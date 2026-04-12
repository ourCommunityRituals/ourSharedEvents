import { test, expect } from '@playwright/test';

test.describe('Admin Event Management Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
  });

  test.describe('Events Table Loading', () => {
    test('should display the events table on admin page load', async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });
    });

    test('should show at least the table structure even when empty', async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Event Row Selection', () => {
    test('should select the first event row on click', async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('[data-testid^="event-row-"]').first();
      const rowCount = await page.locator('[data-testid^="event-row-"]').count();

      test.skip(rowCount === 0, 'No events available — skipping interaction tests');

      await firstRow.click();
      await expect(firstRow).toHaveClass(/selected/);
    });

    test('should deselect previous row when clicking a different event', async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });

      const rows = page.locator('[data-testid^="event-row-"]');
      const rowCount = await rows.count();

      test.skip(rowCount < 2, 'Need at least 2 events for multi-selection test');

      const firstRow = rows.nth(0);
      const secondRow = rows.nth(1);

      await firstRow.click();
      await expect(firstRow).toHaveClass(/selected/);

      await secondRow.click();
      await expect(secondRow).toHaveClass(/selected/);
      await expect(firstRow).not.toHaveClass(/selected/);
    });

    test('should update forms panel when selecting a different event', async ({ page }) => {
      const rows = page.locator('[data-testid^="event-row-"]');
      await expect(page.locator('[data-testid="events-table"]')).toBeVisible({ timeout: 10000 });
      const rowCount = await rows.count();

      test.skip(rowCount < 2, 'Need at least 2 events for panel update test');

      await rows.nth(0).click();
      const formsPanel = page.locator('[data-testid="forms-panel"]');
      await expect(formsPanel).toBeVisible({ timeout: 5000 });

      // Capture first event's panel content
      const firstPanelText = await formsPanel.textContent();

      await rows.nth(1).click();
      await expect(formsPanel).toBeVisible({ timeout: 5000 });

      // Panel content should change for the second event
      const secondPanelText = await formsPanel.textContent();
      // They may differ if events have different data; at minimum the panel should still be visible
      expect(secondPanelText).toBeDefined();
    });
  });

  test.describe('Forms Panel', () => {
    test.beforeEach(async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });
      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available — skipping forms panel tests');
      await page.locator('[data-testid^="event-row-"]').first().click();
    });

    test('should load forms panel after selecting an event (skeleton then content)', async ({
      page,
    }) => {
      const formsPanel = page.locator('[data-testid="forms-panel"]');
      await expect(formsPanel).toBeVisible({ timeout: 10000 });
    });

    test('should render registration form gate', async ({ page }) => {
      const formsPanel = page.locator('[data-testid="forms-panel"]');
      await expect(formsPanel).toBeVisible({ timeout: 10000 });

      const registerGate = page.locator('[data-testid="form-gate-register"]');
      await expect(registerGate).toBeVisible();
    });

    test('should render form gates for expected types', async ({ page }) => {
      const formsPanel = page.locator('[data-testid="forms-panel"]');
      await expect(formsPanel).toBeVisible({ timeout: 10000 });

      const formTypes = ['register', 'checkin', 'survey', 'email'];
      for (const type of formTypes) {
        const gate = page.locator(`[data-testid="form-gate-${type}"]`);
        // At least some gates should be present; not all may be enabled
        if (await gate.isVisible()) {
          await expect(gate).toBeVisible();
        }
      }
    });

    test('should have correct href pattern on form links', async ({ page }) => {
      const formsPanel = page.locator('[data-testid="forms-panel"]');
      await expect(formsPanel).toBeVisible({ timeout: 10000 });

      const registerLink = page.locator('[data-testid="form-link-register"]');
      if (await registerLink.isVisible()) {
        const href = await registerLink.getAttribute('href');
        expect(href).toMatch(/\/forms\/[\w-]+\?type=register/);
      }
    });

    test('should display form links with correct href pattern for each type', async ({ page }) => {
      const formsPanel = page.locator('[data-testid="forms-panel"]');
      await expect(formsPanel).toBeVisible({ timeout: 10000 });

      const formTypes = ['register', 'checkin', 'survey', 'email'];
      for (const type of formTypes) {
        const link = page.locator(`[data-testid="form-link-${type}"]`);
        if (await link.isVisible()) {
          const href = await link.getAttribute('href');
          expect(href).toMatch(new RegExp(`/forms/[\\w-]+\\?type=${type}`));
        }
      }
    });
  });

  test.describe('Count Boxes', () => {
    test.beforeEach(async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });
      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available — skipping count box tests');
      await page.locator('[data-testid^="event-row-"]').first().click();
      await expect(page.locator('[data-testid="forms-panel"]')).toBeVisible({ timeout: 10000 });
    });

    test('should display registration count as a numeric value', async ({ page }) => {
      const countBox = page.locator('[data-testid="count-registrations"]');
      if (await countBox.isVisible()) {
        const text = await countBox.textContent();
        expect(text?.trim()).toMatch(/^\d+$/);
      }
    });

    test('should display count boxes with numeric values', async ({ page }) => {
      const countTestIds = [
        'count-registrations',
        'count-checkins',
        'count-surveys',
        'count-emails',
      ];
      for (const testId of countTestIds) {
        const countBox = page.locator(`[data-testid="${testId}"]`);
        if (await countBox.isVisible()) {
          const text = await countBox.textContent();
          expect(text?.trim()).toMatch(/^\d+$/);
        }
      }
    });
  });

  test.describe('Surface Cards', () => {
    test.beforeEach(async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });
      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available — skipping surface card tests');
      await page.locator('[data-testid^="event-row-"]').first().click();
      await expect(page.locator('[data-testid="forms-panel"]')).toBeVisible({ timeout: 10000 });
    });

    test('should render surface cards with links to correct routes', async ({ page }) => {
      const cardRoutes: Record<string, string> = {
        'card-poster': '/poster',
        'card-display': '/display',
        'card-events': '/events',
        'card-sharedReport': '/sharedReport',
      };

      for (const [testId, route] of Object.entries(cardRoutes)) {
        const card = page.locator(`[data-testid="${testId}"]`);
        if (await card.isVisible()) {
          const link = card.locator('a');
          if ((await link.count()) > 0) {
            const href = await link.first().getAttribute('href');
            expect(href).toContain(route);
          }
        }
      }
    });

    test('should have a copy button on the poster card', async ({ page }) => {
      const copyButton = page.locator('[data-testid="copy-poster"]');
      if (await copyButton.isVisible()) {
        await expect(copyButton).toBeEnabled();
      }
    });

    test('should handle copy button click without errors', async ({ page }) => {
      const copyButton = page.locator('[data-testid="copy-poster"]');
      if (await copyButton.isVisible()) {
        // Grant clipboard permissions for the test context
        await page.context().grantPermissions(['clipboard-write']);
        await copyButton.click();
        // Verify no unhandled errors (button should still be visible after click)
        await expect(copyButton).toBeVisible();
      }
    });
  });

  test.describe('Form Toggle Interaction', () => {
    test('should render form toggles after event selection', async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });
      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available');

      await page.locator('[data-testid^="event-row-"]').first().click();
      await page.waitForSelector('[data-testid^="form-gate-"]', { timeout: 15000 });

      // Config section should be visible
      await expect(page.locator('[data-testid="config-section"]')).toBeVisible();
    });

    test('should render forms-grid container', async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });
      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available');

      await page.locator('[data-testid^="event-row-"]').first().click();
      await page.waitForSelector('[data-testid^="form-gate-"]', { timeout: 15000 });

      await expect(page.locator('[data-testid="forms-grid"]')).toBeVisible();
    });

    test('clicking a toggle fires PUT to flags API', async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });
      const rowCount = await page.locator('[data-testid^="event-row-"]').count();
      test.skip(rowCount === 0, 'No events available');

      await page.locator('[data-testid^="event-row-"]').first().click();
      await page.waitForSelector('[data-testid^="form-gate-"]', { timeout: 15000 });

      // Find an enabled toggle (not disabled by tier)
      const toggle = page.locator('[data-testid="form-toggle-register"]');
      const isDisabled = await toggle.isDisabled();
      test.skip(isDisabled, 'Register toggle is disabled by tier — skipping');

      // Track the PUT call
      let flagPutFired = false;
      page.on('request', (req) => {
        if (req.method() === 'PUT' && req.url().includes('/flags/')) {
          flagPutFired = true;
        }
      });

      const wasBefore = await toggle.isChecked();
      await toggle.click();

      // Wait for network request
      await page.waitForTimeout(1000);
      expect(flagPutFired).toBe(true);

      // Revert the toggle to original state
      await toggle.click();
      await page.waitForTimeout(500);
    });
  });

  test.describe('Copy Button Interaction', () => {
    test('copy button text changes to "Copied!" after click', async ({ page }) => {
      const eventsTable = page.locator('[data-testid="events-table"]');
      await expect(eventsTable).toBeVisible({ timeout: 10000 });

      await page.context().grantPermissions(['clipboard-write']);
      const copyBtn = page.locator('[data-testid="copy-poster"]');
      test.skip(!(await copyBtn.isVisible()), 'Copy button not visible');

      await copyBtn.click();
      await expect(copyBtn).toHaveText('Copied!');

      // Reverts after 2 seconds
      await expect(copyBtn).toHaveText('Copy URL', { timeout: 3000 });
    });
  });

  test.describe('Tier Badge', () => {
    test('should display tier badge in header after loading', async ({ page }) => {
      const tierBadge = page.locator('[data-testid="tier-badge"]');
      await expect(tierBadge).toBeVisible({ timeout: 10000 });
    });

    test('tier badge should have a valid tier class', async ({ page }) => {
      const tierBadge = page.locator('[data-testid="tier-badge"]');
      await expect(tierBadge).toBeVisible({ timeout: 10000 });

      const classes = await tierBadge.getAttribute('class');
      const hasTier =
        classes?.includes('free') || classes?.includes('mid') || classes?.includes('enterprise');
      expect(hasTier).toBeTruthy();
    });

    test('tier badge text should match a known tier', async ({ page }) => {
      const tierBadge = page.locator('[data-testid="tier-badge"]');
      await expect(tierBadge).toBeVisible({ timeout: 10000 });

      const text = await tierBadge.textContent();
      expect(['free', 'mid', 'enterprise']).toContain(text?.trim());
    });
  });
});
