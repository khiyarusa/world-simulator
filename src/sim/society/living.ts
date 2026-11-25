/**
 * The living world: climate, ecology, production, consumption, health, demography, migration,
 * settlement life-cycle and the events they cause (docs/STAGE_3_DESIGN.md §7).
 *
 * Every rule here is integer/fixed-point and reads/writes only `WorldState`. No wall clock, no
 * `Math.random`, no renderer. Fractions are carried per settlement and resource so that 144,000 daily
 * steps conserve to the unit instead of drifting.
 */
import { Rng, STREAM, STREAM_IDS } from '../../core/rng.ts';
import type { RngState } from '../../core/rng.ts';
import { mulDiv } from '../../core/math.ts';
import { calendarOf, DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../core/clock.ts';
import type { WorldState } from '../state/worldState.ts';
import { tierOf } from '../state/worldState.ts';
import {
  COHORT,
  COHORT_COUNT,
  RES,
  RES_COUNT,
  SEVERITY,
  EVENT_TYPE,
  addCohort,
  addStock,
  appendChronicle,
  appendEvent,
  cohortOf,
  infraHas,
  populationOf,
  stockOf,
  INFRA,
} from './state.ts';

/** Design constants (docs/GDD.md §6–§9). Per-mille unless stated. */
export const RULE = {
  foodPerPerson: 1000, // milli-units per person per day (1.0 unit)
  waterPerPerson: 2000,
  fuelPerPerson: 150,
  baseBirthPm: 32, // 3.2 %/year
  baseDeathPm: 14,
  spoilagePm: 2, // per day
  starvationDeathPm: 900, // of unmet person-days
  migrationMaxPm: 80, // 8 % of population per month
  tierVillage: 60,
  tierTown: 500,
  tierCity: 5_000,
  tierMetropolis: 40_000,
} as const;

const SEASON_YIELD_PM = [150, 450, 1000, 550] as const; // winter..autumn
const OCC = { FARMERS: 0, EXTRACTORS: 1, CRAFTERS: 2, TRADERS: 3, SOLDIERS: 4 } as const;

const FLAG_RUINED = 1;
const FLAG_STARVING = 2;
const FLAG_DROUGHT = 4;

export function isAlive(world: WorldState, settlement: number): boolean {
  return (
    settlement < world.settlements.count &&
    ((world.society.flags[settlement] ?? 0) & FLAG_RUINED) === 0 &&
    populationOf(world.society, settlement) > 0
  );
}

function streamIndex(stream: number): number {
  return STREAM_IDS.indexOf(stream);
}

/** Run `fn` with a persisted stream, then store the advanced state. */
function withRng(world: WorldState, stream: number, fn: (rng: Rng) => void): void {
  const index = streamIndex(stream);
  const state: RngState | undefined = world.rngStates[index];
  if (!state) return;
  const rng = new Rng(state);
  fn(rng);
  world.rngStates[index] = rng.state;
}

function fertilePm(world: WorldState, settlement: number): number {
  const s = world.settlements;
  const i = (s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0);
  return 500 + (world.grids.fertility[i] ?? 0); // 0.5x .. 1.5x
}

function hasWaterAccess(world: WorldState, settlement: number): boolean {
  const s = world.settlements;
  const i = (s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0);
  return (world.grids.riverId[i] ?? 0) > 0 || (world.grids.lakeId[i] ?? 0) > 0 || ((world.society.infra[settlement] ?? 0) & (1 << 1)) !== 0;
}

// ------------------------------------------------------------------ climate (monthly)

export function runClimate(world: WorldState, day: number): void {
  const soc = world.society;
  if (day % DAYS_PER_MONTH !== 0) return;

  withRng(world, STREAM.CLIMATE, (rng) => {
    for (let r = 0; r < 16; r++) {
      soc.regionPrecip[r] = rng.range(60, 149);
      soc.regionTempAnomaly[r] = rng.range(-5, 5);
    }
  });

  for (let r = 0; r < 16; r++) {
    const precip = soc.regionPrecip[r] ?? 100;
    if (precip < 40) {
      const months = (soc.regionDroughtMonths[r] ?? 0) + 1;
      soc.regionDroughtMonths[r] = months > 255 ? 255 : months;
    } else {
      soc.regionDroughtMonths[r] = 0;
    }
  }

  // Per-settlement drought state derived from the real region of the settlement.
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    const region = (world.grids.regionId[tile] ?? 0) % 16;
    const flag = soc.flags[i] ?? 0;
    if ((soc.regionDroughtMonths[region] ?? 0) >= 2) {
      if ((flag & FLAG_DROUGHT) === 0) {
        soc.flags[i] = flag | FLAG_DROUGHT;
        soc.lastDroughtEvent[i] = appendEvent(world.society, day, EVENT_TYPE.DROUGHT, SEVERITY.NOTABLE, i, s.civ[i] ?? 0, 0, soc.regionDroughtMonths[region] ?? 0, 0);
      }
    } else if ((flag & FLAG_DROUGHT) !== 0) {
      soc.flags[i] = flag & ~FLAG_DROUGHT;
    }
  }
}

