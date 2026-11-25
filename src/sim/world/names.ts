/**
 * Deterministic name generation. Names are not stored: the renderer and the UI derive the
 * same string from (seed, kind, index) so a save only needs the index.
 */
import { cellHash } from '../../core/rng.ts';
import type { Seed } from '../../core/seed.ts';
import { STREAM } from '../../core/rng.ts';

const SETTLEMENT_HEAD = [
  'Oak', 'Ash', 'Raven', 'Stone', 'Fen', 'Bram', 'Mere', 'Thorn', 'Wold', 'Elder',
  'Grey', 'Har', 'Kel', 'Mor', 'Dun', 'Lin', 'Vale', 'Brack', 'Cald', 'Wyn',
] as const;
const SETTLEMENT_TAIL = [
  'ford', 'hold', 'wick', 'mere', 'stead', 'bury', 'gate', 'hollow', 'moor', 'reach',
  'cross', 'field', 'haven', 'watch', 'rest', 'cliff', 'marsh', 'well', 'wood', 'crest',
] as const;
const CIV_HEAD = [
  'Ar', 'Bel', 'Cor', 'Dra', 'Eld', 'Fen', 'Gal', 'Hal', 'Ith', 'Jor',
  'Kel', 'Lor', 'Mar', 'Nor', 'Oss', 'Pyr', 'Quel', 'Rav', 'Sel', 'Tor',
] as const;
const CIV_TAIL = [
  'anor', 'eth', 'ium', 'oria', 'ash', 'heim', 'land', 'mark', 'gard', 'vale',
  'dor', 'mere', 'wyn', 'thas', 'ric', 'mont', 'sea', 'fall', 'crest', 'reach',
] as const;

function pick(seed: Seed, stream: number, index: number, salt: number, table: readonly string[]): string {
  const h = cellHash(seed.lo, seed.hi, stream, index, salt);
  return table[h % table.length] ?? table[0] ?? '';
}

export function settlementName(seed: Seed, index: number): string {
  const head = pick(seed, STREAM.EVENTS, index, 11, SETTLEMENT_HEAD);
  const tail = pick(seed, STREAM.EVENTS, index, 23, SETTLEMENT_TAIL);
  return `${head}${tail}`;
}

export function civName(seed: Seed, index: number): string {
  const head = pick(seed, STREAM.EVENTS, index, 31, CIV_HEAD);
  const tail = pick(seed, STREAM.EVENTS, index, 47, CIV_TAIL);
  return `${head}${tail}`;
}
