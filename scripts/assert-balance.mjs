#!/usr/bin/env node
/**
 * Reads the balance report and states the S3-A1/A2/A3/A7/A8 facts without inventing them.
 * Exit code is non-zero only for invariant failures; population outside the band is reported, because
 * tuning -- not a failing gate -- is what changes it, and the gate is evaluated by a human/CI reviewer.
 */
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2] ?? 'balance.json', 'utf8'));
const seeds = report.seedsDetail;
const failures = seeds.filter((s) => s.invariantFailures.length > 0);
const inBand = seeds.filter((s) => s.finalPopulation >= 150000 && s.finalPopulation <= 800000);

console.log(`seeds: ${report.seeds}  years: ${report.years}  elapsed: ${report.elapsedMs}ms (+${report.interventionReport?.elapsedMs ?? 0}ms blight)`);
console.log(`population: min ${report.population.min}  median ${report.population.median}  max ${report.population.max}`);
console.log(`in band 150k-800k: ${inBand.length}/${report.seeds}`);
for (const [arc, hits] of Object.entries(report.arcHits)) console.log(`arc ${arc}: ${hits}/${report.seeds}`);
for (const [arc, hits] of Object.entries(report.interventionReport?.arcHits ?? {})) {
  console.log(`arc(blight) ${arc}: ${hits}/${report.seeds}`);
}
for (const s of seeds) {
  console.log(
    `  seed ${s.seed}: pop ${s.initialPopulation} -> ${s.finalPopulation} (peak ${s.peakPopulation})  ` +
      `settlers ${s.livingSettlements}/${s.settlementsEnd}  civs ${s.civs}  ` +
      `births ${s.births} deaths ${s.deaths} (starve ${s.starvationDeaths}, plague ${s.epidemicDeaths}, war ${s.warDeaths})  ` +
      `food ${s.foodDaysEnd}d med ${s.medianFoodDays}d (prod/cons ${s.foodRatio}) starving ${s.starvingSharePm}pm  ` +
      `health ${s.healthAvg} stab ${s.stabilityAvg} farmers ${s.farmerSharePm}pm landPm ${s.landPmAvg}  ` +
      `land cap ${s.landCapacityAvg} (fert ${s.fertilityAvg})  routes ${s.routesOpened}/${s.routesLost} kept ${s.routesEnd}  wars ${s.warsDeclared}/${s.warsEnded}  ` +
      `events ${s.eventCount} (famine ${s.famineEvents}, plague ${s.epidemicEvents})  ` +
      `gate best str ${s.warDiagnostics.maxStrength} grief ${s.warDiagnostics.maxGrievance} ` +
      `cap ${s.warDiagnostics.maxCapacity} util ${s.warDiagnostics.maxUtility} pass ${s.warDiagnostics.passingPairs}  ` +
      `save ${(s.saveBytesRaw / 1048576).toFixed(3)}MB/${s.saveMs}ms  ` +
      `tick p95 ${s.tickP95}ms  ${s.invariantFailures.length ? 'FAIL' : 'ok'}`,
  );
  for (const arc of s.arcs) if (arc.present) console.log(`    arc ${arc.type}: ${arc.evidence}`);
  for (const f of s.invariantFailures.slice(0, 5)) console.log(`    ! ${f}`);
}

const wars = seeds.reduce((n, s) => n + s.warSamples.length, 0);
const gatePass = seeds.every((s) => s.warSamples.every((w) => w.gatePass));
console.log(`wars sampled: ${wars}; every declaration reproduces all four gate values: ${gatePass}`);
const causeFailures = seeds.reduce((n, s) => n + s.causeFailures, 0);
console.log(`severe events without an available cause or explicit root: ${causeFailures}`);

if (failures.length > 0) {
  console.error(`balance: ${failures.length} seed(s) failed invariants`);
  process.exit(1);
}
console.log('balance: every seed satisfied the invariant audit');
