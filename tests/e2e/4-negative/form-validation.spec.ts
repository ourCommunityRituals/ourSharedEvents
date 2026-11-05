import { test, expect } from '@playwright/test';

const TEST_EVENT_ID = process.env.TEST_EVENT_ID || 'test-event-001';

test.describe('Form Validation', () => {
  test.describe('Registration Form Validation', () => {
    test('should not submit with empty name field', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=register`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const submitButton = page
        .locator('button[type="submit"], [data-testid="submit-button"]')
        .first();
      await submitButton.click();

      // Form should not navigate away or show success — required field blocks submission
      await expect(page.locator('[data-testid="form-success"]')).not.toBeVisible({ timeout: 3000 });
    });

    test('should keep the form visible after attempting empty submission', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=register`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const submitButton = page
        .locator('button[type="submit"], [data-testid="submit-button"]')
        .first();
      await submitButton.click();

      // Form should still be visible (not replaced by success)
      await expect(page.locator('form')).toBeVisible();
    });

    test('should have maxlength=200 on name input', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=register`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const nameInput = page.locator('[data-testid="register-name-input"]').first();
      const maxlength = await nameInput.getAttribute('maxlength');
      expect(maxlength).toBe('200');
    });

    test('should enforce required attribute on name input', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=register`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const nameInput = page.locator('[data-testid="register-name-input"]').first();
      const required = await nameInput.getAttribute('required');
      // required attribute can be "" (empty string) or "required" when present
      expect(required).not.toBeNull();
    });
  });

  test.describe('Email Signup Form Validation', () => {
    test('should not submit with empty email field', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=email`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const submitButton = page
        .locator('button[type="submit"], [data-testid="submit-button"]')
        .first();
      await submitButton.click();

      await expect(page.locator('[data-testid="form-success"]')).not.toBeVisible({ timeout: 3000 });
    });

    test('should have type="email" on email input for browser validation', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=email`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const emailInput = page
        .locator('input[type="email"], input[name="email"], input[placeholder*="email" i]')
        .first();
      const inputType = await emailInput.getAttribute('type');
      expect(inputType).toBe('email');
    });

    test('should enforce required attribute on email input', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=email`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const emailInput = page
        .locator('input[type="email"], input[name="email"], input[placeholder*="email" i]')
        .first();
      const required = await emailInput.getAttribute('required');
      expect(required).not.toBeNull();
    });

    test('should keep form visible after invalid email submission attempt', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=email`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const emailInput = page
        .locator('input[type="email"], input[name="email"], input[placeholder*="email" i]')
        .first();
      // Type an invalid email — browser validation should block submission
      await emailInput.fill('not-an-email');

      const submitButton = page
        .locator('button[type="submit"], [data-testid="submit-button"]')
        .first();
      await submitButton.click();

      // Form should still be visible — browser validation blocks
      await expect(page.locator('form')).toBeVisible();
      await expect(page.locator('[data-testid="form-success"]')).not.toBeVisible({ timeout: 3000 });
    });
  });

  test.describe('Survey Form Validation', () => {
    test('should have maxlength=1000 on comments textarea', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=survey`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const commentField = page.locator('[data-testid="survey-comments-input"]').first();

      if (await commentField.isVisible()) {
        const maxlength = await commentField.getAttribute('maxlength');
        expect(maxlength).toBe('1000');
      }
    });

    test('should render the survey form with a rating selector', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=survey`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      // At least one rating option should exist
      const ratingElements = page.locator('[data-testid^="survey-rating-"]');
      const count = await ratingElements.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Check-in Form Validation', () => {
    test('should have a large tap target button (at least 100px)', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=checkin`);

      const tapButton = page.locator('[data-testid="checkin-submit"]').first();
      await expect(tapButton).toBeVisible({ timeout: 10000 });

      const box = await tapButton.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(100);
      expect(box!.height).toBeGreaterThanOrEqual(100);
    });
  });

  test.describe('Bogus Event ID Handling', () => {
    test('should still load form page with a bogus event ID', async ({ page }) => {
      const response = await page.goto(`/forms/nonexistent-event-999?type=register`);
      // Page should load (not crash) — may show error on submit or inline
      expect(response?.status()).toBeLessThan(500);
    });

    test('should show error or empty state when submitting with bogus event ID', async ({
      page,
    }) => {
      await page.goto(`/forms/nonexistent-event-999?type=register`);

      // If a form renders, try to submit and expect an error
      const form = page.locator('form');
      if (await form.isVisible({ timeout: 5000 }).catch(() => false)) {
        const nameInput = page.locator('[data-testid="register-name-input"]').first();
        if (await nameInput.isVisible()) {
          await nameInput.fill('Bogus Test');
        }
        await page.locator('button[type="submit"], [data-testid="submit-button"]').first().click();

        // Should show some kind of error, not a success
        const successVisible = await page
          .locator('[data-testid="form-success"]')
          .isVisible({ timeout: 5000 })
          .catch(() => false);

        // Either success is not shown, or an error message appears
        const errorVisible = await page
          .locator('[data-testid="form-error"]')
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        expect(successVisible === false || errorVisible === true).toBeTruthy();
      }
    });
  });

  test.describe('Disabled Form Handling', () => {
    test('should show form disabled error when submission returns 403 FORM_DISABLED', async ({
      page,
    }) => {
      // Intercept form submission to return 403 FORM_DISABLED, in the shape the
      // router sends when a form type is off for the event (router.ts, forms flag check).
      await page.route('**/api/**', (route) => {
        const request = route.request();
        if (request.method() === 'POST' && request.url().includes('/forms/')) {
          route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: false,
              status: 403,
              code: 'FORM_DISABLED',
              error: 'register is not enabled for this event',
            }),
          });
        } else {
          route.continue();
        }
      });

      await page.goto(`/forms/${TEST_EVENT_ID}?type=register`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const nameInput = page.locator('[data-testid="register-name-input"]').first();
      await nameInput.fill('Disabled Form Test');

      await page.locator('button[type="submit"], [data-testid="submit-button"]').first().click();

      // Wait for the refusal to render. isVisible() does not wait, so it raced
      // the response; toBeVisible() retries until the error shows.
      const formError = page.locator('[data-testid="form-error"]');
      await expect(formError).toBeVisible({ timeout: 5000 });
      await expect(formError).toHaveAttribute('data-error-code', 'FORM_DISABLED');

      // Checked after the response has landed, so it is not vacuous.
      await expect(page.locator('[data-testid="form-success"]')).toHaveCount(0);
    });
  });
});
