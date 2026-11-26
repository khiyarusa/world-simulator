/**
 * War: manpower, the four-condition gate, abstract fronts, attrition, occupation and peace
 * (GDD §10.3, §11).
 *
 * A declaration is impossible unless all four gate values pass *and* the whole declaration is
 * persisted with them, so any war in the report can be re-derived from recorded state. Wars are
 * bounded in time by exhaustion and by an absolute 20-year limit; they always change treasury,
 * population, relations, routes and sometimes territory.
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
  WAR_CAPACITY,
  addCohort,
  addStock,
  appendEvent,
  cohortOf,
  populationOf,
  recordDecision,
  stockOf,
} from './state.ts';
import { atWar, civSettlementCount, isAlive, removePeople } from './common.ts';
import { breakTreaties, treatyBetween } from './diplomacy.ts';
import { TREATY } from './state.ts';

const ROOT_CAUSE = -1;

/** The gate, exactly as persisted. Values are the authoritative thresholds (docs/STAGE_3_DESIGN.md). */
export const WAR_GATE = {
  strengthPm: 1250, // relative strength >= 1.25
  grievance: 40, // grievance score 0..100 (raw grievance / 10)
  foodDays: 90, // capacity proxy: 90 days of food, plus army and exhaustion checks
  minArmy: 20,
  maxExhaustion: 50,
  utilityMargin: 50, // declare_war must beat the best alternative by 50/1000
  maxYears: 20,
} as const;

interface Strength {
  pm: number;
  foodDays: number;
  army: number;
  morale: number;
  tech: number;
}

function avgStability(world: WorldState, civ: number): number {
  const s = world.settlements;
  const soc = world.society;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    sum += soc.stability[i] ?? 0;
    n++;
  }
  return n > 0 ? Math.floor(sum / n) : 0;
}

function avgFoodDays(world: WorldState, civ: number): number {
  const s = world.settlements;
  const soc = world.society;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    sum += Math.floor(stockOf(soc, i, RES.FOOD) / Math.max(1, populationOf(soc, i)));
    n++;
  }
  return n > 0 ? Math.min(999, Math.floor(sum / n)) : 0;
}

function militaryTech(soc: WorldState['society'], civ: number): number {
  return (soc.tech[civ * 12 + 6] ?? 0) + (soc.tech[civ * 12 + 7] ?? 0) + (soc.tech[civ * 12 + 8] ?? 0);
}

export function strengthOf(world: WorldState, civ: number): Strength {
  const soc = world.society;
  const army = Math.max(0, soc.army[civ] ?? 0);
  const foodDays = avgFoodDays(world, civ);
  const morale = avgStability(world, civ);
  const tech = militaryTech(soc, civ);
  const supplyPm = Math.min(1000, foodDays * 8);
  const pm = Math.min(4000, army * 4 + tech * 100 + supplyPm * 2 + morale * 2);
  return { pm, foodDays, army, morale, tech: tech * 100 };
}

