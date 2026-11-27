/**
 * World-state-driven objectives.
 *
 * Every offer is derived from a condition that genuinely exists in the worker state: low food, a real
 * diplomatic rupture, lost connectivity, damaged ecology, low literacy or a settlement ready to grow.
 * There is no scripted mission list and no RNG. Generated objectives are persisted and evaluated on
 * real metrics; the same world and command history always produce the same offer.
 */
import type { WorldState } from '../state/worldState.ts';
import { appendEvent, EVENT_TYPE, SEVERITY } from '../society/state.ts';
import { FLAG_BLIGHT, isAlive, relationOf } from '../society/common.ts';
import { INFRA, populationOf } from '../society/state.ts';
import { legacyDef, OBJECTIVE, OBJECTIVE_CAPACITY, OBJECTIVE_STATE, OFFER_LIMIT, ACTIVE_LIMIT, OFFER_TTL_DAYS, OBJECTIVE_COOLDOWN_DAYS } from './types.ts';
import { targetSettlementFertility, targetSettlementFoodDays } from './measure.ts';

interface Candidate {
  kind: number;
  target: number;
  targetB: number;
  goal: number;
  current: number;
  hold: number;
  ttl: number;
}

const HOLD: Record<number, number> = {
  [OBJECTIVE.FOOD_CRISIS]: 60,
  [OBJECTIVE.TENSION]: 30,
  [OBJECTIVE.TRADE_LOSS]: 60,
  [OBJECTIVE.ECOLOGY]: 90,
  [OBJECTIVE.KNOWLEDGE]: 60,
  [OBJECTIVE.GROWTH]: 0,
};

const TTL: Record<number, number> = {
  [OBJECTIVE.FOOD_CRISIS]: 720,
  [OBJECTIVE.TENSION]: 1080,
  [OBJECTIVE.TRADE_LOSS]: 720,
  [OBJECTIVE.ECOLOGY]: 1080,
  [OBJECTIVE.KNOWLEDGE]: 1080,
  [OBJECTIVE.GROWTH]: 1440,
};

function stewardCiv(world: WorldState): number {
  return world.campaign.targetCiv;
}

function routesOf(world: WorldState, civ: number): number {
  const soc = world.society;
  const s = world.settlements;
  let n = 0;
  for (let k = 0; k < soc.routeCount; k++) {
    const ca = s.civ[soc.routeA[k] ?? 0] ?? 0;
    const cb = s.civ[soc.routeB[k] ?? 0] ?? 0;
    if (ca === civ || cb === civ) n++;
  }
  return n;
}

function literacyOf(world: WorldState, civ: number): number {
  const soc = world.society;
  const s = world.settlements;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    sum += soc.literacy[i] ?? 0;
    n++;
  }
  return n === 0 ? 0 : Math.floor(sum / n);
}

function hasAcademy(world: WorldState, civ: number): boolean {
  const bit = INFRA.indexOf('academy');
  const soc = world.society;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
    if (((soc.infra[i] ?? 0) & (1 << bit)) !== 0) return true;
  }
  return false;
}

function hasTreatyWith(world: WorldState, a: number, b: number): boolean {
  const soc = world.society;
  for (let k = 0; k < soc.treatyCount; k++) {
    const ta = soc.treatyA[k] ?? 0;
    const tb = soc.treatyB[k] ?? 0;
    if (((ta === a && tb === b) || (ta === b && tb === a)) && (soc.treatyEnd[k] ?? 0) > world.day) return true;
  }
  return false;
}

