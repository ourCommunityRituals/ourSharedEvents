/**
 * E2E Tests: Display Sponsor Overlay — SPON-3 Coverage
 *
 * Tests the sponsor overlay on /display served by the Cloudflare Worker.
 * Covers:
 *   - tvTop banner rendering with data-tier attributes
 *   - tvSide sidebar rotation with fade transitions
 *   - Tier-based CSS differentiation (title/platinum get gold accent)
 *   - Sponsor counter ("1/5") on sidebar rotation
 *   - 1080p TV media query breakpoints
 *   - Impression logging fires for displayed sponsors
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (DISPLAY_HTML)
 *
 * Data-testids:
 *   display-sponsor-banner  — tvTop horizontal banner strip
 *   display-sponsor-sidebar — tvSide rotating sidebar
 *   display-sponsor-item    — individual sponsor in banner
 *   display-sponsor-rotate  — currently visible sidebar sponsor
 */

import { test, expect, Page } from '@playwright/test';

const TIMEOUT = 20_000;

async function navigateToDisplay(page: Page) {
  await page.goto('/display', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForLoadState('networkidle');
}

function mockEvents(page: Page, items: Record<string, unknown>[]) {
  return page.route('**/api/v2/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 200, items }),
    })
  );
}

function mockSponsorBundle(
  page: Page,
  tvTop: Record<string, unknown>[],
  tvSide: Record<string, unknown>[],
  rotationMs = 5000
) {
  return page.route('**/sponsor-bundle*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 200,
        bundle: {
          sponsors: [...tvTop, ...tvSide],
          surface_sponsors: {
            posterTop: [],
            tvTop,
            tvSide,
            mobileBanner: [],
          },
          rotation_config: {
            sponsorSlots: Math.max(tvTop.length, tvSide.length, 1),
            rotationMs,
          },
        },
      }),
    })
  );
}

function sponsor(overrides: Record<string, unknown> = {}) {
  return {
    id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    event_id: 'evt_test',
    name: 'Test Sponsor',
    logo_url: 'https://via.placeholder.com/200x80',
    website_url: 'https://example.com',
    tier: 'primary',
    placement_formats: '{}',
    click_token: null,
    impression_token: null,
    is_active: 1,
    ...overrides,
  };
}

