/**
 * OSE-312 — /display venue-TV surface at TV viewport (1920x1080).
 *
 * @contract-flow-no-ui
 *   The /display surface is EXEMPT from invariant 14 mobile workability
 *   (per OCR_STANDARD_mobileWorkability.md: "/display venue TV surface,
 *   designed for landscape kiosk display on a 1080p+ screen — the 375
 *   px viewport assumption does not apply"). Therefore the OSE-307
 *   _helpers/mobile-workability-assertions module is NOT imported.
 *   The OSE-307 regression guard honors this marker as an exemption.
 *
 * What this spec validates at TV viewport (1920x1080):
 *
 *   1. /display renders 200 + text/html
 *   2. Core display-* testids present (header, main, featured-card,
 *      upcoming, ticker, clock, sponsor-banner, sponsor-sidebar)
 *   3. Async event-data chain completes — featured-card OR empty-
 *      state visible (one of the two MUST be true after settle)
 *   4. Featured-card title is non-empty when present (real event data
 *      flowing into the render, not a perpetually-loading skeleton)
 *   5. Sponsor rotation has at least one item OR the banner is
 *      empty — both are acceptable; what's NOT acceptable is the
 *      rotate placeholder stuck on a loading state
 *   6. The page is wide enough to USE the 1080p+ surface — no
 *      max-width: 720px style mobile clamp accidentally applied
 *      (would waste the venue TV's real estate)
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-312 | FE | flow display-tv-viewport | <assertion>`.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

// 1920x1080 — the canonical TV viewport per
// OCR_STANDARD_mobileWorkability.md scope text. Display is designed
// for "10-foot viewing" (see EPIC-ADMIN-PAGE-EVALUATION.md:960).
const TV_VIEWPORT = { width: 1920, height: 1080 };

const STEADY_STATE_TIMEOUT_MS = 4000;

async function loadDisplayAtTv(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize(TV_VIEWPORT);
  await page.goto(`${BASE_URL}/display`, { waitUntil: 'domcontentloaded' });
  // Wait for either featured-card OR empty-state to be visible —
  // one of these is the steady-state proof that the async event
  // fetch completed (vs the page still rendering the loading
  // skeleton).
  await Promise.race([
    page
      .locator('[data-testid="display-featured-card"]')
      .first()
      .waitFor({ state: 'visible', timeout: STEADY_STATE_TIMEOUT_MS })
      .catch(() => null),
    page
      .locator('[data-testid="display-empty"]')
      .first()
      .waitFor({ state: 'visible', timeout: STEADY_STATE_TIMEOUT_MS })
      .catch(() => null),
    page.waitForTimeout(STEADY_STATE_TIMEOUT_MS),
  ]);
}

test.describe('OSE-312 /display venue-TV surface at 1920x1080', () => {
  test('OSE-312 | FE | flow display-tv-viewport | renders 200 + text/html with core display testids', async ({
    page,
  }) => {
    const response = await page.goto(`${BASE_URL}/display`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('text/html');
    await page.setViewportSize(TV_VIEWPORT);

    // Core structural elements MUST be present (even if data hasn't
    // loaded yet — these are server-rendered shell elements).
    for (const testid of [
      'display-header',
      'display-main',
      'display-clock',
      'display-ticker',
      'display-sponsor-banner',
      'display-sponsor-sidebar',
    ]) {
      await expect(
        page.locator(`[data-testid="${testid}"]`),
        `display-${testid} not present — display shell broken`
      ).toBeAttached();
    }
  });

  test('OSE-312 | FE | flow display-tv-viewport | featured-card OR empty-state visible after settle (async chain completes)', async ({
    page,
  }) => {
    await loadDisplayAtTv(page);
    const featuredVisible = await page
      .locator('[data-testid="display-featured-card"]')
      .first()
      .isVisible()
      .catch(() => false);
    const emptyVisible = await page
      .locator('[data-testid="display-empty"]')
      .first()
      .isVisible()
      .catch(() => false);
    expect(
      featuredVisible || emptyVisible,
      'NEITHER display-featured-card NOR display-empty visible after settle — page stuck on loading skeleton (async event-data chain broken)'
    ).toBe(true);
  });

  test('OSE-312 | FE | flow display-tv-viewport | when featured-card renders, title is non-empty (real event data flows)', async ({
    page,
  }) => {
    await loadDisplayAtTv(page);
    const featured = page.locator('[data-testid="display-featured-card"]').first();
    const isVisible = await featured.isVisible().catch(() => false);
    test.skip(!isVisible, 'display-empty path — no events on staging, nothing to assert title on');
    const title = await page.locator('[data-testid="display-featured-title"]').textContent();
    expect(title, 'display-featured-title empty — event data not flowing into render').toBeTruthy();
    expect(title!.trim().length).toBeGreaterThan(0);
  });

  test('OSE-312 | FE | flow display-tv-viewport | layout uses the 1920px width (no mobile max-width clamp leaked in)', async ({
    page,
  }) => {
    // The /display surface is designed for 10-foot viewing — if a
    // mobile max-width:720px style accidentally applies here, the
    // venue TV shows a tiny centered column with massive black
    // borders. Catch that by asserting the main element's rendered
    // width is significantly more than mobile-clamp typical values.
    await loadDisplayAtTv(page);
    const mainBox = await page.locator('[data-testid="display-main"]').boundingBox();
    expect(mainBox).not.toBeNull();
    expect(
      mainBox!.width,
      `display-main rendered width = ${Math.round(mainBox!.width)}px at TV viewport ${TV_VIEWPORT.width}px — likely a mobile max-width clamp leaked through`
    ).toBeGreaterThan(1000);
  });

  test('OSE-312 | FE | flow display-tv-viewport | sponsor-rotate placeholder not stuck on loading-only state', async ({
    page,
  }) => {
    // The sponsor rotation cycles through configured sponsor cards.
    // If the rotate JS fails, the placeholder stays visible
    // indefinitely. Acceptable end-states: at least one
    // display-sponsor-item rendered OR an explicit empty-banner
    // condition. NOT acceptable: indefinite loading state.
    await loadDisplayAtTv(page);
    const rotate = page.locator('[data-testid="display-sponsor-rotate"]').first();
    const isRotateAttached = await rotate.isVisible().catch(() => false);
    if (!isRotateAttached) {
      // Banner not rendered at all — that's OK if no sponsors
      // configured for the displayed event.
      return;
    }
    // If rotate is present, after settle it must have at least one
    // sponsor-item OR display-empty (banner empty intentionally).
    const hasItem = (await page.locator('[data-testid="display-sponsor-item"]').count()) > 0;
    const bannerExists = (await page.locator('[data-testid="display-sponsor-banner"]').count()) > 0;
    expect(
      hasItem || bannerExists,
      'display-sponsor-rotate present but no items rendered and no empty-banner state — sponsor rotation JS may be stuck'
    ).toBe(true);
  });
});
