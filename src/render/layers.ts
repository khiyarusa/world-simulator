/**
 * Map layers (Stage 4 WP3).
 *
 * One container above the terrain bake and below the settlement glyphs. Raster layers become one
 * cached canvas texture; vector layers become a single Graphics object. Nothing rebuilds per frame:
 * a layer is redrawn only when the worker sends new data for it (layer switch, or a periodic refresh
 * while the simulation runs).
 *
 * Every value drawn here came from a `layer` query. There are no decorative borders: political cells
 * are the nearest living settlement's owner, routes are persisted route edges, history markers are
 * persisted events.
 */
import { Container, CanvasSource, Graphics, Sprite, Texture } from 'pixi.js';
import type { LayerData, LayerPoint } from '../worker/queries.ts';
import { TILE_PX } from './markerGeometry.ts';
import { civColor } from './palette.ts';

const MAX_RASTER = 1024;
const INK = 0x2a241a;

export interface LayerViewMeta {
  readonly width: number;
  readonly height: number;
  readonly seaLevel: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Ecological ramps are normalized to the data range of the layer, not to an absolute 0..255. A dry
 * world and a wet world then both show their real internal differences instead of washing out.
 */
function ecologyColor(value: number, metric: string, min: number, max: number): [number, number, number] {
  const t = clamp01((value - min) / Math.max(1, max - min));
  const stops: Record<string, [[number, number, number], [number, number, number]]> = {
    fertility: [[206, 184, 130], [42, 92, 58]],
    vegetation: [[185, 166, 118], [30, 104, 62]],
    moisture: [[206, 178, 112], [48, 118, 146]],
    temperature: [[78, 126, 168], [196, 78, 52]],
  };
  const [a, b] = stops[metric] ?? stops.fertility!;
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}

function populationColor(rank: number): number {
  return [0x8a9a6a, 0xb0a05a, 0xc08a4a, 0xb4553f, 0x8c5a72][Math.max(0, Math.min(4, rank - 1))] ?? 0xb0a05a;
}

function severityColor(severity: number): number {
  return [0x8a8a6a, 0x9a9a6a, 0xc8a05a, 0xc07a3e, 0xb8503c][Math.max(0, Math.min(4, severity - 1))] ?? 0xc8a05a;
}

export class LayerView {
  /** Raster layers (territory, soil) sit below settlement glyphs. */
  readonly rasterContainer = new Container();
  /** Vector markers sit above the glyphs: a population dot under a 19 px glyph would be invisible. */
  readonly vector = new Graphics();
  private readonly spriteLayer = new Container();
  private sprite: Sprite | null = null;
  private data: LayerData | null = null;
  private zoom = 0.1;

  constructor() {
    this.rasterContainer.addChild(this.spriteLayer);
  }

  clear(): void {
    this.data = null;
    if (this.sprite) {
      this.spriteLayer.removeChild(this.sprite);
      this.sprite.destroy();
      this.sprite = null;
    }
    this.vector.clear();
  }

  get layer(): string | null {
    return this.data?.layer ?? null;
  }

  setData(data: LayerData | null, meta: LayerViewMeta): void {
    if (!data) {
      this.clear();
      return;
    }
    this.data = data;
    this.zoom = Math.max(0.03, this.zoom);
    if (this.sprite) {
      this.spriteLayer.removeChild(this.sprite);
      this.sprite.destroy();
      this.sprite = null;
    }
    this.vector.clear();
    if (data.cells) this.drawRaster(data, meta);
    this.drawVectors(data);
  }

  /**
   * Markers are screen-space symbols, not geographic areas: their world radius must shrink as the
   * camera zooms in. Rebuilding the vector graphic only when the zoom changes materially keeps the
   * map correct without per-frame allocation.
   */
  setZoom(zoom: number, force = false): void {
    const next = Math.max(0.03, zoom);
    if (!force && Math.abs(next - this.zoom) / Math.max(this.zoom, 0.0001) < 0.12) return;
    this.zoom = next;
    if (this.data) {
      this.vector.clear();
      this.drawVectors(this.data);
    }
  }

