/**
 * Society codec: the Stage 3 state travels inside the meta shard as JSON (docs/STAGE_3_DESIGN.md §5).
 *
 * Keeping it in `meta` means the v1 four-shard generation set is still exactly four shards, so the
 * Stage 2.1 completeness rule and recovery logic are untouched. Decoding is defensive: a malformed or
 * short array is a corrupt save, not a partially loaded world.
 *
 * Schema 3 adds trade routes, treaties, wars, military state, prices, technology progress and the
 * occupation marker. A schema-2 block still decodes: the new structures are empty, which is exactly
 * what a world that predates those systems had.
 */
import { SimError } from '../../core/errors.ts';
import type { WorldState } from '../state/worldState.ts';
import { validateSociety } from './validate.ts';
import { appendVital, VITAL_CAPACITY } from './vital.ts';
import {
  allocateSociety,
  COHORT_COUNT,
  CIV_STRIDE,
  DECISION_CAPACITY,
  EVENT_CAPACITY,
  RES_COUNT,
  ROUTE_CAPACITY,
  TREATY_CAPACITY,
  WAR_CAPACITY,
  type SocietyState,
} from './state.ts';

type Numbers = number[];

export interface SocietyDoc {
  v: 2 | 3;
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
  lastFamineEvent: Numbers;
  price: Numbers;
  occupier: Numbers;
  surplusYears: Numbers;
  lastEpidemicDay: Numbers;
  historyDay: Numbers;
  culture: Numbers;
  tech: Numbers;
  techProgress: Numbers;
  legitimacy: Numbers;
  relation: Numbers;
  grievance: Numbers;
  army: Numbers;
  exhaustion: Numbers;
  warWins: Numbers;
  regionDroughtMonths: Numbers;
  regionPrecip: Numbers;
  regionTempAnomaly: Numbers;
  events: { count: number; nextId: number; rows: Numbers };
  vital?: { count: number; rows: Numbers };
  decisions: { count: number; rows: Numbers };
  chronicle: { count: number; rows: Numbers };
  routes: { count: number; rows: Numbers };
  treaties: { count: number; rows: Numbers };
  wars: { count: number; rows: Numbers };
}

const arr = (src: ArrayLike<number>, n: number): Numbers => Array.from(src).slice(0, n);

