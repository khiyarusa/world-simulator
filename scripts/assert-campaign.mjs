#!/usr/bin/env node
/**
 * Campaign journey gate. A campaign that never offers work, never changes a priority or quietly
 * fails its invariant audit is not a playable system, whatever its UI looks like.
 */
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2] ?? 'campaign.json', 'utf8'));
const rows = Array.isArray(report.rows) ? report.rows : [];
if (rows.length === 0) {
  console.error('campaign: no seed rows');
  process.exit(1);
}
let failed = false;
for (const r of rows) {
  const issues = r.invariantFailures ?? [];
  const progress = (r.milestones ?? 0) + (r.holds ?? 0);
  console.log(
    `  seed ${r.seed}: pop ${r.population} settlements ${r.settlements} civs ${r.civs} ` +
      `era ${r.era} milestones ${r.milestones} holds ${r.holds} seals ${r.seals} ` +
      `offers ${r.objectivesOffered} accepted ${r.objectivesAccepted} completed ${r.objectivesCompleted} ` +
      `charters ${r.activeCharters} ${issues.length ? 'FAIL' : 'ok'}`,
  );
  if (issues.length > 0) {
    failed = true;
    for (const i of issues.slice(0, 5)) console.error(`    ! ${i}`);
  }
  if ((r.objectivesOffered ?? 0) < 3) {
    failed = true;
    console.error('    ! fewer than three objectives were generated in the journey');
  }
  if (progress < 1) {
    failed = true;
    console.error('    ! no milestone progress in the journey');
  }
  if ((r.activeCharters ?? 0) < 1) {
    failed = true;
    console.error('    ! the scripted steward issued no active charter');
  }
}
if (failed) {
  console.error('campaign: journey gate failed');
  process.exit(1);
}
console.log(`campaign: ${rows.length} seeds x ${report.years} years, invariant audit and journey gate clean`);
