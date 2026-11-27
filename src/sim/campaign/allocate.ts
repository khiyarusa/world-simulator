/**
 * Allocation of the campaign block. Fixed capacities only; a v4 world migrates to a sandbox block
 * with no objective or charter history (the truth about a world that never had stewardship).
 */
import {
  CAMPAIGN_VERSION,
  CHARTER_CAPACITY,
  METRIC_COUNT,
  MODE,
  OBJECTIVE_CAPACITY,
  type CampaignState,
} from './types.ts';

export function allocateCampaign(): CampaignState {
  return {
    version: CAMPAIGN_VERSION,
    mode: MODE.SANDBOX,
    legacy: 0,
    era: 0,
    targetCiv: 255,
    begunDay: 0,
    completed: false,
    completedDay: 0,
    seals: 0,
    objectiveSeq: 1,
    charterSeq: 1,
    lastObjectiveDay: 0,
    lastEvalDay: 0,
    baseline: new Uint16Array(METRIC_COUNT),
    startPopulation: 0,
    startSettlements: 0,
    milestoneDone: new Uint8Array(5),
    milestoneHold: new Uint16Array(5),
    milestoneProgress: new Uint16Array(5),
    milestoneProgress2: new Uint16Array(5),

    objectiveCount: 0,
    objId: new Uint16Array(OBJECTIVE_CAPACITY),
    objKind: new Uint8Array(OBJECTIVE_CAPACITY),
    objState: new Uint8Array(OBJECTIVE_CAPACITY),
    objTarget: new Uint16Array(OBJECTIVE_CAPACITY),
    objTargetB: new Uint8Array(OBJECTIVE_CAPACITY),
    objStart: new Int32Array(OBJECTIVE_CAPACITY),
    objEnd: new Int32Array(OBJECTIVE_CAPACITY),
    objProgress: new Int32Array(OBJECTIVE_CAPACITY),
    objGoal: new Int32Array(OBJECTIVE_CAPACITY),
    objHold: new Uint16Array(OBJECTIVE_CAPACITY),
    objHoldGoal: new Uint16Array(OBJECTIVE_CAPACITY),
    objSeals: new Uint8Array(OBJECTIVE_CAPACITY),

    charterCount: 0,
    chCiv: new Uint8Array(CHARTER_CAPACITY),
    chKind: new Uint8Array(CHARTER_CAPACITY),
    chStart: new Int32Array(CHARTER_CAPACITY),
    chEnd: new Int32Array(CHARTER_CAPACITY),
    chReplaceableDay: new Int32Array(CHARTER_CAPACITY),

    lastResolved: new Int32Array(16),
    lastWarDay: 0,
    lastCrisisDay: 0,
    foodSecurityDays: 0,
  };
}
