/**
 * Primary query projections: world, settlement and civilization. History and layered views live in
 * dedicated modules and are re-exported here so the worker has one import surface.
 */
import type { WorldState } from '../sim/state/worldState.ts';
import { calendarOf } from '../core/clock.ts';
import { seedToText } from '../core/seed.ts';
import { COHORT_COUNT, COHORT_NAMES, CIV_STRIDE, INFRA, RES_COUNT, SETTLEMENT_TREND_SAMPLES, TECH_NAME, TREATY_NAMES, populationOf, stockOf } from '../sim/society/state.ts';
import { FLAG_BLIGHT, FLAG_DROUGHT, FLAG_RUINED, FLAG_STARVING, civSettlementCount, hasTreaty, isAlive, relationOf } from '../sim/society/common.ts';
import { blessMaxAmount } from '../sim/society/interventions.ts';
import { ruinedCount } from '../sim/society/stats.ts';
import { evaluateWarGate } from '../sim/society/war.ts';
import type { CivSummary, CivView, EventView, RouteView, SettlementSummary, SettlementView, WorldView, QueryContext } from './queryTypes.ts';
import { biomeNameOf, civNameOf, settlementNameOf } from './queryNames.ts';
import { allEvents, eventView, querySeries } from './queryEvents.ts';
import { queryInterventions } from './queryEconomy.ts';
import { clampLimit, clampOffset } from './queryUtil.ts';

export type * from './queryTypes.ts';
export { eventCategory, queryHistory, queryEvent, queryChronicle, querySeries } from './queryEvents.ts';
export { queryEconomy, queryEcology, settlementEcology, queryInterventions, queryDecisions } from './queryEconomy.ts';
export { queryLayer } from './queryLayers.ts';
export { queryCampaign } from './queryCampaign.ts';
export { biomeNameOf } from './queryNames.ts';

// ------------------------------------------------------------------ world / settlement / civ

export function queryWorld(world: WorldState, ctx: QueryContext): WorldView {
  const cal = calendarOf(world.day);
  let living = 0;
  for (let i = 0; i < world.settlements.count; i++) if (isAlive(world, i)) living++;
  return {
    day: world.day,
    year: cal.year,
    season: cal.season,
    seasonName: cal.seasonName,
    monthName: cal.monthName,
    dayOfMonth: cal.dayOfMonth,
    width: world.width,
    height: world.height,
    seaLevel: world.seaLevel,
    seedText: seedToText(world.recipe.seed),
    preset: world.recipe.preset,
    recipe: {
      water: world.recipe.water,
      harshness: world.recipe.harshness,
      peoples: world.recipe.peoples,
      generatorVersion: world.recipe.generatorVersion,
    },
    population: world.settlements.pop.reduce((sum, v, i) => (i < world.settlements.count ? sum + v : sum), 0),
    settlements: world.settlements.count,
    livingSettlements: living,
    ruinedSettlements: ruinedCount(world),
    civs: world.civs.count,
    landFraction: world.report.landFraction,
    checksum: 0,
    speed: ctx.speed,
    paused: ctx.speed === 0,
    counters: { ...world.counters },
    series: querySeries(world),
    interventions: queryInterventions(world),
  };
}

export function settlementSummary(world: WorldState, id: number): SettlementSummary {
  const s = world.settlements;
  return {
    id,
    name: settlementNameOf(world, id),
    civId: s.civ[id] ?? 0,
    civName: civNameOf(world, s.civ[id] ?? 0),
    x: s.x[id] ?? 0,
    y: s.y[id] ?? 0,
    pop: populationOf(world.society, id),
    tier: s.tier[id] ?? 0,
    biome: world.grids.biome[(s.y[id] ?? 0) * world.width + (s.x[id] ?? 0)] ?? 0,
    alive: isAlive(world, id),
  };
}

