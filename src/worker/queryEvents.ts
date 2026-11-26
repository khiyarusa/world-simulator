/** History, causality, chronicle and the yearly series. */
import type { WorldState } from '../sim/state/worldState.ts';
import { DAYS_PER_YEAR } from '../core/clock.ts';
import { EVENT_TYPE, EVENT_TYPE_NAMES, STATS_CAPACITY } from '../sim/society/state.ts';
import type { HistoryFilter } from './protocol.ts';
import type { ChronicleEntry, ChroniclePage, EventCategory, EventDetail, EventView, HistoryPage, YearPoint } from './queryTypes.ts';
import { civNameOf, settlementNameOf } from './queryNames.ts';
import { clampLimit, clampOffset } from './queryUtil.ts';

const WAR_TYPES = new Set<number>([EVENT_TYPE.WAR_DECLARED, EVENT_TYPE.BATTLE, EVENT_TYPE.PEACE_SIGNED]);
const DISASTER_TYPES = new Set<number>([
  EVENT_TYPE.DROUGHT,
  EVENT_TYPE.FLOOD,
  EVENT_TYPE.WILDFIRE,
  EVENT_TYPE.EPIDEMIC,
  EVENT_TYPE.FAMINE,
  EVENT_TYPE.COLLAPSE,
  EVENT_TYPE.BLIGHT,
]);
const MIGRATION_TYPES = new Set<number>([EVENT_TYPE.MIGRATION_WAVE]);
const POLITICS_TYPES = new Set<number>([
  EVENT_TYPE.SETTLEMENT_FOUNDED,
  EVENT_TYPE.SETTLEMENT_ABANDONED,
  EVENT_TYPE.TIER_UP,
  EVENT_TYPE.TREATY_SIGNED,
  EVENT_TYPE.TREATY_BROKEN,
  EVENT_TYPE.CIV_FORMED,
  EVENT_TYPE.FRAGMENTATION,
]);
const ECONOMY_TYPES = new Set<number>([
  EVENT_TYPE.ROUTE_OPENED,
  EVENT_TYPE.ROUTE_LOST,
  EVENT_TYPE.BOOM,
  EVENT_TYPE.INFRA_BUILT,
  EVENT_TYPE.TECH_DISCOVERED,
  EVENT_TYPE.TECH_SPREAD,
  EVENT_TYPE.GOLDEN_AGE,
]);

export function eventCategory(type: number, player: boolean): EventCategory {
  if (player) return 'player';
  if (WAR_TYPES.has(type)) return 'war';
  if (DISASTER_TYPES.has(type)) return 'disaster';
  if (MIGRATION_TYPES.has(type)) return 'migration';
  if (POLITICS_TYPES.has(type)) return 'politics';
  if (ECONOMY_TYPES.has(type)) return 'economy';
  return 'other';
}

const ROOT_CAUSE = -1;
const PLAYER_CAUSE = -2;

// ------------------------------------------------------------------ events

interface RawEvent {
  id: number;
  day: number;
  type: number;
  severity: number;
  place: number;
  actorA: number;
  actorB: number;
  magnitude: number;
  cause: number;
}

function rawMainEvents(world: WorldState): RawEvent[] {
  const soc = world.society;
  const out: RawEvent[] = [];
  const cap = soc.eventId.length;
  for (let n = 0; n < soc.eventCount; n++) {
    const i = (soc.eventHead - soc.eventCount + n + cap * 2) % cap;
    out.push({
      id: soc.eventId[i] ?? 0,
      day: soc.eventDay[i] ?? 0,
      type: soc.eventType[i] ?? 0,
      severity: soc.eventSeverity[i] ?? 0,
      place: soc.eventPlace[i] ?? 0,
      actorA: soc.eventActorA[i] ?? 0,
      actorB: soc.eventActorB[i] ?? 0,
      magnitude: soc.eventMagnitude[i] ?? 0,
      cause: soc.eventCause[i] ?? 0,
    });
  }
  return out;
}

