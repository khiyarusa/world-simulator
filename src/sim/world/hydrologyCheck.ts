/**
 * Hydrology audit (stage 2.1, D-35).
 *
 * "River cells are on land" is not a validation. This module proves the contract the generator
 * actually implements:
 *
 *   1. every flow direction is 0..8 and, when not a sink, points strictly downhill on the *filled*
 *      surface (which is why a cycle is impossible — and the audit still checks for one);
 *   2. every river cell reaches the sea, a lake, or a sink within N steps;
 *   3. every sink is a local minimum of the filled surface (water stops only where it cannot fall).
 *
 * A sink that has a lower neighbour is a real defect (wrong flow direction), not a style issue.
 */
import { buildHydrology } from './hydrology.ts';
import type { HydrologyResult } from './hydrology.ts';

/** Mirrors hydrology.ts; a sink deeper than this would normally be classified as a lake. */
export const LAKE_MIN_DEPTH_DM = 12;

const DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
const DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;

export const TERMINAL = {
  UNKNOWN: 0,
  SEA: 1,
  LAKE: 2,
  SINK: 3,
  CYCLE: 4,
} as const;

export interface HydrologyAudit {
  readonly cells: number;
  readonly riverCells: number;
  readonly badDirection: number;
  readonly nonDescending: number;
  readonly cycles: number;
  readonly stranded: number;
  readonly riversToSea: number;
  readonly riversToLake: number;
  readonly riversToSink: number;
  readonly sinks: number;
  readonly sinksNotLocalMinimum: number;
  readonly shallowSinks: number;
  readonly deepSmallSinks: number;
  readonly maxRiverPath: number;
}

export interface HydrologyReport {
  readonly audit: HydrologyAudit;
  /** Empty means the hydrology satisfies the contract above. */
  readonly issues: readonly string[];
}

function downstream(index: number, dir: number, width: number, height: number): number {
  const x = index % width;
  const y = (index / width) | 0;
  const nx = x + (DX[dir] ?? 0);
  const ny = y + (DY[dir] ?? 0);
  if (nx < 0 || ny < 0 || nx >= width || ny >= height) return -1;
  return ny * width + nx;
}

/** Audit an existing hydrology result, or compute one from the elevation grid. */
export function auditHydrology(
  elevation: Int16Array,
  width: number,
  height: number,
  seaLevel: number,
  existing?: HydrologyResult,
): HydrologyReport {
  const hydro = existing ?? buildHydrology(elevation, width, height, seaLevel);
  const n = width * height;
  const issues: string[] = [];

  let badDirection = 0;
  let nonDescending = 0;
  let sinks = 0;
  let sinksNotLocalMinimum = 0;
  let shallowSinks = 0;
  let deepSmallSinks = 0;

  for (let i = 0; i < n; i++) {
    const dir = hydro.flowDir[i] ?? 8;
    if (dir > 8) {
      badDirection++;
      continue;
    }
    if (dir === 8) {
      // sink: must be a local minimum of the filled surface
      if (elevation[i]! >= seaLevel) {
        sinks++;
        const depth = (hydro.filled[i] ?? 0) - (elevation[i] ?? 0);
        if (depth < LAKE_MIN_DEPTH_DM) shallowSinks++;
        else deepSmallSinks++;
        const x = i % width;
        const y = (i / width) | 0;
        let lowerNeighbour = false;
        for (let d = 0; d < 8; d++) {
          const nx = x + (DX[d] ?? 0);
          const ny = y + (DY[d] ?? 0);
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if ((hydro.filled[ny * width + nx] ?? 0) < (hydro.filled[i] ?? 0)) lowerNeighbour = true;
        }
        if (lowerNeighbour) sinksNotLocalMinimum++;
      }
      continue;
    }
    const j = downstream(i, dir, width, height);
    if (j < 0) {
      badDirection++;
      continue;
    }
    if ((hydro.filled[j] ?? 0) >= (hydro.filled[i] ?? 0)) nonDescending++;
  }

  // --- terminals for river cells, memoised
  const memo = new Uint8Array(n); // 0 unknown, 1 sea, 2 lake, 3 sink, 4 cycle
  const stack = new Int32Array(n);
  let cycles = 0;
  let stranded = 0;
  let riversToSea = 0;
  let riversToLake = 0;
  let riversToSink = 0;
  let maxRiverPath = 0;

  const terminalOf = (cell: number): number => {
    if ((elevation[cell] ?? 0) < seaLevel) return TERMINAL.SEA;
    if ((hydro.lakeId[cell] ?? 0) !== 0) return TERMINAL.LAKE;
    return TERMINAL.UNKNOWN;
  };

  for (let start = 0; start < n; start++) {
    if ((hydro.riverId[start] ?? 0) === 0 || memo[start] !== 0) continue;

    let sp = 0;
    let cur = start;
    let steps = 0;
    let result = TERMINAL.UNKNOWN;

    for (;;) {
      if (memo[cur] !== 0) {
        result = memo[cur]!;
        break;
      }
      const known = terminalOf(cur);
      if (known !== TERMINAL.UNKNOWN) {
        memo[cur] = known;
        result = known;
        break;
      }
      const dir = hydro.flowDir[cur] ?? 8;
      if (dir === 8) {
        memo[cur] = TERMINAL.SINK;
        result = TERMINAL.SINK;
        break;
      }
      if (sp >= n - 1) {
        result = TERMINAL.CYCLE;
        break;
      }
      stack[sp] = cur;
      sp++;
      steps++;
      if (steps > n) {
        result = TERMINAL.CYCLE;
        break;
      }
      const next = downstream(cur, dir, width, height);
      if (next < 0) {
        result = TERMINAL.CYCLE;
        break;
      }
      cur = next;
    }

    if (result === TERMINAL.CYCLE) {
      cycles++;
      stranded++;
    }
    for (let k = sp - 1; k >= 0; k--) {
      const cell = stack[k]!;
      if (result === TERMINAL.CYCLE) break;
      memo[cell] = result;
    }

    if (steps > maxRiverPath) maxRiverPath = steps;
    if (result === TERMINAL.SEA) riversToSea++;
    else if (result === TERMINAL.LAKE) riversToLake++;
    else if (result === TERMINAL.SINK) riversToSink++;
  }

  let riverCells = 0;
  for (let i = 0; i < n; i++) if ((hydro.riverId[i] ?? 0) !== 0) riverCells++;

  if (badDirection > 0) issues.push(`${badDirection} flow direction(s) invalid or off-grid`);
  if (nonDescending > 0) issues.push(`${nonDescending} flow step(s) do not descend on the filled surface`);
  if (cycles > 0) issues.push(`${cycles} river path(s) did not terminate (cycle or runaway)`);
  if (sinksNotLocalMinimum > 0) issues.push(`${sinksNotLocalMinimum} sink(s) have a lower neighbour`);
  if (riverCells > 0 && riversToSea + riversToLake + riversToSink === 0) {
    issues.push('river cells exist but none reaches a terminal');
  }

  return {
    audit: {
      cells: n,
      riverCells,
      badDirection,
      nonDescending,
      cycles,
      stranded,
      riversToSea,
      riversToLake,
      riversToSink,
      sinks,
      sinksNotLocalMinimum,
      shallowSinks,
      deepSmallSinks,
      maxRiverPath,
    },
    issues,
  };
}
