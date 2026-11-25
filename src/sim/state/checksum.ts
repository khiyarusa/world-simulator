import { crc32, crc32OfU32 } from '../../core/crc32.ts';
import { GRID_KEYS } from './worldState.ts';
import type { WorldState } from './worldState.ts';

function bytesOf(view: Int16Array | Int8Array | Uint8Array | Uint16Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** CRC over every persisted grid, in the frozen GRID_KEYS order. */
export function gridsChecksum(state: WorldState): number {
  let crc = 0;
  for (const key of GRID_KEYS) {
    crc = crc32(bytesOf(state.grids[key]), crc);
  }
  return crc >>> 0;
}

/**
 * Full world checksum: grids + clock + entity stores + recipe identity.
 * Called on save and by determinism tests, never per tick.
 */
export function worldChecksum(state: WorldState): number {
  let crc = gridsChecksum(state);
  crc = crc32OfU32(crc, state.day);
  crc = crc32OfU32(crc, state.width);
  crc = crc32OfU32(crc, state.height);
  crc = crc32OfU32(crc, state.seaLevel >>> 0);
  crc = crc32OfU32(crc, state.recipe.seed.lo);
  crc = crc32OfU32(crc, state.recipe.seed.hi);
  crc = crc32OfU32(crc, state.recipe.generatorVersion);
  crc = crc32OfU32(crc, state.counters.settlementsFounded);
  crc = crc32OfU32(crc, state.settlements.count);

  const s = state.settlements;
  for (let i = 0; i < s.count; i++) {
    crc = crc32OfU32(crc, s.x[i] ?? 0);
    crc = crc32OfU32(crc, s.y[i] ?? 0);
    crc = crc32OfU32(crc, s.pop[i] ?? 0);
    crc = crc32OfU32(crc, s.civ[i] ?? 0);
    crc = crc32OfU32(crc, s.tier[i] ?? 0);
    crc = crc32OfU32(crc, s.nameIdx[i] ?? 0);
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
  }
  if (state.civs.count > state.civs.capital.length) errors.push('civ count exceeds capacity');
  if (state.day < 1) errors.push('day must be >= 1');
  return errors;
}
