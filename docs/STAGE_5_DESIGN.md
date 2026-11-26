# STAGE 5 — LIVING ATLAS OVERHAUL: DESIGN AND VISUAL DIRECTION

Status: software-complete, physical-device pass pending. This document is the implementation contract
for the final stage. It describes the visual system, the UX changes, the defect ledger and the
technical limits. Evidence lives in `STAGE_5_REPORT.md`; measurements in `PERFORMANCE_BUDGET.md`.

---

## 1. Starting point and non-negotiables

Baseline: `b8801111007aab7f0f081944743329edb21f50ea` (Stage 4, software-complete, device-pending).

The simulation, worker ownership, one-day tick, deterministic RNG, conservation, four-shard saves,
schema 4, checksum v6 and generator version 1 are unchanged. Stage 5 changed presentation, UI,
queries' performance, onboarding/settings, QA and documentation. It added **no sixth layer, no fifth
intervention, no new gameplay system and no persisted world field**.

---

## 2. Visual target: “a living survey atlas”

The map is a survey plate, not a dashboard. It has three materials:

| Material | Use | Tokens |
|---|---|---|
| Deep water | page surround, letterbox, thumbnail ground | `#102129` → `#2a4b59`, CSS radial + fine diagonal grain |
| Survey paper | terrain, panel ink, cartouche | `--paper #e8dcc0`, warm mineral palette |
| Mineral ink | borders, rivers, labels, controls | `--accent #c8a05a`, `--accent-2 #6f8f8a`, `--danger #b8503c` |

### 2.1 Composition

- The Pixi canvas is **transparent**; the sea is a CSS composition behind it, so the square world
  reads as an atlas plate on a page rather than a video in a black letterbox.
- A cartouche (`atlas-plate`) sits in the top margin: tagline + population / settlements / peoples.
- Compass and a live scale bar sit in the lower margin; the scale value is derived from camera zoom
  (`54 px / (zoom × 32) × 3 km`, 1 tile ≈ 3 km).
- The world is never cropped or distorted by default; fit-to-world remains the opening camera.

### 2.2 Terrain

- One deterministic bake (max 896 px) from the real elevation, moisture, temperature, biome,
  hydrology, resource and lake grids.
- Bilinear base elevation with nearest-cell relief neighbours, NW hillshade, local curvature,
  altitude/moisture washes, contour hints on slopes, biome grain (forest stipple, dry tooth), depth-
  graded water, connected river polylines, lake/coast ink and a 4.5 % paper grain.
- The bake is intentionally sized for a phone: 896 px is close to the fit width (≈780 CSS px) at
  1×; the measured bake is ~0.65 s on the CI software renderer. A device bake budget is recorded in
  `PERFORMANCE_BUDGET.md`; no per-frame terrain work exists.

### 2.3 Settlements

- Five tiers keep distinct silhouettes (tents → huts → walled town → towered city → double-ring
  metropolis), plus a ruined variant.
- Screen-constant markers: 18 / 23 / 29 / 37 / 46 px (capital ×1.08).
- Level of detail:
  - zoom < 0.105 → coloured dots (size from tier/capital), no glyph pile-up;
  - 0.105–0.28 → glyphs for capitals and tier ≥ 2 only;
  - ≥ 0.28 → every glyph.
- State marks are screen-space: capital ring/crown, occupied banner, starving/prosperous dot, blight
  ring. They come only from the worker's state bits.

### 2.4 Layers

| Layer | Visual grammar |
|---|---|
| Political | civ-colour territory wash, ink borders, capital diamonds, red active-war edges, teal treaty edges, occupied rings |
| Terrain | the base atlas, no overlay |
| Population | screen-space halos sized by population; migration origins as hollow rings |
| Economy | gold wealth rings, red shortage crosses, route lines weighted by volume |
| Ecology | normalized fertility/vegetation/moisture/temperature ramps, drought/blight rings and areas |
| History | one severity-sized pin per settlement (latest most severe event), player events in the feed |

Layer switching is instant, stable under the camera, and keeps the selected settlement. Raster
layers are rebuilt only on layer change or after 30 simulated days (90 for political, 180 in low-power
mode). The vector layer uses one `Graphics` and screen-space radii; it is rebuilt on layer/zoom change,
never per frame.

### 2.5 Panel language

- Hero: 24 px identity, civ link, actions.
- “At a glance” insight: one measured risk/opportunity sentence, not decoration.
- Stat cards: 3-up on phone, compact values for long numbers, two-line labels.
- Sections are bordered mineral cards with a gold section label; charts are dark plates with LTR
  min/max labels even in RTL.
- Tabs wrap into two rows so all six panels remain reachable at 320 dp and 200 % text.

### 2.6 Design tokens

Colors, surfaces, spacing, radii, motion and type scale are in `src/ui/styles.css` (`:root` plus the
Stage 5 block). Text uses `calc(Npx * var(--text-scale))`; settings set `--text-scale` 1–2. Surfaces
use `linear-gradient` + hairline borders rather than heavy shadows. No full-screen blur, no map
shake, no animated water.

### 2.7 Motion

- Selection ring alpha pulse only when neither reduced motion nor low power is active.
- CSS transitions: 200–240 ms, disabled by `html[data-motion=reduced]` and by the system preference.
- Map state changes are communicated by static shape/colour/text as well.

---

## 3. UX and interaction

- Top bar: world name, date, compact save dot (tap to save), settings, menu. The save sentence is
  hidden on phone to give the date enough room; its state is in the dot and the World panel.
- Bottom arc: Layers, Speed, Menu. Left-handed mode reverses the arc; the map is never mirrored.
- Layer sheet: six layers with descriptions; ecology exposes the four real metrics.
- Settings sheet: language, text size (100–200 %), motion (system/reduced), handedness, low power,
  replay onboarding. Stored in `ws.prefs.v1`, never in the world save.
