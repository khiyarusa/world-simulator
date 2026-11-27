# STAGE 5 — GRAND STEWARDSHIP EXPANSION: REPORT

Status: **implementation complete in software; physical Galaxy A23 validation and release signing
pending.** This report covers the owner-authorized reopening of Stage 5 (D-68). The delivered
Living Atlas remains the foundation; this expansion adds the campaign, real player agency, schema 5
and a multi-resolution premium atlas.

Baseline: `b428f06278457ad9248019c325b014856cf450ae` (the final commit of the first Stage 5 pass).
Final implementation commit and CI links: §12.

---

## 1. What was reopened

The first Stage 5 was a presentation/QA pass with an explicit no-new-gameplay rule. The owner
replaced that rule for this work: the product needed a reason to play as well as a better map. The
amendment is recorded in `TECHNICAL_DECISIONS.md` D-68; the contract documents were updated before
implementation.

There is still no Stage 6. Stage 5 now contains the Living Atlas **and** the Stewardship Campaign.

---

## 2. Gameplay delivered

### 2.1 Two modes

- **Stewardship Campaign** is prominent in the creation flow: choose one of five legacies, then
  choose the people you will steward from the real civilizations in the new world.
- **Free Sandbox** is the original experience: no campaign state, no objectives, no charters, all
  six layers and the four powers.

### 2.2 Five legacy paths

| Legacy | Long-term goal | Chapters |
|---|---|---|
| Haven | Outlast hunger, disease and ecological pressure | 5 sustained food/health/population conditions |
| Concord | A durable treaty network and real peace | 5 treaty/peace conditions |
| Prosperity | Trade, treasury and food security | 5 route/treasury/food conditions |
| Enlightenment | Literacy, academies and technology | 5 literacy/tech/academy conditions |
| Renewal | Restored fertility and vegetation | 5 fertility/vegetation/crisis-free conditions |

Thresholds are measured relative to the founding baseline, so every world is winnable but not
identically difficult. Each completed chapter advances an era: Foundations → Consolidation →
Flourishing → Trials → Legacy.

### 2.3 Real objectives

Six condition families (food crisis, diplomatic tension, lost trade, ecological damage,
scholarship, growth) generate offers from authoritative state. The system enforces two active / two
offered, duplicate prevention, a 540-day cooldown, 180-day offer expiry, real deadlines, explicit
failure and recovery, stable ids and determinism. Declining is free. No offer is generated when
the condition or a valid target does not exist. A failed offer cannot permanently softlock the
legacy chain.

### 2.4 Civic charters

Six charters (Food, Trade, Scholarship, Concord, Defence, Ecology) modify **real utility scores**:
buildings, trade pair value, research speed, yearly relations and ecological extraction/recovery.
One charter per people, 1–3 slots, ten-year terms, replacement ends the old term. The exact bias is
written into the decision ring and shown with the decision it influenced. No charter grants a
building, army or resource, and none bypasses the four-condition war gate.

### 2.5 Progression

No XP and no spendable currency. Each completed objective earns one Mandate Seal (max 99); each
three seals unlock one charter slot. This is the only meta-resource, with a real source, a bounded
use and no power creep. Chapters and eras are the narrative progression; the legacy conclusion is
earned by sustained results.

### 2.6 Endgame

Five completed chapters record `completed`, a historic event and a legacy conclusion with the
steward people, years, seals, chapters and measured population. The civilization and world are not
reset or deleted; the player can continue in endless stewardship. The game remains playable.

### 2.7 Failure and recovery

If the steward people lose every settlement, the board offers a successor people; earned chapters
and seals are kept, live objectives close, and a new baseline is measured. A v4 save loads as Free
Sandbox; a v5 world missing its campaign block is corrupt and follows the existing recovery path.

---

## 3. Player-agency evidence

These are real, automated consequences, not UI descriptions:

- **Charter influence:** a Food charter produces a recorded `+30` utility bias on granary decisions;
  the identical no-charter world records zero positive bias, and the two checksums differ. The same
  test proves the bias is not a cosmetic counter.
- **Food crisis loop:** a genuine shortage (<20 food days) generates a food offer; accepting it and
  recovering the target settlement's stock for 60 days completes it and awards a seal.
- **Objective completion/cancellation:** accepting is valid once; declining makes acceptance
  invalid; an expired offer is `EXPIRED`; a missed deadline is `FAILED`; cooldown creates a new
  opportunity later.
