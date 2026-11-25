/** Public simulation surface. Only the worker imports this; the UI never does. */
export { generateV1, validateGenerated, GENERATOR_VERSION_V1 } from './world/generate.v1.ts';
export { runDay, stageNames } from './systems/pipeline.ts';
export { worldChecksum, gridsChecksum, validateWorld } from './state/checksum.ts';
export { CAPACITY, GENERATOR_VERSION, TIER, tierOf } from './state/worldState.ts';
export type {
  CivStore,
  GenerationReport,
  Preset,
  SettlementStore,
  WorldGrids,
  WorldRecipe,
  WorldState,
} from './state/worldState.ts';
export { PRESETS, PRESET_ORDER, DEFAULT_PRESET } from './world/presets.ts';
export { BIOME, BIOME_NAMES } from './world/biomes.ts';
export { settlementName, civName } from './world/names.ts';
