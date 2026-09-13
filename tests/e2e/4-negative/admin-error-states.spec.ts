import { test, expect } from '@playwright/test';
import { revealAdminDashboard } from '../helpers/reveal-admin-dashboard';

test.describe('Admin Error States', () => {
  test.describe('Events API Failure', () => {
    test('should show error card when events API returns 500', async ({ page }) => {
      await page.route('**/api/v2/admin/events', (route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      });

      await page.goto('/admin');
      await revealAdminDashboard(page);

      const errorCard = page.locator('[data-testid="events-error"]');
      await expect(errorCard).toBeVisible({ timeout: 10000 });
    });

    test('should display a retry button in the error card', async ({ page }) => {
      await page.route('**/api/v2/admin/events', (route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      });

      await page.goto('/admin');
      await revealAdminDashboard(page);

      const retryButton = page.locator('[data-testid="events-retry"]');
      await expect(retryButton).toBeVisible({ timeout: 10000 });
    });

    test('should retry loading events when retry button is clicked', async ({ page }) => {
      let callCount = 0;

      await page.route('**/api/v2/admin/events', (route) => {
        callCount++;
        if (callCount === 1) {
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal Server Error' }),
          });
        } else {
          // Second call succeeds with empty array to clear error
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          });
        }
      });

      await page.goto('/admin');
      await revealAdminDashboard(page);

      const retryButton = page.locator('[data-testid="events-retry"]');
      await expect(retryButton).toBeVisible({ timeout: 10000 });

      await retryButton.click();

      // After retry with success response, error card should disappear
      await expect(page.locator('[data-testid="events-error"]')).not.toBeVisible({
        timeout: 10000,
      });
    });
  });

  test.describe('Empty Events State', () => {
    test('should show "No events found" when API returns empty array', async ({ page }) => {
      await page.route('**/api/v2/admin/events', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      });

      await page.goto('/admin');
      await revealAdminDashboard(page);

      await expect(page.getByText(/no events found/i)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Authentication Errors', () => {
    test('should return 401 when accessing admin without auth headers', async ({ browser }) => {
      // Create a new context WITHOUT the extraHTTPHeaders from config
      const unauthContext = await browser.newContext();
      const unauthPage = await unauthContext.newPage();

      const response = await unauthPage.goto('/admin');
      expect(response?.status()).toBe(401);

      await unauthContext.close();
    });

    test('should not display events table without authentication', async ({ browser }) => {
      const unauthContext = await browser.newContext();
      const unauthPage = await unauthContext.newPage();

      await unauthPage.goto('/admin');

      const eventsTable = unauthPage.locator('[data-testid="events-table"]');
      await expect(eventsTable).not.toBeVisible({ timeout: 5000 });

      await unauthContext.close();
    });
  });

  test.describe('Forms API Failure After Event Selection', () => {
    test('should show forms error state when forms APIs fail', async ({ page }) => {
      // The Worker loads forms data from multiple endpoints in parallel:
      //   /forms/registrations, /forms/checkin-count, /forms/surveys, /forms/email-signups
      //   /flags/resolve?eventId=...
      // Intercept all of them to simulate a full forms failure
      await page.route('**/api/v2/admin/events/*/forms/**', (route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Forms service unavailable' }),
        });
      });
      await page.route('**/api/v2/admin/flags/resolve**', (route) => {
        route.abort('failed');
      });

      await page.goto('/admin');
      await revealAdminDashboard(page);

      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('[data-testid^="event-row-"]').first();
      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available to test forms error state');

      await firstRow.click();

      // Forms panel should show error card with retry button
      const formsError = page.locator('[data-testid="forms-error"]');
      await expect(formsError).toBeVisible({ timeout: 15000 });
    });

    test('forms error state should include a retry button', async ({ page }) => {
      await page.route('**/api/v2/admin/events/*/forms/**', (route) => {
        route.abort('failed');
      });
      await page.route('**/api/v2/admin/flags/resolve**', (route) => {
        route.abort('failed');
      });

      await page.goto('/admin');
      await revealAdminDashboard(page);
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });

      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available');

      await page.locator('[data-testid^="event-row-"]').first().click();

      const formsRetry = page.locator('[data-testid="forms-retry"]');
      await expect(formsRetry).toBeVisible({ timeout: 15000 });
    });

    test('should handle network timeout on forms API gracefully', async ({ page }) => {
      await page.route('**/api/v2/admin/events/*/forms/**', (route) => {
        route.abort('timedout');
      });
      await page.route('**/api/v2/admin/flags/resolve**', (route) => {
        route.abort('timedout');
      });

      await page.goto('/admin');
      await revealAdminDashboard(page);

      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });

      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available to test timeout handling');

      await page.locator('[data-testid^="event-row-"]').first().click();

      // Should show error state rather than hanging
      const formsError = page.locator('[data-testid="forms-error"]');
      await expect(formsError).toBeVisible({ timeout: 15000 });
    });
  });
});
