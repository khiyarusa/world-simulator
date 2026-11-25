/**
 * Golden world regression (docs/WORLD_GENERATION.md §10.4).
 *
 * The fixture is the contract: if world content changes, this test fails and the only legitimate
 * fixes are (a) revert the change or (b) bump generatorVersion and re-generate the fixture with a
 * reviewed diff. Running `npm run golden` rewrites it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { gridsChecksum, worldChecksum } from '../../src/sim/state/checksum.ts';
import { seedOf } from '../../src/core/seed.ts';
import type { Preset } from '../../src/sim/state/worldState.ts';

const FIXTURE = resolve('tests/fixtures/golden/worlds.json');
const SEEDS = [1, 7, 42, 1337, 90210];
const PRESETS: readonly Preset[] = ['small', 'medium', 'large'];

interface GoldenEntry {
  seed: string;
  preset: string;
  hash: string;
  land: number;
}

interface GoldenFile {
  generatorVersion: number;
  worlds: GoldenEntry[];
}

function compute(): GoldenEntry[] {
  const out: GoldenEntry[] = [];
  for (const preset of PRESETS) {
    for (const seed of SEEDS) {
      const state = generateV1({
        seed: seedOf(seed, (seed ^ 0x9e3779b9) >>> 0),
        preset,
        water: 50,
        harshness: 50,
        peoples: 6,
        generatorVersion: 1,
      });
      out.push({
        seed: seed.toString(),
        preset,
        hash: `${worldChecksum(state).toString(16).padStart(8, '0')}:${gridsChecksum(state).toString(16).padStart(8, '0')}`,
        land: state.report.landFraction,
      });
    }
  }
  return out;
}

describe('golden worlds', () => {
  it('reproduces every committed world hash', () => {
    const actual = compute();

    if (!existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      const payload: GoldenFile = { generatorVersion: 1, worlds: actual };
      writeFileSync(FIXTURE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      throw new Error(
        `golden fixture was missing and has been written to ${FIXTURE}. Commit it, then re-run: ` +
          'a missing fixture must never be silently accepted.',
      );
    }

    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as GoldenFile;
    expect(fixture.generatorVersion).toBe(1);
    expect(fixture.worlds).toHaveLength(SEEDS.length * PRESETS.length);

    const byKey = new Map(fixture.worlds.map((w) => [`${w.preset}/${w.seed}`, w]));
    for (const entry of actual) {
      const expected = byKey.get(`${entry.preset}/${entry.seed}`);
      expect(expected, `no fixture for ${entry.preset}/${entry.seed}`).toBeDefined();
      expect(expected?.hash, `world content changed for ${entry.preset}/${entry.seed}`).toBe(entry.hash);
      expect(expected?.land).toBe(entry.land);
    }
  });
});
