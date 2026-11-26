/**
 * Player interventions (GDD §3, Stage 4 WP2).
 *
 * Four actions, one contract each. A command is validated against the *live* world, mutates only real
 * simulation state, appends an event whose root cause is `CAUSE.PLAYER`, and records a persisted row
 * so the effect survives save/load and the cooldown is not a UI fiction.
 *
 * Conservation rules:
 *   - Bless is an exogenous gift (the world outside the map sends it). It is hard-capped at 10 % of
 *     the settlement's annual stock, added through `addStock`, and the *actual* amount added is what
 *     the event and the result report. No unit is created by rounding.
 *   - Blight/fertilize only move vegetation/fertility within 0..255 and never delete a cohort.
 *   - Incite moves the relation/grievance pair; neither is a stock.
 */
import type { WorldState } from '../state/worldState.ts';
import {
  CAUSE,
  EVENT_TYPE,
  INTERVENTION,
  INTERVENTION_COOLDOWN_DAYS,
  INTERVENTION_NAMES,
  RES,
  RES_COUNT,
  RES_NAMES,
  CIV_STRIDE,
  SEVERITY,
  addStock,
  appendEvent,
  type InterventionKind,
  type SocietyState,
} from './state.ts';
import { FLAG_BLIGHT, isAlive, relationOf, setRelation } from './common.ts';
import { appendIntervention } from './rings.ts';
import { stockOf } from './state.ts';

export interface InterventionRequest {
  readonly op: 'bless' | 'blight' | 'fertilize' | 'incite';
  readonly settlement?: number;
  readonly resource?: number;
  readonly amount?: number;
  readonly intensity?: number;
  readonly durationDays?: number;
  readonly civA?: number;
  readonly civB?: number;
}

export interface CommandEffect {
  readonly kind: 'stock' | 'relation' | 'grievance' | 'fertility' | 'vegetation' | 'health' | 'stability' | 'area';
  readonly resource?: number;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface InterventionResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly eventId: number;
  readonly effects: readonly CommandEffect[];
  readonly cooldownDays: number;
}

const KIND: Readonly<Record<InterventionRequest['op'], InterventionKind>> = {
  bless: INTERVENTION.BLESS,
  blight: INTERVENTION.BLIGHT,
  fertilize: INTERVENTION.FERTILIZE,
  incite: INTERVENTION.INCITE,
};

/** Cooldown state for one intervention, from the persisted last-use day. */
export function cooldownOf(
  soc: SocietyState,
  day: number,
  kind: number,
): { lastDay: number; remainingDays: number; ready: boolean; cooldownDays: number } {
  const lastDay = soc.interventionLastDay[kind] ?? 0;
  const cooldownDays = INTERVENTION_COOLDOWN_DAYS[kind] ?? 0;
  const remainingDays = lastDay > 0 ? Math.max(0, cooldownDays - (day - lastDay)) : 0;
  return { lastDay, remainingDays, ready: remainingDays === 0, cooldownDays };
}

/** Daily need per person, used only to size the Bless cap (the real rule lives in living.ts). */
const DAILY_NEED_PM = [1000, 1200, 150, 0, 0, 0] as const;

/**
 * Maximum Bless amount in units: 10 % of the settlement's annual stock.
 *
 * `annual = current stock + one year of that resource's real consumption` (materials use the
 * population's annual labour-equivalent as the denominator). The value is exposed to the UI so the
 * player sees the same limit the worker enforces.
 */
export function blessMaxAmount(world: WorldState, settlement: number, resource: number): number {
  if (settlement < 0 || settlement >= world.settlements.count) return 0;
  const pop = Math.max(1, world.settlements.pop[settlement] ?? 0);
  const rate = DAILY_NEED_PM[resource] ?? 0;
  const annualUse = rate > 0 ? Math.floor((pop * rate * 360) / 1000) : pop * 36;
  const stock = stockOf(world.society, settlement, resource);
  return Math.max(1, Math.floor((stock + annualUse) / 10));
}

function fail(code: string, message: string, cooldownDays = 0): InterventionResult {
  return { ok: false, code, message, eventId: 0, effects: [], cooldownDays };
}

