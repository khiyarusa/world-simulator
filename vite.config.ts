import { defineConfig } from 'vitest/config';

// Base must stay relative: Capacitor serves the bundle from https://localhost/ and an
// absolute base would break every asset URL inside the Android WebView.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1200,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['dot'],
    // Golden generation takes ~9 s on the documented 2-vCPU development box; the 5 s default
    // reports a slow machine as a failing world. CI is faster, so this budget is only headroom.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
