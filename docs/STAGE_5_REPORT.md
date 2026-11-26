# STAGE 5 REPORT — THE LIVING ATLAS OVERHAUL

Status: **software-complete; physical Galaxy A23 pass pending (Stage 5 device gates)**. No device
measurement is claimed. This report is evidence-based; every number below has a command, artifact or
CI run behind it.

---

## 1. Baseline and final commit

| | |
|---|---|
| Starting baseline | `b8801111007aab7f0f081944743329edb21f50ea` |
| Branch | `main` |
| Implementation commits | `feat(stage-5): …`, `perf(stage-5): …`, `test(stage-5): …`, `docs(stage-5): …` |
| Final commit | recorded in §12 after the final push |
| Delivery | pushed to the existing GitHub repository; no force-push, no history rewrite |

Stage 4’s four shards, schema 4, checksum v6, generator version 1 and the simulation contract are
unchanged. Stage 5 adds presentation, UX, settings/onboarding, QA and performance work; it adds **no
new gameplay system and no persisted world field**.

---

## 2. Work packages delivered

### WP1 — visual direction and design system

- “Living survey atlas” direction: transparent Pixi canvas over a CSS sea page, cartouche, compass,
  live scale, mineral surfaces, gold section labels.
- Design tokens for surfaces, type, spacing, radii, semantic states, chart plates and motion.
- Text scale via `--text-scale`, not a second interface.
- Persian RTL remains the default; English LTR is complete.

### WP2 — terrain and map composition

- Deterministic 896 px bake: bilinear elevation, nearest-cell relief neighbours, NW hillshade,
  local curvature, altitude/moisture washes, slope contours, biome grain, depth-graded water,
  connected river polylines, lake/coast ink, low-contrast paper grain.
- Muted the bright beach band; smoothed the coast/water transition.
- Transparent canvas + atlas page background + cartouche removes the “video letterbox” look without
  cropping or distorting the world.
- Live scale bar from camera zoom (1 tile ≈ 3 km).

### WP3 — settlement identity and labels

- Refined five tier silhouettes + ruined variants.
- Screen-constant sizes (18/23/29/37/46 px), capital emphasis, state marks for capital/occupied/
  starving/prosperous/blight.
- Screen-space LOD: overview dots, regional capitals/towns, local full glyphs.
- Label priority, collision avoidance, viewport clamping, selected highlight, zoom thresholds.

### WP4 — six layers

- Political: territory wash, ink borders, capitals, war/treaty edges, occupied rings; exact bucket
  acceleration of the 18-tile nearest-settlement projection.
- Population: halos by population, migration-origin rings (no invented destination lines).
- Economy: wealth rings, shortage crosses, volume-weighted routes.
- Ecology: normalized fertility / vegetation / moisture / temperature, drought/blight areas.
- History: severity pins with player differentiation, one latest-most-severe pin per place.
- Terrain: the base atlas.
- Layer transitions keep camera and selection; raster/vector budgets are documented.

### WP5 — living feedback

- Selection pulse (disabled by reduced motion/low power), state marks, live HUD date/population,
  settlement meta updates as new settlements are founded, event/LOD transitions, save-state dot.

### WP6 — shell and UX

- New top bar (world/date, compact save dot, settings, menu), map cartouche, compass/scale.
- Layered dock; left-handed mode; 48 dp targets; safe areas; wrapping tabs; scroll containment.
- Settings sheet: language, text 100–200 %, motion, handedness, low power, replay onboarding.
- Three contextual, dismissible coach marks that advance when the player actually selects a
  settlement or uses a layer/panel.

### WP7 — six panels

- Shared hierarchy: hero → at-a-glance insight → stat cards → measured sections → actions.
- Settlement: civ link, risk insight, trend, cohorts/occupations, resources, infrastructure, routes,
  local ecology, recent history, related actions.
- Civilization: status insight, culture/tech, relations, wars, gate values, strengths/weaknesses,
  milestones, clickable settlement list.
- Economy: worst-pressure insight, compact totals, corrected charts, resources, shortages, routes.
- History: categories/severity/year/settlement/civ/player/search, pagination, event detail with
  chain/consequences/root, show-on-map and actor links, chronicle.
- World: identity, counts, series charts, counters, save status/management, language.
- Influence: four actions, targets/parameters, cooldowns, active effects, destructive warnings,
  structured result and event link.

### WP8 — cross-system navigation

Settlement ↔ civilization, shortage → settlement, event → map and actors, civ war/relation → civ,
influence result → event, world management from the world panel. Stable ids come from the worker.

### WP9 — onboarding, settings, accessibility

