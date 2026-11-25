/**
 * Seed transport contract (ADR D-23).
 *
 * A 64-bit seed is carried as two unsigned 32-bit words. The text form is fixed width
 * hex ("A1B2C3D4-5E6F7A8B") so it survives JSON, URLs, clipboard and user typing without
 * any BigInt dependency, and round-trips exactly.
 */

export interface Seed {
  readonly lo: number;
  readonly hi: number;
}

export const SEED_TEXT_LENGTH = 17; // 8 + '-' + 8

export function seedOf(lo: number, hi: number): Seed {
  return { lo: lo >>> 0, hi: hi >>> 0 };
}

export function seedToText(seed: Seed): string {
  return `${hex8(seed.hi)}-${hex8(seed.lo)}`;
}

export function parseSeedText(text: string): Seed | null {
  const clean = text.trim().replace(/\s+/g, '').toUpperCase();
  const match = /^([0-9A-F]{8})-?([0-9A-F]{8})$/.exec(clean);
  if (!match) return null;
  const hi = Number.parseInt(match[1] ?? '', 16);
  const lo = Number.parseInt(match[2] ?? '', 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return seedOf(lo, hi);
}

export function seedEquals(a: Seed, b: Seed): boolean {
  return a.lo === b.lo && a.hi === b.hi;
}

/** Short label for UI chips. */
export function seedShort(seed: Seed): string {
  return `${hex8(seed.hi)}-${hex8(seed.lo)}`;
}

function hex8(value: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
