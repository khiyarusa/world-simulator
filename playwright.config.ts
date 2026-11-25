import { defineConfig, devices } from '@playwright/test';

// Chromium only: the product is an Android WebView (Chromium). SwiftShader proves
// correctness here, never frame rate (docs/QA_AND_CI_STRATEGY.md §10).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], hasTouch: true, isMobile: false } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
