/**
 * Worker-side query and command dispatch. Kept out of the scheduling loop so the worker file stays
 * about ownership, ticks and message plumbing.
 */
import { asErrorMessage, SimError } from '../core/errors.ts';
import { worldChecksum } from '../sim/state/checksum.ts';
import type { WorldState } from '../sim/state/worldState.ts';
import { applyIntervention, type InterventionRequest } from '../sim/society/interventions.ts';
import type { QueryResponse, QueryWhat, Speed } from './protocol.ts';
import {
  queryChronicle,
  queryCiv,
  queryCivs,
  queryDecisions,
  queryEcology,
  queryEconomy,
  queryEvent,
  queryHistory,
  queryInterventions,
  queryLayer,
  querySettlement,
  querySettlements,
  queryWorld,
} from './queries.ts';

export function runQuery(state: WorldState | null, what: QueryWhat, speed: Speed, selectedId: number | null): QueryResponse {
  if (!state) return { ok: false, code: 'NO_WORLD', message: 'no world is loaded' };
  try {
    switch (what.kind) {
      case 'world': {
        const view = queryWorld(state, { day: state.day, speed });
        return { ok: true, data: { ...view, checksum: worldChecksum(state) } };
      }
      case 'settlement':
        return { ok: true, data: querySettlement(state, what.id) };
      case 'settlements':
      case 'settlement-list':
        return { ok: true, data: querySettlements(state, what.kind === 'settlements' ? what.offset : undefined, what.kind === 'settlements' ? what.limit : undefined) };
      case 'civ':
        return { ok: true, data: queryCiv(state, what.id) };
      case 'civs':
        return { ok: true, data: queryCivs(state) };
      case 'economy':
        return { ok: true, data: queryEconomy(state, what.civ) };
      case 'ecology':
        return { ok: true, data: queryEcology(state, what.settlement) };
      case 'history':
        return { ok: true, data: queryHistory(state, what.filter, what.offset, what.limit) };
      case 'event':
        return { ok: true, data: queryEvent(state, what.id) };
      case 'chronicle':
        return { ok: true, data: queryChronicle(state, what.fromYear, what.toYear, what.offset, what.limit) };
      case 'decisions':
        return { ok: true, data: queryDecisions(state, what.limit) };
      case 'layer':
        return { ok: true, data: queryLayer(state, what.layer, what.filter) };
      case 'interventions':
        return { ok: true, data: queryInterventions(state) };
      case 'debug':
        return { ok: true, data: { stages: 20, selected: selectedId, speed, day: state.day } };
      default: {
        const exhaustive: never = what;
        return { ok: false, code: 'UNKNOWN_QUERY', message: JSON.stringify(exhaustive) };
      }
    }
  } catch (e) {
    return { ok: false, code: e instanceof SimError ? e.code : 'QUERY_FAILED', message: asErrorMessage(e) };
  }
}

export function runPlayer(state: WorldState | null, command: unknown): ReturnType<typeof applyIntervention> {
  if (!state) {
    return { ok: false, code: 'NO_WORLD', message: 'no world is loaded', eventId: 0, effects: [], cooldownDays: 0 };
  }
  if (!command || typeof command !== 'object' || typeof (command as { op?: unknown }).op !== 'string') {
    return { ok: false, code: 'BAD_COMMAND', message: 'malformed player command', eventId: 0, effects: [], cooldownDays: 0 };
  }
  return applyIntervention(state, command as InterventionRequest, state.day);
}

