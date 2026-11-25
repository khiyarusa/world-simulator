import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { totalPopulation } from '../../src/sim/society/living.ts';
import { populationOf } from '../../src/sim/society/state.ts';
import { serializeWorld, deserializeWorld } from '../../src/worker/serialize.ts';
import { seedOf } from '../../src/core/seed.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(seed = 77): WorldState {
  return generateV1({
    seed: seedOf(seed, 3),
    preset: 'small',
    water: 55,
    harshness: 40,
    peoples: 6,
    generatorVersion: 1,
  });
}

function run(state: WorldState, days: number): void {
  for (let i = 0; i < days; i++) runDay(state);
}

describe('living world', () => {
  it('conserves population exactly across births, deaths and migration', () => {
    const state = world();
    const initial = totalPopulation(state);
    run(state, 3 * 360);
    const final = totalPopulation(state);
    expect(final).toBe(initial + state.counters.births - state.counters.deaths);
    expect(state.counters.births).toBeGreaterThan(0);
    expect(state.counters.deaths).toBeGreaterThan(0);
  });

  it('keeps every cohort sum equal to the settlement population', () => {
    const state = world(19);
    run(state, 2 * 360);
    for (let i = 0; i < state.settlements.count; i++) {
      let sum = 0;
      for (let c = 0; c < 8; c++) sum += state.society.cohorts[i * 8 + c] ?? 0;
      expect(sum).toBe(populationOf(state.society, i));
    }
  });

  it('never produces a negative or over-capacity stock', () => {
    const state = world(5);
    run(state, 5 * 360);
    for (let i = 0; i < state.settlements.count * 6; i++) {
      expect(state.society.stock[i] ?? 0).toBeGreaterThanOrEqual(0);
      expect(state.society.stock[i] ?? 0).toBeLessThanOrEqual(state.society.cap[i] ?? 0);
    }
  });

  it('produces identical history for the same seed and identical weather', () => {
    const a = world(2024);
    const b = world(2024);
    run(a, 2 * 360);
    run(b, 2 * 360);
    expect(worldChecksum(a)).toBe(worldChecksum(b));
    expect(a.counters.births).toBe(b.counters.births);
  });

  it('emits events whose causes resolve to an earlier event or an explicit root', () => {
    const state = world(42);
    run(state, 6 * 360);
    const soc = state.society;
    const seen = new Set<number>();
    for (let k = 0; k < soc.eventCount; k++) {
      const cause = soc.eventCause[k] ?? 0;
      if (cause !== 0) expect(seen.has(cause)).toBe(true);
      seen.add(soc.eventId[k] ?? 0);
    }
    expect(soc.eventCount).toBeGreaterThan(0);
  });

  it('round-trips society state through save and load', async () => {
    const state = world(11);
    run(state, 400);
    const restored = await deserializeWorld(await serializeWorld(state));
    expect(restored.schemaVersion).toBe(2);
    expect(restored.state.day).toBe(state.day);
    expect(worldChecksum(restored.state)).toBe(worldChecksum(state));
    expect(totalPopulation(restored.state)).toBe(totalPopulation(state));
    expect(restored.state.society.eventCount).toBe(state.society.eventCount);

    // and continues deterministically from the restored snapshot
    run(state, 360);
    run(restored.state, 360);
    expect(worldChecksum(restored.state)).toBe(worldChecksum(state));
  });

  it('migrates a v1 save: society is initialised from the legacy population, exactly', async () => {
    const state = world(31);
    // A genuine v1 generation: the encoder is asked for schema 1, which stamps every header.
    const shards = await serializeWorld(state, 1);
    // strip the society block to simulate a real v1 meta shard (same binary shards, old schema)
    const meta = shards.find((s) => s.name === 'meta');
    expect(meta).toBeDefined();
    if (!meta) return;
    const raw = meta.compressed
      ? new Uint8Array(
          await new Response(
            new Blob([new Uint8Array(meta.payload) as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),
          ).arrayBuffer(),
        )
      : new Uint8Array(meta.payload);
    const doc = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    delete doc.society;
    doc.schemaVersion = 1;
    const encoded = new TextEncoder().encode(JSON.stringify(doc));
    const { crc32 } = await import('../../src/core/crc32.ts');
    const v1Meta = {
      name: 'meta',
      crc32: crc32(encoded),
      compressed: false,
      bytes: encoded.byteLength,
      payload: encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer,
    };

    // v1 never wrote a society block, and every binary header already says schema 1.
    const migrated = await deserializeWorld(shards.map((s) => (s.name === 'meta' ? v1Meta : s)));
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.state.society.cohorts.length).toBeGreaterThan(0);
    let legacy = 0;
    for (let i = 0; i < migrated.state.settlements.count; i++) {
      legacy += migrated.state.settlements.pop[i] ?? 0;
      expect(populationOf(migrated.state.society, i)).toBe(migrated.state.settlements.pop[i] ?? 0);
    }
    expect(totalPopulation(migrated.state)).toBe(legacy);
  });
});
