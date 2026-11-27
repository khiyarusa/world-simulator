/** Campaign projection for the stewardship board. Pure reads of worker state. */
import type { WorldState } from '../sim/state/worldState.ts';
import { METRIC, METRIC_COUNT, ERA_NAMES, LEGACY_NAMES, charterSlots, activeCharterCount, legacyDef, OBJECTIVE_STATE, CHARTER } from '../sim/campaign/types.ts';
import { measureAll } from '../sim/campaign/measure.ts';
import { civLiving, completedObjectiveCount } from '../sim/campaign/objectives.ts';
import { stewardExtinct } from '../sim/campaign/run.ts';
import { civNameOf, settlementNameOf } from './queryNames.ts';
import { isAlive } from '../sim/society/common.ts';
import { populationOf } from '../sim/society/state.ts';

export interface CampaignMetricView {
  readonly key: number;
  readonly value: number;
  readonly baseline: number;
}

export interface CampaignMilestoneView {
  readonly index: number;
  readonly titleKey: string;
  readonly done: boolean;
  readonly holdDays: number;
  readonly holdGoal: number;
  readonly progress: number;
  readonly threshold: number;
  readonly progress2: number;
  readonly threshold2: number;
  readonly hasSecond: boolean;
}

export interface CampaignObjectiveView {
  readonly id: number;
  readonly kind: number;
  readonly state: number;
  readonly target: number;
  readonly targetName: string;
  readonly targetB: number;
  readonly progress: number;
  readonly goal: number;
  readonly holdDays: number;
  readonly holdGoal: number;
  readonly startDay: number;
  readonly endDay: number;
  readonly seals: number;
}

export interface CampaignCharterView {
  readonly civ: number;
  readonly civName: string;
  readonly kind: number;
  readonly startDay: number;
  readonly endDay: number;
  readonly daysLeft: number;
}

export interface CampaignCivView {
  readonly id: number;
  readonly name: string;
  readonly capital: string;
  readonly population: number;
  readonly settlements: number;
  readonly charter: number;
}

export interface CampaignView {
  readonly mode: number;
  readonly legacy: number;
  readonly legacyName: string;
  readonly era: number;
  readonly eraName: string;
  readonly completed: boolean;
  readonly completedDay: number;
  readonly begunDay: number;
  readonly day: number;
  readonly targetCiv: number;
  readonly targetCivName: string;
  readonly targetCapital: string;
  readonly stewardAlive: boolean;
  readonly canSucceed: boolean;
  readonly seals: number;
  readonly charterSlots: number;
  readonly activeCharters: number;
  readonly completedObjectives: number;
  readonly startPopulation: number;
  readonly startSettlements: number;
  readonly milestones: readonly CampaignMilestoneView[];
  readonly objectives: readonly CampaignObjectiveView[];
  readonly charters: readonly CampaignCharterView[];
  readonly civs: readonly CampaignCivView[];
  readonly metrics: readonly CampaignMetricView[];
}

const metricsScratch = new Uint16Array(METRIC_COUNT);

