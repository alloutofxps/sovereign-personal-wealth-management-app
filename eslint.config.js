import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/* ===========================================================================
 * Architectural boundaries, enforced.
 * ---------------------------------------------------------------------------
 * The layering is core < data < app < design < features, and it only runs one way:
 *
 *   core     pure arithmetic and domain rules. No React, no DOM, no storage.
 *            Runs in Node under Vitest with no browser at all — which is what
 *            makes the ledger testable at the volume this domain needs.
 *   ingest   parsing bank files. Pure, and never touches the network.
 *   data     SQLite in a worker, repositories, and the live-query bus.
 *   app      configuration and the React bindings over core and data.
 *   design   tokens and UI primitives.
 *   charts   bespoke SVG charts over d3-shape and d3-scale.
 *   features vertical slices. May use everything below.
 *
 * A comment saying so decays. These rules do not.
 * ======================================================================== */

const LAYERS = [
  {
    target: './src/core',
    from: [
      './src/content',
      './src/ingest',
      './src/data',
      './src/app',
      './src/design',
      './src/charts',
      './src/features',
    ],
  },
  // Content is prose and nothing else. It may name a `Minor` and may not know
  // that a database or a React tree exists.
  {
    target: './src/content',
    from: ['./src/ingest', './src/data', './src/app', './src/design', './src/charts', './src/features'],
  },
  {
    target: './src/ingest',
    from: ['./src/data', './src/app', './src/design', './src/charts', './src/features'],
  },
  { target: './src/data', from: ['./src/app', './src/design', './src/charts', './src/features'] },
  { target: './src/app', from: ['./src/design', './src/charts', './src/features'] },
  { target: './src/design', from: ['./src/charts', './src/features'] },
  { target: './src/charts', from: ['./src/features'] },
];

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'public/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { import: importPlugin, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2022 },
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      /* ---------------------------------------------------------------------
       * A memo that reads a value it does not depend on is frozen at whatever
       * that value was on the first render.
       *
       * Phase 5 introduced exactly that and all three gates passed it: four
       * chart geometry memos read a measured `width` while depending only on
       * their data, which would have pinned every chart to its first-paint
       * 320-unit geometry — the same symptom as the bug being removed, made
       * permanent. It was caught by reading the diff, which is luck rather
       * than a control.
       *
       * `rules-of-hooks` is an error because a conditional hook is never
       * intentional. `exhaustive-deps` is a warning because a missing
       * dependency sometimes is: a deliberately-once effect is a real pattern,
       * and it is spelled with a comment rather than by silence.
       * ------------------------------------------------------------------ */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      'import/no-restricted-paths': [
        'error',
        {
          zones: LAYERS.flatMap(({ target, from }) =>
            from.map((f) => ({
              target,
              from: f,
              message: `Dependencies run one way: core < content < data < app < design < features. ${target} may not import from ${f}.`,
            })),
          ),
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /* --- the core layer is held to a stricter contract -------------------- */
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    languageOptions: {
      // No browser globals here at all. `Intl` is ECMA-402, not DOM, so
      // currency metadata still resolves.
      globals: { ...globals.es2022 },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'core is pure — no React below src/core.' },
            { name: 'react-dom', message: 'core is pure — no React below src/core.' },
            { name: 'motion', message: 'core is pure — no animation below src/core.' },
            { name: 'motion/react', message: 'core is pure — no animation below src/core.' },
            { name: 'zustand', message: 'core is pure — no store below src/core.' },
            { name: 'clsx', message: 'core renders nothing.' },
          ],
          patterns: [
            {
              group: ['@/ingest/*', '@/data/*', '@/app/*', '@/design/*', '@/charts/*', '@/features/*'],
              message: 'core imports nothing from the app.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'core must run in a worker and in Node — no DOM.' },
        { name: 'document', message: 'core must run in a worker and in Node — no DOM.' },
        { name: 'navigator', message: 'core must run in a worker and in Node — no DOM.' },
        { name: 'localStorage', message: 'core does not persist — that is the data layer.' },
        { name: 'sessionStorage', message: 'core does not persist — that is the data layer.' },
        { name: 'fetch', message: 'core does no I/O.' },
      ],
    },
  },

  /* --- tests and node scripts ------------------------------------------- */
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'scripts/**/*.mjs', '*.config.ts', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } },
    rules: {
      'no-console': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
