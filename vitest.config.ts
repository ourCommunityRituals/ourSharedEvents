import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Globals mode — describe, test, expect available without imports
    // Same API as Jest, zero conversion needed for most test files
    globals: true,
    environment: 'node',

    // At most 12 workers. Many files here start git, bash or node processes, and on a large
    // Windows workstation the default (one per thread, 31 on 32 threads) oversubscribes it:
    // measured 2026-11-07 on 32 threads, 31 workers took 404 s with 12 timeouts and 551 s of
    // summed transform time; 12 workers took 295 s and 48 s. Machines with 13 or fewer threads,
    // CI's runners included, keep the default (threads - 1). --maxWorkers on the command line
    // still wins.
    maxWorkers: Math.max(1, Math.min(12, availableParallelism() - 1)),

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
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],

    outputFile: process.env.CI ? { junit: '.test-results/vitest-junit.xml' } : undefined,
  },
});
