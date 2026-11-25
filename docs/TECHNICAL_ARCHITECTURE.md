# TECHNICAL ARCHITECTURE — World Simulator

Implementation blueprint for Stages 2–5. Every module boundary here exists to enforce one rule:
**the simulation must not know that a screen exists.**

---

## 1. Architecture in one diagram

```
┌───────────────────────── MAIN THREAD (UI + GPU) ──────────────────────────┐
│                                                                           │
│  app/bootstrap ── ui/shell ── render/pixi ── platform/storage             │
│        │              │            │               │                      │
│        │              │            │               └── IndexedDB (saves)   │
│        │              │            └── reads RenderMirror (typed arrays)   │
│        │              └── reads RenderMirror + ViewState                  │
│        └── WorkerClient (typed protocol, transferables)                   │
│                              │                                            │
└──────────────────────────────┼────────────────────────────────────────────┘
                               │  postMessage (structured clone + transfer)
┌──────────────────────────────┼──────────────────────────── WORKER ───────┐
│                              ▼                                            │
│  worker/sim.worker ── scheduler ── sim/* (pure, deterministic)            │
│        │                 │                                                │
│        │                 ├── world/  (generation)                         │
│        │                 ├── society/(settlements, economy, migration)    │
│        │                 ├── politics/(diplomacy, war)                    │
│        │                 ├── ecology/(climate, vegetation, disasters)     │
│        │                 ├── history/(events, chronicle)                  │
│        │                 ├── ai/     (utility scorer, decisions)          │
│        │                 └── state/  (SoA stores, checksum, snapshot)     │
│        └── deltas → RenderMirror buffers (transferred, reused)            │
└───────────────────────────────────────────────────────────────────────────┘
```

There is exactly **one writer** of simulation state (the worker) and exactly **one owner** of the
rendered copy (the main thread). Neither reaches into the other's data.

## 2. Module boundaries and ownership

| Layer | Owns | Must never |
|---|---|---|
| `src/core/` | RNG, integer math, ids, clock types, result/error types, event bus primitives | import PixiJS, DOM, IndexedDB |
| `src/sim/**` | all game rules and state | import PixiJS, DOM, `window`, `document`, `Date`, routing | 
| `src/worker/` | protocol, scheduling, delta packaging, checksums | contain game rules |
| `src/render/` | PixiJS app, textures, camera, layers, sprites, effects | mutate simulation state or own game data |
| `src/ui/` | DOM shell, panels, HUD, formatting, input mapping | compute game outcomes |
| `src/platform/` | IndexedDB, save/load, migrations, settings, device APIs (Capacitor) | contain game rules |
| `src/app/` | wiring, lifecycle, feature flags | grow into a god module (>300 LOC) |

Dependency rule (enforced by an import-boundary lint in CI):

```
core ← sim ← worker ← app → render, ui, platform
render/ui/platform ← core (types only)
sim ⇸ render  (never, in either direction)
```

## 3. Main-thread responsibilities

- Create and own the PixiJS `Application` (async `init`, one ticker).
- Own the camera and view rectangle; send the view rect to the worker at most 4×/s.
- Own **RenderMirror**: typed arrays describing what to draw (settlements, routes, overlays).
- Own **ViewState**: selected entity, active layer, panel state, speed.
- Own IndexedDB: request a save from the worker, write shards, read shards, hand them back.
- Own all text/formatting and all input handling.
- Run a frame-time ring buffer and expose it to the debug HUD.
- Never simulate, never resolve a rule, never "fix up" a value it received.

## 4. Worker responsibilities

- Own the authoritative `WorldState`.
- Generate worlds (with progress events) and initialise populations.
- Run the fixed-timestep scheduler and all simulation systems.
- Produce render deltas at a bounded rate.
- Answer queries (settlement detail, event chain, decision explanation).
- Serialise state into save shards on request and restore it on load.
- Compute a rolling checksum for determinism tests and save verification.
- Never touch DOM, IndexedDB, timers other than its own scheduler, or network.

