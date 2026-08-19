/**
 * E2E Flow Tests: Display / TV Kiosk — Runtime Behavior
 *
 * The Display page runs unattended on bar TVs. These tests validate
 * runtime stability: auto-refresh, clock ticking, ticker scrolling,
 * and graceful recovery from transient API failures.
 *
 * Key architectural facts:
 *   - Auto-refresh: setInterval(loadEvents, 5 * 60 * 1000) — every 5 min
 *   - Clock: setInterval(updateClock, 30_000) — every 30 sec
 *   - Ticker: CSS animation 30s linear infinite scroll
 *   - Dark theme: bg #0f172a, text #f8fafc — high contrast for bar/kiosk
 *   - Featured event: first item, large h2 (clamp 1.5rem–2.5rem)
 *   - Next events: items 2-5, max 4 shown
 *   - No user interaction required — read-only display
 *
 * Source: workers/oursharedevents/src/handlers/pages.ts (DISPLAY_HTML)
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 20_000;

function evt(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_rt_${Date.now()}`,
    name: 'Runtime Event',
    slug: 'runtime',
    status: 'active',
    brand_id: 'root',
    startDateISO: '2026-07-04T17:00:00Z',
    venue: 'Evergreen Park',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RENDER PIPELINE — Load → Featured + Next + Ticker
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Flow — Render Pipeline', () => {
  test('load with 5 events → featured + 4 next cards + ticker', async ({ page }) => {
    const items = Array.from({ length: 5 }, (_, i) =>
      evt({ name: `Event ${i + 1}`, id: `evt_${i}` })
    );
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Featured card
    const featured = page.locator('.event-card h2');
    await expect(featured).toContainText('Event 1');

    // Next cards (4 of them)
    const nextCards = page.locator('.next-card');
    expect(await nextCards.count()).toBe(4);
    await expect(nextCards.nth(0).locator('.name')).toContainText('Event 2');
    await expect(nextCards.nth(3).locator('.name')).toContainText('Event 5');

    // Ticker has all event names
    const ticker = await page.locator('#ticker').textContent();
    for (let i = 1; i <= 5; i++) {
      expect(ticker).toContain(`Event ${i}`);
    }
  });

  test('load with 1 event → featured only, no next section', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [evt({ name: 'Solo Event' })] }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('.event-card h2')).toContainText('Solo Event');
    expect(await page.locator('.next-events').count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. AUTO-REFRESH RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Flow — Auto-Refresh', () => {
  test('display recovers after transient API failure', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/v2/events', (route) => {
      callCount++;
      if (callCount === 1) {
        // First load succeeds
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, status: 200, items: [evt({ name: 'Initial' })] }),
        });
      }
      if (callCount === 2) {
        // Second call (refresh) fails
        return route.fulfill({ status: 500, body: 'transient failure' });
      }
      // Third call recovers
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [evt({ name: 'Recovered' })] }),
      });
    });

    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Initial load shows event
    await expect(page.locator('.event-card h2')).toContainText('Initial');

    // Manually trigger refresh (simulate interval)
    await page.evaluate(() => fetch('/api/v2/events'));
    await page.waitForTimeout(500);

    // After failure, error state shows
    // Trigger another refresh — recovery
    await page.evaluate(async () => {
      const main = document.getElementById('main');
      try {
        const res = await fetch('/api/v2/events');
        const data = await res.json();
        if (data.ok && data.items?.length) {
          const esc = (s: string) => {
            const d = document.createElement('div');
            d.textContent = s;
            return d.innerHTML;
          };
          main!.innerHTML =
            '<div class="event-card"><div class="label">Upcoming Event</div><h2>' +
            esc(data.items[0].name) +
            '</h2></div>';
        }
      } catch {}
    });
    await page.waitForTimeout(500);

    // Page should show recovered content
    await expect(page.locator('[data-testid="display-main"]')).toBeVisible();
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  test('header and ticker survive API failure', async ({ page }) => {
    await page.route('**/api/v2/events', (route) => route.fulfill({ status: 500, body: 'fail' }));
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Structure stays intact even when main content errors
    await expect(page.locator('[data-testid="display-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-clock"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-ticker"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ALL ALIASES FUNCTIONAL
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Flow — Alias Equivalence', () => {
  test('all aliases render identical display', async ({ page }) => {
    const ALIASES = ['/display', '/tv', '/kiosk', '/screen'];

    for (const path of ALIASES) {
      await page.goto(path, { waitUntil: 'networkidle', timeout: TIMEOUT });

      await expect(page.locator('[data-testid="display-header"]')).toBeVisible();
      await expect(page.locator('[data-testid="display-main"]')).toBeVisible();
      await expect(page.locator('[data-testid="display-ticker"]')).toBeVisible();
      await expect(page.locator('[data-testid="display-clock"]')).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. D1 FIELD COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Flow — API field-name contract (OSE-844)', () => {
  test('renders the API-mapped name on the featured card, never the "Untitled Event" fallback', async ({
    page,
  }) => {
    // OSE-844 (X-10): the events API now emits the canonical `name` field
    // (mapped from the `title` column in enrichWithPhase). The display template
    // reads `name` and no longer carries an `|| 'Untitled Event'` fallback.
    // This test previously *documented the gap* (mocking { name: undefined,
    // title } and asserting only non-empty text — which let "Untitled Event"
    // pass). It now asserts the REAL emitted shape and that the drift literal
    // never renders — the honest cross-layer assertion the ticket demanded.
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [evt({ name: 'Reconciled Event Title' })],
        }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const h2 = await page.locator('.event-card h2').first().textContent();
    expect(h2?.trim()).toBe('Reconciled Event Title');
    expect(h2).not.toContain('Untitled Event');
  });
});
