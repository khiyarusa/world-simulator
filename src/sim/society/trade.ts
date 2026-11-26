/**
 * Trade: scarcity prices, trade routes and the goods that move along them (GDD §9.3).
 *
 * A route is a simulation edge, not a caravan: two settlements, a capacity in units/day, a length, a
 * tariff and a cumulative volume. Routes are created by a utility decision when a durable price gap
 * exists, move real units out of a real surplus into a real deficit, and close when they stop trading.
 */
import type { WorldState } from '../state/worldState.ts';
import {
  DECISION,
  EVENT_TYPE,
  RES_COUNT,
  ROUTE_CAPACITY,
  SEVERITY,
  addStock,
  appendEvent,
  infraHas,
  populationOf,
  recordDecision,
  stockOf,
  INFRA,
} from './state.ts';
import { distanceSq, isAlive, relationOf, routeIndex } from './common.ts';
import { RESERVE_DAYS, recomputePrices, runTreasury } from './economy.ts';

/** Units a settlement is willing to sell, above its own working reserve. */
function surplusOf(world: WorldState, settlement: number, res: number): number {
  const soc = world.society;
  const pop = populationOf(soc, settlement);
  const reserve = pop * (RESERVE_DAYS[res] ?? 10);
  return Math.max(0, stockOf(soc, settlement, res) - reserve);
}

/** Units a settlement is short of, before its own price makes the import worthwhile. */
function deficitOf(world: WorldState, settlement: number, res: number): number {
  const soc = world.society;
  const pop = populationOf(soc, settlement);
  const target = pop * (RESERVE_DAYS[res] ?? 10) * 2;
  return Math.max(0, target - stockOf(soc, settlement, res));
}

/** Tariff in per-mille of the moved value: distance plus culture, reduced by roads and markets. */
function tariffOf(world: WorldState, a: number, b: number, distance: number): number {
  const soc = world.society;
  const s = world.settlements;
  let tariff = 8 + distance;
  if (infraHas(soc, a, INFRA.indexOf('road'))) tariff -= 3;
  if (infraHas(soc, b, INFRA.indexOf('road'))) tariff -= 3;
  if (infraHas(soc, a, INFRA.indexOf('market')) || infraHas(soc, b, INFRA.indexOf('market'))) tariff -= 2;
  const ca = s.civ[a] ?? 0;
  tariff += Math.floor(Math.max(0, (soc.culture[ca * 3 + 1] ?? 0)) / 40); // isolationism
  return tariff < 2 ? 2 : tariff > 60 ? 60 : tariff;
}

/** Best monthly coin margin of pairing two settlements, and the resource that carries it. */
function pairValue(world: WorldState, a: number, b: number): number {
  const soc = world.society;
  let best = 0;
  for (let r = 0; r < RES_COUNT; r++) {
    const pa = soc.price[a * RES_COUNT + r] ?? 1000;
    const pb = soc.price[b * RES_COUNT + r] ?? 1000;
    if (pb > pa) {
      const qty = Math.min(surplusOf(world, a, r), deficitOf(world, b, r));
      if (qty > 0) best = Math.max(best, Math.floor((qty * (pb - pa)) / 1000));
    } else if (pa > pb) {
      const qty = Math.min(surplusOf(world, b, r), deficitOf(world, a, r));
      if (qty > 0) best = Math.max(best, Math.floor((qty * (pa - pb)) / 1000));
    }
  }
  return best;
}