## 5. Worker protocol (the contract)

All messages are plain objects with a discriminated `t` field. Typed arrays are **transferred**, not
cloned, and buffers are **recycled** (the worker keeps a pool and the main thread returns them).

```ts
// ---------- main → worker ----------
type Cmd =
  | { t: 'init'; cfg: { maxSettlements: 200; maxCivs: 12; seed: string } }
  | { t: 'create'; recipe: WorldRecipe }
  | { t: 'load'; shards: SaveShard[]; meta: SaveMeta }
  | { t: 'speed'; speed: 0 | 1 | 2 | 4 | 8 }
  | { t: 'view'; x: number; y: number; w: number; h: number; zoom: number }
  | { t: 'select'; kind: 'settlement' | 'civ' | 'cell' | 'event' | 'none'; id: number }
  | { t: 'intervene'; kind: 'gift' | 'blight' | 'fertilize' | 'incite'; target: number; amount?: number }
  | { t: 'query'; qid: number; what: QueryWhat }
  | { t: 'save'; sid: number; mode: 'full' | 'delta' }
  | { t: 'setTierHint'; visible: Uint16Array }        // recycled buffer
  | { t: 'pause' } | { t: 'resume' } | { t: 'dispose' };

// ---------- worker → main ----------
type Msg =
  | { t: 'ready'; caps: { wasm: false; sab: false } }
  | { t: 'progress'; stage: string; pct: number }
  | { t: 'worldMeta'; meta: WorldMeta }
  | { t: 'delta'; seq: number; day: number; stats: TickStats; mirror: MirrorDelta }
  | { t: 'eventBatch'; events: PackedEvent[]; major: PackedEvent[] }
  | { t: 'queryResult'; qid: number; data: unknown }
  | { t: 'saveShard'; sid: number; shard: SaveShard }
  // Serialisation finished, not durability: the IndexedDB commit happens on the main thread.
  | { t: 'savePrepared'; sid: number; checksum: string; bytes: number }
  | { t: 'notify'; level: 'info' | 'warn' | 'error'; code: string; msg: string }
  | { t: 'crashed'; code: string; msg: string; lastGoodDay: number };

interface MirrorDelta {
  seq: number;
  count: number;
  // parallel arrays, length = count; ids are stable, arrays grow only when settlements are added
  id: Uint16Array;
  pop: Int32Array;
  civ: Uint8Array;
  tier: Uint8Array;
  foodRatio: Uint8Array;   // 0..255 → reserve health
  stability: Uint8Array;
  flags: Uint8Array;       // starving | atWar | occupied | ruined
  dirtyDraw: Uint16Array;  // ids whose sprite/符号 must be rebuilt (tier change, ruin)
}
```

Rules:
- **Delta cadence:** the worker emits at most one `delta` per 250 ms of real time, and only if
  `seq > lastSent` or a structural change occurred. At 8× speed the sim may run 20 days between
  deltas; that is correct — the renderer is a *view*, not a clock.
- **No full state on the wire.** Only the mirror fields above (≈ 200 × 24 B = 4.8 KB worst case).
- **Queries are request/response** with `qid`; the main thread never blocks on them.
- **Commands are queued** and applied at the next tick boundary, so a command cannot land mid-phase.
  This is required for determinism: the command log is the only external input.
- **Backpressure:** the main thread returns recycled buffers; if none are available the worker
  allocates a fresh one (a soft cap of 8 buffers, after which it coalesces deltas).

### 5.1 Command log (determinism evidence)

Every `Cmd` is appended to a log with `(day, cmdIndex)`. The checksum is `hash(seed, day, stateCRC,
hash(commandLog))`. Two runs with the same log must match. The log is also what makes "replay a bug"
possible from a user's save plus a handful of commands.

