/**
 * Settlement life cycle: storage capacity, tiers, founding and abandonment (GDD §7).
 *
 * Founding transfers people and stores from the parent; it never creates them (D-43). Promotion needs
 * two consecutive years of food surplus and the infrastructure the tier requires; demotion is a real
 * collapse, recorded as an event rather than a silent number change.
 */
import type { WorldState } from '../state/worldState.ts';
import { CAPACITY, TIER, tierOf } from '../state/worldState.ts';
import {
  COHORT,
  EVENT_TYPE,
  RES,
  RES_COUNT,
  SEVERITY,
  addCohort,
  addStock,
  appendEvent,
  cohortOf,
  infraHas,
  populationOf,
  stockOf,
} from './state.ts';
import { FLAG_RUINED, isAlive } from './common.ts';
import { landCapacity, recalcCaps } from './economy.ts';
import { syncPopulation } from './living.ts';

/** The infrastructure a tier requires, as a predicate over the settlement's built bits. */
function tierInfraOk(world: WorldState, settlement: number, tier: number): boolean {
  const soc = world.society;
  if (tier <= TIER.VILLAGE) return true;
  const granaryOrWell = infraHas(soc, settlement, 0) || infraHas(soc, settlement, 1);
  if (tier === TIER.TOWN) return granaryOrWell;
  const marketOrWorkshop = infraHas(soc, settlement, 4) || infraHas(soc, settlement, 5);
  if (tier === TIER.CITY) return granaryOrWell && marketOrWorkshop && infraHas(soc, settlement, 3);
  return granaryOrWell && marketOrWorkshop && infraHas(soc, settlement, 3) && (infraHas(soc, settlement, 8) || infraHas(soc, settlement, 9));
}

/**
 * Found a daughter settlement next to its parent, moving people cohort-by-cohort.
 * Valid land only: no water, no lake, not already occupied, and a workable fertility.
 */
function foundDaughter(world: WorldState, parent: number, day: number): void {
  const s = world.settlements;
  const soc = world.society;
  const px = s.x[parent] ?? 0;
  const py = s.y[parent] ?? 0;
  // A local occupancy mask: founding is called for every prosperous settlement, and a per-candidate
  // scan of all settlements turned the 400-year harness quadratic. The mask is conservative (it
  // marks the 5x5 box around each neighbour, slightly more than the real 3-tile radius).
  const SPAN = 15;
  const HALF = 7;
  const occupiedMask = new Uint8Array(SPAN * SPAN);
  for (let k = 0; k < s.count; k++) {
    const ddx = (s.x[k] ?? 0) - px;
    const ddy = (s.y[k] ?? 0) - py;
    if (ddx < -HALF - 3 || ddx > HALF + 3 || ddy < -HALF - 3 || ddy > HALF + 3) continue;
    for (let my = ddy - 2; my <= ddy + 2; my++) {
      if (my < -HALF || my > HALF) continue;
      for (let mx = ddx - 2; mx <= ddx + 2; mx++) {
        if (mx < -HALF || mx > HALF) continue;
        occupiedMask[(my + HALF) * SPAN + (mx + HALF)] = 1;
      }
    }
  }
  let site = -1;
  for (let r = 2; r <= 7 && site < 0; r++) {
    for (let dy = -r; dy <= r && site < 0; dy++) {
      for (let dx = -r; dx <= r && site < 0; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        if (occupiedMask[(dy + HALF) * SPAN + (dx + HALF)] !== 0) continue;
        const x = px + dx;
        const y = py + dy;
        if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) continue;
        const tile = y * world.width + x;
        if ((world.grids.elevation[tile] ?? 0) < world.seaLevel) continue;
        if ((world.grids.lakeId[tile] ?? 0) !== 0) continue;
        if ((world.grids.fertility[tile] ?? 0) < 25) continue;
        site = tile;
      }
    }
  }
  if (site < 0) return;

  const index = s.count;
  s.x[index] = site % world.width;
  s.y[index] = Math.floor(site / world.width);
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
  soc.lastDroughtEvent[index] = 0;
  soc.lastFamineEvent[index] = 0;
  soc.occupier[index] = 0;
  soc.surplusYears[index] = 0;
  for (let r = 0; r < RES_COUNT; r++) soc.price[index * RES_COUNT + r] = 1000;
  // the same adult split the generator uses, so the settlement is valid from its first tick
  soc.occShare[index * 5] = 500;
  soc.occShare[index * 5 + 1] = 200;
  soc.occShare[index * 5 + 2] = 120;
  soc.occShare[index * 5 + 3] = 100;
  soc.occShare[index * 5 + 4] = 80;
  s.count = index + 1;

  // move 40 % of the parent (capped), youngest cohorts first so the daughter can grow
  const target = Math.min(350, Math.floor(populationOf(soc, parent) * 350 / 1000));
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
  recalcCaps(world);
  // seed the daughter proportionally from the parent's stores, so both sides keep the same reserve
  // (a transfer, so the world total is unchanged and neither is silently starved by the split)
  const parentPop = populationOf(soc, parent);
  const share = parentPop > 0 ? Math.floor((moved * 1000) / parentPop) : 0;
  const food = Math.min(stockOf(soc, parent, RES.FOOD), Math.floor((stockOf(soc, parent, RES.FOOD) * share) / 1000));
  addStock(soc, parent, RES.FOOD, -food);
  addStock(soc, index, RES.FOOD, food);
  world.counters.settlementsFounded += 1;
  appendEvent(world.society, day, EVENT_TYPE.SETTLEMENT_FOUNDED, SEVERITY.NOTABLE, index, s.civ[index] ?? 0, 0, moved, 0);
  syncPopulation(world);
}

