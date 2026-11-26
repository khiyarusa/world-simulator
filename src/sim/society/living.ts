/**
 * The living world: climate, ecology, production, consumption, health, demography, migration,
 * settlement life-cycle and the events they cause (docs/STAGE_3_DESIGN.md §7).
 *
 * Every rule here is integer/fixed-point and reads/writes only `WorldState`. No wall clock, no
 * `Math.random`, no renderer. Fractions are carried per settlement and resource so that 144,000 daily
 * steps conserve to the unit instead of drifting.
 */
import { STREAM } from '../../core/rng.ts';
import { mulDiv } from '../../core/math.ts';
import { calendarOf, DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../core/clock.ts';
import type { WorldState } from '../state/worldState.ts';
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
  EVENT_CAPACITY,
  cohortOf,
  infraHas,
  populationOf,
  stockOf,
  INFRA,
} from './state.ts';

/** Design constants (docs/GDD.md §6–§9). Per-mille unless stated. */
export const RULE = {
  foodPerPerson: 1000, // milli-units per person per day (1.0 unit)
  waterPerPerson: 1200,
  fuelPerPerson: 150,
  baseBirthPm: 34, // 3.4 %/year
  baseDeathPm: 12,
  spoilagePm: 1, // per day
  starvationDeathPm: 900, // of unmet person-days
  migrationMaxPm: 20, // 2 % of population per month
  tierVillage: 60,
  tierTown: 500,
  tierCity: 5_000,
  tierMetropolis: 40_000,
} as const;

// winter..autumn; the mean is ~0.85, so a settlement is viable at its labour share, not only in summer
const SEASON_YIELD_PM = [500, 800, 1100, 1000] as const;

import { FLAG_DROUGHT, FLAG_RUINED, FLAG_STARVING, isAlive } from './common.ts';
import { landCapacity } from './economy.ts';
import { withStream } from './streams.ts';
import { retainEvent } from './vital.ts';

export { isAlive } from './common.ts';

const withRng = withStream;

function fertilePm(world: WorldState, settlement: number): number {
  const s = world.settlements;
  const i = (s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0);
  // fertility is 0..255; the multiplier is 0.7x..1.5x, matching the land-capacity model
  return 700 + (world.grids.fertility[i] ?? 0) * 3;
}

function hasWaterAccess(world: WorldState, settlement: number): boolean {
  const s = world.settlements;
  const i = (s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0);
  const infra = world.society.infra[settlement] ?? 0;
  return (
    (world.grids.riverId[i] ?? 0) > 0 ||
    (world.grids.lakeId[i] ?? 0) > 0 ||
    (infra & (1 << 1)) !== 0 || // well
    (infra & (1 << 9)) !== 0 // aqueduct
  );
}

// ------------------------------------------------------------------ climate (monthly)

