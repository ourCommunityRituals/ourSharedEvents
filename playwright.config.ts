/**
 * OSE-306 — Playwright global config.
 *
 * ## UA override (OSE-306)
 *
 * Override the default Chromium UA so it doesn't read as
 * `HeadlessChrome/...`, which Cloudflare's Bot Management intercepts
 * with a challenge page on every staging request from our self-hosted
 * BLOODRAVEN runners.
 *
 * Reproduction (2026-05-16):
 *   curl -A "Mozilla/5.0 ... Chrome/120 ..."       → 200, OSE page
 *   curl -A "Mozilla/5.0 ... HeadlessChrome/123 ..." → 403, Cf-Mitigated:challenge
 *
 * Mobile Safari UA matching iPhone 13 Mini / iPhone X (canonical
 * mobile-workability viewport). Cloudflare whitelists this UA shape
 * as a real-customer pattern. Kept inline so measurement is
 * deterministic — no environment drift.
 *
 * ## Visual regression screenshot defaults (OSE-286)
 *
 * `expect.toHaveScreenshot` controls the pixel-diff gate for all
 * calls to `expect(page|locator).toHaveScreenshot()` across the fleet:
 *
 * - maxDiffPixelRatio 0.02: tolerates up to 2% pixel difference —
 *   absorbs sub-pixel anti-aliasing variance between Chromium versions
 *   and OS renderers while still catching real layout regressions.
 * - animations 'disabled': tells Playwright's screenshot engine to
 *   freeze CSS animations/transitions at their initial keyframe before
 *   capturing, so spinners and transition states don't make diffs
 *   non-deterministic. Works alongside the `freeze-animations` style
 *   injected in visual specs for belt-and-suspenders determinism.
 * - threshold 0.1: per-pixel color tolerance (0–1 scale). 0.1 is
 *   tighter than Playwright's default 0.2 — appropriate for a design
 *   system where exact color is meaningful, not just structure.
 *
 * Snapshots live next to their spec files in
 * `{spec-name}.spec.ts-snapshots/`, committed to the repo. The first
 * run of `ui-preview.visual.spec.ts` creates the baselines. Subsequent
 * runs compare against them. To update baselines after an intentional
 * design change: `npx playwright test --update-snapshots ui-preview.visual`
 * then commit the new PNG files.
 *
 * ## What this config does NOT do
 *
 * - Does NOT set a viewport (per-test concern — mobile-workability uses
 *   375×812, visual spec uses 1280×900 desktop + 375×812 mobile).
 * - Does NOT set baseURL — env vars (STAGING_URL etc.) drive that.
 * - Does NOT set reporter/output config — CI workflow chooses those.
 */

import { defineConfig, devices } from '@playwright/test';
const { guardProduction } = require('./config/production-read-only');

// All UAs are real Safari patterns that Cloudflare Bot Management
// whitelists. HeadlessChrome UA triggers a 403 challenge on staging
// (reproduced 2026-05-16 per OSE-306). Every project overrides UA
// explicitly so no test runs under the default Chromium headless UA.
const UA = {
  iphoneSe:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  iphone14ProMax:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadAir:
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  desktopSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

const config = defineConfig({
  testDir: 'tests/playwright',

  // OSE-1236: specs navigate RELATIVE and let this resolve the target. Before
  // this line, mobile-workability.spec.ts built absolute URLs from
  // STAGING_URL, so it could not be pointed at anything — including a local
  // worker serving the PR's own code. One resolution mechanism, here.
  use: {
    baseURL: process.env.STAGING_URL || 'https://stg.oursharedevents.com',
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      threshold: 0.1,
    },
  },
  projects: [
    {
      // Smallest modern iPhone — the WCAG floor.
      name: 'iPhone SE',
      use: { ...devices['iPhone SE'], userAgent: UA.iphoneSe },
    },
    {
      // Largest current iPhone — validates nothing collapses on wide mobile.
      name: 'iPhone 14 Pro Max',
      use: { ...devices['iPhone 14 Pro Max'], userAgent: UA.iphone14ProMax },
    },
    {
      // Tablet — tests layout at the medium breakpoint where mobile/desktop
      // patterns often collide (two-column layouts, nav changes, etc.).
      //
      // `devices['iPad Air 5']` is not a real Playwright device key (no
      // version ships one — only 'iPad (gen N)' / 'iPad Mini' / 'iPad Pro 11'
      // exist). That typo silently spread `undefined`, so this project ran
      // with NO touch emulation at all: no hasTouch, no isMobile, default
      // browserType — a plain desktop context wearing an iPad UA string, not
      // a tablet. It never surfaced because the mobile-workability spec
      // overrides the viewport itself (MOBILE_VIEWPORT), so the run still
      // "passed" most checks; it only became visible once a check depended
      // on pointer:coarse (the footer's touch-target CSS), where this project
      // started failing identically to Desktop Safari instead of passing like
      // the other two real touch/device projects.
      name: 'iPad Air',
      use: { ...devices['iPad (gen 7)'], userAgent: UA.ipadAir },
    },
    {
      // Desktop — full-width layout, hover states, larger touch targets.
      name: 'Desktop Safari',
      use: { viewport: { width: 1280, height: 900 }, userAgent: UA.desktopSafari },
    },
  ],
});

// ADR-021 (OSE-906): this suite never writes to production.
export default guardProduction(__filename, config);
