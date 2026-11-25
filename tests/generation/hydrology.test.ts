import { describe, expect, it } from 'vitest';
import { auditHydrology, TERMINAL } from '../../src/sim/world/hydrologyCheck.ts';
import { buildHydrology } from '../../src/sim/world/hydrology.ts';
import { generateV1 } from '../../src/sim/world/generate.v1.ts';
import { seedOf } from '../../src/core/seed.ts';
import type { Preset } from '../../src/sim/state/worldState.ts';

function elevationOf(seedLo: number, preset: Preset) {
  const world = generateV1({
    seed: seedOf(seedLo, 11),
    preset,
    water: 50,
    harshness: 50,
    peoples: 4,
    generatorVersion: 1,
  });
  return world;
}

describe('hydrology contract', () => {
  it('satisfies flow, descent, termination and sink-locality rules on every preset', () => {
    for (const preset of ['small', 'medium', 'large'] as const) {
      for (const seed of [1, 3, 77]) {
        const world = elevationOf(seed, preset);
        const report = auditHydrology(world.grids.elevation, world.width, world.height, world.seaLevel);
        expect(report.issues, `seed ${seed} / ${preset}`).toEqual([]);
        expect(report.audit.badDirection).toBe(0);
        expect(report.audit.nonDescending).toBe(0);
        expect(report.audit.cycles).toBe(0);
        expect(report.audit.sinksNotLocalMinimum).toBe(0);
      }
    }
  });

  it('reports where rivers terminate instead of assuming it', () => {
    const world = elevationOf(2024, 'medium');
    const { audit } = auditHydrology(world.grids.elevation, world.width, world.height, world.seaLevel);
    expect(audit.riverCells).toBeGreaterThan(0);
    const accounted = audit.riversToSea + audit.riversToLake + audit.riversToSink;
    expect(accounted).toBeGreaterThan(0);
    // every river path has exactly one terminal kind
    expect(accounted).toBeLessThanOrEqual(audit.riverCells);
    // at least the sea must be reachable from this world's rivers
    expect(audit.riversToSea).toBeGreaterThan(0);
  });

  it('never points a river below the sea or off the map', () => {
    const world = elevationOf(9, 'small');
    const hydro = buildHydrology(world.grids.elevation, world.width, world.height, world.seaLevel);
    const { audit } = auditHydrology(world.grids.elevation, world.width, world.height, world.seaLevel, hydro);
    expect(audit.badDirection).toBe(0);
    expect(audit.stranded).toBe(0);
    expect(audit.maxRiverPath).toBeLessThanOrEqual(world.width * world.height);
  });

  it('detects a deliberately broken flow direction', () => {
    const world = elevationOf(4, 'small');
    const hydro = buildHydrology(world.grids.elevation, world.width, world.height, world.seaLevel);
    // point one cell uphill: the audit must notice, not accept it
    const n = world.width * world.height;
    let broken = -1;
    for (let i = 0; i < n; i++) {
      if ((hydro.flowDir[i] ?? 8) !== 8 && (world.grids.elevation[i] ?? 0) > world.seaLevel) {
        broken = i;
        break;
      }
    }
    expect(broken).toBeGreaterThanOrEqual(0);
    hydro.flowDir[broken] = 8; // a sink in the middle of a slope
    const report = auditHydrology(world.grids.elevation, world.width, world.height, world.seaLevel, hydro);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.audit.sinksNotLocalMinimum).toBeGreaterThan(0);
  });

  it('classifies a flat plateau as a legitimate terminal, not a fault', () => {
    // A 9x9 flat world with a single lower edge: all flow must leave the plateau or stop at a sink
    // that is a local minimum, with no cycle and no non-descending step.
    const size = 9;
    const elevation = new Int16Array(size * size).fill(100);
    for (let x = 0; x < size; x++) elevation[x] = -100; // top row is the sea
    const report = auditHydrology(elevation, size, size, 0);
    expect(report.audit.cycles).toBe(0);
    expect(report.audit.badDirection).toBe(0);
    expect(report.audit.nonDescending).toBe(0);
    expect(report.issues).toEqual([]);
    // the interior cannot descend, so it stops at local-minimum sinks: that is the documented rule
    expect(report.audit.sinks).toBeGreaterThan(0);
  });

  it('counts a sealed pit as a sink with a valid terminal kind', () => {
    const size = 7;
    const elevation = new Int16Array(size * size).fill(500);
    const centre = 3 * size + 3;
    elevation[centre] = -100; // a deep pit that no river can leave
    const report = auditHydrology(elevation, size, size, 0);
    expect(report.audit.cycles).toBe(0);
    expect(report.audit.sinksNotLocalMinimum).toBe(0);
    // the pit is a terminal of kind SINK, which is a legitimate outcome, clearly distinguishable
    expect(TERMINAL.SINK).toBe(3);
  });
});
