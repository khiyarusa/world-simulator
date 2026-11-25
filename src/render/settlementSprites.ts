/**
 * Settlement glyphs, drawn procedurally at runtime (no binary assets in Stage 2).
 *
 * Each tier gets a distinct silhouette so a camp reads differently from a metropolis at 16 px
 * (docs/UX_AND_VISUAL_DIRECTION.md §9.2). The glyph is white with a dark drop shadow so it stays
 * legible on any terrain once tinted with the civilization colour.
 */
import { CanvasSource, Texture } from 'pixi.js';

const SIZE = 64;

function glyphCanvas(tier: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for settlement glyph');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const pass of [0, 1]) {
    // pass 0 = shadow, pass 1 = glyph
    ctx.save();
    if (pass === 0) ctx.translate(1.5, 2.5);
    ctx.fillStyle = pass === 0 ? 'rgba(14,13,11,0.62)' : '#ffffff';
    ctx.strokeStyle = pass === 0 ? 'rgba(14,13,11,0.62)' : '#ffffff';
    draw(ctx, tier);
    ctx.restore();
  }
  return canvas;
}

function draw(ctx: CanvasRenderingContext2D, tier: number): void {
  const c = SIZE / 2;
  switch (tier) {
    case 0: {
      // camp: three dots
      for (const [dx, dy, r] of [
        [-9, 3, 4.5],
        [7, -3, 5.5],
        [2, 9, 4],
      ] as const) {
        ctx.beginPath();
        ctx.arc(c + dx, c + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 1: {
      // village: hut + field strips
      ctx.beginPath();
      ctx.moveTo(c - 11, c + 2);
      ctx.lineTo(c, c - 11);
      ctx.lineTo(c + 11, c + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(c - 8, c + 4, 16, 9);
      ctx.fillRect(c - 16, c + 13, 32, 2.4);
      break;
    }
    case 2: {
      // town: wall ring with a gate notch and two roofs
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(c, c, 15, 0.5, Math.PI * 2 - 0.5);
      ctx.stroke();
      ctx.fillRect(c - 9, c - 2, 7, 8);
      ctx.fillRect(c + 2, c - 4, 8, 10);
      ctx.fillRect(c - 2.5, c + 13, 5, 6);
      break;
    }
    case 3: {
      // city: wall ring plus three towers
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(c, c, 17, 0, Math.PI * 2);
      ctx.stroke();
      for (const [dx, h] of [
        [-10, 12],
        [0, 18],
        [10, 13],
      ] as const) {
        ctx.fillRect(c + dx - 3, c - h / 2, 6, h);
      }
      ctx.fillRect(c - 20, c + 16, 40, 2.6);
      break;
    }
    default: {
      // metropolis: double ring, five spires, aqueduct line
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(c, c, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c, c, 13, 0, Math.PI * 2);
      ctx.stroke();
      for (const [dx, h] of [
        [-12, 10],
        [-6, 15],
        [0, 21],
        [6, 15],
        [12, 10],
      ] as const) {
        ctx.fillRect(c + dx - 2.4, c - h / 2, 4.8, h);
      }
      ctx.fillRect(c - 22, c + 18, 44, 2.4);
      break;
    }
  }
}

/** Five tier textures + a soft ring used for selection. */
export function createSettlementTextures(): Texture[] {
  const out: Texture[] = [];
  for (let tier = 0; tier < 5; tier++) {
    const source = new CanvasSource({ resource: glyphCanvas(tier), scaleMode: 'linear' });
    out.push(new Texture({ source }));
  }
  return out;
}