  private drawRaster(data: LayerData, meta: LayerViewMeta): void {
    const cells = data.cells;
    if (!cells) return;
    const scale = Math.min(MAX_RASTER / data.width, MAX_RASTER / data.height);
    const cw = Math.max(1, Math.round(data.width * scale));
    const ch = Math.max(1, Math.round(data.height * scale));
    const cellW = cw / data.width;
    const cellH = ch / data.height;

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(cw, ch);
    const px = img.data;

    if (data.layer === 'political') {
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          const civ = cells[y * data.width + x] ?? 0;
          if (civ === 0) continue;
          const color = civColor(civ - 1);
          const r = (color >> 16) & 0xff;
          const g = (color >> 8) & 0xff;
          const b = color & 0xff;
          const x0 = Math.floor(x * cellW);
          const x1 = Math.max(x0 + 1, Math.floor((x + 1) * cellW));
          const y0 = Math.floor(y * cellH);
          const y1 = Math.max(y0 + 1, Math.floor((y + 1) * cellH));
          for (let py = y0; py < y1; py++) {
            for (let pxx = x0; pxx < x1; pxx++) {
              const o = (py * cw + pxx) * 4;
              px[o] = r;
              px[o + 1] = g;
              px[o + 2] = b;
              px[o + 3] = 112;
            }
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      // political borders: a dark ink edge wherever two cells have different owners
      ctx.strokeStyle = 'rgba(42,36,26,0.72)';
      ctx.lineWidth = Math.max(1, cellW * 0.18);
      ctx.beginPath();
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          const here = cells[y * data.width + x] ?? 0;
          if (here === 0) continue;
          const right = x + 1 < data.width ? cells[y * data.width + x + 1] ?? 0 : 0;
          const down = y + 1 < data.height ? cells[(y + 1) * data.width + x] ?? 0 : 0;
          const px0 = x * cellW;
          const py0 = y * cellH;
          if (right !== here) {
            ctx.moveTo(px0 + cellW, py0);
            ctx.lineTo(px0 + cellW, py0 + cellH);
          }
          if (down !== here) {
            ctx.moveTo(px0, py0 + cellH);
            ctx.lineTo(px0 + cellW, py0 + cellH);
          }
        }
      }
      ctx.stroke();
    } else {
      // ecology: one normalized metric, sea transparent
      const metric = String(data.meta.metric ?? 'fertility');
      const min = Number(data.meta.min ?? 1);
      const max = Number(data.meta.max ?? 255);
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          const value = cells[y * data.width + x] ?? 0;
          if (value === 0) continue;
          const [r, g, b] = ecologyColor(value, metric, min, max);
          const x0 = Math.floor(x * cellW);
          const x1 = Math.max(x0 + 1, Math.floor((x + 1) * cellW));
          const y0 = Math.floor(y * cellH);
          const y1 = Math.max(y0 + 1, Math.floor((y + 1) * cellH));
          for (let py = y0; py < y1; py++) {
            for (let pxx = x0; pxx < x1; pxx++) {
              const o = (py * cw + pxx) * 4;
              px[o] = r;
              px[o + 1] = g;
              px[o + 2] = b;
              px[o + 3] = 205;
            }
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    const source = new CanvasSource({ resource: canvas, scaleMode: 'linear' });
    this.sprite = new Sprite(new Texture({ source }));
    this.sprite.width = meta.width * TILE_PX;
    this.sprite.height = meta.height * TILE_PX;
    this.spriteLayer.addChild(this.sprite);
  }

  private drawVectors(data: LayerData): void {
    const g = this.vector;
    const s = 1 / Math.max(0.03, this.zoom);
    for (const line of data.lines) {
      const isWar = line.kind === 1;
      const color = isWar ? 0xb8503c : 0x6f8f8a;
      const width = (isWar ? 2.2 : 1.1) * s;
      const alpha = isWar ? 0.95 : 0.7;
      g.moveTo((line.x1 + 0.5) * TILE_PX, (line.y1 + 0.5) * TILE_PX)
        .lineTo((line.x2 + 0.5) * TILE_PX, (line.y2 + 0.5) * TILE_PX)
        .stroke({ width, color, alpha });
    }

    for (const area of data.areas) {
      const isBlight = area.kind === 1;
      const color = isBlight ? 0x8a4a3a : area.kind === 2 ? 0x6f8f5a : 0xb8503c;
      g.circle((area.x + 0.5) * TILE_PX, (area.y + 0.5) * TILE_PX, area.radius * TILE_PX)
        .fill({ color, alpha: 0.12 })
        .stroke({ width: 1.2 * s, color, alpha: 0.55 });
    }

    for (const point of data.points) this.drawPoint(g, data.layer, point, s);
  }

  private drawPoint(g: Graphics, layer: string, point: LayerPoint, s: number): void {
    const x = (point.x + 0.5) * TILE_PX;
    const y = (point.y + 0.5) * TILE_PX;
    if (layer === 'population') {
      const rank = Math.max(0, Math.min(5, point.kind));
      if (rank === 9) {
        // migration origin: a hollow ring, never a fabricated destination line
        g.circle(x, y, 10 * s).stroke({ width: 1.5 * s, color: 0xc8a05a, alpha: 0.9 });
        return;
      }
      // a halo around the glyph, never on top of it: the settlement stays readable
      const color = populationColor(rank);
      const radius = (8 + Math.min(10, Math.sqrt(Math.max(1, point.value)) / 26)) * s;
      g.circle(x, y, radius).fill({ color, alpha: 0.16 });
      g.circle(x, y, radius).stroke({ width: 1.7 * s, color, alpha: 0.95 });
      g.circle(x, y, 1.8 * s).fill({ color, alpha: 0.95 });
      return;
    }
    if (layer === 'economy') {
      if (point.kind === 0) {
        g.circle(x, y, 11 * s).stroke({ width: 1.7 * s, color: 0xb8503c, alpha: 0.95 });
        g.moveTo(x - 4 * s, y - 4 * s).lineTo(x + 4 * s, y + 4 * s).stroke({ width: 1.4 * s, color: 0xb8503c, alpha: 0.95 });
        g.moveTo(x + 4 * s, y - 4 * s).lineTo(x - 4 * s, y + 4 * s).stroke({ width: 1.4 * s, color: 0xb8503c, alpha: 0.95 });
      } else {
        const wealth = Math.max(0, Math.min(4000, point.value));
        const radius = (9 + Math.min(6, wealth / 700)) * s;
        g.circle(x, y, radius).stroke({ width: 1.6 * s, color: 0xc8a05a, alpha: 0.9 });
      }
      return;
    }
    if (layer === 'political') {
      // capital: a stamped diamond above the glyph
      const r = 4.6 * s;
      const top = y - 17 * s;
      g.moveTo(x, y - 8 * s).lineTo(x, top + r).stroke({ width: 1 * s, color: 0xf2e8d2, alpha: 0.55 });
      g.poly([x, top - r, x + r, top, x, top + r, x - r, top]).fill({ color: 0xf2e8d2, alpha: 0.98 });
      g.poly([x, top - r, x + r, top, x, top + r, x - r, top]).stroke({ width: 1 * s, color: INK, alpha: 0.9 });
      return;
    }
    if (layer === 'ecology') {
      const color = point.kind === 2 ? 0x8a4a3a : 0xc08a3e;
      g.circle(x, y, 10 * s).stroke({ width: 1.6 * s, color, alpha: 0.95 });
      g.circle(x, y, 2.1 * s).fill({ color, alpha: 0.95 });
      return;
    }
    if (layer === 'history') {
      // event pin above the settlement: severity is size and ring count, not colour alone
      const top = y - (13 + Math.max(1, Math.min(5, point.value)) * 1.4) * s;
      g.moveTo(x, y - 4 * s).lineTo(x, top + 2 * s).stroke({ width: 1 * s, color: 0x1a1712, alpha: 0.55 });
      const radius = (4.2 + Math.max(1, Math.min(5, point.value)) * 1.05) * s;
      const color = severityColor(point.value);
      g.circle(x, top - radius, radius + 1.4 * s).fill({ color: 0x0c1418, alpha: 0.65 });
      g.circle(x, top - radius, radius).fill({ color, alpha: 0.98 });
      g.circle(x, top - radius, radius).stroke({ width: 1.4 * s, color: 0xf2e8d2, alpha: 0.9 });
      if (point.value >= 4) {
        g.circle(x, top - radius, radius + 3 * s).stroke({ width: 1.2 * s, color: 0xf2e8d2, alpha: 0.9 });
      }
    }
  }

  /** Nearest interactive marker for a tap, in tile coordinates. Null when the layer has no markers. */
  markerAt(tileX: number, tileY: number, radiusTiles = 2.2): { id: number; layer: string } | null {
    const data = this.data;
    if (!data) return null;
    if (data.layer !== 'history' && data.layer !== 'population' && data.layer !== 'economy') return null;
    const screenRadius = 14;
    const touchTiles = Math.max(radiusTiles, screenRadius / (this.zoom * TILE_PX));
    let best: { id: number; layer: string } | null = null;
    let bestDist = touchTiles * touchTiles;
    for (const point of data.points) {
      const dx = point.x - tileX;
      const dy = point.y - tileY;
      const d = dx * dx + dy * dy;
      if (d <= bestDist) {
        bestDist = d;
        best = { id: point.id, layer: data.layer };
      }
    }
    return best;
  }

  /** Test-only probe: proves whether the vector graphic actually has geometry. */
  debugState(): Record<string, number | string | boolean | null> {
    const b = this.vector.getBounds();
    return {
      layer: this.data?.layer ?? null,
      points: this.data?.points.length ?? 0,
      lines: this.data?.lines.length ?? 0,
      zoom: this.zoom,
      visible: this.vector.visible,
      alpha: this.vector.alpha,
      renderable: this.vector.renderable,
      boundsX: b.x,
      boundsY: b.y,
      boundsW: b.width,
      boundsH: b.height,
      parentVisible: this.rasterContainer.visible,
    };
  }

  destroy(): void {
    this.clear();
    this.rasterContainer.destroy({ children: true });
    this.vector.destroy();
  }
}
