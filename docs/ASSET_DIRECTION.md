# ASSET DIRECTION — World Simulator

Production rules for every visual asset. **No assets are produced in Stage 1** — this document
fixes the technical frame, the production path per category, the sizes, the QA gates and the licence
records so that Stage 4 can produce a consistent set instead of a pile of one-off images.

Derived from the `create-game-assets` skill: approve one visual target → produce families → normalise
deterministically → validate in context → record provenance.

---

## 1. Technical frame (locked)

| Parameter | Value |
|---|---|
| Renderer | PixiJS 8 (WebGL), single canvas, DOM UI above it |
| Projection | top-down orthographic, north up, no rotation |
| World bake | 2048 × 2048 px for the whole map (Medium: 10.67 px/tile) |
| Detail bake | 2048 × 2048 px covering the visible region at zoom > 1.2 |
| Settlement sprite sizes | 16 / 24 / 32 / 48 / 64 px square (camp → metropolis), drawn at 1× and 2× |
| Atlas budget | one 2048² RGBA atlas (16 MB GPU); a 1024² fallback on low-memory devices |
| Filtering | linear for terrain, nearest for pixel-aligned glyphs; `roundPixels: true` |
| Colour space | sRGB, no HDR, no tone mapping |
| Transparency | real alpha only — no baked checkerboards, no white mattes |
| Animation | sprite-sheet rows with fixed frame counts (below); no skeletal animation |
| Formats | PNG-8/PNG-24 for atlas sources, WOFF2 for fonts, SVG for UI glyphs |
| Total shipped asset weight | ≤ 6 MB (textures + fonts + audio), gzip/brotli counted separately |

## 2. Production path per category

| Category | Technique | Why | Where |
|---|---|---|---|
| Terrain colour field | **Procedural at bake time** (canvas 2D → RenderTexture) | 16 biomes × 65 k cells cannot be hand-painted; must stay in sync with the sim's biome ids | `render/terrainBake.ts` |
| Relief / hillshade | Procedural from the elevation grid | Free correctness: the lighting matches the real terrain | `render/terrainBake.ts` |
| Coastline, rivers | Procedural (tapered strokes) | Follows the actual hydrology grid | `render/terrainBake.ts` |
| Borders | Procedural (Douglas–Peucker smoothed) | Follows ownership, changes over time | `render/routes.ts` |
| Settlement icons | **Hand-authored SVG → atlas** (5 tiers × 2 states: normal/ruined) | Silhouette legibility at 16 px is an art problem, not an algorithm | `assets/atlas/settlements.*` |
| Resource icons | Hand-authored SVG (7 icons) | Must read at 16 dp in a sheet | `assets/atlas/icons.*` |
| UI glyphs (layer, speed, menu, warnings) | Inline SVG, 24 dp, 2 px stroke | Crisp at any DPR, colour via `currentColor` | `ui/icons/*.svg` |
| Faction colours | **Palette constants, no asset** | 12 categorical hues + ring tints | `render/palette.ts` |
| Effects (fire, dust, ships, refugees) | Small sprite sheets, 6–8 frames | Cheap, pooled, ≤ 64 instances | `assets/atlas/effects.*` |
| Paper grain / vignette | One tiling 256² texture, low contrast | Sells the atlas look without per-frame cost | `assets/textures/paper.png` |
| Fonts | 2 families, subset to Latin + digits + punctuation | Cartographic feel, ≤ 90 KB total | `assets/fonts/*.woff2` |
| Audio (P1) | Recorded/CC0 ambience + synthesized UI ticks | No music loop | `assets/audio/*` |
| Name generator | **Text data, no asset** (syllable tables) | 20k plausible settlement names from 4 tables | `sim/world/names.ts` |

### 2.1 Why so much is procedural

Because the world changes every day of simulated time: borders move, droughts spread, roads appear,
and 200 settlements change tier. Any hand-painted map would be a lie within one simulated year. The
split is: **the land is generated, the symbols are authored.**

## 3. Visual target (the one approved direction)

**"Living atlas, 19th-century survey, kept by hand."**

- Warm off-white paper ground shows only at the sea edges and in the UI; land is pigment on paper.
- Palette is mineral: ochre, olive, umber, slate, verdigris. Nothing saturated.
- Ink is the darkest value: borders, rivers, hatching, labels.
- The relief is subtle (35 % hillshade), never a mountain photograph.
- Settlement marks look stamped/vignetted, slightly imperfect, not clip-art.
- The overall read at arm's length: an old map with living ink.

A single reference image (a 512² crop containing coast, forest, river, one town, and a border) is
approved **before** any family is produced. Everything else is judged against it at actual device
scale, not at 100 % zoom on a desktop.

## 4. Palette (source of truth: `render/palette.ts`)

