/**
 * Structural validation of a generated world (docs/WORLD_GENERATION.md §8).
 *
 * A world that fails these checks may not enter the game. Kept separate from the generator so the
 * rules can be read and tested without reading the pipeline.
 */
import { CAPACITY } from '../state/worldState.ts';
import type { WorldState } from '../state/worldState.ts';

export function validateGenerated(state: WorldState): string[] {
  const issues: string[] = [];
  const { width, height, grids } = state;
  if (width * height !== grids.elevation.length) issues.push('grid size mismatch');
  if (state.settlements.count === 0) issues.push('no spawn sites');
  if (state.settlements.count > CAPACITY.settlements) issues.push('spawn count over capacity');
  if (state.civs.count !== state.settlements.count) issues.push('civ/band count mismatch');
  const requested = state.recipe.peoples;
  if (state.settlements.count < requested) issues.push(`only ${state.settlements.count}/${requested} bands placed`);
  for (let i = 0; i < width * height; i++) {
    if (!Number.isFinite(grids.elevation[i]!)) issues.push(`non-finite elevation at ${i}`);
    if ((grids.biome[i] ?? 0) > 15) issues.push(`biome out of range at ${i}`);
    if ((grids.riverId[i] ?? 0) !== 0 && (grids.elevation[i] ?? 0) < state.seaLevel) {
      issues.push(`river below sea level at ${i}`);
    }
  }
  for (let k = 0; k < state.settlements.count; k++) {
    const x = state.settlements.x[k]!;
    const y = state.settlements.y[k]!;
    const i = y * width + x;
    if ((grids.elevation[i] ?? -9999) < state.seaLevel) issues.push(`spawn ${k} in water`);
    if ((grids.lakeId[i] ?? 0) !== 0) issues.push(`spawn ${k} on a lake`);
  }
  return issues;
}
