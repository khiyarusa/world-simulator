# STAGE 3 REPORT — LIVING WORLD (partial delivery)

**Commit:** `3ac6f2e` · **Branch:** `main` · **Verdict:** **STAGE 3 IS NOT COMPLETE.**

This report is deliberately blunt. A living core exists, runs, conserves and persists; the political
layer and the balance evidence that the acceptance gates require do **not** exist yet. Nothing below is
marked PASS without a run or a test behind it.

---

## 1. What was actually delivered

| Area | State |
|---|---|
| Design contract (`docs/STAGE_3_DESIGN.md`) | **done** — precision/units, eight cohorts, LOD decision, arc wording, save v2, phase map, invariants |
| Society state (SoA, capped, integer) | **implemented, tested** |
| Climate / drought | **implemented, tested** |
| Agriculture, extraction, craft, spoilage, consumption | **implemented, tested** |
| Health, stability from real shortfalls | **implemented, tested** |
| Demography (yearly), ageing, cohort mortality | **implemented, tested** |
| Migration (conserving, cohort-wise) | **implemented, tested** |
| Settlement tiers + abandonment | **implemented, tested** |
| Events with forward cause links | **implemented, tested** |
| Yearly chronicle ring | **implemented** (written, not asserted in detail) |
| Save schema v2 + v1 migration | **implemented, tested** |
| Trade, build decisions, military, diplomacy, war, tech, culture, utility AI | **NOT implemented** |
| Balance harness (20 × 400 years), arc detectors, LOD A/B | **NOT implemented** |
| Stage 3 acceptance gates | **0 of 8 verified** (see §5) |

## 2. Architecture

- New `src/sim/society/` module: `state.ts` (SoA + caps + event/decision/chronicle rings),
  `init.ts` (deterministic cohort split), `living.ts` (all living rules), `codec.ts` (persistence).
- `WorldState` gained one field: `society`. Nothing else in the ownership model changed: the worker
  still owns state, the main thread still owns IndexedDB, the renderer still reads a mirror.
- The 20 declared pipeline phases now delegate to `living.ts` for the phases it implements; the eight
  political/economic phases remain declared and are **explicitly marked not implemented** in the
  pipeline source and in the design doc. They are not silent stubs pretending to work.

## 3. Population system

Eight cohorts per settlement (`children, youth, farmers, extractors, crafters, traders, soldiers,
elders`). `Σ cohorts == population` is asserted in tests. Ageing is yearly
(children→youth 1/15, youth→farmers 1/10, farmers→elders 1/40), deaths are taken elders-first, births
are added to children, and migration transfers people cohort-by-cohort, so nobody is created by
rounding.

**Conservation evidence (test):** over 3 simulated years,
`final == initial + births − deaths` exactly; `counters.deaths` records the people actually removed,
not the requested number.

A real defect was found and fixed during this delivery: monthly demography floored every birth to zero
for settlements below ~300 people, so a small world never grew. The cadence is now annual, which is what
the 3.2 %/yr and 1.4 %/yr constants describe.

## 4. Economy, ecology and causality (as implemented)

- **Units:** stocks are integer units; modifiers are per-mille; a product is divided by 1000 once and the
  remainder is carried per settlement and resource, so 144,000 daily steps do not drift.
- **Production reads real terrain:** fertility, river/lake access, the resource bitmask at the settlement
  tile, season, and irrigation. A mountain settlement with no metal bit cannot produce metal.
- **Consumption** draws food/water/fuel against actual needs; spoilage is 2 ‰/day with a floor of one
  unit; health and stability respond to the real shortfalls, not to a scripted value.
- **Drought** is regional and needs two consecutive months below 40 % of normal; the settlement flag and
  its event id feed the famine event that follows, which is a real forward cause chain.
- **Events** are emitted on transitions only (famine start, drought start, migration, tier change,
  abandonment), with `causeId` pointing at an earlier event or 0 for a root cause. The test walks the
  ring and asserts every non-zero cause was already issued.

## 5. Acceptance gates — honest status

