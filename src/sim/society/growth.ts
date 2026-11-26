/**
 * Settlement life cycle: tiers, founding and abandonment (docs/GDD.md §7).
 *
 * Founding transfers people and stores from the parent; it never creates them (D-43).
 */
import type { WorldState } from '../state/worldState.ts';
import { CAPACITY, tierOf } from '../state/worldState.ts';
import {
  COHORT,
  EVENT_TYPE,
  RES,
  SEVERITY,
  addCohort,
  addStock,
  appendEvent,
  cohortOf,
  populationOf,
  stockOf,
} from './state.ts';
import { FLAG_RUINED, isAlive } from './common.ts';
import { syncPopulation } from './living.ts';

/**
 * Found a daughter settlement next to its parent, moving people cohort-by-cohort.
 * Valid land only: no water, no lake, not already occupied, and a workable fertility.
 */
function foundDaughter(world: WorldState, parent: number, day: number): void {
  const s = world.settlements;
  const soc = world.society;
  const px = s.x[parent] ?? 0;
  const py = s.y[parent] ?? 0;
  const maxRadius = 7;
  let site = -1;
  for (let r = 2; r <= maxRadius && site < 0; r++) {
    for (let dy = -r; dy <= r && site < 0; dy++) {
      for (let dx = -r; dx <= r && site < 0; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const x = px + dx;
        const y = py + dy;
        if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) continue;
        const tile = y * world.width + x;
        if ((world.grids.elevation[tile] ?? 0) < world.seaLevel) continue;
        if ((world.grids.lakeId[tile] ?? 0) !== 0) continue;
        if ((world.grids.fertility[tile] ?? 0) < 25) continue;
        let occupied = false;
        for (let k = 0; k < s.count; k++) {
          const ddx = (s.x[k] ?? 0) - x;
          const ddy = (s.y[k] ?? 0) - y;
          if (ddx * ddx + ddy * ddy < 9) occupied = true;
        }
        if (occupied) continue;
        site = tile;
      }
    }
  }
  if (site < 0) return;

  const index = s.count;
  s.x[index] = site % world.width;
  s.y[index] = site / world.width;
  s.pop[index] = 0;
  s.civ[index] = s.civ[parent] ?? 0;
  s.tier[index] = 0;
  s.nameIdx[index] = index;
  s.foundedDay[index] = day;
  soc.foundedDay[index] = day;
  soc.health[index] = soc.health[parent] ?? 60;
  soc.stability[index] = 60;
  soc.literacy[index] = soc.literacy[parent] ?? 10;
  soc.flags[index] = 0;
  s.count = index + 1;

  // move ~30 % of the parent, youngest cohorts first so the daughter can grow
  const target = Math.min(200, Math.floor(populationOf(soc, parent) * 300 / 1000));
  let left = target;
  for (const c of [COHORT.YOUTH, COHORT.CHILDREN, COHORT.FARMERS, COHORT.EXTRACTORS, COHORT.CRAFTERS]) {
    if (left <= 0) break;
    const take = Math.min(cohortOf(soc, parent, c), left);
    if (take > 0) {
      addCohort(soc, parent, c, -take);
      addCohort(soc, index, c, take);
      left -= take;
    }
  }
  const moved = target - left;
  if (moved <= 0) {
    s.count = index; // nothing to move: undo
    return;
  }
  // seed the daughter from the parent's stores (a transfer, so the world total is unchanged)
  const food = Math.min(stockOf(soc, parent, RES.FOOD), moved * 20);
  addStock(soc, parent, RES.FOOD, -food);
  addStock(soc, index, RES.FOOD, food);
  world.counters.settlementsFounded += 1;
  appendEvent(world.society, day, EVENT_TYPE.SETTLEMENT_FOUNDED, SEVERITY.NOTABLE, index, s.civ[index] ?? 0, 0, moved, 0);
  syncPopulation(world);
}


// ------------------------------------------------------------------ settlement life cycle (monthly)

export function runGrowth(world: WorldState, day: number): void {
  const soc = world.society;
  const s = world.settlements;

  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = populationOf(soc, i);

    if (pop <= 0) {
      soc.flags[i] = (soc.flags[i] ?? 0) | FLAG_RUINED;
      world.counters.abandonments += 1;
      appendEvent(world.society, day, EVENT_TYPE.SETTLEMENT_ABANDONED, SEVERITY.HISTORIC, i, s.civ[i] ?? 0, 0, 0, 0);
      continue;
    }

    // --- founding: prosperity plus room founds a daughter settlement (transfer, not creation)
    if (
      pop >= 400 &&
      (soc.stability[i] ?? 0) >= 55 &&
      stockOf(soc, i, RES.FOOD) > pop * 20 &&
      s.count < CAPACITY.settlements &&
      day % 60 === 0
    ) {
      foundDaughter(world, i, day);
    }

    const tier = tierOf(pop);
    if (tier > (s.tier[i] ?? 0) && stockOf(soc, i, RES.FOOD) > pop * 30) {
      s.tier[i] = tier;
      appendEvent(world.society, day, EVENT_TYPE.TIER_UP, SEVERITY.NOTABLE, i, s.civ[i] ?? 0, 0, tier, 0);
    } else if (tier < (s.tier[i] ?? 0)) {
      s.tier[i] = tier;
    }
  }
}

