/**
 * E2E Tests: Poster Page — LAYOUT / STRUCTURE (data-less)
 *
 * Tests /poster served by the Cloudflare Worker. This file holds ONLY the specs
 * that need no seeded data — structure, empty-state, error-state, URL aliases,
 * security headers, XSS resilience (mocked), response time. It runs in the
 * COMPONENT tier (playwright.component.config.ts, local worker, every PR).
 *
 * The DATA-dependent specs (event picker with data, poster content with data,
 * print layout) moved to poster-print.data.spec.ts (OSE-1228): they assert
 * specific seeded rows and can only run honestly where real data exists (the
 * staging E2E tier, testMatch **\/*.spec.ts). Keeping them here made the
 * component tier skip 22/57 vacuously against an empty/erroring local D1 — a
 * false green. Empty-State lives here on purpose: it is only meaningful with NO
 * data, which is exactly the component tier's local (unseeded) worker.
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (POSTER_HTML)
 *
 * Data-testids: poster-header, poster-print, poster-container,
 *   poster-event-select, poster-event-picker, poster-area
 */

import { test, expect } from '@playwright/test';
import { navigateToPoster, hasEvents } from './poster-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PAGE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Structure', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
  });

  test('returns HTTP 200', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.status()).toBe(200);
  });

  test('Content-Type is text/html', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.headers()['content-type']).toContain('text/html');
  });

  test('has correct <title>', async ({ page }) => {
    const title = await page.title();
    expect(title).toContain('Poster');
    expect(title).toContain('OurSharedEvents');
  });

  test('has lang="en" on <html>', async ({ page }) => {
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('en');
  });

  test('page header is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-header"]')).toBeVisible();
  });

  test('print control is a <button> in header (OSE-286)', async ({ page }) => {
    // OSE-286 / OSE-R-020: the Print control is a real <button> (was a
    // `javascript:window.print()` anchor) so it CAN be disabled while QR codes
    // load. Whether it is disabled right now depends on seeded data (QR present
    // → enabled), so the disabled→enabled gating is proven deterministically in
    // the "Print Gate (OSE-286)" describe below with a mocked, delayed bundle —
    // here we only lock that it is a real button element.
    const printBtn = page.locator('[data-testid="poster-print"]');
    await expect(printBtn).toBeVisible();
    expect(await printBtn.evaluate((el) => el.tagName)).toBe('BUTTON');
  });

  test('container is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-container"]')).toBeVisible();
  });

  test('event select wrapper is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-event-select"]')).toBeVisible();
  });

  test('event picker <select> is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-event-picker"]')).toBeVisible();
  });

  test('event picker has associated <label>', async ({ page }) => {
    const label = page.locator('label[for="event-picker"]');
    await expect(label).toBeVisible();
    const text = await label.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('poster area is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-area"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMPTY STATE  (meaningful only with NO data → the component tier's local worker)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
    test.skip(await hasEvents(page), 'Events present — skipping empty tests');
  });

  test('picker shows "No events available"', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    await expect(picker).toContainText('No events');
  });

  test('poster area shows "No events scheduled"', async ({ page }) => {
    const area = page.locator('[data-testid="poster-area"]');
    await expect(area).toContainText('No events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ERROR STATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Error State', () => {
  test('shows error message when API fails', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({ status: 500, body: 'Server Error' })
    );
    await navigateToPoster(page);

    const area = page.locator('[data-testid="poster-area"]');
    await expect(area).toContainText('Could not load events');
  });

  test('error state has .error class', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({ status: 500, body: 'Server Error' })
    );
    await navigateToPoster(page);

    await expect(page.locator('[data-testid="poster-area"] .error')).toBeVisible();
  });

  test('handles network timeout gracefully', async ({ page }) => {
    await page.route('**/api/v2/events', (route) => route.abort('timedout'));
    await navigateToPoster(page);

    const area = page.locator('[data-testid="poster-area"]');
    await expect(area).toContainText('Could not load events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FRIENDLY URL ALIASES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — URL Aliases', () => {
  const ALIASES = ['/poster', '/posters', '/flyers', '/tabletop', '/tent', '/signage'];

  for (const path of ALIASES) {
    test(`${path} returns 200 with HTML`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      expect(res?.status()).toBe(200);
      expect(res?.headers()['content-type']).toContain('text/html');
    });
  }

  for (const path of ALIASES) {
    test(`${path} renders the poster picker`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle', timeout: 20_000 });
      await expect(page.locator('[data-testid="poster-event-picker"]')).toBeVisible();
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Security Headers', () => {
  test('has Content-Security-Policy header', async ({ page }) => {
    const res = await page.goto('/poster');
    const csp = res?.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('nonce-');
  });

  test('has X-Content-Type-Options: nosniff', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('has X-Frame-Options', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.headers()['x-frame-options']).toBeDefined();
  });

  test('has Strict-Transport-Security', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.headers()['strict-transport-security']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. XSS RESILIENCE  (data mocked inline — no seeded backend needed)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — XSS Resilience', () => {
  test('XSS in event name is escaped in poster', async ({ page }) => {
    // Mock events API with XSS payload in name
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [
            {
              id: 'evt_xss',
              title: '<script>alert("xss")</script>',
              // OSE-844 / ADR-016: enrichWithPhase() emits the canonical field
              // `name` (mapped from `title`) and poster.html:556 reads it. This
              // mock fulfills the route directly, bypassing the worker and its
              // enrichment, so `name` must be supplied here or the poster title
              // renders EMPTY — which makes the `not.toContain('<script>alert')`
              // assertion below pass vacuously. The positive control below is
              // what catches that.
              name: '<script>alert("xss")</script>',
              slug: 'xss-event',
              status: 'active',
              brand_id: 'root',
            },
          ],
        }),
      })
    );
    await navigateToPoster(page);

    // The script tag should be escaped, not executed
    const posterHtml = await page.locator('[data-testid="poster-area"]').innerHTML();
    expect(posterHtml).not.toContain('<script>alert');
    // Should be HTML-escaped
    expect(posterHtml).toContain('&lt;script&gt;');
  });

  test('XSS in venue is escaped', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [
            {
              id: 'evt_xss2',
              title: 'Safe Title',
              slug: 'safe-event',
              status: 'active',
              brand_id: 'root',
              venue: '<img src=x onerror=alert(1)>',
            },
          ],
        }),
      })
    );
    await navigateToPoster(page);

    const posterHtml = await page.locator('[data-testid="poster-area"]').innerHTML();
    expect(posterHtml).not.toContain('<img src=x');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6b. PRINT GATE  (OSE-286 — data mocked inline; QR payload deliberately delayed)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Print Gate (OSE-286)', () => {
  // A 1x1 transparent PNG data-URI: a valid <img src> that loads instantly, so
  // the only thing gating Print is the (delayed) poster-bundle fetch below.
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const ONE_EVENT = {
    ok: true,
    status: 200,
    items: [
      {
        id: 'evt_gate',
        title: 'Gate Test',
        name: 'Gate Test',
        slug: 'gate-test',
        status: 'active',
        brand_id: 'root',
      },
    ],
  };
  const BUNDLE = {
    ok: true,
    qr: { register: TINY_PNG, checkin: TINY_PNG, survey: TINY_PNG, 'email-signup': TINY_PNG },
    links: {
      register: 'https://x/r',
      checkin: 'https://x/c',
      survey: 'https://x/s',
      'email-signup': 'https://x/e',
    },
    labels: {
      register: 'Registration',
      checkin: 'Check-in',
      survey: 'Survey',
      'email-signup': 'Email Signup',
    },
  };

  test('Print stays disabled until QR codes finish loading, then works', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ONE_EVENT),
      })
    );
    // Hold the QR payload open until we release it — simulates the slow venue
    // link where the bug bites hardest.
    let releaseBundle: () => void = () => {};
    const bundleGate = new Promise<void>((resolve) => {
      releaseBundle = resolve;
    });
    await page.route('**/poster-bundle', async (route) => {
      await bundleGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(BUNDLE),
      });
    });
    await page.route('**/sponsor-bundle*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, bundle: {} }),
      })
    );

    // Stub window.print so we can prove it is NOT called while gated.
    await page.addInitScript(() => {
      (window as unknown as { __printCalls: number }).__printCalls = 0;
      window.print = () => {
        (window as unknown as { __printCalls: number }).__printCalls++;
      };
    });

    await page.goto('/poster', { waitUntil: 'domcontentloaded', timeout: 20_000 });

    const printBtn = page.locator('[data-testid="poster-print"]');
    // Event rendered, but QR still in flight → Print disabled + status shown.
    await expect(printBtn).toBeDisabled();
    await expect(page.locator('[data-testid="poster-print-status"]')).toBeVisible();

    // Force a click while gated (dispatchEvent bypasses actionability waits) and
    // confirm nothing printed — the JS guard holds even if the DOM is poked.
    await printBtn.dispatchEvent('click');
    expect(
      await page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls)
    ).toBe(0);

    // Release the QR payload → the gate opens.
    releaseBundle();
    await expect(printBtn).toBeEnabled();

    // Now Print works.
    await printBtn.click();
    expect(
      await page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls)
    ).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6c. ONE CALL  (OSE-867 — the poster-bundle IS the poster's data)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — One Data Call (OSE-867)', () => {
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const BUNDLE = {
    ok: true,
    status: 200,
    eventId: 'evt_one',
    eventStatus: 'active',
    event: {
      id: 'evt_one',
      name: 'Bocce Night',
      start_date: '2026-10-24',
      startDateISO: '2026-10-24',
      starts_at: null,
      timezone: 'America/Chicago',
      venue: 'Eagles Hall',
      cover_image_url: null,
    },
    sponsors: [{ id: 'sp_1', name: 'Corner Bakery', logo_url: null, tier: 'primary' }],
    slots: [
      {
        kind: 'public',
        word: 'EVENT',
        tone: 'neutral',
        label: 'Event page',
        code: 'Abc123',
        url: 'https://x/s/Abc123',
        qr: TINY_PNG,
      },
    ],
  };

  test('a scoped poster (?event=) issues exactly one data request and prints date + venue from it', async ({
    page,
  }) => {
    const dataCalls: string[] = [];
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.pathname.startsWith('/api/')) dataCalls.push(u.pathname);
    });
    // Any list / sponsor-bundle call is a waterfall regression: answer it so a
    // regressed page still renders, and let the count below catch it.
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [BUNDLE.event] }),
      })
    );
    await page.route('**/sponsor-bundle*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, bundle: {} }),
      })
    );
    await page.route('**/poster-bundle', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BUNDLE) })
    );

    await page.goto('/poster?event=evt_one', { waitUntil: 'domcontentloaded', timeout: 20_000 });

    await expect(page.locator('[data-testid="poster-title"]')).toHaveText('Bocce Night');
    await expect(page.locator('[data-testid="poster-meta-venue"]')).toContainText('Eagles Hall');
    await expect(page.locator('[data-testid="poster-meta-date"]')).toContainText('2026');
    await expect(page.locator('[data-testid="poster-sponsor-name"]')).toHaveText('Corner Bakery');
    await expect(page.locator('[data-testid="qr-img-slot-public"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="poster-print"]')).toBeEnabled();

    expect(dataCalls).toEqual(['/api/v2/events/evt_one/poster-bundle']);
  });

  test('a scoped poster for an event that cannot be shown says so (no silent fallback to another event)', async ({
    page,
  }) => {
    await page.route('**/poster-bundle', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, status: 404, error: 'Event not found' }),
      })
    );
    await page.goto('/poster?event=evt_missing', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="poster-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="poster-card"]')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6d. showQRSection  (OSE-869 — a walk-up event prints no QR grid, and no gap)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — showQRSection (OSE-869)', () => {
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const bundle = (settings?: Record<string, unknown>) => ({
    ok: true,
    status: 200,
    eventId: 'evt_walkup',
    eventStatus: 'active',
    event: {
      id: 'evt_walkup',
      name: 'Walk-up Bocce',
      start_date: '2026-10-24',
      startDateISO: '2026-10-24',
      starts_at: null,
      timezone: 'America/Chicago',
      venue: 'Eagles Hall',
      cover_image_url: null,
    },
    sponsors: [],
    slots: [
      {
        kind: 'public',
        word: 'EVENT',
        tone: 'neutral',
        label: 'Event page',
        code: 'Abc123',
        url: 'https://x/s/Abc123',
        qr: TINY_PNG,
      },
    ],
    ...(settings ? { settings } : {}),
  });

  async function open(page: import('@playwright/test').Page, settings?: Record<string, unknown>) {
    await page.route('**/poster-bundle', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(bundle(settings)),
      })
    );
    await page.goto('/poster?event=evt_walkup', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.locator('[data-testid="poster-title"]')).toHaveText('Walk-up Bocce');
    await expect(page.locator('[data-testid="poster-print"]')).toBeEnabled();
  }

  test('off: no QR section on screen or in print, and no reserved gap', async ({ page }) => {
    await open(page, { showQRSection: false });
    await expect(page.locator('[data-testid="poster-qr-section"]')).toHaveCount(0);
    // No QR-shaped hole, on screen or on paper: the poster body's content ends
    // where its last VISIBLE child ends (plus its own bottom padding) — nothing
    // empty is left holding space where the grid was.
    const holeHeight = async () =>
      page.evaluate(() => {
        const body = document.querySelector('[data-testid="poster-body"]') as HTMLElement;
        const pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
        let lastBottom = body.getBoundingClientRect().top;
        for (const child of Array.from(body.children)) {
          const r = child.getBoundingClientRect();
          const mb = parseFloat(getComputedStyle(child).marginBottom) || 0;
          if (r.height > 0) lastBottom = Math.max(lastBottom, r.bottom + mb);
        }
        return body.getBoundingClientRect().bottom - pad - lastBottom;
      });
    expect(await holeHeight()).toBeLessThan(2);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-testid="poster-qr-section"]')).toHaveCount(0);
    expect(await holeHeight()).toBeLessThan(2);
  });

  test('on and absent: the QR section renders with its code', async ({ page }) => {
    await open(page, { showQRSection: true });
    await expect(page.locator('[data-testid="poster-qr-section"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="qr-img-slot-public"]')).toHaveCount(1);
  });

  test('absent setting behaves as on (existing posters unchanged)', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-testid="poster-qr-section"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="qr-img-slot-public"]')).toHaveCount(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. RESPONSE TIME
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Response Time', () => {
  test('page loads within 15 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/poster', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(15_000);
  });
});
