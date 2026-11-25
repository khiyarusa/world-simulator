# UX AND VISUAL DIRECTION — World Simulator

Interaction model, screen layout, visual projection and art direction for a touch-first Android
world simulator. Asset production specification lives in `ASSET_DIRECTION.md`; rendering
architecture lives in `TECHNICAL_ARCHITECTURE.md` §7.

---

## 1. Visual projection: **top-down 2D** (decided)

| Candidate | Cost on Adreno 610 | Legibility on a 6.4" screen | Simulation fit | Verdict |
|---|---|---|---|---|
| **Top-down orthographic 2D** | 1 flat quad for terrain + batched sprites | Borders, rivers, routes, heatmaps all read directly; no overlap ambiguity | 1:1 with the tile grid; overlays are trivial | **Selected** |
| 2D isometric | 2× tile count for the same area, depth sorting per frame, seams at every tile edge | Pretty, but labels, borders and heatmaps become ambiguous; settlements hide behind terrain | Needs a coordinate transform and painter's-order for every overlay | Rejected |
| 2.5D (top-down + relief/parallax) | Same as 2D plus one normal-map-ish shading pass, baked | Good | Fine | Partially adopted: **baked relief shading**, no runtime 3D |

**Decision:** top-down orthographic with **baked relief shading** (light from the north-west) and
paper-cartography styling. This buys 2.5D depth cues for zero runtime cost because the shading is
painted into the terrain texture at bake time, not computed per frame.

Why not isometric, in one line: *isometric doubles the geometry and makes the six information layers
the game depends on harder to read — and this game is about reading the map.*

Projection constants:

- 1 tile = 32 world pixels at zoom 1.0 in the *detail* bake; the world bake uses 10.67 px/tile for
  Medium (2048 / 192).
- North is always up. No rotation (rotation breaks the cartographic metaphor and costs a matrix
  rebake per gesture).
- No perspective, no tilt, no horizon.

## 2. Camera

| Property | Value |
|---|---|
| Zoom range | 0.25× … 8× (1.0 = 1 world px per CSS px) |
| Default on world open | fit whole world, centred, padded 8% |
| Pan | one-finger drag, 1:1 with finger, clamped to view bounds |
| Pinch zoom | two-finger, focal-point preserved, no rotation |
| Double-tap | zoom 2× toward the tap point |
| Inertia | yes, `1 − exp(−6·dt)` decay, cancelled by any touch |
| Smoothing | `1 − exp(−12·dt)`, frame-rate independent |
| Follow | none in P0 (no player avatar). Optional "follow selection" toggle in P1 |
| Bounds | view rectangle clamped inside the world rect; if the world is smaller than the view, centre it |

No camera shake. No screen effects that move the map. The world must be a stable object under the
player's fingers; motion in the world (effects, pulses) is drawn in world space, not applied to the
camera.

### 2.1 Zoom → detail (the only LOD the player sees)

| Zoom | Terrain | Settlements | Labels | Overlays |
|---|---|---|---|---|
| 0.25–0.5 | world bake, biome colours only | dots only, no icons | civ names only | routes + political |
| 0.5–1.2 | world bake, relief + rivers | icon + size ring | capitals + towns | all layers |
| 1.2–3 | detail bake (region) | icon + tier glyph + ring | + villages | all |
| 3–8 | detail bake, highest | icon + tier glyph + occupancy | + camp names, field texture | all + per-settlement bars |

Transitions are a single cross-fade (150 ms) between two bakes; never a per-tile pop.

## 3. Screen layout (portrait, primary)

```
┌──────────────────────────────────────────┐  ← status bar (safe area)
│ ‹Year 214 · Summer›      ⏸ 1×   ⚙        │  top bar 44 dp, 85% black, no blur
├──────────────────────────────────────────┤
│                                          │
│                                          │
│                 W O R L D                │  map: ≥ 75% of the viewport at rest
│              (touch surface)             │
│                                          │
│                                          │
│         ┌──────────────────┐             │  selection chip (appears on tap)
│         │ Oakford · Town   │             │  1 line, tap → sheet
│         │ 1,284 · ⚠ food   │             │
│         └──────────────────┘             │
├──────────────────────────────────────────┤
│  [Layers]      (speed dial)      [Menu]  │  bottom arc, 64 dp, thumb-reachable
└──────────────────────────────────────────┘  ← gesture bar (safe area)
```

- Top bar: 44 dp, three items only (date/season, speed, menu). It hides on downward pan and returns
  on upward pan or tap.
- Bottom arc: 3 targets. The centre is a **speed dial** (tap = pause/resume, long-press = 1/2/4/8
  radial). Left = layers. Right = world menu (save, worlds, settings, about).
- Selection chip: one line + one warning icon, max 45 % width, appears above the bottom arc, never
  covers the selected settlement (repositioned to the opposite half of the screen).
- Panels are **bottom sheets** (see §5), max 45 % height.
- Nothing floats over the map except the chip and a temporary event toast (3 s, top, single line).

