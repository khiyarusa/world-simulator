/**
 * Shared shapes of the worker query layer. Types only: no runtime imports from the UI.
 */
import type { LayerKind } from './protocol.ts';

export type EventCategory = 'war' | 'disaster' | 'migration' | 'politics' | 'economy' | 'player' | 'other';

export interface EventView {
  readonly id: number;
  readonly day: number;
  readonly year: number;
  readonly type: number;
  readonly typeName: string;
  readonly category: EventCategory;
  readonly severity: number;
  readonly place: number;
  readonly placeName: string;
  readonly placeX: number;
  readonly placeY: number;
  readonly actorA: number;
  readonly actorB: number;
  readonly actorAName: string;
  readonly actorBName: string;
  readonly magnitude: number;
  readonly cause: number;
  readonly root: 'player' | 'root' | 'event';
  readonly player: boolean;
}

export interface YearPoint {
  readonly year: number;
  readonly population: number;
  readonly settlements: number;
  readonly civs: number;
  readonly foodProduced: number;
  readonly tradeVolume: number;
  readonly treasury: number;
  readonly wars: number;
  readonly fertility: number;
  readonly drought: number;
}

export interface WorldView {
  readonly day: number;
  readonly year: number;
  readonly season: number;
  readonly seasonName: string;
  readonly monthName: string;
  readonly dayOfMonth: number;
  readonly width: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly seedText: string;
  readonly preset: string;
  readonly recipe: { water: number; harshness: number; peoples: number; generatorVersion: number };
  readonly population: number;
  readonly settlements: number;
  readonly livingSettlements: number;
  readonly ruinedSettlements: number;
  readonly civs: number;
  readonly landFraction: number;
  readonly checksum: number;
  readonly speed: number;
  readonly paused: boolean;
  readonly counters: Readonly<Record<string, number>>;
  readonly series: readonly YearPoint[];
  readonly interventions: readonly InterventionInfo[];
}

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

export interface RouteView {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly fromName: string;
  readonly toName: string;
  readonly capacity: number;
  readonly length: number;
  readonly tariff: number;
  readonly volume: number;
  readonly active: boolean;
}

export interface SettlementView {
  readonly id: number;
  readonly name: string;
  readonly civId: number;
  readonly civName: string;
  readonly x: number;
  readonly y: number;
  readonly pop: number;
  readonly tier: number;
  readonly foundedDay: number;
  readonly biome: number;
  readonly biomeName: string;
  readonly riverId: number;
  readonly lakeId: number;
  readonly region: number;
  readonly fertility: number;
  readonly vegetation: number;
  readonly moisture: number;
  readonly temperature: number;
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
  readonly cohortNames: readonly string[];
  readonly occShare: readonly number[];
  readonly infra: number;
  readonly infraNames: readonly string[];
  readonly flags: number;
  readonly occupier: number;
  readonly occupierName: string;
  readonly surplusYears: number;
  readonly lastDroughtEvent: number;
  readonly lastFamineEvent: number;
  readonly trend: readonly number[];
  readonly blessMax: readonly number[];
  readonly daysOfFood: number;
  readonly daysOfWater: number;
  readonly risks: readonly { code: string; severity: number }[];
  readonly routes: readonly RouteView[];
  readonly recentEvents: readonly EventView[];
  readonly civilization: {
    readonly id: number;
    readonly name: string;
    readonly capital: boolean;
    readonly legitimacy: number;
    readonly colorIdx: number;
  };
}

export interface CivSummary {
  readonly id: number;
  readonly name: string;
  readonly capital: number;
  readonly capitalName: string;
  readonly colorIdx: number;
  readonly population: number;
  readonly settlements: number;
  readonly legitimacy: number;
  readonly army: number;
  readonly exhaustion: number;
  readonly atWar: boolean;
}

export interface CivView extends CivSummary {
  readonly culture: readonly number[];
  readonly tech: readonly number[];
  readonly techNames: readonly string[];
  readonly techProgress: readonly number[];
  readonly treasury: number;
  readonly relations: readonly { civ: number; name: string; relation: number; grievance: number; war: boolean; treaty: string | null }[];
  readonly treaties: readonly { withCiv: number; withName: string; type: number; typeName: string; startDay: number; endDay: number }[];
  readonly wars: readonly { id: number; opponent: number; opponentName: string; startDay: number; score: number; battles: number; exhaustSelf: number; exhaustOther: number }[];
  readonly strengths: readonly string[];
  readonly weaknesses: readonly string[];
  readonly milestones: readonly EventView[];
  readonly gate: { strength: number; grievance: number; capacity: number; utility: number; pass: boolean } | null;
}