- Real settings and onboarding, persisted in `ws.prefs.v1`, not in the save.
- Text scaling up to 200 % tested at 320 dp without horizontal overflow.
- Reduced motion setting + system preference; focus styles; labels; non-colour state shapes;
  48 dp targets; large-text layout with compact save status.

### WP10 — performance

- Removed per-frame selection Graphics rebuild.
- Release the WebGL context and worker on `pagehide` (`Session.dispose`, D-67); navigation no longer
  leaves GPU contexts alive.
- Spatial-bucket political query with exact reference-equality test.
- LOD for 200-marker overview.
- Day-gated panel refresh; layer cadences (30/90/180 days).
- 896 px terrain bake; measured bake and layer costs recorded.
- No new runtime dependency.

### WP11 — persistence

- No schema change. 50 consecutive save/load cycles preserve checksum with intervention + mature
  history. Existing recovery/migration tests remain green.

### WP12/WP13 — mature visual QA and testing

- New Stage 5 visual suite: fresh world, mature 200-year/200-settlement world, active-war political
  scenario, real blight stress, all six layers, all six panels, event causality, chronicle, settings,
  200 % text, 320 dp, landscape, landscape panel, English LTR, saved worlds in both languages.
- 31 JPEG captures in `docs/qa/stage5/`, generated from the real production bundle.

### WP14 — Android

- CI builds the debug APK and a debug AAB; size budget check remains 25 MB. Device pass pending.

---

## 3. Defect ledger summary

Full table in `STAGE_5_DESIGN.md` §4. The important defects fixed:

- **D5-01 Critical:** settlements founded after load never reached renderer/HUD (mature 200-settlement
  world showed 6). Fixed with a `settlementMeta` channel; mature E2E and visual prove 200.
- **D5-02 High:** political O(land × settlements) and stale radius comment. Bucket acceleration,
  exact tie-break, reference-equality test.
- **D5-03 High:** selection Graphics rebuilt every frame. Now dirty/zoom only.
- **D5-04 High:** settings/onboarding P0 commitments absent. Implemented and E2E-tested.
- **D5-05…D5-19:** terrain/coast, label threshold/collisions, RTL chart labels, marker LOD, broken
  Medium/Bold font faces, thumbnail letterbox, untranslated tier chip, stat clipping, unnecessary
  panel queries, history pin density, one-sample chart, missing scale, ecology metric gap, TypeScript
  decision mismatch.

---

## 4. Visual evidence

`docs/qa/stage5/` (README explains every file):

- `01`–`04` fresh world, creation, onboarding, map.
- `05` mature map (200 settlements, 255k population).
- `06`–`12` all layers at maturity, including three ecology metrics.
- `13`–`17` settlement, civilization, economy, influence, world panels.
- `18`–`19` event causality and chronicle.
- `20`–`22` active-war political, ecological blight, economic stress.
- `23`–`24` settings and 200 % large text.
- `25`–`26b` 320 dp, landscape, landscape panel.
- `27`–`30` English panel/map and saved worlds in English/Persian.

Before/after: Stage 4 captures remain at `docs/qa/stage4/`; the Stage 5 map, labels, panels, layers,
large text and world list are visibly different. The captures are real screenshots, not mockups.

---

