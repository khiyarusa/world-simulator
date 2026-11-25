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
  },
});
