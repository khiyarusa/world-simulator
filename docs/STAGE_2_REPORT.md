# STAGE 2 REPORT — World Engine & Playable Foundation

Commit under test: **`9776301`** · Date: 2026-11-25
Verdict: **STAGE 2 IMPLEMENTATION COMPLETE — DEVICE VALIDATION PENDING**

A generated world can be created from a seed, inspected, panned, zoomed, selected, time-controlled,
saved and reloaded. Everything on screen comes from the generated arrays; nothing is a placeholder.

---

## A. Implementation summary

| Area | Delivered |
|---|---|
| Project infrastructure | TypeScript 6.0.3 (strict, all five required flags), Vite 8, PixiJS 8.23, Capacitor 8.6, ESLint 10 + typescript-eslint 8, Vitest 5.1, Playwright 1.65, lockfile committed |
| Deterministic core | xoshiro128** with 12 named streams, two-word seed transport, stateless cell hash, integer/fixed-point helpers, 360-day calendar, typed errors, CRC32 |
| World generation v1 | 13-stage pipeline: land mask → sea-level solve → elevation → temperature → moisture → priority-flood hydrology + D8 + lakes → 16 biomes → fertility → resources → regions → spawn sites → initial bands → report + validation |
| Simulation worker | owns `WorldState`, fixed 1-day tick, timer scheduler, command queue at tick boundaries, delta mirror with pooled transferable buffers, save serialiser |
| Renderer | 2048² baked terrain (relief, ink coastline, rivers, paper grain), screen-constant settlement glyphs (5 tiers), selection ring, DOM labels, camera with focal-preserving pinch |
| UI | creation screen with **real** generator preview, HUD (date, speed dial, save, world info), selection chip, bottom sheets, toast, debug overlay |
| Persistence | IndexedDB (3 stores), four shards, per-shard CRC + gzip, single-transaction generation commit, previous-generation fallback, schema v1 + migration entry point, autosave (90 days / 60 s / on background) |
| Delivery | `ci`, `android`, `perf`, `fixtures` workflows; Capacitor Android project committed with Gradle 8.14.3 wrapper; debug APK artifact |

**No Stage 3 system exists.** The daily pipeline declares all 20 phases and every one that belongs to
Stage 3 is an explicit no-op (`() => void`), not a fake formula. Population does not grow, food is not
consumed, no wars, no AI, no events.

## B. Architecture (as built)

```
main thread                                worker
────────────────────────────────────────   ──────────────────────────────────────
app/bootstrap  → app/session               worker/sim.worker
ui/shell · ui/creation · ui/labels              ├─ scheduler (fixed 1-day tick)
render/app → camera · terrainBake ·             ├─ sim/systems/pipeline (20 phases)
             settlementSprites · palette        ├─ sim/world/generate.v1 (+ noise,
platform/storage · saves · migrations           │   hydrology, biomes, spawn, presets)
core/* (shared, DOM-free)                       └─ sim/state (SoA, checksum)
```

- One writer: the worker. The main thread holds a read-only mirror (`MirrorDelta`).
- Deltas transfer four typed arrays and are handed back by the client for reuse (pool cap 4; on
  exhaustion the worker coalesces instead of allocating).
- Terrain travels once per world as a structured clone (`terrain` message), never per frame
  (decision D-28).
- The renderer never mutates simulation state; `src/sim/**` imports nothing from
  `render/`, `ui/`, `platform/` or `pixi.js` (enforced by ESLint **and** `scripts/check-repo.mjs`).

## C. World generation

- 13 stages implemented exactly as `docs/WORLD_GENERATION.md` §12 records, including the sea-level
  solve that hits the preset's land target instead of hoping for it.
- **Measured land fraction** (15 golden worlds): small **450–451 ‰**, medium **400–401 ‰**, large
  **350–352 ‰** — targets are 450/400/350.
- Rivers come from depression filling + flow accumulation, not from drawn lines: every river cell is
  land, every river terminates in the sea or a lake (unit-tested).
- Spawn sites are scored from fertility, water distance, slope and river proximity; every starting
  band is on land, off lakes, with minimum spacing, 40–120 people.
