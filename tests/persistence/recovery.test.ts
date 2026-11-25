import { describe, expect, it } from 'vitest';
import { loadWorld, newWorldDoc, saveWorld, verifyGeneration, type WorldStore } from '../../src/platform/saves.ts';
import type { StoredShard, WorldDoc } from '../../src/platform/storage.ts';
import { serializeWorld } from '../../src/worker/serialize.ts';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { seedOf } from '../../src/core/seed.ts';
import { REQUIRED_SHARDS } from '../../src/core/saveSchema.ts';
import { SimError } from '../../src/core/errors.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

const WORLD_ID = 'world-test';

/**
 * In-memory implementation of the storage contract.
 *
 * It exercises the real `saves.ts` logic (shard-set validation, recovery choice, repointing,
 * pruning) against the same interface `WorldDb` implements. Real IndexedDB behaviour — including
 * the transaction that deletes a damaged generation — is covered by the browser end-to-end test.
 */
class MemoryWorldStore implements WorldStore {
  readonly worlds = new Map<string, WorldDoc>();
  readonly gens = new Map<string, Map<number, StoredShard[]>>();
  readonly commits: number[] = [];

  async getWorld(id: string): Promise<WorldDoc | null> {
    return this.worlds.get(id) ?? null;
  }

  async readGeneration(worldId: string, gen: number): Promise<StoredShard[]> {
    return this.gens.get(worldId)?.get(gen) ?? [];
  }

  async commitGeneration(
    doc: WorldDoc,
    gen: number,
    shards: readonly Omit<StoredShard, 'worldId' | 'gen'>[],
  ): Promise<void> {
    const forWorld = this.gens.get(doc.id) ?? new Map<number, StoredShard[]>();
    forWorld.set(
      gen,
      shards.map((s) => ({ ...s, worldId: doc.id, gen })),
    );
    this.gens.set(doc.id, forWorld);
    this.worlds.set(doc.id, { ...doc, currentGen: gen });
    this.commits.push(gen);
  }

  async pruneGenerations(worldId: string, keepGen: number): Promise<void> {
    const forWorld = this.gens.get(worldId);
    if (!forWorld) return;
    for (const gen of [...forWorld.keys()]) {
      if (gen < keepGen) forWorld.delete(gen);
    }
  }

  async putWorld(doc: WorldDoc): Promise<void> {
    this.worlds.set(doc.id, doc);
  }

  async resetToGeneration(doc: WorldDoc, gen: number): Promise<void> {
    const forWorld = this.gens.get(doc.id) ?? new Map<number, StoredShard[]>();
    for (const existing of [...forWorld.keys()]) {
      if (existing !== gen) forWorld.delete(existing);
    }
    this.gens.set(doc.id, forWorld);
    this.worlds.set(doc.id, { ...doc, currentGen: gen, prevGen: 0 });
  }

  gensOf(id: string): number[] {
    return [...(this.gens.get(id)?.keys() ?? [])].sort((a, b) => a - b);
  }
}

function world(): WorldState {
  return generateV1({
    seed: seedOf(918273, 5),
    preset: 'small',
    water: 50,
    harshness: 50,
    peoples: 3,
    generatorVersion: 1,
  });
}

async function commitOnce(store: MemoryWorldStore, doc: WorldDoc, state: WorldState): Promise<WorldDoc> {
  const shards = await serializeWorld(state);
  return saveWorld(store, doc, shards, state.day, 'deadbeef', 250);
}

function flipByte(payload: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(payload.slice(0));
  const at = Math.max(0, Math.floor(bytes.length / 2));
  bytes[at] = (bytes[at] ?? 0) ^ 0xff;
  return bytes.buffer as ArrayBuffer;
}