/** Monthly settlement life cycle. Caps are recalculated first, from the population that exists now. */
export function runGrowth(world: WorldState, day: number): void {
  if (day % 30 !== 0) return;
  recalcCaps(world);
  const soc = world.society;
  const s = world.settlements;

  for (let i = 0; i < s.count; i++) {
    if (((soc.flags[i] ?? 0) & FLAG_RUINED) !== 0) continue;
    const pop = populationOf(soc, i);
    if (pop <= 0) {
      // a settlement that lost its last person is abandoned, and the event names the real cause
      soc.flags[i] = (soc.flags[i] ?? 0) | FLAG_RUINED;
      world.counters.abandonments += 1;
      const famine = soc.lastFamineEvent[i] ?? 0;
      const fresh = day - (soc.historyDay[i * 2 + 1] ?? 0) <= 720;
      appendEvent(
        world.society,
        day,
        EVENT_TYPE.SETTLEMENT_ABANDONED,
        SEVERITY.HISTORIC,
        i,
        s.civ[i] ?? 0,
        0,
        0,
        famine > 0 && fresh ? famine : -1,
      );
      continue;
    }
    if (!isAlive(world, i)) continue;
    const foodDays = Math.floor(stockOf(soc, i, RES.FOOD) / Math.max(1, pop));

    // --- sustained surplus, not one good month: promotion needs two consecutive years
    if (foodDays >= 30) soc.surplusYears[i] = Math.min(255, (soc.surplusYears[i] ?? 0) + 1);
    else soc.surplusYears[i] = 0;

    // --- founding: a settlement approaching its own arable capacity sends settlers out
    // (a transfer, not creation); crowding is the cause, not an arbitrary population number
    const crowded = pop * 1000 >= landCapacity(world, i) * 700;
    if (
      pop >= 300 &&
      crowded &&
      (soc.stability[i] ?? 0) >= 45 &&
      foodDays >= 10 &&
      foodDays < 120 && // a settlement that hoards for a century is not the one that expands
      s.count < CAPACITY.settlements &&
      day % 60 === 0
    ) {
      foundDaughter(world, i, day);
      continue;
    }

    const wanted = tierOf(pop);
    const current = s.tier[i] ?? 0;
    if (wanted > current) {
      const next = current + 1;
      if ((soc.surplusYears[i] ?? 0) >= 24 && tierInfraOk(world, i, next) && stockOf(soc, i, RES.FOOD) > pop * 30) {
        s.tier[i] = next;
        appendEvent(world.society, day, EVENT_TYPE.TIER_UP, SEVERITY.NOTABLE, i, s.civ[i] ?? 0, 0, next, 0);
      }
    } else if (wanted < current) {
      // demotion is a collapse, recorded as an event: a real food failure, not a quiet number change
      if ((soc.surplusYears[i] ?? 0) === 0 && foodDays < 5) {
        s.tier[i] = wanted;
        appendEvent(world.society, day, EVENT_TYPE.COLLAPSE, SEVERITY.MAJOR, i, s.civ[i] ?? 0, 0, wanted, -1);
      }
    }
  }
}

