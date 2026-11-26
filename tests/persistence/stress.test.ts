import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { seedOf } from '../../src/core/seed.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { deserializeWorld, serializeWorld } from '../../src/worker/serialize.ts';
import { applyIntervention } from '../../src/sim/society/interventions.ts';
import { isAlive } from '../../src/sim/society/common.ts';

describe('save/load stress (Stage 5 S5-A4)', () => {
  it('survives 50 consecutive round trips with identical state', async () => {
    let state = generateV1({
      seed: seedOf(424242, 7),
      preset: 'small',
      water: 50,
      harshness: 50,
      peoples: 4,
      generatorVersion: 1,
    });
    let id = 0;
    for (let i = 0; i < state.settlements.count; i++) if (isAlive(state, i)) { id = i; break; }
    applyIntervention(state, { op: 'bless', settlement: id, resource: 0, amount: 4 });
    for (let i = 0; i < 380; i++) runDay(state);
    const expected = worldChecksum(state);
    for (let cycle = 0; cycle < 50; cycle++) {
      const restored = await deserializeWorld(await serializeWorld(state));
      expect(worldChecksum(restored.state)).toBe(expected);
      expect(restored.schemaVersion).toBe(4);
      state = restored.state;
    }
  });
});
