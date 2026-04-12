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

  reporter: process.env.CI
    ? [['html', { outputFolder: 'playwright-report-e2e-smoke', open: 'never' }], ['line']]
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
