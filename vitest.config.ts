import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Globals mode — describe, test, expect available without imports
    // Same API as Jest, zero conversion needed for most test files
    globals: true,
    environment: 'node',

    // Test file patterns — unit, contract, integration (not Playwright specs)
    include: [
      'tests/unit/**/*.test.{js,ts}',
      'tests/contract/**/*.test.{js,ts}',
      'tests/integration/**/*.test.{js,ts}',
      // L8 PACT — consumer-driven contracts. Offline (static join against the
      // committed provider snapshots), so it gates in T0 without a deployed
      // worker or the CF Access token that has blocked T2/T3 since 2026-05-19.
      'tests/pact/**/*.test.{js,ts}',
    ],

    // Exclude Playwright tests and archive
    exclude: [
      '**/node_modules/**',
      'archive/**',
      'tests/api/**',
      'tests/ui/**',
      'tests/smoke/**',
      'tests/e2e/**',
      'tests/playwright/**',
      'workers/**',
    ],

    // Reporters
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],

    outputFile: process.env.CI ? { junit: '.test-results/vitest-junit.xml' } : undefined,
  },
});
