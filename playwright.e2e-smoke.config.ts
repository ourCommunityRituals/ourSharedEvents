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

  // The json reporter is additive (mirrors playwright.ui-smoke.config.ts) and is
  // what scripts/pw-guarded.sh reads to publish a per-step passed/SKIPPED/failed
  // line — OSE-852 fix #3. Without it a step reports "green" while an unknown
  // share of its tests skipped, which is the state Gate 0 exists to end.
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report-e2e-smoke', open: 'never' }],
        ['json', { outputFile: '.test-results/e2e-smoke-results.json' }],
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
