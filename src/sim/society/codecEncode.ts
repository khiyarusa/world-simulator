/** Society block encoder. Decoding and validation live in codec.ts. */
import type { WorldState } from '../state/worldState.ts';
import {
  COHORT_COUNT,
  CIV_STRIDE,
  DECISION_CAPACITY,
  EVENT_CAPACITY,
  RES_COUNT,
  SETTLEMENT_TREND_SAMPLES,
} from './state.ts';
import { VITAL_CAPACITY } from './vital.ts';
import type { Numbers, SocietyDoc } from './codecTypes.ts';

const arr = (src: ArrayLike<number>, n: number): number[] => Array.from(src).slice(0, n);

/** Encode the live state. Event rows are stored oldest→newest so ids stay monotonic on reload. */
export function encodeSociety(world: WorldState): SocietyDoc {
  const s = world.society;
  const sc = world.settlements.count;

  const rows: Numbers = [];
  for (let k = 0; k < s.eventCount; k++) {
    const i = (s.eventHead - s.eventCount + k + EVENT_CAPACITY * 2) % EVENT_CAPACITY;
    rows.push(
      s.eventId[i] ?? 0,
      s.eventDay[i] ?? 0,
      s.eventType[i] ?? 0,
      s.eventSeverity[i] ?? 0,
      s.eventPlace[i] ?? 0,
      s.eventActorA[i] ?? 0,
      s.eventActorB[i] ?? 0,
      s.eventMagnitude[i] ?? 0,
      s.eventCause[i] ?? 0,
    );
  }

  const decisions: Numbers = [];
  for (let k = 0; k < s.decisionCount; k++) {
    const i = (s.decisionHead - s.decisionCount + k + DECISION_CAPACITY * 2) % DECISION_CAPACITY;
    decisions.push(
      s.decisionDay[i] ?? 0,
      s.decisionKind[i] ?? 0,
      s.decisionActor[i] ?? 0,
      s.decisionChosen[i] ?? 0,
      s.decisionScore[i] ?? 0,
      s.decisionBias[i] ?? 0,
    );
  }

  const chronicle: Numbers = [];
  for (let k = 0; k < s.chronicleCount; k++) {
    const i = (s.chronicleHead - s.chronicleCount + k + 8192) % 4096;
    chronicle.push(
      s.chronicleYear[i] ?? 0,
      s.chronicleCiv[i] ?? 0,
      s.chroniclePop[i] ?? 0,
      s.chronicleSettlements[i] ?? 0,
      s.chronicleEvents[i] ?? 0,
    );
  }

  const vital: Numbers = [];
  for (let n = 0; n < s.vital.count; n++) {
    const i = (s.vital.head - s.vital.count + n + VITAL_CAPACITY * 2) % VITAL_CAPACITY;
    vital.push(
      s.vital.id[i] ?? 0,
      s.vital.day[i] ?? 0,
      s.vital.type[i] ?? 0,
      s.vital.severity[i] ?? 0,
      s.vital.place[i] ?? 0,
      s.vital.actorA[i] ?? 0,
      s.vital.actorB[i] ?? 0,
      s.vital.magnitude[i] ?? 0,
      s.vital.cause[i] ?? 0,
    );
  }

  const routes: Numbers = [];
  for (let i = 0; i < s.routeCount; i++) {
    routes.push(
      s.routeA[i] ?? 0,
      s.routeB[i] ?? 0,
      s.routeCapacity[i] ?? 0,
      s.routeLength[i] ?? 0,
      s.routeTariff[i] ?? 0,
      s.routeCreated[i] ?? 0,
      s.routeVolume[i] ?? 0,
      s.routeIdle[i] ?? 0,
    );
  }

  const treaties: Numbers = [];
  for (let i = 0; i < s.treatyCount; i++) {
    treaties.push(
      s.treatyA[i] ?? 0,
      s.treatyB[i] ?? 0,
      s.treatyType[i] ?? 0,
      s.treatyStart[i] ?? 0,
      s.treatyEnd[i] ?? 0,
    );
  }

  const wars: Numbers = [];
  for (let i = 0; i < s.warCount; i++) {
    wars.push(
      s.warA[i] ?? 0,
      s.warB[i] ?? 0,
      s.warStart[i] ?? 0,
      s.warScore[i] ?? 0,
      s.warExhaustA[i] ?? 0,
      s.warExhaustB[i] ?? 0,
      s.warBattles[i] ?? 0,
      s.warCause[i] ?? 0,
      s.warGateStrength[i] ?? 0,
      s.warGateGrievance[i] ?? 0,
      s.warGateCapacity[i] ?? 0,
      s.warGateUtility[i] ?? 0,
    );
  }

  const interventions: Numbers = [];
  const ivCap = s.interventionKind.length;
  for (let n = 0; n < s.interventionCount; n++) {
    const i = (s.interventionHead - s.interventionCount + n + ivCap * 2) % ivCap;
    interventions.push(
      s.interventionKind[i] ?? 0,
      s.interventionA[i] ?? 0,
      s.interventionB[i] ?? 0,
      s.interventionStart[i] ?? 0,
      s.interventionEnd[i] ?? 0,
      s.interventionIntensity[i] ?? 0,
      s.interventionResource[i] ?? 255,
      s.interventionAmount[i] ?? 0,
    );
  }

  const stats: Numbers = [];
  const stCap = s.statsYear.length;
  for (let n = 0; n < s.statsCount; n++) {
    const i = (s.statsHead - s.statsCount + n + stCap * 2) % stCap;
    stats.push(
      s.statsYear[i] ?? 0,
      s.statsPopulation[i] ?? 0,
      s.statsSettlements[i] ?? 0,
      s.statsCivs[i] ?? 0,
      s.statsFoodProduced[i] ?? 0,
      s.statsTradeVolume[i] ?? 0,
      s.statsTreasury[i] ?? 0,
      s.statsWars[i] ?? 0,
      s.statsFertility[i] ?? 0,
      s.statsDrought[i] ?? 0,
    );
  }

  return {
    v: 5,
    cohorts: arr(s.cohorts, sc * COHORT_COUNT),
    occShare: arr(s.occShare, sc * 5),
    stock: arr(s.stock, sc * RES_COUNT),
    cap: arr(s.cap, sc * RES_COUNT),
    carry: arr(s.carry, sc * RES_COUNT),
    treasury: arr(s.treasury, sc),
    health: arr(s.health, sc),
    stability: arr(s.stability, sc),
    literacy: arr(s.literacy, sc),
    infra: arr(s.infra, sc),
    flags: arr(s.flags, sc),
    foundedDay: arr(s.foundedDay, sc),
    lastDroughtEvent: arr(s.lastDroughtEvent, sc),
    lastFamineEvent: arr(s.lastFamineEvent, sc),
    price: arr(s.price, sc * RES_COUNT),
    occupier: arr(s.occupier, sc),
    surplusYears: arr(s.surplusYears, sc),
    lastEpidemicDay: arr(s.lastEpidemicDay, sc),
    historyDay: arr(s.historyDay, sc * 3),
    culture: arr(s.culture, CIV_STRIDE * 3),
    tech: arr(s.tech, CIV_STRIDE * 12),
    techProgress: arr(s.techProgress, CIV_STRIDE * 12),
    legitimacy: arr(s.legitimacy, CIV_STRIDE),
    relation: arr(s.relation, CIV_STRIDE * CIV_STRIDE),
    grievance: arr(s.grievance, CIV_STRIDE * CIV_STRIDE),
    army: arr(s.army, CIV_STRIDE),
    exhaustion: arr(s.exhaustion, CIV_STRIDE),
    warWins: arr(s.warWins, CIV_STRIDE),
    regionDroughtMonths: arr(s.regionDroughtMonths, 16),
    regionPrecip: arr(s.regionPrecip, 16),
    regionTempAnomaly: arr(s.regionTempAnomaly, 16),
    events: { count: s.eventCount, nextId: s.nextEventId, rows },
    vital: { count: s.vital.count, rows: vital },
    decisions: { count: s.decisionCount, rows: decisions },
    chronicle: { count: s.chronicleCount, rows: chronicle },
    routes: { count: s.routeCount, rows: routes },
    treaties: { count: s.treatyCount, rows: treaties },
    wars: { count: s.warCount, rows: wars },
    interventions: { count: s.interventionCount, last: Array.from(s.interventionLastDay), rows: interventions },
    stats: { count: s.statsCount, rows: stats },
    trend: {
      counts: arr(s.trendCount, sc),
      values: arr(s.trendPop, sc * SETTLEMENT_TREND_SAMPLES),
    },
  };
}
