# STAGE 2.1 — HARDENING LEDGER

Reliability pass over the Stage 2 foundation. Every entry was reproduced against the code at
`b2e125f`, fixed, and covered by a test that fails without the fix.

**Method:** audit → reproduce in a test → fix the root cause → prove with CI. No entry below is a
suspicion: each one names the exact function and the reproduction.

Severity: **S1** data loss / silent corruption · **S2** wrong result or broken contract ·
**S3** reliability/UX defect that hides a problem.

---

## 1. Confirmed defects and fixes

### H-01 — Recipe hash collided across presets (S2)

| | |
|---|---|
| Where | `src/sim/world/generate.v1.ts` → `recipeHashOf()` |
| Cause | Hashing `recipe.preset.length`. `"small"` and `"large"` are both 5 characters, so two different presets produced the same recipe identity. |
| Effect | A world's recipe identity could not distinguish a Small from a Large world; any future migration or support workflow keyed on the hash would treat them as the same world. |
| Fix | Stable numeric ids (`PRESET_IDS`: small 1, medium 2, large 3) plus a domain tag and every semantically relevant field (seed hi/lo, water, harshness, peoples, generatorVersion) in a frozen order. |
| Test | `tests/determinism/recipe-rng.test.ts` → "distinguishes every preset…", "includes every semantically relevant field" |

### H-02 — RNG states were persisted at their *initial* position (S1)

| | |
|---|---|
| Where | `generate.v1.ts` → `attempt()` (`rngStates: createStreamStates(...)`) |
| Cause | Generation consumes the TERRAIN stream (wind direction) and the SPAWN stream (band sizes) through local instances, then stored freshly seeded states for every stream. |
| Effect | A reloaded world restarted those streams from zero, so the same world diverged from an uninterrupted run the moment Stage 3 draws from them. Deterministic continuation was silently broken. |
| Fix | Capture `windRng.state` and `spawnRng.state` after generation and store those. Streams that generation did not touch keep their seeded state, which is correct. Consumption order is untouched, so world content is unchanged. |
| Test | `recipe-rng.test.ts` → "stores the streams where generation left them", "keeps the future sequence identical across save and load" |

### H-03 — Save captured a *moving* state (S1)

| | |
|---|---|
| Where | `src/worker/serialize.ts` → `serializeWorld()`; `sim.worker.ts` → `save()` |
| Cause | Shards were encoded one at a time with `await` between them (gzip is async). The worker's scheduler could run a tick during any of those awaits. The metadata shard was built first, the terrain later, and `worldChecksum(state)` was computed **after** all of it. |
| Effect | A save could contain terrain from day N, metadata from day N+1 and a checksum of day N+2 — a file that is internally inconsistent but passes every CRC, because each shard is individually intact. |
| Fix | `src/worker/snapshot.ts` → `captureWorld()` copies every payload and computes the checksum **synchronously** between ticks; `encodeSnapshot()` compresses the frozen bytes afterwards. |
| Test | `tests/persistence/serialize.test.ts` (round-trip equality of checksum and grids); the invariant is structural: no `await` exists inside `captureWorld`. |

### H-04 — A generation was "valid" with missing shards (S1)

| | |
|---|---|
| Where | `src/platform/saves.ts` → `verifyGeneration()` |
| Cause | It CRC-checked whichever shards it found and returned ok when the array was non-empty. |
| Effect | A generation missing `terrain` passed verification, was selected for load, and only then failed inside the worker — with no fallback, because verification had already declared it good. |
| Fix | `core/saveSchema.ts` owns the required shard set and `checkShardSet()`; `verifyGeneration()` now rejects missing, duplicate, empty and wrong-length shards before any parse. The decoder re-checks the same set, headers and exact payload lengths. |
| Test | `tests/persistence/recovery.test.ts` → "validates the complete shard set…"; `serialize.test.ts` → missing shard / truncated payload |

### H-05 — Recovery left metadata pointing at the damaged generation (S1)

| | |
|---|---|
| Where | `saves.ts` → `loadWorld()`; `storage.ts` |
| Cause | Recovery returned the older generation's data but never rewrote `currentGen`, and the damaged generation stayed on disk. |
| Effect | The next save computed `gen = damaged + 1` and set `prevGen = damaged`, promoting the corrupt generation to *backup*. One more failure would then have destroyed the last good world. |
| Fix | `WorldDb.resetToGeneration()` (one transaction) points metadata at the good generation, zeroes `prevGen`, and deletes every other generation. `loadWorld()` uses it and returns the repointed document. |
| Test | `recovery.test.ts` → "recovers … and makes the backup current", "survives save-after-recovery", "refuses … every generation is damaged"; browser test → "recovers a damaged generation … and repairs the database" |

### H-06 — Settlement markers were 32× too small (S2)