## 6. Scheduling and the fixed timestep

```
                    ┌──────────── worker scheduler ────────────┐
worker timer loop →  │ accumulator += min(dtReal, 250ms) × speed │
                    │ while accumulator >= DAY_MS and n < 4:    │
                    │     tick(day++); accumulator -= DAY_MS     │
                    │ if accumulator > 30 × DAY_MS: drop excess  │
                    └───────────────────────────────────────────┘
```

- `DAY_MS = 400` at 1×; speed scales the accumulator, not `DAY_MS`, so tick semantics never change.
- The worker does **not** use `requestAnimationFrame`; it uses a `setTimeout(0)`-driven loop that runs
  as long as work is pending, and idles otherwise (no wakeups while paused → battery).
- `dtReal` is clamped to 250 ms so a backgrounded tab does not accumulate an hour of ticks.
- Max 4 ticks per scheduler pass bounds worst-case latency to ~4 × tick cost.
- Backlog cap (30 ticks) prevents unbounded queues at 8× on slow hardware; excess is dropped **with
  a visible indicator**, never silently.
- Rendering is decoupled: PixiJS renders at display refresh (or capped 30 FPS in battery saver),
  interpolating positions only where needed (none in P0 — settlements are static points).

### 6.1 Why a worker at all

| Alternative | Verdict |
|---|---|
| Sim on main thread | Rejected: a 3 ms tick + 8 ms render + GC would fight for the same 33 ms budget, and a frame hitch would slow history. |
| Sim in Worklets / AudioWorklet | Rejected: wrong tool, tiny heap, no typed-array churn. |
| WebAssembly core | Deferred (P2): would help a much larger world; adds a build step and a second determinism surface. Not justified at 200 settlements. |
| Separate worker per system | Rejected: cross-worker state sharing costs more than it saves. One sim worker, one owner. |

## 7. Rendering architecture (PixiJS 8)

```
Application (webgl; webgpu not requested)
└── stage
    ├── worldRoot (Container, isRenderGroup: true)
    │   ├── terrainSprite        ← 1 Sprite of a 2048² RenderTexture (whole world, baked once)
    │   ├── terrainDetail        ← 1 Sprite of a 2048² RenderTexture (visible region, re-baked on zoom)
    │   ├── riversSprite         ← baked overlay
    │   ├── routesLayer          ← Graphics (batched, ≤ 400 short polylines, redrawn on change only)
    │   ├── settlementsLayer     ← Sprite pool (≤ 200), one atlas texture, tinted by civ
    │   ├── effectsLayer         ← ≤ 64 pooled sprites (fire, dust, ships)
    │   └── selectionLayer       ← 1–2 Graphics
    └── hudRoot (Container)      ← DOM UI lives *above* the canvas, not inside PixiJS
```

Decisions:

- **The whole terrain is one baked texture.** Medium = 192 tiles × 10.67 px = 2048 px, so one
  2048² RGBA texture (16 MB GPU) holds the entire map at native zoom. Panning = moving one sprite.
  Draw calls for the static world: **2**.
- **Zoomed detail is a second bake.** When zoom > 1.2×, a 2048² RenderTexture covering the visible
  region at higher pixel density is baked off-screen in ≤ 4 chunks/frame (budgeted), then swapped in.
  Never re-bake the whole world on a pinch.
- **No per-tile sprites.** 65,536 tile sprites would be ~65 k draw-call items and a GC disaster.
- **Settlements are pooled sprites** with one atlas; tint encodes civ; scale encodes population tier.
  Text labels are **DOM**, not PixiJS `Text` (avoids canvas texture churn per label).
- **UI is DOM/CSS above the canvas.** Rationale: accessibility, text rendering quality, `safe-area`
  insets, and zero cost when hidden. PixiJS is for the world only.
- **No filters in the hot path.** Filters break batching and are expensive on Mali. Bloom/vignette
  are baked into the terrain texture or skipped.
