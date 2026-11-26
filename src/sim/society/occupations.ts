/**
 * Occupation: labour moves toward each settlement's comparative advantage (GDD §7.3, brief §4.2).
 *
 * The five adult cohorts are the real distribution; `occShare` is their per-mille projection. People
 * are moved between cohorts, never created: every transfer is a paired +/- on the same settlement.
 * A single occupation is capped at 70 %, so no settlement becomes a monoculture.
 */
import type { WorldState } from '../state/worldState.ts';
import { COHORT, CIV_STRIDE, addCohort, cohortOf, infraHas } from './state.ts';
import { isAlive } from './common.ts';

const ADULT = [COHORT.FARMERS, COHORT.EXTRACTORS, COHORT.CRAFTERS, COHORT.TRADERS, COHORT.SOLDIERS] as const;
const MAX_SHARE_PM = 700;

function threat(world: WorldState, settlement: number): number {
  const civ = world.settlements.civ[settlement] ?? 0;
  const soc = world.society;
  const n = world.civs.count;
  let value = 0;
  for (let other = 0; other < n; other++) {
    if (other === civ) continue;
    const g = soc.grievance[civ * CIV_STRIDE + other] ?? 0;
    if (g > value) value = g;
  }
  for (let k = 0; k < soc.warCount; k++) {
    if ((soc.warA[k] ?? 0) === civ || (soc.warB[k] ?? 0) === civ) value = 1000;
  }
  return Math.floor(value / 10);
}

/** Move up to 1.5 % of adults per month toward the measured comparative advantage. */
export function runOccupations(world: WorldState, day: number): void {
  if (day % 30 !== 0) return;
  const soc = world.society;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const tile = (s.y[i] ?? 0) * world.width + (s.x[i] ?? 0);
    const fertility = world.grids.fertility[tile] ?? 0;
    const mask = world.grids.resource[tile] ?? 0;
    const adults =
      cohortOf(soc, i, COHORT.FARMERS) +
      cohortOf(soc, i, COHORT.EXTRACTORS) +
      cohortOf(soc, i, COHORT.CRAFTERS) +
      cohortOf(soc, i, COHORT.TRADERS) +
      cohortOf(soc, i, COHORT.SOLDIERS);
    if (adults <= 0) continue;
    // weights in per-mille: land, deposits, surplus materials, routes, danger
    const weights = [
      300 + Math.floor(fertility / 2),
      120 + ((mask & 1) !== 0 ? 80 : 0) + ((mask & 2) !== 0 ? 80 : 0) + ((mask & 4) !== 0 ? 60 : 0),
      80 + ((mask & 4) !== 0 && (mask & 2) !== 0 ? 80 : 0) + (infraHas(soc, i, 5) ? 60 : 0),
      60 + (infraHas(soc, i, 4) ? 80 : 0) + (infraHas(soc, i, 6) ? 40 : 0),
      40 + threat(world, i),
    ];
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) continue;

    // specialization cap, then redistribute the excess proportionally to the other occupations
    const desired = weights.map((w) => Math.floor((w * 1000) / total));
    let excess = 0;
    for (let k = 0; k < desired.length; k++) {
      if ((desired[k] ?? 0) > MAX_SHARE_PM) {
        excess += (desired[k] ?? 0) - MAX_SHARE_PM;
        desired[k] = MAX_SHARE_PM;
      }
    }
    let free = 0;
    for (let k = 0; k < desired.length; k++) if ((desired[k] ?? 0) < MAX_SHARE_PM) free += MAX_SHARE_PM - (desired[k] ?? 0);
    if (excess > 0 && free > 0) {
      for (let k = 0; k < desired.length; k++) {
        const room = MAX_SHARE_PM - (desired[k] ?? 0);
        if (room <= 0) continue;
        desired[k] = (desired[k] ?? 0) + Math.floor((excess * room) / free);
      }
    }

    for (let k = 0; k < ADULT.length; k++) {
      const cohort = ADULT[k]!;
      const want = Math.floor((adults * (desired[k] ?? 0)) / 1000);
      const have = cohortOf(soc, i, cohort);
      if (want === have) continue;
      const step = Math.max(1, Math.floor(adults * 15 / 1000));
      const delta = Math.max(-step, Math.min(step, want - have));
      if (delta > 0) {
        // take from the occupation with the largest excess above its own target
        let donor = -1;
        let donorExcess = 0;
        for (let d = 0; d < ADULT.length; d++) {
          if (d === k) continue;
          const haveD = cohortOf(soc, i, ADULT[d]!);
          const wantD = Math.floor((adults * (desired[d] ?? 0)) / 1000);
          if (haveD - wantD > donorExcess) {
            donorExcess = haveD - wantD;
            donor = d;
          }
        }
        if (donor < 0 || donorExcess <= 0) continue;
        const take = Math.min(delta, donorExcess);
        addCohort(soc, i, ADULT[donor]!, -take);
        addCohort(soc, i, cohort, take);
      } else {
        // give the excess to the occupation with the largest deficit
        let receiver = -1;
        let receiverNeed = 0;
        for (let d = 0; d < ADULT.length; d++) {
          if (d === k) continue;
          const haveD = cohortOf(soc, i, ADULT[d]!);
          const wantD = Math.floor((adults * (desired[d] ?? 0)) / 1000);
          if (wantD - haveD > receiverNeed) {
            receiverNeed = wantD - haveD;
            receiver = d;
          }
        }
        if (receiver < 0 || receiverNeed <= 0) continue;
        const give = Math.min(-delta, receiverNeed, have);
        addCohort(soc, i, cohort, -give);
        addCohort(soc, i, ADULT[receiver]!, give);
      }
    }

    // project the real adult cohorts into occShare (sum is exactly 1000 by construction)
    let adultNow = 0;
    for (const cohort of ADULT) adultNow += cohortOf(soc, i, cohort);
    if (adultNow > 0) {
      let assigned = 0;
      for (let k = 0; k < ADULT.length; k++) {
        const share = Math.floor((cohortOf(soc, i, ADULT[k]!) * 1000) / adultNow);
        soc.occShare[i * 5 + k] = share;
        assigned += share;
      }
      soc.occShare[i * 5] = (soc.occShare[i * 5] ?? 0) + (1000 - assigned);
    }
  }
}
