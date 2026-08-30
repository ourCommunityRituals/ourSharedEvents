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

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Cost lever (Coverage Economics): CI cost = wall-clock minutes, so serial
  // 3-engine runs pay 3× for nothing when specs mock at the network edge
  // (page.route) and share no state. Default stays 1 because SOME e2e specs
  // mutate staging (demo-harness resets) and fullyParallel:false only
  // serializes within a file, not across files. Opt in per run:
  //   PW_WORKERS=3 npx playwright test admin-wizard-journey sponsor-lifecycle.matrix ...
  // → one worker per engine project; safe for the mocked matrix/journey specs.
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 1,

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

  /**
   * Engine/device tiering (Coverage Economics doctrine): every page is
   * exercised on BOTH shipping engines — WebKit (Safari) and Chromium
   * (Chrome) — and mobile is the attendee's primary surface, so the mobile
   * matrix covers both engines too. Firefox is excluded by doctrine
   * (no meaningful attendee share). Project names carry the engine so a
   * red run says WHICH engine broke on first read.
   *
   * - e2e-chromium      → Desktop Chrome (organizer surfaces: admin/report)
   * - e2e-mobile-safari → iPhone 14 (defaultBrowserType: webkit — the real
   *                       Safari engine; iOS attendees scanning /q/<token>)
   * - e2e-mobile-chrome → Pixel 7 (chromium; Android attendees)
   */
  projects: [
    {
      name: 'e2e-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'e2e-mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