- **Trade/concord/scholarship/ecology hooks:** unit tests assert the exact ×1.15 trade pair, ×1.20
  research, +2 relation drift and ecology caretaking state after issuing the corresponding charter.
- **Persistence:** objective, charter, seal and milestone state survive save/reload; schema 5,
  checksum v7.
- **Scripted journey:** three seeds × 50 years through the real pipeline generate 24 objective
  offers, accept 92 real offers, complete objectives (seals 3/3/0), advance every seed to era 3 and
  maintain zero invariant failures.

---

## 4. Visual transformation

### 4.1 Atlas pipeline

- Overview bake raised from the 896 px ceiling to **1536 px high / 1280 balanced / 1024
  performance** (D-70). 1536 is 2.4× the linear resolution and 5.7× the pixels of 896.
- **Regional detail chunks**: 16-tile chunks at 48 px/tile, and 8-tile close chunks at 96 px/tile,
  from the same deterministic grids. LRU cache of 10 textures, explicit destroy, world-space
  seam-aligned samples, overview always beneath as a fallback.
- **Art direction**: mineral survey plate, warm paper, one NW sun, biome colour blending, canopy
  and field texture, dune/rock/snow families, continuous water depth stops, river banks and
  highlights, marching-squares smooth coastlines with foam, paper grain. No invented geography.
- **Settlement detail**: local-zoom footprints built from real infrastructure bits — walls,
  towers, fields, roads, granary, well, irrigation, market, workshop, temple, academy, aqueduct,
  barracks, harbour — with deterministic variation, capitals and ruined variants. Overview dots
  and regional glyphs remain.
- **Campaign map layer**: steward capital ring and flag, objective diamonds on real targets,
  civ-coloured halos on chartered capitals.
- **Quality setting**: High / Balanced / Performance in Settings; simulation results unchanged.

### 4.2 Evidence

`docs/qa/stewardship/` contains 13 real captures: creation, people choice, board, objective offer,
charter choice, mature board, mature steward map, capital detail, high-detail coast, charter/metrics,
200 % text at 320 dp, Persian board and Persian map. The Living Atlas captures at `docs/qa/stage5/`
were regenerated by the same final build, so the two sets share the 1536 px pipeline. CI uploads all
44 captures together (`visual-qa-ac9f3c4…`, 4,345,124 B).

### 4.3 Honest visual limits

This is a much higher-resolution, coherently art-directed procedural atlas, not a hand-painted asset
pack. Close zoom in a uniform biome is still quiet, settlement footprints are schematic, and lakes
that occupy one grid cell remain rounded squares. These are recorded as D5-25/D5-26 and are the
next visual investment; they are not claimed as a finished premium illustration.

---

## 5. Persistence and determinism

- **Schema 5**. The campaign block lives in the meta shard; the four shards and the v1–v4 migration
  path are unchanged.
- **Checksum v7** hashes the campaign block and the decision-bias column; the golden fixture still
  pins grid content, not the integrity checksum.
- v1 → v2 → v3 → v4 → v5 migrations are pure and ordered. A v4 world becomes a genuine Free
  Sandbox world with an empty campaign block.
- Objective and charter state, seals, milestones and baselines round-trip exactly; the 50-cycle
  stress test remains green (extended to schema 5).
- The campaign phase runs every five simulated days, not every tick, so the simulation budget is
  protected; sustained conditions still use real simulated days. No RNG was added.
- Free Sandbox remains byte-equivalent in rules; no campaign phase runs without a begun campaign.

---

## 6. Architecture

- `sim/campaign/` — types, allocation, measurement, milestones, objectives, charters, codec, run.
- `campaign` is a `WorldState` field; the worker owns it. The main thread only projects it.
- `settlementMeta`, `MirrorDelta` and `SettlementLayout` now carry the real infrastructure
  bitfield (a `Uint32Array`) so the renderer cannot invent a building.
- Worker commands: `campaign` begin/accept/decline/charter; a structured `commandResult` and no UI
  success before the worker accepts.
- Renderer: `terrainPaint` shared pixel language, `terrainBake` overview, `terrainDetail` chunk
  cache, city footprint Graphics, campaign marks, explicit quality and destruction.
- Settings quality is UI-only; campaign state is world state.

---

## 7. Tests and evidence

