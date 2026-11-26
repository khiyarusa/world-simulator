/**
 * Civilizations: formation, culture drift and technology (GDD §8, Stage 3 WP F).
 *
 * A civilization is not spawned: it forms when a large, distant, stable settlement of an existing
 * civilization stops being governable from its capital. Its culture starts from the environment and
 * then drifts toward what it actually does; technology is researched from real labour, literacy,
 * contact and academies, and spreads along real trade routes.
 */
import type { WorldState } from '../state/worldState.ts';
import { DAYS_PER_YEAR } from '../../core/clock.ts';
import {
  COHORT,
  CIV_STRIDE,
  DECISION,
  EVENT_TYPE,
  RES,
  SEVERITY,
  appendEvent,
  cohortOf,
  populationOf,
  recordDecision,
  stockOf,
} from './state.ts';
import { civSettlementCount, isAlive } from './common.ts';
import { hasForeignContact } from './trade.ts';
import { infraHas, INFRA } from './state.ts';

const RESEARCH_COST = [3_000, 6_000, 12_000] as const;
const ROOT_CAUSE = -1;

function branchOf(node: number): number {
  return Math.floor(node / 3);
}

function tierOfTech(node: number): number {
  return node % 3;
}

/** A node is available when its branch's previous tier is complete. */
export function techAvailable(soc: WorldState['society'], civ: number, node: number): boolean {
  const tier = tierOfTech(node);
  if (tier === 0) return true;
  return (soc.tech[civ * 12 + (node - 1)] ?? 0) === 1;
}

export function hasTech(soc: WorldState['society'], civ: number, node: number): boolean {
  return (soc.tech[civ * 12 + node] ?? 0) === 1;
}

/** Research points per month from the GDD's four real inputs. */
function researchPoints(world: WorldState, civ: number): { points: number; academies: number; literacy: number; labour: number } {
  const soc = world.society;
  const s = world.settlements;
  let labour = 0;
  let literacySum = 0;
  let settlements = 0;
  let academies = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ) continue;
    if (!isAlive(world, i)) continue;
    labour +=
      Math.floor(cohortOf(soc, i, COHORT.YOUTH) / 2) +
      cohortOf(soc, i, COHORT.CRAFTERS) +
      cohortOf(soc, i, COHORT.TRADERS) +
      cohortOf(soc, i, COHORT.ELDERS) / 2;
    literacySum += soc.literacy[i] ?? 0;
    settlements++;
    if (infraHas(soc, i, INFRA.indexOf('academy'))) academies++;
  }
  const literacy = settlements > 0 ? Math.floor(literacySum / settlements) : 0;
  const contacts = hasForeignContact(world, civ) ? 1 : 0;
  const points = Math.floor(labour / 10) + literacy * 3 + contacts * 30 + academies * 50;
  return { points, academies, literacy, labour };
}

/** Pick the next research node: measured need plus culture, ties by lowest index. */
function chooseResearch(world: WorldState, civ: number): number {
  const soc = world.society;
  let foodDays = 0;
  let settlements = 0;
  let goods = 0;
  let literacy = 0;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    const pop = Math.max(1, populationOf(soc, i));
    foodDays += Math.floor(stockOf(soc, i, RES.FOOD) / pop);
    goods += stockOf(soc, i, RES.GOODS);
    literacy += soc.literacy[i] ?? 0;
    settlements++;
  }
  if (settlements === 0) return -1;
  foodDays = Math.floor(foodDays / settlements);
  literacy = Math.floor(literacy / settlements);
  const martial = soc.culture[civ * 3] ?? 0;
  const isolation = soc.culture[civ * 3 + 1] ?? 0;
  const scholarly = soc.culture[civ * 3 + 2] ?? 0;

  let best = -1;
  let bestScore = 0;
  for (let node = 0; node < 12; node++) {
    if (hasTech(soc, civ, node) || !techAvailable(soc, civ, node)) continue;
    let need = 20;
    const branch = branchOf(node);
    if (branch === 0) need += Math.max(0, 45 - foodDays) * 2;
    else if (branch === 1) need += goods < settlements * 5 ? 60 : 10;
    else if (branch === 2) need += martial;
    else need += Math.max(0, 60 - literacy) + scholarly;
    if (isolation > 40) need += 10;
    if (need > bestScore) {
      bestScore = need;
      best = node;
    }
  }
  return best;
}

