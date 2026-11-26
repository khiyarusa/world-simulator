/** Shared predicates for the society systems (kept out of any one system module). */
import type { WorldState } from '../state/worldState.ts';
import { populationOf } from './state.ts';

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