- Onboarding: three contextual coach marks; step 2 advances when a settlement is selected, step 3
  when a layer/panel is used. Dismissible; completion is persisted.
- Panels: six tabs, cross-links (settlement ↔ civilization, event → map/actor, shortage → settlement,
  civ war/relation → civ), event cause chain, chronicle.
- World management: list with real thumbnail, play/rename/delete, save status, autosave.

---

## 4. Defect ledger (found in the audit and during visual QA)

| ID | Severity | Defect | Evidence | Fix | Regression |
|---|---|---|---|---|---|
| D5-01 | Critical | Settlements founded after load never reached the renderer/HUD; a 200-settlement world still showed 6 markers and “6 settlements” | mature capture at 200y with query showing 200 | new `settlementMeta` message carries live layout/civs/capitals; renderer rebuilds sprites/labels, HUD summary updates | E2E mature world; visual 05 |
| D5-02 | High | Political layer scanned O(land × settlements); comment said 10 tiles while code used 18 | code audit + 200-settlement profile | deterministic 18-tile bucket grid; exact tie-break; byte-equality test against reference | `tests/worker/layers.test.ts` |
| D5-03 | High | Selection `Graphics` was cleared/filled every frame | `applyTransform()` hot path | redraw only on selection/zoom change; pulse via alpha | visual/selection smoke |
| D5-04 | High | Documented P0 settings and onboarding were absent | shell audit; translations only | real settings sheet + three contextual coach marks + persistence | Stage 5 E2E |
| D5-05 | Medium | Terrain was a soft colour chart; coastline read as a dotted edge; rivers were rectangles | Stage 4 captures | higher-resolution bilinear relief, curvature, contours, connected rivers, coast/lake ink, muted beach | before/after captures |
| D5-06 | Medium | Labels disappeared at the fit zoom (threshold 0.07 > actual 0.063), and could overlap/clip | camera/label audit | threshold, collision boxes, viewport clamp, priority, LOD limits | Stage 5 captures |
| D5-07 | Medium | Chart min/max labels reversed in Persian RTL | world/economy captures | `direction: ltr` on chart ranges | visual 15/17 |
| D5-08 | Medium | HUD counts were stale after founding | same as D5-01 | live settlement meta + map stats each delta | E2E mature |
| D5-09 | Medium | 200 detailed glyphs formed an unreadable pile at overview | mature capture | screen-space dot LOD and tier visibility threshold | visual 05 |
| D5-10 | Medium | Vazirmatn Medium/Bold faces failed to load (zero-width text) | font probe | ship the verified Regular face; synthetic weights; removed unused WOFF2 | visual headings |
| D5-11 | Medium | Saved-world thumbnails had black letterbox bars | world list capture | centred square crop + sea fill in `snapshotDataUrl` | visual 29 |
| D5-12 | Medium | Tier chip said “Village” inside Persian UI | landscape capture | `t()` tier labels and locale number formatting in the session | E2E/visual |
| D5-13 | Low | Long stat values clipped | economy/settlement captures | compact values + two-line stat labels | visual 15/17 |
| D5-14 | Low | Panels re-queried even when the simulated day had not changed | session review | day-gated refresh (4 s while running) | code/test |
| D5-15 | Low | History pins piled on the same settlement | historical layer audit | one latest-most-severe pin per place; panel keeps every event | visual 12 |
| D5-16 | Low | Legacy `sparkline` said “No data” for one sample | charts audit | one sample renders a flat line | unit/visual |
| D5-17 | Low | No numeric scale on the map | composition audit | live km scale from zoom | visual |
| D5-18 | Low | Ecology layer exposed only fertility | feature audit | real fertility/vegetation/moisture/temperature metrics + normalized ramps | E2E metric test |
| D5-19 | Low | TypeScript decision said 7 while package pins 6.0.3 | docs audit | D-59 supersedes D-01 with the tested toolchain | docs |

No issue was closed by suppressing a test. Every behavioural fix has a test or a real capture.

---

## 5. Persistence and compatibility

Stage 5 does **not** change the save shape. It keeps schema 4, checksum v6, the four shards, current
+ previous generation recovery and all migrations. Settings/onboarding live in `localStorage`; the
world document gains no UI state. The save/load stress test runs 50 consecutive round trips with a
player intervention and a mature population ring, asserting identical checksums.

---

## 6. Performance design

- Terrain bake once per world load; 896 px cap; measured ~0.65 s on CI software rendering.
- Layer query and render on change/30 days (political 90, low-power 180); no tick rebuild.
- Political query spatial buckets, exact result; measured ~90 ms including render at 200 settlements
  on CI software rendering.
- Selection redraw off the per-frame path; LOD reduces marker draw work at overview.
- Panels refresh only while open and only when the day changed, at most every 4 s.
- History pagination is 50 events; chronicle 40 rows; layer history pins ≤ 100 and clustered.
- No new runtime dependency, no blur/shader, no full-screen effect.

Device frame times, memory and thermal behaviour remain **pending**; CI numbers are not device
measurements.

---

## 7. Deferred / not claimed

- Physical Galaxy A23 frame-time, touch, TalkBack and 15-minute thermal measurements.
- A second high-resolution terrain detail bake at deep zoom (the 896 px atlas is the deliberate
  Stage 5 compromise for startup cost; the limitation is documented).
- Territory is still a nearest-settlement projection, not a simulated border grid.
- Migration lines are not drawn to coordinates the event format does not contain.
- Per-settlement daily production history is not persisted; the economy panel reports real stocks,
  prices, cumulative flows, routes and shortages.
- Audio (P1) and export/import (P1) remain out of Stage 5 scope.
