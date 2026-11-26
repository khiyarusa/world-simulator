/**
 * Narrative-arc detectors (docs/STAGE_3_DESIGN.md §4).
 *
 * Pure predicates over the recorded yearly history and the real event log. They never read the
 * world's narrative text and never inject events: an arc is either visible in the numbers or absent.
 */
export interface ArcYear {
  year: number;
  population: number;
  settlements: number;
  foodDays: number;
  routes: number;
  wars: number;
  health: number;
  stability: number;
  /** population per civilization, index = civ */
  civPopulation: number[];
  /** routes touching each civilization */
  civRoutes: number[];
}

export interface ArcEvent {
  id: number;
  day: number;
  type: string;
  severity: number;
  place: number;
  actorA: number;
  actorB: number;
  magnitude: number;
  cause: number;
}

export interface ArcTrace {
  years: ArcYear[];
  events: ArcEvent[];
  /** Day the harness-only blight was applied, or 0 when this run had no intervention. */
  blightDay: number;
  blightCiv: number;
}

export interface ArcResult {
  type: string;
  present: boolean;
  evidence: string;
}

const YEAR = 360;

function yearIndex(day: number): number {
  return Math.floor((day - 1) / YEAR);
}

/** 1. A boom that overshoots, collapses after a drought, and is resettled. */
function boomCollapse(trace: ArcTrace): ArcResult {
  const ys = trace.years;
  let peak = 0;
  for (let i = 1; i < ys.length; i++) {
    const p = ys[i]?.population ?? 0;
    if (p > (ys[peak]?.population ?? 0)) peak = i;
  }
  const peakPop = ys[peak]?.population ?? 0;
  if (peakPop < 500) return { type: 'boom_collapse_resettlement', present: false, evidence: 'no boom' };
  let trough = -1;
  let troughPop = peakPop;
  for (let i = peak + 1; i < Math.min(ys.length, peak + 40); i++) {
    const p = ys[i]?.population ?? 0;
    if (p < troughPop) {
      troughPop = p;
      trough = i;
    }
  }
  if (trough < 0 || troughPop > peakPop * 0.75) {
    return { type: 'boom_collapse_resettlement', present: false, evidence: `peak ${peakPop}, trough ${troughPop}` };
  }
  let recovered = false;
  for (let i = trough + 1; i < ys.length; i++) {
    if ((ys[i]?.population ?? 0) >= troughPop * 1.1) {
      recovered = true;
      break;
    }
  }
  const droughtBeforeTrough = trace.events.some((e) => {
    if (e.type !== 'drought') return false;
    const y = yearIndex(e.day);
    return y >= peak && y <= trough;
  });
  return {
    type: 'boom_collapse_resettlement',
    present: recovered && droughtBeforeTrough,
    evidence: `peak ${peakPop}@${ys[peak]?.year}, trough ${troughPop}@${ys[trough]?.year}, recovered ${recovered}, drought ${droughtBeforeTrough}`,
  };
}

/** 2. A war that kills a trade route and leaves both sides poorer. */
function warTradeDecline(trace: ArcTrace): ArcResult {
  const wars = trace.events.filter((e) => e.type === 'war_declared');
  for (const war of wars) {
    const startYear = yearIndex(war.day);
    const a = war.actorA;
    const b = war.actorB;
    const lost = trace.events.some((e) => {
      if (e.type !== 'route_lost') return false;
      const y = yearIndex(e.day);
      const touches = e.actorA === a || e.actorA === b || e.actorB === a || e.actorB === b;
      return touches && y >= startYear && y <= startYear + 20;
    });
    const before = trace.years[startYear];
    const after = trace.years[Math.min(trace.years.length - 1, startYear + 20)];
    if (!before || !after) continue;
    const popBefore = (before.civPopulation[a] ?? 0) + (before.civPopulation[b] ?? 0);
    const popAfter = (after.civPopulation[a] ?? 0) + (after.civPopulation[b] ?? 0);
    if (lost && popBefore > 0 && popAfter < popBefore * 0.9) {
      return {
        type: 'war_trade_decline',
        present: true,
        evidence: `war ${a}-${b}@${before.year}, route lost, population ${popBefore}->${popAfter}`,
      };
    }
  }
  return { type: 'war_trade_decline', present: false, evidence: `${wars.length} wars, no qualifying decline` };
}

/** 3. Trade grows, one civilization grows with it and another declines. */
function tradeDivergence(trace: ArcTrace): ArcResult {
  const ys = trace.years;
  for (let i = 0; i + 50 < ys.length; i++) {
    const start = ys[i];
    const end = ys[i + 50];
    if (!start || !end) continue;
    if ((end.routes ?? 0) - (start.routes ?? 0) < 20) continue;
    for (let civ = 0; civ < start.civPopulation.length; civ++) {
      const before = start.civPopulation[civ] ?? 0;
      const after = end.civPopulation[civ] ?? 0;
      const routeGain = (end.civRoutes[civ] ?? 0) - (start.civRoutes[civ] ?? 0);
      if (before < 200 || routeGain < 2 || after < before * 1.25) continue;
      for (let other = 0; other < start.civPopulation.length; other++) {
        if (other === civ) continue;
        const ob = start.civPopulation[other] ?? 0;
        const oa = end.civPopulation[other] ?? 0;
        if (ob >= 200 && oa < ob * 0.9) {
          return {
            type: 'trade_divergence',
            present: true,
            evidence: `civ ${civ} +routes ${routeGain}, ${before}->${after}; civ ${other} ${ob}->${oa}`,
          };
        }
      }
    }
  }
  return { type: 'trade_divergence', present: false, evidence: 'no 50-year divergence' };
}

/** 4. The harness blight causes refugees and a measurable decline in the affected civilization. */
function blightArc(trace: ArcTrace): ArcResult {
  if (trace.blightDay <= 0) return { type: 'blight_refugees', present: false, evidence: 'no intervention' };
  const blightYear = yearIndex(trace.blightDay);
  const start = trace.years[blightYear];
  const after = trace.years[Math.min(trace.years.length - 1, blightYear + 10)];
  if (!start || !after) return { type: 'blight_refugees', present: false, evidence: 'trace too short' };
  const before = start.civPopulation[trace.blightCiv] ?? 0;
  const afterPop = after.civPopulation[trace.blightCiv] ?? 0;
  const refugees = trace.events.some((e) => {
    if (e.type !== 'migration_wave') return false;
    const y = yearIndex(e.day);
    return y >= blightYear && y <= blightYear + 5;
  });
  return {
    type: 'blight_refugees',
    present: refugees && before > 0 && afterPop < before * 0.95,
    evidence: `civ ${trace.blightCiv} ${before}->${afterPop}, refugees ${refugees}`,
  };
}

export function detectArcs(trace: ArcTrace): ArcResult[] {
  return [boomCollapse(trace), warTradeDecline(trace), tradeDivergence(trace), blightArc(trace)];
}
