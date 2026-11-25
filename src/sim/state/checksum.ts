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
export const CHECKSUM_CONTRACT_VERSION = 2;

const CHECKSUM_DOMAIN = 0x43534d32; // "CSM2"

function bytesOf(view: Int16Array | Int8Array | Uint8Array | Uint16Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** CRC over every persisted grid, in the frozen GRID_KEYS order. */
export function gridsChecksum(state: WorldState): number {
  let crc = crc32OfU32(0, CHECKSUM_DOMAIN);
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
  let crc = gridsChecksum(state);
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
