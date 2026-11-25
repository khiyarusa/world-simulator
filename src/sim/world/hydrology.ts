/**
 * Deterministic hydrology: depression filling (priority flood), D8 flow, accumulation,
 * rivers and lakes. Every tie-break is by cell index, so the result is a pure function of
 * the elevation grid (docs/WORLD_GENERATION.md §4.3).
 */

const DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
const DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;

export const RIVER_THRESHOLD = 24;
const WIDTH_STEPS = [24, 80, 300, 1200, 5000] as const;
const LAKE_MIN_CELLS = 8;
const LAKE_MIN_DEPTH = 12; // decimetres

export interface HydrologyResult {
  /** Elevation after depression filling, decimetres. */
  filled: Int32Array;
  /** 0..7 = downstream neighbour index, 8 = outlet/sink. */
  flowDir: Uint8Array;
  accumulation: Uint32Array;
  riverId: Uint16Array;
  riverWidth: Uint8Array;
  lakeId: Uint16Array;
  lakeVolume: Uint32Array;
  riverCells: number;
  lakeCells: number;
  lakeCount: number;
}

/** Minimal binary min-heap keyed by (elevation, index). Deterministic by construction. */
class MinHeap {
  private readonly keys: Int32Array;
  private readonly vals: Int32Array;
  private size = 0;

  constructor(capacity: number) {
    this.keys = new Int32Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(key: number, value: number): void {
    if (this.size >= this.keys.length) throw new Error('MinHeap: capacity exceeded');
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = value;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(parent, i)) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  popValue(): number {
    const top = this.vals[0]!;
    const last = --this.size;
    this.keys[0] = this.keys[last]!;
    this.vals[0] = this.vals[last]!;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let best = i;
      if (l < this.size && this.less(l, best)) best = l;
      if (r < this.size && this.less(r, best)) best = r;
      if (best === i) break;
      this.swap(best, i);
      i = best;
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a]!;
    const kb = this.keys[b]!;
    return ka < kb || (ka === kb && this.vals[a]! < this.vals[b]!);
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = k;
    const v = this.vals[a]!;
    this.vals[a] = this.vals[b]!;
    this.vals[b] = v;
  }
}

