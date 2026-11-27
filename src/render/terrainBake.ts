/**
 * Terrain baking (Stage 5): one deterministic high-resolution atlas plate from the real grids.
 *
 * The overview is a mineral survey plate. Close zoom is served by `terrainDetail.ts` chunks, so the
 * overview is no longer the effective quality ceiling (D-70).
 *
 * No generated value is invented: every pixel is a function of the elevation, moisture, temperature,
 * biome and hydrology arrays the simulation owns. No Math.random, no wall clock.
 */
import type { TerrainArrays } from '../core/gridTypes.ts';
import { mix, RIVER_INK } from './palette.ts';
import { hash2, paintPixel } from './terrainPaint.ts';

export interface BakedTerrain {
  readonly canvas: HTMLCanvasElement;
  readonly pixelsPerTile: number;
}

export const MAX_BAKE = 1536;
export const DEFAULT_BAKE = 1536;

export type Quality = 'high' | 'balanced' | 'performance';

export function bakeSizeForQuality(quality: Quality): number {
  if (quality === 'performance') return 1024;
  if (quality === 'balanced') return 1280;
  return DEFAULT_BAKE;
}

export function detailEnabled(quality: Quality): boolean {
  return quality !== 'performance';
}

export function bakeTerrain(
  grids: TerrainArrays,
  width: number,
  height: number,
  seaLevel: number,
  bakeSize = DEFAULT_BAKE,
): BakedTerrain {
  const px = Math.max(512, Math.min(MAX_BAKE, Math.floor(bakeSize)));
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
      const color = paintPixel(grids, width, height, seaLevel, gx, gy, x, y, false);
      data[at] = color.r;
      data[at + 1] = color.g;
      data[at + 2] = color.b;
      data[at + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  drawRivers(ctx, grids, width, height, cw, ch);
  drawSmoothCoast(ctx, grids, width, height, seaLevel, cw, ch, 0, 0, 'sea');
  drawSmoothCoast(ctx, grids, width, height, seaLevel, cw, ch, 0, 0, 'lake');
  drawGrain(ctx, px, 0.05);

  return { canvas, pixelsPerTile: cw };
}

/** Connected polylines: a river is a line with a bank and a highlight, not a row of beads. */
export function drawRivers(
  ctx: CanvasRenderingContext2D,
  grids: TerrainArrays,
  width: number,
  height: number,
  cw: number,
  ch: number,
  offsetX = 0,
  offsetY = 0,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const w = grids.riverWidth[i] ?? 0;
      if (w === 0) continue;
      const river = grids.riverId[i] ?? 0;
      const cx = (x + 0.5) * cw - offsetX;
      const cy = (y + 0.5) * ch - offsetY;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        const nw = grids.riverWidth[j] ?? 0;
        if (nw === 0) continue;
        if ((grids.riverId[j] ?? 0) !== river && river !== 0) continue;
        const ex = (nx + 0.5) * cw - offsetX;
        const ey = (ny + 0.5) * ch - offsetY;
        const widthPx = Math.max(1.4, cw * (0.3 + Math.min(6, Math.max(w, nw)) * 0.16));
        ctx.strokeStyle = 'rgba(31, 55, 62, 0.55)';
        ctx.lineWidth = widthPx * 1.7;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(38, 73, 82, 0.92)';
        ctx.lineWidth = widthPx;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(154, 190, 192, 0.42)';
        ctx.lineWidth = Math.max(0.6, widthPx * 0.3);
        ctx.beginPath();
        ctx.moveTo(cx - widthPx * 0.12, cy - widthPx * 0.12);
        ctx.lineTo(ex - widthPx * 0.12, ey - widthPx * 0.12);
        ctx.stroke();
      }
    }
  }
}

