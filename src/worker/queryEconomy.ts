/** Economy, ecology and player-intervention state. */
import type { WorldState } from '../sim/state/worldState.ts';
import { DAYS_PER_YEAR } from '../core/clock.ts';
import { DECISION_CAPACITY, INTERVENTION, INTERVENTION_NAMES, RES_COUNT, RES_NAMES, populationOf, stockOf } from '../sim/society/state.ts';
import { FLAG_BLIGHT, FLAG_DROUGHT, isAlive } from '../sim/society/common.ts';
import { cooldownOf, listInterventions, type InterventionRow } from '../sim/society/interventions.ts';
import type { DecisionView, EconomyView, EcologyView, InterventionInfo, RouteView, SettlementEcology } from './queryTypes.ts';
import { clampLimit } from './queryUtil.ts';
import { civNameOf, settlementNameOf } from './queryNames.ts';
import { querySeries } from './queryEvents.ts';

export function queryEconomy(world: WorldState, civ: number | undefined): EconomyView {
  const soc = world.society;
  const s = world.settlements;
  let population = 0;
  let treasury = 0;
  const totals = new Array<number>(RES_COUNT).fill(0);
  const caps = new Array<number>(RES_COUNT).fill(0);
  const minPrice = new Array<number>(RES_COUNT).fill(999999);
  const maxPrice = new Array<number>(RES_COUNT).fill(0);
  const priceSum = new Array<number>(RES_COUNT).fill(0);
  const priceCount = new Array<number>(RES_COUNT).fill(0);
  const scarcity = new Array<number>(RES_COUNT).fill(0);
  const shortages: { settlement: number; name: string; resource: number; days: number }[] = [];
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    if (civ !== undefined && (s.civ[i] ?? 0) !== civ) continue;
    const pop = Math.max(1, populationOf(soc, i));
    population += populationOf(soc, i);
    treasury += soc.treasury[i] ?? 0;
    for (let r = 0; r < RES_COUNT; r++) {
      totals[r] = (totals[r] ?? 0) + stockOf(soc, i, r);
      caps[r] = (caps[r] ?? 0) + (soc.cap[i * RES_COUNT + r] ?? 0);
      const price = soc.price[i * RES_COUNT + r] ?? 1000;
      minPrice[r] = Math.min(minPrice[r] ?? price, price);
      maxPrice[r] = Math.max(maxPrice[r] ?? price, price);
      priceSum[r] = (priceSum[r] ?? 0) + price;
      priceCount[r] = (priceCount[r] ?? 0) + 1;
      if (price >= 1500) scarcity[r] = (scarcity[r] ?? 0) + 1;
    }
    const foodDays = Math.floor(stockOf(soc, i, 0) / pop);
    const waterDays = Math.floor(stockOf(soc, i, 1) / pop);
    if (foodDays < 10) shortages.push({ settlement: i, name: settlementNameOf(world, i), resource: 0, days: foodDays });
    if (waterDays < 5) shortages.push({ settlement: i, name: settlementNameOf(world, i), resource: 1, days: waterDays });
  }
  const routes: RouteView[] = [];
  for (let k = 0; k < soc.routeCount; k++) {
    const a = soc.routeA[k] ?? 0;
    const b = soc.routeB[k] ?? 0;
    if (!isAlive(world, a) || !isAlive(world, b)) continue;
    if (civ !== undefined && (s.civ[a] ?? 0) !== civ && (s.civ[b] ?? 0) !== civ) continue;
    routes.push({
      id: k,
      from: a,
      to: b,
      fromName: settlementNameOf(world, a),
      toName: settlementNameOf(world, b),
      capacity: soc.routeCapacity[k] ?? 0,
      length: soc.routeLength[k] ?? 0,
      tariff: soc.routeTariff[k] ?? 0,
      volume: soc.routeVolume[k] ?? 0,
      active: (soc.routeIdle[k] ?? 0) === 0,
    });
  }
  routes.sort((a, b) => b.volume - a.volume);
  return {
    population,
    treasury,
    foodProduced: world.counters.foodProduced,
    foodConsumed: world.counters.foodConsumed,
    tradeVolume: world.counters.tradeVolume,
    taxCollected: world.counters.taxCollected,
    tributePaid: world.counters.tributePaid,
    routesOpened: world.counters.routesOpened,
    routesLost: world.counters.routesLost,
    resources: totals.map((stock, r) => ({
      id: r,
      name: RES_NAMES[r] ?? 'resource',
      stock,
      cap: caps[r] ?? 0,
      avgPrice: (priceCount[r] ?? 0) > 0 ? Math.round((priceSum[r] ?? 0) / (priceCount[r] ?? 1)) : 1000,
      minPrice: minPrice[r] === 999999 ? 1000 : minPrice[r]!,
      maxPrice: maxPrice[r] === 0 ? 1000 : maxPrice[r]!,
      scarcity: scarcity[r] ?? 0,
    })),
    routes,
    shortages,
    series: querySeries(world),
  };
}

