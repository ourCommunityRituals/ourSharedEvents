/**
 * OSE-286 — Fleet-wide surface visual regression baselines.
 *
 * Takes a full-page screenshot of every OSE surface at every device project
 * defined in playwright.config.ts (iPhone SE, iPhone 14 Pro Max, iPad Air,
 * Desktop Safari). Playwright namespaces snapshot filenames by project
 * automatically:
 *   landing-iPhone-SE-darwin.png
 *   landing-Desktop-Safari-darwin.png  …etc.
 *
 * ## Why every surface, not just /ui-preview
 *
 * /ui-preview baselines prove the component library renders correctly in
 * isolation. Surface baselines prove the design system holds in context —
 * a CSS change on a shared class can break the landing page layout without
 * touching /ui-preview at all. Any new surface Claude Design generates
 * inherits a baseline the moment it first deploys and this suite runs
 * with --update-snapshots.
 *
 * ## Surfaces covered (11)
 *
 *   /                              landing
 *   /events                        public events listing
 *   /events/evt_test_2026          public event page (data-dependent)
 *   /forms/evt_test_2026?type=*    register, checkin, survey, email-signup
 *   /admin                         admin dashboard (auth required)
 *   /sharedReport                  shared report (auth required)
 *   /poster                        poster preview
 *   /display                       TV/kiosk display board
 *   /ui-preview                    @ocr/ui component showcase
 *
 * ## Auth surfaces (/admin, /sharedReport)
 *
 * Require OSE_ADMIN_BEARER to be set to a real staging admin token.
 * When unset or equal to the test default, those surfaces are skipped
 * with the documented founder action — same logic as mobile-workability.spec.ts.
 *
 * ## Baseline management
 *
 * First run (creates baselines):
 *   npx playwright test --update-snapshots surfaces.visual
 *
 * After an intentional design change:
 *   npx playwright test --update-snapshots surfaces.visual
 *   git add tests/playwright/surfaces.visual.spec.ts-snapshots/
 *   git commit -m "chore(visual): update surface baselines after <change>"
 *
 * ## Determinism
 *
 * Animations frozen two ways:
 *   1. playwright.config.ts: toHaveScreenshot.animations='disabled'
 *   2. freezeAnimations() injects a <style> tag before capture
 *
 * Steady-state wait races aria-busy, data-ready, and a 3s timeout —
 * same model as mobile-workability.spec.ts so async surfaces (sharedReport)
 * are measured after data resolves.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || 'test-admin-key-e2e-2026';

const ADMIN_BEARER_IS_DEFAULT =
  !process.env.OSE_ADMIN_BEARER || process.env.OSE_ADMIN_BEARER === 'test-admin-key-e2e-2026';
const ADMIN_SKIP_REASON = ADMIN_BEARER_IS_DEFAULT
  ? 'Requires OSE_ADMIN_BEARER repo secret with a valid staging admin bearer. ' +
    'Founder action: `gh secret set OSE_ADMIN_BEARER --repo OurCommunityRituals/ourSharedEvents`'
  : undefined;

type SurfaceEntry = {
  path: string;
  /** Stable slug used in the snapshot filename — no special chars. */
  name: string;
  authHeader?: Record<string, string>;
  skipReason?: string;
};

const SURFACES: SurfaceEntry[] = [
  { path: '/', name: 'landing' },
  { path: '/events', name: 'events-listing' },
  { path: '/events/evt_test_2026', name: 'event-detail' },
  { path: '/forms/evt_test_2026?type=register', name: 'form-register' },
  { path: '/forms/evt_test_2026?type=checkin', name: 'form-checkin' },
  { path: '/forms/evt_test_2026?type=survey', name: 'form-survey' },
  { path: '/forms/evt_test_2026?type=email-signup', name: 'form-email-signup' },
  {
    path: '/admin',
    name: 'admin',
    authHeader: { Authorization: `Bearer ${ADMIN_BEARER}` },
    skipReason: ADMIN_SKIP_REASON,
  },
  {
    path: '/sharedReport',
    name: 'shared-report',
    authHeader: { Authorization: `Bearer ${ADMIN_BEARER}` },
    skipReason: ADMIN_SKIP_REASON,
  },
  { path: '/poster', name: 'poster' },
  { path: '/display', name: 'display' },
  { path: '/ui-preview', name: 'ui-preview' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadAndFreeze(page: Page, surface: SurfaceEntry): Promise<void> {
  if (surface.authHeader) {
    await page.setExtraHTTPHeaders(surface.authHeader);
  }
  await page.goto(`${BASE_URL}${surface.path}`, { waitUntil: 'domcontentloaded' });
  // Steady-state wait — same OCR-42 model as mobile-workability.spec.ts.
  await Promise.race([
    page
      .locator('main[aria-busy="false"], main:not([aria-busy])')
      .first()
      .waitFor({ state: 'attached', timeout: 3000 })
      .catch(() => null),
    page
      .locator('body[data-ready="true"]')
      .first()
      .waitFor({ state: 'attached', timeout: 3000 })
      .catch(() => null),
    page.waitForTimeout(3000),
  ]);
  // Belt-and-suspenders animation freeze alongside toHaveScreenshot config.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  });
}

// ── Surface baseline tests ────────────────────────────────────────────────────

for (const surface of SURFACES) {
  test(`OSE-286 | VR | ${surface.name} — full-page matches baseline`, async ({ page }) => {
    test.skip(!!surface.skipReason, surface.skipReason);
    await loadAndFreeze(page, surface);
    await expect(page).toHaveScreenshot(`${surface.name}.png`, { fullPage: true });
  });
}
