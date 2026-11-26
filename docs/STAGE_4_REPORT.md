# STAGE 4 REPORT — PLAYER EXPERIENCE AND CONTENT

Status: **software-complete, physical-device pass pending (Stage 5)**. No device validation is claimed.
Baseline: `e912487796c0b73697716366feab8ecb390fe790`.

---

## 1. What was built

### 1.1 Worker API and data contracts

- Added typed `QueryWhat` for world, settlement(s), civilization(s), economy, ecology, history,
  event/causality, chronicle, decisions, interventions and the six layers.
- Added structured `QueryResponse` (`ok`/`code`/`message`) and a `player` command message with a
  structured `commandResult`.
- All list queries are bounded; history and chronicle paginate; layer cells are freshly allocated and
  transferred.
- The previous `settlement` query and `world` checksum remain compatible with the session/tools.

### 1.2 Interventions

- Bless, Blight, Fertilize and Incite are validated in the worker and applied to real state:
  stocks through `addStock`, vegetation/fertility grids, health/stability, relation/grievance.
- Cooldowns (360/1080/1800/1800 days) are persisted, not UI-only.
- Lingering blight/fertilize effects are persisted rows and are read every month by ecology and
  production; a blight multiplies agricultural yield while active.
- Every action appends an event with cause `-2` (player root), a persisted intervention row and a
  counter. The UI shows the worker's actual `effects` and the event id.
- Bless is capped at 10 % of current + one year of use; the UI receives the same limit from the worker.

### 1.3 Six real layers

Political (derived territory, capitals, war/treaty edges, occupation), Terrain (smoothed bake),
Population (population halos, migration origins), Economy (wealth/shortage rings, trade routes),
Ecology (fertility heat, drought/blight areas), History (severity-sized event pins). Layer changes and
30-day refreshes only; marker sizes are screen-space; raster territory sits below glyphs, vector symbols
above them.

### 1.4 Six panels and history/causality

Settlement, Civilization, Economy, History, World and Influence panels, all query-backed. History has
events/chronicle modes, category/severity/player/search filters, pagination, event detail with cause
chain, direct consequences and an honest root. The world panel includes a measured yearly series and
save status. Influence shows cooldowns, active effects, recent actions, destructive warnings and the
structured result with an event link.

### 1.5 World management

Multiple worlds with stable ids, names, seeds, presets, counts, day, checksum and a real saved
thumbnail; create, play, rename, delete (confirmed), save, autosave and return to the list. Damaged
generation recovery still repoints and deletes the damaged generation.

### 1.6 Visual, UX and language

Smoothed terrain bake, ruined settlement glyphs, state marks, screen-space layer symbols, legend
scales, 24 px icon set, mobile bottom sheet/right panel layouts, safe areas, 48 dp targets, reduced
motion and focus styles. **Persian RTL (Vazirmatn) is the default**, English is a complete second
language; all strings go through `t()` and numeric/proper-noun bidi is handled explicitly.

### 1.7 Persistence

Schema 4 adds intervention rows/cooldowns, 256 yearly world samples, six yearly population samples per
settlement and four counters inside the existing four-shard `meta` block. Checksum contract v6 covers
them. Schema 2/3 blocks decode with the new rings empty; a schema-4 block missing them is corrupt.

---

## 2. Acceptance gates

| Gate | Evidence | Result |
|---|---|---|
| A. Six layers work with real data | `tests/worker/queries.test.ts`, `tests/e2e/smoke.spec.ts` (all layer switches), `tests/visual/capture.spec.ts` captures 04–08 | **pass** |
| A. Six panels work with real data | E2E opens all six; visual captures 09–14, 16–17 | **pass** |
| A. Four interventions work and are recorded | `tests/society/interventions.test.ts` (7 tests), E2E bless + save/load, visual event detail | **pass** |
| A. History/causality usable | `queryHistory`/`queryEvent` tests, event detail + chain UI, chronicle capture 16 | **pass** |
| A. World management complete | E2E create/switch/rename/delete + recovery (5 tests), world list capture 19 | **pass** |
| B. UI shows authoritative data | all panels call worker queries; no panel-local simulation values | **pass** |
| B. Invalid ids/queries handled | query tests + worker `QueryResponse`; commands reject malformed targets | **pass** |
| B. Determinism preserved | Stage 3 determinism CI; intervention determinism test; camera test unchanged | **pass** |
| B. Conservation | intervention tests check actual stock delta; no cohort creation; existing invariants green | **pass** |
| B. Saves preserve state | schema-4 round-trip test incl. interventions, cooldowns, series, trend; recovery E2E | **pass** |
| C. Visual quality | 19 committed real-app captures in `docs/qa/stage4/`; polished atlas terrain, panels, legends | **pass (software)** |
| D. Typecheck / lint / repo gates | `tsc --noEmit`, `eslint .`, `node scripts/check-repo.mjs` locally; CI links below | **pass** |
| D. Unit/integration | 114 tests in 16 files locally | **pass** |
| D. E2E | 8 Playwright tests locally (2.5 min) | **pass** |
| D. Visual QA | 1 capture test, 19 images, uploaded artifact in CI | **pass** |
| D. Web + Android builds | CI `verify` and `android` jobs, both green (`§8`) | **pass** |
| E. Documentation accurate | Stage 4 design/report + AGENTS/README/ROADMAP/architecture/save/UX/asset/QA/perf/ADRs | **pass** |
| F. Physical Galaxy A23 | not performed; deferred to Stage 5 by the user's workflow | **pending** |

