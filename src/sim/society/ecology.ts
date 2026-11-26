/**
 * Ecology: vegetation, soil, wildfire, flood and epidemic (GDD §6, Stage 3 WP D).
 *
 * These are the pressures that make a location different from another one and that turn an economic
 * boom into a crisis. All of them read and write persisted grids or stocks, use the named FIRE and
 * EPIDEMIC streams, and produce events with a real cause reference or the explicit root marker (-1).
 */
import type { WorldState } from '../state/worldState.ts';
import { STREAM } from '../../core/rng.ts';
import {
  COHORT,
  EVENT_TYPE,
  RES,
  SEVERITY,
  addStock,
  appendEvent,
  cohortOf,
  populationOf,
  stockOf,
} from './state.ts';
import { FLAG_DROUGHT, isAlive, removePeople } from './common.ts';
import { withStream } from './streams.ts';
import { retainEvent } from './vital.ts';
import { damageInfrastructure } from './infra.ts';

/** Most a tile can recover to, given its moisture (vegetation is a 0..255 index). */
function vegetationTarget(moisture: number): number {
  return 40 + Math.floor((moisture * 160) / 255);
}

/** Fertility a healthy vegetated tile tends toward, given its moisture. */
function fertilityTarget(moisture: number): number {
  return 25 + Math.floor((moisture * 190) / 255);
}

const ROOT_CAUSE = -1;

/** Monthly ecological pass over every living settlement's own tile. */
export function runEcology(world: WorldState, day: number): void {
  if (day % 30 !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  const grids = world.grids;

  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    const moisture = grids.moisture[tile] ?? 100;
    const target = vegetationTarget(moisture);
    const fertTarget = fertilityTarget(moisture);
    let vegetation = grids.vegetation[tile] ?? 0;

    // --- harvest pressure: extractors cut real vegetation, and a timber-rich tile feels it more
    const extractors = cohortOf(soc, i, COHORT.EXTRACTORS);
    const mask = grids.resource[tile] ?? 0;
    const pressure = Math.floor(extractors / ((mask & 4) !== 0 ? 12 : 3));
    vegetation = Math.max(0, vegetation - pressure);

    // --- recovery: vegetation regrows toward the moisture-limited climax, slowly
    if (vegetation < target) vegetation = Math.min(target, vegetation + 1 + Math.floor(moisture / 64));
    grids.vegetation[tile] = vegetation > 255 ? 255 : vegetation;

    // --- soil: erosion where the cover is gone, recovery where it is healthy
    let fertility = grids.fertility[tile] ?? 0;
    if (vegetation < 50) {
      fertility = Math.max(5, fertility - 1);
    } else if (vegetation >= target - 10 && fertility < fertTarget) {
      fertility = Math.min(fertTarget, fertility + 1);
    }
    grids.fertility[tile] = fertility;

    // --- epidemic pressure: real health, crowding and famine drive real outbreaks
    const pop = populationOf(soc, i);
    const health = soc.health[i] ?? 60;
    const famine = soc.lastFamineEvent[i] ?? 0;
    const freshFamine = day - (soc.historyDay[i * 3 + 1] ?? 0) <= 720;
    const lastEpidemic = soc.lastEpidemicDay[i] ?? 0;
    if (pop >= 120 && health < 45 && day - lastEpidemic >= 1080) {
      // a recovered population keeps its immunity for two years; without that window an outbreak
      // feeds its own risk and deletes the settlement
      const risk = Math.min(60, (45 - health) * 2 + (pop > 2_000 ? 20 : 0));
      let outbreak = false;
      withStream(world, STREAM.EPIDEMIC, (rng) => {
        outbreak = rng.chance(risk);
      });
      if (outbreak) {
        const deaths = removePeople(soc, i, Math.max(1, Math.floor((pop * (10 + (45 - health))) / 1000)));
        world.counters.deaths += deaths;
        world.counters.epidemicDeaths += deaths;
        soc.health[i] = Math.max(0, health - 10);
        soc.stability[i] = Math.max(0, (soc.stability[i] ?? 60) - 6);
        soc.lastEpidemicDay[i] = day;
        appendEvent(
          soc,
          day,
          EVENT_TYPE.EPIDEMIC,
          SEVERITY.HISTORIC,
          i,
          s.civ[i] ?? 0,
          0,
          deaths,
          famine > 0 && freshFamine ? famine : ROOT_CAUSE,
        );
      }
    }
  }

  // --- regional hazards: one fire and one flood roll per settlement per month, from their own tiles
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    const region = (grids.regionId[tile] ?? 0) % 16;
    const precip = soc.regionPrecip[region] ?? 100;
    const drought = ((soc.flags[i] ?? 0) & FLAG_DROUGHT) !== 0;
    const vegetation = grids.vegetation[tile] ?? 0;

    if (drought && vegetation >= 100) {
      let fire = false;
      withStream(world, STREAM.FIRE, (rng) => {
        fire = rng.chance(8);
      });
      if (fire) {
        grids.vegetation[tile] = Math.max(0, vegetation - 90);
        const wood = stockOf(soc, i, RES.WOOD);
        addStock(soc, i, RES.WOOD, -Math.floor(wood / 4));
        const lost = damageInfrastructure(world, i);
        soc.health[i] = Math.max(0, (soc.health[i] ?? 60) - 4);
        const droughtEvent = soc.lastDroughtEvent[i] ?? 0;
        if (droughtEvent > 0) retainEvent(soc, droughtEvent);
        appendEvent(
          soc,
          day,
          EVENT_TYPE.WILDFIRE,
          SEVERITY.MAJOR,
          i,
          s.civ[i] ?? 0,
          0,
          lost >= 0 ? lost : 0,
          droughtEvent > 0 ? droughtEvent : ROOT_CAUSE,
        );
      }
    }

    if (precip >= 160 && ((grids.riverId[tile] ?? 0) > 0 || (grids.lakeId[tile] ?? 0) > 0)) {
      let flood = false;
      withStream(world, STREAM.FIRE, (rng) => {
        flood = rng.chance(12);
      });
      if (flood) {
        // a flood destroys stores and one structure, but deposits fresh silt
        const food = stockOf(soc, i, RES.FOOD);
        addStock(soc, i, RES.FOOD, -Math.floor(food / 10));
        grids.fertility[tile] = Math.min(255, (grids.fertility[tile] ?? 0) + 4);
        const lost = damageInfrastructure(world, i);
        soc.stability[i] = Math.max(0, (soc.stability[i] ?? 60) - 3);
        appendEvent(
          soc,
          day,
          EVENT_TYPE.FLOOD,
          SEVERITY.MAJOR,
          i,
          s.civ[i] ?? 0,
          0,
          lost >= 0 ? lost : 0,
          ROOT_CAUSE,
        );
      }
    }
  }
}

