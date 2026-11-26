/**
 * Main-thread side of the worker protocol: one typed client, one message router.
 *
 * Owns nothing about the world; it forwards commands and hands events to the session. Buffer
 * recycling is explicit (`release`) so the worker never allocates a delta per emission.
 */
import type { CommandEffect, PlayerCommand, QueryWhat, SaveShard, Speed, WorkerMsg } from './protocol.ts';
import type { WorldMetaMsg, MirrorDelta, SettlementMetaMsg } from './protocol.ts';
import type { TerrainArrays } from '../core/gridTypes.ts';
import type { WorldRecipe } from '../sim/state/worldState.ts';

export interface TickStatsMsg {
  readonly tickP50: number;
  readonly tickP95: number;
  readonly tickMax: number;
  readonly dropped: number;
  readonly speed: Speed;
  readonly day: number;
}

export interface PreviewPayload {
  readonly token: number;
  readonly width: number;
  readonly height: number;
  readonly biome: Uint8Array;
  readonly elevation: Int16Array;
}

export interface SaveResult {
  readonly shards: SaveShard[];
  readonly checksum: string;
  readonly bytes: number;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly eventId: number;
  readonly effects: readonly CommandEffect[];
  readonly cooldownDays: number;
}

export interface ClientHandlers {
  onReady(): void;
  onProgress(stage: string, pct: number): void;
  onMeta(meta: WorldMetaMsg): void;
  onSettlementMeta(meta: SettlementMetaMsg): void;
  onTerrain(width: number, height: number, grids: TerrainArrays): void;
  onDelta(delta: MirrorDelta): void;
  onStats(stats: TickStatsMsg): void;
  onNotify(level: 'info' | 'warn' | 'error', code: string, msg: string): void;
  onCrash(code: string, msg: string, lastGoodDay: number): void;
  onPreview(payload: PreviewPayload): void;
}

export class WorkerClient {
  private readonly worker: Worker;
  private readonly handlers: ClientHandlers;
  private nextQid = 1;
  private nextToken = 1;
  private readonly pending = new Map<number, { resolve: (data: unknown) => void; reject: (e: Error) => void }>();
  private readonly pendingCommands = new Map<number, (result: CommandResult) => void>();
  private saveBuffer: SaveShard[] = [];
  private saveWaiter: { resolve: (r: SaveResult) => void; reject: (e: Error) => void } | null = null;

