# PERFORMANCE BUDGET — World Simulator

A budget is a **constraint with a number**, not a wish. Every entry below is either marked
`[TARGET]` (a design hypothesis to be validated) or `[VERIFIED]` (actually measured, with the
measurement recorded). At Stage 1 nothing has been measured, so **every number here is a target**.
`[VERIFIED]` appears only when a CI run or a device capture is attached to a commit.

---

## 1. Hardware assumption

| Item | Value | Status |
|---|---|---|
| Reference device | Samsung Galaxy A23 4G (SM-A235F): Snapdragon 680, Adreno 610, 4 GB RAM, 1080×2408 @ 90 Hz | assumed — **confirm exact model before Stage 5 sign-off** |
| WebView | Android System WebView, Chromium-based, auto-updated | assumed current stable (Chromium 14x era) |
| OS floor | API 24 (Android 7) | from Capacitor 8 requirements |
| OS realistic floor | Android 10+ (updatable WebView, modern JS) | recommended floor for support |
| Min spec target | 2 GB RAM, 720p, any 2019+ Adreno/Mali GPU | stretch goal |
| Dev machine | 2 vCPU / 2 GB RAM, no Node installed | observed (this machine) |

The reference device drives every budget. A device that is faster gets headroom (and optionally
60 FPS); a device that is slower gets the degradation ladder in §8, never a crash.

**1200×2408 at 3× DPR is not rendered at native resolution.** `resolution` is clamped to
`min(devicePixelRatio, 2)` and the canvas is CSS-sized; 2× on a 1080p-wide phone is ~1080×2280
backing pixels, which is already a fill-rate risk on Adreno 610 for a full-screen quad. This single
decision is the difference between 30 FPS and 15 FPS on this class of GPU.

## 2. Frame budget (30 FPS baseline)

```
33.3 ms total per frame at 30 FPS
├── 8.0 ms  CPU main thread (input, camera, delta apply, DOM, PixiJS submit)
├── 12.0 ms GPU (terrain quad + ~200 settlement sprites + ≤ 4 overlays)
├── 4.0 ms  compositor / vsync slack
└── 9.3 ms  headroom (thermal, GC, OS jank, WebView overhead)
```

| Metric | Budget | Measurement |
|---|---|---|
| Frame time p50 | ≤ 20 ms | main-thread ring buffer |
| Frame time p95 | ≤ 33.3 ms | 120-frame window |
| Frame time p99 | ≤ 45 ms | logged, not fatal |
| Long frames (> 50 ms) | ≤ 1 per 10 s | counted |
| Main-thread CPU per frame | ≤ 8 ms | `performance.now()` around update+render |
| Draw calls | ≤ 120 | PixiJS stats |
| Triangles/vertices | ≤ 60 k | PixiJS stats |
| Texture memory | ≤ 40 MB | own counter |
| JS heap | ≤ 120 MB | `performance.memory` (Chrome only) |
| App RSS | ≤ 250 MB | device capture (`adb shell dumpsys meminfo`) |

60 FPS is an **optimisation goal**, not a promise: if the frame fits in 16.6 ms on a device, the
ticker runs at display rate; otherwise the app caps at 30 FPS deliberately via a frame-limiter, which
is smoother than an oscillating 45–55 FPS and saves battery.

## 3. Simulation budget

| Metric | 1× | 4× | 8× |
|---|---|---|---|
| Day-tick cost p50 (Medium) | ≤ 1.5 ms | ≤ 1.5 ms | ≤ 1.5 ms |
| Day-tick cost p95 | ≤ 3.0 ms | ≤ 3.0 ms | ≤ 3.0 ms |
| Day-tick worst case (monthly/yearly systems) | ≤ 8 ms | ≤ 8 ms | ≤ 12 ms |
| Ticks per second | 2.5 | 10 | 20 |
| Average sim CPU per real second | ≤ 7.5 ms | ≤ 30 ms | ≤ 60 ms |
| Ticks per frame (max) | 4 | 4 | 4 |
| Backlog cap | 30 ticks | 30 ticks | 30 ticks |
| Delta emission | ≤ 4 Hz | ≤ 4 Hz | ≤ 4 Hz |

At 8× the sim needs 20 ticks/s × 1.5 ms ≈ 30 ms/s (3% of one core) in the steady state, which is why
a worker thread is enough and a second thread is not. The **worst case** is the number that matters:
a monthly tick where diplomacy + war + climate + tech all fire at once. The mitigation is slicing, not
hoping:

- Yearly work is split into 12 monthly blocks (`SIMULATION_MODEL.md` §2).
- Monthly work is sorted into a fixed "cost budget" order and may spill one tick (never dropped).
- Any single system exceeding 2 ms in dev triggers a warning in the audit phase and a test fixture.

Per-preset scaling target: Small ≈ 0.55× Medium, Large ≈ 1.8× Medium.

## 4. Memory budget

