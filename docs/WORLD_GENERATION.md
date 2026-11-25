# WORLD GENERATION — World Simulator

Deterministic, seed-based world construction. Implemented in `src/sim/world/**`, executed inside the
simulation worker at world creation, never on the main thread.

Goal: for a given `(seed, preset, water, harshness, peoples, generatorVersion)` produce **byte-identical**
terrain, biomes, resources and starting populations on every device and every run.

---

## 1. Determinism contract

A world is identified by:

```ts
interface WorldRecipe {
  seed: bigint;            // 64-bit, shown to the player as two base-32 words
  preset: 'small' | 'medium' | 'large';
  water: number;           // 0..100 (50 = preset default)
  harshness: number;       // 0..100
  peoples: number;         // 1..12
  generatorVersion: number;// bumped on any algorithmic change; old versions must still load
}
```

`hash(WorldRecipe)` is stored in the save header and in the generation report. Given the same recipe
and the same `generatorVersion`, the output is identical.

### 1.1 What is forbidden in generation code (lint-enforced)

| Forbidden | Why | Replacement |
|---|---|---|
| `Math.random()` | unseedable | `Rng` streams |
| `Math.sin/cos/tan/pow/exp/log` on simulation inputs | implementations are not bit-identical across engines/versions | integer hashes, polynomial curves, lookup tables |
| `Date.now()`, `performance.now()` | wall-clock | `day` counter, or explicit budget argument |
| `Object.keys` / `for…in` ordering | integer-like keys reorder | explicit arrays |
| `Array.prototype.sort` without a total order comparator | stability is guaranteed, but comparator ties are not a *total* order | always tie-break by id |
| `toLocaleString`, `localeCompare` | locale-dependent | ASCII compares, formatting only at display |
| `Promise.all` results feeding state | completion order | sequential awaits, or ordered collect |

Floating-point arithmetic (`+ − × ÷`, `Math.floor`, `Math.sqrt`) **is** used in terrain generation
only, and is IEEE-754 deterministic in JS across conforming engines. No transcendental functions are
used, so cross-engine parity holds. Simulation itself uses integers exclusively
(`SIMULATION_MODEL.md` §5).

## 2. Random number generation

### 2.1 Algorithm: xoshiro128** (32-bit), no BigInt

Rationale: ~2 ns/word, statistically strong, trivially portable, no BigInt (BigInt is ~10× slower on
ARM32/64 JS and would allocate). Seeded via a splitmix32 expansion of `(seedLo, seedHi, streamId)`.

```ts
interface Rng { readonly stream: number; nextU32(): number; }

function makeRng(seedLo: u32, seedHi: u32, stream: number): Rng {
  let s0 = mix32(seedLo ^ 0x9E3779B9, stream);
  let s1 = mix32(seedHi ^ 0x85EBCA6B, stream + 1);
  let s2 = mix32(seedLo ^ 0xC2B2AE35, stream + 2);
  let s3 = mix32(seedHi ^ 0x27D4EB2F, stream + 3);
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
  return { stream, nextU32() { /* xoshiro128** core */ } };
}

function mix32(a, b) {           // 32-bit finalizer; no floats, no BigInt
  let h = (a ^ Math.imul(b, 0x9E3779B1)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x21F0AAAD) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x735A2D97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
```

### 2.2 Streams (never one shared generator)

| Stream id | Consumer | Rationale |
|---|---|---|
| `TERRAIN = 0x01` | continent mask, elevation | |
| `MOISTURE = 0x02` | moisture field | separate so editing elevation noise cannot reshape rainfall |
| `TEMP = 0x03` | temperature noise | |
| `RIVERS = 0x04` | depression-fill tie-breaks | |
| `RESOURCES = 0x05` | ore/stone/timber scatter | |
| `SPAWN = 0x06` | starting band placement | |
| `CLIMATE = 0x10` | monthly weather | per-day derived |
| `FIRE = 0x11` | wildfire rolls | |
| `EPIDEMIC = 0x12` | epidemic rolls | |
| `DECISION = 0x20` | utility tie-breaks | |
| `EVENTS = 0x21` | narrative flourishes (names, epithets) | |
| `MIGRATION = 0x22` | flow ordering tie-break | |

**Rule:** adding a new consumer must allocate a new stream. Reordering or adding a draw inside an
existing stream is a `generatorVersion` bump, because it changes every downstream value.

### 2.3 Per-cell hash (not a stream)

