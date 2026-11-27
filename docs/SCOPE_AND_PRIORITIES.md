# SCOPE AND PRIORITIES — World Simulator

Scope control is the project's biggest technical risk, not performance. This document is the
authority on **what is in, what is later, and what is never**, with reasons. Every P0 item is mapped
to a stage; nothing P0 may be left unassigned.

Legend: **P0** required for a coherent v1 · **P1** valuable if the stage has room · **P2** post-release,
not planned · **CUT** decided against, with reason.

---

## 1. Priority matrix

### 1.1 World generation

| Feature | Pri | Stage | Note |
|---|---|---|---|
| Seeded, reproducible generation | P0 | 2 | determinism tests are the gate |
| Continent mask, elevation, sea level | P0 | 2 | |
| Temperature, moisture, rivers, lakes | P0 | 2 | rivers are gameplay-critical |
| 16 biomes + fertility + resources | P0 | 2 | |
| Spawn sites + initial bands | P0 | 2 | |
| 3 size presets + water/harshness sliders | P0 | 2 | |
| Generation report + validation | P0 | 2 | support without the save file |
| Archipelago mode | P1 | 3 | variety, cheap (multi-blob mask) |
| Full plate-tectonics simulation | CUT | — | weeks of work for a different-looking map; noise + ridges reads better at this scale |
| Map editor / terrain painting | CUT | — | different product; breaks seed reproducibility |

### 1.2 Population and society

| Feature | Pri | Stage | Note |
|---|---|---|---|
| Cohort-based population (8 cohorts) | P0 | 3 | the cost/scale decision |
| Needs: food, water, fuel, safety | P0 | 3 | |
| Births, deaths, ageing (sliced) | P0 | 3 | |
| Health, stability, literacy | P0 | 3 | |
| Migration flows with conservation | P0 | 3 | |
| Occupation shifts + specialization cap | P0 | 3 | |
| Tier 0/1/2 detail LOD | P0 | 3 | without it, 200 settlements is impossible |
| Notable characters (≤ 60) | P1 | 3 | narrative flavour; cut first if Stage 3 is tight |
| Individual citizen agents | CUT | — | 10⁵–10⁶ entities at 30 FPS on an Adreno 610 is not achievable with a JS sim, and adds no gameplay the cohorts don't give |
| Family trees, genetics, personalities | CUT | — | content-heavy, invisible at world scale |
| Religion as a separate system | CUT | — | absorbed into the culture axes; a second belief system doubles UI for no new decisions |

### 1.3 Settlements and civilizations

| Feature | Pri | Stage | Note |
|---|---|---|---|
| 5 emergent tiers | P0 | 3 | promotion by surplus, not by script |
| 12 infrastructure types | P0 | 3 | enough for distinct strategies |
| Founding, expansion, fragmentation, abandonment | P0 | 3 | the life cycle is the content |
| Civilization formation from conditions | P0 | 3 | |
| Culture axes (3) with drift | P0 | 3 | identity without content authoring |
| 12-node tech tree + spread | P0 | 3 | |
| Government forms (3) + legitimacy | P1 | 3 | cheap, adds politics texture |
| Wonders / monuments | P2 | — | content, not systems |
| Named dynasties and succession | P2 | — | needs characters to be P0 first |

### 1.4 Economy

| Feature | Pri | Stage | Note |
|---|---|---|---|
| 6 resources + treasury, integer fixed-point | P0 | 3 | |
| Production, consumption, spoilage, storage caps | P0 | 3 | |
| Prices from local scarcity | P0 | 3 | |
| Trade routes with capacity + tariffs | P0 | 3 | |
| Route creation/decay by profitability | P0 | 3 | |
| Supply shocks propagating through reserves | P0 | 3 | the core "causal honesty" demo |
| Currency/banking/inflation | CUT | — | treasury is abstract; a monetary system is a second simulator |
| Per-good quality tiers | P2 | — | multiplies state for no visible decision |
| Caravans as moving entities | CUT | — | animation cost for zero systemic value; routes are edges |

### 1.5 Diplomacy and war

| Feature | Pri | Stage | Note |
|---|---|---|---|
| Relations ±100 + grievance memory | P0 | 3 | |
| 5 treaty types | P0 | 3 | |
| Four-condition war gate | P0 | 3 | anti-random-war requirement |
| Abstract fronts, attrition, occupation, exhaustion, peace | P0 | 3 | |
| Post-war consequences (refugees, legitimacy, routes) | P0 | 3 | war must matter |
| Alliances in war (call to arms) | P1 | 3 | |
| Tactical battles / unit control | CUT | — | explicitly out of genre, and unaffordable |
| Espionage, assassinations | P2 | — | character-driven, needs P0 characters |

### 1.6 Ecology

| Feature | Pri | Stage | Note |
|---|---|---|---|
| Seasons, temperature, precipitation | P0 | 3 | |
| Drought, flood, wildfire, epidemic | P0 | 3 | |
| Vegetation growth/harvest, erosion, fertility | P0 | 3 | slow-failure ecology |
| Climate change over centuries | P2 | — | a knob, not a system, until the base sim is balanced |
| Animals / migration of fauna | CUT | — | no gameplay consumer |
| Weather as visual VFX | CUT | — | layer encoding instead; particles cost frames |

### 1.7 History