function inRadius(world: WorldState, centre: number, radius: number): number[] {
  const s = world.settlements;
  const cx = s.x[centre] ?? 0;
  const cy = s.y[centre] ?? 0;
  const out: number[] = [];
  for (let i = 0; i < s.count; i++) {
    if (!isAlive(world, i)) continue;
    const dx = (s.x[i] ?? 0) - cx;
    const dy = (s.y[i] ?? 0) - cy;
    if (dx * dx + dy * dy <= radius * radius) out.push(i);
  }
  return out;
}

function tileOf(world: WorldState, settlement: number): number {
  return (world.settlements.y[settlement] ?? 0) * world.width + (world.settlements.x[settlement] ?? 0);
}

function setFloat(grid: Uint8Array, index: number, value: number): void {
  grid[index] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/** Apply one player command. Pure with respect to anything except `world`. */
export function applyIntervention(world: WorldState, req: InterventionRequest, day = world.day): InterventionResult {
  const soc = world.society;
  const kind = KIND[req.op];
  if (kind === undefined) return fail('UNKNOWN_OP', `unknown intervention ${String(req.op)}`);
  const cooldown = cooldownOf(soc, day, kind);
  if (!cooldown.ready) {
    return fail(
      'COOLDOWN',
      `${INTERVENTION_NAMES[kind]} is on cooldown for ${cooldown.remainingDays} more day(s)`,
      cooldown.remainingDays,
    );
  }

  switch (req.op) {
    case 'bless':
      return bless(world, req, day);
    case 'blight':
      return blight(world, req, day);
    case 'fertilize':
      return fertilize(world, req, day);
    case 'incite':
      return incite(world, req, day);
  }
}

function bless(world: WorldState, req: InterventionRequest, day: number): InterventionResult {
  const soc = world.society;
  const s = world.settlements;
  const id = req.settlement;
  if (id === undefined || !Number.isInteger(id) || id < 0 || id >= s.count) {
    return fail('BAD_TARGET', 'bless needs a valid settlement');
  }
  if (!isAlive(world, id)) return fail('DEAD_TARGET', 'that settlement no longer exists');
  const resource = req.resource;
  if (resource === undefined || !Number.isInteger(resource) || resource < 0 || resource >= RES_COUNT) {
    return fail('BAD_RESOURCE', 'bless needs a resource between 0 and 5');
  }
  const amount = req.amount;
  if (amount === undefined || !Number.isInteger(amount) || amount < 1) {
    return fail('BAD_AMOUNT', 'bless needs a positive whole amount');
  }
  const max = blessMaxAmount(world, id, resource);
  if (amount > max) {
    return fail('AMOUNT_LIMIT', `the yearly gift limit is ${max} units of ${RES_NAMES[resource] ?? 'resource'}`);
  }
  const before = stockOf(soc, id, resource);
  const added = addStock(soc, id, resource, amount);
  if (added <= 0) {
    return fail('NO_ROOM', 'the settlement has no free storage for that gift');
  }
  const after = stockOf(soc, id, resource);
  const eventId = appendEvent(
    soc,
    day,
    EVENT_TYPE.PLAYER_BLESS,
    added >= Math.max(50, max / 2) ? SEVERITY.MAJOR : SEVERITY.NOTABLE,
    id,
    s.civ[id] ?? 0,
    0,
    added,
    CAUSE.PLAYER,
  );
  appendIntervention(soc, INTERVENTION.BLESS, id, 0, day, day, 1, resource, added);
  world.counters.blessings += 1;
  return {
    ok: true,
    code: 'OK',
    message: `${added} ${RES_NAMES[resource] ?? 'units'} delivered`,
    eventId,
    effects: [{ kind: 'stock', resource, before, after, delta: added }],
    cooldownDays: INTERVENTION_COOLDOWN_DAYS[INTERVENTION.BLESS] ?? 0,
  };
}

function blight(world: WorldState, req: InterventionRequest, day: number): InterventionResult {
  const soc = world.society;
  const s = world.settlements;
  const id = req.settlement;
  if (id === undefined || !Number.isInteger(id) || id < 0 || id >= s.count) {
    return fail('BAD_TARGET', 'blight needs a valid settlement');
  }
  if (!isAlive(world, id)) return fail('DEAD_TARGET', 'that settlement no longer exists');
  const intensity = req.intensity ?? 1;
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 3) {
    return fail('BAD_INTENSITY', 'blight intensity must be 1, 2 or 3');
  }
  const duration = req.durationDays ?? 180;
  if (!Number.isInteger(duration) || duration < 90 || duration > 360 || duration % 30 !== 0) {
    return fail('BAD_DURATION', 'blight duration must be 90, 120, 150, 180 … 360 days');
  }
  const radius = 3 + intensity * 2;
  const affected = inRadius(world, id, radius);
  if (affected.length === 0) return fail('NO_EFFECT', 'no living settlement lies in that region');
  const effects: CommandEffect[] = [];
  let people = 0;
  for (const i of affected) {
    const tile = tileOf(world, i);
    const beforeVeg = world.grids.vegetation[tile] ?? 0;
    setFloat(world.grids.vegetation, tile, beforeVeg - (20 + intensity * 10));
    const beforeFert = world.grids.fertility[tile] ?? 0;
    setFloat(world.grids.fertility, tile, beforeFert - (8 + intensity * 4));
    const food = stockOf(soc, i, RES.FOOD);
    addStock(soc, i, RES.FOOD, -Math.floor((food * (15 + intensity * 10)) / 100));
    soc.health[i] = Math.max(0, (soc.health[i] ?? 60) - intensity * 3);
    soc.stability[i] = Math.max(0, (soc.stability[i] ?? 60) - intensity * 4);
    soc.flags[i] = (soc.flags[i] ?? 0) | FLAG_BLIGHT;
    people += s.pop[i] ?? 0;
    if (i === id) {
      effects.push({ kind: 'vegetation', before: beforeVeg, after: world.grids.vegetation[tile] ?? 0, delta: (world.grids.vegetation[tile] ?? 0) - beforeVeg });
      effects.push({ kind: 'fertility', before: beforeFert, after: world.grids.fertility[tile] ?? 0, delta: (world.grids.fertility[tile] ?? 0) - beforeFert });
    }
  }
  const eventId = appendEvent(soc, day, EVENT_TYPE.BLIGHT, SEVERITY.HISTORIC, id, s.civ[id] ?? 0, 0, affected.length, CAUSE.PLAYER);
  appendIntervention(soc, INTERVENTION.BLIGHT, id, 0, day, day + duration, intensity, 255, affected.length);
  world.counters.blights += 1;
  effects.unshift({ kind: 'area', before: 0, after: affected.length, delta: people });
  return {
    ok: true,
    code: 'OK',
    message: `A ${duration}-day blight settled over ${affected.length} settlement(s)`,
    eventId,
    effects,
    cooldownDays: INTERVENTION_COOLDOWN_DAYS[INTERVENTION.BLIGHT] ?? 0,
  };
}

