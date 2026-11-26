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

---

## 7. Stage 2.1 hardening decisions

These were forced by defects found in the Stage 2 code (see `docs/STAGE_2_1_HARDENING.md`). Each one
names the invariant it protects, because the next agent will be tempted to "simplify" them back.

### D-32 — Preset identity is numeric, never a string property

- **Decision:** `PRESET_IDS = { small: 1, medium: 2, large: 3 }`; recipe hashing uses these ids and a
  domain tag, in a frozen field order.
- **Why:** the previous hash used `preset.length`, and `"small"`/`"large"` both have five characters, so
  two presets shared one identity. A hash derived from a display string is a latent collision by
  construction.
- **Trade-off:** preset ids are now part of the persisted identity and must never be renumbered; adding a
  preset means adding an id, not reordering the map.

### D-33 — RNG state is captured where generation leaves it

- **Decision:** after generation, the TERRAIN and SPAWN streams store their current state; all other
  streams keep their seeded state because nothing consumed them.
- **Why:** storing freshly seeded states meant a load restarted consumed streams, so a resumed world
  diverged from an uninterrupted one. No visible difference existed in Stage 2 only because no tick
  system draws random numbers yet.
- **Trade-off:** generation now must expose the streams it used. Any future generator stage must add its
  stream to the capture list, or the invariant silently degrades — that is why the continuation test
  compares 32 future draws, not just the stored words.

### D-34 — Checksum contract v2, decoupled from the golden fixture

- **Decision:** `worldChecksum` covers recipe identity, all RNG state, settlement `foundedDay` and the
  counters, under a domain tag (`CSM2`). The golden fixture pins **grid content** (`gridsChecksum`) and
  land fraction, not `worldChecksum`.
- **Why:** (a) the checksum could not detect corruption in exactly the fields continuation depends on;
  (b) using one hash for both purposes means every integrity improvement looks like a world-content
  change, which trains reviewers to regenerate fixtures — the opposite of a regression test.
- **Trade-off:** two hashes to reason about, each with one job and one test.

### D-35 — Hydrology is validated against the contract it implements

- **Decision:** `auditHydrology()` proves: direction 0–8; strict descent on the filled surface; every
  river terminating within N steps; every sink a local minimum; and it reports how rivers actually end
  (sea / lake / sink).
- **Why:** "river cells are on land" is true of a river drawn anywhere. On a filled surface a flat
  plateau legitimately has no downhill neighbour, so "river must reach the sea" is not the true
  contract; "water stops only where it cannot fall" is.
- **Trade-off:** the audit is O(n) and runs in tests and tooling, not in the load path; a `hydro` tool
  mode reports measured terminal counts in CI so the claim is evidence, not assertion.

### D-36 — A generation is valid only with the complete shard set

- **Decision:** `core/saveSchema.ts` owns `SHARD_NAMES`; `verifyGeneration` rejects missing, duplicate,
  empty and wrong-length shards before any parse; the decoder re-checks the same set and exact payload
  lengths.
- **Why:** CRC-validating the shards that happen to exist declared a missing-terrain generation
  "valid", which suppressed the fallback that would have saved the world.
- **Trade-off:** adding a shard in Stage 3 means updating one list, which is the desired coupling.

### D-37 — Save = synchronous capture, asynchronous compression

- **Decision:** `captureWorld()` copies every payload and computes the checksum synchronously between
  ticks; `encodeSnapshot()` compresses the frozen bytes. No `await` may appear in the capture.
- **Why:** the encoder awaited between shards, so a tick could run mid-save and produce a file whose
  terrain and metadata were different days, with a checksum of a third state — all individually
  CRC-valid.
- **Trade-off:** a save briefly holds a second copy of the world (~0.5 MB at Medium), and the worker is
  busy for the duration of the copy. Both are bounded and far cheaper than an inconsistent save.

### D-38 — Recovery repoints and deletes, it does not "skip"

- **Decision:** after falling back to an older generation, `resetToGeneration()` updates the metadata to
  that generation, zeroes `prevGen`, and deletes every other generation in one transaction.
- **Why:** leaving the damaged generation on disk meant the next save recorded it as `prevGen`, promoting
  corruption to the only backup.
- **Trade-off:** the damaged generation is not kept for forensics. A future "export damaged save" can
  copy it before deletion; correctness of the next save comes first.

### D-39 — Marker geometry applies the camera zoom exactly once

