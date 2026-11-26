import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { auditSociety } from '../../src/sim/society/audit.ts';
import { applyBlight } from '../../src/sim/society/ecology.ts';
import { evaluateWarGate, WAR_GATE } from '../../src/sim/society/war.ts';
import { populationOf, RES } from '../../src/sim/society/state.ts';
import { totalPopulation } from '../../src/sim/society/living.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { serializeWorld, deserializeWorld } from '../../src/worker/serialize.ts';
import { crc32 } from '../../src/core/crc32.ts';
import { seedOf } from '../../src/core/seed.ts';
import type { SaveShard } from '../../src/worker/protocol.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(seed = 91): WorldState {
  return generateV1({
    seed: seedOf(seed, 5),
    preset: 'small',
    water: 50,
    harshness: 50,
    peoples: 6,
    generatorVersion: 1,
  });
}

async function readMeta(shards: readonly SaveShard[]): Promise<{ doc: Record<string, unknown>; shard: SaveShard }> {
  const shard = shards.find((s) => s.name === 'meta');
  if (!shard) throw new Error('no meta shard');
  const raw = shard.compressed
    ? new Uint8Array(
        await new Response(
          new Blob([new Uint8Array(shard.payload) as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer(),
      )
    : new Uint8Array(shard.payload);
  return { doc: JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>, shard };
}

function metaShard(doc: Record<string, unknown>): SaveShard {
  const encoded = new TextEncoder().encode(JSON.stringify(doc));
  return {
    name: 'meta',
    crc32: crc32(encoded),
    compressed: false,
    bytes: encoded.byteLength,
    payload: encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer,
  };
}

async function expectCorrupt(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
}

describe('stage 3.2 systems', () => {
  it('refuses a war gate that no real condition satisfies', () => {
    const state = world();
    expect(state.civs.count).toBeGreaterThan(1);
    const gate = evaluateWarGate(state, 0, 1);
    expect(gate.pass).toBe(false);
    expect(gate.strength).toBeGreaterThan(0);
  });

  it('passes the gate only when all four measured conditions pass, and records their values', () => {
    const state = world(17);
    const soc = state.society;
    const s = state.settlements;
    soc.army[0] = 200;
    soc.army[1] = 5;
    soc.grievance[0 * 12 + 1] = 800;
    soc.grievance[1 * 12 + 0] = 800;
    for (let i = 0; i < s.count; i++) {
      const civ = s.civ[i] ?? 0;
      const pop = Math.max(1, populationOf(soc, i));
      if (civ === 0) {
        soc.stock[i * 6 + RES.FOOD] = pop * 100;
        soc.cap[i * 6 + RES.FOOD] = pop * 200;
      } else if (civ === 1) {
        soc.stock[i * 6 + RES.FOOD] = pop * 5;
        soc.cap[i * 6 + RES.FOOD] = pop * 200;
      }
    }
    const capital = state.civs.capital[0] ?? 0;
    soc.treasury[capital] = 10_000;

    const gate = evaluateWarGate(state, 0, 1);
    expect(gate.strength).toBeGreaterThanOrEqual(WAR_GATE.strengthPm);
    expect(gate.grievance).toBeGreaterThanOrEqual(WAR_GATE.grievance);
    expect(gate.capacity).toBeGreaterThanOrEqual(WAR_GATE.foodDays);
    expect(gate.utility).toBeGreaterThanOrEqual(WAR_GATE.utilityMargin);
    expect(gate.pass).toBe(true);
  });

  it('keeps the population identity and the occupation projection exact over a long run', () => {
    const state = world(23);
    const initial = totalPopulation(state);
    for (let i = 0; i < 3 * 360; i++) runDay(state);
    expect(totalPopulation(state)).toBe(initial + state.counters.births - state.counters.deaths);
    for (let i = 0; i < state.settlements.count; i++) {
      let cohortSum = 0;
      for (let c = 0; c < 8; c++) cohortSum += state.society.cohorts[i * 8 + c] ?? 0;
      expect(cohortSum).toBe(populationOf(state.society, i));
      let share = 0;
      for (let k = 0; k < 5; k++) share += state.society.occShare[i * 5 + k] ?? 0;
      expect(share).toBe(1000);
    }
    expect(auditSociety(state)).toEqual([]);
  });

  it('a blight lowers real fertility and is recorded as a root-cause event', () => {
    const state = world(29);
    const i = 0;
    const tile = (state.settlements.y[i] ?? 0) * state.width + (state.settlements.x[i] ?? 0);
    const before = state.grids.fertility[tile] ?? 0;
    const affected = applyBlight(state, i, state.day);
    expect(affected).toBeGreaterThan(0);
    expect(state.grids.fertility[tile] ?? 0).toBeLessThan(before);
    const soc = state.society;
    let found = false;
    for (let k = 0; k < soc.eventCount; k++) {
      if ((soc.eventType[k] ?? 255) === 24) {
        found = true;
        expect(soc.eventCause[k]).toBe(-1);
        expect(soc.eventSeverity[k]).toBe(5);
      }
    }
    expect(found).toBe(true);
  });

  it('loads a genuine schema-2 block and expands it into the schema-3 layout', async () => {
    const state = world(31);
    const shards = await serializeWorld(state, 2);
    const { doc } = await readMeta(shards);
    doc.schemaVersion = 2;
    const society = doc.society as Record<string, unknown>;
    society.v = 2;
    delete society.price;
    delete society.lastFamineEvent;
    delete society.occupier;
    delete society.surplusYears;
    delete society.techProgress;
    delete society.army;
    delete society.exhaustion;
    delete society.warWins;
    delete society.routes;
    delete society.treaties;
    delete society.wars;

    const migrated = await deserializeWorld(shards.map((s) => (s.name === 'meta' ? metaShard(doc) : s)));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.state.society.routeCount).toBe(0);
    expect(migrated.state.society.treatyCount).toBe(0);
    expect(migrated.state.society.warCount).toBe(0);
    expect(migrated.state.society.price[0]).toBe(1000);
    expect(worldChecksum(migrated.state)).toBe(worldChecksum(state));
  });

  it('rejects a schema-3 block that is missing a required structure', async () => {
    const state = world(37);
    const shards = await serializeWorld(state);
    const { doc } = await readMeta(shards);
    const society = doc.society as Record<string, unknown>;
    delete society.price;
    await expectCorrupt(deserializeWorld(shards.map((s) => (s.name === 'meta' ? metaShard(doc) : s))));
  });
});
