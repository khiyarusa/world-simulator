/**
 * Stage 3 society state: cohorts, economy, society, ecology and history (docs/STAGE_3_DESIGN.md).
 *
 * Structure-of-arrays, fixed capacity, integer units. Nothing here knows about rendering or the DOM;
 * the worker owns it and the renderer only ever sees a mirror.
 *
 * Capacity decision: the whole society block is bounded by the settlement/civ caps, so no dynamic
 * growth exists anywhere in this file.
 */
import { CAPACITY } from '../state/worldState.ts';

export const COHORT_COUNT = 8;
export const COHORT = {
  CHILDREN: 0,
  YOUTH: 1,
  FARMERS: 2,
  EXTRACTORS: 3,
  CRAFTERS: 4,
  TRADERS: 5,
  SOLDIERS: 6,
  ELDERS: 7,
} as const;
export const COHORT_NAMES = [
  'children',
  'youth',
  'farmers',
  'extractors',
  'crafters',
  'traders',
  'soldiers',
  'elders',
] as const;

export const RES_COUNT = 6;
export const RES = { FOOD: 0, WATER: 1, WOOD: 2, STONE: 3, METAL: 4, GOODS: 5 } as const;
export const RES_NAMES = ['food', 'water', 'wood', 'stone', 'metal', 'goods'] as const;

/** Infrastructure bits. Order is part of the persisted format. */
export const INFRA = [
  'granary',
  'well',
  'irrigation',
  'walls',
  'market',
  'workshop',
  'road',
  'temple',
  'academy',
  'aqueduct',
  'barracks',
  'harbour',
] as const;
export const INFRA_COUNT = INFRA.length;

export const EVENT_CAPACITY = 20_000;
export const DECISION_CAPACITY = 64;

/** Event types are a closed registry (docs/GDD.md §14). Order is part of the persisted format. */
export const EVENT_TYPE = {
  SETTLEMENT_FOUNDED: 0,
  SETTLEMENT_ABANDONED: 1,
  TIER_UP: 2,
  DROUGHT: 3,
  FLOOD: 4,
  WILDFIRE: 5,
  EPIDEMIC: 6,
  FAMINE: 7,
  BOOM: 8,
  MIGRATION_WAVE: 9,
  ROUTE_OPENED: 10,
  ROUTE_LOST: 11,
  TREATY_SIGNED: 12,
  WAR_DECLARED: 13,
  BATTLE: 14,
  PEACE_SIGNED: 15,
  TECH_DISCOVERED: 16,
  FRAGMENTATION: 17,
  COLLAPSE: 18,
  GOLDEN_AGE: 19,
} as const;
export const EVENT_TYPE_NAMES = [
  'settlement_founded',
  'settlement_abandoned',
  'tier_up',
  'drought',
  'flood',
  'wildfire',
  'epidemic',
  'famine',
  'boom',
  'migration_wave',
  'route_opened',
  'route_lost',
  'treaty_signed',
  'war_declared',
  'battle',
  'peace_signed',
  'tech_discovered',
  'fragmentation',
  'collapse',
  'golden_age',
] as const;

export const SEVERITY = { TRACE: 1, LOCAL: 2, NOTABLE: 3, MAJOR: 4, HISTORIC: 5 } as const;

/** Society and ecology state for the whole world. */
export interface SocietyState {
  /** settlements × COHORT_COUNT, people */
  cohorts: Int32Array;
  /** settlements × 5 adult occupation shares in per-mille (farmers, extractors, crafters, traders, soldiers) */
  occShare: Uint16Array;
  /** settlements × RES_COUNT, units */
  stock: Int32Array;
  /** settlements × RES_COUNT, units */
  cap: Int32Array;
  /** settlements × RES_COUNT, fractional production remainder 0..999 */
  carry: Uint16Array;
  treasury: Int32Array;
  health: Uint8Array;
  stability: Uint8Array;
  literacy: Uint8Array;
  /** bitfield of INFRA indices built */
  infra: Uint32Array;
  /** settlements × 1: 0 alive, 1 ruined */
  /** bit0 ruined, bit1 starving (last tick), bit2 drought-struck */
  flags: Uint8Array;
  foundedDay: Uint32Array;
  /** id of the most recent drought event affecting this settlement, for cause chains */
  lastDroughtEvent: Int32Array;

