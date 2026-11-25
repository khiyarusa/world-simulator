#!/usr/bin/env node
/**
 * Repository-level gates that a general linter cannot express (docs/QA_AND_CI_STRATEGY.md §3).
 * Read-only: prints every violation and exits 1 if any.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sourceFiles = walk(join(root, 'src')).filter((f) => f.endsWith('.ts'));
const forbidden = [
  { pattern: /\bMath\.random\s*\(/, why: 'Math.random destroys reproducibility (AGENTS.md R-15)' },
  { pattern: /\bDate\.now\s*\(/, why: 'wall clock in a deterministic path (R-15)' },
  { pattern: /\bperformance\.now\s*\(/, why: 'wall clock in a deterministic path (R-15)' },
  { pattern: /\bcrypto\./, why: 'unseeded randomness (R-15)' },
  { pattern: /\blocaleCompare\b|\btoLocaleString\b/, why: 'locale-dependent ordering (R-17)' },
  { pattern: /\bMath\.(sin|cos|tan|pow|exp|log)\s*\(/, why: 'transcendental math is not bit-identical across engines (R-17)' },
];

for (const file of sourceFiles) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  // Only pure simulation code is held to the determinism rules; the worker may read a wall
  // clock for scheduling and diagnostics as long as that value never enters world state.
  const isSim = rel.startsWith('src/sim/') || rel.startsWith('src/core/');
  if (!isSim) continue;
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) failures.push(`${rel}: ${rule.why}`);
  }
  if (/\bfrom\s+['"]pixi\.js['"]/.test(text)) failures.push(`${rel}: simulation must not import pixi.js (R-10)`);
  if (/\bfrom\s+['"][^'"]*\/(render|ui|app)\//.test(text)) {
    failures.push(`${rel}: simulation must not import render/ui/app (R-10)`);
  }
  if (/\bfrom\s+['"][^'"]*\/platform\//.test(text)) failures.push(`${rel}: simulation must not import platform (R-10)`);
}

// file length discipline (soft 300, hard 500)
for (const file of [...sourceFiles, ...walk(join(root, 'tools')).filter((f) => f.endsWith('.ts'))]) {
  const lines = readFileSync(file, 'utf8').split('\n').length;
  if (lines > 500) failures.push(`${relative(root, file)}: ${lines} lines exceeds the 500-line hard limit`);
}

// docs: every relative link must resolve, and no parked work markers
const docs = walk(join(root, 'docs')).filter((f) => f.endsWith('.md'));
for (const file of docs) {
  const text = readFileSync(file, 'utf8');
  if (/\b(TODO|FIXME)\b/.test(text)) failures.push(`${relative(root, file)}: contains TODO/FIXME (R-43)`);
  for (const match of text.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) {
    const target = (match[1] ?? '').split('#')[0];
    if (!target) continue;
    const resolved = join(root, 'docs', target);
    try {
      statSync(resolved);
    } catch {
      // links may point at the repo root from docs/
      try {
        statSync(join(root, target));
      } catch {
        failures.push(`${relative(root, file)}: broken link ${target}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`check-repo: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-repo: ok');
