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
    // Wayfinding = OSE-660 universal geo-link: privacy-first, opens the visitor's
    // OWN maps app via a geo: URI (coordinates) or maps.apple.com (address
    // fallback), link-out only with rel="noopener noreferrer" — NEVER a Google-
    // specific embed/tracker on the anonymous surface. (The old gmaps-link
    // assertion was drift — a contract the app never shipped, OSE-1106.)
    await expect(page.locator('[data-testid="geo-link"]')).toHaveAttribute(
      'href',
      /^geo:|^https:\/\/maps\.apple\.com\//
    );
    await expect(page.locator('[data-testid="geo-link"]')).toHaveAttribute(
      'rel',
      'noopener noreferrer'
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
    // LIVE variant of the OSE-660 geo-link (same privacy-first contract, distinct
    // testid emitted by renderEventLiveHtml) — OSE-1106.
    await expect(page.locator('[data-testid="geo-link-live"]')).toHaveAttribute(
      'href',
      /^geo:|^https:\/\/maps\.apple\.com\//
    );
    await expect(page.locator('[data-testid="geo-link-live"]')).toHaveAttribute(
      'rel',
      'noopener noreferrer'
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
      new RegExp(`/events/${POST}/updates$`)
    );
    await expect(page.locator('[data-testid="anonymity-affordance"]')).toBeVisible();
    // Regression guard: the old stub message must NOT be the whole page
    await expect(page.locator('[data-testid="event-phase-msg"]')).toHaveCount(0);
  });

  test('POST: next-event link points at a real event — loop closes, not a dead end', async ({
    page,
  }) => {
    test.skip(!POST, 'SMOKE_EVENT_POST not seeded');
    await page.goto(`/events/${POST}`);
    const link = page.locator('[data-testid="next-event-link"]');
    if (await link.count()) {
      // The loop-closes contract at this rung = the link EXISTS and TARGETS a
      // real /events/<id> page. We assert the target, not a live click-through.
      //
      // Why not click through: the actual cross-page navigation goes through
      // Cloudflare bot mitigation on the public /events/* surface
      // (docs/security/BOT_CONTROLS_BASELINE.md §6.1) and is unreliable under
      // automation across engines — Chromium trips a Managed Challenge (worker
      // never runs, no <main>) and WebKit hangs the in-page nav without ever
      // committing a URL (page.url() == "" while the recap page is still shown).
      // Both are edge/automation behaviour, NOT an app defect: the destination's
      // render is already proven deterministically by the PRE/LIVE/POST goto
      // tests above and by the worker-level public-event-page.spec.ts (which also
      // asserts href="/events/<nextId>"). Recovering the live click-through as CI
      // coverage needs the CI-scoped WAF Managed-Challenge Skip on stg /events/*
      // (founder/DevOps lane; mirrors OSE-939's /q/* rule) — OSE-1162.
      await expect(link).toHaveAttribute('href', /\/events\/.+/);
    }
  });

  test('POST: email signup CTA lands on the working form', async ({ page }) => {
    test.skip(!POST, 'SMOKE_EVENT_POST not seeded');
    await page.goto(`/events/${POST}`);
    // The link targets the event's own updates form (OSE-1684). It is not
    // clicked: since the form moved under /events/*, an automated in-page
    // click there meets Cloudflare's Managed Challenge, the same edge
    // behaviour the NEXT test above describes (OSE-1162). The form is opened
    // by its address instead, as the PRE/LIVE/POST tests open the event page.
    const link = page.locator('[data-testid="email-signup-link"]');
    await expect(link).toHaveAttribute('href', new RegExp(`/events/${POST}/updates$`));
    await page.goto(`/events/${POST}/updates`);
    // The email form page renders an input — the loop is functionally closed
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
  });
});