function fertilize(world: WorldState, req: InterventionRequest, day: number): InterventionResult {
  const soc = world.society;
  const s = world.settlements;
  const id = req.settlement;
  if (id === undefined || !Number.isInteger(id) || id < 0 || id >= s.count) {
    return fail('BAD_TARGET', 'fertilize needs a valid settlement');
  }
  if (!isAlive(world, id)) return fail('DEAD_TARGET', 'that settlement no longer exists');
  const intensity = req.intensity ?? 1;
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 3) {
    return fail('BAD_INTENSITY', 'fertilize intensity must be 1, 2 or 3');
  }
  const radius = 3 + intensity;
  const affected = inRadius(world, id, radius);
  if (affected.length === 0) return fail('NO_EFFECT', 'no living settlement lies in that area');
  const effects: CommandEffect[] = [];
  for (const i of affected) {
    const tile = tileOf(world, i);
    const before = world.grids.fertility[tile] ?? 0;
    setFloat(world.grids.fertility, tile, before + 5 + intensity * 3);
    setFloat(world.grids.vegetation, tile, (world.grids.vegetation[tile] ?? 0) + intensity * 2);
    soc.health[i] = Math.min(100, (soc.health[i] ?? 60) + intensity);
    soc.stability[i] = Math.min(100, (soc.stability[i] ?? 60) + intensity);
    if (i === id) {
      effects.push({ kind: 'fertility', before, after: world.grids.fertility[tile] ?? 0, delta: (world.grids.fertility[tile] ?? 0) - before });
    }
  }
  const eventId = appendEvent(soc, day, EVENT_TYPE.PLAYER_FERTILIZE, SEVERITY.NOTABLE, id, s.civ[id] ?? 0, 0, affected.length, CAUSE.PLAYER);
  appendIntervention(soc, INTERVENTION.FERTILIZE, id, 0, day, day + 5 * 360, intensity, 255, affected.length);
  world.counters.fertilized += 1;
  effects.unshift({ kind: 'area', before: 0, after: affected.length, delta: affected.length });
  return {
    ok: true,
    code: 'OK',
    message: `Soil enriched across ${affected.length} settlement(s) for five years`,
    eventId,
    effects,
    cooldownDays: INTERVENTION_COOLDOWN_DAYS[INTERVENTION.FERTILIZE] ?? 0,
  };
}

