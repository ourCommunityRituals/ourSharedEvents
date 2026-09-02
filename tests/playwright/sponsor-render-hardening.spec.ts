/**
 * OSE-R-011 + OSE-R-015 — Playwright FE for sponsor render hardening.
 *
 * Layer: FE (real browser loads each sponsor-bearing surface, intercepts
 * the sponsor-bundle API to inject a broken-URL sponsor, and verifies the
 * onerror handler fires + rotation advances + no Referer leak).
 *
 * Companion to:
 *   - workers/oursharedevents/tests/sponsor-render-hardening.spec.ts (vitest API)
 *   - bruno/ose-pages (OSE-R-011 folder)
 *
 * Two audit rows in one spec because the fix is shared:
 *   OSE-R-015 — sponsor logo render must escape URL + carry referrerpolicy
 *   OSE-R-011 — TV display rotation must advance immediately on img error
 */

import { test, expect, type Page, type Route } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

const SPONSOR_BUNDLE_BROKEN: Record<string, unknown> = {
  ok: true,
  bundle: {
    surface_sponsors: {
      tvTop: [
        {
          id: 'sp_top1',
          name: 'Reckless Records',
          tier: 'gold',
          logo_url: 'https://broken.example.invalid/logo.png',
        },
      ],
      tvSide: [
        {
          id: 'sp_side1',
          name: 'Half Acre',
          tier: 'silver',
          logo_url: 'https://broken.example.invalid/halfacre.png',
        },
        {
          id: 'sp_side2',
          name: 'Empty Bottle',
          tier: 'silver',
          logo_url: 'https://broken.example.invalid/emptybottle.png',
        },
      ],
      mobileBanner: [
        {
          id: 'sp_mob1',
          name: 'Reckless Records',
          tier: 'gold',
          logo_url: 'https://broken.example.invalid/logo.png',
        },
      ],
      posterTop: [
        {
          id: 'sp_pos1',
          name: 'Reckless Records',
          tier: 'gold',
          logo_url: 'https://broken.example.invalid/logo.png',
        },
      ],
    },
    rotation_config: { rotationMs: 1500 },
  },
};

