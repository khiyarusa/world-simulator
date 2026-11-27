/**
 * Civic charters: bounded, worker-authoritative strategic priorities.
 *
 * A charter never grants a building, an army or a resource. It offsets the utility score the existing
 * AI already uses, inside legality and affordability. The offset is recorded with the decision that
 * it influenced, so the UI can show causality rather than a fictional percentage.
 */
import type { WorldState } from '../state/worldState.ts';
import { appendEvent, EVENT_TYPE, SEVERITY } from '../society/state.ts';
import { INFRA } from '../society/state.ts';
import {
  activeCharterCount,
  CHARTER,
  CHARTER_CAPACITY,
  CHARTER_DAYS,
  charterOf,
  charterSlots,
  hasCharter,
} from './types.ts';
import { populationOf } from '../society/state.ts';
import { isAlive } from '../society/common.ts';

export const CHARTER_BIAS: readonly Readonly<Record<number, number>>[] = [
  {},
  // FOOD
  {
    [INFRA.indexOf('granary')]: 30,
    [INFRA.indexOf('well')]: 24,
    [INFRA.indexOf('irrigation')]: 30,
    [INFRA.indexOf('aqueduct')]: 26,
  },
  // TRADE
  {
    [INFRA.indexOf('market')]: 30,
    [INFRA.indexOf('road')]: 28,
    [INFRA.indexOf('harbour')]: 32,
  },
  // SCHOLARSHIP
  {
    [INFRA.indexOf('academy')]: 34,
    [INFRA.indexOf('temple')]: 18,
  },
  // CONCORD
  {
    [INFRA.indexOf('temple')]: 14,
    [INFRA.indexOf('market')]: 10,
  },
  // DEFENSE
  {
    [INFRA.indexOf('walls')]: 34,
    [INFRA.indexOf('barracks')]: 34,
    [INFRA.indexOf('workshop')]: 10,
  },
  // ECOLOGY
  {
    [INFRA.indexOf('irrigation')]: 28,
    [INFRA.indexOf('aqueduct')]: 22,
    [INFRA.indexOf('granary')]: 16,
    [INFRA.indexOf('well')]: 12,
  },
];

/** Utility offset for one building bit in one civilization at the current day. */
export function charterInfraBias(world: WorldState, civ: number, bit: number): number {
  const kind = charterOf(world.campaign, civ, world.day);
  if (kind === CHARTER.NONE) return 0;
  return CHARTER_BIAS[kind]?.[bit] ?? 0;
}

/** Trade utility multiplier in per-cent: a trade charter makes the same gap more attractive. */
export function charterTradePct(world: WorldState, a: number, b: number): number {
  const ca = world.settlements.civ[a] ?? 0;
  const cb = world.settlements.civ[b] ?? 0;
  if (hasCharter(world, ca, CHARTER.TRADE) || hasCharter(world, cb, CHARTER.TRADE)) return 115;
  return 100;
}

/** Research speed in per-cent for a civ with a scholarship charter. */
export function charterResearchPct(world: WorldState, civ: number): number {
  return hasCharter(world, civ, CHARTER.SCHOLARSHIP) ? 120 : 100;
}

/** Yearly relation drift added when either side has a concord charter. */
export function charterConcordDelta(world: WorldState, a: number, b: number): number {
  return hasCharter(world, a, CHARTER.CONCORD) || hasCharter(world, b, CHARTER.CONCORD) ? 2 : 0;
}

/** Ecology charter: caretaker pressure reduces extraction and helps soil recovery. */
export function charterEcologyCaretaking(world: WorldState, settlement: number): boolean {
  const civ = world.settlements.civ[settlement] ?? 0;
  return hasCharter(world, civ, CHARTER.ECOLOGY);
}

export interface CharterResult {
  ok: boolean;
  error?: string;
  index?: number;
}

function livingSettlements(world: WorldState, civ: number): number {
  let n = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if ((world.settlements.civ[i] ?? 0) === civ && isAlive(world, i)) n++;
  }
  return n;
}

/** Validate and issue a charter. Replacing ends the old term only for the same civilization. */
export function issueCharter(world: WorldState, day: number, civ: number, kind: number, replace: boolean): CharterResult {
  const c = world.campaign;
  if (c.mode !== 1 || c.targetCiv === 255) return { ok: false, error: 'CAMPAIGN_NOT_READY' };
  if (!Number.isInteger(civ) || civ < 0 || civ >= world.civs.count) return { ok: false, error: 'BAD_TARGET' };
  if (livingSettlements(world, civ) === 0) return { ok: false, error: 'NO_LIVING_SETTLEMENT' };
  if (!Number.isInteger(kind) || kind < CHARTER.FOOD || kind > CHARTER.ECOLOGY) return { ok: false, error: 'BAD_CHARTER' };
  const existing = charterOf(c, civ, day);
  if (existing !== CHARTER.NONE && !replace) return { ok: false, error: 'CHARTER_ACTIVE' };
  const active = activeCharterCount(c, day);
  if (existing === CHARTER.NONE && active >= charterSlots(c)) return { ok: false, error: 'NO_CAPACITY' };

  // End the replaced term first, recording it as a real political decision.
  if (existing !== CHARTER.NONE) {
    for (let i = 0; i < c.charterCount; i++) {
      if ((c.chCiv[i] ?? 255) === civ && (c.chEnd[i] ?? 0) > day) {
        c.chEnd[i] = day;
        appendEnded(world, day, civ, existing);
      }
    }
  }

  let row = -1;
  for (let i = 0; i < c.charterCount; i++) {
    if ((c.chEnd[i] ?? 0) <= day) {
      row = i;
      break;
    }
  }
  if (row < 0 && c.charterCount < CHARTER_CAPACITY) row = c.charterCount++;
  if (row < 0) return { ok: false, error: 'CHARTER_LOG_FULL' };

  c.chCiv[row] = civ;
  c.chKind[row] = kind;
  c.chStart[row] = day;
  c.chEnd[row] = day + CHARTER_DAYS;
  c.chReplaceableDay[row] = day + CHARTER_DAYS + 2 * 360;
  appendEvent(world.society, day, EVENT_TYPE.CHARTER_ISSUED, SEVERITY.NOTABLE, world.civs.capital[civ] ?? 0, civ, 0, kind, 0);
  return { ok: true, index: row };
}

function appendEnded(world: WorldState, day: number, civ: number, kind: number): void {
  appendEvent(world.society, day, EVENT_TYPE.CHARTER_ENDED, SEVERITY.TRACE, world.civs.capital[civ] ?? 0, civ, 0, kind, 0);
}

/** Expire finished terms exactly once; the event ring is the durable record. */
export function expireCharters(world: WorldState, day: number): void {
  const c = world.campaign;
  for (let i = 0; i < c.charterCount; i++) {
    if ((c.chKind[i] ?? 0) === 0) continue;
    if ((c.chEnd[i] ?? 0) > day) continue;
    appendEnded(world, day, c.chCiv[i] ?? 0, c.chKind[i] ?? 0);
    c.chKind[i] = 0;
  }
}

export function charterCivPopulation(world: WorldState, civ: number): number {
  let pop = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if ((world.settlements.civ[i] ?? 0) === civ && isAlive(world, i)) pop += populationOf(world.society, i);
  }
  return pop;
}
