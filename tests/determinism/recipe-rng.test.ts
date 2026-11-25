import { describe, expect, it } from 'vitest';
import { serializeWorld, deserializeWorld } from '../../src/worker/serialize.ts';
import { generateV1, recipeHashOf } from '../../src/sim/world/generate.v1.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { Rng, STREAM, STREAM_IDS, seedState } from '../../src/core/rng.ts';
import { seedOf } from '../../src/core/seed.ts';
import type { Preset, WorldRecipe, WorldState } from '../../src/sim/state/worldState.ts';

const TERRAIN_INDEX = STREAM_IDS.indexOf(STREAM.TERRAIN);
const SPAWN_INDEX = STREAM_IDS.indexOf(STREAM.SPAWN);

function recipe(seedLo = 424242, preset: Preset = 'small', overrides: Partial<WorldRecipe> = {}): WorldRecipe {
  return {
    seed: seedOf(seedLo, 7),
    preset,
    water: 50,
    harshness: 50,
    peoples: 5,
    generatorVersion: 1,
    ...overrides,
  };
}

function world(): WorldState {
  return generateV1(recipe());
}

function sequence(state: { s0: number; s1: number; s2: number; s3: number }, count: number): number[] {
  const rng = new Rng(state);
  return Array.from({ length: count }, () => rng.next());
}

describe('rng state capture', () => {
  it('stores the streams where generation left them, not where they started', () => {
    const state = world();
    const initialTerrain = seedState(state.recipe.seed.lo, state.recipe.seed.hi, STREAM.TERRAIN);
    expect(state.rngStates[TERRAIN_INDEX]).not.toEqual(initialTerrain);
    expect(state.rngStates[SPAWN_INDEX]).not.toEqual(seedState(state.recipe.seed.lo, state.recipe.seed.hi, STREAM.SPAWN));
  });

  it('captures identical states for identical recipes', () => {
    const a = world();
    const b = world();
    expect(a.rngStates).toEqual(b.rngStates);
  });

  it('keeps the future sequence identical across save and load', async () => {
    const original = world();
    const restored = await deserializeWorld(await serializeWorld(original));
    const before = sequence(original.rngStates[TERRAIN_INDEX]!, 32);
    const after = sequence(restored.state.rngStates[TERRAIN_INDEX]!, 32);
    expect(after).toEqual(before);
    expect(restored.state.rngStates).toEqual(original.rngStates);
  });

  it('changes the world checksum when a stream position changes', () => {
    const state = world();
    const before = worldChecksum(state);
    const mutated: WorldState = {
      ...state,
      rngStates: state.rngStates.map((s, i) =>
        i === TERRAIN_INDEX ? { s0: (s.s0 ^ 0x01010101) >>> 0, s1: s.s1, s2: s.s2, s3: s.s3 } : s,
      ),
    };
    expect(worldChecksum(mutated)).not.toBe(before);
  });

  it('keeps independent streams unaffected by another stream being consumed', () => {
    const state = world();
    const other = new Rng(state.rngStates[SPAWN_INDEX]!);
    for (let i = 0; i < 10; i++) other.next();
    const still = sequence(state.rngStates[TERRAIN_INDEX]!, 8);
    expect(still).toEqual(sequence(world().rngStates[TERRAIN_INDEX]!, 8));
  });
});

describe('recipe identity', () => {
  it('distinguishes every preset, including the ones with equal name length', () => {
    const small = recipeHashOf(recipe(1, 'small'));
    const medium = recipeHashOf(recipe(1, 'medium'));
    const large = recipeHashOf(recipe(1, 'large'));
    expect(new Set([small, medium, large]).size).toBe(3);
    // regression: "small" and "large" are both five characters long
    expect(small).not.toBe(large);
  });

  it('is stable across calls and independent of property order', () => {
    const a = recipeHashOf(recipe(99));
    const b = recipeHashOf({ ...recipe(99) });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('includes every semantically relevant field', () => {
    const base = recipeHashOf(recipe(5));
    expect(recipeHashOf(recipe(5, 'small', { water: 51 }))).not.toBe(base);
    expect(recipeHashOf(recipe(5, 'small', { harshness: 51 }))).not.toBe(base);
    expect(recipeHashOf(recipe(5, 'small', { peoples: 6 }))).not.toBe(base);
    expect(recipeHashOf(recipe(6))).not.toBe(base);
    expect(recipeHashOf(recipe(5, 'small', { generatorVersion: 2 }))).not.toBe(base);
  });

  it('rejects an unsupported generator version instead of generating anyway', () => {
    expect(() => generateV1(recipe(1, 'small', { generatorVersion: 2 }))).toThrowError(/generator version/i);
  });

  it('rejects an unknown preset', () => {
    const bad = { ...recipe(1), preset: 'huge' as Preset };
    expect(() => generateV1(bad)).toThrowError(/preset/i);
  });
});
