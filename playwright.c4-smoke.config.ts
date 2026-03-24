/**
 * Story C4: Create-Event Smoke Gate - Playwright Configuration
 *
 * Stage-2 Gate: Create-Event Smoke (Playwright API) + Log Evidence
 *
 * Purpose:
 *   Every staging deploy proves the system works end-to-end:
 *   Worker auth -> Sheets write -> Sheets read
 *
 * Usage:
 *   npx playwright test --config=playwright.c4-smoke.config.ts
 *   npm run test:c4:smoke
 *
 * Environment Variables:
 *   BASE_URL     - Override base URL (default: https://stg.eventangle.com)
 *   ADMIN_KEY    - Admin API key for authorized requests
 *   ADMIN_KEY_STG - Alternative admin key (CI uses this)
 *
 * @see Story C4 - Stage-2 Gate: Create-Event Smoke (Playwright API) + Log Evidence
 */

import { defineConfig, devices } from '@playwright/test';

// Default to staging URL per Story C4 requirements
const BASE_URL = process.env.BASE_URL || 'https://stg.eventangle.com';

export default defineConfig({
  testDir: './tests/smoke',

  // Smoke tests run sequentially
  fullyParallel: false,

  // Fail fast in CI
  forbidOnly: !!process.env.CI,

  // CI: 2 retries for cold start tolerance; Local: 0 for fast feedback
  retries: process.env.CI ? 2 : 0,

  // Single worker - smoke tests are sequential
  workers: 1,

  // Staging cold start tolerance
  timeout: 30000,

  // Expect timeout for assertions
  expect: {
    timeout: 5000,
  },

  // Reporters
  reporter: process.env.CI ? [
    ['html', { outputFolder: 'playwright-report-c4-smoke', open: 'never' }],
    ['json', { outputFile: '.test-results/c4-smoke-results.json' }],
    ['junit', { outputFile: '.test-results/c4-smoke-junit.xml' }],
    ['line'],
  ] : [
    ['html', { outputFolder: 'playwright-report-c4-smoke', open: 'never' }],
    ['json', { outputFile: '.test-results/c4-smoke-results.json' }],
    ['list'],
  ],

  use: {
    // Base URL for API requests
    baseURL: BASE_URL,

    // Traces only on failure
    trace: 'retain-on-failure',

    // Extra HTTP headers for API requests
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },

    // Ignore HTTPS errors for staging/QA
    ignoreHTTPSErrors: true,
  },

  // Single browser project for API tests
  projects: [
    {
      name: 'c4-smoke',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
