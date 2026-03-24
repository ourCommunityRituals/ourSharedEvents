/**
 * Playwright Stage-2 Smoke Test Configuration - Story 5
 *
 * Dedicated configuration for Stage-2 CI/CD gate validation.
 * This config runs ONLY smoke tests - not flow tests or manual tests.
 *
 * Test Suites Included:
 * - Stage-2 Critical Smoke (stage2-critical-smoke.spec.ts)
 * - Backend Health (backend-health.spec.ts)
 * - Events V2 API (events-v2.spec.ts)
 * - Environment Alignment (env-alignment.spec.ts)
 * - UI Smoke Tests (manage.smoke.spec.ts, events.smoke.spec.ts, etc.)
 *
 * Acceptance Criteria (Story 5):
 * - Stage-2 executes only smoke tests
 * - Tests fail if first API host does not include stg.eventangle.com
 * - Tests fail if any response returns ok:false
 * - Log output includes base URL and first host for debugging
 *
 * Usage:
 *   npx playwright test --config playwright.stage2-smoke.config.ts
 *   npm run test:stage2:smoke
 *
 * Environment Variables:
 *   BASE_URL - Override base URL (default: staging)
 *   TEST_BRAND - Brand to test (default: 'root')
 *   CI - Set to 'true' in CI environments
 *
 * @see Story 5 - Expand Playwright Smoke Coverage
 */

import { defineConfig, devices } from '@playwright/test';

// Import canonical environment configuration
const { getBaseUrl } = require('./config/environments');

export default defineConfig({
  // Test directories to include
  testDir: './tests',

  // Only run smoke test files
  testMatch: [
    // API smoke tests
    'api/smoke/stage2-critical-smoke.spec.ts',
    'api/smoke/backend-health.spec.ts',
    'api/smoke/events-v2.spec.ts',
    'api/smoke/env-alignment.spec.ts',
    'api/smoke/fail-fast-gates.spec.ts',
    // UI smoke tests
    'ui/smoke/manage.smoke.spec.ts',
    'ui/smoke/events.smoke.spec.ts',
    'ui/smoke/sharedreport.smoke.spec.ts',
  ],

  // Ignore flow tests, manual tests, and flaky tests
  testIgnore: [
    '**/flows/**',
    '**/manual/**',
    '**/flaky/**',
    '**/experimental/**',
    '**/*.flow.spec.ts',
    '**/*.manual.spec.ts',
  ],

  // Smoke tests run sequentially for stability
  fullyParallel: false,

  // Fail fast in CI - smoke tests are critical gates
  forbidOnly: !!process.env.CI,

  // CI: 2 retries for cold start tolerance; Local: 0 for fast feedback
  retries: process.env.CI ? 2 : 0,

  // Single worker - smoke tests are sequential health checks
  workers: 1,

  // Extended timeout for page loads with cold starts
  timeout: 60000,

  // Expect timeout for assertions
  expect: {
    timeout: 15000,
  },

  // Global timeout for entire test run
  globalTimeout: 15 * 60 * 1000, // 15 minutes

  // Reporters optimized for CI visibility
  reporter: process.env.CI ? [
    ['html', { outputFolder: 'playwright-report-stage2-smoke', open: 'never' }],
    ['json', { outputFile: '.test-results/stage2-smoke-results.json' }],
    ['junit', { outputFile: '.test-results/stage2-smoke-junit.xml' }],
    ['line'], // Concise CI output
    ['github'], // GitHub Actions annotations
  ] : [
    ['html', { outputFolder: 'playwright-report-stage2-smoke', open: 'never' }],
    ['json', { outputFile: '.test-results/stage2-smoke-results.json' }],
    ['list'], // Verbose local output
  ],

  use: {
    // Base URL from environment (defaults to staging)
    baseURL: getBaseUrl(),

    // Traces on failure for debugging
    trace: 'retain-on-failure',

    // Screenshots on failure
    screenshot: 'only-on-failure',

    // Video only on failure (helps debug UI issues)
    video: 'retain-on-failure',

    // Extra HTTP headers for API requests
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },

    // Ignore HTTPS errors for staging/QA
    ignoreHTTPSErrors: true,

    // Viewport for consistent rendering
    viewport: { width: 1280, height: 720 },

    // Navigation timeout
    navigationTimeout: 45000,

    // Action timeout
    actionTimeout: 15000,
  },

  // Output directory for test artifacts
  outputDir: 'test-results-stage2-smoke',

  // Browser projects for Stage-2 smoke tests
  projects: [
    {
      name: 'stage2-api-smoke',
      testDir: './tests/api/smoke',
      testMatch: [
        'stage2-critical-smoke.spec.ts',
        'backend-health.spec.ts',
        'events-v2.spec.ts',
        'env-alignment.spec.ts',
        'fail-fast-gates.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'stage2-ui-smoke',
      testDir: './tests/ui/smoke',
      testMatch: [
        'manage.smoke.spec.ts',
        'events.smoke.spec.ts',
        'sharedreport.smoke.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      // UI tests depend on API tests passing
      dependencies: ['stage2-api-smoke'],
    },
  ],

  // Test metadata for tracking
  metadata: {
    suite: 'stage2-smoke',
    environment: process.env.NODE_ENV || 'staging',
    configVersion: '5.0.0',
    story: 'Story 5 - Expand Playwright Smoke Coverage',
  },

  // No webServer - tests run against deployed URLs
});
