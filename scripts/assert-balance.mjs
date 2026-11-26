#!/usr/bin/env node
/**
 * Reads the balance report and states the S3-A1/A3 facts without inventing them.
 * Exit code is non-zero only for invariant failures; population outside the band is reported, because
 * tuning -- not a failing gate -- is what changes it, and the gate is evaluated by a human/CI reviewer.
 */
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2] ?? 'balance.json', 'utf8'));
const failures = report.seedsDetail.filter((s) => s.invariantFailures.length > 0);
const inBand = report.seedsDetail.filter((s) => s.finalPopulation >= 150000 && s.finalPopulation <= 800000);

console.log(`seeds: ${report.seeds}  years: ${report.years}  elapsed: ${report.elapsedMs}ms`);
console.log(`population: min ${report.population.min}  median ${report.population.median}  max ${report.population.max}`);
console.log(`in band 150k-800k: ${inBand.length}/${report.seeds}`);
for (const s of report.seedsDetail) {
  console.log(
    `  seed ${s.seed}: pop ${s.initialPopulation} -> ${s.finalPopulation}  settlers ${s.livingSettlements}/${s.settlements}  ` +
      `births ${s.births} deaths ${s.deaths} abandon ${s.abandonments}  food ${s.foodPerCapitaDays}d  ` +
      `events ${s.eventCount}  tick p95 ${s.tickP95}ms  ${s.invariantFailures.length ? 'FAIL' : 'ok'}`,
  );
  for (const f of s.invariantFailures.slice(0, 5)) console.log(`    ! ${f}`);
}

if (failures.length > 0) {
  console.error(`balance: ${failures.length} seed(s) failed invariants`);
  process.exit(1);
}
console.log('balance: every seed satisfied the invariant audit');