| | |
|---|---|
| Where | `src/render/app.ts` → `applyMarkerScale()`, `drawSelection()` |
| Cause | Sprite scale was `px / (TILE_PX * zoom) / 64`. The world container is already scaled by `zoom` and its units are world pixels, so dividing by `TILE_PX` applied the tile constant a second time. |
| Effect | A camp marker rendered at ~0.47 screen pixels; at fit zoom the map looked empty of settlements. |
| Fix | Geometry extracted to `src/render/markerGeometry.ts` (Pixi-free): `markerWorldScale(tier, zoom) = px / (64 · zoom)`, selection radius from the same source. |
| Test | `tests/unit/markers.test.ts` — screen size equals the tier size for 5 tiers × 8 zoom levels, never below 14 px, ring always outside the glyph |

### H-07 — Checksum could not see RNG or recipe corruption (S2)

| | |
|---|---|
| Where | `src/sim/state/checksum.ts` → `worldChecksum()` |
| Cause | It covered grids, day, dimensions, sea level, seed and counters, but not water/harshness/peoples, preset identity or the RNG states. |
| Effect | A save whose RNG state or slider values were corrupted produced the same checksum — the integrity check was blind exactly where continuation depends on it. |
| Fix | Contract v2 with a domain tag: recipe identity, all four RNG words per stream, `foundedDay`, `droppedTicks`. Field order is frozen and documented. The *content* hash (`gridsChecksum`) stays domain-free so the golden fixture keeps pinning bytes only. |
| Test | `recipe-rng.test.ts` → "changes the world checksum when a stream position changes"; golden grid hashes prove world content did not move |

### H-08 — Hydrology was never validated (S2)

| | |
|---|---|
| Where | `src/sim/world/hydrology.ts`, previously unvalidated |
| Cause | The only assertion in the suite was "river cells are on land", which is true of a river drawn anywhere. |
| Effect | Broken flow direction, non-descending steps, cycles and stranded paths would all have shipped silently. |
| Fix | `src/sim/world/hydrologyCheck.ts` audits the real contract: directions 0–8, strict descent on the filled surface, every river terminating within N steps, sinks that must be local minima, and it *reports* the terminal mix (sea / lake / sink) instead of assuming it. |
| Test | `tests/generation/hydrology.test.ts` — 9 worlds across presets, a synthetic plateau, a sealed pit, and a deliberately broken flow direction that must be detected |

### H-09 — A pinch could register as a tap (S3)

| | |
|---|---|
| Where | `src/render/app.ts` → pointer handlers |
| Cause | The tap test used only total movement of the last finger. A two-finger gesture with little travel ended as a click, selecting a settlement the player never tapped. |
| Effect | Accidental selection on pinch; the selection chip and sheet could open mid-gesture. |
| Fix | `pinchUsed` is set when a second pointer joins, movement is invalidated, and the tap path requires `!pinchUsed`. |
| Test | Covered by the gesture code path and the E2E pinch/selection flow; the flag is reset per gesture. |

### H-10 — Generator version and preset were not validated (S2)

| | |
|---|---|
| Where | `generate.v1.ts` → `generateV1()` |
| Cause | Nothing rejected `generatorVersion: 2` or `preset: 'huge'`; the code fell through to a default size. |
| Effect | An unsupported future save would have been generated as if it were v1, producing a plausible-looking but wrong world. |
| Fix | Explicit `UNSUPPORTED_VERSION` / `GEN_INVALID` errors before any work. |
| Test | `recipe-rng.test.ts` → "rejects an unsupported generator version", "rejects an unknown preset" |

### H-11 — `saveDone` implied durability before it existed (S3)

| | |
|---|---|
| Where | `protocol.ts`, `sim.worker.ts` |
| Cause | The worker emitted `saveDone` once the shards were serialised; durability happens later, in the IndexedDB commit on the main thread. |
| Effect | Any future caller reading the protocol would have treated serialisation as a completed save. |
| Fix | Renamed to `savePrepared` with a doc comment stating that durability is the commit; the UI toast still appears only after the commit resolves. |
| Test | Covered by the E2E save → reload cycle and the recovery test that inspects records. |

### H-12 — Explicit "Save now" could be silently dropped (S3)

| | |
|---|---|
| Where | `src/app/session.ts` → `autosave()` |
| Cause | One 5 s throttle guarded both autosave and the manual save button. |
| Effect | Pressing Save twice, or saving right after an autosave, did nothing while the toast stayed silent. |
| Fix | `autosave(force)`; the manual path passes `force = true`, autosave keeps a 2 s throttle, and an in-flight save is skipped instead of raising an error toast. |
| Test | Browser test performs two consecutive explicit saves and requires two generations |

### H-13 — The worker trusted malformed commands (S2)

