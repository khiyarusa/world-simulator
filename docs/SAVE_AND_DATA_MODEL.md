# SAVE AND DATA MODEL — World Simulator

How world state is represented, serialised, stored, versioned and recovered. Written against the
`save-systems` skill's core rules: save *data*, not objects; version from day one; write atomically;
load defensively; migrate forward only.

---

## 1. Principles

1. **The save is the world.** No render state, no camera, no UI state (except a small `uiPrefs` blob).
2. **Plain data only.** No class instances, no functions, no references, no object graphs. Typed arrays
   and primitives, or JSON of primitives.
3. **Exact, not approximate.** Integer economy state means a loaded world is *bit-identical* to the
   world that was saved — not "close enough".
4. **Atomic.** A save either fully lands or leaves the previous save untouched. A crash mid-save must
   never destroy a world.
5. **Forward-migratable.** Every save carries `schemaVersion`; migrations run in order; newer saves are
   refused, never half-loaded.
6. **Bounded.** Save size and write time have budgets; growth is capped by retention policy, not hope.

## 2. What is persisted, and what is not

| Persisted | Reason |
|---|---|
| `recipe` (seed, preset, sliders, `generatorVersion`) | reproduces the world; identifies it |
| `generationReport` | diagnostics, support, "why does this map look odd" |
| All terrain grids (elevation, moisture, temperature, biome, fertility, vegetation, riverId, lakeId, regionId, resourceMask) | exactness + instant load (regenerating costs ~0.9 s and risks divergence if code changed) |
| Ownership grid (`ownerCiv`) | cheap, and changes constantly |
| Settlement store (all SoA arrays) | the core population/economy state |
| Civilization store (incl. 12×12 relation/grievance/treaty matrices) | politics state |
| Character store (≤ 60) | narrative continuity |
| Trade route edges (≤ 400) | economy topology |
| Event ring (14,000) + vital severe ring (4,096) | history, cause chains |
| Chronicle (per civ per year, downsampled) | readable history |
| **RNG stream states** (xoshiro128** 4×u32 × 12 streams ≈ 192 B) | exact resumption; without this, reload perturbs future randomness |
| Decision ring buffer (64 records) | "why?" explanations survive a reload |
| Calendar (`day`), caps, counters, checksum seed | clock and determinism |
| `uiPrefs` (separate store) | layer, speed, handedness, text scale, reduced motion |

| Not persisted | Reason |
|---|---|
| Camera position/zoom | view state; restored to "fit world" (or last selection, P1) |
| PixiJS objects, textures, DOM | renderer rebuilds them |
| Tier assignments (`detailTier`) | recomputed from the camera on load; persisting them would let the camera leak into state |
| Derived caches (prices, route capacity, harvest forecasts) | recomputed on the next tick; persisting them invites stale-state bugs |
| Frame stats, debug counters | not game state |
| Particle pools, animation phases | irrelevant to history |
| Command log (optional) | persisted only when `--debug-replay` is enabled, for bug reports |

**Why terrain is stored despite being seed-derived:** regeneration is a second implementation of the
world that can drift (a shader-grade bug would silently change old worlds). Storing ~450 KB buys
guaranteed fidelity, ~0.9 s of load time, and the ability to keep old generator versions alive
without shipping every version's code. The recipe is still stored, so a determinism test can compare
"regenerate vs stored" in CI.

## 3. Storage backend

**IndexedDB**, in the app's origin (`https://localhost` under Capacitor). Reasons: structured binary
storage (ArrayBuffer without base64 inflation), transactions with atomic commit, no 5 MB
localStorage ceiling, supported in Android WebView.

Quota reality (MDN, verified 2026-11): Chromium gives an origin up to ~60 % of total disk, but the data
is **best-effort** unless `navigator.storage.persist()` is granted. So:

- On first world creation, request persistence (`navigator.storage.persist()`); record the result.
- Even if granted, never assume it: always keep export/import as the user's escape hatch (P1).
- Before every save, check `navigator.storage.estimate()`; if free space < 3× the save size, warn.

### 3.1 Database schema

```
DB: "world-simulator"  (version 1)
├── store "worlds"    keyPath: "id"                       // metadata only, small
│     { id, name, schemaVersion, recipe, createdAt, updatedAt,
│       day, counts:{settlements,civs,pop}, checksum, bytes,
│       currentGen, prevGen, appVersion, persistGranted }
├── store "shards"    keyPath: ["worldId","gen","name"]     // ArrayBuffer payloads
│     { worldId, gen, name, crc32, compressed, bytes, payload }
└── store "prefs"     keyPath: "key"                        // ui + settings, not world state
```

`id` is a ULID-like string (time + random) generated in the main thread (not the sim, so it does not
consume a simulation RNG stream).

## 4. Sharding

