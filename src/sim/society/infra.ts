/**
 * Infrastructure: twelve buildings selected by integer utility, paid for with real materials and coin
 * (GDD §7.2, docs/SIMULATION_MODEL.md §7).
 *
 * A building bit is never set without payment. The utility score combines a measured need (food days,
 * water access, stability, literacy, threat), a cultural affinity and a cost penalty, and the decision
 * is recorded so a player can ask why a settlement built a granary instead of walls.
 */
import type { WorldState } from '../state/worldState.ts';
import {
  DECISION,
  EVENT_TYPE,
  INFRA_COUNT,
  RES,
  SEVERITY,
  addStock,
  appendEvent,
  infraHas,
  populationOf,
  recordDecision,
  stockOf,
} from './state.ts';
import { isAlive } from './common.ts';
import { recalcCaps } from './economy.ts';

interface Cost {
  readonly wood: number;
  readonly stone: number;
  readonly metal: number;
  readonly goods: number;
  readonly coin: number;
  /** minimum tier (0 camp .. 4 metropolis) */
  readonly tier: number;
}

/** Cost and prerequisite per building, in INFRA order. */
export const INFRA_COST: readonly Cost[] = [
  { wood: 60, stone: 20, metal: 0, goods: 0, coin: 120, tier: 1 }, // granary
  { wood: 20, stone: 60, metal: 0, goods: 0, coin: 100, tier: 1 }, // well
  { wood: 40, stone: 30, metal: 0, goods: 0, coin: 150, tier: 1 }, // irrigation
  { wood: 60, stone: 120, metal: 10, goods: 0, coin: 300, tier: 2 }, // walls
  { wood: 40, stone: 20, metal: 10, goods: 10, coin: 250, tier: 2 }, // market
  { wood: 60, stone: 30, metal: 30, goods: 0, coin: 250, tier: 2 }, // workshop
  { wood: 60, stone: 40, metal: 0, goods: 0, coin: 180, tier: 1 }, // road
  { wood: 40, stone: 60, metal: 10, goods: 0, coin: 200, tier: 1 }, // temple
  { wood: 40, stone: 60, metal: 10, goods: 20, coin: 400, tier: 3 }, // academy
  { wood: 20, stone: 120, metal: 20, goods: 0, coin: 450, tier: 3 }, // aqueduct
  { wood: 60, stone: 80, metal: 40, goods: 0, coin: 350, tier: 3 }, // barracks
  { wood: 120, stone: 40, metal: 0, goods: 10, coin: 300, tier: 2 }, // harbour
];

const BIT = {
  GRANARY: 0,
  WELL: 1,
  IRRIGATION: 2,
  WALLS: 3,
  MARKET: 4,
  WORKSHOP: 5,
  ROAD: 6,
  TEMPLE: 7,
  ACADEMY: 8,
  AQUEDUCT: 9,
  BARRACKS: 10,
  HARBOUR: 11,
} as const;

function coastal(world: WorldState, settlement: number): boolean {
  const s = world.settlements;
  const tile = (s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0);
  return ((world.grids.resource[tile] ?? 0) & 8) !== 0;
}

function hasWater(world: WorldState, settlement: number): boolean {
  const s = world.settlements;
  const tile = (s.y[settlement] ?? 0) * world.width + (s.x[settlement] ?? 0);
  return (world.grids.riverId[tile] ?? 0) > 0 || (world.grids.lakeId[tile] ?? 0) > 0;
}

/** Real stock above the working reserve; a settlement does not build with the food it needs to eat. */
function spare(world: WorldState, settlement: number, res: number): number {
  const pop = populationOf(world.society, settlement);
  const days = res === RES.FOOD ? 15 : res === RES.WOOD ? 10 : res === RES.STONE ? 2 : res === RES.METAL ? 1 : 1;
  return Math.max(0, stockOf(world.society, settlement, res) - pop * days);
}

function canPay(world: WorldState, settlement: number, cost: Cost): boolean {
  if ((world.society.treasury[settlement] ?? 0) < cost.coin) return false;
  if (spare(world, settlement, RES.WOOD) < cost.wood) return false;
  if (spare(world, settlement, RES.STONE) < cost.stone) return false;
  if (spare(world, settlement, RES.METAL) < cost.metal) return false;
  if (spare(world, settlement, RES.GOODS) < cost.goods) return false;
  return true;
}

function pay(world: WorldState, settlement: number, cost: Cost): void {
  const soc = world.society;
  addStock(soc, settlement, RES.WOOD, -cost.wood);
  addStock(soc, settlement, RES.STONE, -cost.stone);
  addStock(soc, settlement, RES.METAL, -cost.metal);
  addStock(soc, settlement, RES.GOODS, -cost.goods);
  soc.treasury[settlement] = (soc.treasury[settlement] ?? 0) - cost.coin;
}

/** Cultural weight for a building: what this civilization values, not a global preference. */
function affinity(soc: WorldState['society'], civ: number, bit: number): number {
  const martial = soc.culture[civ * 3] ?? 0; // -100 agrarian .. +100 martial
  const isolation = soc.culture[civ * 3 + 1] ?? 0; // -100 mercantile .. +100 isolationist
  const scholarly = soc.culture[civ * 3 + 2] ?? 0; // -100 traditional .. +100 scholarly
  switch (bit) {
    case BIT.GRANARY:
    case BIT.IRRIGATION:
    case BIT.WELL:
    case BIT.AQUEDUCT:
      return Math.floor((100 - martial) / 4);
    case BIT.WALLS:
    case BIT.BARRACKS:
      return Math.floor((martial + 100) / 4);
    case BIT.MARKET:
    case BIT.ROAD:
    case BIT.HARBOUR:
      return Math.floor((100 - isolation) / 4);
    case BIT.ACADEMY:
    case BIT.TEMPLE:
      return Math.floor((scholarly + 100) / 4);
    default:
      return 0;
  }
}