Landscape (secondary): the sheet becomes a right-side panel (max 40 % width), the arc moves to the
right edge as a vertical stack. The layout is defined once in CSS with two media queries; there is no
separate "landscape build".

### 3.1 Touch targets and thumb zones

| Rule | Value |
|---|---|
| Minimum target | 48 × 48 dp |
| Primary action zone | bottom 25 % of the screen (portrait, right-handed default) |
| Left-handed mode | mirrors the arc to the bottom-left |
| Map gestures ignore UI | any touch starting on a UI element never pans the map |
| Palm rejection | second touch on the opposite edge within 80 ms of a pan start is ignored |
| Tap slop | 8 dp; a drag > 8 dp is a pan, never a selection |

## 4. Gesture and interaction model

| Gesture | Action | Notes |
|---|---|---|
| Tap map | select nearest settlement/cell (24 dp radius, nearest wins) | shows chip; no side effects |
| Tap empty map | clear selection | chip dismisses |
| Double-tap | zoom in 2× at point | disabled during a fly-to |
| Long-press (500 ms) | "inspect at point": terrain, biome, owner, event history pin | haptic light |
| One-finger drag | pan | inertia on release |
| Two-finger drag | pan (no zoom) | prevents accidental zoom while reading |
| Pinch | zoom, focal preserved | clamps at ends with rubber-band 8 % |
| Swipe down on sheet | dismiss | also a close button |
| Swipe between sheet tabs | switch tab (Settlement / Economy / History) | 3 tabs max |
| Back gesture / button | close top sheet, then deselect, then pause menu | never exits the app directly |
| Long-press speed dial | radial speed picker | 4 options + pause |

**No gesture has a destructive outcome.** Interventions require: open a sheet → "Influence" tab →
choose power → confirm sheet with the target named ("Blight the Oakford region? Cooldown: 3 years").
Two taps minimum, and the confirm names the target.

## 5. Bottom sheets (the only panel pattern)

| Property | Value |
|---|---|
| Height | content-sized, max 45 % of viewport, min 30 % |
| Corner radius | 20 dp top |
| Backdrop | none (map stays fully visible), a 1 dp top hairline |
| Animation | translate + fade, 220 ms, `ease-out`, respects reduce-motion |
| Dismiss | swipe down, close button, back, tap-map |
| Tabs | max 3, text-only, sticky header |
| Scrolling | inner scroll only; the sheet never expands the page |
| Content | numbers with units, sparkline (1 line), one sentence of interpretation |

Sheet contents (P0):

1. **Settlement** — name, tier, civ, population, health/stability bars, food reserve days, cohort
   split (one stacked bar), 3 key resources, top 3 recent events, "View history".
2. **Civilization** — name, capital, settlements, population, treasury, tech (12 dots), culture axes
   (3 short bars), relations list (sorted by tension), active treaties, wars.
3. **Economy** — production vs consumption per resource, 3 trade partners, price index, deficit
   warnings.
4. **History** — chronicle by year, filter by severity, "why?" affordance on every sev-4+ event.
5. **World** — seed, preset, day/year, population, civs, settlements, layer legend, save/export.
6. **Influence** — the four powers with cooldown state and a target picker.

**No modal dialogs** except: delete world (typed confirmation), schema-too-new error, and a crash
report prompt. Everything else is a sheet or a toast.

## 6. HUD and information design

- **Numbers never stand alone.** Every figure gets a comparator or a unit:
  `Food 14,220 (+38/day · 41 days)` — not `Food 14220`.
- Trends: a 30-day sparkline (≤ 120 × 24 px, one colour, no axes).
- Severity colours are paired with a glyph: ▲ shortage, ✕ war, ☀ drought, ✦ discovery.
- The world's own state is visible without any panel: starving settlements pulse a warning ring;
  active wars tint border segments; drought desaturates the biome tint.
- Toasts: max one at a time, 3 s, never stack, never for severity < 3.

## 7. Onboarding (90 seconds, no text walls)

1. **First launch** → world is already generating; a single line: "Your world is being born."
2. After generation: three coach marks, each dismissed by performing the action —
   *drag to look*, *pinch to zoom*, *tap a settlement*.
3. On first settlement selection: the chip appears with a one-line hint "Tap to open".
4. The speed dial pulses once after 20 s of watching at 1×.
5. No tutorial modal, no blocking overlay, no "tutorial level". Skippable via settings.

## 8. Accessibility

| Requirement | Implementation |
|---|---|
| Text size | 14–18 sp base, scales to 200 % with reflow; sheets scroll rather than clip |
| Contrast | ≥ 4.5:1 for body text, ≥ 3:1 for large text and key icons |
| Colour-blind safety | political palette is distinguishable in deuteranopia; every heat colour has a glyph |
| Motion | reduce-motion disables camera easing, pulses and effect animation |
| Touch | 48 dp targets; no double-tap-only action; no long-press-only action for essential features |
| Screen reader | DOM UI carries labels and roles; canvas exposes an accessibility summary ("Year 214, 6 civilizations, 87 settlements") |
| One hand | left/right handed arc mirroring; everything reachable below 75 % height |

