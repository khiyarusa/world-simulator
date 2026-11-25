/**
 * Fixed-timestep scheduler (docs/TECHNICAL_ARCHITECTURE.md §6).
 *
 * Speed scales the accumulator, never the tick size: one tick is always exactly one day.
 * Real elapsed time is clamped so a backgrounded tab cannot queue an hour of history.
 */
import type { Speed } from './protocol.ts';
import { DAY_MS, MAX_BACKLOG, MAX_TICKS_PER_PASS } from './protocol.ts';

export interface SchedulerOptions {
  readonly dayMs?: number;
  readonly maxTicksPerPass?: number;
  readonly maxBacklog?: number;
  readonly maxRealDeltaMs?: number;
}

export class Scheduler {
  readonly dayMs: number;
  readonly maxTicksPerPass: number;
  readonly maxBacklog: number;
  readonly maxRealDeltaMs: number;

  private accumulator = 0;
  private droppedTotal = 0;
  speed: Speed = 0;

  constructor(opts: SchedulerOptions = {}) {
    this.dayMs = opts.dayMs ?? DAY_MS;
    this.maxTicksPerPass = opts.maxTicksPerPass ?? MAX_TICKS_PER_PASS;
    this.maxBacklog = opts.maxBacklog ?? MAX_BACKLOG;
    this.maxRealDeltaMs = opts.maxRealDeltaMs ?? 250;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  /** Simulated milliseconds still owed (never above the backlog cap). */
  get backlogTicks(): number {
    return this.accumulator / this.dayMs;
  }

  get dropped(): number {
    return this.droppedTotal;
  }

  reset(): void {
    this.accumulator = 0;
  }

  /**
   * Feed real elapsed milliseconds and return how many day-ticks may run now.
   * Call again with 0 while it keeps returning a full batch.
   */
  advance(realMs: number): number {
    if (this.speed === 0) {
      this.accumulator = 0;
      return 0;
    }
    const dt = realMs > 0 ? Math.min(realMs, this.maxRealDeltaMs) : 0;
    this.accumulator += dt * this.speed;

    const cap = this.maxBacklog * this.dayMs;
    if (this.accumulator > cap) {
      const droppedTicks = Math.floor((this.accumulator - cap) / this.dayMs);
      this.droppedTotal += droppedTicks;
      this.accumulator = cap;
    }

    const due = Math.floor(this.accumulator / this.dayMs);
    if (due <= 0) return 0;
    const run = Math.min(due, this.maxTicksPerPass);
    this.accumulator -= run * this.dayMs;
    return run;
  }
}
