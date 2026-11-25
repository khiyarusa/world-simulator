/**
 * Synchronous world snapshot (stage 2.1, D-37).
 *
 * The save must describe **one** simulation state. Anything awaited inside the capture would let the
 * scheduler run a tick between two shards, producing a file whose terrain is day N and whose
 * metadata is day N+1. So the capture copies every byte and computes the checksum synchronously,
 * and only afterwards may the encoder compress (compression works on immutable copies).
 */
import { crc32 } from '../core/crc32.ts';
import { SAVE_SCHEMA_VERSION } from '../core/saveSchema.ts';
import { seedToText } from '../core/seed.ts';
import { worldChecksum } from '../sim/state/checksum.ts';
import { GRID_KEYS } from '../sim/state/worldState.ts';
import type { WorldState } from '../sim/state/worldState.ts';
import {
  CIVS_HEADER_BYTES,
  CIVS_MAGIC,
  GRID_BYTES,
  SETTLEMENTS_HEADER_BYTES,
  SETTLEMENTS_MAGIC,
  TERRAIN_HEADER_BYTES,
  TERRAIN_MAGIC,
} from './shardFormat.ts';
import type { MetaDoc, ShardName } from './shardFormat.ts';

export interface CapturedShard {
  readonly name: ShardName;
  /** CRC32 of `raw`, computed at capture time. */
  readonly crc32: number;
  /** Uncompressed size in bytes. */
  readonly bytes: number;
  /** Immutable copy of the payload as it was at capture time. */
  readonly raw: Uint8Array;
}

export interface WorldSnapshot {
  readonly schemaVersion: number;
  readonly day: number;
  /** World checksum of exactly the captured state, not of a later live state. */
  readonly checksum: number;
  readonly shards: readonly CapturedShard[];
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
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

/** A byte view of a typed array. Only safe for immediate copying (the caller must copy). */
function viewOf(view: Int16Array | Int8Array | Uint8Array | Uint16Array | Int32Array | Uint32Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

const encoder = new TextEncoder();

/** Capture the complete state synchronously. No `await` may appear in this function. */
export function captureWorld(state: WorldState, schemaVersion = SAVE_SCHEMA_VERSION): WorldSnapshot {
  const meta: MetaDoc = {
    schemaVersion,
    seedText: seedToText(state.recipe.seed),
    preset: state.recipe.preset,
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
    counters: { ...state.counters },
    rng: state.rngStates.map((s) => ({ s0: s.s0, s1: s.s1, s2: s.s2, s3: s.s3 })),
    report: state.report,
  };

  const terrainHeader = new Uint8Array(TERRAIN_HEADER_BYTES);
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
    const bytes = viewOf(state.grids[key]);
    const expected = GRID_BYTES[g]!;
    if (bytes.byteLength !== state.width * state.height * expected) {
      throw new Error(`grid ${key} has unexpected byte length`);
    }
    gridParts.push(bytes);
  }

  const s = state.settlements;
  const settHeader = new Uint8Array(SETTLEMENTS_HEADER_BYTES);
  const sdv = new DataView(settHeader.buffer);
  sdv.setUint32(0, SETTLEMENTS_MAGIC, true);
  sdv.setUint16(4, schemaVersion, true);
  sdv.setUint16(6, s.count, true);

  const c = state.civs;
  const civHeader = new Uint8Array(CIVS_HEADER_BYTES);
  const cdv = new DataView(civHeader.buffer);
  cdv.setUint32(0, CIVS_MAGIC, true);
  cdv.setUint16(4, schemaVersion, true);
  cdv.setUint16(6, c.count, true);

  const parts: Array<readonly [ShardName, Uint8Array]> = [
    ['meta', encoder.encode(JSON.stringify(meta))],
    ['terrain', concat([terrainHeader, ...gridParts])],
    [
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
    ],
    ['civs', concat([civHeader, viewOf(c.capital.subarray(0, c.count)), viewOf(c.colorIdx.subarray(0, c.count)), viewOf(c.nameIdx.subarray(0, c.count))])],
  ];

  const shards: CapturedShard[] = parts.map(([name, raw]) => ({
    name,
    crc32: crc32(raw),
    bytes: raw.byteLength,
    raw,
  }));

  return { schemaVersion, day: state.day, checksum: worldChecksum(state), shards };
}
