# World Simulator

A living-world sandbox simulator for Android. You generate a world, then watch it develop: settlements
grow, economies specialize, droughts cause famines, people migrate, civilizations trade, rival and fight,
and a history is written that you can read and trace back to its causes.

The world does not need you. That is the point.

> **Status: Stage 4 of 5 — software-complete, physical-device pass pending.**
> Six real map layers, six panels, four validated player interventions, causal history and a
> chronicle, multi-world management, Persian RTL (Vazirmatn) and English. Simulation, saves and
> determinism are covered by unit, integration, browser E2E and visual-QA runs.
> See [`docs/STAGE_4_REPORT.md`](docs/STAGE_4_REPORT.md), the design in
> [`docs/STAGE_4_DESIGN.md`](docs/STAGE_4_DESIGN.md), and
> [`docs/ROADMAP_5_STAGES.md`](docs/ROADMAP_5_STAGES.md).

---

## What it is

- **Offline-first Android game** (Capacitor 8 + PixiJS 8 + TypeScript), portrait-first, touch-only.
- **A simulation, not an animation**: every visible change comes from a simulated variable you can inspect.
- **Emergent history**: foundings, booms, droughts, famines, migrations, treaties, wars, collapses — each
  event stores what caused it, so "why did this happen?" is answerable up to 8 links back.
- **Scale without lies**: 200 settlements and 12 civilizations simulated at full fidelity every tick; population
  is modelled as cohorts, never as thousands of decorative agents.

## What it is not

Not a city-builder, not an RTS, not a campaign, not a dashboard, not 3D or isometric. There are no units to
command and no buildings to place. The player observes, inspects, accelerates, and occasionally nudges.

## The design set

| Document | Contents |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Permanent rules for any agent or developer working here |
| [`docs/README.md`](docs/README.md) | Documentation index and the design in ten lines |
| [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md) | Mission, platform contract, pillars, success criteria |
| [`docs/GDD.md`](docs/GDD.md) | Game design: loop, powers, systems, constants |
| [`docs/SIMULATION_MODEL.md`](docs/SIMULATION_MODEL.md) | Tick pipeline, state layout, all rules |
| [`docs/WORLD_GENERATION.md`](docs/WORLD_GENERATION.md) | Seeded generation, RNG, terrain, biomes, validation |
| [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) | Modules, worker protocol, rendering, directory tree |
| [`docs/SAVE_AND_DATA_MODEL.md`](docs/SAVE_AND_DATA_MODEL.md) | Persistence, shards, migrations, recovery |
| [`docs/PERFORMANCE_BUDGET.md`](docs/PERFORMANCE_BUDGET.md) | Frame/tick/memory budgets and measurement |
| [`docs/UX_AND_VISUAL_DIRECTION.md`](docs/UX_AND_VISUAL_DIRECTION.md) | Projection, camera, gestures, layout, art direction |
| [`docs/ASSET_DIRECTION.md`](docs/ASSET_DIRECTION.md) | Asset pipeline, sizes, manifest, licences |
| [`docs/SCOPE_AND_PRIORITIES.md`](docs/SCOPE_AND_PRIORITIES.md) | P0/P1/P2 and the cut list, with reasons |
| [`docs/ROADMAP_5_STAGES.md`](docs/ROADMAP_5_STAGES.md) | Five stages, each with measurable acceptance criteria |
| [`docs/QA_AND_CI_STRATEGY.md`](docs/QA_AND_CI_STRATEGY.md) | Workflows, quality gates, device validation |
| [`docs/TECHNICAL_DECISIONS.md`](docs/TECHNICAL_DECISIONS.md) | ADRs, verified facts, open assumptions |
| [`docs/SKILL_USAGE.md`](docs/SKILL_USAGE.md) | Installed game-dev skills and how they shaped the design |

## Technology

| Layer | Choice |
|---|---|
| Language | TypeScript 6.0.3 (strict) |
| Build | Vite 8 |
| Rendering | PixiJS 8.23 (WebGL) — rendering only, never game state |
| Simulation | TypeScript in one dedicated Web Worker, fixed 1-day tick, integer fixed-point |
| Persistence | IndexedDB, sharded and generation-based, schema-versioned |
| Android | Capacitor 8.6 (`minSdk 24`, `compileSdk`/`targetSdk` 36) |
| Automation | GitHub Actions (typecheck, lint, unit, determinism, E2E, perf, APK) |

Runtime dependencies: **one** (`pixi.js`). The PRNG, noise, storage wrapper and UI layer are project code,
because determinism and footprint are product requirements.

## Development

The development machine for this project is intentionally weak; builds, tests and Android packaging
run in GitHub Actions.

```bash
npm ci
npm run dev        # browser dev server (development only, not a product)
npm run typecheck
npm test           # unit + invariants + golden worlds
npm run det        # 40 seeds x 3 presets, two processes, compared in CI
npm run android:sync
```

Android artifacts are produced by CI (`.github/workflows/android.yml`), never locally. The last green
runs are linked from `docs/STAGE_2_REPORT.md` §H.

## Skills

Game-development skills are vendored under `.opencode/skills/` from
[`awesome-gamedev-agent-skills`](https://github.com/gamedev-skills/awesome-gamedev-agent-skills)
(Apache-2.0, commit `c6ca6c4`). Selection, rationale and attribution:
[`docs/SKILL_USAGE.md`](docs/SKILL_USAGE.md). Do not edit vendored skill files.

## Licence

Game code and documentation: to be declared at release. Vendored skills: Apache-2.0 (see
`.opencode/skills/_vendor/awesome-gamedev-agent-skills/LICENSE`). Assets: see
[`docs/ASSET_DIRECTION.md`](docs/ASSET_DIRECTION.md) §9 — every asset must carry a source and a licence.
