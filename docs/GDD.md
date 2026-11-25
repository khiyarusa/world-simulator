# GAME DESIGN DOCUMENT — World Simulator

Stage 1 baseline. All numbers here are **design starting values**, to be tuned with the automated
balance harness (Stage 3+) and playtests. They are consistent with `SIMULATION_MODEL.md`,
`WORLD_GENERATION.md` and `PERFORMANCE_BUDGET.md`; if a number changes, it changes in one place and
the others link here.

---

## 1. Premise and player fantasy

You hold a world. Not a kingdom in it — the world itself. Nobody asks you for orders. You drop a
seed, press play, and civilizations reason their way into prosperity, rivalry, and ruin. Your
pleasure is **understanding**: catching the drought that started it, following the refugees, seeing
the war three generations later.

The fantasy is the naturalist's, not the general's: *"I know why this happened."*

## 2. Core loop (30 seconds → 30 hours)

```
create world  →  watch  →  notice something  →  inspect & trace cause
      ▲                                              │
      │                                              ▼
  save / new world  ←  intervene (optional)  ←  form a hypothesis
```

| Timescale | Player activity |
|---|---|
| 0–30 s | Pan, zoom, tap a settlement, read a number, change speed. |
| 2–5 min | Follow one civilization; watch a shortage turn into a migration. |
| 20–60 min | Compare two civs' trajectories; read a chronicle decade; intervene to test a theory. |
| Hours / days | Return to a world at year 300, read what happened while away. Start a new seed. |

**There is no fail state.** Collapse is content. The player can lose nothing except a world they
delete.

## 3. Player role and powers

The player is an **observer with a light hand**. Powers are deliberately limited so that causality
stays legible and the world does not become a puppet show.

| Power | P0 | Bounds |
|---|---|---|
| Create world (seed + preset + difficulty knobs) | Yes | Preset governs size, water, hostility, starting civ count |
| Pause / 1× / 2× / 4× / 8× | Yes | Hard cap on simulated days per second (see §12) |
| Pan / zoom / rotate-free camera | Yes | Zoom 0.25×–8× tiles-per-pixel band |
| Inspect anything (settlement, civ, region, river, event) | Yes | Read-only, always available |
| Information layers (political, terrain, population, economy, ecology, history) | Yes | 6 layers |
| **Bless**: send a one-off resource gift to one settlement | Yes | Cooldown 1 year; magnitude ≤ 10% of its annual stock |
| **Blight**: force a drought in one region | Yes | Cooldown 3 years; duration 1 season |
| **Fertilize**: raise soil fertility in a small area | Yes | Cooldown 5 years; +15 fertility for 5 years |
| **Incite**: raise tension between two civs | Yes | Cooldown 5 years; +15 relation delta, may be refused |
| Place buildings / draw roads / command armies | **No** | Never. That is a different game. |
| Edit terrain / delete civs mid-run | **No** | Only through world creation parameters |

Interventions are logged as events with `actor: player`, so their consequences remain traceable and
the chronicle stays honest ("Year 214: the riverlands withered — cause: unknown blight").

## 4. World creation

### 4.1 Flow

1. **Seed** — typed, random, or "copy from a friend". Seed is a 64-bit integer rendered as a
   base-32 word pair (e.g. `K7F2-QJ9M`) so it is shareable and typo-resistant.
2. **Preset** — `Small / Medium / Large` (see §4.2) plus three sliders: **Water** (dry ↔ wet),
   **Harshness** (temperate ↔ extreme), **Peoples** (1–12 starting bands).
3. **Preview** — a 2-second generated thumbnail of the actual map (computed in a worker, cancelled
   if the player keeps dragging).
4. **Confirm** — the world is generated deterministically and the simulation starts paused at
   Year 1, Day 1.

### 4.2 Presets

