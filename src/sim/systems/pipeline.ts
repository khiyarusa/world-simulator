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

export interface TickContext {
  state: WorldState;
  /** The day being simulated (state.day + 1). */
  day: number;
  isMonthEnd: boolean;
  isYearEnd: boolean;
  isWeekEnd: boolean;
}

export type Stage = (ctx: TickContext) => void;

/** Declared phase order. Stage 3 implements the first eight plus the heal/growth/history tail. */
export const DAILY_STAGES: ReadonlyArray<readonly [string, Stage]> = [
  ['climate', (c) => runClimate(c.state, c.day)],
  ['ecology', () => { /* ecology runs inside agriculture/fertility until Stage 3.1 adds per-cell work */ }],
  ['fertility', () => { /* soil recovery is driven by the vegetation pass in Stage 3.1 */ }],
  ['agriculture', (c) => runProduction(c.state, c.day)],
  ['extraction', () => { /* extraction shares runProduction: same phase, one pass over settlements */ }],
  ['craft', () => { /* crafting shares runProduction for the same reason */ }],
  ['consumption', (c) => runConsumption(c.state, c.day)],
  ['health', () => { /* health is updated by consumption from the actual shortfalls */ }],
  ['demographics', () => { /* demography runs yearly, with ageing (see runDay) */ }],
  ['stability', () => { /* stability is updated by consumption from the actual shortfalls */ }],
  ['migration', (c) => { if (c.isMonthEnd) runMigration(c.state, c.day); }],
  ['trade', () => { /* Stage 3.2: routes and tariffs (not implemented yet) */ }],
  ['build', () => { /* Stage 3.2: infrastructure selection (not implemented yet) */ }],
  ['military', () => { /* Stage 3.2: manpower and upkeep (not implemented yet) */ }],
  ['diplomacy', () => { /* Stage 3.2: relations and treaties (not implemented yet) */ }],
  ['war', () => { /* Stage 3.2: fronts and peace (not implemented yet) */ }],
  ['settlement-growth', (c) => { if (c.isMonthEnd) runGrowth(c.state, c.day); }],
  ['civilization', () => { /* Stage 3.2: formation, culture, technology (not implemented yet) */ }],
  ['events', () => { /* events are emitted by the phases that cause them */ }],
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
  }
  syncPopulation(state);
  state.day = day;
  state.counters.ticks += 1;
}
