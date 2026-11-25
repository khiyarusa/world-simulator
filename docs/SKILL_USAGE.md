# SKILL USAGE — World Simulator

Record of exactly which game-development skills were inspected, installed, and **how they changed the
design**. Required by the Stage 1 brief; also the reference for future agents so they do not re-derive
(or ignore) the same guidance.

---

## 1. Source and provenance

| Item | Value |
|---|---|
| Repository | `https://github.com/gamedev-skills/awesome-gamedev-agent-skills` |
| Commit inspected | `c6ca6c41c839b68319ffc08430b99ab768debc32` (2026-11-12) |
| README content | 79 skills + 1 router; engines include PixiJS 8.22 baseline; art-direction workflow included |
| License | **Apache-2.0** (`LICENSE`), attribution in `NOTICE` — both copied verbatim into `.opencode/skills/_vendor/awesome-gamedev-agent-skills/` |
| Version-support doc | `docs/VERSION-SUPPORT.md` copied to the same `_vendor/` folder |
| Installation date | 2026-11-25 |
| Installation method | Direct Git archive (`codeload.github.com` tarball) + `cp -a` of the selected skill directories. **No `npx`, no Node, no global packages** — the machine has no Node.js, and the official `npx skills add` path requires Node ≥ 22.20. |
| Install location | `.opencode/skills/<id>/SKILL.md` — the project-scope path documented at `opencode.ai/docs/skills` |
| Files installed | 50 files, 616 KB total |
| Verification | each installed directory contains `SKILL.md` with its original frontmatter; `references/`, `scripts/`, `assets/` preserved where present |

The full repository was **not** copied. Only the router, the selected skills and the required licence
files are in the project, because OpenCode advertises every discovered skill's description and a 79-skill
catalog would crowd out the project's own instructions.

---

## 2. Router execution (the actual selection)

The router (`gamedev-router/SKILL.md`) defines: detect engine → classify task → resolve minimal set →
compose. Applied to this project:

### Step 1 — Engine detection

| Signal | Finding |
|---|---|
| `package.json` dependency `pixi.js` **in a game** | the mandated stack; project is a game, not a dashboard |
| Result | **PixiJS 8** → engine skill `pixijs-rendering` (baseline 8.22; project pins 8.23) |
| No other engine fingerprint | no `project.godot`, `.uproject`, `Assets/`+`ProjectSettings`, `Cargo.toml`+bevy, `game.project`, `conf.lua`, Rojo files |

