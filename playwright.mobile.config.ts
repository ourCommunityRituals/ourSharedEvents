import { defineConfig, devices } from '@playwright/test';

/**
 * Mobile workability against PR CODE — invariant 14's blocking gate (OSE-1236).
 *
 * WHY THIS CONFIG EXISTS
 * ----------------------
 * `mobile-workability-audit.yml` pointed Playwright at `STAGING_URL`. Two
 * consequences, both measured 2026-09-05:
 *
 *   1. On a pull_request it audited DEPLOYED STAGING — that is, whatever was
 *      already merged — and reported the result as a check on the PR. A PR
 *      that broke a touch target passed; a PR that fixed one still failed. The
 *      check's verdict was uncorrelated with the diff under review.
 *   2. It was `continue-on-error: true` on PRs, so the verdict could not block
 *      anything regardless.
 *
 * Meanwhile the SCHEDULED run failed four nights running (runs 187, 188, 189,
 * 192 — every schedule event since 2026-09-01). Its top failure mode was not a
 * workability violation at all:
 *
 *      browserType.launch: Executable doesn't exist at .../webkit-2336/pw_run.sh
 *
 * Three of the four projects in `playwright.config.ts` are WebKit device
 * descriptors (`devices['iPhone SE']`, `['iPhone 14 Pro Max']`, `['iPad Air 5']`
 * all carry defaultBrowserType 'webkit'), and the workflow installs
 * `chromium` only. So the one run that COULD block was red every night for a
 * reason that says nothing about mobile workability — and a gate that is always
 * red teaches people to ignore it just as surely as one that is always green.
 *
 * THE SPLIT THIS CONFIG MAKES
 * ---------------------------
 *   this config      → PR code, local worker, Chromium, BLOCKING
 *   the nightly      → deployed staging, all four projects, still blocking
 *
 * They answer different questions and both are worth asking. "Did this diff
 * break mobile?" is answerable from a local worker on every PR in ~3 minutes.
 * "Is production mobile-workable right now?" needs the deployed target, real
 * data, and the edge — and cannot gate a PR, because its answer depends on
 * things the PR does not control.
 *
 * WHY CHROMIUM ONLY HERE
 * ----------------------
 * The spec calls `page.setViewportSize(375×812)` on every surface, so the
 * viewport — the thing invariant 14 is actually about — is identical across
 * projects; what differs is engine and UA. Engine-specific layout bugs are
 * real, which is why the nightly keeps all four. But a blocking PR gate is
 * bought with contributor minutes, and the marginal find rate of three more
 * engines does not justify quadrupling the cost on every push. Chromium is
 * also the one engine the workflow already installs, so this gate cannot fail
 * for a missing-browser reason.
 *
 * WHAT THIS GATE CANNOT SEE (stated, not discovered later)
 * --------------------------------------------------------
 * Local D1 has no migrations and no seed, so:
 *   - `/events/evt_test_2026` serves the branded 503 outage page, not an event
 *   - `/admin` serves the 401 sign-in page, not the dashboard
 * Both are real surfaces a person can reach and are worth auditing, but they
 * are NOT the pages the same paths serve on staging. The surface list below
 * is therefore explicit and annotated rather than inherited wholesale — a gate
 * that silently audits a different page than its name claims is worse than no
 * gate, because it reports confidence it has not earned.
 */
const PORT = Number(process.env.MOBILE_PORT ?? 8789);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Local-only admin key, so this gate can audit /admin and /sharedReport.
 *
 * The spec skips both surfaces when OSE_ADMIN_BEARER is unset OR equal to the
 * shared test default — because on STAGING that means the request is
 * unauthenticated, Cloudflare Bot Management serves a challenge page, and the
 * audit measures Cloudflare's UI instead of OSE's. That reasoning is sound for
 * staging and irrelevant here: a local worker has no Cloudflare in front of it.
 *
 * The consequence of leaving it skipped is not small. `/admin` is the LARGEST
 * surface in the bundle — admin.html is 162.7KB, 55% of all template bytes —
 * and it has never been mobile-audited on any run, because OSE-302's staging
 * bearer secret has been unset since May. Passing a key the local worker will
 * accept converts 10 permanently-skipped tests into 10 that run on every PR.
 *
 * The value is distinct from the shared `test-admin-key-e2e-2026` default on
 * purpose: matching that default is precisely what triggers the skip.
 *
 * This grants no access anywhere. `wrangler dev --local` is an in-process
 * miniflare with an empty D1; the key authenticates against a worker that
 * exists for the length of this run.
 */
const LOCAL_ADMIN_KEY = 'ose-local-mobile-audit-key';

// Read by the spec at import time. The config module is evaluated in the
// runner AND in each test worker process, so this reaches the spec in both.
process.env.OSE_ADMIN_BEARER = LOCAL_ADMIN_KEY;

export default defineConfig({
  testDir: './tests/playwright',
  // Explicit list, not a directory sweep. tests/playwright/ holds specs written
  // against deployed staging; one that reads seeded rows would go green here
  // against an empty local D1 while no longer testing what it was written for.
  // A spec joins this gate only by being named.
  testMatch: /(mobile-workability|admin-wizard-isolation)\.spec\.ts/,

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0, // a workability check that needs a retry is measuring the wrong thing
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        ['junit', { outputFile: '.test-results/mobile-junit.xml' }],
      ]
    : [['list']],

  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The spec forces 375×812 per surface; this is the launch default only.
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: false, // Chromium's isMobile is not supported alongside some device args
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],

  webServer: {
    // ALLOW_ADMIN_KEY_FALLBACK lives under [env.staging.vars] in wrangler.toml,
    // not top-level [vars], so `wrangler dev` with no --env leaves the Bearer
    // path (auth/admin.ts Method 3) switched off entirely and /admin answers
    // 401 no matter what key you send. Both vars are needed; one is not.
    command:
      `npx wrangler dev --local --port ${PORT}` +
      ` --var ADMIN_KEY:${LOCAL_ADMIN_KEY}` +
      ` --var ALLOW_ADMIN_KEY_FALLBACK:true`,
    cwd: 'workers/oursharedevents',
    url: BASE + '/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