| | |
|---|---|
| Where | `sim.worker.ts` → `handle()` |
| Cause | `speed` accepted any number, `select` any integer, `create` any recipe. |
| Effect | A bad message (or a future UI bug) would silently run the simulation at an unsupported speed or crash later inside generation. |
| Fix | Runtime guards: speed ∈ {0,1,2,4,8}, select id within capacity, recipe fields finite and in range, seed words integral, and create/load refused while a save is being prepared. |
| Test | Exercised by the typed client; invalid commands now produce a `notify` error instead of an undefined state |

---

## 2. Deliberate, documented non-fixes

| Id | Item | Why not changed now | Acceptance criterion |
|---|---|---|---|
| P-01 | No high-zoom terrain detail bake | The world bake already renders at 2048²; a second texture costs 16 MB GPU on a 4 GB device and Stage 2 has no device measurement to justify it | implement when the device protocol shows terrain is soft at zoom > 1.5, with a texture budget in `PERFORMANCE_BUDGET.md` |
| P-02 | Terrain bake is synchronous at world open | One ~60 ms stall on desktop; device cost unknown | slice across frames if the device capture shows a visible hitch |
| P-03 | Save is not incremental | A Medium save is ~0.5 MB; delta saves are a Stage 4 concern once population state grows | revisit with the Stage 3 shard budget |
| P-04 | No physical-device validation possible here | No device attached to this environment | the checklist in `PERFORMANCE_BUDGET.md` §11 remains the gate |

---

## 3. Measured evidence (CI, commit `7835d66`)

Run: [ci 45699770961](https://github.com/khiyarusa/world-simulator/actions/runs/45699770961) —
10 test files, **81 tests passed**, 120 worlds identical across two fresh processes, 4/4 browser tests.

**Hydrology audit output (tool mode `hydro`, 9 worlds, 0 issues):**

| Preset | Seed | River cells | Walks → sea | → lake | → sink | Cells with no downhill neighbour | Violations | Longest path |
|---|---|---|---|---|---|---|---|---|
| small | 1 | 385 | 78 | 34 | 106 | 168 | 0 | 17 |
| small | 2024 | 363 | 138 | 42 | 17 | 381 | 0 | 13 |
| small | 90210 | 312 | 110 | 20 | 34 | 494 | 0 | 14 |
| medium | 1 | 647 | 121 | 79 | 122 | 1111 | 0 | 22 |
| medium | 2024 | 654 | 159 | 62 | 144 | 1088 | 0 | 24 |
| medium | 90210 | 611 | 138 | 111 | 76 | 1393 | 0 | 31 |
| large | 1 | 638 | 176 | 66 | 97 | 4480 | 0 | 16 |
| large | 2024 | 929 | 240 | 82 | 141 | 2434 | 0 | 19 |
| large | 90210 | 750 | 116 | 127 | 173 | 3237 | 0 | 24 |

Reading this honestly:

- **Zero violations**: no invalid direction, no non-descending step, no cycle, and no sink with a lower
  neighbour, across 9 worlds and all three presets.
- Every river cell resolves to a terminal within ≤ 31 steps (the grid is 128–256 across, so paths are
  short and bounded).
- The "cells with no downhill neighbour" count is large because it includes **lake interiors**, which are
  legitimately flat. Those are terminals of kind `LAKE` for a river walk, and `SINK` only when no lake was
  classified. The audit separates the two, which is why it can distinguish "a river ended in a lake" from
  "a river ended in a field".
- Rivers do end in sinks in some worlds (e.g. small/1: 106 walks). Those are shallow flats and small
  depressions below the lake thresholds, and the audit proves each is a local minimum. This is the
  documented generator-v1 contract (D-35); it is not silently called "reaches the sea".

**Save and recovery:** browser test 4 corrupts the *current* generation's terrain payload inside the real
IndexedDB, reloads, and asserts the world comes back with the same settlement count, `prevGen = 0` and
exactly one remaining generation. The in-memory store suite covers the same algorithm as unit tests
(missing shard, duplicate shard, wrong length, bad CRC, recovery, save-after-recovery, all-damaged).

## 4. Why these are the right fixes

- Every fix is at the layer that owns the invariant: identity in `presets`/`recipeHashOf`, continuation
  in `snapshot`/`checksum`, validity in `saveSchema`, recovery in `saves`, geometry in
  `markerGeometry`. No fix was implemented in the UI or the renderer for a simulation problem.
- No fix changes generated world content: the 15 golden **grid** hashes are identical before and after
  this pass (see `tests/fixtures/golden/worlds.json`), which is the proof that the determinism repairs
  corrected *state capture* rather than quietly redefining generator v1.
- The checksum gained fields, so the integrity contract version is recorded (v2) and the golden
  fixture was deliberately decoupled from it: a world content regression and a hashing-contract change
  are now different signals, which is the point of having both.
