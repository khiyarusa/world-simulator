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
| Event ring (20k) + major event store | history, cause chains |
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

| Shard | Content | Typical (Medium, yr 200) |
|---|---|---|
| `meta` | header, version, recipe, report, RNG states, counters | ~4 KB |
| `terrain` | 11 grids packed, in a fixed order with an explicit type table | ~500 KB raw → ~200 KB gzip |
| `settlements` | SoA arrays (all fields), cohort arrays | ~30 KB → ~14 KB |
| `civs` | civ store incl. 12×12 matrices | ~6 KB |
| `characters` | ≤ 60 records | ~6 KB |
| `routes` | ≤ 400 edges | ~9 KB |
| `events` | 20k packed records (24 B each) | ~480 KB → ~120 KB |
| `history` | chronicle entries + decade summaries | ~200 KB → ~60 KB |
| **Total** | | **≈ 1.2 MB raw / ≈ 0.4 MB gzip** |

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
  1. worker: verify we are at a tick boundary; capture a snapshot of state
  2. worker: serialise shard by shard (yield between shards), computing crc32 per shard
  3. worker → main: transfer shard buffers (no copy)
  4. main: gen = currentGen + 1
  5. main: single IDB readwrite transaction on ["shards","worlds"]:
        put all shards under (worldId, gen)
        put updated world doc with currentGen = gen, prevGen = old currentGen
     (transaction commits atomically or not at all)
  6. main: after commit, delete generation < prevGen (garbage collection)
  7. main: update the in-memory world doc
```

Crash windows, all safe:

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
  4. on any failure: try prevGen (backup), log the failure with the failing shard name
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
const SAVE_VERSION = 1;   // Stage 1 value; bumped by any persisted-shape change

type Migration = (doc: WorldDoc, shards: ShardMap) => void;
const migrations: Record<number, Migration> = {
  // 1 -> 2: { ... }
};
```

Rules, learned from the skill's versioning guidance:

- Migrations are **pure**: read a shard, return a new one; never touch IDB inside a migration.
- Migrations run **in order**: 1→2→3, never skipping.
- Migrations are **never deleted** — a shipped version's save must remain loadable forever.
- Adding a field = migration that fills a default; renaming = copy + delete; removing = keep the old
  field ignored for two versions, then drop.
- Every migration has a fixture: a real save of the old version in `tests/fixtures/saves/vN.wsv`, loaded
  in CI after every schema change.
- `generatorVersion` (world content) and `schemaVersion` (save shape) are **independent**. A generator
  change does not migrate saves; it only matters if a save is regenerated (which we never do implicitly).

## 8. Retention policy (bounded history)

| Data | Retention | At the limit |
|---|---|---|
| Events severity 5 | forever | none (≈ 30–80 per 500 years) |
| Events severity 4 | forever | capped at 100k; beyond that, severity-5 only |
| Events severity 3 | 200 years | rolled into per-year counters, then dropped |
| Events severity ≤ 2 | not stored | aggregated into yearly statistics |
| Chronicle entries | 200 years full text | older: one entry per decade per civ (~8× compression) |
| Characters | 60 living + last 40 dead (id + epitaph) | oldest dead dropped |
| Decision records | last 64 | ring buffer |

Consequence: history stays rich where it matters (the last two centuries and everything
world-changing) and cheap where it does not. This is why a 500-year world still saves in ~0.4 MB.

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
