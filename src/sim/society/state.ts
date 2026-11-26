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
import { allocateVitalRing, appendVital, type VitalRing } from './vital.ts';

export const COHORT_COUNT = 8;
/** Civilization-major arrays use this fixed stride. It must never follow `civs.count`, or a new
 * civilization would reinterpret every existing relation and technology row. */
export const CIV_STRIDE = CAPACITY.civs;
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

export const EVENT_CAPACITY = 14_000;
// (the vital ring below keeps 4096 severe rows; 14k + 4k rows keeps the year-200 raw save under
// 1,200,000 bytes, the strict decimal reading of S3-A7; measured max 1,172 KiB at 14.5k)
export const DECISION_CAPACITY = 64;
export const ROUTE_CAPACITY = 400;
export const TREATY_CAPACITY = 64;
export const WAR_CAPACITY = 32;

/** Decision kinds recorded by the utility systems (docs/SIMULATION_MODEL.md §7). */
export const DECISION = {
  BUILD: 1,
  TRADE_ROUTE: 2,
  TREATY: 3,
  WAR: 4,
  TECH: 5,
  FOUND: 6,
} as const;

/** Treaty kinds (GDD §10.2). Order is part of the persisted format. */
export const TREATY = {
  NON_AGGRESSION: 1,
  TRADE: 2,
  ALLIANCE: 3,
  TRIBUTE: 4,
  BORDER: 5,
} as const;
export const TREATY_NAMES = ['none', 'non-aggression', 'trade', 'alliance', 'tribute', 'border'] as const;

