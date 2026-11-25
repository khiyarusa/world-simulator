import { describe, expect, it } from 'vitest';
import { deserializeWorld, serializeWorld } from '../../src/worker/serialize.ts';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { crc32 } from '../../src/core/crc32.ts';
import { seedOf } from '../../src/core/seed.ts';
import { SimError } from '../../src/core/errors.ts';
import type { SaveShard } from '../../src/worker/protocol.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(): WorldState {
  return generateV1({
    seed: seedOf(424242, 7),
    preset: 'small',
    water: 50,
    harshness: 50,
    peoples: 5,
    generatorVersion: 1,
  });
}

async function expectSimError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(SimError);
    expect((e as SimError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, nothing was thrown`);
}

describe('save shards', () => {
  it('round-trips the world exactly', async () => {
    const original = world();
    const shards = await serializeWorld(original);
    expect(shards.map((s) => s.name).sort()).toEqual(['civs', 'meta', 'settlements', 'terrain']);

    const restored = await deserializeWorld(shards);
    expect(restored.schemaVersion).toBe(2);
    expect(restored.state.day).toBe(original.day);
    expect(restored.state.recipe.seed).toEqual(original.recipe.seed);
    expect(restored.state.recipe.preset).toBe(original.recipe.preset);
    expect(worldChecksum(restored.state)).toBe(worldChecksum(original));
    expect(Array.from(restored.state.grids.biome)).toEqual(Array.from(original.grids.biome));
    expect(Array.from(restored.state.grids.elevation)).toEqual(Array.from(original.grids.elevation));
    expect(restored.state.settlements.count).toBe(original.settlements.count);
    expect(restored.state.rngStates).toHaveLength(original.rngStates.length);
  });

  it('keeps generating identical states after a load', async () => {
    const original = world();
    const restored = await deserializeWorld(await serializeWorld(original));
    expect(worldChecksum(restored.state)).toBe(worldChecksum(original));
  });

  it('rejects a corrupted payload', async () => {
    const shards = await serializeWorld(world());
    const terrain = shards.find((s) => s.name === 'terrain');
    expect(terrain).toBeDefined();
    if (!terrain) return;
    const bytes = new Uint8Array(terrain.payload);
    bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] ?? 0) ^ 0xff;
    await expectSimError(deserializeWorld(shards), 'SAVE_CORRUPT');
  });

  it('rejects a truncated payload instead of half-loading', async () => {
    const shards = await serializeWorld(world());
    const settlements = shards.find((s) => s.name === 'settlements');
    expect(settlements).toBeDefined();
    if (!settlements) return;
    const truncated = settlements.payload.slice(0, Math.max(4, settlements.payload.byteLength - 40));
    const patched: SaveShard = { ...settlements, payload: truncated };
    const mixed = shards.map((s) => (s.name === 'settlements' ? patched : s));
    await expectSimError(deserializeWorld(mixed), 'SAVE_CORRUPT');
  });

  it('rejects a missing shard', async () => {
    const shards = await serializeWorld(world());
    await expectSimError(
      deserializeWorld(shards.filter((s) => s.name !== 'civs')),
      'SAVE_CORRUPT',
    );
  });

  it('refuses a save written by a newer schema', async () => {
    const shards = await serializeWorld(world());
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
    const doc = JSON.parse(new TextDecoder().decode(raw)) as { schemaVersion: number };
    doc.schemaVersion = 99;
    const encoded = new TextEncoder().encode(JSON.stringify(doc));
    const bumped: SaveShard = {
      name: 'meta',
      crc32: crc32(encoded),
      compressed: false,
      bytes: encoded.byteLength,
      payload: encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer,
    };
    await expectSimError(
      deserializeWorld(shards.map((s) => (s.name === 'meta' ? bumped : s))),
      'SAVE_SCHEMA_NEWER',
    );
  });

  it('preserves the saved day across a round trip', async () => {
    const original = world();
    original.day = 12_345;
    const restored = await deserializeWorld(await serializeWorld(original));
    expect(restored.state.day).toBe(12_345);
  });
});
