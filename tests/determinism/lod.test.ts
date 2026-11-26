import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { totalPopulation } from '../../src/sim/society/living.ts';
import { seedOf } from '../../src/core/seed.ts';
import { Camera } from '../../src/render/camera.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(seed: number): WorldState {
  return generateV1({
    seed: seedOf(seed, 9),
    preset: 'small',
    water: 50,
    harshness: 50,
    peoples: 6,
    generatorVersion: 1,
  });
}

/**
 * S3-A6: a camera that pans and zooms on every frame must not change history. The simulation never
 * reads the camera; this test proves it on the actual pipeline rather than by assertion in a document.
 */
describe('camera independence (S3-A6)', () => {
  it('produces an identical world with a fixed and a constantly moving camera', () => {
    const fixed = world(5150);
    const moving = world(5150);
    const camera = new Camera();
    camera.setViewport(360, 780);
    camera.setWorld(moving.width, moving.height);
    camera.fit();

    for (let day = 1; day <= 720; day++) {
      runDay(fixed);
      runDay(moving);
      if (day % 3 === 0) {
        camera.panByScreen(Math.sin(day / 17) * 40, Math.cos(day / 23) * 40);
        camera.zoomAtScreen(180, 390, day % 6 === 0 ? 1.2 : 0.85);
        camera.update(1 / 60);
      }
    }

    expect(camera.zoom).toBeGreaterThan(0);
    expect(worldChecksum(moving)).toBe(worldChecksum(fixed));
    expect(totalPopulation(moving)).toBe(totalPopulation(fixed));
    expect(moving.society.eventCount).toBe(fixed.society.eventCount);
    for (let k = 0; k < fixed.society.eventCount; k++) {
      expect(moving.society.eventId[k]).toBe(fixed.society.eventId[k]);
      expect(moving.society.eventDay[k]).toBe(fixed.society.eventDay[k]);
      expect(moving.society.eventType[k]).toBe(fixed.society.eventType[k]);
    }
  });
});