| Suite | Result |
|---|---|
| Typecheck / lint / repo gates | pass |
| Unit + integration | **129 tests / 20 files** |
| Campaign legacies/objectives/charters/state | 12 new campaign tests |
| Browser E2E | **15 tests** (13 previous + 2 stewardship) |
| Visual QA | **44 captures** (31 Stage 5 + 13 stewardship) |
| Campaign journey harness (CI) | 3 seeds × 50 years, **0 invariant failures**, 24 offers, era 3, 6 milestones + 6 holds, seals 3/3/0, 1–2 active charters/seed |
| Determinism / hydrology | CI verify |
| Balance | 20 × 400 Medium + 1 × 500 Large |
| Save stress | 50 round trips, schema 5/checksum v7 |
| Android | **APK 5,637,166 B (5.64 MB)**, **debug AAB 4,830,342 B (4.83 MB)**, 25 MB check pass |

New tests:

- `tests/campaign/campaign.test.ts`: baseline, real charter bias, food crisis completion, schema 5
  round trip, v4→v5, determinism.
- `tests/campaign/legacies.test.ts`: all five chains to completion, post-completion save/play, all
  charter hooks, objective acceptance, schema-4 sandbox load.
- `tests/e2e/stewardship.spec.ts`: setup → choose people → real objective → charter → save/reload;
  sandbox has no campaign chrome.
- `tests/visual/stewardship.spec.ts`: 13 real captures, including 200 % at 320 dp and Persian RTL.
- `scripts/assert-campaign.mjs` + balance workflow campaign step.

---

## 8. Performance

Measured on the documented 2-vCPU / 2 GB development box; CI numbers are recorded in §12.

| Metric | Value | Note |
|---|---|---|
| Overview bake (1536 px) | **~2.4–2.9 s** | down from 2048 (~3.4 s); the old 896 px cap was ~0.65 s on CI; CI is faster than this box |
| Campaign simulation | 80 years in **~6 s** in Chromium (worker), 80 years in **1.9 s** headless Node | 5-day campaign cadence |
| Detail chunks | 16 tiles @ 48 px; 8 tiles @ 96 px; 10-texture LRU | generation staggered ~90 ms |
| Settlement detail | local zoom only; redraw on dirty/zoom/pan ≥ 1 tile | no per-frame rebuild |
| Campaign queries | on board open / day change while open | not per tick |
| Tick budget | campaign phase every 5 days | documented trade-off |

**Not yet measured on a real A23**: frame time, chunk-generation hitch, texture memory, thermal
drift, cold start. Those remain device gates. No device number is claimed.

---

## 9. Android

