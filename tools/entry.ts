/**
 * Headless tooling entry (bundled by vite.tools.config.ts, run by Node in CI only).
 *
 * Modes:
 *   golden       write/refresh tests/fixtures/golden/worlds.json
 *   determinism  print per-seed checksums (compared across two processes by CI)
 *   bench        tick-time distribution for the perf budget
 *
 * This file is the only place that touches the filesystem or argv: the simulation itself stays
 * pure (AGENTS.md R-10/R-15).
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { generateV1 } from '../src/sim/world/generate.v1.ts';
import { runDay } from '../src/sim/systems/pipeline.ts';
import { gridsChecksum, worldChecksum } from '../src/sim/state/checksum.ts';
import { auditHydrology } from '../src/sim/world/hydrologyCheck.ts';
import { runBalance } from './balance.ts';
import { seedOf } from '../src/core/seed.ts';
import type { Preset, WorldRecipe } from '../src/sim/state/worldState.ts';

const GOLDEN_PATH = resolve('tests/fixtures/golden/worlds.json');

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function recipeFor(seedLo: number, preset: Preset, peoples = 6): WorldRecipe {
  return {
    seed: seedOf(seedLo, (seedLo ^ 0x9e3779b9) >>> 0),
    preset,
    water: 50,
    harshness: 50,
    peoples,
    generatorVersion: 1,
  };
}

function hashOf(seedLo: number, preset: Preset): { seed: string; preset: string; gridsHash: string; hash: string; land: number } {
  const state = generateV1(recipeFor(seedLo, preset));
  const gridsHash = gridsChecksum(state).toString(16).padStart(8, '0');
  const hash = `${worldChecksum(state).toString(16).padStart(8, '0')}:${gridsHash}`;
  return { seed: seedLo.toString(), preset, gridsHash, hash, land: state.report.landFraction };
}

const SEEDS = [1, 7, 42, 1337, 90210];

function golden(): void {
  const worlds = [];
  for (const preset of ['small', 'medium', 'large'] as const) {
    for (const seed of SEEDS) worlds.push(hashOf(seed, preset));
  }
  const payload = {
    generatorVersion: 1,
    note:
      'World *content* contract (grid bytes + land fraction). Regenerate with `npm run golden` only when ' +
      'generator content legitimately changes; record why. worldChecksum is the separate integrity contract ' +
      'and is mutation-tested in tests/determinism/recipe-rng.test.ts.',
    worlds: worlds.map(({ seed, preset, gridsHash, land }) => ({ seed, preset, gridsHash, land })),
  };
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`wrote ${worlds.length} golden worlds to ${GOLDEN_PATH}`);
}

function determinism(): void {
  const seeds = Number(arg('seeds', '40'));
  const presets = arg('presets', 'small,medium,large').split(',') as Preset[];
  const out = [];
  const started = performance.now();
  for (const preset of presets) {
    for (let i = 0; i < seeds; i++) {
      out.push(hashOf(i * 2654435761 + 11, preset));
    }
  }
  const elapsed = Math.round(performance.now() - started);
  console.log(JSON.stringify({ generatorVersion: 1, seeds, presets, elapsedMs: elapsed, worlds: out }));
}

function bench(): void {
  const preset = arg('preset', 'medium') as Preset;
  const years = Number(arg('years', '50'));
  const speeds = arg('speeds', '1,2,4,8')
    .split(',')
    .map(Number);
  const state = generateV1(recipeFor(12345, preset));
  const dayTicks = Math.round(years * 360);
  const samples: number[] = [];
  let worst = 0;
  // Warm up before measuring: the first ticks pay JIT and one-off allocations. Run with
  // --expose-gc so the delta is live heap, not compiler metadata.
  const gc = (globalThis as { gc?: () => void }).gc;
  for (let i = 0; i < 2000; i++) runDay(state);
  gc?.();
  const heapStart = process.memoryUsage().heapUsed;
  for (let i = 0; i < dayTicks; i++) {
    const t0 = performance.now();
    runDay(state);
    const dt = performance.now() - t0;
    samples.push(dt);
    if (dt > worst) worst = dt;
  }
  gc?.();
  const heapEnd = process.memoryUsage().heapUsed;
  samples.sort((a, b) => a - b);
  const at = (p: number): number => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] ?? 0;
  console.log(
    JSON.stringify({
      preset,
      years,
      days: dayTicks,
      speeds,
      day1x: { p50: round(at(0.5)), p95: round(at(0.95)), max: round(worst) },
      heapGrowthBytes: heapEnd - heapStart,
      heapGrowthPer10kTicks: round(((heapEnd - heapStart) / Math.max(1, dayTicks)) * 10_000),
    }),
  );
}

/**
 * Hydrology audit statistics. Prints, per preset, how rivers actually terminate, so the report can
 * state measured facts instead of "rivers are validated".
 */
function hydro(): void {
  const rows = [];
  for (const preset of ['small', 'medium', 'large'] as const) {
    for (const seed of [1, 2024, 90210]) {
      const world = generateV1(recipeFor(seed, preset));
      const report = auditHydrology(world.grids.elevation, world.width, world.height, world.seaLevel);
      rows.push({ preset, seed, ...report.audit, issues: report.issues });
    }
  }
  const issues = rows.reduce((sum, r) => sum + r.issues.length, 0);
  console.log(JSON.stringify({ worlds: rows.length, issues, rows }));
}

/**
 * Balance harness entry. `--seeds`, `--years`, `--preset`, `--out`.
 * The JSON is the evidence; the text summary is for a human reading the job log.
 */
function balance(): void {
  const seeds = Number(arg('seeds', '20'));
  const years = Number(arg('years', '400'));
  const preset = arg('preset', 'medium') as Preset;
  const out = arg('out', '');
  const report = runBalance({ seeds, years, preset, peoples: 6 });
  const json = JSON.stringify(report, null, 2);
  if (out) writeFileSync(out, `${json}\n`, 'utf8');
  console.log(json);
  const failures = report.seedsDetail.filter((s) => s.invariantFailures.length > 0);
  console.log(
    `\nbalance: ${report.seeds} seeds x ${report.years}y in ${report.elapsedMs}ms | ` +
      `population min ${report.population.min} median ${report.population.median} max ${report.population.max} | ` +
      `invariant failures ${report.failures} | seeds with failures ${failures.length}`,
  );
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

const mode = process.argv[2] ?? 'help';
if (mode === 'golden') golden();
else if (mode === 'determinism') determinism();
else if (mode === 'bench') bench();
else if (mode === 'hydro') hydro();
else if (mode === 'balance') balance();
else {
  console.log('usage: tools.js <golden|determinism|bench|hydro|balance> [--seeds=20] [--years=400] [--preset=medium] [--out=file]');
  if (!existsSync(GOLDEN_PATH)) console.log(`golden fixture missing at ${GOLDEN_PATH}`);
}
