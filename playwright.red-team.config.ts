/**
 * Playwright Red Team Test Configuration
 *
 * Adversarial security tests targeting the live staging environment.
 * These tests make real network calls against https://stg.oursharedevents.com
 * and intentionally probe auth, rate limits, injection vectors, and headers.
 *
 * Run only on the nightly / pre-release CI gate — NOT on every push.
 * Many tests are slow by design (rate-limit tests make 61+ sequential calls).
 *
 * Usage:
 *   npx playwright test --config playwright.red-team.config.ts
 *   npx playwright test --config playwright.red-team.config.ts --grep "HDR-"
 *   npx playwright test --config playwright.red-team.config.ts tests/red-team/security-headers.spec.ts
 *
 * Required env vars (at minimum, for full coverage):
 *   BASE_URL        — defaults to https://stg.oursharedevents.com
 *   ADMIN_KEY       — Bearer token for admin-gated tests
 *   X_OCR_INTERNAL  — X-OCR-Internal header secret
 *
 * Optional:
 *   SMOKE_EVENT_ID  — real staging event ID (used by injection + rate-limit tests)
 *
 * Worker count: 1
 *   Sequential execution prevents the tests themselves from triggering
 *   the rate limiter unexpectedly during unrelated test groups.
 *
 * Timeout: 5 minutes per test
 *   Rate-limit tests make 61+ sequential HTTP calls. Security header tests
 *   hit every surface. Allow generous per-test time.
 */

import { defineConfig, devices } from '@playwright/test';
const { guardProduction } = require('./config/production-read-only');

const config = defineConfig({
  // No git commit or diff in reports (OSE-1470): uploaded artifacts must not
  // carry commit messages or source diffs. CI defaults both to true.
  captureGitInfo: { commit: false, diff: false },
  testDir: './tests/red-team',
  testMatch: '**/*.spec.ts',

  // Serial execution — rate-limit tests must not race each other
  fullyParallel: false,
  workers: 1,

  // No retries — security tests should not retry on failure.
  // A 429 that becomes a 200 on retry would mask a real finding.
  retries: 0,

  // 5 minutes per test — rate-limit tests are slow by design
  timeout: 300_000,
  expect: { timeout: 30_000 },

  // Do not forbid test.only in red-team — useful for focused runs
  forbidOnly: false,

  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report-red-team', open: 'never' }],
        ['json', { outputFile: '.test-results/red-team-results.json' }],
        ['junit', { outputFile: '.test-results/red-team-junit.xml' }],
        ['line'],
      ]
    : [['html', { outputFolder: 'playwright-report-red-team', open: 'never' }], ['list']],

  use: {
    baseURL: process.env.BASE_URL ?? 'https://stg.oursharedevents.com',

    // Red-team tests deliberately omit auth headers at the global level.
    // Each test injects its own auth (or deliberately omits it) to test
    // the auth boundary. Do NOT add extraHTTPHeaders here.

    // Credential safety (OSE-1470): trace and video are OFF. Playwright traces record
    // every request's headers (CF-Access-Client-Secret, Authorization: Bearer <ADMIN_KEY>,
    // X-OCR-Internal) and the minted CF_Authorization cookie; CI uploads them as
    // artifacts anyone with repo read access can download. A plain page screenshot
    // shows no headers, so failure screenshots stay. Do not turn these back on.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',

    // Staging uses valid TLS — do not ignore errors in security tests
    ignoreHTTPSErrors: false,

    viewport: { width: 1280, height: 720 },

    // Use a real-looking UA — staging has Bot Management (OSE-306)
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },

  // Single Chromium project — security header tests are browser-agnostic.
  // The iframe clickjacking test (AUTH-005) needs a real browser context.
  projects: [
    {
      name: 'red-team-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

// ADR-021 (OSE-906): this suite never writes to production.
export default guardProduction(__filename, config);