/** Every event the save still holds, oldest first, with vital-only rows appended and de-duplicated. */
export function allEvents(world: WorldState): RawEvent[] {
  const main = rawMainEvents(world);
  const seen = new Set<number>();
  for (const e of main) seen.add(e.id);
  const vital = world.society.vital;
  const extra: RawEvent[] = [];
  for (let n = 0; n < vital.count; n++) {
    const i = (vital.head - vital.count + n + vital.id.length * 2) % vital.id.length;
    const id = vital.id[i] ?? 0;
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    extra.push({
      id,
      day: vital.day[i] ?? 0,
      type: vital.type[i] ?? 0,
      severity: vital.severity[i] ?? 0,
      place: vital.place[i] ?? 0,
      actorA: vital.actorA[i] ?? 0,
      actorB: vital.actorB[i] ?? 0,
      magnitude: vital.magnitude[i] ?? 0,
      cause: vital.cause[i] ?? 0,
    });
  }
  extra.sort((a, b) => (a.day === b.day ? a.id - b.id : a.day - b.day));
  return [...main, ...extra].sort((a, b) => (a.day === b.day ? a.id - b.id : a.day - b.day));
}

function isPlayerEvent(e: RawEvent): boolean {
  return e.cause === PLAYER_CAUSE || e.type === EVENT_TYPE.PLAYER_BLESS || e.type === EVENT_TYPE.PLAYER_FERTILIZE || e.type === EVENT_TYPE.PLAYER_INCITE;
}

export function eventView(world: WorldState, e: RawEvent): EventView {
  const player = isPlayerEvent(e);
  const place = e.place < world.settlements.count ? e.place : -1;
  return {
    id: e.id,
    day: e.day,
    year: Math.floor((e.day - 1) / DAYS_PER_YEAR) + 1,
    type: e.type,
    typeName: EVENT_TYPE_NAMES[e.type] ?? 'unknown',
    category: eventCategory(e.type, player),
    severity: e.severity,
    place,
    placeName: place >= 0 ? settlementNameOf(world, place) : '—',
    placeX: place >= 0 ? world.settlements.x[place] ?? 0 : 0,
    placeY: place >= 0 ? world.settlements.y[place] ?? 0 : 0,
    actorA: e.actorA,
    actorB: e.actorB,
    actorAName: e.actorA < world.civs.count ? civNameOf(world, e.actorA) : '—',
    actorBName: e.actorB < world.civs.count ? civNameOf(world, e.actorB) : '—',
    magnitude: e.magnitude,
    cause: e.cause,
    root: player ? 'player' : e.cause <= 0 ? 'root' : 'event',
    player,
  };
}