| Feature | Pri | Stage | Note |
|---|---|---|---|
| Event records with severity + cause links | P0 | 3 | |
| Cause-chain "Why?" up to 8 links | P0 | 4 | the product's differentiator |
| Per-year chronicle | P0 | 4 | |
| Retention/downsampling policy | P0 | 3 | bounded saves |
| Timeline scrubber over history | P2 | — | nice, expensive; not needed to read history |
| Full replay of past years | CUT | — | requires full state snapshots per year; storage explodes |

### 1.8 Rendering and UX

| Feature | Pri | Stage | Note |
|---|---|---|---|
| PixiJS boot + baked terrain + camera | P0 | 2 | |
| Settlement sprites + labels + selection | P0 | 2 | |
| Pan/pinch/double-tap/inertia | P0 | 2 | |
| HUD: date, speed, layers, menu | P0 | 2 | |
| 6 information layers | P0 | 4 | political first, then population/economy/ecology/history |
| Bottom sheets: settlement, civ, economy, history, world, influence | P0 | 4 | |
| Onboarding coach marks | P0 | 4→5 | delivered in Stage 5 as closure of the Stage 4 P0 gap |
| Settings (text scale, motion, handedness, battery) | P0 | 4→5 | delivered in Stage 5; persisted in `ws.prefs.v1`, not a save field |
| Audio ambience | P1 | 4 | first thing cut if Stage 4 runs long |
| Animated water, weather VFX | P2 | — | |
| 3D/isometric view | CUT | — | see `UX_AND_VISUAL_DIRECTION.md` §1 |
| Tablet-specific layout | P2 | — | phone-first; tablets get the stretched portrait layout |

### 1.9 Platform and persistence

| Feature | Pri | Stage | Note |
|---|---|---|---|
| Capacitor shell, portrait, safe areas | P0 | 2 | |
| IndexedDB save/load/autosave, generations | P0 | 2 | must exist before features pile up |
| Schema version + migrations + fixtures | P0 | 2 | |
| Save recovery from backup generation | P0 | 2 | |
| Persist request + quota checks | P0 | 4 | |
| Export/import `.wsv` | P1 | 4 | the anti-eviction escape hatch |
| Multiple worlds list + delete | P0 | 4 | |
| Cloud save, accounts, sync | CUT | — | server requirement contradicts the platform contract |
| Play Games achievements | CUT | — | no goals in a sandbox |

### 1.10 Engineering

| Feature | Pri | Stage | Note |
|---|---|---|---|
| GitHub Actions CI (typecheck/lint/unit/build) | P0 | 2 | the only build machine |
| Determinism + invariant suites | P0 | 2 | |
| Playwright smoke + E2E | P0 | 2 | |
| Android APK artifact in CI | P0 | 2 | |
| Perf harness + budgets | P0 | 2 | |
| Physical-device validation protocol | P0 | 2–5 | cannot be automated |
| AAB + release signing | P0 | 5 | |
| Instrumentation tests on an emulator | P2 | — | slow, flaky, low value for a WebView game |
| i18n framework | P2 | — | English-only at release; strings are already in one file |
| Mod support | CUT | — | |

### 1.11 Owner-authorized Stage 5 expansion (2026-11-27)

| Feature | Pri | Stage | Note |
|---|---|---|---|
| Stewardship Campaign + five legacy paths | P0 | 5 | primary mode; Free Sandbox remains |
| Dynamic objectives from real world state | P0 | 5 | no scripted mission text |
| Civic charters affecting utility decisions | P0 | 5 | worker-authoritative, bounded capacity |
| Campaign persistence (schema 5) | P0 | 5 | migration from v1–v4, checksum v7 |
| Multi-resolution premium atlas | P0 | 5 | overview + regional detail chunks |
| Infrastructure-driven settlement art | P0 | 5 | real infra bits, no invented buildings |
| Campaign/legacy UI + conclusion | P0 | 5 | sheet, not a seventh layer |
| Larger asset/APK budget | P0 | 5 | quality over the old 5.5 MB artefact |

## 2. Explicit postponements and cuts (single list)

**CUT (never planned):** individual citizen agents · tactical battles · religion system · cloud saves
and accounts · multiplayer · map editor · replay of past years · caravans as entities · dynamic
weather VFX · 3D/isometric projection · desktop builds · monetisation SDKs · LLM-driven runtime AI.

**P2 (post-release, not in the five stages):** wonders/monuments · named dynasties · espionage ·
timeline scrubber · tablet layout · climate change over centuries · i18n · emulator instrumentation
tests · Play Games integration.

**P1 (in the plan, first to drop under pressure):** notable characters · archipelago mode ·
government forms · alliances · audio ambience · export/import · duplicate world · "rewind one action".

## 3. What gets dropped first if a stage runs late

In order, and only with a note in the stage report:

1. Audio ambience (Stage 4).
2. Notable characters (Stage 3) — but the event text must then not reference individuals.
3. Archipelago mode (Stage 3).
4. Export/import (Stage 4) — accepting the storage-eviction risk knowingly.
5. Effects sprite sheets (Stage 4).

**Never dropped:** determinism, saves/autosave/migrations, cause chains, the four-condition war gate,
the LOD tiers, the CI gates, the perf budget, accessibility minimums.

## 4. Scope rules for future agents

1. No feature may be added to a stage without removing something of comparable cost from that stage,
   or documenting the schedule risk in the stage report.
2. No "small" feature that requires a new persistent field may ship without a schema version bump and
   a migration.
3. No feature may read renderer state.
4. If a feature cannot be tested in CI, it needs a written manual test in the stage report — not a
   "tested manually" claim with no steps.
5. The five-stage limit is absolute. There is no "phase 6" to hide unfinished work in.