- **Decision:** `src/render/markerGeometry.ts`: screen size = `64 · scale · zoom`, so
  `scale = px / (64 · zoom)`. The module is Pixi-free and unit-tested.
- **Why:** the previous formula also divided by `TILE_PX`, applying the tile constant twice and rendering
  every marker at ~0.5 px. Visual inspection at one zoom level would not have caught it; the maths does.
- **Trade-off:** marker size is deliberately screen-constant, so markers do not grow when zooming in.
  That is the intended cartographic behaviour (a symbol, not a building).

### D-40 — A gesture is either a tap or a pinch, never both

- **Decision:** any second pointer marks the gesture as a pinch, invalidates accumulated movement, and
  suppresses the tap path for the whole gesture.
- **Why:** pinch with little travel ended in a click that selected an arbitrary settlement.
- **Trade-off:** a deliberate two-finger tap does nothing. Acceptable: nothing in the UI requires it.

### D-41 — Full settlement fidelity at the Stage 3 cap; the camera cannot reach a rule

- **Decision:** all 200 settlements run the complete pipeline every tick. Detail tiers are derived
  metadata for rendering only and are never persisted. `tests/determinism/lod.test.ts` runs the same
  seed twice, moving and zooming a `Camera` on one copy every three days, and requires an identical
  checksum, population and event stream.
- **Why:** the hard product invariant is "moving the camera never changes history". Any aggregation that
  changed cadence with the view would make history depend on where the player looked.
- **Trade-off:** no cadence saving at the cap. Measured p95 is 0.03–0.11 ms per tick at 200 settlements
  on the CI runner, far inside the 3 ms budget; cadence-LOD remains deferred with a measured trigger.

### D-42 — Cohorts are the only authoritative population

- **Decision:** `Σ cohorts` is the population. `settlements.pop` is written once per tick by
  `syncPopulation()` as a projection, and every mirror/query/save-metadata consumer reads the projection,
  while simulation rules read the cohorts directly. `auditSociety()` asserts both agree every month.
- **Why:** two writable representations diverged: the map showed a population the rules had not changed.
- **Trade-off:** one full pass over settlements per tick (200 × 8 adds) to keep the legacy array honest.

### D-43 — Founding transfers people and stores; it never creates them

- **Decision:** a daughter settlement receives 35 % of the parent's adults (cap 350) and the same share
  of its food, cohort-by-cohort and unit-by-unit. `Σ population` is unchanged by founding.
- **Why:** population creation by founding would break the conservation identity and the audit.
- **Trade-off:** a settlement cannot found while it is starving; the safety valve requires 10 days of
  reserve, so collapse happens before fragmentation in a true famine.

### D-44 — The society block lives inside the `meta` shard

- **Decision:** the four-shard set (`meta`, `terrain`, `settlements`, `civs`) is unchanged; the society
  JSON travels inside `meta`. `SHARD_NAMES` does not gain a `society` shard.
- **Why:** the Stage 2.1 completeness/recovery rules and every historical v1/v2 save remain valid, and a
  fifth shard would have required a version-aware manifest for no measured benefit.
- **Trade-off:** the meta shard is large (≈1 MB raw at year 200) and is compressed as a unit; that is
  within the S3-A7 budget and measured by the harness.

### D-45 — Schema v3, with a real 2→3 migration

- **Decision:** `SAVE_SCHEMA_VERSION = 3`. The codec (`v: 3`) adds routes, treaties, wars, military,
  prices, research progress, occupation/immunity markers, the vital ring and per-settlement history days.
  A v2 block decodes by expanding its used-civ-corner matrices into the fixed 12-civ stride and filling
  the new structures as empty; a v3 block missing any structure is `SAVE_CORRUPT`.
- **Why:** the complete Stage 3 state must survive a reload; silently defaulting a missing v3 structure
  is indistinguishable from loading a different world.
- **Trade-off:** v2 and v3 both need tests. `tests/society/systems.test.ts` builds a genuine v2 payload
  from the current encoder and proves the expansion, and rejects a v3 block with a deleted field.

### D-46 — Vital-event ring and the retention contract

- **Decision:** the main ring holds 14,000 events; a second ring holds 4,096 severity-4/5 events with the
  same stable ids. A notable event cited as a cause (a drought) is copied into the vital ring at citation
  time. Retention contract: the complete authoritative history is the event stream; a save preserves the
  most recent 14,000 events plus 4,096 severe events and their cited causes. The year-200 raw save stays
  under 1,200,000 bytes with this budget (measured max 1,172 KiB at 14.5k, trimmed once more for decimal-MB margin).