## 9. Visual language

**Concept: "a living atlas."** The world looks like a hand-painted map that someone keeps updating —
not a strategy dashboard, not a toy, not a satellite photo.

| Aspect | Rule |
|---|---|
| Palette | muted earth tones; desaturated greens/blues; ink-brown borders; parchment cream for UI accents. No pure `#00ff00`, no neon gradients, no rainbow categorical colours. |
| Value structure | terrain is light-mid value; settlements are the darkest small elements; UI is dark-neutral so it recedes |
| Shape language | organic for land/water (noise-shaped, never straight coastlines), geometric for civic (walls, roads, grids), glyphic for settlements (distinct silhouette per tier) |
| Edges | terrain has soft, painterly transitions (dither + blend, no hard tile seams); borders are hand-drawn ink lines 1.5 px, slightly irregular |
| Lighting | single global light from NW, baked into relief shading; no dynamic lights in P0 |
| Detail density | high at zoom ≥ 3 (field textures, tree clumps), minimal at zoom ≤ 0.5 (colour fields only) |
| Motion | slow, organic: river shimmer (subtle), vegetation sway (off by default), event pulses; nothing bounces, nothing loops faster than 0.5 Hz |
| Typography | one serif display face for settlement names (cartographic), one humanist sans for UI; both bundled as subset WOFF2 (≤ 90 KB total) |
| Iconography | 2 px stroke, square-ish caps, monochrome in UI, 24 dp grid |

### 9.1 Terrain rendering

- Base: biome colour field from the world bake, with a paper grain overlay at 4 % opacity.
- Relief: hillshade from the elevation grid baked once (light NW, 45°), applied at 35 % over the
  biome colour. This is what makes top-down read as 3D.
- Water: three depth bands (shallow/medium/deep) derived from elevation, plus a thin ink coastline;
  rivers as 1–3 px tapered ink-blue strokes with a light highlight on one side.
- Snow/glacier: cool white with blue shadow, not pure white.
- Beaches: a 1-tile sand band with a stippled edge.

### 9.2 Settlements

- Silhouette per tier, readable at 16 px: camp = cluster of 3 dots; village = hut + field grid;
  town = wall ring + gate; city = wall + towers + a landmark spire; metropolis = concentric rings +
  multiple spires.
- Civ colour applied as a **ring**, not a fill (fill would destroy the silhouette and fail contrast).
- Population shown by icon scale (not by number on the map); number lives in the chip/sheet.
- Occupied = desaturated + a diagonal hatch; ruined = broken outline + ash tint.
- Selected = 2 px cream ring + 8 px glow (no animation beyond a 1.2 s breathing alpha).

### 9.3 Routes and borders

- Trade routes: 1.5 px, civ-coloured, dashed when under 50 % capacity, solid when healthy, animated
  dash offset at 0.4 Hz (disabled in reduce-motion and at zoom < 0.5).
- Borders: 1.5 px ink lines following tile edges, smoothed by a Douglas–Peucker pass at bake time so
  they do not look like pixel stairs.
- Active war front: 3 px double line with a slow pulse, only on the political layer.

### 9.4 Overlays

Each layer has exactly one encoding channel so layers can be compared mentally:

| Layer | Channel | Scale |
|---|---|---|
| Political | hue (civ colour) + border | 12-colour categorical palette |
| Population | dot size + alpha | 20–200 people/dot radius |
| Economy | line thickness + icon | 0–100 % capacity |
| Ecology | sequential heat (olive → ochre → rust) | vegetation/drought index |
| History | pin size + age fade | severity 3–5 |

## 10. UI theme tokens (single source: `ui/theme.css`)

```
--bg-panel:   #1b1a17ee     --text:        #ece5d8
--bg-panel-2: #262420       --text-dim:    #a89f8f
--accent:     #c8a05a       --danger:      #b8503c
--ok:         #6f8f5a       --warn:        #c08a3e
--border:     #3a362e       --map-paper:   #e8dcc0
--radius:     20px          --space:       8px grid (8/12/16/24)
--tap:        48px          --hairline:    1px
```

Contrast pairs are validated in CI by a test that parses these tokens and asserts WCAG ratios. A
theme change that breaks contrast fails the build — cheaper than an accessibility audit later.

## 11. What we deliberately do not build (visual)

- No 3D camera, no tilt, no rotation, no dynamic shadows.
- No bloom, blur filters, or shader post-processing on the world pass.
- No animated water shader in P0 (baked + a 1 Hz subtle tint shift if profiling allows).
- No particle storms, no weather particle systems (weather is shown in the layer, not as VFX).
- No character portraits or unit art (there are no units).
- No decorative loading screens with fake progress (generation progress is real).
- No title-screen art beyond the atlas motif (keeps first-paint fast).

Each of these is a performance or legibility decision, not a taste decision, and each is reclaimable
in a hypothetical Stage 6 that does not exist.