/**
 * Harness-only blight (Stage 3 WP H). This is the one non-input intervention the acceptance harness
 * needs; it is not a production cheat: it changes vegetation, soil and food exactly as a real
 * ecological blight would, and every consequence (migration, prices, war) follows from those numbers.
 * It is never scheduled by the simulation itself.
 */
export function applyBlight(world: WorldState, centre: number, day: number, radius = 6): number {
  const s = world.settlements;
  const soc = world.society;
  const cx = s.x[centre] ?? 0;
  const cy = s.y[centre] ?? 0;
  let affected = 0;
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const dx = (s.x[i] ?? 0) - cx;
    const dy = (s.y[i] ?? 0) - cy;
    if (dx * dx + dy * dy > radius * radius) continue;
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    world.grids.vegetation[tile] = Math.max(0, (world.grids.vegetation[tile] ?? 0) - 90);
    world.grids.fertility[tile] = Math.max(5, (world.grids.fertility[tile] ?? 0) - 50);
    // a blight destroys the standing crop, not just the soil: 80 % of the store is lost
    const food = stockOf(soc, i, RES.FOOD);
    addStock(soc, i, RES.FOOD, -Math.floor((food * 80) / 100));
    soc.health[i] = Math.max(0, (soc.health[i] ?? 60) - 10);
    soc.stability[i] = Math.max(0, (soc.stability[i] ?? 60) - 15);
    affected++;
  }
  appendEvent(
    soc,
    day,
    EVENT_TYPE.BLIGHT,
    SEVERITY.HISTORIC,
    centre,
    s.civ[centre] ?? 0,
    0,
    affected,
    ROOT_CAUSE,
  );
  return affected;
}

/** Whether a tile still has enough cover to be worked, used by the audit. */
export function vegetationOf(world: WorldState, settlement: number): number {
  const s = world.settlements;
  return world.grids.vegetation[(s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0)] ?? 0;
}
