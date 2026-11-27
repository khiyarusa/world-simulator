/**
 * Save schema migrations (docs/SAVE_AND_DATA_MODEL.md §7).
 *
 * Migrations are pure document transforms applied in order, never deleted. Each one returns a document
 * stamped with exactly the next version; the loop verifies that, so a migration cannot silently skip a
 * step (which is what the previous 1 -> 2 entry did after the loop incremented the version again).
 */
import { MIN_SUPPORTED_SCHEMA, SAVE_SCHEMA_VERSION } from '../core/saveSchema.ts';
import { SimError } from '../core/errors.ts';
import type { WorldDoc } from './storage.ts';

export type Migration = (doc: WorldDoc) => WorldDoc;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  /**
   * 1 -> 2: the document shape is unchanged; the society block was added to the *save payload*, not to
   * WorldDoc. The worker materialises it during deserialisation (exactly once, deterministically).
   * This entry exists so `migrateDoc()` does not reject a valid v1 world at startup (defect H-14).
   */
  1: (doc) => ({ ...doc, schemaVersion: 2 }),
  /**
   * 2 -> 3: trade routes, treaties, wars, military state, prices, technology progress and the
   * occupation marker are added to the save *payload*. A schema-2 world is a world that predates them,
   * so the decoder fills those structures as empty (the codec keeps accepting v2 blocks).
   */
  2: (doc) => ({ ...doc, schemaVersion: 3 }),
  /**
   * 3 -> 4: player interventions, their cooldowns and the yearly world series are added to the save
   * payload (the society block). A schema-3 world predates them, so its block decodes with empty
   * rings — the honest state of a world that never saw a player action.
   */
  3: (doc) => ({ ...doc, schemaVersion: 4 }),
  /**
   * 4 -> 5: the campaign block (mode, legacy, milestones, objectives, charters) is added to the meta
   * payload. A schema-4 world predates stewardship and decodes as Free Sandbox with empty history.
   */
  4: (doc) => ({ ...doc, schemaVersion: 5 }),
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
    const from = current.schemaVersion;
    const migration = MIGRATIONS[from];
    if (!migration) throw new SimError('UNSUPPORTED_VERSION', `no migration from schema ${from}`);
    const next = migration(current);
    if (next.schemaVersion !== from + 1) {
      throw new SimError('SAVE_CORRUPT', `migration ${from} produced schema ${next.schemaVersion}`);
    }
    current = next;
  }
  return current;
}