| Gate | Status | Evidence / reason |
|---|---|---|
| **S3-A1** 20 × 400-year stability | **NOT RUN** | tests run 2–6 years on ~6 settlements; no harness exists |
| **S3-A2** ≥3 arcs in ≥10/20 seeds | **NOT MET** | arc detectors not implemented; the systems that produce arcs 2–4 (war, trade, blight) are absent |
| **S3-A3** 150k–800k population at year 400 | **NOT MEASURED** | 400-year runs not executed |
| **S3-A4** sev-4 events have causes | **PARTIAL** | true for the events that exist (tested); most of the 20 event types are not produced yet |
| **S3-A5** 20 explainable wars | **NOT MET** | no war system |
| **S3-A6** LOD equivalence | **STRUCTURAL ONLY** | by construction the camera never reaches a rule (design §3); no A/B harness run |
| **S3-A7** save ≤1.2 MB, load ≤1 s | **NOT MEASURED** | round-trip is tested; size/time not measured on a real world or device |
| **S3-A8** p95 ≤3 ms full pipeline | **INDICATIVE ONLY** | perf run 45709012104: 18,000 days, Medium, p50 0.001 ms, p95 0.002 ms, max 0.14 ms, heap +105 KB/10k — but with 6 settlements and no political layer, so this is not the acceptance configuration |

Because S3-A2, S3-A3, S3-A5 and the harness are missing, Stage 3 cannot be declared complete, and it is
not.

## 6. Save schema v2 and migration

- `SAVE_SCHEMA_VERSION = 2`. The four-shard set is unchanged, so the Stage 2.1 completeness, CRC and
  recovery rules keep working untouched; the society block travels inside the `meta` shard as JSON.
- **Migration 1→2** happens on load: a v1 meta has no society block, so the society is initialised
  deterministically from the legacy population with a remainder-exact cohort table. No RNG, no terrain
  regeneration, no clock.
- **Tested:** a v1 generation produced by the real encoder (`serializeWorld(state, 1)`, society removed
  from meta) loads, migrates, keeps settlement/civ identity and conserves population exactly; the
  migrated world then continues deterministically.
- An earlier attempt to build the fixture by relabelling a v2 file as v1 was rejected by the
  terrain-header check — the check was right, and the fixture was rebuilt honestly.

## 7. Tests and CI

| | |
|---|---|
| Unit/integration | **88 tests in 11 files, all passing** (was 81) |
| New | `tests/society/living.test.ts` — conservation, cohort sums, stock bounds, determinism, cause chains, save round-trip + continuation, v1 migration |
| Determinism | 120 worlds identical across two fresh processes (unchanged) |
| Browser | 4/4 (unchanged; the new systems are not yet exposed through the UI) |
| `ci` | [45709012292](https://github.com/khiyarusa/world-simulator/actions/runs/45709012292) — **success** |
| `android` | [45709012158](https://github.com/khiyarusa/world-simulator/actions/runs/45709012158) — **success**, APK 4.59 MB |
| `perf` | [45709012104](https://github.com/khiyarusa/world-simulator/actions/runs/45709012104) — **success** |

## 8. Android

APK artifact `world-simulator-debug-3ac6f2e…` (4,808,322 bytes). **Device validation: PENDING** — no
Galaxy A23 is attached to this environment, and the Stage 2 gap the owner accepted remains.

## 9. Deferred, not cut

Trade routes, infrastructure build decisions, military, diplomacy/treaties, war, technology, culture,
utility-AI decision sites, the 20-seed balance harness, arc detectors and the LOD A/B run. These are in
`docs/STAGE_3_DESIGN.md` with their assigned phases and caps; they were deferred because the execution
budget of this session ran out, not because they were judged unimportant.

## 10. Next session's first task

1. `tools/balance.ts`: run N seeds for Y years through the real pipeline, emit machine-readable JSON
   (population, settlements, civs, events, conservation counters, tick distribution, save size).
2. Use it to tune the food economy until a 400-year Medium world stays inside 150k–800k **without**
   clamping population.
3. Then the political layer in this order: trade → build → military → diplomacy → war → tech/culture,
   each with an event and a decision record, then the four arc detectors.

Only after those exist can S3-A2/A3/A5 be evaluated at all.
