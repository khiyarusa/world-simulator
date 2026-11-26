/**
 * Balance harness: the only honest way to know whether the world actually works (Stage 3, WP C).
 *
 * Runs the real generator and the real pipeline for N years on M deterministic seeds and reports what
 * happened. It never substitutes a summary for simulation and never clamps a result.
 */
import { generateV1 } from '../src/sim/world/generate.v1.ts';
import { runDay } from '../src/sim/systems/pipeline.ts';
import { worldChecksum } from '../src/sim/state/checksum.ts';
import { totalPopulation } from '../src/sim/society/living.ts';
import { populationOf } from '../src/sim/society/state.ts';
import { seedOf } from '../src/core/seed.ts';
import { EVENT_TYPE_NAMES } from '../src/sim/society/state.ts';
import type { Preset, WorldState } from '../src/sim/state/worldState.ts';

export interface SeedReport {
  seed: number;
  initialPopulation: number;
  finalPopulation: number;
  settlements: number;
  livingSettlements: number;
  civs: number;
  births: number;
  deaths: number;
  migrants: number;
  abandonments: number;
  foodProduced: number;
  foodConsumed: number;
  foodPerCapitaDays: number;
  avgHealth: number;
  avgStability: number;
  eventCount: number;
  eventsBySeverity: number[];
  topEvents: Array<[string, number]>;
  tickP50: number;
  tickP95: number;
  tickMax: number;
  invariantFailures: string[];
  checksum: string;
}

export interface BalanceReport {
  seeds: number;
  years: number;
  preset: Preset;
  elapsedMs: number;
  population: { min: number; median: number; max: number };
  failures: number;
  seedsDetail: SeedReport[];
}

export interface BalanceOptions {
  seeds: number;
  years: number;
  preset: Preset;
  peoples: number;
  onSeed?: (report: SeedReport) => void;
}

function pick(seedLo: number): number {
  return (seedLo * 2654435761 + 0x9e3779b9) >>> 0;
}

/** Yearly invariant audit. A world that keeps running but violates these is a failed simulation. */
function audit(state: WorldState, out: string[]): void {
  for (let i = 0; i < state.settlements.count; i++) {
    let sum = 0;
    for (let c = 0; c < 8; c++) sum += state.society.cohorts[i * 8 + c] ?? 0;
    if (sum !== populationOf(state.society, i)) out.push(`cohort sum mismatch at ${i}`);
    if ((state.settlements.pop[i] ?? 0) !== sum) out.push(`legacy population diverged at ${i}`);
    for (let r = 0; r < 6; r++) {
      const stock = state.society.stock[i * 6 + r] ?? 0;
      if (stock < 0) out.push(`negative stock ${r} at ${i}`);
      if (stock > (state.society.cap[i * 6 + r] ?? 0)) out.push(`stock ${r} over capacity at ${i}`);
    }
    if ((state.society.health[i] ?? 0) > 100) out.push(`health out of range at ${i}`);
  }
  if (out.length > 40) out.length = 40;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

export function runBalance(options: BalanceOptions): BalanceReport {
  const startedAt = performance.now();
  const detail: SeedReport[] = [];

  for (let s = 0; s < options.seeds; s++) {
    const seedLo = pick(s + 1);
    const state = generateV1({
      seed: seedOf(seedLo, 0x5eed),
      preset: options.preset,
      water: 50,
      harshness: 50,
      peoples: options.peoples,
      generatorVersion: 1,
    });

    const initialPopulation = totalPopulation(state);
    const failures: string[] = [];
    const samples: number[] = [];
    const startEvents = state.society.eventCount;
    const days = options.years * 360;

    for (let d = 0; d < days; d++) {
      const t0 = performance.now();
      runDay(state);
      samples.push(performance.now() - t0);
      if (d % 360 === 0) audit(state, failures);
      if (failures.length > 0) break;
    }

    samples.sort((a, b) => a - b);
    const living = countLiving(state);
    const foodDays = foodReserveDays(state);
    const hist = new Int32Array(6);
    const byType = new Map<string, number>();
    for (let k = 0; k < state.society.eventCount; k++) {
      hist[state.society.eventSeverity[k] ?? 0] = (hist[state.society.eventSeverity[k] ?? 0] ?? 0) + 1;
      const name = EVENT_TYPE_NAMES[state.society.eventType[k] ?? 0] ?? 'unknown';
      byType.set(name, (byType.get(name) ?? 0) + 1);
    }

    const report: SeedReport = {
      seed: seedLo,
      initialPopulation,
      finalPopulation: totalPopulation(state),
      settlements: state.settlements.count,
      livingSettlements: living,
      civs: state.civs.count,
      births: state.counters.births,
      deaths: state.counters.deaths,
      migrants: state.counters.migrants,
      abandonments: state.counters.abandonments,
      foodProduced: state.counters.foodProduced,
      foodConsumed: state.counters.foodConsumed,
      foodPerCapitaDays: foodDays,
      avgHealth: avg(state.society.health, state.settlements.count),
      avgStability: avg(state.society.stability, state.settlements.count),
      eventCount: state.society.eventCount - startEvents,
      eventsBySeverity: Array.from(hist),
      topEvents: [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      tickP50: round(percentile(samples, 0.5)),
      tickP95: round(percentile(samples, 0.95)),
      tickMax: round(samples[samples.length - 1] ?? 0),
      invariantFailures: failures,
      checksum: worldChecksum(state).toString(16),
    };
    detail.push(report);
    options.onSeed?.(report);
  }

  const pops = detail.map((d) => d.finalPopulation).sort((a, b) => a - b);
  return {
    seeds: options.seeds,
    years: options.years,
    preset: options.preset,
    elapsedMs: Math.round(performance.now() - startedAt),
    population: {
      min: pops[0] ?? 0,
      median: pops[Math.floor(pops.length / 2)] ?? 0,
      max: pops[pops.length - 1] ?? 0,
    },
    failures: detail.reduce((n, d) => n + d.invariantFailures.length, 0),
    seedsDetail: detail,
  };
}

function countLiving(state: WorldState): number {
  let n = 0;
  for (let i = 0; i < state.settlements.count; i++) {
    if (((state.society.flags[i] ?? 0) & 1) === 0 && populationOf(state.society, i) > 0) n++;
  }
  return n;
}

function foodReserveDays(state: WorldState): number {
  let pop = 0;
  let food = 0;
  for (let i = 0; i < state.settlements.count; i++) {
    if (((state.society.flags[i] ?? 0) & 1) !== 0) continue;
    pop += populationOf(state.society, i);
    food += state.society.stock[i * 6] ?? 0;
  }
  return pop > 0 ? Math.round(food / pop) : 0;
}

function avg(arr: Uint8Array, count: number): number {
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += arr[i] ?? 0;
  return Math.round(sum / count);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
