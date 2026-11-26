/**
 * Terrain baking (Stage 5 WP2): one deterministic atlas plate from the real grids.
 *
 * Pipeline:
 *  1. bilinear elevation/moisture/temperature + nearest biome at bake resolution
 *  2. directional relief, altitude wash, biome grain and contour hints
 *  3. depth-graded water with a coastal shelf
 *  4. connected river polylines (not per-tile rectangles)
 *  5. coastline and lake inks
 *  6. very low-contrast paper grain
 *
 * No generated value is invented: every pixel is a function of the same elevation, moisture,
 * temperature, biome and hydrology arrays the simulation owns. No Math.random, no wall clock.
 */
import type { TerrainArrays } from '../core/gridTypes.ts';
import { BIOME_COLORS, RIVER_INK, WATER_DEEP, WATER_SHALLOW, mix, shade, type Rgb } from './palette.ts';

export interface BakedTerrain {
  readonly canvas: HTMLCanvasElement;
  readonly pixelsPerTile: number;
}

const MAX_BAKE = 896;
const CONTOUR_DM = 420;

function toRgba(c: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/** Deterministic per-pixel value noise, used only for restrained material grain. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function bilinear(grid: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
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

/** Water colour by depth below sea level (decimetres). */
function waterColor(depth: number): Rgb {
  if (depth > 1500) return WATER_DEEP;
  if (depth > 500) return mix(WATER_DEEP, WATER_SHALLOW, (depth - 500) / 1000);
  const shelf = mix(WATER_SHALLOW, { r: 153, g: 187, b: 187 }, 1 - depth / 500);
  return mix(shelf, { r: 196, g: 216, b: 205 }, Math.max(0, 1 - depth / 90) * 0.45);
}

export function bakeTerrain(
  grids: TerrainArrays,
  width: number,
  height: number,
  seaLevel: number,
  bakeSize = MAX_BAKE,
): BakedTerrain {
  const px = Math.max(384, Math.min(MAX_BAKE, Math.floor(bakeSize)));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D canvas unavailable for terrain bake');

  const cw = px / width;
  const ch = px / height;
  const img = ctx.createImageData(px, px);
  const data = img.data;

  for (let y = 0; y < px; y++) {
    const gy = (y + 0.5) / ch - 0.5;
    for (let x = 0; x < px; x++) {
      const gx = (x + 0.5) / cw - 0.5;
      const at = (y * px + x) * 4;
      const elevation = bilinear(grids.elevation, width, height, gx, gy);
      const depth = seaLevel - elevation;
      let color: Rgb;
      if (depth > 0) {
        color = waterColor(depth);
        // faint depth bands and a coastal shelf; no animated water (explicitly out of scope)
        const band = Math.sin((depth + gy * 2.2) * 0.018) * 0.012;
        color = shade(color, 1 + band);
      } else {
        const biome = grids.biome[Math.max(0, Math.min(height - 1, Math.round(gy))) * width + Math.max(0, Math.min(width - 1, Math.round(gx)))] ?? 0;
        let base = BIOME_COLORS[biome] ?? BIOME_COLORS[8]!;
        if (biome === 2) base = mix(WATER_SHALLOW, { r: 122, g: 160, b: 158 }, 0.5);
        else if (biome === 3) base = mix(base, RIVER_INK, 0.18);

        const moisture = bilinear(grids.moisture, width, height, gx, gy) / 255;
        // Shading neighbours use the exact grid cells; only the base elevation is interpolated.
        // This keeps the relief tied to real cells and removes four bilinear samples per pixel.
        const gxi = Math.max(0, Math.min(width - 1, Math.round(gx)));
        const gyi = Math.max(0, Math.min(height - 1, Math.round(gy)));
        const row = gyi * width;
        const eL = grids.elevation[row + Math.max(0, gxi - 1)] ?? elevation;
        const eR = grids.elevation[row + Math.min(width - 1, gxi + 1)] ?? elevation;
        const eU = grids.elevation[Math.max(0, gyi - 1) * width + gxi] ?? elevation;
        const eD = grids.elevation[Math.min(height - 1, gyi + 1) * width + gxi] ?? elevation;
        const nx = (eR - eL) / 16;
        const ny = (eD - eU) / 16;
        const slope = Math.min(3.2, Math.sqrt(nx * nx + ny * ny) / 22);
        const mean = (eL + eR + eU + eD) / 4;
        const local = Math.max(-420, Math.min(420, elevation - mean));
        const light = Math.max(
          0.52,
          Math.min(1.5, 1 - (nx * 0.72 + ny * 0.72) * 0.08 + slope * 0.21 + local * 0.00055),
        );
        const altitude = Math.max(0, Math.min(1, (elevation - seaLevel) / 5200));
        color = shade(base, light);
        // moisture and altitude wash; high ground cools toward the survey paper
        color = mix(color, { r: 214, g: 226, b: 198 }, (1 - moisture) * 0.09);
        color = mix(color, { r: 246, g: 239, b: 218 }, altitude * 0.15);
        if (biome >= 4) color = mix(color, { r: 250, g: 249, b: 244 }, altitude * 0.23);
        if (biome === 4 || biome === 5 || biome === 15) color = mix(color, { r: 245, g: 247, b: 245 }, 0.1 + altitude * 0.2);

        // contour hint only on slopes, so flats stay quiet
        const contour = Math.abs(((elevation - seaLevel) % CONTOUR_DM + CONTOUR_DM) % CONTOUR_DM);
        if (contour < 10 && slope > 0.08) color = shade(color, 0.94);

        // restrained biome texture: forest canopy stipple, dry land tooth, snow sparkle
        const grain = hash2(x, y) - 0.5;
        if (biome === 6 || biome === 7 || biome === 12) {
          color = shade(color, 1 + grain * 0.06);
          if (hash2(x + 917, y - 313) > 0.72) color = shade(color, 0.9);
        } else if (biome === 10 || biome === 11) {
          color = shade(color, 1 + grain * 0.035);
        } else {
          color = shade(color, 1 + grain * 0.025);
        }
      }
      data[at] = color.r;
      data[at + 1] = color.g;
      data[at + 2] = color.b;
      data[at + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  drawRivers(ctx, grids, width, height, cw, ch);
  drawGrain(ctx, px);

  return { canvas, pixelsPerTile: cw };
}

/** Connected polylines: a river is a line, not a row of beads. */
function drawRivers(
  ctx: CanvasRenderingContext2D,
  grids: TerrainArrays,
  width: number,
  height: number,
  cw: number,
  ch: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const w = grids.riverWidth[i] ?? 0;
      if (w === 0) continue;
      const river = grids.riverId[i] ?? 0;
      const cx = (x + 0.5) * cw;
      const cy = (y + 0.5) * ch;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        const nw = grids.riverWidth[j] ?? 0;
        if (nw === 0) continue;
        if ((grids.riverId[j] ?? 0) !== river && river !== 0) continue;
        const widthPx = Math.max(1.2, cw * (0.22 + Math.min(5, w) * 0.13));
        ctx.strokeStyle = toRgba(mix(RIVER_INK, { r: 24, g: 48, b: 62 }, 0.5), 0.9);
        ctx.lineWidth = widthPx;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo((nx + 0.5) * cw, (ny + 0.5) * ch);
        ctx.stroke();
        ctx.strokeStyle = toRgba({ r: 138, g: 174, b: 178 }, 0.34);
        ctx.lineWidth = Math.max(0.7, widthPx * 0.34);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo((nx + 0.5) * cw, (ny + 0.5) * ch);
        ctx.stroke();
      }
    }
  }
}

/** Land/water and lake edges, drawn as clean ink lines with a soft under-stroke. */
export function drawShoreline(
  ctx: CanvasRenderingContext2D,
  grids: TerrainArrays,
  width: number,
  height: number,
  seaLevel: number,
  cw: number,
  ch: number,
): void {
  const pass = (wide: boolean, lake: boolean): void => {
    ctx.beginPath();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const elev = grids.elevation[i] ?? 0;
        const lakeId = grids.lakeId[i] ?? 0;
        const wet = lake ? lakeId > 0 : elev < seaLevel;
        if (lake ? lakeId === 0 : elev < seaLevel) continue;
        const left = x > 0 ? (lake ? (grids.lakeId[i - 1] ?? 0) > 0 : (grids.elevation[i - 1] ?? 0) < seaLevel) : false;
        const right = x < width - 1 ? (lake ? (grids.lakeId[i + 1] ?? 0) > 0 : (grids.elevation[i + 1] ?? 0) < seaLevel) : false;
        const up = y > 0 ? (lake ? (grids.lakeId[i - width] ?? 0) > 0 : (grids.elevation[i - width] ?? 0) < seaLevel) : false;
        const down = y < height - 1 ? (lake ? (grids.lakeId[i + width] ?? 0) > 0 : (grids.elevation[i + width] ?? 0) < seaLevel) : false;
        if (!left && !right && !up && !down) continue;
        // a wet tile whose neighbours are dry produces the boundary; the opposite case is handled
        // by the dry tile itself, so draw only from the dry side to avoid a doubled line
        if (lake ? !wet : !wet) {
          const x0 = x * cw;
          const y0 = y * ch;
          if (!left) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + ch); }
          if (!right) { ctx.moveTo(x0 + cw, y0); ctx.lineTo(x0 + cw, y0 + ch); }
          if (!up) { ctx.moveTo(x0, y0); ctx.lineTo(x0 + cw, y0); }
          if (!down) { ctx.moveTo(x0, y0 + ch); ctx.lineTo(x0 + cw, y0 + ch); }
        }
      }
    }
    ctx.strokeStyle = wide ? 'rgba(24,38,42,0.26)' : lake ? 'rgba(38,66,74,0.7)' : 'rgba(42,36,26,0.78)';
    ctx.lineWidth = wide ? 4 : lake ? 1.1 : 1.35;
    ctx.stroke();
  };
  pass(true, false);
  pass(false, false);
  pass(false, true);
}

function drawGrain(ctx: CanvasRenderingContext2D, size: number): void {
  const tile = document.createElement('canvas');
  tile.width = 64;
  tile.height = 64;
  const tctx = tile.getContext('2d');
  if (!tctx) return;
  const img = tctx.createImageData(64, 64);
  for (let i = 0; i < 64 * 64; i++) {
    const v = Math.floor(hash2(i % 64, Math.floor(i / 64)) * 255);
    const o = i * 4;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}