| Item | Medium | Large | Notes |
|---|---|---|---|
| Terrain grids (11 arrays, 14 B/cell) | 504 KB | 896 KB | typed arrays, no objects |
| Settlement store (cap 200) | 24 KB | 24 KB | fixed capacity |
| Civ + relations | 1 KB | 1 KB | |
| Event ring (20k) + major store | 480 KB + 320 KB | same | caps, not growth |
| Chronicle (500 years × 12 civs) | 240 KB | 240 KB | downsampled older than 200 y |
| Mirror buffers (main + worker pools) | 64 KB | 64 KB | 8 recycled buffers |
| Terrain textures (2 × 2048² RGBA) | 32 MB GPU | 32 MB GPU | 1 world + 1 detail bake |
| Sprite atlas (2048²) | 16 MB GPU | 16 MB GPU | settlements, effects, icons |
| UI/DOM | ~8 MB | ~8 MB | |
| PixiJS + runtime baseline | ~25 MB | ~25 MB | measured in Stage 2 |
| **Working total (JS + GPU)** | **≈ 85 MB** | **≈ 90 MB** | budget 250 MB RSS leaves room for WebView |

Hard caps that prevent unbounded growth:

| Cap | Value | Behaviour at cap |
|---|---|---|
| Settlements | 200 | founding is refused; recorded as a "land is full" pressure event |
| Civilizations | 12 | fragmentation merges into nearest kin instead of creating a 13th |
| Trade routes | 400 | lowest-usage route decays first |
| Notable characters | 60 | oldest retired character is dropped after 3 years |
| Persisted events | 20,000 | lowest (severity, age) evicted; severities 4–5 kept separately forever |
| Major events store | 100,000 | at cap, only severity 5 kept (≈ 400 years of dense history) |
| Save generations per slot | 2 (current + backup) | oldest rotated out |

## 5. Work-slicing rules (no unbounded work, ever)

| Process | Slice | Limit |
|---|---|---|
| World generation | per stage, cancellable | ≤ 1.5 s total, progress every 8 ms |
| Terrain detail re-bake | 4 chunks per frame | ≤ 2 ms/frame |
| Save serialisation | per shard | ≤ 12 ms per shard, yields between shards |
| Save write | per generation | **one** IDB transaction for all shards + metadata (D-25); shards are serialised one at a time before the transaction opens |
| Crop/atlas warmup | per texture | ≤ 16 ms total on first frame after boot |
| Event chronicle pass | one civ per month | ~12 small writes |
| Catch-up after absence | ≤ 30 ticks, budgeted | stops early rather than dropping frames |

Rule: **any loop whose iteration count depends on world size must have a per-frame or per-tick
budget, a time check, or a cap.** This is reviewed explicitly in Stage 2 code review.

## 6. Simulation LOD budget (the main scaling lever)

| Tier | Settlements | Cost per update | Total per day |
|---|---|---|---|
| 0 Focus | ≤ 24 | ~40 µs each | ~1.0 ms |
| 1 Regional | ≤ 96 | ~6 µs each (weekly → ÷7) | ~0.08 ms/day |
| 2 World | ≤ 200 | ~2 µs each (monthly → ÷30) | ~0.013 ms/day |

So detail is affordable exactly where the player is looking, and history still advances elsewhere at
1/30th the cost. Tiering hysteresis (2 days) prevents thrash when the camera jitters.

## 7. Rendering cost model

| Element | Vertices | Draw items | Notes |
|---|---|---|---|
| Terrain (baked world quad) | 4 | 1 | one Sprite |
| Terrain detail (baked region) | 4 | 1 | visible only at zoom > 1.2 |
| Rivers overlay (baked) | 4 | 1 | |
| Trade routes (Graphics) | ≤ 3,200 | 1–3 | redrawn only on change, not per frame |
| Settlements (pooled sprites) | ≤ 1,600 | ≤ 8 batches | one atlas, tint by civ → batched |
| Selection / effects | ≤ 300 | ≤ 4 | |
| HUD | — | 0 | DOM, outside WebGL |

Total steady state ≈ **≤ 15 draw items**, far under the 120 budget. The budget exists to absorb
overlays (history pins, heatmap) and future growth, not because we expect to need it.

**Why not tile sprites:** 36,864 tiles × 1 quad = 36,864 instances. Even at 16 tiles per batch that
is 2,300 draw calls. Baking is not an optimisation, it is the architecture.

## 8. Degradation ladder (automatic, in order)

| Step | Trigger | Action | Recovery |
|---|---|---|---|
| 1 | p95 frame > 33 ms for 5 s | stop detail re-bake, keep the last bake | 30 s below budget |
| 2 | still over | disable effects layer (fire/dust), keep settlements | 60 s below |
| 3 | still over | drop settlement label density (DOM) to 50 % | user opens panel |
| 4 | still over | cap sim tier-0 set from 24 → 12 | 30 s below |
| 5 | still over, or thermal flag | force 30 FPS cap and 1× max speed; toast "performance mode" | manual in settings |

