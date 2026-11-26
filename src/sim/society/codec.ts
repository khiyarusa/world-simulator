/**
 * Society codec: the Stage 3 state travels inside the meta shard as JSON (docs/STAGE_3_DESIGN.md §5).
 *
 * Keeping it in `meta` means the v1 four-shard generation set is still exactly four shards, so the
 * Stage 2.1 completeness rule and recovery logic are untouched. Decoding is defensive: a malformed or
 * short array is a corrupt save, not a partially loaded world.
 */
import { SimError } from '../../core/errors.ts';
import type { WorldState } from '../state/worldState.ts';
import { validateSociety } from './validate.ts';
import {
  allocateSociety,
  COHORT_COUNT,
  DECISION_CAPACITY,
  EVENT_CAPACITY,
  RES_COUNT,
  type SocietyState,
} from './state.ts';

type Numbers = number[];

export interface SocietyDoc {
  v: 2;
  cohorts: Numbers;
  occShare: Numbers;
  stock: Numbers;
  cap: Numbers;
  carry: Numbers;
  treasury: Numbers;
  health: Numbers;
  stability: Numbers;
  literacy: Numbers;
  infra: Numbers;
  flags: Numbers;
  foundedDay: Numbers;
  lastDroughtEvent: Numbers;
  culture: Numbers;
  tech: Numbers;
  legitimacy: Numbers;
  relation: Numbers;
  grievance: Numbers;
  regionDroughtMonths: Numbers;
  regionPrecip: Numbers;
  regionTempAnomaly: Numbers;
  events: { count: number; nextId: number; rows: Numbers };
  decisions: { count: number; rows: Numbers };
  chronicle: { count: number; rows: Numbers };
}

const arr = (src: ArrayLike<number>, n: number): Numbers => Array.from(src).slice(0, n);

/** Encode the live state. Event rows are stored oldest→newest so ids stay monotonic on reload. */
export function encodeSociety(world: WorldState): SocietyDoc {
  const s = world.society;
  const sc = world.settlements.count;
  const cc = world.civs.count;

  const rows: Numbers = [];
  for (let k = 0; k < s.eventCount; k++) {
    const i = (s.eventHead - s.eventCount + k + EVENT_CAPACITY * 2) % EVENT_CAPACITY;
    rows.push(
      s.eventId[i] ?? 0,
      s.eventDay[i] ?? 0,
      s.eventType[i] ?? 0,
      s.eventSeverity[i] ?? 0,
      s.eventPlace[i] ?? 0,
      s.eventActorA[i] ?? 0,
      s.eventActorB[i] ?? 0,
      s.eventMagnitude[i] ?? 0,
      s.eventCause[i] ?? 0,
    );
  }

  const decisions: Numbers = [];
  for (let k = 0; k < s.decisionCount; k++) {
    const i = (s.decisionHead - s.decisionCount + k + DECISION_CAPACITY * 2) % DECISION_CAPACITY;
    decisions.push(
      s.decisionDay[i] ?? 0,
      s.decisionKind[i] ?? 0,
      s.decisionActor[i] ?? 0,
      s.decisionChosen[i] ?? 0,
      s.decisionScore[i] ?? 0,
    );
  }

  const chronicle: Numbers = [];
  for (let k = 0; k < s.chronicleCount; k++) {
    const i = (s.chronicleHead - s.chronicleCount + k + 8192) % 4096;
    chronicle.push(
      s.chronicleYear[i] ?? 0,
      s.chronicleCiv[i] ?? 0,
      s.chroniclePop[i] ?? 0,
      s.chronicleSettlements[i] ?? 0,
      s.chronicleEvents[i] ?? 0,
    );
  }

  return {
    v: 2,
    cohorts: arr(s.cohorts, sc * COHORT_COUNT),
    occShare: arr(s.occShare, sc * 5),
    stock: arr(s.stock, sc * RES_COUNT),
    cap: arr(s.cap, sc * RES_COUNT),
    carry: arr(s.carry, sc * RES_COUNT),
    treasury: arr(s.treasury, sc),
    health: arr(s.health, sc),
    stability: arr(s.stability, sc),
    literacy: arr(s.literacy, sc),
    infra: arr(s.infra, sc),
    flags: arr(s.flags, sc),
    foundedDay: arr(s.foundedDay, sc),
    lastDroughtEvent: arr(s.lastDroughtEvent, sc),
    culture: arr(s.culture, cc * 3),
    tech: arr(s.tech, cc * 12),
    legitimacy: arr(s.legitimacy, cc),
    relation: arr(s.relation, cc * cc),
    grievance: arr(s.grievance, cc * cc),
    regionDroughtMonths: arr(s.regionDroughtMonths, 16),
    regionPrecip: arr(s.regionPrecip, 16),
    regionTempAnomaly: arr(s.regionTempAnomaly, 16),
    events: { count: s.eventCount, nextId: s.nextEventId, rows },
    decisions: { count: s.decisionCount, rows: decisions },
    chronicle: { count: s.chronicleCount, rows: chronicle },
  };
}

function expectArray(value: unknown, label: string, expected: number): Numbers {
  if (!Array.isArray(value)) throw new SimError('SAVE_CORRUPT', `society.${label} is not an array`);
  if (value.length !== expected) {
    throw new SimError('SAVE_CORRUPT', `society.${label} length ${value.length} != ${expected}`);
  }
  for (let i = 0; i < value.length; i++) {
    const n = value[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new SimError('SAVE_CORRUPT', `society.${label}[${i}] is not a number`);
    }
  }
  return value as Numbers;
}