/** Score every unbuilt, legal, affordable building and return the best bit and score. */
function chooseBuilding(world: WorldState, settlement: number): { bit: number; score: number } {
  const soc = world.society;
  const s = world.settlements;
  const civ = s.civ[settlement] ?? 0;
  const pop = Math.max(1, populationOf(soc, settlement));
  const foodDays = Math.floor(stockOf(soc, settlement, RES.FOOD) / pop);
  const waterDays = Math.floor(stockOf(soc, settlement, RES.WATER) / pop);
  const goodsDays = Math.floor(stockOf(soc, settlement, RES.GOODS) / pop);
  const tier = s.tier[settlement] ?? 0;
  const stability = soc.stability[settlement] ?? 60;
  const health = soc.health[settlement] ?? 60;
  const literacy = soc.literacy[settlement] ?? 10;
  const threat = Math.min(100, Math.floor(civThreat(world, civ) / 2));

  let bestBit = -1;
  let bestScore = 0;
  for (let bit = 0; bit < INFRA_COUNT; bit++) {
    if (infraHas(soc, settlement, bit)) continue;
    const cost = INFRA_COST[bit];
    if (!cost || tier < cost.tier) continue;
    if (bit === BIT.HARBOUR && !coastal(world, settlement)) continue;
    if (!canPay(world, settlement, cost)) continue;

    let need = 0;
    switch (bit) {
      case BIT.GRANARY:
        need = Math.max(0, 45 - foodDays) * 4;
        break;
      case BIT.WELL:
        need = hasWater(world, settlement) ? 0 : 180;
        break;
      case BIT.IRRIGATION:
        need = 80 + Math.max(0, 30 - foodDays) * 2;
        break;
      case BIT.WALLS:
        need = 50 + threat;
        break;
      case BIT.MARKET:
        need = 60 + Math.max(0, 4 - goodsDays) * 10;
        break;
      case BIT.WORKSHOP:
        need = 70 + Math.max(0, 20 - waterDays);
        break;
      case BIT.ROAD:
        need = 55 + Math.min(60, pop / 20);
        break;
      case BIT.TEMPLE:
        need = Math.max(0, 90 - stability) * 2 + Math.max(0, 80 - health);
        break;
      case BIT.ACADEMY:
        need = Math.max(0, 80 - literacy) * 2;
        break;
      case BIT.AQUEDUCT:
        need = hasWater(world, settlement) ? Math.max(0, 55 - waterDays) * 2 : 120;
        break;
      case BIT.BARRACKS:
        need = 40 + threat;
        break;
      case BIT.HARBOUR:
        need = 90 + Math.min(40, pop / 40);
        break;
      default:
        need = 0;
    }
    if (need <= 0) continue;
    const costPenalty = Math.floor((cost.coin + cost.wood + cost.stone + cost.metal + cost.goods) / 20);
    const score = need + affinity(soc, civ, bit) - costPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestBit = bit;
    }
  }
  return { bit: bestBit, score: bestScore > 0 ? (bestScore > 1000 ? 1000 : bestScore) : 0 };
}

/** Highest grievance or active war involving this civilization, 0..100. */
function civThreat(world: WorldState, civ: number): number {
  const soc = world.society;
  const n = world.civs.count;
  let threat = 0;
  for (let other = 0; other < n; other++) {
    if (other === civ) continue;
    if ((soc.grievance[civ * n + other] ?? 0) > threat) threat = soc.grievance[civ * n + other] ?? 0;
  }
  for (let k = 0; k < soc.warCount; k++) {
    const a = soc.warA[k] ?? 0;
    const b = soc.warB[k] ?? 0;
    if (a === civ || b === civ) threat = 100;
  }
  return threat;
}

/** Monthly build phase: at most one new building per settlement, at most four in the world. */
export function runConstruction(world: WorldState, day: number): void {
  if (day % 30 !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  let built = 0;
  for (let i = 0; i < s.count && built < 4; i++) {
    if (!isAlive(world, i)) continue;
    const { bit, score } = chooseBuilding(world, i);
    if (bit < 0 || score < 55) continue;
    const cost = INFRA_COST[bit];
    if (!cost || !canPay(world, i, cost)) continue;
    pay(world, i, cost);
    soc.infra[i] = (soc.infra[i] ?? 0) | (1 << bit);
    world.counters.infraBuilt += 1;
    appendEvent(soc, day, EVENT_TYPE.INFRA_BUILT, SEVERITY.NOTABLE, i, s.civ[i] ?? 0, 0, bit, 0);
    recordDecision(soc, day, DECISION.BUILD, i, bit, score);
    recalcCaps(world);
    built++;
  }
}

/** Lose one building to a disaster: the highest-index structure is the most fragile. */
export function damageInfrastructure(world: WorldState, settlement: number): number {
  const soc = world.society;
  const mask = soc.infra[settlement] ?? 0;
  if (mask === 0) return -1;
  let bit = -1;
  for (let b = INFRA_COUNT - 1; b >= 0; b--) {
    if ((mask & (1 << b)) !== 0) {
      bit = b;
      break;
    }
  }
  if (bit < 0) return -1;
  soc.infra[settlement] = mask & ~(1 << bit);
  recalcCaps(world);
  return bit;
}

export { BIT as INFRA_BIT };
