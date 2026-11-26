/** Small shared measurements for the balance harness (kept separate to respect the file budget). */
import { populationOf } from '../src/sim/society/state.ts';
import type { WorldState } from '../src/sim/state/worldState.ts';

export function pick(seedLo: number): number {
  return (seedLo * 2654435761 + 0x9e3779b9) >>> 0;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

export function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function heapMb(): number {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') return 0;
  return Math.round(process.memoryUsage().heapUsed / 1048576);
}

export function gridSum(world: WorldState, key: 'vegetation' | 'fertility'): number {
  let sum = 0;
  const grid = world.grids[key];
  for (let i = 0; i < grid.length; i++) sum += grid[i] ?? 0;
  return sum;
}

export function avgOf(values: Uint8Array, count: number): number {
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += values[i] ?? 0;
  return Math.floor(sum / count);
}

/** Food reserve in days across every living settlement. */
export function foodDays(world: WorldState): number {
  let pop = 0;
  let food = 0;
  for (let i = 0; i < world.settlements.count; i++) {
    if (((world.society.flags[i] ?? 0) & 1) !== 0) continue;
    pop += populationOf(world.society, i);
    food += world.society.stock[i * 6] ?? 0;
  }
  return pop > 0 ? Math.floor(food / pop) : 0;
}