| Preset | Grid | Tiles | Land (typical) | Target settlements at yr 300 | Save size target |
|---|---|---|---|---|---|
| Small | 128 × 128 | 16,384 | ~45% | 25–60 | ≤ 0.6 MB |
| **Medium (default)** | 192 × 192 | 36,864 | ~40% | 45–120 | ≤ 1.2 MB |
| Large | 256 × 256 | 65,536 | ~35% | 80–200 | ≤ 2.0 MB |

`1 tile ≈ 3 km`; Medium is ≈ 576 × 576 km. This is a **narrative abstraction**, not a measurement;
it exists so distances, travel times and trade decay read sensibly.

Why not bigger: at 256² the whole terrain fits in one 2048² texture and ~1 MB of typed arrays, and
200 settlements is already more than a player can hold in mind. Larger worlds add cost without
adding decisions. See `TECHNICAL_DECISIONS.md` D-07.

## 5. The simulation in one page

### 5.1 Three detail tiers

The world never simulates every inhabitant. Population is **aggregated by settlement**, and
settlements are simulated at three levels of detail:

| Tier | Scope | Update rate | Cost per update |
|---|---|---|---|
| **Tier 0 — Focus** | ≤ 24 settlements near the camera + selected + capital cities | every day | full production/consumption/needs chain |
| **Tier 1 — Regional** | ≤ 96 settlements in loaded regions | every 7 days | coarse economy + demographics + migration |
| **Tier 2 — World** | remaining settlements (cap 200) | every 30 days | closed-form logistic + trade equilibrium |

Tier assignment is a pure function of camera and selection, executed **inside the worker** (the
renderer sends a view rectangle, never a state mutation). Re-tiering is throttled to once per
simulated day, so scrolling the camera cannot change the simulation's trajectory. This is the single
most important anti-cheat against "the world changes when I look at it".

### 5.2 Entities

| Entity | Count cap | Representation |
|---|---|---|
| World | 1 | struct-of-arrays grids + region graph |
| Region | ~64–256 | coarse cells (4×4 tiles) with climate, biome mix, carrying capacity |
| Civilization | 12 | scalar block + relation matrix + tech vector + culture vector |
| Settlement | 200 | struct in typed arrays + per-settlement cohort arrays (8 cohorts) |
| Trade route | 400 | edge with capacity, length, tariff, usage |
| Notable character | 60 | small record (name, age, role, traits, allegiance, deeds) |
| Event | 20,000 persisted | packed record + cause link |

There are **no per-citizen entities**. A settlement's people are 8 cohorts (children, youth,
adults × 3 occupations, elders) plus scalar health/literacy/cohesion. This is the design decision
that makes 200-year worlds and 30 FPS compatible (see `SIMULATION_MODEL.md` §3).

### 5.3 Feedback loop map (must stay acyclic at tick time)

```
            climate/season ──────────────┐
                  │                       │
                  ▼                       ▼
   soil fertility → agriculture → FOOD ──► health ──► deaths, productivity
        ▲              │            │        │
        │              │            ▼        ▼
   vegetation ◄────────┘        reserves   stability ──► migration ──► neighbouring settlements
        ▲                          │           │                          │
        │                          ▼           ▼                          ▼
     wood/soil              trade & prices   unrest/abandon        population pressure
                                   │           │                          │
                                   ▼           ▼                          ▼
                              wealth ──► infrastructure ──► capacity   border friction
                                   │                                     │
                                   ▼                                     ▼
                            military capacity ──────► war ◄──── diplomacy ◄── rivalry
                                                        │
                                                        ▼
                                              destruction → refugees → food shock
```

Cycles exist *across* days, never within one tick: each system reads the previous day's state and
writes to its own outputs. The tick pipeline in `TECHNICAL_ARCHITECTURE.md` §6 enforces this
(double-buffered reads), which is what makes the simulation both stable and deterministic.

## 6. Population and needs

### 6.1 Needs (per person per day, baseline)

| Need | Amount | If unmet |
|---|---|---|
| Food | 1.0 grain unit | health −, then deaths at 4%/month |
| Water | 2.0 units (from local sources, not transported) | health −− (dry regions only) |
| Fuel/shelter | 0.15 wood | health −, unrest + |
| Safety | qualitative (war, raid, disaster) | migration pressure + |