function incite(world: WorldState, req: InterventionRequest, day: number): InterventionResult {
  const soc = world.society;
  const civs = world.civs.count;
  const a = req.civA;
  const b = req.civB;
  if (a === undefined || b === undefined || !Number.isInteger(a) || !Number.isInteger(b)) {
    return fail('BAD_TARGET', 'incite needs two civilizations');
  }
  if (a < 0 || b < 0 || a >= civs || b >= civs || a === b) {
    return fail('BAD_TARGET', 'choose two different existing civilizations');
  }
  if (world.settlements.pop[a] === undefined) return fail('BAD_TARGET', 'invalid civilization');
  // both must still own at least one living settlement
  let aliveA = false;
  let aliveB = false;
  for (let i = 0; i < world.settlements.count; i++) {
    if (!isAlive(world, i)) continue;
    if ((world.settlements.civ[i] ?? 0) === a) aliveA = true;
    else if ((world.settlements.civ[i] ?? 0) === b) aliveB = true;
  }
  if (!aliveA || !aliveB) return fail('DEAD_TARGET', 'a civilization with no settlements cannot be incited');
  for (let k = 0; k < soc.warCount; k++) {
    const wa = soc.warA[k] ?? 0;
    const wb = soc.warB[k] ?? 0;
    if ((wa === a && wb === b) || (wa === b && wb === a)) {
      return fail('REFUSED', 'those civilizations are already at war');
    }
  }
  const relBefore = relationOf(soc, a, b);
  const grBefore = soc.grievance[a * CIV_STRIDE + b] ?? 0;
  if (relBefore <= -90 && grBefore >= 950) return fail('REFUSED', 'relations are already at their worst');
  const relAfter = Math.max(-100, relBefore - 15);
  setRelation(soc, a, b, relAfter);
  setRelation(soc, b, a, relAfter);
  const grAfter = Math.min(1000, grBefore + 150);
  soc.grievance[a * CIV_STRIDE + b] = grAfter;
  soc.grievance[b * CIV_STRIDE + a] = grAfter;
  const eventId = appendEvent(soc, day, EVENT_TYPE.PLAYER_INCITE, SEVERITY.NOTABLE, world.civs.capital[a] ?? 0, a, b, grAfter - grBefore, CAUSE.PLAYER);
  appendIntervention(soc, INTERVENTION.INCITE, a, b, day, day, 1, 255, grAfter - grBefore);
  world.counters.incited += 1;
  return {
    ok: true,
    code: 'OK',
    message: `Relations fell by ${relBefore - relAfter}; grievance rose by ${grAfter - grBefore}`,
    eventId,
    effects: [
      { kind: 'relation', before: relBefore, after: relAfter, delta: relAfter - relBefore },
      { kind: 'grievance', before: grBefore, after: grAfter, delta: grAfter - grBefore },
    ],
    cooldownDays: INTERVENTION_COOLDOWN_DAYS[INTERVENTION.INCITE] ?? 0,
  };
}

/**
 * Monthly upkeep of lingering effects. A blight is re-applied while it is active and cleared when it
 * expires; fertilize keeps pushing the soil toward its enriched target. This is a real read by the
 * production system (through vegetation/fertility and `blightPressurePm`), not a UI badge.
 */
