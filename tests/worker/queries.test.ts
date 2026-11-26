import { describe, expect, it } from 'vitest';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { runDay } from '../../src/sim/systems/pipeline.ts';
import { seedOf } from '../../src/core/seed.ts';
import { applyIntervention } from '../../src/sim/society/interventions.ts';
import { isAlive } from '../../src/sim/society/common.ts';
import {
  queryChronicle,
  queryCiv,
  queryCivs,
  queryEconomy,
  queryEcology,
  queryEvent,
  queryHistory,
  queryInterventions,
  queryLayer,
  querySettlement,
  querySettlements,
  queryWorld,
} from '../../src/worker/queries.ts';
import { LAYER_KINDS } from '../../src/worker/protocol.ts';
import type { WorldState } from '../../src/sim/state/worldState.ts';

function world(): WorldState {
  return generateV1({
    seed: seedOf(8675309, 3),
    preset: 'small',
    water: 55,
    harshness: 45,
    peoples: 6,
    generatorVersion: 1,
  });
}

function alive(w: WorldState): number {
  for (let i = 0; i < w.settlements.count; i++) if (isAlive(w, i)) return i;
  return 0;
}

describe('worker query layer', () => {
  it('returns a complete world view from live state', () => {
    const w = world();
    const view = queryWorld(w, { day: w.day, speed: 0 });
    expect(view.day).toBe(1);
    expect(view.year).toBe(1);
    expect(view.settlements).toBeGreaterThan(0);
    expect(view.livingSettlements).toBeGreaterThan(0);
    expect(view.population).toBeGreaterThan(0);
    expect(view.seedText).toMatch(/^[0-9A-F]{8}-[0-9A-F]{8}$/);
    expect(view.civs).toBeGreaterThan(0);
    expect(view.paused).toBe(true);
  });

  it('exposes every settlement field a panel needs, with safe missing ids', () => {
    const w = world();
    const id = alive(w);
    const view = querySettlement(w, id);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.name.length).toBeGreaterThan(0);
    expect(view.cohorts).toHaveLength(8);
    expect(view.stock).toHaveLength(6);
    expect(view.blessMax).toHaveLength(6);
    expect(view.blessMax.every((v) => v >= 1)).toBe(true);
    expect(view.civName.length).toBeGreaterThan(0);
    expect(querySettlement(w, -1)).toBeNull();
    expect(querySettlement(w, 9999)).toBeNull();
    const page = querySettlements(w, 0, 5);
    expect(page.rows.length).toBeLessThanOrEqual(5);
    expect(page.total).toBe(w.settlements.count);
  });

  it('returns civilizations with relations, treaties and an honest war gate', () => {
    const w = world();
    const civs = queryCivs(w);
    expect(civs.length).toBe(w.civs.count);
    const view = queryCiv(w, 0);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.culture).toHaveLength(3);
    expect(view.tech).toHaveLength(12);
    expect(view.relations.length).toBe(Math.max(0, w.civs.count - 1));
    expect(queryCiv(w, 99)).toBeNull();
  });

  it('aggregates economy and ecology without inventing production rates', () => {
    const w = world();
    const economy = queryEconomy(w, undefined);
    expect(economy.resources).toHaveLength(6);
    expect(economy.population).toBeGreaterThan(0);
    expect(economy.resources.every((r) => r.avgPrice >= 250 && r.avgPrice <= 3000)).toBe(true);
    const ecology = queryEcology(w, alive(w));
    expect(ecology.regions).toHaveLength(16);
    expect(ecology.local).not.toBeNull();
    expect(ecology.averageFertility).toBeGreaterThan(0);
  });

  it('paginates history and resolves a real cause chain', () => {
    const w = world();
    const id = alive(w);
    const result = applyIntervention(w, { op: 'bless', settlement: id, resource: 0, amount: 3 });
    expect(result.ok).toBe(true);

    const page = queryHistory(w, undefined, 0, 10);
    expect(page.events.length).toBeLessThanOrEqual(10);
    expect(page.total).toBeGreaterThan(0);
    const player = queryHistory(w, { playerOnly: true }, 0, 10);
    expect(player.events.some((e) => e.id === result.eventId)).toBe(true);

    const detail = queryEvent(w, result.eventId);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.event.player).toBe(true);
    expect(detail.root.kind).toBe('player');
    expect(detail.chain[detail.chain.length - 1]?.id).toBe(result.eventId);
    expect(queryEvent(w, 999999)).toBeNull();
  });

  it('serves all six layers with correctly sized tile data where the layer is raster', () => {
    const w = world();
    for (const kind of LAYER_KINDS) {
      const data = queryLayer(w, kind);
      expect(data.layer).toBe(kind);
      expect(data.width).toBe(w.width);
      expect(data.height).toBe(w.height);
      if (data.cells) expect(data.cells.length).toBe(w.width * w.height);
      if (kind === 'population') expect(data.points.length).toBeGreaterThan(0);
      if (kind === 'political') expect(data.cells).not.toBeNull();
      if (kind === 'ecology') expect(data.cells2).not.toBeNull();
    }
  });

  it('filters history by place, civilization and a real day window', () => {
    const w = world();
    const id = alive(w);
    applyIntervention(w, { op: 'bless', settlement: id, resource: 0, amount: 3 });
    runDay(w);
    const byPlace = queryHistory(w, { place: id }, 0, 50);
    expect(byPlace.events.every((e) => e.place === id)).toBe(true);
    const civ = w.settlements.civ[id] ?? 0;
    const byCiv = queryHistory(w, { civ }, 0, 50);
    expect(byCiv.events.every((e) => e.actorA === civ || e.actorB === civ)).toBe(true);
    const byDay = queryHistory(w, { fromDay: 2, toDay: 2 }, 0, 50);
    expect(byDay.events.every((e) => e.day === 2)).toBe(true);
  });

  it('reports cooldowns and active effects from the persisted rows', () => {
    const w = world();
    const id = alive(w);
    applyIntervention(w, { op: 'blight', settlement: id, intensity: 1, durationDays: 90 });
    const info = queryInterventions(w);
    expect(info).toHaveLength(4);
    expect(info[1]?.ready).toBe(false);
    expect(info[1]?.active.length).toBe(1);
    runDay(w);
    expect(queryChronicle(w, undefined, undefined, 0, 5).series).toHaveLength(0);
  });
});
