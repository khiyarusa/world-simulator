/**
 * Balance harness: the only honest way to know whether the world actually works (Stage 3, WP C).
 *
 * Runs the real generator and the real pipeline for N years on M deterministic seeds and reports what
 * happened. It never substitutes a summary for simulation and never clamps a result. Every acceptance
 * number in docs/STAGE_3_REPORT.md comes from this file's JSON, not from a hand-written table.
 */
import { generateV1 } from '../src/sim/world/generate.v1.ts';
import { runDay } from '../src/sim/systems/pipeline.ts';
import { worldChecksum } from '../src/sim/state/checksum.ts';
import { totalPopulation } from '../src/sim/society/living.ts';
import { populationOf, EVENT_TYPE_NAMES, EVENT_CAPACITY, CIV_STRIDE } from '../src/sim/society/state.ts';
import { auditSociety } from '../src/sim/society/audit.ts';
import { applyBlight } from '../src/sim/society/ecology.ts';
import { seedOf } from '../src/core/seed.ts';
import { captureWorld } from '../src/worker/snapshot.ts';
import { encodeSnapshot } from '../src/worker/serialize.ts';
import { detectArcs, type ArcEvent, type ArcResult, type ArcTrace, type ArcYear } from './arcs.ts';
import type { Preset, WorldState } from '../src/sim/state/worldState.ts';

export interface WarSample {
  a: number;
  b: number;
  day: number;
  strength: number;
  grievance: number;
  capacity: number;
  utility: number;
  gatePass: boolean;
}

export interface SeedReport {
  seed: number;
  preset: Preset;
  generatorVersion: number;
  initialPopulation: number;
  finalPopulation: number;
  peakPopulation: number;
  settlementsStart: number;
  settlementsEnd: number;
  livingSettlements: number;
  tierHistogram: number[];
  civs: number;
  civPopulation: number[];
  births: number;
  deaths: number;
  starvationDeaths: number;
  epidemicDeaths: number;
  warDeaths: number;
  migrants: number;
  abandonments: number;
  foundings: number;
  civFormed: number;
  foodProduced: number;
  foodConsumed: number;
  foodDaysStart: number;
  foodDaysEnd: number;
  healthAvg: number;
  stabilityAvg: number;
  vegetationStart: number;
  vegetationEnd: number;
  fertilityStart: number;
  fertilityEnd: number;
  droughtEvents: number;
  floodEvents: number;
  wildfireEvents: number;
  epidemicEvents: number;
  famineEvents: number;
  routesOpened: number;
  routesLost: number;
  routesEnd: number;
  tradeVolume: number;
  transfers: number;
  treatiesSigned: number;
  treatiesEnd: number;
  warsDeclared: number;
  warsEnded: number;
  techDiscovered: number;
  techsKnown: number;
  culture: number[];
  eventCount: number;
  eventsBySeverity: number[];
  eventsByType: [string, number][];
  causeFailures: number;
  conservationFailures: number;
  invariantFailures: string[];
  warSamples: WarSample[];
  tickP50: number;
  tickP95: number;
  tickMax: number;
  heapStartMb: number;
  heapEndMb: number;
  saveBytesRaw: number;
  saveBytesCompressed: number;
  saveMs: number;
  checksum: string;
  arcs: ArcResult[];
}

export interface BalanceReport {
  seeds: number;
  years: number;
  preset: Preset;
  intervention: boolean;
  elapsedMs: number;
  population: { min: number; median: number; max: number };
  failures: number;
  arcHits: Record<string, number>;
  seedsDetail: SeedReport[];
  interventionReport?: BalanceReport;
}

export interface BalanceOptions {
  seeds: number;
  years: number;
  preset: Preset;
  peoples: number;
  intervention: boolean;
  onSeed?: (report: SeedReport) => void;
}

function pick(seedLo: number): number {
  return (seedLo * 2654435761 + 0x9e3779b9) >>> 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function heapMb(): number {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') return 0;
  return Math.round(process.memoryUsage().heapUsed / 1048576);
}

function gridSum(world: WorldState, key: 'vegetation' | 'fertility'): number {
  let sum = 0;
  const grid = world.grids[key];
  for (let i = 0; i < grid.length; i++) sum += grid[i] ?? 0;
  return sum;
}

function avgOf(values: Uint8Array, count: number): number {
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += values[i] ?? 0;
  return Math.floor(sum / count);
}

function foodDays(world: WorldState): number {
  let pop = 0;
  let food = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if (((world.society.flags[i] ?? 0) & 1) !== 0) continue;
    pop += populationOf(world.society, i);
    food += world.society.stock[i * 6] ?? 0;
  }
  return pop > 0 ? Math.floor(food / pop) : 0;
}

