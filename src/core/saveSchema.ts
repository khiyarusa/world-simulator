/**
 * Save schema version. One source of truth, shared by the worker serialiser and the storage layer
 * (docs/SAVE_AND_DATA_MODEL.md §7).
 */
export const SAVE_SCHEMA_VERSION = 1;

/** Oldest schema this build can still migrate from. */
export const MIN_SUPPORTED_SCHEMA = 1;
