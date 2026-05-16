/**
 * OSE-307 — Events discovery flow (first PR of the flow-test arc).
 *
 * Walks the customer's events-discovery journey at 375x812 and asserts
 * mobile workability at EACH step of the navigation chain. Fills the
 * gap left by `tests/playwright/mobile-workability.spec.ts` which
 * measures per-surface compliance but NOT flow continuity.
 *
 * Flow:
 *   1. Land on / (landing page)
 *   2. Tap "Events" navigation (or equivalent) → navigate to /events
 *   3. Tap an event card's CTA → navigate to /events/:id
 *   4. Assert /events/:id is reachable + mobile-clean
 *
 * Each step asserts:
 *   - URL matches expected pattern
 *   - No horizontal scroll
 *   - Touch targets >= 44px (WCAG 2.5.5 inline exemption applied)
 *   - Viewport allows pinch-zoom
 *   - Primary CTA above the fold (when applicable)
 *
 * Failure modes this catches that the per-surface audit doesn't:
 *   - Landing's "Events" nav link doesn't actually navigate to /events
 *   - /events public-event-cta resolves to an element that doesn't
 *     navigate (broken href / missing onClick)
 *   - URL params get dropped when navigating between surfaces
 *   - One of the surfaces becomes unreachable due to a routing change
 *
 * Failure modes this does NOT catch (deferred to subsequent flow specs):
 *   - Form-fill UX (covered by future attendee-registration flow once
 *     staging has a pre_event fixture)
 *   - Data round-trip (form submit + success state)
 *   - Admin flows (blocked on OSE_ADMIN_BEARER founder action / OSE-302)
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names follow
 *   `OSE-307 | FE | flow <flow-name> | step N: <assertion>`.
 */

import { test, expect } from '@playwright/test';
import {
  loadAndSettle,
  settle,
  assertMobileWorkable,
  MOBILE_VIEWPORT,
} from './_helpers/mobile-workability-assertions';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

test.describe('OSE-307 events discovery flow — mobile workability per step', () => {
  test('OSE-307 | FE | flow events-discovery | step 1: landing renders mobile-clean with navigable Events link', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await assertMobileWorkable(page, 'landing', {
      // Landing's primary CTA is the subscribe-submit button — already
      // validated mobile-clean by mobile-workability.spec.ts. Here we
      // re-validate in flow context to catch any regression that breaks
      // landing's CTA chain.
      primaryCtaSelector:
        '[data-testid="subscribe-submit"], [data-testid="cta-primary"], header a, .hero a, .hero button',
    });

    // The Events nav link is the gateway to the events-discovery flow.
    // It MUST exist and be tappable.
    const eventsLink = page.locator('[data-testid="nav-events"]').first();
    await expect(
      eventsLink,
      'landing: nav-events link missing — first step of events-discovery flow has no entry point'
    ).toBeVisible();
  });

  test('OSE-307 | FE | flow events-discovery | step 2: tap nav-events → /events renders with at least one event card', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/`);

    const eventsLink = page.locator('[data-testid="nav-events"]').first();
    await eventsLink.click();
    await page.waitForURL(/\/events\/?$/, { timeout: 5000 });
    await settle(page);

    await expect(page).toHaveURL(/\/events\/?$/);
    await assertMobileWorkable(page, 'public events listing', {
      primaryCtaSelector: '[data-testid="public-event-cta"], main a, [data-testid*="event"]',
    });

    // The /events listing must show at least one event card for the
    // discovery flow to continue. If this fails, staging has no public
    // events seeded — that's itself a real problem worth surfacing.
    const eventCards = page.locator('[data-testid="public-event-card"]');
    const cardCount = await eventCards.count();
    expect(
      cardCount,
      '/events: zero event cards — the public discovery flow has no events to discover'
    ).toBeGreaterThan(0);
  });

  test('OSE-307 | FE | flow events-discovery | step 3: tap public-event-cta → /events/:id renders mobile-clean', async ({
    page,
  }) => {
    await loadAndSettle(page, `${BASE_URL}/events`);

    const firstCta = page.locator('[data-testid="public-event-cta"]').first();
    await expect(firstCta, '/events: no public-event-cta on first card').toBeVisible();
    // Capture the href so we can assert navigation lands at the right URL.
    const expectedHref = await firstCta.getAttribute('href');
    expect(expectedHref, '/events: public-event-cta has no href — CTA cannot navigate').toMatch(
      /^\/events\/[\w-]+/
    );

    await firstCta.click();
    await page.waitForURL(new RegExp(`${expectedHref!.replace(/\//g, '\\/')}`), {
      timeout: 5000,
    });
    await settle(page);

    // /events/:id render is phase-dependent. We accept any of:
    //   - pre_event render (data-testid="event-main")
    //   - event-live render (data-testid="event-main-live")
    //   - post_event minimal render (data-testid="event-main-minimal")
    //   - OSE-R-004 error page (data-testid="error-main") if event missing
    // All four ARE customer surfaces and MUST be mobile-clean.
    const mainPresent = await page
      .locator(
        '[data-testid="event-main"], [data-testid="event-main-live"], [data-testid="event-main-minimal"], [data-testid="error-main"]'
      )
      .first()
      .isVisible();
    expect(
      mainPresent,
      `/events/:id: no recognized main element — phase render unexpectedly missing`
    ).toBe(true);

    // The per-step mobile-workability assertion. For phase-minimal /
    // error renders, no primary CTA is required (those surfaces are
    // intentionally minimal — the message IS the surface).
    await assertMobileWorkable(page, '/events/:id (flow target)');
  });

  test('OSE-307 | FE | flow events-discovery | viewport stays at 375x812 throughout the entire flow', async ({
    page,
  }) => {
    // Regression guard for the FLOW MEASUREMENT contract: if Playwright
    // ever resets viewport between navigations (e.g., due to a Chromium
    // upgrade or a config drift), the per-step mobile assertions silently
    // start measuring at desktop. Asserting the viewport at flow START
    // and END catches that class of issue.
    await loadAndSettle(page, `${BASE_URL}/`);
    expect(page.viewportSize()).toEqual(MOBILE_VIEWPORT);

    await page.locator('[data-testid="nav-events"]').first().click();
    await page.waitForURL(/\/events\/?$/, { timeout: 5000 });
    expect(page.viewportSize()).toEqual(MOBILE_VIEWPORT);

    const cta = page.locator('[data-testid="public-event-cta"]').first();
    if ((await cta.count()) > 0) {
      await cta.click();
      await page.waitForLoadState('domcontentloaded');
      expect(page.viewportSize()).toEqual(MOBILE_VIEWPORT);
    }
  });
});
