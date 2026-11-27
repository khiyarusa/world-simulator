/**
 * The campaign tick: counters, milestones, objectives and charter expiry.
 *
 * The phase runs after the simulation's own systems so every measured value describes the day that
 * just happened. It never mutates stocks, population, diplomacy or ecology: it reads them and records
 * decisions. Charters affect decisions at their own decision sites.
 */
import type { WorldState } from '../state/worldState.ts';
import { appendEvent, EVENT_TYPE, SEVERITY } from '../society/state.ts';
import { isAlive } from '../society/common.ts';
import { MODE, LEGACY, METRIC, METRIC_COUNT, OBJECTIVE_STATE, type Legacy } from './types.ts';
import { beginBaseline, measureAll, noteCampaignDay } from './measure.ts';
import { evaluateMilestones } from './milestones.ts';
import { evaluateObjectives, generateObjectives, civLiving } from './objectives.ts';
import { expireCharters } from './charters.ts';

const metrics = new Uint16Array(METRIC_COUNT);

/** Mark a newly created world as a campaign before the player chooses a people. */
export function startCampaign(world: WorldState, legacy: number): boolean {
  if (legacy < LEGACY.HAVEN || legacy > LEGACY.RENEWAL) return false;
  const c = world.campaign;
  c.mode = MODE.CAMPAIGN;
  c.legacy = legacy as Legacy;
  c.era = 0;
  c.targetCiv = 255;
  c.completed = false;
  c.seals = 0;
  c.objectiveCount = 0;
  c.charterCount = 0;
  c.lastObjectiveDay = 0;
  c.lastEvalDay = 0;
  c.baseline.fill(0);
  c.milestoneDone.fill(0);
  c.milestoneHold.fill(0);
  c.lastResolved.fill(0);
  return true;
}

/** Choose the steward people and measure the baseline. A successor is allowed if the old civ died. */
export function beginStewardship(world: WorldState, civ: number): { ok: boolean; error?: string } {
  const c = world.campaign;
  if (c.mode !== MODE.CAMPAIGN) return { ok: false, error: 'NOT_A_CAMPAIGN' };
  if (!Number.isInteger(civ) || civ < 0 || civ >= world.civs.count) return { ok: false, error: 'BAD_TARGET' };
  if (civLiving(world, civ) === 0) return { ok: false, error: 'NO_LIVING_SETTLEMENT' };
  const successor = c.targetCiv !== 255;
  if (successor) {
    let alive = false;
    for (let i = 0; i < world.settlements.count; i++) {
      if ((world.settlements.civ[i] ?? 0) === c.targetCiv && isAlive(world, i)) {
        alive = true;
        break;
      }
    }
    if (alive) return { ok: false, error: 'STEWARD_ALIVE' };
    // A dead steward cannot softlock the campaign: keep earned milestones and seals, clear live work.
    for (let i = 0; i < c.objectiveCount; i++) {
      const st = c.objState[i] ?? 0;
      if (st === OBJECTIVE_STATE.OFFERED || st === OBJECTIVE_STATE.ACTIVE) c.objState[i] = OBJECTIVE_STATE.EXPIRED;
    }
  }
  c.targetCiv = civ;
  c.begunDay = world.day;
  beginBaseline(world);
  appendEvent(
    world.society,
    world.day,
    EVENT_TYPE.CAMPAIGN_BEGUN,
    SEVERITY.HISTORIC,
    world.civs.capital[civ] ?? 0,
    civ,
    c.legacy,
    0,
    0,
  );
  return { ok: true };
}

/** Daily stewardship phase. No allocations, no RNG, no writes to simulation resources. */
export function runCampaign(world: WorldState, day: number): void {
  const c = world.campaign;
  if (c.mode !== MODE.CAMPAIGN || c.targetCiv === 255) return;
  // Sustained conditions do not need a per-day sort of every settlement. A five-day cadence keeps
  // the campaign out of the tick budget while staying well inside the shortest hold (180 days).
  if (day % 5 !== 0) return;

  noteCampaignDay(world);
  measureAll(world, metrics);
  const threshold = (c.baseline[METRIC.FOOD_DAYS] ?? 0) + 5;
  if ((metrics[METRIC.FOOD_DAYS] ?? 0) >= threshold) {
    c.foodSecurityDays = Math.min(65535, c.foodSecurityDays + 5);
  } else {
    c.foodSecurityDays = 0;
  }
  metrics[METRIC.FOOD_SECURITY_DAYS] = c.foodSecurityDays;

  evaluateMilestones(world, day, metrics, 5);
  expireCharters(world, day);
  evaluateObjectives(world, day, 5);
  if (day % 60 === 0) {
    c.lastObjectiveDay = day;
    generateObjectives(world, day);
  }
  c.lastEvalDay = day;
}

/** True when the steward civilization has no living settlement; the UI offers a successor. */
export function stewardExtinct(world: WorldState): boolean {
  const c = world.campaign;
  return c.mode === MODE.CAMPAIGN && c.targetCiv !== 255 && civLiving(world, c.targetCiv) === 0;
}