export function querySettlement(world: WorldState, id: number): SettlementView | null {
  const s = world.settlements;
  if (!Number.isInteger(id) || id < 0 || id >= s.count) return null;
  const soc = world.society;
  const tile = (s.y[id] ?? 0) * world.width + (s.x[id] ?? 0);
  const civId = s.civ[id] ?? 0;
  const pop = populationOf(soc, id);
  const stock: number[] = [];
  const cap: number[] = [];
  const price: number[] = [];
  for (let r = 0; r < RES_COUNT; r++) {
    stock.push(stockOf(soc, id, r));
    cap.push(soc.cap[id * RES_COUNT + r] ?? 0);
    price.push(soc.price[id * RES_COUNT + r] ?? 1000);
  }
  const cohorts: number[] = [];
  for (let c = 0; c < COHORT_COUNT; c++) cohorts.push(soc.cohorts[id * COHORT_COUNT + c] ?? 0);
  const occShare: number[] = [];
  for (let k = 0; k < 5; k++) occShare.push(soc.occShare[id * 5 + k] ?? 0);
  const infraNames: string[] = [];
  for (let bit = 0; bit < INFRA.length; bit++) if (((soc.infra[id] ?? 0) & (1 << bit)) !== 0) infraNames.push(INFRA[bit] ?? '');
  const flags = soc.flags[id] ?? 0;
  const daysOfFood = pop > 0 ? Math.floor(stock[0]! / pop) : 0;
  const daysOfWater = pop > 0 ? Math.floor(stock[1]! / pop) : 0;
  const risks: { code: string; severity: number }[] = [];
  if ((flags & FLAG_RUINED) !== 0) risks.push({ code: 'ruined', severity: 3 });
  if ((flags & FLAG_STARVING) !== 0) risks.push({ code: 'starving', severity: 3 });
  if ((flags & FLAG_DROUGHT) !== 0) risks.push({ code: 'drought', severity: 2 });
  if ((flags & FLAG_BLIGHT) !== 0) risks.push({ code: 'blight', severity: 3 });
  if (daysOfFood < 10) risks.push({ code: 'low_food', severity: 2 });
  if (daysOfWater < 5) risks.push({ code: 'low_water', severity: 2 });
  if ((soc.health[id] ?? 60) < 40) risks.push({ code: 'poor_health', severity: 2 });
  if ((soc.stability[id] ?? 60) < 30) risks.push({ code: 'unrest', severity: 2 });
  if ((soc.occupier[id] ?? 0) !== 0) risks.push({ code: 'occupied', severity: 3 });

  const trend: number[] = [];
  const trendCount = soc.trendCount[id] ?? 0;
  for (let k = 0; k < trendCount; k++) trend.push(soc.trendPop[id * SETTLEMENT_TREND_SAMPLES + k] ?? 0);

  const routes: RouteView[] = [];
  for (let k = 0; k < soc.routeCount; k++) {
    const a = soc.routeA[k] ?? 0;
    const b = soc.routeB[k] ?? 0;
    if (a !== id && b !== id) continue;
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

  const recentEvents: EventView[] = [];
  const all = allEvents(world);
  for (let n = all.length - 1; n >= 0 && recentEvents.length < 8; n--) {
    const e = all[n];
    if (!e || (e.place !== id && e.actorA !== civId && e.actorB !== civId)) continue;
    recentEvents.push(eventView(world, e));
  }

  const blessMax: number[] = [];
  for (let r = 0; r < RES_COUNT; r++) blessMax.push(blessMaxAmount(world, id, r));

  return {
    id,
    name: settlementNameOf(world, id),
    civId,
    civName: civNameOf(world, civId),
    x: s.x[id] ?? 0,
    y: s.y[id] ?? 0,
    pop,
    tier: s.tier[id] ?? 0,
    foundedDay: s.foundedDay[id] ?? 1,
    biome: world.grids.biome[tile] ?? 0,
    biomeName: biomeNameOf(world.grids.biome[tile] ?? 0),
    riverId: world.grids.riverId[tile] ?? 0,
    lakeId: world.grids.lakeId[tile] ?? 0,
    region: (world.grids.regionId[tile] ?? 0) % 16,
    fertility: world.grids.fertility[tile] ?? 0,
    vegetation: world.grids.vegetation[tile] ?? 0,
    moisture: world.grids.moisture[tile] ?? 0,
    temperature: world.grids.temperature[tile] ?? 0,
    resource: world.grids.resource[tile] ?? 0,
    owner: world.grids.owner[tile] ?? 0,
    alive: isAlive(world, id),
    health: soc.health[id] ?? 0,
    stability: soc.stability[id] ?? 0,
    literacy: soc.literacy[id] ?? 0,
    treasury: soc.treasury[id] ?? 0,
    stock,
    cap,
    price,
    cohorts,
    cohortNames: [...COHORT_NAMES],
    occShare,
    infra: soc.infra[id] ?? 0,
    infraNames,
    flags,
    occupier: soc.occupier[id] ?? 0,
    occupierName: (soc.occupier[id] ?? 0) > 0 ? civNameOf(world, (soc.occupier[id] ?? 1) - 1) : '',
    surplusYears: soc.surplusYears[id] ?? 0,
    lastDroughtEvent: soc.lastDroughtEvent[id] ?? 0,
    lastFamineEvent: soc.lastFamineEvent[id] ?? 0,
    trend,
    blessMax,
    daysOfFood,
    daysOfWater,
    risks,
    routes,
    recentEvents,
    civilization: {
      id: civId,
      name: civNameOf(world, civId),
      capital: (world.civs.capital[civId] ?? -1) === id,
      legitimacy: soc.legitimacy[civId] ?? 0,
      colorIdx: world.civs.colorIdx[civId] ?? 0,
    },
  };
}

export function querySettlements(world: WorldState, offsetIn: number | undefined, limitIn: number | undefined): { total: number; offset: number; rows: SettlementSummary[] } {
  const offset = clampOffset(offsetIn);
  const limit = clampLimit(limitIn, 40, 200);
  const rows: SettlementSummary[] = [];
  for (let i = 0; i < world.settlements.count; i++) rows.push(settlementSummary(world, i));
  rows.sort((a, b) => b.pop - a.pop);
  return { total: rows.length, offset, rows: rows.slice(offset, offset + limit) };
}

export function civSummary(world: WorldState, id: number): CivSummary {
  const soc = world.society;
  const cap = world.civs.capital[id] ?? 0;
  let atWar = false;
  for (let k = 0; k < soc.warCount; k++) {
    if ((soc.warA[k] ?? 0) === id || (soc.warB[k] ?? 0) === id) atWar = true;
  }
  let population = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if ((world.settlements.civ[i] ?? 0) === id && isAlive(world, i)) population += populationOf(soc, i);
  }
  return {
    id,
    name: civNameOf(world, id),
    capital: cap,
    capitalName: settlementNameOf(world, cap),
    colorIdx: world.civs.colorIdx[id] ?? 0,
    population,
    settlements: civSettlementCount(world, id),
    legitimacy: soc.legitimacy[id] ?? 0,
    army: soc.army[id] ?? 0,
    exhaustion: soc.exhaustion[id] ?? 0,
    atWar,
  };
}