function matchesFilter(view: EventView, filter: HistoryFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.types && filter.types.length > 0 && !filter.types.includes(view.type)) return false;
  if (filter.minSeverity !== undefined && view.severity < filter.minSeverity) return false;
  if (filter.fromDay !== undefined && view.day < filter.fromDay) return false;
  if (filter.toDay !== undefined && view.day > filter.toDay) return false;
  if (filter.place !== undefined && view.place !== filter.place) return false;
  if (filter.civ !== undefined && view.actorA !== filter.civ && view.actorB !== filter.civ) return false;
  if (filter.playerOnly && !view.player) return false;
  if (filter.search) {
    const q = filter.search.trim().toLowerCase();
    if (q.length > 0) {
      const hay = `${view.typeName} ${view.placeName} ${view.actorAName} ${view.actorBName} ${view.year}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

export function queryHistory(world: WorldState, filter: HistoryFilter | undefined, offsetIn: number | undefined, limitIn: number | undefined): HistoryPage {
  const offset = clampOffset(offsetIn);
  const limit = clampLimit(limitIn, 50, 100);
  const counts: Record<EventCategory, number> = {
    war: 0,
    disaster: 0,
    migration: 0,
    politics: 0,
    economy: 0,
    player: 0,
    other: 0,
  };
  const matched: EventView[] = [];
  let first = 0;
  let last = 0;
  for (const raw of allEvents(world)) {
    const view = eventView(world, raw);
    counts[view.category] += 1;
    if (!matchesFilter(view, filter)) continue;
    if (first === 0 || view.year < first) first = view.year;
    if (view.year > last) last = view.year;
    matched.push(view);
  }
  // newest first is what a player expects in a feed
  matched.sort((a, b) => (b.day === a.day ? b.id - a.id : b.day - a.day));
  return { total: matched.length, offset, events: matched.slice(offset, offset + limit), counts, years: { first, last } };
}

export function queryEvent(world: WorldState, id: number): EventDetail | null {
  const all = allEvents(world);
  const byId = new Map<number, RawEvent>();
  for (const e of all) byId.set(e.id, e);
  const target = byId.get(id);
  if (!target) return null;
  const targetView = eventView(world, target);

  // walk the cause chain, guarding against a malformed cycle
  const chain: EventView[] = [];
  const seen = new Set<number>();
  let cursor: RawEvent | undefined = target;
  while (cursor && !seen.has(cursor.id) && chain.length < 10) {
    seen.add(cursor.id);
    chain.unshift(eventView(world, cursor));
    if (cursor.cause > 0) cursor = byId.get(cursor.cause);
    else cursor = undefined;
  }
  const consequences = all
    .filter((e) => e.cause === target.id)
    .slice(0, 20)
    .map((e) => eventView(world, e));
  const root = targetView.player
    ? { kind: 'player' as const, explanation: 'This was caused by a player intervention.' }
    : target.cause === ROOT_CAUSE
      ? { kind: 'root' as const, explanation: 'No earlier event is recorded: this is an environmental or systemic root cause.' }
      : target.cause === 0
        ? { kind: 'root' as const, explanation: 'This event has no recorded parent; it is a founding or systemic condition.' }
        : { kind: 'event' as const, explanation: `Caused by event #${target.cause}.` };
  return { event: targetView, chain, consequences, root };
}

export function queryChronicle(world: WorldState, fromYear: number | undefined, toYear: number | undefined, offsetIn: number | undefined, limitIn: number | undefined): ChroniclePage {
  const soc = world.society;
  const offset = clampOffset(offsetIn);
  const limit = clampLimit(limitIn, 40, 100);
  const entries: ChronicleEntry[] = [];
  for (let n = 0; n < soc.chronicleCount; n++) {
    const i = (soc.chronicleHead - soc.chronicleCount + n + 8192) % 4096;
    const year = soc.chronicleYear[i] ?? 0;
    if (fromYear !== undefined && year < fromYear) continue;
    if (toYear !== undefined && year > toYear) continue;
    const civ = soc.chronicleCiv[i] ?? 0;
    entries.push({
      year,
      civ,
      civName: civNameOf(world, civ),
      population: soc.chroniclePop[i] ?? 0,
      settlements: soc.chronicleSettlements[i] ?? 0,
      notableEvents: soc.chronicleEvents[i] ?? 0,
    });
  }
  entries.sort((a, b) => (b.year === a.year ? a.civ - b.civ : b.year - a.year));
  return { total: entries.length, offset, entries: entries.slice(offset, offset + limit), series: querySeries(world) };
}

export function querySeries(world: WorldState): YearPoint[] {
  const soc = world.society;
  const out: YearPoint[] = [];
  for (let n = 0; n < soc.statsCount; n++) {
    const i = (soc.statsHead - soc.statsCount + n + STATS_CAPACITY * 2) % STATS_CAPACITY;
    out.push({
      year: soc.statsYear[i] ?? 0,
      population: soc.statsPopulation[i] ?? 0,
      settlements: soc.statsSettlements[i] ?? 0,
      civs: soc.statsCivs[i] ?? 0,
      foodProduced: soc.statsFoodProduced[i] ?? 0,
      tradeVolume: soc.statsTradeVolume[i] ?? 0,
      treasury: soc.statsTreasury[i] ?? 0,
      wars: soc.statsWars[i] ?? 0,
      fertility: soc.statsFertility[i] ?? 0,
      drought: soc.statsDrought[i] ?? 0,
    });
  }
  return out;
}
