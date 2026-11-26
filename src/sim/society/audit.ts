/**
 * One reusable invariant audit (docs/QA_AND_CI_STRATEGY.md §4, brief §14).
 *
 * The harness, the worker's development probe and the tests all call this, so a rule cannot be
 * "tested" in one place and violated in another. It returns human-readable failures instead of
 * throwing: a long run must finish and report every broken rule, not die on the first one.
 */
import type { WorldState } from '../state/worldState.ts';
import { SimError } from '../../core/errors.ts';
import { COHORT_COUNT, RES_COUNT, populationOf, stockOf } from './state.ts';
import { validateSociety } from './validate.ts';
import { isAlive } from './common.ts';

export interface AuditOptions {
  /** Expected population identity: initial + births - deaths - (people lost to uncaught paths). */
  expectedPopulation?: number;
}

export function auditSociety(world: WorldState, options: AuditOptions = {}): string[] {
  const errors: string[] = [];
  const soc = world.society;
  const s = world.settlements;

  for (let i = 0; i < s.count; i++) {
    let sum = 0;
    for (let c = 0; c < COHORT_COUNT; c++) {
      const value = soc.cohorts[i * COHORT_COUNT + c] ?? 0;
      if (value < 0) errors.push(`settlement ${i} cohort ${c} is negative`);
      sum += value;
    }
    if (sum !== populationOf(soc, i)) errors.push(`settlement ${i} cohort sum ${sum} != populationOf`);
    if (sum !== (s.pop[i] ?? 0)) errors.push(`settlement ${i} legacy population ${s.pop[i] ?? 0} != cohorts ${sum}`);
    if (soc.treasury[i] === undefined) errors.push(`settlement ${i} treasury missing`);
    else if ((soc.treasury[i] ?? 0) < 0) errors.push(`settlement ${i} treasury is negative`);
    for (let r = 0; r < RES_COUNT; r++) {
      const stock = stockOf(soc, i, r);
      if (stock < 0) errors.push(`settlement ${i} stock ${r} is negative`);
      if (stock > (soc.cap[i * RES_COUNT + r] ?? 0)) errors.push(`settlement ${i} stock ${r} ${stock} over cap`);
      const carry = soc.carry[i * RES_COUNT + r] ?? 0;
      if (carry >= 1000) errors.push(`settlement ${i} carry ${r} is ${carry}`);
    }
    if ((soc.health[i] ?? 0) > 100) errors.push(`settlement ${i} health out of range`);
    if ((soc.stability[i] ?? 0) > 100) errors.push(`settlement ${i} stability out of range`);
    if ((soc.literacy[i] ?? 0) > 100) errors.push(`settlement ${i} literacy out of range`);
  }

  if (options.expectedPopulation !== undefined) {
    let total = 0;
    for (let i = 0; i < s.count; i++) total += populationOf(soc, i);
    if (total !== options.expectedPopulation) {
      errors.push(`population identity: expected ${options.expectedPopulation}, found ${total}`);
    }
  }

  // semantic validation is the same contract a loaded save must satisfy
  try {
    validateSociety(world, soc);
  } catch (e) {
    if (e instanceof SimError) errors.push(e.message);
    else errors.push(String(e));
  }

  // a dead settlement must not still be counted as a live one
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i) && (soc.flags[i] ?? 0) === 0) errors.push(`settlement ${i} is empty but not ruined`);
  }
  return errors;
}
