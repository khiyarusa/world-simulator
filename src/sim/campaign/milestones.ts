/**
 * Sustained legacy milestones. A chapter is earned by holding a real condition, not by waiting for a
 * year counter. Thresholds are relative to the baseline measured when stewardship began.
 */
import type { WorldState } from '../state/worldState.ts';
import { appendEvent, EVENT_TYPE, SEVERITY } from '../society/state.ts';
import { legacyDef, type CampaignState } from './types.ts';

function threshold(c: CampaignState, metric: number, delta: number): number {
  return (c.baseline[metric] ?? 0) + delta;
}

export function evaluateMilestones(world: WorldState, day: number, metrics: Uint16Array, step = 1): boolean {
  const c = world.campaign;
  if (c.mode !== 1 || c.targetCiv === 255 || c.completed) return false;
  const def = legacyDef(c.legacy);
  const count = Math.min(def.milestones.length, 5);
  let changed = false;
  for (let i = 0; i < count; i++) {
    if ((c.milestoneDone[i] ?? 0) !== 0) continue;
    const m = def.milestones[i]!;
    const v1 = metrics[m.metric] ?? 0;
    c.milestoneProgress[i] = v1;
    let ok = v1 >= threshold(c, m.metric, m.delta);
    if (m.metric2 !== undefined) {
      const v2 = metrics[m.metric2] ?? 0;
      c.milestoneProgress2[i] = v2;
      ok = ok && v2 >= threshold(c, m.metric2, m.delta2 ?? 0);
    }
    if (!ok) {
      c.milestoneHold[i] = 0;
      continue;
    }
    const held = (c.milestoneHold[i] ?? 0) + step;
    c.milestoneHold[i] = Math.min(65535, held);
    if (held < m.holdDays) continue;
    c.milestoneDone[i] = 1;
    c.era = Math.min(5, c.era + 1);
    changed = true;
    appendEvent(
      world.society,
      day,
      EVENT_TYPE.MILESTONE_REACHED,
      SEVERITY.HISTORIC,
      world.civs.capital[c.targetCiv] ?? 0,
      c.targetCiv,
      c.legacy,
      i + 1,
      0,
    );
    if (c.milestoneDone.every((v) => v !== 0)) {
      c.completed = true;
      c.completedDay = day;
      appendEvent(
        world.society,
        day,
        EVENT_TYPE.LEGACY_COMPLETE,
        SEVERITY.HISTORIC,
        world.civs.capital[c.targetCiv] ?? 0,
        c.targetCiv,
        c.legacy,
        5,
        0,
      );
    }
  }
  return changed;
}

/** Milestone state for the query layer; kept out of the renderer. */
export function milestoneCount(c: CampaignState): number {
  let n = 0;
  for (let i = 0; i < 5; i++) if ((c.milestoneDone[i] ?? 0) !== 0) n++;
  return n;
}

export function nextMilestone(c: CampaignState): number {
  for (let i = 0; i < 5; i++) if ((c.milestoneDone[i] ?? 0) === 0) return i;
  return 5;
}