// ------------------------------------------------------------------ production (daily)

/** Add a fractional daily flow to a stock with an exact per-mille carry. */
function flow(world: WorldState, settlement: number, res: number, milli: number): number {
  const at = settlement * RES_COUNT + res;
  const total = (world.society.carry[at] ?? 0) + Math.max(0, milli);
  const units = Math.floor(total / 1000);
  world.society.carry[at] = total - units * 1000;
  return addStock(world.society, settlement, res, units);
}

export function runProduction(world: WorldState, day: number): void {
  const soc = world.society;
  const s = world.settlements;
  const season = calendarOf(day).season;
  const seasonal = SEASON_YIELD_PM[season] ?? 500;

  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = populationOf(soc, i);
    const farmers = cohortOf(soc, i, COHORT.FARMERS) + Math.floor(cohortOf(soc, i, COHORT.YOUTH) / 2);
    const extractors = cohortOf(soc, i, COHORT.EXTRACTORS);
    const crafters = cohortOf(soc, i, COHORT.CRAFTERS);
    const drought = ((soc.flags[i] ?? 0) & FLAG_DROUGHT) !== 0;

    // --- agriculture: 1 farmer feeds ~2.6 people at full season and fertility
    let milli = farmers * 2600;
    milli = mulDiv(milli, seasonal, 1000);
    milli = mulDiv(milli, drought ? 400 : 1000, 1000);
    milli = mulDiv(milli, fertilePm(world, i), 1000);
    if (infraHas(soc, i, INFRA.indexOf('irrigation'))) milli = mulDiv(milli, 1150, 1000);
    flow(world, i, RES.FOOD, milli);

    // --- water: local source or a well; a dry settlement cannot sustain its people
    const waterAccess = hasWaterAccess(world, i);
    flow(world, i, RES.WATER, Math.round(pop * (waterAccess ? 2200 : 700)));

    // --- fuel and materials from the actual resource mask at the settlement tile
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    const mask = world.grids.resource[tile] ?? 0;
    flow(world, i, RES.WOOD, extractors * ((mask & 4) !== 0 ? 1200 : 200));
    flow(world, i, RES.STONE, extractors * ((mask & 1) !== 0 ? 900 : 0));
    flow(world, i, RES.METAL, extractors * ((mask & 2) !== 0 ? 500 : 0));

    // --- craft: goods need metal and wood, one unit of each per two goods
    if (crafters > 0) {
      const wanted = crafters * 500; // milli-goods/day
      const metalAvail = stockOf(soc, i, RES.METAL) * 1000;
      const woodAvail = stockOf(soc, i, RES.WOOD) * 1000;
      const buildable = Math.min(wanted, metalAvail, woodAvail);
      if (buildable >= 1000) {
        const units = Math.floor(buildable / 1000);
        addStock(soc, i, RES.METAL, -units);
        addStock(soc, i, RES.WOOD, -units);
        flow(world, i, RES.GOODS, units * 1000);
      }
    }
  }
}

// ------------------------------------------------------------------ consumption (daily)

