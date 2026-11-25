/**
 * Spawn site selection (docs/WORLD_GENERATION.md §5). Deterministic greedy placement with a
 * minimum spacing, scored from real terrain data: habitability, fertility, water, flatness.
 */
import { cellHash } from '../../core/rng.ts';
import { STREAM } from '../../core/rng.ts';
import type { Seed } from '../../core/seed.ts';
import { BIOME, BIOME_FERTILITY, BIOME_HABITABILITY, isWaterBiome } from './biomes.ts';

export interface SpawnSite {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

/** Multi-source BFS distance (in tiles) to the nearest water cell, capped at 255. */
export function computeWaterDistance(
  elevation: Int16Array,
  width: number,
  height: number,
  seaLevel: number,
  biome?: Uint8Array,
): Uint8Array {
  const n = width * height;
  const dist = new Uint8Array(n).fill(255);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (elevation[i]! < seaLevel || (biome !== undefined && isWaterBiome(biome[i]!))) {
      dist[i] = 0;
      queue[tail] = i;
      tail++;
    }
  }
  while (head < tail) {
    const i = queue[head]!;
    head++;
    const d = dist[i]!;
    if (d >= 200) continue;
    const x = i % width;
    const y = (i / width) | 0;
    const next = d + 1;
    if (x > 0 && dist[i - 1]! > next) {
      dist[i - 1] = next;
      queue[tail] = i - 1;
      tail++;
    }
    if (x < width - 1 && dist[i + 1]! > next) {
      dist[i + 1] = next;
      queue[tail] = i + 1;
      tail++;
    }
    if (y > 0 && dist[i - width]! > next) {
      dist[i - width] = next;
      queue[tail] = i - width;
      tail++;
    }
    if (y < height - 1 && dist[i + width]! > next) {
      dist[i + width] = next;
      queue[tail] = i + width;
      tail++;
    }
  }
  return dist;
}

export function localSlope(elevation: Int16Array, width: number, height: number, x: number, y: number): number {
  const here = elevation[y * width + x]!;
  let maxDiff = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const diff = Math.abs(elevation[ny * width + nx]! - here);
      if (diff > maxDiff) maxDiff = diff;
    }
  }
  return Math.floor(maxDiff / 20);
}

export interface SpawnInput {
  readonly elevation: Int16Array;
  readonly biome: Uint8Array;
  readonly riverId: Uint16Array;
  readonly waterDistance: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly count: number;
  readonly seed: Seed;
}

export function findSpawnSites(input: SpawnInput): SpawnSite[] {
  const { elevation, biome, riverId, waterDistance, width, height, seaLevel, count, seed } = input;
  const candidates: SpawnSite[] = [];

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const b = biome[i]!;
      if (isWaterBiome(b) || b === BIOME.GLACIER || b === BIOME.SNOW) continue;
      if (elevation[i]! < seaLevel + 10) continue;
      const d = waterDistance[i]!;
      if (d > 8) continue;
      const slope = localSlope(elevation, width, height, x, y);
      if (slope > 5) continue;

      const habitability = BIOME_HABITABILITY[b] ?? 0;
      const fertility = BIOME_FERTILITY[b] ?? 0;
      const water = d <= 1 ? 1000 : d === 2 ? 900 : d === 3 ? 760 : d === 4 ? 620 : d === 5 ? 480 : 340;
      const flat = Math.max(0, 1000 - slope * 260);
      const riverBonus = riverId[i]! > 0 ? 120 : 0;
      const jitter = cellHash(seed.lo, seed.hi, STREAM.SPAWN, x, y) % 40;

      const score =
        Math.round(
          habitability * 0.34 + fertility * 2.0 * 0.3 + water * 0.2 + flat * 0.16 + riverBonus,
        ) + jitter;
      candidates.push({ x, y, score });
    }
  }

  // Stable ordering: score desc, then index asc (the comparator is a total order).
  candidates.sort((a, b) => (b.score - a.score) || (a.y - b.y) || (a.x - b.x));

  const baseSpacing = Math.max(6, Math.floor(width / (count + 2)));
  for (const factor of [1, 0.75, 0.55, 0.4]) {
    const spacing = Math.max(3, Math.floor(baseSpacing * factor));
    const chosen: SpawnSite[] = [];
    for (const c of candidates) {
      if (chosen.length >= count) break;
      let ok = true;
      for (const s of chosen) {
        if (Math.abs(s.x - c.x) + Math.abs(s.y - c.y) < spacing) {
          ok = false;
          break;
        }
      }
      if (ok) chosen.push(c);
    }
    if (chosen.length >= count) return chosen;
  }

  // Last resort: take the best candidates regardless of spacing, still deterministic.
  return candidates.slice(0, count);
}
