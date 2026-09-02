/**
 * OSE-R-004 (+ OSE-R-022) — Playwright FE for branded 4xx/5xx error pages.
 *
 * Layer: FE (real browser visits an event link that 404s, sees the brand
 * header + friendly copy + working CTA back to /events).
 *
 * Companion to:
 *   - workers/oursharedevents/tests/public-event-error-pages.spec.ts (vitest API)
 *   - bruno/ose-pages (OSE-R-004 folder)
 *
 * Test names share their shape byte-for-byte across runners where the
 * scenario maps; differ only by the API/FE qualifier where the layer
 * differs.
 *
 * Backstop: The audit (REFINEMENT-BACKLOG-2026-05-15.md OSE-R-004 + R-022)
 * found that public-event 404 / 503 returned bare 1996-style HTML. A bar
 * attendee following a shared link to an archived event saw nothing but
 * `<h1>Event not found</h1>` — no brand, no nav, no CTA. This spec
 * verifies the branded shell + a working CTA in a real browser.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const NONEXISTENT_EVENT_ID = 'evt_does_not_exist_r004';
const MALFORMED_EVENT_ID = 'not a valid id!!';

async function gotoEventPage(page: Page, eventId: string): Promise<void> {
  await page.goto(`${BASE_URL}/events/${encodeURIComponent(eventId)}`, {
    waitUntil: 'domcontentloaded',
  });
}

test.describe('OSE-R-004 — branded public-event error pages in browser', () => {
  test('OSE-R-004 | FE | GET /events/:id (well-formed id, no row) | error page shows OurSharedEvents brand header', async ({
    page,
  }) => {
    await gotoEventPage(page, NONEXISTENT_EVENT_ID);
    await expect(page.locator('[data-testid="error-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-brand"]')).toHaveText(/OurSharedEvents/);
  });

  test('OSE-R-004 | FE | GET /events/:id (well-formed id, no row) | renders friendly "couldn\'t find that event" copy', async ({
    page,
  }) => {
    await gotoEventPage(page, NONEXISTENT_EVENT_ID);
    const title = page.locator('[data-testid="error-title"]');
    await expect(title).toBeVisible();
    await expect(title).toHaveText(/couldn'?t find that event/i);
    const body = page.locator('[data-testid="error-body"]');
    await expect(body).toBeVisible();
    await expect(body).toContainText(/archived|coming up next/i);
  });

  test('OSE-R-004 | FE | GET /events/:id (well-formed id, no row) | CTA links to /events and is clickable', async ({
    page,
  }) => {
    await gotoEventPage(page, NONEXISTENT_EVENT_ID);
    const cta = page.locator('[data-testid="error-cta"]');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(/browse upcoming events/i);
    await expect(cta).toHaveAttribute('href', '/events');
  });

  test('OSE-R-004 | FE | GET /events/:id (malformed id) | same branded shell renders (not bare HTML)', async ({
    page,
  }) => {
    await gotoEventPage(page, MALFORMED_EVENT_ID);
    await expect(page.locator('[data-testid="error-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-cta"]')).toBeVisible();
  });

  test('OSE-R-004 | FE | GET /events/:id (any error) | brand header appears VISUALLY above the error title', async ({
    page,
  }) => {
    // Trust + wayfinding: the brand chrome anchors the page before the
    // error content. The audit specifically flagged that pre-fix the
    // customer saw an unanchored h1 with no surrounding context.
    await gotoEventPage(page, NONEXISTENT_EVENT_ID);
    const header = page.locator('[data-testid="error-header"]');
    const title = page.locator('[data-testid="error-title"]');
    const headerBox = await header.boundingBox();
    const titleBox = await title.boundingBox();
    expect(headerBox, 'header must be laid out').toBeTruthy();
    expect(titleBox, 'title must be laid out').toBeTruthy();
    if (headerBox && titleBox) {
      expect(headerBox.y).toBeLessThan(titleBox.y);
    }
  });

  test('OSE-R-022 | FE | GET /events/:id (any error) | page renders with no horizontal scroll on a phone-width viewport', async ({
    page,
  }) => {
    // Bar attendees follow share-links on phones. The branded shell must
    // fit a 375px-wide viewport without a horizontal scrollbar — otherwise
    // the CTA can drift off-screen and the page reads worse than the
    // pre-fix bare HTML for this specific audience.
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoEventPage(page, NONEXISTENT_EVENT_ID);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, 'no horizontal scroll on phone-width viewport').toBeLessThanOrEqual(
      clientWidth
    );
  });

  test('OSE-R-004 | FE | GET /events/:id (any error) | CTA click navigates to /events without error', async ({
    page,
  }) => {
    await gotoEventPage(page, NONEXISTENT_EVENT_ID);
    await page.locator('[data-testid="error-cta"]').click();
    // The CTA target may render 404 too in this test environment (no seed
    // events), but the URL navigation itself must succeed.
    await expect(page).toHaveURL(/\/events(?:\?|$)/);
  });
});