### 6.2 Demographics (annual rates, applied monthly)

```
births/yr = pop × 0.032 × food_ok × health_factor × housing_factor
deaths/yr = pop × 0.014 + crisis_deaths
net steady-state growth ≈ 1.8%/yr  →  population doubles in ≈ 39 years
```

Crisis deaths are computed, not rolled: starvation deaths = unmet_food_units × 0.9 per day;
epidemic deaths scale with density and sanitation; war deaths come from the war resolver.

### 6.3 Health and stability

```
health     0..100   ← food & water sufficiency, sanitation, epidemics, war
stability  0..100   ← food, health, taxation, crowding, war, recent disasters, cohesion
```

| Stability | Consequence |
|---|---|
| ≥ 60 | growth, investment, cultural output |
| 30–59 | stagnation, slower building |
| 15–29 | emigration, unrest events, tax evasion |
| < 15 for 3 consecutive months | **fragmentation**: a splinter group founds a new settlement |
| < 8 for 6 consecutive months | **abandonment**: settlement is ruined, population disperses |

### 6.4 Migration

Migration is a flow, not an event. Each month, a settlement computes:

```
push    = food_deficit + unrest + war_risk + crowding
pull(d) = destination_surplus + safety + kinship + route_access
flow(d) = clamp( pop × 0.02 × (push − pull(d)) / 100 , 0, pop × 0.08 )
```

Constraints: a destination must be reachable (land path ≤ 8 tiles, or a trade route, or coast for
sea migration); receiving capacity is capped; flows are resolved in a deterministic settlement-id
order and subtract from the source in the same tick they add to the destination, so population is
conserved exactly (checked by a CI invariant).

## 7. Settlements

### 7.1 Tiers (emergent, never assigned)

| Tier | Pop | Unlocks |
|---|---|---|
| Camp | 0–60 | foraging, a fire, no storage |
| Village | 60–500 | fields, granary, well |
| Town | 500–5,000 | walls, market, workshop, specialization |
| City | 5,000–40,000 | aqueduct, academy, standing army |
| Metropolis | 40,000+ | regional capital, wonders, cultural spread |

A settlement promotes only when its food surplus has held for 2 consecutive years and its
infrastructure meets the tier requirement. Demotion happens through collapse (never silently).

### 7.2 Infrastructure (chosen by the settlement, not the player)

`granary · well · irrigation · walls · market · workshop · road · temple · academy · aqueduct ·
barracks · harbour`

Each has a cost (wood/stone/metal/labour-days), a prerequisite tier, and an effect on a simulated
variable. Selection uses **utility scoring** with a build budget of 25% of surplus (§`SIMULATION_MODEL.md` §7).

### 7.3 What makes settlements differ

No two settlements get identical outcomes, because six inputs differ: biome mix, water access,
river/coast flag, resource endowment, neighbours, and history (raids, disasters, migrations). The
*strategy* differences emerge from utility weights, which drift with culture — an agrarian culture
weights food security higher; a martial culture weights walls and manpower.

## 8. Civilizations

### 8.1 Formation

A civilization forms when a settlement reaches Village tier **and** either (a) controls ≥ 2
settlements, or (b) has stability ≥ 70 and literacy ≥ 10 for 5 years. Formation is an emergent
event with a recorded cause, not a spawn rule.

### 8.2 Identity (derived, then drifting)

```
culture.axes = { Agrarian ↔ Martial , Mercantile ↔ Isolationist , Traditional ↔ Scholarly }
```

Initial values are computed from environment and early history: river + fertile → Agrarian; hostile
neighbours + mountains → Martial; coast + crossroads → Mercantile. Axes drift by ±1 per decade
toward whatever the civilization actually did (won wars → Martial; built academies → Scholarly).
Culture then feeds back into utility weights, so identity is *caused by history* and *causes future
history*.

### 8.3 Technology