/** Raise or shrink the abstract army toward the soldiers the settlements can actually field. */
export function runMilitary(world: WorldState, day: number): void {
  if (day % 30 !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  for (let civ = 0; civ < world.civs.count; civ++) {
    if (civSettlementCount(world, civ) === 0) continue;
    let soldiers = 0;
    let barracks = 0;
    let capital = world.civs.capital[civ] ?? 0;
    for (let i = 0; i < s.count; i++) {
      if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
      soldiers += cohortOf(soc, i, COHORT.SOLDIERS);
      if (((soc.infra[i] ?? 0) & (1 << 10)) !== 0) barracks++; // barracks bit
    }
    const target = soldiers + barracks * 40;
    let army = soc.army[civ] ?? 0;
    const delta = Math.floor(Math.abs(target - army) / 5) + 1;
    army += target > army ? Math.min(delta, target - army) : -Math.min(delta, army);
    soc.army[civ] = army;

    // upkeep: coin and food are real costs; an unpaid army erodes and the state loses confidence
    const coin = Math.ceil(army / 4);
    const food = Math.ceil(army / 20);
    const treasury = soc.treasury[capital] ?? 0;
    const foodHave = stockOf(soc, capital, RES.FOOD);
    if (treasury >= coin && foodHave >= food) {
      soc.treasury[capital] = treasury - coin;
      if (food > 0) addStock(soc, capital, RES.FOOD, -food);
    } else {
      soc.army[civ] = Math.max(0, army - Math.max(1, Math.floor(army / 25)));
      soc.exhaustion[civ] = Math.min(100, (soc.exhaustion[civ] ?? 0) + 1);
      soc.stability[capital] = Math.max(0, (soc.stability[capital] ?? 60) - 1);
    }
    if ((soc.exhaustion[civ] ?? 0) > 0 && soc.warCount === 0) {
      soc.exhaustion[civ] = Math.max(0, (soc.exhaustion[civ] ?? 0) - 1);
    }
  }
}

/** Relative strength in per-mille; 1250 means "25 % stronger". */
function strengthRatio(world: WorldState, a: number, b: number): number {
  const sa = strengthOf(world, a).pm;
  const sb = strengthOf(world, b).pm;
  return Math.floor((sa * 1000) / Math.max(1, sb));
}

function grievanceScore(world: WorldState, a: number, b: number): number {
  return Math.floor((world.society.grievance[a * CIV_STRIDE + b] ?? 0) / 10);
}

/** Utility of declaring war, minus the best alternative (peace = 50 on the same scale). */
function warMargin(world: WorldState, a: number, b: number, ratio: number, grievance: number): number {
  const soc = world.society;
  const greed = Math.min(60, Math.floor((ratio - 1000) / 5));
  const grievanceUtility = Math.min(50, Math.floor(grievance / 2));
  const exhaustionCost = (soc.exhaustion[a] ?? 0);
  const tradeCost = treatyBetween(soc, a, b, TREATY.TRADE) ? 15 : 0;
  const allyCost = treatyBetween(soc, a, b, TREATY.ALLIANCE) ? 1000 : 0;
  const income = Math.min(20, Math.floor(((soc.treasury[world.civs.capital[b] ?? 0] ?? 0) / 50)));
  const utility = Math.min(1000, greed + grievanceUtility + income);
  return Math.max(0, utility - 50 - exhaustionCost - tradeCost - allyCost);
}

/** Can this pair legally and materially fight right now? Returns the four gate values. */
export function evaluateWarGate(
  world: WorldState,
  a: number,
  b: number,
): { strength: number; grievance: number; capacity: number; utility: number; pass: boolean } {
  const soc = world.society;
  const ratio = strengthRatio(world, a, b);
  const grievance = grievanceScore(world, a, b);
  const foodDays = avgFoodDays(world, a);
  const strength = strengthOf(world, a);
  const capacity = Math.min(999, foodDays);
  const margin = warMargin(world, a, b, ratio, grievance);
  const pass =
    ratio >= WAR_GATE.strengthPm &&
    grievance >= WAR_GATE.grievance &&
    foodDays >= WAR_GATE.foodDays &&
    strength.army >= WAR_GATE.minArmy &&
    (soc.exhaustion[a] ?? 0) < WAR_GATE.maxExhaustion &&
    !atWar(soc, a, b) &&
    soc.warCount < WAR_CAPACITY &&
    margin >= WAR_GATE.utilityMargin;
  return { strength: ratio, grievance, capacity, utility: margin, pass };
}

/** Is this civ already fighting anyone? A second front is not allowed (GDD capacity condition). */
function civAtWar(soc: WorldState['society'], civ: number): boolean {
  for (let k = 0; k < soc.warCount; k++) {
    if ((soc.warA[k] ?? 0) === civ || (soc.warB[k] ?? 0) === civ) return true;
  }
  return false;
}

function declareWar(world: WorldState, day: number, a: number, b: number, gate: { strength: number; grievance: number; capacity: number; utility: number }): void {
  const soc = world.society;
  breakTreaties(world, a, b, day);
  const at = soc.warCount;
  soc.warA[at] = a;
  soc.warB[at] = b;
  soc.warStart[at] = day;
  soc.warScore[at] = 0;
  soc.warExhaustA[at] = 0;
  soc.warExhaustB[at] = 0;
  soc.warBattles[at] = 0;
  soc.warGateStrength[at] = Math.min(65535, gate.strength);
  soc.warGateGrievance[at] = Math.min(65535, gate.grievance);
  soc.warGateCapacity[at] = Math.min(65535, gate.capacity);
  soc.warGateUtility[at] = Math.min(65535, gate.utility);
  soc.warCount = at + 1;
  const capital = world.civs.capital[a] ?? 0;
  const cause = appendEvent(
    soc,
    day,
    EVENT_TYPE.WAR_DECLARED,
    SEVERITY.HISTORIC,
    capital,
    a,
    b,
    gate.strength,
    ROOT_CAUSE,
  );
  soc.warCause[at] = cause;
  world.counters.warsDeclared += 1;
  recordDecision(soc, day, DECISION.WAR, a, b, Math.min(1000, gate.utility));
  // the declaration itself is a grievance and ruins the relation
  soc.relation[a * CIV_STRIDE + b] = -60;
  soc.relation[b * CIV_STRIDE + a] = -60;
  soc.grievance[a * CIV_STRIDE + b] = Math.min(1000, (soc.grievance[a * CIV_STRIDE + b] ?? 0) + 150);
  soc.grievance[b * CIV_STRIDE + a] = soc.grievance[a * CIV_STRIDE + b] ?? 0;
}

/** The most exposed enemy settlement: nearest to the attacker's capital, not already occupied. */
function chooseTarget(world: WorldState, attacker: number, defender: number): number {
  const s = world.settlements;
  const attackerCapital = world.civs.capital[attacker] ?? 0;
  let best = -1;
  let bestDist = 1e9;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== defender || !isAlive(world, i)) continue;
    if ((world.society.occupier[i] ?? 0) !== 0) continue;
    const dx = (s.x[i] ?? 0) - (s.x[attackerCapital] ?? 0);
    const dy = (s.y[i] ?? 0) - (s.y[attackerCapital] ?? 0);
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Attrition is paid in people removed from cohorts, never in an abstract counter alone. */
function attrition(world: WorldState, civ: number, deaths: number): number {
  const soc = world.society;
  const s = world.settlements;
  let left = deaths;
  for (let i = 0; i < s.count && left > 0; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    const soldiers = cohortOf(soc, i, COHORT.SOLDIERS);
    const take = Math.min(soldiers, left);
    if (take > 0) {
      addCohort(soc, i, COHORT.SOLDIERS, -take);
      left -= take;
    }
  }
  for (let i = 0; i < s.count && left > 0; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    const take = removePeople(soc, i, left);
    left -= take;
  }
  const removed = deaths - left;
  soc.army[civ] = Math.max(0, (soc.army[civ] ?? 0) - removed);
  world.counters.deaths += removed;
  world.counters.warDeaths += removed;
  return removed;
}

function closeRoutesBetween(world: WorldState, a: number, b: number, day: number): void {
  const soc = world.society;
  const s = world.settlements;
  for (let k = soc.routeCount - 1; k >= 0; k--) {
    const ca = s.civ[soc.routeA[k] ?? 0] ?? 0;
    const cb = s.civ[soc.routeB[k] ?? 0] ?? 0;
    if (!((ca === a && cb === b) || (ca === b && cb === a))) continue;
    appendEvent(soc, day, EVENT_TYPE.ROUTE_LOST, SEVERITY.NOTABLE, soc.routeA[k] ?? 0, a, b, -2, -1);
    world.counters.routesLost += 1;
    const last = soc.routeCount - 1;
    if (k !== last) {
      soc.routeA[k] = soc.routeA[last] ?? 0;
      soc.routeB[k] = soc.routeB[last] ?? 0;
      soc.routeCapacity[k] = soc.routeCapacity[last] ?? 0;
      soc.routeLength[k] = soc.routeLength[last] ?? 0;
      soc.routeTariff[k] = soc.routeTariff[last] ?? 0;
      soc.routeCreated[k] = soc.routeCreated[last] ?? 0;
      soc.routeVolume[k] = soc.routeVolume[last] ?? 0;
      soc.routeIdle[k] = soc.routeIdle[last] ?? 0;
    }
    soc.routeCount = last;
  }
}

function endWar(world: WorldState, index: number, day: number, score: number, mutual: boolean): void {
  const soc = world.society;
  const s = world.settlements;
  const a = soc.warA[index] ?? 0;
  const b = soc.warB[index] ?? 0;
  const cause = soc.warCause[index] ?? 0;
  const winner = score > 0 ? a : score < 0 ? b : -1;
  const loser = winner === a ? b : winner === b ? a : -1;

  if (winner >= 0 && loser >= 0) {
    // tribute, legitimacy and a real population movement away from the fighting
    const loserCapital = world.civs.capital[loser] ?? 0;
    const winnerCapital = world.civs.capital[winner] ?? 0;
    const tribute = Math.floor((soc.treasury[loserCapital] ?? 0) / 5);
    if (tribute > 0) {
      soc.treasury[loserCapital] = (soc.treasury[loserCapital] ?? 0) - tribute;
      soc.treasury[winnerCapital] = (soc.treasury[winnerCapital] ?? 0) + tribute;
      world.counters.tributePaid += tribute;
    }
    soc.legitimacy[winner] = Math.min(100, (soc.legitimacy[winner] ?? 50) + 5);
    soc.legitimacy[loser] = Math.max(0, (soc.legitimacy[loser] ?? 50) - 10);
    soc.warWins[winner] = (soc.warWins[winner] ?? 0) + 1;
    if (mutual) {
      // a drawn war cedes nothing; occupied settlements return to their owner
      for (let i = 0; i < s.count; i++) if ((soc.occupier[i] ?? 0) === winner + 1) soc.occupier[i] = 0;
    } else {
      for (let i = 0; i < s.count; i++) {
        if ((soc.occupier[i] ?? 0) !== winner + 1) continue;
        if (score >= 60) {
          s.civ[i] = winner;
          soc.occupier[i] = 0;
        } else {
          soc.occupier[i] = 0;
        }
      }
    }
    // refugees: 3 % of the loser's people near the front move to the winner's capital
    const moveFrom = chooseTarget(world, winner, loser);
    if (moveFrom >= 0) {
      const movers = Math.floor(populationOf(soc, moveFrom) * 30 / 1000);
      let left = movers;
      for (let c = 0; c < 8 && left > 0; c++) {
        const have = cohortOf(soc, moveFrom, c);
        const take = Math.min(have, left);
        if (take <= 0) continue;
        addCohort(soc, moveFrom, c, -take);
        addCohort(soc, winnerCapital, c, take);
        left -= take;
      }
      if (movers - left > 0) {
        world.counters.migrants += movers - left;
        appendEvent(soc, day, EVENT_TYPE.MIGRATION_WAVE, SEVERITY.NOTABLE, moveFrom, loser, winner, movers - left, cause);
      }
    }
    soc.relation[a * CIV_STRIDE + b] = Math.max(-100, (soc.relation[a * CIV_STRIDE + b] ?? 0) - 20);
    soc.relation[b * CIV_STRIDE + a] = soc.relation[a * CIV_STRIDE + b] ?? 0;
    soc.grievance[loser * CIV_STRIDE + winner] = Math.min(1000, (soc.grievance[loser * CIV_STRIDE + winner] ?? 0) + 100);
    soc.grievance[winner * CIV_STRIDE + loser] = soc.grievance[loser * CIV_STRIDE + winner] ?? 0;
  }
  closeRoutesBetween(world, a, b, day);
  appendEvent(soc, day, EVENT_TYPE.PEACE_SIGNED, SEVERITY.HISTORIC, world.civs.capital[a] ?? 0, a, b, score, cause);
  world.counters.warsEnded += 1;

  const last = soc.warCount - 1;
  if (index !== last) {
    soc.warA[index] = soc.warA[last] ?? 0;
    soc.warB[index] = soc.warB[last] ?? 0;
    soc.warStart[index] = soc.warStart[last] ?? 0;
    soc.warScore[index] = soc.warScore[last] ?? 0;
    soc.warExhaustA[index] = soc.warExhaustA[last] ?? 0;
    soc.warExhaustB[index] = soc.warExhaustB[last] ?? 0;
    soc.warBattles[index] = soc.warBattles[last] ?? 0;
    soc.warCause[index] = soc.warCause[last] ?? 0;
    soc.warGateStrength[index] = soc.warGateStrength[last] ?? 0;
    soc.warGateGrievance[index] = soc.warGateGrievance[last] ?? 0;
    soc.warGateCapacity[index] = soc.warGateCapacity[last] ?? 0;
    soc.warGateUtility[index] = soc.warGateUtility[last] ?? 0;
  }
  soc.warCount = last;
}

/** Monthly war phase: gate checks, fronts, attrition, occupation and peace. */
export function runWar(world: WorldState, day: number): void {
  if (day % 30 !== 0) return;
  const soc = world.society;

  // one declaration per year at most, so the world cannot explode into simultaneous wars
  if (day % DAYS_PER_YEAR === 0 && soc.warCount < WAR_CAPACITY) {
    let declared = false;
    for (let a = 0; a < world.civs.count && !declared; a++) {
      if (civSettlementCount(world, a) === 0 || civAtWar(soc, a)) continue;
      for (let b = 0; b < world.civs.count; b++) {
        if (a === b || civSettlementCount(world, b) === 0 || civAtWar(soc, b)) continue;
        if (treatyBetween(soc, a, b, TREATY.ALLIANCE) || treatyBetween(soc, a, b, TREATY.NON_AGGRESSION)) continue;
        const gate = evaluateWarGate(world, a, b);
        if (!gate.pass) continue;
        declareWar(world, day, a, b, gate);
        declared = true;
        break;
      }
    }
  }

  for (let k = soc.warCount - 1; k >= 0; k--) {
    const a = soc.warA[k] ?? 0;
    const b = soc.warB[k] ?? 0;
    if (civSettlementCount(world, a) === 0 || civSettlementCount(world, b) === 0) {
      endWar(world, k, day, civSettlementCount(world, a) === 0 ? -100 : 100, false);
      continue;
    }
    const sa = strengthOf(world, a).pm;
    const sb = strengthOf(world, b).pm;
    let delta = Math.floor(((sa - sb) * 8) / 1000);
    if (delta > 12) delta = 12;
    if (delta < -12) delta = -12;
    let score = (soc.warScore[k] ?? 0) + delta;
    score = score > 100 ? 100 : score < -100 ? -100 : score;
    soc.warScore[k] = score;

    let exhA = Math.min(100, (soc.warExhaustA[k] ?? 0) + 1 + (score < -20 ? 1 : 0));
    let exhB = Math.min(100, (soc.warExhaustB[k] ?? 0) + 1 + (score > 20 ? 1 : 0));
    soc.warExhaustA[k] = exhA;
    soc.warExhaustB[k] = exhB;

    // attrition: more with enemy military technology and when the front is going badly
    const debtA = Math.max(0, -score);
    const debtB = Math.max(0, score);
    const lossA = Math.floor(((soc.army[a] ?? 0) * (5 + militaryTech(soc, b) * 4 + Math.floor(debtA / 5))) / 1000);
    const lossB = Math.floor(((soc.army[b] ?? 0) * (5 + militaryTech(soc, a) * 4 + Math.floor(debtB / 5))) / 1000);
    if (lossA > 0) attrition(world, a, lossA);
    if (lossB > 0) attrition(world, b, lossB);
    soc.warBattles[k] = (soc.warBattles[k] ?? 0) + 1;
    if ((soc.warBattles[k] ?? 0) % 6 === 1) {
      appendEvent(soc, day, EVENT_TYPE.BATTLE, SEVERITY.LOCAL, world.civs.capital[a] ?? 0, a, b, lossA + lossB, soc.warCause[k] ?? 0);
    }

    // occupation: a front that crosses +-35 takes the most exposed enemy settlement
    if (score >= 35) {
      const target = chooseTarget(world, a, b);
      if (target >= 0) {
        soc.occupier[target] = Math.min(255, a + 1);
        soc.stability[target] = Math.max(0, (soc.stability[target] ?? 60) - 8);
      }
    } else if (score <= -35) {
      const target = chooseTarget(world, b, a);
      if (target >= 0) {
        soc.occupier[target] = Math.min(255, b + 1);
        soc.stability[target] = Math.max(0, (soc.stability[target] ?? 60) - 8);
      }
    }

    const years = Math.floor((day - (soc.warStart[k] ?? day)) / DAYS_PER_YEAR);
    const bothTired = exhA >= 80 && exhB >= 80;
    const oneTired = (exhA >= 80 && score <= -20) || (exhB >= 80 && score >= 20);
    const decided = Math.abs(score) >= 60;
    if (decided || bothTired || oneTired || years >= WAR_GATE.maxYears) {
      endWar(world, k, day, score, bothTired || years >= WAR_GATE.maxYears);
    }
  }
}
