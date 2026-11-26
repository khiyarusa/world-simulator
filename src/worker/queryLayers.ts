/** The six information layers, built from persisted simulation state only. */
import type { WorldState } from '../sim/state/worldState.ts';
import { EVENT_TYPE, INTERVENTION } from '../sim/society/state.ts';
import { FLAG_BLIGHT, FLAG_DROUGHT, isAlive } from '../sim/society/common.ts';
import { listInterventions } from '../sim/society/interventions.ts';
import type { HistoryFilter, LayerKind } from './protocol.ts';
import type { LayerArea, LayerData, LayerLine, LayerPoint } from './queryTypes.ts';
import { settlementNameOf, civNameOf } from './queryNames.ts';
import { queryHistory, allEvents } from './queryEvents.ts';
import { populationOf, stockOf } from '../sim/society/state.ts';

// ------------------------------------------------------------------ layers

function densityClass(pop: number): number {
  if (pop >= 40_000) return 5;
  if (pop >= 5_000) return 4;
  if (pop >= 500) return 3;
  if (pop >= 60) return 2;
  return 1;
}

/**
 * Political territory is a real projection of settlement ownership, not a second truth: each land
 * tile belongs to the civilization of the nearest living settlement within 10 tiles. The cell value
 * is civ+1, so 0 means "no polity claims this land".
 */
function politicalCells(world: WorldState): Uint8Array {
  const s = world.settlements;
  const cells = new Uint8Array(world.width * world.height);
  const owners: { x: number; y: number; civ: number }[] = [];
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    owners.push({ x: s.x[i] ?? 0, y: s.y[i] ?? 0, civ: (s.civ[i] ?? 0) + 1 });
  }
  const radius = 18;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = y * world.width + x;
      if ((world.grids.elevation[tile] ?? 0) < world.seaLevel) continue;
      let best = -1;
      let bestDist = radius * radius + 1;
      for (const owner of owners) {
        const dx = owner.x - x;
        const dy = owner.y - y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = owner.civ;
        }
      }
      if (best > 0) cells[tile] = best;
    }
  }
  return cells;
}

function trialCells(world: WorldState, mode: 'fertility' | 'vegetation' | 'moisture'): Uint8Array {
  const cells = new Uint8Array(world.width * world.height);
  const grid = mode === 'fertility' ? world.grids.fertility : mode === 'vegetation' ? world.grids.vegetation : world.grids.moisture;
  for (let i = 0; i < cells.length; i++) {
    if ((world.grids.elevation[i] ?? 0) < world.seaLevel) continue;
    cells[i] = Math.min(255, (grid[i] ?? 0) + 1);
  }
  return cells;
}