export interface EconomyView {
  readonly population: number;
  readonly treasury: number;
  readonly foodProduced: number;
  readonly foodConsumed: number;
  readonly tradeVolume: number;
  readonly taxCollected: number;
  readonly tributePaid: number;
  readonly routesOpened: number;
  readonly routesLost: number;
  readonly resources: readonly {
    id: number;
    name: string;
    stock: number;
    cap: number;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    scarcity: number;
  }[];
  readonly routes: readonly RouteView[];
  readonly shortages: readonly { settlement: number; name: string; resource: number; days: number }[];
  readonly series: readonly YearPoint[];
}

export interface EcologyView {
  readonly averageFertility: number;
  readonly averageVegetation: number;
  readonly averageMoisture: number;
  readonly averageTemperature: number;
  readonly droughtSettlements: number;
  readonly blightSettlements: number;
  readonly regions: readonly { id: number; precip: number; tempAnomaly: number; droughtMonths: number; settlements: number }[];
  readonly hazards: readonly { kind: string; settlement: number; name: string; intensity: number; endDay: number }[];
  readonly local: SettlementEcology | null;
}

export interface SettlementEcology {
  readonly settlement: number;
  readonly name: string;
  readonly fertility: number;
  readonly vegetation: number;
  readonly moisture: number;
  readonly temperature: number;
  readonly drought: boolean;
  readonly blight: boolean;
}

export interface HistoryPage {
  readonly total: number;
  readonly offset: number;
  readonly events: readonly EventView[];
  readonly counts: Readonly<Record<EventCategory, number>>;
  readonly years: { readonly first: number; readonly last: number };
}

export interface EventDetail {
  readonly event: EventView;
  readonly chain: readonly EventView[];
  readonly consequences: readonly EventView[];
  readonly root: { readonly kind: 'player' | 'root' | 'event'; readonly explanation: string };
}

export interface ChronicleEntry {
  readonly year: number;
  readonly civ: number;
  readonly civName: string;
  readonly population: number;
  readonly settlements: number;
  readonly notableEvents: number;
}

export interface ChroniclePage {
  readonly total: number;
  readonly offset: number;
  readonly entries: readonly ChronicleEntry[];
  readonly series: readonly YearPoint[];
}

export interface DecisionView {
  readonly index: number;
  readonly day: number;
  readonly year: number;
  readonly kind: number;
  readonly actor: number;
  readonly actorName: string;
  readonly chosen: number;
  readonly score: number;
  /** Utility offset contributed by an active stewardship charter (schema 5). */
  readonly bias: number;
}

export interface InterventionInfo {
  readonly kind: number;
  readonly name: string;
  readonly lastDay: number;
  readonly cooldownDays: number;
  readonly remainingDays: number;
  readonly ready: boolean;
  readonly active: readonly { a: number; b: number; label: string; startDay: number; endDay: number; intensity: number }[];
  readonly history: readonly { kind: number; a: number; b: number; label: string; startDay: number; endDay: number; intensity: number; amount: number; active: boolean }[];
}

export interface LayerPoint {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly kind: number;
  readonly label: string;
}

export interface LayerLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly kind: number;
  readonly value: number;
  readonly label: string;
}

export interface LayerArea {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly kind: number;
  readonly value: number;
  readonly label: string;
}

export interface LayerData {
  readonly layer: LayerKind;
  readonly day: number;
  readonly width: number;
  readonly height: number;
  /** per-tile primary metric (owner civ+1, fertility, vegetation, density class) */
  readonly cells: Uint8Array | null;
  /** per-tile secondary metric, or null */
  readonly cells2: Uint8Array | null;
  readonly points: readonly LayerPoint[];
  readonly lines: readonly LayerLine[];
  readonly areas: readonly LayerArea[];
  readonly meta: Readonly<Record<string, string | number>>;
}

export interface QueryContext {
  readonly day: number;
  readonly speed: number;
}