/** One real candidate per kind, or null when the condition does not exist. */
function findCandidate(world: WorldState, kind: number): Candidate | null {
  const civ = stewardCiv(world);
  const soc = world.society;
  const s = world.settlements;
  if (kind === OBJECTIVE.FOOD_CRISIS) {
    let best = -1;
    let worst = 30;
    for (let i = 0; i < s.count; i++) {
      if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
      const days = targetSettlementFoodDays(world, i);
      if (days < worst) {
        worst = days;
        best = i;
      }
    }
    if (best < 0) return null;
    return { kind, target: best, targetB: 0, goal: 30, current: worst, hold: HOLD[kind] ?? 30, ttl: TTL[kind] ?? 720 };
  }
  if (kind === OBJECTIVE.TENSION) {
    let other = -1;
    let worst = -15;
    for (let c = 0; c < world.civs.count; c++) {
      if (c === civ) continue;
      if (civLiving(world, c) === 0) continue;
      const rel = relationOf(soc, civ, c);
      if (rel < worst) {
        worst = rel;
        other = c;
      }
    }
    if (other < 0) return null;
    return { kind, target: other, targetB: 0, goal: 0, current: worst, hold: HOLD[kind] ?? 30, ttl: TTL[kind] ?? 1080 };
  }
  if (kind === OBJECTIVE.TRADE_LOSS) {
    const routes = routesOf(world, civ);
    if (routes >= 6) return null;
    let other = -1;
    for (let c = 0; c < world.civs.count; c++) {
      if (c !== civ && civLiving(world, c) > 0 && relationOf(soc, civ, c) > -30) {
        other = c;
        break;
      }
    }
    if (other < 0) return null;
    return { kind, target: other, targetB: 0, goal: Math.min(12, routes + 3), current: routes, hold: HOLD[kind] ?? 60, ttl: TTL[kind] ?? 720 };
  }
  if (kind === OBJECTIVE.ECOLOGY) {
    let best = -1;
    let worst = 70;
    for (let i = 0; i < s.count; i++) {
      if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
      const fert = targetSettlementFertility(world, i);
      const blight = ((soc.flags[i] ?? 0) & FLAG_BLIGHT) !== 0;
      if (fert < worst || (blight && best < 0)) {
        worst = fert;
        best = i;
      }
    }
    if (best < 0) return null;
    return { kind, target: best, targetB: 0, goal: Math.min(220, worst + 12), current: worst, hold: HOLD[kind] ?? 90, ttl: TTL[kind] ?? 1080 };
  }
  if (kind === OBJECTIVE.KNOWLEDGE) {
    const lit = literacyOf(world, civ);
    if (lit >= 55) return null;
    if (civLiving(world, civ) === 0) return null;
    return { kind, target: civ, targetB: 0, goal: Math.min(90, lit + 8), current: lit, hold: HOLD[kind] ?? 60, ttl: TTL[kind] ?? 1080 };
  }
  if (kind === OBJECTIVE.GROWTH) {
    let best = -1;
    let bestPop = 100;
    for (let i = 0; i < s.count; i++) {
      if ((s.civ[i] ?? 0) !== civ || !isAlive(world, i)) continue;
      const tier = s.tier[i] ?? 0;
      if (tier > 1) continue;
      const pop = populationOf(soc, i);
      if (pop >= bestPop) {
        bestPop = pop;
        best = i;
      }
    }
    if (best < 0) return null;
    return { kind, target: best, targetB: 0, goal: 2, current: s.tier[best] ?? 0, hold: HOLD[kind] ?? 0, ttl: TTL[kind] ?? 1440 };
  }
  return null;
}

export function civLiving(world: WorldState, civ: number): number {
  let n = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if ((world.settlements.civ[i] ?? 0) === civ && isAlive(world, i)) n++;
  }
  return n;
}

function unresolved(c: WorldState['campaign'], kind: number): boolean {
  for (let i = 0; i < c.objectiveCount; i++) {
    if ((c.objKind[i] ?? 0) !== kind) continue;
    const st = c.objState[i] ?? 0;
    if (st === OBJECTIVE_STATE.OFFERED || st === OBJECTIVE_STATE.ACTIVE) return true;
  }
  return false;
}

function countState(c: WorldState['campaign'], state: number): number {
  let n = 0;
  for (let i = 0; i < c.objectiveCount; i++) if ((c.objState[i] ?? 0) === state) n++;
  return n;
}

function freeRow(c: WorldState['campaign']): number {
  for (let i = 0; i < c.objectiveCount; i++) {
    const st = c.objState[i] ?? 0;
    if (st === OBJECTIVE_STATE.FREE) return i;
  }
  if (c.objectiveCount < OBJECTIVE_CAPACITY) return c.objectiveCount;
  let oldest = -1;
  let oldestDay = 0x7fffffff;
  for (let i = 0; i < c.objectiveCount; i++) {
    const st = c.objState[i] ?? 0;
    if (st === OBJECTIVE_STATE.OFFERED || st === OBJECTIVE_STATE.ACTIVE) continue;
    const d = c.objStart[i] ?? 0;
    if (d < oldestDay) {
      oldestDay = d;
      oldest = i;
    }
  }
  return oldest;
}

