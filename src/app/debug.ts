/**
 * Debug overlay formatting (docs/PERFORMANCE_BUDGET.md §11).
 *
 * Compiled in, hidden unless `?debug=1`. Every value here is measured, never estimated — except
 * heap, which the browser only exposes on Chromium.
 */

export interface DebugSample {
  readonly day: number;
  readonly speed: number;
  readonly season: string;
  readonly tickP50: number;
  readonly tickP95: number;
  readonly tickMax: number;
  readonly dropped: number;
  readonly zoom: number;
  readonly camX: number;
  readonly camY: number;
  readonly settlements: number;
  readonly population: number;
  readonly frameP50: number;
  readonly frameP95: number;
}

export function isDebugEnabled(search: string): boolean {
  return new URLSearchParams(search).has('debug');
}

export function formatDebug(sample: DebugSample): string {
  const heap = heapMb();
  return [
    `day ${sample.day}  speed ${sample.speed}×  ${sample.season}`,
    `tick p50 ${sample.tickP50.toFixed(2)}ms  p95 ${sample.tickP95.toFixed(2)}ms  max ${sample.tickMax.toFixed(2)}ms`,
    `frame p50 ${sample.frameP50.toFixed(1)}ms  p95 ${sample.frameP95.toFixed(1)}ms`,
    `dropped ${sample.dropped}`,
    `zoom ${sample.zoom.toFixed(3)}  cam ${Math.round(sample.camX)},${Math.round(sample.camY)}`,
    `settlements ${sample.settlements}  pop ${sample.population}`,
    `heap ${heap}`,
  ].join('\n');
}

export function heapMb(): string {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  const used = perf.memory?.usedJSHeapSize;
  return used ? `${Math.round(used / 1_048_576)} MB` : 'n/a';
}

/** Rolling frame-time window; the renderer feeds it once per tick of its ticker. */
export class FrameTimer {
  private readonly samples = new Float32Array(120);
  private cursor = 0;
  private filled = 0;

  push(ms: number): void {
    this.samples[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % this.samples.length;
    if (this.filled < this.samples.length) this.filled++;
  }

  percentile(p: number): number {
    if (this.filled === 0) return 0;
    const copy = Array.from(this.samples.subarray(0, this.filled)).sort((a, b) => a - b);
    const idx = Math.min(copy.length - 1, Math.floor((copy.length - 1) * p));
    return copy[idx] ?? 0;
  }
}