One save = a set of named shards, written in one IndexedDB transaction.

**Shipped in schema v1 (Stage 2): four shards.** Shards for systems that do not exist yet are not
written as empty placeholders (D-30); Stage 3 adds them with a schema bump.

A generation is valid **only when all four exist** and every payload passes its CRC *and* its declared
length. Validating whichever shards happen to be present is not validation (D-36, defect H-04).

| Shard | Content | Measured / typical (Medium) |
|---|---|---|
| `meta` | header, version, recipe, report, RNG states, counters | ~6 KB |
| `terrain` | 12 grids (+ river width) in a fixed order with an explicit byte table | ~520 KB raw → ~90–200 KB gzip |
| `settlements` | initial band records (SoA arrays, `count` entries) | ~2 KB at year 1 |
| `civs` | initial civ store (one per band) | < 1 KB |
| *(Stage 3)* `characters`, `routes`, `events`, `history` | | budgeted, not yet written |
| **Total v1** | | **≈ 0.55 MB raw / ≈ 0.1–0.2 MB gzip** |

Budgets: Small ≤ 0.6 MB raw, Medium ≤ 1.2 MB, Large ≤ 2.0 MB, measured **after** compression.

### 4.1 Binary layout (grids)

```
Header (32 B):
  magic    "WSG1"        (4 B)
  version  u16           (2 B)
  flags    u16           (2 B)   bit0 = little endian, bit1 = gzip
  width    u16           (2 B)
  height   u16           (2 B)
  resA     u32           (4 B)   reserved
  checksum u32           (4 B)   CRC32 of the payload
  reserved u64           (8 B)
Payload: arrays in a fixed, documented order:
  elevation   i16[w*h]
  moisture    u8[w*h]
  temperature i8[w*h]
  biome       u8[w*h]
  fertility   u8[w*h]
  vegetation  u8[w*h]
  riverId     u16[w*h]
  lakeId      u16[w*h]
  regionId    u8[w*h]
  resource    u8[w*h]
  ownerCiv    u8[w*h]
```

A reader validates `magic`, `version`, `width×height`, and the total payload length before touching
memory. Wrong size ⇒ shard rejected, never a partially read grid. (`precision: Int16` in decimetres;
no floats anywhere in the save.)

### 4.2 Packed records (events)

```
Event (24 B):
  id u32 · day u32 · type u8 · severity u8 · placeU16 u16 · actorA u8 · actorB u8
  magnitude i16 · causeId u32 · outcomeIdx u16 · flags u8 · reserved u8
```
Event text is generated from `(type, actors, magnitude)` at display time — we store the *facts*, not
localised strings, so a future language change does not require a migration.

### 4.3 Compression

`CompressionStream('gzip')` when available (Android WebView ≥ Chrome 80 covers our floor), else the
shard is written raw with `compressed: false`. Per shard, because a 4 KB meta shard gains nothing from
gzip and the streams are async anyway. No third-party compressor in P0; `fflate` is the documented
fallback if a real device test shows a gap.

## 5. Save flow (atomic, generation-based)

```
saveWorld(worldId):
  1. worker: captureWorld() — SYNCHRONOUS copy of every payload + checksum, between ticks
  2. worker: encodeSnapshot() — gzip the frozen bytes (async; cannot disturb the snapshot)
  3. worker → main: transfer shard buffers, then 'savePrepared' (serialised, NOT durable yet)
  4. main: gen = currentGen + 1
  5. main: single IDB readwrite transaction on ["shards","worlds"]:
        put all shards under (worldId, gen)
        put updated world doc with currentGen = gen, prevGen = old currentGen
     (transaction commits atomically or not at all)
  6. main: after commit, delete generation < prevGen (garbage collection)
  7. main: update the in-memory world doc
```

Crash windows, all safe:

The capture must not contain an `await`: an await between shards let a tick run mid-save, producing a
file with terrain from one day, metadata from the next and a checksum of a third (defect H-03).

| Crash point | Result on next launch |
|---|---|
| Before step 5 | old generation intact, world as of the last save |
| During step 5 | transaction aborts; IDB rolls back; old generation intact |
| During step 6 | two generations on disk; the older one is deleted next save |
| Before step 4 | nothing changed |

**No `.tmp` file dance is needed** because IndexedDB transactions are already atomic over the stores
they touch; the equivalent safety comes from writing a *new generation* rather than overwriting.

## 6. Load flow (defensive)