12 nodes, 4 branches × 3 tiers: `Agriculture I–III`, `Industry I–III`, `Military I–III`,
`Civic I–III`. Research points per month:

```
research = 0.4 × surplus_labour + 0.3 × literacy + 0.2 × contacts + 0.1 × academies
```

Tech spreads through trade routes and proximity at 15% of the holder's level, so isolation is a real
strategic cost and contact is a real benefit.

### 8.4 Government and legitimacy

Three forms, emergent from size and stability: **Band → Chiefdom → State**. Each form changes how
much surplus the centre extracts and how fast it can raise military capacity. Legitimacy is a
0–100 derivative of stability history; low legitimacy raises fragmentation risk.

## 9. Economy

### 9.1 Resources (six + treasury)

| Resource | Source | Use |
|---|---|---|
| Food (grain) | farms, foraging, fishing, herds | consumption, spoilage, war supply |
| Water | wells, rivers, aqueducts | consumption, irrigation |
| Wood | forests | fuel, building, boats |
| Stone | quarries | building, walls |
| Metal | mines, smelting | tools (+productivity), weapons |
| Goods | workshops | wealth, luxury, trade, morale |
| Treasury | tax on surplus + trade tariffs | infrastructure, army upkeep, diplomacy |

### 9.2 Integer, not float

All stocks are **integer fixed-point** (`1 unit = 1 person-day of food`; rates in per-mille).
This kills float drift over 200 years, makes saves exact, and makes conservation invariants testable
to the unit. Floats are permitted only inside world generation and in display formatting.

### 9.3 Prices and trade

```
local_price(r) = base_price × clamp(demand / max(supply, 1), 0.4, 3.0)
route_capacity = min(infra_capacity, 40 × (1 − distance/40)) × relation_factor
```

Each route moves up to capacity of the resource with the largest price gap, tariffed at 5–20%.
Trade requires relationship ≥ 0 and an existing route. Routes are built by settlements when a
profitable gap persists for 2 years (another utility decision), and decay when unused.

### 9.4 Specialization

