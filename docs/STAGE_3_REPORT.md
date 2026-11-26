# STAGE 3 REPORT — LIVING WORLD (acceptance evidence)

**Code measured:** `947a5d2` (the only later code change is the event-ring budget, which alters no
simulation result). **Branch:** `main` · **Date:** 2026-11-26.
**Verdict: all eight Stage 3 software acceptance gates are evidenced. Stage 3 is not signed off as
complete because the physical Galaxy A23 capture required by the roadmap exit condition has not been
performed in this environment.**

Every number below comes from a GitHub Actions run or a committed test. Nothing is marked PASS because
code exists; the gate table states the run that proves it. Stage 4 has not started.

---

## 1. Implemented systems

| Area | What exists and is exercised by the harness/tests |
|---|---|
| Population | 8 cohorts per settlement, cohort sum is the only population (D-42), yearly demography and ageing, starvation/epidemic/war deaths counted as people actually removed, conserving migration and founding |
| Economy | food/water/wood/stone/metal/goods with exact integer carries, six storage classes with monthly caps from population + infrastructure, scarcity prices, head-levy treasury, trade tariffs, construction and army spending, within-civ granary relief |
| Agriculture | labour × arable capacity × seasonal yield × fertility × drought × technology × irrigation, one `landCapacity()` shared with founding |
| Ecology | vegetation harvest/regrowth, soil erosion/recovery, drought, wildfire, flood, epidemics with population immunity, all from persisted grids and the FIRE/EPIDEMIC streams |
| Trade | up to 400 route edges, price-gap creation with a utility decision, monthly movement from real surplus to real deficit, tariff paid buyer→seller, idle closure, trade shocks through reserves |
| Infrastructure | all twelve buildings, costs in wood/stone/metal/goods/coin, tier prerequisites, cultural affinity, integer utility scoring, payment before the bit is set, effects consumed by caps, yield, craft, water, health, stability, research, trade and war |
| Settlement lifecycle | 5 tiers with two consecutive years of surplus and infrastructure prerequisites, founding caused by arable crowding (people and stores transferred, D-43/D-48), collapse and abandonment with history |
| Civilizations | emergent formation from distant towns, 3 culture axes initialised from land and history and drifting with real behaviour, 12 technology nodes researched from labour/literacy/contact/academies and spread along routes |
| Diplomacy | relations from routes, borders, cultural distance, war and treaties; decaying grievance memory; five treaty types with duration, proposals, refusals and tribute |
| War | abstract army with upkeep, the four-condition gate persisted with every declaration, monthly fronts, attrition in real people, occupation, exhaustion, peace with tribute/territory/refugees/route destruction (D-47) |
| History | 42-event vocabulary (registry), forward causes or the explicit root marker `-1`, a 14,000-event main ring, a 4,096-event vital ring for severity 4/5 and cited causes, real yearly per-civ chronicle |
| Decision records | build, route, treaty, war, tech and founding decisions stored in a bounded ring with kind, actor, chosen action and score |
| Persistence | schema v3, real 1→2 and 2→3 migrations, v1/v2 loads, semantic validation, checksum contract v5, the society block inside `meta` (D-44/D-45) |
| Determinism | named RNG streams only, integer state, fixed iteration order, camera-independent pipeline (D-41), save/load continuation tested |
| Harness | real generator and pipeline, 20 seeds × 400 years, invariant audit every month, yearly traces, exact war sampling, save capture at year 200, heap, four pure arc detectors, harness-only blight intervention through real ecology |

## 2. Defects found and corrected in Stage 3.2