For stateless per-cell rolls (wildfire ignition, scatter), use a pure hash of `(seed, stream, x, y)`
so results do not depend on iteration order:

```ts
function cellHash(seedLo, seedHi, stream, x, y): u32 {
  return mix32(mix32(x, y) ^ seedLo, stream ^ seedHi);
}
```

## 3. Pipeline (stages, outputs, determinism notes)

| # | Stage | Input | Output | Notes |
|---|---|---|---|---|
| 1 | Continent mask | seed, water | `landMask` (bool grid) | radial falloff + warped fBm + optional multi-blob archipelago |
| 2 | Elevation | landMask | `elevation: Int16` | fBm 5 octaves, ridged for mountains, scaled per preset |
| 3 | Sea level & coast | elevation, water | `isLand`, coast flags | sea level chosen so land fraction matches the preset band |
| 4 | Temperature | latitude, elevation | `temperature: Int8` | latitude curve + lapse rate + low-freq noise |
| 5 | Moisture | sea distance, wind, elevation | `moisture: Uint8` | upwind ocean fetch, orographic shadow |
| 6 | Rivers & lakes | elevation, moisture | `riverId`, `lakeId`, flow | priority-flood + D8 accumulation |
| 7 | Biomes | temp, moisture, elevation, water | `biome` | Whittaker matrix + special cases |
| 8 | Fertility | biome, river, slope, floodplain | `fertility` | floodplains highest |
| 9 | Resources | geology noise, biome, coast | `resourceMask` | stone/metal/timber/harbour flags |
| 10 | Regions | grid, rivers | `regionId` (4×4 tile blocks, merged) | coarse graph for macro sim |
| 11 | Spawn sites | fertility, water, flatness, spacing | N sites | deterministic greedy with min distance |
| 12 | Initial populations | spawn sites, recipe.peoples | 1–12 bands | 40–120 people each, cohort split |
| 13 | Validation | everything | report or rejection | see §8 |

Everything is computed on flat typed arrays in a single pass per stage. No per-stage object graphs
(GC pressure), no recursion deeper than the priority-queue fill.

## 4. Terrain algorithms

### 4.1 Continent mask

```
for each cell:
  r      = normalized distance from map centre (0 at centre, 1 at edge)
  falloff= clamp01(1.15 − r^2.2)                       // soft island bias
  warp   = fbm(TERRAIN, x/48, y/48, 3 octaves)         // domain warp ±0.35 cells
  n      = fbm(TERRAIN, (x+warp)/32, (y+warp)/32, 5)   // 0..1
  v      = n × 0.72 + falloff × 0.28
  land   = v > seaThreshold(water)                     // threshold tuned to hit target land fraction
```

`water` slider shifts `seaThreshold` by ±0.08. The preset's target land fraction (Small 45 %,
Medium 40 %, Large 35 %) is a **band**, not an exact value: the generator searches ±3 % and records
the achieved value in the report.

Optional archipelago mode (P1, `harshness`-driven): 2–5 blob centres instead of one radial falloff,
which produces separated landmasses and forces maritime trade to matter.

### 4.2 Elevation and mountains

```
e  = fbm(TERRAIN, x/64, y/64, 5, gain 0.5)              // rolling base
r  = ridged(TERRAIN+1, x/40, y/40, 4)                   // 1 − |noise|, sharp ridges
e  = e × 0.75 + r^2 × 0.35 × mountainBias(x, y)         // mountainBias from a low-freq mask
el = round((e × 10000) − 2000)                          // decimetres, −2000..9000
```

`Int16` in decimetres gives 0.1 m resolution over −200 m…+900 m, i.e. exact integers, no float
storage, and enough precision for a 3 km tile.

### 4.3 Rivers and lakes

Rivers are the most gameplay-relevant feature (water, fertility, trade, borders), so they are
computed properly rather than drawn:

```
1. fill depressions     priority-flood from map edges (min-heap, tie-break by cell index)
                        → filledElevation, guaranteed downhill path to the sea for every land cell
2. flow direction       steepest descent (D8) on filledElevation, tie-break by fixed direction order
3. accumulation         process cells in descending elevation order (counting sort by elevation)
                        → flowAccumulation[cell] = number of upstream cells + 1
4. river mask           river if accumulation >= riverThreshold(width) and not ocean
                        riverId assigned by walking downstream and labelling contiguous runs
5. lakes                 filledElevation > elevation → lake cell; lakeId by flood fill of the
                        filled plateau; lake volume from the fill depth
6. width                widthTier = clamp(floor(log4(accumulation)), 1, 5)   // for rendering + trade
```