---

## 3. Measurements (local CI-class runner, Chromium/SwiftShader)

| Metric | Value | Where |
|---|---|---|
| Unit/integration tests | **114 passed / 16 files** | `npx vitest run` |
| Browser E2E | **8 passed** | `npx playwright test --project=chromium` |
| Visual captures | **19 images**, 390×844 @ DPR 2 | `docs/qa/stage4/` |
| Raw save at year 400 (Medium, 1 seed) | **1,158 KiB = 1,185,792 B** (contract < 1,200,000 B) | `tools.js balance --seeds=1 --years=400` |
| Tick p95 at year 400 | **0.323 ms** (budget 2 ms) | same |
| Population at year 200 (1 seed) | 187,647 (in 150k–800k band) | same |
| Invariant failures | **0** | same |
| Web bundle | `index` 402.7 kB / 119.2 kB gzip; worker 141.9 kB | `npm run build` |
| Debug APK | **5,229,380 bytes (5.23 MB)** | CI `android` artifact |
| Font weight | 152 KB (3 × WOFF2) + 4.4 KB licence | `public/fonts/` |

The Stage 3 20-seed balance remains the balance authority; Stage 4 did not change simulation rules
except the additive intervention/statistics state and the blight yield hook.

---

## 4. What changed at the architecture level

- Worker owns queries and commands; the main thread has one query client and no parallel world model.
- Sessions split into `sessionCore` (loop/protocol/renderer/map), `sessionWorlds` (list/create/save)
  and `session` (panel API/debug facade) to keep each file under the 500-line hard limit.
- Panels split into core (world/settlement), societies (civ/economy), history and influence layers; the
  shell instantiates the final `PanelHost`.
- Query code split into types/names/events/economy/layers/handler; codec split into types/encode/decode.
- i18n dictionaries live in `i18n.en.ts`/`i18n.fa.ts`; runtime formatting stays in `i18n.ts`.

---

## 5. Known limitations

1. **No physical-device validation.** No A23 frame times, touch-feel, TalkBack or real save/load timings.
2. Political territory is a nearest-living-settlement projection (documented), not a simulated border
   grid; the layer metadata states the rule.
3. Migration destinations are recorded as civilizations, not coordinates; the population layer shows
   origin rings rather than invented flow lines.
4. The yearly series begins after year 1; one sample is drawn as a flat line, not a fake trend.
5. Per-settlement daily production/consumption rates are not stored historically; the economy panel
   uses real stocks, prices, cumulative flows, routes and shortages.
6. Visual QA runs in Chromium/SwiftShader; GPU-specific rendering differences remain a Stage 5 device
   concern.
7. Narrow 320 dp and large-text Persian layouts are implemented responsively but not captured on a
   device.

---

## 6. Stage 5 priorities (exact)

1. Install the CI APK on the Galaxy A23 and run `PERFORMANCE_BUDGET.md` §11 (50 years at 8×, save/load
   at year 200, every panel/layer by touch), recording captures.
2. Profile layer queries at 200 settlements under 8× (political cells are the most expensive query) and
   reduce the 30-day refresh cost if a device frame hitch appears.
3. Device pass over 360×800 / 390×844 / 412×915, portrait + landscape, Persian and English, large text
   and TalkBack.
4. Fix any device-only visual/touch issues; no new features.
5. APK size/perf final check and release packaging.

---

## 7. Remaining risks

- A device may reveal that the 30-day layer refresh is too frequent at high speed; the cache key is
  already isolated, so the fix is a cadence/query change, not a redesign.
- The political query is O(land × settlements); at 200 settlements on a weak phone it is the first
  place to profile.
- Persian text expansion can push tab rows to three lines on 320 dp; the tab strip wraps by design but
  needs device confirmation.
- Visual captures are software-rendered; colours may differ slightly on Adreno.

---

## 8. CI and artifacts

Code commit: `3ef8ff947f652d208f88c115bc7df39f237f7b88`. All four workflows ran on it and passed:

| Workflow | Result | Link |
|---|---|---|
| `ci` (typecheck, lint, repo gates, 114 unit/integration tests, two-process determinism, hydrology, web build, 8 E2E tests, 19 visual captures) | **success** | https://github.com/khiyarusa/world-simulator/actions/runs/45829111590 |
| `android` (web build + Capacitor sync + debug APK + size budget) | **success** | https://github.com/khiyarusa/world-simulator/actions/runs/45829111653 |
| `balance` (20 seeds × 400 years, arcs, save size) | **success** | https://github.com/khiyarusa/world-simulator/actions/runs/45829111565 |
| `perf` (tick-time budget) | **success** | https://github.com/khiyarusa/world-simulator/actions/runs/45829111734 |

Artifacts:

- debug APK `world-simulator-debug-3ef8ff9…` — 5,229,380 bytes;
- visual QA `visual-qa-3ef8ff9…` — 975,049 bytes; committed copies in `docs/qa/stage4/` with
  [`README.md`](qa/stage4/README.md);
- CI fixtures `ci-fixtures-3ef8ff9…`.

No physical-device artifact exists. Stage 4 must not be described as device-validated.
