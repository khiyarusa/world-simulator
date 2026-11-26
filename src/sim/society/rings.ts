/** Bounded history, intervention and yearly-series rings. */
import {
  INTERVENTION_CAPACITY,
  SETTLEMENT_TREND_SAMPLES,
  STATS_CAPACITY,
  type SocietyState,
} from './state.ts';

export function appendChronicle(
  soc: SocietyState,
  year: number,
  civ: number,
  population: number,
  settlements: number,
  notableEvents: number,
): void {
  const index = soc.chronicleHead;
  soc.chronicleYear[index] = year;
  soc.chronicleCiv[index] = civ;
  soc.chroniclePop[index] = population;
  soc.chronicleSettlements[index] = settlements;
  soc.chronicleEvents[index] = notableEvents > 255 ? 255 : notableEvents;
  soc.chronicleHead = (index + 1) % 4096;
  if (soc.chronicleCount < 4096) soc.chronicleCount++;
}

/** Append one player intervention row (oldest rows are overwritten when the ring wraps). */
export function appendIntervention(
  soc: SocietyState,
  kind: number,
  a: number,
  b: number,
  start: number,
  end: number,
  intensity: number,
  resource: number,
  amount: number,
): number {
  const index = soc.interventionHead;
  soc.interventionKind[index] = kind;
  soc.interventionA[index] = a;
  soc.interventionB[index] = b;
  soc.interventionStart[index] = start;
  soc.interventionEnd[index] = end;
  soc.interventionIntensity[index] = intensity;
  soc.interventionResource[index] = resource;
  soc.interventionAmount[index] = amount;
  soc.interventionHead = (index + 1) % INTERVENTION_CAPACITY;
  if (soc.interventionCount < INTERVENTION_CAPACITY) soc.interventionCount++;
  if (kind >= 0 && kind < soc.interventionLastDay.length) soc.interventionLastDay[kind] = start;
  return index;
}

/** Append one yearly world sample. */
export function appendYearlyStats(soc: SocietyState, sample: {
  year: number;
  population: number;
  settlements: number;
  civs: number;
  foodProduced: number;
  tradeVolume: number;
  treasury: number;
  wars: number;
  fertility: number;
  drought: number;
}): void {
  const index = soc.statsHead;
  soc.statsYear[index] = sample.year;
  soc.statsPopulation[index] = sample.population;
  soc.statsSettlements[index] = sample.settlements;
  soc.statsCivs[index] = sample.civs;
  soc.statsFoodProduced[index] = sample.foodProduced;
  soc.statsTradeVolume[index] = sample.tradeVolume;
  soc.statsTreasury[index] = sample.treasury;
  soc.statsWars[index] = sample.wars;
  soc.statsFertility[index] = sample.fertility;
  soc.statsDrought[index] = sample.drought;
  soc.statsHead = (index + 1) % STATS_CAPACITY;
  if (soc.statsCount < STATS_CAPACITY) soc.statsCount++;
}

/**
 * Shift one settlement's six-sample population window. Sampling is yearly and capped to 65535, so
 * the display never shows a value the simulation cannot hold.
 */
export function appendSettlementTrend(soc: SocietyState, settlement: number, population: number): void {
  const base = settlement * SETTLEMENT_TREND_SAMPLES;
  const count = soc.trendCount[settlement] ?? 0;
  if (count < SETTLEMENT_TREND_SAMPLES) {
    soc.trendPop[base + count] = population > 65535 ? 65535 : population;
    soc.trendCount[settlement] = count + 1;
    return;
  }
  for (let i = 1; i < SETTLEMENT_TREND_SAMPLES; i++) {
    soc.trendPop[base + i - 1] = soc.trendPop[base + i] ?? 0;
  }
  soc.trendPop[base + SETTLEMENT_TREND_SAMPLES - 1] = population > 65535 ? 65535 : population;
}