/** Technology branches (GDD §8.3): four branches, three tiers, indexed tier-major. */
export const TECH_BRANCH = { AGRICULTURE: 0, INDUSTRY: 1, MILITARY: 2, CIVIC: 3 } as const;
export const TECH_NAME = [
  'agriculture I', 'agriculture II', 'agriculture III',
  'industry I', 'industry II', 'industry III',
  'military I', 'military II', 'military III',
  'civic I', 'civic II', 'civic III',
] as const;

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
  INFRA_BUILT: 20,
  CIV_FORMED: 21,
  TREATY_BROKEN: 22,
  TECH_SPREAD: 23,
  BLIGHT: 24,
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
  'infra_built',
  'civ_formed',
  'treaty_broken',
  'tech_spread',
  'blight',
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
  /** id of the most recent famine event, so an epidemic can name its real cause */
  lastFamineEvent: Int32Array;
  /** settlements × RES_COUNT local price, per-mille of the base value (250..3000) */
  price: Uint16Array;
  /** 0 = self-governed, else the civ index + 1 that currently occupies the settlement */
  occupier: Uint8Array;
  /** consecutive months with a food surplus; tier promotion needs two years of it (GDD §7.1) */
  surplusYears: Uint8Array;
  /** day of the last epidemic in this settlement; a population needs time to regain immunity */
  lastEpidemicDay: Int32Array;
  /** settlements × 3: last drought day, last famine-event day, current shortfall start day */
  historyDay: Int32Array;

  /** civs × 3 culture axes, -100..100 */
  culture: Int8Array;
  /** civs × 12 technology flags */
  tech: Uint8Array;
  legitimacy: Uint8Array;
  /** civs × civs relation, -100..100 */
  relation: Int8Array;
  /** civs × civs grievance magnitude */
  grievance: Uint16Array;
  /** civs × 12 research progress 0..999; the flag in `tech` is the completed node */
  techProgress: Uint16Array;
  /** abstract military strength, in manpower units */
  army: Int32Array;
  /** war exhaustion 0..100, a real limit on how long a war can continue */
  exhaustion: Uint8Array;
  warWins: Uint16Array;

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

  /** severity-4/5 history that survives the main ring's wrap (docs/STAGE_3_DESIGN.md §9.3) */
  vital: VitalRing;

  // --- trade routes: simulation edges, never rendered entities (GDD §9.3)
  routeCount: number;
  routeA: Uint16Array;
  routeB: Uint16Array;
  /** units per day */
  routeCapacity: Uint16Array;
  /** distance in tiles, the cost basis of the tariff */
  routeLength: Uint16Array;
  /** per-mille of moved value paid by the buyer to the seller's treasury */
  routeTariff: Uint8Array;
  routeCreated: Int32Array;
  routeVolume: Int32Array;
  /** consecutive monthly periods with no move; a route that does not trade closes */
  routeIdle: Uint8Array;

  // --- treaties (GDD §10.2)
  treatyCount: number;
  treatyA: Uint8Array;
  treatyB: Uint8Array;
  treatyType: Uint8Array;
  treatyStart: Int32Array;
  treatyEnd: Int32Array;

  // --- wars (GDD §10.3, §11); the gate values are persisted evidence, not a narrative
  warCount: number;
  warA: Uint8Array;
  warB: Uint8Array;
  warStart: Int32Array;
  /** war score, positive = A winning */
  warScore: Int8Array;
  warExhaustA: Uint8Array;
  warExhaustB: Uint8Array;
  warBattles: Uint16Array;
  /** event id of the declaration, the cause of every battle */
  warCause: Int32Array;
  /** the four gate values at declaration: strength per-mille, grievance, capacity, utility margin */
  warGateStrength: Uint16Array;
  warGateGrievance: Uint16Array;
  warGateCapacity: Uint16Array;
  warGateUtility: Uint16Array;
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
    lastFamineEvent: new Int32Array(s),
    price: new Uint16Array(s * RES_COUNT).fill(1000),
    occupier: new Uint8Array(s),
    surplusYears: new Uint8Array(s),
    lastEpidemicDay: new Int32Array(s),
    historyDay: new Int32Array(s * 3),

    culture: new Int8Array(c * 3),
    tech: new Uint8Array(c * 12),
    legitimacy: new Uint8Array(c).fill(50),
    relation: new Int8Array(c * c),
    grievance: new Uint16Array(c * c),
    techProgress: new Uint16Array(c * 12),
    army: new Int32Array(c),
    exhaustion: new Uint8Array(c),
    warWins: new Uint16Array(c),

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

    vital: allocateVitalRing(),

    routeCount: 0,
    routeA: new Uint16Array(ROUTE_CAPACITY),
    routeB: new Uint16Array(ROUTE_CAPACITY),
    routeCapacity: new Uint16Array(ROUTE_CAPACITY),
    routeLength: new Uint16Array(ROUTE_CAPACITY),
    routeTariff: new Uint8Array(ROUTE_CAPACITY),
    routeCreated: new Int32Array(ROUTE_CAPACITY),
    routeVolume: new Int32Array(ROUTE_CAPACITY),
    routeIdle: new Uint8Array(ROUTE_CAPACITY),

    treatyCount: 0,
    treatyA: new Uint8Array(TREATY_CAPACITY),
    treatyB: new Uint8Array(TREATY_CAPACITY),
    treatyType: new Uint8Array(TREATY_CAPACITY),
    treatyStart: new Int32Array(TREATY_CAPACITY),
    treatyEnd: new Int32Array(TREATY_CAPACITY),

    warCount: 0,
    warA: new Uint8Array(WAR_CAPACITY),
    warB: new Uint8Array(WAR_CAPACITY),
    warStart: new Int32Array(WAR_CAPACITY),
    warScore: new Int8Array(WAR_CAPACITY),
    warExhaustA: new Uint8Array(WAR_CAPACITY),
    warExhaustB: new Uint8Array(WAR_CAPACITY),
    warBattles: new Uint16Array(WAR_CAPACITY),
    warCause: new Int32Array(WAR_CAPACITY),
    warGateStrength: new Uint16Array(WAR_CAPACITY),
    warGateGrievance: new Uint16Array(WAR_CAPACITY),
    warGateCapacity: new Uint16Array(WAR_CAPACITY),
    warGateUtility: new Uint16Array(WAR_CAPACITY),
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
  // severe history is kept even after the main ring overwrites it
  if (severity >= 4) {
    appendVital(soc.vital, id, day, type, severity, place, actorA, actorB, magnitude, cause);
  }
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