export function runInterventionEffects(world: WorldState, day: number): void {
  const soc = world.society;
  const s = world.settlements;
  for (let i = 0; i < s.count; i++) soc.flags[i] = (soc.flags[i] ?? 0) & ~FLAG_BLIGHT;

  const cap = soc.interventionKind.length;
  for (let n = 0; n < soc.interventionCount; n++) {
    const k = (soc.interventionHead - soc.interventionCount + n + cap * 2) % cap;
    const kind = soc.interventionKind[k] ?? 0;
    const start = soc.interventionStart[k] ?? 0;
    const end = soc.interventionEnd[k] ?? 0;
    if (end <= start || day < start || day > end) continue;
    const centre = soc.interventionA[k] ?? 0;
    if (centre >= s.count) continue;
    if (kind === INTERVENTION.BLIGHT) {
      const intensity = Math.max(1, soc.interventionIntensity[k] ?? 1);
      const radius = 3 + intensity * 2;
      for (const i of inRadius(world, centre, radius)) {
        const tile = tileOf(world, i);
        setFloat(world.grids.vegetation, tile, (world.grids.vegetation[tile] ?? 0) - (1 + intensity));
        setFloat(world.grids.fertility, tile, (world.grids.fertility[tile] ?? 0) - 1);
        soc.flags[i] = (soc.flags[i] ?? 0) | FLAG_BLIGHT;
      }
    } else if (kind === INTERVENTION.FERTILIZE) {
      const intensity = Math.max(1, soc.interventionIntensity[k] ?? 1);
      const radius = 3 + intensity;
      for (const i of inRadius(world, centre, radius)) {
        const tile = tileOf(world, i);
        setFloat(world.grids.fertility, tile, (world.grids.fertility[tile] ?? 0) + 1 + intensity);
        setFloat(world.grids.vegetation, tile, (world.grids.vegetation[tile] ?? 0) + 1);
      }
    }
  }
}

/** Production multiplier from active blights, per-mille (1000 = no blight). */
export function blightPressurePm(world: WorldState, settlement: number): number {
  const soc = world.society;
  const s = world.settlements;
  if (((soc.flags[settlement] ?? 0) & FLAG_BLIGHT) === 0) return 1000;
  let intensity = 1;
  const cap = soc.interventionKind.length;
  for (let n = 0; n < soc.interventionCount; n++) {
    const k = (soc.interventionHead - soc.interventionCount + n + cap * 2) % cap;
    if ((soc.interventionKind[k] ?? 0) !== INTERVENTION.BLIGHT) continue;
    if ((soc.interventionEnd[k] ?? 0) < world.day) continue;
    const centre = soc.interventionA[k] ?? 0;
    if (centre >= s.count) continue;
    const dx = (s.x[settlement] ?? 0) - (s.x[centre] ?? 0);
    const dy = (s.y[settlement] ?? 0) - (s.y[centre] ?? 0);
    if (dx * dx + dy * dy > (3 + (soc.interventionIntensity[k] ?? 1) * 2) ** 2) continue;
    intensity = Math.max(intensity, soc.interventionIntensity[k] ?? 1);
  }
  return 1000 - intensity * 180;
}

export interface InterventionRow {
  readonly kind: number;
  readonly a: number;
  readonly b: number;
  readonly startDay: number;
  readonly endDay: number;
  readonly intensity: number;
  readonly resource: number;
  readonly amount: number;
  readonly active: boolean;
}

/** All persisted rows, newest first. */
export function listInterventions(soc: SocietyState, day: number): InterventionRow[] {
  const out: InterventionRow[] = [];
  const cap = soc.interventionKind.length;
  for (let n = 0; n < soc.interventionCount; n++) {
    const k = (soc.interventionHead - 1 - n + cap * 2) % cap;
    out.push({
      kind: soc.interventionKind[k] ?? 0,
      a: soc.interventionA[k] ?? 0,
      b: soc.interventionB[k] ?? 0,
      startDay: soc.interventionStart[k] ?? 0,
      endDay: soc.interventionEnd[k] ?? 0,
      intensity: soc.interventionIntensity[k] ?? 0,
      resource: soc.interventionResource[k] ?? 255,
      amount: soc.interventionAmount[k] ?? 0,
      active: (soc.interventionEnd[k] ?? 0) > (soc.interventionStart[k] ?? 0) && day >= (soc.interventionStart[k] ?? 0) && day <= (soc.interventionEnd[k] ?? 0),
    });
  }
  return out;
}
