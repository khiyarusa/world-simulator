/**
 * Diplomacy: relations, grievance memory and the five treaty types (GDD §10).
 *
 * Every relation change has a driver that can be named: a route, a shared border, cultural distance,
 * a war, a treaty. Grievance decays, is raised by real friction and is the input the war gate reads.
 * A proposal is scored and recorded, including the refusals, so "why is there peace?" is answerable.
 */
import type { WorldState } from '../state/worldState.ts';
import { DAYS_PER_YEAR } from '../../core/clock.ts';
import {
  CIV_STRIDE,
  DECISION,
  EVENT_TYPE,
  SEVERITY,
  TREATY,
  TREATY_CAPACITY,
  TREATY_NAMES,
  appendEvent,
  recordDecision,
} from './state.ts';
import { atWar, civPopulation, civSettlementCount, isAlive, relationOf, setRelation } from './common.ts';

const ROOT_CAUSE = -1;

function treatyIndex(soc: WorldState['society'], a: number, b: number, type: number): number {
  for (let k = 0; k < soc.treatyCount; k++) {
    const ta = soc.treatyA[k] ?? 0;
    const tb = soc.treatyB[k] ?? 0;
    if (((ta === a && tb === b) || (ta === b && tb === a)) && (soc.treatyType[k] ?? 0) === type) return k;
  }
  return -1;
}

function removeTreaty(world: WorldState, index: number, day: number, broken: boolean): void {
  const soc = world.society;
  const a = soc.treatyA[index] ?? 0;
  const b = soc.treatyB[index] ?? 0;
  const type = soc.treatyType[index] ?? 0;
  // magnitude encodes type and cause of ending: type*10 + 1 when broken, type*10 when expired
  appendEvent(soc, day, EVENT_TYPE.TREATY_BROKEN, SEVERITY.LOCAL, world.civs.capital[a] ?? 0, a, b, type * 10 + (broken ? 1 : 0), ROOT_CAUSE);
  if (broken) {
    adjustRelation(soc, a, b, -20);
    soc.legitimacy[a] = Math.max(0, (soc.legitimacy[a] ?? 50) - 6);
    soc.grievance[a * CIV_STRIDE + b] = Math.min(1000, (soc.grievance[a * CIV_STRIDE + b] ?? 0) + 25);
  }
  const last = soc.treatyCount - 1;
  if (index !== last) {
    soc.treatyA[index] = soc.treatyA[last] ?? 0;
    soc.treatyB[index] = soc.treatyB[last] ?? 0;
    soc.treatyType[index] = soc.treatyType[last] ?? 0;
    soc.treatyStart[index] = soc.treatyStart[last] ?? 0;
    soc.treatyEnd[index] = soc.treatyEnd[last] ?? 0;
  }
  soc.treatyCount = last;
}

function adjustRelation(soc: WorldState['society'], a: number, b: number, delta: number): void {
  const value = Math.floor((relationOf(soc, a, b) + relationOf(soc, b, a)) / 2) + delta;
  setRelation(soc, a, b, value);
  setRelation(soc, b, a, value);
}

/** Break every treaty between two civilizations (called by a war declaration). */
export function breakTreaties(world: WorldState, a: number, b: number, day: number): void {
  const soc = world.society;
  for (let k = soc.treatyCount - 1; k >= 0; k--) {
    const ta = soc.treatyA[k] ?? 0;
    const tb = soc.treatyB[k] ?? 0;
    if ((ta === a && tb === b) || (ta === b && tb === a)) removeTreaty(world, k, day, true);
  }
}

/** Does a treaty of this kind bind the pair? Exported for the war gate and the UI. */
export function treatyBetween(soc: WorldState['society'], a: number, b: number, type: number): boolean {
  return treatyIndex(soc, a, b, type) >= 0;
}

