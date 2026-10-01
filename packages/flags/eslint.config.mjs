// ESLint for @ocr/flags (OSE-1461).
//
// The root eslint.config.js ignores **/*.ts, and the root CI lint only covers
// config/ scripts/ tests/unit/ tests/contract/, so before this file no linter
// had ever read this package. It lints the whole package:
//   - TypeScript (src, tests, vitest.config.ts): typescript-eslint
//     recommendedTypeChecked against tsconfig.tests.json, the same program
//     `npm run typecheck` uses.
//   - .mjs (scripts/generate-from-yaml.mjs, this file): ESLint recommended
//     with Node globals; no type information.
// .mjs, not .js: the root lint-staged hook parses *.js with the root config,
// which reads a .js file here as a CommonJS script and rejects `import`.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.tests.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // StorageAdapter is an async interface, and the memory + sqlite adapters
      // (better-sqlite3 is synchronous) and the D1 test stub implement it with
      // no await. `async` is deliberate there: it turns a synchronous throw
      // into a rejected promise, which is what the fail-open contract and
      // promise-chaining callers expect. Dropping `async` to satisfy this rule
      // would change behaviour, so the rule does not fit this package.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  }
);