Never degraded: simulation correctness, saves, history, input. Only appearance and detail.

## 9. Thermal and battery

- A 15-minute session at 8× is the thermal worst case. Expect throttling on a 4 GB mid-range phone;
  the ladder converges to a stable 30 FPS rather than fighting the device.
- Pause on `visibilitychange` (screen off, app backgrounded) — no background ticking, ever. This is
  also why catch-up exists (`SIMULATION_MODEL.md` §14).
- Battery saver mode: 30 FPS cap, max 1×, no effects, sim paused when idle for 60 s with no input
  (opt-in setting, default off).

## 10. What CI can and cannot measure

| Measured in CI (headless Node) | Cannot be measured in CI |
|---|---|
| Tick time p50/p95/worst (pure sim) | GPU frame time |
| Memory growth per 10k ticks | Real thermal behaviour |
| Ticks dropped under a simulated slow loop | WebView compositor cost |
| Save/load duration and size | Touch latency |
| Generation time (relative regression) | Actual battery drain |
| Determinism checksums | Anything on Adreno 610 |
| Draw-call *counts* via a mocked renderer | Fill rate, overdraw |

CI uses headless Chromium (SwiftShader software rasteriser) for **correctness** of rendering, never
for performance claims. Any rendering number quoted in a document must name the device and build.

### 10.1 CI perf job specification (`perf.yml`)

```
node --version                       # pinned 24.x
npm ci
npm run build:sim                    # tsc → dist-sim (no DOM, no PixiJS)
node tests/perf/tick-bench.mjs \
  --preset medium --years 50 --speeds 1,2,4,8 --seeds 3 --json > perf.json
node tests/perf/assert-budgets.mjs perf.json --baseline .perf/baseline.json --regression 20
```

`assert-budgets.mjs` fails when:

- tick p95 > 3.0 ms on the CI reference runner (note: CI is faster than an A23 — this is a
  **regression guard**, with the device budget checked separately),
- any tick > 8 ms during a steady 1× run,
- heap growth > 1 MB per 10,000 ticks,
- a named budget in this document regresses by more than 20% versus `.perf/baseline.json`.

The baseline file is committed and updated only in a commit that explains the change.

## 11. Physical-device validation protocol (each stage from 2 onward)

1. `npm run build && npx cap sync android`, build a **debug** APK in CI, install via `adb install -r`.
2. Enable `?debug=1` overlay; set Medium world, 1×, zoom 1.0, dwell 60 s. Record p50/p95 frame time,
   draw calls, heap.
3. Same at 8× for 60 s. Record ticks dropped and tick p95.
4. Pinch to max zoom over a dense settlement cluster for 20 s — the worst-case bake path.
5. Open the history panel and scroll to year 1 — worst-case DOM path.
6. Save, force-stop, relaunch, load — measure cold start and save duration.
7. 15-minute continuous run at 4× to observe thermal drift; report frame time at minute 1 vs 15.
8. Export the overlay CSV, attach it to the stage's release notes.

Acceptance: p95 ≤ 33.3 ms in steps 2–5, cold start ≤ 6 s, 15-min frame time degradation ≤ 25%, no
`OutOfMemoryError`, no ANR.

If a stage cannot be validated on a physical device (no device available), that must be **stated in
the stage report**, not silently skipped.

## 12. Known performance risks (ranked)

| # | Risk | Likelihood | Mitigation | Trigger to act |
|---|---|---|---|---|
| R1 | Full-screen 2× DPR quad overdraws on Adreno 610 | Medium | clamp resolution; test 1× DPR fallback | frame p95 > 33 ms at zoom 1 |
| R2 | Texture memory (32 MB world + 16 MB atlas) on 4 GB devices | Low–Med | 1024² atlas on `lowMemory` devices, 16-bit terrain textures | heap/texture warning |
| R3 | DOM panels cause layout thrash on open | Medium | transform-only animations, `contain: strict`, build panel content off-thread | panel open > 100 ms |
| R4 | GC pauses from per-frame object churn in render code | High if undisciplined | preallocated pools, no closures in ticker, no array literals per frame | any frame > 50 ms without a bake |
| R5 | Sim worker starves the compositor on a 2-core CPU | Medium | 4-tick cap, idle when paused, budgeted slices | ticks dropped counter > 0 at 1× |
| R6 | WebView version variance (API 24 device with old WebView) | Medium (low-end only) | feature detect `CompressionStream`; avoid new syntax at runtime (Vite targets ES2020) | any boot failure on Android 7 |
| R7 | Save write blocking the main thread on a slow eMMC | Medium | shard writes, yield between transactions, autosave during low activity | save > 1.5 s |

## 13. Budget governance

- This document is the single source of performance numbers. Code comments reference it by section.
- A PR that exceeds a budget must either fix it or update this document **with a measurement** — never
  silently.
- At Stage 5 the budget table is re-issued as `PERFORMANCE_BUDGET.md` v2 with `[VERIFIED]` marks and
  the device captures attached to the release.
