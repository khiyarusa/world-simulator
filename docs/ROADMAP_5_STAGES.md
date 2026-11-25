# ROADMAP — 5 STAGES

Exactly five stages. No stage 6. Each stage has a **definition of done** that is either a CI gate
(automated) or a written manual check with recorded evidence. A stage is not complete because code
was written; it is complete when its gates are green **and** the evidence is attached.

Numbering: `S<n>-A<m>` is referenced from PRs and stage reports.

---

## Stage 1 — Foundation and architecture *(current)*

**Objective:** produce a buildable blueprint. No gameplay code.

| Work | Output |
|---|---|
| Repository audit | state recorded in the stage report (empty scaffold, no code, no workflows) |
| Skill research + install | `.opencode/skills/**` with 12 skills + router + licence |
| Official-source research | versions and requirements verified against vendor docs (`TECHNICAL_DECISIONS.md`) |
| Game design | `GDD.md`, `SIMULATION_MODEL.md`, `WORLD_GENERATION.md` |
| Technical architecture | `TECHNICAL_ARCHITECTURE.md`, `SAVE_AND_DATA_MODEL.md` |
| Performance design | `PERFORMANCE_BUDGET.md` |
| UX / visual / assets | `UX_AND_VISUAL_DIRECTION.md`, `ASSET_DIRECTION.md` |
| Delivery design | `QA_AND_CI_STRATEGY.md`, `SCOPE_AND_PRIORITIES.md` |
| Agent instructions | `AGENTS.md`, `SKILL_USAGE.md` |

**Deliverables:** `AGENTS.md` + 15 documents in `docs/` (16 in total) + installed skills + committed tree.

**Risks:** over-designing (mitigated by the P0-only rule); wrong version assumptions (mitigated by
registry/vendor verification on 2026-11-25 and by recording anything unverified as an assumption).

**Acceptance criteria**

- `S1-A1` All required documents exist and are non-trivial (no empty templates).
- `S1-A2` Cross-document numbers agree (world sizes, tick model, caps, budgets).
- `S1-A3` Every P0 feature is assigned to a stage; no orphan.
- `S1-A4` Every stage has measurable acceptance criteria.
- `S1-A5` Skills are installed at the OpenCode-recognised path with licence preserved, and
  `SKILL_USAGE.md` records the selection and its influence.
- `S1-A6` No implementation code, no dependency install, no APK attempt.
- `S1-A7` Self-review scores ≥ 4/5 in all ten categories.

**Exit condition:** `S1-A1…A7` satisfied and the stage report is delivered.

---

## Stage 2 — World engine and playable foundation

**Objective:** a generated world you can pan, zoom, inspect and save — on Android.

| Area | Work |
|---|---|
| Infrastructure | Vite + TS 7 + PixiJS 8.23 project, strict tsconfig, ESLint, Vitest, Playwright, Capacitor 8 shell (`android/` committed) |
| Core | `core/rng` (xoshiro128** + streams), `core/clock`, integer math, typed-array builders |
| Generation | `world/generate.v1` full pipeline, validation report, golden hashes, `generatorVersion = 1` |
| Sim skeleton | `WorldState` SoA, tick pipeline with phases 1–6 stubbed to constants, scheduler, checksum |
| Worker | protocol, `sim.worker`, delta mirror at 4 Hz, command queue at tick boundaries |
| Render | PixiJS boot, world bake (2048²), camera with pinch/inertia/bounds, settlement sprites, selection |
| UI | HUD (date, speed dial, layers stub), bottom sheet shell, dark theme tokens, safe areas |
| Persistence | IndexedDB wrapper, shard save/load, generations, autosave, schema v1, recovery |
| Perf | in-app overlay, frame/tick ring buffers, `perf.yml` harness + baseline |
| CI | `ci.yml` (typecheck, lint, unit, determinism, build, playwright), `android.yml` (APK) |

**Deliverables:** installable debug APK; `npm run dev` world on desktop for development; green CI.

**Dependencies:** Stage 1 docs only (no code exists).

**Risks**

| Risk | Mitigation |
|---|---|
| PixiJS 8 API details wrong at implementation time | version pinned; the `pixijs-rendering` skill's gotchas list is the checklist |
| Terrain bake too slow on A23 | bake in ≤ 4 chunks/frame + budgeted; degrade to 1024² |
| Android build fails in CI (SDK/JDK mismatch) | JDK 21 + compileSdk 36 + AGP 8.13 fixed in the workflow, pinned by version |
| Determinism leaks (iteration order) | static lint + two-process hash test from day one |

**Tests (all in CI):** unit (rng, clock, noise, hydrology), determinism (200-seed sweep + cross-process
hash + 15 golden worlds), invariants (INV-1…INV-5 on a stub world), Playwright (boot → generate →
canvas non-blank → pan → zoom → screenshot), save round-trip, APK artifact uploaded.

**Acceptance criteria**

