import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-tools', 'android', 'node_modules', 'coverage', 'test-results', '.opencode'] },
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
      eqeqeq: ['error', 'always'],
      'no-restricted-globals': ['error', 'name', 'event', 'fdescribe'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Deterministic RNG only (core/rng.ts).' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', '**/render/**', '**/ui/**', '**/platform/**'],
              message: 'src/sim must stay renderer-independent (AGENTS.md R-10).',
            },
          ],
        },
      ],
    },
  },
  {
    // Boundary rule only applies to the simulation core.
    files: ['src/core/**/*.ts', 'src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', '*/render/*', '*/ui/*', '*/platform/*', '*/app/*'],
              message: 'src/sim must stay renderer-independent (AGENTS.md R-10).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/worker/**/*.ts', 'tools/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Plain-Node helper scripts: the only place `process`, `console` and `Buffer` legitimately
    // appear (the game itself never runs in Node).
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
