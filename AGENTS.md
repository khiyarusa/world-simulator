# AGENTS.md — World Simulator (project instructions)

**Read this before touching any file in this repository.**
This file is the permanent contract for every coding agent working here. It is not a tutorial; it is a
set of rules with reasons. When a rule and a convenience conflict, the rule wins.

Project root: `world-simulator/` (the directory containing this file).
Design set: `docs/`. Start with `docs/README.md`.

---

## 1. Mission

Build **World Simulator**: an offline Android sandbox where a procedurally generated world of
settlements, economies, ecologies and civilizations develops on its own, and the player can inspect,
accelerate and lightly influence it.

The product test for every decision: *does this make the world more causally readable?* If the answer is
"it adds content" or "it looks cool", it is not P0.

## 2. Where we are in the plan

| Stage | State |
|---|---|
| 1 — Foundation & architecture | **complete** (design + skills) |
| 2 — World engine & playable foundation | **implementation complete — device validation pending** (`docs/STAGE_2_REPORT.md`) |
| 2.1 — Reliability and correctness hardening | **complete** — 13 verified defects fixed, all with regression tests (`docs/STAGE_2_1_HARDENING.md`) |
| 3 — Living world & civilization systems | **implementation and all eight software gates evidenced; physical Galaxy A23 capture pending** (`docs/STAGE_3_REPORT.md`) |
| 4 — Player experience & content | **software-complete; physical Galaxy A23 capture pending** (`docs/STAGE_4_REPORT.md`) |
| 5 — Living atlas overhaul, optimisation, QA, release | **software-complete; physical Galaxy A23 validation and release signing pending** (`docs/STAGE_5_REPORT.md`) |

There are exactly five stages. **There is no Stage 6.** Unfinished work is cut or explicitly reported,
never deferred to an imaginary future stage.

Do not start a stage (or any implementation) unless the task prompt explicitly says to.

## 3. Hard rules

### 3.1 Platform (non-negotiable)

- **R-1** Android only: Capacitor 8 + WebView. `minSdk 24`, `compileSdk 36`, `targetSdk 36`.
- **R-2** No Windows/macOS/Linux/Electron/Tauri/Steam build. The browser build exists for development
  and CI, not as a product.
- **R-3** No account, no server, no network requirement, no telemetry upload, no ads, no IAP.
- **R-4** Touch-first. Portrait is the primary layout; landscape must work but may be simpler.
- **R-5** Offline-first: the game must be fully playable with the network off. Any feature requiring
  connectivity is rejected, not deferred.

### 3.2 Stack (do not drift)

- **R-6** TypeScript (strict), Vite, PixiJS 8 (rendering only), Web Worker (simulation), IndexedDB
  (persistence), Capacitor 8 (Android), GitHub Actions (all automation).
- **R-7** Runtime dependencies: **one** (`pixi.js`). Adding a runtime dependency requires an entry in
  `docs/TECHNICAL_DECISIONS.md` explaining what was measured or what was removed to pay for it.
- **R-8** No React/Vue/Svelte, no state-management framework, no physics engine, no ECS library, no
  noise/PRNG library, no UI kit. The UI is DOM + CSS; the PRNG and noise are ours (determinism).
- **R-9** No Unity/Unreal/Godot. No WebAssembly core unless `PERFORMANCE_BUDGET.md` proves the need.

### 3.3 Architecture boundaries (enforced by lint)

- **R-10** `src/sim/**` must never import `pixi.js`, `render/`, `ui/`, `platform/`, or touch
  `window`/`document`/`Date`/`performance`/`crypto`.
- **R-11** The renderer is never the source of truth. The worker owns state; the main thread owns a
  read-only mirror. A UI bug must be fixable without touching simulation rules.
- **R-12** One writer: only the simulation worker mutates world state. Only the main thread touches
  IndexedDB.
- **R-13** Commands are applied at tick boundaries and appended to the command log. No external input
  may land mid-phase.
- **R-14** No per-frame simulation work. Simulation runs on a fixed 1-day tick; rendering is decoupled.

### 3.4 Determinism

- **R-15** `Math.random`, `Date.now`, `performance.now`, `crypto.*` are forbidden in `src/sim/**`
  (CI-checked). Use the seeded RNG streams.
- **R-16** Every random consumer gets its **own named stream**. Adding a consumer must not change
  existing worlds.
- **R-17** No transcendental math (`sin/cos/pow/exp/log`) on simulation inputs. Use integer hashes,
  curves and lookup tables. Float only in generation, and only `+ − × ÷ floor sqrt`.
- **R-18** All iteration in the tick path is over explicit arrays with a total order. No `Set`/`Map`/
  `Object.keys` iteration, no sorting without an id tie-break.
- **R-19** Every change that alters world generation output bumps `generatorVersion` and adds a frozen
  generator path. Never edit a shipped generator version.

### 3.5 Economy and state

