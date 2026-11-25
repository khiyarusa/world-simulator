#!/usr/bin/env node
/**
 * Compare two determinism reports produced by two separate Node processes.
 * Elapsed time is ignored (it is a measurement, not a result); every world hash must match.
 */
import { readFileSync } from 'node:fs';

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error('usage: compare-determinism.mjs <a.json> <b.json>');
  process.exit(2);
}

const a = JSON.parse(readFileSync(aPath, 'utf8'));
const b = JSON.parse(readFileSync(bPath, 'utf8'));

const key = (w) => `${w.preset}/${w.seed}`;
const mapA = new Map(a.worlds.map((w) => [key(w), w.hash]));
const mapB = new Map(b.worlds.map((w) => [key(w), w.hash]));

const problems = [];
if (mapA.size !== mapB.size) problems.push(`world count differs: ${mapA.size} vs ${mapB.size}`);
if (a.generatorVersion !== b.generatorVersion) problems.push('generatorVersion differs');

let checked = 0;
for (const [k, hash] of mapA) {
  const other = mapB.get(k);
  if (other === undefined) problems.push(`missing in second run: ${k}`);
  else if (other !== hash) problems.push(`hash mismatch for ${k}: ${hash} vs ${other}`);
  else checked++;
}

if (problems.length > 0) {
  console.error(`determinism: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`determinism: ${checked} worlds identical across two fresh processes`);
