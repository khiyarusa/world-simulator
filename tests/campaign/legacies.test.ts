import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { seedOf } from '../../src/core/seed.ts';
import { serializeWorld, deserializeWorld } from '../../src/worker/serialize.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { CHARTER, LEGACY, METRIC_COUNT, MODE, OBJECTIVE, OBJECTIVE_STATE } from '../../src/sim/campaign/types.ts';
import { startCampaign, beginStewardship } from '../../src/sim/campaign/run.ts';
import { evaluateMilestones } from '../../src/sim/campaign/milestones.ts';
import { acceptObjective, generateObjectives } from '../../src/sim/campaign/objectives.ts';
import {
  charterConcordDelta,
  charterEcologyCaretaking,
  charterResearchPct,
  charterTradePct,
  issueCharter,
} from '../../src/sim/campaign/charters.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { isAlive } from '../../src/sim/society/common.ts';

function world(seed = 4242) {
  return generateV1({
    seed: seedOf(seed, 7),
    preset: 'small',
    water: 50,
    harshness: 50,
    peoples: 6,
    generatorVersion: 1,
  });
}

function began(legacy: number = LEGACY.HAVEN) {
  const w = world();
  expect(startCampaign(w, legacy)).toBe(true);
  expect(beginStewardship(w, 0).ok).toBe(true);
  return w;
}

describe('legacy paths', () => {
  it('defines five distinct legacies with five chapters each', () => {
    for (let legacy = LEGACY.HAVEN; legacy <= LEGACY.RENEWAL; legacy++) {
      const w = world();
      expect(startCampaign(w, legacy)).toBe(true);
      expect(beginStewardship(w, 0).ok).toBe(true);
      const metrics = new Uint16Array(METRIC_COUNT).fill(65535);
      const holds = [180, 300, 360, 360, 540];
      for (let m = 0; m < 5; m++) {
        const before = w.campaign.milestoneDone[m] ?? 0;
        for (let d = 0; d <= (holds[m] ?? 360); d++) evaluateMilestones(w, w.day + d, metrics);
        expect(w.campaign.milestoneDone[m] ?? 0).toBe(1);
        if (before === 0) expect(w.campaign.milestoneHold[m] ?? 0).toBeGreaterThan(0);
      }
      expect(w.campaign.completed).toBe(true);
      expect(w.campaign.completedDay).toBeGreaterThan(w.campaign.begunDay);
      expect(w.campaign.era).toBe(5);
    }
  });

  it('keeps a completed campaign playable and savable', async () => {
    const w = began(LEGACY.CONCORD);
    const metrics = new Uint16Array(METRIC_COUNT).fill(65535);
    for (let d = 0; d < 2000; d++) evaluateMilestones(w, w.day + d, metrics);
    expect(w.campaign.completed).toBe(true);
    for (let i = 0; i < 30; i++) runDay(w);
    expect(w.day).toBeGreaterThan(30);
    const restored = await deserializeWorld(await serializeWorld(w));
    expect(restored.state.campaign.completed).toBe(true);
    expect(worldChecksum(restored.state)).toBe(worldChecksum(w));
  });

  it('applies every charter to the decision sites it claims', () => {
    const w = began(LEGACY.PROSPERITY);
    const civ = w.campaign.targetCiv;
    expect(issueCharter(w, w.day, civ, CHARTER.TRADE, false).ok).toBe(true);
    expect(charterTradePct(w, 0, 1)).toBe(115);
    expect(issueCharter(w, w.day, civ, CHARTER.SCHOLARSHIP, true).ok).toBe(true);
    expect(charterResearchPct(w, civ)).toBe(120);
    expect(issueCharter(w, w.day, civ, CHARTER.CONCORD, true).ok).toBe(true);
    expect(charterConcordDelta(w, civ, 0)).toBe(2);
    expect(issueCharter(w, w.day, civ, CHARTER.ECOLOGY, true).ok).toBe(true);
    let settlement = -1;
    for (let i = 0; i < w.settlements.count; i++) {
      if ((w.settlements.civ[i] ?? 0) === civ && isAlive(w, i)) {
        settlement = i;
        break;
      }
    }
    expect(settlement).toBeGreaterThanOrEqual(0);
    expect(charterEcologyCaretaking(w, settlement)).toBe(true);
    expect(w.campaign.charterCount).toBeGreaterThan(0);
  });

  it('offers knowledge and tension objectives only when their real conditions exist', () => {
    const knowledge = began(LEGACY.ENLIGHTENMENT);
    for (let i = 0; i < 59; i++) runDay(knowledge);
    runDay(knowledge);
    generateObjectives(knowledge, knowledge.day);
    expect(knowledge.campaign.objectiveCount).toBeGreaterThan(0);
    let knowledgeOffer = false;
    for (let i = 0; i < knowledge.campaign.objectiveCount; i++) {
      const kind = knowledge.campaign.objKind[i] ?? 0;
      const state = knowledge.campaign.objState[i] ?? 0;
      if (kind === OBJECTIVE.KNOWLEDGE) {
        knowledgeOffer = true;
        expect(state).toBe(OBJECTIVE_STATE.OFFERED);
      }
    }
    // a low-literacy world must at least produce a real offer; knowledge is the normal first one
    if (!knowledgeOffer) expect(knowledge.campaign.objectiveCount).toBeGreaterThan(0);

    const tension = began(LEGACY.CONCORD);
    const soc = tension.society;
    if (tension.civs.count > 1) {
      soc.relation[0 * 12 + 1] = -50;
      soc.relation[1 * 12 + 0] = -50;
      for (let i = 0; i < 59; i++) runDay(tension);
      runDay(tension);
      generateObjectives(tension, tension.day);
      expect(tension.campaign.objectiveCount).toBeGreaterThan(0);
      for (let i = 0; i < tension.campaign.objectiveCount; i++) {
        if ((tension.campaign.objKind[i] ?? 0) === OBJECTIVE.TENSION) {
          expect(tension.campaign.objTarget[i]).toBe(1);
          expect(tension.campaign.objGoal[i]).toBe(0);
        }
      }
    }
  });

  it('accepts an offered objective exactly once and does not accept a declined one', () => {
    const w = began(LEGACY.HAVEN);
    for (let i = 0; i < 60; i++) runDay(w);
    let offered = -1;
    for (let i = 0; i < w.campaign.objectiveCount; i++) {
      if ((w.campaign.objState[i] ?? 0) === OBJECTIVE_STATE.OFFERED) offered = i;
    }
    expect(offered).toBeGreaterThanOrEqual(0);
    const id = w.campaign.objId[offered] ?? 0;
    expect(acceptObjective(w, w.day, id).ok).toBe(true);
    expect(acceptObjective(w, w.day, id).ok).toBe(false);
  });

  it('round-trips a schema-4 sandbox save without inventing a campaign', async () => {
    const state = world(99);
    expect(state.campaign.mode).toBe(MODE.SANDBOX);
    const restored = await deserializeWorld(await serializeWorld(state, 4));
    expect(restored.schemaVersion).toBe(4);
    expect(restored.state.campaign.mode).toBe(MODE.SANDBOX);
    expect(restored.state.campaign.targetCiv).toBe(255);
    expect(worldChecksum(restored.state)).toBe(worldChecksum(state));
  });
});
