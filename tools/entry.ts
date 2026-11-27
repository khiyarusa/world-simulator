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
import { validateWorld } from '../src/sim/state/checksum.ts';
import { validateSociety } from '../src/sim/society/validate.ts';
import { startCampaign, beginStewardship } from '../src/sim/campaign/run.ts';
import { issueCharter } from '../src/sim/campaign/charters.ts';
import { acceptObjective } from '../src/sim/campaign/objectives.ts';
import { applyIntervention, blessMaxAmount } from '../src/sim/society/interventions.ts';
import { OBJECTIVE_STATE, activeCharterCount, charterSlots, LEGACY } from '../src/sim/campaign/types.ts';
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
async function balance(): Promise<void> {
  const seeds = Number(arg('seeds', '20'));
  const years = Number(arg('years', '400'));
  const preset = arg('preset', 'medium') as Preset;
  const out = arg('out', '');
  const report = await runBalance({ seeds, years, preset, peoples: 6, intervention: false });
  const json = JSON.stringify(report, null, 2);
  if (out) writeFileSync(out, `${json}\n`, 'utf8');
  console.log(json);
  const failures = report.seedsDetail.filter((s) => s.invariantFailures.length > 0);
  console.log(
    `\nbalance: ${report.seeds} seeds x ${report.years}y in ${report.elapsedMs}ms (no input) + ` +
      `${report.interventionReport?.elapsedMs ?? 0}ms (blight) | ` +
      `population min ${report.population.min} median ${report.population.median} max ${report.population.max} | ` +
      `invariant failures ${report.failures} | seeds with failures ${failures.length}`,
  );
  for (const [arc, hits] of Object.entries(report.arcHits)) console.log(`arc ${arc}: ${hits}/${report.seeds}`);
  for (const [arc, hits] of Object.entries(report.interventionReport?.arcHits ?? {})) {
    console.log(`arc(blight) ${arc}: ${hits}/${report.seeds}`);
  }
  const inBand = report.seedsDetail.filter((s) => s.finalPopulation >= 150_000 && s.finalPopulation <= 800_000).length;
  const saves = report.seedsDetail.map((s) => s.saveBytesRaw).sort((a, b) => a - b);
  const p95 = report.seedsDetail.map((s) => s.tickP95).sort((a, b) => a - b);
  console.log(`in band 150k-800k: ${inBand}/${report.seeds}`);
  console.log(`save raw median ${Math.round((saves[Math.floor(saves.length / 2)] ?? 0) / 1024)} KiB, max ${Math.round((saves[saves.length - 1] ?? 0) / 1024)} KiB`);
  console.log(`tick p95 median ${p95[Math.floor(p95.length / 2)] ?? 0} ms, max ${p95[p95.length - 1] ?? 0} ms`);
  const wars = report.seedsDetail.reduce((n, s) => n + s.warSamples.length, 0);
  console.log(`wars sampled ${wars}, all gates pass: ${report.seedsDetail.every((s) => s.warSamples.every((w) => w.gatePass))}`);
}