- `GenerationReport` carries recipe hash, land fraction, elevation range, biome histogram, river/lake
  counts, resource histogram, spawn count, validation issues, warnings, attempts, timing and wind
  direction. A world with validation issues is rejected before it can be played.

**Determinism evidence (CI run 45676649285):**
`determinism: 120 worlds identical across two fresh processes` (40 seeds × 3 presets, two separate
Node processes) plus 15 committed golden hashes, all distinct.

## D. Rendering

- Whole world in **one 2048² texture**; static world = 2 draw calls (terrain + nothing else). No
  per-tile sprites anywhere.
- Relief is baked from the real elevation gradient (NW light), coastlines are drawn only where a land
  cell touches water, rivers are tapered by the width tier computed in hydrology.
- Settlements use five procedural glyphs (camp → metropolis), pooled, tinted by civilization colour,
  and **sized in screen pixels** so a marker is readable at fit zoom and unobtrusive at 8×.
- Labels are DOM, pooled (28 nodes), chosen by weight, culled by viewport.
- Camera: exponential smoothing, focal-preserving pinch, view-clamped pans, no rotation, no shake.
  Unit tests assert ≤ 2 px focal error, no empty space, and frame-rate independence.

## E. Worker and scheduling

- `DAY_MS = 400`, speeds 0/1/2/4/8 scale the accumulator; tick size never changes.
- Real delta clamped to 250 ms, max 4 ticks per pass, backlog capped at 30 ticks; dropped ticks are
  counted and surfaced.
- Idle when paused (`clearSchedule`), and the app pauses + saves on `visibilitychange:hidden`,
  restoring the previous speed on return.
- Commands are applied between ticks, so no external input can land mid-phase.

## F. Persistence

Schema v1 shards: `meta` (JSON), `terrain` (binary, 12 grids with a byte table), `settlements`,
`civs`. Each shard carries CRC32 of its uncompressed bytes; gzip via `CompressionStream` when the
platform has it.

Save flow: worker snapshots → serialises shard by shard → transfers buffers → main writes **all
shards and the metadata in one transaction** → only then is the generation current → the previous
generation is pruned to keep exactly two.

Load flow: metadata → schema check → read current generation → inflate + CRC every shard → fall back
to the previous generation on any failure → refuse a newer schema outright.

Tested: round-trip byte equality, day preservation, corrupted payload, truncated payload, missing
shard, newer schema, RNG state survival.

## G. Performance

**Measured on CI (GitHub `ubuntu-latest`), commit `9776301`** — these numbers describe the Stage 2
pipeline, which still has no per-day systems, so they certify loop and harness overhead only:

| Metric | Value |
|---|---|
| Days simulated | 18,000 (50 years) |
| Tick p50 / p95 | < 0.001 ms / < 0.001 ms |
| Tick max | 0.524 ms |
| Live heap growth | +92 KB per 10,000 ticks (budget 1 MB) |
| APK size | **4.55 MB** (budget 25 MB) |

Not measured, and therefore not claimed: frame time on a Galaxy A23, terrain bake duration on a
phone, touch latency, thermal behaviour, save duration on eMMC. These are the device protocol in
`docs/PERFORMANCE_BUDGET.md` §11, all **PENDING DEVICE VALIDATION**.

One real regression was caught and fixed by the budget: the tick loop allocated a context object per
day (~400 B/tick), which the heap gate rejected; the context is now reused.

## H. CI results