/** Legacy-relevant categories come first, but a world that lacks one falls through to the next. */
function kindOrder(legacy: number): readonly number[] {
  switch (legacy) {
    case 1:
      return [OBJECTIVE.FOOD_CRISIS, OBJECTIVE.ECOLOGY, OBJECTIVE.GROWTH, OBJECTIVE.TENSION, OBJECTIVE.KNOWLEDGE, OBJECTIVE.TRADE_LOSS];
    case 2:
      return [OBJECTIVE.TENSION, OBJECTIVE.TRADE_LOSS, OBJECTIVE.KNOWLEDGE, OBJECTIVE.FOOD_CRISIS, OBJECTIVE.GROWTH, OBJECTIVE.ECOLOGY];
    case 3:
      return [OBJECTIVE.TRADE_LOSS, OBJECTIVE.GROWTH, OBJECTIVE.FOOD_CRISIS, OBJECTIVE.TENSION, OBJECTIVE.KNOWLEDGE, OBJECTIVE.ECOLOGY];
    case 4:
      return [OBJECTIVE.KNOWLEDGE, OBJECTIVE.TENSION, OBJECTIVE.TRADE_LOSS, OBJECTIVE.FOOD_CRISIS, OBJECTIVE.GROWTH, OBJECTIVE.ECOLOGY];
    case 5:
      return [OBJECTIVE.ECOLOGY, OBJECTIVE.FOOD_CRISIS, OBJECTIVE.GROWTH, OBJECTIVE.TENSION, OBJECTIVE.TRADE_LOSS, OBJECTIVE.KNOWLEDGE];
    default:
      return [OBJECTIVE.FOOD_CRISIS, OBJECTIVE.TENSION, OBJECTIVE.TRADE_LOSS, OBJECTIVE.ECOLOGY, OBJECTIVE.KNOWLEDGE, OBJECTIVE.GROWTH];
  }
}

/** Called every 60 days; at most one new offer per call. */
export function generateObjectives(world: WorldState, day: number): void {
  const c = world.campaign;
  if (c.mode !== 1 || c.targetCiv === 255) return;
  if (countState(c, OBJECTIVE_STATE.ACTIVE) >= ACTIVE_LIMIT) return;
  if (countState(c, OBJECTIVE_STATE.OFFERED) >= OFFER_LIMIT) return;
  const order = kindOrder(c.legacy);
  for (const kind of order) {
    const resolvedDay = c.lastResolved[kind] ?? 0;
    if (resolvedDay > 0 && resolvedDay + OBJECTIVE_COOLDOWN_DAYS > day) continue;
    if (unresolved(c, kind)) continue;
    const cand = findCandidate(world, kind);
    if (!cand) continue;
    const row = freeRow(c);
    if (row < 0) return;
    if (row >= c.objectiveCount) c.objectiveCount = row + 1;
    c.objId[row] = c.objectiveSeq++ & 0xffff;
    if (c.objId[row] === 0) c.objId[row] = 1;
    c.objKind[row] = cand.kind;
    c.objState[row] = OBJECTIVE_STATE.OFFERED;
    c.objTarget[row] = cand.target;
    c.objTargetB[row] = cand.targetB;
    c.objStart[row] = day;
    c.objEnd[row] = day + OFFER_TTL_DAYS;
    c.objProgress[row] = cand.current;
    c.objGoal[row] = cand.goal;
    c.objHold[row] = 0;
    c.objHoldGoal[row] = cand.hold;
    c.objSeals[row] = 1;
    return;
  }
}

export interface ObjectiveResult {
  ok: boolean;
  error?: string;
}

export function acceptObjective(world: WorldState, day: number, id: number): ObjectiveResult {
  const c = world.campaign;
  const row = rowOf(c, id);
  if (row < 0) return { ok: false, error: 'NO_OBJECTIVE' };
  if ((c.objState[row] ?? 0) !== OBJECTIVE_STATE.OFFERED) return { ok: false, error: 'NOT_OFFERED' };
  if (day > (c.objEnd[row] ?? 0)) {
    c.objState[row] = OBJECTIVE_STATE.EXPIRED;
    c.lastResolved[c.objKind[row] ?? 0] = day;
    return { ok: false, error: 'OFFER_EXPIRED' };
  }
  c.objState[row] = OBJECTIVE_STATE.ACTIVE;
  c.objStart[row] = day;
  c.objEnd[row] = day + (TTL[c.objKind[row] ?? 0] ?? 720);
  c.objHold[row] = 0;
  appendEvent(
    world.society,
    day,
    EVENT_TYPE.OBJECTIVE_ACCEPTED,
    SEVERITY.NOTABLE,
    objectivePlace(world, c.objTarget[row] ?? 0, c.objKind[row] ?? 0),
    c.targetCiv,
    c.objTargetB[row] ?? 0,
    c.objKind[row] ?? 0,
    0,
  );
  return { ok: true };
}

export function declineObjective(world: WorldState, day: number, id: number): ObjectiveResult {
  const c = world.campaign;
  const row = rowOf(c, id);
  if (row < 0) return { ok: false, error: 'NO_OBJECTIVE' };
  if ((c.objState[row] ?? 0) !== OBJECTIVE_STATE.OFFERED) return { ok: false, error: 'NOT_OFFERED' };
  c.objState[row] = OBJECTIVE_STATE.DECLINED;
  c.lastResolved[c.objKind[row] ?? 0] = day;
  return { ok: true };
}

