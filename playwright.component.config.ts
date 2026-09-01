/**
 * Playwright COMPONENT / VIEWPORT config — real browser engine, NO deploy.
 *
 * WHY THIS CONFIG EXISTS
 * ----------------------
 * Every other Playwright config in this repo points at a deployed URL via
 * `getBaseUrl()`, and none starts a server — each one says so in a comment:
 * "No webServer - tests run against deployed URLs". That single fact is what
 * kept the FE rung ungated: 55 specs across the five surfaces are named in no
 * workflow, and every tier that could run them (T2 → T3 → T4) sits behind
 * staging. Nothing about the specs blocks them. Where they point does.
 *
 * This config starts a local Worker (`wrangler dev --local`, miniflare) and
 * points Playwright at it. Measured on a clean checkout: the worker is serving
 * in ~4s, and `/`, `/poster`, `/display` and `/public` all return 200 text/html.
 * That is enough for layout- and geometry-shaped assertions, which is exactly
 * what OSE-1070 classified as COMPONENT/VIEWPORT (47 specs / 995 tests,
 * destination "real-engine Playwright CT on Chromium *and* WebKit — no deploy").
 *
 * THE BOUNDARY, MEASURED NOT ASSUMED
 * ----------------------------------
 * On the same local worker `/api/v2/events` returns 503 — local D1 has no
 * migrations applied and no seed. So the split is empirical, not a guess:
 *   - renders-and-lays-out  → runs here, today, on every PR   (this config)
 *   - needs seeded data     → INTEGRATION rung, in-job miniflare + migrations
 * A spec that reads data will fail loudly here rather than pass vacuously.
 *
 * WHAT MOVING A SPEC HERE CAN GET WRONG
 * -------------------------------------
 * A spec written against staging may assert on seeded rows, CF Access
 * redirects, or edge behaviour a local worker does not reproduce — so it can
 * go green here while no longer testing what it was written for. That is a
 * false green manufactured by the migration itself. OSE-1070 says the same in
 * its limits: classification is file-level, so "one edge-dependent assertion
 * inside an otherwise demotable spec would be missed."
 *
 * Therefore: specs are added to this config ONE REVIEWED BATCH AT A TIME, by
 * explicit file list on the command line — never by a broad testMatch that
 * sweeps in specs nobody read. `poster-qr-layout.spec.ts` is the worked
 * example of why: it navigates to the absolute URL `http://poster.test/poster`,
 * so it ignores baseURL entirely and would NOT follow this config. File-level
 * capability detection classified it as component; an assertion-level read
 * caught it. It stays out until its host mapping is decided.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.COMPONENT_PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',

  // Deliberately no testMatch. Batches are passed explicitly on the CLI so a
  // spec cannot join this tier without someone naming it. See the header.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a component test that needs a retry is telling you something
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: '.test-results/component-junit.xml' }]]
    : [['list']],

  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // OSE-1070's destination names Chromium AND WebKit — layout regressions are
  // routinely engine-specific, and a Chromium-only pass would understate them.
  // WebKit is listed second so a runner missing its deps fails on a named
  // project rather than silently reducing coverage.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Escape hatch for sandboxes whose preinstalled Chromium build does not
        // match the pinned @playwright/test. Unset in CI, where `playwright
        // install --with-deps chromium` (as the T0 invariants shard already
        // does) provides the matching binary.
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    command: 'npx wrangler dev --local --port ' + PORT,
    cwd: 'workers/oursharedevents',
    url: BASE + '/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // measured ~4s locally; CI cold-start needs real headroom
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
