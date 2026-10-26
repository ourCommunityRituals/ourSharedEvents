// @ts-check
//
// OSE-1695 — mutation testing (StrykerJS) for the CI security rules in scripts/ci.
//
// Same idea as workers/oursharedevents/stryker.conf.mjs: a surviving mutant in a security rule
// means the tests defending it are hollow (green with no teeth). Targets here are the pure
// functions that decide whether a workflow can hand a secret to a branch push. If this rule
// silently went soft, a secret could be exposed again with every test still green.
//
// Run from the repository root with the worker's Stryker (it is installed there):
//   node workers/oursharedevents/node_modules/@stryker-mutator/core/bin/stryker.js run stryker.ci-scripts.conf.mjs

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.ci-scripts.config.mjs' },
  mutate: ['scripts/ci/branch-push-secret-exposure.mjs'],
  // Copy only what the test needs into Stryker's sandbox, not the whole repository (archive/ holds
  // HTML templates that Vite cannot parse, and 3,000 files make every run slow).
  ignorePatterns: [
    '/*',
    '!/package.json',
    '!/vitest.ci-scripts.config.mjs',
    '!/.github',
    '!/scripts',
    '/scripts/*',
    '!/scripts/ci',
    '/scripts/ci/*',
    '!/scripts/ci/branch-push-secret-exposure.mjs',
    '!/tests',
    '/tests/*',
    '!/tests/unit',
    '/tests/unit/*',
    '!/tests/unit/ci',
    '/tests/unit/ci/*',
    '!/tests/unit/ci/no-secret-on-branch-push.test.js',
  ],
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation-ci-scripts/index.html' },
  // Held to the same bar as the covenant guards: 95%. Residual survivors must be documented
  // equivalent mutants (`// Stryker disable` with a written reason), never a lower threshold.
  thresholds: { high: 95, low: 95, break: 95 },
};