| Workflow | Run | Result |
|---|---|---|
| `ci` | [45676649285](https://github.com/khiyarusa/world-simulator/actions/runs/45676649285) | **success** — typecheck, lint, repo gates, 51 unit tests, 120-world determinism (2 processes), build, 3/3 Playwright |
| `android` | [45676649292](https://github.com/khiyarusa/world-simulator/actions/runs/45676649292) | **success** — `cap sync` + Gradle `assembleDebug`, APK 4.55 MB, artifact `world-simulator-debug-9776301…` |
| `perf` | [45676649247](https://github.com/khiyarusa/world-simulator/actions/runs/45676649247) | **success** — budgets asserted against `.perf/baseline.json` |

Artifacts: debug APK (14 days) and the perf report (30 days) on the runs above.

## I. Acceptance matrix

| ID | Criterion | Status | Evidence |
|---|---|---|---|
| S2-A1 | Same seed ⇒ byte-identical world | **PASS** | `determinism: 120 worlds identical across two fresh processes`; 15 golden hashes; same-process test |
| S2-A2 | Medium world ≤ 1.5 s on Galaxy A23 | **PENDING DEVICE VALIDATION** | generation budget coded and measured only on CI hardware; no phone capture yet |
| S2-A3 | Camera focal error ≤ 2 px, pan never leaves the world | **PASS (numeric) / PENDING DEVICE VALIDATION (feel)** | camera unit tests; E2E zoom + pan; touch feel not tested on hardware |
| S2-A4 | Save → force-stop → relaunch restores world and day | **PASS (browser) / PENDING DEVICE VALIDATION** | E2E reload test restores settlement count and day; force-stop on Android not yet run |
| S2-A5 | Corrupt shard ⇒ recovery from previous generation | **PASS** | corruption, truncation and missing-shard tests; generation fallback in `platform/saves.ts` |
| S2-A6 | CI + Android build green, APK installs | **PASS (build) / PENDING DEVICE VALIDATION (install)** | both workflows green; APK artifact produced; not installed on hardware yet |
| S2-A7 | Perf job green, tick p95 ≤ 3 ms in CI | **PASS** | `perf` run; p95 < 0.001 ms, max 0.524 ms |
| S2-A8 | Forbidden APIs absent from `src/sim/**` | **PASS** | `scripts/check-repo.mjs` in the verify job (Math.random, Date.now, performance.now, crypto, transcendental math, renderer imports) |

Honest reading: three of eight criteria are fully proven, three are proven in a browser and await a
physical device, and two are build-only until the device protocol runs.

## J. Remaining issues

| # | Issue | Priority | Note |
|---|---|---|---|
| 1 | Device validation not performed (S2-A2/A3/A4/A6) | **High** | needs a Galaxy A23 and 20 minutes with the §11 protocol |
| 2 | Terrain bake is synchronous on the main thread (~one frame stall at world open) | Medium | acceptable for Stage 2; slice per stage in Stage 5 if the device shows a visible hitch |
| 3 | Preview always generates the Small preset | Low | stated in the UI copy; Medium preview would cost ~1 s per tap |
| 4 | `visibilitychange` can fire mid-save in exotic cases (two saves racing) | Low | `autosave` is guarded by a 5 s throttle and a single in-flight save; a second guard is a Stage 4 task |
| 5 | Settlement labels are hidden below 0.09 zoom | Low | intentional (full-world labels would be unreadable) |
| 6 | No `android/variables.gradle` override yet for release signing | Medium | Stage 5 |
| 7 | Event/history/route shards do not exist | Expected | Stage 3 adds them with a schema bump (D-30) |

## K. Scope discipline

Deliberately **not** implemented, because they belong to later stages: population growth, births and
deaths, cohorts, agriculture, resource flow, trade, prices, civilization formation, government,
technology, diplomacy, treaties, war, migration, climate simulation, disasters, utility AI, decision
records, the event/chronicle system (all Stage 3); the six information layers, full civilization /
economy / history panels, onboarding, advanced settings, multiple-world UI, export/import (Stage 4).

Deliberate deviations from the Stage 1 design, all recorded as ADRs D-23…D-31: seed transport as two
32-bit words, worker-timer scheduling, one transaction per generation, TypeScript 6.0.3, no
`ui/store.ts`, terrain clone instead of transfer, on-demand preview, four shards, fit-zoom floor.

Also not done: no Windows/macOS/Linux/Electron build, no account, no server, no telemetry, no ads, no
extra runtime dependency (runtime dependencies: `pixi.js` only).

## L. Stage status

**STAGE 2 IMPLEMENTATION COMPLETE — DEVICE VALIDATION PENDING.**

Stage 3 may begin only after the device protocol is run (or the gap is explicitly accepted by the
project owner). Nothing in this report is marked PASS without a link to a run or a test that proves
it.
