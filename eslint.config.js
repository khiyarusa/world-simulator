import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Boundary rules are expressed here and mirrored by scripts/check-repo.mjs, which runs even
// where ESLint cannot resolve a file. AGENTS.md R-10 is the authority for all of them.
const SIM_BOUNDARY = [
  {
    group: ['pixi.js', '**/render/**', '**/ui/**', '**/platform/**', '**/app/**'],
    message: 'src/sim must stay renderer-independent (AGENTS.md R-10).',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-tools',
      'android',
      'node_modules',
      'coverage',
      'test-results',
      'playwright-report',
      '.opencode',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Deterministic RNG only (core/rng.ts).' },
      ],
    },
  },
  {
    // The simulation and its core primitives may not reach into presentation or I/O.
    files: ['src/core/**/*.ts', 'src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: SIM_BOUNDARY }],
    },
  },
  {
    // The worker may talk to the DOM-free runtime, the tools and tests may use Node.
    files: ['src/worker/**/*.ts', 'tools/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Plain-Node helper scripts are the only place process/console/Buffer belong.
    files: ['scripts/**/*.mjs', 'tests/perf/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