- **R-20** Economy and population are **integers** (fixed-point per-mille). No float accumulation in
  stocks. Use the shared scale helpers; never multiply raw per-mille by units.
- **R-21** Conservation is a law: resources and population must balance exactly. A change that cannot
  satisfy INV-1/INV-2 is wrong, not "close enough".
- **R-22** All caps in `PERFORMANCE_BUDGET.md` §4 are hard. Hitting a cap must be handled (refuse,
  merge, evict), never grown past.

### 3.6 Persistence

- **R-23** Any change to a persisted field bumps `schemaVersion` **and** adds a migration **and** a
  fixture save, in the same commit.
- **R-24** Migrations are pure, ordered, and never deleted.
- **R-25** Saves are written as a new generation and committed in a single transaction. Never overwrite
  the current save in place.
- **R-26** A load failure falls back to the previous generation, then reports — never half-loads and
  never silently resets a world.

### 3.7 Performance

- **R-27** `docs/PERFORMANCE_BUDGET.md` is the single source of frame/tick/memory numbers. Code comments
  cite it; PRs may not drift from it silently.
- **R-28** Every loop whose cost depends on world size needs a budget, a slice, or a cap.
- **R-29** No allocations in the hot path: no array literals, no closures, no string building per frame
  or per tick. Pool and reuse.
- **R-30** "Measure first" — do not optimise by feeling, and do not claim a number you did not measure.
  Targets are labelled `[TARGET]`; only measured values may be labelled `[VERIFIED]`.
- **R-31** Degrade appearance, never correctness, when the device is slow (`PERFORMANCE_BUDGET.md` §8).

### 3.8 Testing and delivery

- **R-32** All automation runs on GitHub Actions. Never require a local Android SDK, Gradle, emulator, or
  heavy test run on the development machine.
- **R-33** Never report a test as passing without a workflow run URL or a device capture path. If GitHub
  access is unavailable, say so explicitly.
- **R-34** A stage is complete only when every acceptance criterion in `docs/ROADMAP_5_STAGES.md` for
  that stage is green, with evidence in the stage report.
- **R-35** No new feature in Stage 5. Fixes, tuning and polish only.
- **R-36** A red `verify` or `perf` job blocks merges. Determinism failures stop all feature work.

### 3.9 Scope

- **R-37** Every feature must already exist in `docs/SCOPE_AND_PRIORITIES.md` at the right priority and
  stage. Inventing a feature requires updating that document first, with a reason and a cost.
- **R-38** Adding a P0 feature to a stage requires removing something of comparable cost from that stage.
- **R-39** Cut features stay cut with a recorded reason. Do not silently reintroduce them.
- **R-40** The cut list is not a challenge. Individual citizen agents, tactical battles, cloud saves,
  multiplayer, a map editor and runtime LLM decisions are **out** (see `TECHNICAL_DECISIONS.md`).

### 3.10 Documentation

- **R-41** One fact, one home. Numbers live in the document that owns them; others link, never copy.
- **R-42** Every significant decision (persisted shape, protocol, budget, stage scope, dependency) gets
  an ADR row in `docs/TECHNICAL_DECISIONS.md` in the same commit. Supersede, never delete.
- **R-43** No `TODO`/`FIXME` in `docs/`. A design doc records decisions; open questions go in
  `TECHNICAL_DECISIONS.md` §4 with an owner and a deadline.
- **R-44** Design docs are updated when code makes them false. A stale doc is a bug with the same
  severity as a failing test.

## 4. Coding standards

- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `verbatimModuleSyntax`.
- No `any` in `src/sim/**`; `unknown` + narrowing at boundaries.
- No default exports (worker entrypoints excepted). No barrel files inside `sim/`.
- Rules are pure functions: `(state, inputs) → out`, side effects only through explicit stores.
- Names carry units: `day`, `msPerDay`, `foodUnits`, `pop`, `perMille`. A bare `value`/`data`/`temp` is a
  review rejection in simulation code.
- Comments explain **why**; the code explains what. No commented-out code.
- Files: soft limit 300 lines, hard limit 500. A 700-line "systems" file is a design failure.
- Commit style: `type(scope): summary` (`feat`, `fix`, `perf`, `docs`, `test`, `chore`, `ci`).
- Never commit build output, APKs, keystores, `.env*`, or anything in `.gitignore`.

## 5. Using the installed skills

- Skills live in `.opencode/skills/` (vendored, Apache-2.0 — **never edit them**).
- Installed: `gamedev-router`, `pixijs-rendering`, `procedural-gen`, `game-ai`,
  `ai-behavior-trees-utility-ai`, `save-systems`, `performance-optimization`, `game-ui-ux`,
  `camera-systems`, `input-systems`, `create-game-assets`, `game-docs`.
- Load only the 1–2 relevant to the current task. Do not bulk-load. See `docs/SKILL_USAGE.md` §5.
- If a skill's advice conflicts with `docs/TECHNICAL_DECISIONS.md`, the decision wins until formally
  superseded.

