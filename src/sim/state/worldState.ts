import type { Seed } from '../../core/seed.ts';
import type { RngState } from '../../core/rng.ts';
import { TERRAIN_KEYS } from '../../core/gridTypes.ts';
import type { TerrainArrays, TerrainKey } from '../../core/gridTypes.ts';

export type Preset = 'small' | 'medium' | 'large';

/** Persisted recipe. `generatorVersion` freezes world content (see docs/WORLD_GENERATION.md §11). */
export interface WorldRecipe {
  readonly seed: Seed;
  readonly preset: Preset;
  readonly water: number;
  readonly harshness: number;
  readonly peoples: number;
  readonly generatorVersion: number;
}

export const GENERATOR_VERSION = 1;

export const CAPACITY = {
  settlements: 200,
  civs: 12,
  routes: 400,
  events: 20_000,
  characters: 60,
} as const;

/** Grid identity order is part of the save format. Never reorder (owned by core/gridTypes). */
export const GRID_KEYS = TERRAIN_KEYS;
export type GridKey = TerrainKey;

export type WorldGrids = TerrainArrays;

export const RESOURCE = {
  STONE: 1,
  METAL: 2,
  TIMBER: 4,
  HARBOUR: 8,
} as const;

export interface SettlementStore {
  count: number;
  x: Uint16Array;
  y: Uint16Array;
  pop: Int32Array;
  civ: Uint8Array;
  tier: Uint8Array;
  nameIdx: Uint16Array;
  foundedDay: Uint32Array;
}

export interface CivStore {
  count: number;
  capital: Uint16Array;
  colorIdx: Uint8Array;
  nameIdx: Uint16Array;
}

export interface WorldCounters {
  settlementsFounded: number;
  ticks: number;
  droppedTicks: number;
}

export interface GenerationReport {
  recipeHash: string;
  generatorVersion: number;
  width: number;
  height: number;
  landFraction: number; // per-mille
  elevationMin: number;
  elevationMax: number;
  biomeHistogram: number[]; // 16 entries
  riverCells: number;
  lakeCells: number;
  lakeCount: number;
  resourceHistogram: number[]; // stone, metal, timber, harbour counts
  spawnCount: number;
  validation: string[];
  warnings: string[];
  attempts: number;
  relaxations: string[];
  timingMs: number;
  windDirection: number;
}

export interface WorldState {
  readonly width: number;
  readonly height: number;
  readonly seaLevel: number;
  recipe: WorldRecipe;
  grids: WorldGrids;
  settlements: SettlementStore;
  civs: CivStore;
  day: number;
  counters: WorldCounters;
  rngStates: RngState[];
  report: GenerationReport;
}

export const TIER = {
  CAMP: 0,
  VILLAGE: 1,
  TOWN: 2,
  CITY: 3,
  METROPOLIS: 4,
} as const;

export type Tier = (typeof TIER)[keyof typeof TIER];

/** Tier thresholds are design constants (docs/GDD.md §7.1). */
export function tierOf(pop: number): Tier {
  if (pop >= 40_000) return TIER.METROPOLIS;
  if (pop >= 5_000) return TIER.CITY;
  if (pop >= 500) return TIER.TOWN;
  if (pop >= 60) return TIER.VILLAGE;
  return TIER.CAMP;
}

export function allocateGrids(width: number, height: number): WorldGrids {
  const n = width * height;
  return {
    elevation: new Int16Array(n),
    moisture: new Uint8Array(n),
    temperature: new Int8Array(n),
    biome: new Uint8Array(n),
    fertility: new Uint8Array(n),
    vegetation: new Uint8Array(n),
    riverId: new Uint16Array(n),
    riverWidth: new Uint8Array(n),
    lakeId: new Uint16Array(n),
    regionId: new Uint8Array(n),
    resource: new Uint8Array(n),
    owner: new Uint8Array(n),
  };
}

export function allocateSettlements(): SettlementStore {
  const cap = CAPACITY.settlements;
  return {
    count: 0,
    x: new Uint16Array(cap),
    y: new Uint16Array(cap),
    pop: new Int32Array(cap),
    civ: new Uint8Array(cap),
    tier: new Uint8Array(cap),
    nameIdx: new Uint16Array(cap),
    foundedDay: new Uint32Array(cap),
  };
}

export function allocateCivs(): CivStore {
  const cap = CAPACITY.civs;
  return {
    count: 0,
    capital: new Uint16Array(cap),
    colorIdx: new Uint8Array(cap),
    nameIdx: new Uint16Array(cap),
  };
}

export const idx = (x: number, y: number, width: number): number => y * width + x;