/** Yearly relation and grievance update from named drivers. */
export function updateRelations(world: WorldState): void {
  const soc = world.society;
  const s = world.settlements;
  const n = world.civs.count;
  for (let a = 0; a < n; a++) {
    if (civSettlementCount(world, a) === 0) continue;
    for (let b = a + 1; b < n; b++) {
      if (civSettlementCount(world, b) === 0) continue;
      let delta = 0;
      // trade: every route is a reason to remain on good terms
      let routes = 0;
      for (let k = 0; k < soc.routeCount; k++) {
        const ra = s.civ[soc.routeA[k] ?? 0] ?? 0;
        const rb = s.civ[soc.routeB[k] ?? 0] ?? 0;
        if ((ra === a && rb === b) || (ra === b && rb === a)) routes++;
      }
      delta += Math.min(4, routes);
      // shared border friction: near settlements of different civilizations
      let border = 0;
      for (let i = 0; i < s.count && border < 4; i++) {
        if ((s.civ[i] ?? 0) !== a || !isAlive(world, i)) continue;
        for (let j = 0; j < s.count; j++) {
          if ((s.civ[j] ?? 0) !== b || !isAlive(world, j)) continue;
          const dx = (s.x[i] ?? 0) - (s.x[j] ?? 0);
          const dy = (s.y[i] ?? 0) - (s.y[j] ?? 0);
          if (dx * dx + dy * dy <= 10 * 10) {
            border++;
            break;
          }
        }
      }
      delta -= Math.min(3, border);
      // cultural distance: unlike civilizations drift apart
      let distance = 0;
      for (let axis = 0; axis < 3; axis++) {
        distance += Math.abs((soc.culture[a * 3 + axis] ?? 0) - (soc.culture[b * 3 + axis] ?? 0));
      }
      delta -= Math.floor(distance / 100);
      if (atWar(soc, a, b)) delta -= 6;
      if (treatyBetween(soc, a, b, TREATY.ALLIANCE)) delta += 3;
      else if (treatyBetween(soc, a, b, TREATY.TRADE)) delta += 2;
      else if (treatyBetween(soc, a, b, TREATY.NON_AGGRESSION)) delta += 1;
      adjustRelation(soc, a, b, delta);

      // grievance: friction accumulates it, quiet neighbours and treaties erode it
      let grievance = soc.grievance[a * CIV_STRIDE + b] ?? 0;
      if (atWar(soc, a, b)) grievance += 3;
      else if (border > 0) grievance += border;
      else if (routes > 0) grievance -= 3;
      else grievance -= 2;
      if (treatyBetween(soc, a, b, TREATY.BORDER)) grievance -= 2;
      soc.grievance[a * CIV_STRIDE + b] = Math.min(1000, Math.max(0, grievance));
      soc.grievance[b * CIV_STRIDE + a] = soc.grievance[a * CIV_STRIDE + b] ?? 0;
    }
  }
}

/** Sign a treaty. The terms are real: duration, participants, type. */
export function signTreaty(world: WorldState, day: number, a: number, b: number, type: number, years: number): boolean {
  const soc = world.society;
  if (soc.treatyCount >= TREATY_CAPACITY) return false;
  if (a === b || treeExists(soc, a, b, type)) return false;
  const at = soc.treatyCount;
  soc.treatyA[at] = a;
  soc.treatyB[at] = b;
  soc.treatyType[at] = type;
  soc.treatyStart[at] = day;
  soc.treatyEnd[at] = day + years * DAYS_PER_YEAR;
  soc.treatyCount = at + 1;
  adjustRelation(soc, a, b, 8);
  if (type === TREATY.BORDER) {
    soc.grievance[a * CIV_STRIDE + b] = Math.max(0, (soc.grievance[a * CIV_STRIDE + b] ?? 0) - 25);
    soc.grievance[b * CIV_STRIDE + a] = soc.grievance[a * CIV_STRIDE + b] ?? 0;
  }
  appendEvent(soc, day, EVENT_TYPE.TREATY_SIGNED, SEVERITY.NOTABLE, world.civs.capital[a] ?? 0, a, b, type, ROOT_CAUSE);
  recordDecision(soc, day, DECISION.TREATY, a, type, 800);
  return true;
}

function treeExists(soc: WorldState['society'], a: number, b: number, type: number): boolean {
  return treatyIndex(soc, a, b, type) >= 0;
}

