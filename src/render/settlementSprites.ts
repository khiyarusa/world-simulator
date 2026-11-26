/**
 * Settlement glyphs, drawn procedurally at runtime (no binary assets).
 *
 * The five tiers are a progression of silhouette, not only scale: a camp is open tents, a village is
 * huts and fields, a town adds a wall, a city adds towers and a keep, a metropolis adds a second ring
 * and a dome. A separate ruined variant keeps the silhouette but removes whole quarters. The glyph is
 * white with a dark drop shadow so it can be tinted by civilization colour on any terrain.
 */
import { CanvasSource, Texture } from 'pixi.js';

const SIZE = 64;

function glyphCanvas(tier: number, ruined: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for settlement glyph');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const pass of [0, 1]) {
    ctx.save();
    if (pass === 0) ctx.translate(1.6, 2.6);
    ctx.fillStyle = pass === 0 ? 'rgba(10,14,13,0.72)' : '#ffffff';
    ctx.strokeStyle = pass === 0 ? 'rgba(10,14,13,0.72)' : '#ffffff';
    draw(ctx, tier);
    ctx.restore();
  }
  if (ruined) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(SIZE * 0.6, SIZE * 0.4, SIZE * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(SIZE * 0.36, SIZE * 0.63, SIZE * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(SIZE * 0.18, SIZE * 0.79, SIZE * 0.64, 2.2);
    ctx.fillRect(SIZE * 0.26, SIZE * 0.75, 3, 3);
    ctx.fillRect(SIZE * 0.48, SIZE * 0.82, 2.4, 2.4);
  }
  return canvas;
}

function draw(ctx: CanvasRenderingContext2D, tier: number): void {
  const c = SIZE / 2;
  switch (tier) {
    case 0: {
      // camp: three open tents around a fire
      for (const [dx, dy, s] of [
        [-10, 5, 10],
        [8, -4, 12],
        [3, 10, 8],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(c + dx, c + dy - s);
        ctx.lineTo(c + dx + s * 0.75, c + dy + s * 0.55);
        ctx.lineTo(c + dx - s * 0.75, c + dy + s * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(c - 1, c + 8, 1.9, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 1: {
      // village: two huts, field strips and a fence line
      for (const [dx, dy, w] of [
        [-9, -1, 12],
        [8, 3, 10],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(c + dx, c + dy - 10);
        ctx.lineTo(c + dx + w, c + dy - 1);
        ctx.lineTo(c + dx + w * 0.82, c + dy + 8);
        ctx.lineTo(c + dx - w * 0.82, c + dy + 8);
        ctx.lineTo(c + dx - w, c + dy - 1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillRect(c - 18, c + 13, 36, 2.2);
      for (let x = -17; x <= 17; x += 6) ctx.fillRect(c + x, c + 9, 1.4, 4);
      break;
    }
    case 2: {
      // town: wall ring with gate notch, two roofs and a watchtower
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(c, c, 15.5, 0.36, Math.PI * 2 - 0.36);
      ctx.stroke();
      ctx.fillRect(c - 10, c - 1, 7, 8);
      ctx.fillRect(c + 2, c - 4, 8, 11);
      ctx.fillRect(c - 1, c + 12, 4.5, 6);
      ctx.fillRect(c - 17, c - 13, 3.5, 8);
      ctx.fillRect(c + 14, c - 10, 3.5, 8);
      ctx.fillRect(c - 20, c + 17, 40, 2.4);
      break;
    }
    case 3: {
      // city: thick wall, four towers, central keep and flag
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.arc(c, c, 18, 0, Math.PI * 2);
      ctx.stroke();
      for (const [dx, dy] of [
        [-13, -7],
        [13, -7],
        [-11, 10],
        [11, 10],
      ] as const) {
        ctx.fillRect(c + dx - 3, c + dy - 6, 6, 13);
      }
      ctx.fillRect(c - 5, c - 7, 10, 15);
      ctx.beginPath();
      ctx.moveTo(c, c - 7);
      ctx.lineTo(c, c - 20);
      ctx.lineTo(c + 9, c - 16);
      ctx.lineTo(c, c - 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(c - 23, c + 18, 46, 2.6);
      break;
    }
    default: {
      // metropolis: second ring, seven towers, central dome, aqueduct arc
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.arc(c, c, 20.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c, c, 13.5, 0, Math.PI * 2);
      ctx.stroke();
      for (const [dx, dy, h] of [
        [-15, 0, 9],
        [-9, -11, 12],
        [0, -15, 15],
        [9, -11, 12],
        [15, 0, 9],
        [-8, 12, 8],
        [8, 12, 8],
      ] as const) {
        ctx.fillRect(c + dx - 2.2, c + dy - h / 2, 4.4, h);
      }
      ctx.beginPath();
      ctx.arc(c, c + 1, 6.2, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(c - 1.3, c - 15, 2.6, 9);
      ctx.fillRect(c - 24, c + 19, 48, 2.6);
      for (let i = -18; i <= 18; i += 9) ctx.fillRect(c + i, c + 16, 1.8, 5);
      break;
    }
  }
}

/**
 * Five normal tier textures, five ruined variants (index tier + 5), then a plain dot for the
 * global-overview LOD where 200 detailed glyphs would overlap into noise.
 */
export function createSettlementTextures(): Texture[] {
  const out: Texture[] = [];
  for (const ruined of [false, true]) {
    for (let tier = 0; tier < 5; tier++) {
      const source = new CanvasSource({ resource: glyphCanvas(tier, ruined), scaleMode: 'linear' });
      out.push(new Texture({ source }));
    }
  }
  const dot = document.createElement('canvas');
  dot.width = SIZE;
  dot.height = SIZE;
  const dctx = dot.getContext('2d');
  if (dctx) {
    dctx.fillStyle = 'rgba(10,14,13,0.7)';
    dctx.beginPath();
    dctx.arc(SIZE / 2 + 1.4, SIZE / 2 + 2, 15, 0, Math.PI * 2);
    dctx.fill();
    dctx.fillStyle = '#ffffff';
    dctx.beginPath();
    dctx.arc(SIZE / 2, SIZE / 2, 13, 0, Math.PI * 2);
    dctx.fill();
  }
  out.push(new Texture({ source: new CanvasSource({ resource: dot, scaleMode: 'linear' }) }));
  return out;
}

export const RUINED_TEXTURE_OFFSET = 5;
export const DOT_TEXTURE = 10;
