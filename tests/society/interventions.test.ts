import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { seedOf } from '../../src/core/seed.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { serializeWorld, deserializeWorld } from '../../src/worker/serialize.ts';
import { applyIntervention, blessMaxAmount, listInterventions } from '../../src/sim/society/interventions.ts';
import { FLAG_BLIGHT, isAlive } from '../../src/sim/society/common.ts';
import { CAUSE, EVENT_TYPE, INTERVENTION } from '../../src/sim/society/state.ts';
import { stockOf } from '../../src/sim/society/state.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(seed = 424242): WorldState {
  return generateV1({
    seed: seedOf(seed, 7),
    preset: 'small',
    water: 50,
    harshness: 50,
    peoples: 8,
    generatorVersion: 1,
  });
}

function firstAlive(w: WorldState): number {
  for (let i = 0; i < w.settlements.count; i++) if (isAlive(w, i)) return i;
  throw new Error('no living settlement in fixture');
}

function run(w: WorldState, days: number): void {
  for (let i = 0; i < days; i++) runDay(w);
}

describe('player interventions', () => {
  it('blesses a settlement with real units and records a player-rooted event', () => {
    const w = world();
    const id = firstAlive(w);
    const before = stockOf(w.society, id, 0);
    const max = blessMaxAmount(w, id, 0);
    expect(max).toBeGreaterThan(0);
    const result = applyIntervention(w, { op: 'bless', settlement: id, resource: 0, amount: Math.min(5, max) });
    expect(result.ok).toBe(true);
    expect(result.eventId).toBeGreaterThan(0);
    const after = stockOf(w.society, id, 0);
    expect(after - before).toBe(result.effects[0]?.delta);
    expect(after).toBeGreaterThan(before);
    expect(w.counters.blessings).toBe(1);

    const soc = w.society;
    const index = (soc.eventHead - 1 + soc.eventId.length) % soc.eventId.length;
    expect(soc.eventId[index]).toBe(result.eventId);
    expect(soc.eventType[index]).toBe(EVENT_TYPE.PLAYER_BLESS);
    expect(soc.eventCause[index]).toBe(CAUSE.PLAYER);
    expect(listInterventions(soc, w.day)[0]?.kind).toBe(INTERVENTION.BLESS);
  });

  it('refuses a gift above the yearly limit and refuses a second gift during cooldown', () => {
    const w = world();
    const id = firstAlive(w);
    const max = blessMaxAmount(w, id, 0);
    const tooMuch = applyIntervention(w, { op: 'bless', settlement: id, resource: 0, amount: max + 1 });
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.code).toBe('AMOUNT_LIMIT');

    const first = applyIntervention(w, { op: 'bless', settlement: id, resource: 0, amount: Math.max(1, Math.floor(max / 2)) });
    expect(first.ok).toBe(true);
    const second = applyIntervention(w, { op: 'bless', settlement: id, resource: 0, amount: 1 });
    expect(second.ok).toBe(false);
    expect(second.code).toBe('COOLDOWN');
    expect(second.cooldownDays).toBeGreaterThan(0);
  });

  it('blights a region through the real ecology pass and keeps the effect across a reload', async () => {
    const w = world(9001);
    const id = firstAlive(w);
    const result = applyIntervention(w, { op: 'blight', settlement: id, intensity: 2, durationDays: 180 });
    expect(result.ok).toBe(true);
    expect(w.counters.blights).toBe(1);
    run(w, 30);
    expect((w.society.flags[id] ?? 0) & FLAG_BLIGHT).toBeTruthy();

    const before = worldChecksum(w);
    const restored = await deserializeWorld(await serializeWorld(w));
    expect(worldChecksum(restored.state)).toBe(before);
    expect(restored.state.society.interventionCount).toBe(w.society.interventionCount);
    expect(restored.state.society.interventionLastDay[INTERVENTION.BLIGHT]).toBe(w.society.interventionLastDay[INTERVENTION.BLIGHT]);
    run(restored.state, 1);
    expect(worldChecksum(restored.state)).not.toBe(before);
  });

  it('fertilizes soil within the 0..255 bound', () => {
    const w = world(777);
    const id = firstAlive(w);
    const tile = (w.settlements.y[id] ?? 0) * w.width + (w.settlements.x[id] ?? 0);
    const before = w.grids.fertility[tile] ?? 0;
    const result = applyIntervention(w, { op: 'fertilize', settlement: id, intensity: 3 });
    expect(result.ok).toBe(true);
    expect(w.grids.fertility[tile] ?? 0).toBeGreaterThan(before);
    expect(w.grids.fertility[tile] ?? 0).toBeLessThanOrEqual(255);
    expect(w.counters.fertilized).toBe(1);
  });

  it('incites two real civilizations, bounded by the relation floor', () => {
    const w = world(31337);
    if (w.civs.count < 2) return;
    const result = applyIntervention(w, { op: 'incite', civA: 0, civB: 1 });
    expect(result.ok).toBe(true);
    expect(w.society.relation[0 * 12 + 1]).toBeLessThanOrEqual(0);
    expect(w.society.grievance[0 * 12 + 1]).toBeGreaterThan(0);
    expect(w.counters.incited).toBe(1);
    expect(applyIntervention(w, { op: 'incite', civA: 0, civB: 0 }).ok).toBe(false);
    expect(applyIntervention(w, { op: 'incite', civA: 0, civB: 99 }).ok).toBe(false);
  });

  it('rejects malformed targets without mutating the world', () => {
    const w = world(123);
    const before = worldChecksum(w);
    for (const command of [
      { op: 'bless' as const, settlement: 999, resource: 0, amount: 1 },
      { op: 'bless' as const, settlement: 0, resource: 9, amount: 1 },
      { op: 'blight' as const, settlement: 0, intensity: 7, durationDays: 180 },
      { op: 'fertilize' as const, settlement: -1, intensity: 1 },
    ]) {
      expect(applyIntervention(w, command).ok).toBe(false);
    }
    expect(worldChecksum(w)).toBe(before);
  });

  it('keeps determinism: the same commands on the same seed produce the same checksum', () => {
    const a = world(2024);
    const b = world(2024);
    const idA = firstAlive(a);
    const idB = firstAlive(b);
    applyIntervention(a, { op: 'bless', settlement: idA, resource: 0, amount: 10 });
    applyIntervention(b, { op: 'bless', settlement: idB, resource: 0, amount: 10 });
    applyIntervention(a, { op: 'fertilize', settlement: idA, intensity: 2 });
    applyIntervention(b, { op: 'fertilize', settlement: idB, intensity: 2 });
    run(a, 40);
    run(b, 40);
    expect(worldChecksum(a)).toBe(worldChecksum(b));
  });
});