`Math.log4` is avoided in the hot path: a small lookup of accumulation thresholds replaces it.
Tie-breaks are by index so the priority queue produces one canonical result.

### 4.4 Temperature and moisture

```
temperature = baseByLatitude(y)                        // equator-ish warm, poles cold: integer table
            + elevationLapse(el)                       // −6 °C per 1000 m, integer per 100 dm
            + noise(TEMP, x/80, y/80) × 3              // ±3 °C
moisture    = oceanFetch(x, y)                         // upwind distance to water, capped
            × (1 − rainShadow(el, upwind))             // mountains dry their lee
            + noise(MOISTURE, x/56, y/56) × 24
            + riverBonus(cell)
```

Prevailing wind is a per-world constant drawn from `TERRAIN` (one of 4 cardinal directions) and shown
in the world report, so rain shadows are consistent and explainable.

### 4.5 Biomes (closed set of 16)

| id | Biome | Rule (abbrev.) |
|---|---|---|
| 0 | Ocean | not land |
| 1 | Coast/beach | land adjacent to ocean, low elevation |
| 2 | Lake | lake cell |
| 3 | River valley | riverId ≠ 0 and slope low |
| 4 | Glacier | temp < −12 °C |
| 5 | Tundra | temp < −2 °C |
| 6 | Boreal forest | temp < 6, moisture > 90 |
| 7 | Temperate forest | temp 6–20, moisture > 120 |
| 8 | Grassland | temp 6–24, moisture 60–120 |
| 9 | Steppe | temp 4–26, moisture 30–60 |
| 10 | Desert | moisture < 30, temp > 12 |
| 11 | Savanna | temp > 22, moisture 60–110 |
| 12 | Tropical forest | temp > 22, moisture > 140 |
| 13 | Wetland | moisture > 200 and slope ~0 |
| 14 | Highland | elevation > 4000 dm |
| 15 | Snow peak | elevation > 6500 dm or temp < −15 |

`biomeYield[]`, `biomeWood[]`, `biomeMovement[]` are constant tables in `sim/world/biomeTables.ts` —
one source of truth shared by agriculture, extraction, pathfinding cost and rendering colours.

### 4.6 Resources and fertility

```
fertility = biomeFertility[biome]
          + floodplainBonus (river + low slope)
          − slopePenalty
          − overHarvestPenalty(0 at generation)
stone/metal: geological noise clusters, only on highland/mountain, min cluster size 3
timber: forest biomes, density from moisture
harbour: coast cell with adjacent deep water (elevation < −300 dm) and low slope
```

Resource placement uses its own stream and a scatter pass that enforces a minimum distance between
deposits, so the map does not become a uniform sprinkle of identical dots.

## 5. Starting populations

```
candidate  = land && fertility >= 90 && waterWithin(3 tiles) && slope <= 2 && biome not glacier/snow
spacing    = max(6, floor(width / (peoples + 2)))
pick N sites greedily by score with spacing, tie-break by index
each band  = { pop: 40..120 (SPAWN stream), cohorts split by a fixed demographic curve,
               food: 30 days of reserve, wood: 200, tech: 0, culture: derived from biome/terrain }
```

Derived initial culture (not random): river+fertile → agrarian; mountains/highland → martial;
coast/harbour → mercantile. This makes a world's first civilizations legible from the map alone.

## 6. Chunking: what it is for, and what it is not

| Concern | Decision |
|---|---|
| Terrain storage | **Global typed arrays.** Medium = 36,864 cells × 14 B ≈ 504 KB. Chunk-streaming storage would add complexity for no memory win. |
| Render baking | **16×16 tile chunks.** Each chunk bakes into the world texture; visible chunks can be re-baked at higher resolution when zoomed in. |
| Save sharding | **16×16 tile chunks** grouped into 4 shards per save (`terrain-0..3`) so a save writes in bounded transactions. |
| Detail simulation | **Not chunked.** Simulation detail is per-settlement tier, because people, not tiles, cost money. |
| Generation parallelism | Chunk-parallel *noise* evaluation is possible but not needed at these sizes; generation is single-worker and budgeted at ≤ 1.5 s. |