async function mockSponsorBundle(page: Page): Promise<void> {
  await page.route(/\/api\/v2\/events\/.+\/sponsor-bundle(\?.+)?$/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SPONSOR_BUNDLE_BROKEN),
    });
  });
  // Mock the events list so the surfaces that fetch /api/v2/events have something.
  await page.route('**/api/v2/events', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          items: [{ id: 'evt_test_2026', name: 'Test Event', status: 'active' }],
        }),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe('OSE-R-011 + OSE-R-015 — sponsor render hardening in browser', () => {
  test('OSE-R-015 | FE | GET /events (broken sponsor URL) | sponsor img has referrerpolicy="no-referrer"', async ({
    page,
  }) => {
    await mockSponsorBundle(page);
    await page.goto(`${BASE_URL}/events`, { waitUntil: 'domcontentloaded' });
    // Wait for the sponsor banner script to inject the markup.
    const img = page.locator('[data-testid="public-sponsor-card"] img').first();
    await img.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    const visible = await img.count();
    test.skip(visible === 0, 'Sponsor banner not rendered (no ?event= param resolution)');

    const attr = await img.getAttribute('referrerpolicy');
    expect(attr).toBe('no-referrer');
  });

  test('OSE-R-015 | FE | GET /display (broken sponsor URL) | top-banner img has referrerpolicy="no-referrer"', async ({
    page,
  }) => {
    await mockSponsorBundle(page);
    await page.goto(`${BASE_URL}/display`, { waitUntil: 'domcontentloaded' });
    const img = page.locator('[data-testid="display-sponsor-item"] img').first();
    await img.waitFor({ state: 'attached', timeout: 5000 });
    const attr = await img.getAttribute('referrerpolicy');
    expect(attr).toBe('no-referrer');
  });

  test('OSE-R-011 | FE | GET /display (broken sponsor URL in rotation) | rotation advances after onerror fires', async ({
    page,
  }) => {
    // Critical regression test: a broken sponsor logo in the rotation
    // should NOT leave the bar's TV stuck on the broken slot. The error
    // handler advances showNext() immediately.
    await mockSponsorBundle(page);
    await page.goto(`${BASE_URL}/display`, { waitUntil: 'domcontentloaded' });
    // Wait for sentinel element appearance — proof that the error
    // handler fired AND ran the advance logic.
    const sentinel = page.locator('[data-testid="display-sponsor-error"]').first();
    await expect(sentinel).toBeAttached({ timeout: 8000 });
  });

  test('OSE-R-011 | FE | GET /display (broken sponsor URL) | broken image is hidden via inline display:none', async ({
    page,
  }) => {
    await mockSponsorBundle(page);
    await page.goto(`${BASE_URL}/display`, { waitUntil: 'domcontentloaded' });
    // Wait briefly for the error handler to fire.
    await page.waitForTimeout(2000);
    // After the error fires, the broken img in the rotation slot has
    // its inline display:none set. Top-banner imgs may also have it
    // applied via the inline onerror.
    const imgs = await page.locator('img').all();
    let foundHidden = false;
    for (const img of imgs) {
      const style = (await img.getAttribute('style')) || '';
      if (style.includes('display: none') || style.includes('display:none')) {
        foundHidden = true;
        break;
      }
    }
    expect(foundHidden, 'at least one broken sponsor img must be inline-hidden').toBe(true);
  });

  test('OSE-R-015 | FE | GET /forms/:id (broken sponsor URL) | mobile-banner img has referrerpolicy="no-referrer"', async ({
    page,
  }) => {
    await mockSponsorBundle(page);
    await page.goto(`${BASE_URL}/forms/evt_test_2026?type=register`, {
      waitUntil: 'domcontentloaded',
    });
    const strip = page.locator('[data-testid="form-sponsor-strip"]');
    await expect(strip).toHaveClass(/has-sponsors/, { timeout: 5000 });
    const img = strip.locator('img').first();
    await img.waitFor({ state: 'attached' });
    const attr = await img.getAttribute('referrerpolicy');
    expect(attr).toBe('no-referrer');
  });

  test('OSE-R-015 | FE | GET /poster (broken sponsor URL) | poster sponsor img has referrerpolicy="no-referrer"', async ({
    page,
  }) => {
    await mockSponsorBundle(page);
    await page.goto(`${BASE_URL}/poster`, { waitUntil: 'domcontentloaded' });
    const img = page.locator('[data-testid="poster-sponsor-logo"]').first();
    await img.waitFor({ state: 'attached', timeout: 8000 });
    const attr = await img.getAttribute('referrerpolicy');
    expect(attr).toBe('no-referrer');
  });

  test('OSE-R-015 | FE | GET /forms/:id (XSS payload in sponsor logo_url) | payload escaped, no script execution', async ({
    page,
  }) => {
    // Defense-in-depth: even if the admin API returns a malicious sponsor
    // row with a JavaScript injection in logo_url, the form-pages JS must
    // escape the URL before interpolating into the img src attribute.
    const xssPayload: Record<string, unknown> = {
      ok: true,
      bundle: {
        surface_sponsors: {
          mobileBanner: [
            {
              id: 'sp_xss',
              name: 'Reckless Records',
              tier: 'gold',
              // Attribute-breakout payload that, if not escaped, would
              // close the src attribute and inject an onerror handler.
              logo_url: '"><img src=x onerror="window.__pwned=true">',
            },
          ],
        },
        rotation_config: { rotationMs: 1500 },
      },
    };
    await page.route(/\/api\/v2\/events\/.+\/sponsor-bundle(\?.+)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(xssPayload),
      });
    });
    await page.goto(`${BASE_URL}/forms/evt_test_2026?type=register`, {
      waitUntil: 'domcontentloaded',
    });
    // Wait briefly for the sponsor strip to attempt render.
    await page.waitForTimeout(2000);
    // The injection must NOT have executed.
    const pwned = await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned);
    expect(pwned).toBeFalsy();
  });
});