export function runConsumption(world: WorldState, day: number): void {
  const soc = world.society;
  const s = world.settlements;

  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = populationOf(soc, i);

    // spoilage first: 2‰/day, always at least 1 unit when there is food to lose
    const food = stockOf(soc, i, RES.FOOD);
    const spoil = Math.max(food > 0 ? 1 : 0, Math.floor((food * RULE.spoilagePm) / 1000));
    if (spoil > 0) addStock(soc, i, RES.FOOD, -spoil);

    const needFood = Math.ceil((pop * RULE.foodPerPerson) / 1000);
    const eaten = Math.min(stockOf(soc, i, RES.FOOD), needFood);
    addStock(soc, i, RES.FOOD, -eaten);
    const foodShortfall = needFood - eaten;

    const needWater = Math.ceil((pop * RULE.waterPerPerson) / 1000);
    const drank = Math.min(stockOf(soc, i, RES.WATER), needWater);
    addStock(soc, i, RES.WATER, -drank);
    const waterShortfall = needWater - drank;

    const needFuel = Math.ceil((pop * RULE.fuelPerPerson) / 1000);
    const burned = Math.min(stockOf(soc, i, RES.WOOD), needFuel);
    addStock(soc, i, RES.WOOD, -burned);
    const fuelShortfall = needFuel - burned;

    // --- health responds to the actual shortfalls and to density
    const densityPm = pop > 2500 ? 120 : 0;
    let health = soc.health[i] ?? 70;
    if (foodShortfall > 0) health -= Math.min(4, 1 + Math.floor(foodShortfall / Math.max(1, pop / 10)));
    else health += 1;
    if (waterShortfall > 0) health -= Math.min(3, 1 + Math.floor(waterShortfall / Math.max(1, pop)));
    if (fuelShortfall > 0) health -= 1;
    health -= Math.floor(densityPm / 60);
    if (infraHas(soc, i, INFRA.indexOf('well'))) health += 1;
    if (infraHas(soc, i, INFRA.indexOf('temple'))) health += 1;
    soc.health[i] = health < 0 ? 0 : health > 100 ? 100 : health;

    // --- stability: food and health first, then crowding and taxation
    let stability = soc.stability[i] ?? 60;
    stability += foodShortfall > 0 ? -3 : 1;
    stability += health >= 60 ? 1 : -1;
    if (pop > 20_000) stability -= 2;
    else if (pop > 5_000) stability -= 1;
    if ((soc.treasury[i] ?? 0) < 0) stability -= 1;
    soc.stability[i] = stability < 0 ? 0 : stability > 100 ? 100 : stability;

    // --- famine is a transition, not a every-day event
    const starving = foodShortfall > 0;
    const flags = soc.flags[i] ?? 0;
    if (starving && (flags & FLAG_STARVING) === 0) {
      soc.flags[i] = flags | FLAG_STARVING;
      const cause = soc.lastDroughtEvent[i] ?? 0;
      appendEvent(world.society, day, EVENT_TYPE.FAMINE, SEVERITY.MAJOR, i, s.civ[i] ?? 0, 0, foodShortfall, cause);
    } else if (!starving && (flags & FLAG_STARVING) !== 0) {
      soc.flags[i] = flags & ~FLAG_STARVING;
    }
  }
}

// ------------------------------------------------------------------ demography (monthly)

export function runDemographics(world: WorldState, day: number): void {
  const soc = world.society;
  const s = world.settlements;
  const months = 12;

  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = populationOf(soc, i);
    if (pop <= 0) continue;

    const health = soc.health[i] ?? 50;
    const starving = ((soc.flags[i] ?? 0) & FLAG_STARVING) !== 0;
    const densityPm = pop > 5000 ? 300 : pop > 500 ? 150 : 100;

    // births: 3.2 %/yr scaled by health, and halved while starving
    let birthPm = mulDiv(RULE.baseBirthPm, Math.max(0, 60 + health), 100);
    if (starving) birthPm = mulDiv(birthPm, 500, 1000);
    const births = Math.floor((pop * birthPm) / 1000 / months);
    addCohort(soc, i, COHORT.CHILDREN, births);

    // deaths: 1.4 %/yr, plus starvation and epidemic pressure (Stage 3 models starvation only)
    let deathPm = mulDiv(RULE.baseDeathPm, densityPm, 100);
    if (starving) deathPm += 120;
    if (health < 30) deathPm += 30;
    const deaths = Math.floor((pop * deathPm) / 1000 / months);

    // natural deaths are taken from elders first, then adults, then children — conservation-safe
    let remaining = deaths;
    const order = [COHORT.ELDERS, COHORT.SOLDIERS, COHORT.TRADERS, COHORT.CRAFTERS, COHORT.EXTRACTORS, COHORT.FARMERS, COHORT.YOUTH, COHORT.CHILDREN];
    for (const cohort of order) {
      if (remaining <= 0) break;
      const have = cohortOf(soc, i, cohort);
      const take = Math.min(have, remaining);
      if (take > 0) addCohort(soc, i, cohort, -take);
      remaining -= take;
    }

    // starvation kills the unmet person-days directly
    if (starving) {
      const extra = Math.max(0, Math.floor(pop / 400));
      let left = extra;
      for (const cohort of order) {
        if (left <= 0) break;
        const have = cohortOf(soc, i, cohort);
        const take = Math.min(have, left);
        if (take > 0) addCohort(soc, i, cohort, -take);
        left -= take;
      }
    }

    // count what actually left the cohorts, so the conservation identity is exact even for a tiny
    // settlement where the requested deaths exceed the people available
    world.counters.births += births;
    world.counters.deaths += deaths - remaining;
  }
}

// ------------------------------------------------------------------ ageing (yearly)

