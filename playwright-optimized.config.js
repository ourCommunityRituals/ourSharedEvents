/**
 * OPTIMIZED PLAYWRIGHT CONFIGURATION
 *
 * Cost-Optimized Testing Strategy:
 * 1. Run 2-5 smoke tests FIRST (critical health checks)
 * 2. If smoke tests pass → Continue with full E2E suite
 * 3. If smoke tests fail → Stop immediately (save costs)
 * 4. Test on iPhone 14 Safari only (most important mobile device)
 *
 * Usage:
 * - Smoke tests: npm run test:smoke
 * - Full suite: npm run test:e2e
 * - Local testing: npx playwright test
 */

const { defineConfig, devices } = require('@playwright/test');
const { getCurrentEnvironment } = require('./tests/config/environments');

// Get the current environment configuration
const env = getCurrentEnvironment();

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run smoke tests sequentially for fail-fast
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, // Reduced retries for faster feedback
  workers: process.env.CI ? 1 : 2, // Single worker in CI for cost optimization

  // Timeouts optimized for smoke tests
  timeout: 30000, // 30s per test (smoke tests should be fast)
  expect: {
    timeout: 5000 // 5s for assertions
  },

  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: '.test-results/playwright-results.json' }],
    ['list'],
    // Add JUnit for CI/CD integration
    ['junit', { outputFile: '.test-results/junit-results.xml' }]
  ],

  use: {
    baseURL: env.baseUrl,
    trace: 'retain-on-failure', // Only keep traces for failures
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Extra HTTP headers
    extraHTTPHeaders: {
      'Accept': 'text/html,application/json',
    },

    // Realistic user agent (avoid bot detection)
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',

    // Ignore HTTPS errors for QA/staging
    ignoreHTTPSErrors: true,
  },

  // Global setup - print environment info before tests
  globalSetup: require.resolve('./tests/config/global-setup.js'),

  // OPTIMIZED: Test projects for cost-effective testing
  projects: [
    // ========================================
    // SMOKE TESTS (Run First - Critical Gate)
    // ========================================
    {
      name: 'smoke-critical',
      testMatch: '**/1-smoke/critical-smoke.spec.js',
      use: {
        ...devices['iPhone 14 Pro'], // Most important mobile device
      },
      retries: 0, // No retries for smoke tests (fail fast)
      timeout: 15000, // 15s max for smoke tests
    },

    {
      name: 'smoke-security',
      testMatch: '**/1-smoke/security-smoke.spec.js',
      use: {
        ...devices['iPhone 14 Pro'],
      },
      retries: 0,
      timeout: 15000,
    },

    // ========================================
    // FULL E2E SUITE (Run if smoke passes)
    // ========================================
    {
      name: 'iPhone 14 Safari',
      testMatch: '**/e2e/**/*.spec.js',
      testIgnore: '**/1-smoke/**', // Skip smoke tests (already run)
      use: {
        ...devices['iPhone 14 Pro'],
      },
      dependencies: ['smoke-critical', 'smoke-security'], // Only run if smoke passes
    },

    // ========================================
    // OPTIONAL: Desktop Testing (Local Only)
    // ========================================
    {
      name: 'chromium-desktop',
      testMatch: '**/e2e/**/*.spec.js',
      testIgnore: '**/1-smoke/**',
      use: {
        ...devices['Desktop Chrome'],
      },
      dependencies: ['smoke-critical'],
      // Only run locally (not in CI)
      grep: process.env.CI ? /@local/ : undefined,
      grepInvert: process.env.CI ? /@local/ : undefined,
    },
  ],

  // No webServer needed - we test deployed URLs directly
});

/**
 * USAGE PATTERNS
 *
 * 1. Smoke Tests Only (Fast - 2-5 tests, < 1 minute):
 *    npm run test:smoke
 *    → Runs critical-smoke.spec.js on iPhone 14 Safari
 *    → Perfect for quick validation after deployment
 *
 * 2. Full E2E Suite (Complete - ~700 tests, ~30 minutes):
 *    npm run test:e2e
 *    → Runs ALL tests on iPhone 14 Safari
 *    → Only if smoke tests pass (cost optimization)
 *
 * 3. Specific Test Suite:
 *    npm run test:api        (API tests only)
 *    npm run test:pages      (Page tests only)
 *    npm run test:flows      (Flow tests only)
 *
 * 4. Local Development (All devices):
 *    npx playwright test --project="chromium-desktop"
 *    → Run on desktop Chrome for faster local testing
 *
 * 5. CI/CD (Optimized):
 *    GitHub Actions will:
 *    1. Run smoke tests first (2-5 tests)
 *    2. If > 50% fail → STOP (save costs)
 *    3. If < 50% fail → Continue with full suite
 */

/**
 * COST OPTIMIZATION BENEFITS
 *
 * Before (expensive):
 * - 700 tests × 11 devices = 7,700 test runs per CI job
 * - ~3 hours execution time
 * - High GitHub Actions costs
 *
 * After (optimized):
 * - Smoke: 5 tests × 1 device = 5 test runs (< 1 minute)
 * - Full: 700 tests × 1 device = 700 test runs (~30 minutes)
 * - Total: 705 test runs (90% reduction!)
 * - Early failure detection saves ~2.5 hours when deployment is broken
 *
 * Cost Savings:
 * - 90% fewer test runs
 * - 50% faster feedback (smoke tests fail fast)
 * - Run full suite only when smoke tests pass
 */
