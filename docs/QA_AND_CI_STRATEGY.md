# QA AND CI STRATEGY — World Simulator

The development machine has 2 vCPU / 2 GB RAM and no Node.js. **CI is the build machine.** This
document defines what runs where, what blocks a merge, and how a stage is proven done.

---

## 1. Test pyramid (and what each layer is allowed to claim)

| Layer | Count (target) | Runtime | Runs in | Proves |
|---|---|---|---|---|
| Unit — pure rules | 300+ | < 20 s | every push | arithmetic, curves, resolvers, formatters |
| Invariants — world state | ~30 | < 60 s | every push | conservation, bounds, id validity |
| Determinism — seeds | 200 seeds × 3 presets | < 3 min | every push | reproducibility, golden hashes |
| Integration — worker + protocol | ~15 | < 30 s | every push | message contract, tier continuity |
| E2E — Playwright | ~10 | < 4 min | every push | boot → generate → interact → save → reload |
| Perf — headless bench | 3 seeds × 4 speeds | < 6 min | push to `main`, nightly | tick budgets, regression |
| Android build | 1 | ~8–12 min | push to `main`, tags | APK produced, installable |
| Device validation | 8 manual steps | 20 min | per stage | everything CI cannot measure |

Rule: **a test may only claim what it actually executed.** A Playwright run under SwiftShader proves
correctness, never frame rate. A headless Node benchmark proves simulation cost, never GPU cost.

## 2. Workflows

### 2.1 `ci.yml` — every push and PR

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest          # public repo → 4 vCPU / 16 GB
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }

      - name: Install (lockfile-only)
        run: npm ci

      - name: Type check
        run: npx tsc --noEmit

      - name: Lint
        run: npx eslint .

      - name: Frontmatter/gate checks (docs, skills, assets)
        run: node scripts/check-repo.mjs

      - name: Unit + invariant tests
        run: npx vitest run --reporter=dot

      - name: Determinism — same process
        run: node scripts/determinism.mjs --mode=same-process --seeds=60

      - name: Determinism — fresh processes (2 runs, hash compare)
        run: |
          node scripts/determinism.mjs --mode=cross-process --seeds=200 --out=a.json
          node scripts/determinism.mjs --mode=cross-process --seeds=200 --out=b.json
          node scripts/compare-hashes.mjs a.json b.json

      - name: Golden worlds
        run: node scripts/golden-worlds.mjs --fixtures tests/fixtures/golden

      - name: Build
        run: npm run build

      - name: Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: E2E smoke
        # served by scripts/serve-dist.mjs, a plain static server: `vite preview` timed out in CI
        run: npx playwright test --project=chromium

      - name: Upload traces on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: test-results/
          retention-days: 7
```

### 2.2 `perf.yml` — simulation budgets

```yaml
name: perf
on:
  push: { branches: [main] }
  schedule: [{ cron: '0 3 * * *' }]
  workflow_dispatch:

jobs:
  sim-bench:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run build:sim
      - name: Bench
        run: |
          node tests/perf/tick-bench.mjs --preset medium --years 50 \
            --speeds 1,2,4,8 --seeds 3 --json > perf.json
      - name: Assert budgets
        run: node tests/perf/assert-budgets.mjs perf.json \
               --baseline .perf/baseline.json --regression 20
      - uses: actions/upload-artifact@v4
        with: { name: perf-report, path: perf.json }
```

The job fails on: tick p95 > 3.0 ms, any tick > 8 ms in a 1× steady run, heap growth > 1 MB / 10k
ticks, or a > 20 % regression against `.perf/baseline.json`. Baselines are updated only in a commit
that states the reason.

### 2.3 `fixtures.yml` — deliberate golden regeneration

`workflow_dispatch` only. Runs `npm run golden`, prints the diff and uploads `worlds.json`. It exists so
regenerating the golden contract is an explicit, reviewable act: the PR that commits the result must
also justify it (bump `generatorVersion` or show why existing worlds are unaffected).

While the fixture does not exist, the golden test **writes it and fails** with the path, so a missing
contract can never be mistaken for a green run.

### 2.4 `android.yml` — the artifact

```yaml
name: android
on:
  push: { branches: [main], tags: ['v*'] }
  workflow_dispatch:

