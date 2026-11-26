/**
 * The only place colour exists (docs/UX_AND_VISUAL_DIRECTION.md §9, docs/ASSET_DIRECTION.md §4).
 * Simulation code never imports this: biome ids are data, colours are presentation.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export const BIOME_COLORS: readonly Rgb[] = [
  { r: 43, g: 74, b: 94 }, // 0 ocean (overridden by depth shading)
  { r: 178, g: 171, b: 132 }, // 1 coast / beach (survey sand, deliberately quiet)
  { r: 61, g: 100, b: 120 }, // 2 lake
  { r: 122, g: 141, b: 96 }, // 3 river valley
  { r: 223, g: 230, b: 230 }, // 4 glacier
  { r: 154, g: 167, b: 154 }, // 5 tundra
  { r: 85, g: 112, b: 90 }, // 6 boreal forest
  { r: 111, g: 138, b: 92 }, // 7 temperate forest
  { r: 154, g: 168, b: 106 }, // 8 grassland
  { r: 184, g: 168, b: 120 }, // 9 steppe
  { r: 203, g: 176, b: 131 }, // 10 desert
  { r: 168, g: 160, b: 98 }, // 11 savanna
  { r: 74, g: 122, b: 82 }, // 12 tropical forest
  { r: 125, g: 146, b: 122 }, // 13 wetland
  { r: 141, g: 133, b: 120 }, // 14 highland
  { r: 238, g: 241, b: 239 }, // 15 snow peak
];

export const WATER_DEEP: Rgb = { r: 32, g: 57, b: 74 };
export const WATER_MID: Rgb = { r: 60, g: 100, b: 120 };
export const WATER_SHALLOW: Rgb = { r: 93, g: 138, b: 154 };
export const RIVER_INK: Rgb = { r: 74, g: 112, b: 128 };
export const INK: Rgb = { r: 58, g: 50, b: 38 };
export const PAPER: Rgb = { r: 232, g: 220, b: 192 };

/** Twelve categorical civ hues, checked for adjacent-hue separation (ASSET_DIRECTION §4). */
export const CIV_COLORS: readonly number[] = [
  0xb4553f, 0x4f7a8c, 0x8a6f3e, 0x6b7f4a, 0x8c5a72, 0xb08a4a, 0x4a6b8a, 0x7a5a4a, 0x5f8a6a, 0xa06a3a,
  0x6a5f8a, 0x8a8a5a,
];

export function civColor(civId: number): number {
  const i = civId % CIV_COLORS.length;
  return CIV_COLORS[i < 0 ? 0 : i] ?? 0x8a8a5a;
}

export function css(rgb: Rgb): string {
  return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}

export function shade(c: Rgb, factor: number): Rgb {
  return {
    r: Math.max(0, Math.min(255, Math.round(c.r * factor))),
    g: Math.max(0, Math.min(255, Math.round(c.g * factor))),
    b: Math.max(0, Math.min(255, Math.round(c.b * factor))),
  };
}
