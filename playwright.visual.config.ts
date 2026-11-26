import { defineConfig } from '@playwright/test';

/**
 * Visual QA configuration. Kept separate from the E2E config because it pins a phone viewport and
 * writes the curated captures into `docs/qa/stage4/`. It runs the real production bundle.
 */
export default defineConfig({
  testDir: 'tests/visual',
  timeout: 600_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/visual',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'node scripts/serve-dist.mjs 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
