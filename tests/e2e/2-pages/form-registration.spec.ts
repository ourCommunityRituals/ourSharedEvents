/**
 * PAGE TESTS - Level 2: Registration Form Page
 *
 * Purpose: Test the public registration form at /forms/{eventId}?type=register
 * Coverage: Form structure, input validation, submission, success/error states
 *
 * Public page - no authentication required.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
const TEST_EVENT_ID = process.env.TEST_EVENT_ID || 'test-event-001';
const FORM_URL = `${BASE_URL}/forms/${TEST_EVENT_ID}?type=register`;

test.describe('Registration Form - Page Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('page loads with form header', async ({ page }) => {
    const header = page.locator('[data-testid="form-header"]');
    await expect(header).toBeVisible();
  });

  test('form header displays event name', async ({ page }) => {
    const eventName = page.locator('[data-testid="form-event-name"]');
    await expect(eventName).toBeVisible();
    const text = await eventName.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('registration form element is present', async ({ page }) => {
    const form = page.locator('[data-testid="register-form"]');
    await expect(form).toBeVisible();
  });

  test('name input is present and required', async ({ page }) => {
    const nameInput = page.locator('[data-testid="register-name-input"]');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveAttribute('required', '');
  });

  test('name input is a text field with maxlength 200', async ({ page }) => {
    const nameInput = page.locator('[data-testid="register-name-input"]');
    await expect(nameInput).toHaveAttribute('type', 'text');
    await expect(nameInput).toHaveAttribute('maxlength', '200');
  });

  test('email input is present and optional', async ({ page }) => {
    const emailInput = page.locator('[data-testid="register-email-input"]');
    await expect(emailInput).toBeVisible();
    // Email should NOT have required attribute (it is optional)
    const required = await emailInput.getAttribute('required');
    expect(required).toBeNull();
  });

  test('email input has email type and maxlength 320', async ({ page }) => {
    const emailInput = page.locator('[data-testid="register-email-input"]');
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveAttribute('maxlength', '320');
  });

  test('submit button is visible and enabled', async ({ page }) => {
    const submit = page.locator('[data-testid="register-submit"]');
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
  });

  test('privacy notice is visible', async ({ page }) => {
    const notice = page.locator('[data-testid="privacy-notice"]');
    await expect(notice).toBeVisible();
    const text = await notice.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});

test.describe('Registration Form - Submission', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('submit with name only shows success', async ({ page }) => {
    const nameInput = page.locator('[data-testid="register-name-input"]');
    await nameInput.fill('Test User');

    const submit = page.locator('[data-testid="register-submit"]');
    await submit.click();

    const success = page.locator('[data-testid="form-success"]');
    await expect(success).toBeVisible({ timeout: 10000 });
  });

  test('submit with name and email shows success', async ({ page }) => {
    const nameInput = page.locator('[data-testid="register-name-input"]');
    await nameInput.fill('Test User');

    const emailInput = page.locator('[data-testid="register-email-input"]');
    await emailInput.fill('test@example.com');

    const submit = page.locator('[data-testid="register-submit"]');
    await submit.click();

    const success = page.locator('[data-testid="form-success"]');
    await expect(success).toBeVisible({ timeout: 10000 });
  });

  test('success state shows checkmark', async ({ page }) => {
    const nameInput = page.locator('[data-testid="register-name-input"]');
    await nameInput.fill('Checkmark Test');

    const submit = page.locator('[data-testid="register-submit"]');
    await submit.click();

    const success = page.locator('[data-testid="form-success"]');
    await expect(success).toBeVisible({ timeout: 10000 });

    // Success should contain a checkmark (SVG, icon, or text character)
    const html = await success.innerHTML();
    const hasCheckmark =
      html.includes('checkmark') ||
      html.includes('check') ||
      html.includes('\u2713') ||
      html.includes('\u2714') ||
      html.includes('svg');
    expect(hasCheckmark).toBe(true);
  });

  test('API call is made to correct endpoint on submit', async ({ page }) => {
    const apiPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/v2/events/${TEST_EVENT_ID}/forms/register`) &&
        req.method() === 'POST'
    );

    const nameInput = page.locator('[data-testid="register-name-input"]');
    await nameInput.fill('API Test User');

    const emailInput = page.locator('[data-testid="register-email-input"]');
    await emailInput.fill('api@test.com');

    const submit = page.locator('[data-testid="register-submit"]');
    await submit.click();

    const request = await apiPromise;
    const body = request.postDataJSON();
    expect(body).toHaveProperty('name', 'API Test User');
    expect(body).toHaveProperty('email', 'api@test.com');
  });

  test('empty name prevents submission (browser validation)', async ({ page }) => {
    // Do not fill name, just click submit
    const submit = page.locator('[data-testid="register-submit"]');
    await submit.click();

    // Success should NOT appear because name is required
    const success = page.locator('[data-testid="form-success"]');
    await expect(success).not.toBeVisible({ timeout: 2000 });
  });
});
