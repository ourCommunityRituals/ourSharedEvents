/**
 * Playwright UI Smoke Test Configuration
 *
 * Stage-2 UI Smoke Pack Configuration
 * Validates "If you show it, it works" across Admin, Public, Display, and Poster surfaces.
 *
 * Story 1.2 (DevOps + SDET): All CI tests use https://stg.oursharedevents.com
 * - Reads process.env.BASE_URL with default = https://stg.oursharedevents.com
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

/**
 * Admin credential path (OSE-865 / OSE-1010) — the credential X-1 supplied but
 * nothing consumed. Built from env, never a literal in the repo:
 *   • CF-Access-Client-Id / -Secret  → clears the Cloudflare Access EDGE so the
 *     worker actually runs (without these, GET /admin 302s to the CF Access
 *     login and the worker never sees the request — see OSE-1010 / OSE-349).
 *   • Authorization: Bearer <ADMIN_KEY> → the worker-level admin guard.
 * Absent env → empty headers (clean no-op); the admin routes stay gated/ skipped
 * exactly as before. SRE owns rotation of these secrets (OSE-865 DevOps AC).
 *
 * NOTE: wiring the headers does not by itself re-enable the admin routes in the
 * blocking gate — the T4d `--grep-invert` stays until a staging run with a live
 * CF Access service token confirms the edge clears (OSE-1010 DoD).
 */
function adminExtraHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const { CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, ADMIN_KEY } = process.env;
  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    h['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID;
    h['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET;
  }
  if (ADMIN_KEY) h['Authorization'] = `Bearer ${ADMIN_KEY}`;
  return h;
}

export default defineConfig({
  testDir: './tests/ui/smoke',

  // Archived smoke specs (tests/ui/smoke/archive/**) are retired and some no
  // longer compile — never run them. Without this, a bare `playwright test`
  // (no file filter) fails to compile one archived spec and aborts discovery to
  // "0 tests in 0 files", masking the live tier-1 smoke. CI already dodges this
  // by passing an explicit tier1.spec.ts filter (ci.yml T4d); this makes the
  // config honest for local runs too, so the count can never go vacuously green.
  testIgnore: '**/archive/**',

  // UI smoke tests run sequentially to avoid race conditions
  fullyParallel: false,

  // Fail fast in CI - smoke tests should all pass
  forbidOnly: !!process.env.CI,

  // CI: 2 retries for flakiness tolerance; Local: 0 for fast feedback
  retries: process.env.CI ? 2 : 0,

  // Single worker - smoke tests are sequential health checks
  workers: 1,

  // UI tests need more time for page loads
  timeout: 60000,

  // Expect timeout for assertions (longer for dynamic content)
  expect: {
    timeout: 10000,
  },

  // Reporters
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report-ui-smoke', open: 'never' }],
        // outputFile honors PLAYWRIGHT_JSON_OUTPUT_NAME so pw-guarded.sh's Gate
        // 0b (OSE-1170) can point the result JSON at its own temp file; the
        // config value wins over the env var in Playwright's json reporter, so
        // the guard cannot override it from outside — it must be wired here.
        [
          'json',
          {
            outputFile:
              process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || '.test-results/ui-smoke-results.json',
          },
        ],
        ['junit', { outputFile: '.test-results/ui-smoke-junit.xml' }],
        ['line'],
      ]
    : [
        ['html', { outputFolder: 'playwright-report-ui-smoke', open: 'never' }],
        // outputFile honors PLAYWRIGHT_JSON_OUTPUT_NAME so pw-guarded.sh's Gate
        // 0b (OSE-1170) can point the result JSON at its own temp file; the
        // config value wins over the env var in Playwright's json reporter, so
        // the guard cannot override it from outside — it must be wired here.
        [
          'json',
          {
            outputFile:
              process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || '.test-results/ui-smoke-results.json',
          },
        ],
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

    // Admin credential headers (OSE-865/OSE-1010) — env-driven, empty when unset.
    extraHTTPHeaders: adminExtraHeaders(),
  },

  // Browser projects for UI smoke tests.
  //
  // Tiering (OSE-1058): the full device matrix (iPhone/iPad/Android/desktop) runs
  // on the deep E2E journey suite; the remaining flows — this tier-1 page-smoke
  // pack included — verify cross-browser on the two engines that matter: Safari
  // (WebKit) and Chrome (Chromium). That catches engine-level rendering/JS
  // divergence cheaply without quadrupling every smoke on emulated devices.
  // The T4 install fetches `chromium webkit` so both engines are present
  // (the retired self-hosted box had webkit globally cached, masking the need).
  projects: [
    {
      name: 'ui-smoke-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ui-smoke-safari',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // No webServer - tests run against deployed URLs
});
