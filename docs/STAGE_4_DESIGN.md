# STAGE 4 — PLAYER EXPERIENCE AND CONTENT

Design contract for the player-facing layer built on the Stage 3 simulation. Status labels are the
project's: **implemented** · **tested** · **measured** · **targeted (unverified)** ·
**pending device validation** · **deferred**. This document is the authority for Stage 4; where an
older document disagrees, this one and `TECHNICAL_DECISIONS.md` D-51…D-58 win.

---

## 1. Scope and constraints

Stage 4 adds **no new simulation system**. It makes the existing one playable:

- six information layers over the real world state;
- six panels (settlement, civilization, economy, history, world, influence);
- four player interventions through a validated worker command path;
- event investigation, causal chains and a chronicle;
- multiple saved worlds with create/load/rename/save/delete/recovery;
- a coherent visual identity, mobile-first layout, Persian RTL + English;
- tests, visual QA, CI and docs.

Physical-device validation is deferred to Stage 5 by the user's workflow. Stage 4 is
**software-complete, device-pending**; it does not claim device validation.

### 1.1 Preserved Stage 3 invariants

Determinism, one-writer ownership, four shards, cohorts as the only population representation, the
war gate, cause/root integrity, capture-without-`await`, generation recovery and checksum contracts
are unchanged. Every new persisted value is additive and schema-versioned.

---

## 2. Data contracts

### 2.1 Queries (`src/worker/queries*.ts`)

| Query | Returns |
|---|---|
| `world` | identity, calendar, population/settlement/civ counts, land, checksum, counters, yearly series, intervention state |
| `settlement` | identity, tier, cohorts, occupations, stocks/caps/prices, health/stability/literacy, treasury, infrastructure, routes, local ecology, trend window, risks, recent events, Bless limits |
| `settlements` | bounded, population-sorted summaries |
| `civ` / `civs` | capital, population, settlements, culture axes, technology, treasury, relations, treaties, wars, gate values, milestones, strengths/weaknesses |
| `economy` | resource stock/cap/price/scarcity, production/consumption counters, trade volume, routes, shortages, yearly series |
| `ecology` | fertility/vegetation/moisture/temperature averages, drought/blight counts, 16 regional climate cells, active hazard areas, local values |
| `history` | filtered, paginated events with category counts and year range |
| `event` | event, cause chain (root → event), direct consequences, honest root classification |
| `chronicle` | per-civ yearly rows, paginated, plus the world series |
| `decisions` | the simulation's recorded utility decisions |
| `layer` | tile cells and/or points, lines and areas for one of six layers |
| `interventions` | cooldown, active effects and recent action history |

Every query validates ids/limits, returns a copy (never live typed arrays except the layer cells,
which are freshly allocated and transferred), bounds lists (50–100 rows by default; 200 for the
settlement list) and returns `{ok:false, code, message}` instead of a half-filled panel.

### 2.2 Commands (`player`)

```ts
{ op: 'bless', settlement, resource, amount }
{ op: 'blight', settlement, intensity, durationDays }
{ op: 'fertilize', settlement, intensity }
{ op: 'incite', civA, civB }
```

The worker validates **everything** (live target, resource range, amount limit, intensity 1–3,
duration 90–360 in 30-day steps, two distinct living civs, not already at war, cooldown), applies the
effect, appends an event with cause `-2` (player root), appends a persisted intervention row, bumps a
counter, and returns `{ok, code, message, eventId, effects[], cooldownDays}`. The UI reports only that
result. A failed command mutates nothing.

### 2.3 Intervention rules

| Action | Real effect | Limits |
|---|---|---|
| Bless | adds units to one resource through `addStock`; reports the units actually added | ≤ 10 % of current + one year of that resource's use; cooldown 360 days |
| Blight | immediate vegetation/fertility/food/health/stability damage plus a persisted 90–360-day pressure; production multiplied by 1000 − 180×intensity while active | radius 3+2×intensity tiles; cooldown 1080 days |
| Fertilize | immediate soil/vegetation/health/stability gain plus a five-year monthly enrichment toward the 255 cap | radius 3+intensity tiles; cooldown 1800 days |
| Incite | relation −15 (floor −100), grievance +150 (cap 1000) for both directions | refused for dead/identical civs or when already at war; cooldown 1800 days |

Bless is deliberately **exogenous**: the world outside the map sends the gift. Its hard yearly cap and
the recorded actual amount are what keep it from being a cheat. Blight/fertilize move only ecological
values; incite moves only the relation pair. No cohort is created or deleted by any intervention.