- `S2-A1` Same seed ⇒ byte-identical world in the same process and in two fresh processes.
- `S2-A2` Medium world generates in ≤ 1.5 s on the A23 (recorded capture) and ≤ 4× the CI baseline.
- `S2-A3` Camera: pinch keeps the focal point within 2 px; pan never shows outside the world; 60 s of
  interaction causes zero long frames > 50 ms on desktop.
- `S2-A4` Save → force-stop → relaunch → load restores the same day and the same world checksum.
- `S2-A5` Corrupting a shard falls back to the previous generation (test).
- `S2-A6` `ci.yml` and `android.yml` are green; APK artifact downloads and installs on a device.
- `S2-A7` `perf.yml` passes with tick p95 ≤ 3 ms on the CI runner for a stub world.
- `S2-A8` No `Math.random`/`Date.now` in `src/sim/**` (static check green).

**Exit condition:** all eight criteria demonstrated with links to workflow runs and one device capture.

---

## Stage 3 — Living world and civilization systems

**Objective:** the world develops on its own. This is the hardest stage.

| Area | Work |
|---|---|
| Population | cohorts, needs, demographics, health, stability, migration (conserving) |
| Settlements | tiers, 12 infrastructure types, founding/expansion/fragmentation/abandonment |
| Civilizations | formation, culture axes + drift, 12-node tech + spread, government, legitimacy |
| Economy | production/consumption/spoilage, prices, routes, trade, treasury, specialization cap |
| Politics | relations, grievance memory, 5 treaties, four-condition war gate, war resolver, peace |
| Ecology | climate, drought/flood/fire/epidemic, vegetation, erosion, fertility |
| History | 42 event types, cause links, severity, retention, decision records |
| AI | utility scorer, 3 decision sites, decision records + on-demand explanation |
| LOD | tiering with hysteresis, Tier-2 aggregation equivalence |
| Harness | balance audit: 20 seeds × 400 years, narrative-arc assertions |

**Deliverables:** a world that produces a readable 400-year history with no player input; a headless
balance report; the settlement/civ/economy/history data ready for Stage 4 UI.

**Dependencies:** Stage 2 world + pipeline + save (economy state needs schema v2 → first real migration).

**Risks**

| Risk | Mitigation |
|---|---|
| Balance produces boring or degenerate worlds | the 20-seed harness is a gate, not a nice-to-have; tune constants, not rules |
| Tier aggregation causes history to depend on the camera | A/B equivalence test (INV-6); if it fails, reduce Tier-2 coarseness |
| Monthly tick spikes (diplomacy + war together) | slicing, per-system budget warnings, worst-case fixtures |
| Integer overflow in fixed-point multiplication | all products use a documented scale (10⁶) and are checked in dev with `Math.abs(x) < 2^31` |
| Scope creep into characters | characters stay P1 and are dropped before any P0 slips |

**Tests:** all simulation rules unit-tested; INV-1…INV-10; 20-seed balance report committed as an
artifact; migration fixture v1→v2; event cause-chain integrity; no-nondeterminism sweep.

**Acceptance criteria**

- `S3-A1` 400 simulated years, 20 seeds: zero runtime errors, zero invariant failures.
- `S3-A2` ≥ 3 of the 4 narrative arcs from `GDD.md` §16 appear in ≥ 50 % of seeds.
- `S3-A3` Population at year 400 within 150k–800k (Medium); no settlement exceeds tier caps.
- `S3-A4` Every severity-4+ event has a resolvable cause chain of ≥ 1 link, or an explicit
  `root_cause` flag.
- `S3-A5` War declarations are always explainable: sampling 20 wars, each reproduces its gate values.
- `S3-A6` Tier A/B test (INV-6): same seed, fixed vs moving camera ⇒ identical final checksum, or
  ≤ 0.5 % population delta with identical event sets.
- `S3-A7` Medium save at year 200 ≤ 1.2 MB raw; load ≤ 1.0 s on device.
- `S3-A8` `perf.yml` steady 1× tick p95 ≤ 3 ms with the full pipeline.

**Exit condition:** all eight criteria + the committed balance report + a device capture of a 50-year
run at 8×.

---

## Stage 4 — Player experience and game content

**Objective:** it stops being a simulation and becomes a game you can read.

| Area | Work |
|---|---|
| UI | full HUD, 6 layers, 6 sheets, speed dial, world menu, settings, onboarding |
| Inspection | settlement/civ/economy/history panels wired to queries; "Why?" cause-chain view |
| Interaction | selection, fly-to, intervention flows with cooldown + confirmation |
| History UX | chronicle browser, severity filter, event pins on the map |
| Persistence UX | world list, multiple worlds, delete, autosave indicator, persist request |
| Assets | final atlas (5 tiers × states), 20 UI icons, 2 fonts, paper texture, effects |
| Audio | ambience beds + UI ticks (P1) |
| Content | name tables, event text templates, tutorial copy |

**Deliverables:** a build a stranger can use for 10 minutes without instructions.

