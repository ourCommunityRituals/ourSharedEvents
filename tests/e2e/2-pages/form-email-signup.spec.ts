/**
 * PAGE TESTS - Level 2: Email Signup Form Page
 *
 * Purpose: Test the public email signup form at /forms/{eventId}?type=email
 * Coverage: Email input, submission, success/duplicate states, error handling
 *
 * Public page - no authentication required.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
const TEST_EVENT_ID = process.env.TEST_EVENT_ID || 'test-event-001';
const FORM_URL = `${BASE_URL}/forms/${TEST_EVENT_ID}?type=email`;

test.describe('Email Signup Form - Page Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('page loads with email form container', async ({ page }) => {
    const container = page.locator('[data-testid="form-email"]');
    await expect(container).toBeVisible();
  });

  test('email form element is present', async ({ page }) => {
    const form = page.locator('[data-testid="email-form"]');
    await expect(form).toBeVisible();
  });

  test('email input is present and required', async ({ page }) => {
    const emailInput = page.locator('[data-testid="email-email-input"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('required', '');
  });

  test('email input has email type and maxlength 320', async ({ page }) => {
    const emailInput = page.locator('[data-testid="email-email-input"]');
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveAttribute('maxlength', '320');
  });

  test('submit button is visible', async ({ page }) => {
    const submit = page.locator('[data-testid="email-submit"]');
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

test.describe('Email Signup Form - Submission', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('valid email submission shows success message', async ({ page }) => {
    const emailInput = page.locator('[data-testid="email-email-input"]');
    const uniqueEmail = `test-${Date.now()}@example.com`;
    await emailInput.fill(uniqueEmail);

    const submit = page.locator('[data-testid="email-submit"]');
    await submit.click();

    const success = page.locator('[data-testid="form-success"]');
    await expect(success).toBeVisible({ timeout: 10000 });

    const successText = await success.textContent();
    expect(successText).toMatch(/you.re on the list/i);
  });

  test('duplicate email shows already-signed-up message', async ({ page }) => {
    const duplicateEmail = 'duplicate-test@example.com';

    // First submission
    const emailInput = page.locator('[data-testid="email-email-input"]');
    await emailInput.fill(duplicateEmail);
    const submit = page.locator('[data-testid="email-submit"]');
    await submit.click();

    const success = page.locator('[data-testid="form-success"]');
    await expect(success).toBeVisible({ timeout: 10000 });

    // Navigate back and submit same email again
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const emailInput2 = page.locator('[data-testid="email-email-input"]');
    await emailInput2.fill(duplicateEmail);
    const submit2 = page.locator('[data-testid="email-submit"]');
    await submit2.click();

    const success2 = page.locator('[data-testid="form-success"]');
    await expect(success2).toBeVisible({ timeout: 10000 });

    const successText = await success2.textContent();
    expect(successText).toMatch(/already signed up/i);
  });

  test('API call is made to correct endpoint', async ({ page }) => {
    const apiPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/v2/events/${TEST_EVENT_ID}/forms/email-signup`) &&
        req.method() === 'POST'
    );

    const emailInput = page.locator('[data-testid="email-email-input"]');
    await emailInput.fill('api-check@example.com');

    const submit = page.locator('[data-testid="email-submit"]');
    await submit.click();

    const request = await apiPromise;
    expect(request.method()).toBe('POST');
  });

  test('empty email prevents submission (browser validation)', async ({ page }) => {
    const submit = page.locator('[data-testid="email-submit"]');
    await submit.click();

    // Success should NOT appear because email is required
    const success = page.locator('[data-testid="form-success"]');
    await expect(success).not.toBeVisible({ timeout: 2000 });
  });
});
