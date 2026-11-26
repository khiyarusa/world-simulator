/**
 * Semantic validation of a decoded society block (defect H-16).
 *
 * Array length and finiteness prove nothing about meaning: a save can carry the right shapes and still
 * be impossible (negative cohorts, stock above capacity, a culture axis at 400, an event whose cause
 * does not exist). Everything that a rule reads must be a legal value before the world is accepted.
 */
import { SimError } from '../../core/errors.ts';
import type { WorldState } from '../state/worldState.ts';
import { COHORT_COUNT, RES_COUNT, type SocietyState } from './state.ts';

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
    }
    for (let other = 0; other < civs; other++) {
      const rel = s.relation[c * civs + other] ?? 0;
      if (rel < -100 || rel > 100) fail(`relation ${c}->${other} is ${rel}`);
    }
  }

  const ids = new Set<number>();
  for (let k = 0; k < s.eventCount; k++) {
    const id = s.eventId[k] ?? 0;
    if (id <= 0 || ids.has(id)) fail(`event id ${id} is not unique and positive`);
    const cause = s.eventCause[k] ?? 0;
    if (cause !== 0 && !ids.has(cause)) fail(`event ${id} references a cause that does not exist yet (${cause})`);
    const day = s.eventDay[k] ?? 0;
    if (day < 1) fail(`event ${id} has day ${day}`);
    ids.add(id);
  }
  if (s.eventCount > 0) {
    let maxId = 0;
    for (let k = 0; k < s.eventCount; k++) maxId = Math.max(maxId, s.eventId[k] ?? 0);
    if (s.nextEventId <= maxId) fail(`next event id ${s.nextEventId} would reuse an existing id`);
  }

  for (let k = 0; k < s.decisionCount; k++) {
    if ((s.decisionActor[k] ?? 0) >= Math.max(1, civs) && (s.decisionActor[k] ?? 0) > settlements) {
      fail(`decision ${k} references an invalid actor`);
    }
  }
}
