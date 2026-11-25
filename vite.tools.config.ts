import { defineConfig } from 'vite';

// Headless tooling bundle: the simulation, checksums and generators compiled to one ESM file so
// CI can run determinism and perf jobs in plain Node without a second toolchain.
export default defineConfig({
  build: {
    ssr: 'tools/entry.ts',
    outDir: 'dist-tools',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: false,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'tools.js' },
    },
  },
});
