# TECHNICAL DECISIONS — World Simulator

ADR-style record of the choices that shape Stages 2–5. Each entry: decision, alternatives,
justification, trade-off, risk, status. Sources were checked on **2026-11-25**; anything not verified
is listed in §3 as an explicit assumption, not a fact.

Status values: **Accepted** (binding for the roadmap), **Provisional** (accepted but re-checked at a
named stage), **Deferred** (deliberately not now).

---

## 1. Decisions

### D-01 — TypeScript 7 for type checking

- **Decision:** `typescript@^7.0.2`, `tsc --noEmit` as the type gate, strict flags on.
- **Alternatives:** TypeScript 6.0.3 (JS compiler); plain JS + JSDoc.
- **Why:** 7.0 is the current stable (`latest` on npm, and the native Go compiler: 8–12× faster full
  builds, ~15 % less peak memory per the release post). On a machine where CI is the only build host,
  a 10× faster type check is a real budget line, not a micro-optimisation.
- **Trade-off / risk:** TypeScript 7 ships **no programmatic API** until 7.1, so tools that import
  `typescript` (notably `typescript-eslint`) must use the TS 6 API. Mitigation: keep
  `typescript` at 7 for `tsc`; if type-aware lint rules are wanted, install
  `typescript` as an npm alias to `@typescript/typescript6` and add `@typescript/native` as the alias
  for the 7 binary — exactly the side-by-side path Microsoft documents. If that combination fights the
  toolchain, fall back to `typescript@6.0.3` project-wide (a one-line change) rather than shipping a
  broken lint.