- **`antialias: false`, `backgroundAlpha: 1`, `resolution` clamped to `min(devicePixelRatio, 2)`** —
  a 3× DPR phone would otherwise render 9× the pixels for no legibility gain.

## 8. Camera

```ts
// camera state, all in world pixels
interface Camera { x: number; y: number; zoom: number; tx: number; ty: number; tzoom: number; }

update(dt) {                             // exponential smoothing, frame-rate independent
  const k = 1 - Math.exp(-12 * dt);
  cam.x += (cam.tx - cam.x) * k;
  cam.y += (cam.ty - cam.y) * k;
  cam.zoom += (cam.tzoom - cam.zoom) * k;
  worldRoot.position.set(-cam.x * cam.zoom, -cam.y * cam.zoom);
  worldRoot.scale.set(cam.zoom);
}
```

- Pan bounds clamp the **view**, not the centre, so the map edge never shows void.
- Pinch zoom keeps the **focal point** fixed (solve for the new `tx/ty` from the pinch midpoint).
- Double-tap zooms 2× toward the tap; two-finger drag is pan-only (no accidental zoom).
- Inertia: velocity decays with `1 - exp(-6*dt)`; killed by any new touch.
- `zoom ∈ [0.25, 8]` where 1.0 = one world pixel per CSS pixel.

## 9. Persistence boundary

- The **worker serialises**, the **main thread writes**. The worker returns `SaveShard[]` as
  `ArrayBuffer` (transferred); the main thread writes them inside a single IndexedDB transaction.
- Save format, sharding, compression, migration and recovery are specified in
  `SAVE_AND_DATA_MODEL.md`. This document only fixes the boundary: no IDB calls in `src/sim/**`, no
  game rules in `src/platform/**`.
- Autosave triggers: every 90 simulated days **or** 60 s of real play, whichever comes first, only at
  a tick boundary, never during world generation.

## 10. Error handling

| Failure | Detection | Response |
|---|---|---|
| Worker throws | `worker.onerror`, `messageerror` | capture `lastGoodDay`, restart worker, reload last autosave, show a non-blocking toast |
| Worker silent > 5 s | watchdog timer on main thread | ping; if no pong, restart path above |
| World generation hard fail | validation report | show recipe + report, offer "retry with derived seed" |
| Save write fails | IndexedDB `QuotaExceededError`/`AbortError` | keep previous generation, tell player, offer to delete an old world |
| Save read fails / corrupt | header CRC + shard CRC | fall back to previous generation, then to `.bak`, then report |
| Newer schema | `version > SAVE_VERSION` | refuse, explain, do not half-load |
| Sim invariant violation (dev/CI) | audit phase | throw with a state dump; in production, log + continue for non-conservation checks only |
| Out of memory | `performance.memory` heuristic + catch | reduce detail tiers, drop event ring, prompt to save |

All errors are typed:

```ts
type SimErrorCode = 'GEN_INVALID' | 'SAVE_CORRUPT' | 'SAVE_SCHEMA_NEWER' | 'INVARIANT' |
                    'WORKER_CRASH' | 'QUOTA' | 'BUDGET_EXCEEDED' | 'UNSUPPORTED_VERSION';
```

## 11. Performance instrumentation (built in, never removed)

| Metric | Source | Budget check |
|---|---|---|
| frame time p50/p95 | main-thread ring buffer (120 frames) | warn > 33.3 ms, error > 50 ms |
| render CPU submit | time around `app.render()` | ≤ 8 ms |
| tick time p50/p95/max | worker, per tick | warn > 3 ms, error > 8 ms |
| ticks dropped | scheduler counter | any drop is logged with speed + device |
| delta size / rate | protocol | ≤ 8 KB, ≤ 4 Hz |
| JS heap | `performance.memory` when present | warn > 120 MB |
| save duration / size | platform layer | warn > 1.5 s / 2 MB |
| texture memory | PixiJS texture GC estimate + own counter | warn > 40 MB |