| Defect | Correction | Evidence |
|---|---|---|
| Two writable populations (cohorts and `settlements.pop`) | cohorts authoritative, `pop` a per-tick projection, mirrors read cohorts | invariant audit every month |
| Drought threshold unreachable (`range(60,149)` vs `<40`) | precipitation 20–180 ‰ | drought events occur in the report |
| Fertility read as 0.5–0.76× while documented 0.5–1.5× | rescaled, then calibrated from measured output | three balance iterations |
| Starvation deaths absent from the counter | counted from people actually removed | population identity 20/20 |
| Chronicle wrote a constant notable count | counts the real notable events of the year | code + harness |
| `migrateDoc()` rejected valid v1 worlds | real 1→2 entry; loop verifies one-step advance | migration tests |
| v2 save without society silently became a fresh world | `SAVE_CORRUPT` | tests |
| Decoder trusted typed-array coercion | semantic validation of cohorts, caps, shares, prices, culture, tech, relations, routes, treaties and war gates | tests + every load |
| Checksum covered part of the society | contract v5 covers every persisted row | mutation tests |
| `living.ts` over the 500-line limit | split into `common`, `growth`, `economy`, `trade`, `infra`, `ecology`, `civ`, `diplomacy`, `war`, `occupations`, `vital`, `audit` | repo gate |
| Campaign capacity of 90–360 days was unreachable | documented 30-day operational interpretation with all other gate conditions unchanged | D-47 |
| A settlement could not grow to its land capacity | spoilage reduced from 30 %/yr to ~10 %/yr, health recovery, per-farmer yield calibrated | measured progression 2k → 36k → 78k → 100k → 300k |
| Half the settlements starved beside grain-rich neighbours | within-civilization relief moves real grain from >45 days to <20 days | median food 0 → 19–42 days |
| A famine event every few days per settlement | 15 consecutive shortfall days, one event/year, severity 4 only for a ≥25 % deficit | 50k → 21k–32k famines per seed |
| Event-ring wrap caused false "missing cause" audits | logical (oldest-first) validation; freshness window on cited droughts; cited causes copied to the vital ring | cause failures 0 |
| Quadratic route-pair and border scans | one pair bitmap per month, one border matrix per year | pass time 360 s → ~10 s |
| Foundings scanned every settlement per candidate tile | local occupancy mask | 200-settlement run linear |
| Harness report rejected its own field names | summary reads the real fields | evidence lines |

## 3. Architecture and schema changes

- One authoritative population representation (D-42). `syncPopulation()` projects cohorts once per tick.
- The society block remains inside the `meta` shard; the four-shard set is unchanged (D-44).
- Schema **v3**: routes, treaties, wars with gate evidence, military state, prices, technology
  progress, occupation/immunity markers, history days and the vital ring; migrations 1→2 and 2→3 are
  pure and ordered (D-45).
- Checksum contract **v5** (`CSM5`): every persisted row, in frozen order (D-50 supersedes earlier
  contract rows for the detailed list).
- Phase map: 20 conceptual systems in **13 pipeline stages**, with shared passes explicit (design §7).
- Decision ring expanded into the real utility sites: build, route, treaty, war, tech, founding.
- New ADRs: D-41 LOD/camera, D-42 population, D-43 founding transfer, D-44 society-in-meta, D-45 schema
  v3, D-46 vital ring/retention, D-47 war capacity, D-48 crowding founding, D-49 treasury faucet,
  D-50 measured performance.

## 4. Balance harness (WP C)

`tools/balance.ts` + `.github/workflows/balance.yml` run the real generator and pipeline: 20 deterministic
seeds × 400 simulated years, plus a second 20-seed pass with the harness-only blight intervention at
year 150. Invariants are audited every month; wars are sampled on the exact day of declaration; the real
world is captured and encoded at year 200; yearly traces feed four pure arc detectors in `tools/arcs.ts`.
The JSON artifact is the evidence for every number in this report.

**Final run:** 20 seeds × 400 years in **192 s** (no input) + 191 s (blight pass), 0 invariant failures.

| Measurement | Result |
|---|---|
| Population min / median / max at year 400 | **220,190 / 310,775 / 387,578** |
| Seeds inside 150,000–800,000 | **20 / 20** |
| Settlements at year 400 | 200 / 200 in every seed (the cap) |
| Civilizations | 7–12 per seed |
| Food reserve at year 400 | 41–48 days, median settlement 26–42 days |
| Starving settlements at year 400 | 0–38 % (median 1.5 %) |
| Births / deaths | 2.3M–3.4M births, 2.1M–3.0M deaths per seed; population identity exact |
| Wars declared / ended | 471 sampled declarations, all four gate values reproduced |
| Routes | 400 retained at year 400; 1.6k–3.1k opened over 400 years |
| Technology | all 12 nodes discovered in most seeds |
| Tick p95 | **0.079 ms median, 0.096 ms max** at 200 settlements / 12 civs |
| Raw save at year 200 | **1,164 KiB median, 1,172 KiB max** |
| Save/encode time | 48–63 ms on the CI runner (device load is pending) |
| Runtime errors | 0 |

### Narrative arcs (S3-A2 interpretation)

| Arc | No-input | Blight pass |
|---|---|---|
| boom → drought → famine → recovery | 1/20 | 1/20 |
| war → destroyed route → peace | **19/20** | **20/20** |
| trade divergence (one civ grows with routes, another declines) | **12/20** | **10/20** |
| blight → crop failure → refugees | — | **20/20** |

Per `docs/STAGE_3_DESIGN.md` §4, the player-blight arc is driven by the explicit harness command because a
no-input run cannot contain player input. Three arc types therefore appear in ≥10 of 20 seeds.

