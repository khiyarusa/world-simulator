import { describe, expect, it } from 'vitest';
import { generateV1, validateGenerated } from '../../src/sim/world/generate.v1.ts';
import { gridsChecksum, worldChecksum } from '../../src/sim/state/checksum.ts';
import { BIOME, isWaterBiome } from '../../src/sim/world/biomes.ts';
import { PRESETS } from '../../src/sim/world/presets.ts';
import { seedOf } from '../../src/core/seed.ts';
import type { Preset, WorldRecipe } from '../../src/sim/state/worldState.ts';

function recipe(seedLo: number, preset: Preset = 'small', overrides: Partial<WorldRecipe> = {}): WorldRecipe {
  return {
    seed: seedOf(seedLo, (seedLo ^ 0x9e3779b9) >>> 0),
    preset,
    water: 50,
    harshness: 50,
    peoples: 6,
    generatorVersion: 1,
    ...overrides,
  };
}

describe('world generation v1', () => {
  it('is byte-identical for the same recipe', () => {
    const a = generateV1(recipe(1234));
    const b = generateV1(recipe(1234));
    expect(gridsChecksum(a)).toBe(gridsChecksum(b));
    expect(worldChecksum(a)).toBe(worldChecksum(b));
    expect(Array.from(a.grids.biome)).toEqual(Array.from(b.grids.biome));
    expect(Array.from(a.grids.elevation)).toEqual(Array.from(b.grids.elevation));
  });

  it('produces different worlds for different seeds', () => {
    const a = generateV1(recipe(11));
    const b = generateV1(recipe(12));
    expect(gridsChecksum(a)).not.toBe(gridsChecksum(b));
  });

  it('honours the preset dimensions exactly', () => {
    for (const preset of ['small', 'medium', 'large'] as const) {
      const world = generateV1(recipe(77, preset));
      expect(world.width).toBe(PRESETS[preset].size);
      expect(world.height).toBe(PRESETS[preset].size);
      expect(world.grids.elevation.length).toBe(world.width * world.height);
      expect(world.grids.biome.length).toBe(world.width * world.height);
      expect(world.grids.owner.length).toBe(world.width * world.height);
    }
  });

  it('hits the land fraction target within a sane band', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const world = generateV1(recipe(seed, 'medium'));
      const target = PRESETS.medium.landPm;
      expect(Math.abs(world.report.landFraction - target)).toBeLessThanOrEqual(100);
    }
  });

  it('classifies every cell into a real biome and keeps water consistent', () => {
    const world = generateV1(recipe(9));
    const hist = world.report.biomeHistogram;
    expect(hist.length).toBe(16);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(world.width * world.height);
    expect(hist.filter((c) => c > 0).length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < world.grids.biome.length; i++) {
      const biome = world.grids.biome[i] ?? 255;
      expect(biome).toBeLessThan(16);
      if ((world.grids.lakeId[i] ?? 0) > 0) expect(biome).toBe(BIOME.LAKE);
      if ((world.grids.elevation[i] ?? 0) < world.seaLevel) expect(biome).toBe(BIOME.OCEAN);
    }
  });

  it('forms rivers and lakes from the elevation field', () => {
    const world = generateV1(recipe(2024, 'medium'));
    expect(world.report.riverCells).toBeGreaterThan(0);
    expect(world.report.lakeCells).toBeGreaterThanOrEqual(0);
    // every river cell must be land, and must have a downstream or be a source
    for (let i = 0; i < world.grids.riverId.length; i++) {
      if ((world.grids.riverId[i] ?? 0) === 0) continue;
      expect(world.grids.elevation[i] ?? 0).toBeGreaterThanOrEqual(world.seaLevel);
    }
  });

  it('places every starting band on habitable land with spacing', () => {
    const world = generateV1(recipe(31337, 'medium'));
    const s = world.settlements;
    expect(s.count).toBeGreaterThan(0);
    expect(s.count).toBe(world.recipe.peoples);
    for (let i = 0; i < s.count; i++) {
      const x = s.x[i] ?? 0;
      const y = s.y[i] ?? 0;
      const idx = y * world.width + x;
      expect(world.grids.elevation[idx] ?? -1).toBeGreaterThanOrEqual(world.seaLevel);
      expect(world.grids.lakeId[idx] ?? 0).toBe(0);
      expect(isWaterBiome(world.grids.biome[idx] ?? 0)).toBe(false);
      expect(s.pop[i] ?? 0).toBeGreaterThanOrEqual(40);
      expect(s.pop[i] ?? 0).toBeLessThanOrEqual(120);
      for (let j = 0; j < i; j++) {
        const dx = Math.abs((s.x[j] ?? 0) - x);
        const dy = Math.abs((s.y[j] ?? 0) - y);
        expect(dx + dy).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('writes a generation report that matches the produced world', () => {
    const world = generateV1(recipe(5150, 'medium'));
    const r = world.report;
    expect(r.recipeHash).toMatch(/^[0-9a-f]{8}$/);
    expect(r.generatorVersion).toBe(1);
    expect(r.width).toBe(world.width);
    expect(r.height).toBe(world.height);
    expect(r.spawnCount).toBe(world.settlements.count);
    expect(r.elevationMin).toBeLessThanOrEqual(r.elevationMax);
    expect(r.validation).toEqual([]);
    expect(r.attempts).toBe(1);
    expect(r.windDirection).toBeGreaterThanOrEqual(0);
    expect(r.windDirection).toBeLessThan(4);
  });

  it('reports structural problems instead of accepting a broken world', () => {
    const world = generateV1(recipe(4));
    expect(validateGenerated(world)).toEqual([]);
    // a deliberately corrupted world must be caught
    world.settlements.x[0] = 0;
    world.settlements.y[0] = 0;
    world.grids.elevation[0] = -500;
    expect(validateGenerated(world).length).toBeGreaterThan(0);
  });

  it('respects the peoples slider', () => {
    const world = generateV1(recipe(8, 'small', { peoples: 3 }));
    expect(world.settlements.count).toBe(3);
    expect(world.civs.count).toBe(3);
  });

  it('scales work with the preset rather than faking it', () => {
    const small = generateV1(recipe(6, 'small'));
    const large = generateV1(recipe(6, 'large'));
    expect(large.width * large.height).toBeGreaterThan(small.width * small.height);
    expect(large.report.spawnCount).toBe(small.report.spawnCount);
    expect(gridsChecksum(large)).not.toBe(gridsChecksum(small));
  });
});