/** Monthly research for every living civilization. */
export function runResearch(world: WorldState, day: number): void {
  if (day % 30 !== 0) return;
  const soc = world.society;
  for (let civ = 0; civ < world.civs.count; civ++) {
    if (civSettlementCount(world, civ) === 0) continue;
    const node = chooseResearch(world, civ);
    if (node < 0) continue;
    const { points } = researchPoints(world, civ);
    if (points <= 0) continue;
    const at = civ * 12 + node;
    const progress = Math.min(1000, (soc.techProgress[at] ?? 0) + Math.floor((points * 1000) / (RESEARCH_COST[tierOfTech(node)] ?? 3000)));
    soc.techProgress[at] = progress;
    if (progress >= 1000) {
      soc.tech[civ * 12 + node] = 1;
      world.counters.techDiscovered += 1;
      const capital = world.civs.capital[civ] ?? 0;
      appendEvent(
        soc,
        day,
        EVENT_TYPE.TECH_DISCOVERED,
        SEVERITY.MAJOR,
        capital,
        civ,
        0,
        node,
        ROOT_CAUSE,
      );
      recordDecision(soc, day, DECISION.TECH, civ, node, 1000);
    }
  }
}

/** Technology spreads along routes: a holder's knowledge leaks to its trading partner. */
export function runTechSpread(world: WorldState, day: number): void {
  if (day % DAYS_PER_YEAR !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  for (let route = 0; route < soc.routeCount; route++) {
    const a = soc.routeA[route] ?? 0;
    const b = soc.routeB[route] ?? 0;
    if (!isAlive(world, a) || !isAlive(world, b)) continue;
    const ca = s.civ[a] ?? 0;
    const cb = s.civ[b] ?? 0;
    if (ca === cb) continue;
    for (let node = 0; node < 12; node++) {
      const hasA = (soc.tech[ca * 12 + node] ?? 0) === 1;
      const hasB = (soc.tech[cb * 12 + node] ?? 0) === 1;
      if (hasA === hasB) continue;
      const holder = hasA ? ca : cb;
      const learner = hasA ? cb : ca;
      if (!techAvailable(soc, learner, node)) continue;
      const at = learner * 12 + node;
      const before = soc.techProgress[at] ?? 0;
      if (before >= 700) continue; // proximity can speed a branch, not finish it
      soc.techProgress[at] = Math.min(1000, before + 150);
      recordDecision(soc, day, DECISION.TECH, learner, node, 600);
      appendEvent(
        soc,
        day,
        EVENT_TYPE.TECH_SPREAD,
        SEVERITY.LOCAL,
        b,
        holder,
        learner,
        node,
        ROOT_CAUSE,
      );
    }
  }
}

/** Literacy responds to academies, contact and civic technology — real causes, bounded drift. */
export function runLiteracy(world: WorldState, day: number): void {
  if (day % DAYS_PER_YEAR !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const civ = s.civ[i] ?? 0;
    const academy = infraHas(soc, i, INFRA.indexOf('academy')) ? 20 : 0;
    const temple = infraHas(soc, i, INFRA.indexOf('temple')) ? 4 : 0;
    const civic = hasTech(soc, civ, 9) ? 8 : 0;
    const target = Math.min(100, 5 + academy + temple + civic + Math.floor((soc.stability[i] ?? 60) / 10));
    const current = soc.literacy[i] ?? 0;
    soc.literacy[i] = current < target ? current + 1 : current > target ? current - 1 : current;
  }
}

/** Culture drifts toward what the civilization actually did this year. */
export function runCulture(world: WorldState, day: number): void {
  if (day % DAYS_PER_YEAR !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  const n = world.civs.count;
  for (let civ = 0; civ < n; civ++) {
    if (civSettlementCount(world, civ) === 0) continue;
    let war = false;
    let routes = 0;
    let academies = 0;
    let foodDays = 0;
    let settlements = 0;
    for (let k = 0; k < soc.warCount; k++) {
      if ((soc.warA[k] ?? 0) === civ || (soc.warB[k] ?? 0) === civ) war = true;
    }
    for (let k = 0; k < soc.routeCount; k++) {
      const a = s.civ[soc.routeA[k] ?? 0] ?? 0;
      const b = s.civ[soc.routeB[k] ?? 0] ?? 0;
      if (a === civ || b === civ) routes++;
    }
    for (let i = 0; i < s.count; i++) {
      if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
      if (infraHas(soc, i, INFRA.indexOf('academy'))) academies++;
      foodDays += Math.floor(stockOf(soc, i, RES.FOOD) / Math.max(1, populationOf(soc, i)));
      settlements++;
    }
    if (settlements > 0) foodDays = Math.floor(foodDays / settlements);

    let martial = soc.culture[civ * 3] ?? 0;
    let isolation = soc.culture[civ * 3 + 1] ?? 0;
    let scholarly = soc.culture[civ * 3 + 2] ?? 0;

    if (war) martial += 2;
    else if (foodDays >= 45) martial -= 1;
    if (routes > 0) isolation -= 1;
    else if (isolation < 0) isolation += 1;
    if (academies > 0) scholarly += 1;

    soc.culture[civ * 3] = martial < -100 ? -100 : martial > 100 ? 100 : martial;
    soc.culture[civ * 3 + 1] = isolation < -100 ? -100 : isolation > 100 ? 100 : isolation;
    soc.culture[civ * 3 + 2] = scholarly < -100 ? -100 : scholarly > 100 ? 100 : scholarly;
  }
}

/** Initial culture for a newly formed civilization, from the land and the history it already had. */
function initialCulture(world: WorldState, capital: number): [number, number, number] {
  const soc = world.society;
  const s = world.settlements;
  const tile = (s.y[capital] ?? 0) * world.width + (s.x[capital] ?? 0);
  const fertility = world.grids.fertility[tile] ?? 0;
  const water = (world.grids.riverId[tile] ?? 0) > 0 || (world.grids.lakeId[tile] ?? 0) > 0;
  const coast = ((world.grids.resource[tile] ?? 0) & 8) !== 0;
  const martial = Math.min(60, Math.max(0, 60 - fertility));
  const mercantile = coast || water ? -40 : 0;
  const scholarly = Math.min(50, soc.literacy[capital] ?? 0);
  return [martial, mercantile, scholarly];
}

/**
 * Form a civilization when a town is too far from its capital to be governed by it.
 * People do not move; only the colour and the government change, which is what makes the event cheap
 * to conserve and expensive in meaning.
 */
export function runCivFormation(world: WorldState, day: number): void {
  if (day % DAYS_PER_YEAR !== 0) return;
  if (world.civs.count >= 12) return;
  const soc = world.society;
  const s = world.settlements;
  const civs = world.civs;
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const oldCiv = s.civ[i] ?? 0;
    if ((s.tier[i] ?? 0) < 2) continue;
    if (civSettlementCount(world, oldCiv) < 3) continue;
    if ((soc.stability[i] ?? 0) < 65 || (soc.literacy[i] ?? 0) < 15) continue;
    const capital = civs.capital[oldCiv] ?? 0;
    const dx = (s.x[i] ?? 0) - (s.x[capital] ?? 0);
    const dy = (s.y[i] ?? 0) - (s.y[capital] ?? 0);
    if (dx * dx + dy * dy < 18 * 18) continue;

    const civ = civs.count;
    civs.count = civ + 1;
    civs.capital[civ] = i;
    civs.colorIdx[civ] = civ % 8;
    civs.nameIdx[civ] = civ;
    soc.legitimacy[civ] = 55;
    const [a0, a1, a2] = initialCulture(world, i);
    soc.culture[civ * 3] = a0;
    soc.culture[civ * 3 + 1] = a1;
    soc.culture[civ * 3 + 2] = a2;
    for (let other = 0; other < civs.count; other++) {
      soc.relation[civ * CIV_STRIDE + other] = 0;
      soc.relation[other * CIV_STRIDE + civ] = 0;
      soc.grievance[civ * CIV_STRIDE + other] = 0;
      soc.grievance[other * CIV_STRIDE + civ] = 0;
    }
    // the settlements that are geographically part of this new polity join it
    let moved = 0;
    for (let k = 0; k < s.count; k++) {
      if ((s.civ[k] ?? 0) !== oldCiv || !isAlive(world, k)) continue;
      const kx = (s.x[k] ?? 0) - (s.x[i] ?? 0);
      const ky = (s.y[k] ?? 0) - (s.y[i] ?? 0);
      if (kx * kx + ky * ky > 12 * 12) continue;
      s.civ[k] = civ;
      moved++;
    }
    if ((s.civ[capital] ?? 0) === civ) {
      // the old capital defected: move the old government to its largest remaining settlement
      let best = -1;
      let bestPop = 0;
      for (let k = 0; k < s.count; k++) {
        if ((s.civ[k] ?? 0) !== oldCiv || !isAlive(world, k)) continue;
        const p = populationOf(soc, k);
        if (p > bestPop) {
          bestPop = p;
          best = k;
        }
      }
      if (best >= 0) civs.capital[oldCiv] = best;
    }
    appendEvent(soc, day, EVENT_TYPE.CIV_FORMED, SEVERITY.HISTORIC, i, civ, oldCiv, moved, ROOT_CAUSE);
    recordDecision(soc, day, DECISION.FOUND, civ, i, 800);
    return;
  }
}

/** Yearly civilization phase (formation, literacy, culture); research runs monthly. */
export function runCivYearly(world: WorldState, day: number): void {
  if (day % DAYS_PER_YEAR !== 0) return;
  runCivFormation(world, day);
  runLiteracy(world, day);
  runCulture(world, day);
}

