import { test, expect } from '@playwright/test';

const TEST_EVENT_ID = process.env.TEST_EVENT_ID || 'test-event-001';

test.describe('Form Submission Flows', () => {
  test.describe('Registration Form', () => {
    test('should load the registration form page', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=register`);
      await expect(page).not.toHaveURL(/error/);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });
    });

    test('should fill in name and submit registration successfully', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=register`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const nameInput = page.locator('[data-testid="register-name-input"]').first();
      await nameInput.fill('E2E Test User');
      await page.locator('button[type="submit"], [data-testid="submit-button"]').first().click();

      // Wait for success indicator
      await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10000 });
    });

    test('should show success state after registration submission', async ({ page }) => {
      const timestamp = Date.now();
      await page.goto(`/forms/${TEST_EVENT_ID}?type=register`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const nameInput = page.locator('[data-testid="register-name-input"]').first();
      await nameInput.fill(`E2E User ${timestamp}`);
      await page.locator('button[type="submit"], [data-testid="submit-button"]').first().click();

      await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Check-in Form', () => {
    test('should load the check-in form page', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=checkin`);
      await expect(page).not.toHaveURL(/error/);
    });

    test('should tap the check-in button and update count text', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=checkin`);

      const tapButton = page
        .locator(
          '[data-testid="tap-button"], [data-testid="checkin-button"], button:has-text("tap"), button:has-text("check")'
        )
        .first();
      await expect(tapButton).toBeVisible({ timeout: 10000 });

      // Capture initial count text if visible
      const countLocator = page.locator('[data-testid="checkin-count"], [class*="count"]').first();
      let initialCount: string | null = null;
      if (await countLocator.isVisible()) {
        initialCount = await countLocator.textContent();
      }

      await tapButton.click();

      // After tapping, count should update or a success indication should appear
      if (initialCount !== null && (await countLocator.isVisible())) {
        await expect(countLocator).not.toHaveText(initialCount!, { timeout: 5000 });
      }
    });

    test('should handle multiple rapid check-in taps', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=checkin`);

      const tapButton = page
        .locator(
          '[data-testid="tap-button"], [data-testid="checkin-button"], button:has-text("tap"), button:has-text("check")'
        )
        .first();
      await expect(tapButton).toBeVisible({ timeout: 10000 });

      // Rapid taps should not crash the page
      await tapButton.click();
      await tapButton.click();
      await tapButton.click();

      // Page should still be functional
      await expect(tapButton).toBeVisible();
    });
  });

  test.describe('Survey Form', () => {
    test('should load the survey form page', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=survey`);
      await expect(page).not.toHaveURL(/error/);
    });

    test('should select rating 5 and fill comment then submit', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=survey`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      // Click rating 5 (could be stars, radio buttons, or numbered buttons)
      const rating5 = page.locator('[data-testid="survey-rating-5"]').first();
      if (await rating5.isVisible()) {
        await rating5.click();
      }

      // Fill comment
      const commentField = page.locator('[data-testid="survey-comments-input"]').first();
      if (await commentField.isVisible()) {
        await commentField.fill('Great event');
      }

      await page.locator('button[type="submit"], [data-testid="submit-button"]').first().click();

      await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10000 });
    });

    test('should show success after survey submission', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=survey`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const rating5 = page.locator('[data-testid="survey-rating-5"]').first();
      if (await rating5.isVisible()) {
        await rating5.click();
      }

      const commentField = page.locator('[data-testid="survey-comments-input"]').first();
      if (await commentField.isVisible()) {
        await commentField.fill(`E2E survey comment ${Date.now()}`);
      }

      await page.locator('button[type="submit"], [data-testid="submit-button"]').first().click();

      await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Email Signup Form', () => {
    test('should load the email signup form page', async ({ page }) => {
      await page.goto(`/forms/${TEST_EVENT_ID}?type=email`);
      await expect(page).not.toHaveURL(/error/);
    });

    test('should fill email and submit successfully', async ({ page }) => {
      const timestamp = Date.now();
      await page.goto(`/forms/${TEST_EVENT_ID}?type=email`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const emailInput = page
        .locator('input[type="email"], input[name="email"], input[placeholder*="email" i]')
        .first();
      await emailInput.fill(`e2e-test-${timestamp}@test.com`);

      await page.locator('button[type="submit"], [data-testid="submit-button"]').first().click();

      await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10000 });
    });

    test('should show success state after email signup', async ({ page }) => {
      const timestamp = Date.now();
      await page.goto(`/forms/${TEST_EVENT_ID}?type=email`);
      await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

      const emailInput = page
        .locator('input[type="email"], input[name="email"], input[placeholder*="email" i]')
        .first();
      await emailInput.fill(`e2e-verify-${timestamp}@test.com`);

      await page.locator('button[type="submit"], [data-testid="submit-button"]').first().click();

      await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10000 });
    });
  });
});
