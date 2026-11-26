import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { seedOf } from '../../src/core/seed.ts';
import { politicalCells, politicalCellsReference } from '../../src/worker/queryLayers.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(preset: 'small' | 'medium' = 'small', seed = 424242): WorldState {
  return generateV1({
    seed: seedOf(seed, 11),
    preset,
    water: 55,
    harshness: 50,
    peoples: 8,
    generatorVersion: 1,
  });
}

describe('political territory acceleration', () => {
  it('is byte-identical to the reference nearest-settlement projection', () => {
    for (const preset of ['small', 'medium'] as const) {
      const w = world(preset);
      const fast = politicalCells(w);
      const reference = politicalCellsReference(w);
      expect(fast.length).toBe(reference.length);
      expect(fast).toEqual(reference);
    }
  });

  it('keeps every claimed cell within the documented radius', () => {
    const w = world('medium', 777);
    const cells = politicalCells(w);
    const radiusSq = 18 * 18;
    for (let y = 0; y < w.height; y += 3) {
      for (let x = 0; x < w.width; x += 3) {
        const civ = cells[y * w.width + x] ?? 0;
        if (civ === 0) continue;
        let nearest = radiusSq + 1;
        for (let i = 0; i < w.settlements.count; i++) {
          if ((w.settlements.civ[i] ?? 0) + 1 !== civ) continue;
          const dx = (w.settlements.x[i] ?? 0) - x;
          const dy = (w.settlements.y[i] ?? 0) - y;
          nearest = Math.min(nearest, dx * dx + dy * dy);
        }
        expect(nearest).toBeLessThanOrEqual(radiusSq);
      }
    }
  });
});
