/**
 * Save shard format constants (docs/SAVE_AND_DATA_MODEL.md §4).
 *
 * One source of truth for the wire format: the encoder and the decoder both import these, so a
 * header can never be written with one set of constants and read with another.
 */
import type { RngState } from '../core/rng.ts';
import type { GenerationReport, WorldRecipe } from '../sim/state/worldState.ts';

export const TERRAIN_MAGIC = 0x31475357; // "WSG1"
export const SETTLEMENTS_MAGIC = 0x31535357; // "WSS1"
export const CIVS_MAGIC = 0x31564357; // "WCV1"

/** Bytes per element, in GRID_KEYS order. Part of the save format. */
export const GRID_BYTES = [2, 1, 1, 1, 1, 1, 2, 1, 2, 1, 1, 1] as const;

export const TERRAIN_HEADER_BYTES = 16;
export const SETTLEMENTS_HEADER_BYTES = 8;
export const CIVS_HEADER_BYTES = 8;

/** Bytes per settlement record: x,y(u16) pop(i32) civ,tier(u8) nameIdx(u16) foundedDay(u32). */
export const SETTLEMENT_RECORD_BYTES = 16;
/** Bytes per civ record: capital(u16) colorIdx(u8) nameIdx(u16). */
export const CIV_RECORD_BYTES = 5;

// Shard identity and completeness rules are owned by core/saveSchema.ts (D-36).
export { SHARD_NAMES, REQUIRED_SHARDS, checkShardSet, isShardName } from '../core/saveSchema.ts';
export type { ShardName } from '../core/saveSchema.ts';

/** JSON metadata shard. Shape is versioned by `schemaVersion`. */
export interface MetaDoc {
  schemaVersion: number;
  seedText: string;
  preset: string;
  recipe: {
    preset: string;
    water: number;
    harshness: number;
    peoples: number;
    generatorVersion: number;
  };
  day: number;
  width: number;
  height: number;
  seaLevel: number;
  counters: {
    settlementsFounded: number;
    ticks: number;
    droppedTicks: number;
    births?: number;
    deaths?: number;
    migrants?: number;
    abandonments?: number;
    foodProduced?: number;
    foodConsumed?: number;
    infraBuilt?: number;
    routesOpened?: number;
    routesLost?: number;
    tradeVolume?: number;
    tributePaid?: number;
    taxCollected?: number;
    warsDeclared?: number;
    warsEnded?: number;
    warDeaths?: number;
    techDiscovered?: number;
    starvationDeaths?: number;
    epidemicDeaths?: number;
    blessings?: number;
    blights?: number;
    fertilized?: number;
    incited?: number;
  };
  rng: RngState[];
  report: GenerationReport;
  /** Stage 3 society block (schema v2). Absent in v1 saves, which are migrated on load. */
  society?: unknown;
}

export type { WorldRecipe };