```
loadWorld(worldId):
  1. read world doc → schemaVersion, currentGen, prevGen, expectedShardCount
  2. if schemaVersion > SAVE_VERSION → refuse with "created by a newer version" (no partial load)
  3. try generation currentGen:
        read all shards in one read-only transaction
        verify count, per-shard crc32, header magic/size
  4. on any failure: try prevGen (backup), logging why the candidate was rejected; a candidate must
     have the complete shard set and matching CRCs before it is accepted
  4b. when an older generation is accepted, repoint metadata at it and delete the damaged newer
      generation in one transaction (D-38); otherwise the next save would record corruption as "prev"
  5. on success: run migrations schemaVersion → SAVE_VERSION (in memory)
  6. validate post-migration invariants (INV-3, INV-4, required keys, array lengths)
  7. hand shards to the worker; worker rebuilds SoA state and recomputes derived caches
  8. verify rolling checksum against the stored `checksum` (warn only — migrations may change it)
  9. resume at the saved `day`, paused
```

If both generations fail: keep both on disk (never auto-delete a world the player might recover), show
a recovery sheet with "Export damaged save" (P1) and "Start new world".

## 7. Schema versioning and migration

```ts
// src/core/saveSchema.ts — one source of truth
export const SAVE_SCHEMA_VERSION = 4;
export const MIN_SUPPORTED_SCHEMA = 1;

// src/platform/migrations.ts — pure document transforms, never deleted
const MIGRATIONS = {
  1: (doc) => ({ ...doc, schemaVersion: 2 }),  // society block added to the payload
  2: (doc) => ({ ...doc, schemaVersion: 3 }),  // routes/treaties/wars/military/tech/prices
  3: (doc) => ({ ...doc, schemaVersion: 4 }),  // interventions, yearly series, trend windows
};
```

Rules, learned from the skill's versioning guidance:

- Migrations are **pure**: read a doc/block, return a new one; never touch IDB inside a migration.
- Migrations run **in order** (1→2→3→4), and each step is verified to produce exactly the next version.
- Migrations are **never deleted** — a shipped version's save must remain loadable forever.
- The shard set is unchanged at four (`meta`, `terrain`, `settlements`, `civs`); new society state
  travels inside the `meta` block (D-44), so completeness/recovery rules do not change.
- A genuine v2/v3 society block decodes with the Stage 4 rings **empty**, because that world never had
  interventions or yearly samples. A v4 block missing them is `SAVE_CORRUPT`, not silently initialised.
- `generatorVersion` (world content) and `schemaVersion` (save shape) are **independent**.

### 7.1 Schema 4 additions (inside `meta.society`)

| Field | Shape | Meaning |
|---|---|---|
| `interventions` | `{count, last[4], rows[8]}` | kind, targets, start/end day, intensity, resource, amount; `last` is the cooldown clock |
| `stats` | `{count, rows[10]}` | yearly population/settlements/civs/cumulative food/cumulative trade/treasury/wars/fertility/drought |
| `trend` | `{counts[settlements], values[settlements×6]}` | six capped yearly population samples per settlement |
| counters | four numbers | blessings, blights, fertilized, incited |

Checksum contract **v6** covers every one of these values. Existing v2/v3 save fixtures still decode;
`tests/persistence/schema4.test.ts` proves the legacy decode, the missing-ring corruption case and the
round-trip checksum.

## 8. Retention policy (bounded history)

The Stage 3 retention contract (D-46) is unchanged except that Stage 4 adds bounded rings. There is no
"kept forever" claim: every ring is finite and the player is told which history survives.

| Data | Capacity | At the limit |
|---|---|---|
| Main event ring | 14,000 events | oldest row overwritten; cause chains are measured over what survives |
| Vital severe ring | 4,096 events (severity ≥ 4) | oldest severe row overwritten after the main ring has already wrapped |
| Chronicle | 4,096 rows (per civ per year) | oldest year overwritten |
| Decision records | 64 | ring buffer |
| Yearly world series | 256 samples | oldest year overwritten |
| Settlement trend | 6 yearly samples | oldest sample shifted out |
| Intervention rows | 64 | oldest action row overwritten; the event itself remains in history |

Measured Medium save at year 400: **1,158 KiB raw (1,185,792 bytes)**, under the 1,200,000-byte
contract; the earlier 0.4 MB figure in this document was a Stage 1 target, not a measurement.

## 9. Autosave

| Trigger | Behaviour |
|---|---|
| every 90 simulated days (a season) | autosave to the world's own generation chain |
| every 60 s of real play | same, whichever comes first |
| app backgrounded (`visibilitychange`) | immediate autosave, then pause |
| before a player intervention | snapshot to `prevGen` so an experiment can be undone (P1 "rewind one action") |
| **never** | during world generation, mid-command, or while another save is in flight |

Autosave does not use a separate slot: it advances the same generation chain, so "autosave" and
"manual save" differ only in trigger. The player-facing "Save now" simply forces a save. This avoids
the classic bug where autosave silently overwrites the manual save while a manual save is more stale.

A small non-blocking indicator appears for saves > 250 ms ("Saving…"), never a modal.

## 10. Multiple worlds and slots

