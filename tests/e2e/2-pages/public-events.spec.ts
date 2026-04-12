/**
 * E2E Tests: Public Events Page — Deep Functional Coverage
 *
 * Tests /events served by the Cloudflare Worker.
 * This is the customer-facing event listing — must render flawlessly.
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (PUBLIC_HTML)
 *
 * Data-testids:
 *   public-header          — header with h1 "OurSharedEvents"
 *   public-main            — main content area
 *   public-events          — events container (loading → cards or empty)
 *   public-event-card      — individual event card (repeated per event)
 *   public-event-name      — h3 event name inside card
 *   public-event-meta      — p.meta with date + venue
 *   public-error           — error message on fetch failure
 *
 * Client-side: fetches GET /api/v2/events, renders cards or empty/error state.
 * Uses esc() helper for XSS protection on name, date, venue.
 */

import { test, expect, Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function navigateToPublic(page: Page) {
  await page.goto('/events', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

async function hasEventCards(page: Page): Promise<boolean> {
  const cards = page.locator('[data-testid="public-event-card"]');
  return (await cards.count()) > 0;
}

function mockEventsApi(page: Page, response: { status: number; body: unknown } | 'timeout') {
  return page.route('**/api/v2/events', (route) => {
    if (response === 'timeout') return route.abort('timedout');
    return route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
    });
  });
}

function sampleEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_pub_${Date.now()}`,
    title: 'Community BBQ',
    name: 'Community BBQ',
    slug: 'community-bbq',
    status: 'active',
    brand_id: 'root',
    startDateISO: '2026-07-04T17:00:00Z',
    venue: 'Evergreen Park',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PAGE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Structure', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPublic(page);
  });

  test('returns HTTP 200', async ({ page }) => {
    const res = await page.goto('/events');
    expect(res?.status()).toBe(200);
  });

  test('Content-Type is text/html', async ({ page }) => {
    const res = await page.goto('/events');
    expect(res?.headers()['content-type']).toContain('text/html');
  });

  test('has correct <title>', async ({ page }) => {
    expect(await page.title()).toContain('OurSharedEvents');
  });

  test('has lang="en" on <html>', async ({ page }) => {
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
  });

  test('header is visible with h1', async ({ page }) => {
    const header = page.locator('[data-testid="public-header"]');
    await expect(header).toBeVisible();
    await expect(header.locator('h1')).toContainText('OurSharedEvents');
  });

  test('main content area is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="public-main"]')).toBeVisible();
  });

  test('h2 "Upcoming Events" is visible', async ({ page }) => {
    const h2 = page.locator('[data-testid="public-main"] h2');
    await expect(h2).toBeVisible();
    await expect(h2).toContainText('Upcoming Events');
  });

  test('events container is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="public-events"]')).toBeVisible();
  });

  test('heading hierarchy: h1 → h2 (no skip)', async ({ page }) => {
    const h1 = page.locator('h1');
    const h2 = page.locator('h2');
    expect(await h1.count()).toBeGreaterThanOrEqual(1);
    expect(await h2.count()).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EVENT CARDS — WITH DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Event Cards (Data Present)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPublic(page);
    test.skip(!(await hasEventCards(page)), 'No events on staging');
  });

  test('at least one event card is rendered', async ({ page }) => {
    const cards = page.locator('[data-testid="public-event-card"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('each card has an event name (h3)', async ({ page }) => {
    const names = page.locator('[data-testid="public-event-name"]');
    const count = await names.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      const text = await names.nth(i).textContent();
      expect(text?.trim().length, `Card ${i} name is empty`).toBeGreaterThan(0);
    }
  });

  test('each card has a meta line', async ({ page }) => {
    const metas = page.locator('[data-testid="public-event-meta"]');
    expect(await metas.count()).toBeGreaterThanOrEqual(1);
  });

  test('event cards have left border accent', async ({ page }) => {
    const card = page.locator('[data-testid="public-event-card"]').first();
    const borderLeft = await card.evaluate((el) => window.getComputedStyle(el).borderLeftWidth);
    expect(parseInt(borderLeft)).toBeGreaterThanOrEqual(2);
  });

  test('event cards are inside the events container', async ({ page }) => {
    const container = page.locator('[data-testid="public-events"]');
    const cards = container.locator('[data-testid="public-event-card"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('no error message when events load successfully', async ({ page }) => {
    const error = page.locator('[data-testid="public-error"]');
    expect(await error.count()).toBe(0);
  });

  test('no "Loading" text visible after load', async ({ page }) => {
    const container = page.locator('[data-testid="public-events"]');
    const text = await container.textContent();
    expect(text).not.toContain('Loading events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Empty State', () => {
  test('shows "No events scheduled" when API returns empty items', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await navigateToPublic(page);

    const container = page.locator('[data-testid="public-events"]');
    await expect(container).toContainText('No events scheduled');
  });

  test('no event cards rendered when empty', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await navigateToPublic(page);

    const cards = page.locator('[data-testid="public-event-card"]');
    expect(await cards.count()).toBe(0);
  });

  test('shows empty state when ok:false', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: { ok: false, error: 'DB error' } });
    await navigateToPublic(page);

    const container = page.locator('[data-testid="public-events"]');
    await expect(container).toContainText('No events scheduled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ERROR STATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Error State', () => {
  test('shows error message on API 500', async ({ page }) => {
    await mockEventsApi(page, { status: 500, body: 'Server Error' });
    await navigateToPublic(page);

    const error = page.locator('[data-testid="public-error"]');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Could not load events');
  });

  test('error has .error CSS class', async ({ page }) => {
    await mockEventsApi(page, { status: 500, body: 'fail' });
    await navigateToPublic(page);

    await expect(page.locator('[data-testid="public-events"] .error')).toBeVisible();
  });

  test('shows error on network timeout', async ({ page }) => {
    await mockEventsApi(page, 'timeout');
    await navigateToPublic(page);

    await expect(page.locator('[data-testid="public-error"]')).toBeVisible();
  });

  test('shows error on malformed JSON', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: 'not json' });
    await navigateToPublic(page);

    await expect(page.locator('[data-testid="public-error"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. MOCK DATA RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Mock Data Rendering', () => {
  test('renders correct number of cards for mocked events', async ({ page }) => {
    const events = [sampleEvent(), sampleEvent({ name: 'Second Event', id: 'evt_2' })];
    await mockEventsApi(page, { status: 200, body: { ok: true, status: 200, items: events } });
    await navigateToPublic(page);

    const cards = page.locator('[data-testid="public-event-card"]');
    expect(await cards.count()).toBe(2);
  });

  test('renders event name in h3', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [sampleEvent({ name: 'Test BBQ 2026' })] },
    });
    await navigateToPublic(page);

    const name = page.locator('[data-testid="public-event-name"]').first();
    await expect(name).toContainText('Test BBQ 2026');
  });

  test('renders date in meta when startDateISO provided', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [sampleEvent({ startDateISO: '2026-07-04T17:00:00Z' })],
      },
    });
    await navigateToPublic(page);

    const meta = page.locator('[data-testid="public-event-meta"]').first();
    const text = await meta.textContent();
    // Should contain formatted date (e.g. "Saturday, July 4, 2026")
    expect(text).toContain('July');
    expect(text).toContain('2026');
  });

  test('renders venue in meta when provided', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [sampleEvent({ venue: 'Evergreen Park Pavilion' })] },
    });
    await navigateToPublic(page);

    const meta = page.locator('[data-testid="public-event-meta"]').first();
    await expect(meta).toContainText('Evergreen Park Pavilion');
  });

  test('no date in meta when startDateISO is null', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [sampleEvent({ startDateISO: null })] },
    });
    await navigateToPublic(page);

    const meta = page.locator('[data-testid="public-event-meta"]').first();
    const text = await meta.textContent();
    expect(text).not.toContain('2026');
  });

  test('no venue separator when venue is null', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [sampleEvent({ venue: null })] },
    });
    await navigateToPublic(page);

    const meta = page.locator('[data-testid="public-event-meta"]').first();
    const html = await meta.innerHTML();
    expect(html).not.toContain('&middot;');
  });

  test('shows "Untitled Event" when name is missing', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [sampleEvent({ name: undefined, title: undefined })] },
    });
    await navigateToPublic(page);

    const name = page.locator('[data-testid="public-event-name"]').first();
    await expect(name).toContainText('Untitled Event');
  });

  test('renders 10 event cards without overflow', async ({ page }) => {
    const events = Array.from({ length: 10 }, (_, i) =>
      sampleEvent({ name: `Event ${i + 1}`, id: `evt_${i}` })
    );
    await mockEventsApi(page, { status: 200, body: { ok: true, status: 200, items: events } });
    await navigateToPublic(page);

    expect(await page.locator('[data-testid="public-event-card"]').count()).toBe(10);

    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasScroll).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. XSS RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — XSS Resilience', () => {
  test('script tag in event name is HTML-escaped', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [sampleEvent({ name: '<script>alert(1)</script>XSS' })],
      },
    });
    await navigateToPublic(page);

    const nameHtml = await page.locator('[data-testid="public-event-name"]').first().innerHTML();
    expect(nameHtml).not.toContain('<script>');
    expect(nameHtml).toContain('&lt;script&gt;');
  });

  test('img onerror in venue is HTML-escaped', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [sampleEvent({ venue: '<img src=x onerror=alert(1)>' })],
      },
    });
    await navigateToPublic(page);

    const metaHtml = await page.locator('[data-testid="public-event-meta"]').first().innerHTML();
    expect(metaHtml).not.toContain('<img src=x');
  });

  test('no JS errors with XSS payloads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [
          sampleEvent({
            name: '"><script>alert(1)</script>',
            venue: "'; DROP TABLE events;--",
          }),
        ],
      },
    });
    await navigateToPublic(page);
    expect(errors).toHaveLength(0);
  });

  test('emoji in event name renders correctly', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [sampleEvent({ name: '🎉 Block Party 🌭' })] },
    });
    await navigateToPublic(page);

    const name = await page.locator('[data-testid="public-event-name"]').first().textContent();
    expect(name).toContain('🎉');
    expect(name).toContain('🌭');
  });

  test('CJK characters render correctly', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [sampleEvent({ name: 'コミュニティBBQ', venue: '東京都' })],
      },
    });
    await navigateToPublic(page);

    await expect(page.locator('[data-testid="public-event-name"]').first()).toContainText(
      'コミュニティBBQ'
    );
    await expect(page.locator('[data-testid="public-event-meta"]').first()).toContainText('東京都');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. URL ALIASES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — URL Aliases', () => {
  const ALIASES = ['/events', '/public', '/schedule', '/calendar', '/agenda', '/lineup'];

  for (const path of ALIASES) {
    test(`${path} returns 200 with HTML`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      expect(res?.status()).toBe(200);
      expect(res?.headers()['content-type']).toContain('text/html');
    });
  }

  for (const path of ALIASES) {
    test(`${path} renders the events container`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle', timeout: 20_000 });
      await expect(page.locator('[data-testid="public-events"]')).toBeVisible();
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Security Headers', () => {
  test('has CSP with nonce', async ({ page }) => {
    const res = await page.goto('/events');
    const csp = res?.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain('nonce-');
  });

  test('has X-Content-Type-Options: nosniff', async ({ page }) => {
    const res = await page.goto('/events');
    expect(res?.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('has HSTS', async ({ page }) => {
    const res = await page.goto('/events');
    expect(res?.headers()['strict-transport-security']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. NO GAS MARKERS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — No GAS HTML Leak', () => {
  test('no GAS markers in page source', async ({ page }) => {
    await navigateToPublic(page);
    const content = await page.content();
    expect(content).not.toContain('userCodeAppPanel');
    expect(content).not.toContain('Google Apps Script');
    expect(content).not.toContain('script.google.com');
    expect(content).not.toContain('macros/s/');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. RESPONSE TIME
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Response Time', () => {
  test('page loads within 15 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/events', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    expect(Date.now() - start).toBeLessThan(15_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. CONSOLE ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — No Console Errors', () => {
  test('no JS errors during normal page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await navigateToPublic(page);
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});
