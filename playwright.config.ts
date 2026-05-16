/**
 * OSE-306 — Playwright global config.
 *
 * Sole purpose today: override the default Chromium UA so it doesn't
 * read as `HeadlessChrome/...`, which Cloudflare's Bot Management
 * intercepts with a challenge page on every staging request from our
 * self-hosted BLOODRAVEN runners.
 *
 * ## Why
 *
 * Reproduction (2026-05-16):
 *   curl -A "Mozilla/5.0 ... Chrome/120 ..."       → 200, OSE page (correct)
 *   curl -A "Mozilla/5.0 ... HeadlessChrome/123 ..." → 403, Cf-Mitigated:challenge
 *
 * Without this override, the mobile-workability audit measures the CF
 * challenge page instead of OSE — producing 5 false-positive
 * violations across /events/:id and /sharedReport (per audit run
 * 25952807821). The challenge page has its own anchors (54×18, 37×18)
 * and a wider layout (scrollWidth=470 > clientWidth=375) that look
 * like OSE bugs but aren't.
 *
 * ## Why Mobile Safari UA specifically
 *
 * The mobile-workability audit runs at 375×812 (iPhone 13 Mini /
 * iPhone X viewport). Real customers hitting that viewport are on
 * Mobile Safari. Using the same UA makes the audit measure what a
 * real iPhone customer would actually see — including any
 * CDN/Cloudflare/server response paths that branch on UA. This is
 * more representative than a generic desktop Chrome UA would be.
 *
 * Other Playwright suites in tests/playwright/* (admin-friendly-labels,
 * landing-page, etc.) inherit this UA. Confirmed safe via:
 *   grep -r "setUserAgent\|userAgent" tests/playwright/
 *   (returns nothing — no existing UA dependencies)
 *
 * ## What this config does NOT do
 *
 * - Does NOT set a viewport (each test sets its own per design — e.g.
 *   mobile-workability uses 375×812, other suites use whatever they
 *   need). Viewport is a per-test concern, UA is a per-environment
 *   concern.
 * - Does NOT set baseURL — env vars (STAGING_URL etc.) drive that.
 * - Does NOT set reporter/output config — CI workflow chooses those.
 *
 * Per ADR convention: this is a small focused config that does one
 * load-bearing thing. If more global Playwright config is needed
 * later, it gets added here with its own commented rationale.
 */

import { defineConfig } from '@playwright/test';

// Mobile Safari UA matching iPhone 13 Mini / iPhone X (the canonical
// mobile-workability viewport). Cloudflare's Bot Management whitelists
// this UA shape as a real-customer pattern. Kept inline (not behind
// an env var) so the audit's measurement is deterministic across CI
// runs and local dev — no environment drift.
const MOBILE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 ' +
  'Mobile/15E148 Safari/604.1';

export default defineConfig({
  testDir: 'tests/playwright',
  use: {
    userAgent: MOBILE_SAFARI_UA,
  },
});
