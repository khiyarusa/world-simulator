/**
 * Integer-hash gradient noise (docs/WORLD_GENERATION.md §4).
 *
 * No Math.sin/cos/pow/exp: gradient directions come from a fixed table, the fade curve is a
 * polynomial. That keeps results identical across JS engines, which transcendental functions
 * are not guaranteed to be.
 */
import { cellHash } from '../../core/rng.ts';
import { clamp01 } from '../../core/math.ts';

// 16 unit-ish directions, written as literals so no trigonometry runs at startup.
const GX = [
  1, -1, 0, 0, 0.70710678, -0.70710678, 0.70710678, -0.70710678, 1, -1, 1, -1, 0.92387953, -0.92387953,
  0.38268343, -0.38268343,
] as const;
const GY = [
  0, 0, 1, -1, 0.70710678, 0.70710678, -0.70710678, -0.70710678, 1, 1, -1, -1, 0.38268343, 0.38268343,
  0.92387953, -0.92387953,
] as const;

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function gradDot(hash: number, dx: number, dy: number): number {
  const i = hash & 15;
  return (GX[i] ?? 0) * dx + (GY[i] ?? 0) * dy;
}

export interface NoiseField {
  readonly seedLo: number;
  readonly seedHi: number;
  readonly stream: number;
}

/** Single-octave gradient noise, roughly -1..1. */
export function noise2(field: NoiseField, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);

  const n00 = gradDot(cellHash(field.seedLo, field.seedHi, field.stream, xi, yi), xf, yf);
  const n10 = gradDot(cellHash(field.seedLo, field.seedHi, field.stream, xi + 1, yi), xf - 1, yf);
  const n01 = gradDot(cellHash(field.seedLo, field.seedHi, field.stream, xi, yi + 1), xf, yf - 1);
  const n11 = gradDot(cellHash(field.seedLo, field.seedHi, field.stream, xi + 1, yi + 1), xf - 1, yf - 1);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.42;
}

export interface FbmOptions {
  readonly octaves?: number;
  /** Frequency multiplier per octave; 2 is the integer-friendly default. */
  readonly lacunarity?: number;
  /** Amplitude multiplier per octave, 0..1. */
  readonly gain?: number;
  readonly frequency?: number;
}

/** Fractal Brownian motion, normalised to 0..1. */
export function fbm2(field: NoiseField, x: number, y: number, opts: FbmOptions = {}): number {
  const octaves = opts.octaves ?? 5;
  const lacunarity = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  const baseFreq = opts.frequency ?? 1;

  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(field, x * freq + o * 17.31, y * freq + o * 11.17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return clamp01((sum / norm + 1) * 0.5);
}

/** Ridged multifractal, 0..1, sharp crests (mountain ranges). */
export function ridged2(field: NoiseField, x: number, y: number, opts: FbmOptions = {}): number {
  const octaves = opts.octaves ?? 4;
  const lacunarity = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  const baseFreq = opts.frequency ?? 1;

  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise2(field, x * freq + o * 7.77, y * freq + o * 5.31));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return clamp01(sum / norm);
}

/** Domain warp helper: returns a small offset derived from a second field. */
export function warp2(field: NoiseField, x: number, y: number, strength: number): { dx: number; dy: number } {
  const nx = noise2(field, x * 0.5 + 5.2, y * 0.5 + 1.3);
  const ny = noise2(field, x * 0.5 + 19.7, y * 0.5 + 11.1);
  return { dx: nx * strength, dy: ny * strength };
}
