/**
 * Playwright E2E Functional Test Configuration
 *
 * Deep functional tests for Admin dashboard, Forms, and multi-step flows.
 * Runs against staging (stg.oursharedevents.com) with auth headers.
 *
 * Usage:
 *   npm run test:e2e:pages      # Page-level functional tests
 *   npm run test:e2e:flows      # Multi-step flow tests
 *   npm run test:e2e:negative   # Error/validation tests
 *   npm run test:e2e:all        # Full suite
 *
 * Required env vars:
 *   X_OCR_INTERNAL — auth secret for admin endpoints
 *   ADMIN_KEY      — fallback bearer token (optional)
 */

import { defineConfig, devices } from '@playwright/test';
const { guardProduction } = require('./config/production-read-only');

const { getBaseUrl } = require('./config/environments');

const config = defineConfig({
  // On GitHub Actions Playwright records the HEAD commit message
  // (metadata.gitCommit) and, on PR runs, the whole PR diff (metadata.gitDiff)
  // in every report. CI uploads reports as artifacts, so neither belongs there
  // (OSE-1470). Guarded by tests/integration/scan-artifacts-for-secrets.test.js.
  captureGitInfo: { commit: false, diff: false },
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report-e2e', open: 'never' }],
        ['json', { outputFile: '.test-results/e2e-results.json' }],
        ['junit', { outputFile: '.test-results/e2e-junit.xml' }],
        ['line'],
      ]
    : [['html', { outputFolder: 'playwright-report-e2e', open: 'never' }], ['list']],

  use: {
    baseURL: getBaseUrl(),
    // Credential safety (OSE-1470): trace and video are OFF. Playwright traces record
    // every request's headers (CF-Access-Client-Secret, Authorization: Bearer <ADMIN_KEY>,
    // X-OCR-Internal) and the minted CF_Authorization cookie; CI uploads them as
    // artifacts anyone with repo read access can download. A plain page screenshot
    // shows no headers, so failure screenshots stay. Do not turn these back on.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },

    // Admin auth — injected on all requests so /admin pages load
    extraHTTPHeaders: {
      ...(process.env.X_OCR_INTERNAL
        ? { 'X-OCR-Internal': process.env.X_OCR_INTERNAL }
        : process.env.ADMIN_KEY
          ? { Authorization: `Bearer ${process.env.ADMIN_KEY}` }
          : {}),
    },
  },

  projects: [
    {
      name: 'e2e-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-mobile',
      use: { ...devices['iPhone 14'] },
    },
  ],
});

// ADR-021 (OSE-906): this suite never writes to production.
export default guardProduction(__filename, config);