---

## 3. The six layers

| Layer | Real source | Presentation |
|---|---|---|
| Political | ownership derived from the nearest living settlement within 18 tiles; capitals, war and treaty edges, occupied settlements | civ-colour territory cells, ink borders, capital diamonds, red war lines, teal treaty lines |
| Terrain | baked elevation/biome/river/lake grids | smoothed colour field, hillshade, river ink, coastline, paper grain |
| Population | living settlement population; recent migration events | screen-space halo per settlement (radius by population), migration origin rings |
| Economy | persisted routes, treasury per capita, food-day shortage | gold wealth rings, red shortage crosses, route lines weighted by volume |
| Ecology | fertility/vegetation grids, drought/blight flags, persisted hazard areas | fertility heat overlay, hazard rings/areas |
| History | filtered persisted events | severity-sized event pins above settlements; player events are marked in the feed |

Layer values never come from UI heuristics. Political territory is a documented projection of
settlement ownership (there is no separate territory grid); it is not drawn where no living settlement
claims the land.

### 3.1 Rendering discipline

- terrain bake: once per world load, upscaled from one sample per tile with smoothing;
- raster layers: one cached canvas texture, rebuilt only when the layer changes or after 30 simulated
  days;
- vector layers: one `Graphics`, rebuilt only on layer/zoom changes; marker world radius is
  `screenPx / zoom`, so a marker stays a symbol at every zoom;
- vector markers live above settlement glyphs; raster territory lives below them;
- no per-tick layer rebuild, no per-frame allocation.

---

## 4. Panels

| Panel | Contents |
|---|---|
| Settlement | identity/tier, risks, population/health/stability/literacy/treasury/food days, six-sample trend, cohort and occupation meters, six resource meters with price and days, infrastructure, routes, local ecology, recent history, Bless shortcut |
| Civilization | picker, capital, population/settlements/legitimacy/army/exhaustion/treasury, three culture axes, 12 technology nodes, relations with grievance/treaty/war, war fronts, persisted war-gate values, strengths/weaknesses, milestones, Incite shortcut |
| Economy | totals, cumulative production/consumption, yearly trade/treasury chart, resource table, shortages, trade routes |
| History | event/chronicle modes, category chips, severity filter, player-only filter, search, paginated feed, event detail with chain/consequences/root, chronicle rows and world chart |
| World | identity/seed/preset, day/year/population/settlements/civs/land, population and treasury charts, counters, save status, Save/Manage/Rename/Delete, language |
| Influence | four actions, target/resource/amount or intensity/duration, cooldown, destructive warning, active effects, recent actions, structured result and event link |

Panels are rebuilt from the latest query, not from a parallel model. They refresh on a 4 s timer only
while open and the simulation is running; history owns its own pagination so a background refresh
cannot duplicate a page.

---

## 5. Causality and chronicle

- Every event has a stable id, day/year, type, severity, place, actors, magnitude and cause.
- A cause of `-1` is an explicit root; a cause of `-2` is a player intervention; a positive cause is an
  earlier event id. The event detail shows the chain root → event, direct consequences, and the honest
  classification. Missing/evicted ancestors are handled as "unknown", never invented.
- The chronicle reads the simulation's own per-civ yearly ring; the world chart reads the yearly world
  series (population, settlements, civs, cumulative food/trade, treasury, wars, fertility, drought).

---

## 6. World management

- Every world has a stable id (`w-<time36>-<rand36>`), name, seed, preset, schema version, counts,
  day, checksum and an optional real thumbnail (render capture at save time).
- Boot opens the world-selection screen; a world is playable only if a complete generation exists.
- Create validates the seed and name; the first save happens immediately after the world mounts.
- Save writes a new generation atomically, keeps current + previous, prunes older generations, and a
  damaged current generation recovers to the previous one, repoints and deletes the damage.
- Rename and delete are explicit; deletion requires confirmation and never touches another world.
- Autosave: every 90 simulated days, every 60 s when dirty, and on background.

---

## 7. Visual identity and assets

- “Living atlas”: mineral palette, relief, river ink, paper grain, stamped settlement glyphs.
- Settlement glyphs: five tier silhouettes plus ruined variants; state bits add occupied banners,
  starving/prosperous dots and declining alpha.
- Civilization colour palette (12 hues) used by glyphs, territory and capitals.
- Inline 24 px stroke icon set for layers, panels, resources and actions.
- Vazirmatn WOFF2 (three weights, 152 KB total) under the SIL OFL; licence at
  `public/fonts/OFL.txt`; everything else is procedural (no binary art pack).
