/**
 * OSE-R-002 — Playwright FE for friendly form-error copy.
 *
 * Layer: FE (real browser submits a form, intercepts the API response,
 * and verifies the rendered error copy is friendly — not a dev code).
 *
 * Companion to:
 *   - workers/oursharedevents/tests/form-error-friendly-copy.spec.ts (vitest API)
 *   - bruno/ose-api
 *
 * Tests share names byte-for-byte across runners where the scenario maps;
 * differ only by the API/FE qualifier where the layer differs.
 *
 * The audit (REFINEMENT-BACKLOG-2026-05-15.md R-002) found that
 * `errEl.textContent = err.message` piped raw server codes like
 * `INVALID_BODY`, `PAYLOAD_TOO_LARGE`, and `FORMS_ENCRYPTION_KEY not
 * configured` directly to bar attendees on their phones in noisy venues.
 *
 * This spec uses Playwright's route interception to mock the server
 * response (so we don't need a real broken event), then verifies that
 * the rendered DOM error message is the friendly copy (not the code)
 * and that the raw code is preserved on the data-error-code attribute
 * for support visibility.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';
const TEST_EVENT_ID = 'evt_test_2026';

// Convenience: load a form page in the browser, then intercept the
// submit POST so we control the server response shape.
async function loadRegisterFormWithMockedResponse(
  page: Page,
  responseShape: { status: number; body: Record<string, unknown> }
): Promise<void> {
  await page.route(`**/api/v2/events/${TEST_EVENT_ID}/forms/register`, async (route) => {
    await route.fulfill({
      status: responseShape.status,
      contentType: 'application/json',
      body: JSON.stringify(responseShape.body),
    });
  });
  await page.goto(`${BASE_URL}/forms/${TEST_EVENT_ID}?type=register`, {
    waitUntil: 'domcontentloaded',
  });
}

// Fill the form with valid data then submit. Most error responses come
// from server-side validation that runs regardless of client-side input —
// we just need to trigger a submit so the friendly-copy branch runs.
async function fillAndSubmitRegister(page: Page): Promise<void> {
  const nameInput = page.locator('input[name="name"], [data-testid*="name"]').first();
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill('Test Bar Customer');
  }
  const emailInput = page.locator('input[type="email"]').first();
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill('customer@example.com');
  }
  await page.locator('[data-testid$="-submit"]').first().click();
}

test.describe('OSE-R-002 — friendly form-error copy in browser', () => {
  test('OSE-R-002 | FE | POST /api/v2/events/:id/forms/register (server returns INVALID_BODY) | renders friendly "couldn\'t read your response" copy', async ({
    page,
  }) => {
    await loadRegisterFormWithMockedResponse(page, {
      status: 400,
      body: {
        ok: false,
        status: 400,
        code: 'INVALID_BODY',
        error: 'Request body must be valid JSON',
      },
    });
    await fillAndSubmitRegister(page);

    const errEl = page.locator('#error-msg');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    // Friendly copy is rendered
    expect(text).toMatch(/couldn't read your response|refresh the page/i);
    // Raw server string is NOT rendered to user
    expect(text).not.toMatch(/INVALID_BODY/);
    expect(text).not.toMatch(/Request body must be valid JSON/);
    // Raw code IS preserved for support via data-error-code attribute
    await expect(errEl).toHaveAttribute('data-error-code', 'INVALID_BODY');
  });

  test('OSE-R-002 | FE | POST /api/v2/events/:id/forms/register (server returns PAYLOAD_TOO_LARGE) | renders friendly "too long" copy', async ({
    page,
  }) => {
    await loadRegisterFormWithMockedResponse(page, {
      status: 413,
      body: {
        ok: false,
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        error: 'Body must be under 16KB',
      },
    });
    await fillAndSubmitRegister(page);

    const errEl = page.locator('#error-msg');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/too long|shorten/i);
    expect(text).not.toMatch(/PAYLOAD_TOO_LARGE/);
    expect(text).not.toMatch(/under 16KB/);
    await expect(errEl).toHaveAttribute('data-error-code', 'PAYLOAD_TOO_LARGE');
  });

  test('OSE-R-002 | FE | POST /api/v2/events/:id/forms/register (server returns MISSING_FIELD) | renders friendly "fill out required fields" copy', async ({
    page,
  }) => {
    await loadRegisterFormWithMockedResponse(page, {
      status: 400,
      body: {
        ok: false,
        status: 400,
        code: 'MISSING_FIELD',
        error: 'Missing required field: responses',
      },
    });
    await fillAndSubmitRegister(page);

    const errEl = page.locator('#error-msg');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/fill out all required fields/i);
    // Critical: the raw "Missing required field: responses" must NOT appear
    expect(text).not.toMatch(/Missing required field/);
    expect(text).not.toMatch(/responses/);
    await expect(errEl).toHaveAttribute('data-error-code', 'MISSING_FIELD');
  });

  test('OSE-R-002 | FE | POST /api/v2/events/:id/forms/register (server returns INVALID_EMAIL) | renders friendly "that email doesn\'t look right" copy', async ({
    page,
  }) => {
    await loadRegisterFormWithMockedResponse(page, {
      status: 400,
      body: { ok: false, status: 400, code: 'INVALID_EMAIL', error: 'Invalid email format' },
    });
    await fillAndSubmitRegister(page);

    const errEl = page.locator('#error-msg');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/email doesn't look right/i);
    expect(text).not.toMatch(/INVALID_EMAIL/);
    await expect(errEl).toHaveAttribute('data-error-code', 'INVALID_EMAIL');
  });

  test('OSE-R-002 | FE | POST /api/v2/events/:id/forms/register (server returns CONFIG_ERROR) | renders friendly "not set up on our side" copy', async ({
    page,
  }) => {
    // The most jargon-leaking pre-fix error: bar customer saw
    // "FORMS_ENCRYPTION_KEY not configured" — devops-internal string.
    await loadRegisterFormWithMockedResponse(page, {
      status: 503,
      body: {
        ok: false,
        status: 503,
        code: 'CONFIG_ERROR',
        error: 'FORMS_ENCRYPTION_KEY not configured',
      },
    });
    await fillAndSubmitRegister(page);

    const errEl = page.locator('#error-msg');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/not set up on our side|try again in a few minutes/i);
    // The actual dev string must NEVER appear
    expect(text).not.toMatch(/FORMS_ENCRYPTION_KEY/);
    expect(text).not.toMatch(/not configured/);
    await expect(errEl).toHaveAttribute('data-error-code', 'CONFIG_ERROR');
  });

  test('OSE-R-002 | FE | POST /api/v2/events/:id/forms/register (server returns unknown code) | renders generic friendly fallback', async ({
    page,
  }) => {
    // Defensive: if the server adds a new error code we haven't mapped yet,
    // the customer still sees something readable.
    await loadRegisterFormWithMockedResponse(page, {
      status: 400,
      body: {
        ok: false,
        status: 400,
        code: 'BRAND_NEW_FUTURE_CODE',
        error: "Some new server-side state that hasn't been mapped",
      },
    });
    await fillAndSubmitRegister(page);

    const errEl = page.locator('#error-msg');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    // Generic fallback fires
    expect(text).toMatch(/something went wrong|try again/i);
    // Neither the raw code nor the raw error message reaches the user
    expect(text).not.toMatch(/BRAND_NEW_FUTURE_CODE/);
    expect(text).not.toMatch(/hasn't been mapped/);
    // But the code is preserved for support
    await expect(errEl).toHaveAttribute('data-error-code', 'BRAND_NEW_FUTURE_CODE');
  });

  test('OSE-R-002 | FE | POST /api/v2/events/:id/forms/register (network failure) | renders generic friendly fallback', async ({
    page,
  }) => {
    // Simulate a network failure (no server response at all).
    await page.route(`**/api/v2/events/${TEST_EVENT_ID}/forms/register`, async (route) => {
      await route.abort('failed');
    });
    await page.goto(`${BASE_URL}/forms/${TEST_EVENT_ID}?type=register`, {
      waitUntil: 'domcontentloaded',
    });
    await fillAndSubmitRegister(page);

    const errEl = page.locator('#error-msg');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/something went wrong|try again/i);
    // Network errors get a different support code than server errors
    await expect(errEl).toHaveAttribute('data-error-code', 'NETWORK_ERROR');
  });

  test('OSE-R-002 | FE | POST /api/v2/events/:id/forms/register (server returns non-JSON 502) | renders generic friendly fallback', async ({
    page,
  }) => {
    // Proxy / gateway returns HTML or text instead of JSON. Common in
    // real-world failure modes (CF 502, gateway timeout pages).
    await page.route(`**/api/v2/events/${TEST_EVENT_ID}/forms/register`, async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<html><body>Bad Gateway</body></html>',
      });
    });
    await page.goto(`${BASE_URL}/forms/${TEST_EVENT_ID}?type=register`, {
      waitUntil: 'domcontentloaded',
    });
    await fillAndSubmitRegister(page);

    const errEl = page.locator('#error-msg');
    await expect(errEl).toBeVisible();
    const text = (await errEl.textContent()) ?? '';
    expect(text).toMatch(/something went wrong|try again|trouble right now/i);
    // The HTML gateway response must NOT reach the user
    expect(text).not.toMatch(/Bad Gateway/);
    await expect(errEl).toHaveAttribute('data-error-code', 'NON_JSON_RESPONSE');
  });
});
