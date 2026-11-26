/**
 * Yearly world series (Stage 4 WP1/WP4).
 *
 * One sample per simulated year, taken from live state at the end of the year. It exists so the
 * economy/world panels can show a real trend without inventing numbers, and it is bounded (512 years)
 * and persisted with the world.
 */
import type { WorldState } from '../state/worldState.ts';
import { calendarOf } from '../../core/clock.ts';
import { populationOf } from './state.ts';
import { appendSettlementTrend, appendYearlyStats } from './rings.ts';
import { FLAG_DROUGHT, FLAG_RUINED, isAlive } from './common.ts';

export function runYearlyStats(world: WorldState): void {
  const soc = world.society;
  const s = world.settlements;
  let population = 0;
  let settlements = 0;
  let treasury = 0;
  let fertilitySum = 0;
  let drought = 0;
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = populationOf(soc, i);
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    population += pop;
    settlements++;
    treasury += soc.treasury[i] ?? 0;
    fertilitySum += world.grids.fertility[tile] ?? 0;
    if (((soc.flags[i] ?? 0) & FLAG_DROUGHT) !== 0) drought++;
    appendSettlementTrend(soc, i, pop);
  }
  appendYearlyStats(soc, {
    year: calendarOf(world.day).year,
    population,
    settlements,
    civs: world.civs.count,
    foodProduced: world.counters.foodProduced,
    tradeVolume: world.counters.tradeVolume,
    treasury,
    wars: soc.warCount,
    fertility: settlements > 0 ? Math.floor(fertilitySum / settlements) : 0,
    drought,
  });
}

/** Ruined settlements are counted separately by the world panel, not folded into the living count. */
export function ruinedCount(world: WorldState): number {
  let n = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if (((world.society.flags[i] ?? 0) & FLAG_RUINED) !== 0) n++;
  }
  return n;
}