**Dependencies:** Stage 3 state + query API; `SAVE_AND_DATA_MODEL` schema v3 if UI fields persist.

**Risks**

| Risk | Mitigation |
|---|---|
| UI performance (DOM panels on a weak device) | transform-only animation, `contain: strict`, build content once per open |
| Information overload | one encoding per layer, one sentence of interpretation per number, max 3 tabs per sheet |
| Text/asset weight | subset fonts, single atlas, ≤ 6 MB total |
| Onboarding becoming a wall of text | 3 coach marks, perform-to-dismiss, no modal |

**Tests:** Playwright E2E for the full loop (create → pan → inspect → intervene → save → reload);
DOM contrast test; text-overflow test at 200 % scale; screenshot snapshots at 3 viewport sizes;
manifest/asset licence check; Lighthouse-ish first-paint check (informational).

**Acceptance criteria**

- `S4-A1` A new user completes create → pan → zoom → inspect → speed change with no external help
  (5-person informal test, recorded notes).
- `S4-A2` All six layers render correct data for the selected year on a real world.
- `S4-A3` Every severity-4+ event exposes "Why?" and resolves ≥ 1 cause link.
- `S4-A4` Sheet open ≤ 100 ms; no frame > 50 ms during panel interaction on device.
- `S4-A5` Text at 200 % does not clip or overlap on a 360 dp-wide screen (screenshot test).
- `S4-A6` Contrast test passes on all declared theme pairs.
- `S4-A7` Asset manifest complete: every file has source, licence, checks passed; total ≤ 6 MB.
- `S4-A8` Full E2E loop green in CI; world survives app restart on device.

**Exit condition:** `S4-A1…A8` + a 3-minute screen recording of the loop on the A23.

---

## Stage 5 — Optimization, QA and release

**Objective:** ship it, or ship a smaller thing that works.

| Area | Work |
|---|---|
| Profiling | frame/tick/heap capture on A23 and one low-end device; fix the top 3 costs |
| Memory | texture and event-store audit; leak check over a 1-hour session |
| Stress | 500-year large world, 12 civs, 200 settlements, 8× for 30 min |
| Reliability | save/load loops ×50, corruption injection, low-storage simulation |
| Polish | animation timing, copy, empty states, error messages |
| Android | release signing, AAB, versionCode, icon/splash, Play listing text |
| CI | release workflow, artifact retention, tag-driven versioning |
| Docs | `PERFORMANCE_BUDGET.md` v2 with `[VERIFIED]` values, release notes |

**Deliverables:** signed AAB + APK, green release workflow, verified budget sheet, release notes.

**Dependencies:** Stage 4 feature freeze. **No new features in Stage 5** — fixes, tuning, polish only.

**Risks**

| Risk | Mitigation |
|---|---|
| Perf work reveals an architectural problem | act on R1–R7 in `PERFORMANCE_BUDGET.md` §12; the bake + LOD design is the escape valve |
| Last-minute balancing changes break saves | balance constants are not persisted; saves unaffected |
| Signing/keystore mishandling | keystore in an encrypted secret, base64, never committed; documented rotation |
| Play policy issues (target SDK, data safety) | targetSdk 36 from stage 2, no data collection, no ads |

**Tests:** full suite + 30-minute device soak + 500-year stress + release build smoke + save-compat
matrix (v1→v5 fixtures) + APK install on a clean device.

**Acceptance criteria**

- `S5-A1` p95 frame time ≤ 33.3 ms on the A23 in all five measured scenarios (§11 of the perf doc).
- `S5-A2` 15-minute session frame-time degradation ≤ 25 % (thermal).
- `S5-A3` 500-year Large world: no crash, save ≤ 2 MB, load ≤ 2 s, no unbounded memory growth.
- `S5-A4` 50 consecutive save/load cycles: no corruption, no size growth.
- `S5-A5` Cold start ≤ 6 s (Medium world ready to interact).
- `S5-A6` APK ≤ 25 MB; AAB produced and installable from the artifact.
- `S5-A7` All stage-acceptance criteria from Stages 2–4 still green (regression).
- `S5-A8` Every budget marked `[VERIFIED]` has an attached capture; unverified ones are listed as
  open risks in the release notes.

**Exit condition:** all eight criteria + released artifacts + release notes + updated budget doc.

---

## Cross-stage rules

1. **Stage reports.** Each stage ends with a report: what shipped, gate results with links, what was
   cut, what slipped, and the next stage's first task. No report, no stage completion.
2. **No forward code.** Stage 2 may not implement Stage 3 rules "while it's easy", and Stage 3 may not
   build panels. Stubs must be honest (`return 0`, not a fake formula).
3. **Schema discipline.** Any persisted-field change bumps `schemaVersion` and adds a migration +
   fixture in the same PR.
4. **Budget discipline.** A PR that regresses a budget either fixes it or updates
   `PERFORMANCE_BUDGET.md` with a measurement and a reason.
5. **Evidence discipline.** "Tested" means a workflow run URL or a device capture path. Nothing else
   counts.
