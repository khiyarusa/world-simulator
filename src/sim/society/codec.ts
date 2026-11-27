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
import type { Numbers, SocietyDoc } from './codecTypes.ts';
export { encodeSociety } from './codecEncode.ts';
import { allocateSociety } from './allocate.ts';
import { appendVital, VITAL_CAPACITY } from './vital.ts';
import {
  COHORT_COUNT,
  CIV_STRIDE,
  DECISION_CAPACITY,
  EVENT_CAPACITY,
  INTERVENTION_CAPACITY,
  RES_COUNT,
  ROUTE_CAPACITY,
  SETTLEMENT_TREND_SAMPLES,
  STATS_CAPACITY,
  TREATY_CAPACITY,
  WAR_CAPACITY,
  type SocietyState,
} from './state.ts';

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
  if (d.v !== 2 && d.v !== 3 && d.v !== 4 && d.v !== 5) {
    throw new SimError('UNSUPPORTED_VERSION', `society block version ${String(d.v)}`);
  }
  const legacy = d.v === 2;
  const stage4 = d.v === 4 || d.v === 5;
  const stage5 = d.v === 5;

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

  const decisionStride = stage5 ? 6 : 5;
  const decisions = expectRows(d.decisions?.rows, 'decisions.rows', decisionStride, DECISION_CAPACITY);
  s.decisionCount = Math.min(DECISION_CAPACITY, d.decisions?.count ?? 0);
  if (decisions.length < s.decisionCount * decisionStride) {
    throw new SimError('SAVE_CORRUPT', 'society.decisions rows shorter than count');
  }
  for (let k = 0; k < s.decisionCount; k++) {
    const o = k * decisionStride;
    s.decisionDay[k] = decisions[o] ?? 0;
    s.decisionKind[k] = decisions[o + 1] ?? 0;
    s.decisionActor[k] = decisions[o + 2] ?? 0;
    s.decisionChosen[k] = decisions[o + 3] ?? 0;
    s.decisionScore[k] = decisions[o + 4] ?? 0;
    s.decisionBias[k] = stage5 ? (decisions[o + 5] ?? 0) : 0;
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

  // --- schema 4: player interventions and the yearly series
  if (stage4) {
    const iv = d.interventions;
    if (!iv || typeof iv.count !== 'number') throw new SimError('SAVE_CORRUPT', 'society.interventions is missing');
    const last = expectArray(iv.last, 'interventions.last', 4);
    for (let k = 0; k < 4; k++) s.interventionLastDay[k] = last[k] ?? 0;
    const rows = expectRows(iv.rows, 'interventions.rows', 8, INTERVENTION_CAPACITY);
    s.interventionCount = Math.min(INTERVENTION_CAPACITY, iv.count);
    if (rows.length < s.interventionCount * 8) {
      throw new SimError('SAVE_CORRUPT', 'society.interventions rows shorter than count');
    }
    for (let k = 0; k < s.interventionCount; k++) {
      const o = k * 8;
      s.interventionKind[k] = rows[o] ?? 0;
      s.interventionA[k] = rows[o + 1] ?? 0;
      s.interventionB[k] = rows[o + 2] ?? 0;
      s.interventionStart[k] = rows[o + 3] ?? 0;
      s.interventionEnd[k] = rows[o + 4] ?? 0;
      s.interventionIntensity[k] = rows[o + 5] ?? 0;
      s.interventionResource[k] = rows[o + 6] ?? 255;
      s.interventionAmount[k] = rows[o + 7] ?? 0;
    }
    s.interventionHead = s.interventionCount % INTERVENTION_CAPACITY;

    const stats = d.stats;
    if (!stats || typeof stats.count !== 'number') throw new SimError('SAVE_CORRUPT', 'society.stats is missing');
    const stRows = expectRows(stats.rows, 'stats.rows', 10, STATS_CAPACITY);
    s.statsCount = Math.min(STATS_CAPACITY, stats.count);
    if (stRows.length < s.statsCount * 10) throw new SimError('SAVE_CORRUPT', 'society.stats rows shorter than count');
    for (let k = 0; k < s.statsCount; k++) {
      const o = k * 10;
      s.statsYear[k] = stRows[o] ?? 0;
      s.statsPopulation[k] = stRows[o + 1] ?? 0;
      s.statsSettlements[k] = stRows[o + 2] ?? 0;
      s.statsCivs[k] = stRows[o + 3] ?? 0;
      s.statsFoodProduced[k] = stRows[o + 4] ?? 0;
      s.statsTradeVolume[k] = stRows[o + 5] ?? 0;
      s.statsTreasury[k] = stRows[o + 6] ?? 0;
      s.statsWars[k] = stRows[o + 7] ?? 0;
      s.statsFertility[k] = stRows[o + 8] ?? 0;
      s.statsDrought[k] = stRows[o + 9] ?? 0;
    }
    s.statsHead = s.statsCount % STATS_CAPACITY;

    const trend = d.trend;
    if (!trend) throw new SimError('SAVE_CORRUPT', 'society.trend is missing');
    copy(s.trendCount, expectArray(trend.counts, 'trend.counts', sc));
    copy(s.trendPop, expectArray(trend.values, 'trend.values', sc * SETTLEMENT_TREND_SAMPLES));
    for (let i = 0; i < sc; i++) {
      if ((s.trendCount[i] ?? 0) > SETTLEMENT_TREND_SAMPLES) {
        throw new SimError('SAVE_CORRUPT', `settlement ${i} trend count is ${s.trendCount[i]}`);
      }
    }
  }
  // a schema-2/3 world predates interventions; its rings stay empty, which is the truth about it

  // semantics, not just shapes: reject an impossible world instead of coercing it
  validateSociety(world, s);
  return s;
}
