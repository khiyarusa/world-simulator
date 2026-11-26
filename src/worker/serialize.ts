/**
 * Save shard encoding and decoding (docs/SAVE_AND_DATA_MODEL.md §4).
 *
 * `captureWorld` (snapshot.ts) produces an immutable snapshot synchronously; this module compresses
 * and decompresses it. Decoding validates the complete required shard set, every header, every length
 * and every CRC before it hands a world back.
 */
import { crc32 } from '../core/crc32.ts';
import { asErrorMessage, SimError } from '../core/errors.ts';
import { checkShardSet, SAVE_SCHEMA_VERSION } from '../core/saveSchema.ts';
import { parseSeedText, seedOf } from '../core/seed.ts';
import type { Seed } from '../core/seed.ts';
import { STREAM_IDS } from '../core/rng.ts';
import type { RngState } from '../core/rng.ts';
import type { SaveShard } from './protocol.ts';
import { captureWorld } from './snapshot.ts';
import { decodeSociety } from '../sim/society/codec.ts';
import { allocateSociety } from '../sim/society/allocate.ts';
import { initialiseSociety } from '../sim/society/init.ts';
import type { WorldSnapshot } from './snapshot.ts';
import {
  CIVS_HEADER_BYTES,
  CIVS_MAGIC,
  CIV_RECORD_BYTES,
  GRID_BYTES,
  SETTLEMENTS_HEADER_BYTES,
  SETTLEMENTS_MAGIC,
  SETTLEMENT_RECORD_BYTES,
  TERRAIN_HEADER_BYTES,
  TERRAIN_MAGIC,
} from './shardFormat.ts';
import type { MetaDoc } from './shardFormat.ts';
import { allocateCivs, allocateGrids, allocateSettlements, GRID_KEYS } from '../sim/state/worldState.ts';
import type { CivStore, SettlementStore, WorldRecipe, WorldState } from '../sim/state/worldState.ts';

export { SAVE_SCHEMA_VERSION } from '../core/saveSchema.ts';

const decoder = new TextDecoder();

async function compressIfUseful(raw: Uint8Array): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  if (typeof CompressionStream === 'undefined') return { bytes: raw, compressed: false };
  try {
    const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    if (packed.byteLength >= raw.byteLength) return { bytes: raw, compressed: false };
    return { bytes: packed, compressed: true };
  } catch {
    return { bytes: raw, compressed: false };
  }
}

/** Compress a frozen snapshot. Safe to await: the bytes can no longer change. */
export async function encodeSnapshot(snapshot: WorldSnapshot): Promise<SaveShard[]> {
  const out: SaveShard[] = [];
  for (const shard of snapshot.shards) {
    const { bytes, compressed } = await compressIfUseful(shard.raw);
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    out.push({ name: shard.name, crc32: shard.crc32, compressed, bytes: shard.bytes, payload });
  }
  return out;
}

/** Convenience for tests and tools: capture then encode in one call. */
export async function serializeWorld(state: WorldState, schemaVersion = SAVE_SCHEMA_VERSION): Promise<SaveShard[]> {
  return encodeSnapshot(captureWorld(state, schemaVersion));
}

async function inflate(shard: SaveShard): Promise<Uint8Array> {
  const bytes = new Uint8Array(shard.payload);
  if (!shard.compressed) return bytes;
  if (typeof DecompressionStream === 'undefined') {
    throw new SimError('UNSUPPORTED_VERSION', 'compressed shard but no DecompressionStream');
  }
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    throw new SimError('SAVE_CORRUPT', `shard ${shard.name} could not be decompressed: ${asErrorMessage(e)}`);
  }
}

/** Verify the CRC of the uncompressed payload. */
async function readShard(shard: SaveShard): Promise<Uint8Array> {
  const raw = await inflate(shard);
  if (crc32(raw) !== (shard.crc32 >>> 0)) {
    throw new SimError('SAVE_CORRUPT', `shard ${shard.name} failed CRC after decompression`);
  }
  return raw;
}