async function expectSimError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(SimError);
    expect((e as SimError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, nothing thrown`);
}

describe('save generations', () => {
  it('keeps the current and the previous generation after two saves', async () => {
    const store = new MemoryWorldStore();
    const state = world();
    const base = newWorldDoc(WORLD_ID, 'Test', '00000001-00000002', 'small');
    const first = await commitOnce(store, base, state);
    const doc = await commitOnce(store, first, state);
    expect(doc.currentGen).toBe(2);
    expect(doc.prevGen).toBe(1);
    expect(store.gensOf(WORLD_ID)).toEqual([1, 2]);
  });

  it('validates the complete shard set, not just the shards present', async () => {
    const ok = await serializeWorld(world());
    expect(ok.map((s) => s.name).sort()).toEqual([...REQUIRED_SHARDS].sort());
    expect(await verifyGeneration(ok.map((s) => ({ ...s, worldId: WORLD_ID, gen: 1 })))).toEqual({ ok: true });

    for (const missing of REQUIRED_SHARDS) {
      const rows = ok.filter((s) => s.name !== missing).map((s) => ({ ...s, worldId: WORLD_ID, gen: 1 }));
      const result = await verifyGeneration(rows);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('missing shard');
    }

    const duplicate = [...ok, ok[0]!].map((s) => ({ ...s, worldId: WORLD_ID, gen: 1 }));
    expect((await verifyGeneration(duplicate)).reason).toContain('duplicate shard');

    const wrongLength = ok.map((s, i) => ({ ...s, worldId: WORLD_ID, gen: 1, bytes: i === 0 ? s.bytes + 1 : s.bytes }));
    expect((await verifyGeneration(wrongLength)).ok).toBe(false);

    const corrupted = ok.map((s, i) => ({ ...s, worldId: WORLD_ID, gen: 1, payload: i === 0 ? flipByte(s.payload) : s.payload }));
    expect((await verifyGeneration(corrupted)).ok).toBe(false);
  });

  it('recovers from a damaged current generation and makes the backup current', async () => {
    const store = new MemoryWorldStore();
    const state = world();
    const base = newWorldDoc(WORLD_ID, 'Test', '00000001-00000002', 'small');
    const first = await commitOnce(store, base, state);
    await commitOnce(store, first, state);
    expect(store.gensOf(WORLD_ID)).toEqual([1, 2]);

    // damage the current generation exactly as a bad write would
    const current = store.gens.get(WORLD_ID)!.get(2)!;
    store.gens.get(WORLD_ID)!.set(
      2,
      current.map((s, i) => (i === 0 ? { ...s, payload: flipByte(s.payload) } : s)),
    );

    const loaded = await loadWorld(store, WORLD_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.recovered).toBe(true);
    expect(loaded!.doc.currentGen).toBe(1);
    expect(loaded!.doc.prevGen).toBe(0);
    // the damaged generation is gone, so the next save cannot promote it to "previous"
    expect(store.gensOf(WORLD_ID)).toEqual([1]);
    expect(store.worlds.get(WORLD_ID)?.currentGen).toBe(1);
  });

  it('survives save-after-recovery and keeps the recovered world loadable', async () => {
    const store = new MemoryWorldStore();
    const state = world();
    const base = newWorldDoc(WORLD_ID, 'Test', '00000001-00000002', 'small');
    const first = await commitOnce(store, base, state);
    await commitOnce(store, first, state);

    store.gens.get(WORLD_ID)!.set(2, []);
    const recovered = await loadWorld(store, WORLD_ID);
    expect(recovered!.recovered).toBe(true);

    const doc = await commitOnce(store, recovered!.doc, state);
    expect(doc.currentGen).toBe(2);
    expect(doc.prevGen).toBe(1);
    expect(store.gensOf(WORLD_ID)).toEqual([1, 2]);

    const loaded = await loadWorld(store, WORLD_ID);
    expect(loaded!.recovered).toBe(false);
    expect(loaded!.doc.currentGen).toBe(2);
  });

  it('refuses to load when every generation is damaged', async () => {
    const store = new MemoryWorldStore();
    const state = world();
    const base = newWorldDoc(WORLD_ID, 'Test', '00000001-00000002', 'small');
    const first = await commitOnce(store, base, state);
    await commitOnce(store, first, state);
    store.gens.get(WORLD_ID)!.set(1, []);
    store.gens.get(WORLD_ID)!.set(2, []);
    await expectSimError(loadWorld(store, WORLD_ID), 'SAVE_CORRUPT');
  });

  it('refuses to write a snapshot with an incomplete shard set', async () => {
    const store = new MemoryWorldStore();
    const doc = newWorldDoc(WORLD_ID, 'Test', '00000001-00000002', 'small');
    const partial = (await serializeWorld(world())).filter((s) => s.name !== 'terrain');
    await expectSimError(saveWorld(store, doc, partial, 1, 'x', 0), 'SAVE_CORRUPT');
    expect(store.commits).toEqual([]);
  });

  it('prunes old generations but never the previous one', async () => {
    const store = new MemoryWorldStore();
    const state = world();
    let doc = await commitOnce(store, newWorldDoc(WORLD_ID, 'Test', '00000001-00000002', 'small'), state);
    for (let i = 0; i < 3; i++) doc = await commitOnce(store, doc, state);
    // each save keeps exactly current + previous
    expect(store.gensOf(WORLD_ID)).toEqual([3, 4]);
    expect(store.worlds.get(WORLD_ID)?.prevGen).toBe(3);
  });
});
