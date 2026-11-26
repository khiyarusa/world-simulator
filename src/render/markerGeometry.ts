/**
 * Marker geometry, DOM-free and Pixi-free so it can be unit-tested in Node (D-39).
 *
 * Coordinate spaces, stated once:
 *   - a tile is TILE_PX world pixels wide;
 *   - the world container is scaled by `zoom`, so world→screen = `zoom`;
 *   - a settlement glyph texture is MARKER_TEXTURE_PX square.
 *
 * Screen size of a glyph = texturePx * scale * zoom. Therefore the scale that yields `px` screen
 * pixels is `px / (texturePx * zoom)` — and nothing else.
 */

export const TILE_PX = 32;
export const MARKER_TEXTURE_PX = 64;

/** Marker size in screen pixels per settlement tier (camp → metropolis). */
const MARKER_PX: readonly number[] = [18, 23, 29, 37, 46];

export function markerPx(tier: number): number {
  return MARKER_PX[tier] ?? MARKER_PX[0]!;
}

/** Sprite scale that renders a settlement glyph at `markerPx(tier)` screen pixels. */
export function markerWorldScale(tier: number, zoom: number): number {
  const safeZoom = zoom > 0 ? zoom : 1;
  return markerPx(tier) / (MARKER_TEXTURE_PX * safeZoom);
}

/** Selection ring radius in world pixels, sized from the marker so it tracks it on screen. */
export function selectionRadiusWorld(tier: number, zoom: number): number {
  const safeZoom = zoom > 0 ? zoom : 1;
  return (markerPx(tier) / 2 + 5) / safeZoom;
}