A settlement's production mix converges to its comparative advantage: high-fertility river land
→ grain; forest → wood/tools; mountains → stone/metal; coast → fish/trade. Specialization is
emergent (workers shift sector when a sector's marginal yield is higher) but bounded at 70% of the
workforce, so no settlement becomes a monoculture that dies from one bad harvest. That bound is a
deliberate anti-fragility rule.

## 10. Diplomacy

### 10.1 Relationship model

Each ordered pair holds `relation ∈ [−100, +100]` plus a **grievance memory** (decaying list of past
offences with magnitude and age). Relations are updated monthly from:

| Driver | Δ/month |
|---|---|
| Shared trade route, active | +1 … +3 |
| Border contact without treaty | −1 · friction(border_length, crowding) |
| Ideological distance (culture axes) | −0 … −2 |
| Recent war (per 5 years) | −5 decaying |
| Gift / marriage / shared enemy | +3 … +8 |
| Player "Incite" | −15 one-off |

### 10.2 Treaties

`Non-aggression · Trade agreement · Alliance · Tribute · Border settlement`

Treaties are proposed by utility AI with an explicit expected-value calculation and can be refused.
Each treaty has a duration, an expiry event, and a breaking cost (legitimacy and relations).

### 10.3 Why wars start (and why they often don't)

War declaration requires **all** of:

1. `relative_strength ≥ 1.25` (or desperation: own food deficit > 30% for 2 years), **and**
2. `grievance_score ≥ 40` (border friction, broken treaty, ideology, past defeat), **and**
3. `war_capacity ≥ 1` (surplus food for 1 year, manpower, no active war, exhaustion < 50), **and**
4. utility score of `declare_war` beats all alternatives by the hysteresis margin (50/1000).

If any condition fails, no war — and the *reason* is stored in the decision record, so the player can
inspect "why peace?" This is the direct answer to "avoid random war declarations".

## 11. Warfare

Abstract, operational, monthly. No tactical battlefield, no unit sprites moving (see
`TECHNICAL_DECISIONS.md` D-11).

```
strength(civ) = manpower×0.40 + tech×0.30 + supply×0.20 + morale×0.10   (each normalised 0..1)
front_delta   = (strength_A − strength_B) × 8    per month, clamped to ±12 war score
attrition     = 0.5% … 4% of engaged manpower per month, scaled by tech and supply
```

- **Fronts** exist per shared border region, not per tile.
- **Occupation** occurs when war score crosses ±35 in a contiguous border region; occupied
  settlements pay tribute and lose 20% production; they revert on peace unless ceded.
- **War exhaustion** rises 1–3/month per side; at ≥ 80 a side accepts any peace with score ≥ −20.
- **Peace** triggers at |score| ≥ 60, mutual exhaustion, or a third-party mediation event.
- **Consequences** (all simulated, all logged): deaths, food drain, ruined infrastructure,
  refugee flows (migration surge), trade route destruction, legitimacy shifts, post-war grievance
  memory that shapes the next 50 years.

## 12. Simulation speed and time

- 1 tick = **1 simulated day**. 1 year = 360 days = 12 months of 30 days; 4 seasons of 90 days.
- Real time per day: **1× = 400 ms** (≈ 2.5 days/s, ≈ 2.4 min per year), 2× = 200 ms, 4× = 100 ms,
  8× = 50 ms.
- Pause is a true stop: no ticking, no background catch-up while the app is foregrounded.
- Hard bound: at most **4 day-ticks per rendered frame** and a backlog cap of 30 ticks. Beyond that,
  the world *visibly* slows and a small "sim lag" indicator appears. The simulation never
  accumulates unbounded debt and never allocates unbounded work (see `PERFORMANCE_BUDGET.md` §5).
- On resume from a long absence, catch-up is capped at 7 simulated days per world-day-away, up to
  30 days of real absence, then stops (the world "waited" rather than exploding).

## 13. Ecology

| System | Model | Propagates to |
|---|---|---|
| Seasons | 4 × 90 days; temperature and insolation curves | yields, growth, fuel need |
| Weather | monthly per region: temp anomaly, precipitation | drought/flood trigger |
| Drought | ≥ 2 consecutive months at < 40% normal precipitation | food −20…−60%, water −, unrest + |
| Flood | extreme precipitation on a river cell | buildings destroyed, harvest −, deaths |
| Wildfire | dry + hot + fuel load, seeded roll | wood −, fertility + after 2 years |
| Vegetation | per-cell biomass 0–255, slow growth, harvest | wood yield, erosion |
| Erosion | low biomass + slope + rain | fertility − (long-term) |
| Epidemic | density × sanitation × trade contact | deaths, migration, trade closure |

Disasters are **not random decorations**: each is triggered by state, has a magnitude computed from
state, and writes into the same variables everything else reads. A wildfire in a well-managed forest
is a small event; in an over-harvested one it is a civilizational problem.

## 14. History

### 14.1 Events

Every event record contains: `id, day, type, place, actors[], magnitude, severity(1–5), causeId|null,
outcome`. Severity:

| Sev | Meaning | Persistence |
|---|---|---|
| 5 | World-changing (collapse, great war, founding of an age) | kept forever |
| 4 | Major (famine, migration wave, treaty, city founded) | kept forever |
| 3 | Notable (disaster, route opened, tech discovered) | kept 200 years, then chronicled |
| 2 | Local (build completed, small raid) | aggregated into yearly stats |
| 1 | Debug/trace | never persisted |

### 14.2 Cause chains

Each event stores `causeId`, forming a DAG. The UI exposes "Why?" walking up to 8 links:

> *Year 214 famine (sev 4) ← harvest −62% ← drought (sev 3) ← precipitation deficit ← 2 months below
> 40% ← regional climate shift. Contributing: forest clearance raised erosion 18%.*

### 14.3 Chronicle

At each year end the sim compiles a per-civilization chronicle entry (≤ 120 words): population,
territory, the 3 highest-severity events, and one "state of the realm" sentence. This gives the
player a readable history even after 500 years, at bounded storage cost (~2 KB/civ/year, capped by
downsampling years older than 200).

## 15. Player experience: information layers

| Layer | Encodes | Read at a glance |
|---|---|---|
| **Political** | civ territory tint, borders, capitals | who owns what |
| **Terrain** | biomes, relief shading, rivers | where things can grow |
| **Population** | per-settlement dot size/heat | where people are |
| **Economy** | route lines, resource icons, surplus/deficit tint | what flows, where it breaks |
| **Ecology** | vegetation, drought/flood scars | pressure on the land |
| **History** | event pins, decayed by age | what happened here |

Layers are additive-capped: one base layer + one overlay at a time, to preserve legibility on a
6.4-inch screen.

## 16. Progression and emergent narrative

There is no XP, no unlocks, no meta-currency. Progression is **understanding**: the same world gets
more legible as the player learns its systems, and the world itself escalates from bands to states to
empires over centuries. The chronicle is the reward.

Emergent arcs the design intends to produce (validated by the Stage 3 long-run harness):

1. **River valley boom → over-specialization → drought → collapse → resettlement.**
2. **Mountain kingdom militarizes for defence → raids a wealthy neighbour → trade route dies →
   both decline → a third civ inherits the routes.**
3. **Coastal trade league outcompetes an inland autocracy → hinterland migrates to the coast →
   inland capital fragments.**
4. **Player blights a region → refugees destabilize an enemy → war ends in 12 years → chronicle
   blames "the withering".**

If the harness cannot produce at least 3 of these 4 in 20 seeds by year 400, the utility weights and
the economy constants are wrong — that is a Stage 3 acceptance failure, not a polish issue.

## 17. UX principles (summary; detail in `UX_AND_VISUAL_DIRECTION.md`)

1. The world is the UI: ≥ 75% of screen area at rest is map.
2. One thumb: every control reachable in the bottom third in portrait.
3. Inspect before command: tapping always selects; nothing destructive happens from a single tap.
4. Panels are bottom sheets, max 45% height, swipe-dismiss, one open at a time.
5. No modal dialogs except world-delete confirmation.
6. Numbers are shown with units and a one-line "what this means" (e.g. *"Food: +12/day — 34 days of
   reserve"*).
7. Everything is readable at 1.0× system font scale; no text below 14 sp; 4.5:1 contrast.

## 18. Audio direction (P1, Stage 4)

Ambient only: wind/water beds per biome, distant crowd murmur scaled by population, seasonal shift
in timbre, war drums only when the camera is over an active front. No music loop that repeats every
90 seconds. All SFX original or CC0, recorded in `ASSET_DIRECTION.md`.

## 19. Difficulty and knobs

| Knob | Range | Effect |
|---|---|---|
| Water | dry ↔ wet | sea level, river density, drought base rate |
| Harshness | temperate ↔ extreme | seasonal amplitude, disaster base rate |
| Peoples | 1–12 | number of starting bands |
| (Advanced) Growth | slow ↔ fast | birth/death multipliers, for players who want 1000-year arcs |
| (Advanced) Conflict | peaceful ↔ warlike | grievance and war-declaration thresholds |

No difficulty setting changes the simulation's *rules*, only its constants. This keeps every world
comparable and the chronicle honest.

## 20. Accessibility and comfort

- Colour-blind safe palette (no red/green-only encoding); every heat colour has an icon/shape pair.
- Reduce-motion option (disables camera easing, particle effects, and map animation).
- Battery saver: caps to 30 FPS and 1× max speed, pauses sim when the screen is off.
- Text scale 100–200% with reflow (no clipping).
- One-handed mode: shifts primary controls to the lower-left arc.

## 21. Explicitly cut from the design (and why)

See `SCOPE_AND_PRIORITIES.md` for the full matrix. Headlines: no individual-citizen agents, no
tactical battles, no diplomacy dialogue trees, no religion system (culture absorbs it), no naval
warfare, no technology art trees, no mod support, no cloud, no multiplayer, no map editor.