export function runClimate(world: WorldState, day: number): void {
  const soc = world.society;
  if (day % DAYS_PER_MONTH !== 0) return;

  withRng(world, STREAM.CLIMATE, (rng) => {
    for (let r = 0; r < 16; r++) {
      // 20..180 per-mille of normal: the <40 drought threshold must be reachable (~12 % of months)
      soc.regionPrecip[r] = rng.range(20, 180);
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
        soc.historyDay[i * 3] = day;
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
  const added = addStock(world.society, settlement, res, units);
  if (res === RES.FOOD) world.counters.foodProduced += added;
  return added;
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

    // --- agriculture: labour x land. Yield per farmer falls as the settlement approaches the arable
    // capacity of its own tiles, which is what gives a settlement a carrying capacity at all.
    const landCap = landCapacity(world, i);
    const landPm = pop > 0 ? Math.min(1000, Math.max(300, Math.floor((landCap * 1000) / pop))) : 1000;
    const civ = s.civ[i] ?? 0;
    const agriTech = (soc.tech[civ * 12] ?? 0) + (soc.tech[civ * 12 + 1] ?? 0) + (soc.tech[civ * 12 + 2] ?? 0);
    const indTech = (soc.tech[civ * 12 + 3] ?? 0) + (soc.tech[civ * 12 + 4] ?? 0) + (soc.tech[civ * 12 + 5] ?? 0);
    let milli = farmers * 8000;
    milli = mulDiv(milli, seasonal, 1000);
    milli = mulDiv(milli, drought ? 400 : 1000, 1000);
    milli = mulDiv(milli, fertilePm(world, i), 1000);
    milli = mulDiv(milli, landPm, 1000);
    milli = mulDiv(milli, 1000 + agriTech * 80, 1000);
    if (infraHas(soc, i, INFRA.indexOf('irrigation'))) milli = mulDiv(milli, 1150, 1000);
    if ((soc.occupier[i] ?? 0) !== 0) milli = mulDiv(milli, 800, 1000); // an occupied settlement produces less
    flow(world, i, RES.FOOD, milli);

    // --- water: local source or a well; a dry settlement cannot sustain its people
    const waterAccess = hasWaterAccess(world, i);
    // every settlement has some local water; a river, lake, well or aqueduct makes the difference
    flow(world, i, RES.WATER, Math.round(pop * (waterAccess ? 2200 : 1400)));

    // --- fuel and materials from the actual resource mask at the settlement tile
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    const mask = world.grids.resource[tile] ?? 0;
    const extraction = mulDiv(1000 + indTech * 80, (soc.occupier[i] ?? 0) !== 0 ? 800 : 1000, 1000);
    flow(world, i, RES.WOOD, mulDiv(extractors * ((mask & 4) !== 0 ? 3000 : 1500), extraction, 1000));
    flow(world, i, RES.STONE, mulDiv(extractors * ((mask & 1) !== 0 ? 2000 : 0), extraction, 1000));
    flow(world, i, RES.METAL, mulDiv(extractors * ((mask & 2) !== 0 ? 1200 : 0), extraction, 1000));

    // --- craft: goods need metal and wood, one unit of each per two goods
    if (crafters > 0) {
      let wanted = crafters * 500; // milli-goods/day
      if (infraHas(soc, i, INFRA.indexOf('workshop'))) wanted = mulDiv(wanted, 1250, 1000);
      wanted = mulDiv(wanted, 1000 + indTech * 100, 1000);
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
    world.counters.foodConsumed += eaten;
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
    if (infraHas(soc, i, INFRA.indexOf('aqueduct'))) health += 2;
    if (infraHas(soc, i, INFRA.indexOf('temple'))) health += 1;
    soc.health[i] = health < 0 ? 0 : health > 100 ? 100 : health;

    // --- stability: food and health first, then crowding and taxation
    let stability = soc.stability[i] ?? 60;
    stability += foodShortfall > 0 ? -3 : 1;
    stability += health >= 60 ? 1 : -1;
    if (pop > 20_000) stability -= 2;
    else if (pop > 5_000) stability -= 1;
    if ((soc.occupier[i] ?? 0) !== 0) stability -= 2;
    if (infraHas(soc, i, INFRA.indexOf('temple'))) stability += 1;
    if ((soc.treasury[i] ?? 0) < 0) stability -= 1;
    soc.stability[i] = stability < 0 ? 0 : stability > 100 ? 100 : stability;

    // --- famine is a sustained shortage, not an every-day flag flip. It needs 15 consecutive
    // shortfall days and at most one event per year; a recurrence within five years is notable rather
    // than historic, so the vital ring is not flooded by a settlement that is merely hungry.
    const starving = foodShortfall > 0;
    const flags = soc.flags[i] ?? 0;
    const shortStart = soc.historyDay[i * 3 + 2] ?? 0;
    if (starving) {
      if (shortStart === 0) soc.historyDay[i * 3 + 2] = day;
      if ((flags & FLAG_STARVING) === 0) soc.flags[i] = flags | FLAG_STARVING;
      const sustained = day - (soc.historyDay[i * 3 + 2] ?? day) >= 15;
      const lastFamine = soc.historyDay[i * 3 + 1] ?? 0;
      if (sustained && day - lastFamine >= 360) {
        const droughtCause = soc.lastDroughtEvent[i] ?? 0;
        const freshDrought = day - (soc.historyDay[i * 3] ?? 0) <= 720;
        const cause = droughtCause > 0 && freshDrought ? droughtCause : -1;
        if (cause > 0) retainEvent(soc, cause);
        // only a substantial deficit is historic; ordinary hunger stays notable and out of the vital ring
        const severity = foodShortfall * 4 >= needFood ? SEVERITY.MAJOR : SEVERITY.NOTABLE;
        soc.lastFamineEvent[i] = appendEvent(
          world.society,
          day,
          EVENT_TYPE.FAMINE,
          severity,
          i,
          s.civ[i] ?? 0,
          0,
          foodShortfall,
          cause,
        );
        soc.historyDay[i * 3 + 1] = day;
      }
    } else {
      soc.historyDay[i * 3 + 2] = 0;
      if ((flags & FLAG_STARVING) !== 0) soc.flags[i] = flags & ~FLAG_STARVING;
    }
  }
}

// ------------------------------------------------------------------ demography (monthly)

export function runDemographics(world: WorldState): void {
  const soc = world.society;
  const s = world.settlements;
  // annual cadence: at monthly cadence a 100-person settlement floors every birth to zero
  const months = 1;

  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = populationOf(soc, i);
    if (pop <= 0) continue;

    const health = soc.health[i] ?? 50;
    const starving = ((soc.flags[i] ?? 0) & FLAG_STARVING) !== 0;
    const densityPm = pop > 5000 ? 300 : pop > 500 ? 150 : 100;

    // births: 3.2 %/yr scaled by health AND by the food reserve. Fertility falling before reserves run
    // out is what turns a hard overshoot into a soft landing (the balance harness showed the overshoot).
    const reserveDays = Math.floor(stockOf(soc, i, RES.FOOD) / Math.max(1, pop));
    const reservePm = Math.min(1000, Math.max(400, reserveDays * 18));
    let birthPm = mulDiv(RULE.baseBirthPm, Math.max(0, 60 + health), 100);
    birthPm = mulDiv(birthPm, reservePm, 1000);
    if (starving) birthPm = mulDiv(birthPm, 400, 1000);
    const births = Math.floor((pop * birthPm) / 1000 / months);
    addCohort(soc, i, COHORT.CHILDREN, births);

    // deaths: 1.4 %/yr, plus starvation and epidemic pressure (Stage 3 models starvation only)
    let deathPm = mulDiv(RULE.baseDeathPm, densityPm, 100);
    if (starving) deathPm += 40;
    if (health < 30) deathPm += 20;
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

    // starvation kills the unmet person-days directly, and those deaths are counted too
    let starved = 0;
    if (starving) {
      const extra = Math.max(0, Math.floor(pop / 1200));
      let left = extra;
      for (const cohort of order) {
        if (left <= 0) break;
        const have = cohortOf(soc, i, cohort);
        const take = Math.min(have, left);
        if (take > 0) addCohort(soc, i, cohort, -take);
        left -= take;
      }
      starved = extra - left;
    }

    // count what actually left the cohorts, so the conservation identity is exact even for a tiny
    // settlement where the requested deaths exceed the people available
    world.counters.births += births;
    world.counters.deaths += deaths - remaining + starved;
    world.counters.starvationDeaths += starved;
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
    // Only a genuinely failing settlement empties itself; a hungry but stable one stays and recovers,
    // and a remnant always remains (otherwise a bad year deletes a settlement's labour base).
    if (!starving && stability >= 20) continue;
    if (pop <= 60) continue;

    // nearest living settlement with a visible food surplus and room
    let best = -1;
    let bestDist = 1e9;
    for (let to = 0; to < s.count; to++) {
      if (to === from || !isAlive(world, to)) continue;
      // the destination must be able to feed the newcomers, not merely have *some* food
      if (stockOf(soc, to, RES.FOOD) < populationOf(soc, to) * 45) continue;
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

// ------------------------------------------------------------------ chronicle (yearly)

export function runChronicle(world: WorldState, day: number): void {
  if (day % DAYS_PER_YEAR !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  const year = Math.floor(day / DAYS_PER_YEAR);

  // one pass over the ring counts the real notable events of the elapsed year, per civilization
  const notable = new Int32Array(12);
  for (let k = 0; k < soc.eventCount; k++) {
    const i = (soc.eventHead - soc.eventCount + k + EVENT_CAPACITY * 2) % EVENT_CAPACITY;
    if ((soc.eventDay[i] ?? 0) <= day - DAYS_PER_YEAR) continue;
    if ((soc.eventSeverity[i] ?? 0) < SEVERITY.NOTABLE) continue;
    const civ = soc.eventActorA[i] ?? 0;
    if (civ < 12) notable[civ] = (notable[civ] ?? 0) + 1;
  }

  for (let c = 0; c < world.civs.count; c++) {
    let pop = 0;
    let settlements = 0;
    for (let i = 0; i < s.count; i++) {
      if ((s.civ[i] ?? 0) !== c) continue;
      if (((soc.flags[i] ?? 0) & FLAG_RUINED) !== 0) continue;
      pop += populationOf(soc, i);
      settlements++;
    }
    appendChronicle(soc, year, c, pop, settlements, notable[c] ?? 0);
  }
}

/**
 * One authoritative population representation (D-42): cohorts. The legacy `settlements.pop` array is a
 * projection of them, refreshed once per tick so every existing consumer (mirror, query, checksum,
 * save metadata) reads a value that cannot disagree with the simulation.
 */
export function syncPopulation(world: WorldState): void {
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    s.pop[i] = populationOf(world.society, i);
  }
}

/** Population conservation check used by tests and the audit phase. */
export function totalPopulation(world: WorldState): number {
  let total = 0;
  for (let i = 0; i < world.settlements.count; i++) total += populationOf(world.society, i);
  return total;
}
