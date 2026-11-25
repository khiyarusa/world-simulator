import { describe, expect, it } from 'vitest';
import { markerPx, markerWorldScale, selectionRadiusWorld, TILE_PX } from '../../src/render/markerGeometry.ts';

/**
 * The renderer applies the camera zoom once, in the world container. A marker's screen size is
 * therefore `64 * scale * zoom`. Before Stage 2.1 the scale also divided by TILE_PX, which shrank
 * every marker 32x to a sub-pixel dot (D-39). These tests pin the maths, not a screenshot.
 */
describe('settlement marker geometry', () => {
  const tiers = [0, 1, 2, 3, 4];
  const zooms = [0.0625, 0.1, 0.25, 0.5, 1, 2, 4, 8];

  it('renders every tier at its intended screen size, at every zoom', () => {
    for (const tier of tiers) {
      for (const zoom of zooms) {
        const screenPx = 64 * markerWorldScale(tier, zoom) * zoom;
        expect(screenPx).toBeCloseTo(markerPx(tier), 6);
      }
    }
  });

  it('grows monotonically with tier', () => {
    const sizes = tiers.map((t) => markerPx(t));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
  });

  it('never produces a sub-pixel marker at the supported zoom range', () => {
    for (const tier of tiers) {
      for (const zoom of zooms) {
        expect(64 * markerWorldScale(tier, zoom) * zoom).toBeGreaterThanOrEqual(14);
      }
    }
  });

  it('is independent of TILE_PX for the marker itself', () => {
    // A marker is a screen-space symbol; if the tile constant leaks in again this fails.
    expect(markerWorldScale(2, 1)).toBeCloseTo(markerPx(2) / 64, 9);
    expect(TILE_PX).toBe(32);
  });

  it('keeps the selection ring around the marker at every zoom', () => {
    for (const tier of tiers) {
      for (const zoom of zooms) {
        const ringPx = selectionRadiusWorld(tier, zoom) * zoom;
        expect(ringPx).toBeGreaterThan(markerPx(tier) / 2);
        expect(ringPx).toBeLessThan(markerPx(tier));
      }
    }
  });

  it('survives a nonsensical zoom without NaN or a division blow-up', () => {
    expect(Number.isFinite(markerWorldScale(1, 0))).toBe(true);
    expect(markerWorldScale(1, 0)).toBeCloseTo(markerPx(1) / 64, 9);
  });
});