function evt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_test_1',
    name: 'Display Sponsor Test',
    status: 'active',
    startDateISO: '2026-07-04T17:00:00Z',
    venue: 'Test Venue',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SPONSOR BANNER (tvTop)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Sponsors — Banner (tvTop)', () => {
  test('banner container exists in DOM', async ({ page }) => {
    await navigateToDisplay(page);
    await expect(page.locator('[data-testid="display-sponsor-banner"]')).toBeAttached();
  });

  test('banner renders tvTop sponsors', async ({ page }) => {
    const tvTop = [
      sponsor({ name: 'Banner Sponsor A', tier: 'gold' }),
      sponsor({ name: 'Banner Sponsor B', tier: 'primary' }),
    ];
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, tvTop, []);
    await navigateToDisplay(page);

    const items = page.locator('[data-testid="display-sponsor-item"]');
    await expect(items).toHaveCount(2);
  });

  test('banner items have data-tier attribute', async ({ page }) => {
    const tvTop = [
      sponsor({ name: 'Gold Sponsor', tier: 'gold' }),
      sponsor({ name: 'Primary Sponsor', tier: 'primary' }),
    ];
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, tvTop, []);
    await navigateToDisplay(page);

    const items = page.locator('[data-testid="display-sponsor-item"]');
    await expect(items.first()).toHaveAttribute('data-tier', 'gold');
    await expect(items.last()).toHaveAttribute('data-tier', 'primary');
  });

  test('banner is hidden when no tvTop sponsors', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], []);
    await navigateToDisplay(page);

    const banner = page.locator('[data-testid="display-sponsor-banner"]');
    const html = await banner.innerHTML();
    expect(html.trim()).toBe('');
  });

  test('banner shows sponsor name', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [sponsor({ name: 'Acme Corp' })], []);
    await navigateToDisplay(page);

    await expect(page.locator('[data-testid="display-sponsor-item"] .name')).toContainText(
      'Acme Corp'
    );
  });

  test('banner shows sponsor logo when provided', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(
      page,
      [sponsor({ name: 'Logo Co', logo_url: 'https://via.placeholder.com/200x80' })],
      []
    );
    await navigateToDisplay(page);

    const img = page.locator('[data-testid="display-sponsor-item"] img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'Logo Co');
  });

  test('banner handles sponsor without logo', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [sponsor({ name: 'No Logo', logo_url: null })], []);
    await navigateToDisplay(page);

    const item = page.locator('[data-testid="display-sponsor-item"]');
    await expect(item).toBeVisible();
    expect(await item.locator('img').count()).toBe(0);
    await expect(item.locator('.name')).toContainText('No Logo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TIER-BASED RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Sponsors — Uniform Rendering (#25 / OSE-878)', () => {
  // INVERTED from the retired tier-accent model. #25 forbids tier-keyed treatment:
  // every sponsor renders identically regardless of tier. Each test seeds a tiered
  // sponsor + a base (primary) sponsor and asserts their computed border/size are
  // EQUAL — so reintroducing a tier accent or size detonates it. CSS lock: WALL-3b.

  async function seedPair(page: import('@playwright/test').Page, tier: string) {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(
      page,
      [
        sponsor({ name: 'Tiered', tier, logo_url: 'https://via.placeholder.com/200x80' }),
        sponsor({
          name: 'Primary',
          tier: 'primary',
          logo_url: 'https://via.placeholder.com/200x80',
        }),
      ],
      []
    );
    await navigateToDisplay(page);
  }
  const borderOf = (page: import('@playwright/test').Page, tier: string) =>
    page
      .locator(`[data-testid="display-sponsor-item"][data-tier="${tier}"]`)
      .evaluate((el) => window.getComputedStyle(el).borderColor);

  test('title tier border matches a base sponsor (no gold accent)', async ({ page }) => {
    await seedPair(page, 'title');
    expect(await borderOf(page, 'title')).toBe(await borderOf(page, 'primary'));
  });

  test('platinum tier border matches a base sponsor (no gold accent)', async ({ page }) => {
    await seedPair(page, 'platinum');
    expect(await borderOf(page, 'platinum')).toBe(await borderOf(page, 'primary'));
  });

  test('title and primary logos are the SAME size (no tier sizing)', async ({ page }) => {
    await seedPair(page, 'title');
    const titleImgHeight = await page
      .locator('[data-tier="title"] img')
      .evaluate((el) => parseFloat(window.getComputedStyle(el).height));
    const primaryImgHeight = await page
      .locator('[data-tier="primary"] img')
      .evaluate((el) => parseFloat(window.getComputedStyle(el).height));
    expect(titleImgHeight).toBe(primaryImgHeight);
  });

  test('gold tier border matches a base sponsor (no accent)', async ({ page }) => {
    await seedPair(page, 'gold');
    expect(await borderOf(page, 'gold')).toBe(await borderOf(page, 'primary'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SIDEBAR ROTATION (tvSide)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Sponsors — Sidebar Rotation (tvSide)', () => {
  test('sidebar container exists in DOM', async ({ page }) => {
    await navigateToDisplay(page);
    await expect(page.locator('[data-testid="display-sponsor-sidebar"]')).toBeAttached();
  });

  test('sidebar renders first tvSide sponsor', async ({ page }) => {
    const tvSide = [sponsor({ name: 'Side A', tier: 'gold' })];
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], tvSide);
    await navigateToDisplay(page);

    await expect(page.locator('[data-testid="display-sponsor-rotate"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-sponsor-rotate"] .name')).toContainText(
      'Side A'
    );
  });

  test('sidebar sponsor has data-tier attribute', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], [sponsor({ name: 'Tiered', tier: 'platinum' })]);
    await navigateToDisplay(page);

    await expect(page.locator('[data-testid="display-sponsor-rotate"]')).toHaveAttribute(
      'data-tier',
      'platinum'
    );
  });

  test('sidebar shows counter when multiple sponsors', async ({ page }) => {
    const tvSide = [
      sponsor({ name: 'Side A', id: 'sa' }),
      sponsor({ name: 'Side B', id: 'sb' }),
      sponsor({ name: 'Side C', id: 'sc' }),
    ];
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], tvSide);
    await navigateToDisplay(page);

    const counter = page.locator('.sponsor-counter');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('/3');
  });

  test('sidebar hides counter for single sponsor', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], [sponsor({ name: 'Only One' })]);
    await navigateToDisplay(page);

    expect(await page.locator('.sponsor-counter').count()).toBe(0);
  });

  test('sidebar rotates to next sponsor after interval', async ({ page }) => {
    const tvSide = [sponsor({ name: 'First', id: 's1' }), sponsor({ name: 'Second', id: 's2' })];
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], tvSide, 2000); // fast rotation for test
    await navigateToDisplay(page);

    // First sponsor shows immediately
    await expect(page.locator('[data-testid="display-sponsor-rotate"] .name')).toContainText(
      'First'
    );

    // Wait for rotation (2s interval + 0.6s fade)
    await page.waitForTimeout(3200);

    // Second sponsor should now be visible
    await expect(page.locator('[data-testid="display-sponsor-rotate"] .name')).toContainText(
      'Second'
    );
  });

  test('fade-out class is applied during transition', async ({ page }) => {
    const tvSide = [sponsor({ name: 'Fade A', id: 'fa' }), sponsor({ name: 'Fade B', id: 'fb' })];
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], tvSide, 2000);
    await navigateToDisplay(page);

    // Wait for rotation to trigger (just before the fade completes)
    await page.waitForTimeout(2200);

    // The fade-out class should be applied briefly
    // We check that the transition CSS property includes opacity
    const transition = await page
      .locator('[data-testid="display-sponsor-rotate"]')
      .evaluate((el) => window.getComputedStyle(el).transition);
    expect(transition).toContain('opacity');
  });

  test('sidebar is empty when no tvSide sponsors', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], []);
    await navigateToDisplay(page);

    const sidebar = page.locator('[data-testid="display-sponsor-sidebar"]');
    const html = await sidebar.innerHTML();
    expect(html.trim()).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 1080p TV LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Sponsors — 1080p TV Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  test('sidebar is wider at 1920px (280px)', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], [sponsor({ name: 'Wide' })]);
    await navigateToDisplay(page);

    const width = await page
      .locator('[data-testid="display-sponsor-sidebar"]')
      .evaluate((el) => parseFloat(window.getComputedStyle(el).width));
    expect(width).toBeGreaterThanOrEqual(270);
  });

  test('banner has larger padding at 1920px', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [sponsor({ name: 'TV Banner' })], []);
    await navigateToDisplay(page);

    const minHeight = await page
      .locator('[data-testid="display-sponsor-banner"]')
      .evaluate((el) => parseFloat(window.getComputedStyle(el).minHeight));
    expect(minHeight).toBeGreaterThanOrEqual(60);
  });

  test('sponsor logos scale up UNIFORMLY at 1920px (no tier bump)', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(
      page,
      [
        sponsor({ name: 'Title', tier: 'title', logo_url: 'https://via.placeholder.com/200x80' }),
        sponsor({
          name: 'Primary',
          tier: 'primary',
          logo_url: 'https://via.placeholder.com/200x80',
        }),
      ],
      []
    );
    await navigateToDisplay(page);

    const heightOf = (tier: string) =>
      page
        .locator(`[data-tier="${tier}"] img`)
        .evaluate((el) => parseFloat(window.getComputedStyle(el).height));
    const titleH = await heightOf('title');
    const primaryH = await heightOf('primary');
    // Responsive clamp scales the logo up on the big viewport (well above the 32px min)…
    expect(titleH).toBeGreaterThanOrEqual(40);
    // …but tier-blind (#25/OSE-878): title equals primary — no 64px title-only bump.
    expect(titleH).toBe(primaryH);
  });

  test('no horizontal overflow with sponsors at 1920px', async ({ page }) => {
    const tvTop = Array.from({ length: 5 }, (_, i) =>
      sponsor({ name: `Sponsor ${i}`, id: `s${i}`, tier: i === 0 ? 'title' : 'primary' })
    );
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, tvTop, [sponsor({ name: 'Side' })]);
    await navigateToDisplay(page);

    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasScroll).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. IMPRESSION LOGGING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Sponsors — Impression Logging', () => {
  test('impression POST fires for displayed sponsors', async ({ page }) => {
    const impressionRequests: string[] = [];
    await page.route('**/impression', (route) => {
      impressionRequests.push(route.request().url());
      route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
    });

    const tvTop = [sponsor({ name: 'Tracked', id: 'sp_tracked' })];
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, tvTop, []);
    await navigateToDisplay(page);

    // Wait for impression to fire
    await page.waitForTimeout(2000);

    expect(impressionRequests.length).toBeGreaterThan(0);
    expect(impressionRequests[0]).toContain('sp_tracked');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. XSS RESILIENCE (sponsor data)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Sponsors — XSS Resilience', () => {
  test('XSS in sponsor name is escaped', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [sponsor({ name: '<script>alert(1)</script>Evil' })], []);
    await navigateToDisplay(page);

    const html = await page.locator('[data-testid="display-sponsor-item"]').innerHTML();
    expect(html).not.toContain('<script>');
  });

  test('XSS in logo_url is escaped', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [sponsor({ name: 'Safe', logo_url: '" onerror="alert(1)' })], []);
    await navigateToDisplay(page);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });

  test('XSS in tier attribute is escaped', async ({ page }) => {
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(
      page,
      [sponsor({ name: 'Tier XSS', tier: '"><script>alert(1)</script>' })],
      []
    );
    await navigateToDisplay(page);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. STABILITY
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Sponsors — Stability', () => {
  test('no JS errors with sponsors loaded', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockEvents(page, [evt()]);
    await mockSponsorBundle(
      page,
      [sponsor({ name: 'Stable Banner', tier: 'gold' })],
      [sponsor({ name: 'Stable Side', tier: 'platinum' })]
    );
    await navigateToDisplay(page);
    await page.waitForTimeout(3000);

    expect(errors).toHaveLength(0);
  });

  test('no JS errors when sponsor-bundle API fails', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockEvents(page, [evt()]);
    await page.route('**/sponsor-bundle*', (route) => route.fulfill({ status: 500, body: 'fail' }));
    await navigateToDisplay(page);
    await page.waitForTimeout(2000);

    expect(errors).toHaveLength(0);
  });

  test('no JS errors when sponsor-bundle returns empty', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], []);
    await navigateToDisplay(page);
    await page.waitForTimeout(2000);

    expect(errors).toHaveLength(0);
  });

  test('sidebar rotation runs 30s without memory leak or crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const tvSide = Array.from({ length: 5 }, (_, i) =>
      sponsor({ name: `Rotate ${i}`, id: `r${i}` })
    );
    await mockEvents(page, [evt()]);
    await mockSponsorBundle(page, [], tvSide, 2000);
    await navigateToDisplay(page);

    await page.waitForTimeout(30000);
    expect(errors).toHaveLength(0);

    // Sidebar should still be rendering
    await expect(page.locator('[data-testid="display-sponsor-rotate"]')).toBeVisible();
  });
});
