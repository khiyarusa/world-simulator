/**
 * Worker protocol (docs/TECHNICAL_ARCHITECTURE.md §5).
 *
 * Discriminated by `t`. Typed arrays are transferred, never cloned, and the main thread
 * returns them through `release` so the worker can reuse its pooled buffers.
 */
import type { GenerationReport, WorldRecipe } from '../sim/state/worldState.ts';
import type { TerrainArrays } from '../core/gridTypes.ts';

export type Speed = 0 | 1 | 2 | 4 | 8;
export const SPEEDS: readonly Speed[] = [0, 1, 2, 4, 8];

export const DAY_MS = 400;
export const MAX_TICKS_PER_PASS = 4;
export const MAX_BACKLOG = 30;
export const MAX_DELTA_HZ = 4;

export interface MirrorDelta {
  seq: number;
  day: number;
  count: number;
  id: Uint16Array;
  pop: Int32Array;
  civ: Uint8Array;
  tier: Uint8Array;
  /** Stage 4 visual state bits: 1 ruined, 2 starving, 4 drought, 8 blight, 16 occupied, 32 prosperous, 64 declining */
  state: Uint8Array;
  /** Real infrastructure bitfield (schema 5 detail layers); never invented by the renderer. */
  infra: Uint32Array;
}

export interface SettlementLayout {
  readonly x: Uint16Array;
  readonly y: Uint16Array;
  readonly nameIdx: Uint16Array;
  readonly civ: Uint8Array;
  readonly tier: Uint8Array;
  readonly pop: Int32Array;
  readonly infra: Uint32Array;
}

export interface CivLayout {
  readonly nameIdx: Uint16Array;
  readonly colorIdx: Uint8Array;
  readonly capital: Uint16Array;
}

export interface WorldMetaMsg {
  readonly width: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly recipe: WorldRecipe;
  readonly report: GenerationReport;
  readonly day: number;
  readonly settlements: SettlementLayout;
  readonly civs: CivLayout;
  /** Stage 5: enough for the shell to show the legacy strip and the setup step without a query. */
  readonly campaign?: CampaignSummary | undefined;
}

export interface CampaignSummary {
  readonly mode: number;
  readonly legacy: number;
  readonly era: number;
  readonly targetCiv: number;
  readonly completed: boolean;
  readonly milestones: number;
}

export interface SettlementMetaMsg {
  readonly day: number;
  readonly settlements: SettlementLayout;
  readonly civs: CivLayout;
}

export interface SaveShard {
  readonly name: string;
  readonly crc32: number;
  readonly compressed: boolean;
  readonly bytes: number;
  readonly payload: ArrayBuffer;
}

export type LayerKind = 'political' | 'terrain' | 'population' | 'economy' | 'ecology' | 'history';
export type EcologyMetric = 'fertility' | 'vegetation' | 'moisture' | 'temperature';
export const LAYER_KINDS: readonly LayerKind[] = ['political', 'terrain', 'population', 'economy', 'ecology', 'history'];

export interface HistoryFilter {
  /** EVENT_TYPE ids; empty/undefined means every category */
  readonly types?: readonly number[] | undefined;
  readonly minSeverity?: number | undefined;
  readonly fromDay?: number | undefined;
  readonly toDay?: number | undefined;
  readonly place?: number | undefined;
  readonly civ?: number | undefined;
  readonly playerOnly?: boolean | undefined;
  /** free text over names and event type, matched case-insensitively in the worker */
  readonly search?: string | undefined;
}

export type QueryWhat =
  | { readonly kind: 'world' }
  | { readonly kind: 'settlement'; readonly id: number }
  | { readonly kind: 'settlements'; readonly offset?: number | undefined; readonly limit?: number | undefined }
  | { readonly kind: 'settlement-list' }
  | { readonly kind: 'civ'; readonly id: number }
  | { readonly kind: 'civs' }
  | { readonly kind: 'economy'; readonly civ?: number | undefined }
  | { readonly kind: 'ecology'; readonly settlement?: number | undefined }
  | { readonly kind: 'history'; readonly filter?: HistoryFilter | undefined; readonly offset?: number | undefined; readonly limit?: number | undefined }
  | { readonly kind: 'event'; readonly id: number }
  | { readonly kind: 'chronicle'; readonly fromYear?: number | undefined; readonly toYear?: number | undefined; readonly offset?: number | undefined; readonly limit?: number | undefined }
  | { readonly kind: 'decisions'; readonly limit?: number | undefined }
  | { readonly kind: 'layer'; readonly layer: LayerKind; readonly filter?: HistoryFilter | undefined; readonly metric?: EcologyMetric | undefined }
  | { readonly kind: 'interventions' }
  | { readonly kind: 'campaign' }
  | { readonly kind: 'debug' };

/** Structured query failure. The client rejects instead of handing `null` to a panel. */
export type QueryResponse = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly code: string; readonly message: string };

export type CampaignCommand =
  | { readonly op: 'begin'; readonly civ: number }
  | { readonly op: 'accept'; readonly id: number }
  | { readonly op: 'decline'; readonly id: number }
  | { readonly op: 'charter'; readonly civ: number; readonly kind: number; readonly replace: boolean };

export type PlayerCommand =
  | { readonly op: 'bless'; readonly settlement: number; readonly resource: number; readonly amount: number }
  | { readonly op: 'blight'; readonly settlement: number; readonly intensity: number; readonly durationDays: number }
  | { readonly op: 'fertilize'; readonly settlement: number; readonly intensity: number }
  | { readonly op: 'incite'; readonly civA: number; readonly civB: number };

