/**
 * Save shard serialisation (docs/SAVE_AND_DATA_MODEL.md §4).
 *
 * Binary grids with an explicit header, JSON only for the small meta shard. Every shard
 * carries a CRC32 of its uncompressed bytes so a corrupted save is detected, never half-read.
 */
import { crc32 } from '../core/crc32.ts';
import { asErrorMessage, SimError } from '../core/errors.ts';
import { seedOf, seedToText, parseSeedText } from '../core/seed.ts';
import type { Seed } from '../core/seed.ts';
import { STREAM_IDS } from '../core/rng.ts';
import type { RngState } from '../core/rng.ts';
import type { SaveShard } from './protocol.ts';
import { allocateCivs, allocateGrids, allocateSettlements, GRID_KEYS } from '../sim/state/worldState.ts';
import type { CivStore, GenerationReport, SettlementStore, WorldRecipe, WorldState } from '../sim/state/worldState.ts';

export { SAVE_SCHEMA_VERSION } from '../core/saveSchema.ts';
import { SAVE_SCHEMA_VERSION } from '../core/saveSchema.ts';
const TERRAIN_MAGIC = 0x31475357; // "WSG1" little-endian
const SETTLEMENTS_MAGIC = 0x31535357; // "WSS1"
const CIVS_MAGIC = 0x31564357; // "WCV1"

/** Bytes per element, in GRID_KEYS order. Part of the save format. */
const GRID_BYTES = [2, 1, 1, 1, 1, 1, 2, 1, 2, 1, 1, 1] as const;

