/**
 * Grid array types shared by the simulation and the renderer.
 *
 * This module is deliberately data-only: it lets the renderer receive a world's grids without
 * importing anything from `src/sim/**` (AGENTS.md R-10 keeps the dependency arrow one-way).
 */
export interface TerrainArrays {
  /** decimetres above sea level */
  elevation: Int16Array;
  moisture: Uint8Array;
  /** degrees Celsius, annual mean */
  temperature: Int8Array;
  biome: Uint8Array;
  fertility: Uint8Array;
  vegetation: Uint8Array;
  riverId: Uint16Array;
  /** 1..5 visual / trade thickness tier */
  riverWidth: Uint8Array;
  lakeId: Uint16Array;
  regionId: Uint8Array;
  /** bitfield of RESOURCE flags */
  resource: Uint8Array;
  /** 0 = unclaimed, else civ index + 1 */
  owner: Uint8Array;
}

export type TerrainKey = keyof TerrainArrays;

/** Frozen order; part of the save format and of the terrain message. */
export const TERRAIN_KEYS: readonly TerrainKey[] = [
  'elevation',
  'moisture',
  'temperature',
  'biome',
  'fertility',
  'vegetation',
  'riverId',
  'riverWidth',
  'lakeId',
  'regionId',
  'resource',
  'owner',
];
