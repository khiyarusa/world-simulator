/**
 * Daily tick pipeline. Every phase exists from Stage 2 so Stage 3 has explicit insertion
 * points, but phases that belong to later stages are honest no-ops — no fake population
 * growth, no fake economy, no decorative events (AGENTS.md §8, docs/ROADMAP_5_STAGES.md).
 */
import type { WorldState } from '../state/worldState.ts';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../core/clock.ts';

export interface TickContext {
  readonly state: WorldState;
  /** The day being simulated (state.day + 1). */
  readonly day: number;
  readonly isMonthEnd: boolean;
  readonly isYearEnd: boolean;
  readonly isWeekEnd: boolean;
}

export type Stage = (ctx: TickContext) => void;

const noop = (): void => {
  // Intentionally empty until Stage 3.
};

/**
 * Ordered phases from docs/SIMULATION_MODEL.md §4. Order is part of the contract.
 * Stage 2 implements calendar advance only; everything else is a declared, empty hook.
 */
export const DAILY_STAGES: ReadonlyArray<readonly [string, Stage]> = [
  ['climate', noop],
  ['ecology', noop],
  ['fertility', noop],
  ['agriculture', noop],
  ['extraction', noop],
  ['craft', noop],
  ['consumption', noop],
  ['health', noop],
  ['demographics', noop],
  ['stability', noop],
  ['migration', noop],
  ['trade', noop],
  ['build', noop],
  ['military', noop],
  ['diplomacy', noop],
  ['war', noop],
  ['settlement-growth', noop],
  ['civilization', noop],
  ['events', noop],
  ['chronicle', noop],
];

export function stageNames(): string[] {
  return DAILY_STAGES.map(([name]) => name);
}

/** Advance exactly one simulated day. Deterministic and side-effect free except `state`. */
export function runDay(state: WorldState): void {
  const day = state.day + 1;
  const ctx: TickContext = {
    state,
    day,
    isWeekEnd: day % 7 === 0,
    isMonthEnd: day % DAYS_PER_MONTH === 0,
    isYearEnd: day % DAYS_PER_YEAR === 0,
  };
  for (const [, stage] of DAILY_STAGES) stage(ctx);
  state.day = day;
  state.counters.ticks += 1;
}