- **Why:** the main ring wraps within a 400-year run. Without a second ring, a war declaration's cause was
  evicted before the peace that cites it, and `causeId` 0 proved nothing.
- **Trade-off:** severe history older than the vital window is not preserved. The harness measures cause
  integrity over every event it observed, not only the retained tail.

### D-47 — The war gate uses a 30-day campaign reserve

- **Decision:** all four GDD conditions are enforced and persisted with every declaration: relative
  strength ≥ 1.25, grievance score ≥ 40, capacity (≥30 days of food, army ≥20, no active war, exhaustion
  <50), and a `declare_war` utility margin ≥50/1000. The 30-day figure is the operational interpretation
  of "surplus food for one year": the implemented economy stores 60 days at base and 105 with a granary,
  so a literal 360-day condition would make the gate unreachable. The strength/grievance/utility values
  are unchanged.
- **Why:** a gate that cannot pass is not a gate, and a gate weakened silently is worse. The threshold and
  its reason are recorded here and in the design doc; every declaration persists all four values.
- **Trade-off:** wars are rarer than a game-first design would choose. The harness sampled 23 real wars
  across 20 seeds, all reproducing the four values.

### D-48 — Founding is caused by arable crowding; land capacity has one owner

- **Decision:** `economy.landCapacity()` (`220 + 20 × fertility`) is used by both agriculture and the
  founding decision. A settlement founds when population reaches 70 % of that capacity, stability ≥45,
  food ≥10 days and a valid site exists.
- **Why:** a fixed population threshold either never fired (900, when the settlement starved first) or
  fired at a size unrelated to the land. Crowding is the mechanism the world actually has.
- **Trade-off:** settlements on poor land split early and stay small; that is the intended geography.

### D-49 — Treasury has one faucet and no free money

- **Decision:** the only coin faucet is the monthly head levy on real production
  (`pop × (600 + 4×stability)/1000`). Trade moves coin from buyer to seller, tribute moves it between
  treasuries, and construction/military upkeep destroy it. No flow creates coin without a source.
- **Why:** an inert treasury is a dead system; a treasury that grows by itself invalidates the economy.
- **Trade-off:** coin is an abstract claim on production, not a stored good; the report tracks collected
  tax, transfers and construction spending separately.

### D-50 — Measured performance keeps full fidelity affordable

- **Decision:** no ECS, no aggregation by camera, no extra runtime dependency. The measured 200-settlement
  full pipeline at steady 1× is p95 0.03–0.11 ms per day on the CI runner (budget 3 ms), with a year-200
  raw save of 0.9–1.2 MB and 59–124 ms encode. The two quadratic hotspots the harness found (route-pair
  scans and per-civ-pair border scans) were replaced with one bitmap and one settlement pass.
- **Why:** measure first; the initial full-system run was 6 minutes per pass because of those two loops.
- **Trade-off:** the harness itself is a CI job of several minutes; it is the price of evidence.

### D-51 — Schema 4 adds player state inside the existing `meta` block

- **Decision:** interventions (rows + cooldowns), the yearly world series, six settlement trend samples
  and four player counters are persisted inside the `meta` society block. The four-shard set is
  unchanged; `SAVE_SCHEMA_VERSION = 4`; a 3→4 document migration exists, and genuine v2/v3 blocks decode
  with the new rings empty. Checksum contract v6 covers every new value.
- **Why:** the Stage 2.1 recovery/completeness rules and Stage 3's four-shard identity are load-bearing.
  A fifth shard would invalidate old generation sets and add a new completeness failure mode for no
  player benefit.
- **Trade-off:** the meta block grows by ~9 KiB at year 200 (measured raw save 1,158 KiB at year 400,
  still under 1,200,000 B). A v4 save missing a ring is rejected as corrupt rather than silently reset.

### D-52 — Queries are typed projections; layers are not a second world model

- **Decision:** every panel and layer reads one of the `QueryWhat` projections in
  `src/worker/query*.ts`. There is no UI-side aggregate state and no layer-specific copy of the world.
  Political territory is derived as "nearest living settlement within 18 tiles" and the layer metadata
  says so; it is not presented as a separately simulated border.
- **Why:** Stage 3 closed with one authoritative state and a mirror. A second model would drift, and a
  decorative political layer would contradict ownership. The nearest-settlement projection is honest,
  cheap, and changes with real settlement ownership.
