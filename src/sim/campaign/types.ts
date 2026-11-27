/**
 * World Stewardship campaign model (D-68).
 *
 * The campaign is simulation state, not a UI layer: objectives are measured from authoritative
 * stocks, routes, treaties, technology and ecology, and charters change the utility score of real
 * decisions. Everything here is fixed-capacity and integer, like the rest of the society block.
 */
import type { WorldState } from '../state/worldState.ts';

export const CAMPAIGN_VERSION = 1;

export const MODE = { SANDBOX: 0, CAMPAIGN: 1 } as const;
export type CampaignMode = (typeof MODE)[keyof typeof MODE];

export const LEGACY = {
  NONE: 0,
  HAVEN: 1,
  CONCORD: 2,
  PROSPERITY: 3,
  ENLIGHTENMENT: 4,
  RENEWAL: 5,
} as const;
export type Legacy = (typeof LEGACY)[keyof typeof LEGACY];
export const LEGACY_NAMES = ['none', 'haven', 'concord', 'prosperity', 'enlightenment', 'renewal'] as const;

export const ERA_NAMES = ['foundations', 'consolidation', 'flourishing', 'trials', 'legacy'] as const;

/** Metric keys are persisted by number; append only. */
export const METRIC = {
  FOOD_DAYS: 0,
  STABILITY: 1,
  HEALTH: 2,
  LITERACY: 3,
  TREATIES: 4,
  PEACE_DAYS: 5,
  ROUTES: 6,
  TREASURY: 7,
  TECH_NODES: 8,
  ACADEMIES: 9,
  FERTILITY: 10,
  VEGETATION: 11,
  POPULATION: 12,
  SETTLEMENTS: 13,
  FOOD_SECURITY_DAYS: 14,
  CRISIS_FREE_DAYS: 15,
} as const;
export const METRIC_COUNT = 16;

export const CHARTER = {
  NONE: 0,
  FOOD: 1,
  TRADE: 2,
  SCHOLARSHIP: 3,
  CONCORD: 4,
  DEFENSE: 5,
  ECOLOGY: 6,
} as const;
export type Charter = (typeof CHARTER)[keyof typeof CHARTER];
export const CHARTER_NAMES = ['none', 'food', 'trade', 'scholarship', 'concord', 'defense', 'ecology'] as const;
export const CHARTER_CAPACITY = 16;
export const CHARTER_DAYS = 10 * 360;
export const CHARTER_COOLDOWN_DAYS = 2 * 360;

export const OBJECTIVE = {
  NONE: 0,
  FOOD_CRISIS: 1,
  TENSION: 2,
  TRADE_LOSS: 3,
  ECOLOGY: 4,
  KNOWLEDGE: 5,
  GROWTH: 6,
} as const;
export type ObjectiveKind = (typeof OBJECTIVE)[keyof typeof OBJECTIVE];
export const OBJECTIVE_KINDS = 6;

export const OBJECTIVE_STATE = {
  FREE: 0,
  OFFERED: 1,
  ACTIVE: 2,
  COMPLETE: 3,
  FAILED: 4,
  DECLINED: 5,
  EXPIRED: 6,
} as const;
export type ObjectiveState = (typeof OBJECTIVE_STATE)[keyof typeof OBJECTIVE_STATE];

export const OBJECTIVE_CAPACITY = 8;
export const ACTIVE_LIMIT = 2;
export const OFFER_LIMIT = 2;
export const OFFER_TTL_DAYS = 180;
export const OBJECTIVE_COOLDOWN_DAYS = 540;

/** A milestone has one or two sustained conditions. Thresholds are relative to the campaign baseline. */
export interface MilestoneDef {
  readonly titleKey: string;
  readonly metric: number;
  readonly delta: number;
  readonly metric2?: number;
  readonly delta2?: number;
  readonly holdDays: number;
}

export interface LegacyDef {
  readonly id: Legacy;
  readonly nameKey: string;
  readonly fantasyKey: string;
  readonly goalKey: string;
  readonly milestones: readonly MilestoneDef[];
}

/**
 * Five chapters per legacy. Deltas are relative to the metrics measured when stewardship begins, so a
 * harsh or gentle world changes the numbers, never the possibility of finishing.
 */
