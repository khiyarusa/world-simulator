# SIMULATION MODEL — World Simulator

Scope: the deterministic rules engine. No rendering, no UI, no I/O. Everything here runs inside the
simulation worker (`src/sim/**`) and must be executable in plain Node for tests.

Companion documents: `GDD.md` (design intent and constants), `TECHNICAL_ARCHITECTURE.md` (module
boundaries, tick scheduling, worker protocol), `SAVE_AND_DATA_MODEL.md` (persistence).

---

## 1. Design constraints that shaped the model

| Constraint | Consequence for the model |
|---|---|
| 30 FPS on a Mali-G52, 4 GB RAM | No per-citizen agents; no per-tile AI; no per-frame search. |
| 200-year worlds, exact saves | Integer fixed-point for all economy/population; no float accumulation. |
| Same seed ⇒ same world | No `Math.random`, no `Math.sin/cos` in generation, no unordered iteration. |
| Player can inspect "why" | Every decision writes a compact decision record with its top inputs. |
| Camera must not change history | Tier assignment is a rendering-side hint; state never depends on view. |
| 5 stages total | The model is one coherent graph, not 20 optional subsystems. |

## 2. Time model

| Unit | Value |
|---|---|
| Tick | 1 simulated **day** |
| Month | 30 days |
| Season | 90 days (4/year) |
| Year | 360 days |
| Persisted clock | `day: uint32` (supports 11.9 million years; we need 100k) |
| Derived | `year = floor((day-1)/360)+1`, `month = floor(((day-1)%360)/30)`, `season` |

Cadences (all keyed off `day`, never off wall-clock):

```
DAILY     when true                              // settlements Tier 0, population, stock flows
WEEKLY    when day % 7 == 0                      // Tier 1 aggregates, route utilisation
MONTHLY   when day % 30 == 0                     // climate, diplomacy, war, tech, migration
YEARLY    when day % 360 == 0                    // chronicle, census, balance audit
```

Why these cadences: the fastest *real* process in the model (eating) is daily; the fastest
*decision* process (market clearing) is weekly; political decisions are monthly because a war
declared every day would be noise. Yearly passes handle bookkeeping only, and are **sliced across
12 months** so no single tick ever pays the full yearly cost (`PERFORMANCE_BUDGET.md` §5).

## 3. State layout (structure of arrays)

The world state is a set of typed arrays plus a few small object pools. No object graph per entity.
This is what makes serialisation, checksumming and cache behaviour predictable.

```ts
// ---- world grids: length = width*height, row-major, index = y*width + x
interface Grids {
  elevation: Int16Array;     // decimetres above sea level, -2000..9000
  moisture: Uint8Array;      // 0..255 (255 = saturated)
  temperature: Int8Array;    // °C annual mean, -40..+50
  biome: Uint8Array;         // Biome enum (0..15)
  fertility: Uint8Array;     // 0..255
  vegetation: Uint8Array;    // 0..255 biomass
  riverId: Uint16Array;      // 0 = none, else river segment id
  lakeId: Uint16Array;       // 0 = none
  regionId: Uint8Array;      // coarse region index
  ownerCiv: Uint8Array;      // 0 = unclaimed
  resourceMask: Uint8Array;  // bitfield: stone/metal/fertile/harbour/timber
}

// ---- settlements: struct-of-arrays, capacity 200
interface SettlementStore {
  count: number;
  id: Uint16Array; nameIdx: Uint16Array;
  x: Uint16Array; y: Uint16Array;
  civ: Uint8Array; tier: Uint8Array;
  pop: Int32Array;                    // people
  food: Int32Array; water: Int32Array; wood: Int32Array;
  stone: Int32Array; metal: Int32Array; goods: Int32Array;
  treasury: Int32Array;
  health: Uint8Array; stability: Uint8Array; literacy: Uint8Array;
  workers: Uint16Array;               // 8 cohorts × occupations packed per-settlement below
  infra: Uint32Array;                 // bitmask of built infrastructure
  foundedDay: Uint32Array; lastEventDay: Uint32Array;
  detailTier: Uint8Array;             // 0 focus / 1 regional / 2 world (recomputed, not persisted)
  // cohorts: cohort[ s*8 + c ] people count; occupation shares in per-mille
  cohorts: Int32Array;                // 200*8
  occShare: Uint16Array;              // 200*8 per-mille (farm/wood/stone/metal/craft/trade/military/other)
  // rolling buffers for the weekly/daily model
  lastHarvest: Int32Array; foodReserveDays: Uint8Array;
}

// ---- civilizations: capacity 12
interface CivStore {
  count: number;
  id: Uint8Array; nameIdx: Uint8Array;
  capital: Uint16Array;               // settlement id
  treasury: Int32Array;
  tech: Uint16Array;                  // 12 nodes × 4 bits level
  culture: Int8Array;                 // 3 axes × int8 (-100..100)
  legitimacy: Uint8Array;
  warExhaustion: Uint8Array;
  relation: Int8Array;                // 12×12 matrix, row = observer
  grievance: Int16Array;              // 12×12 magnitude
  treaty: Uint8Array;                 // 12×12 treaty type
}
```