/** Append every event emitted since `lastId` (oldest first) to `out`. */
function collectEvents(world: WorldState, lastId: number, out: ArcEvent[]): number {
  const soc = world.society;
  let newest = lastId;
  const temp: ArcEvent[] = [];
  let index = (soc.eventHead - 1 + EVENT_CAPACITY) % EVENT_CAPACITY;
  for (let guard = 0; guard < EVENT_CAPACITY; guard++) {
    const id = soc.eventId[index] ?? 0;
    if (id <= lastId) break;
    temp.push({
      id,
      day: soc.eventDay[index] ?? 0,
      type: EVENT_TYPE_NAMES[soc.eventType[index] ?? 0] ?? 'unknown',
      severity: soc.eventSeverity[index] ?? 0,
      place: soc.eventPlace[index] ?? 0,
      actorA: soc.eventActorA[index] ?? 0,
      actorB: soc.eventActorB[index] ?? 0,
      magnitude: soc.eventMagnitude[index] ?? 0,
      cause: soc.eventCause[index] ?? 0,
    });
    if (id > newest) newest = id;
    index = (index - 1 + EVENT_CAPACITY) % EVENT_CAPACITY;
  }
  for (let i = temp.length - 1; i >= 0; i--) out.push(temp[i]!);
  return newest;
}

function sampleYear(world: WorldState, year: number, routes: number): ArcYear {
  const civPopulation = new Array<number>(CIV_STRIDE).fill(0);
  const civRoutes = new Array<number>(CIV_STRIDE).fill(0);
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    const civ = s.civ[i] ?? 0;
    if (civ < CIV_STRIDE) civPopulation[civ] = (civPopulation[civ] ?? 0) + populationOf(world.society, i);
  }
  for (let k = 0; k < world.society.routeCount; k++) {
    const a = s.civ[world.society.routeA[k] ?? 0] ?? 0;
    const b = s.civ[world.society.routeB[k] ?? 0] ?? 0;
    if (a < CIV_STRIDE) civRoutes[a] = (civRoutes[a] ?? 0) + 1;
    if (b < CIV_STRIDE) civRoutes[b] = (civRoutes[b] ?? 0) + 1;
  }
  let living = 0;
  for (let i = 0; i < s.count; i++) if (((world.society.flags[i] ?? 0) & 1) === 0 && populationOf(world.society, i) > 0) living++;
  return {
    year,
    population: totalPopulation(world),
    settlements: living,
    foodDays: foodDays(world),
    routes,
    wars: world.society.warCount,
    health: avgOf(world.society.health, s.count),
    stability: avgOf(world.society.stability, s.count),
    civPopulation,
    civRoutes,
  };
}