  /** civs × 3 culture axes, -100..100 */
  culture: Int8Array;
  /** civs × 12 technology flags */
  tech: Uint8Array;
  legitimacy: Uint8Array;
  /** civs × civs relation, -100..100 */
  relation: Int8Array;
  /** civs × civs grievance magnitude */
  grievance: Uint16Array;

  /** regional climate, one entry per region (0..255 on the world grid) */
  regionDroughtMonths: Uint8Array;
  regionPrecip: Uint8Array;
  regionTempAnomaly: Int8Array;

  // --- bounded event ring
  eventCount: number;
  eventHead: number;
  eventId: Int32Array;
  eventDay: Int32Array;
  eventType: Uint8Array;
  eventSeverity: Uint8Array;
  eventPlace: Uint16Array;
  eventActorA: Uint8Array;
  eventActorB: Uint8Array;
  eventMagnitude: Int16Array;
  eventCause: Int32Array;
  nextEventId: number;

  // --- decision ring (explainability)
  decisionCount: number;
  decisionHead: number;
  decisionDay: Int32Array;
  decisionKind: Uint8Array;
  decisionActor: Uint8Array;
  decisionChosen: Uint8Array;
  decisionScore: Uint16Array;

  /** yearly chronicle ring: year, civ, population, settlements, notable events */
  chronicleCount: number;
  chronicleHead: number;
  chronicleYear: Uint16Array;
  chronicleCiv: Uint8Array;
  chroniclePop: Int32Array;
  chronicleSettlements: Uint16Array;
  chronicleEvents: Uint8Array;
}

export function allocateSociety(): SocietyState {
  const s = CAPACITY.settlements;
  const c = CAPACITY.civs;
  return {
    cohorts: new Int32Array(s * COHORT_COUNT),
    occShare: new Uint16Array(s * 5),
    stock: new Int32Array(s * RES_COUNT),
    cap: new Int32Array(s * RES_COUNT),
    carry: new Uint16Array(s * RES_COUNT),
    treasury: new Int32Array(s),
    health: new Uint8Array(s).fill(70),
    stability: new Uint8Array(s).fill(60),
    literacy: new Uint8Array(s),
    infra: new Uint32Array(s),
    flags: new Uint8Array(s),
    foundedDay: new Uint32Array(s),
    lastDroughtEvent: new Int32Array(s),

    culture: new Int8Array(c * 3),
    tech: new Uint8Array(c * 12),
    legitimacy: new Uint8Array(c).fill(50),
    relation: new Int8Array(c * c),
    grievance: new Uint16Array(c * c),

    regionDroughtMonths: new Uint8Array(256),
    regionPrecip: new Uint8Array(256).fill(100),
    regionTempAnomaly: new Int8Array(256),

    eventCount: 0,
    eventHead: 0,
    eventId: new Int32Array(EVENT_CAPACITY),
    eventDay: new Int32Array(EVENT_CAPACITY),
    eventType: new Uint8Array(EVENT_CAPACITY),
    eventSeverity: new Uint8Array(EVENT_CAPACITY),
    eventPlace: new Uint16Array(EVENT_CAPACITY),
    eventActorA: new Uint8Array(EVENT_CAPACITY),
    eventActorB: new Uint8Array(EVENT_CAPACITY),
    eventMagnitude: new Int16Array(EVENT_CAPACITY),
    eventCause: new Int32Array(EVENT_CAPACITY),
    nextEventId: 1,

    decisionCount: 0,
    decisionHead: 0,
    decisionDay: new Int32Array(DECISION_CAPACITY),
    decisionKind: new Uint8Array(DECISION_CAPACITY),
    decisionActor: new Uint8Array(DECISION_CAPACITY),
    decisionChosen: new Uint8Array(DECISION_CAPACITY),
    decisionScore: new Uint16Array(DECISION_CAPACITY),

    chronicleCount: 0,
    chronicleHead: 0,
    chronicleYear: new Uint16Array(4096),
    chronicleCiv: new Uint8Array(4096),
    chroniclePop: new Int32Array(4096),
    chronicleSettlements: new Uint16Array(4096),
    chronicleEvents: new Uint8Array(4096),
  };
}

