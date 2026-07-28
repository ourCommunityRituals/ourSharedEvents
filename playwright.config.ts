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

import { defineConfig } from '@playwright/test';

const MOBILE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 ' +
  'Mobile/15E148 Safari/604.1';

export default defineConfig({
  testDir: 'tests/playwright',
  use: {
    userAgent: MOBILE_SAFARI_UA,
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      threshold: 0.1,
    },
  },
});
