/**
 * Deterministic society initialisation (used by world generation and the v1→v2 migration).
 *
 * The cohort split is a fixed per-mille table whose sum is exactly 1000; the rounding remainder goes
 * to farmers, so `sum(cohorts) === legacyPopulation` always holds. No RNG, no clock: migrating a save
 * twice produces the same society.
 */
import type { WorldState } from '../state/worldState.ts';
import { COHORT, RES, RES_COUNT, type SocietyState } from './state.ts';

/** children, youth, farmers, extractors, crafters, traders, soldiers, elders */
const COHORT_SHARE_PM = [300, 200, 250, 100, 60, 40, 30, 20] as const;
const OCC_SHARE_PM = [500, 200, 120, 100, 80] as const; // farmers, extractors, crafters, traders, soldiers

export function initialiseSociety(world: WorldState, society: SocietyState): void {
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    const pop = s.pop[i] ?? 0;
    let assigned = 0;
    for (let c = 0; c < COHORT_SHARE_PM.length; c++) {
      const share = COHORT_SHARE_PM[c] ?? 0;
      const value = Math.floor((pop * share) / 1000);
      society.cohorts[i * 8 + c] = value;
      assigned += value;
    }
    society.cohorts[i * 8 + COHORT.FARMERS] = (society.cohorts[i * 8 + COHORT.FARMERS] ?? 0) + (pop - assigned);

    for (let k = 0; k < OCC_SHARE_PM.length; k++) society.occShare[i * 5 + k] = OCC_SHARE_PM[k] ?? 0;

    const at = i * RES_COUNT;
    society.stock[at + RES.FOOD] = pop * 30;
    society.stock[at + RES.WATER] = pop * 10;
    society.stock[at + RES.WOOD] = pop * 2;
    society.stock[at + RES.STONE] = 40;
    society.stock[at + RES.METAL] = 20;
    society.cap[at + RES.FOOD] = pop * 90;
    society.cap[at + RES.WATER] = pop * 40;
    society.cap[at + RES.WOOD] = pop * 20;
    society.cap[at + RES.STONE] = 5_000;
    society.cap[at + RES.METAL] = 2_000;
    society.cap[at + RES.GOODS] = 2_000;

    society.health[i] = 70;
    society.stability[i] = 60;
    society.literacy[i] = 10;
    society.foundedDay[i] = s.foundedDay[i] ?? 1;
  }
}