- Unlimited worlds, limited by storage (each world is a separate `worldId`).
- World list shows: name, seed, year, population, civs, size, last played, thumbnail-less
  (a thumbnail would add 20–40 KB per world; P1 optional).
- Deleting a world is the only destructive action: typed confirmation, then delete all shards for
  every generation in one transaction.
- Renaming is a metadata write only.
- "Duplicate world" (fork a save at the current day) is P1 — it is trivial with generations, but it
  doubles storage, so it must be explicit.

## 11. Export / import (P1, specified now)

`.wsv` file = gzip of `{header.json, shards/*.bin}` with a manifest. Exported through the Capacitor
Filesystem/Share plugin, imported through the file picker. Version-checked on import; a newer file is
refused. Purpose: survive WebView storage eviction, move a world between devices, and attach a world to
a bug report. This is the reason we do not need cloud saves in v1.

## 12. Data integrity tests (CI)

| Test | Assertion |
|---|---|
| Round-trip exactness | save → load → compare every persisted array byte-for-byte |
| Continuation determinism (INV-9) | save at day 5000 → load → 1000 ticks ⇒ checksum equals the uninterrupted run |
| Corrupt shard | flip one byte in a shard ⇒ load falls back to `prevGen`, logs the shard name |
| Truncated shard | cut a payload short ⇒ rejected by length check, no partial read |
| Missing shard | delete one ⇒ fallback to `prevGen` |
| Newer schema | write `schemaVersion = SAVE_VERSION + 1` ⇒ load refused with `SAVE_SCHEMA_NEWER` |
| Migration chain | every fixture in `tests/fixtures/saves/` loads to the current version and passes invariants |
| Quota failure | mock `QuotaExceededError` ⇒ current generation intact, user notified |
| Generation GC | after 5 saves, only 2 generations remain on disk |
| Save size | Medium at year 200 ≤ 1.2 MB raw and ≤ 0.4 MB gzip |

## 13. Risks

| Risk | Mitigation |
|---|---|
| WebView evicts best-effort storage under disk pressure | request `persist()`, keep export/import, never treat "saved" as permanent without a check |
| IDB write latency on slow eMMC blocks the UI | shard-level transactions, yields, autosave when idle |
| A schema change ships without a migration | CI fixture test + release checklist gate |
| Event store grows unbounded through a bug | hard cap + drop policy + a test that asserts the cap after 10k years |
| RNG state not saved ⇒ silent non-determinism | RNG states are in `meta` and compared in the round-trip test |
| Two tabs / two app instances writing one world | single-instance guard via a `worlds.lock` key + BroadcastChannel; second instance opens read-only (P1) |

---

## 10. Stage 5 — no schema change, new stress evidence

Stage 5 deliberately did **not** change the persisted shape:

- `SAVE_SCHEMA_VERSION` remains **4**; checksum contract remains **v6**.
- The four shards (`meta`, `terrain`, `settlements`, `civs`) and the current+previous generation
  recovery are untouched.
- v1→v2→v3→v4 migrations and v2/v3 legacy-block decoding are untouched.
- Settings, language and onboarding live in `localStorage` (`ws.prefs.v1`, `ws.lang`), not in the
  world.
- `tests/persistence/stress.test.ts` performs **50 consecutive** serialise/deserialise cycles on a
  world with a real Bless, a mature event history and yearly samples; every cycle asserts the exact
  world checksum and schema 4.
- The measured year-400 Medium raw save remains 1,158 KiB (1,185,792 B), under the strict
  1,200,000-byte contract.

---

## 11. Schema 5 — campaign state (reopened Stage 5)

- **Schema 5**, checksum contract **v7**, four shards unchanged. The campaign block lives inside the
  `meta` shard beside the society block; the v1–v4 decoders and migrations are untouched.
- Campaign block v1: mode, legacy, era, steward civ, begun/completed days, seals, objective/charter
  sequence, baselines (16 metrics), start population/settlements, 5 milestone rows, up to 8 objective
  rows (id/kind/state/target/start/end/progress/goal/hold/hold-goal), up to 16 charter rows
  (civ/kind/start/end/replaceable), per-kind resolution days, war/crisis clocks and food security.
- Decision rows are 6 columns in schema 5 (adds the charter utility bias); the decoder accepts the
  schema-4 5-column row and fills bias 0.
- Migration 4→5 is a pure stamp. A v4 world decodes with an allocated **Free Sandbox** campaign; a v5
  world missing the block is `SAVE_CORRUPT` and follows the existing previous-generation recovery.
- `tests/persistence/stress.test.ts` still performs 50 round trips; `tests/campaign/*` proves exact
  objective/charter/seal/milestone round trips and v4 sandbox compatibility.
- Checksum v7 adds the campaign fields and the decision bias. The golden fixture still pins grid
  content, not the integrity checksum (D-34).