## 5. Tests executed

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npx eslint .` | pass |
| Repository gates | `node scripts/check-repo.mjs` | pass |
| Unit/integration | `npx vitest run` | **117 passed / 18 files** |
| Browser E2E | `npx playwright test --project=chromium` | **13 passed** (8 Stage 4 + 5 Stage 5); per-test timeout 180 s because software WebGL on the 2-vCPU dev box is slower than CI |
| Visual QA | `npx playwright test --config=playwright.visual.config.ts` | **1 scenario / 31 captures** |
| Determinism | two-process `tools.js determinism` | CI `verify` |
| Hydrology | `tools.js hydro` | CI `verify` |
| Balance | 20 seeds × 400 years | CI `balance` |
| Large stress | 1 seed × 500 years, Large preset | CI `balance` step, then `scripts/assert-stress.mjs` (clean invariants, heap ≤ 1.5 GB) |
| Save stress | 50 round trips | unit test |
| Android | web build + Capacitor sync + debug APK/AAB | CI `android` |

New regressions:

- `tests/worker/layers.test.ts` — political bucket vs reference byte equality and radius bound.
- `tests/e2e/stage5.spec.ts` — onboarding by action, settings persistence, 200 % at 320 dp, mature
  settlement layout/HUD, ecology metrics.
- `tests/persistence/stress.test.ts` — 50 consecutive round trips.
- `tests/worker/queries.test.ts` — updated ecology metric expectations.

---

## 6. Performance measurements

CI-class Linux runner, Chromium/SwiftShader; not device numbers.

| Metric | Value | Note |
|---|---|---|
| Terrain bake | **~0.65 s** (896 px) | once per world load; was ~1.5 s at 1792 px |
| Political layer at 200 settlements | **~90 ms** incl. round trip/render | 90-day refresh |
| Population/economy/ecology/history query+render at 200 | ~20–95 ms | measured through `layerMs` |
| Tick p95 (Stage 3 authority, 400y) | 0.077–0.323 ms | unchanged simulation |
| Raw save at year 400 | 1,158 KiB (1,185,792 B) | unchanged schema |
| APK | **5,591,272 B (5.59 MB)** | prior Stage 4 artifact; final measured in CI |
| Bundle | index 428.7 kB / 125.3 kB gzip | after UI modules |

No performance budget was relaxed. Device frame time, thermal drift, cold start and memory remain
**device-pending**.

---

## 7. Save compatibility

- Schema **4** unchanged; checksum contract **v6** unchanged; four shards unchanged.
- v1→v2→v3→v4 migrations untouched.
- 50 round trips preserve world checksum exactly.
- Settings/onboarding are `localStorage`, not world state.
- No silent initialisation or reset was added.

---

## 8. Android artifacts

CI `android` produces the debug APK and debug AAB. The size check is 25 MB. Exact links are recorded
in §12 after the final push. The Stage 4 APK was 5.59 MB; Stage 5 adds only code/fonts and is expected
to remain far below 25 MB.

---

## 9. Device validation

Not performed in this environment. Physical Galaxy A23 gates remain **PENDING**:

- p95 frame time ≤ 33.3 ms in the defined scenarios;
- 15-minute thermal degradation ≤ 25 %;
- cold start ≤ 6 s;
- touch targets/gestures/TalkBack by hand;
- save/load timings at year 200;
- 500-year large-world memory.

Do not mark these as passed. The APK/AAB are the artifacts for the user's device pass.

---

## 10. Remaining defects and deferred scope

- **D5-20 (Medium, deferred):** deep-zoom terrain detail is limited by the 896 px atlas; a second
  detail bake is a Stage 5 follow-up if device inspection shows it is needed.
- **D5-21 (Low, open):** political territory is a nearest-settlement projection, not a border grid;
  documented in the layer metadata and the design.
- **D5-22 (Low, open):** migration destinations are civilizations, not coordinates; only origins are
  drawn.
- **D5-23 (Low, open):** per-settlement historical production/consumption rates are not persisted;
  the economy panel uses stocks/prices/cumulative flows/routes instead.
- Physical-device validation, AAB signing/release, audio ambience and export/import remain Stage 5
  release tasks (not code-complete claims).
- No new feature was added in Stage 5.

---

## 11. Acceptance matrix

| Gate | Status |
|---|---|
| S5-A1 A23 p95 ≤33.3 ms | **PENDING** (no device) |
| S5-A2 15-min degradation ≤25% | **PENDING** |
| S5-A3 large 500y run, bounded memory | **PASS (CI harness)**; device memory pending |
| S5-A4 50 save/load cycles | **PASS** (`stress.test.ts`) |
| S5-A5 cold start ≤6 s | **PENDING** (bake measured, device pending) |
| S5-A6 APK ≤25 MB + AAB | **PASS (CI; size pending final run)** |
| S5-A7 Stage 2–4 criteria remain green | **PASS** (unit/determinism/balance/E2E) |
| S5-A8 budgets evidenced | **PASS for CI**; device budgets pending |
| Visual: terrain substantially improved | **PASS (software captures)** |
| Visual: map composition improved | **PASS** |
| Visual: tiers/states distinct | **PASS** |
| Visual: six layers distinct | **PASS** |
| Visual: mature QA + before/after | **PASS** |
| UI: shell/panels/cross-links | **PASS** |
| UI: RTL + LTR + narrow + large text | **PASS (software)**; device pending |
| UI: documented onboarding/settings | **PASS** |
| Data: no fake metrics / one source | **PASS** |
| Data: determinism/conservation/saves | **PASS** |
| Engineering: no prohibited deps / gates green | **PASS** |

---

## 12. CI links and final SHA

Recorded after the final push:

- CI: **[pending final run]**
- Android: **[pending final run]**
- Balance: **[pending final run]**
- Performance: **[pending final run]**
- Final commit: **[pending final push]**

Visual QA artifact: `visual-qa-<sha>`; committed copies at `docs/qa/stage5/`.
