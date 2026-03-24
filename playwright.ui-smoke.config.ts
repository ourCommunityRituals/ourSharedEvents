/**
 * Playwright UI Smoke Test Configuration
 *
 * Stage-2 UI Smoke Pack Configuration
 * Validates "If you show it, it works" across Admin, Public, Display, and Poster surfaces.
 *
 * Story 1.2 (DevOps + SDET): All CI tests use https://stg.eventangle.com
 * - Reads process.env.BASE_URL with default = https://stg.eventangle.com
 * - Uses canonical config/environments.js for consistent environment resolution
 *
 * Usage:
 *   npm run test:ui:smoke                    # Run all UI smoke tests
 *   npm run test:ui:smoke -- --grep admin    # Run only admin tests
 *
 * Environment Variables:
 *   BASE_URL - Override base URL (default: staging)
 *   USE_PRODUCTION - Set to 'true' to test production
 *   TEST_BRAND - Brand to test (default: 'root')
 */

import { defineConfig, devices } from '@playwright/test';

// Import canonical environment configuration (Story 1.2)
// Single source of truth for BASE_URL resolution
const { getBaseUrl } = require('./config/environments');

export default defineConfig({
  testDir: './tests/ui/smoke',

  // UI smoke tests run sequentially to avoid race conditions
  fullyParallel: false,

  // Fail fast in CI - smoke tests should all pass
  forbidOnly: !!process.env.CI,

  // CI: 2 retries for flakiness tolerance; Local: 0 for fast feedback
  retries: process.env.CI ? 2 : 0,

  // Single worker - smoke tests are sequential health checks
  workers: 1,

  // UI tests need more time for page loads (GAS cold starts)
  timeout: 60000,

  // Expect timeout for assertions (longer for dynamic content)
  expect: {
    timeout: 10000,
  },

  // Reporters
  reporter: process.env.CI ? [
    ['html', { outputFolder: 'playwright-report-ui-smoke', open: 'never' }],
    ['json', { outputFile: '.test-results/ui-smoke-results.json' }],
    ['junit', { outputFile: '.test-results/ui-smoke-junit.xml' }],
    ['line'],
  ] : [
    ['html', { outputFolder: 'playwright-report-ui-smoke', open: 'never' }],
    ['json', { outputFile: '.test-results/ui-smoke-results.json' }],
    ['list'],
  ],

  use: {
    // Base URL from environment
    baseURL: getBaseUrl(),

    // Traces on failure for debugging
    trace: 'retain-on-failure',

    // Screenshots on failure
    screenshot: 'only-on-failure',

    // Video only on failure (helps debug UI issues)
    video: 'retain-on-failure',

    // Ignore HTTPS errors for staging/QA
    ignoreHTTPSErrors: true,

    // Viewport for consistent rendering
    viewport: { width: 1280, height: 720 },
  },

  // Browser projects for UI smoke tests
  projects: [
    {
      name: 'ui-smoke-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile viewport for responsive testing
    {
      name: 'ui-smoke-mobile',
      use: { ...devices['iPhone 14'] },
    },
  ],

  // No webServer - tests run against deployed URLs
});