CI `android` run [46003826241](https://github.com/khiyarusa/world-simulator/actions/runs/46003826241)
produced the debug APK (**5,637,166 B / 5.64 MB**) and debug AAB (**4,830,342 B / 4.83 MB**), and the
25 MB check passed. The APK grew only ~110 KB over the first Stage 5 artefact: the premium atlas is
generated at runtime, so the visual increase does not ship unlicensed texture packs. A signed release
AAB remains a release task, not a code-complete claim.

---

## 10. Skills and sources actually used

| Source | Version / commit | Licence | Concrete influence |
|---|---|---|---|
| `gamedev-router` (vendored) | repository copy | Apache-2.0 | Fingerprinted PixiJS 8 + worker + IndexedDB; routed to rendering, UI, performance, saves; no engine change |
| `pixijs-rendering` (vendored) | PixiJS 8.x guidance | Apache-2.0 | Container layering, one ticker, explicit texture destroy, world-space containers for chunks, `CanvasSource` textures |
| `game-ui-ux` (vendored) | repository copy | Apache-2.0 | Board as an overlay, safe areas, wrapping tabs, event-driven strip, 320/390/412 + 200 % size sweep |
| `performance-optimization` (vendored) | repository copy | Apache-2.0 | Measure-first; 5-day campaign cadence; chunk LRU; no per-frame city/selection rebuild; budget sheet |
| `save-systems` (vendored) | repository copy | Apache-2.0 | Schema 5, ordered migrations, defensive decode, checksum, round-trip stress |
| `create-game-assets` (vendored) | repository copy | Apache-2.0 | Art bible, asset provenance, no unverified AI art; procedural-only decision |
| ForgeSkills README | `main`, inspected 2026-11-27 | Apache-2.0 | Adopted measure → build → render → compare → fix-one-cause and “artifact or it did not happen”. Did not run its Blender/Godot tools (no 3D need, no Godot). |
| Red Blob Mapgen4 | 2018/2023/2025 notes, inspected | CC BY-NC? site content; methods only | Hand-drawn map look: side-view relief cues, smooth coast/river outlines, contour ink, biome materials. No code copied. |
| PixiJS performance guide | URL consulted; empty response | MIT | The same principles were applied from the vendored pixijs-rendering guidance; no API claim is made from the empty fetch. |
| Android texture guidance | developer.android.com | site terms; guidance only | Atlas/filter/compression guidance; ASTC/ETC2 recorded as **not applicable** while the atlas is a runtime canvas. Mipmap/device filtering remains a device-pass item. |
| MDA framework | AAAI WS04-04-001 | academic citation | Used as the table in `STEWARDSHIP_DESIGN.md` §2; every mechanic states decision → state → trade-off → feedback. |

Not used: Blender/MCP (no 3D asset requirement), ForgeSkills Godot/Unity/Blender procedures (wrong
engine / not needed), audio/shader skills (no shader or audio work), LLM runtime AI (out of scope).

---

## 11. Remaining defects

| ID | Severity | Status |
|---|---|---|
| D5-25 | Medium | Close zoom in a uniform biome remains visually quiet; settlement footprints are schematic, not painted. Open for the device/art pass. |
| D5-26 | Low | A one-cell lake reads as a rounded square at deep zoom; a distance-field water mask is the next fix. Open. |
| D5-27 | Medium | The five legacies share the chapter machinery and six objective families; they are distinct in metrics, not bespoke mission scripts. Accepted design limit. |
| D5-28 | Low | The legacy conclusion is a designed board summary, not a cinematic. Accepted. |
| D5-29 | Medium | Physical device frame time/thermal/cold start and chunk hitch are unmeasured. Pending A23. |
| D5-30 | Low | Detail-chunk seams are sampled from one continuous field, but no automated pixel-seam test exists; visual inspection is manual. Open. |
| — | Release | Signed AAB, Play listing, device cycle pending. |

No P0/P1 software failure is known. CI gates are the authority; the device gates are not claimed.

---

## 12. CI and final SHA

Implementation commit **`ac9f3c4d79b0dd4c0021d6ccef22ac56c8cabdea`** (`ac9f3c4`), pushed to `main`
without rewriting history. All workflows on that exact SHA passed:

| Workflow | Result | Run |
|---|---|---|
| `ci` (verify) | success — typecheck, lint, gates, **129 unit**, determinism, hydrology, build, **15 E2E**, **44 visual captures** (6 m 55 s) | [46003826191](https://github.com/khiyarusa/world-simulator/actions/runs/46003826191) |
| `android` | success — APK 5,637,166 B / AAB 4,830,342 B, 25 MB check | [46003826241](https://github.com/khiyarusa/world-simulator/actions/runs/46003826241) |
| `balance` | success — 20×400 (0 failures), 500-year Large (heap 100 MB), **3×50-year campaign** (0 failures, era 3) | [46003826272](https://github.com/khiyarusa/world-simulator/actions/runs/46003826272) |
| `perf` | success — 50-year benchmark and budget regression | [46003825931](https://github.com/khiyarusa/world-simulator/actions/runs/46003825931) |

Artifacts: `visual-qa-ac9f3c4…` (4,345,124 B, 44 JPEGs), `balance-ac9f3c4…` (40,635 B:
`balance.json`, `stress.json`, `campaign.json`), `world-simulator-debug-ac9f3c4…` (10,013,443 B
zipped APK+AAB). This report's links and numbers are a follow-up documentation commit; the
implementation SHA above is the code that was verified. The device gates in §9 remain **PENDING**
and are not implied by green CI.

Acceptance (software):

| Gate | Status |
|---|---|
| Two modes, five legacies, five chapters each | PASS |
| Real objectives, validation, dedupe, expiry, recovery | PASS |
| Charters alter real utility decisions and show the bias | PASS |
| Campaign/objective/charter state survives save/load | PASS |
| Completion conclusion + continued play | PASS |
| Free Sandbox unchanged | PASS |
| 1536 atlas + multi-resolution chunks + quality levels | PASS (software) |
| Smooth coast, richer terrain, infra-driven settlements | PASS (software; limits D5-25/D5-26) |
| Persian/English/200 %/320 dp | PASS (software) |
| Determinism, conservation, schema migrations | PASS |
| Android APK/AAB, size budget | PASS (CI) |
| A23 frame time/thermal/cold start/memory | PENDING |
| Signed release AAB | PENDING |

CI evidence (ac9f3c4): 129 unit / 20 files, 15 E2E, 44 captures, 20×400 + 500y + 3×50y campaign,
APK 5.64 MB / AAB 4.83 MB. Device remains the only unverified release axis.

Verdict: **software-complete, device-pending.** Not “finished” in the owner's full sense until the
A23 cycles in §9 are performed.