- **Status:** Accepted (Provisional on the eslint combination — verify in Stage 2's first commit).

### D-02 — Vite 8 build/dev server

- **Decision:** `vite@^8.3.8`.
- **Alternatives:** Rollup + custom config; Parcel; esbuild alone.
- **Why:** first-class worker handling (`new Worker(new URL(...), {type:'module'})`), asset pipeline,
  near-instant cold start on weak hardware, and Vitest shares the transform. Node requirement
  (`^20.19 || >=22.12`) is satisfied by Node 24 LTS.
- **Trade-off:** top-level `await` in the entry has historically broken production builds
  (documented for Vite ≤ 6.0.6); the boot path is written as `async function boot()` regardless, which
  is safe on every version.
- **Status:** Accepted.

### D-03 — PixiJS 8.23 as the renderer only

- **Decision:** `pixi.js@^8.23.0`, WebGL backend (no WebGPU preference), used strictly as a drawing
  layer. No game state in PixiJS objects.
- **Alternatives:** Phaser 4 (brings scenes/physics/input we do not want), three.js (3D cost), raw
  WebGL (months of work), canvas 2D (fill-rate bound at 1080p).
- **Why:** fastest path to batched 2D sprites with a small API, render groups for the static world, and
  a well-documented v8 lifecycle (`await app.init()`). The skill baseline is 8.22.0; npm `latest` is
  8.23.0 and the v8 API used here is unchanged.
- **Trade-off:** PixiJS has no tilemap, no camera, no input mapping — all of that is our code
  (estimated ~1,200 LOC in `render/`). That is the price of not adopting a framework whose scene graph
  we would have to fight.
- **Status:** Accepted.

### D-04 — Capacitor 8.6 for the Android shell

- **Decision:** `@capacitor/{cli,core,android}@^8.6.2`, `minSdk 24`, `compileSdk 36`, `targetSdk 36`,
  AGP 8.13, JDK 21, portrait-locked by manifest with a landscape layout supported.
- **Alternatives:** Cordova (aging plugin model), Tauri (desktop-first; Android via Rust webview is a
  different toolchain), raw Android Activity + WebView (we would reimplement the plugin bridge), a
  fully native Android app (contradicts the TS/PixiJS stack).
- **Why:** verified current stable major (8.6.2, published 2026-11-16). Capacitor 8 requires Node ≥ 22,
  Android Studio 2025.2.1+, API 24+, and pins `targetSdk 36` — all documented. The native project is
  plain Gradle we own, which matters because CI must build it without Android Studio.
- **Trade-off:** the app is a WebView, so we inherit its timer throttling, storage eviction policy and
  GPU path. Mitigated by the offline-first design, `persist()`, and the export path.
- **Status:** Accepted.

### D-05 — Simulation in a single dedicated Web Worker

- **Decision:** one long-lived worker owns the simulation; the main thread owns rendering, UI and I/O.
- **Alternatives:** main-thread simulation; multiple workers per subsystem; WebAssembly core now.
- **Why:** a 3 ms tick and an 8 ms frame in the same 33 ms budget would make frame jitter *be* history
  jitter. Isolation also enforces the architecture rule mechanically: the sim cannot touch the DOM
  because it does not have one.
- **Trade-off:** every state read crosses a message boundary, so the protocol must be small (it is:
  ≤ 4.8 KB per delta). No synchronous debugging of sim state from the console — mitigated by a
  `?debug=1` bridge and a `--headless` Node harness that runs the same code.
- **Status:** Accepted.

### D-06 — No SharedArrayBuffer

- **Decision:** transferable `ArrayBuffer`s only; no SAB, no `Atomics`, no cross-origin-isolation
  dependency.
- **Alternatives:** SAB + COOP/COEP for zero-copy shared state.
- **Why:** SAB requires cross-origin isolation headers. In Capacitor the app is served from the local
  `https://localhost` origin by the native WebView asset loader, where we do not control response
  headers without injecting a custom `WebViewClient` — an extra native surface that can break on OEM
  WebView updates. The measured benefit for a 4 KB delta at 4 Hz is negligible.
- **Trade-off:** saves and snapshots copy ~1 MB occasionally. Acceptable (a save is a once-per-season
  event, budgeted at ≤ 12 ms per shard).
- **Status:** Accepted.

### D-07 — World sizes and entity caps

- **Decision:** 128² / 192² / 256² tiles; caps of 200 settlements, 12 civs, 60 characters, 400 routes, 20k
  events.
- **Alternatives:** 512²+ worlds; unbounded settlements.
- **Why:** arithmetic, not taste: 256² × 14 B/cell ≈ 896 KB of terrain, which fits **one** 2048²
  texture at ~10 px/tile, which makes the static world **2 draw calls**. Every step above that forces
  chunked streaming, texture atlases per region, and a save-sharding redesign — for content the player
  cannot hold in mind.
- **Trade-off:** the world is a region, not a planet. Accepted: the fantasy is "a world that lives",
  not "a globe".
- **Status:** Accepted. Revisit only if the Stage 5 stress test shows headroom *and* playtests show
  players exhausting the map.

### D-08 — Integer fixed-point economy

- **Decision:** all stocks/rates are integers (1 unit = 1 person-day of food; per-mille rates).
- **Alternatives:** floats with epsilon comparisons.
- **Why:** 400 years × 360 days = 144,000 accumulation steps. Float drift makes saves non-exact,
  conservation invariants untestable, and "same seed ⇒ same world" fragile across engines. Integers make
  INV-1/INV-2 exact and the save byte-comparable.
- **Trade-off:** multiplication must respect a fixed scale (all products go through `mulPerMille`) and
  overflow checks exist in dev builds. Slightly more verbose code.
- **Status:** Accepted.

### D-09 — Utility AI, FSM where transitions are few, no GOAP, no runtime LLM

- **Decision:** utility scoring for settlement/civ/character decisions; FSMs for war phases and crisis
  modes; behavior trees explicitly not used in P0.
- **Alternatives:** behavior trees everywhere; GOAP; rule tables; an LLM per civilization.
- **Why:** the problem is *graded trade-offs over continuous variables*, which is exactly utility AI's
  shape, and utility scoring is explainable — the decision record plus the top-3 scores answers "why
  did they do that?" for free. GOAP produces emergent plans that are hard to debug and unnecessary when
  decisions are single-step. BT adds a runtime and a lifecycle contract for behaviour we do not have.
  An LLM cannot be used: runtime cost, latency, non-determinism, offline requirement, and no API
  dependency is a hard product constraint.
- **Trade-off:** utility can produce bland, similar civilizations if the weights converge. Mitigated by
  culture-weighted consideration curves + hysteresis + seeded tie-breaks, and validated by the 20-seed
  narrative harness.
- **Status:** Accepted.

### D-10 — Cohort aggregation, not individual citizens

- **Decision:** population = 8 cohorts per settlement; no per-person entities. ≤ 60 notable characters
  exist for narrative purposes only.
- **Alternatives:** individual agents with needs/goals; hybrid where near agents are individuals.
- **Why:** a 200-settlement world at 200 people each is 40,000 agents — at even 1 µs each per day-tick
  that is 40 ms/tick, 100× over budget, and it buys no decision the player can perceive at map scale. The
  cohort model produces the same *systemic* behaviour (growth, shortage, migration, specialization) at
  1/1000th the cost.
- **Trade-off:** no individual stories, no "follow this person". Compensated by named characters +
  chronicle. If a future version wants person-scale stories, characters are the extension point, not
  cohorts.
- **Status:** Accepted.

### D-11 — Abstract operational war, no tactical battles

- **Decision:** monthly front resolution per border region with strength/attrition/occupation/war score.
- **Alternatives:** tile-level unit combat; RTS-style control; Total-War-style battles.
- **Why:** tactical combat is a second game with its own rendering, AI, input and balance budget, and it
  would consume the whole five-stage plan. The design's promise is *consequences*, not battles: war must
  move borders, kill people, burn food, create refugees and rewrite relations — and the abstract model
  does all of that in ~150 lines.
- **Trade-off:** no battle spectacle. Mitigated visually by front lines, ruined settlements, refugee
  surges and event text.
- **Status:** Accepted.

### D-12 — Top-down 2D projection

- **Decision:** orthographic top-down, north up, baked relief shading; no isometric, no tilt.
- **Alternatives:** isometric 2D; 2.5D with dynamic lighting; 3D.
- **Why:** the game's interface is six information layers over a grid. Top-down maps 1:1 to that grid;
  isometric doubles geometry and makes borders/overlays ambiguous; 3D multiplies GPU cost on an Adreno
  610. Full reasoning in `UX_AND_VISUAL_DIRECTION.md` §1.
- **Trade-off:** less "premium 3D" screenshot appeal. Offset by art direction (living atlas) and baked
  relief, which reads as depth at zero runtime cost.
- **Status:** Accepted.

### D-13 — Bake the terrain, do not draw tiles

- **Decision:** the world is one 2048² RenderTexture (+ one detail bake); settlements are pooled sprites.
- **Alternatives:** tile sprites; per-chunk meshes; vector terrain.
- **Why:** 36,864–65,536 tiles cannot be individual display objects on a mid-range GPU; baking collapses
  the static world to ~2 draw calls and turns zoom into a texture swap. Detail is re-baked only where the
  camera is, in ≤ 4 chunks/frame.
- **Trade-off:** terrain edits (blight/fertilize) require a partial re-bake (budgeted, small region).
  Accepted; those are rare, deliberate player actions.
- **Status:** Accepted.

### D-14 — IndexedDB with a minimal in-house wrapper

- **Decision:** IndexedDB; ~200 LOC wrapper in `platform/storage.ts`; no Dexie, no `idb`.
- **Alternatives:** Dexie (schema/query sugar), `idb` (promise wrapper), localStorage (5 MB cap, sync,
  strings only), OPFS (files, but awkward for transactional multi-record updates and less predictable
  in older WebViews).
- **Why:** we need exactly three stores, explicit transactions and binary payloads. Dexie's value
  (queries, live queries, schema helpers) is unused; each dependency is 20–30 KB and another supply-chain
  surface in an offline game.
- **Trade-off:** we own ~200 lines and their tests. That is smaller than integrating and learning a
  library whose abstractions we would bypass.
- **Status:** Accepted.

### D-15 — Own PRNG and own noise

- **Decision:** xoshiro128** with named streams, 32-bit integer hashing, integer gradient noise.
- **Alternatives:** `seedrandom`, `simplex-noise`, `alea`.
- **Why:** determinism is a product guarantee. Third-party PRNGs do not promise sequence stability across
  versions, and popular noise libraries use `Math.sin`-derived gradients or float tables whose
  cross-engine results are not guaranteed. Owning ~200 lines of integer math is cheaper than owning a
  cross-version reproducibility bug.
- **Trade-off:** we implement and test our own noise (and pin its outputs in tests). Accepted.
- **Status:** Accepted.

### D-16 — DOM/CSS UI, not PixiJS UI and not a framework

- **Decision:** panels/HUD are DOM elements layered above the canvas; a ~200-line reactive store; no
  React/Vue/Svelte.
- **Alternatives:** PixiJS `Text`/`Graphics` UI; React; Svelte.
- **Why:** DOM gives real text layout, accessibility, `safe-area` insets, and free rendering when hidden.
  A six-panel game does not need a component framework, and every framework adds 40–150 KB plus a
  renderer to a boot path that must finish in ≤ 6 s on a weak phone.
- **Trade-off:** we write explicit show/hide and content-binding code. Bounded, and testable with
  Playwright DOM assertions.
- **Status:** Accepted.

### D-17 — Vitest + Playwright

- **Decision:** Vitest 5.1 for unit/integration (Node + jsdom where needed); Playwright 1.65 for E2E.
- **Alternatives:** Jest (slower, separate transform), node:test (fine but weaker DX/mocking), Cypress
  (heavier, weaker multi-tab/mobile emulation).
- **Why:** Vitest reuses the Vite pipeline (one transform config, one dependency tree) and Playwright is
  the only reliable way to drive Chromium with touch emulation in CI.
- **Trade-off:** Vitest 5 requires Node 22.12+/24+ — satisfied by the pinned Node 24.
- **Status:** Accepted.

### D-18 — GitHub Actions only; no emulator

- **Decision:** all automated work on `ubuntu-latest` (4 vCPU/16 GB for public repos); Android via
  Gradle in CI; no emulator/instrumentation jobs.
- **Alternatives:** local builds (impossible: 2 GB RAM, no Node), self-hosted runner (maintenance),
  emulator tests (slow, flaky, unrepresentative WebView).
- **Why:** the dev machine cannot build; public-repo runners are free and strong enough for an 8–12
  minute Gradle build.
- **Trade-off:** feedback latency (minutes, not seconds) and reliance on GitHub availability. Mitigated
  by fast local checks that need no toolchain (docs, static analysis by review) and by keeping the
  type-check/build in one job so failures surface early.
- **Status:** Accepted.

### D-19 — Generator versioning with a frozen v1 path

- **Decision:** `generatorVersion` in the recipe; `generateV1()` frozen after Stage 2; new behaviour ships
  as v2.
- **Alternatives:** always regenerate with current code; store no version.
- **Why:** otherwise every noise tweak silently changes every existing world, and "same seed, same world"
  becomes a lie across app updates.
- **Trade-off:** a small amount of permanently carried code (~400 LOC per version). Cheap insurance.
- **Status:** Accepted.

### D-20 — Chunking limited to rendering and save shards

- **Decision:** no world streaming, no chunked simulation, no chunk loading/unloading.
- **Alternatives:** open-world chunk streaming.
- **Why:** the entire world fits in ~1 MB of RAM and one texture. Streaming would add residency logic,
  seam handling, and a whole class of bugs, to save nothing.
- **Trade-off:** world size is bounded by the texture/array budget rather than by disk. Accepted (D-07).
- **Status:** Accepted.

### D-21 — Bounded catch-up on resume

- **Decision:** on load, simulate at most `min(daysAway × 7, 30)` days, budgeted, then stop.
- **Alternatives:** simulate all elapsed real time (unbounded work, exploitable), nothing (world feels
  frozen), wall-clock-scaled fake progress (dishonest).
- **Why:** returning players want change, not a 40-second loading bar, and the simulation must never be
  allowed to do unbounded work on a phone.
- **Trade-off:** a month away advances the world by 30 days, not 30 weeks. Documented in-game ("the world
  waited for you").
- **Status:** Accepted.

### D-22 — One worker, one scheduler, fixed 1-day tick

- **Decision:** the tick is a day; speed scales the accumulator (not the step).
- **Alternatives:** variable dt; sub-day ticks for "real-time" combat; frame-coupled ticking.
- **Why:** fixed steps are the only way to keep the integer economy, determinism and history coherent.
  Variable dt would make the same seed produce different worlds on a slow phone.
- **Trade-off:** at 8× we run 20 ticks/s; that is the performance cliff the budget is built around.
- **Status:** Accepted.

---

## 2. Alternatives considered at the stack level (and rejected)

| Option | Why it was rejected |
|---|---|
| Unity / Godot / Unreal | Contradicts the mandated stack; huge APK, editor-centric workflow, impossible to build on this machine or in a lightweight CI. |
| Flutter / native Kotlin | Would mean rewriting the simulation and renderer in another language; no benefit for a canvas-heavy simulation with a text UI. |
| Phaser 4 | Brings scenes, physics, input and a larger runtime; we would use 20 % of it and fight the rest. |
| React + PixiJS | Adds a renderer for a six-panel UI; increases boot time and bundle size. |
| SQLite (WASM) for saves | Larger payload, a WASM compile step, and IDB already gives transactions + binary; unnecessary at ≤ 2 MB saves. |
| WebAssembly simulation | 2–4× speedup potential for a sim that already fits budget; adds toolchain and a second determinism surface. Deferred (P2) until profiling demands it. |

---

## 3. Verified facts vs assumptions (honesty register)

### 3.1 Verified on 2026-11-25

| Fact | Source |
|---|---|
| `pixi.js` latest = **8.23.0** | npm registry `dist-tags` |
| `@capacitor/core` + `/android` + `/cli` latest = **8.6.2** | npm registry |
| `vite` latest = **8.3.8**; engines `^20.19 || >=22.12` | npm registry |
| `typescript` latest = **7.0.2** (7.1 in dev); `6.0.3` is the last 6.x | npm registry |
| `vitest` latest = **5.1.1**; engines `^22.12 || ^24 || >=26`; peers vite 6/7/8 | npm registry |
| `@playwright/test` latest = **1.65.1** | npm registry |
| Node LTS lines: **v24.22.3 (Krypton)**, **v26.13.1 (Lithium)** | nodejs.org `dist/index.json` |
| Capacitor 8 requires **Node ≥ 22** | capacitorjs.com/docs/getting-started/environment-setup |
| Capacitor 8: **API 24+**, Android Studio **2025.2.1+**, Android 16 (API 36) latest stable | capacitorjs.com/docs/android |
| Capacitor 8 pins **targetSdk 36**, `compileSdk 36`, `minSdk 24`, **AGP 8.13.0** | capacitorjs.com/docs/android/setting-target-sdk, /updating/8-0 |
| PixiJS 8 boot is `await app.init()`, `Assets`, renderer order webgl→webgpu→canvas | pixijs.com/8.x/guides/getting-started/quick-start, /concepts/performance-tips |
| PixiJS perf guidance: group object types, avoid filters/masks, cull manually, `antialias:false` helps older mobile | pixijs.com/8.x/guides/concepts/performance-tips |
| Chrome/Chromium origin quota ≈ **60 % of disk**; default storage is **best-effort**; `navigator.storage.persist()` opts out of LRU eviction | MDN Storage quotas and eviction criteria |
| GitHub-hosted `ubuntu-latest` for **public** repos = **4 vCPU / 16 GB / 14 GB SSD**, free & unlimited | docs.github.com/actions/reference/runners/github-hosted-runners |
| TypeScript 7 has **no programmatic API** until 7.1; `@typescript/typescript6` alias is the documented side-by-side path | devblogs.microsoft.com/typescript/announcing-typescript-7-0 |
| OpenCode discovers project skills at `.opencode/skills/<id>/SKILL.md`, ID = directory name | opencode.ai/docs/skills |
| gamedev skills repo: 79 skills + router, Apache-2.0, PixiJS baseline 8.22, checked 2026-11-11 | github.com/gamedev-skills/awesome-gamedev-agent-skills (commit `c6ca6c4`) |

### 3.2 Assumptions that must be resolved (tracked, not hidden)

| Id | Assumption | Why it matters | Resolve at |
|---|---|---|---|
| A-01 | Reference device is the **A23 4G / Snapdragon 680 / Adreno 610 / 4 GB** variant | every GPU budget | before Stage 5 sign-off — confirm exact model |
| A-02 | Android System WebView on the device supports `CompressionStream` and ES2020 | save compression, bundle target | Stage 2 device test |
| A-03 | `navigator.storage.persist()` returns granted (or is at least not actively evicted) in a Capacitor WebView | save durability | Stage 2 device test; if denied, promote export/import to P0 |
| A-04 | TS 7 + eslint(TS 6 API) coexistence works without friction | lint gate | first Stage 2 commit |
| A-05 | Vite 8 worker-module output works inside Capacitor's `https://localhost` asset loader | sim boots on device | Stage 2 device test (high risk, test early) |
| A-06 | PixiJS 8 WebGL path is reliable on Adreno 610 with a 2048² texture + ~200 sprites | frame budget | Stage 2 device capture |
| A-07 | 2× DPR full-screen quad is affordable on Adreno 610 | frame budget | Stage 2 device capture; fallback: DPR 1.5 |
| A-08 | The `android/` project generated by `cap add android` matches the documented AGP 8.13/SDK 36 matrix | CI Android build | Stage 2 first Android run |
| A-09 | Playwright + Chromium in CI renders WebGL well enough for a non-blank-canvas assertion (SwiftShader) | E2E gate | Stage 2 first E2E run; fallback: assert canvas size + no errors + DOM state only |

Each assumption has a named stage where it becomes either a verified fact or a design change. None is
allowed to remain unstated in a stage report.

---

## 4. Open risks that are not yet decisions

| # | Open question | Options | Decision needed by |
|---|---|---|---|
| O-1 | Is one worker enough at 8× when the player also opens the history panel? | keep one + budget; add a query worker | Stage 4 |
| O-2 | Does Tier-2 aggregation stay within the ±0.5 % equivalence band for all systems? | coarser/finer Tier-2 step; more frequent aggregation | Stage 3 |
| O-3 | Does the utility AI produce distinct civilizations, or convergent ones? | culture-weighted curves; more consideration diversity | Stage 3 (harness) |
| O-4 | Is 200 settlements enough content for 400 years, or does the map saturate by year 150? | founding limits; collapse pacing; larger world | Stage 3 (harness) |
| O-5 | Does the portrait layout hold at 320 dp width (small phones)? | compress arc; hide labels | Stage 4 |
| O-6 | Is `CompressionStream` fast enough on a Snapdragon 680 for a 1.2 MB save? | fflate fallback; smaller shards | Stage 2 |

---

## 5. Decision process rules

1. A decision that changes a persisted shape, a public protocol, a budget, or a stage scope gets an entry
   here in the same commit.
2. Superseded decisions stay in the file, marked `Superseded by D-xx`, with the reason. Deleting history
   is how projects relearn the same mistake.
3. "We will see" is not a decision; it goes in §4 with an owner and a deadline.
4. Any claim of a version number, API or policy must cite its source and date, or be labelled an
   assumption.

---

## 6. Stage 2 implementation decisions (added while building)

These were not knowable at design time. Each one resolves a real ambiguity or records a deviation
from the design text; the design documents named in each entry were corrected in the same commit.

### D-23 — Seed transport as two 32-bit words

- **Decision:** a seed is `{ lo, hi }` (`u32` each) everywhere on the wire, in memory and in a save
  (`seedText` is the fixed-width hex form `AAAAAAAA-BBBBBBBB`).
- **Why:** `WorldRecipe` was specified with `seed: bigint`, but `bigint` does not survive
  `JSON.stringify` and is not structured-cloneable in every position. Two words are exact, cheap and
  work in JSON, IndexedDB, `postMessage` and a URL.
- **Trade-off:** callers must format/parse; `core/seed.ts` is the only place that does, and its
  round-trip is unit-tested. The PRNG never sees the text form.

### D-24 — The scheduler is a worker timer; rendering uses `requestAnimationFrame`

- **Decision:** the simulation loop is a `setTimeout`-driven loop inside the worker
  (`src/worker/sim.worker.ts` + `src/worker/scheduler.ts`). The renderer's `requestAnimationFrame`
  (PixiJS ticker) never advances the simulation.
- **Why:** the architecture diagram in `TECHNICAL_ARCHITECTURE.md` §6 showed `rAF` on the main thread
  above the worker; that was a diagram shorthand and contradicted §6's own text ("the worker does not
  use rAF"). A display-linked clock would make history depend on the device's refresh rate and on
  whether the tab is visible — a direct violation of R-14.
- **Trade-off:** the worker must idle explicitly (it does: `clearSchedule()` while paused) and the
  main thread must not assume a tick per frame (it does not). Corrected in the architecture doc.

### D-25 — One IndexedDB transaction per save generation

- **Decision:** all shards plus the world metadata commit in a single `readwrite` transaction over
  `['worlds','shards']`; pruning of old generations happens afterwards in its own transaction.
- **Why:** `SAVE_AND_DATA_MODEL.md` requires atomicity; `PERFORMANCE_BUDGET.md` §5 said "one IDB
  transaction per shard", which would allow a partially written generation to become visible. The
  save document owns the format and wins (R-41); the perf document was corrected.
- **Trade-off:** a large save holds the transaction open for its whole duration (~10 ms for a Medium
  world). Acceptable; the worker has already produced every buffer before the transaction opens.

### D-26 — TypeScript 6.0.3, not 7.0

- **Decision:** the project compiles with `typescript@6.0.3`.
- **Why:** D-01 anticipated this: TypeScript 7 has no programmatic API until 7.1, and the lint gate
  uses `typescript-eslint`, which needs the compiler API. Option (a) — aliasing two compilers — adds a
  toolchain that must be proven before it can be trusted; option (b) — TS 6 — is one line and is
  explicitly sanctioned by D-01. The faster `tsc` is worth revisiting at 7.1.
- **Trade-off:** slower type checks than TS 7. The CI job still finishes the full verify in a few
  minutes, which is what matters here.

### D-27 — No `ui/panels.ts` and no reactive store

- **Decision:** the UI is `ui/shell.ts` (DOM + events), `ui/labels.ts` (map labels), `ui/format.ts`
  (presentation). There is no `store.ts` and no panel framework.
- **Why:** `TECHNICAL_ARCHITECTURE.md` listed a ~200-line reactive store as an example. With two live
  values (day, speed) and one selection, a store would be indirection without a consumer. The shell
  owns its DOM and receives explicit calls. R-8/R-7 favour fewer moving parts.
- **Trade-off:** if Stage 4 grows six panels with shared state, a store may earn its place then. It is
  a P1 refactor, not a P0.

### D-28 — Terrain is structured-cloned once; deltas are transferred

- **Decision:** the world's terrain grids travel to the main thread as a structured clone in one
  `terrain` message per world; the per-delta mirror buffers are transferred and recycled.
- **Why:** transferring terrain would detach the worker's authoritative arrays. The clone is ~0.5 MB
  once per world load — irrelevant — while the 4 Hz delta path must stay allocation-free.
- **Trade-off:** peak memory doubles for the grids during the message (then the worker's copy is the
  only one the simulation owns). Bounded and measured.

### D-29 — Preview generates a real Small world on demand

- **Decision:** the creation screen's preview runs `generateV1` with `preset: 'small'` in the worker
  when the player taps Preview, and discards the result. Tokens discard stale responses.
- **Why:** a preview from a fake thumbnail would violate the product's first rule. Regenerating on
  every slider change would block the worker; an explicit button plus a token is honest and cheap.
- **Trade-off:** the preview is Small even when Medium is selected. Stated in the UI copy.

### D-30 — Save v1 has four shards, not eight

- **Decision:** `meta`, `terrain`, `settlements`, `civs`.
- **Why:** events, history, characters and routes do not exist until Stage 3. Writing empty shards
  would be fake data (AGENTS.md §8). The shard *scheme* is unchanged, so Stage 3 adds shards rather
  than restructuring the save — with a schema bump, as R-23 requires.
- **Trade-off:** a Stage 3 save adds ~700 KB of new shards; the budget already accounts for them.

### D-31 — The zoom floor is the fit zoom

- **Decision:** minimum zoom = `min(0.25, fitZoom)`.
- **Why:** the design's 0.25 floor cannot show a 6144 px-wide world on a 390 px screen. Locking 0.25
  would leave the player unable to see the world they generated. The floor still prevents zooming out
  into empty space.
- **Trade-off:** "0.25×" in the UX document is a nominal floor; the real floor is device- and
  world-size-dependent. Corrected in the UX doc.
