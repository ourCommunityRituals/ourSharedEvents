/**
 * Playwright Configuration for Smoke Packs
 *
 * This config is specifically for the smoke pack tests in tests/smoke/
 * which are integration-level smoke tests that verify deep component behavior.
 *
 * Usage: npx playwright test --config=playwright.smoke-packs.config.js tests/smoke/
 */

const { defineConfig, devices } = require('@playwright/test');
const { getCurrentEnvironment } = require('./tests/config/environments');

// Get the current environment configuration
const env = getCurrentEnvironment();

module.exports = defineConfig({
  // Smoke packs are in tests/smoke/ directory
  testDir: './tests/smoke',

  fullyParallel: false, // Run sequentially for more reliable results
  forbidOnly: !!process.env.CI,

  // Allow retries for transient failures
  retries: process.env.CI ? 2 : 0,

  // Single worker for CI to avoid resource contention
  workers: 1,

  // Longer timeout for integration tests
  timeout: 60000,

  // Global expect timeout
  expect: {
    timeout: 15000,
  },

  reporter: process.env.CI ? [
    ['html', {
      outputFolder: process.env.PLAYWRIGHT_HTML_REPORT || 'playwright-report',
      open: 'never',
    }],
    ['json', { outputFile: '.test-results/smoke-packs-results.json' }],
    ['junit', { outputFile: '.test-results/smoke-packs-junit.xml' }],
    ['line'],
  ] : [
    ['html', {
      outputFolder: process.env.PLAYWRIGHT_HTML_REPORT || 'playwright-report',
      open: 'never',
    }],
    ['list']
  ],

  use: {
    // Use environment-aware base URL
    baseURL: env.baseUrl,

    // Enable traces on failure for debugging
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',

    // Navigation timeout (30s for Google Apps Script cold starts)
    navigationTimeout: 30000,

    // Action timeout
    actionTimeout: 15000,

    // Extra HTTP headers
    extraHTTPHeaders: {
      'Accept': 'text/html,application/json',
    },

    // Realistic user agent
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

    // Ignore HTTPS errors for QA/staging
    ignoreHTTPSErrors: true,
  },

  // Use only chromium for smoke packs to speed up CI
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