Sizes at Medium/cap-200: grids ≈ 14 B × 36,864 ≈ 504 KB; settlements ≈ 200 × ~120 B ≈ 24 KB;
civs ≈ 1 KB; events packed store ≈ 20,000 × 24 B ≈ 480 KB. **Total live state ≈ 1 MB**, which is the
foundation of the memory budget.

### 3.1 Why no ECS framework

A general ECS buys flexibility we do not need (there is one entity type that matters: settlement) and
costs indirection in the hot loop. Struct-of-arrays with explicit ids gives the same cache behaviour
with 200 lines of code and no dependency. Revisit only if Stage 3 profiling shows a real need.

### 3.2 Entity ids and iteration order

Ids are dense `uint16` indices, assigned **in generation order** and never reused within a world.
Every iteration in the simulation is `for (let i = 0; i < count; i++)` over an array. No `Set`, no
`Map`, no `Object.keys` in the tick path (insertion order is stable in JS, but a single refactor can
break it, and sorted integer keys reorder silently). This is a hard rule enforced by lint + review.

## 4. The tick pipeline

The implementation declares **13 stages**; several conceptual stages share one pass over settlements
by construction, and the design document (`docs/STAGE_3_DESIGN.md` §7) is the authoritative map. Order
is fixed; a stage reads only what earlier stages wrote in the same tick, and no system re-reads a value
it has already written.

```
runDay(state):
  1. climate          (MONTHLY) region precipitation/temperature, drought flags + events
  2. ecology          (MONTHLY) vegetation harvest/regrowth, soil erosion/recovery, wildfire, flood, epidemic
  3. labour           (MONTHLY) adult cohorts move toward comparative advantage (70% cap), people conserved
  4. agriculture      (DAILY)   food/water/wood/stone/metal/goods from labour, land, weather, tech, infrastructure
  5. consumption      (DAILY)   food/water/fuel draw, spoilage, health and stability, famine transitions
  6. migration        (MONTHLY) cohort-exact flows out of failing settlements
  7. trade            (MONTHLY) prices, head levy, route creation/movement/closures, tariffs
  8. build            (MONTHLY) utility-scored infrastructure, paid in materials and coin
  9. military         (MONTHLY) army toward fieldable soldiers, coin/food upkeep
 10. diplomacy        (YEARLY)  relation drivers, grievance, treaty proposals/expiry, tribute
 11. war              (MONTHLY) four-condition gate, fronts, attrition, occupation, peace
 12. settlement-growth(MONTHLY) caps, sustained-surplus promotion, founding by arable crowding, collapse
 13. civilization     (MONTHLY/YEARLY) research, spread, literacy, culture drift, civilization formation
 14. chronicle        (YEARLY)  per-civilization aggregates from real events
     plus: demography + ageing at year end; syncPopulation projects cohorts into the legacy array
```

There is no double buffering. The order is the contract: production is computed before consumption, and
the audit is a separate harness phase, not a simulation stage. Every loop is over `0..count` in id order.

## 5. Economy rules (exact formulas)

All values are integers. `per_mille` means `/1000`; fractional production is carried per settlement and
resource in `carry` (0..999) so daily flows conserve to the unit.