export function queryEcology(world: WorldState, settlement: number | undefined): EcologyView {
  const soc = world.society;
  const s = world.settlements;
  let fert = 0;
  let veg = 0;
  let moist = 0;
  let temp = 0;
  let living = 0;
  let drought = 0;
  let blight = 0;
  const regionSettlements = new Array<number>(16).fill(0);
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    fert += world.grids.fertility[tile] ?? 0;
    veg += world.grids.vegetation[tile] ?? 0;
    moist += world.grids.moisture[tile] ?? 0;
    temp += world.grids.temperature[tile] ?? 0;
    living++;
    if (((soc.flags[i] ?? 0) & FLAG_DROUGHT) !== 0) drought++;
    if (((soc.flags[i] ?? 0) & FLAG_BLIGHT) !== 0) blight++;
    const region = (world.grids.regionId[tile] ?? 0) % 16;
    regionSettlements[region] = (regionSettlements[region] ?? 0) + 1;
  }
  const regions: Array<EcologyView['regions'][number]> = [];
  for (let r = 0; r < 16; r++) {
    regions.push({
      id: r,
      precip: soc.regionPrecip[r] ?? 100,
      tempAnomaly: soc.regionTempAnomaly[r] ?? 0,
      droughtMonths: soc.regionDroughtMonths[r] ?? 0,
      settlements: regionSettlements[r] ?? 0,
    });
  }
  const hazards: Array<EcologyView['hazards'][number]> = [];
  for (const row of listInterventions(soc, world.day)) {
    if (!row.active) continue;
    if (row.kind !== INTERVENTION.BLIGHT && row.kind !== INTERVENTION.FERTILIZE) continue;
    hazards.push({
      kind: INTERVENTION_NAMES[row.kind] ?? 'effect',
      settlement: row.a,
      name: settlementNameOf(world, row.a),
      intensity: row.intensity,
      endDay: row.endDay,
    });
  }
  const local = settlement === undefined ? null : settlementEcology(world, settlement);
  return {
    averageFertility: living > 0 ? Math.round(fert / living) : 0,
    averageVegetation: living > 0 ? Math.round(veg / living) : 0,
    averageMoisture: living > 0 ? Math.round(moist / living) : 0,
    averageTemperature: living > 0 ? Math.round(temp / living) : 0,
    droughtSettlements: drought,
    blightSettlements: blight,
    regions,
    hazards,
    local,
  };
}

export function settlementEcology(world: WorldState, id: number): SettlementEcology | null {
  const s = world.settlements;
  if (!Number.isInteger(id) || id < 0 || id >= s.count) return null;
  const soc = world.society;
  const tile = (s.y[id] ?? 0) * world.width + (s.x[id] ?? 0);
  const flags = soc.flags[id] ?? 0;
  return {
    settlement: id,
    name: settlementNameOf(world, id),
    fertility: world.grids.fertility[tile] ?? 0,
    vegetation: world.grids.vegetation[tile] ?? 0,
    moisture: world.grids.moisture[tile] ?? 0,
    temperature: world.grids.temperature[tile] ?? 0,
    drought: (flags & FLAG_DROUGHT) !== 0,
    blight: (flags & FLAG_BLIGHT) !== 0,
  };
}

export function queryDecisions(world: WorldState, limitIn: number | undefined): DecisionView[] {
  const soc = world.society;
  const limit = clampLimit(limitIn, 40, DECISION_CAPACITY);
  const out: DecisionView[] = [];
  for (let n = 0; n < soc.decisionCount && out.length < limit; n++) {
    const i = (soc.decisionHead - 1 - n + DECISION_CAPACITY * 2) % DECISION_CAPACITY;
    const actor = soc.decisionActor[i] ?? 0;
    out.push({
      index: i,
      day: soc.decisionDay[i] ?? 0,
      year: Math.floor(((soc.decisionDay[i] ?? 1) - 1) / DAYS_PER_YEAR) + 1,
      kind: soc.decisionKind[i] ?? 0,
      actor,
      actorName: actor < world.civs.count ? civNameOf(world, actor) : settlementNameOf(world, actor),
      chosen: soc.decisionChosen[i] ?? 0,
      score: soc.decisionScore[i] ?? 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------ interventions

function interventionLabel(world: WorldState, row: InterventionRow): string {
  if (row.kind === INTERVENTION.INCITE) return `${civNameOf(world, row.a)} ↔ ${civNameOf(world, row.b)}`;
  return settlementNameOf(world, row.a);
}

export function queryInterventions(world: WorldState): InterventionInfo[] {
  const soc = world.society;
  const rows = listInterventions(soc, world.day);
  const out: InterventionInfo[] = [];
  for (let kind = 0; kind < 4; kind++) {
    const cd = cooldownOf(soc, world.day, kind);
    const mine = rows.filter((r) => r.kind === kind);
    out.push({
      kind,
      name: INTERVENTION_NAMES[kind] ?? 'unknown',
      lastDay: cd.lastDay,
      cooldownDays: cd.cooldownDays,
      remainingDays: cd.remainingDays,
      ready: cd.ready,
      active: mine
        .filter((r) => r.active)
        .map((r) => ({ a: r.a, b: r.b, label: interventionLabel(world, r), startDay: r.startDay, endDay: r.endDay, intensity: r.intensity })),
      history: mine.map((r) => ({
        kind: r.kind,
        a: r.a,
        b: r.b,
        label: interventionLabel(world, r),
        startDay: r.startDay,
        endDay: r.endDay,
        intensity: r.intensity,
        amount: r.amount,
        active: r.active,
      })),
    });
  }
  return out;
}