```
biome/ocean-deep   #2b4a5e     biome/ocean-mid   #3c6478    biome/ocean-shallow #5d8a9a
biome/beach        #d9c9a3     biome/grassland   #9aa86a    biome/steppe        #b8a878
biome/desert       #cbb083     biome/savanna     #a8a062    biome/temperate-f   #6f8a5c
biome/boreal       #55705a     biome/tropical-f  #4a7a52    biome/wetland       #7d927a
biome/tundra       #9aa79a     biome/glacier     #dfe6e6    biome/highland      #8d8578
biome/snow         #eef1ef
ink                #3a3226     paper             #e8dcc0    parchment           #d8c9a8
civ/1..12          #b4553f #4f7a8c #8a6f3e #6b7f4a #8c5a72 #b08a4a
                   #4a6b8a #7a5a4a #5f8a6a #a06a3a #6a5f8a #8a8a5a
ui/bg #1b1a17 · ui/text #ece5d8 · ui/accent #c8a05a · ui/warn #c08a3e · ui/danger #b8503c
```

Rules: no two adjacent civ hues within 25° of hue and 15 % of lightness; every heat scale is
monotonic in lightness; terrain never uses pure white except snow peaks; UI never uses a hue that
exists only in the terrain (avoids confusion).

## 5. Per-category specification

### 5.1 Settlement icons (the only "character art" in the game)

| Tier | Canvas | Silhouette | Frames |
|---|---|---|---|
| Camp | 16 | three dots + smoke wisp | 1 |
| Village | 24 | hut + 2 field strips | 1 |
| Town | 32 | wall ring + gate notch | 1 |
| City | 48 | wall + 3 towers + spire | 1 |
| Metropolis | 64 | double ring + 5 spires + aqueduct line | 1 |
| Ruined (any) | as tier | broken outline, ash fill, no glow | 1 |
| Occupied | as tier | normal silhouette + hatch pattern overlay (drawn, not baked) | 1 |

Requirements: readable as a black shape at 16 px on a mid-value terrain; no text; no gradients finer
than 2 px; the civ colour is applied as an outer ring by the renderer, never baked into the icon.

### 5.2 Effects (P1, capped)

`fire` 8 frames 32², `dust` 6 frames 24², `ship` 4 frames 24², `refugee` 6 frames 16². All loop at
≤ 6 FPS, ≤ 64 simultaneous instances, no additive blending (breaks batching on Mali).

### 5.3 UI icons (24 dp, 2 px stroke)

`layers`, `play`, `pause`, `ff-2x`, `ff-4x`, `ff-8x`, `settlement`, `civ`, `coin`, `leaf`, `scroll`,
`warning`, `chevron`, `close`, `gift`, `blight`, `fertile`, `incite`, `save`, `settings`.

Drawn as a family: same optical weight, same corner radius (2 px), same cap style, on the 24 grid
with a 2 px safe margin. Exported as a single SVG sprite sheet + individual files, inlined at build.

### 5.4 Fonts

| Role | Character | Constraints |
|---|---|---|
| Display (settlement names, chronicle headings) | Old-style serif, slightly condensed, high x-height | ≤ 45 KB WOFF2, Latin subset, weights 400/600 |
| UI (everything else) | Humanist sans, tabular numerals | ≤ 45 KB WOFF2, Latin subset, weights 400/600 |

Tabular numerals are mandatory: numbers must not shift width when a population changes each day.
Fallback stack must remain legible if fonts fail to load (`Georgia, serif` / `system-ui, sans-serif`).

## 6. Asset manifest (`assets/manifest.json`)

Every produced file gets one entry. The build fails if a shipped asset has no entry, no licence, or
`technical_checks_passed !== true`.

```json
{
  "id": "settlement.city",
  "file": "atlas/settlements.png",
  "frame": { "x": 96, "y": 0, "w": 48, "h": 48 },
  "kind": "sprite",
  "states": ["normal", "ruined"],
  "anchor": [0.5, 0.5],
  "source": { "type": "original", "tool": "hand-authored SVG", "author": "project" },
  "license": "project-own (all rights reserved, see LICENSE-ASSETS.md)",
  "provenance": { "created": "stage-4", "edits": [] },
  "technical_checks_passed": false,
  "notes": "must read at 16px"
}
```

Allowed `source.type` values: `original`, `cc0`, `cc-by` (with attribution text), `generated`
(with the generation tool, model, prompt hash and a human review note). **No `unknown`, no
`pinterest`, no `found-on-the-internet`.**

## 7. QA gates (must pass before an asset ships)

| Gate | Check | Tool |
|---|---|---|
| Dimensions | exact declared size, power-of-two within the atlas | `scripts/asset_report.py --expect-size` |
| Alpha | real transparency; fully opaque RGBA fails when alpha is required | `--require-alpha` |
| Palette | ≤ declared colour count; no off-palette hues beyond tolerance | `--max-colors` |
| Silhouette | legible at 16 px against each of 3 terrain values | contact sheet at 1× |
| Seam | tileable assets repeat cleanly 3 × 3 | contact sheet |
| Atlas | frames do not overlap; padding ≥ 2 px; no bleeding | atlas build log |
| Context | looks correct in the running game at native device resolution | device screenshot |
| Weight | total shipped ≤ 6 MB; each texture ≤ 2048² | build report |
| Licence | entry has license + source + provenance | manifest schema test |