export function runAgeing(world: WorldState): void {
  const soc = world.society;
  for (let i = 0; i < world.settlements.count; i++) {
    if (!isAlive(world, i)) continue;
    const children = cohortOf(soc, i, COHORT.CHILDREN);
    const youth = cohortOf(soc, i, COHORT.YOUTH);
    const farmers = cohortOf(soc, i, COHORT.FARMERS);

    const toYouth = Math.floor(children / 15);
    const toFarmers = Math.floor(youth / 10);
    const toElders = Math.floor(farmers / 40);

    addCohort(soc, i, COHORT.CHILDREN, -toYouth);
    addCohort(soc, i, COHORT.YOUTH, toYouth - toFarmers);
    addCohort(soc, i, COHORT.FARMERS, toFarmers - toElders);
    addCohort(soc, i, COHORT.ELDERS, toElders);
  }
}

// ------------------------------------------------------------------ migration (monthly)

export function runMigration(world: WorldState, day: number): void {
  const soc = world.society;
  const s = world.settlements;
  if (s.count < 2) return;

  for (let from = 0; from < s.count; from++) {
    if (!isAlive(world, from)) continue;
    const pop = populationOf(soc, from);
    const starving = ((soc.flags[from] ?? 0) & FLAG_STARVING) !== 0;
    const stability = soc.stability[from] ?? 0;
    if (!starving && stability >= 25) continue;

    // nearest living settlement with a visible food surplus and room
    let best = -1;
    let bestDist = 1e9;
    for (let to = 0; to < s.count; to++) {
      if (to === from || !isAlive(world, to)) continue;
      if (stockOf(soc, to, RES.FOOD) < populationOf(soc, to)) continue;
      const dx = (s.x[to] ?? 0) - (s.x[from] ?? 0);
      const dy = (s.y[to] ?? 0) - (s.y[from] ?? 0);
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = to;
      }
    }
    if (best < 0 || bestDist > 64 * 64) continue;

    const movers = Math.floor((pop * RULE.migrationMaxPm) / 1000);
    if (movers <= 0) continue;

    // move people cohort by cohort so no person is created or lost
    let left = movers;
    for (let c = COHORT_COUNT - 1; c >= 0 && left > 0; c--) {
      if (c === COHORT.FARMERS) continue; // keep the food base in place
      const have = cohortOf(soc, from, c);
      const take = Math.min(have, left);
      if (take <= 0) continue;
      addCohort(soc, from, c, -take);
      addCohort(soc, best, c, take);
      left -= take;
    }
    const moved = movers - left;
    if (moved > 0) {
      world.counters.migrants += moved;
      appendEvent(world.society, day, EVENT_TYPE.MIGRATION_WAVE, SEVERITY.NOTABLE, from, s.civ[from] ?? 0, s.civ[best] ?? 0, moved, soc.lastDroughtEvent[from] ?? 0);
    }
  }
}

// ------------------------------------------------------------------ settlement life cycle (monthly)

export function runGrowth(world: WorldState, day: number): void {
  const soc = world.society;
  const s = world.settlements;

  for (let i = 0; i < s.count; i++) {
    if ((soc.flags[i] ?? 0) & FLAG_RUINED) continue;
    const pop = populationOf(soc, i);

    if (pop <= 0) {
      soc.flags[i] = (soc.flags[i] ?? 0) | FLAG_RUINED;
      world.counters.abandonments += 1;
      appendEvent(world.society, day, EVENT_TYPE.SETTLEMENT_ABANDONED, SEVERITY.HISTORIC, i, s.civ[i] ?? 0, 0, 0, 0);
      continue;
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

// ------------------------------------------------------------------ chronicle (yearly)

export function runChronicle(world: WorldState, day: number): void {
  if (day % DAYS_PER_YEAR !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  const year = Math.floor(day / DAYS_PER_YEAR);

  for (let c = 0; c < world.civs.count; c++) {
    let pop = 0;
    let settlements = 0;
    for (let i = 0; i < s.count; i++) {
      if ((s.civ[i] ?? 0) !== c) continue;
      if (((soc.flags[i] ?? 0) & FLAG_RUINED) !== 0) continue;
      pop += populationOf(soc, i);
      settlements++;
    }
    appendChronicle(soc, year, c, pop, settlements, 1);
  }

  // unbounded growth is impossible: the ring is fixed at 4096 entries
}

/** Population conservation check used by tests and the audit phase. */
export function totalPopulation(world: WorldState): number {
  let total = 0;
  for (let i = 0; i < world.settlements.count; i++) total += populationOf(world.society, i);
  return total;
}
