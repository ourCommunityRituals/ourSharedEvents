/**
 * E2E Flow: Public → Register, after OSE-1243
 *
 * ─── WHY THIS FILE SHRANK FROM 22 TESTS TO 7 ──────────────────────────────────
 *
 * 21 of the 22 tests began with `mockEvents(page, [...])`, intercepting
 * `**\/api/v2/events` to decide what the cards said. The public list is
 * server-rendered now, so that interception never reaches the code under test —
 * the page renders whatever the backend actually holds and the stub sits unused.
 * The tests would not have gone red; they would have gone green for no reason.
 *
 * Most of what they asserted was markup, not behaviour: the CTA is an `<a>`,
 * its href is `/forms/{id}?type=register`, its aria-label names the event, each
 * card carries its own `data-event-id`, cards keep provider order, XSS in an id
 * or a name is escaped. None of that needed a browser. All of it moved to
 * `tests/unit/public-events-phase.test.ts`, which runs against
 * `renderEventList()` in milliseconds and covers more cases than the originals.
 *
 * What survives here is what only a browser can answer: does clicking actually
 * arrive at a working form, is the target big enough for a thumb, and does the
 * card hold together at 375px. These read whatever events the environment has
 * and skip when it has none — the pattern the one non-mocked test in this file
 * ("complete flow") already used.
 *
 * The full journey is the reason this file exists. Keep it first.
 */

import { test, expect, type Page } from '@playwright/test';

const TIMEOUT = 20_000;

/** Load /events and report how many cards the environment actually has. */
async function loadEvents(page: Page): Promise<number> {
  await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });
  return page.locator('[data-testid="public-event-card"]').count();
}

/**
 * The first card offering registration. A card whose event has already
 * happened links to a recap instead, and clicking that proves nothing about
 * this flow.
 */
function registerCta(page: Page) {
  return page.locator('[data-testid="public-event-cta"][data-cta="register"]').first();
}

test.describe('Public → Register: the journey', () => {
  test('complete flow: see event → register → success', async ({ page }) => {
    const cards = await loadEvents(page);
    test.skip(cards === 0, 'No events in this environment — cannot test the journey');

    const cta = registerCta(page);
    test.skip((await cta.count()) === 0, 'No upcoming events — every card is a recap');

    await expect(cta).toContainText('Register');
    await cta.click();
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/forms/');
    expect(page.url()).toContain('type=register');

    const nameInput = page.locator('[data-testid="register-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(`E2E Journey Test ${Date.now()}`);

    await page.locator('[data-testid="register-submit"]').click();
    await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10_000 });
  });

  test('the form that opens is for the event whose card was clicked', async ({ page }) => {
    const cards = await loadEvents(page);
    test.skip(cards === 0, 'No events in this environment');
    const cta = registerCta(page);
    test.skip((await cta.count()) === 0, 'No upcoming events');

    // Read the identity off the card BEFORE navigating, then prove the form
    // agrees. This is the assertion the per-card href unit tests cannot make:
    // that the link resolves to a page about the same event.
    const card = page.locator('[data-testid="public-event-card"]').filter({ has: cta }).first();
    const eventId = await card.getAttribute('data-event-id');
    const eventName = (
      await card.locator('[data-testid="public-event-name"]').textContent()
    )?.trim();

    await cta.click();
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain(`/forms/${eventId}`);
    const heading = page.locator('[data-testid="form-event-name"]');
    await expect(heading).toBeVisible({ timeout: 10_000 });
    if (eventName) await expect(heading).toContainText(eventName);
  });

  test('the registration form is ready for input on arrival', async ({ page }) => {
    const cards = await loadEvents(page);
    test.skip(cards === 0, 'No events in this environment');
    const cta = registerCta(page);
    test.skip((await cta.count()) === 0, 'No upcoming events');

    await cta.click();
    await page.waitForLoadState('networkidle');
    const nameInput = page.locator('[data-testid="register-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await expect(nameInput).toBeEditable();
  });
});

test.describe('Public → Register: layout a unit test cannot measure', () => {
  test('the CTA meets the 44px touch target minimum', async ({ page }) => {
    const cards = await loadEvents(page);
    test.skip(cards === 0, 'No events in this environment');

    // WCAG 2.5.5. The old assertion here allowed 30px with a comment excusing
    // it as "padding .5rem = ~34px+", which is not the standard and is below
    // what OSE-1236's mobile-workability contract now enforces everywhere else.
    const box = await page.locator('[data-testid="public-event-cta"]').first().boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('the CTA is reachable by keyboard without a tabindex hack', async ({ page }) => {
    const cards = await loadEvents(page);
    test.skip(cards === 0, 'No events in this environment');

    const cta = page.locator('[data-testid="public-event-cta"]').first();
    const tabindex = await cta.getAttribute('tabindex');
    expect(tabindex === null || tabindex === '0').toBe(true);
    await cta.focus();
    await expect(cta).toBeFocused();
  });

  test('the card fits a 375px viewport and keeps its CTA visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const cards = await loadEvents(page);
    test.skip(cards === 0, 'No events in this environment');

    const card = page.locator('[data-testid="public-event-card"]').first();
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(375);
    await expect(card.locator('[data-testid="public-event-cta"]')).toBeVisible();
  });

  test('no horizontal overflow with real event names at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loadEvents(page);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflows).toBe(false);
  });
});