  constructor(handlers: ClientHandlers) {
    this.handlers = handlers;
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (ev: MessageEvent<WorkerMsg>) => this.route(ev.data));
    this.worker.addEventListener('error', (ev) => {
      this.handlers.onCrash('WORKER_CRASH', ev.message || 'worker crashed', 0);
    });
    this.worker.addEventListener('messageerror', () => {
      this.handlers.onCrash('PROTOCOL', 'worker message could not be deserialized', 0);
    });
  }

  init(): void {
    this.worker.postMessage({ t: 'init', maxSettlements: 200 });
  }

  create(recipe: WorldRecipe): void {
    this.worker.postMessage({ t: 'create', recipe });
  }

  load(shards: readonly SaveShard[]): void {
    // Shards arrive as ArrayBuffers from IndexedDB; transfer them into the worker.
    const transfer = shards.map((s) => s.payload);
    this.worker.postMessage({ t: 'load', shards }, transfer);
  }

  setSpeed(speed: Speed): void {
    this.worker.postMessage({ t: 'speed', speed });
  }

  advance(days: number): void {
    this.worker.postMessage({ t: 'advance', days });
  }

  pause(): void {
    this.worker.postMessage({ t: 'pause' });
  }

  setView(x: number, y: number, w: number, h: number, zoom: number): void {
    this.worker.postMessage({ t: 'view', x, y, w, h, zoom });
  }

  select(id: number | null): void {
    this.worker.postMessage({ t: 'select', id });
  }

  preview(recipe: WorldRecipe, token: number): void {
    this.worker.postMessage({ t: 'preview', token, recipe });
  }

  query<T>(what: QueryWhat): Promise<T> {
    const qid = this.nextQid++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(qid, { resolve: (data) => resolve(data as T), reject });
      this.worker.postMessage({ t: 'query', qid, what });
    });
  }

  /** Send a player command. The promise resolves only after the worker has applied or refused it. */
  command(command: PlayerCommand): Promise<CommandResult> {
    const token = this.nextToken++;
    return new Promise<CommandResult>((resolve) => {
      this.pendingCommands.set(token, resolve);
      this.worker.postMessage({ t: 'player', token, command });
    });
  }

  save(): Promise<SaveResult> {
    if (this.saveWaiter) return Promise.reject(new Error('a save is already in flight'));
    this.saveBuffer = [];
    const sid = Date.now() & 0x7fffffff;
    return new Promise<SaveResult>((resolve, reject) => {
      this.saveWaiter = { resolve, reject };
      this.worker.postMessage({ t: 'save', sid });
    });
  }

  dispose(): void {
    this.worker.postMessage({ t: 'dispose' });
    this.worker.terminate();
    this.pending.clear();
    this.pendingCommands.clear();
    this.saveWaiter = null;
  }

  private route(msg: WorkerMsg): void {
    switch (msg.t) {
      case 'ready':
        this.handlers.onReady();
        break;
      case 'progress':
        this.handlers.onProgress(msg.stage, msg.pct);
        break;
      case 'worldMeta':
        this.handlers.onMeta(msg.meta);
        break;
      case 'settlementMeta':
        this.handlers.onSettlementMeta(msg.meta);
        break;
      case 'terrain':
        this.handlers.onTerrain(msg.width, msg.height, msg.grids);
        break;
      case 'delta': {
        this.handlers.onDelta(msg.delta);
        // hand the buffers back so the worker can reuse them
        this.worker.postMessage({
          t: 'release',
          buffers: [
            msg.delta.id.buffer,
            msg.delta.pop.buffer,
            msg.delta.civ.buffer,
            msg.delta.tier.buffer,
            msg.delta.state.buffer,
          ],
        });
        break;
      }
      case 'stats':
        this.handlers.onStats(msg);
        break;
      case 'queryResult': {
        const waiter = this.pending.get(msg.qid);
        if (waiter) {
          this.pending.delete(msg.qid);
          if (msg.response.ok) waiter.resolve(msg.response.data);
          else waiter.reject(new Error(`${msg.response.code}: ${msg.response.message}`));
        }
        break;
      }
      case 'commandResult': {
        const waiter = this.pendingCommands.get(msg.token);
        if (waiter) {
          this.pendingCommands.delete(msg.token);
          waiter({
            ok: msg.ok,
            code: msg.code,
            message: msg.message,
            eventId: msg.eventId,
            effects: msg.effects,
            cooldownDays: msg.cooldownDays,
          });
        }
        break;
      }
      case 'saveShard':
        this.saveBuffer.push({
          name: msg.name,
          crc32: msg.crc32,
          compressed: msg.compressed,
          bytes: msg.bytes,
          payload: msg.payload,
        });
        break;
      case 'savePrepared': {
        const waiter = this.saveWaiter;
        this.saveWaiter = null;
        const shards = this.saveBuffer;
        this.saveBuffer = [];
        waiter?.resolve({ shards, checksum: msg.checksum, bytes: msg.bytes });
        break;
      }
      case 'previewResult':
        this.handlers.onPreview({
          token: msg.token,
          width: msg.width,
          height: msg.height,
          biome: msg.biome,
          elevation: msg.elevation,
        });
        break;
      case 'notify':
        this.handlers.onNotify(msg.level, msg.code, msg.msg);
        break;
      case 'crashed':
        this.handlers.onCrash(msg.code, msg.msg, msg.lastGoodDay);
        break;
      default: {
        const exhaustive: never = msg;
        void exhaustive;
      }
    }
  }
}
