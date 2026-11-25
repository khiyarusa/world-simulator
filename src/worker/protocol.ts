/**
 * Worker protocol (docs/TECHNICAL_ARCHITECTURE.md §5).
 *
 * Discriminated by `t`. Typed arrays are transferred, never cloned, and the main thread
 * returns them through `release` so the worker can reuse its pooled buffers.
 */
import type { GenerationReport, WorldRecipe } from '../sim/state/worldState.ts';
import type { TerrainArrays } from '../core/gridTypes.ts';

export type Speed = 0 | 1 | 2 | 4 | 8;
export const SPEEDS: readonly Speed[] = [0, 1, 2, 4, 8];

export const DAY_MS = 400;
export const MAX_TICKS_PER_PASS = 4;
export const MAX_BACKLOG = 30;
export const MAX_DELTA_HZ = 4;

export interface MirrorDelta {
  seq: number;
  day: number;
  count: number;
  id: Uint16Array;
  pop: Int32Array;
  civ: Uint8Array;
  tier: Uint8Array;
}

export interface SettlementLayout {
  readonly x: Uint16Array;
  readonly y: Uint16Array;
  readonly nameIdx: Uint16Array;
  readonly civ: Uint8Array;
  readonly tier: Uint8Array;
  readonly pop: Int32Array;
}

export interface CivLayout {
  readonly nameIdx: Uint16Array;
  readonly colorIdx: Uint8Array;
}

export interface WorldMetaMsg {
  readonly width: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly recipe: WorldRecipe;
  readonly report: GenerationReport;
  readonly day: number;
  readonly settlements: SettlementLayout;
  readonly civs: CivLayout;
}

export interface SaveShard {
  readonly name: string;
  readonly crc32: number;
  readonly compressed: boolean;
  readonly bytes: number;
  readonly payload: ArrayBuffer;
}

export type QueryWhat =
  | { readonly kind: 'world' }
  | { readonly kind: 'settlement'; readonly id: number }
  | { readonly kind: 'settlement-list' }
  | { readonly kind: 'debug' };

export interface SettlementDetail {
  readonly id: number;
  readonly name: string;
  readonly civName: string;
  readonly civId: number;
  readonly x: number;
  readonly y: number;
  readonly pop: number;
  readonly tier: number;
  readonly foundedDay: number;
  readonly biome: number;
  readonly riverId: number;
  readonly lakeId: number;
  readonly fertility: number;
  readonly resource: number;
  readonly owner: number;
}

export type Cmd =
  | { readonly t: 'init'; readonly maxSettlements: number }
  | {
      readonly t: 'create';
      readonly recipe: WorldRecipe;
    }
  | { readonly t: 'load'; readonly shards: readonly SaveShard[] }
  | { readonly t: 'speed'; readonly speed: Speed }
  | { readonly t: 'view'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly zoom: number }
  | { readonly t: 'select'; readonly id: number | null }
  | { readonly t: 'query'; readonly qid: number; readonly what: QueryWhat }
  | { readonly t: 'save'; readonly sid: number }
  | { readonly t: 'preview'; readonly token: number; readonly recipe: WorldRecipe }
  | { readonly t: 'pause' }
  | { readonly t: 'resume' }
  | { readonly t: 'release'; readonly buffers: readonly ArrayBuffer[] }
  | { readonly t: 'dispose' };

export type WorkerMsg =
  | { readonly t: 'ready' }
  | { readonly t: 'progress'; readonly stage: string; readonly pct: number }
  | { readonly t: 'worldMeta'; readonly meta: WorldMetaMsg }
  // Sent once per created/loaded world. Structured-cloned (a one-off ~0.5 MB copy), because
  // transferring would detach the worker's own authoritative grids.
  | { readonly t: 'terrain'; readonly width: number; readonly height: number; readonly grids: TerrainArrays }
  | { readonly t: 'delta'; readonly delta: MirrorDelta }
  | { readonly t: 'stats'; readonly tickP50: number; readonly tickP95: number; readonly tickMax: number; readonly dropped: number; readonly speed: Speed; readonly day: number }
  | { readonly t: 'queryResult'; readonly qid: number; readonly data: unknown }
  | {
      readonly t: 'previewResult';
      readonly token: number;
      readonly width: number;
      readonly height: number;
      readonly biome: Uint8Array;
      readonly elevation: Int16Array;
    }
  | ({ readonly t: 'saveShard' } & SaveShard)
  | { readonly t: 'saveDone'; readonly sid: number; readonly checksum: string; readonly bytes: number }
  | { readonly t: 'notify'; readonly level: 'info' | 'warn' | 'error'; readonly code: string; readonly msg: string }
  | { readonly t: 'crashed'; readonly code: string; readonly msg: string; readonly lastGoodDay: number };

/** Transfer list for a message, or undefined when nothing is transferable. */
export function transferListOf(msg: WorkerMsg): Transferable[] | undefined {
  if (msg.t === 'delta') {
    const d = msg.delta;
    return [d.id.buffer, d.pop.buffer, d.civ.buffer, d.tier.buffer];
  }
  return undefined;
}
