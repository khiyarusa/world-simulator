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
import { appendVital, type VitalRing } from './vital.ts';

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

/** Stage 4: player interventions and the yearly world series. Both rings are bounded and persisted. */
export const INTERVENTION_CAPACITY = 64;
export const STATS_CAPACITY = 256;
/** Six yearly population samples per settlement: enough for an honest sparkline, small on disk. */
export const SETTLEMENT_TREND_SAMPLES = 6;

/** The four interventions of GDD §3. Order is part of the persisted format. */
export const INTERVENTION = { BLESS: 0, BLIGHT: 1, FERTILIZE: 2, INCITE: 3 } as const;
export type InterventionKind = (typeof INTERVENTION)[keyof typeof INTERVENTION];
export const INTERVENTION_NAMES = ['bless', 'blight', 'fertilize', 'incite'] as const;
/** GDD §3 cooldowns: one year, three years, five years, five years. */
export const INTERVENTION_COOLDOWN_DAYS = [360, 1080, 1800, 1800] as const;

/**
 * Root-cause markers. A positive value is an event id; these two are the honest "no earlier event"
 * cases. `PLAYER` is a real cause, not a decoration: it is how the UI answers "did I do this?".
 */
export const CAUSE = { ROOT: -1, PLAYER: -2 } as const;

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
  /** Stage 4 player actions. BLIGHT (24) doubles as the player blight type when cause = PLAYER. */
  PLAYER_BLESS: 25,
  PLAYER_FERTILIZE: 26,
  PLAYER_INCITE: 27,
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
  'player_bless',
  'player_fertilize',
  'player_incite',
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

  // --- Stage 4 player interventions (schema v4). A row is one action the player actually took.
  interventionCount: number;
  interventionHead: number;
  interventionKind: Uint8Array;
  /** affected settlement, or the attacking civilization for `incite` */
  interventionA: Uint16Array;
  /** defender civilization for `incite`, else 0 */
  interventionB: Uint8Array;
  interventionStart: Int32Array;
  /** day the lingering effect ends; equal to start for instantaneous actions */
  interventionEnd: Int32Array;
  /** 1..3 for blight/fertilize, 0 otherwise */
  interventionIntensity: Uint8Array;
  /** RES id for bless, 255 otherwise */
  interventionResource: Uint8Array;
  /** units granted (bless) or people/fertility touched, for display */
  interventionAmount: Int32Array;
  /** last day each intervention kind was used, indexed by INTERVENTION */
  interventionLastDay: Int32Array;

  // --- yearly world series (schema v4): measured, not synthesised. Cumulative counters are kept
  // cumulative so a chart can difference them without a second persisted counter.
  statsCount: number;
  statsHead: number;
  statsYear: Uint16Array;
  statsPopulation: Int32Array;
  statsSettlements: Uint16Array;
  statsCivs: Uint8Array;
  statsFoodProduced: Int32Array;
  statsTradeVolume: Int32Array;
  statsTreasury: Int32Array;
  statsWars: Uint8Array;
  /** mean soil fertility over living settlement tiles, 0..255 */
  statsFertility: Uint8Array;
  /** living settlements currently under a drought flag */
  statsDrought: Uint16Array;

  /** settlements × SETTLEMENT_TREND_SAMPLES, capped population, oldest→newest */
  trendPop: Uint16Array;
  /** how many of the six slots are valid (0..6) */
  trendCount: Uint8Array;
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

