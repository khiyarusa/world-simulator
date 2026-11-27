import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { seedOf } from '../../src/core/seed.ts';
import { worldChecksum } from '../../src/sim/state/checksum.ts';
import { serializeWorld, deserializeWorld } from '../../src/worker/serialize.ts';
import { migrateDoc } from '../../src/platform/migrations.ts';
import { newWorldDoc } from '../../src/platform/saves.ts';
import { isAlive } from '../../src/sim/society/common.ts';
import { populationOf, RES, setStock, stockOf } from '../../src/sim/society/state.ts';
import { CHARTER, LEGACY, METRIC, OBJECTIVE, OBJECTIVE_STATE, MODE } from '../../src/sim/campaign/types.ts';
import { startCampaign, beginStewardship } from '../../src/sim/campaign/run.ts';
import { issueCharter, charterInfraBias } from '../../src/sim/campaign/charters.ts';
import { acceptObjective } from '../../src/sim/campaign/objectives.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(seed = 90210): WorldState {
  return generateV1({
    seed: seedOf(seed, 7),
    preset: 'small',
    water: 50,
    harshness: 50,
    peoples: 6,
    generatorVersion: 1,
  });
}

function campaignWorld(): WorldState {
  const w = world();
  expect(startCampaign(w, LEGACY.HAVEN)).toBe(true);
  expect(beginStewardship(w, 0).ok).toBe(true);
  return w;
}

function run(w: WorldState, days: number): void {
  for (let i = 0; i < days; i++) runDay(w);
}

function firstStewardSettlement(w: WorldState): number {
  for (let i = 0; i < w.settlements.count; i++) {
    if ((w.settlements.civ[i] ?? 0) === w.campaign.targetCiv && isAlive(w, i)) return i;
  }
  throw new Error('campaign fixture has no living settlement');
}

describe('stewardship campaign', () => {
  it('begins on a real people and measures a real baseline', () => {
    const w = campaignWorld();
    expect(w.campaign.mode).toBe(MODE.CAMPAIGN);
    expect(w.campaign.targetCiv).toBe(0);
    expect(w.campaign.legacy).toBe(LEGACY.HAVEN);
    expect(w.campaign.baseline[METRIC.SETTLEMENTS] ?? 0).toBeGreaterThan(0);
    expect(w.campaign.startPopulation).toBeGreaterThan(0);

    run(w, 30);
    expect(w.campaign.lastEvalDay).toBeGreaterThanOrEqual(w.day - 4);
    expect(w.campaign.milestoneHold[0] ?? 0).toBeGreaterThan(0);
  });

  it('makes a charter change a real building utility and records the bias', () => {
    const chartered = campaignWorld();
    const control = campaignWorld();
    expect(issueCharter(chartered, chartered.day, chartered.campaign.targetCiv, CHARTER.FOOD, false).ok).toBe(true);
    expect(charterInfraBias(chartered, chartered.campaign.targetCiv, 0)).toBeGreaterThan(0);
    expect(charterInfraBias(control, control.campaign.targetCiv, 0)).toBe(0);

    run(chartered, 360 * 8);
    run(control, 360 * 8);

    let charteredBias = 0;
    let controlBias = 0;
    for (let i = 0; i < chartered.society.decisionCount; i++) if ((chartered.society.decisionBias[i] ?? 0) > 0) charteredBias++;
    for (let i = 0; i < control.society.decisionCount; i++) if ((control.society.decisionBias[i] ?? 0) > 0) controlBias++;
    expect(charteredBias).toBeGreaterThan(0);
    expect(controlBias).toBe(0);
    expect(worldChecksum(chartered)).not.toBe(worldChecksum(control));
  });

  it('offers a food objective from a real shortage and completes it from recovered stock', () => {
    const w = campaignWorld();
    const id = firstStewardSettlement(w);
    // create the condition before the day-60 generation, so the offer reads a real shortage
    run(w, 58);
    setStock(w.society, id, RES.FOOD, 0);
    w.society.carry[id * 6 + RES.FOOD] = 0;
    run(w, 2);

    let offer = -1;
    for (let i = 0; i < w.campaign.objectiveCount; i++) {
      if ((w.campaign.objKind[i] ?? 0) === OBJECTIVE.FOOD_CRISIS && (w.campaign.objState[i] ?? 0) === OBJECTIVE_STATE.OFFERED) offer = i;
    }
    expect(offer).toBeGreaterThanOrEqual(0);
    const objectiveId = w.campaign.objId[offer] ?? 0;
    expect(acceptObjective(w, w.day, objectiveId).ok).toBe(true);

    const pop = populationOf(w.society, id);
    w.society.cap[id * 6 + RES.FOOD] = Math.max(w.society.cap[id * 6 + RES.FOOD] ?? 0, pop * 90);
    setStock(w.society, id, RES.FOOD, pop * 80);
    run(w, 70);
    let row = -1;
    for (let i = 0; i < w.campaign.objectiveCount; i++) if ((w.campaign.objId[i] ?? 0) === objectiveId) row = i;
    expect(row).toBeGreaterThanOrEqual(0);
    expect(w.campaign.objState[row] ?? 0).toBe(OBJECTIVE_STATE.COMPLETE);
    expect(w.campaign.seals).toBeGreaterThan(0);
  });

  it('round-trips campaign state through schema 5 and keeps the checksum', async () => {
    const w = campaignWorld();
    expect(issueCharter(w, w.day, 0, CHARTER.TRADE, false).ok).toBe(true);
    run(w, 90);
    const checksum = worldChecksum(w);
    const shards = await serializeWorld(w);
    const restored = await deserializeWorld(shards);
    expect(restored.schemaVersion).toBe(5);
    expect(restored.state.campaign.mode).toBe(MODE.CAMPAIGN);
    expect(restored.state.campaign.charterCount).toBe(1);
    expect(restored.state.campaign.targetCiv).toBe(0);
    expect(worldChecksum(restored.state)).toBe(checksum);
  });

  it('migrates a v4 world to a sandbox campaign block', () => {
    const doc = { ...newWorldDoc('w-old', 'Old', 'AAAA0000-00000001', 'small'), schemaVersion: 4 };
    const migrated = migrateDoc(doc);
    expect(migrated.schemaVersion).toBe(5);
  });

  it('is deterministic for the same seed and charter command history', () => {
    const a = campaignWorld();
    const b = campaignWorld();
    expect(issueCharter(a, a.day, 0, CHARTER.ECOLOGY, false).ok).toBe(true);
    expect(issueCharter(b, b.day, 0, CHARTER.ECOLOGY, false).ok).toBe(true);
    run(a, 360);
    run(b, 360);
    expect(worldChecksum(a)).toBe(worldChecksum(b));
    expect(stockOf(a.society, firstStewardSettlement(a), RES.FOOD)).toBe(
      stockOf(b.society, firstStewardSettlement(b), RES.FOOD),
    );
  });
});