`technical_checks_passed` flips to `true` only when every gate above is green for that file, and the
contact sheet is attached to the Stage 4 report.

## 8. Naming and layout

```
assets/
├── manifest.json
├── atlas/            settlements.png · effects.png · icons.png (+ .json frame data)
├── ui/               icons/*.svg
├── textures/         paper.png (256² tiling) · noise.png
├── fonts/            display-600.woff2 · ui-400.woff2 · ui-600.woff2
└── audio/            ambience-*.ogg · ui-*.ogg   (P1)
```

Convention: `category/name-state[@scale].ext` — e.g. `settlement/city-ruined@2x.png`. Lowercase
kebab-case, no spaces, no version numbers in filenames (the manifest carries versions).

## 9. Licences and attribution

- Project-original assets: all rights reserved by the project; recorded in `LICENSE-ASSETS.md`.
- CC0 assets: source URL + retrieval date + the licence text reference in `NOTICE-ASSETS.md`.
- CC-BY assets: attribution rendered in Settings → About, verbatim as required.
- Generated assets: tool + model + date + prompt hash, **and** a human review note confirming the
  silhouette/palette gates. Generation is never accepted as proof of shippability.
- Third-party fonts: OFL/Apache text shipped alongside, subsetting permitted only if the licence
  allows it (OFL does).

No asset may be added without a row in the manifest and a line in the licence file. This is checked
in CI by a script that diffs `assets/**` against `manifest.json`.

## 10. What Stage 1 does not do

No images are generated, downloaded, or committed in Stage 1. This document is the specification the
Stage 4 asset work will follow; producing art before the renderer, palette constants and DPR strategy
exist would guarantee a rework.

---

## 9. Stage 4 delivered inventory

| Asset | Form | Source / licence | Weight |
|---|---|---|---|
| Terrain, relief, rivers, coast | procedural bake from real grids | project code | 0 |
| Settlement glyphs, 5 tiers + 5 ruined | procedural Canvas → Pixi Texture | project code | 0 |
| UI icons (layers, panels, resources, actions) | inline 24 px SVG, `currentColor` | project code | < 8 KB |
| Vazirmatn Regular/Medium/Bold | WOFF2 | SIL OFL 1.1, `public/fonts/OFL.txt` | 152 KB + licence |
| Layer legends/scales | CSS gradients + shapes | project code | 0 |
| World thumbnails | runtime JPEG data URL in the world doc | real framebuffer capture | ~20–30 KB/world (storage, not shipped) |

No binary art pack, no unlicensed asset, no downloaded texture. The 6 MB target is not close to being
used. The manifest rule is met by this table plus `public/fonts/OFL.txt`; missing assets are impossible
by construction because the glyphs/icons are generated, and the font has a system fallback.

---

## 10. Stage 5 asset changes

| Asset | Change | Weight |
|---|---|---|
| Terrain | rebuilt deterministic 896 px bake; no new binary asset | 0 |
| Settlements | richer procedural glyphs; overview dot texture in the same runtime atlas | 0 |
| Icons | added settings/compass as inline SVG; same 24 px stroke family | < 2 KB |
| Font | **only the verified Vazirmatn Regular WOFF2 is shipped**; Medium/Bold faces failed to load in Chromium and were removed. Weight 500/600/700 is synthesized by the browser. | 50.7 KB + OFL |
| Thumbnails | real square framebuffer crop with sea fill | runtime storage only |

Total shipped font/asset weight is ~51 KB plus the 4.4 KB licence, far below the 6 MB target. The
removal is a correctness fix (zero-width text), not a licence or budget shortcut.

---

## 11. Reopened Stage 5 — premium atlas provenance

The premium atlas is **procedural**; there is no downloaded or AI-generated binary art in this
stage. The art bible is `ART_BIBLE.md`; the technical pixel language is
`src/render/terrainPaint.ts` and is shared by the overview and detail chunks.

- Terrain and settlements: generated at runtime from the simulation grids and the real `infra`
  bitfield; source = this repository, licence = project licence.
- Font: Vazirmatn Regular WOFF2 + OFL (50.7 KB + 4.4 KB). Medium/Bold remain removed (zero-width
  failure).
- Icons: inline SVG, 24 px stroke family, no binary icon pack.
- Quality assets: 1536/1280/1024 overview and 48/96 px-per-tile chunks are generated, not shipped;
  the APK does not grow with texture packs, but GPU memory does and is budgeted separately.
- Android texture compression (ASTC/ETC2) is **not applicable** while the atlas is a runtime canvas;
  it becomes relevant only if an authored texture pipeline is introduced. Mipmap/filter selection
  remains a device-pass measurement.
- Rejection and validation: `ART_BIBLE.md` §10; visual evidence in `docs/qa/stewardship/`.