- Total shipped font/asset weight is far below the 6 MB target (see `ASSET_DIRECTION.md`).

---

## 8. Language, layout and accessibility

- **Persian RTL is the default** interface; English is a complete second language. The choice is
  stored locally; `?lang=en` is supported for tests.
- All UI text goes through `t()`; layouts use logical CSS properties (`inset-inline`, `padding-inline`,
  `text-align: start`), so RTL is a layout, not a mirrored afterthought.
- Numeric values are wrapped with `dir="ltr"` and proper nouns with `unicode-bidi: plaintext`.
- Persian uses Persian digits and translated seasons/months/resources/cohorts/infrastructure/
  technology/treaties/events.
- 48 dp touch targets, safe-area insets, bottom sheets in portrait, right-side panel on wide/landscape,
  wrapped tab rows so all six panels remain reachable, no destructive action without a confirmation.
- Reduced-motion preferences disable transitions; focus outlines are visible; colour is never the only
  carrier (shape/icon/text accompany it).

---

## 9. Persistence — schema 4

Schema 4 adds, inside the existing `meta` society block (four shards unchanged):

- `interventions`: up to 64 rows (`kind,a,b,start,end,intensity,resource,amount`) + last-use day per kind;
- `stats`: up to 256 yearly world samples (population, settlements, civs, cumulative food, cumulative
  trade, treasury, wars, mean fertility, drought count);
- `trend`: six capped yearly population samples per settlement;
- four counters (`blessings`, `blights`, `fertilized`, `incited`).

Decoding rules: a v2/v3 block predates these rings and decodes with them empty (the truth about that
world); a v4 block missing them is `SAVE_CORRUPT`. Checksum contract v6 covers every new value.
Measured raw save at year 400 is 1,158 KiB (1,185,792 bytes), under the 1,200,000-byte contract.

---

## 10. Testing and CI

- Unit: interventions (limits, cooldowns, conservation, determinism, reload), query validation and
  pagination, layer shapes, schema-4 migration/legacy decode/corruption, world generation/saves.
- Integration/browser: create, layers, panels, command, save/reload, multiple worlds, rename/delete,
  damaged-generation recovery, worker-confirmed intervention.
- Visual QA: 19 committed captures from the real production build at 390×844 / DPR 2, generated by
  `tests/visual/capture.spec.ts`, uploaded by CI.
- CI: typecheck, lint, repository gates, unit/invariant, two-process determinism, hydrology, web build,
  Playwright E2E, visual QA, Android APK.

---

## 11. File map (Stage 4 additions)

| Area | Files |
|---|---|
| Persisted state | `sim/society/interventions.ts`, `stats.ts`, `rings.ts`, `allocate.ts`, `codecEncode.ts`, `codecTypes.ts` |
| Worker | `worker/queryTypes.ts`, `queryNames.ts`, `queryEvents.ts`, `queryEconomy.ts`, `queryLayers.ts`, `queryHandler.ts`, `queries.ts` |
| Renderer | `render/layers.ts`, `render/settlementSprites.ts` (ruined variants), `render/terrainBake.ts` (smooth bake) |
| UI | `ui/i18n.ts` + `i18n.en.ts` + `i18n.fa.ts`, `dom.ts`, `panelKit.ts`, `panels*.ts`, `legend.ts`, `icons.ts`, `worlds.ts`, `shell.ts`, `styles.css` |
| Session | `app/sessionCore.ts`, `sessionWorlds.ts`, `session.ts` |
| Tests | `tests/society/interventions.test.ts`, `tests/worker/queries.test.ts`, `tests/persistence/schema4.test.ts`, `tests/e2e/*`, `tests/visual/capture.spec.ts` |
| Evidence | `docs/qa/stage4/*.jpg`, `docs/STAGE_4_REPORT.md` |

---

## 12. Known limitations (honest)

- Physical Galaxy A23 feel, frame times and save/load timings are **pending Stage 5**.
- Political territory is a nearest-settlement projection, not a separately simulated border grid;
  the map states this in the layer metadata.
- Migration destinations are civilizations, not coordinates (the event format records the origin and
  the destination civ); the population layer therefore shows origin rings, not invented flow lines.
- The world chart starts after the first simulated year; a single yearly sample is shown as a flat line
  rather than a fake trend.
- Production/consumption per settlement per day is not stored historically; the economy panel shows
  real stocks, prices, cumulative flows, routes and shortages instead of a fabricated rate chart.