A debug overlay (`?debug=1`) renders these; it is compiled in but hidden in release. CI reads the
same numbers through a headless harness for simulation-only metrics.

## 12. Dependency strategy

Verified 2026-11-25 against the npm registry and vendor docs. **Runtime dependencies: one.**

| Package | Version | Role | Why this and not more |
|---|---|---|---|
| `pixi.js` | ^8.23.0 | WebGL rendering | Only mature 2D WebGL renderer with a small API surface, render groups, and proven mobile performance. |
| *dev only* | | | |
| `vite` | ^8.3.8 | dev server + build | Worker/asset handling, tiny config, fast cold start on weak hardware. |
| `typescript` | 6.0.3 | type check | TS 7 has no programmatic API until 7.1 and `typescript-eslint` needs the compiler API; D-26 records the fallback D-01 sanctioned. |
| `vitest` | ^5.1.1 | unit/invariant tests | Shares Vite's transform pipeline; no second bundler. |
| `@playwright/test` | ^1.65.1 | browser smoke + E2E | Only stack that reliably drives Chromium headless in CI, including WebGL checks. |
| `@capacitor/cli/core/android` | ^8.6.2 | Android shell | Current stable major; `targetSdk 36`, API 24+, plain native project we own. |
| `eslint` + `typescript-eslint` | 10.x / 8.x | lint | TS syntax parsing needs the TS 6 API, which is why the project pins TS 6 rather than aliasing two compilers. |
| `prettier` | latest | formatting | Opinionated, zero-config, no debate. |

Rejected (with reason): React/Svelte/Vue (a 6-panel UI does not need a component framework; DOM + a
300-line reactive store is smaller and faster to start), Redux/Zustand (single store, no async graph),
Dexie/idb (we need custom sharding and a single transaction; ~200 LOC wrapper is cheaper than a
dependency), fflate (native `CompressionStream` exists in Android WebView ≥ Chrome 80; polyfill only
if a real device test fails), any physics engine (no physics), any audio library (WebAudio API is
enough), any noise library (own integer noise is required for determinism guarantees).

## 13. Directory tree (as built in Stage 2)

Deviations from the plan are marked; every one is also recorded in `TECHNICAL_DECISIONS.md`.