export function queryCivs(world: WorldState): CivSummary[] {
  const out: CivSummary[] = [];
  for (let c = 0; c < world.civs.count; c++) out.push(civSummary(world, c));
  return out.sort((a, b) => b.population - a.population);
}

export function queryCiv(world: WorldState, id: number): CivView | null {
  if (!Number.isInteger(id) || id < 0 || id >= world.civs.count) return null;
  const soc = world.society;
  const summary = civSummary(world, id);
  const culture: number[] = [];
  for (let k = 0; k < 3; k++) culture.push(soc.culture[id * 3 + k] ?? 0);
  const tech: number[] = [];
  const techProgress: number[] = [];
  for (let k = 0; k < 12; k++) {
    tech.push(soc.tech[id * 12 + k] ?? 0);
    techProgress.push(soc.techProgress[id * 12 + k] ?? 0);
  }
  let treasury = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if ((world.settlements.civ[i] ?? 0) === id && isAlive(world, i)) treasury += soc.treasury[i] ?? 0;
  }

  const relations: Array<CivView['relations'][number]> = [];
  const treaties: Array<CivView['treaties'][number]> = [];
  const wars: Array<CivView['wars'][number]> = [];
  for (let other = 0; other < world.civs.count; other++) {
    if (other === id) continue;
    let war = false;
    for (let k = 0; k < soc.warCount; k++) {
      const a = soc.warA[k] ?? 0;
      const b = soc.warB[k] ?? 0;
      if ((a === id && b === other) || (a === other && b === id)) war = true;
    }
    let treaty: string | null = null;
    for (let type = 1; type <= 5; type++) {
      if (hasTreaty(soc, id, other, type)) {
        treaty = TREATY_NAMES[type] ?? null;
        break;
      }
    }
    relations.push({
      civ: other,
      name: civNameOf(world, other),
      relation: relationOf(soc, id, other),
      grievance: soc.grievance[id * CIV_STRIDE + other] ?? 0,
      war,
      treaty,
    });
  }
  for (let k = 0; k < soc.treatyCount; k++) {
    const a = soc.treatyA[k] ?? 0;
    const b = soc.treatyB[k] ?? 0;
    if (a !== id && b !== id) continue;
    const other = a === id ? b : a;
    treaties.push({
      withCiv: other,
      withName: civNameOf(world, other),
      type: soc.treatyType[k] ?? 0,
      typeName: TREATY_NAMES[soc.treatyType[k] ?? 0] ?? 'none',
      startDay: soc.treatyStart[k] ?? 0,
      endDay: soc.treatyEnd[k] ?? 0,
    });
  }
  for (let k = 0; k < soc.warCount; k++) {
    const a = soc.warA[k] ?? 0;
    const b = soc.warB[k] ?? 0;
    if (a !== id && b !== id) continue;
    const other = a === id ? b : a;
    wars.push({
      id: k,
      opponent: other,
      opponentName: civNameOf(world, other),
      startDay: soc.warStart[k] ?? 0,
      score: a === id ? soc.warScore[k] ?? 0 : -(soc.warScore[k] ?? 0),
      battles: soc.warBattles[k] ?? 0,
      exhaustSelf: a === id ? soc.warExhaustA[k] ?? 0 : soc.warExhaustB[k] ?? 0,
      exhaustOther: a === id ? soc.warExhaustB[k] ?? 0 : soc.warExhaustA[k] ?? 0,
    });
  }

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (summary.legitimacy >= 65) strengths.push('legitimacy');
  if (summary.legitimacy < 35) weaknesses.push('legitimacy');
  if (summary.army > 100) strengths.push('army');
  if (summary.army < 30) weaknesses.push('army');
  if (summary.exhaustion > 60) weaknesses.push('exhaustion');
  if (culture[2]! > 40) strengths.push('scholarly');
  if (culture[0]! > 40) strengths.push('martial');
  if (culture[1]! > 40) weaknesses.push('isolation');
  const capitalSettlement = querySettlement(world, summary.capital);
  if (capitalSettlement && capitalSettlement.daysOfFood < 10) weaknesses.push('food');

  const milestones: EventView[] = [];
  const all = allEvents(world);
  for (let n = all.length - 1; n >= 0 && milestones.length < 12; n--) {
    const e = all[n];
    if (!e) continue;
    if (e.actorA !== id && e.actorB !== id) continue;
    if (e.severity < 3) continue;
    milestones.push(eventView(world, e));
  }

  let gate: CivView['gate'] = null;
  for (let other = 0; other < world.civs.count; other++) {
    if (other === id || civSettlementCount(world, other) === 0) continue;
    const g = evaluateWarGate(world, id, other);
    if (!gate || g.utility > gate.utility) gate = g;
  }

  return {
    ...summary,
    culture,
    tech,
    techNames: [...TECH_NAME],
    techProgress,
    treasury,
    relations,
    treaties,
    wars,
    strengths,
    weaknesses,
    milestones,
    gate,
  };
}
