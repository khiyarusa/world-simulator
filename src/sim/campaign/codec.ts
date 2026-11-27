/** Campaign save block (schema 5). Fixed capacities, explicit row strides, defensive decode. */
import { SimError } from '../../core/errors.ts';
import { allocateCampaign } from './allocate.ts';
import {
  CAMPAIGN_VERSION,
  CHARTER_CAPACITY,
  METRIC_COUNT,
  OBJECTIVE_CAPACITY,
  type CampaignState,
} from './types.ts';

export const OBJECTIVE_STRIDE = 11;
export const CHARTER_STRIDE = 5;

export interface CampaignDoc {
  v: number;
  mode: number;
  legacy: number;
  era: number;
  targetCiv: number;
  begunDay: number;
  completed: boolean;
  completedDay: number;
  seals: number;
  objectiveSeq: number;
  charterSeq: number;
  lastObjectiveDay: number;
  lastEvalDay: number;
  baseline: number[];
  startPopulation: number;
  startSettlements: number;
  milestoneDone: number[];
  milestoneHold: number[];
  milestoneProgress: number[];
  milestoneProgress2: number[];
  objectives: { count: number; rows: number[] };
  charters: { count: number; rows: number[] };
  lastResolved: number[];
  lastWarDay: number;
  lastCrisisDay: number;
  foodSecurityDays: number;
}

const nums = (src: ArrayLike<number>, n: number): number[] => Array.from(src).slice(0, n);
const int = (v: unknown, min: number, max: number, label: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new SimError('SAVE_CORRUPT', `campaign.${label} is invalid`);
  }
  return v;
};

export function encodeCampaign(c: CampaignState): CampaignDoc {
  const objectives: number[] = [];
  for (let i = 0; i < c.objectiveCount; i++) {
    objectives.push(
      c.objId[i] ?? 0,
      c.objKind[i] ?? 0,
      c.objState[i] ?? 0,
      c.objTarget[i] ?? 0,
      c.objTargetB[i] ?? 0,
      c.objStart[i] ?? 0,
      c.objEnd[i] ?? 0,
      c.objProgress[i] ?? 0,
      c.objGoal[i] ?? 0,
      c.objHold[i] ?? 0,
      c.objHoldGoal[i] ?? 0,
    );
  }
  const charters: number[] = [];
  for (let i = 0; i < c.charterCount; i++) {
    charters.push(c.chCiv[i] ?? 0, c.chKind[i] ?? 0, c.chStart[i] ?? 0, c.chEnd[i] ?? 0, c.chReplaceableDay[i] ?? 0);
  }
  return {
    v: CAMPAIGN_VERSION,
    mode: c.mode,
    legacy: c.legacy,
    era: c.era,
    targetCiv: c.targetCiv,
    begunDay: c.begunDay,
    completed: c.completed,
    completedDay: c.completedDay,
    seals: c.seals,
    objectiveSeq: c.objectiveSeq,
    charterSeq: c.charterSeq,
    lastObjectiveDay: c.lastObjectiveDay,
    lastEvalDay: c.lastEvalDay,
    baseline: nums(c.baseline, METRIC_COUNT),
    startPopulation: c.startPopulation,
    startSettlements: c.startSettlements,
    milestoneDone: nums(c.milestoneDone, 5),
    milestoneHold: nums(c.milestoneHold, 5),
    milestoneProgress: nums(c.milestoneProgress, 5),
    milestoneProgress2: nums(c.milestoneProgress2, 5),
    objectives: { count: c.objectiveCount, rows: objectives },
    charters: { count: c.charterCount, rows: charters },
    lastResolved: nums(c.lastResolved, 16),
    lastWarDay: c.lastWarDay,
    lastCrisisDay: c.lastCrisisDay,
    foodSecurityDays: c.foodSecurityDays,
  };
}

function rowArray(value: unknown, label: string, stride: number, cap: number): { count: number; rows: number[] } {
  if (!value || typeof value !== 'object') throw new SimError('SAVE_CORRUPT', `campaign.${label} missing`);
  const o = value as { count?: unknown; rows?: unknown };
  const count = int(o.count, 0, cap, `${label}.count`);
  if (!Array.isArray(o.rows)) throw new SimError('SAVE_CORRUPT', `campaign.${label}.rows is not an array`);
  if (o.rows.length !== count * stride) {
    throw new SimError('SAVE_CORRUPT', `campaign.${label}.rows length does not match count`);
  }
  for (const n of o.rows) if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new SimError('SAVE_CORRUPT', `campaign.${label}.rows contains a non-number`);
  }
  return { count, rows: o.rows as number[] };
}

function fixed(value: unknown, n: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== n) throw new SimError('SAVE_CORRUPT', `campaign.${label} length`);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = value[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new SimError('SAVE_CORRUPT', `campaign.${label}[${i}]`);
    out.push(v);
  }
  return out;
}