/** Land/water and lake edges, with a soft outer foam shelf on the overview. */
export function drawShoreline(
  ctx: CanvasRenderingContext2D,
  grids: TerrainArrays,
  width: number,
  height: number,
  seaLevel: number,
  cw: number,
  ch: number,
  lakes: boolean,
  offsetX = 0,
  offsetY = 0,
): void {
  const wetAt = (i: number): boolean => (lakes ? (grids.lakeId[i] ?? 0) > 0 : (grids.elevation[i] ?? 0) < seaLevel);
  const path = (expand: number): void => {
    ctx.beginPath();
    const e = expand;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (wetAt(i)) continue;
        const left = x > 0 && wetAt(i - 1);
        const right = x < width - 1 && wetAt(i + 1);
        const up = y > 0 && wetAt(i - width);
        const down = y < height - 1 && wetAt(i + width);
        if (!left && !right && !up && !down) continue;
        const x0 = x * cw - offsetX;
        const y0 = y * ch - offsetY;
        if (left) { ctx.moveTo(x0 - e, y0); ctx.lineTo(x0 - e, y0 + ch); }
        if (right) { ctx.moveTo(x0 + cw + e, y0); ctx.lineTo(x0 + cw + e, y0 + ch); }
        if (up) { ctx.moveTo(x0, y0 - e); ctx.lineTo(x0 + cw, y0 - e); }
        if (down) { ctx.moveTo(x0, y0 + ch + e); ctx.lineTo(x0 + cw, y0 + ch + e); }
      }
    }
  };
  // foam is drawn on the water side first, then the ink line
  path(cw * 0.28);
  ctx.strokeStyle = lakes ? 'rgba(190, 210, 198, 0.16)' : 'rgba(192, 214, 202, 0.2)';
  ctx.lineWidth = Math.max(2, cw * 0.22);
  ctx.stroke();
  path(0);
  ctx.strokeStyle = lakes ? 'rgba(38, 66, 74, 0.72)' : 'rgba(38, 33, 24, 0.82)';
  ctx.lineWidth = Math.max(1.2, cw * 0.09);
  ctx.stroke();
}

function drawGrain(ctx: CanvasRenderingContext2D, size: number, alpha: number): void {
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const tctx = tile.getContext('2d');
  if (!tctx) return;
  const img = tctx.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const x = i % 128;
    const y = Math.floor(i / 128);
    const v = Math.floor((hash2(x, y) * 0.55 + hash2(x + 311, y - 97) * 0.45) * 255);
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
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

export { drawGrain, mix, RIVER_INK };

/**
 * Smooth sea/lake contours from bilinear elevation (marching squares), not per-cell stair steps.
 * At regional zoom the old cell-edge ink was the most obvious low-resolution artefact.
 */
export function drawSmoothCoast(
  ctx: CanvasRenderingContext2D,
  grids: TerrainArrays,
  width: number,
  height: number,
  seaLevel: number,
  cw: number,
  ch: number,
  offsetX: number,
  offsetY: number,
  mode: 'sea' | 'lake',
): void {
  const sub = 2;
  const valueAt = (x: number, y: number): number => {
    if (mode === 'sea') return bilinear(grids.elevation, width, height, x, y) - seaLevel;
    // A binary lake mask; sub-cell contouring still removes the hard corner joins.
    return bilinear(grids.lakeId, width, height, x, y) > 0.5 ? 1 : -1;
  };
  const pass = (level: number, style: string, widthPx: number, alpha: number): void => {
    ctx.beginPath();
    const nx = width * sub;
    const ny = height * sub;
    const points: Array<[number, number]> = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = i / sub;
        const y = j / sub;
        const step = 1 / sub;
        const v00 = valueAt(x, y) - level;
        const v10 = valueAt(x + step, y) - level;
        const v01 = valueAt(x, y + step) - level;
        const v11 = valueAt(x + step, y + step) - level;
        points.length = 0;
        if (v00 * v10 < 0) points.push([x + (step * v00) / (v00 - v10), y]);
        if (v01 * v11 < 0) points.push([x + (step * v01) / (v01 - v11), y + step]);
        if (v00 * v01 < 0) points.push([x, y + (step * v00) / (v00 - v01)]);
        if (v10 * v11 < 0) points.push([x + step, y + (step * v10) / (v10 - v11)]);
        if (points.length < 2) continue;
        const p0 = points[0]!;
        const p1 = points[1]!;
        ctx.moveTo(p0[0] * cw - offsetX, p0[1] * ch - offsetY);
        ctx.lineTo(p1[0] * cw - offsetX, p1[1] * ch - offsetY);
        if (points.length > 2) {
          const p2 = points[2]!;
          const p3 = points[3] ?? points[0]!;
          ctx.moveTo(p2[0] * cw - offsetX, p2[1] * ch - offsetY);
          ctx.lineTo(p3[0] * cw - offsetX, p3[1] * ch - offsetY);
        }
      }
    }
    ctx.strokeStyle = style;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = widthPx;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (mode === 'sea') {
    pass(-28, 'rgba(196, 218, 205, 1)', Math.max(4, cw * 0.42), 0.18);
    pass(0, 'rgba(38, 33, 24, 1)', Math.max(1.3, cw * 0.09), 0.8);
  } else {
    pass(0, 'rgba(38, 66, 74, 1)', Math.max(1, cw * 0.06), 0.62);
  }
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