export function queryLayer(world: WorldState, layer: LayerKind, filter?: HistoryFilter): LayerData {
  const s = world.settlements;
  const points: LayerPoint[] = [];
  const lines: LayerLine[] = [];
  const areas: LayerArea[] = [];
  let cells: Uint8Array | null = null;
  let cells2: Uint8Array | null = null;
  const meta: Record<string, string | number> = { day: world.day };

  if (layer === 'terrain') {
    // the baked terrain already is this layer; no per-tile payload is needed
    meta.note = 'base terrain bake';
  } else if (layer === 'political') {
    cells = politicalCells(world);
    meta.source = 'nearest living settlement within 18 tiles';
    for (let c = 0; c < world.civs.count; c++) {
      const cap = world.civs.capital[c] ?? 0;
      if (!isAlive(world, cap)) continue;
      points.push({
        id: cap,
        x: s.x[cap] ?? 0,
        y: s.y[cap] ?? 0,
        value: 1,
        kind: 1,
        label: civNameOf(world, c),
      });
    }
    for (let k = 0; k < world.society.warCount; k++) {
      const a = world.society.warA[k] ?? 0;
      const b = world.society.warB[k] ?? 0;
      const ca = world.civs.capital[a] ?? 0;
      const cb = world.civs.capital[b] ?? 0;
      if (!isAlive(world, ca) || !isAlive(world, cb)) continue;
      lines.push({
        x1: s.x[ca] ?? 0,
        y1: s.y[ca] ?? 0,
        x2: s.x[cb] ?? 0,
        y2: s.y[cb] ?? 0,
        kind: 1,
        value: Math.abs(world.society.warScore[k] ?? 0),
        label: 'war',
      });
    }
    for (let k = 0; k < world.society.treatyCount; k++) {
      const a = world.society.treatyA[k] ?? 0;
      const b = world.society.treatyB[k] ?? 0;
      const ca = world.civs.capital[a] ?? 0;
      const cb = world.civs.capital[b] ?? 0;
      if (!isAlive(world, ca) || !isAlive(world, cb)) continue;
      lines.push({
        x1: s.x[ca] ?? 0,
        y1: s.y[ca] ?? 0,
        x2: s.x[cb] ?? 0,
        y2: s.y[cb] ?? 0,
        kind: 2,
        value: world.society.treatyType[k] ?? 0,
        label: 'treaty',
      });
    }
    for (let i = 0; i < s.count; i++) {
      if (!isAlive(world, i)) continue;
      if ((world.society.occupier[i] ?? 0) === 0) continue;
      areas.push({ x: s.x[i] ?? 0, y: s.y[i] ?? 0, radius: 2, kind: 2, value: 1, label: 'occupied' });
    }
  } else if (layer === 'population') {
    meta.metric = 'population';
    for (let i = 0; i < s.count; i++) {
      if (!isAlive(world, i)) continue;
      const pop = populationOf(world.society, i);
      points.push({
        id: i,
        x: s.x[i] ?? 0,
        y: s.y[i] ?? 0,
        value: pop,
        kind: densityClass(pop),
        label: settlementNameOf(world, i),
      });
    }
    // migration origins are real events; the destination is a civilization, not a guessed coordinate
    for (const e of allEvents(world)) {
      if (e.type !== EVENT_TYPE.MIGRATION_WAVE) continue;
      if (world.day - e.day > 360) continue;
      if (e.place >= s.count) continue;
      points.push({
        id: e.id,
        x: s.x[e.place] ?? 0,
        y: s.y[e.place] ?? 0,
        value: e.magnitude,
        kind: 9,
        label: `migration:${e.magnitude}`,
      });
    }
  } else if (layer === 'economy') {
    meta.metric = 'treasury per person';
    for (let i = 0; i < s.count; i++) {
      if (!isAlive(world, i)) continue;
      const pop = Math.max(1, populationOf(world.society, i));
      const wealth = Math.floor(((world.society.treasury[i] ?? 0) * 1000) / pop);
      const foodDays = Math.floor(stockOf(world.society, i, 0) / pop);
      points.push({
        id: i,
        x: s.x[i] ?? 0,
        y: s.y[i] ?? 0,
        value: foodDays < 10 ? -1 : wealth,
        kind: foodDays < 10 ? 0 : 1,
        label: settlementNameOf(world, i),
      });
    }
    for (let k = 0; k < world.society.routeCount; k++) {
      const a = world.society.routeA[k] ?? 0;
      const b = world.society.routeB[k] ?? 0;
      if (!isAlive(world, a) || !isAlive(world, b)) continue;
      lines.push({
        x1: s.x[a] ?? 0,
        y1: s.y[a] ?? 0,
        x2: s.x[b] ?? 0,
        y2: s.y[b] ?? 0,
        kind: 1,
        value: world.society.routeVolume[k] ?? 0,
        label: `${world.society.routeTariff[k] ?? 0}‰`,
      });
    }
  } else if (layer === 'ecology') {
    cells = trialCells(world, 'fertility');
    cells2 = trialCells(world, 'vegetation');
    meta.metric = 'fertility';
    for (let i = 0; i < s.count; i++) {
      if (!isAlive(world, i)) continue;
      const flags = world.society.flags[i] ?? 0;
      if ((flags & FLAG_DROUGHT) !== 0) {
        points.push({ id: i, x: s.x[i] ?? 0, y: s.y[i] ?? 0, value: 1, kind: 1, label: 'drought' });
      }
      if ((flags & FLAG_BLIGHT) !== 0) {
        points.push({ id: i, x: s.x[i] ?? 0, y: s.y[i] ?? 0, value: 1, kind: 2, label: 'blight' });
      }
    }
    for (const row of listInterventions(world.society, world.day)) {
      if (!row.active) continue;
      if (row.kind === INTERVENTION.BLIGHT) {
        areas.push({ x: s.x[row.a] ?? 0, y: s.y[row.a] ?? 0, radius: 3 + row.intensity * 2, kind: 1, value: row.intensity, label: 'blight' });
      } else if (row.kind === INTERVENTION.FERTILIZE) {
        areas.push({ x: s.x[row.a] ?? 0, y: s.y[row.a] ?? 0, radius: 3 + row.intensity, kind: 2, value: row.intensity, label: 'fertilize' });
      }
    }
  } else if (layer === 'history') {
    const page = queryHistory(world, filter, 0, 100);
    for (const e of page.events) {
      if (e.place < 0) continue;
      points.push({
        id: e.id,
        x: world.settlements.x[e.place] ?? 0,
        y: world.settlements.y[e.place] ?? 0,
        value: e.severity,
        kind: e.type,
        label: e.typeName,
      });
    }
    meta.total = page.total;
  }

  return { layer, day: world.day, width: world.width, height: world.height, cells, cells2, points, lines, areas, meta };
}