export function populationOf(soc: SocietyState, settlement: number): number {
  let total = 0;
  const base = settlement * COHORT_COUNT;
  for (let k = 0; k < COHORT_COUNT; k++) total += soc.cohorts[base + k] ?? 0;
  return total;
}

export function cohortOf(soc: SocietyState, settlement: number, cohort: number): number {
  return soc.cohorts[settlement * COHORT_COUNT + cohort] ?? 0;
}

export function addCohort(soc: SocietyState, settlement: number, cohort: number, delta: number): void {
  const at = settlement * COHORT_COUNT + cohort;
  const next = (soc.cohorts[at] ?? 0) + delta;
  soc.cohorts[at] = next < 0 ? 0 : next;
}

export function stockOf(soc: SocietyState, settlement: number, res: number): number {
  return soc.stock[settlement * RES_COUNT + res] ?? 0;
}

export function setStock(soc: SocietyState, settlement: number, res: number, value: number): void {
  soc.stock[settlement * RES_COUNT + res] = value < 0 ? 0 : value;
}

/** Add to a stock, clamped to [0, capacity]. Returns the amount actually added (unit-exact). */
export function addStock(soc: SocietyState, settlement: number, res: number, delta: number): number {
  const at = settlement * RES_COUNT + res;
  const cap = soc.cap[at] ?? 0;
  const before = soc.stock[at] ?? 0;
  const next = before + delta;
  const clamped = next < 0 ? 0 : next > cap ? cap : next;
  soc.stock[at] = clamped;
  return clamped - before;
}

export function infraHas(soc: SocietyState, settlement: number, bit: number): boolean {
  return ((soc.infra[settlement] ?? 0) & (1 << bit)) !== 0;
}

/** Append an event; returns its stable id. Oldest events are dropped when the ring is full. */
export function appendEvent(
  soc: SocietyState,
  day: number,
  type: number,
  severity: number,
  place: number,
  actorA: number,
  actorB: number,
  magnitude: number,
  cause: number,
): number {
  const index = soc.eventHead;
  const id = soc.nextEventId++;
  soc.eventId[index] = id;
  soc.eventDay[index] = day;
  soc.eventType[index] = type;
  soc.eventSeverity[index] = severity;
  soc.eventPlace[index] = place;
  soc.eventActorA[index] = actorA;
  soc.eventActorB[index] = actorB;
  soc.eventMagnitude[index] = magnitude;
  soc.eventCause[index] = cause;
  soc.eventHead = (index + 1) % EVENT_CAPACITY;
  if (soc.eventCount < EVENT_CAPACITY) soc.eventCount++;
  return id;
}

/** Record a decision for on-demand explanation. */
export function recordDecision(
  soc: SocietyState,
  day: number,
  kind: number,
  actor: number,
  chosen: number,
  score: number,
): void {
  const index = soc.decisionHead;
  soc.decisionDay[index] = day;
  soc.decisionKind[index] = kind;
  soc.decisionActor[index] = actor;
  soc.decisionChosen[index] = chosen;
  soc.decisionScore[index] = score > 1000 ? 1000 : score;
  soc.decisionHead = (index + 1) % DECISION_CAPACITY;
  if (soc.decisionCount < DECISION_CAPACITY) soc.decisionCount++;
}

export function appendChronicle(
  soc: SocietyState,
  year: number,
  civ: number,
  population: number,
  settlements: number,
  notableEvents: number,
): void {
  const index = soc.chronicleHead;
  soc.chronicleYear[index] = year;
  soc.chronicleCiv[index] = civ;
  soc.chroniclePop[index] = population;
  soc.chronicleSettlements[index] = settlements;
  soc.chronicleEvents[index] = notableEvents > 255 ? 255 : notableEvents;
  soc.chronicleHead = (index + 1) % 4096;
  if (soc.chronicleCount < 4096) soc.chronicleCount++;
}
