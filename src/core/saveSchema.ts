/**
 * Save schema version. One source of truth, shared by the worker serialiser and the storage layer
 * (docs/SAVE_AND_DATA_MODEL.md §7).
 */
export const SAVE_SCHEMA_VERSION = 3;

/** Oldest schema this build can still migrate from. */
export const MIN_SUPPORTED_SCHEMA = 1;

/** Shard names of schema v1. A generation is only valid if every one of these exists. */
export const SHARD_NAMES = ['meta', 'terrain', 'settlements', 'civs'] as const;
export type ShardName = (typeof SHARD_NAMES)[number];
export const REQUIRED_SHARDS: readonly ShardName[] = SHARD_NAMES;

export function isShardName(name: string): name is ShardName {
  return (SHARD_NAMES as readonly string[]).includes(name);
}

/** Structural check of a shard set. Returns a reason, or null when complete. */
export function checkShardSet(names: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return `duplicate shard ${name}`;
    seen.add(name);
  }
  for (const name of REQUIRED_SHARDS) {
    if (!seen.has(name)) return `missing shard ${name}`;
  }
  return null;
}
