/**
 * E2E Negative Tests: Landing — Subscribe Validation + Error States
 *
 * Covers every subscribe form error path:
 *   - Empty email → custom validity
 *   - Invalid email format → custom validity
 *   - API 400 → error message
 *   - API 429 rate limit → error message
 *   - Network failure → fallback error
 *   - XSS in email → safely handled
 *   - Console errors across all states
 *
 * Source: workers/oursharedevents/src/handlers/pages.ts (LANDING_HTML)
 * Subscribe API: POST /subscribe → validated by handleSubscribe() in pages.ts
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 20_000;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CLIENT-SIDE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Negative — Client Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });
  });

  test('empty submit does not fire API call', async ({ page }) => {
    let apiCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/subscribe') && req.method() === 'POST') apiCalled = true;
    });

    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(apiCalled).toBe(false);
  });

  test('whitespace-only email does not fire API call', async ({ page }) => {
    let apiCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/subscribe') && req.method() === 'POST') apiCalled = true;
    });

    await page.locator('[data-testid="subscribe-email"]').fill('   ');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(apiCalled).toBe(false);
  });

  test('invalid email format does not fire API call', async ({ page }) => {
    let apiCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/subscribe') && req.method() === 'POST') apiCalled = true;
    });

    await page.locator('[data-testid="subscribe-email"]').fill('not-an-email');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(apiCalled).toBe(false);
  });

  test('email missing @ does not fire API call', async ({ page }) => {
    let apiCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/subscribe') && req.method() === 'POST') apiCalled = true;
    });

    await page.locator('[data-testid="subscribe-email"]').fill('userexample.com');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(apiCalled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. API ERROR RESPONSES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Negative — API Errors', () => {
  test('400 invalid email → error message shown', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Please enter a valid email address.' }),
      })
    );
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="subscribe-email"]').fill('valid-looking@test.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    const msg = page.locator('#form-message');
    await expect(msg).toContainText('valid email', { timeout: 5000 });
    const classes = await msg.getAttribute('class');
    expect(classes).toContain('error');
  });

  test('429 rate limit → error message shown', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Too many requests. Please try again later.',
        }),
      })
    );
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="subscribe-email"]').fill('rate@limit.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    await expect(page.locator('#form-message')).toContainText('Too many', { timeout: 5000 });
  });

  test('413 payload too large → error message', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Payload too large.' }),
      })
    );
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="subscribe-email"]').fill('big@payload.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    await expect(page.locator('#form-message')).toContainText('large', { timeout: 5000 });
  });

  test('500 server error → fallback message', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({ status: 500, body: 'Internal Error' })
    );
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="subscribe-email"]').fill('server@error.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    await expect(page.locator('#form-message')).toContainText('wrong', { timeout: 5000 });
  });

  test('network failure → fallback message', async ({ page }) => {
    await page.route('**/subscribe', (route) => route.abort('failed'));
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="subscribe-email"]').fill('network@fail.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    await expect(page.locator('#form-message')).toContainText('wrong', { timeout: 5000 });
  });

  test('button re-enables after error', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Invalid.' }),
      })
    );
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="subscribe-email"]').fill('retry@test.com');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    await expect(page.locator('[data-testid="subscribe-submit"]')).toBeEnabled();
    await expect(page.locator('[data-testid="subscribe-submit"]')).toContainText(
      'Stay in the Loop'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. XSS RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Negative — XSS', () => {
  test('XSS in error message is not rendered as HTML', async ({ page }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: '<script>alert(1)</script>Error' }),
      })
    );
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="subscribe-email"]').fill('xss@test.com');
    await page.locator('[data-testid="subscribe-submit"]').click();

    const msg = page.locator('#form-message');
    await expect(msg).toBeVisible({ timeout: 5000 });
    // textContent is set via .textContent (not innerHTML), so XSS is safe
    const html = await msg.innerHTML();
    expect(html).not.toContain('<script>');
  });

  test('no JS errors with XSS payload in email', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page
      .locator('[data-testid="subscribe-email"]')
      .fill('"><script>alert(1)</script>@test.com');
    // This won't pass client validation, but should not crash
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CONSOLE ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Negative — Console Errors', () => {
  test('no JS errors on normal load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });

  test('no JS errors during form interaction', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    );
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="subscribe-email"]').fill('noerror@test.com');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(errors).toHaveLength(0);
  });
});
