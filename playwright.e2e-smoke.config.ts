/**
 * Playwright E2E Smoke Test Configuration
 *
 * Minimal config for e2e security smoke tests in CI.
 * Uses testDir to restrict discovery to tests/e2e/ (excludes archive/).
 * No globalSetup/teardown to avoid archive dependency issues.
 *
 * Usage:
 *   npx playwright test --config=playwright.e2e-smoke.config.ts tests/e2e/1-smoke/security-smoke.spec.js
 */

import { defineConfig, devices } from '@playwright/test';

const { getBaseUrl } = require('./config/environments');

export default defineConfig({
  testDir: './tests/e2e',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,

  expect: {
    timeout: 15000,
  },

  // The `json` reporter is REQUIRED, not cosmetic: pw-guarded.sh's Gate 0b
  // (OSE-1170) reads the emitted result JSON to prove tests actually EXECUTED
  // rather than all-skipped. Without it, the guard sees no result file and a
  // healthy green run is misread as "cannot confirm any test executed" → false
  // red. Every config pw-guarded.sh runs (this one for T4a/T4f, ui-smoke for
  // T4d/T4e) MUST carry it; the ci-gate0-discovery test locks that in.
  //
  // `outputFile` explicitly honors PLAYWRIGHT_JSON_OUTPUT_NAME so the guard can
  // point the result JSON at its own temp file. Playwright's json reporter
  // takes the config `outputFile` over the env var (verified the hard way in
  // CI — env-var-wins was wrong), so the guard cannot override it from outside;
  // wiring it here makes the config value BE the env var when the guard sets it,
  // and fall back to the stable artifact path otherwise (non-guarded T4b/T4c).
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report-e2e-smoke', open: 'never' }],
        [
          'json',
          {
            outputFile:
              process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || '.test-results/e2e-smoke-results.json',
          },
        ],
        ['line'],
      ]
    : [['list']],

  use: {
    baseURL: getBaseUrl(),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  },

  projects: [
    {
      name: 'e2e-smoke',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