## 6. Workflow for any task

1. Read `docs/README.md` → the 1–2 documents that own the area you will touch → the relevant skill.
2. Check `git status`; never discard uncommitted work that is not yours.
3. Confirm the task exists in the current stage's scope. If it does not, say so before coding.
4. Implement the smallest change that satisfies the acceptance criterion.
5. Add or update the tests that prove it (unit / invariant / determinism / e2e, as appropriate).
6. Update the docs the change makes stale, and add an ADR row if the change is a decision.
7. Push and **read the workflow result**. Report the run URL, or report that you could not.
8. If you cut or skipped anything, say it in the report — explicitly, in one line.

## 7. What "done" looks like for a change

- Behaviour is exercised by an automated test that would fail without the change.
- Determinism and conservation still hold (or the change explains why not).
- No budget regressed without a documented measurement.
- Saves still load, and existing worlds are not invalidated.
- The relevant doc no longer lies.
- CI is green, with a link.

## 8. Anti-patterns (seen in almost every AI-generated game)

| Anti-pattern | Why it is banned here |
|---|---|
| "Let's add a feature while we're here" | scope death; see R-37/R-38 |
| Fake gameplay with no simulation behind it | violates the product's entire premise |
| Toasts/notifications for everything | history belongs in the chronicle, not in the player's face |
| Dead code paths, stubbed "just in case" abstractions | review rejection |
| Per-frame `new Vector2()`, `[]`, `.map()`, template strings | GC hitches on a mid-range phone |
| Storing floats in saves | drift, untestable conservation |
| `Math.random()` anywhere near world state | destroys reproducibility |
| Claiming a benchmark without running it | the fastest way to lose the project's credibility |
| Adding a dependency to avoid 200 lines of code | supply chain + size + a second determinism surface |
| Rewriting a shipped generator in place | silently changes every existing world |

## 9. Environment notes

- The development machine is weak (≈2 vCPU / 2 GB RAM) and may have **no Node.js installed**. Do not
  assume `npm` works locally; use CI for builds and tests.
- Do not install global tooling, change the user's shell configuration, or add system packages without
  being asked.
- The machine also hosts unrelated production services (a Marzban panel, two Telegram bots). **Never**
  stop, restart, reconfigure or write into anything outside this project directory.
- Git identity for this repository is set locally (`khiyarusa`); do not change global git config.

## 10. Current next action

Stage 5 is implemented and its software gates are evidenced in `docs/STAGE_5_REPORT.md`. The final
stage remains **device-pending and release-pending**:

1. Install the CI APK/AAB on a Galaxy A23 and run the device protocol in
   `docs/PERFORMANCE_BUDGET.md` §11: startup, 50-year 8× run, year-200 save/load, every layer/panel by
   touch, Persian/English, 200 % text, landscape, background/resume, 15-minute thermal run.
2. Record the real captures and timings in the Stage 5 report §9. Do not mark S5-A1/A2/A5 or release
   signing as passed before that.
3. Sign and package the release AAB; no cloud accounts or telemetry.

The Stage 5 contract that a future change must not silently break:

- **settlements founded after load reach the renderer.** `settlementMeta` carries live layout, civs
  and capitals; the HUD/map/labels update without re-baking terrain (D-60).
- **the political query is exact and bounded.** 18-tile nearest-settlement projection with a
  deterministic bucket grid; `tests/worker/layers.test.ts` compares it byte-for-byte with the
  reference (D-61).
- **selection is not a per-frame Graphics rebuild.** Redraw only on selection/zoom change; pulse is
  alpha-only and disabled by reduced motion/low power (D-62).
- **schema 4 and the four shards are unchanged.** Stage 5 UI preferences and onboarding live in
  `localStorage`; no world field was added (D-63).
- **terrain is one deterministic 896 px bake** from the real grids; no per-tick/per-frame terrain
  work (D-64).
- **Persian RTL is the default interface**, English is complete, and text scaling uses
  `--text-scale`; settings are real, not a translation-only switch (D-55/D-65).

The Stage 3/4 contract also remains: cohorts are the only population representation (D-42); four
shards with society inside `meta` (D-44); war gate four values (D-47); severe events have a cause or
`-1`; player causes use `-2`; camera cannot affect history; `captureWorld()` has no `await`; recovery
repoints and deletes the damaged generation; marker geometry is unit-tested.

Invariants established by the hardening pass — do not "simplify" them away:

- `captureWorld()` contains no `await`; a save is one synchronous snapshot (D-37).
- A generation is valid only with the complete shard set (D-36), and recovery repoints and deletes the
  damaged generation (D-38).
- The RNG streams are captured where generation left them (D-33); the golden fixture pins grid content,
  not the checksum (D-34).
- Marker geometry lives in `render/markerGeometry.ts` and is unit-tested (D-39).