export interface DeserializedWorld {
  readonly state: WorldState;
  readonly schemaVersion: number;
}

export async function deserializeWorld(shards: readonly SaveShard[]): Promise<DeserializedWorld> {
  try {
    return await deserializeInner(shards);
  } catch (e) {
    if (e instanceof SimError) throw e;
    // Truncated headers and short payloads surface as RangeError from DataView; both mean the same
    // thing to the player: this save is damaged.
    throw new SimError('SAVE_CORRUPT', asErrorMessage(e));
  }
}

async function deserializeInner(shards: readonly SaveShard[]): Promise<DeserializedWorld> {
  const setProblem = checkShardSet(shards.map((s) => s.name));
  if (setProblem) throw new SimError('SAVE_CORRUPT', setProblem);

  const byName = new Map<string, SaveShard>();
  for (const s of shards) byName.set(s.name, s);
  const metaShard = byName.get('meta');
  const terrainShard = byName.get('terrain');
  const settShard = byName.get('settlements');
  const civShard = byName.get('civs');
  if (!metaShard || !terrainShard || !settShard || !civShard) {
    throw new SimError('SAVE_CORRUPT', 'missing shard');
  }

  let meta: MetaDoc;
  try {
    meta = JSON.parse(decoder.decode(await readShard(metaShard))) as MetaDoc;
  } catch (e) {
    throw new SimError('SAVE_CORRUPT', `meta shard unreadable: ${asErrorMessage(e)}`);
  }
  if (!Number.isInteger(meta.schemaVersion) || meta.schemaVersion < 1) {
    throw new SimError('SAVE_CORRUPT', 'meta schema version invalid');
  }
  if (meta.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SimError('SAVE_SCHEMA_NEWER', `save is version ${meta.schemaVersion}`);
  }
  if (meta.recipe.preset !== meta.preset) throw new SimError('SAVE_CORRUPT', 'recipe preset mismatch');
  if (meta.recipe.generatorVersion !== 1) {
    throw new SimError('UNSUPPORTED_VERSION', `generator version ${meta.recipe.generatorVersion}`);
  }

  const parsedSeed = parseSeedText(meta.seedText);
  if (!parsedSeed) throw new SimError('SAVE_CORRUPT', 'seed unreadable');
  const seed: Seed = seedOf(parsedSeed.lo, parsedSeed.hi);

  const { width, height } = meta;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) {
    throw new SimError('SAVE_CORRUPT', `bad world dimensions ${width}x${height}`);
  }

  const grids = allocateGrids(width, height);
  const terrain = await readShard(terrainShard);
  if (terrain.byteLength < TERRAIN_HEADER_BYTES) throw new SimError('SAVE_CORRUPT', 'terrain header truncated');
  const tdv = new DataView(terrain.buffer, terrain.byteOffset, terrain.byteLength);
  if (tdv.getUint32(0, true) !== TERRAIN_MAGIC) throw new SimError('SAVE_CORRUPT', 'terrain magic');
  if (tdv.getUint16(4, true) !== meta.schemaVersion) throw new SimError('SAVE_CORRUPT', 'terrain version');
  if (tdv.getUint16(6, true) !== GRID_KEYS.length) throw new SimError('SAVE_CORRUPT', 'grid count');
  if (tdv.getUint16(8, true) !== width || tdv.getUint16(10, true) !== height) {
    throw new SimError('SAVE_CORRUPT', 'grid dimensions');
  }
  let expectedTerrain = TERRAIN_HEADER_BYTES;
  for (let g = 0; g < GRID_KEYS.length; g++) expectedTerrain += width * height * GRID_BYTES[g]!;
  if (terrain.byteLength !== expectedTerrain) {
    throw new SimError('SAVE_CORRUPT', `terrain length ${terrain.byteLength} != ${expectedTerrain}`);
  }

  let offset = TERRAIN_HEADER_BYTES;
  for (let g = 0; g < GRID_KEYS.length; g++) {
    const key = GRID_KEYS[g]!;
    const bytesPer = GRID_BYTES[g]!;
    const len = width * height * bytesPer;
    new Uint8Array(grids[key].buffer, grids[key].byteOffset, len).set(
      new Uint8Array(terrain.buffer, terrain.byteOffset + offset, len),
    );
    offset += len;
  }

  const settlements: SettlementStore = allocateSettlements();
  const sett = await readShard(settShard);
  if (sett.byteLength < SETTLEMENTS_HEADER_BYTES) throw new SimError('SAVE_CORRUPT', 'settlements header truncated');
  const sdv = new DataView(sett.buffer, sett.byteOffset, sett.byteLength);
  if (sdv.getUint32(0, true) !== SETTLEMENTS_MAGIC) throw new SimError('SAVE_CORRUPT', 'settlements magic');
  if (sdv.getUint16(4, true) !== meta.schemaVersion) throw new SimError('SAVE_CORRUPT', 'settlements version');
  const sCount = sdv.getUint16(6, true);
  if (sCount > settlements.x.length) throw new SimError('SAVE_CORRUPT', 'settlement count over capacity');
  const expectedSett = SETTLEMENTS_HEADER_BYTES + sCount * SETTLEMENT_RECORD_BYTES;
  if (sett.byteLength !== expectedSett) {
    throw new SimError('SAVE_CORRUPT', `settlements length ${sett.byteLength} != ${expectedSett}`);
  }
  settlements.count = sCount;
  let so = SETTLEMENTS_HEADER_BYTES;
  so = readU16Into(sett, so, settlements.x, sCount);
  so = readU16Into(sett, so, settlements.y, sCount);
  so = readI32Into(sett, so, settlements.pop, sCount);
  so = readU8Into(sett, so, settlements.civ, sCount);
  so = readU8Into(sett, so, settlements.tier, sCount);
  so = readU16Into(sett, so, settlements.nameIdx, sCount);
  readU32Into(sett, so, settlements.foundedDay, sCount);

  const civs: CivStore = allocateCivs();
  const civBytes = await readShard(civShard);
  if (civBytes.byteLength < CIVS_HEADER_BYTES) throw new SimError('SAVE_CORRUPT', 'civs header truncated');
  const cdv = new DataView(civBytes.buffer, civBytes.byteOffset, civBytes.byteLength);
  if (cdv.getUint32(0, true) !== CIVS_MAGIC) throw new SimError('SAVE_CORRUPT', 'civs magic');
  if (cdv.getUint16(4, true) !== meta.schemaVersion) throw new SimError('SAVE_CORRUPT', 'civs version');
  const cCount = cdv.getUint16(6, true);
  if (cCount > civs.capital.length) throw new SimError('SAVE_CORRUPT', 'civ count over capacity');
  if (cCount > sCount) throw new SimError('SAVE_CORRUPT', 'more civs than settlements');
  const expectedCivs = CIVS_HEADER_BYTES + cCount * CIV_RECORD_BYTES;
  if (civBytes.byteLength !== expectedCivs) {
    throw new SimError('SAVE_CORRUPT', `civs length ${civBytes.byteLength} != ${expectedCivs}`);
  }
  civs.count = cCount;
  let co = CIVS_HEADER_BYTES;
  co = readU16Into(civBytes, co, civs.capital, cCount);
  co = readU8Into(civBytes, co, civs.colorIdx, cCount);
  readU16Into(civBytes, co, civs.nameIdx, cCount);

  const recipe: WorldRecipe = {
    seed,
    preset: meta.recipe.preset as WorldRecipe['preset'],
    water: meta.recipe.water,
    harshness: meta.recipe.harshness,
    peoples: meta.recipe.peoples,
    generatorVersion: meta.recipe.generatorVersion,
  };

  if (!Array.isArray(meta.rng) || meta.rng.length !== STREAM_IDS.length) {
    throw new SimError('SAVE_CORRUPT', `expected ${STREAM_IDS.length} RNG streams, found ${meta.rng?.length ?? 0}`);
  }
  const rngStates: RngState[] = STREAM_IDS.map((_, i) => {
    const s = meta.rng[i];
    return s ? { s0: s.s0 >>> 0, s1: s.s1 >>> 0, s2: s.s2 >>> 0, s3: s.s3 >>> 0 } : { s0: 1, s1: 0, s2: 0, s3: 0 };
  });

  if (!Number.isInteger(meta.day) || meta.day < 1) throw new SimError('SAVE_CORRUPT', `bad day ${meta.day}`);

  const counters = {
    settlementsFounded: meta.counters?.settlementsFounded ?? settlements.count,
    ticks: meta.counters?.ticks ?? 0,
    droppedTicks: meta.counters?.droppedTicks ?? 0,
    births: meta.counters?.births ?? 0,
    deaths: meta.counters?.deaths ?? 0,
    migrants: meta.counters?.migrants ?? 0,
    abandonments: meta.counters?.abandonments ?? 0,
    foodProduced: meta.counters?.foodProduced ?? 0,
    foodConsumed: meta.counters?.foodConsumed ?? 0,
    infraBuilt: meta.counters?.infraBuilt ?? 0,
    routesOpened: meta.counters?.routesOpened ?? 0,
    routesLost: meta.counters?.routesLost ?? 0,
    tradeVolume: meta.counters?.tradeVolume ?? 0,
    tributePaid: meta.counters?.tributePaid ?? 0,
    taxCollected: meta.counters?.taxCollected ?? 0,
    warsDeclared: meta.counters?.warsDeclared ?? 0,
    warsEnded: meta.counters?.warsEnded ?? 0,
    warDeaths: meta.counters?.warDeaths ?? 0,
    techDiscovered: meta.counters?.techDiscovered ?? 0,
    starvationDeaths: meta.counters?.starvationDeaths ?? 0,
    epidemicDeaths: meta.counters?.epidemicDeaths ?? 0,
    blessings: meta.counters?.blessings ?? 0,
    blights: meta.counters?.blights ?? 0,
    fertilized: meta.counters?.fertilized ?? 0,
    incited: meta.counters?.incited ?? 0,
  };

  const state: WorldState = {
    width,
    height,
    seaLevel: meta.seaLevel,
    recipe,
    grids,
    settlements,
    civs,
    day: meta.day,
    counters,
    rngStates,
    report: meta.report,
    society: allocateSociety(),
  };

  // Migration 1 → 2: a v1 save has no society block. It is initialised deterministically from the
  // legacy population (exact cohort split), never regenerated and never randomised.
  if (meta.schemaVersion >= 2) {
    // A v2 save must carry its society block. Falling back to a fresh society here would silently
    // reset a 200-year world (defect H-15).
    if (meta.society === undefined) throw new SimError('SAVE_CORRUPT', 'v2 save is missing its society block');
    state.society = decodeSociety(state, meta.society);
  } else {
    // genuine v1: migrate deterministically from the legacy population
    initialiseSociety(state, state.society);
  }

  return { state, schemaVersion: meta.schemaVersion };
}

function readU16Into(src: Uint8Array, offset: number, target: Uint16Array, count: number): number {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < count; i++) target[i] = dv.getUint16(offset + i * 2, true);
  return offset + count * 2;
}

function readU32Into(src: Uint8Array, offset: number, target: Uint32Array, count: number): number {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < count; i++) target[i] = dv.getUint32(offset + i * 4, true);
  return offset + count * 4;
}

function readI32Into(src: Uint8Array, offset: number, target: Int32Array, count: number): number {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < count; i++) target[i] = dv.getInt32(offset + i * 4, true);
  return offset + count * 4;
}

function readU8Into(src: Uint8Array, offset: number, target: Uint8Array, count: number): number {
  for (let i = 0; i < count; i++) target[i] = src[offset + i] ?? 0;
  return offset + count;
}