export function queryCampaign(world: WorldState): CampaignView {
  const c = world.campaign;
  const civs: CampaignCivView[] = [];
  for (let civ = 0; civ < world.civs.count; civ++) {
    const living = civLiving(world, civ);
    if (living === 0) continue;
    let pop = 0;
    for (let i = 0; i < world.settlements.count; i++) {
      if ((world.settlements.civ[i] ?? 0) === civ && isAlive(world, i)) pop += populationOf(world.society, i);
    }
    let charter: number = CHARTER.NONE;
    for (let i = 0; i < c.charterCount; i++) {
      if ((c.chCiv[i] ?? 255) === civ && (c.chEnd[i] ?? 0) > world.day) charter = c.chKind[i] ?? 0;
    }
    civs.push({
      id: civ,
      name: civNameOf(world, civ),
      capital: settlementNameOf(world, world.civs.capital[civ] ?? 0),
      population: pop,
      settlements: living,
      charter,
    });
  }

  const milestones: CampaignMilestoneView[] = [];
  const def = legacyDef(c.legacy);
  for (let i = 0; i < def.milestones.length; i++) {
    const m = def.milestones[i]!;
    milestones.push({
      index: i,
      titleKey: m.titleKey,
      done: (c.milestoneDone[i] ?? 0) !== 0,
      holdDays: c.milestoneHold[i] ?? 0,
      holdGoal: m.holdDays,
      progress: c.milestoneProgress[i] ?? 0,
      threshold: (c.baseline[m.metric] ?? 0) + m.delta,
      progress2: c.milestoneProgress2[i] ?? 0,
      threshold2: m.metric2 === undefined ? 0 : (c.baseline[m.metric2] ?? 0) + (m.delta2 ?? 0),
      hasSecond: m.metric2 !== undefined,
    });
  }

  const objectives: CampaignObjectiveView[] = [];
  for (let i = 0; i < c.objectiveCount; i++) {
    if ((c.objState[i] ?? 0) === OBJECTIVE_STATE.FREE) continue;
    const kind = c.objKind[i] ?? 0;
    const target = c.objTarget[i] ?? 0;
    const targetName =
      kind === 2 || kind === 3
        ? civNameOf(world, target)
        : kind === 5
          ? civNameOf(world, c.targetCiv)
          : settlementNameOf(world, target);
    objectives.push({
      id: c.objId[i] ?? 0,
      kind,
      state: c.objState[i] ?? 0,
      target,
      targetName,
      targetB: c.objTargetB[i] ?? 0,
      progress: c.objProgress[i] ?? 0,
      goal: c.objGoal[i] ?? 0,
      holdDays: c.objHold[i] ?? 0,
      holdGoal: c.objHoldGoal[i] ?? 0,
      startDay: c.objStart[i] ?? 0,
      endDay: c.objEnd[i] ?? 0,
      seals: c.objSeals[i] ?? 1,
    });
  }

  const charters: CampaignCharterView[] = [];
  for (let i = 0; i < c.charterCount; i++) {
    const end = c.chEnd[i] ?? 0;
    if (end <= world.day) continue;
    const civ = c.chCiv[i] ?? 0;
    charters.push({
      civ,
      civName: civNameOf(world, civ),
      kind: c.chKind[i] ?? 0,
      startDay: c.chStart[i] ?? 0,
      endDay: end,
      daysLeft: end - world.day,
    });
  }

  measureAll(world, metricsScratch);
  const metrics: CampaignMetricView[] = [];
  const keys = [
    METRIC.FOOD_DAYS, METRIC.STABILITY, METRIC.HEALTH, METRIC.LITERACY, METRIC.TREASURY,
    METRIC.TREATIES, METRIC.ROUTES, METRIC.TECH_NODES, METRIC.ACADEMIES, METRIC.FERTILITY,
    METRIC.VEGETATION, METRIC.POPULATION, METRIC.SETTLEMENTS, METRIC.PEACE_DAYS, METRIC.CRISIS_FREE_DAYS,
  ];
  for (const key of keys) {
    metrics.push({ key, value: metricsScratch[key] ?? 0, baseline: c.baseline[key] ?? 0 });
  }

  const extinct = stewardExtinct(world);
  return {
    mode: c.mode,
    legacy: c.legacy,
    legacyName: LEGACY_NAMES[c.legacy] ?? 'none',
    era: c.era,
    eraName: ERA_NAMES[Math.min(4, c.era)] ?? 'foundations',
    completed: c.completed,
    completedDay: c.completedDay,
    begunDay: c.begunDay,
    day: world.day,
    targetCiv: c.targetCiv,
    targetCivName: c.targetCiv < world.civs.count ? civNameOf(world, c.targetCiv) : '',
    targetCapital: c.targetCiv < world.civs.count ? settlementNameOf(world, world.civs.capital[c.targetCiv] ?? 0) : '',
    stewardAlive: !extinct,
    canSucceed: extinct,
    seals: c.seals,
    charterSlots: charterSlots(c),
    activeCharters: activeCharterCount(c, world.day),
    completedObjectives: completedObjectiveCount(c),
    startPopulation: c.startPopulation,
    startSettlements: c.startSettlements,
    milestones,
    objectives,
    charters,
    civs,
    metrics,
  };
}
