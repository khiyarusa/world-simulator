# Documentation index

World Simulator — design set for the five-stage build. **Start with `../AGENTS.md`** (the rules), then
this page (the map), then the two or three documents that own the area you are working on.

Status of the whole set: **Stage 4 software-complete, physical-device pass pending** (2026-11-26).
The world engine, living simulation, player experience, six layers, six panels, interventions,
multi-world management and Persian/English UI are implemented and tested in software. Evidence:
[`STAGE_4_REPORT.md`](STAGE_4_REPORT.md) and [`STAGE_3_REPORT.md`](STAGE_3_REPORT.md); design contracts:
[`STAGE_4_DESIGN.md`](STAGE_4_DESIGN.md) and [`STAGE_3_DESIGN.md`](STAGE_3_DESIGN.md).

## Read in this order

| # | Document | Answers | Read when |
|---|---|---|---|
| 0 | [`../AGENTS.md`](../AGENTS.md) | What am I allowed to do, and what is forbidden? | always, first |
| 1 | [`PRODUCT_BRIEF.md`](PRODUCT_BRIEF.md) | What are we building, for whom, with what constraints, and what does "done" mean? | first contact with the project |
| 2 | [`GDD.md`](GDD.md) | What is the game? Loop, player powers, systems, constants, emergent arcs. | designing or questioning gameplay |
| 3 | [`SCOPE_AND_PRIORITIES.md`](SCOPE_AND_PRIORITIES.md) | Is this feature P0/P1/P2 or cut, and why? | before proposing any feature |
| 4 | [`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md) | Module boundaries, worker protocol, scheduling, directory tree, dependencies. | writing code |
| 5 | [`SIMULATION_MODEL.md`](SIMULATION_MODEL.md) | State layout, tick pipeline, economy/AI/diplomacy/war/ecology rules, invariants. | implementing or balancing the sim |
| 6 | [`WORLD_GENERATION.md`](WORLD_GENERATION.md) | RNG streams, noise, hydrology, biomes, resources, validation, seed tests. | implementing generation |
| 7 | [`SAVE_AND_DATA_MODEL.md`](SAVE_AND_DATA_MODEL.md) | What is persisted, shard format, atomic saves, migrations, recovery, retention. | touching persistence or any persisted field |
| 8 | [`PERFORMANCE_BUDGET.md`](PERFORMANCE_BUDGET.md) | Frame/tick/memory budgets, LOD, slicing, degradation, CI vs device measurement. | optimising, or adding anything to a loop |
| 9 | [`UX_AND_VISUAL_DIRECTION.md`](UX_AND_VISUAL_DIRECTION.md) | Projection, camera, gestures, layout, sheets, palette, typography, accessibility. | building UI or rendering |
| 10 | [`ASSET_DIRECTION.md`](ASSET_DIRECTION.md) | Per-category asset technique, sizes, manifest, licences, QA gates. | producing or importing art |
| 11 | [`ROADMAP_5_STAGES.md`](ROADMAP_5_STAGES.md) | What each stage must deliver, with numbered acceptance criteria. | planning or reporting a stage |
| 12 | [`QA_AND_CI_STRATEGY.md`](QA_AND_CI_STRATEGY.md) | What runs where, the workflows, quality gates, flaky policy, device protocol. | changing CI, tests or gates |
| 13 | [`TECHNICAL_DECISIONS.md`](TECHNICAL_DECISIONS.md) | Each decision, its alternatives, its risk, plus verified facts and open assumptions. | disagreeing with a choice, or adding one |
| 14 | [`SKILL_USAGE.md`](SKILL_USAGE.md) | Which game-dev skills are installed, why those, and what each one changed. | start of any implementation task |
| 15 | [`STAGE_2_REPORT.md`](STAGE_2_REPORT.md) | What Stage 2 actually built, the acceptance matrix, CI evidence and the remaining issues. | before starting Stage 3, and for any status question |
| 16 | [`STAGE_2_1_HARDENING.md`](STAGE_2_1_HARDENING.md) | The 13 verified defects, their root causes, fixes and regression tests, plus what was deliberately not fixed. | before changing determinism, saves, camera or markers |
| 17 | [`STAGE_3_DESIGN.md`](STAGE_3_DESIGN.md) / [`STAGE_3_REPORT.md`](STAGE_3_REPORT.md) | The living-world contract and its measured evidence. | changing simulation rules or balance |
| 18 | [`STAGE_4_DESIGN.md`](STAGE_4_DESIGN.md) / [`STAGE_4_REPORT.md`](STAGE_4_REPORT.md) | Player experience contract, schema 4, layer/panel/command design, evidence and remaining device work. | changing UI, queries, commands or saves |

## Ownership of facts (one fact, one home)

| Fact | Owner |
|---|---|
| Gameplay constants (rates, thresholds, tiers, caps that are *design*) | `GDD.md` |
| Rules and formulas | `SIMULATION_MODEL.md` |
| RNG, noise, generation algorithms | `WORLD_GENERATION.md` |
| Frame/tick/memory numbers | `PERFORMANCE_BUDGET.md` |
| Save shape and schema version | `SAVE_AND_DATA_MODEL.md` |
| Layout, gestures, colours, type scale | `UX_AND_VISUAL_DIRECTION.md` |
| Asset sizes and licences | `ASSET_DIRECTION.md` |
| Stage gates | `ROADMAP_5_STAGES.md` |
| CI jobs and thresholds | `QA_AND_CI_STRATEGY.md` |
| Why a technology was chosen | `TECHNICAL_DECISIONS.md` |

If two documents disagree, the owner wins and the other is corrected in the same commit.

## The design in ten lines

1. Top-down 2D living-atlas world, 128²/192²/256² tiles, seed-reproducible, `generatorVersion`-pinned.
2. Simulation runs in a worker at a fixed 1-day tick; speed scales the accumulator, never the step.
3. State is struct-of-arrays typed arrays; economy is integer fixed-point; 200 settlements, 12 civs.
4. Detail is tiered by camera and selection (24 daily / 96 weekly / 200 monthly) without letting the
   camera change history.
5. Population is 8 cohorts per settlement, never individual citizens; 60 named characters for narrative.
6. Decisions are utility-scored, deterministic, and recorded so "why?" is answerable on demand.
7. War is abstract and monthly: fronts, attrition, occupation, exhaustion, peace — with real consequences.
8. Saves are sharded, versioned, generation-based, atomic; terrain is stored, not regenerated.
9. The world renders as ~2 draw calls (one baked 2048² texture) with ~200 pooled settlement sprites; DOM UI.
10. Everything heavy runs in GitHub Actions; the phone is validated manually against a written protocol.

## Conventions

- `[TARGET]` = a hypothesis not yet measured. `[VERIFIED]` = measured, with a capture or run attached.
- `S<n>-A<m>` = an acceptance criterion, defined in `ROADMAP_5_STAGES.md`.
- `D-nn` = a decision, `A-nn` = an assumption, `O-n` = an open question — all in `TECHNICAL_DECISIONS.md`.
- `INV-n` = a machine-checked invariant, defined in `SIMULATION_MODEL.md` §15.
