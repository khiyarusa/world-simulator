#!/usr/bin/env node
/** APK size gate (docs/ROADMAP_5_STAGES.md S5-A6, docs/PERFORMANCE_BUDGET.md §4). */
import { statSync } from 'node:fs';

const [file, limitMbRaw] = process.argv.slice(2);
if (!file) {
  console.error('usage: check-apk-size.mjs <apk> [limitMb=25]');
  process.exit(2);
}
const limitMb = Number(limitMbRaw ?? 25);
const bytes = statSync(file).size;
const mb = bytes / (1024 * 1024);
const limit = limitMb * 1024 * 1024;

console.log(`${file}: ${mb.toFixed(2)} MB (limit ${limitMb} MB)`);
if (bytes > limit) {
  console.error('APK exceeds the size budget');
  process.exit(1);
}
