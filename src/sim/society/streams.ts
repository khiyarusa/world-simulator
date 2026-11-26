/**
 * Persisted named-stream helper. Every random consumer has its own stream, and no consumer may advance
 * another's sequence (AGENTS.md R-16). A world saved mid-run resumes at exactly these positions.
 */
import type { WorldState } from '../state/worldState.ts';
import { Rng, STREAM_IDS } from '../../core/rng.ts';
import type { RngState, StreamId } from '../../core/rng.ts';

export function withStream(world: WorldState, stream: StreamId, fn: (rng: Rng) => void): void {
  const index = STREAM_IDS.indexOf(stream);
  const state: RngState | undefined = world.rngStates[index];
  if (!state) return;
  const rng = new Rng(state);
  fn(rng);
  world.rngStates[index] = rng.state;
}
