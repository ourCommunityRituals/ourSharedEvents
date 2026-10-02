/**
 * Playwright Smoke Test Configuration
 *
 * Stage-2 API Smoke Pack Configuration
 * Validates deployed environment against v4.1.2 contract.
 *
 * Story 1.2 (DevOps + SDET): All CI tests use https://stg.oursharedevents.com
 * - Reads process.env.BASE_URL with default = https://stg.oursharedevents.com
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
const { guardProduction } = require('./config/production-read-only');

// Import canonical environment configuration (Story 1.2)
// Single source of truth for BASE_URL resolution
const { getBaseUrl } = require('./config/environments');

const config = defineConfig({
  // On GitHub Actions Playwright records the HEAD commit message
  // (metadata.gitCommit) and, on PR runs, the whole PR diff (metadata.gitDiff)
  // in every report. CI uploads reports as artifacts, so neither belongs there
  // (OSE-1470). Guarded by tests/integration/scan-artifacts-for-secrets.test.js.
  captureGitInfo: { commit: false, diff: false },
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
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report-smoke', open: 'never' }],
        ['json', { outputFile: '.test-results/smoke-results.json' }],
        ['junit', { outputFile: '.test-results/smoke-junit.xml' }],
        ['line'],
      ]
    : [
        ['html', { outputFolder: 'playwright-report-smoke', open: 'never' }],
        ['json', { outputFile: '.test-results/smoke-results.json' }],
        ['list'],
      ],

  use: {
    // Base URL from environment
    baseURL: getBaseUrl(),

    // Credential safety (OSE-1470): trace and video are OFF. Playwright traces record
    // every request's headers (CF-Access-Client-Secret, Authorization: Bearer <ADMIN_KEY>,
    // X-OCR-Internal) and the minted CF_Authorization cookie; CI uploads them as
    // artifacts anyone with repo read access can download. A plain page screenshot
    // shows no headers, so failure screenshots stay. Do not turn these back on.
    trace: 'off',
    video: 'off',

    // Extra HTTP headers for API requests
    extraHTTPHeaders: {
      Accept: 'application/json',
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

// ADR-021 (OSE-906): this suite never writes to production.
export default guardProduction(__filename, config);
