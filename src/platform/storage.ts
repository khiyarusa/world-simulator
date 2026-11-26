/**
 * Minimal IndexedDB access layer (docs/SAVE_AND_DATA_MODEL.md §3).
 *
 * ~150 lines instead of a dependency: three stores, explicit transactions, binary payloads.
 * The one rule that matters: a save writes its shards and its metadata inside a single
 * transaction, so a crash can never leave a half-written world behind.
 */
import { SimError } from '../core/errors.ts';

export const DB_NAME = 'world-simulator';
export const DB_VERSION = 1;

export interface WorldDoc {
  id: string;
  name: string;
  schemaVersion: number;
  seedText: string;
  preset: string;
  day: number;
  createdAt: number;
  updatedAt: number;
  checksum: string;
  bytes: number;
  currentGen: number;
  prevGen: number;
  counts: { settlements: number; civs: number; population: number };
  /** Real render captured when the world was last saved (data URL); optional for old saves. */
  thumbnail?: string;
}

export interface StoredShard {
  worldId: string;
  gen: number;
  name: string;
  crc32: number;
  compressed: boolean;
  bytes: number;
  payload: ArrayBuffer;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class WorldDb {
  private db: IDBDatabase | null = null;

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (typeof indexedDB === 'undefined') {
      throw new SimError('QUOTA', 'IndexedDB is unavailable in this environment');
    }
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('shards')) {
          db.createObjectStore('shards', { keyPath: ['worldId', 'gen', 'name'] });
        }
        if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new SimError('QUOTA', 'IndexedDB open failed'));
      req.onblocked = () => reject(new SimError('QUOTA', 'IndexedDB upgrade blocked by another tab'));
    });
    return this.db;
  }

  /** Persist metadata + shards for one generation. Atomic across both stores. */
  async commitGeneration(doc: WorldDoc, gen: number, shards: readonly Omit<StoredShard, 'worldId' | 'gen'>[]): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['worlds', 'shards'], 'readwrite');
    const worlds = tx.objectStore('worlds');
    const shardsStore = tx.objectStore('shards');

    for (const shard of shards) {
      shardsStore.put({
        worldId: doc.id,
        gen,
        name: shard.name,
        crc32: shard.crc32,
        compressed: shard.compressed,
        bytes: shard.bytes,
        payload: shard.payload,
      } satisfies StoredShard);
    }
    worlds.put({ ...doc, currentGen: gen, updatedAt: Date.now() });
    await done(tx);
  }

  /** Metadata-only update (used when a recovered generation becomes current, D-38). */
  async putWorld(doc: WorldDoc): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(doc);
    await done(tx);
  }

  /**
   * Make `gen` the only generation for a world and point the metadata at it, in one transaction.
   * Used after recovering from a damaged newer generation: leaving the damaged one on disk would
   * let the next save promote it to "previous", which is exactly the trap D-38 exists to close.
   */
  async resetToGeneration(doc: WorldDoc, gen: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['worlds', 'shards'], 'readwrite');
    const shards = tx.objectStore('shards');
    shards.delete(IDBKeyRange.bound([doc.id, 0, ''], [doc.id, gen - 1, '\uffff']));
    shards.delete(IDBKeyRange.bound([doc.id, gen + 1, ''], [doc.id, Number.MAX_SAFE_INTEGER, '\uffff']));
    tx.objectStore('worlds').put({ ...doc, currentGen: gen, prevGen: 0, updatedAt: Date.now() });
    await done(tx);
  }

  async getWorld(id: string): Promise<WorldDoc | null> {
    const db = await this.open();
    const tx = db.transaction('worlds', 'readonly');
    const doc = await request<WorldDoc | undefined>(tx.objectStore('worlds').get(id));
    await done(tx);
    return doc ?? null;
  }

  async listWorlds(): Promise<WorldDoc[]> {
    const db = await this.open();
    const tx = db.transaction('worlds', 'readonly');
    const docs = await request<WorldDoc[]>(tx.objectStore('worlds').getAll());
    await done(tx);
    return docs;
  }

  async readGeneration(worldId: string, gen: number): Promise<StoredShard[]> {
    const db = await this.open();
    const tx = db.transaction('shards', 'readonly');
    const range = IDBKeyRange.bound([worldId, gen, ''], [worldId, gen, '\uffff']);
    const rows = await request<StoredShard[]>(tx.objectStore('shards').getAll(range));
    await done(tx);
    return rows;
  }

  /** Remove every generation older than `keepGen` (and never the current one). */
  async pruneGenerations(worldId: string, keepGen: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('shards', 'readwrite');
    const store = tx.objectStore('shards');
    const range = IDBKeyRange.bound([worldId, 0, ''], [worldId, Math.max(0, keepGen - 1), '\uffff']);
    store.delete(range);
    await done(tx);
  }

  async deleteWorld(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['worlds', 'shards'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    tx.objectStore('shards').delete(IDBKeyRange.bound([id, 0, ''], [id, Number.MAX_SAFE_INTEGER, '\uffff']));
    await done(tx);
  }

  async getPref<T>(key: string): Promise<T | null> {
    const db = await this.open();
    const tx = db.transaction('prefs', 'readonly');
    const row = await request<{ key: string; value: T } | undefined>(tx.objectStore('prefs').get(key));
    await done(tx);
    return row ? row.value : null;
  }

  async setPref(key: string, value: unknown): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('prefs', 'readwrite');
    tx.objectStore('prefs').put({ key, value });
    await done(tx);
  }
}