This is a deliberate departure from "open-world streaming" advice: our world is small enough to fit
in memory entirely, and pretending otherwise would import streaming complexity that Stage 5 cannot
afford.

## 7. Generation cost budget (targets, to be measured in Stage 2)

| Preset | Cells | Target generation time (A23, single worker) | Stage-2 acceptance ceiling | Memory peak |
|---|---|---|---|---|
| Small | 16,384 | ≤ 450 ms | ≤ 900 ms | ≤ 24 MB |
| Medium | 36,864 | ≤ 900 ms | ≤ 1,500 ms | ≤ 40 MB |
| Large | 65,536 | ≤ 1,500 ms | ≤ 2,500 ms | ≤ 64 MB |

Targets are `[TARGET]` (unmeasured). The ceiling is what `S2-A2` actually gates on, so a first
implementation that lands between target and ceiling is accepted and tracked as an optimisation item
rather than a failed stage.

Generation reports progress every 8 ms (`{stage, pct}`), so the preview and the "creating world"
state always animate. The main thread never blocks: generation runs in the worker and the whole
process is cancellable between stages.

## 8. Validation and rejection

The generator validates its own output and, on failure, regenerates with
`seed' = mix32(seedLo, seedHi) ^ attempt` (max 3 attempts), then relaxes constraints in a fixed order
and records that it did so in the report.

| Check | Failure handling |
|---|---|
| Land fraction within preset band ±3 % | adjust sea level and retry stage 3 |
| At least one landmass ≥ 400 cells | retry with different `TERRAIN` offset |
| Every river terminates in ocean or a lake | retry flow stage |
| No NaN/Infinity in any grid | hard fail (a bug, not a seed) |
| ≥ `peoples` valid spawn sites | relax fertility threshold stepwise |
| Each spawn site has ≥ 20 owned-tile-equivalents of arable land | relax or reduce peoples count |
| Every region has ≥ 1 land cell | merge into a neighbour region |
| Biome diversity ≥ 6 distinct biomes | warn only (harshness extremes may legitimately reduce it) |

Hard failures are reported to the player as a bug with the recipe attached, never as a silent
"please try another seed".

## 9. Generation report (persisted with the world)

```ts
interface GenerationReport {
  recipe: WorldRecipe; recipeHash: string;
  achieved: { landPct: number; riverCells: number; lakeCells: number;
              biomeHistogram: number[]; regions: number; spawnSites: number;
              attempts: number; relaxations: string[] };
  timingMs: { total: number; [stage: string]: number };
  windDirection: 0 | 1 | 2 | 3;
}
```

The report is the first thing to look at when a world feels wrong, and it makes support possible
without shipping the world itself.

## 10. Automated generation tests (specified now, implemented Stage 2)

1. **Determinism, same process:** generate seed S twice, assert every grid byte-equal and identical
   `recipeHash`.
2. **Determinism, fresh process:** generate seed S in two separate Node processes (different
   `--random-seed`, different heap layout), compare SHA-256 of the concatenated grids. Catches
   hash-randomization and iteration-order leaks.
3. **Seed sweep (200 seeds / preset):** zero hard failures; land fraction in band; ≥ 6 biomes;
   rivers terminate; spawn count satisfied; report min/median/max of land %, river cells, attempts.
4. **Golden worlds:** 5 fixed seeds per preset checked into `tests/fixtures/golden/` as hashes; any
   algorithmic change must either keep the hashes or bump `generatorVersion` and update fixtures
   deliberately (reviewed diff, never auto-accepted).
5. **No random API:** static check that `src/sim/**` contains no `Math.random`, `Date.now`,
   `performance.now`, `crypto.` (except in the seed-entry UI, which lives outside `src/sim`).
6. **Cost ceiling:** generation of Medium at the CI runner must stay under 4× the local-device
   target (CI hardware differs; the assertion is a regression guard, not a device claim).

## 11. Versioning

`generatorVersion` increments on any change that alters output for an existing recipe (noise
constants, stage order, thresholds, new pass). Old saves keep their version and are regenerated with
the old code path, which is why the generator keeps **versioned entry points**:

```ts
generateWorld(recipe): GeneratedWorld {
  switch (recipe.generatorVersion) {
    case 1: return generateV1(recipe);
    default: throw new UnsupportedGeneratorVersion(recipe.generatorVersion);
  }
}
```

The v1 path is frozen at Stage 2 and never edited again; new behaviour ships as v2. This costs a
module boundary and saves every existing player's world.
