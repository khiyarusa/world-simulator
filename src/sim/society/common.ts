/** Shared predicates for the society systems (kept out of any one system module). */
import type { WorldState } from '../state/worldState.ts';
import { COHORT, CIV_STRIDE, addCohort, cohortOf, populationOf, type SocietyState } from './state.ts';

export const FLAG_RUINED = 1;
export const FLAG_STARVING = 2;
export const FLAG_DROUGHT = 4;

export function isAlive(world: WorldState, settlement: number): boolean {
  return (
    settlement < world.settlements.count &&
    ((world.society.flags[settlement] ?? 0) & FLAG_RUINED) === 0 &&
    populationOf(world.society, settlement) > 0
  );
}

/** Squared tile distance. Chebyshev would also do; the square is only used for ordering. */
export function distanceSq(world: WorldState, a: number, b: number): number {
  const s = world.settlements;
  const dx = (s.x[a] ?? 0) - (s.x[b] ?? 0);
  const dy = (s.y[a] ?? 0) - (s.y[b] ?? 0);
  return dx * dx + dy * dy;
}

export function relationOf(soc: SocietyState, a: number, b: number): number {
  return soc.relation[a * CIV_STRIDE + b] ?? 0;
}

export function setRelation(soc: SocietyState, a: number, b: number, value: number): void {
  const at = a * CIV_STRIDE + b;
  soc.relation[at] = value < -100 ? -100 : value > 100 ? 100 : value;
}

export function hasTreaty(soc: SocietyState, a: number, b: number, type: number): boolean {
  for (let k = 0; k < soc.treatyCount; k++) {
    const ta = soc.treatyA[k] ?? 0;
    const tb = soc.treatyB[k] ?? 0;
    if ((ta === a && tb === b) || (ta === b && tb === a)) {
      if ((soc.treatyType[k] ?? 0) === type) return true;
    }
  }
  return false;
}

export function atWar(soc: SocietyState, a: number, b: number): boolean {
  for (let k = 0; k < soc.warCount; k++) {
    const wa = soc.warA[k] ?? 0;
    const wb = soc.warB[k] ?? 0;
    if ((wa === a && wb === b) || (wa === b && wb === a)) return true;
  }
  return false;
}

export function warIndex(soc: SocietyState, a: number, b: number): number {
  for (let k = 0; k < soc.warCount; k++) {
    const wa = soc.warA[k] ?? 0;
    const wb = soc.warB[k] ?? 0;
    if ((wa === a && wb === b) || (wa === b && wb === a)) return k;
  }
  return -1;
}

export function routeIndex(soc: SocietyState, a: number, b: number): number {
  for (let k = 0; k < soc.routeCount; k++) {
    const ra = soc.routeA[k] ?? 0;
    const rb = soc.routeB[k] ?? 0;
    if ((ra === a && rb === b) || (ra === b && rb === a)) return k;
  }
  return -1;
}

/**
 * Remove `count` people from the cohorts, elders first, and return how many actually left.
 * Every cause of death (famine, epidemic, war) uses this helper so the number counted is the number
 * removed, never a requested figure that the settlement could not supply.
 */
export function removePeople(soc: SocietyState, settlement: number, count: number): number {
  if (count <= 0) return 0;
  const order = [
    COHORT.ELDERS,
    COHORT.SOLDIERS,
    COHORT.TRADERS,
    COHORT.CRAFTERS,
    COHORT.EXTRACTORS,
    COHORT.FARMERS,
    COHORT.YOUTH,
    COHORT.CHILDREN,
  ] as const;
  let left = count;
  for (const cohort of order) {
    if (left <= 0) break;
    const have = cohortOf(soc, settlement, cohort);
    const take = have < left ? have : left;
    if (take > 0) addCohort(soc, settlement, cohort, -take);
    left -= take;
  }
  return count - left;
}

/** Total living population of a civilization, read from the authoritative cohorts. */
export function civPopulation(world: WorldState, civ: number): number {
  const s = world.settlements;
  let total = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ) continue;
    if (!isAlive(world, i)) continue;
    total += populationOf(world.society, i);
  }
  return total;
}

export function civSettlementCount(world: WorldState, civ: number): number {
  const s = world.settlements;
  let n = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) === civ && isAlive(world, i)) n++;
  }
  return n;
}
