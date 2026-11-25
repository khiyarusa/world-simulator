/** Integer/fixed-point helpers shared by generation and (from Stage 3) the economy. */

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const u32 = (v: number): number => v >>> 0;

export const minInt = (a: number, b: number): number => (a < b ? a : b);
export const maxInt = (a: number, b: number): number => (a > b ? a : b);

/** floor(a / b) for positive b, safe for the ranges used here. */
export function divFloor(a: number, b: number): number {
  return Math.floor(a / b);
}

/** round(a * b / c) with integer inputs; exact for |a*b| < 2^53. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c <= 0) throw new RangeError('mulDiv: non-positive divisor');
  return Math.round((a * b) / c);
}

/** Apply a per-mille factor: perMille(1000, 1500) === 1500. */
export function perMille(value: number, pm: number): number {
  return Math.round((value * pm) / 1000);
}

export function lerpInt(a: number, b: number, tPerMille: number): number {
  return a + Math.round(((b - a) * tPerMille) / 1000);
}

/** Smoothstep on 0..1000, polynomial only (no transcendental math). */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1000) / 1000;
  return Math.round(x * x * (3000 - 2000 * x));
}

/** Linear interpolation of two integers by t in 0..1000. */
export function scaleTo(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  const t = clamp(((value - inMin) * 1000) / (inMax - inMin), 0, 1000);
  return outMin + Math.round(((outMax - outMin) * t) / 1000);
}

export function isInt32(v: number): boolean {
  return Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff;
}

export function assertInt32(v: number, label: string): number {
  if (!isInt32(v)) throw new RangeError(`${label}: not an int32 (${v})`);
  return v;
}

/** Two-dimensional integer hash with a 0..1 output, used for grain and scatter. */
export function hash01(a: number, b: number, salt: number): number {
  let h = (a * 0x1f1f1f1f) ^ Math.imul(b, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}