interface MetaDoc {
  schemaVersion: number;
  seedText: string;
  recipe: { preset: string; water: number; harshness: number; peoples: number; generatorVersion: number };
  day: number;
  width: number;
  height: number;
  seaLevel: number;
  counters: { settlementsFounded: number; ticks: number; droppedTicks: number };
  rng: RngState[];
  report: GenerationReport;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function viewOf(view: Int16Array | Int8Array | Uint8Array | Uint16Array | Int32Array | Uint32Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

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

async function shardOf(name: string, raw: Uint8Array): Promise<SaveShard> {
  const crc = crc32(raw);
  const { bytes, compressed } = await compressIfUseful(raw);
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { name, crc32: crc, compressed, bytes: raw.byteLength, payload };
}

export async function serializeWorld(state: WorldState, schemaVersion = SAVE_SCHEMA_VERSION): Promise<SaveShard[]> {
  const meta: MetaDoc = {
    schemaVersion,
    seedText: seedToText(state.recipe.seed),
    recipe: {
      preset: state.recipe.preset,
      water: state.recipe.water,
      harshness: state.recipe.harshness,
      peoples: state.recipe.peoples,
      generatorVersion: state.recipe.generatorVersion,
    },
    day: state.day,
    width: state.width,
    height: state.height,
    seaLevel: state.seaLevel,
    counters: state.counters,
    rng: state.rngStates.map((s) => ({ s0: s.s0, s1: s.s1, s2: s.s2, s3: s.s3 })),
    report: state.report,
  };

  const terrainHeader = new Uint8Array(16);
  const tdv = new DataView(terrainHeader.buffer);
  tdv.setUint32(0, TERRAIN_MAGIC, true);
  tdv.setUint16(4, schemaVersion, true);
  tdv.setUint16(6, GRID_KEYS.length, true);
  tdv.setUint16(8, state.width, true);
  tdv.setUint16(10, state.height, true);
  tdv.setUint32(12, 0, true);

  const gridParts: Uint8Array[] = [];
  for (let g = 0; g < GRID_KEYS.length; g++) {
    const key = GRID_KEYS[g]!;
    const arr = state.grids[key];
    const expected = GRID_BYTES[g]!;
    const bytes = viewOf(arr);
    if (bytes.byteLength !== state.width * state.height * expected) {
      throw new SimError('INVARIANT', `grid ${key} has unexpected byte length`);
    }
    gridParts.push(bytes);
  }

  const settHeader = new Uint8Array(8);
  const sdv = new DataView(settHeader.buffer);
  sdv.setUint32(0, SETTLEMENTS_MAGIC, true);
  sdv.setUint16(4, schemaVersion, true);
  sdv.setUint16(6, state.settlements.count, true);

  const s = state.settlements;
  const civHeader = new Uint8Array(8);
  const cdv = new DataView(civHeader.buffer);
  cdv.setUint32(0, CIVS_MAGIC, true);
  cdv.setUint16(4, schemaVersion, true);
  cdv.setUint16(6, state.civs.count, true);
  const c = state.civs;

  const shards: SaveShard[] = [];
  shards.push(await shardOf('meta', encoder.encode(JSON.stringify(meta))));
  shards.push(await shardOf('terrain', concat([terrainHeader, ...gridParts])));
  shards.push(
    await shardOf(
      'settlements',
      concat([
        settHeader,
        viewOf(s.x.subarray(0, s.count)),
        viewOf(s.y.subarray(0, s.count)),
        viewOf(s.pop.subarray(0, s.count)),
        viewOf(s.civ.subarray(0, s.count)),
        viewOf(s.tier.subarray(0, s.count)),
        viewOf(s.nameIdx.subarray(0, s.count)),
        viewOf(s.foundedDay.subarray(0, s.count)),
      ]),
    ),
  );
  shards.push(
    await shardOf(
      'civs',
      concat([civHeader, viewOf(c.capital.subarray(0, c.count)), viewOf(c.colorIdx.subarray(0, c.count)), viewOf(c.nameIdx.subarray(0, c.count))]),
    ),
  );
  return shards;
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
    // Truncated headers and short payloads surface as RangeError from DataView; both mean the
    // same thing to the player: this save is damaged.
    throw new SimError('SAVE_CORRUPT', asErrorMessage(e));
  }
}

async function deserializeInner(shards: readonly SaveShard[]): Promise<DeserializedWorld> {
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
  if (meta.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SimError('SAVE_SCHEMA_NEWER', `save is version ${meta.schemaVersion}`);
  }

  const parsedSeed = parseSeedText(meta.seedText);
  if (!parsedSeed) throw new SimError('SAVE_CORRUPT', 'seed unreadable');
  const seed: Seed = seedOf(parsedSeed.lo, parsedSeed.hi);

  const { width, height } = meta;
  const grids = allocateGrids(width, height);
  const terrain = await readShard(terrainShard);
  const tdv = new DataView(terrain.buffer, terrain.byteOffset, terrain.byteLength);
  if (tdv.getUint32(0, true) !== TERRAIN_MAGIC) throw new SimError('SAVE_CORRUPT', 'terrain magic');
  if (tdv.getUint16(4, true) !== meta.schemaVersion) throw new SimError('SAVE_CORRUPT', 'terrain version');
  if (tdv.getUint16(6, true) !== GRID_KEYS.length) throw new SimError('SAVE_CORRUPT', 'grid count');
  if (tdv.getUint16(8, true) !== width || tdv.getUint16(10, true) !== height) {
    throw new SimError('SAVE_CORRUPT', 'grid dimensions');
  }
  let offset = 16;
  for (let g = 0; g < GRID_KEYS.length; g++) {
    const key = GRID_KEYS[g]!;
    const bytesPer = GRID_BYTES[g]!;
    const len = width * height * bytesPer;
    if (offset + len > terrain.byteLength) throw new SimError('SAVE_CORRUPT', `terrain truncated at ${key}`);
    new Uint8Array(grids[key].buffer, grids[key].byteOffset, len).set(
      new Uint8Array(terrain.buffer, terrain.byteOffset + offset, len),
    );
    offset += len;
  }

  const settlements: SettlementStore = allocateSettlements();
  const sett = await readShard(settShard);
  const sdv = new DataView(sett.buffer, sett.byteOffset, sett.byteLength);
  if (sdv.getUint32(0, true) !== SETTLEMENTS_MAGIC) throw new SimError('SAVE_CORRUPT', 'settlements magic');
  const sCount = sdv.getUint16(6, true);
  if (sCount > settlements.x.length) throw new SimError('SAVE_CORRUPT', 'settlement count over capacity');
  settlements.count = sCount;
  let so = 8;
  so = readU16Into(sett, so, settlements.x, sCount);
  so = readU16Into(sett, so, settlements.y, sCount);
  so = readI32Into(sett, so, settlements.pop, sCount);
  so = readU8Into(sett, so, settlements.civ, sCount);
  so = readU8Into(sett, so, settlements.tier, sCount);
  so = readU16Into(sett, so, settlements.nameIdx, sCount);
  readU32Into(sett, so, settlements.foundedDay, sCount);

  const civs: CivStore = allocateCivs();
  const civBytes = await readShard(civShard);
  const cdv = new DataView(civBytes.buffer, civBytes.byteOffset, civBytes.byteLength);
  if (cdv.getUint32(0, true) !== CIVS_MAGIC) throw new SimError('SAVE_CORRUPT', 'civs magic');
  const cCount = cdv.getUint16(6, true);
  if (cCount > civs.capital.length) throw new SimError('SAVE_CORRUPT', 'civ count over capacity');
  civs.count = cCount;
  let co = 8;
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

  const rngStates: RngState[] = STREAM_IDS.map((_, i) => {
    const s = meta.rng[i];
    return s ? { s0: s.s0 >>> 0, s1: s.s1 >>> 0, s2: s.s2 >>> 0, s3: s.s3 >>> 0 } : { s0: 1, s1: 0, s2: 0, s3: 0 };
  });

  const state: WorldState = {
    width,
    height,
    seaLevel: meta.seaLevel,
    recipe,
    grids,
    settlements,
    civs,
    day: meta.day,
    counters: meta.counters,
    rngStates,
    report: meta.report,
  };

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
