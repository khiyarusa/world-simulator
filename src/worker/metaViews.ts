/** World and settlement metadata projections. Pure reads of the worker state. */
import type { WorldState } from '../sim/state/worldState.ts';
import type { SettlementMetaMsg, WorldMetaMsg } from './protocol.ts';

export function buildSettlementMeta(state: WorldState): SettlementMetaMsg {
  const s = state.settlements;
  const c = state.civs;
  return {
    day: state.day,
    settlements: {
      x: s.x.slice(0, s.count),
      y: s.y.slice(0, s.count),
      nameIdx: s.nameIdx.slice(0, s.count),
      civ: s.civ.slice(0, s.count),
      tier: s.tier.slice(0, s.count),
      pop: s.pop.slice(0, s.count),
      infra: state.society.infra.slice(0, s.count),
    },
    civs: { nameIdx: c.nameIdx.slice(0, c.count), colorIdx: c.colorIdx.slice(0, c.count), capital: c.capital.slice(0, c.count) },
  };
}

export function buildWorldMeta(state: WorldState): WorldMetaMsg {
  const s = state.settlements;
  const c = state.civs;
  return {
    width: state.width,
    height: state.height,
    seaLevel: state.seaLevel,
    recipe: state.recipe,
    report: state.report,
    day: state.day,
    settlements: {
      x: s.x.slice(0, s.count),
      y: s.y.slice(0, s.count),
      nameIdx: s.nameIdx.slice(0, s.count),
      civ: s.civ.slice(0, s.count),
      tier: s.tier.slice(0, s.count),
      pop: s.pop.slice(0, s.count),
      infra: state.society.infra.slice(0, s.count),
    },
    civs: { nameIdx: c.nameIdx.slice(0, c.count), colorIdx: c.colorIdx.slice(0, c.count), capital: c.capital.slice(0, c.count) },
    campaign: {
      mode: state.campaign.mode,
      legacy: state.campaign.legacy,
      era: state.campaign.era,
      targetCiv: state.campaign.targetCiv,
      completed: state.campaign.completed,
      milestones: state.campaign.milestoneDone.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0),
    },
  };
}
