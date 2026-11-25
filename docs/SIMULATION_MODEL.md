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

Order matters and is fixed. Each phase reads the state produced by earlier phases **of the previous
tick** where noted; the double-buffered fields are marked `(prev)`.

```
tick(day, dt):
  1. clock        update derived season/month; emit calendar events
  2. climate      (MONTHLY) temperature anomaly, precipitation per region
  3. ecology      vegetation growth, erosion, wildfire, flood checks
  4. fertility    soil update from vegetation/erosion/flood deposits
  5. agriculture  per settlement: harvest = f(land, labour, water, tech, season, weather)
  6. extraction   wood/stone/metal from owned tiles, capped by vegetation/deposits
  7. craft        goods = f(metal, wood, labour, tech)
  8. consumption  food/water/fuel per capita; spoilage; reserve days
  9. health       from sufficiency, sanitation, epidemic flag
 10. demographics births/deaths (MONTHLY), cohort ageing (YEARLY slice)
 11. stability    from food/health/war/tax/crowding/disaster memory
 12. migration    (MONTHLY) compute flows, resolve in id order, conserve population
 13. trade        (WEEKLY) route capacity, price gaps, movement, tariffs
 14. build        utility-scored infrastructure, paid from surplus + treasury
 15. military     manpower, upkeep, supply stock
 16. diplomacy    (MONTHLY) relation deltas, treaty proposals, war declarations
 17. war          (MONTHLY) fronts, attrition, occupation, peace
 18. settle-growth/decline, fragmentation, abandonment, new settlement founding
 19. civ          (MONTHLY) legitimacy, culture drift, tech spread
 20. events       flush decision records → events, cause links, severity filter
 21. chronicle    (YEARLY slice) per-civ summary, downsample old events
 22. audit        (dev only) invariants: conservation, bounds, id validity
```

**Read/write discipline.** Phases 5–12 read `pop(prev)` and write proposals; the proposal buffers are
committed in phase 12. This prevents "order of iteration changes the outcome" bugs (e.g. a settlement
consuming food a neighbour has not yet produced).

## 5. Economy rules (exact formulas)

All values integer. `per_mille` means `/1000`.

```
// --- agriculture (daily, per settlement, Tier 0 detail)
land        = ownedTiles × biomeYield[biome] × fertility/255
labour      = cohortAdults_farm × 2.6            // 1 farmer feeds ~2.6
seasonMul   = [0.15, 0.45, 1.00, 0.55][season]   // winter..autumn (hemisphere-agnostic)
weatherMul  = 400..1600 per_mille from drought/flood
techMul     = 1000 + 150 × techLevel(Agriculture)
harvest     = (land × labour × seasonMul × weatherMul × techMul) / (1000^3)

// --- consumption (daily)
needFood    = pop × 1000                        // 1.000 grain/person/day, in milli-units
needWater   = pop × 2000
needFuel    = pop × 150                         // wood
shortfall   = max(0, needFood − food)
food       -= min(food, needFood)
spoilage    = food × spoilagePerMille(tier, season) / 1000   // 0.2%–1.5%/day

// --- starvation (daily, applied monthly in aggregate)
starving    = shortfall / 1000                  // person-days lost
health     -= clamp(starving / pop × 400, 0, 3)
deaths     += starving × 0.9                    // people

// --- prices (weekly, per settlement, per resource)
demand      = consumptionRate × 7
supply      = stock + productionRate × 7
price       = basePrice × clamp(demand×1000 / max(supply,1), 400, 3000) / 1000

// --- trade (weekly, per route)
gap         = price[dest] − price[src] − tariff − transportCost(distance)
if gap > 0: move = min(routeCapacity, src.stock − src.reserve, dest.stockCap − dest.stock)
            wealth[src] += move × price[src] × tariffPerMille / 1000
```

Conservation invariants (tested every tick in dev, every 1000 ticks in CI production profile):
`Σ food_created − Σ food_consumed − Σ spoil = Σ food_stock` and the same for water/wood/stone/metal/
goods. Population: `Σ births − Σ deaths − Σ emigrants + Σ immigrants = Σ pop` exactly (integer).

## 6. Population cohorts

Per settlement, 8 cohorts: `children(0–14)`, `youth(15–24)`, `adult_farm`, `adult_extract`,
`adult_craft`, `adult_trade`, `adult_military`, `elders(60+)`.

- Ageing is applied in 12 yearly slices (one cohort block per month) so no tick spikes.
- Occupation shares move toward the sector with the highest marginal yield, capped at **700‰ per
  sector** (anti-monoculture) and floored at 50‰ for food.
- Military share is capped by `war_capacity` and decays after peace.
- A cohort is a **number**, not an agent: no pathfinding, no inventory, no per-person decision.

Consequence: 200 settlements × 8 cohorts = 1,600 integers updated daily, i.e. negligible. The cost
sits in the *rules* (multiplications), not the entities, which is why the model scales.

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
