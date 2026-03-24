/**
 * Playwright Smoke Test Configuration
 *
 * Stage-2 API Smoke Pack Configuration
 * Validates deployed environment against v4.1.2 contract.
 *
 * Story 1.2 (DevOps + SDET): All CI tests use https://stg.eventangle.com
 * - Reads process.env.BASE_URL with default = https://stg.eventangle.com
 * - Uses canonical config/environments.js for consistent environment resolution
 *
 * Usage:
 *   npm run test:api:smoke                    # Run all API smoke tests
 *   npm run test:api:smoke -- --grep status   # Run only status tests
 *
 * Environment Variables:
 *   BASE_URL - Override base URL (default: staging)
 *   USE_PRODUCTION - Set to 'true' to test production
 */

import { defineConfig, devices } from '@playwright/test';

// Import canonical environment configuration (Story 1.2)
// Single source of truth for BASE_URL resolution
const { getBaseUrl } = require('./config/environments');

export default defineConfig({
  testDir: './tests/api/smoke',

  // Smoke tests run sequentially to avoid overwhelming the API
  fullyParallel: false,

  // Fail fast in CI - smoke tests should all pass
  forbidOnly: !!process.env.CI,

  // CI: 2 retries for cold start tolerance; Local: 0 for fast feedback
  retries: process.env.CI ? 2 : 0,

  // Single worker - smoke tests are sequential health checks
  workers: 1,

  // Smoke tests should complete quickly (20s per test)
  timeout: 20000,

  // Expect timeout for assertions
  expect: {
    timeout: 5000,
  },

  // Reporters
  reporter: process.env.CI ? [
    ['html', { outputFolder: 'playwright-report-smoke', open: 'never' }],
    ['json', { outputFile: '.test-results/smoke-results.json' }],
    ['junit', { outputFile: '.test-results/smoke-junit.xml' }],
    ['line'],
  ] : [
    ['html', { outputFolder: 'playwright-report-smoke', open: 'never' }],
    ['json', { outputFile: '.test-results/smoke-results.json' }],
    ['list'],
  ],

  use: {
    // Base URL from environment
    baseURL: getBaseUrl(),

    // Traces only on failure
    trace: 'retain-on-failure',

    // Extra HTTP headers for API requests
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },

    // Ignore HTTPS errors for staging/QA
    ignoreHTTPSErrors: true,
  },

  // Single browser project for API tests (no UI rendering needed)
  projects: [
    {
      name: 'api-smoke',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer - tests run against deployed URLs
});
