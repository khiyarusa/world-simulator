/** Serialized society block shape (schema 2..4). */
export type Numbers = number[];

export interface SocietyDoc {
  v: 2 | 3 | 4;
  cohorts: Numbers;
  occShare: Numbers;
  stock: Numbers;
  cap: Numbers;
  carry: Numbers;
  treasury: Numbers;
  health: Numbers;
  stability: Numbers;
  literacy: Numbers;
  infra: Numbers;
  flags: Numbers;
  foundedDay: Numbers;
  lastDroughtEvent: Numbers;
  lastFamineEvent: Numbers;
  price: Numbers;
  occupier: Numbers;
  surplusYears: Numbers;
  lastEpidemicDay: Numbers;
  historyDay: Numbers;
  culture: Numbers;
  tech: Numbers;
  techProgress: Numbers;
  legitimacy: Numbers;
  relation: Numbers;
  grievance: Numbers;
  army: Numbers;
  exhaustion: Numbers;
  warWins: Numbers;
  regionDroughtMonths: Numbers;
  regionPrecip: Numbers;
  regionTempAnomaly: Numbers;
  events: { count: number; nextId: number; rows: Numbers };
  vital?: { count: number; rows: Numbers };
  decisions: { count: number; rows: Numbers };
  chronicle: { count: number; rows: Numbers };
  routes: { count: number; rows: Numbers };
  treaties: { count: number; rows: Numbers };
  wars: { count: number; rows: Numbers };
  /** Schema 4: player interventions and their cooldown clock. */
  interventions?: { count: number; last: Numbers; rows: Numbers };
  /** Schema 4: the yearly world series. */
  stats?: { count: number; rows: Numbers };
  /** Schema 4: six yearly population samples per settlement. */
  trend?: { counts: Numbers; values: Numbers };
}