Only one engine skill set applies (the router's exclusive-engine rule). PixiJS's baseline is 8.22 and the
project uses 8.23; per the router's version rule, APIs named by the skill were checked against the current
docs before use, and none of the 8.23 additions are required by this design.

### Step 2 — Task classification

| Category | Matches in this project | Selected |
|---|---|---|
| Discipline | procedural generation, seeded RNG, noise terrain | `procedural-gen` |
| Discipline | NPC/entity AI, decision model choice, pathfinding | `game-ai` |
| Discipline | utility AI scoring, response curves, BT lifecycle | `ai-behavior-trees-utility-ai` |
| Discipline | save format, slots, atomic writes, migration | `save-systems` |
| Discipline | frame budget, pooling, GC, budgets | `performance-optimization` |
| Discipline | HUD/menu layout, safe areas, event-driven HUD | `game-ui-ux` |
| Discipline | camera follow/deadzone/zoom/bounds | `camera-systems` |
| Discipline | input actions, touch mapping, buffering | `input-systems` |
| Discipline | art direction, asset families, licensing, QA | `create-game-assets` |
| Workflow | the request explicitly asks for a GDD and docs | `game-docs` |
| Genre | none matches | **none loaded** — "world simulator" is not `platformer`, `roguelike`, `rpg`, `fps-shooter`, `tower-defense`, `card-game`, `visual-novel`, `survival-crafting` or `puzzle`; the closest (`survival-crafting`) is about gathering/recipes/carry weight, which this game does not have |

The router's composition rule is respected: one engine skill + the disciplines the task names + at most
one genre (zero here). No vendor tool (Unity/Roblox/Unreal/`game-studio`) is installed, so §4 of the
router does not apply.

### Step 3 — Explicitly not loaded

| Skill | Why not |
|---|---|
| `phaser-core`, `phaser-arcade-physics`, `threejs-*` | wrong engine |
| `physics-tuning` | there is no physics; nothing collides |
| `game-feel` | no player avatar, no hit feedback, no shake (deliberately excluded from the camera too) |
| `level-design` | no levels, no authored pacing |
| `dialogue-systems` | no dialogue; event text is templated |
| `audio-design` | audio is P1 ambience only; if Stage 4 reaches it, the skill will be installed then |
| `shader-programming` | no runtime shaders; relief shading is baked with canvas 2D |
| `prototype-fast`, `game-jam`, `steam-publish`, `itch-publish` | wrong delivery model (Android, five-stage plan) |
| `roblox-*`, `unity-*`, `godot-*`, `unreal-*`, `ebitengine-game`, `bevy-ecs`, `pygame-core`, `love2d-core`, `defold-core` | wrong engine |

Installed skills (12 + router):

```
gamedev-router/                     (router, references/ + agents/)
pixijs-rendering/
procedural-gen/
game-ai/
ai-behavior-trees-utility-ai/
save-systems/
performance-optimization/
game-ui-ux/
camera-systems/
input-systems/
create-game-assets/
game-docs/
```

---

## 3. How each skill changed the design (not "was read")

| Skill | Concrete influence | Where it landed |
|---|---|---|
| `gamedev-router` | produced the engine/task resolution above; set the "one engine, additive disciplines, no genre" rule and the progressive-disclosure read protocol | this document, §2 |
| `pixijs-rendering` | `await app.init()` boot pattern with `app.canvas`; `Container` layers with `worldRoot`/`hudRoot`; `isRenderGroup` for the static world; `eventMode`/`globalpointermove` gotchas for touch; `Assets.load` + `addBundle`; destroy/unload on teardown; **`antialias: false` and object-type grouping for older mobile** from the performance guide; `renderer.name` branching instead of assuming WebGPU | `TECHNICAL_ARCHITECTURE.md` §7, §1; `PERFORMANCE_BUDGET.md` §7 |
| `procedural-gen` | "own the randomness" → one RNG instance per system with named streams; derive child seeds per stream so adding a consumer cannot reshuffle a world; **pin the first PRNG outputs in a test**; seed sweep over ≥ 200 seeds run twice in separate processes; "flat noise at integer coordinates" → non-integer frequency; "correlated noise fields" → separate streams + offsets for elevation/moisture; triangles for connectivity validation → hydrology/landmass checks | `WORLD_GENERATION.md` §1–§2, §10; `QA_AND_CI_STRATEGY.md` §4.1 |
| `game-ai` | perceive → decide → path → steer layering mapped to region → settlement → cohort; the decision-model table (FSM for few obvious transitions, utility for graded trade-offs, GOAP only if a BT cannot express it); "pathfinding on the coarsest graph" → routes/adjacency instead of A* per person; anti-flicker hysteresis; staggered decision cadence; "cheap to expensive checks first" | `SIMULATION_MODEL.md` §7, §10 |
| `ai-behavior-trees-utility-ai` | utility scoring shape: normalize every input to 0–1 (here 0–1000 integers), multiply, **compensate so extra considerations do not drag scores to zero**, keep a 0 as a veto, add an inertia/hysteresis bonus only to positive scores, argmax with a margin; the lifecycle contract argument is why BTs are **not** used without a runtime that needs them; headless tick-test idea → decision-record tests | `SIMULATION_MODEL.md` §7 |
| `save-systems` | save data not objects; stamp `version` from the first release; JSON first / binary only for measured size; **atomic write via a new generation rather than in-place**; keep the previous generation as backup; load defensively with validation before apply; autosave at safe boundaries in a throttled way; keep every migration forever; round-trip + corruption + migration-fixture tests; "integers load as floats" caution avoided by a binary grid format | `SAVE_AND_DATA_MODEL.md` §1, §5–§8, §12 |
| `performance-optimization` | set the budget first, then measure; uncap VSync before measuring; split CPU from GPU; **fix the biggest cost by doing less work** (bake instead of tiles, monthly cadence instead of daily, aggregation instead of agents); pool objects; kill per-frame allocations; thermal-throttling reality on phones → headroom + a degradation ladder; "measure on a release-like build on target hardware" → device protocol; what headless CI can and cannot claim | `PERFORMANCE_BUDGET.md` §2–§11 |
| `game-ui-ux` | anchors/containers and one scaling policy; **safe-area insets** applied to critical UI only; event-driven HUD rather than polling; screen stack (sheets) instead of boolean flags; focus/selection never lost after a modal; text size and contrast minimums with cited guidelines (26 px console / 18 px PC at 1080p, 4.5:1); colour is never the only signal; "text 30 % longer in German" → containers that size to content | `UX_AND_VISUAL_DIRECTION.md` §3, §5, §8; theme contrast test in CI |
| `camera-systems` | `1 − exp(−rate·dt)` smoothing instead of a fixed `lerp` (frame-rate independence); **clamp the view, not the centre**; deadzone before look-ahead; focal-point-preserving pinch; no shake written into the follow target; hard-cut + reset smoothing on teleport/fly-to; the headless 30 vs 144 Hz lag check as a test idea | `UX_AND_VISUAL_DIRECTION.md` §2; `TECHNICAL_ARCHITECTURE.md` §8 |
| `input-systems` | named actions over raw coordinates; edge vs held; **radial deadzone** (not per-axis) for any analog input; buffered discrete presses measured in game time; tap slop so a drag never selects; no gesture-only path to an essential action; rebinding is not needed (single device, no keyboard) which is stated rather than half-implemented | `UX_AND_VISUAL_DIRECTION.md` §3.1, §4 |
| `create-game-assets` | the pipeline the asset work must follow: lock the technical frame → name the visual system in concrete properties → **manifest with source + licence + checks per file** → approve one target before a family → normalize deterministically → validate in context → record provenance; scripts named for raster QA; "never trust generated transparency/grids" | `ASSET_DIRECTION.md` §2, §6–§9 |
| `game-docs` | one-page GDD + feature index rather than 20 files; **one fact, one home**; status words that agree between documents; decision rows; proof annotations (only tick a criterion a test actually proves); "docs nobody keeps current are worse than none" | this doc set's structure; `docs/README.md` index; `ROADMAP_5_STAGES.md` gate wording |

Where a skill's code examples were Godot/C#/Python, the *principle* was ported to TypeScript; no Godot,
Unity, Unreal or Godot-API code was copied into the design.

---

## 4. Documented gaps in the skill coverage

Honest list of what the installed skills do **not** cover, and where this project had to decide alone:

| Gap | Handling |
|---|---|
| No Capacitor/Android-packaging skill | Researched the official Capacitor 8 docs directly (`TECHNICAL_DECISIONS.md` §3.1); the pipeline is specified in `QA_AND_CI_STRATEGY.md` §2.3 |
| No Web-Worker / worker-protocol skill | Designed from MDN/messaging constraints + the no-SAB decision (D-06) |
| No IndexedDB-specific skill | `save-systems` covers the *policy* (atomicity, versions, migration); the IDB mechanics are designed here |
| No "world simulation / grand-strategy AI" skill | `game-ai` + `ai-behavior-trees-utility-ai` supply the decision architecture; the economy/demography rules are original design |
| No CI-for-web-games skill | `performance-optimization` gives the "measure first" discipline; the workflows are specified in `QA_AND_CI_STRATEGY.md` |
| No PixiJS mobile-GPU tuning skill | The skill's performance guide note (`antialias:false`, grouping, culling is app-level) plus the device protocol |
| Skills' mobile guidance is Godot/Unity-centric | Principles ported; no engine-specific numbers reused |

These gaps are **stated**, not papered over: a future agent should not assume the skill set answers an
Android-packaging question.

---

## 5. How future agents must use these skills

1. Read `AGENTS.md`, then this file, then the one or two skills relevant to the task.
2. Do **not** load all 12 skills "to be safe" — the router's gotcha list explicitly warns against it.
3. Re-route on pivot: if a task moves from rendering to saves, load `save-systems`, not both.
4. If a skill conflicts with a decision in `TECHNICAL_DECISIONS.md`, the decision wins until it is
   formally superseded (with a measurement or a stated reason).
5. Never edit files inside `.opencode/skills/` — they are vendored, licensed third-party content. Project
   rules belong in `AGENTS.md`; project specifics belong in `docs/`.
6. `create-game-assets` scripts need Python + Pillow; that is a **local, optional** tool for asset QA, not
   a build dependency. CI must not require it for the game build.

---

## 6. Attribution

```
awesome-gamedev-agent-skills — Copyright (c) the repository authors.
Licensed under the Apache License, Version 2.0.
Source: https://github.com/gamedev-skills/awesome-gamedev-agent-skills (commit c6ca6c4)
Full license and NOTICE: .opencode/skills/_vendor/awesome-gamedev-agent-skills/
```

Modifications: none to file contents. Directory names normalised to lowercase-kebab skill ids for
OpenCode discovery (`router/` → `gamedev-router/`); all other names already matched.