/** Strength ratio in per-mille, used by tribute proposals; >= 1000 means a is stronger. */
function strengthRatio(world: WorldState, a: number, b: number): number {
  const pa = Math.max(1, civPopulation(world, a));
  const pb = Math.max(1, civPopulation(world, b));
  return Math.floor((pa * 1000) / pb);
}

/** Yearly treaty proposals, scored and recorded including refusals. */
export function proposeTreaties(world: WorldState, day: number): void {
  const soc = world.society;
  const n = world.civs.count;
  let signed = 0;
  for (let a = 0; a < n && signed < 2; a++) {
    if (civSettlementCount(world, a) === 0) continue;
    for (let b = a + 1; b < n && signed < 2; b++) {
      if (civSettlementCount(world, b) === 0) continue;
      if (atWar(soc, a, b)) continue;
      const rel = Math.min(relationOf(soc, a, b), relationOf(soc, b, a));
      if (rel < 10) {
        // a much stronger neighbour can impose tribute; the weaker side accepts only under threat
        const ratio = strengthRatio(world, a, b);
        if (ratio >= 1800 || ratio <= 500) {
          const strong = ratio >= 1800 ? a : b;
          const weak = strong === a ? b : a;
          const score = Math.min(1000, Math.floor(Math.abs(ratio - 1000) / 2));
          recordDecision(soc, day, DECISION.TREATY, strong, TREATY.TRIBUTE, score);
          if (!treeExists(soc, strong, weak, TREATY.TRIBUTE)) {
            signTreaty(world, day, strong, weak, TREATY.TRIBUTE, 10);
            signed++;
          }
        }
        continue;
      }
      let type = 0;
      let years = 10;
      let score = rel;
      if (rel >= 65 && !treeExists(soc, a, b, TREATY.ALLIANCE)) {
        type = TREATY.ALLIANCE;
        years = 15;
        score = rel;
      } else if (rel >= 35 && !treeExists(soc, a, b, TREATY.TRADE)) {
        type = TREATY.TRADE;
        years = 20;
        score = rel + 10;
      } else if (!treeExists(soc, a, b, TREATY.NON_AGGRESSION)) {
        type = TREATY.NON_AGGRESSION;
        years = 15;
        score = rel + 5;
      } else if (rel >= 20 && (soc.grievance[a * CIV_STRIDE + b] ?? 0) >= 15 && !treeExists(soc, a, b, TREATY.BORDER)) {
        type = TREATY.BORDER;
        years = 25;
        score = rel;
      }
      if (type === 0) continue;
      recordDecision(soc, day, DECISION.TREATY, a, type, score > 1000 ? 1000 : score);
      // a refused proposal is equally explainable; refusal happens below the utility threshold
      if (score < 40) continue;
      if (signTreaty(world, day, a, b, type, years)) signed++;
    }
  }
}

/** Expire treaties, collect tribute, and let the treaty list stay bounded. */
export function runDiplomacyYearly(world: WorldState, day: number): void {
  if (day % DAYS_PER_YEAR !== 0) return;
  const soc = world.society;
  updateRelations(world);
  proposeTreaties(world, day);
  for (let k = soc.treatyCount - 1; k >= 0; k--) {
    if (day >= (soc.treatyEnd[k] ?? 0)) {
      removeTreaty(world, k, day, false);
      continue;
    }
    if ((soc.treatyType[k] ?? 0) === TREATY.TRIBUTE) {
      const strong = soc.treatyA[k] ?? 0;
      const weak = soc.treatyB[k] ?? 0;
      // the weak side pays a tenth of its yearly treasury to the strong side
      const amount = Math.floor((soc.treasury[weak] ?? 0) / 10);
      if (amount > 0) {
        soc.treasury[weak] = (soc.treasury[weak] ?? 0) - amount;
        soc.treasury[strong] = (soc.treasury[strong] ?? 0) + amount;
        world.counters.tributePaid += amount;
      }
    }
  }
}

export { TREATY_NAMES };
