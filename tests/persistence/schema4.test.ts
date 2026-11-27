import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { seedOf } from '../../src/core/seed.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { serializeWorld, deserializeWorld } from '../../src/worker/serialize.ts';
import { decodeSociety, encodeSociety } from '../../src/sim/society/codec.ts';
import { applyIntervention } from '../../src/sim/society/interventions.ts';
import { isAlive } from '../../src/sim/society/common.ts';
import { migrateDoc } from '../../src/platform/migrations.ts';
import { newWorldDoc } from '../../src/platform/saves.ts';
import { SAVE_SCHEMA_VERSION } from '../../src/core/saveSchema.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(): WorldState {
  return generateV1({
    seed: seedOf(555111, 9),
    preset: 'small',
    water: 50,
    harshness: 50,
    peoples: 6,
    generatorVersion: 1,
  });
}

function alive(w: WorldState): number {
  for (let i = 0; i < w.settlements.count; i++) if (isAlive(w, i)) return i;
  return 0;
}

describe('schema 5 (campaign) on the route from 3 (interventions/history)', () => {
  it('migrates a schema-3 document and keeps the four-shard contract', () => {
    const doc = { ...newWorldDoc('w-old', 'Old world', 'AAAA0000-00000001', 'small'), schemaVersion: 3 };
    const migrated = migrateDoc(doc);
    expect(migrated.schemaVersion).toBe(5);
    expect(SAVE_SCHEMA_VERSION).toBe(5);
  });

  it('decodes a genuine schema-3 society block with empty intervention and series rings', () => {
    const w = world();
    const doc = encodeSociety(w);
    const legacy: Record<string, unknown> = { ...doc, v: 3 };
    delete legacy.interventions;
    delete legacy.stats;
    delete legacy.trend;
    const decoded = decodeSociety(w, legacy);
    expect(decoded.interventionCount).toBe(0);
    expect(decoded.statsCount).toBe(0);
    expect(decoded.trendCount[0]).toBe(0);
  });

  it('refuses a schema-4 block that silently lost its intervention ring', () => {
    const w = world();
    const doc = encodeSociety(w);
    const broken: Record<string, unknown> = { ...doc, v: 4 };
    delete broken.interventions;
    expect(() => decodeSociety(w, broken)).toThrow(/interventions/);
  });

  it('round-trips interventions, cooldowns and the yearly series exactly', async () => {
    const w = world();
    const id = alive(w);
    expect(applyIntervention(w, { op: 'bless', settlement: id, resource: 0, amount: 4 }).ok).toBe(true);
    expect(applyIntervention(w, { op: 'fertilize', settlement: id, intensity: 2 }).ok).toBe(true);
    for (let i = 0; i < 420; i++) runDay(w);
    expect(w.society.statsCount).toBeGreaterThan(0);
    expect(w.society.interventionCount).toBe(2);

    const checksum = worldChecksum(w);
    const restored = await deserializeWorld(await serializeWorld(w));
    expect(restored.schemaVersion).toBe(5);
    expect(worldChecksum(restored.state)).toBe(checksum);
    expect(restored.state.society.interventionCount).toBe(2);
    expect(restored.state.society.interventionLastDay[0]).toBe(w.society.interventionLastDay[0]);
    expect(restored.state.society.statsCount).toBe(w.society.statsCount);
    expect(restored.state.society.trendCount[id]).toBe(w.society.trendCount[id]);
  });
});
