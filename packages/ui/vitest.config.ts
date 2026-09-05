import { defineConfig } from 'vitest/config';

/**
 * @ocr/ui runs its own vitest.
 *
 * WHY THIS FILE EXISTS (OSE-1232, measured 2026-09-05)
 *   Without it, `vitest` walked up to the repo-root config, whose include is
 *   `tests/{unit,contract,integration}/**` — patterns that cannot match
 *   `packages/ui/tests/`. The four suites here (partials, contract, tokens,
 *   and a since-removed React suite) reported "No test files found, exiting with code 1" and CI never
 *   ran them. A component library nobody adopts is one problem; a component
 *   library whose tests do not execute is a different and worse one.
 *
 *   The package already declared `"test": "vitest run tests/"`. That script
 *   was correct and inert — the config resolution, not the script, was the gap.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
  },
});