/** A scripted steward journey: the campaign must offer, accept and act, not just exist. */
async function campaign(): Promise<void> {
  const seeds = Number(arg('seeds', '3'));
  const years = Number(arg('years', '50'));
  const preset = arg('preset', 'medium') as Preset;
  const out = arg('out', '');
  const rows = [];
  const started = performance.now();
  const charterOrder = [1, 2, 6, 3, 4, 5];
  let charterIndex = 0;
  for (let s = 0; s < seeds; s++) {
    const seed = s * 2654435761 + 90210;
    const world = generateV1(recipeFor(seed, preset));
    const failures: string[] = [];
    if (!startCampaign(world, LEGACY.HAVEN)) failures.push('campaign did not start');
    if (!beginStewardship(world, 0).ok) failures.push('steward did not begin');
    let offered = 0;
    let completed = 0;
    let failed = 0;
    let accepted = 0;
    for (let d = 0; d < years * 360; d++) {
      runDay(world);
      if (world.day % 30 === 0) {
        let active = 0;
        for (let i = 0; i < world.campaign.objectiveCount; i++) {
          if ((world.campaign.objState[i] ?? 0) === OBJECTIVE_STATE.ACTIVE) active++;
        }
        if (active < 2) {
          for (let i = 0; i < world.campaign.objectiveCount; i++) {
            if ((world.campaign.objState[i] ?? 0) !== OBJECTIVE_STATE.OFFERED) continue;
            const kind = world.campaign.objKind[i] ?? 0;
            const target = world.campaign.objTarget[i] ?? 0;
            const result = acceptObjective(world, world.day, world.campaign.objId[i] ?? 0);
            if (!result.ok) continue;
            accepted++;
            // A scripted steward uses the real powers it has: food for hunger, care for the soil.
            if (kind === 1) {
              const max = blessMaxAmount(world, target, 0);
              if (max > 0) applyIntervention(world, { op: 'bless', settlement: target, resource: 0, amount: Math.min(max, 8) });
            } else if (kind === 4) {
              applyIntervention(world, { op: 'fertilize', settlement: target, intensity: 2 });
            }
            break;
          }
        }
      }
      if (world.day % (5 * 360) === 0) {
        const active = activeCharterCount(world.campaign, world.day);
        if (active < charterSlots(world.campaign)) {
          for (let civ = 0; civ < world.civs.count; civ++) {
            const has = world.campaign.charterCount;
            let occupied = false;
            for (let c = 0; c < has; c++) {
              if ((world.campaign.chCiv[c] ?? 255) === civ && (world.campaign.chEnd[c] ?? 0) > world.day) occupied = true;
            }
            if (occupied) continue;
            const kind = charterOrder[charterIndex++ % charterOrder.length] ?? 1;
            issueCharter(world, world.day, civ, kind, false);
            break;
          }
        }
      }
    }
    for (let i = 0; i < world.campaign.objectiveCount; i++) {
      const st = world.campaign.objState[i] ?? 0;
      if (st !== OBJECTIVE_STATE.FREE) offered++;
      if (st === OBJECTIVE_STATE.COMPLETE) completed++;
      if (st === OBJECTIVE_STATE.FAILED) failed++;
    }
    try {
      validateSociety(world, world.society);
      failures.push(...validateWorld(world));
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
    const milestones = world.campaign.milestoneDone.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
    const holds = world.campaign.milestoneHold.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
    rows.push({
      seed,
      years,
      preset,
      population: world.settlements.pop.reduce((n, v, i) => n + (i < world.settlements.count ? v : 0), 0),
      settlements: world.settlements.count,
      civs: world.civs.count,
      legacy: world.campaign.legacy,
      era: world.campaign.era,
      milestones,
      holds,
      seals: world.campaign.seals,
      objectivesOffered: offered,
      objectivesAccepted: accepted,
      objectivesCompleted: completed,
      objectivesFailed: failed,
      chartersIssued: world.campaign.charterCount,
      activeCharters: activeCharterCount(world.campaign, world.day),
      completedCampaign: world.campaign.completed,
      invariantFailures: failures,
    });
  }
  const report = {
    seeds,
    years,
    preset,
    elapsedMs: Math.round(performance.now() - started),
    failures: rows.reduce((n, r) => n + r.invariantFailures.length, 0),
    rows,
  };
  const json = JSON.stringify(report, null, 2);
  if (out) writeFileSync(out, `${json}\n`, 'utf8');
  console.log(json);
  console.log(
    `campaign: ${seeds} seeds x ${years}y | offers ${rows.reduce((n, r) => n + r.objectivesOffered, 0)} | ` +
      `accepted ${rows.reduce((n, r) => n + r.objectivesAccepted, 0)} | ` +
      `completed ${rows.reduce((n, r) => n + r.objectivesCompleted, 0)} | ` +
      `milestones ${rows.reduce((n, r) => n + r.milestones, 0)} | failures ${report.failures}`,
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
else if (mode === 'balance') await balance();
else if (mode === 'campaign') await campaign();
else {
  console.log('usage: tools.js <golden|determinism|bench|hydro|balance|campaign> [--seeds=20] [--years=400] [--preset=medium] [--out=file]');
  if (!existsSync(GOLDEN_PATH)) console.log(`golden fixture missing at ${GOLDEN_PATH}`);
}
