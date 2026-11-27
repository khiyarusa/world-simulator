/**
 * Shared terrain pixel language for the overview bake and the regional detail chunks.
 *
 * Every value is a deterministic function of the real grids. The style is a mineral survey plate:
 * warm paper light, olive/ochre biome families, blue-grey water, NW relief and restrained material
 * grain. `detail` enables finer material motifs for close zoom without changing geography.
 */
import type { TerrainArrays } from '../core/gridTypes.ts';
import { BIOME_COLORS, RIVER_INK, WATER_DEEP, WATER_SHALLOW, mix, shade, type Rgb } from './palette.ts';

export const PAPER = { r: 244, g: 233, b: 205 } as const;
const COOL = { r: 176, g: 198, b: 200 } as const;
const OCHRE = { r: 208, g: 174, b: 112 } as const;
const CANOPY = { r: 78, g: 104, b: 62 } as const;
const ROCK = { r: 132, g: 122, b: 106 } as const;
const SNOW = { r: 244, g: 246, b: 246 } as const;
const CONTOUR_DM = 360;

export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise from four hashed corners; deterministic and cheap. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
}

export function fbm(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function bilinear(grid: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const a = grid[y0 * width + x0] ?? 0;
  const b = grid[y0 * width + x1] ?? 0;
  const c = grid[y1 * width + x0] ?? 0;
  const d = grid[y1 * width + x1] ?? 0;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

export function waterColor(depth: number, _detail: boolean): Rgb {
  // Continuous depth stops: a jump at 500 dm was a visible hard band at regional zoom.
  const shelf = { r: 196, g: 216, b: 205 } as const;
  const mid = mix(WATER_SHALLOW, WATER_DEEP, 0.38);
  let color: Rgb;
  if (depth < 120) color = mix(shelf, WATER_SHALLOW, depth / 120);
  else if (depth < 600) color = mix(WATER_SHALLOW, mid, (depth - 120) / 480);
  else if (depth < 1800) color = mix(mid, WATER_DEEP, (depth - 600) / 1200);
  else color = WATER_DEEP;
  if (depth < 220) color = mix(color, { r: 176, g: 190, b: 168 }, (1 - depth / 220) * 0.12);
  return color;
}

function biomeFamily(biome: number): 'forest' | 'dry' | 'grass' | 'wet' | 'rock' | 'snow' | 'other' {
  if (biome === 6 || biome === 7 || biome === 12) return 'forest';
  if (biome === 10 || biome === 11) return 'dry';
  if (biome === 2 || biome === 8 || biome === 9) return 'grass';
  if (biome === 3) return 'wet';
  if (biome === 4 || biome === 5 || biome === 15) return 'rock';
  if (biome === 13 || biome === 14) return 'snow';
  return 'other';
}

/** Bilinear biome-colour blend hides the categorical cell grid without inventing geography. */
function blendBiomeColor(grids: TerrainArrays, width: number, height: number, gx: number, gy: number): Rgb {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(gy)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, gx - x0));
  const fy = Math.max(0, Math.min(1, gy - y0));
  const at = (x: number, y: number): Rgb => {
    const b = grids.biome[y * width + x] ?? 8;
    return BIOME_COLORS[b === 0 || b === 2 ? 8 : b] ?? BIOME_COLORS[8]!;
  };
  const a = mix(at(x0, y0), at(x1, y0), fx);
  const c = mix(at(x0, y1), at(x1, y1), fx);
  return mix(a, c, fy);
}

