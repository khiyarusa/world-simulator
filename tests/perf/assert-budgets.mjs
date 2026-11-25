#!/usr/bin/env node
/**
 * Budget gate for the headless simulation benchmark (docs/PERFORMANCE_BUDGET.md §10.1).
 *
 * Numbers here are regression guards measured on a GitHub runner — they are NOT a claim about a
 * Galaxy A23. Device budgets are validated by the manual protocol in the performance doc.
 */
import { existsSync, readFileSync } from 'node:fs';

const [perfPath, ...rest] = process.argv.slice(2);
if (!perfPath) {
  console.error('usage: assert-budgets.mjs <perf.json> [--baseline=path] [--regression=20]');
  process.exit(2);
}

const baselineArg = rest.find((a) => a.startsWith('--baseline='))?.split('=')[1];
const regressionPct = Number(rest.find((a) => a.startsWith('--regression='))?.split('=')[1] ?? 20);

const perf = JSON.parse(readFileSync(perfPath, 'utf8'));
const p95 = perf.day1x?.p95 ?? Infinity;
const max = perf.day1x?.max ?? Infinity;
const heapPer10k = perf.heapGrowthPer10kTicks ?? 0;

const failures = [];
const notes = [];

// Absolute budgets. Sim ticks are no-ops in Stage 2, so these are loose on purpose: they exist to
// catch an accidental O(n^2) or a per-tick allocation regression, not to certify speed.
if (p95 > 3) failures.push(`tick p95 ${p95}ms exceeds the 3ms CI budget`);
if (max > 8) failures.push(`tick max ${max}ms exceeds the 8ms CI budget`);
if (heapPer10k > 1_048_576) failures.push(`heap growth ${Math.round(heapPer10k)}B/10k ticks exceeds 1MB`);

if (baselineArg) {
  if (existsSync(baselineArg)) {
    const baseline = JSON.parse(readFileSync(baselineArg, 'utf8'));
    const baseP95 = baseline.day1x?.p95 ?? 0;
    if (baseP95 > 0) {
      // Floor: sub-0.02 ms timings are timer noise, not a regression signal.
      const allowed = Math.max(0.02, baseP95 * (1 + regressionPct / 100));
      if (p95 > allowed) failures.push(`tick p95 ${p95}ms regressed >${regressionPct}% over baseline ${baseP95}ms`);
      else notes.push(`p95 within ${regressionPct}% of baseline (${baseP95}ms)`);
    }
  } else {
    notes.push(`no baseline at ${baselineArg}; absolute budgets applied only`);
  }
}

for (const note of notes) console.log(`note: ${note}`);

if (failures.length > 0) {
  console.error(`perf: ${failures.length} budget failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`perf: ok (p95 ${p95}ms, max ${max}ms, heap ${Math.round(heapPer10k)}B/10k ticks)`);
