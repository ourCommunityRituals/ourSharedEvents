/**
 * ESLint Flat Config (ESLint v9+)
 *
 * Story 2.2: ESLint static code analysis configuration
 * Migrated from .eslintrc.json for compatibility with ESLint v9.
 *
 * Key Rules:
 * - no-unused-vars: Error for production code (catches dead code)
 * - no-console: Warn for production code
 * - semi: Error (consistent semicolon usage)
 * - no-var: Warn (prefer let/const)
 *
 * @see docs/CODING-STYLE.md for full coding style guide
 */

const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');

module.exports = [
  // Base recommended config
  js.configs.recommended,
  // Security rules — catches eval, unsafe regex, child_process injection
  // detect-object-injection disabled globally: fires on all bracket notation (arr[i], obj[key])
  // which has near-100% false-positive rate in test/config code; high-signal rules kept active.
  {
    ...security.configs.recommended,
    rules: {
      ...security.configs.recommended.rules,
      'security/detect-object-injection': 'off',
    },
  },

  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'build/**',
      'playwright-report/**',
      'playwright-report-*/**',
      'test-results/**',
      '.test-results/**',
      'tests/load/**',
      // Archive folder - legacy V2 code not in active use
      'archive/**',
      // Retired GAS/zeventbook MVP reference — kept as history, not linted (OSE-882)
      'reference/**',
      // Claude worktrees — isolated git branches, not part of active codebase
      '.claude/**',
      // Generated files
      '**/*.min.js',
      '**/vendor/**',
      // Wrangler build output
      '**/.wrangler/**',
      // TypeScript files - linted by TypeScript compiler, not ESLint
      '**/*.ts',
      '**/*.tsx',
    ],
  },

  // Default config for all JS files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Critical rules - these cause CI to fail
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      semi: ['error', 'always'],

      // Warning rules - tracked but won't fail CI immediately
      'no-console': 'warn',
      'no-undef': 'warn',
      'no-var': 'warn',

      // Style rules
      quotes: 'off',
      eqeqeq: ['warn', 'smart'],
      curly: ['warn', 'multi-line'],
    },
  },

  // Test files (Jest - Unit/Contract tests)
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        test: 'readonly',
        expect: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off', // Console is fine in tests
      'no-redeclare': 'off', // Tests often mock/redefine globals
    },
  },

  // E2E test files (Playwright - ESM)
  {
    files: ['tests/e2e/**/*.js', 'tests/e2e/**/*.spec.js', '**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-redeclare': 'off',
    },
  },

  // Smoke test files
  {
    files: ['tests/smoke/**/*.js', 'tests/api/**/*.ts', 'tests/ui/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-redeclare': 'off',
    },
  },

  // Triangle test files
  {
    files: ['tests/triangle/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-redeclare': 'off',
    },
  },

  // Scripts (Node.js CommonJS)
  {
    files: ['scripts/**/*.js', '.github/scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-redeclare': 'off',
      // Build/CI scripts use variable file paths and bracket notation by design —
      // high false-positive rate; high-signal rules (eval, child_process, regex) still active.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },

  // Scripts (Node.js ESM - .mjs files)
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-redeclare': 'off',
    },
  },

  // Root-level utility scripts
  {
    files: ['*.js'],
    ignores: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  // Config files
  {
    files: ['*.config.js', '*.config.mjs', 'playwright*.config.*'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