export function decodeCampaign(doc: unknown): CampaignState {
  if (!doc || typeof doc !== 'object') throw new SimError('SAVE_CORRUPT', 'campaign block missing');
  const d = doc as CampaignDoc;
  if (d.v !== CAMPAIGN_VERSION) throw new SimError('UNSUPPORTED_VERSION', `campaign block version ${String(d.v)}`);
  const c = allocateCampaign();
  c.mode = int(d.mode, 0, 1, 'mode') as CampaignState['mode'];
  c.legacy = int(d.legacy, 0, 5, 'legacy') as CampaignState['legacy'];
  c.era = int(d.era, 0, 5, 'era');
  c.targetCiv = int(d.targetCiv, 0, 255, 'targetCiv');
  c.begunDay = int(d.begunDay, 0, 0x7fffffff, 'begunDay');
  c.completed = d.completed === true;
  c.completedDay = int(d.completedDay, 0, 0x7fffffff, 'completedDay');
  c.seals = int(d.seals, 0, 99, 'seals');
  c.objectiveSeq = int(d.objectiveSeq, 1, 0xffff, 'objectiveSeq');
  c.charterSeq = int(d.charterSeq, 1, 0xffff, 'charterSeq');
  c.lastObjectiveDay = int(d.lastObjectiveDay, 0, 0x7fffffff, 'lastObjectiveDay');
  c.lastEvalDay = int(d.lastEvalDay, 0, 0x7fffffff, 'lastEvalDay');
  const baseline = fixed(d.baseline, METRIC_COUNT, 'baseline');
  for (let i = 0; i < METRIC_COUNT; i++) c.baseline[i] = Math.max(0, Math.min(65535, baseline[i] ?? 0));
  c.startPopulation = int(d.startPopulation, 0, 0x7fffffff, 'startPopulation');
  c.startSettlements = int(d.startSettlements, 0, 200, 'startSettlements');
  const done = fixed(d.milestoneDone, 5, 'milestoneDone');
  for (let i = 0; i < 5; i++) c.milestoneDone[i] = done[i] === 0 ? 0 : 1;
  const hold = fixed(d.milestoneHold, 5, 'milestoneHold');
  for (let i = 0; i < 5; i++) c.milestoneHold[i] = Math.max(0, Math.min(65535, hold[i] ?? 0));
  const p1 = fixed(d.milestoneProgress, 5, 'milestoneProgress');
  const p2 = fixed(d.milestoneProgress2, 5, 'milestoneProgress2');
  for (let i = 0; i < 5; i++) {
    c.milestoneProgress[i] = Math.max(0, Math.min(65535, p1[i] ?? 0));
    c.milestoneProgress2[i] = Math.max(0, Math.min(65535, p2[i] ?? 0));
  }

  const objectives = rowArray(d.objectives, 'objectives', OBJECTIVE_STRIDE, OBJECTIVE_CAPACITY);
  c.objectiveCount = objectives.count;
  for (let i = 0; i < c.objectiveCount; i++) {
    const o = i * OBJECTIVE_STRIDE;
    c.objId[i] = objectives.rows[o] ?? 0;
    c.objKind[i] = objectives.rows[o + 1] ?? 0;
    c.objState[i] = objectives.rows[o + 2] ?? 0;
    c.objTarget[i] = objectives.rows[o + 3] ?? 0;
    c.objTargetB[i] = objectives.rows[o + 4] ?? 0;
    c.objStart[i] = objectives.rows[o + 5] ?? 0;
    c.objEnd[i] = objectives.rows[o + 6] ?? 0;
    c.objProgress[i] = objectives.rows[o + 7] ?? 0;
    c.objGoal[i] = objectives.rows[o + 8] ?? 0;
    c.objHold[i] = objectives.rows[o + 9] ?? 0;
    c.objHoldGoal[i] = objectives.rows[o + 10] ?? 0;
    c.objSeals[i] = 1;
  }
  const charters = rowArray(d.charters, 'charters', CHARTER_STRIDE, CHARTER_CAPACITY);
  c.charterCount = charters.count;
  for (let i = 0; i < c.charterCount; i++) {
    const o = i * CHARTER_STRIDE;
    c.chCiv[i] = charters.rows[o] ?? 0;
    c.chKind[i] = charters.rows[o + 1] ?? 0;
    c.chStart[i] = charters.rows[o + 2] ?? 0;
    c.chEnd[i] = charters.rows[o + 3] ?? 0;
    c.chReplaceableDay[i] = charters.rows[o + 4] ?? 0;
  }
  const resolved = fixed(d.lastResolved, 16, 'lastResolved');
  for (let i = 0; i < 16; i++) c.lastResolved[i] = Math.max(0, Math.min(0x7fffffff, resolved[i] ?? 0));
  c.lastWarDay = int(d.lastWarDay, 0, 0x7fffffff, 'lastWarDay');
  c.lastCrisisDay = int(d.lastCrisisDay, 0, 0x7fffffff, 'lastCrisisDay');
  c.foodSecurityDays = int(d.foodSecurityDays, 0, 65535, 'foodSecurityDays');
  return c;
}
