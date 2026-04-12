/**
 * E2E Flow Tests: Public Events — Data Rendering Journey
 *
 * Multi-step flows validating the complete render pipeline:
 *   1. Page loads → loading state → API fetch → cards render
 *   2. Cards display correct content from API response
 *   3. Multiple events render in correct order
 *   4. All URL aliases produce identical functional output
 *   5. Page works across viewport sizes (desktop + mobile)
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (PUBLIC_HTML)
 */

import { test, expect } from '@playwright/test';

function sampleEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${Date.now()}`,
    name: 'Flow Event',
    slug: 'flow-event',
    status: 'active',
    brand_id: 'root',
    startDateISO: '2026-08-15T18:00:00Z',
    venue: 'Beverly Arts Center',
    ...overrides,
  };
}

test.describe('Public Events Flow — Render Pipeline', () => {
  test('loading → fetch → cards appear', async ({ page }) => {
    // Navigate without waiting for networkidle so we can catch loading state
    const events = [
      sampleEvent({ name: 'First Event', id: 'evt_1' }),
      sampleEvent({ name: 'Second Event', id: 'evt_2' }),
    ];

    await page.route('**/api/v2/events', async (route) => {
      // Small delay to let loading state render
      await new Promise((r) => setTimeout(r, 200));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: events }),
      });
    });

    await page.goto('/events', { waitUntil: 'domcontentloaded', timeout: 20_000 });

    // Wait for cards to render
    await page.waitForSelector('[data-testid="public-event-card"]', { timeout: 10_000 });

    // Cards rendered
    const cards = page.locator('[data-testid="public-event-card"]');
    expect(await cards.count()).toBe(2);

    // No loading text visible
    const container = page.locator('[data-testid="public-events"]');
    expect(await container.textContent()).not.toContain('Loading');
  });

  test('cards display in API response order', async ({ page }) => {
    const events = [
      sampleEvent({ name: 'Alpha Event', id: 'evt_a' }),
      sampleEvent({ name: 'Beta Event', id: 'evt_b' }),
      sampleEvent({ name: 'Gamma Event', id: 'evt_c' }),
    ];

    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: events }),
      })
    );
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });

    const names = page.locator('[data-testid="public-event-name"]');
    expect(await names.nth(0).textContent()).toContain('Alpha');
    expect(await names.nth(1).textContent()).toContain('Beta');
    expect(await names.nth(2).textContent()).toContain('Gamma');
  });

  test('date + venue render correctly in meta', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [
            sampleEvent({
              name: 'Summer Fest',
              startDateISO: '2026-07-04T17:00:00Z',
              venue: 'Washington Park',
            }),
          ],
        }),
      })
    );
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });

    const meta = page.locator('[data-testid="public-event-meta"]').first();
    const text = await meta.textContent();
    expect(text).toContain('July');
    expect(text).toContain('Washington Park');
  });

  test('event with only name (no date, no venue) still renders card', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [sampleEvent({ name: 'Name Only', startDateISO: null, venue: null })],
        }),
      })
    );
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="public-event-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="public-event-name"]')).toContainText('Name Only');
  });
});

test.describe('Public Events Flow — Alias Equivalence', () => {
  const ALIASES = ['/events', '/public', '/schedule', '/calendar', '/agenda', '/lineup'];

  test('all aliases render identical structure', async ({ page }) => {
    for (const path of ALIASES) {
      await page.goto(path, { waitUntil: 'networkidle', timeout: 20_000 });

      // Same structural elements
      await expect(page.locator('[data-testid="public-header"]')).toBeVisible();
      await expect(page.locator('[data-testid="public-main"]')).toBeVisible();
      await expect(page.locator('[data-testid="public-events"]')).toBeVisible();

      // Same h1
      await expect(page.locator('h1')).toContainText('OurSharedEvents');

      // Same h2
      await expect(page.locator('h2')).toContainText('Upcoming Events');
    }
  });
});

test.describe('Public Events Flow — Responsive', () => {
  test('no horizontal overflow on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [
            sampleEvent({ name: 'Mobile Event One' }),
            sampleEvent({ name: 'Mobile Event Two', id: 'evt_m2' }),
          ],
        }),
      })
    );
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });

    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasScroll).toBe(false);
  });

  test('cards are readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [sampleEvent({ name: 'Mobile Card Test' })],
        }),
      })
    );
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });

    const card = page.locator('[data-testid="public-event-card"]').first();
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    // Card should fit within mobile viewport width
    expect(box!.width).toBeLessThanOrEqual(375);
    expect(box!.width).toBeGreaterThanOrEqual(200); // not too tiny
  });
});
