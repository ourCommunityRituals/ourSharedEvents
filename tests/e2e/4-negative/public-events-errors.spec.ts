/**
 * E2E Negative: Public Events — what still needs a browser after OSE-1243
 *
 * ─── WHY THIS FILE SHRANK FROM 22 TESTS TO 6 ──────────────────────────────────
 *
 * Every test here used to begin by intercepting `**\/api/v2/events` and
 * fulfilling it with a crafted payload. That worked because the page fetched
 * its own list: the interception WAS the input.
 *
 * OSE-1243 server-rendered the list. The Worker now puts the events in the HTML
 * it sends, so a route interception no longer reaches the code under test — it
 * would sit there unused while the page rendered whatever the backend actually
 * held. The old tests would not have failed loudly; they would have passed
 * vacuously, which is worse.
 *
 * The cases did not disappear. Error, empty, `ok:false`, null items, XSS in the
 * name, XSS in the venue, a quote in the id, a missing name, a garbage date —
 * all of them now live in `tests/unit/public-events-phase.test.ts`, exercised
 * against `renderEventList()` directly. They run in milliseconds without a
 * browser, and they assert the produced markup rather than a payload's journey
 * through a network stub.
 *
 * What is left here is the residue that a unit test genuinely cannot prove:
 * that a REAL browser, against a REAL response, lays the page out and logs
 * nothing.
 *
 * ─── A NOTE ON WHAT THIS FILE PROVED ABOUT ITSELF ─────────────────────────────
 *
 * Two of the deleted tests asserted that an event with no name renders
 * "Untitled Event". The template stopped producing that when OSE-871 removed
 * the `|| 'Untitled Event'` fallback. Those tests could only have stayed green
 * by never running — and they never did: CI invokes an explicit allowlist via
 * `playwright.e2e-smoke.config.ts`, and this file has never been on it.
 * `npm run test:e2e:negative` exists and no workflow calls it. Tracked as
 * OSE-1244.
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 20_000;

test.describe('Public Events — server-rendered page in a real browser', () => {
  test('the list is in the HTML the server sent, before any script runs', async ({ browser }) => {
    // JavaScript disabled. This is the whole point of the change: if the cards
    // are visible with no JS at all, they were in the response.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto('/events', { timeout: TIMEOUT });
      const cards = page.locator('[data-testid="public-event-card"]');
      const empty = page.locator('[data-testid="public-events-empty"]');
      // Either state is legitimate — it depends on the backend's actual data.
      // What must NOT happen is neither, which is what a client-rendered page
      // gives you with JS off.
      expect((await cards.count()) + (await empty.count())).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('no loading state is ever shown, because nothing loads', async ({ page }) => {
    await page.goto('/events', { timeout: TIMEOUT });
    // Asserted by its text rather than by the retired loading testid. The
    // testid-drift gate (OSE-1003) flags any spec that names a testid the code
    // does not emit — including inside comments — and it is right to: a
    // selector for a retired element is indistinguishable from a typo.
    // Absence of the ELEMENT is already proven in
    // workers/oursharedevents/tests/public-server-rendered.spec.ts.
    expect(await page.content()).not.toContain('Loading events');
  });

  test('the page never renders both an empty state and a card', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });
    const cards = await page.locator('[data-testid="public-event-card"]').count();
    const empty = await page.locator('[data-testid="public-events-empty"]').count();
    expect(cards > 0 && empty > 0).toBe(false);
  });

  test('the page does not scroll horizontally at 375px', async ({ page }) => {
    // Layout, so it needs a real engine. Long event names are the input that
    // historically broke this.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflows).toBe(false);
  });

  test('no uncaught page errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });
    expect(errors).toEqual([]);
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });
    expect(errors).toEqual([]);
  });
});