function openRoute(world: WorldState, a: number, b: number, day: number, score: number): boolean {
  const soc = world.society;
  if (soc.routeCount >= ROUTE_CAPACITY) return false;
  const distance = Math.round(Math.sqrt(distanceSq(world, a, b)));
  const pop = populationOf(soc, a) + populationOf(soc, b);
  let capacity = 2 + Math.floor(pop / 200);
  if (infraHas(soc, a, INFRA.indexOf('road'))) capacity = Math.floor((capacity * 130) / 100);
  if (infraHas(soc, a, INFRA.indexOf('market')) || infraHas(soc, b, INFRA.indexOf('market'))) {
    capacity = Math.floor((capacity * 120) / 100);
  }
  if (capacity > 80) capacity = 80;
  const at = soc.routeCount;
  soc.routeA[at] = a;
  soc.routeB[at] = b;
  soc.routeCapacity[at] = capacity;
  soc.routeLength[at] = distance;
  soc.routeTariff[at] = tariffOf(world, a, b, distance);
  soc.routeCreated[at] = day;
  soc.routeVolume[at] = 0;
  soc.routeIdle[at] = 0;
  soc.routeCount = at + 1;
  recordDecision(soc, day, DECISION.TRADE_ROUTE, a, b, score);
  appendEvent(
    soc,
    day,
    EVENT_TYPE.ROUTE_OPENED,
    SEVERITY.NOTABLE,
    a,
    world.settlements.civ[a] ?? 0,
    world.settlements.civ[b] ?? 0,
    capacity,
    0,
  );
  world.counters.routesOpened += 1;
  return true;
}

/** Open at most a few routes per month, each from an actual price gap. */
function createRoutes(world: WorldState, day: number): void {
  const soc = world.society;
  const s = world.settlements;
  let opened = 0;
  for (let a = 0; a < s.count && opened < 4; a++) {
    if (!isAlive(world, a)) continue;
    const ca = s.civ[a] ?? 0;
    let bestB = -1;
    let bestScore = 0;
    for (let b = a + 1; b < s.count; b++) {
      if (!isAlive(world, b)) continue;
      if (routeIndex(soc, a, b) >= 0) continue;
      const d2 = distanceSq(world, a, b);
      if (d2 > 22 * 22) continue;
      const cb = s.civ[b] ?? 0;
      if (ca !== cb) {
        const rel = Math.min(relationOf(soc, ca, cb), relationOf(soc, cb, ca));
        if (rel < -30) continue;
      }
      const score = pairValue(world, a, b);
      if (score > bestScore) {
        bestScore = score;
        bestB = b;
      }
    }
    if (bestB < 0 || bestScore < 60) continue;
    if (openRoute(world, a, bestB, day, bestScore > 1000 ? 1000 : bestScore)) opened++;
  }
}

/** Move the best-paying resource along one route. Returns units moved. */
function moveAlongRoute(world: WorldState, route: number, day: number): number {
  const soc = world.society;
  const s = world.settlements;
  const a = soc.routeA[route] ?? 0;
  const b = soc.routeB[route] ?? 0;
  if (!isAlive(world, a) || !isAlive(world, b)) return 0;

  const capacity = (soc.routeCapacity[route] ?? 0) * 30; // one month of daily capacity
  let bestRes = -1;
  let bestProfit = 0;
  let bestQty = 0;
  let bestFrom = a;
  let bestTo = b;
  let bestPrice = 0;
  for (let r = 0; r < RES_COUNT; r++) {
    const pa = soc.price[a * RES_COUNT + r] ?? 1000;
    const pb = soc.price[b * RES_COUNT + r] ?? 1000;
    const fromA = pa < pb;
    const seller = fromA ? a : b;
    const buyer = fromA ? b : a;
    const sellPrice = fromA ? pa : pb;
    const buyPrice = fromA ? pb : pa;
    let qty = Math.min(capacity, surplusOf(world, seller, r), deficitOf(world, buyer, r));
    // the buyer can only pay coin it owns: limit by its treasury
    const unitCost = Math.max(1, sellPrice);
    const maxAffordable = Math.floor(((soc.treasury[buyer] ?? 0) * 1000) / Math.max(1, unitCost));
    if (qty > maxAffordable) qty = maxAffordable;
    // the counterparty must also have room in storage
    const free = (soc.cap[buyer * RES_COUNT + r] ?? 0) - stockOf(soc, buyer, r);
    if (qty > free) qty = free;
    if (qty <= 0) continue;
    const profit = Math.floor((qty * (buyPrice - sellPrice)) / 1000);
    if (profit > bestProfit) {
      bestProfit = profit;
      bestRes = r;
      bestQty = qty;
      bestFrom = seller;
      bestTo = buyer;
      bestPrice = sellPrice;
    }
  }
  if (bestRes < 0 || bestQty <= 0) return 0;

  const before = stockOf(soc, bestFrom, bestRes);
  addStock(soc, bestFrom, bestRes, -bestQty);
  const removed = before - stockOf(soc, bestFrom, bestRes);
  const added = addStock(soc, bestTo, bestRes, removed);
  if (added <= 0) {
    // no room after all: put the units back, nothing happened
    addStock(soc, bestFrom, bestRes, removed);
    return 0;
  }

  const tariff = soc.routeTariff[route] ?? 10;
  const value = Math.floor((added * bestPrice) / 1000);
  const fee = Math.floor((value * tariff) / 1000);
  const buyer = bestTo;
  const seller = bestFrom;
  const affordable = Math.min(soc.treasury[buyer] ?? 0, value + fee);
  soc.treasury[buyer] = (soc.treasury[buyer] ?? 0) - affordable;
  soc.treasury[seller] = (soc.treasury[seller] ?? 0) + affordable;

  soc.routeVolume[route] = (soc.routeVolume[route] ?? 0) + added;
  soc.routeIdle[route] = 0;
  world.counters.tradeVolume += added;
  world.counters.tributePaid += fee;
  if (world.counters.tradeVolume % 5_000 < added) {
    appendEvent(
      soc,
      day,
      EVENT_TYPE.BOOM,
      SEVERITY.LOCAL,
      seller,
      s.civ[seller] ?? 0,
      s.civ[buyer] ?? 0,
      added,
      0,
    );
  }
  return added;
}

