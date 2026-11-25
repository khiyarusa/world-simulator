/**
 * Biome classification and yield tables. Classification is simulation data (docs/GDD.md §4.1);
 * colours live only in the renderer (docs/UX_AND_VISUAL_DIRECTION.md §9.1).
 */

export const BIOME = {
  OCEAN: 0,
  COAST: 1,
  LAKE: 2,
  RIVER: 3,
  GLACIER: 4,
  TUNDRA: 5,
  BOREAL_FOREST: 6,
  TEMPERATE_FOREST: 7,
  GRASSLAND: 8,
  STEPPE: 9,
  DESERT: 10,
  SAVANNA: 11,
  TROPICAL_FOREST: 12,
  WETLAND: 13,
  HIGHLAND: 14,
  SNOW: 15,
} as const;

export const BIOME_COUNT = 16;

export const BIOME_NAMES: readonly string[] = [
  'Ocean',
  'Coast',
  'Lake',
  'River valley',
  'Glacier',
  'Tundra',
  'Boreal forest',
  'Temperate forest',
  'Grassland',
  'Steppe',
  'Desert',
  'Savanna',
  'Tropical forest',
  'Wetland',
  'Highland',
  'Snow peak',
];

/** Base fertility 0..255. Floodplains and river valleys are the best farmland. */
export const BIOME_FERTILITY: Uint8Array = Uint8Array.from([
  0, 20, 0, 190, 0, 20, 70, 120, 170, 90, 10, 110, 130, 180, 40, 0,
]);

/** Timber potential 0..255. */
export const BIOME_WOOD: Uint8Array = Uint8Array.from([
  0, 10, 0, 60, 0, 10, 200, 230, 20, 5, 0, 40, 240, 90, 20, 0,
]);

/** Base vegetation biomass at world creation, 0..255. */
export const BIOME_VEGETATION: Uint8Array = Uint8Array.from([
  0, 30, 20, 150, 0, 40, 210, 240, 150, 70, 10, 170, 245, 200, 60, 0,
]);

export interface BiomeInput {
  readonly elevation: number;
  readonly seaLevel: number;
  readonly temperature: number;
  readonly moisture: number;
  readonly isLake: boolean;
  readonly isRiver: boolean;
  readonly isCoast: boolean;
  readonly slope: number;
}

export function classifyBiome(i: BiomeInput): number {
  if (i.elevation < i.seaLevel) return BIOME.OCEAN;
  if (i.isLake) return BIOME.LAKE;
  if (i.elevation > 6500 || i.temperature < -15) return BIOME.SNOW;
  if (i.elevation > 4000) return BIOME.HIGHLAND;
  if (i.temperature < -12) return BIOME.GLACIER;
  if (i.isRiver && i.slope <= 2) return BIOME.RIVER;
  if (i.isCoast && i.elevation < i.seaLevel + 150) return BIOME.COAST;
  if (i.moisture > 200 && i.slope <= 1) return BIOME.WETLAND;
  if (i.temperature < -2) return BIOME.TUNDRA;
  if (i.moisture < 30 && i.temperature > 12) return BIOME.DESERT;
  if (i.temperature > 22 && i.moisture > 140) return BIOME.TROPICAL_FOREST;
  if (i.temperature >= 6 && i.temperature <= 20 && i.moisture > 120) return BIOME.TEMPERATE_FOREST;
  if (i.temperature < 6 && i.moisture > 90) return BIOME.BOREAL_FOREST;
  if (i.temperature > 22 && i.moisture >= 60) return BIOME.SAVANNA;
  if (i.temperature >= 6 && i.temperature <= 24 && i.moisture >= 60) return BIOME.GRASSLAND;
  if (i.moisture >= 30 && i.moisture < 60) return BIOME.STEPPE;
  if (i.temperature < 6) return BIOME.BOREAL_FOREST;
  return BIOME.GRASSLAND;
}

export function isWaterBiome(biome: number): boolean {
  return biome === BIOME.OCEAN || biome === BIOME.LAKE;
}

/** Rough habitability weight used by spawn scoring, 0..1000. */
export const BIOME_HABITABILITY: Uint16Array = Uint16Array.from([
  0, 520, 0, 900, 0, 180, 420, 620, 880, 560, 80, 600, 500, 640, 260, 0,
]);