function expectRows(value: unknown, label: string, stride: number, cap: number): Numbers {
  if (!Array.isArray(value)) throw new SimError('SAVE_CORRUPT', `society.${label} is not an array`);
  if (value.length % stride !== 0) throw new SimError('SAVE_CORRUPT', `society.${label} has a partial row`);
  if (value.length / stride > cap) throw new SimError('SAVE_CORRUPT', `society.${label} over capacity`);
  return value as Numbers;
}

export function decodeSociety(world: WorldState, doc: unknown): SocietyState {
  if (!doc || typeof doc !== 'object') throw new SimError('SAVE_CORRUPT', 'society block missing');
  const d = doc as SocietyDoc;
  if (d.v !== 2) throw new SimError('UNSUPPORTED_VERSION', `society block version ${String(d.v)}`);

  const sc = world.settlements.count;
  const cc = world.civs.count;
  const s = allocateSociety();

  const copy = (target: ArrayLike<number> & { [n: number]: number }, src: Numbers): void => {
    for (let i = 0; i < src.length; i++) target[i] = src[i] ?? 0;
  };

  copy(s.cohorts, expectArray(d.cohorts, 'cohorts', sc * COHORT_COUNT));
  copy(s.occShare, expectArray(d.occShare, 'occShare', sc * 5));
  copy(s.stock, expectArray(d.stock, 'stock', sc * RES_COUNT));
  copy(s.cap, expectArray(d.cap, 'cap', sc * RES_COUNT));
  copy(s.carry, expectArray(d.carry, 'carry', sc * RES_COUNT));
  copy(s.treasury, expectArray(d.treasury, 'treasury', sc));
  copy(s.health, expectArray(d.health, 'health', sc));
  copy(s.stability, expectArray(d.stability, 'stability', sc));
  copy(s.literacy, expectArray(d.literacy, 'literacy', sc));
  copy(s.infra, expectArray(d.infra, 'infra', sc));
  copy(s.flags, expectArray(d.flags, 'flags', sc));
  copy(s.foundedDay, expectArray(d.foundedDay, 'foundedDay', sc));
  copy(s.lastDroughtEvent, expectArray(d.lastDroughtEvent, 'lastDroughtEvent', sc));
  copy(s.culture, expectArray(d.culture, 'culture', cc * 3));
  copy(s.tech, expectArray(d.tech, 'tech', cc * 12));
  copy(s.legitimacy, expectArray(d.legitimacy, 'legitimacy', cc));
  copy(s.relation, expectArray(d.relation, 'relation', cc * cc));
  copy(s.grievance, expectArray(d.grievance, 'grievance', cc * cc));
  copy(s.regionDroughtMonths, expectArray(d.regionDroughtMonths, 'regionDroughtMonths', 16));
  copy(s.regionPrecip, expectArray(d.regionPrecip, 'regionPrecip', 16));
  copy(s.regionTempAnomaly, expectArray(d.regionTempAnomaly, 'regionTempAnomaly', 16));

  const events = expectRows(d.events?.rows, 'events.rows', 9, EVENT_CAPACITY);
  s.eventCount = Math.min(EVENT_CAPACITY, d.events?.count ?? 0);
  s.nextEventId = Math.max(1, d.events?.nextId ?? 1);
  for (let k = 0; k < s.eventCount; k++) {
    const o = k * 9;
    s.eventId[k] = events[o] ?? 0;
    s.eventDay[k] = events[o + 1] ?? 0;
    s.eventType[k] = events[o + 2] ?? 0;
    s.eventSeverity[k] = events[o + 3] ?? 0;
    s.eventPlace[k] = events[o + 4] ?? 0;
    s.eventActorA[k] = events[o + 5] ?? 0;
    s.eventActorB[k] = events[o + 6] ?? 0;
    s.eventMagnitude[k] = events[o + 7] ?? 0;
    s.eventCause[k] = events[o + 8] ?? 0;
  }
  s.eventHead = s.eventCount % EVENT_CAPACITY;

  const decisions = expectRows(d.decisions?.rows, 'decisions.rows', 5, DECISION_CAPACITY);
  s.decisionCount = Math.min(DECISION_CAPACITY, d.decisions?.count ?? 0);
  for (let k = 0; k < s.decisionCount; k++) {
    const o = k * 5;
    s.decisionDay[k] = decisions[o] ?? 0;
    s.decisionKind[k] = decisions[o + 1] ?? 0;
    s.decisionActor[k] = decisions[o + 2] ?? 0;
    s.decisionChosen[k] = decisions[o + 3] ?? 0;
    s.decisionScore[k] = decisions[o + 4] ?? 0;
  }
  s.decisionHead = s.decisionCount % DECISION_CAPACITY;

  const chronicle = expectRows(d.chronicle?.rows, 'chronicle.rows', 5, 4096);
  s.chronicleCount = Math.min(4096, d.chronicle?.count ?? 0);
  for (let k = 0; k < s.chronicleCount; k++) {
    const o = k * 5;
    s.chronicleYear[k] = chronicle[o] ?? 0;
    s.chronicleCiv[k] = chronicle[o + 1] ?? 0;
    s.chroniclePop[k] = chronicle[o + 2] ?? 0;
    s.chronicleSettlements[k] = chronicle[o + 3] ?? 0;
    s.chronicleEvents[k] = chronicle[o + 4] ?? 0;
  }
  s.chronicleHead = s.chronicleCount % 4096;

  // semantics, not just shapes: reject an impossible world instead of coercing it
  validateSociety(world, s);
  return s;
}
