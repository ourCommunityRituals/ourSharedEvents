/**
 * Playwright E2E Smoke Test Configuration
 *
 * Minimal config for e2e security smoke tests in CI.
 * Uses testDir to restrict discovery to tests/e2e/ (excludes archive/).
 * No globalSetup/teardown to avoid archive dependency issues.
 *
 * Usage:
 *   npx playwright test --config=playwright.e2e-smoke.config.ts tests/e2e/1-smoke/security-smoke.spec.js
 */

import { defineConfig, devices } from '@playwright/test';

const { getBaseUrl } = require('./config/environments');
const { productionTestMatch } = require('./config/production-read-only');

// ADR-021 (OSE-906): against production this config may discover only the
// approved read-only specs, whatever the invocation.
const PRODUCTION_ONLY = productionTestMatch('playwright.e2e-smoke.config.ts', getBaseUrl());

export default defineConfig({
  testDir: './tests/e2e',
  ...(PRODUCTION_ONLY ? { testMatch: PRODUCTION_ONLY } : {}),

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,

  expect: {
    timeout: 15000,
  },

  // The `json` reporter is REQUIRED, not cosmetic: pw-guarded.sh's Gate 0b
  // (OSE-1170) reads the emitted result JSON to prove tests actually EXECUTED
  // rather than all-skipped. Without it, the guard sees no result file and a
  // healthy green run is misread as "cannot confirm any test executed" → false
  // red. Every config pw-guarded.sh runs (this one for T4a/T4f, ui-smoke for
  // T4d/T4e) MUST carry it; the ci-gate0-discovery test locks that in.
  //
  // `outputFile` explicitly honors PLAYWRIGHT_JSON_OUTPUT_NAME so the guard can
  // point the result JSON at its own temp file. Playwright's json reporter
  // takes the config `outputFile` over the env var (verified the hard way in
  // CI — env-var-wins was wrong), so the guard cannot override it from outside;
  // wiring it here makes the config value BE the env var when the guard sets it,
  // and fall back to the stable artifact path otherwise (non-guarded T4b/T4c).
  //
  // `junit` feeds the dorny/test-reporter Check on T3 security smoke and T4
  // functional (both glob `.test-results/*junit.xml`). Without it the T3 report
  // step found no file and annotated the run "No test report files were found".
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report-e2e-smoke', open: 'never' }],
        [
          'json',
          {
            outputFile:
              process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || '.test-results/e2e-smoke-results.json',
          },
        ],
        ['junit', { outputFile: '.test-results/e2e-smoke-junit.xml' }],
        ['line'],
      ]
    : [['list']],

  use: {
    baseURL: getBaseUrl(),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    // OSE-1310 / OSE-306: default headless Chromium sends `HeadlessChrome/...`
    // as its User-Agent. OSE-306 already found Cloudflare Bot Management
    // 403-challenging that exact UA on staging (see the UA override in
    // playwright.config.ts). classifyBeacon() (OSE-1310, invalid-traffic.ts)
    // now ALSO treats it as automated traffic on the impression/click write
    // path — not a 403, but a silent 202 "accepted, not counted" — so T4a's
    // functional checks against real staging (ncr-accumulation, anonymous-id,
    // sponsor-journey) stopped seeing their writes land. This suite drives a
    // real browser to prove the real pipeline works; it is not a bot, so it
    // must present a real-browser UA like every other staging Playwright
    // config already does. Guarded by tests/unit/playwright-ua-override.test.ts.
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },

  projects: [
    {
      name: 'e2e-smoke',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
