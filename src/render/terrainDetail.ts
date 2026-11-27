/**
 * Multi-resolution regional detail (D-70).
 *
 * The overview plate stays the geography; above a zoom threshold, deterministic chunks are painted
 * from the same grids at a higher texel density. Chunks are world-space, seam-aligned by sampling the
 * same global coordinates, bounded by an LRU cache and disposed explicitly.
 */
import { Container, Sprite, Texture, CanvasSource } from 'pixi.js';
import type { TerrainArrays } from '../core/gridTypes.ts';
import { TILE_PX } from './markerGeometry.ts';
import { drawGrain, drawRivers, drawSmoothCoast } from './terrainBake.ts';
import { paintPixel } from './terrainPaint.ts';
import type { Quality } from './terrainBake.ts';
import type { Camera } from './camera.ts';

interface Level {
  readonly tiles: number;
  readonly pxPerTile: number;
  /** zoom range where this level is visible */
  readonly from: number;
  readonly to: number;
}

const LEVELS: readonly Level[] = [
  { tiles: 16, pxPerTile: 48, from: 0.55, to: 2.2 },
  { tiles: 8, pxPerTile: 96, from: 1.7, to: 9 },
];

const CACHE_LIMIT = 10;

interface Entry {
  level: number;
  cx: number;
  cy: number;
  sprite: Sprite;
  texture: Texture;
  lastUsed: number;
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class TerrainDetail {
  readonly container = new Container();
  private readonly layers: Container[] = [new Container(), new Container()];
  private readonly entries = new Map<string, Entry>();
  private readonly grids: TerrainArrays;
  private readonly width: number;
  private readonly height: number;
  private readonly seaLevel: number;
  private readonly quality: Quality;
  private lastGenerate = 0;
  private serial = 0;
  private lastCanvas: HTMLCanvasElement | null = null;

  constructor(grids: TerrainArrays, width: number, height: number, seaLevel: number, quality: Quality) {
    this.grids = grids;
    this.width = width;
    this.height = height;
    this.seaLevel = seaLevel;
    this.quality = quality;
    for (const layer of this.layers) this.container.addChild(layer);
    this.container.eventMode = 'none';
  }

  update(cam: Camera): void {
    if (this.quality === 'performance') {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const need: Array<{ level: number; cx: number; cy: number; alpha: number; key: string }> = [];
    for (let level = 0; level < LEVELS.length; level++) {
      const def = LEVELS[level]!;
      if (cam.zoom < def.from || cam.zoom > def.to) continue;
      const alpha = smooth(def.from, Math.min(def.to, def.from + 0.25), cam.zoom);
      const tile0x = Math.floor(cam.x / TILE_PX) - 1;
      const tile0y = Math.floor(cam.y / TILE_PX) - 1;
      const tile1x = Math.ceil((cam.x + cam.vw / cam.zoom) / TILE_PX) + 1;
      const tile1y = Math.ceil((cam.y + cam.vh / cam.zoom) / TILE_PX) + 1;
      const cx0 = Math.floor(tile0x / def.tiles);
      const cy0 = Math.floor(tile0y / def.tiles);
      const cx1 = Math.floor(tile1x / def.tiles);
      const cy1 = Math.floor(tile1y / def.tiles);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (cx < 0 || cy < 0 || cx * def.tiles >= this.width || cy * def.tiles >= this.height) continue;
          need.push({ level, cx, cy, alpha, key: `${level}:${cx}:${cy}` });
        }
      }
    }

    const now = performance.now();
    for (const e of this.entries.values()) e.sprite.visible = false;
    const needed = new Set(need.map((n) => n.key));
    for (const n of need) {
      const found = this.entries.get(n.key);
      if (found) {
        found.sprite.visible = true;
        found.sprite.alpha = n.alpha;
        found.lastUsed = now;
        continue;
      }
      if (now - this.lastGenerate < 90) continue;
      this.lastGenerate = now;
      this.create(n.level, n.cx, n.cy, n.alpha);
      needed.add(n.key);
      break;
    }

    // LRU: never keep high-res chunks the viewport no longer needs.
    if (this.entries.size > CACHE_LIMIT) {
      const list = [...this.entries.entries()].filter(([key]) => !needed.has(key)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [key, entry] of list) {
        if (this.entries.size <= CACHE_LIMIT) break;
        this.entries.delete(key);
        entry.sprite.destroy();
        entry.texture.destroy(true);
      }
    }
  }

  private create(level: number, cx: number, cy: number, alpha: number): void {
    const def = LEVELS[level]!;
    const size = def.tiles * def.pxPerTile;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const img = ctx.createImageData(size, size);
    const data = img.data;
    const originX = cx * def.tiles;
    const originY = cy * def.tiles;
    for (let y = 0; y < size; y++) {
      const gy = originY + (y + 0.5) / def.pxPerTile - 0.5;
      for (let x = 0; x < size; x++) {
        const gx = originX + (x + 0.5) / def.pxPerTile - 0.5;
        const at = (y * size + x) * 4;
        const color = paintPixel(this.grids, this.width, this.height, this.seaLevel, gx, gy, x + originX * def.pxPerTile, y + originY * def.pxPerTile, true);
        data[at] = color.r;
        data[at + 1] = color.g;
        data[at + 2] = color.b;
        data[at + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.lastCanvas = canvas;
    const offsetX = originX * def.pxPerTile;
    const offsetY = originY * def.pxPerTile;
    drawRivers(ctx, this.grids, this.width, this.height, def.pxPerTile, def.pxPerTile, offsetX, offsetY);
    drawSmoothCoast(ctx, this.grids, this.width, this.height, this.seaLevel, def.pxPerTile, def.pxPerTile, offsetX, offsetY, 'sea');
    drawSmoothCoast(ctx, this.grids, this.width, this.height, this.seaLevel, def.pxPerTile, def.pxPerTile, offsetX, offsetY, 'lake');
    drawGrain(ctx, size, 0.035);

    const source = new CanvasSource({ resource: canvas, scaleMode: 'linear' });
    const texture = new Texture({ source });
    const sprite = new Sprite(texture);
    const world = def.tiles * TILE_PX;
    sprite.x = originX * TILE_PX;
    sprite.y = originY * TILE_PX;
    sprite.width = world;
    sprite.height = world;
    sprite.alpha = alpha;
    sprite.visible = true;
    this.layers[level]!.addChild(sprite);
    const key = `${level}:${cx}:${cy}`;
    this.entries.set(key, { level, cx, cy, sprite, texture, lastUsed: performance.now() + this.serial++ });
  }

  image(): string {
    return this.lastCanvas?.toDataURL('image/png') ?? '';
  }

  stats(): { entries: number; visible: number; zoom: number } {
    let visible = 0;
    for (const e of this.entries.values()) if (e.sprite.visible) visible++;
    return { entries: this.entries.size, visible, zoom: 0 };
  }

  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.sprite.destroy();
      entry.texture.destroy(true);
    }
    this.entries.clear();
    this.container.destroy({ children: true });
  }
}
