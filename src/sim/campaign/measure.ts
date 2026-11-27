/** Authoritative campaign metrics. Every number comes from live worker state. */
import type { WorldState } from '../state/worldState.ts';
import { METRIC, METRIC_COUNT } from './types.ts';
import { FLAG_BLIGHT, FLAG_DROUGHT, FLAG_STARVING, isAlive } from '../society/common.ts';
import { cohortOf, COHORT, INFRA, populationOf, RES, stockOf } from '../society/state.ts';

const scratch = new Uint16Array(256);

function median(values: Uint16Array, n: number): number {
  if (n === 0) return 0;
  for (let i = 1; i < n; i++) {
    const v = values[i] ?? 0;
    let j = i - 1;
    while (j >= 0 && (values[j] ?? 0) > v) {
      values[j + 1] = values[j] ?? 0;
      j--;
    }
    values[j + 1] = v;
  }
  return values[(n - 1) >> 1] ?? 0;
}

function foodDays(world: WorldState, settlement: number): number {
  const pop = Math.max(1, populationOf(world.society, settlement));
  return Math.floor(stockOf(world.society, settlement, RES.FOOD) / pop);
}

export function measureAll(world: WorldState, out: Uint16Array): void {
  const c = world.campaign;
  const civ = c.targetCiv;
  const soc = world.society;
  const s = world.settlements;
  out.fill(0);
  if (civ >= world.civs.count) return;

  const academyBit = INFRA.indexOf('academy');
  let n = 0;
  let pop = 0;
  let fertSum = 0;
  let vegSum = 0;
  let tech = 0;
  let academies = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    const p = populationOf(soc, i);
    pop += p;
    n++;
    scratch[n - 1] = Math.min(65535, foodDays(world, i));
    if (n > 200) break;
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    fertSum += world.grids.fertility[tile] ?? 0;
    vegSum += world.grids.vegetation[tile] ?? 0;
    if (((soc.infra[i] ?? 0) & (1 << academyBit)) !== 0) academies++;
  }
  if (n === 0) return;
  out[METRIC.FOOD_DAYS] = median(scratch, n);
  out[METRIC.POPULATION] = Math.min(65535, Math.floor(pop / 100));
  out[METRIC.SETTLEMENTS] = n;
  out[METRIC.FERTILITY] = Math.floor(fertSum / n);
  out[METRIC.VEGETATION] = Math.floor(vegSum / n);
  out[METRIC.ACADEMIES] = academies;

  let m = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    scratch[m++] = soc.stability[i] ?? 0;
  }
  out[METRIC.STABILITY] = median(scratch, m);
  m = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    scratch[m++] = soc.health[i] ?? 0;
  }
  out[METRIC.HEALTH] = median(scratch, m);
  m = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    scratch[m++] = soc.literacy[i] ?? 0;
  }
  out[METRIC.LITERACY] = median(scratch, m);
  m = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    scratch[m++] = Math.max(0, Math.min(65535, soc.treasury[i] ?? 0));
  }
  out[METRIC.TREASURY] = median(scratch, m);

  for (let t = 0; t < 12; t++) tech += soc.tech[civ * 12 + t] ?? 0;
  out[METRIC.TECH_NODES] = tech;

  let treaties = 0;
  for (let k = 0; k < soc.treatyCount; k++) {
    const a = soc.treatyA[k] ?? 0;
    const b = soc.treatyB[k] ?? 0;
    if ((a === civ || b === civ) && (soc.treatyEnd[k] ?? 0) > world.day) treaties++;
  }
  out[METRIC.TREATIES] = treaties;

  let routes = 0;
  for (let k = 0; k < soc.routeCount; k++) {
    const ca = s.civ[soc.routeA[k] ?? 0] ?? 0;
    const cb = s.civ[soc.routeB[k] ?? 0] ?? 0;
    if (ca === civ || cb === civ) routes++;
  }
  out[METRIC.ROUTES] = routes;
  out[METRIC.PEACE_DAYS] = Math.min(65535, Math.max(0, world.day - c.lastWarDay));
  out[METRIC.CRISIS_FREE_DAYS] = Math.min(65535, Math.max(0, world.day - c.lastCrisisDay));
  out[METRIC.FOOD_SECURITY_DAYS] = Math.min(65535, c.foodSecurityDays);
}

export function atWarWithSteward(world: WorldState, civ: number): boolean {
  const soc = world.society;
  for (let k = 0; k < soc.warCount; k++) {
    if ((soc.warA[k] ?? 0) === civ || (soc.warB[k] ?? 0) === civ) return true;
  }
  return false;
}

/** Record today's war/crisis clock before metrics are read. Called once per simulated day. */
export function noteCampaignDay(world: WorldState): void {
  const c = world.campaign;
  const civ = c.targetCiv;
  if (civ >= world.civs.count) return;
  if (atWarWithSteward(world, civ)) c.lastWarDay = world.day;
  const soc = world.society;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    if (((soc.flags[i] ?? 0) & (FLAG_STARVING | FLAG_BLIGHT | FLAG_DROUGHT)) !== 0) {
      c.lastCrisisDay = world.day;
      break;
    }
  }
}

/** Establish the baseline and first counters when the steward is chosen. */
export function beginBaseline(world: WorldState): void {
  const c = world.campaign;
  measureAll(world, c.baseline);
  let pop = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if ((world.settlements.civ[i] ?? 0) === c.targetCiv) pop += populationOf(world.society, i);
  }
  c.startPopulation = pop;
  c.startSettlements = c.baseline[METRIC.SETTLEMENTS] ?? 0;
  c.begunDay = world.day;
  c.lastWarDay = world.day;
  c.lastCrisisDay = world.day;
  c.foodSecurityDays = 0;
  // Baseline counters that are not absolute levels.
  c.baseline[METRIC.PEACE_DAYS] = 0;
  c.baseline[METRIC.CRISIS_FREE_DAYS] = 0;
  c.baseline[METRIC.FOOD_SECURITY_DAYS] = 0;
}

export function targetSettlementFoodDays(world: WorldState, settlement: number): number {
  return foodDays(world, settlement);
}

export function targetSettlementFertility(world: WorldState, settlement: number): number {
  const s = world.settlements;
  const tile = (s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0);
  return world.grids.fertility[tile] ?? 0;
}

export function targetSettlementVegetation(world: WorldState, settlement: number): number {
  const s = world.settlements;
  const tile = (s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0);
  return world.grids.vegetation[tile] ?? 0;
}

export function targetSettlementPop(world: WorldState, settlement: number): number {
  return populationOf(world.society, settlement);
}

export function targetFarmers(world: WorldState, settlement: number): number {
  return cohortOf(world.society, settlement, COHORT.FARMERS);
}

export const METRIC_KEYS = METRIC_COUNT;
