/**
 * Deterministic RNG: xoshiro128** seeded through splitmix32.
 *
 * Contract (docs/WORLD_GENERATION.md §2):
 *  - 32-bit integer arithmetic only, no BigInt, no Math.random.
 *  - One stream per consumer; adding a consumer must not shift another stream's sequence.
 *  - State is snapshot-able so a loaded world continues exactly where it stopped.
 */

export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

export const rotl32 = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** 32-bit finalizer used by seed expansion and per-cell hashing. */
export function mix32(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** splitmix32 step. Mutates the cursor and returns the next 32-bit word. */
export function splitmix32(cursor: { v: number }): number {
  cursor.v = (cursor.v + 0x9e3779b9) >>> 0;
  let z = cursor.v;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

/** Named streams. Values are frozen by docs/WORLD_GENERATION.md §2.2. */
export const STREAM = {
  TERRAIN: 0x01,
  MOISTURE: 0x02,
  TEMP: 0x03,
  RIVERS: 0x04,
  RESOURCES: 0x05,
  SPAWN: 0x06,
  CLIMATE: 0x10,
  FIRE: 0x11,
  EPIDEMIC: 0x12,
  DECISION: 0x20,
  EVENTS: 0x21,
  MIGRATION: 0x22,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

/** Canonical, ordered list used for persistence. Never reorder. */
export const STREAM_IDS: readonly StreamId[] = [
  STREAM.TERRAIN,
  STREAM.MOISTURE,
  STREAM.TEMP,
  STREAM.RIVERS,
  STREAM.RESOURCES,
  STREAM.SPAWN,
  STREAM.CLIMATE,
  STREAM.FIRE,
  STREAM.EPIDEMIC,
  STREAM.DECISION,
  STREAM.EVENTS,
  STREAM.MIGRATION,
];

export const STREAM_NAMES: Readonly<Record<StreamId, string>> = {
  [STREAM.TERRAIN]: 'terrain',
  [STREAM.MOISTURE]: 'moisture',
  [STREAM.TEMP]: 'temp',
  [STREAM.RIVERS]: 'rivers',
  [STREAM.RESOURCES]: 'resources',
  [STREAM.SPAWN]: 'spawn',
  [STREAM.CLIMATE]: 'climate',
  [STREAM.FIRE]: 'fire',
  [STREAM.EPIDEMIC]: 'epidemic',
  [STREAM.DECISION]: 'decision',
  [STREAM.EVENTS]: 'events',
  [STREAM.MIGRATION]: 'migration',
};

export function seedState(seedLo: number, seedHi: number, stream: number): RngState {
  const cursor = { v: mix32((seedLo ^ Math.imul(stream, 0x27d4eb2f)) >>> 0, (seedHi + stream) >>> 0) };
  let s0 = splitmix32(cursor);
  const s1 = splitmix32(cursor);
  const s2 = splitmix32(cursor);
  const s3 = splitmix32(cursor);
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
  return { s0, s1, s2, s3 };
}

/**
 * The generator. Mutable for speed; consumers must not share an instance across systems
 * unless they share the stream by design.
 */
export class Rng {
  s0: number;
  s1: number;
  s2: number;
  s3: number;

  constructor(state: RngState) {
    if ((state.s0 | state.s1 | state.s2 | state.s3) === 0) {
      throw new Error('Rng: refusing an all-zero state');
    }
    this.s0 = state.s0 >>> 0;
    this.s1 = state.s1 >>> 0;
    this.s2 = state.s2 >>> 0;
    this.s3 = state.s3 >>> 0;
  }

  static forStream(seedLo: number, seedHi: number, stream: StreamId | number): Rng {
    return new Rng(seedState(seedLo, seedHi, stream));
  }

  /** Raw 32-bit output. */
  next(): number {
    const s1 = this.s1;
    const result = Math.imul(rotl32(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl32(this.s3, 11);
    return result;
  }

  /** Uniform integer in [0, maxExclusive) without modulo bias. */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x7fffffff) {
      throw new RangeError(`Rng.int: bad bound ${maxExclusive}`);
    }
    const limit = 0x100000000 - (0x100000000 % maxExclusive);
    for (let i = 0; i < 64; i++) {
      const x = this.next();
      if (x < limit) return x % maxExclusive;
    }
    return this.next() % maxExclusive;
  }

  /** Uniform integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    if (max < min) throw new RangeError('Rng.range: max < min');
    return min + this.int(max - min + 1);
  }

  /** Float in [0, 1) with 24 bits of precision. */
  float(): number {
    return (this.next() >>> 8) / 0x1000000;
  }

  /** True with probability perMille/1000. */
  chance(perMille: number): boolean {
    return this.int(1000) < perMille;
  }

  get state(): RngState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }

  restore(state: RngState): void {
    this.s0 = state.s0 >>> 0;
    this.s1 = state.s1 >>> 0;
    this.s2 = state.s2 >>> 0;
    this.s3 = state.s3 >>> 0;
  }
}

/** Stateless per-cell hash: result never depends on iteration order. */
export function cellHash(seedLo: number, seedHi: number, stream: number, x: number, y: number): number {
  return mix32(mix32(x | 0, y | 0) ^ seedLo, (stream ^ seedHi) >>> 0);
}

/** Derive a child stream value from a parent, so new streams never disturb old ones. */
export function deriveStream(parent: number, index: number): number {
  return mix32(parent, index) & 0xff;
}

/** Persisted state for every stream, in STREAM_IDS order. */
export function createStreamStates(seedLo: number, seedHi: number): RngState[] {
  return STREAM_IDS.map((id) => seedState(seedLo, seedHi, id));
}
