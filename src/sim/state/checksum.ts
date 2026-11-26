import { crc32, crc32OfU32 } from '../../core/crc32.ts';
import { GRID_KEYS } from './worldState.ts';
import { presetIdOf } from '../world/presets.ts';
import type { WorldState } from './worldState.ts';

/**
 * Integrity contract for a world (D-34).
 *
 * Contract version 2 adds the recipe identity and the RNG stream states: two worlds that differ only
 * in `water` or in where their random streams stand are *not* the same world, and a checksum that
 * cannot see that difference cannot detect the corruption it exists to detect.
 *
 * Field order is frozen. Everything hashed here is deterministic persisted state; nothing here is
 * transient (no render, camera, UI, timing or report data).
 */
export const CHECKSUM_CONTRACT_VERSION = 4;

const CHECKSUM_DOMAIN = 0x43534d34; // "CSM4"

function bytesOf(view: Int16Array | Int8Array | Uint8Array | Uint16Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

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
 * Full world checksum: grids + clock + entity stores + recipe identity + RNG states.
 * Called on save and by determinism tests, never per tick.
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
  crc = crc32OfU32(crc, state.counters.settlementsFounded);
  crc = crc32OfU32(crc, state.counters.ticks);
  crc = crc32OfU32(crc, state.counters.droppedTicks);

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

  // --- Stage 3 society: cohorts, stocks, social state and the event tail
  const soc = state.society;
  crc = crc32OfU32(crc, soc.eventCount);
  crc = crc32OfU32(crc, soc.nextEventId);
  for (let i = 0; i < state.settlements.count; i++) {
    let pop = 0;
    for (let k = 0; k < 8; k++) pop += soc.cohorts[i * 8 + k] ?? 0;
    crc = crc32OfU32(crc, pop);
    crc = crc32OfU32(crc, soc.health[i] ?? 0);
    crc = crc32OfU32(crc, soc.stability[i] ?? 0);
    crc = crc32OfU32(crc, soc.treasury[i] ?? 0);
    crc = crc32OfU32(crc, soc.infra[i] ?? 0);
    crc = crc32OfU32(crc, soc.flags[i] ?? 0);
    crc = crc32OfU32(crc, soc.literacy[i] ?? 0);
    for (let r = 0; r < 6; r++) {
      crc = crc32OfU32(crc, soc.stock[i * 6 + r] ?? 0);
      crc = crc32OfU32(crc, soc.cap[i * 6 + r] ?? 0);
      crc = crc32OfU32(crc, soc.carry[i * 6 + r] ?? 0);
    }
    for (let k = 0; k < 5; k++) crc = crc32OfU32(crc, soc.occShare[i * 5 + k] ?? 0);
  }

  for (let c = 0; c < state.civs.count; c++) {
    crc = crc32OfU32(crc, soc.legitimacy[c] ?? 0);
    for (let a = 0; a < 3; a++) crc = crc32OfU32(crc, (soc.culture[c * 3 + a] ?? 0) & 0xff);
    for (let t = 0; t < 12; t++) crc = crc32OfU32(crc, soc.tech[c * 12 + t] ?? 0);
    for (let o = 0; o < state.civs.count; o++) {
      crc = crc32OfU32(crc, (soc.relation[c * state.civs.count + o] ?? 0) & 0xff);
    }
  }

  for (let r = 0; r < 16; r++) {
    crc = crc32OfU32(crc, soc.regionPrecip[r] ?? 0);
    crc = crc32OfU32(crc, soc.regionDroughtMonths[r] ?? 0);
    crc = crc32OfU32(crc, (soc.regionTempAnomaly[r] ?? 0) & 0xff);
  }
  crc = crc32OfU32(crc, soc.decisionCount);
  crc = crc32OfU32(crc, soc.chronicleCount);
  // the event ring's head entry is enough to detect a dropped or reordered history
  if (soc.eventCount > 0) {
    const head = (soc.eventHead - 1 + soc.eventId.length) % soc.eventId.length;
    crc = crc32OfU32(crc, soc.eventId[head] ?? 0);
    crc = crc32OfU32(crc, soc.eventDay[head] ?? 0);
    crc = crc32OfU32(crc, soc.eventType[head] ?? 0);
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