jobs:
  apk:
    runs-on: ubuntu-latest           # 4 vCPU / 16 GB, SDK preinstalled
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '21' }
      - uses: gradle/actions/setup-gradle@v4

      - run: npm ci
      - run: npm run build
      - run: npx cap sync android          # copies dist/ + updates plugins

      - name: Assemble debug
        run: cd android && ./gradlew :app:assembleDebug --no-daemon --stacktrace

      - name: Assert APK size budget (25 MB)
        run: node scripts/check-apk-size.mjs android/app/build/outputs/apk/debug/*.apk 25

      - uses: actions/upload-artifact@v4
        with:
          name: world-simulator-debug-${{ github.sha }}
          path: android/app/build/outputs/apk/debug/*.apk
          retention-days: 14
```

Release (Stage 5) adds a `bundleRelease` job on tags with a keystore from secrets
(`ANDROID_KEYSTORE_B64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`),
signs, verifies with `apksigner`, and uploads the AAB. Secrets never appear in logs; the keystore is
never committed.

**No emulator jobs.** Instrumentation tests on a GitHub-hosted emulator are slow, flaky, and would
test a WebView that differs from a real device anyway. Physical-device checks (§5) cover that ground.

## 3. Quality gates

| Gate | PR | `main` | Nightly | Release |
|---|---|---|---|---|
| Type check, lint | ✅ block | ✅ | ✅ | ✅ |
| Unit + invariants | ✅ block | ✅ | ✅ | ✅ |
| Determinism (200 seeds) | ✅ block | ✅ | ✅ | ✅ |
| Golden worlds | ✅ block | ✅ | ✅ | ✅ |
| E2E smoke | ✅ block | ✅ | ✅ | ✅ full |
| Save round-trip / corrupt | ✅ block | ✅ | ✅ | ✅ ×50 |
| Perf budgets | informational | ✅ block | ✅ | ✅ |
| Android APK | — | ✅ block | ✅ | ✅ APK+AAB |
| Device validation | — | — | — | ✅ block |
| Docs consistency | ✅ block | ✅ | ✅ | ✅ |

`scripts/check-repo.mjs` enforces project-specific invariants that a general linter cannot:

- every `docs/*.md` referenced from `AGENTS.md` or `docs/README.md` exists;
- no parked-work markers in `docs/` (design docs must be decided, not parked);
- every installed skill directory has `SKILL.md` and the vendor `LICENSE`/`NOTICE` are present;
- `assets/manifest.json` (when it exists) covers every file under `assets/`;
- no `Math.random`, `Date.now`, `performance.now`, `crypto.` in `src/sim/**`;
- no import from `render/`, `ui/`, `platform/` inside `src/sim/**`;
- `SAVE_VERSION` has a migration entry and a fixture for every prior version.

## 4. Test policy details

### 4.1 Determinism tests

- `same-process`: generate twice, compare every byte of every grid + the checksum.
- `cross-process`: two separate Node invocations; compare a SHA-256 over the concatenated grids. This
  catches hash-randomised iteration, GC-dependent behaviour, and accidental wall-clock use.
- `golden`: 5 seeds × 3 presets stored as hashes. A change either keeps the hash or bumps
  `generatorVersion` and updates fixtures in a reviewed diff.
- `long-run`: 10,000 ticks from a fixed seed; checksum compared across OS/branch where feasible.
- `continuation`: after generate → save → load, the next 32 draws of a stream are identical to the
  uninterrupted world, and the stored state is not the seeded state (D-33, defect H-02).
- `identity`: preset ids and every recipe field change the recipe hash, including the `small`/`large`
  length-collision case that used to alias (D-32, defect H-01).
- `hydrology`: nine worlds across presets are audited for descent, cycles and terminal kinds; a
  deliberately broken flow direction must be reported (D-35, defect H-08).

### 4.2 Save tests

Round-trip exactness, continuation determinism (INV-9), corrupt/truncated/missing shard, newer schema,
migration fixtures for every shipped version, quota failure, generation GC, and a 50-cycle loop in
Stage 5.

### 4.3 E2E (Playwright)

| Test | Steps |
|---|---|
| boot | page loads, canvas present, `window.__ws.app.renderer` exists, no console errors |
| generate | create Small world from a fixed seed; assert canvas non-blank (pixel sample) and the HUD date appears |
| camera | pan and pinch via touch emulation; assert camera transform changed and clamped at bounds |
| inspect | tap a known settlement; assert the chip and sheet show that settlement's name |
| intervene | apply a blight; assert a `player_blight` event appears in history |
| save/reload | save, reload the page, load the world, assert same day + same settlement count |
| recovery | save twice, corrupt the current generation's terrain payload through the real IndexedDB, reload, assert the world recovers from the previous generation and the database is repaired |
| layers | switch all six layers; assert no errors and the canvas changes |

Playwright runs with a fixed viewport (360 × 800, DPR 2) and `hasTouch: true` for the mobile profile,
plus one 800 × 360 landscape project. Screenshots are attached, not diffed pixel-perfect (fonts and
GPU rasterisation vary) — except for the UI-only panels, which are diffed with a 2 % tolerance.

### 4.4 Flaky-test policy

A test that fails non-deterministically twice in 10 runs is quarantined within one working day:
tagged `quarantine`, removed from the blocking set, and either fixed or deleted within a week. A
quarantined list of more than 3 tests blocks new feature work. No `retry: 3` hiding of real races.

## 5. Physical-device validation (the part CI cannot do)

Protocol in `PERFORMANCE_BUDGET.md` §11. Evidence required per stage:

| Stage | Evidence |
|---|---|
| 2 | APK install + 60 s pan/zoom capture + save/reload |
| 3 | 50-year run at 8× capture + 5-minute stability log |
| 4 | 3-minute UX recording + panel timing log |
| 5 | 8-step protocol table with p50/p95 per step + thermal capture |

Format: a markdown table in the stage report with the device model, WebView version, Android version,
build SHA, and the measured numbers. "It felt smooth" is not evidence.

## 6. What is deliberately not automated

| Not automated | Why | Compensating control |
|---|---|---|
| GPU/frame-time on device | no representative GPU in CI | manual protocol, in-app overlay, stage gates |
| Touch feel / gestures | synthetic touch ≠ thumb | informal 5-person test at Stage 4 |
| Game balance "fun" | not a machine property | 20-seed narrative-arc harness (objective) + human review |
| Screen-reader flow | requires TalkBack | manual checklist at Stage 4 |
| Play Console review | external | pre-submission checklist at Stage 5 |

## 7. Failure triage and reporting rules

1. A red workflow is reported with the failing job name **and** the run URL. Never "tests pass" without
   a URL.
2. If GitHub access is unavailable, the report says so explicitly and lists what could not be verified.
   A green status is never inferred.
3. Budget failures are triaged as: measurement error → fix the harness; real regression → fix the code
   or update the doc with a measurement and a reason.
4. Determinism failures are stop-the-line: no feature work until resolved, because every subsequent
   test result becomes untrustworthy.

## 8. Repository hygiene

- Branch protection on `main`: PR required, `verify` required, linear history, no force-push.
- Commit messages: `type(scope): summary` (`feat`, `fix`, `perf`, `docs`, `test`, `chore`, `ci`).
- Every PR states: what changed, which gate it satisfies, and which budget it touches.
- Artifacts: APK 14 days, perf reports 30 days, traces 7 days. Never commit build output.
- Secrets: none in the repo; keystore only in Actions secrets; `.env*` ignored (already in
  `.gitignore`).


## Stage 3 suite (2026-11-26)

The Stage 3 suite is **95 tests in 13 files** plus the workflows below; the counts and results are
owned by `docs/STAGE_3_REPORT.md` §5 and the `ci` run it links. New coverage added for Stage 3:
conservation across births/deaths/migration/founding, cohort/occupation identity, economy caps and
prices, infrastructure payment, trade conservation, ecology and blight, civilization/technology,
diplomacy, the four-condition war gate, event-ring ordering and retention, v1/v2/v3 save paths, a v3
corruption case, and a fixed-vs-moving-camera A/B test on the real pipeline.

---

## 12. Stage 4 additions to the test strategy

- **Unit/integration:** intervention limits/cooldowns/conservation/determinism, query validation and
  pagination, layer shapes, schema-4 legacy decode/corruption/round-trip, world generation and saves.
  Current suite: **114 tests in 16 files**.
- **Browser E2E:** two specs, **8 tests**, covering boot → create → six layers → six panels → command →
  event → save/reload → two worlds → rename/delete → damaged-generation recovery. Ports are isolated from
  other projects on the machine (4174/4175).
- **Visual QA:** `tests/visual/capture.spec.ts`, 390×844 @ DPR 2, captures 19 real screens (worlds,
  creation, terrain + five layers, six panels, event causality, chronicle, English world panel/map,
  saved world list) into `docs/qa/stage4/`. CI uploads `visual-qa-<sha>` and the images are committed.
- **Repository gates:** the 500-line limit is honoured by splitting the new modules (D-58); the
  determinism/lint gates run unchanged.
- **Device:** still Stage 5. E2E proves the software path, not A23 frame times, touch feel or TalkBack.