```
// --- agriculture (daily, per settlement)
landCap     = 220 + 20 × fertility(tile)              // arable capacity, one source: economy.landCapacity
landPm      = clamp(300, 1000, landCap × 1000 / pop)  // yield per farmer falls as land fills
fertilePm   = 700 + 3 × fertility(tile)               // 0.7x .. 1.465x
harvest     = farmers × 6000 × seasonPm × droughtPm × fertilePm × landPm × techPm
              / 1000^4 ; seasonPm = [500, 800, 1100, 1000], droughtPm = 400 when struck
techPm      = 1000 + 80 × agriculture techs; irrigation multiplies by 1150/1000

// --- extraction / craft (daily, same pass)
wood        = extractors × (timber tile ? 3000 : 1500) × industryPm / 1000
stone/metal = extractors × (deposit ? 2000 / 1200 : 0) × industryPm / 1000
goods       = min(crafters × 500 × workshopPm × industryPm, metal×1000, wood×1000) / 1000
              consuming one metal and one wood per good

// --- consumption (daily)
needFood    = pop × 1000 milli = pop units
needWater   = pop × 1200 milli
needFuel    = pop × 150 milli
spoilage    = max(1 if food>0, food × 1 / 1000)
health     ±= food/water/fuel shortfall, density, well/aqueduct/temple
stability  ±= food, health, crowding, occupation, temple, treasury

// --- prices (monthly, per settlement, per resource)
perPerson   = stock × 1000 / pop
price       = clamp(250, 3000, targetDays × 1000 × 1000 / max(1, perPerson))

// --- trade (monthly, per route)
capacity    = routeCapacity(units/day) × 30, capped by 80/day at creation
qty         = min(capacity, seller surplus above reserve, buyer deficit, buyer free cap, buyer affordable)
buyer pays  = floor(qty × sellerPrice / 1000) + floor(value × tariff / 1000)
              from buyer treasury to seller treasury (coin is transferred, never created)

// --- treasury (monthly)
tax         = pop × (600 + 4 × stability) / 1000      // the only faucet; the state's claim on production
spend       = infrastructure coin cost, army upkeep, tribute (all transfers or real construction)
```

Resource caps are recomputed monthly from population and infrastructure; a cap never falls below the
stock already held, so shrinking a settlement cannot delete goods its people own.

Population identity: `initial + births − deaths == final` exactly, with starvation, epidemic and war
deaths counted as the number of people actually removed from cohorts. Occupation changes and migration
are paired transfers within or between settlements.

## 6. Population cohorts

Per settlement, 8 cohorts: `children(0–14)`, `youth(15–24)`, `farmers`, `extractors`, `crafters`,
`traders`, `soldiers`, `elders(60+)`. The total is the settlement population; `settlements.pop` is a
per-tick projection of it (D-42).

- Ageing is yearly: children→youth `1/15`, youth→farmers `1/10`, farmers→elders `1/40`; remainders stay
  in the source cohort, so rounding never creates or destroys a person.
- Occupation is monthly: labour moves toward the measured comparative advantage of the settlement (land,
  deposits, materials, routes, threat) at up to 1.5 % of adults per month, with a **700‰ cap per
  occupation**. Every move is a paired transfer between adult cohorts.
- The five adult cohorts' per-mille projection is stored in `occShare` and sums to exactly 1000.
- A cohort is a **number**, not an agent: no pathfinding, no inventory, no per-person decision.

## 7. Decision making (utility AI)

Three decision sites, all using the same scorer:

| Site | Cadence | Options |
|---|---|---|
| Settlement build | daily (budget-gated) | build granary / well / irrigation / walls / market / workshop / road / temple / academy / barracks |
| Civilization strategy | monthly | expand / fortify / trade / research / mobilize / appease / declare war |
| Notable character action | monthly | govern / lead army / explore / intrigue / retire |

### 7.1 Scorer (shared implementation, no allocation)

```
score(option) = compensate( Π curve_i(input_i) )

curve: linear / inverseLinear / logistic(mid,k) / step / bell(mid,width)
each curve output clamped to [0,1000] (integers, per-mille-free)
compensate(p, n) = p^(1/n) implemented as an integer 4-step approximation table
veto: if any input curve returns 0, score = 0 (hard precondition)
hysteresis: keep the current choice unless best − current ≥ 50
```

0–1000 integers (not floats) keep the scorer deterministic and comparable across saves.

### 7.2 Decision records (explainability)

Every scored decision writes a compact record, capped at 64 bytes, into a ring buffer:

```ts
interface DecisionRecord {         // 12 bytes packed + variable option table
  day: u32; actorKind: u8; actorId: u8;
  kind: u8; chosen: u8; runnerUp: u8;
  score: u16; runnerUpScore: u16; topInputHash: u16;
}
```