export const LEGACIES: readonly LegacyDef[] = [
  {
    id: LEGACY.NONE,
    nameKey: 'legacy.none',
    fantasyKey: 'legacy.none.fantasy',
    goalKey: 'legacy.none.goal',
    milestones: [],
  },
  {
    id: LEGACY.HAVEN,
    nameKey: 'legacy.haven',
    fantasyKey: 'legacy.haven.fantasy',
    goalKey: 'legacy.haven.goal',
    milestones: [
      { titleKey: 'milestone.haven.1', metric: METRIC.FOOD_DAYS, delta: 10, holdDays: 180 },
      { titleKey: 'milestone.haven.2', metric: METRIC.STABILITY, delta: 8, metric2: METRIC.HEALTH, delta2: 5, holdDays: 300 },
      { titleKey: 'milestone.haven.3', metric: METRIC.FOOD_DAYS, delta: 20, metric2: METRIC.SETTLEMENTS, delta2: 0, holdDays: 360 },
      { titleKey: 'milestone.haven.4', metric: METRIC.POPULATION, delta: 40, metric2: METRIC.FOOD_SECURITY_DAYS, delta2: 180, holdDays: 360 },
      { titleKey: 'milestone.haven.5', metric: METRIC.FOOD_DAYS, delta: 30, metric2: METRIC.CRISIS_FREE_DAYS, delta2: 720, holdDays: 540 },
    ],
  },
  {
    id: LEGACY.CONCORD,
    nameKey: 'legacy.concord',
    fantasyKey: 'legacy.concord.fantasy',
    goalKey: 'legacy.concord.goal',
    milestones: [
      { titleKey: 'milestone.concord.1', metric: METRIC.TREATIES, delta: 1, holdDays: 90 },
      { titleKey: 'milestone.concord.2', metric: METRIC.TREATIES, delta: 2, metric2: METRIC.PEACE_DAYS, delta2: 360, holdDays: 240 },
      { titleKey: 'milestone.concord.3', metric: METRIC.TREATIES, delta: 3, metric2: METRIC.PEACE_DAYS, delta2: 720, holdDays: 360 },
      { titleKey: 'milestone.concord.4', metric: METRIC.TREATIES, delta: 3, metric2: METRIC.PEACE_DAYS, delta2: 1080, holdDays: 360 },
      { titleKey: 'milestone.concord.5', metric: METRIC.TREATIES, delta: 4, metric2: METRIC.PEACE_DAYS, delta2: 1440, holdDays: 540 },
    ],
  },
  {
    id: LEGACY.PROSPERITY,
    nameKey: 'legacy.prosperity',
    fantasyKey: 'legacy.prosperity.fantasy',
    goalKey: 'legacy.prosperity.goal',
    milestones: [
      { titleKey: 'milestone.prosperity.1', metric: METRIC.ROUTES, delta: 2, holdDays: 90 },
      { titleKey: 'milestone.prosperity.2', metric: METRIC.ROUTES, delta: 4, metric2: METRIC.TREASURY, delta2: 400, holdDays: 240 },
      { titleKey: 'milestone.prosperity.3', metric: METRIC.ROUTES, delta: 6, metric2: METRIC.TREASURY, delta2: 900, holdDays: 300 },
      { titleKey: 'milestone.prosperity.4', metric: METRIC.ROUTES, delta: 8, metric2: METRIC.FOOD_DAYS, delta2: 5, holdDays: 360 },
      { titleKey: 'milestone.prosperity.5', metric: METRIC.ROUTES, delta: 12, metric2: METRIC.TREASURY, delta2: 1800, holdDays: 540 },
    ],
  },
  {
    id: LEGACY.ENLIGHTENMENT,
    nameKey: 'legacy.enlightenment',
    fantasyKey: 'legacy.enlightenment.fantasy',
    goalKey: 'legacy.enlightenment.goal',
    milestones: [
      { titleKey: 'milestone.enlightenment.1', metric: METRIC.LITERACY, delta: 10, holdDays: 180 },
      { titleKey: 'milestone.enlightenment.2', metric: METRIC.TECH_NODES, delta: 2, metric2: METRIC.LITERACY, delta2: 12, holdDays: 240 },
      { titleKey: 'milestone.enlightenment.3', metric: METRIC.TECH_NODES, delta: 4, metric2: METRIC.ACADEMIES, delta2: 1, holdDays: 300 },
      { titleKey: 'milestone.enlightenment.4', metric: METRIC.TECH_NODES, delta: 6, metric2: METRIC.LITERACY, delta2: 20, holdDays: 360 },
      { titleKey: 'milestone.enlightenment.5', metric: METRIC.TECH_NODES, delta: 8, metric2: METRIC.LITERACY, delta2: 28, holdDays: 540 },
    ],
  },
  {
    id: LEGACY.RENEWAL,
    nameKey: 'legacy.renewal',
    fantasyKey: 'legacy.renewal.fantasy',
    goalKey: 'legacy.renewal.goal',
    milestones: [
      { titleKey: 'milestone.renewal.1', metric: METRIC.FERTILITY, delta: 6, holdDays: 180 },
      { titleKey: 'milestone.renewal.2', metric: METRIC.VEGETATION, delta: 10, metric2: METRIC.FERTILITY, delta2: 8, holdDays: 240 },
      { titleKey: 'milestone.renewal.3', metric: METRIC.CRISIS_FREE_DAYS, delta: 360, metric2: METRIC.FERTILITY, delta2: 12, holdDays: 300 },
      { titleKey: 'milestone.renewal.4', metric: METRIC.VEGETATION, delta: 20, metric2: METRIC.POPULATION, delta2: 25, holdDays: 360 },
      { titleKey: 'milestone.renewal.5', metric: METRIC.FERTILITY, delta: 24, metric2: METRIC.VEGETATION, delta2: 28, holdDays: 540 },
    ],
  },
];