/** Close routes that cannot trade, without leaving a hole in the bounded list. */
function decayRoutes(world: WorldState, day: number): void {
  const soc = world.society;
  for (let route = soc.routeCount - 1; route >= 0; route--) {
    const a = soc.routeA[route] ?? 0;
    const b = soc.routeB[route] ?? 0;
    const dead = !isAlive(world, a) || !isAlive(world, b);
    const idle = (soc.routeIdle[route] ?? 0) + 1;
    soc.routeIdle[route] = idle > 255 ? 255 : idle;
    if (!dead && idle < 24) continue;

    appendEvent(
      soc,
      day,
      EVENT_TYPE.ROUTE_LOST,
      SEVERITY.NOTABLE,
      a,
      world.settlements.civ[a] ?? 0,
      world.settlements.civ[b] ?? 0,
      soc.routeVolume[route] ?? 0,
      -1,
    );
    world.counters.routesLost += 1;
    const last = soc.routeCount - 1;
    if (route !== last) {
      soc.routeA[route] = soc.routeA[last] ?? 0;
      soc.routeB[route] = soc.routeB[last] ?? 0;
      soc.routeCapacity[route] = soc.routeCapacity[last] ?? 0;
      soc.routeLength[route] = soc.routeLength[last] ?? 0;
      soc.routeTariff[route] = soc.routeTariff[last] ?? 0;
      soc.routeCreated[route] = soc.routeCreated[last] ?? 0;
      soc.routeVolume[route] = soc.routeVolume[last] ?? 0;
      soc.routeIdle[route] = soc.routeIdle[last] ?? 0;
    }
    soc.routeCount = last;
  }
}

/** Monthly trade phase: prices, treasury, route creation, movement, decay. */
export function runTrade(world: WorldState, day: number): void {
  if (day % 30 !== 0) return;
  recomputePrices(world);
  runTreasury(world);
  createRoutes(world, day);
  for (let route = 0; route < world.society.routeCount; route++) moveAlongRoute(world, route, day);
  decayRoutes(world, day);
}

/** Whether a civ has any route to another civ (used for technology spread and contact). */
export function hasForeignContact(world: WorldState, civ: number): boolean {
  const soc = world.society;
  const s = world.settlements;
  for (let k = 0; k < soc.routeCount; k++) {
    const a = soc.routeA[k] ?? 0;
    const b = soc.routeB[k] ?? 0;
    const ca = s.civ[a] ?? 0;
    const cb = s.civ[b] ?? 0;
    if ((ca === civ && cb !== civ) || (cb === civ && ca !== civ)) return true;
  }
  return false;
}

/** Base resource value used by the UI and by trade accounting. */
export const BASE_VALUE = [1000, 300, 500, 700, 900, 1200] as const;