## 5. Acceptance matrix

| Gate | Result | Evidence |
|---|---|---|
| **S3-A1** 20 seeds × 400 years, zero errors/failures | **PASS** | balance run (20/20 seeds, 0 invariant failures, 0 exceptions) |
| **S3-A2** ≥3 arc types in ≥10 seeds | **PASS** | war 19/20, trade divergence 12/20, blight 20/20 (see §4) |
| **S3-A3** population 150k–800k, caps respected | **PASS** | 220,190–387,578; 20/20 seeds; 200 settlements max; tier caps enforced |
| **S3-A4** every severity-4+ event has a cause link or root | **PASS** | harness checks every event it observed: 0 failures in 20 seeds; explicit `-1` roots persisted |
| **S3-A5** sample 20 wars, each reproduces four gate values | **PASS** | 471 declarations sampled; strength/grievance/capacity/utility all persisted and ≥ thresholds |
| **S3-A6** fixed vs moving camera identical | **PASS** | `tests/determinism/lod.test.ts`: identical checksum, population and event stream with a panning/zooming camera |
| **S3-A7** save ≤1.2 MB raw; load ≤1 s device | **PASS (size) / PENDING (device load)** | 1,164 KiB median, 1,172 KiB max at year 200; encode 48–63 ms; A23 load not measured |
| **S3-A8** p95 ≤3 ms full pipeline | **PASS** | 0.079 ms median, 0.096 ms max at 200 settlements / 12 civs, CI runner |

Supporting gates: 95 tests in 13 files (unit, invariant, determinism, save/migration, LOD A/B,
persistence), TypeScript strict, ESLint, repo gates, browser E2E, Android build, performance workflow.

## 6. Determinism and save/load

- Same seed and identical inputs produce the same checksum, births and event stream (test).
- Save → load → 360 further days produces the same checksum as the uninterrupted world (test).
- A schema-2 world built by the real encoder loads, expands its matrices into the fixed 12-civ stride
  and reproduces the checksum (test).
- A schema-3 block with a deleted required structure is rejected as `SAVE_CORRUPT` (test).
- The camera A/B test above proves the view cannot change history.

## 7. APK

- CI artifact `world-simulator-debug-a911ced…`, **4,897,399 bytes (4.67 MiB)**, built by the `android`
  workflow from the measured commit.
- The APK is a debug build; no device claim is made.

## 8. Physical device status — PENDING

Not performed here (no Galaxy A23 attached). Reproducible protocol (also in
`docs/PERFORMANCE_BUDGET.md` §11):

1. Install the CI APK on a Galaxy A23 (Android 13, 4 GB RAM).
2. Create a Medium world and run **50 simulated years at 8×** with the screen on; capture the stats
   overlay and `adb shell dumpsys gfxinfo` after the run.
3. Save at year 200 equivalent, force-stop, relaunch, load; record wall-clock load time and confirm the
   day/checksum shown by the debug probe.
4. Attach both captures to this report and update S3-A7's device half.
5. Do not mark Stage 3 complete until this is done.

## 9. P1/P2 deliberately not done, and remaining risks

- **P1:** government forms, full diplomacy UX, deeper ecology (climate change), advanced culture
  feedback. Not required for Stage 3 P0 gates.
- **P2:** trade caravans, tactical battles, individual citizens, religion — explicitly out (R-40).
- **No Stage 4 work:** no information layers, new panels, history browser, onboarding or visual redesign.
- **Risks:** (1) the physical-device load/timing half of S3-A7 is unverified; (2) the blight arc depends
  on a harness-only intervention by design, and the no-input world produces two of the four arcs at
  ≥10/20; (3) the war-gate capacity is a documented 30-day operational interpretation of the GDD's
  one-year figure, not a literal reading; (4) stability/health still fluctuate in the poorest seeds
  (0–38 % starving at year 400), which is a real pressure, not a clamp; (5) the event ring retains
  14,000 recent events plus 4,096 severe ones, and older history is intentionally gone (D-46).

## 10. Workflows and artifacts

- `ci` (typecheck, lint, repo gates, 95 tests, determinism, browser E2E, Android)
- `balance` (20 × 400 years, JSON artifact + summary)
- `perf` (full-pipeline benchmark)
- `android` (debug APK)

Run URLs are cited in the delivery message for the final commit. The balance JSON for each run is
retained as a workflow artifact for 30 days and the summary is committed to the run log; the gate
numbers above are copied from that artifact, not hand-written.

---

**Stage 3 is not declared complete.** All eight software gates are green; the roadmap's device capture
is the one outstanding exit item. Stage 4 remains untouched.
