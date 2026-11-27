/** Selection ring: screen-space width, world-space radius, no per-frame rebuild. */
import type { Graphics, Sprite } from 'pixi.js';
import { selectionRadiusWorld } from './markerGeometry.ts';

export function drawSelection(
  g: Graphics,
  sprites: readonly Sprite[],
  selectedId: number | null,
  tier: Uint8Array,
  zoom: number,
): void {
  g.clear();
  if (selectedId === null) return;
  const sprite = sprites[selectedId];
  if (!sprite || !sprite.visible) return;
  const r = selectionRadiusWorld(tier[selectedId] ?? 0, zoom);
  const w = 1.8 / Math.max(0.15, zoom);
  g.circle(sprite.x, sprite.y, r).stroke({ width: w, color: 0xece5d8, alpha: 0.98 });
  g.circle(sprite.x, sprite.y, r + 4 / Math.max(0.15, zoom)).stroke({ width: w * 0.45, color: 0xc8a05a, alpha: 0.7 });
  const tick = r + 7 / Math.max(0.15, zoom);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    g.moveTo(sprite.x + dx * tick, sprite.y + dy * tick)
      .lineTo(sprite.x + dx * (tick + 4 / Math.max(0.15, zoom)), sprite.y + dy * (tick + 4 / Math.max(0.15, zoom)))
      .stroke({ width: w * 0.8, color: 0xece5d8, alpha: 0.9 });
  }
}
