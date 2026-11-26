/**
 * Daily tick pipeline. Every phase has an owner; nothing here is a placeholder that pretends a system
 * exists (docs/STAGE_3_DESIGN.md §7).
 *
 * Read/write discipline: phases run in a fixed order and each one reads the state produced earlier in
 * the same tick. There is no same-tick feedback loop: a phase never re-reads a value it already wrote.
 */
import type { WorldState } from '../state/worldState.ts';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../core/clock.ts';
import { runGrowth } from '../society/growth.ts';
import {
  syncPopulation,
  runAgeing,
  runChronicle,
  runClimate,
  runConsumption,
  runDemographics,
  runMigration,
  runProduction,
} from '../society/living.ts';
import { runEcology } from '../society/ecology.ts';
import { runOccupations } from '../society/occupations.ts';
import { runTrade } from '../society/trade.ts';
import { runConstruction } from '../society/infra.ts';
import { runMilitary, runWar } from '../society/war.ts';
import { runDiplomacyYearly } from '../society/diplomacy.ts';
import { runCivYearly, runResearch, runTechSpread } from '../society/civ.ts';
import { runYearlyStats } from '../society/stats.ts';

export interface TickContext {
  state: WorldState;
  /** The day being simulated (state.day + 1). */
  day: number;
  isMonthEnd: boolean;
  isYearEnd: boolean;
  isWeekEnd: boolean;
}

export type Stage = (ctx: TickContext) => void;

/**
 * Declared phase order. Every phase owns a real system: the comments name the module, and a phase
 * that only shares a pass with another one says so explicitly instead of pretending to be empty.
 */
export const DAILY_STAGES: ReadonlyArray<readonly [string, Stage]> = [
  ['climate', (c) => runClimate(c.state, c.day)],
  ['ecology', (c) => runEcology(c.state, c.day)],
  ['labour', (c) => runOccupations(c.state, c.day)],
  ['agriculture', (c) => runProduction(c.state, c.day)],
  // extraction, craft, consumption, health and stability are one pass over settlements in
  // consuming.ts/living.ts; they are listed in the design order and share an owner deliberately.
  ['consumption', (c) => runConsumption(c.state, c.day)],
  ['migration', (c) => { if (c.isMonthEnd) runMigration(c.state, c.day); }],
  ['trade', (c) => runTrade(c.state, c.day)],
  ['build', (c) => runConstruction(c.state, c.day)],
  ['military', (c) => runMilitary(c.state, c.day)],
  ['diplomacy', (c) => runDiplomacyYearly(c.state, c.day)],
  ['war', (c) => runWar(c.state, c.day)],
  ['settlement-growth', (c) => runGrowth(c.state, c.day)],
  ['civilization', (c) => { runResearch(c.state, c.day); runTechSpread(c.state, c.day); runCivYearly(c.state, c.day); }],
  ['chronicle', (c) => runChronicle(c.state, c.day)],
];

export function stageNames(): string[] {
  return DAILY_STAGES.map(([name]) => name);
}

const ctx: TickContext = {
  state: null as unknown as WorldState,
  day: 0,
  isMonthEnd: false,
  isYearEnd: false,
  isWeekEnd: false,
};

/** Advance exactly one simulated day. Deterministic; the only side effect is on `state`. */
export function runDay(state: WorldState): void {
  const day = state.day + 1;
  ctx.state = state;
  ctx.day = day;
  ctx.isWeekEnd = day % 7 === 0;
  ctx.isMonthEnd = day % DAYS_PER_MONTH === 0;
  ctx.isYearEnd = day % DAYS_PER_YEAR === 0;
  for (let i = 0; i < DAILY_STAGES.length; i++) {
    DAILY_STAGES[i]![1](ctx);
  }
  if (ctx.isYearEnd) {
    runDemographics(state);
    runAgeing(state);
    // sampled after the yearly systems so the series describes the year that just ended
    runYearlyStats(state);
  }
  syncPopulation(state);
  state.day = day;
  state.counters.ticks += 1;
}
