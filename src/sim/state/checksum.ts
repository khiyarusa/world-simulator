import { crc32, crc32OfU32 } from '../../core/crc32.ts';
import { GRID_KEYS } from './worldState.ts';
import { CIV_STRIDE } from '../society/state.ts';
import { presetIdOf } from '../world/presets.ts';
import type { WorldState } from './worldState.ts';

/**
 * Integrity contract for a world (D-34).
 *
 * Contract version 2 adds the recipe identity and the RNG stream states: two worlds that differ only
 * in `water` or in where their random streams stand are *not* the same world, and a checksum that
 * cannot see that difference cannot detect the corruption it exists to detect.
 *
 * Version 5 covers the complete persisted society: every stock, capacity, carry, occupation share,
 * price, culture axis, technology flag and research progress, relation and grievance, climate cell,
 * trade route, treaty, war (including the four gate values), event, decision and chronicle row.
 * Hashing only a head entry would let a save lose history and still "verify".
 *
 * Field order is frozen. Everything hashed here is deterministic persisted state; nothing here is
 * transient (no render, camera, UI, timing or report data).
 */
export const CHECKSUM_CONTRACT_VERSION = 5;

const CHECKSUM_DOMAIN = 0x43534d35; // "CSM5"

function bytesOf(view: Int16Array | Int8Array | Uint8Array | Uint16Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

const u8 = (v: number): number => v & 0xff;

/**
 * CRC over every persisted grid, in the frozen GRID_KEYS order.
 *
 * Deliberately domain-free: this is the *content* hash the golden fixture pins, so it must depend only
 * on the bytes of the world. Domain separation belongs to the integrity contract below (D-34).
 */
export function gridsChecksum(state: WorldState): number {
  let crc = 0;
  for (const key of GRID_KEYS) {
    crc = crc32(bytesOf(state.grids[key]), crc);
  }
  return crc >>> 0;
}

/**
 * Full world checksum: grids + clock + entity stores + recipe identity + RNG states + the complete
 * society block. Called on save and by determinism tests, never per tick.
 */
export function worldChecksum(state: WorldState): number {
  let crc = crc32OfU32(gridsChecksum(state), CHECKSUM_DOMAIN);
  crc = crc32OfU32(crc, state.day);
  crc = crc32OfU32(crc, state.width);
  crc = crc32OfU32(crc, state.height);
  crc = crc32OfU32(crc, state.seaLevel >>> 0);

  // --- recipe identity: every field that changes the generated world
  crc = crc32OfU32(crc, state.recipe.generatorVersion);
  crc = crc32OfU32(crc, presetIdOf(state.recipe.preset));
  crc = crc32OfU32(crc, state.recipe.seed.hi);
  crc = crc32OfU32(crc, state.recipe.seed.lo);
  crc = crc32OfU32(crc, state.recipe.water);
  crc = crc32OfU32(crc, state.recipe.harshness);
  crc = crc32OfU32(crc, state.recipe.peoples);

  // --- clock and counters that must survive a reload exactly
  const k = state.counters;
  crc = crc32OfU32(crc, k.settlementsFounded);
  crc = crc32OfU32(crc, k.ticks);
  crc = crc32OfU32(crc, k.droppedTicks);
  crc = crc32OfU32(crc, k.births);
  crc = crc32OfU32(crc, k.deaths);
  crc = crc32OfU32(crc, k.migrants);
  crc = crc32OfU32(crc, k.abandonments);
  crc = crc32OfU32(crc, k.foodProduced);
  crc = crc32OfU32(crc, k.foodConsumed);
  crc = crc32OfU32(crc, k.infraBuilt);
  crc = crc32OfU32(crc, k.routesOpened);
  crc = crc32OfU32(crc, k.routesLost);
  crc = crc32OfU32(crc, k.tradeVolume);
  crc = crc32OfU32(crc, k.tributePaid);
  crc = crc32OfU32(crc, k.taxCollected);
  crc = crc32OfU32(crc, k.warsDeclared);
  crc = crc32OfU32(crc, k.warsEnded);
  crc = crc32OfU32(crc, k.warDeaths);
  crc = crc32OfU32(crc, k.techDiscovered);
  crc = crc32OfU32(crc, k.starvationDeaths);
  crc = crc32OfU32(crc, k.epidemicDeaths);

  // --- RNG: a resumed world must have the same stream positions as an uninterrupted one
  crc = crc32OfU32(crc, state.rngStates.length);
  for (const s of state.rngStates) {
    crc = crc32OfU32(crc, s.s0);
    crc = crc32OfU32(crc, s.s1);
    crc = crc32OfU32(crc, s.s2);
    crc = crc32OfU32(crc, s.s3);
  }

  const s = state.settlements;
  crc = crc32OfU32(crc, s.count);
  for (let i = 0; i < s.count; i++) {
    crc = crc32OfU32(crc, s.x[i] ?? 0);
    crc = crc32OfU32(crc, s.y[i] ?? 0);
    crc = crc32OfU32(crc, s.pop[i] ?? 0);
    crc = crc32OfU32(crc, s.civ[i] ?? 0);
    crc = crc32OfU32(crc, s.tier[i] ?? 0);
    crc = crc32OfU32(crc, s.nameIdx[i] ?? 0);
    crc = crc32OfU32(crc, s.foundedDay[i] ?? 0);
  }

  // --- society: settlements
  const soc = state.society;
  for (let i = 0; i < state.settlements.count; i++) {
    for (let c = 0; c < 8; c++) crc = crc32OfU32(crc, soc.cohorts[i * 8 + c] ?? 0);
    for (let kk = 0; kk < 5; kk++) crc = crc32OfU32(crc, soc.occShare[i * 5 + kk] ?? 0);
    for (let r = 0; r < 6; r++) {
      crc = crc32OfU32(crc, soc.stock[i * 6 + r] ?? 0);
      crc = crc32OfU32(crc, soc.cap[i * 6 + r] ?? 0);
      crc = crc32OfU32(crc, soc.carry[i * 6 + r] ?? 0);
      crc = crc32OfU32(crc, soc.price[i * 6 + r] ?? 0);
    }
    crc = crc32OfU32(crc, soc.treasury[i] ?? 0);
    crc = crc32OfU32(crc, soc.health[i] ?? 0);
    crc = crc32OfU32(crc, soc.stability[i] ?? 0);
    crc = crc32OfU32(crc, soc.literacy[i] ?? 0);
    crc = crc32OfU32(crc, soc.infra[i] ?? 0);
    crc = crc32OfU32(crc, soc.flags[i] ?? 0);
    crc = crc32OfU32(crc, soc.occupier[i] ?? 0);
    crc = crc32OfU32(crc, soc.surplusYears[i] ?? 0);
    crc = crc32OfU32(crc, soc.foundedDay[i] ?? 0);
    crc = crc32OfU32(crc, soc.lastDroughtEvent[i] ?? 0);
    crc = crc32OfU32(crc, soc.lastFamineEvent[i] ?? 0);
  }

  // --- society: civilizations
  for (let c = 0; c < state.civs.count; c++) {
    crc = crc32OfU32(crc, soc.legitimacy[c] ?? 0);
    crc = crc32OfU32(crc, soc.army[c] ?? 0);
    crc = crc32OfU32(crc, soc.exhaustion[c] ?? 0);
    crc = crc32OfU32(crc, soc.warWins[c] ?? 0);
    for (let a = 0; a < 3; a++) crc = crc32OfU32(crc, u8(soc.culture[c * 3 + a] ?? 0));
    for (let t = 0; t < 12; t++) {
      crc = crc32OfU32(crc, soc.tech[c * 12 + t] ?? 0);
      crc = crc32OfU32(crc, soc.techProgress[c * 12 + t] ?? 0);
    }
    for (let o = 0; o < CIV_STRIDE; o++) {
      crc = crc32OfU32(crc, u8(soc.relation[c * CIV_STRIDE + o] ?? 0));
      crc = crc32OfU32(crc, soc.grievance[c * CIV_STRIDE + o] ?? 0);
    }
  }

  // --- climate and all bounded structures
  for (let r = 0; r < 16; r++) {
    crc = crc32OfU32(crc, soc.regionPrecip[r] ?? 0);
    crc = crc32OfU32(crc, soc.regionDroughtMonths[r] ?? 0);
    crc = crc32OfU32(crc, u8(soc.regionTempAnomaly[r] ?? 0));
  }

  crc = crc32OfU32(crc, soc.routeCount);
  for (let i = 0; i < soc.routeCount; i++) {
    crc = crc32OfU32(crc, soc.routeA[i] ?? 0);
    crc = crc32OfU32(crc, soc.routeB[i] ?? 0);
    crc = crc32OfU32(crc, soc.routeCapacity[i] ?? 0);
    crc = crc32OfU32(crc, soc.routeLength[i] ?? 0);
    crc = crc32OfU32(crc, soc.routeTariff[i] ?? 0);
    crc = crc32OfU32(crc, soc.routeCreated[i] ?? 0);
    crc = crc32OfU32(crc, soc.routeVolume[i] ?? 0);
    crc = crc32OfU32(crc, soc.routeIdle[i] ?? 0);
  }

  crc = crc32OfU32(crc, soc.treatyCount);
  for (let i = 0; i < soc.treatyCount; i++) {
    crc = crc32OfU32(crc, soc.treatyA[i] ?? 0);
    crc = crc32OfU32(crc, soc.treatyB[i] ?? 0);
    crc = crc32OfU32(crc, soc.treatyType[i] ?? 0);
    crc = crc32OfU32(crc, soc.treatyStart[i] ?? 0);
    crc = crc32OfU32(crc, soc.treatyEnd[i] ?? 0);
  }

  crc = crc32OfU32(crc, soc.warCount);
  for (let i = 0; i < soc.warCount; i++) {
    crc = crc32OfU32(crc, soc.warA[i] ?? 0);
    crc = crc32OfU32(crc, soc.warB[i] ?? 0);
    crc = crc32OfU32(crc, soc.warStart[i] ?? 0);
    crc = crc32OfU32(crc, u8(soc.warScore[i] ?? 0));
    crc = crc32OfU32(crc, soc.warExhaustA[i] ?? 0);
    crc = crc32OfU32(crc, soc.warExhaustB[i] ?? 0);
    crc = crc32OfU32(crc, soc.warBattles[i] ?? 0);
    crc = crc32OfU32(crc, soc.warCause[i] ?? 0);
    crc = crc32OfU32(crc, soc.warGateStrength[i] ?? 0);
    crc = crc32OfU32(crc, soc.warGateGrievance[i] ?? 0);
    crc = crc32OfU32(crc, soc.warGateCapacity[i] ?? 0);
    crc = crc32OfU32(crc, soc.warGateUtility[i] ?? 0);
  }

  // every persisted history row, oldest -> newest, so a dropped or reordered row is visible
  crc = crc32OfU32(crc, soc.eventCount);
  crc = crc32OfU32(crc, soc.nextEventId);
  for (let n = 0; n < soc.eventCount; n++) {
    const i = (soc.eventHead - soc.eventCount + n + soc.eventId.length * 2) % soc.eventId.length;
    crc = crc32OfU32(crc, soc.eventId[i] ?? 0);
    crc = crc32OfU32(crc, soc.eventDay[i] ?? 0);
    crc = crc32OfU32(crc, soc.eventType[i] ?? 0);
    crc = crc32OfU32(crc, soc.eventSeverity[i] ?? 0);
    crc = crc32OfU32(crc, soc.eventPlace[i] ?? 0);
    crc = crc32OfU32(crc, soc.eventActorA[i] ?? 0);
    crc = crc32OfU32(crc, soc.eventActorB[i] ?? 0);
    crc = crc32OfU32(crc, soc.eventMagnitude[i] ?? 0);
    crc = crc32OfU32(crc, soc.eventCause[i] ?? 0);
  }

  crc = crc32OfU32(crc, soc.vital.count);
  for (let n = 0; n < soc.vital.count; n++) {
    const i = (soc.vital.head - soc.vital.count + n + soc.vital.id.length * 2) % soc.vital.id.length;
    crc = crc32OfU32(crc, soc.vital.id[i] ?? 0);
    crc = crc32OfU32(crc, soc.vital.day[i] ?? 0);
    crc = crc32OfU32(crc, soc.vital.type[i] ?? 0);
    crc = crc32OfU32(crc, soc.vital.severity[i] ?? 0);
    crc = crc32OfU32(crc, soc.vital.place[i] ?? 0);
    crc = crc32OfU32(crc, soc.vital.actorA[i] ?? 0);
    crc = crc32OfU32(crc, soc.vital.actorB[i] ?? 0);
    crc = crc32OfU32(crc, soc.vital.magnitude[i] ?? 0);
    crc = crc32OfU32(crc, soc.vital.cause[i] ?? 0);
  }

  crc = crc32OfU32(crc, soc.decisionCount);
  for (let n = 0; n < soc.decisionCount; n++) {
    const i = (soc.decisionHead - soc.decisionCount + n + soc.decisionDay.length * 2) % soc.decisionDay.length;
    crc = crc32OfU32(crc, soc.decisionDay[i] ?? 0);
    crc = crc32OfU32(crc, soc.decisionKind[i] ?? 0);
    crc = crc32OfU32(crc, soc.decisionActor[i] ?? 0);
    crc = crc32OfU32(crc, soc.decisionChosen[i] ?? 0);
    crc = crc32OfU32(crc, soc.decisionScore[i] ?? 0);
  }

  crc = crc32OfU32(crc, soc.chronicleCount);
  for (let n = 0; n < soc.chronicleCount; n++) {
    const i = (soc.chronicleHead - soc.chronicleCount + n + 8192) % 4096;
    crc = crc32OfU32(crc, soc.chronicleYear[i] ?? 0);
    crc = crc32OfU32(crc, soc.chronicleCiv[i] ?? 0);
    crc = crc32OfU32(crc, soc.chroniclePop[i] ?? 0);
    crc = crc32OfU32(crc, soc.chronicleSettlements[i] ?? 0);
    crc = crc32OfU32(crc, soc.chronicleEvents[i] ?? 0);
  }

  const c = state.civs;
  crc = crc32OfU32(crc, c.count);
  for (let i = 0; i < c.count; i++) {
    crc = crc32OfU32(crc, c.capital[i] ?? 0);
    crc = crc32OfU32(crc, c.colorIdx[i] ?? 0);
    crc = crc32OfU32(crc, c.nameIdx[i] ?? 0);
  }
  return crc >>> 0;
}

/** Cheap structural validation used by tests and the audit phase. */
export function validateWorld(state: WorldState): string[] {
  const errors: string[] = [];
  const n = state.width * state.height;
  for (const key of GRID_KEYS) {
    if (state.grids[key].length !== n) errors.push(`grid ${key} length ${state.grids[key].length} != ${n}`);
  }
  const s = state.settlements;
  if (s.count > s.x.length) errors.push('settlement count exceeds capacity');
  for (let i = 0; i < s.count; i++) {
    const x = s.x[i] ?? 0;
    const y = s.y[i] ?? 0;
    if (x >= state.width || y >= state.height) errors.push(`settlement ${i} outside world`);
    if ((s.pop[i] ?? 0) <= 0) errors.push(`settlement ${i} has non-positive population`);
    if ((s.civ[i] ?? 0) >= Math.max(1, state.civs.count)) errors.push(`settlement ${i} references a missing civ`);
  }
  if (state.civs.count > state.civs.capital.length) errors.push('civ count exceeds capacity');
  if (state.day < 1) errors.push('day must be >= 1');
  if (state.rngStates.length === 0) errors.push('no RNG state captured');
  for (const st of state.rngStates) {
    if ((st.s0 | st.s1 | st.s2 | st.s3) === 0) errors.push('all-zero RNG state');
  }
  return errors;
}
