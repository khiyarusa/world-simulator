/** Name derivation shared by every query. */
import type { WorldState } from '../sim/state/worldState.ts';
import { civName, settlementName } from '../sim/world/names.ts';
import { BIOME_NAMES } from '../sim/world/biomes.ts';

// ------------------------------------------------------------------ names

export function settlementNameOf(world: WorldState, id: number): string {
  if (id < 0 || id >= world.settlements.count) return '—';
  return settlementName(world.recipe.seed, world.settlements.nameIdx[id] ?? id);
}

export function civNameOf(world: WorldState, id: number): string {
  if (id < 0 || id >= world.civs.count) return '—';
  return civName(world.recipe.seed, world.civs.nameIdx[id] ?? id);
}

export function biomeNameOf(biome: number): string {
  return BIOME_NAMES[biome] ?? 'Unknown';
}
