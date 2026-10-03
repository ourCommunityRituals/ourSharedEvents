/**
 * admin-wizard-journey.spec.ts — the guided path, walked end to end.
 *
 * Feature intent: proves a first-time organizer (the bar owner setting up
 * their first trivia night) can go from "Walk me through it" to a launched
 * event without touching the advanced dashboard. This is the executable port
 * of the dormant S08 contract (admin-wizard-flow.spec.js — GAS-era, .js, not
 * matched by playwright.e2e.config.ts) onto the real native-JS wizard built
 * in FE dev-prep Phase B (docs/plans/FE-DEV-PREP-2026-08-29.md).
 *
 * API calls are mocked at the network edge: the wizard's ONE write is
 * POST /api/v2/admin/events (the same endpoint the dashboard form uses) and
 * its QR/link data comes from GET /api/v2/events/:id/poster-bundle. Mocking
 * keeps this spec runnable against staging without creating real events;
 * the endpoints themselves are covered by API/contract suites.
 *
 * History: replaces reliance on the archived GAS wizard spec; testid family
 * (launch-wizard, wizard-step-1..5, wizard-event-name/date/venue,
 * wizard-next-btn, wizard-finish-btn, wizard-link-*) predates this file in
 * the drift baseline and is now emitted by admin.html.
 */

import { test, expect, type Page } from '@playwright/test';

const TIMEOUT = 20_000;
const CREATED_ID = 'evt_wizard_journey';

/** Mock the wizard's two API touchpoints — create + poster-bundle. */
async function mockWizardApis(page: Page) {
  await page.route('**/api/v2/admin/events', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: CREATED_ID, warnings: [] }),
      });
    }
    return route.continue();
  });
  await page.route(`**/api/v2/events/${CREATED_ID}/poster-bundle*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 200,
        eventId: CREATED_ID,
        qr: { register: 'data:image/png;base64,iVBORw0KGgo=' },
        links: { register: `https://example.test/forms/${CREATED_ID}?type=register` },
        uecQr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
      }),
    })
  );
}

test.describe('guided wizard journey (two paths, one admin)', () => {
  test('organizer creates and launches an event through all five steps', async ({ page }) => {
    await mockWizardApis(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // Door: the chooser offers both paths; picking the wizard opens step 1.
    await page.locator('[data-testid="admin-path-wizard"]').click();
    const wizard = page.locator('[data-testid="launch-wizard"]');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('h2')).toHaveText('Create & Launch');
    await expect(page.locator('[data-testid="wizard-step-1"]')).toBeVisible();

    // Step 1 gate: name + venue are the only two real requirements. Next stays
    // enabled and says why it will not move on (OSE-1515).
    const next = page.locator('[data-testid="wizard-next-btn"]');
    await next.click();
    await expect(page.locator('[data-testid="wizard-msg"]')).toHaveText(
      'Add a name and a place to continue'
    );
    await page.locator('[data-testid="wizard-event-name"]').fill('Journey Trivia Night');
    await next.click();
    await expect(page.locator('[data-testid="wizard-step-1"]')).toBeVisible();
    await page.locator('[data-testid="wizard-event-venue"]').fill('Rock Island Public House');
    await expect(next).toBeEnabled();
    // Date pre-fills to today — the organizer shouldn't start from a blank.
    await expect(page.locator('[data-testid="wizard-event-date"]')).not.toHaveValue('');
    await next.click();

    // Step 2: pick a template; the choice is a plain-language prefill.
    await expect(page.locator('[data-testid="wizard-step-2"]')).toBeVisible();
    const trivia = page.locator('.wizard-template-card[data-template="trivia"]');
    await trivia.click();
    await expect(trivia).toHaveClass(/selected/);
    await next.click();

    // Step 3: sign-up choice; the action button now says what it does.
    await expect(page.locator('[data-testid="wizard-step-3"]')).toBeVisible();
    await expect(next).toHaveText('Create Event');
    await expect(page.locator('.wizard-signup-option[data-option="create"]')).toHaveClass(
      /selected/
    );

    // Back nav preserves everything typed so far (no lost work).
    await page.locator('#wizardBackBtn').click();
    await expect(page.locator('[data-testid="wizard-step-2"]')).toBeVisible();
    await next.click();
    await expect(page.locator('[data-testid="wizard-event-name"]')).toHaveValue(
      'Journey Trivia Night'
    );

    // Create — the wizard's single POST to the same endpoint the dashboard uses.
    await next.click();

    // Step 4: every share surface gets a link card; attendee-reached pages
    // (event page, sign-up) also get a scannable code.
    await expect(page.locator('[data-testid="wizard-step-4"]')).toBeVisible();
    for (const card of ['public', 'signup', 'poster', 'display', 'report']) {
      await expect(page.locator(`[data-testid="wizard-link-${card}"]`)).toBeVisible();
    }
    await expect(
      page.locator(`[data-testid="wizard-link-public"] [data-role="url"]`)
    ).toContainText(`/events/${CREATED_ID}`);
    await expect(page.locator('#wizardQrPublic img')).toBeVisible();
    await expect(page.locator('#wizardQrSignup img')).toBeVisible();
    await next.click();

    // Step 5: plain-language summary carries the event name; Done closes out.
    await expect(page.locator('[data-testid="wizard-step-5"]')).toBeVisible();
    await expect(page.locator('#wizardEventSummary')).toContainText('Journey Trivia Night');
    const finish = page.locator('[data-testid="wizard-finish-btn"]');
    await expect(finish).toBeVisible();
    await expect(finish).toHaveText('Done');
  });

  test('advanced path clears the doorway and keeps the dashboard', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.locator('[data-testid="admin-path-advanced"]').click();
    // Chooser steps aside; the full dashboard (create card) is the surface.
    await expect(page.locator('[data-testid="admin-path-chooser"]')).toBeHidden();
    await expect(page.locator('[data-testid="launch-wizard"]')).toBeHidden();
    await expect(page.locator('[data-testid="create-event-card"]')).toBeVisible();
  });

  test('skip on the sign-ups step still creates the event (one POST, no dead end)', async ({
    page,
  }) => {
    await mockWizardApis(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.locator('[data-testid="admin-path-wizard"]').click();
    await page.locator('[data-testid="wizard-event-name"]').fill('Skip Night');
    await page.locator('[data-testid="wizard-event-venue"]').fill('Harbor Cabins');
    await page.locator('[data-testid="wizard-next-btn"]').click();
    await page.locator('[data-testid="wizard-next-btn"]').click();
    await page.locator('#wizardSkipBtn').click();
    await expect(page.locator('[data-testid="wizard-step-4"]')).toBeVisible();
    // No sign-ups chosen → the sign-up card stays out of the way.
    await expect(page.locator('[data-testid="wizard-link-signup"]')).toBeHidden();
  });
});
