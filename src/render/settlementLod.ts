/** Screen-space settlement LOD and state marks. Drawing only; no game state is owned here. */
import type { Graphics, Sprite, Texture } from 'pixi.js';
import type { WorldMetaMsg } from '../worker/protocol.ts';
import { TILE_PX, markerWorldScale } from './markerGeometry.ts';
import { DOT_TEXTURE, RUINED_TEXTURE_OFFSET } from './settlementSprites.ts';

export interface SettlementLodInput {
  readonly sprites: readonly Sprite[];
  readonly textures: readonly Texture[];
  readonly count: number;
  readonly tier: Uint8Array;
  readonly state: Uint8Array;
  readonly capital: Uint8Array;
  readonly zoom: number;
}

/** Returns true when the local-zoom city-detail layer should be visible. */
export function applySettlementLod(input: SettlementLodInput): boolean {
  const { sprites, textures, count, tier, state, capital, zoom } = input;
  const local = zoom >= 0.62;
  const overview = zoom < 0.105;
  const regional = zoom < 0.28;
  const s = 1 / Math.max(0.03, zoom);
  for (let i = 0; i < count; i++) {
    const sprite = sprites[i];
    if (!sprite) continue;
    const t = tier[i] ?? 0;
    const isCapital = (capital[i] ?? 0) !== 0;
    if (local) {
      sprite.visible = false;
      continue;
    }
    let visible = true;
    if (overview) {
      sprite.texture = textures[DOT_TEXTURE]!;
      const dotPx = 3.2 + t * 1.05 + (isCapital ? 2.4 : 0);
      sprite.scale.set((dotPx * s) / 64);
    } else if (regional) {
      visible = isCapital || t >= 2;
      sprite.texture = textures[t + ((state[i] ?? 0) & 1 ? RUINED_TEXTURE_OFFSET : 0)]!;
      sprite.scale.set(markerWorldScale(t, zoom) * (isCapital ? 1.08 : 1));
    } else {
      sprite.texture = textures[t + ((state[i] ?? 0) & 1 ? RUINED_TEXTURE_OFFSET : 0)]!;
      sprite.scale.set(markerWorldScale(t, zoom) * (isCapital ? 1.08 : 1));
    }
    sprite.visible = visible;
  }
  for (let i = count; i < sprites.length; i++) {
    const sprite = sprites[i];
    if (sprite) sprite.visible = false;
  }
  return local;
}

export interface StateMarkInput {
  readonly g: Graphics;
  readonly sprites: readonly Sprite[];
  readonly count: number;
  readonly state: Uint8Array;
  readonly capital: Uint8Array;
  readonly zoom: number;
  readonly meta: WorldMetaMsg | null;
}

export function drawStateMarks(input: StateMarkInput): void {
  const { g, sprites, count, state: states, capital, zoom, meta } = input;
  g.clear();
  const s = 1 / Math.max(0.03, zoom);
  const local = zoom >= 0.62;
  for (let i = 0; i < count; i++) {
    const sprite = sprites[i];
    if (!sprite || (!sprite.visible && !local)) continue;
    const state = states[i] ?? 0;
    if (state === 0 && (capital[i] ?? 0) === 0) continue;
    const x = meta ? ((meta.settlements.x[i] ?? 0) + 0.5) * TILE_PX : sprite.x;
    const y = meta ? ((meta.settlements.y[i] ?? 0) + 0.5) * TILE_PX : sprite.y;
    if ((capital[i] ?? 0) !== 0) {
      g.circle(x, y, 9 * s).stroke({ width: 1.1 * s, color: 0xd8c07a, alpha: 0.95 });
      g.poly([x - 3 * s, y - 12 * s, x, y - 17 * s, x + 3 * s, y - 12 * s]).fill({ color: 0xd8c07a, alpha: 0.98 });
    }
    if ((state & 16) !== 0) {
      g.poly([x - 3 * s, y - 8 * s, x + 3 * s, y - 8 * s, x, y - 3 * s]).fill({ color: 0xb8503c, alpha: 0.98 });
    }
    if ((state & 2) !== 0) {
      g.circle(x + 4 * s, y - 3 * s, 1.9 * s).fill({ color: 0xc08a3e, alpha: 0.98 });
    } else if ((state & 32) !== 0) {
      g.circle(x + 4 * s, y - 3 * s, 1.6 * s).fill({ color: 0xd8c07a, alpha: 0.98 });
    }
    if ((state & 8) !== 0) {
      g.circle(x - 4 * s, y - 3 * s, 1.9 * s).stroke({ width: 1 * s, color: 0x9a5a3a, alpha: 0.98 });
    }
  }
}
