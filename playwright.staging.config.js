/**
 * Playwright Staging Configuration (Story 3.5)
 *
 * Enhanced configuration for staging environment E2E tests with:
 * - Improved timeout handling
 * - Graceful error recovery
 * - Test isolation using QA brand
 * - Stability-focused settings
 *
 * Usage:
 *   npx playwright test --config playwright.staging.config.js
 *   npm run test:staging
 */

const { defineConfig, devices } = require('@playwright/test');
const { STAGING_URL } = require('./tests/config/environments');

// Staging-specific environment settings
const stagingEnv = {
  baseUrl: process.env.BASE_URL || STAGING_URL,
  qaBrand: process.env.QA_BRAND_ID || 'qa-testing',
};

module.exports = defineConfig({
  testDir: './tests/e2e',

  // Parallelization: Sequential in staging for stability
  // Parallel execution can cause race conditions with shared test data
  fullyParallel: false,

  // Forbid .only in CI
  forbidOnly: !!process.env.CI,

  // Retries: Higher in staging to handle transient network issues
  retries: process.env.CI ? 3 : 1,

  // Workers: Single worker for stability (prevents race conditions)
  workers: 1,

  // Test timeout: Extended for cold starts and network latency
  timeout: 60000,  // 60 seconds per test

  // Global timeout: Max time for entire test run
  globalTimeout: 30 * 60 * 1000,  // 30 minutes

  // Expect timeout: Extended for element visibility
  expect: {
    timeout: 15000,  // 15 seconds
  },

  // Reporters with stability tracking
  reporter: [
    ['html', {
      outputFolder: 'playwright-report-staging',
      open: 'never',
    }],
    ['json', { outputFile: '.test-results/staging-results.json' }],
    ['junit', { outputFile: '.test-results/staging-junit.xml' }],
    ['./tests/shared/history-reporter.js'],
    process.env.CI ? ['github'] : ['list'],
  ],

  // Browser settings optimized for staging
  use: {
    baseURL: stagingEnv.baseUrl,

    // Extended timeouts for staging environment
    navigationTimeout: 45000,  // 45 seconds for page loads
    actionTimeout: 15000,      // 15 seconds for interactions

    // Tracing: Always capture for debugging
    trace: 'on-first-retry',

    // Screenshots: Capture on failure
    screenshot: 'only-on-failure',

    // Video: Capture on failure for debugging
    video: 'on-first-retry',

    // Extra HTTP headers
    extraHTTPHeaders: {
      'Accept': 'text/html,application/json',
      'X-Test-Session': process.env.TEST_SESSION_ID || 'unknown',
    },

    // Bypass bot detection
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

    // Ignore HTTPS errors
    ignoreHTTPSErrors: true,

    // Connect over HTTPS
    launchOptions: {
      // Slow down for stability
      slowMo: process.env.CI ? 100 : 0,
    },
  },

  // Global setup/teardown with cleanup
  globalSetup: require.resolve('./tests/config/global-setup.js'),
  globalTeardown: require.resolve('./tests/config/global-teardown.js'),

  // Output directory for test artifacts
  outputDir: 'test-results-staging',

  // Projects: Focused browser coverage for staging
  projects: [
    {
      name: 'staging-chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Extra stability settings
        viewport: { width: 1280, height: 720 },
      },
      // Test matching: Only run stable tests in staging by default
      testMatch: /.*\.spec\.(js|ts)/,
      // Ignore flaky tests unless explicitly included
      testIgnore: process.env.INCLUDE_FLAKY ? [] : [
        /flaky/,
        /experimental/,
      ],
    },
    {
      name: 'staging-mobile',
      use: {
        ...devices['iPhone 14 Pro'],
      },
      testMatch: /.*\.spec\.(js|ts)/,
      testIgnore: process.env.INCLUDE_FLAKY ? [] : [
        /flaky/,
        /experimental/,
      ],
    },
  ],

  // Test metadata for tracking
  metadata: {
    environment: 'staging',
    qaBrand: stagingEnv.qaBrand,
    configVersion: '3.5.0',
  },
});
