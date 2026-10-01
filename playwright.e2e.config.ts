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

const { getBaseUrl } = require('./config/environments');

const { refuseProductionTargets } = require('./config/production-read-only');

// ADR-021 (OSE-906): this suite can write, so it never targets production.
refuseProductionTargets('playwright.e2e.config.ts', getBaseUrl());

export default defineConfig({
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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
