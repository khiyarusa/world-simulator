/**
 * Economy: storage capacity, local prices and the treasury (GDD §9).
 *
 * One rule everywhere: a suck or a faucet is a real transfer. Prices are derived from the stock a
 * settlement actually holds; treasury is created only by selling real surplus and spent only on real
 * goods, labour or upkeep.
 */
import type { WorldState } from '../state/worldState.ts';
import { RES, RES_COUNT, addStock, infraHas, populationOf, stockOf, INFRA } from './state.ts';
import { isAlive } from './common.ts';

/** Days of consumption a settlement can store per resource, before infrastructure. */
const CAP_DAYS = [60, 20, 20, 0, 0, 0] as const;
/** Stock target used by the price curve, in days of consumption. */
export const PRICE_TARGET_DAYS = [30, 10, 15, 10, 10, 8] as const;
/** Reserve kept before anything may be sold or traded, in days of consumption. */
export const RESERVE_DAYS = [20, 8, 10, 4, 3, 2] as const;

/**
 * Recompute storage caps from the real population and the built infrastructure.
 *
 * A cap never falls below what is already stored: shrinking a settlement's cap must not delete goods
 * that its people already own. The excess is consumed or spoils in the normal daily pass, and the cap
 * tightens as the stock falls.
 */
export function recalcCaps(world: WorldState): void {
  const soc = world.society;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = populationOf(soc, i);
    const granary = infraHas(soc, i, INFRA.indexOf('granary'));
    const market = infraHas(soc, i, INFRA.indexOf('market'));
    const well = infraHas(soc, i, INFRA.indexOf('well'));
    const aqueduct = infraHas(soc, i, INFRA.indexOf('aqueduct'));

    const food = pop * (CAP_DAYS[0] + (granary ? 45 : 0));
    const water = pop * (CAP_DAYS[1] + (well ? 10 : 0) + (aqueduct ? 15 : 0));
    const wood = 200 + pop * CAP_DAYS[2];
    const stone = 2_000 + pop * 2;
    const metal = 1_000 + pop;
    const goods = (market ? 1_500 : 1_000) + pop;

    const wanted = [food, water, wood, stone, metal, goods] as const;
    for (let r = 0; r < RES_COUNT; r++) {
      const at = i * RES_COUNT + r;
      const stock = soc.stock[at] ?? 0;
      const cap = Math.max(wanted[r] ?? 0, stock);
      soc.cap[at] = cap > 2_000_000 ? 2_000_000 : cap;
    }
  }
}

/** Local price per unit, per-mille of the base value (1000 = normal). */
export function recomputePrices(world: WorldState): void {
  const soc = world.society;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = Math.max(1, populationOf(soc, i));
    for (let r = 0; r < RES_COUNT; r++) {
      const targetDays = PRICE_TARGET_DAYS[r] ?? 10;
      const perPerson = Math.floor((stockOf(soc, i, r) * 1000) / pop);
      const target = targetDays * 1000;
      // scarcity raises the price; abundance lowers it but never below a quarter of base
      let price = Math.floor((target * 1000) / Math.max(1, perPerson));
      if (price < 250) price = 250;
      if (price > 3000) price = 3000;
      soc.price[i * RES_COUNT + r] = price;
    }
  }
}

/**
 * Sell a real surplus into the treasury. The state can only coin what the settlement actually owns
 * above its own reserve: the food/wood units leave the stock, so the money has a source.
 */
export function runTreasury(world: WorldState): void {
  const soc = world.society;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const pop = populationOf(soc, i);
    // the state's claim on this month's real production: a head levy, collected more efficiently
    // where the settlement is stable. It is income, not a stock transfer, and it is the only faucet.
    const tax = Math.floor((pop * (600 + (soc.stability[i] ?? 60) * 4)) / 1000);
    soc.treasury[i] = (soc.treasury[i] ?? 0) + tax;
    world.counters.taxCollected += tax;
    // surplus food above 60 days, at most a tenth per month, is sold at the local price
    const food = stockOf(soc, i, RES.FOOD);
    const keep = pop * 60;
    if (food > keep) {
      const sell = Math.min(food - keep, Math.max(1, Math.floor((food - keep) / 10)));
      const price = soc.price[i * RES_COUNT + RES.FOOD] ?? 1000;
      addStock(soc, i, RES.FOOD, -sell);
      soc.treasury[i] = (soc.treasury[i] ?? 0) + Math.floor((sell * price) / 1000);
    }
    // goods are the other taxable surplus; a market makes the exchange more efficient
    const goods = stockOf(soc, i, RES.GOODS);
    const goodsKeep = pop * 2;
    if (goods > goodsKeep) {
      const sell = Math.min(goods - goodsKeep, Math.max(1, Math.floor((goods - goodsKeep) / 8)));
      const price = soc.price[i * RES_COUNT + RES.GOODS] ?? 1000;
      addStock(soc, i, RES.GOODS, -sell);
      const efficiency = infraHas(soc, i, INFRA.indexOf('market')) ? 1200 : 1000;
      soc.treasury[i] = (soc.treasury[i] ?? 0) + Math.floor((sell * price * efficiency) / 1_000_000);
    }
  }
}

/** Spend treasury, never below zero. Returns whether the whole cost was affordable. */
export function spendTreasury(soc: WorldState['society'], settlement: number, cost: number): boolean {
  if (cost <= 0) return true;
  const have = soc.treasury[settlement] ?? 0;
  if (have < cost) return false;
  soc.treasury[settlement] = have - cost;
  return true;
}

/** Transfer coin between treasuries; no coin is created or destroyed. */
export function payTribute(soc: WorldState['society'], from: number, to: number, amount: number): number {
  const have = soc.treasury[from] ?? 0;
  const paid = Math.min(have, Math.max(0, amount));
  if (paid <= 0) return 0;
  soc.treasury[from] = have - paid;
  soc.treasury[to] = (soc.treasury[to] ?? 0) + paid;
  return paid;
}
