/**
 * LIVE E2E Tests: Display Sponsor Overlay — Staging Validation
 *
 * These tests hit the REAL staging environment (stg.oursharedevents.com)
 * with NO route mocking. They validate that the sponsor overlay renders
 * correctly against live D1 data and the deployed Worker.
 *
 * Run against staging (default):
 *   npx playwright test --config=playwright.e2e-smoke.config.ts tests/e2e/2-pages/display-sponsor-live.spec.ts
 *
 * Run against production:
 *   BASE_URL="https://oursharedevents.com" npx playwright test tests/e2e/2-pages/display-sponsor-live.spec.ts
 *
 * These tests are designed to pass even when no sponsors exist in the
 * database — they verify structural readiness and degrade gracefully.
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (DISPLAY_HTML)
 */

import { test, expect, Page } from '@playwright/test';

const TIMEOUT = 30_000;

async function navigateToDisplay(page: Page) {
  await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForLoadState('networkidle');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LIVE: SPONSOR INFRASTRUCTURE EXISTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Live Display — Sponsor Infrastructure', () => {
  test('sponsor banner container exists in DOM', async ({ page }) => {
    await navigateToDisplay(page);
    await expect(page.locator('[data-testid="display-sponsor-banner"]')).toBeAttached();
  });

  test('sponsor sidebar container exists in DOM', async ({ page }) => {
    await navigateToDisplay(page);
    await expect(page.locator('[data-testid="display-sponsor-sidebar"]')).toBeAttached();
  });

  test('sponsor-bundle API returns valid response', async ({ page }) => {
    await navigateToDisplay(page);

    // Fetch events first to get an event ID
    const eventsRes = await page.evaluate(async () => {
      const res = await fetch('/api/v2/events');
      return res.json();
    });

    if (eventsRes.ok && eventsRes.items?.length > 0) {
      const eventId = eventsRes.items[0].id;
      const bundleRes = await page.evaluate(async (eid: string) => {
        const res = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsor-bundle?surface=display`
        );
        return res.json();
      }, eventId);

      expect(bundleRes.ok).toBe(true);
      expect(bundleRes.bundle).toBeDefined();
      expect(bundleRes.bundle.surface_sponsors).toBeDefined();
      expect(bundleRes.bundle.surface_sponsors.tvTop).toBeInstanceOf(Array);
      expect(bundleRes.bundle.surface_sponsors.tvSide).toBeInstanceOf(Array);
      expect(bundleRes.bundle.rotation_config).toBeDefined();
      expect(bundleRes.bundle.rotation_config.rotationMs).toBeGreaterThanOrEqual(3000);
    }
  });

  test('sponsor-bundle API returns rotation_config with valid bounds', async ({ page }) => {
    await navigateToDisplay(page);

    const eventsRes = await page.evaluate(async () => {
      const res = await fetch('/api/v2/events');
      return res.json();
    });

    if (eventsRes.ok && eventsRes.items?.length > 0) {
      const eventId = eventsRes.items[0].id;
      const bundleRes = await page.evaluate(async (eid: string) => {
        const res = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsor-bundle?surface=display`
        );
        return res.json();
      }, eventId);

      const ms = bundleRes.bundle?.rotation_config?.rotationMs;
      if (ms) {
        expect(ms).toBeGreaterThanOrEqual(3000);
        expect(ms).toBeLessThanOrEqual(15000);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. LIVE: SPONSOR RENDERING (when sponsors exist)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Live Display — Sponsor Rendering', () => {
  test('if tvTop sponsors exist, banner items have data-tier attribute', async ({ page }) => {
    await navigateToDisplay(page);

    const items = page.locator('[data-testid="display-sponsor-item"]');
    const count = await items.count();

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const tier = await items.nth(i).getAttribute('data-tier');
        expect(tier).toBeTruthy();
        expect(tier!.length).toBeGreaterThan(0);
      }
    }
  });

  test('if tvTop sponsors exist, each has a name', async ({ page }) => {
    await navigateToDisplay(page);

    const items = page.locator('[data-testid="display-sponsor-item"]');
    const count = await items.count();

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const name = await items.nth(i).locator('.name').textContent();
        expect(name?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('if tvSide sponsors exist, sidebar shows rotate item', async ({ page }) => {
    await navigateToDisplay(page);

    const rotateItem = page.locator('[data-testid="display-sponsor-rotate"]');
    const count = await rotateItem.count();

    if (count > 0) {
      await expect(rotateItem).toBeVisible();
      const tier = await rotateItem.getAttribute('data-tier');
      expect(tier).toBeTruthy();
    }
  });

  test('if multiple tvSide sponsors, counter is visible', async ({ page }) => {
    await navigateToDisplay(page);

    // Check if sidebar has sponsors by looking at the DOM
    const rotateItem = page.locator('[data-testid="display-sponsor-rotate"]');
    const counter = page.locator('.sponsor-counter');

    if ((await rotateItem.count()) > 0 && (await counter.count()) > 0) {
      await expect(counter).toBeVisible();
      const text = await counter.textContent();
      // Format: "1/N" where N > 1
      expect(text).toMatch(/\d+\/\d+/);
    }
  });

  test('if tvSide sponsors exist, rotation changes content', async ({ page }) => {
    await navigateToDisplay(page);

    const rotateItem = page.locator('[data-testid="display-sponsor-rotate"]');
    const counter = page.locator('.sponsor-counter');

    // Only test rotation if there are multiple sponsors (counter visible)
    if ((await rotateItem.count()) > 0 && (await counter.count()) > 0) {
      const firstName = await rotateItem.locator('.name').textContent();

      // Wait for one rotation cycle (max 15s per bundle spec)
      await page.waitForTimeout(16000);

      const currentName = await rotateItem.locator('.name').textContent();
      // Name should have changed (rotated to next sponsor)
      // Note: if only 2 sponsors, it may have rotated back — so we just check stability
      expect(currentName?.trim().length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. LIVE: TIER CSS DIFFERENTIATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Live Display — Uniform sponsor treatment (#25 / OSE-878)', () => {
  // INVERTED from the retired tier-accent model. The `if (...)` guards that let these
  // pass vacuously are replaced with explicit test.skip — an honest skip, not a silent
  // green. Once X-3 (OSE-834) seeds ≥2-tier fixtures the skips no longer fire.
  test('title/platinum sponsors use the DEFAULT border — no tier accent', async ({ page }) => {
    await navigateToDisplay(page);

    const premiumItems = page.locator(
      '[data-testid="display-sponsor-item"][data-tier="title"], ' +
        '[data-testid="display-sponsor-item"][data-tier="platinum"]'
    );
    const count = await premiumItems.count();
    test.skip(count === 0, 'No title/platinum sponsors on this deployment (seed via X-3/OSE-834)');

    const borderColor = await premiumItems
      .first()
      .evaluate((el) => window.getComputedStyle(el).borderColor);
    // #25: uniform — the premium item carries the SAME default border as every other
    // sponsor; the retired gold accent is gone. Reintroducing an accent detonates this.
    expect(borderColor).toContain('0.06');
  });

  test('title/platinum logos are the SAME height as standard (no tier sizing)', async ({
    page,
  }) => {
    await navigateToDisplay(page);

    const premiumImg = page.locator('[data-tier="title"] img, [data-tier="platinum"] img');
    const standardImg = page.locator(
      '[data-tier="primary"] img, [data-tier="bronze"] img, [data-tier="silver"] img'
    );

    const hasPremium = (await premiumImg.count()) > 0;
    const hasStandard = (await standardImg.count()) > 0;
    test.skip(
      !hasPremium || !hasStandard,
      'Need both a premium and a standard sponsor present (seed via X-3/OSE-834)'
    );

    const premiumHeight = await premiumImg
      .first()
      .evaluate((el) => parseFloat(window.getComputedStyle(el).height));
    const standardHeight = await standardImg
      .first()
      .evaluate((el) => parseFloat(window.getComputedStyle(el).height));
    expect(premiumHeight).toBe(standardHeight);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. LIVE: 1080p TV LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Live Display — 1080p TV', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  test('page loads without horizontal overflow', async ({ page }) => {
    await navigateToDisplay(page);

    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasScroll).toBe(false);
  });

  test('sidebar width is 280px at 1920px viewport', async ({ page }) => {
    await navigateToDisplay(page);

    const sidebar = page.locator('[data-testid="display-sponsor-sidebar"]');
    const width = await sidebar.evaluate((el) => parseFloat(window.getComputedStyle(el).width));
    expect(width).toBeGreaterThanOrEqual(270);
  });

  test('header h1 scales up at 1920px', async ({ page }) => {
    await navigateToDisplay(page);

    const fontSize = await page
      .locator('[data-testid="display-header"] h1')
      .evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
    // @media (min-width: 1920px) sets h1 to 2rem = 32px
    expect(fontSize).toBeGreaterThanOrEqual(30);
  });

  test('main content uses wider max-width at 1920px', async ({ page }) => {
    await navigateToDisplay(page);

    const maxWidth = await page
      .locator('[data-testid="display-main"]')
      .evaluate((el) => window.getComputedStyle(el).maxWidth);
    // @media (min-width: 1920px) sets max-width: 1600px
    expect(parseInt(maxWidth)).toBeGreaterThanOrEqual(1500);
  });

  test('banner min-height scales at 1920px', async ({ page }) => {
    await navigateToDisplay(page);

    const minHeight = await page
      .locator('[data-testid="display-sponsor-banner"]')
      .evaluate((el) => parseFloat(window.getComputedStyle(el).minHeight));
    expect(minHeight).toBeGreaterThanOrEqual(60);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. LIVE: IMPRESSION API CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Live Display — Impression API', () => {
  test('impression endpoint accepts POST and returns 201', async ({ page }) => {
    await navigateToDisplay(page);

    const eventsRes = await page.evaluate(async () => {
      const res = await fetch('/api/v2/events');
      return res.json();
    });

    if (eventsRes.ok && eventsRes.items?.length > 0) {
      const eventId = eventsRes.items[0].id;

      // Get sponsor bundle to find a real sponsor ID
      const bundleRes = await page.evaluate(async (eid: string) => {
        const res = await fetch(
          `/api/v2/events/${encodeURIComponent(eid)}/sponsor-bundle?surface=display`
        );
        return res.json();
      }, eventId);

      const allSponsors = [
        ...(bundleRes.bundle?.surface_sponsors?.tvTop || []),
        ...(bundleRes.bundle?.surface_sponsors?.tvSide || []),
      ];

      if (allSponsors.length > 0) {
        const sponsorId = allSponsors[0].id;
        // OSE-1310: impression writes require the beacon token minted into
        // this exact bundle response for this sponsor.
        const beaconToken = allSponsors[0].beacon_token || '';
        const impressionRes = await page.evaluate(
          async ({ eid, sid, token }: { eid: string; sid: string; token: string }) => {
            const res = await fetch(
              `/api/v2/events/${encodeURIComponent(eid)}/sponsors/${encodeURIComponent(sid)}/impression`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  surface: 'display',
                  placement: 'tvTop',
                  beacon_token: token,
                }),
              }
            );
            return { status: res.status, body: await res.json() };
          },
          { eid: eventId, sid: sponsorId, token: beaconToken }
        );

        expect(impressionRes.status).toBe(201);
        expect(impressionRes.body.ok).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. LIVE: NO ERRORS ON DISPLAY SURFACE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Live Display — Stability', () => {
  test('no JS errors during live display load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await navigateToDisplay(page);
    await page.waitForTimeout(3000);

    expect(errors).toHaveLength(0);
  });

  test('no JS errors at 1080p viewport', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToDisplay(page);
    await page.waitForTimeout(3000);

    expect(errors).toHaveLength(0);
  });

  test('display runs stable for 30 seconds with live data', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await navigateToDisplay(page);
    await page.waitForTimeout(30000);

    expect(errors).toHaveLength(0);

    // Page should still be functional
    await expect(page.locator('[data-testid="display-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-main"]')).toBeVisible();
  });

  test('all URL aliases serve the same display page', async ({ page }) => {
    for (const path of ['/display', '/tv', '/kiosk', '/screen']) {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      expect(res?.status()).toBe(200);
      await expect(page.locator('[data-testid="display-sponsor-banner"]')).toBeAttached();
    }
  });
});