```
world-simulator/
├── AGENTS.md
├── README.md
├── .opencode/skills/            # installed game-dev skills (Stage 1)
├── docs/                        # this design set
├── src/
│   ├── main.ts                  # entry: async boot
│   ├── core/
│   │   ├── rng.ts               # xoshiro128**, streams, cellHash
│   │   ├── math.ts              # integer helpers, curves, clamp, per-mille
│   │   ├── ids.ts               # dense id helpers, typed-array builders
│   │   ├── clock.ts             # day ↔ year/month/season
│   │   └── errors.ts            # SimError, codes
│   ├── sim/
│   │   ├── index.ts             # public surface: create/load/tick/serialize
│   │   ├── state/
│   │   │   ├── worldState.ts    # SoA stores, allocation
│   │   │   ├── checksum.ts      # rolling CRC32 over state
│   │   │   └── snapshot.ts      # mirror delta packing
│   │   ├── world/
│   │   │   ├── generate.v1.ts   # frozen v1 generator (never edited)
│   │   │   ├── noise.ts         # integer gradient noise, fbm, ridged
│   │   │   ├── hydrology.ts     # priority flood, D8, lakes
│   │   │   ├── biomes.ts        # classification + tables
│   │   │   └── spawn.ts         # site selection, initial bands
│   │   ├── society/
│   │   │   ├── agriculture.ts   ├── extraction.ts   ├── craft.ts
│   │   │   ├── consumption.ts   ├── demographics.ts ├── stability.ts
│   │   │   ├── migration.ts     └── settlements.ts
│   │   ├── economy/  trade.ts · prices.ts · routes.ts
│   │   ├── politics/ diplomacy.ts · war.ts · treaties.ts
│   │   ├── ecology/ climate.ts · vegetation.ts · disasters.ts
│   │   ├── history/ events.ts · chronicle.ts
│   │   ├── ai/ scorer.ts · decisions.ts · records.ts
│   │   └── systems/ pipeline.ts · tiers.ts · audit.ts
│   ├── worker/
│   │   ├── sim.worker.ts        # entrypoint
│   │   ├── protocol.ts          # Cmd/Msg types (shared with main via core)
│   │   ├── scheduler.ts         # accumulator, backlog cap, idle
│   │   └── serialize.ts         # shard packing + compression
│   ├── render/
│   │   ├── app.ts               # Application, world container, input
│   │   ├── markerGeometry.ts    # screen-space marker maths (Pixi-free, unit tested)
│   │   ├── camera.ts            # DOM-free camera math (unit tested)
│   │   ├── terrainBake.ts       # 2048² bake, relief, coastline, grain
│   │   ├── settlementSprites.ts # five procedural tier glyphs
│   │   └── palette.ts           # single source of colour truth
│   │                            # no layers/routes/effects.ts yet (Stage 3/4)
│   ├── ui/
│   │   ├── shell.ts             # HUD, chip, sheets, toast (364 lines)
│   │   ├── creation.ts          # world creation form + real preview panel
│   │   ├── labels.ts            # pooled DOM settlement labels
│   │   └── format.ts            # numbers → text (one place)
│   │                            # no hud.ts/panels/store.ts: D-27
│   ├── platform/
│   │   ├── storage.ts           # minimal IndexedDB wrapper (3 stores)
│   │   ├── saves.ts             # generation commit, CRC verify, fallback
│   │   └── migrations.ts        # schemaVersion → schemaVersion+1
│   │                            # no device.ts: no plugin is used in Stage 2
│   └── app/
│       ├── bootstrap.ts         # wiring, error boundary
│       ├── settings.ts
│       └── debug.ts             # ?debug=1 overlay
├── tests/
│   ├── unit/                    # vitest: core, sim rules
│   ├── determinism/             # seed sweeps, cross-process hashes
│   ├── invariants/              # INV-1..INV-10
│   ├── fixtures/golden/         # 15 golden world hashes
│   └── e2e/                     # playwright: boot, generate, pan, inspect, save/load
├── android/                     # Capacitor native project (committed)
├── .github/workflows/           # ci.yml · android.yml · perf.yml
├── capacitor.config.ts
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 14. Coding standards (enforced in CI)

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`,
  `noImplicitOverride: true`, `verbatimModuleSyntax: true`.
- No `any` in `src/sim/**`; `unknown` + narrowing at boundaries.
- No default exports (except worker entrypoints), no barrel files inside `sim/` (barrels hide cycles).
- Pure functions for rules: `(state, inputs) => out` with no side effects except through explicit
  store parameters.
- No class inheritance beyond `Error` subclasses; composition and plain data.
- Every public function in `sim/**` has a unit test or a documented reason it cannot be tested in
  isolation (e.g. it needs a full world).
- Comments explain *why*, never *what*; no commented-out code.
- Numbers with units carry the unit in the name (`pop`, `foodUnits`, `dayCount`, `msPerDay`).

## 15. Stage 2 skeleton order (so Stage 2 cannot sprawl)

1. `core/` + `protocol` + worker that returns a stub world → CI green.
2. `world/generate.v1` + determinism tests + golden hashes.
3. PixiJS boot + terrain bake + camera → visible, pannable world.
4. Delta mirror + settlement dots + HUD (date, speed) → inspectable world.
5. IndexedDB save/load of the generated world + autosave → survivable world.
6. Perf overlay + budgets wired into the CI perf job.

Anything not on that list is not Stage 2.