export function buildHydrology(
  elevation: Int16Array,
  width: number,
  height: number,
  seaLevel: number,
): HydrologyResult {
  const n = width * height;
  const filled = new Int32Array(n).fill(0x7fffffff);
  const heap = new MinHeap(n + 1);

  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = y * width + x;
      if (filled[i] !== 0x7fffffff) continue;
      filled[i] = elevation[i]!;
      heap.push(filled[i]!, i);
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const i = y * width + x;
      if (filled[i] !== 0x7fffffff) continue;
      filled[i] = elevation[i]!;
      heap.push(filled[i]!, i);
    }
  }

  while (heap.length > 0) {
    const i = heap.popValue();
    const x = i % width;
    const y = (i / width) | 0;
    const base = filled[i]!;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (filled[j] !== 0x7fffffff) continue;
      const e = elevation[j]!;
      filled[j] = e > base ? e : base;
      heap.push(filled[j]!, j);
    }
  }

  // ---- flow direction: steepest descent on the filled surface, tie-break by direction order
  const flowDir = new Uint8Array(n).fill(8);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const here = filled[i]!;
      let best = here;
      let bestDir = 8;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const v = filled[ny * width + nx]!;
        if (v < best) {
          best = v;
          bestDir = d;
        }
      }
      flowDir[i] = bestDir;
    }
  }

  // ---- accumulation: process cells high -> low (counting sort on filled elevation)
  let minFill = 0x7fffffff;
  let maxFill = -0x80000000;
  for (let i = 0; i < n; i++) {
    const v = filled[i]!;
    if (v < minFill) minFill = v;
    if (v > maxFill) maxFill = v;
  }
  const bucketCount = Math.max(1, maxFill - minFill + 1);
  const buckets = new Uint32Array(bucketCount + 1);
  for (let i = 0; i < n; i++) {
    const b = filled[i]! - minFill;
    buckets[b] = (buckets[b] ?? 0) + 1;
  }
  let running = 0;
  for (let b = 0; b < bucketCount; b++) {
    running += buckets[b]!;
    buckets[b] = running;
  }
  const order = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const b = filled[i]! - minFill;
    buckets[b] = (buckets[b] ?? 0) - 1;
    order[buckets[b]!] = i;
  }

  const accumulation = new Uint32Array(n);
  for (let k = n - 1; k >= 0; k--) {
    const i = order[k]!;
    accumulation[i] = (accumulation[i] ?? 0) + 1;
    const dir = flowDir[i]!;
    if (dir === 8) continue;
    const x = i % width;
    const y = (i / width) | 0;
    const j = (y + DY[dir]!) * width + (x + DX[dir]!);
    accumulation[j] = (accumulation[j] ?? 0) + accumulation[i]!;
  }

  // ---- lakes: filled above the real surface, grouped by 4-connectivity
  const lakeId = new Uint16Array(n);
  const lakeVolume = new Uint32Array(n);
  const candidate = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (elevation[i]! < seaLevel) continue;
    if (filled[i]! - elevation[i]! >= LAKE_MIN_DEPTH) candidate[i] = 1;
  }

  let lakeCount = 0;
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (candidate[start] !== 1) continue;
    let sp = 0;
    stack[sp] = start;
    sp++;
    candidate[start] = 2;
    let cells = 0;
    let volume = 0;
    while (sp > 0) {
      sp--;
      const i = stack[sp]!;
      cells++;
      volume += filled[i]! - elevation[i]!;
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0) {
        const j = i - 1;
        if (candidate[j] === 1) {
          candidate[j] = 2;
          stack[sp] = j;
          sp++;
        }
      }
      if (x < width - 1) {
        const j = i + 1;
        if (candidate[j] === 1) {
          candidate[j] = 2;
          stack[sp] = j;
          sp++;
        }
      }
      if (y > 0) {
        const j = i - width;
        if (candidate[j] === 1) {
          candidate[j] = 2;
          stack[sp] = j;
          sp++;
        }
      }
      if (y < height - 1) {
        const j = i + width;
        if (candidate[j] === 1) {
          candidate[j] = 2;
          stack[sp] = j;
          sp++;
        }
      }
    }
    if (cells < LAKE_MIN_CELLS) continue;
    if (lakeCount >= 0xfffe) break;
    lakeCount++;
    const id = lakeCount;
    let sp2 = 0;
    stack[sp2] = start;
    sp2++;
    lakeId[start] = id;
    lakeVolume[start] = volume;
    while (sp2 > 0) {
      sp2--;
      const i = stack[sp2]!;
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0) sp2 = pushLake(i - 1, id, candidate, lakeId, lakeVolume, volume, stack, sp2);
      if (x < width - 1) sp2 = pushLake(i + 1, id, candidate, lakeId, lakeVolume, volume, stack, sp2);
      if (y > 0) sp2 = pushLake(i - width, id, candidate, lakeId, lakeVolume, volume, stack, sp2);
      if (y < height - 1) sp2 = pushLake(i + width, id, candidate, lakeId, lakeVolume, volume, stack, sp2);
    }
  }

  // ---- rivers
  const riverId = new Uint16Array(n);
  const riverWidth = new Uint8Array(n);
  let riverCells = 0;
  let nextRiver = 0;
  for (let i = 0; i < n; i++) {
    const isLand = elevation[i]! >= seaLevel;
    if (!isLand || lakeId[i] !== 0) continue;
    if (accumulation[i]! < RIVER_THRESHOLD) continue;
    riverCells++;
    const acc = accumulation[i]!;
    let tier = 1;
    for (let s = 0; s < WIDTH_STEPS.length; s++) if (acc >= WIDTH_STEPS[s]!) tier = s + 1;
    riverWidth[i] = tier;
    if (riverId[i] !== 0) continue;
    nextRiver++;
    if (nextRiver > 0xfffe) {
      nextRiver = 0xfffe;
      continue;
    }
    // Label the downstream run so rivers are addressable as entities.
    let cur = i;
    let guard = 0;
    while (guard++ < n) {
      riverId[cur] = nextRiver;
      const dir = flowDir[cur]!;
      if (dir === 8) break;
      const x = cur % width;
      const y = (cur / width) | 0;
      const j = (y + DY[dir]!) * width + (x + DX[dir]!);
      if (elevation[j]! < seaLevel || lakeId[j] !== 0) break;
      if (accumulation[j]! < RIVER_THRESHOLD) break;
      if (riverId[j] !== 0) break;
      cur = j;
    }
  }

  let lakeCells = 0;
  for (let i = 0; i < n; i++) if (lakeId[i] !== 0) lakeCells++;

  return { filled, flowDir, accumulation, riverId, riverWidth, lakeId, lakeVolume, riverCells, lakeCells, lakeCount };
}

function pushLake(
  j: number,
  id: number,
  candidate: Uint8Array,
  lakeId: Uint16Array,
  lakeVolume: Uint32Array,
  volume: number,
  stack: Int32Array,
  sp: number,
): number {
  if (candidate[j] !== 2 || lakeId[j] !== 0) return sp;
  lakeId[j] = id;
  lakeVolume[j] = volume;
  stack[sp] = j;
  return sp + 1;
}

/** Follow one step downstream; -1 means outlet. Exposed for validation tests. */export function downstreamIndex(
  index: number,
  flowDir: Uint8Array,
  width: number,
  height: number,
): number {
  const dir = flowDir[index] ?? 8;
  if (dir === 8) return -1;
  const x = index % width;
  const y = (index / width) | 0;
  const nx = x + (DX[dir] ?? 0);
  const ny = y + (DY[dir] ?? 0);
  if (nx < 0 || ny < 0 || nx >= width || ny >= height) return -1;
  return ny * width + nx;
}
