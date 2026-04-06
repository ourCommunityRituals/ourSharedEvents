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
    reporters: process.env.CI
      ? ['default', 'junit']
      : ['default'],

    outputFile: process.env.CI
      ? { junit: '.test-results/vitest-junit.xml' }
      : undefined,
  },
});
