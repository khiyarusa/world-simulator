#!/usr/bin/env node
/**
 * S5-A3: a single long, large-preset run must finish with the invariant audit clean and a bounded
 * live heap. `balance` already keeps only the bounded rings the game keeps, so a growing heap would
 * mean a new unbounded store. The bound is deliberately generous (1.5 GB) and is a leak gate, not a
 * device-memory measurement; the A23 number remains a device-pass item.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'stress.json';
const report = JSON.parse(readFileSync(file, 'utf8'));
const seeds = Array.isArray(report.seedsDetail) ? report.seedsDetail : [];
const years = Number(report.years ?? 0);
const heapCeilingMb = Number(process.argv[3] ?? 1536);

if (seeds.length === 0) {
  console.error(`stress: ${file} contains no seed reports`);
  process.exit(1);
}
if (years < 500) {
  console.error(`stress: expected a 500-year run, found ${years}`);
  process.exit(1);
}

const failures = seeds.flatMap((s) => s.invariantFailures ?? []);
const maxHeap = Math.max(...seeds.map((s) => Number(s.heapEndMb ?? 0)));
const maxGrowth = Math.max(...seeds.map((s) => Number(s.heapEndMb ?? 0) - Number(s.heapStartMb ?? 0)));
const empty = seeds.filter((s) => Number(s.finalPopulation ?? 0) <= 0 || Number(s.livingSettlements ?? 0) <= 0);

for (const s of seeds) {
  console.log(
    `  seed ${s.seed}: pop ${s.finalPopulation} settlements ${s.livingSettlements}/${s.settlementsEnd} ` +
      `civs ${s.civs} events ${s.eventCount} heap ${s.heapStartMb}→${s.heapEndMb}MB ` +
      `save ${(Number(s.saveBytesRaw ?? 0) / 1048576).toFixed(3)}MB tick p95 ${s.tickP95}ms ` +
      `${(s.invariantFailures ?? []).length ? 'FAIL' : 'ok'}`,
  );
}
console.log(`stress: ${seeds.length} seed(s) × ${years} years; heap ceiling ${maxHeap}MB (limit ${heapCeilingMb}MB), growth ${maxGrowth}MB`);

if (failures.length > 0) {
  for (const f of failures.slice(0, 10)) console.error(`  ! ${f}`);
  console.error(`stress: ${failures.length} invariant failure(s)`);
  process.exit(1);
}
if (empty.length > 0) {
  console.error(`stress: ${empty.length} seed(s) ended with no population or no living settlement`);
  process.exit(1);
}
if (maxHeap > heapCeilingMb) {
  console.error(`stress: live heap ${maxHeap}MB exceeds the ${heapCeilingMb}MB leak ceiling`);
  process.exit(1);
}
console.log('stress: invariant audit clean and heap bounded');
