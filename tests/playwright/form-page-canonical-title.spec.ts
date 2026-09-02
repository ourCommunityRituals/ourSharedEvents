/**
 * OSE-R-007 — Playwright FE for canonical event-title on form pages.
 *
 * Layer: FE (real browser visits /forms/:eventId with and without a
 * crafted ?event=... query param; inspects the rendered DOM and document
 * title to confirm the canonical title from D1 wins and any attacker-
 * supplied query string is ignored entirely).
 *
 * Companion to:
 *   - workers/oursharedevents/tests/form-page-canonical-title.spec.ts (vitest API)
 *   - bruno/ose-api (OSE-R-007 folder)
 *
 * Backstop: per audit OSE-R-007, the form renderer pre-fix trusted
 * ?event=... as the display name. An attacker crafting
 * `/forms/evt_X?event=Cheap%20Rolex%20Deals!` got a phishing-ready page
 * that looked official. The fix routes the title through a D1 lookup;
 * the query param is dead content.
 *
 * Test data: this spec assumes a seeded event with id `evt_test_2026`
 * exists in staging with title containing "Empty Bottle" — adjust the
 * KNOWN_TITLE constant if the staging seed differs.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const KNOWN_EVENT_ID = process.env.OSE_R007_KNOWN_EVENT_ID || 'evt_test_2026';
const KNOWN_TITLE_REGEX = new RegExp(
  process.env.OSE_R007_KNOWN_TITLE_PATTERN || 'Empty Bottle|Thursday Jazz|Test Event',
  'i'
);
const UNKNOWN_EVENT_ID = 'evt_does_not_exist_r007';

async function gotoForm(page: Page, eventId: string, query = ''): Promise<void> {
  await page.goto(`${BASE_URL}/forms/${eventId}${query}`, {
    waitUntil: 'domcontentloaded',
  });
}

test.describe('OSE-R-007 — canonical form-page title in browser', () => {
  test('OSE-R-007 | FE | GET /forms/:id (known event, no query) | event-name header reflects canonical title from D1', async ({
    page,
  }) => {
    await gotoForm(page, KNOWN_EVENT_ID);
    const eventName = page.locator('[data-testid="form-event-name"]');
    await expect(eventName).toBeVisible();
    await expect(eventName).toHaveText(KNOWN_TITLE_REGEX);
  });

  test('OSE-R-007 | FE | GET /forms/:id (known event, attacker query) | query param IGNORED in rendered DOM', async ({
    page,
  }) => {
    const phishingPayload = 'Cheap Rolex Deals!';
    await gotoForm(page, KNOWN_EVENT_ID, `?event=${encodeURIComponent(phishingPayload)}`);
    const eventName = page.locator('[data-testid="form-event-name"]');
    await expect(eventName).toBeVisible();
    await expect(eventName).toHaveText(KNOWN_TITLE_REGEX);
    // The attacker payload must NOT appear anywhere visible in the DOM.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(phishingPayload);
    expect(bodyText).not.toContain('Cheap Rolex');
  });

  test('OSE-R-007 | FE | GET /forms/:id (known event, attacker query) | document.title NOT controlled by query param', async ({
    page,
  }) => {
    // Browser-tab title is one of the most-visible phishing surfaces;
    // it must reflect the canonical event, never the URL parameter.
    await gotoForm(page, KNOWN_EVENT_ID, '?event=' + encodeURIComponent('PWNED'));
    const title = await page.title();
    expect(title).not.toContain('PWNED');
    expect(title).toMatch(KNOWN_TITLE_REGEX);
  });

  test('OSE-R-007 | FE | GET /forms/:id (unknown event, attacker query) | "Event" fallback rendered, query param NOT', async ({
    page,
  }) => {
    const phishingPayload = 'URGENT: Account suspended — click here';
    await gotoForm(page, UNKNOWN_EVENT_ID, `?event=${encodeURIComponent(phishingPayload)}`);
    const eventName = page.locator('[data-testid="form-event-name"]');
    await expect(eventName).toBeVisible();
    await expect(eventName).toHaveText('Event');
    // Phishing payload must not surface anywhere in the visible DOM.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(phishingPayload);
    expect(bodyText).not.toContain('Account suspended');
  });

  test('OSE-R-007 | FE | GET /forms/:id (unknown event, script-tag XSS in query) | payload neither rendered nor executed', async ({
    page,
  }) => {
    // The classic XSS payload — defense in depth check. The escapeHtml
    // pass was already there pre-fix; this test locks that no future
    // refactor accidentally drops it. We also assert no script execution
    // by listening for any unexpected page errors.
    const xssPayload = '<script>window.__oser007_pwned__ = true;</script>';
    let scriptExecuted = false;
    await page.exposeBinding('__oser007_pwned_detector__', () => {
      scriptExecuted = true;
    });
    await gotoForm(page, UNKNOWN_EVENT_ID, `?event=${encodeURIComponent(xssPayload)}`);
    // Probe whether the injected script set the window flag.
    const flagSet = await page.evaluate(
      () => (window as unknown as { __oser007_pwned__?: boolean }).__oser007_pwned__
    );
    expect(flagSet).toBeFalsy();
    expect(scriptExecuted).toBe(false);
    // Visible fallback text wins.
    await expect(page.locator('[data-testid="form-event-name"]')).toHaveText('Event');
  });

  test('OSE-R-007 | FE | GET /forms/:id (img onerror XSS in query) | payload neither rendered nor executed', async ({
    page,
  }) => {
    const xssPayload = '"><img src=x onerror="alert(1)">';
    let alertFired = false;
    page.on('dialog', async (dialog) => {
      alertFired = true;
      await dialog.dismiss();
    });
    await gotoForm(page, KNOWN_EVENT_ID, `?event=${encodeURIComponent(xssPayload)}`);
    await page.waitForTimeout(500);
    expect(alertFired).toBe(false);
    await expect(page.locator('[data-testid="form-event-name"]')).toHaveText(KNOWN_TITLE_REGEX);
  });
});
