/**
 * ATTENDEE ARC — Poster → Pre / Event / Post (Tier 2)
 *
 * The existing journey-{pre,event-day,post}-event smoke specs walk the ADMIN
 * side. This spec is the missing half: what the person who scans the poster
 * QR actually experiences at each phase of /events/:id.
 *
 * Fixtures (seeded by CI before this runs; skip cleanly if absent):
 *   SMOKE_EVENT_PRE   — active event with start_date in the future
 *   SMOKE_EVENT_LIVE  — active event with now between start and end
 *   SMOKE_EVENT_POST  — active event with end_date in the past
 *
 * Seeding: tests/ui/smoke/fixtures/smoke-events.sql — dates relative to now
 * so fixtures never rot. Apply manually or via wrangler d1 execute before
 * dispatching T4 Functional.
 *
 * File: tests/ui/smoke/journey-attendee-arc.smoke.spec.ts
 */
import { test, expect } from '@playwright/test';

const PRE = process.env.SMOKE_EVENT_PRE;
const LIVE = process.env.SMOKE_EVENT_LIVE;
const POST = process.env.SMOKE_EVENT_POST;

test.describe('attendee arc — /events/:id across phases', () => {
  test('PRE: 5W surface, venue map, share metadata', async ({ page }) => {
    test.skip(!PRE, 'SMOKE_EVENT_PRE not seeded');
    await page.goto(`/events/${PRE}`);
    await expect(page.locator('[data-testid="event-main"], main').first()).toBeVisible();
    // 5W content present
    await expect(page.locator('[data-testid="venue-map"]')).toBeVisible();
    await expect(page.locator('[data-testid="gmaps-link"]')).toHaveAttribute(
      'href',
      /google\.com\/maps/
    );
    // Share path: OG tags rendered server-side
    expect(await page.locator('meta[property="og:title"]').count()).toBe(1);
    // Anonymity affordance is part of the contract on every phase
    await expect(page.locator('[data-testid="anonymity-affordance"]')).toBeVisible();
  });

  test('LIVE: navigate-now affordance replaces directions', async ({ page }) => {
    test.skip(!LIVE, 'SMOKE_EVENT_LIVE not seeded');
    await page.goto(`/events/${LIVE}`);
    await expect(page.locator('[data-testid="venue-map-live"]')).toBeVisible();
    await expect(page.locator('[data-testid="gmaps-link-live"]')).toHaveAttribute(
      'href',
      /maps\/dir/
    );
    await expect(page.locator('[data-testid="anonymity-affordance"]')).toBeVisible();
  });

  test('POST: recap renders — never the dead-end stub', async ({ page }) => {
    test.skip(!POST, 'SMOKE_EVENT_POST not seeded');
    await page.goto(`/events/${POST}`);
    await expect(page.locator('[data-testid="event-main-post"]')).toBeVisible();
    await expect(page.locator('[data-testid="event-title-post"]')).toBeVisible();
    await expect(page.locator('[data-testid="event-recap-card"]')).toBeVisible();
    // The loop must close: either a concrete next event or the listing pointer
    const next = page.locator(
      '[data-testid="next-event-card"], [data-testid="next-event-fallback"]'
    );
    await expect(next.first()).toBeVisible();
    // Opt-in continuity CTA present and correctly targeted
    await expect(page.locator('[data-testid="email-signup-link"]')).toHaveAttribute(
      'href',
      new RegExp(`/forms/${POST}\\?type=email`)
    );
    await expect(page.locator('[data-testid="anonymity-affordance"]')).toBeVisible();
    // Regression guard: the old stub message must NOT be the whole page
    await expect(page.locator('[data-testid="event-phase-msg"]')).toHaveCount(0);
  });

  test('POST: next-event link actually navigates when present', async ({ page }) => {
    test.skip(!POST, 'SMOKE_EVENT_POST not seeded');
    await page.goto(`/events/${POST}`);
    const link = page.locator('[data-testid="next-event-link"]');
    if (await link.count()) {
      await link.click();
      await expect(page).toHaveURL(/\/events\/.+/);
      await expect(page.locator('main').first()).toBeVisible();
    }
  });

  test('POST: email signup CTA lands on the working form', async ({ page }) => {
    test.skip(!POST, 'SMOKE_EVENT_POST not seeded');
    await page.goto(`/events/${POST}`);
    await page.locator('[data-testid="email-signup-link"]').click();
    await expect(page).toHaveURL(new RegExp(`/forms/${POST}`));
    // The email form page renders an input — the loop is functionally closed
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
  });
});