async function runSeed(seedLo: number, options: BalanceOptions): Promise<SeedReport> {
  const state = generateV1({
    seed: seedOf(seedLo, 0x5eed),
    preset: options.preset,
    water: 50,
    harshness: 50,
    peoples: options.peoples,
    generatorVersion: 1,
  });
  const initialPopulation = totalPopulation(state);
  const settlementsStart = state.settlements.count;
  const vegetationStart = gridSum(state, 'vegetation');
  const fertilityStart = gridSum(state, 'fertility');
  const foodDaysStart = foodDays(state);
  const heapStartMb = heapMb();

  const failures: string[] = [];
  const samples: number[] = [];
  const events: ArcEvent[] = [];
  const years: ArcYear[] = [];
  const warSamples: WarSample[] = [];
  let lastEventId = 0;
  let prevWarCount = 0;
  let saveBytesRaw = 0;
  let saveBytesCompressed = 0;
  let saveMs = 0;
  let blightDay = 0;
  let blightCiv = -1;
  const days = options.years * 360;
  const interventionYear = Math.min(150, Math.max(10, Math.floor(options.years / 2)));

  for (let d = 1; d <= days; d++) {
    const t0 = performance.now();
    runDay(state);
    samples.push(performance.now() - t0);

    const soc = state.society;
    if (soc.warCount > prevWarCount) {
      for (let k = prevWarCount; k < soc.warCount; k++) {
        warSamples.push({
          a: soc.warA[k] ?? 0,
          b: soc.warB[k] ?? 0,
          day: soc.warStart[k] ?? 0,
          strength: soc.warGateStrength[k] ?? 0,
          grievance: soc.warGateGrievance[k] ?? 0,
          capacity: soc.warGateCapacity[k] ?? 0,
          utility: soc.warGateUtility[k] ?? 0,
          gatePass:
            (soc.warGateStrength[k] ?? 0) >= 1250 &&
            (soc.warGateGrievance[k] ?? 0) >= 40 &&
            (soc.warGateCapacity[k] ?? 0) >= 90 &&
            (soc.warGateUtility[k] ?? 0) >= 50,
        });
      }
    }
    prevWarCount = soc.warCount;

    if (d % 30 === 0) {
      const audit = auditSociety(state, {
        expectedPopulation: initialPopulation + state.counters.births - state.counters.deaths,
        full: d % 360 === 0,
      });
      for (const failure of audit) if (failures.length < 40) failures.push(`day ${d}: ${failure}`);
    }

    if (d === 200 * 360) {
      const t1 = performance.now();
      const shards = await encodeSnapshot(captureWorld(state));
      saveMs = round(performance.now() - t1);
      saveBytesRaw = shards.reduce((n, shard) => n + shard.bytes, 0);
      saveBytesCompressed = shards.reduce((n, shard) => n + shard.payload.byteLength, 0);
    }

    if (d % 360 === 0) {
      lastEventId = collectEvents(state, lastEventId, events);
      years.push(sampleYear(state, d / 360, state.society.routeCount));
      if (options.intervention && d === interventionYear * 360) {
        let capital = 0;
        let best = -1;
        for (let i = 0; i < state.settlements.count; i++) {
          const pop = populationOf(state.society, i);
          if (pop > best) {
            best = pop;
            capital = i;
          }
        }
        blightDay = d;
        blightCiv = state.settlements.civ[capital] ?? 0;
        applyBlight(state, capital, d);
      }
    }
  }

  samples.sort((a, b) => a - b);
  collectEvents(state, lastEventId, events);

  const soc = state.society;
  const eventsBySeverity = new Array<number>(6).fill(0);
  const byType = new Map<string, number>();
  let causeFailures = 0;
  const ids = new Set<number>();
  for (const e of events) ids.add(e.id);
  for (const e of events) {
    eventsBySeverity[e.severity] = (eventsBySeverity[e.severity] ?? 0) + 1;
    byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    if (e.severity >= 4) {
      // a severe event needs a real ancestor or the explicit root marker (-1)
      if (e.cause !== -1 && e.cause !== 0 && !ids.has(e.cause)) causeFailures++;
    }
  }
  const tierHistogram = new Array<number>(5).fill(0);
  for (let i = 0; i < state.settlements.count; i++) {
    if (((soc.flags[i] ?? 0) & 1) !== 0) continue;
    const tier = state.settlements.tier[i] ?? 0;
    tierHistogram[tier] = (tierHistogram[tier] ?? 0) + 1;
  }
  const civPopulation = new Array<number>(CIV_STRIDE).fill(0);
  for (let i = 0; i < state.settlements.count; i++) {
    const civ = state.settlements.civ[i] ?? 0;
    if (civ < CIV_STRIDE) civPopulation[civ] = (civPopulation[civ] ?? 0) + populationOf(soc, i);
  }
  const cultureSum = [0, 0, 0];
  for (let civ = 0; civ < state.civs.count; civ++) {
    for (let axis = 0; axis < 3; axis++) cultureSum[axis] = (cultureSum[axis] ?? 0) + (soc.culture[civ * 3 + axis] ?? 0);
  }
  const culture = state.civs.count > 0 ? cultureSum.map((v) => Math.round(v / state.civs.count)) : [0, 0, 0];
  let techsKnown = 0;
  for (let civ = 0; civ < state.civs.count; civ++) {
    for (let t = 0; t < 12; t++) techsKnown += soc.tech[civ * 12 + t] ?? 0;
  }

  const conservationFailures = failures.filter((f) => f.includes('population identity')).length;
  const trace: ArcTrace = { years, events, blightDay, blightCiv };
  const arcs = detectArcs(trace);
  const population = totalPopulation(state);
  const peakPopulation = years.reduce((max, y) => (y.population > max ? y.population : max), initialPopulation);

  return {
    seed: seedLo,
    preset: options.preset,
    generatorVersion: 1,
    initialPopulation,
    finalPopulation: population,
    peakPopulation,
    settlementsStart,
    settlementsEnd: state.settlements.count,
    livingSettlements: years.length > 0 ? years[years.length - 1]!.settlements : state.settlements.count,
    tierHistogram,
    civs: state.civs.count,
    civPopulation,
    births: state.counters.births,
    deaths: state.counters.deaths,
    starvationDeaths: state.counters.starvationDeaths,
    epidemicDeaths: state.counters.epidemicDeaths,
    warDeaths: state.counters.warDeaths,
    migrants: state.counters.migrants,
    abandonments: state.counters.abandonments,
    foundings: state.counters.settlementsFounded - settlementsStart,
    civFormed: byType.get('civ_formed') ?? 0,
    foodProduced: state.counters.foodProduced,
    foodConsumed: state.counters.foodConsumed,
    foodDaysStart,
    foodDaysEnd: foodDays(state),
    healthAvg: avgOf(soc.health, state.settlements.count),
    stabilityAvg: avgOf(soc.stability, state.settlements.count),
    vegetationStart,
    vegetationEnd: gridSum(state, 'vegetation'),
    fertilityStart,
    fertilityEnd: gridSum(state, 'fertility'),
    droughtEvents: byType.get('drought') ?? 0,
    floodEvents: byType.get('flood') ?? 0,
    wildfireEvents: byType.get('wildfire') ?? 0,
    epidemicEvents: byType.get('epidemic') ?? 0,
    famineEvents: byType.get('famine') ?? 0,
    routesOpened: state.counters.routesOpened,
    routesLost: state.counters.routesLost,
    routesEnd: soc.routeCount,
    tradeVolume: state.counters.tradeVolume,
    transfers: state.counters.tributePaid,
    treatiesSigned: byType.get('treaty_signed') ?? 0,
    treatiesEnd: soc.treatyCount,
    warsDeclared: state.counters.warsDeclared,
    warsEnded: state.counters.warsEnded,
    techDiscovered: state.counters.techDiscovered,
    techsKnown,
    culture,
    eventCount: events.length,
    eventsBySeverity,
    eventsByType: [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    causeFailures,
    conservationFailures,
    invariantFailures: failures,
    warSamples,
    tickP50: round(percentile(samples, 0.5)),
    tickP95: round(percentile(samples, 0.95)),
    tickMax: round(samples[samples.length - 1] ?? 0),
    heapStartMb,
    heapEndMb: heapMb(),
    saveBytesRaw,
    saveBytesCompressed,
    saveMs,
    checksum: worldChecksum(state).toString(16),
    arcs,
  };
}

async function runSet(options: BalanceOptions): Promise<BalanceReport> {
  const startedAt = performance.now();
  const detail: SeedReport[] = [];
  for (let s = 0; s < options.seeds; s++) {
    const report = await runSeed(pick(s + 1), options);
    detail.push(report);
    options.onSeed?.(report);
  }
  const pops = detail.map((d) => d.finalPopulation).sort((a, b) => a - b);
  const arcHits: Record<string, number> = {};
  for (const seed of detail) {
    for (const arc of seed.arcs) if (arc.present) arcHits[arc.type] = (arcHits[arc.type] ?? 0) + 1;
  }
  return {
    seeds: options.seeds,
    years: options.years,
    preset: options.preset,
    intervention: options.intervention,
    elapsedMs: Math.round(performance.now() - startedAt),
    population: {
      min: pops[0] ?? 0,
      median: pops[Math.floor(pops.length / 2)] ?? 0,
      max: pops[pops.length - 1] ?? 0,
    },
    failures: detail.reduce((n, d) => n + d.invariantFailures.length, 0),
    arcHits,
    seedsDetail: detail,
  };
}

/** No-input run plus the harness-only blight run needed by the fourth arc. */
export async function runBalance(options: BalanceOptions): Promise<BalanceReport> {
  const main = await runSet({ ...options, intervention: false });
  const intervention = await runSet({ ...options, intervention: true });
  main.interventionReport = intervention;
  return main;
}
