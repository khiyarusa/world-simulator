# PRODUCT BRIEF

> **Owner amendment (2026-11-27):** the player is now the **World Steward**. The autonomous world
> remains the foundation, but the primary experience is a campaign of long-term stewardship: choose a
> legacy, read real crises, issue strategic charters and leave a legacy. Free Sandbox preserves the
> original observer experience (D-68). — World Simulator

Working title: **World Simulator** (configurable; no commercial title yet).
Document status: **Stage 1 baseline v1.0** — binding for Stages 2–5 until explicitly revised.

---

## 1. What this product is

A **living-world stewardship game for Android**. The player generates a world, chooses a legacy,
then guides autonomous civilizations through real crises and long-term chapters — or watches in Free
Sandbox. The original line describes the sandbox mode:
settlements, economies, ecologies and civilizations develop, interact, and collapse on their own.
The player can pause, accelerate, inspect any part of the world, and intervene — but the world does
not need the player to keep moving.

One sentence: *a pocket-sized world that keeps making history, and a steward who can shape what it
becomes without scripting its people.*

## 2. What this product is not

| Not this | Why it matters |
|---|---|
| A campaign / level-based game | No levels, no scripted missions, no win screen. Progression is emergent. |
| A city-builder | The player does not place buildings or draw roads. Settlements build themselves. |
| A real-time strategy game | No unit selection, no orders, no tactical combat. War is abstract and systemic. |
| A map animation / screensaver | Every visual change must be caused by a simulated variable the player can inspect. |
| A dashboard | The world is the interface; panels are subordinate and dismissible. |
| A 3D or isometric game | Top-down 2D, chosen for legibility and mobile GPU cost (see `UX_AND_VISUAL_DIRECTION.md`). |

## 3. Target player and session shape

- **Primary player:** someone who wants a readable living world **and** a reason to intervene —
  Dwarf Fortress / Rimworld
  observers, Civilization players who like the map more than the combat, fans of "ant farm" games.
- **Session shape:** 3–15 minutes, several times a day, plus occasional 30–60 minute deep sessions.
  The world must be *interesting to return to*: something changed while away (simulated forward on
  load at a bounded catch-up rate, never unbounded).
- **Skill floor:** no tutorial required to enjoy watching; a 90-second onboarding explains pan,
  zoom, speed, and inspect.

## 4. Platform contract (non-negotiable)

| Constraint | Requirement |
|---|---|
| Target | Android phones, API 24+ (`minSdk 24`), `targetSdk 36` |
| Reference device | Samsung Galaxy A23 (Mali-G52, 4 GB RAM, 90 Hz panel limited to our cap) |
| Output | Debug APK in CI; release APK + AAB at Stage 5 |
| Offline | 100% playable with no network. No account, no server, no telemetry upload. |
| Orientation | **Portrait is primary**; landscape is supported as a secondary layout |
| Input | Touch only. No mouse/keyboard dependency, no gamepad requirement |
| Distribution | Google Play (AAB), plus APK sideload for testing |
| Dev machine | Weak (2 vCPU / 2 GB RAM class). All heavy work runs on GitHub Actions. |

Explicitly out of scope: Windows/macOS/Linux builds, Electron, Tauri, Steam, iOS, consoles,
multiplayer, cloud saves, user accounts, ads, IAP.

## 5. Product pillars

1. **Causal honesty.** A drought lowers harvest, lowers reserves, raises prices, lowers health,
   pushes migration, strains neighbours, and can end in war or collapse. Every arrow is a real
   variable, not a scripted sequence.
2. **Autonomy.** Left alone for 400 simulated years, the world produces a readable history:
   foundings, famines, migrations, treaties, wars, collapses, recoveries.
3. **Inspectability.** Any number on screen can be traced to its inputs. Any major event can be
   asked "why?" and answered with its cause chain.
4. **Restraint in the frame.** The world occupies the screen; UI is thin, thumb-reachable, and
   dismissible. 30 FPS is a design constraint, not an aspiration.
5. **Small, deep world.** 200 meaningful settlements beat 20,000 decorative dots. Scope reduction
   is preferred over shallow breadth (see `SCOPE_AND_PRIORITIES.md`).

## 6. Success criteria for the product

Measured, not vibes. These become stage acceptance gates.

| # | Criterion | Target |
|---|---|---|
| P1 | World runs 200 simulated years unattended with zero runtime errors and no unbounded growth | Required |
| P2 | Frame time at Medium world, 1× speed, mid-zoom on A23 | p95 ≤ 33.3 ms (30 FPS), CPU main ≤ 8 ms |
| P3 | Simulation cost per day-tick, Medium world, A23 | p95 ≤ 3 ms |
| P4 | Save round-trip fidelity after 200 years | Exact on all persisted fields; no drift |
| P5 | Same seed + same preset + same command log ⇒ identical checksum at day 10,000 | Required |
| P6 | Player can answer "why did this happen?" for any event of severity ≥ 4 | Cause chain present |
| P7 | Cold start to playable world (Medium) on A23 | ≤ 6 s |
| P8 | Install size | ≤ 25 MB APK |
| P9 | Save file size at year 200, Medium | ≤ 2 MB compressed |
| P10 | A new player understands pan/zoom/speed/inspect without reading text | 3-step onboarding |

## 7. Business and delivery constraints

- **5 stages total, hard stop.** No stage 6. If a feature threatens the limit, it is cut, not
  deferred to an imaginary later stage.
- **Every stage ships something runnable** and passes CI before the next stage begins.
- **No paid runtime services.** No LLM API in the game loop, no analytics SDK, no ad SDK.
- **License hygiene.** Only permissively licensed dependencies (PixiJS MIT, Capacitor MIT) and
  original or CC0 assets, with provenance recorded in `docs/ASSET_DIRECTION.md`.

## 8. Definition of done for the product (release)

A player can, entirely offline on a mid-range Android phone:

1. Create a world from a seed and a preset, or load an existing one.
2. Watch it evolve at 1×, 2×, 4× or 8×, or pause and inspect.
3. Tap any settlement and read its population, food balance, economy, stability, and history.
4. Read the political map, the trade network, and the ecology layer.
5. Open the chronicle and read a coherent year-by-year history with causes.
6. Intervene in bounded ways (drought, fertility, a gift, a raid) and see consequences propagate.
7. Save, quit, return a week later, and find the world intact and advanced.
8. Do all of the above without an internet connection and without ever seeing a debug overlay.

Anything not required for those eight outcomes is P1/P2 or cut (see `SCOPE_AND_PRIORITIES.md`).