export interface CommandEffect {
  readonly kind:
    | 'stock'
    | 'relation'
    | 'grievance'
    | 'fertility'
    | 'vegetation'
    | 'health'
    | 'stability'
    | 'area';
  readonly resource?: number;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

/** One settlement row, cheap enough to list every settlement. */
export interface SettlementSummary {
  readonly id: number;
  readonly name: string;
  readonly civId: number;
  readonly civName: string;
  readonly x: number;
  readonly y: number;
  readonly pop: number;
  readonly tier: number;
  readonly biome: number;
  readonly alive: boolean;
}

export interface SettlementDetail {
  readonly id: number;
  readonly name: string;
  readonly civName: string;
  readonly civId: number;
  readonly x: number;
  readonly y: number;
  readonly pop: number;
  readonly tier: number;
  readonly foundedDay: number;
  readonly biome: number;
  readonly riverId: number;
  readonly lakeId: number;
  readonly fertility: number;
  readonly resource: number;
  readonly owner: number;
  readonly alive: boolean;
  readonly health: number;
  readonly stability: number;
  readonly literacy: number;
  readonly treasury: number;
  readonly stock: readonly number[];
  readonly cap: readonly number[];
  readonly price: readonly number[];
  readonly cohorts: readonly number[];
  readonly occShare: readonly number[];
  readonly infra: number;
  readonly flags: number;
  readonly occupier: number;
  readonly surplusYears: number;
  readonly lastDroughtEvent: number;
  readonly lastFamineEvent: number;
  readonly trend: readonly number[];
  /** per-resource yearly Bless limit, computed by the same worker rule that enforces it */
  readonly blessMax: readonly number[];
  readonly civilization: {
    readonly id: number;
    readonly name: string;
    readonly capital: boolean;
    readonly legitimacy: number;
  };
}

export type Cmd =
  | { readonly t: 'init'; readonly maxSettlements: number }
  | {
      readonly t: 'create';
      readonly recipe: WorldRecipe;
      /** Stage 5: create a stewardship campaign world; absent means Free Sandbox. */
      readonly campaign?: { readonly legacy: number } | undefined;
    }
  | { readonly t: 'load'; readonly shards: readonly SaveShard[] }
  | { readonly t: 'speed'; readonly speed: Speed }
  | { readonly t: 'view'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly zoom: number }
  | { readonly t: 'select'; readonly id: number | null }
  | { readonly t: 'query'; readonly qid: number; readonly what: QueryWhat }
  | { readonly t: 'player'; readonly token: number; readonly command: PlayerCommand }
  | { readonly t: 'campaign'; readonly token: number; readonly command: CampaignCommand }
  | { readonly t: 'save'; readonly sid: number }
  | { readonly t: 'preview'; readonly token: number; readonly recipe: WorldRecipe }
  /** QA / harness only: run N days synchronously through the real pipeline. */
  | { readonly t: 'advance'; readonly days: number }
  | { readonly t: 'pause' }
  | { readonly t: 'resume' }
  | { readonly t: 'release'; readonly buffers: readonly ArrayBuffer[] }
  | { readonly t: 'dispose' };

export type WorkerMsg =
  | { readonly t: 'ready' }
  | { readonly t: 'progress'; readonly stage: string; readonly pct: number }
  | { readonly t: 'worldMeta'; readonly meta: WorldMetaMsg }
  | { readonly t: 'settlementMeta'; readonly meta: SettlementMetaMsg }
  // Sent once per created/loaded world. Structured-cloned (a one-off ~0.5 MB copy), because
  // transferring would detach the worker's own authoritative grids.
  | { readonly t: 'terrain'; readonly width: number; readonly height: number; readonly grids: TerrainArrays }
  | { readonly t: 'delta'; readonly delta: MirrorDelta }
  | { readonly t: 'stats'; readonly tickP50: number; readonly tickP95: number; readonly tickMax: number; readonly dropped: number; readonly speed: Speed; readonly day: number }
  | { readonly t: 'queryResult'; readonly qid: number; readonly response: QueryResponse }
  | {
      readonly t: 'commandResult';
      readonly token: number;
      readonly ok: boolean;
      readonly code: string;
      readonly message: string;
      readonly eventId: number;
      readonly effects: readonly CommandEffect[];
      readonly cooldownDays: number;
    }
  | {
      readonly t: 'previewResult';
      readonly token: number;
      readonly width: number;
      readonly height: number;
      readonly biome: Uint8Array;
      readonly elevation: Int16Array;
    }
  | ({ readonly t: 'saveShard' } & SaveShard)
  /**
   * The worker has serialised a coherent snapshot and the shards are on their way. This is *not*
   * durability: the main thread reports success only after the IndexedDB transaction commits (D-37).
   */
  | { readonly t: 'savePrepared'; readonly sid: number; readonly checksum: string; readonly bytes: number }
  | { readonly t: 'notify'; readonly level: 'info' | 'warn' | 'error'; readonly code: string; readonly msg: string }
  | { readonly t: 'crashed'; readonly code: string; readonly msg: string; readonly lastGoodDay: number };

/** Transfer list for a message, or undefined when nothing is transferable. */
export function transferListOf(msg: WorkerMsg): Transferable[] | undefined {
  if (msg.t === 'delta') {
    const d = msg.delta;
    return [d.id.buffer, d.pop.buffer, d.civ.buffer, d.tier.buffer, d.state.buffer, d.infra.buffer];
  }
  return undefined;
}
