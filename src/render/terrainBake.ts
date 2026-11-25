/**
 * Terrain baking: the whole world becomes one texture (docs/TECHNICAL_ARCHITECTURE.md §7).
 *
 * Every pixel here comes from real generated data: elevation for relief and depth, biome ids for
 * colour, river/lake ids for water, coast adjacency for the ink coastline. Nothing is decorative
 * noise pretending to be geography.
 */
import type { TerrainArrays } from '../core/gridTypes.ts';
import { BIOME_COLORS, INK, RIVER_INK, WATER_DEEP, WATER_SHALLOW, mix, shade, type Rgb } from './palette.ts';

export interface BakedTerrain {
  readonly canvas: HTMLCanvasElement;
  /** pixels per tile actually used (canvas size / world size) */
  readonly scale: number;
}

const MAX_BAKE = 2048;

function toRgba(c: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/** Water colour by depth below sea level (decimetres). */
function waterColor(depth: number): Rgb {
  if (depth > 1200) return WATER_DEEP;
  if (depth > 400) return mix(WATER_DEEP, WATER_SHALLOW, (depth - 400) / 800);
  return mix(WATER_SHALLOW, { r: 143, g: 176, b: 178 }, 1 - depth / 400);
}

/**
 * Bake the world to a canvas at `bakeSize` (capped at 2048).
 * A 3×3 elevation gradient lights the surface from the north-west, which is what makes a
 * top-down map read as terrain instead of a colour chart.
 */
export function bakeTerrain(
  grids: TerrainArrays,
  width: number,
  height: number,
  seaLevel: number,
  bakeSize = MAX_BAKE,
): BakedTerrain {
  const size = Math.max(256, Math.min(MAX_BAKE, Math.floor(bakeSize)));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D canvas unavailable for terrain bake');

  const scale = size / Math.max(width, height);
  const cw = size / width;
  const ch = size / height;

  // ---- pass 1: land + water fill with relief
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const elev = grids.elevation[i] ?? 0;
      const px = x * cw;
      const py = y * ch;
      const w = Math.ceil(cw) + 1;
      const h = Math.ceil(ch) + 1;

      if (elev < seaLevel) {
        const water = waterColor(seaLevel - elev);
        ctx.fillStyle = toRgba(water);
        ctx.fillRect(px, py, w, h);
        continue;
      }

      const biome = grids.biome[i] ?? 0;
      let base = BIOME_COLORS[biome] ?? BIOME_COLORS[8]!;

      if (biome === 2) {
        base = mix(WATER_SHALLOW, { r: 122, g: 160, b: 158 }, 0.5);
      } else if (biome === 3) {
        base = mix(base, RIVER_INK, 0.22);
      }

      // hillshade from the NW: brighter on NW-facing slopes, darker in the SE lee
      const eL = grids.elevation[y * width + Math.max(0, x - 1)] ?? elev;
      const eR = grids.elevation[y * width + Math.min(width - 1, x + 1)] ?? elev;
      const eU = grids.elevation[Math.max(0, y - 1) * width + x] ?? elev;
      const eD = grids.elevation[Math.min(height - 1, y + 1) * width + x] ?? elev;
      const gx = (eR - eL) / 20; // decimetres per cell -> slope in metres
      const gy = (eD - eU) / 20;
      const slope = Math.min(2.4, Math.sqrt(gx * gx + gy * gy) / 26);
      const light = Math.max(0.62, Math.min(1.34, 1 - (gx * 0.55 + gy * 0.55) * 0.06 + slope * 0.14));

      // high ground lightens, low ground warms toward paper
      const altitude = Math.max(0, Math.min(1, (elev - seaLevel) / 5000));
      let color = shade(base, light);
      color = mix(color, { r: 244, g: 236, b: 214 }, altitude * 0.16);
      if (biome >= 4) color = mix(color, { r: 252, g: 250, b: 246 }, altitude * 0.22);

      ctx.fillStyle = toRgba(color);
      ctx.fillRect(px, py, w, h);
    }
  }

  // ---- pass 2: rivers (tapered ink strokes from the river width tier)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const tier = grids.riverWidth[i] ?? 0;
      if (tier === 0) continue;
      const px = x * cw;
      const py = y * ch;
      const w = Math.max(1, (cw * (0.55 + tier * 0.5)) / 1);
      ctx.fillStyle = toRgba(mix(RIVER_INK, { r: 30, g: 52, b: 66 }, 0.35));
      ctx.fillRect(px + cw / 2 - w / 2, py, w, ch + 0.5);
    }
  }

  // ---- pass 3: coastline ink, drawn only on land cells that touch water
  ctx.fillStyle = toRgba(shade(INK, 1.0), 0.5);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if ((grids.elevation[i] ?? 0) < seaLevel) continue;
      const px = x * cw;
      const py = y * ch;
      const t = Math.max(0.8, Math.min(2, cw * 0.12));
      const leftWater = x > 0 && (grids.elevation[i - 1] ?? 0) < seaLevel;
      const rightWater = x < width - 1 && (grids.elevation[i + 1] ?? 0) < seaLevel;
      const upWater = y > 0 && (grids.elevation[i - width] ?? 0) < seaLevel;
      const downWater = y < height - 1 && (grids.elevation[i + width] ?? 0) < seaLevel;
      if (!leftWater && !rightWater && !upWater && !downWater) continue;
      if (leftWater) ctx.fillRect(px, py, t, ch + 0.5);
      if (rightWater) ctx.fillRect(px + cw - t, py, t, ch + 0.5);
      if (upWater) ctx.fillRect(px, py, cw + 0.5, t);
      if (downWater) ctx.fillRect(px, py + ch - t, cw + 0.5, t);
    }
  }

  // ---- pass 4: paper grain, very low contrast, breaks the flat digital look
  ctx.globalAlpha = 0.05;
  const grain = grainPattern(ctx);
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.globalAlpha = 1;

  return { canvas, scale };
}

let grainCache: CanvasPattern | null = null;

function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainCache) return grainCache;
  const tile = document.createElement('canvas');
  tile.width = 64;
  tile.height = 64;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;
  const img = tctx.createImageData(64, 64);
  let seed = 0x9e3779b9;
  for (let i = 0; i < 64 * 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const v = (seed >>> 24) & 0xff;
    const o = i * 4;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  grainCache = ctx.createPattern(tile, 'repeat');
  return grainCache;
}
