import { defineConfig, devices } from '@playwright/test';

// Chromium only: the product is an Android WebView (Chromium). SwiftShader proves
// correctness here, never frame rate (docs/QA_AND_CI_STRATEGY.md §10).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        hasTouch: true,
        isMobile: false,
        launchOptions: {
          // Headless Chromium has no GPU: force the ANGLE/SwiftShader path so WebGL exists.
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    // A plain static server instead of `vite preview`: predictable in CI, no config reads, and it
    // fails loudly if `dist` was not built.
    command: 'node scripts/serve-dist.mjs 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
