/**
 * Save schema migrations (docs/SAVE_AND_DATA_MODEL.md §7).
 *
 * Migrations are pure document transforms applied in order, never deleted. Schema 1 is the first
 * shipped shape, so the table is currently empty — that is a fact, not a placeholder.
 */
import { MIN_SUPPORTED_SCHEMA, SAVE_SCHEMA_VERSION } from '../core/saveSchema.ts';
import { SimError } from '../core/errors.ts';
import type { WorldDoc } from './storage.ts';

export type Migration = (doc: WorldDoc) => WorldDoc;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 1 -> 2 goes here when the persisted shape changes.
};

export function migrateDoc(doc: WorldDoc): WorldDoc {
  if (doc.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SimError('SAVE_SCHEMA_NEWER', `save schema ${doc.schemaVersion}`);
  }
  if (doc.schemaVersion < MIN_SUPPORTED_SCHEMA) {
    throw new SimError('UNSUPPORTED_VERSION', `save schema ${doc.schemaVersion} is too old`);
  }
  let current = doc;
  while (current.schemaVersion < SAVE_SCHEMA_VERSION) {
    const migration = MIGRATIONS[current.schemaVersion];
    if (!migration) {
      throw new SimError('UNSUPPORTED_VERSION', `no migration from schema ${current.schemaVersion}`);
    }
    current = migration(current);
    current = { ...current, schemaVersion: current.schemaVersion + 1 };
  }
  return current;
}