/** The complete land/water pixel. `x,y` are pixel coordinates (stable hash inputs). */
export function paintPixel(
  grids: TerrainArrays,
  width: number,
  height: number,
  seaLevel: number,
  gx: number,
  gy: number,
  x: number,
  y: number,
  detail: boolean,
): Rgb {
  const elevation = bilinear(grids.elevation, width, height, gx, gy);
  const depth = seaLevel - elevation;
  if (depth > 0) {
    let color = waterColor(depth, detail);
    const band = Math.sin((depth + gy * 2.2) * 0.018) * 0.014;
    color = shade(color, 1 + band);
    if (detail && depth < 1600) {
      const ripple = Math.sin((gx * 3.2 + gy * 1.6) + valueNoise(gx * 0.7, gy * 0.7) * 5) * 0.5 + 0.5;
      const fine = Math.sin((gx * 11.7 - gy * 5.3) + valueNoise(gx * 2.3, gy * 2.3) * 4) * 0.5 + 0.5;
      color = shade(color, 1 + (ripple - 0.5) * 0.07 + (fine - 0.5) * 0.025);
    }
    return color;
  }

  const gxi = Math.max(0, Math.min(width - 1, Math.round(gx)));
  const gyi = Math.max(0, Math.min(height - 1, Math.round(gy)));
  const tile = gyi * width + gxi;
  const biome = grids.biome[tile] ?? 0;
  const family = biomeFamily(biome);
  let base = blendBiomeColor(grids, width, height, gx, gy);
  if (family === 'wet') base = mix(WATER_SHALLOW, { r: 118, g: 146, b: 126 }, 0.55);

  // Inland lakes can sit above sea level; sample the four nearest lake flags so the pond has a soft
  // shore instead of a hard biome-coloured square at close zoom.
  const lx0 = Math.max(0, Math.min(width - 1, Math.floor(gx)));
  const ly0 = Math.max(0, Math.min(height - 1, Math.floor(gy)));
  const lx1 = Math.min(width - 1, lx0 + 1);
  const ly1 = Math.min(height - 1, ly0 + 1);
  const lfx = Math.max(0, Math.min(1, gx - lx0));
  const lfy = Math.max(0, Math.min(1, gy - ly0));
  const lakeAt = (x: number, y: number): number => ((grids.lakeId[y * width + x] ?? 0) > 0 ? 1 : 0);
  const lakeWet = lakeAt(lx0, ly0) * (1 - lfx) * (1 - lfy) + lakeAt(lx1, ly0) * lfx * (1 - lfy) + lakeAt(lx0, ly1) * (1 - lfx) * lfy + lakeAt(lx1, ly1) * lfx * lfy;
  if (lakeWet > 0.02) base = mix(base, { r: 86, g: 126, b: 134 }, smoothstep(0.15, 0.8, lakeWet));

  const moisture = bilinear(grids.moisture, width, height, gx, gy) / 255;
  const temp = bilinear(grids.temperature, width, height, gx, gy);
  const d = 0.82;
  const eL = bilinear(grids.elevation, width, height, gx - d, gy);
  const eR = bilinear(grids.elevation, width, height, gx + d, gy);
  const eU = bilinear(grids.elevation, width, height, gx, gy - d);
  const eD = bilinear(grids.elevation, width, height, gx, gy + d);
  const nx = (eR - eL) / (d * 16);
  const ny = (eD - eU) / (d * 16);
  const slope = Math.min(3.2, Math.sqrt(nx * nx + ny * ny) / 24);
  const mean = (eL + eR + eU + eD) / 4;
  const local = Math.max(-420, Math.min(420, elevation - mean));
  const altitude = Math.max(0, Math.min(1, (elevation - seaLevel) / 5200));

  // NW light, gentle curvature; the aim is a drawn relief, not an overexposed satellite photo
  const light = Math.max(0.5, Math.min(1.32, 1 - (nx * 0.8 + ny * 0.8) * 0.075 + slope * 0.22 + local * 0.00052));
  base = colorGrade(base, moisture, temp, altitude, slope, family);

  const paper = detail ? 0.02 : 0.035;
  base = mix(base, PAPER, paper + altitude * 0.07);
  base = shade(base, light);

  const n1 = detail ? fbm(gx * 1.7, gy * 1.7, 3) : valueNoise(gx * 1.7, gy * 1.7);
  const n2 = hash2(x, y);
  const grain = (n2 - 0.5) * (detail ? 0.075 : 0.045) + (n1 - 0.5) * 0.08;
  base = shade(base, 1 + grain);

  if (family === 'forest') {
    const canopy = detail ? fbm(gx * 2.1, gy * 2.1, 3) : valueNoise(gx * 2.1, gy * 2.1);
    if (canopy > 0.5) base = mix(base, CANOPY, (canopy - 0.5) * 0.4);
    const fine = detail ? fbm(gx * 11, gy * 11, 3) : valueNoise(gx * 5, gy * 5);
    base = shade(base, 1 + (fine - 0.5) * (detail ? 0.22 : 0.1));
    const leaf = valueNoise(gx * (detail ? 34 : 12), gy * (detail ? 34 : 12));
    if (leaf > 0.72) base = mix(base, CANOPY, 0.12);
  } else if (family === 'dry') {
    const dune = Math.sin(gy * 4.1 + valueNoise(gx * 0.5, gy * 0.5) * 5.5) * 0.5 + 0.5;
    base = shade(base, 1 + (dune - 0.5) * (detail ? 0.075 : 0.05));
    const grit = detail ? fbm(gx * 13, gy * 13, 3) : valueNoise(gx * 6, gy * 6);
    const dune2 = Math.sin(gy * 9.1 + valueNoise(gx * 0.9, gy * 0.9) * 7) * 0.5 + 0.5;
    base = shade(base, 1 + (grit - 0.5) * (detail ? 0.16 : 0.07) + (detail ? (dune2 - 0.5) * 0.04 : 0));
  } else if (family === 'grass') {
    const tuft = detail ? fbm(gx * 15, gy * 15, 3) : valueNoise(gx * 6, gy * 6);
    const stroke = Math.sin(gx * 9.3 + valueNoise(gx * 1.4, gy * 1.4) * 6) * 0.5 + 0.5;
    base = shade(base, 1 + (tuft - 0.5) * (detail ? 0.18 : 0.08) + (detail ? (stroke - 0.5) * 0.035 : 0));
    base = mix(base, OCHRE, Math.max(0, 0.12 - moisture) * 0.5);
  } else if (family === 'rock') {
    base = mix(base, ROCK, Math.min(0.5, slope * 0.22));
    if (altitude > 0.52) base = mix(base, SNOW, Math.min(0.85, (altitude - 0.52) * 1.7));
    const ridge = Math.abs(((elevation - seaLevel) % CONTOUR_DM + CONTOUR_DM) % CONTOUR_DM);
    if (ridge < (detail ? 14 : 10) && slope > 0.06) base = shade(base, 0.9);
    if (detail) {
      const striation = Math.sin((elevation + gx * 3.7) * 0.05 + valueNoise(gx, gy) * 6) * 0.5 + 0.5;
      base = shade(base, 1 + (striation - 0.5) * 0.05);
    }
  } else if (family === 'wet') {
    const pool = fbm(gx * 2.4, gy * 2.4, 2);
    if (pool > 0.58) base = mix(base, { r: 92, g: 126, b: 130 }, (pool - 0.58) * 0.8);
  } else if (family === 'snow') {
    base = mix(base, SNOW, 0.5 + altitude * 0.3);
    const crevasse = Math.sin((gx * 6.1 - gy * 2.3) + valueNoise(gx, gy) * 5) * 0.5 + 0.5;
    if (detail && crevasse > 0.8) base = shade(base, 0.93);
  }

  if (temp < 20) base = mix(base, COOL, Math.min(0.16, (20 - temp) / 200));
  if (temp > 30) base = mix(base, OCHRE, Math.min(0.1, (temp - 30) / 220));
  return base;
}

function colorGrade(
  base: Rgb,
  moisture: number,
  _temp: number,
  altitude: number,
  slope: number,
  family: string,
): Rgb {
  // A single mineral grade stops the palette reading as flat saturation.
  const graded = mix(base, PAPER, 0.045);
  const luma = (graded.r * 0.3 + graded.g * 0.6 + graded.b * 0.1) / 255;
  const warmed = mix(graded, { r: 218, g: 196, b: 154 }, Math.max(0, 0.48 - luma) * 0.18);
  let r = warmed.r;
  let g = warmed.g;
  const b = warmed.b;
  if (family === 'forest') {
    r = Math.round(r * (1 - moisture * 0.08));
    g = Math.round(g * (0.96 + moisture * 0.04));
  }
  if (slope > 0.2 && altitude > 0.25) {
    r = Math.round(r * 0.98);
    g = Math.round(g * 0.98);
  }
  return { r, g, b };
}

export { RIVER_INK, mix, shade };
export type { Rgb };
