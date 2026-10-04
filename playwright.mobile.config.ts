import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
const { guardProduction } = require('./config/production-read-only');

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
 * LOCAL D1 IS MIGRATED, NOT PRE-SEEDED (OSE-1249)
 * -----------------------------------------------
 * The webServer applies `wrangler d1 migrations apply --local` (DB + FORMS_DB)
 * before `wrangler dev` starts, so the schema is present and /admin renders the
 * dashboard rather than erroring on `no such table: events`. This is what lets
 * the admin specs below actually exercise their controls at 375×812 — the
 * whole point of auditing /admin (OSE-1236), the largest and previously
 * never-mobile-audited surface.
 *
 * What is still NOT provided is an ambient seed. Content is created by the
 * specs that need it — admin-csp-controls seeds its own event via
 * POST /api/v2/admin/events. A spec that assumes pre-existing rows it did not
 * create will not find them, by design: a gate that silently audits a
 * different state than its name claims is worse than no gate.
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

/**
 * Local-only HMAC key for signed links (sponsor home, SharedReport). Without
 * it the worker fails closed — mint returns 503 SIGNING_NOT_CONFIGURED — and
 * /sponsor can only ever render its invalid-link page. Same reasoning as the
 * admin key above: it signs tokens for a worker that exists for this run only.
 * Random per run (64 hex chars, above the /health signingSecretConfigured
 * floor of 32): nothing outside the worker needs to know it — tokens are
 * minted by that same worker — so there is no literal for a secret scanner to
 * flag or a reader to reuse.
 */
const LOCAL_SIGNING_SECRET = randomBytes(32).toString('hex');

/**
 * Local-only keys for the forms database. Without them a registration that
 * carries a name answers 503 CONFIG_ERROR, so no browser flow can register.
 * Random per run, for the same reason as the signing secret above.
 */
const LOCAL_FORMS_KEY = randomBytes(32).toString('hex');
const LOCAL_FORMS_PEPPER = randomBytes(32).toString('hex');

// Read by the spec at import time. The config module is evaluated in the
// runner AND in each test worker process, so this reaches the spec in both.
process.env.OSE_ADMIN_BEARER = LOCAL_ADMIN_KEY;

const config = defineConfig({
  // No git commit or diff in reports (OSE-1470): uploaded artifacts must not
  // carry commit messages or source diffs. CI defaults both to true.
  captureGitInfo: { commit: false, diff: false },
  testDir: './tests/playwright',
  // Explicit list, not a directory sweep. tests/playwright/ holds specs written
  // against deployed staging; one that reads seeded rows would go green here
  // against an empty local D1 while no longer testing what it was written for.
  // A spec joins this gate only by being named.
  testMatch:
    /(mobile-workability|a11y-profile|admin-wizard-isolation|admin-csp-controls|admin-sponsor-form|sponsor-home-flow|landing-theme|publish-loop-journey|admin-deep-dive-journey|sponsor-surfaces-journey|attendee-forms-journey|report-counts-journey|form-sponsor-logo-fallback|admin-create-preview|admin-logs-settings-journey|event-page-choices)\.spec\.ts/,

  // Seeds a live event + sponsor and mints its /sponsor link so the phone audit
  // measures the real sponsor surface instead of skipping it. Runs after the
  // webServer is up. See tests/playwright/mobile.global-setup.ts.
  globalSetup: './tests/playwright/mobile.global-setup.ts',

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
    // Grant clipboard so the Copy URL control's real navigator.clipboard.writeText
    // resolves in headless CI (Chromium denies it without a permission grant, so
    // the button's graceful `.catch` sets "Failed" and the OSE-1239 "the button
    // is not dead" assertion never sees the real "Copied!" path). On a real phone
    // tap the write is user-activated and works; this makes the audit match that.
    // Chromium-only permission — this gate is Chromium-only by design.
    permissions: ['clipboard-read', 'clipboard-write'],
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
    {
      // Tablet (PO 2026-10-03): the same workability contracts at an iPad Air
      // portrait size. 820px sits past the templates' 768px breakpoints, so
      // this is the width where a page falls back to its desktop layout.
      name: 'tablet-chromium',
      testMatch: /mobile-workability\.spec\.ts/,
      metadata: { auditViewport: { width: 820, height: 1180 } },
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: false,
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
    {
      // WebKit for the organizer's publish loop (OSE-1508) and the sponsor
      // surfaces journey, which measures where the sponsor sits (OSE-1513):
      // most phones in the nightly matrix are WebKit. The rest of the audit
      // stays Chromium-only (see the workflow's install step for why).
      name: 'mobile-webkit',
      testMatch: /(publish-loop-journey|sponsor-surfaces-journey|event-page-choices)\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 375, height: 812 },
        // WebKit rejects the Chromium clipboard permissions set above.
        permissions: [],
      },
    },
  ],

  webServer: {
    // ALLOW_ADMIN_KEY_FALLBACK lives under [env.staging.vars] in wrangler.toml,
    // not top-level [vars], so `wrangler dev` with no --env leaves the Bearer
    // path (auth/admin.ts Method 3) switched off entirely and /admin answers
    // 401 no matter what key you send. Both vars are needed; one is not.
    // ADMIN_SCOPE_ALL lets a `key:` actor list events unscoped. Without it the
    // events table renders EMPTY for this worker — admin-brand-scope.ts scopes
    // key actors to their brand membership, and a local key has none — so any
    // test that needs to select an event has nothing to click. Same value CI's
    // vitest bindings already set, and it never elevates a real (email)
    // operator: that path resolves through the membership map, fail-closed.
    // Apply migrations to the SAME local D1 wrangler dev serves (both default
    // to .wrangler/state in this cwd) BEFORE the server boots, so /admin is a
    // working dashboard rather than `no such table: events` (OSE-1249). Idempotent
    // and non-interactive with --local; the specs seed their own content.
    command:
      `npx wrangler d1 migrations apply DB --local && ` +
      `npx wrangler d1 migrations apply FORMS_DB --local && ` +
      `npx wrangler dev --local --port ${PORT}` +
      ` --var ADMIN_KEY:${LOCAL_ADMIN_KEY}` +
      ` --var ALLOW_ADMIN_KEY_FALLBACK:true` +
      ` --var ADMIN_SCOPE_ALL:true` +
      ` --var SHARED_REPORT_SIGNING_SECRET:${LOCAL_SIGNING_SECRET}` +
      ` --var FORMS_ENCRYPTION_KEY:${LOCAL_FORMS_KEY}` +
      ` --var FORMS_HASH_PEPPER:${LOCAL_FORMS_PEPPER}` +
      // Publish grace window ON, as deployed, but 1 minute instead of 10 so a
      // spec can watch an event go from "live by link only" to listed.
      // helpers/sponsor-home-seed.ts waitUntilListed() waits it out.
      ` --var PUBLISH_GRACE_MINUTES:1`,
    cwd: 'workers/oursharedevents',
    url: BASE + '/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

// ADR-021 (OSE-906): this suite never writes to production.
export default guardProduction(__filename, config);