function objectivePlace(world: WorldState, target: number, kind: number): number {
  if (kind === OBJECTIVE.TENSION || kind === OBJECTIVE.TRADE_LOSS || kind === OBJECTIVE.KNOWLEDGE) {
    return world.civs.capital[stewardCiv(world)] ?? 0;
  }
  return target;
}

function rowOf(c: WorldState['campaign'], id: number): number {
  for (let i = 0; i < c.objectiveCount; i++) if ((c.objId[i] ?? 0) === id) return i;
  return -1;
}

function measureObjective(world: WorldState, kind: number, target: number): number {
  const civ = stewardCiv(world);
  if (kind === OBJECTIVE.FOOD_CRISIS) return targetSettlementFoodDays(world, target);
  if (kind === OBJECTIVE.TENSION) return relationOf(world.society, civ, target);
  if (kind === OBJECTIVE.TRADE_LOSS) return routesOf(world, civ);
  if (kind === OBJECTIVE.ECOLOGY) return targetSettlementFertility(world, target);
  if (kind === OBJECTIVE.KNOWLEDGE) return literacyOf(world, civ);
  if (kind === OBJECTIVE.GROWTH) return world.settlements.tier[target] ?? 0;
  return 0;
}

function satisfied(world: WorldState, kind: number, target: number, goal: number): boolean {
  if (kind === OBJECTIVE.TENSION) {
    return relationOf(world.society, stewardCiv(world), target) >= goal || hasTreatyWith(world, stewardCiv(world), target);
  }
  if (kind === OBJECTIVE.ECOLOGY) {
    const blight = ((world.society.flags[target] ?? 0) & FLAG_BLIGHT) !== 0;
    return !blight && targetSettlementFertility(world, target) >= goal;
  }
  if (kind === OBJECTIVE.KNOWLEDGE) return literacyOf(world, stewardCiv(world)) >= goal || hasAcademy(world, stewardCiv(world));
  return measureObjective(world, kind, target) >= goal;
}

/** Daily evaluation; records completion/failure exactly once. */
export function evaluateObjectives(world: WorldState, day: number, step = 1): void {
  const c = world.campaign;
  if (c.mode !== 1 || c.targetCiv === 255) return;
  for (let i = 0; i < c.objectiveCount; i++) {
    const state = c.objState[i] ?? 0;
    if (state !== OBJECTIVE_STATE.OFFERED && state !== OBJECTIVE_STATE.ACTIVE) continue;
    const kind = c.objKind[i] ?? 0;
    const target = c.objTarget[i] ?? 0;
    if (state === OBJECTIVE_STATE.OFFERED) {
      if (day > (c.objEnd[i] ?? 0)) {
        c.objState[i] = OBJECTIVE_STATE.EXPIRED;
        c.lastResolved[kind] = day;
      }
      continue;
    }
    const value = measureObjective(world, kind, target);
    c.objProgress[i] = value;
    const ok = satisfied(world, kind, target, c.objGoal[i] ?? 0);
    if (!ok) {
      c.objHold[i] = 0;
    } else {
      c.objHold[i] = Math.min(65535, (c.objHold[i] ?? 0) + step);
    }
    const held = ok && (c.objHold[i] ?? 0) >= (c.objHoldGoal[i] ?? 0);
    if (held) {
      c.objState[i] = OBJECTIVE_STATE.COMPLETE;
      c.seals = Math.min(99, c.seals + (c.objSeals[i] ?? 1));
      c.lastResolved[kind] = day;
      appendEvent(
        world.society,
        day,
        EVENT_TYPE.OBJECTIVE_COMPLETE,
        SEVERITY.MAJOR,
        objectivePlace(world, target, kind),
        c.targetCiv,
        c.objTargetB[i] ?? 0,
        kind,
        c.objSeals[i] ?? 1,
      );
    } else if (day > (c.objEnd[i] ?? 0)) {
      c.objState[i] = OBJECTIVE_STATE.FAILED;
      c.lastResolved[kind] = day;
      appendEvent(
        world.society,
        day,
        EVENT_TYPE.OBJECTIVE_FAILED,
        SEVERITY.TRACE,
        objectivePlace(world, target, kind),
        c.targetCiv,
        c.objTargetB[i] ?? 0,
        kind,
        0,
      );
    }
  }
}

/** Total objective completions, for the legacy summary (bounded scan). */
export function completedObjectiveCount(c: WorldState['campaign']): number {
  let n = 0;
  for (let i = 0; i < c.objectiveCount; i++) if ((c.objState[i] ?? 0) === OBJECTIVE_STATE.COMPLETE) n++;
  return n;
}

export function legacyGoalKey(legacy: number): string {
  return legacyDef(legacy).goalKey;
}