/** Encode the live state. Event rows are stored oldest→newest so ids stay monotonic on reload. */
export function encodeSociety(world: WorldState): SocietyDoc {
  const s = world.society;
  const sc = world.settlements.count;

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

  const vital: Numbers = [];
  for (let n = 0; n < s.vital.count; n++) {
    const i = (s.vital.head - s.vital.count + n + VITAL_CAPACITY * 2) % VITAL_CAPACITY;
    vital.push(
      s.vital.id[i] ?? 0,
      s.vital.day[i] ?? 0,
      s.vital.type[i] ?? 0,
      s.vital.severity[i] ?? 0,
      s.vital.place[i] ?? 0,
      s.vital.actorA[i] ?? 0,
      s.vital.actorB[i] ?? 0,
      s.vital.magnitude[i] ?? 0,
      s.vital.cause[i] ?? 0,
    );
  }

  const routes: Numbers = [];
  for (let i = 0; i < s.routeCount; i++) {
    routes.push(
      s.routeA[i] ?? 0,
      s.routeB[i] ?? 0,
      s.routeCapacity[i] ?? 0,
      s.routeLength[i] ?? 0,
      s.routeTariff[i] ?? 0,
      s.routeCreated[i] ?? 0,
      s.routeVolume[i] ?? 0,
      s.routeIdle[i] ?? 0,
    );
  }

  const treaties: Numbers = [];
  for (let i = 0; i < s.treatyCount; i++) {
    treaties.push(
      s.treatyA[i] ?? 0,
      s.treatyB[i] ?? 0,
      s.treatyType[i] ?? 0,
      s.treatyStart[i] ?? 0,
      s.treatyEnd[i] ?? 0,
    );
  }

  const wars: Numbers = [];
  for (let i = 0; i < s.warCount; i++) {
    wars.push(
      s.warA[i] ?? 0,
      s.warB[i] ?? 0,
      s.warStart[i] ?? 0,
      s.warScore[i] ?? 0,
      s.warExhaustA[i] ?? 0,
      s.warExhaustB[i] ?? 0,
      s.warBattles[i] ?? 0,
      s.warCause[i] ?? 0,
      s.warGateStrength[i] ?? 0,
      s.warGateGrievance[i] ?? 0,
      s.warGateCapacity[i] ?? 0,
      s.warGateUtility[i] ?? 0,
    );
  }

  return {
    v: 3,
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
    lastFamineEvent: arr(s.lastFamineEvent, sc),
    price: arr(s.price, sc * RES_COUNT),
    occupier: arr(s.occupier, sc),
    surplusYears: arr(s.surplusYears, sc),
    lastEpidemicDay: arr(s.lastEpidemicDay, sc),
    historyDay: arr(s.historyDay, sc * 3),
    culture: arr(s.culture, CIV_STRIDE * 3),
    tech: arr(s.tech, CIV_STRIDE * 12),
    techProgress: arr(s.techProgress, CIV_STRIDE * 12),
    legitimacy: arr(s.legitimacy, CIV_STRIDE),
    relation: arr(s.relation, CIV_STRIDE * CIV_STRIDE),
    grievance: arr(s.grievance, CIV_STRIDE * CIV_STRIDE),
    army: arr(s.army, CIV_STRIDE),
    exhaustion: arr(s.exhaustion, CIV_STRIDE),
    warWins: arr(s.warWins, CIV_STRIDE),
    regionDroughtMonths: arr(s.regionDroughtMonths, 16),
    regionPrecip: arr(s.regionPrecip, 16),
    regionTempAnomaly: arr(s.regionTempAnomaly, 16),
    events: { count: s.eventCount, nextId: s.nextEventId, rows },
    vital: { count: s.vital.count, rows: vital },
    decisions: { count: s.decisionCount, rows: decisions },
    chronicle: { count: s.chronicleCount, rows: chronicle },
    routes: { count: s.routeCount, rows: routes },
    treaties: { count: s.treatyCount, rows: treaties },
    wars: { count: s.warCount, rows: wars },
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

/** Schema-2 blocks lack the newer arrays; in schema 3 their absence is corruption, not "empty". */
function optionalArray(value: unknown, label: string, expected: number, legacy: boolean, fill: number): Numbers {
  if (value === undefined) {
    if (!legacy) throw new SimError('SAVE_CORRUPT', `society.${label} is missing`);
    return new Array<number>(expected).fill(fill);
  }
  return expectArray(value, label, expected);
}

function expectRows(value: unknown, label: string, stride: number, cap: number): Numbers {
  if (!Array.isArray(value)) throw new SimError('SAVE_CORRUPT', `society.${label} is not an array`);
  if (value.length % stride !== 0) throw new SimError('SAVE_CORRUPT', `society.${label} has a partial row`);
  if (value.length / stride > cap) throw new SimError('SAVE_CORRUPT', `society.${label} over capacity`);
  return value as Numbers;
}

/**
 * Civilization-major array. Schema 3 stores the fixed 12-civ stride; schema 2 stored only the used
 * rows, so a genuine v2 block is expanded into the fixed stride instead of being reinterpreted.
 */
function civArray(value: unknown, label: string, width: number, civs: number, legacy: boolean, fill: number): Numbers {
  const fixed = CIV_STRIDE * width;
  if (value === undefined) {
    if (!legacy) throw new SimError('SAVE_CORRUPT', `society.${label} is missing`);
    return new Array<number>(fixed).fill(fill);
  }
  if (!Array.isArray(value)) throw new SimError('SAVE_CORRUPT', `society.${label} is not an array`);
  if (!legacy) return expectArray(value, label, fixed);
  if (value.length === fixed) return value as Numbers;
  if (value.length !== civs * width) {
    throw new SimError('SAVE_CORRUPT', `society.${label} length ${value.length} is neither ${civs * width} nor ${fixed}`);
  }
  const out = new Array<number>(fixed).fill(fill);
  for (let c = 0; c < civs; c++) {
    for (let k = 0; k < width; k++) out[c * width + k] = value[c * width + k] ?? fill;
  }
  return out;
}

/** A civ×civ matrix: schema 3 is 12×12, schema 2 stored only the used `civs × civs` corner. */
function civMatrix(value: unknown, label: string, civs: number, legacy: boolean): Numbers {
  const fixed = CIV_STRIDE * CIV_STRIDE;
  if (value === undefined) {
    if (!legacy) throw new SimError('SAVE_CORRUPT', `society.${label} is missing`);
    return new Array<number>(fixed).fill(0);
  }
  if (!Array.isArray(value)) throw new SimError('SAVE_CORRUPT', `society.${label} is not an array`);
  if (!legacy) return expectArray(value, label, fixed);
  if (value.length === fixed) return value as Numbers;
  if (value.length !== civs * civs) {
    throw new SimError('SAVE_CORRUPT', `society.${label} length ${value.length} != ${civs * civs}`);
  }
  const out = new Array<number>(fixed).fill(0);
  for (let r = 0; r < civs; r++) {
    for (let c = 0; c < civs; c++) out[r * CIV_STRIDE + c] = value[r * civs + c] ?? 0;
  }
  return out;
}

function optionalRows(value: unknown, label: string, stride: number, cap: number, legacy: boolean): Numbers {
  if (value === undefined) {
    if (!legacy) throw new SimError('SAVE_CORRUPT', `society.${label} is missing`);
    return [];
  }
  return expectRows(value, label, stride, cap);
}

export function decodeSociety(world: WorldState, doc: unknown): SocietyState {
  if (!doc || typeof doc !== 'object') throw new SimError('SAVE_CORRUPT', 'society block missing');
  const d = doc as SocietyDoc;
  if (d.v !== 2 && d.v !== 3) throw new SimError('UNSUPPORTED_VERSION', `society block version ${String(d.v)}`);
  const legacy = d.v === 2;

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
  copy(s.lastFamineEvent, optionalArray(d.lastFamineEvent, 'lastFamineEvent', sc, legacy, 0));
  copy(s.price, optionalArray(d.price, 'price', sc * RES_COUNT, legacy, 1000));
  copy(s.occupier, optionalArray(d.occupier, 'occupier', sc, legacy, 0));
  copy(s.surplusYears, optionalArray(d.surplusYears, 'surplusYears', sc, legacy, 0));
  copy(s.lastEpidemicDay, optionalArray(d.lastEpidemicDay, 'lastEpidemicDay', sc, legacy, 0));
  copy(s.historyDay, optionalArray(d.historyDay, 'historyDay', sc * 3, legacy, 0));
  copy(s.culture, civArray(d.culture, 'culture', 3, cc, legacy, 0));
  copy(s.tech, civArray(d.tech, 'tech', 12, cc, legacy, 0));
  copy(s.techProgress, civArray(d.techProgress, 'techProgress', 12, cc, legacy, 0));
  copy(s.legitimacy, civArray(d.legitimacy, 'legitimacy', 1, cc, legacy, 50));
  copy(s.relation, civMatrix(d.relation, 'relation', cc, legacy));
  copy(s.grievance, civMatrix(d.grievance, 'grievance', cc, legacy));
  copy(s.army, civArray(d.army, 'army', 1, cc, legacy, 0));
  copy(s.exhaustion, civArray(d.exhaustion, 'exhaustion', 1, cc, legacy, 0));
  copy(s.warWins, civArray(d.warWins, 'warWins', 1, cc, legacy, 0));
  copy(s.regionDroughtMonths, expectArray(d.regionDroughtMonths, 'regionDroughtMonths', 16));
  copy(s.regionPrecip, expectArray(d.regionPrecip, 'regionPrecip', 16));
  copy(s.regionTempAnomaly, expectArray(d.regionTempAnomaly, 'regionTempAnomaly', 16));

  const events = expectRows(d.events?.rows, 'events.rows', 9, EVENT_CAPACITY);
  s.eventCount = Math.min(EVENT_CAPACITY, d.events?.count ?? 0);
  s.nextEventId = Math.max(1, d.events?.nextId ?? 1);
  if (events.length < s.eventCount * 9) throw new SimError('SAVE_CORRUPT', 'society.events rows shorter than count');
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
  if (decisions.length < s.decisionCount * 5) throw new SimError('SAVE_CORRUPT', 'society.decisions rows shorter than count');
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
  if (chronicle.length < s.chronicleCount * 5) throw new SimError('SAVE_CORRUPT', 'society.chronicle rows shorter than count');
  for (let k = 0; k < s.chronicleCount; k++) {
    const o = k * 5;
    s.chronicleYear[k] = chronicle[o] ?? 0;
    s.chronicleCiv[k] = chronicle[o + 1] ?? 0;
    s.chroniclePop[k] = chronicle[o + 2] ?? 0;
    s.chronicleSettlements[k] = chronicle[o + 3] ?? 0;
    s.chronicleEvents[k] = chronicle[o + 4] ?? 0;
  }
  s.chronicleHead = s.chronicleCount % 4096;

  if (legacy || d.vital === undefined) {
    // an older block kept no vital ring; rebuild it from the severe events it still carries
    for (let k = 0; k < s.eventCount; k++) {
      if ((s.eventSeverity[k] ?? 0) >= 4) {
        appendVital(
          s.vital,
          s.eventId[k] ?? 0,
          s.eventDay[k] ?? 0,
          s.eventType[k] ?? 0,
          s.eventSeverity[k] ?? 0,
          s.eventPlace[k] ?? 0,
          s.eventActorA[k] ?? 0,
          s.eventActorB[k] ?? 0,
          s.eventMagnitude[k] ?? 0,
          s.eventCause[k] ?? 0,
        );
      }
    }
  } else {
    const vitalRows = optionalRows(d.vital?.rows, 'vital.rows', 9, VITAL_CAPACITY, legacy);
    s.vital.count = Math.min(VITAL_CAPACITY, d.vital?.count ?? 0);
    if (vitalRows.length < s.vital.count * 9) throw new SimError('SAVE_CORRUPT', 'society.vital rows shorter than count');
    for (let k = 0; k < s.vital.count; k++) {
      const o = k * 9;
      s.vital.id[k] = vitalRows[o] ?? 0;
      s.vital.day[k] = vitalRows[o + 1] ?? 0;
      s.vital.type[k] = vitalRows[o + 2] ?? 0;
      s.vital.severity[k] = vitalRows[o + 3] ?? 0;
      s.vital.place[k] = vitalRows[o + 4] ?? 0;
      s.vital.actorA[k] = vitalRows[o + 5] ?? 0;
      s.vital.actorB[k] = vitalRows[o + 6] ?? 0;
      s.vital.magnitude[k] = vitalRows[o + 7] ?? 0;
      s.vital.cause[k] = vitalRows[o + 8] ?? 0;
    }
    s.vital.head = s.vital.count % VITAL_CAPACITY;
  }

  const routes = optionalRows(d.routes?.rows, 'routes.rows', 8, ROUTE_CAPACITY, legacy);
  if (!legacy && typeof d.routes?.count !== 'number') throw new SimError('SAVE_CORRUPT', 'society.routes.count is missing');
  s.routeCount = legacy ? 0 : Math.min(ROUTE_CAPACITY, d.routes?.count ?? 0);
  if (routes.length < s.routeCount * 8) throw new SimError('SAVE_CORRUPT', 'society.routes rows shorter than count');
  for (let k = 0; k < s.routeCount; k++) {
    const o = k * 8;
    s.routeA[k] = routes[o] ?? 0;
    s.routeB[k] = routes[o + 1] ?? 0;
    s.routeCapacity[k] = routes[o + 2] ?? 0;
    s.routeLength[k] = routes[o + 3] ?? 0;
    s.routeTariff[k] = routes[o + 4] ?? 0;
    s.routeCreated[k] = routes[o + 5] ?? 0;
    s.routeVolume[k] = routes[o + 6] ?? 0;
    s.routeIdle[k] = routes[o + 7] ?? 0;
  }

  const treaties = optionalRows(d.treaties?.rows, 'treaties.rows', 5, TREATY_CAPACITY, legacy);
  if (!legacy && typeof d.treaties?.count !== 'number') throw new SimError('SAVE_CORRUPT', 'society.treaties.count is missing');
  s.treatyCount = legacy ? 0 : Math.min(TREATY_CAPACITY, d.treaties?.count ?? 0);
  if (treaties.length < s.treatyCount * 5) throw new SimError('SAVE_CORRUPT', 'society.treaties rows shorter than count');
  for (let k = 0; k < s.treatyCount; k++) {
    const o = k * 5;
    s.treatyA[k] = treaties[o] ?? 0;
    s.treatyB[k] = treaties[o + 1] ?? 0;
    s.treatyType[k] = treaties[o + 2] ?? 0;
    s.treatyStart[k] = treaties[o + 3] ?? 0;
    s.treatyEnd[k] = treaties[o + 4] ?? 0;
  }

  const wars = optionalRows(d.wars?.rows, 'wars.rows', 12, WAR_CAPACITY, legacy);
  if (!legacy && typeof d.wars?.count !== 'number') throw new SimError('SAVE_CORRUPT', 'society.wars.count is missing');
  s.warCount = legacy ? 0 : Math.min(WAR_CAPACITY, d.wars?.count ?? 0);
  if (wars.length < s.warCount * 12) throw new SimError('SAVE_CORRUPT', 'society.wars rows shorter than count');
  for (let k = 0; k < s.warCount; k++) {
    const o = k * 12;
    s.warA[k] = wars[o] ?? 0;
    s.warB[k] = wars[o + 1] ?? 0;
    s.warStart[k] = wars[o + 2] ?? 0;
    s.warScore[k] = wars[o + 3] ?? 0;
    s.warExhaustA[k] = wars[o + 4] ?? 0;
    s.warExhaustB[k] = wars[o + 5] ?? 0;
    s.warBattles[k] = wars[o + 6] ?? 0;
    s.warCause[k] = wars[o + 7] ?? 0;
    s.warGateStrength[k] = wars[o + 8] ?? 0;
    s.warGateGrievance[k] = wars[o + 9] ?? 0;
    s.warGateCapacity[k] = wars[o + 10] ?? 0;
    s.warGateUtility[k] = wars[o + 11] ?? 0;
  }

  // semantics, not just shapes: reject an impossible world instead of coercing it
  validateSociety(world, s);
  return s;
}
