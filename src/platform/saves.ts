/**
 * Save orchestration on the main thread (docs/SAVE_AND_DATA_MODEL.md §5–§6).
 *
 * A generation is valid only when **every** required shard exists, its CRC matches and its payload is
 * structurally sound. Recovery picks the newest valid generation, then *repoints* the metadata at it
 * and deletes the damaged newer generation, so the next save cannot promote corruption to "backup"
 * (D-38).
 */
import { crc32 } from '../core/crc32.ts';
import { SimError } from '../core/errors.ts';
import { checkShardSet, SAVE_SCHEMA_VERSION } from '../core/saveSchema.ts';
import type { SaveShard } from '../worker/protocol.ts';
import type { StoredShard, WorldDoc } from './storage.ts';

export const DEFAULT_WORLD_ID = 'world-1';

/** The slice of the database that save orchestration needs; `WorldDb` implements it, tests fake it. */
export interface WorldStore {
  getWorld(id: string): Promise<WorldDoc | null>;
  readGeneration(worldId: string, gen: number): Promise<StoredShard[]>;
  commitGeneration(doc: WorldDoc, gen: number, shards: readonly Omit<StoredShard, 'worldId' | 'gen'>[]): Promise<void>;
  pruneGenerations(worldId: string, keepGen: number): Promise<void>;
  putWorld(doc: WorldDoc): Promise<void>;
  resetToGeneration(doc: WorldDoc, gen: number): Promise<void>;
}

async function inflate(payload: ArrayBuffer, compressed: boolean): Promise<Uint8Array> {
  const bytes = new Uint8Array(payload);
  if (!compressed) return bytes;
  if (typeof DecompressionStream === 'undefined') {
    throw new SimError('UNSUPPORTED_VERSION', 'this WebView cannot decompress save shards');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A generation is loadable only if the shard set is complete, every CRC matches and the payload is
 * non-empty. CRC-validating whatever happens to exist is not validation.
 */
export async function verifyGeneration(
  shards: readonly StoredShard[],
): Promise<{ ok: boolean; reason?: string }> {
  if (shards.length === 0) return { ok: false, reason: 'no shards' };
  const setProblem = checkShardSet(shards.map((s) => s.name));
  if (setProblem) return { ok: false, reason: setProblem };
  for (const shard of shards) {
    if (shard.bytes <= 0) return { ok: false, reason: `${shard.name} is empty` };
    try {
      const raw = await inflate(shard.payload, shard.compressed);
      if (raw.byteLength !== shard.bytes) {
        return { ok: false, reason: `${shard.name} length ${raw.byteLength} != declared ${shard.bytes}` };
      }
      if (crc32(raw) !== (shard.crc32 >>> 0)) return { ok: false, reason: `crc mismatch in ${shard.name}` };
    } catch (e) {
      return { ok: false, reason: `${shard.name}: ${(e as Error).message}` };
    }
  }
  return { ok: true };
}

export interface LoadedWorld {
  readonly doc: WorldDoc;
  readonly shards: SaveShard[];
  /** true when the newest generation was damaged and an older one is now current. */
  readonly recovered: boolean;
}

/**
 * Write a new generation and make it current only after the transaction commits.
 * On any failure the previous generation stays exactly as it was.
 */
export async function saveWorld(
  db: WorldStore,
  doc: WorldDoc,
  shards: readonly SaveShard[],
  day: number,
  checksum: string,
  population: number,
): Promise<WorldDoc> {
  if (shards.length === 0) throw new SimError('SAVE_CORRUPT', 'refusing to save zero shards');
  const setProblem = checkShardSet(shards.map((s) => s.name));
  if (setProblem) throw new SimError('SAVE_CORRUPT', `incomplete snapshot: ${setProblem}`);

  const gen = doc.currentGen + 1;
  const next: WorldDoc = {
    ...doc,
    day,
    checksum,
    bytes: shards.reduce((sum, s) => sum + s.bytes, 0),
    counts: { ...doc.counts, population },
    prevGen: doc.currentGen,
    currentGen: gen,
    updatedAt: Date.now(),
  };
  await db.commitGeneration(next, gen, shards);
  // Post-commit cleanup: keep the current and the previous generation only.
  if (next.prevGen > 0) await db.pruneGenerations(doc.id, next.prevGen);
  return next;
}

export async function loadWorld(db: WorldStore, id: string): Promise<LoadedWorld | null> {
  const doc = await db.getWorld(id);
  if (!doc) return null;
  if (doc.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SimError('SAVE_SCHEMA_NEWER', `save schema ${doc.schemaVersion} is newer than ${SAVE_SCHEMA_VERSION}`);
  }

  const candidates = [doc.currentGen, doc.prevGen].filter((g) => g > 0);
  let lastReason = 'no generation recorded';
  for (const gen of candidates) {
    const rows = await db.readGeneration(id, gen);
    const check = await verifyGeneration(rows);
    if (!check.ok) {
      lastReason = check.reason ?? 'unknown';
      continue;
    }

    const recovered = gen !== doc.currentGen;
    if (recovered) {
      // The damaged generation is deleted here, not merely skipped.
      await db.resetToGeneration(doc, gen);
      const repointed: WorldDoc = { ...doc, currentGen: gen, prevGen: 0, updatedAt: Date.now() };
      return { doc: repointed, shards: rows.map(toShard), recovered: true };
    }
    return { doc, shards: rows.map(toShard), recovered: false };
  }

  throw new SimError('SAVE_CORRUPT', `all save generations are damaged (${lastReason})`);
}

function toShard(row: StoredShard): SaveShard {
  return {
    name: row.name,
    crc32: row.crc32,
    compressed: row.compressed,
    bytes: row.bytes,
    payload: row.payload,
  };
}

export function newWorldDoc(id: string, name: string, seedText: string, preset: string): WorldDoc {
  const now = Date.now();
  return {
    id,
    name,
    schemaVersion: SAVE_SCHEMA_VERSION,
    seedText,
    preset,
    day: 1,
    createdAt: now,
    updatedAt: now,
    checksum: '',
    bytes: 0,
    currentGen: 0,
    prevGen: 0,
    counts: { settlements: 0, civs: 0, population: 0 },
  };
}