Top-3 options and their dominant inputs are materialised **only on demand** (when the player inspects
that actor) by re-running the scorer against the saved scalar inputs. That gives full explanations at
near-zero steady-state cost. This is the mechanism behind GDD §14.2 "Why?" and PRODUCT_BRIEF P6.

### 7.3 Why utility AI, and where a BT would appear later

- Utility fits the problem: many graded trade-offs over continuous variables (food vs. walls vs.
  market), tuned by culture weights, and inherently explainable.
- FSMs are used **inside** war (phases: `mobilize → advance → siege → hold → sue`) and inside
  settlement crisis handling (`normal → shortage → famine → exodus`), where transitions are few and
  obvious. Follows the `game-ai` skill's rule: start with an FSM, promote only when transitions stop
  fitting.
- Behavior trees are **not** used in P0. They add a runtime and a lifecycle contract for behaviour
  that does not yet exist (no individual agents to sequence). If Stage 3 reveals a need for
  multi-step individual behaviour, a BT would be added for *characters only* — never for the whole
  simulation. Recorded as a deliberate omission, not an oversight (`TECHNICAL_DECISIONS.md` D-09).

### 7.4 Randomness in decisions

Seeded randomness is allowed **only** as a bounded tie-breaker: when two options score within 10/1000,
the pick uses `hash(seed, stream=DECISION, day, actorId) & 1`. No random "personality rolls" and no
random war declarations. Every random consumer draws from a named stream so adding a new consumer
cannot reshuffle existing ones.

## 8. Diplomacy resolver (monthly)

```
for a in civs: for b in civs where b != a:
  d = 0
  d += tradeBonus(a,b)                    // +1..+3 if active route
  d -= borderFriction(a,b)                // f(shared border length, crowding)
  d -= ideologyDistance(a,b) / 40         // 0..2
  d -= grievanceDecayed(a,b) / 60
  relation[a][b] = clamp(relation + d, -100, 100)
  grievance[a][b] = grievance * 970 / 1000   // 3%/month decay

  if canDeclareWar(a,b) and utility("war", a) beats alternatives by hysteresis:
      declareWar(a,b)   // writes event with cause = grievance contributors
```

`canDeclareWar` is exactly the four-condition gate in `GDD.md` §10.3. A failed gate writes a
`war_blocked` decision record with the failing condition id — so "why is there peace?" is answerable.

## 9. War resolver (monthly)

```
for each war w:
  for each front f in w.fronts:
    sA = strength(civA, f); sB = strength(civB, f)
    delta = clamp((sA − sB) × 8, −12, +12)
    w.score += delta
    casualties = engaged × attritionRate(sA,sB) / 1000
    supplyA -= engaged × 1000 ; supplyB -= engaged × 1000
    if w.score > 35 and f.contested: occupyNextSettlement(f)
  exhaustionA += 1 + (shortfall ? 2 : 0)
  if |score| >= 60 or (exhaustionA>=80 and exhaustionB>=80) or mediation:
      signPeace(w)   // territorial cession, tribute, or status quo ante
```

Post-war: `grievance += 30..60`, `legitimacy ±10`, `trade routes through former front destroyed`,
`refugees = displaced × 0.25` injected into migration queues for 6 months.

## 10. Migration resolver (monthly)

Deterministic, conservative, bounded:

```
candidates = settlements sorted by (deficit desc, id asc)   // stable, explicit sort
for each source s:
  budget = pop_s × 80 / 1000                               // max 8%/month
  for each destination d in reachable(s) (≤ 4 by score):
     flow = min(budget, capacity(d) − pop_d, pull(d) − push(s))
     if flow > 0: queue transfer (s → d, flow)
  commit all queues in a single pass (population conserved exactly)
```

Reachability uses the **route graph + land adjacency ≤ 8 tiles**, never A* per person and never a
per-frame search. Cost is O(settlements × 4) per month.

## 11. Ecology resolver

```
MONTHLY per region:
  tempAnomaly   = noise(seed, CLIMATE, region, year*12+month) − 500    // −5..+5 °C
  precip        = base(region) × seasonal × (moisture/255) × (1 + anomaly/20)
  drought       if precip < 400‰ of normal for 2 consecutive months
  flood         if precip > 1800‰ and riverId != 0 and slope < threshold
  wildfire      if temp > 30 && dryDays > 60 && vegetation > 120 && roll(seed, FIRE, cell) < p
DAILY per cell (only cells in owned/loaded regions):
  vegetation += growth(biome, moisture, temp) − harvest(timber)
  fertility  += deposit(flood) − erosion(slope, lowVegetation, rain)
```

