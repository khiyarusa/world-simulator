# ART BIBLE — THE LIVING SURVEY ATLAS

Owner-authorized premium direction for the reopened Stage 5. This is the standard used by the
terrain bake, the detail chunks, the settlement footprints and the campaign overlays. It is also
the checklist for rejecting an asset or a render.

---

## 1. One-sentence direction

**A living survey atlas**: a mineral-ink cartographic plate, printed on warm paper, where the land
is worked and the cities are built — top-down and legible, never a satellite photo and never a
generic strategy HUD.

## 2. Shape language

- **Land**: broad, soft, hand-drawn masses. No perfect circles, no grid-aligned biome squares.
- **Water**: long, calm bands; coastlines are contours, not stair steps. Lakes are soft-edged
  ponds, even when the simulation stores them as one tile.
- **Settlements**: clustered, asymmetric footprints. A city is a dense cluster inside a wall, not
  a larger dot. A camp is open, a metropolis has a second ring and a monumental centre.
- **UI**: thin 1.7 px strokes, rounded 10–18 px plates, gold section rules, restrained shadows.
  The map is the hero; panels are lecterns, not dashboards.

## 3. Value structure

| Layer | Value | Role |
|---|---|---|
| Sea page | 6–16 % | quiet surround, keeps the atlas plate readable |
| Land base | 45–78 % | biome identity; never pure white |
| Relief shadow | 24–65 % | NW light, one sun, no mirrored embossing |
| Ink lines | 15–30 % | coast, rivers, walls, labels |
| Gold accent | 60–80 % hue | section rules, capitals, stewardship |
| Text | 88–96 % | warm ivory, never #fff |

The highest-value element on the map is the **steward's capital** and the **current objective**;
everything else recedes. If a decorative material is brighter than those, it is wrong.

## 4. Palette roles

| Role | Token | Use |
|---|---|---|
| Deep sea | `#102129` → `#2a4b59` | page surround, thumbnail ground |
| Survey paper | `#e8dcc0`, `#f4e9cd` | land wash, cartouche, grain |
| Mineral ink | `#3a3226` | coast, rivers, wall ink, small text |
| Gold | `#c8a05a` | capitals, sections, legacy, objective rings |
| Sage | `#8fae9a` | success, fertility, active objective |
| Rust | `#b8503c` | war, occupation, hazard, failure |
| Civ hues | 12 categorical | banners, charter halos, political ink |

Biome families: temperate/boreal/tropical forest (olive → deep green), grassland (warm olive),
steppe/savanna (ochre), desert (pale sand, never neon yellow), wetland (blue-green), tundra
(grey-green), glacier/snow (cool ivory), highland (grey-brown). Red is not a terrain colour.

## 5. Material treatment

- **Paper**: 4.5–6 % monochrome grain at overview; 3.5 % in detail chunks. No visible tiling.
- **Relief**: bilinear elevation at ±0.82 tiles, NW light, curvature and slope; no hard cell
  shading. Ridges darken; snow appears only above the real altitude threshold.
- **Forest**: low-frequency canopy patches + fine leaf noise; never hard squares.
- **Dry land**: dune banding and grit; no repeated stamp.
- **Rock**: slope-driven stone tint, contour ridges, striations at detail.
- **Water**: continuous depth stops (no hard 500 dm band), coastal sand tint, wave/caustic noise
  at detail. No animated water in this stage.
- **Rivers**: dark bank, mid ink, pale highlight; widths follow the real `riverWidth`.
- **Coast**: a smooth marching-squares contour, a wide pale foam under-stroke, then a thin dark
  ink line. No per-tile stair steps.

## 6. Detail hierarchy

| Zoom | What must be legible | What is dropped |
|---|---|---|
| Fit / overview | land mass, biome families, capitals, 200 settlements, scale | individual buildings, minor rivers |
| Regional (≥0.55) | coastline, river courses, fields, towns, detail chunks | building interiors |
| Local (≥0.62) | city footprint, walls, infrastructure silhouettes, objective rings | low-value terrain micro-noise |
| Deep (≥3) | building roofs, granary/temple/academy/aqueduct marks, foam | overview-only labels |

LOD transitions are thresholds with a short alpha fade; no popping settlements, no half-loaded
chunk visible without the overview beneath.

## 7. Settlement architecture

- **Camp** — 2–4 open tents, a fire/meeting point, no wall.
- **Village** — 3–6 huts, small worked fields, a path; wells/granaries only when built.
- **Town** — denser blocks, a wall ring when `walls` is set, market/workshop silhouettes when
  built, a gate and towers.
- **City** — wall, four towers, a keep/plaza, academies/aqueducts/barracks only when the real
  bitfield says so.
- **Metropolis** — second ring, eight towers, dense districts, a civic centre; no invented
  monument unless an academy/temple is present.
- **Ruined** — broken wall arcs, rubble, no fields/roofs; the silhouette remains.

Infrastructure iconography: granary silo, well ring, irrigation channels, wall, market awning,
workshop chimney, road spokes, temple dome, academy tower, aqueduct arches, barracks block,
harbour dock and boat. Colour is a civic accent, not a tier code.

## 8. Lighting and composition

- One sun, north-west, 35–45°. Shadows fall south-east.
- The atlas plate is centred; the cartouche and compass/scale live in the margins. The world is
  never cropped or stretched by default.
- UI surfaces are dark mineral plates with a 1 px warm border; no glassmorphism, no neon.

## 9. Asset resolution and provenance

- All terrain and settlement art is **procedurally generated at runtime** from the simulation
  grids and real infrastructure bits. There are no downloaded texture packs and no AI-generated
  binary art in this stage.
- Overview: 1536 px texture (high), 1280 balanced, 1024 performance.
- Detail: 16-tile chunks at 48 px/tile; 8-tile close chunks at 96 px/tile; LRU 10.
- Settlement glyph atlas: 64 px per sprite, 11 variants, nearest/linear filtering.
- Texture compression: not applicable while the runtime bake is a canvas; ASTC/ETC2 is a
  device-pass decision only if a future authored texture pipeline lands. The Android texture
  guidance is recorded in `SKILL_USAGE.md`.
- Provenance is procedural: source = this repository, licence = project licence. The only binary
  asset is the OFL Vazirmatn Regular face (50.7 KB + OFL).

## 10. Rejection test

Before a visual change is accepted:

1. Compare the same seed, camera, viewport, language and text scale.
2. Inspect at native resolution — not a contact sheet only.
3. Reject any of: visible biome squares, stair-step coast, hard water-depth band, tiled noise,
   building outside its wall without cause, invented infrastructure, bloom/blur used to hide
   detail, a settlement brighter than the objective/steward mark.
4. Measure the bake, chunk generation and frame-time cost; record it in `PERFORMANCE_BUDGET.md`.