export interface CampaignState {
  version: number;
  mode: CampaignMode;
  legacy: Legacy;
  era: number;
  /** 255 = the campaign has not begun; the world is paused at the steward selection. */
  targetCiv: number;
  begunDay: number;
  completed: boolean;
  completedDay: number;
  seals: number;
  objectiveSeq: number;
  charterSeq: number;
  lastObjectiveDay: number;
  lastEvalDay: number;
  /** Metrics measured when stewardship began; milestone thresholds are relative to these. */
  baseline: Uint16Array;
  startPopulation: number;
  startSettlements: number;
  /** Per milestone: 1 = complete; hold = consecutive days the conditions have held. */
  milestoneDone: Uint8Array;
  milestoneHold: Uint16Array;
  /** Latest known value per condition, for an honest progress bar. */
  milestoneProgress: Uint16Array;
  milestoneProgress2: Uint16Array;

  objectiveCount: number;
  /** Index 0..OBJECTIVE_CAPACITY-1 is stable while the row lives. */
  objId: Uint16Array;
  objKind: Uint8Array;
  objState: Uint8Array;
  objTarget: Uint16Array;
  objTargetB: Uint8Array;
  objStart: Int32Array;
  objEnd: Int32Array;
  objProgress: Int32Array;
  objGoal: Int32Array;
  objHold: Uint16Array;
  objHoldGoal: Uint16Array;
  objSeals: Uint8Array;

  charterCount: number;
  chCiv: Uint8Array;
  chKind: Uint8Array;
  chStart: Int32Array;
  chEnd: Int32Array;
  chReplaceableDay: Int32Array;

  /** Last day a kind was resolved, for cooldown and duplicate prevention. */
  lastResolved: Int32Array;
  /** Last day a war involved the steward, and last day a crisis touched its settlements. */
  lastWarDay: number;
  lastCrisisDay: number;
  /** Days on which the steward's settlements all had at least the baseline food reserve. */
  foodSecurityDays: number;
}

export function legacyDef(legacy: number): LegacyDef {
  return LEGACIES[legacy] ?? LEGACIES[0]!;
}

export function charterSlots(c: CampaignState): number {
  const fromSeals = Math.floor(c.seals / 3);
  return Math.min(3, 1 + fromSeals);
}

export function activeCharterCount(c: CampaignState, day: number): number {
  let n = 0;
  for (let i = 0; i < c.charterCount; i++) {
    if ((c.chEnd[i] ?? 0) > day) n++;
  }
  return n;
}

export function charterOf(c: CampaignState, civ: number, day: number): number {
  for (let i = 0; i < c.charterCount; i++) {
    if ((c.chCiv[i] ?? 255) === civ && (c.chEnd[i] ?? 0) > day) return c.chKind[i] ?? 0;
  }
  return 0;
}

export function hasCharter(world: WorldState, civ: number, kind: number): boolean {
  return charterOf(world.campaign, civ, world.day) === kind;
}