Long-run equilibrium is intentional: forests regrow unless cleared faster than ~1.2%/year; fertility
declines only under sustained over-harvest. That makes ecological mismanagement a *slow* failure the
player can actually observe, rather than a hidden timer.

## 12. Events and causes

```ts
createEvent({ type, day, place, actors, magnitude, severity, causeId, outcome }):
  push into ring buffer (20k, evict lowest (severity, age))
  if severity >= 4: also append to `majorEvents` store (never evicted)
  link cause chain: causeId must exist or event is created without a cause (never fabricated)
```

Event types (v1, closed set of 42): `civ_founded, settlement_founded, settlement_abandoned,
settlement_destroyed, tier_up, drought, flood, wildfire, epidemic, famine, boom, migration_wave,
route_opened, route_lost, treaty_signed, treaty_broken, war_declared, battle, siege, peace_signed,
tech_discovered, capital_moved, fragmentation, collapse, golden_age, player_intervention,
player_blight, player_fertilize, player_gift, player_incite, …`

Cause chains are built **forward**: the producer passes `causeId` when it creates the event (the
drought event id is passed into the famine event). No post-hoc inference, no guessing.

## 13. Sim LOD (detail tiers)

```
every simulated day (after migration phase):
  view = last view rect from renderer (or "none")
  for each settlement: score = inView ? 3 : (nearView ? 2 : (isCapital ? 1 : 0))
  tier = 0 if score >= 2 or selected or capital, capped at 24 by distance
        = 1 if score >= 1, capped at 96
        = 2 otherwise
  apply changes with hysteresis: a settlement must hold a new tier for 2 days to switch
```

Rules:
- Tier changes **never** touch simulation inputs, only update cadence.
- Aggregation functions are designed so a Tier 2 settlement run for 30 days produces statistically
  the same trajectory as a Tier 0 settlement run daily (validated by a Stage 3 A/B invariant test:
  same seed, one world with camera fixed, one with camera moving — final checksum must match).
  Where an exact match is impossible, the test asserts final population within ±0.5% and identical
  event sets. This is the strongest practical guarantee that "watching doesn't change history".

## 14. Catch-up on resume

Long absence must not explode. On load:

```
away = clamp(realDaysAway, 0, 30)
target = min(away × 7, 30) simulated days     // ≤ 30 days of world time on resume
run target ticks with the normal pipeline at max speed, budgeted at 3 ms/tick
if budget exceeded: stop early (the world "waited"), never interpolate or fabricate
```

The result is deterministic given `away` (it depends on the load's wall-clock delta, which is part of
the save metadata, so the same save produces the same catch-up once).

## 15. Invariants (machine-checked)

| Id | Invariant | When |
|---|---|---|
| INV-1 | Resource conservation per resource | every tick (dev), every 1000 (prod CI) |
| INV-2 | Population conservation | every tick |
| INV-3 | `0 ≤ health, stability ≤ 100`; `0 ≤ culture axis ≤ 100` (offset) | every tick |
| INV-4 | No settlement id out of range; `ownerCiv` valid or 0 | every tick |
| INV-5 | `day` monotonic; no phase depends on wall-clock | every tick |
| INV-6 | Tier assignment does not change final checksum (A/B test) | CI |
| INV-7 | Same seed + command log ⇒ same checksum at day 10,000 | CI |
| INV-8 | Every persisted event has a valid `causeId` or null, never dangling | CI |
| INV-9 | Save → load → 1000 ticks ⇒ checksum equals uninterrupted run | CI |
| INV-10 | No allocation per tick beyond fixed ring buffers (heap growth < 1 MB / 10k ticks) | CI perf |

## 16. Balance audit harness (Stage 3 deliverable, specified now)

```
for seed in 0..19:
  create Medium world, run 400 years at max speed headless
  assert: 3 of 4 narrative arcs present (GDD §16)
  assert: world pop within [150k, 800k]
  assert: ≥ 4 civs alive at year 400 or ≥ 2 collapsed with recorded cause
  assert: no settlement above tier capacity, no negative stocks
  report: settlements/year, wars/century, famines/century, mean stability
```

Numbers are reported as *observed*, never as promises. The first run of this harness is the first
moment the design's balance claims become evidence.