- **Trade-off:** sparse worlds show sparse territory (few settlements claim little land), and a border
  can move when a settlement dies; that is the real owner, not a cartographic embellishment.

### D-53 — Commands are worker-validated and report actual effects

- **Decision:** the four interventions are `player` commands. The worker validates live targets,
  resource/amount, intensity, duration, civ pair, war state and cooldown; applies the effect; appends a
  persisted row and an event with cause `-2`; returns `{ok, code, message, eventId, effects[]}`. The UI
  reports only that result.
- **Why:** a UI-side clamp is not a rule, and "success" before the worker confirms is a lie. Bless is an
  exogenous gift but hard-capped at 10 % of current + one year of use; the reported delta is the amount
  `addStock` actually accepted.
- **Trade-off:** a refused command still costs a round-trip and the UI must show the refusal; that is
  preferable to a button that pretends.

### D-54 — One query/command surface, bounded and failure-aware

- **Decision:** `queryResult` carries a discriminated `QueryResponse`; failed queries reject on the
  client. `commandResult` carries the structured intervention result. Lists are bounded (history 50,
  chronicle 40, settlements 40, layer events 100), and layer cells are freshly allocated and
  transferred.
- **Why:** the Stage 2 protocol returned `unknown` and `null`; a panel could not distinguish "missing
  entity" from "worker failed". Typed failures make the UI honest and testable.
- **Trade-off:** more types and a small amount of dispatch code; no runtime dependency added.

### D-55 — Persian RTL (Vazirmatn) is the default interface; English is complete

- **Decision:** the game ships Persian RTL as the default and English as a complete second language.
  All strings pass through `t()`; dictionaries live in `i18n.fa.ts`/`i18n.en.ts`. Layout uses logical
  CSS properties, numbers are isolated with `dir="ltr"` and proper nouns with `unicode-bidi: plaintext`.
  Language is stored locally; `?lang=en` exists for tests. Vazirmatn (three WOFF2 weights, 152 KB) is
  bundled under the SIL OFL with its licence.
- **Why:** the user's interface standard is Persian RTL, while the code and design docs are English.
  A cosmetic RTL toggle that breaks alignment would satisfy neither. This resolves the contradiction
  explicitly instead of leaving it implicit.
- **Trade-off:** two dictionaries to keep in sync and Persian text expansion to test on device; the
  tab strip wraps so all six panels remain reachable.

### D-56 — Layers refresh on change/30 days; marker size is screen-space

- **Decision:** raster layers are one cached canvas texture rebuilt only on layer change or after 30
  simulated days; vector layers are one `Graphics` rebuilt on layer/zoom change. Marker world radius is
  `screenPixels / zoom`; vector symbols draw above settlement glyphs, raster territory below them.
- **Why:** rebuilding a layer every tick would violate the simulation/render separation and burn the
  frame budget; drawing population dots at the settlement centre hid them under the 19 px glyph.
- **Trade-off:** a marker is a symbol, not a geographic area; zooming changes its world footprint. The
  hit radius is widened in screen space so touch remains usable at fit zoom.

### D-57 — Multiple worlds are first-class; thumbnails are real captures

- **Decision:** each world has a stable `w-<time36>-<rand36>` id, its own generation chain, metadata and
  a thumbnail captured from the real framebuffer at save time. Boot opens world selection; create,
  play, rename, delete (confirmed) and recovery all act on one id.
- **Why:** the Stage 2 storage layer already supported multiple worlds but the game hard-coded
  `world-1`. A world list with fake thumbnails would be worse than no thumbnails.
- **Trade-off:** a thumbnail adds ~20–30 KB per world doc (JPEG data URL); it is optional for old docs
  and rendered as a monogram fallback when absent.

### D-58 — Split the new UI/session/query files at the 500-line boundary

- **Decision:** rather than raising the repository's 500-line hard limit, Stage 4 splits the query
  layer (types/names/events/economy/layers/handler), the panels (core/societies/history/influence), the
  session (core/worlds/facade), the codec (types/encode/decode), the society state (state/allocate/rings)
  and the dictionaries (runtime/en/fa).
- **Why:** the limit exists to stop a single composition file becoming the place every change touches;
  the split keeps each file with one owner and makes the Stage 4 diff reviewable.
- **Trade-off:** more modules and a few re-export lines; the build and the repository gate both accept
  the result.
