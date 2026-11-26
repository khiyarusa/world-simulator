/**
 * Semantic validation of a decoded society block (defect H-16).
 *
 * Array length and finiteness prove nothing about meaning: a save can carry the right shapes and still
 * be impossible (negative cohorts, stock above capacity, a culture axis at 400, an event whose cause
 * does not exist). Everything that a rule reads must be a legal value before the world is accepted.
 */
import { SimError } from '../../core/errors.ts';
import type { WorldState } from '../state/worldState.ts';
import {
  COHORT_COUNT,
  CIV_STRIDE,
  RES_COUNT,
  ROUTE_CAPACITY,
  TREATY_CAPACITY,
  WAR_CAPACITY,
  type SocietyState,
} from './state.ts';

const fail = (msg: string): never => {
  throw new SimError('SAVE_CORRUPT', `society: ${msg}`);
};

export function validateSociety(world: WorldState, s: SocietyState): void {
  const settlements = world.settlements.count;
  const civs = world.civs.count;

  for (let i = 0; i < settlements; i++) {
    let sum = 0;
    for (let c = 0; c < COHORT_COUNT; c++) {
      const v = s.cohorts[i * COHORT_COUNT + c] ?? 0;
      if (!Number.isInteger(v) || v < 0) fail(`cohort ${c} of settlement ${i} is ${v}`);
      sum += v;
    }
    const pop = world.settlements.pop[i] ?? 0;
    if (sum !== pop) fail(`settlement ${i} cohorts sum to ${sum}, population is ${pop}`);

    let share = 0;
    for (let k = 0; k < 5; k++) share += s.occShare[i * 5 + k] ?? 0;
    if (share !== 1000) fail(`settlement ${i} occupation shares sum to ${share}`);

    for (let r = 0; r < RES_COUNT; r++) {
      const stock = s.stock[i * RES_COUNT + r] ?? 0;
      const cap = s.cap[i * RES_COUNT + r] ?? 0;
      if (!Number.isInteger(stock) || stock < 0) fail(`settlement ${i} stock ${r} is ${stock}`);
      if (stock > cap) fail(`settlement ${i} stock ${r} ${stock} exceeds capacity ${cap}`);
      const carry = s.carry[i * RES_COUNT + r] ?? 0;
      if (carry > 999) fail(`settlement ${i} carry ${r} is ${carry}`);
    }

    if ((s.health[i] ?? 0) > 100) fail(`settlement ${i} health out of range`);
    if ((s.stability[i] ?? 0) > 100) fail(`settlement ${i} stability out of range`);
    if (((s.infra[i] ?? 0) & ~0xfff) !== 0) fail(`settlement ${i} has unknown infrastructure bits`);
    if ((s.occupier[i] ?? 0) > civs) fail(`settlement ${i} is occupied by an unknown civ`);
    for (let r = 0; r < RES_COUNT; r++) {
      const price = s.price[i * RES_COUNT + r] ?? 0;
      if (price < 250 || price > 3000) fail(`settlement ${i} price ${r} is ${price}`);
    }
  }

  for (let c = 0; c < civs; c++) {
    if ((s.legitimacy[c] ?? 0) > 100) fail(`civ ${c} legitimacy out of range`);
    for (let a = 0; a < 3; a++) {
      const v = s.culture[c * 3 + a] ?? 0;
      if (v < -100 || v > 100) fail(`civ ${c} culture axis ${a} is ${v}`);
    }
    for (let t = 0; t < 12; t++) {
      const v = s.tech[c * 12 + t] ?? 0;
      if (v > 1) fail(`civ ${c} technology ${t} is ${v}`);
      if ((s.techProgress[c * 12 + t] ?? 0) > 1000) fail(`civ ${c} research progress ${t} out of range`);
    }
    if ((s.army[c] ?? 0) < 0) fail(`civ ${c} has a negative army`);
    if ((s.exhaustion[c] ?? 0) > 100) fail(`civ ${c} exhaustion out of range`);
    for (let other = 0; other < CIV_STRIDE; other++) {
      const rel = s.relation[c * CIV_STRIDE + other] ?? 0;
      if (rel < -100 || rel > 100) fail(`relation ${c}->${other} is ${rel}`);
    }
  }

  const allIds = new Set<number>();
  const vitalIds = new Set<number>();
  for (let k = 0; k < s.vital.count; k++) {
    const id = s.vital.id[k] ?? 0;
    if (id <= 0 || vitalIds.has(id)) fail(`vital event id ${id} is not unique and positive`);
    allIds.add(id);
    vitalIds.add(id);
  }
  const mainIds = new Set<number>();
  const cap = s.eventId.length;
  let retentionFloor = Number.MAX_SAFE_INTEGER;
  if (s.eventCount > 0) {
    const oldest = (s.eventHead - s.eventCount + cap * 2) % cap;
    retentionFloor = Math.min(retentionFloor, s.eventId[oldest] ?? 0);
  }
  if (s.vital.count > 0) {
    const oldestVital = (s.vital.head - s.vital.count + s.vital.id.length * 2) % s.vital.id.length;
    retentionFloor = Math.min(retentionFloor, s.vital.id[oldestVital] ?? 0);
  }
  for (let n = 0; n < s.eventCount; n++) {
    // logical order (oldest first), not physical index order: after a wrap the array starts mid-history
    const k = (s.eventHead - s.eventCount + n + cap * 2) % cap;
    const id = s.eventId[k] ?? 0;
    if (id <= 0 || mainIds.has(id)) fail(`event id ${id} is not unique and positive`);
    const cause = s.eventCause[k] ?? 0;
    if (cause !== 0 && cause !== -1) {
      // a cause older than the retention floor was evicted by the documented ring budget, not lost
      if (!allIds.has(cause) && cause >= retentionFloor) {
        fail(`event ${id} references a cause that does not exist (${cause})`);
      }
      if (cause >= id) fail(`event ${id} references a later cause (${cause})`);
    }
    const day = s.eventDay[k] ?? 0;
    if (day < 1) fail(`event ${id} has day ${day}`);
    mainIds.add(id);
    allIds.add(id);
  }
  if (s.eventCount > 0) {
    let maxId = 0;
    for (let k = 0; k < s.eventCount; k++) maxId = Math.max(maxId, s.eventId[k] ?? 0);
    if (s.nextEventId <= maxId) fail(`next event id ${s.nextEventId} would reuse an existing id`);
  }

  if (s.routeCount > ROUTE_CAPACITY) fail(`route count ${s.routeCount} over capacity`);
  for (let k = 0; k < s.routeCount; k++) {
    const a = s.routeA[k] ?? 0;
    const b = s.routeB[k] ?? 0;
    if (a === b) fail(`route ${k} has identical endpoints`);
    if (a >= settlements || b >= settlements) fail(`route ${k} references a missing settlement`);
    if ((s.routeCapacity[k] ?? 0) === 0) fail(`route ${k} has no capacity`);
    if ((s.routeTariff[k] ?? 0) >= 1000) fail(`route ${k} tariff is not a per-mille`);
  }

  if (s.treatyCount > TREATY_CAPACITY) fail(`treaty count ${s.treatyCount} over capacity`);
  for (let k = 0; k < s.treatyCount; k++) {
    const a = s.treatyA[k] ?? 0;
    const b = s.treatyB[k] ?? 0;
    if (a === b) fail(`treaty ${k} has identical participants`);
    if (a >= civs || b >= civs) fail(`treaty ${k} references a missing civilization`);
    const type = s.treatyType[k] ?? 0;
    if (type < 1 || type > 5) fail(`treaty ${k} has unknown type ${type}`);
    if ((s.treatyEnd[k] ?? 0) <= (s.treatyStart[k] ?? 0)) fail(`treaty ${k} expires before it starts`);
  }

  if (s.warCount > WAR_CAPACITY) fail(`war count ${s.warCount} over capacity`);
  for (let k = 0; k < s.warCount; k++) {
    const a = s.warA[k] ?? 0;
    const b = s.warB[k] ?? 0;
    if (a === b) fail(`war ${k} has identical participants`);
    if (a >= civs || b >= civs) fail(`war ${k} references a missing civilization`);
    const score = s.warScore[k] ?? 0;
    if (score < -100 || score > 100) fail(`war ${k} score out of range`);
    if ((s.warExhaustA[k] ?? 0) > 100 || (s.warExhaustB[k] ?? 0) > 100) fail(`war ${k} exhaustion out of range`);
    if ((s.warGateStrength[k] ?? 0) < 1250) fail(`war ${k} was declared below the strength gate`);
    if ((s.warGateGrievance[k] ?? 0) < 40) fail(`war ${k} was declared below the grievance gate`);
    if ((s.warGateCapacity[k] ?? 0) < 30) fail(`war ${k} was declared without campaign capacity`);
    if ((s.warGateUtility[k] ?? 0) < 50) fail(`war ${k} was declared below the utility margin`);
    if ((s.warCause[k] ?? 0) === 0) fail(`war ${k} has no declaration event`);
  }

  for (let k = 0; k < s.decisionCount; k++) {
    if ((s.decisionActor[k] ?? 0) >= Math.max(1, civs) && (s.decisionActor[k] ?? 0) > settlements) {
      fail(`decision ${k} references an invalid actor`);
    }
  }
}
