/**
 * E2E Tests: Admin Dashboard — Deep Functional Coverage
 *
 * Tests the /admin page served by the Cloudflare Worker.
 * Covers: header, events table, forms card, surface cards.
 * Handles both data-present and empty-state scenarios.
 *
 * Auth is handled via extraHTTPHeaders in playwright config.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://oursharedevents.com';
const ADMIN_URL = `${BASE_URL}/admin`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function navigateToAdmin(page: import('@playwright/test').Page) {
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  // Admin now opens on the front-door chooser with the dashboard hidden; these
  // tests exercise the dashboard, so reveal it via "Show me everything".
  const advanced = page.locator('[data-testid="admin-path-advanced"]');
  if (await advanced.isVisible().catch(() => false)) {
    await advanced.click();
    await page
      .locator('[data-testid="admin-path-chooser"]')
      .waitFor({ state: 'hidden' })
      .catch(() => {});
  }
}

/**
 * Determine whether the staging environment has events.
 * Returns true when at least one event row is visible.
 */
async function hasEvents(page: import('@playwright/test').Page): Promise<boolean> {
  const table = page.locator('[data-testid="events-table"]');
  const empty = page.getByText('No events found');
  await Promise.race([
    table.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    empty.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
  ]);
  return table.isVisible();
}

// ===========================================================================
// 1. Header
// ===========================================================================

test.describe('Header', () => {
  test('should display admin header', async ({ page }) => {
    await navigateToAdmin(page);
    const header = page.locator('[data-testid="admin-header"]');
    await expect(header).toBeVisible();
  });

  test('should display a tier badge', async ({ page }) => {
    await navigateToAdmin(page);
    const badge = page.locator('[data-testid="tier-badge"]');
    await expect(badge).toBeVisible();
  });

  test('tier badge should have a valid tier class', async ({ page }) => {
    await navigateToAdmin(page);
    const badge = page.locator('[data-testid="tier-badge"]');
    await expect(badge).toBeVisible();

    const classes = await badge.getAttribute('class');
    const hasTier =
      classes?.includes('free') || classes?.includes('mid') || classes?.includes('enterprise');
    expect(hasTier).toBeTruthy();
  });

  test('tier badge should include the tier-badge base class', async ({ page }) => {
    await navigateToAdmin(page);
    const badge = page.locator('[data-testid="tier-badge"]');
    const classes = await badge.getAttribute('class');
    expect(classes).toContain('tier-badge');
  });
});

// ===========================================================================
// 2. Events Table — Loading / Skeleton
// ===========================================================================

test.describe('Events Table — Loading', () => {
  test('should show skeleton loader while events load', async ({ page }) => {
    await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    // Skeleton should appear before the network fetch resolves
    const skeleton = page.locator('[data-testid="skeleton-events"]');
    await expect(skeleton).toBeVisible({ timeout: 5_000 });
  });

  test('skeleton should disappear once events table or empty state renders', async ({ page }) => {
    await navigateToAdmin(page);
    const skeleton = page.locator('[data-testid="skeleton-events"]');
    await expect(skeleton).toBeHidden({ timeout: 15_000 });
  });
});

// ===========================================================================
// 3. Events Table — With Data
// ===========================================================================

test.describe('Events Table — Data Present', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToAdmin(page);
    test.skip(!(await hasEvents(page)), 'No events in staging — skipping data tests');
  });

  test('should render the events table', async ({ page }) => {
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible();
  });

  test('should render a table body', async ({ page }) => {
    await expect(page.locator('[data-testid="events-tbody"]')).toBeVisible();
  });

  test('should contain at least one event row', async ({ page }) => {
    const rows = page.locator('[data-testid^="event-row-"]');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  test('each row should have an event name cell', async ({ page }) => {
    const firstRow = page.locator('[data-testid^="event-row-"]').first();
    await expect(firstRow.locator('[data-testid="event-name"]')).toBeVisible();
  });

  test('each row should have an event date cell', async ({ page }) => {
    const firstRow = page.locator('[data-testid^="event-row-"]').first();
    await expect(firstRow.locator('[data-testid="event-date"]')).toBeVisible();
  });

  test('each row should have an event venue cell', async ({ page }) => {
    const firstRow = page.locator('[data-testid^="event-row-"]').first();
    await expect(firstRow.locator('[data-testid="event-venue"]')).toBeVisible();
  });

  test('each row should have an event status badge', async ({ page }) => {
    const firstRow = page.locator('[data-testid^="event-row-"]').first();
    const status = firstRow.locator('[data-testid="event-status"]');
    await expect(status).toBeVisible();

    const classes = await status.getAttribute('class');
    const hasBadge = classes?.includes('active') || classes?.includes('archived');
    expect(hasBadge).toBeTruthy();
  });

  test('status badge should have the .badge base class', async ({ page }) => {
    const firstRow = page.locator('[data-testid^="event-row-"]').first();
    const status = firstRow.locator('[data-testid="event-status"]');
    const classes = await status.getAttribute('class');
    expect(classes).toContain('badge');
  });

  test('clicking a row should add the .selected class', async ({ page }) => {
    const firstRow = page.locator('[data-testid^="event-row-"]').first();
    await firstRow.click();
    await expect(firstRow).toHaveClass(/selected/);
  });

  test('clicking a different row should move the .selected class', async ({ page }) => {
    const rows = page.locator('[data-testid^="event-row-"]');
    const count = await rows.count();
    test.skip(count < 2, 'Need at least two events to test selection switch');

    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveClass(/selected/);

    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveClass(/selected/);
    await expect(rows.nth(0)).not.toHaveClass(/selected/);
  });
});

// ===========================================================================
// 4. Events Table — Empty State
// ===========================================================================

test.describe('Events Table — Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToAdmin(page);
    test.skip(await hasEvents(page), 'Events present — skipping empty-state tests');
  });

  test('should display "No events found" when table is empty', async ({ page }) => {
    await expect(page.getByText('No events found')).toBeVisible();
  });

  test('should not render the events table when empty', async ({ page }) => {
    await expect(page.locator('[data-testid="events-table"]')).toBeHidden();
  });
});

// ===========================================================================
// 5. Events Table — Error State
// ===========================================================================

test.describe('Events Table — Error State', () => {
  test('should show error UI when API request fails', async ({ page }) => {
    // Intercept the events API and force a 500
    await page.route('**/api/v2/admin/events', (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' })
    );
    await navigateToAdmin(page);

    const errorEl = page.locator('[data-testid="events-error"]');
    await expect(errorEl).toBeVisible({ timeout: 15_000 });
  });

  test('error state should include a retry button', async ({ page }) => {
    await page.route('**/api/v2/admin/events', (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' })
    );
    await navigateToAdmin(page);

    const retry = page.locator('[data-testid="events-retry"]');
    await expect(retry).toBeVisible();
  });

  test('clicking retry should re-fetch events', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/v2/admin/events', (route) => {
      callCount++;
      if (callCount === 1) {
        return route.fulfill({ status: 500, body: 'fail' });
      }
      // Let the second request through
      return route.fallback();
    });
    await navigateToAdmin(page);

    const retry = page.locator('[data-testid="events-retry"]');
    await expect(retry).toBeVisible();
    await retry.click();

    // After retry the error should disappear (table or empty state shows)
    const errorEl = page.locator('[data-testid="events-error"]');
    await expect(errorEl).toBeHidden({ timeout: 15_000 });
    expect(callCount).toBe(2);
  });
});

// ===========================================================================
// 6. Forms Card — Initial State
// ===========================================================================

test.describe('Forms Card — Initial State', () => {
  test('should display the forms card', async ({ page }) => {
    await navigateToAdmin(page);
    await expect(page.locator('[data-testid="forms-card"]')).toBeVisible();
  });

  test('should display the forms panel', async ({ page }) => {
    await navigateToAdmin(page);
    await expect(page.locator('[data-testid="forms-panel"]')).toBeVisible();
  });

  test('should show placeholder text before an event is selected', async ({ page }) => {
    await navigateToAdmin(page);
    const panel = page.locator('[data-testid="forms-panel"]');
    await expect(panel).toContainText('Select an event to manage forms');
  });
});

// ===========================================================================
// 7. Forms Card — After Event Selection
// ===========================================================================

test.describe('Forms Card — Event Selected', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToAdmin(page);
    test.skip(!(await hasEvents(page)), 'No events to select');
    // Select the first event row
    await page.locator('[data-testid^="event-row-"]').first().click();
    // Wait for the forms panel to update (skeleton -> gates)
    await page.waitForSelector('[data-testid^="form-gate-"]', { timeout: 15_000 });
  });

  test('should render the register form gate', async ({ page }) => {
    await expect(page.locator('[data-testid="form-gate-register"]')).toBeVisible();
  });

  test('should render the checkin form gate', async ({ page }) => {
    await expect(page.locator('[data-testid="form-gate-checkin"]')).toBeVisible();
  });

  test('should render the survey form gate', async ({ page }) => {
    await expect(page.locator('[data-testid="form-gate-survey"]')).toBeVisible();
  });

  test('should render the email form gate', async ({ page }) => {
    await expect(page.locator('[data-testid="form-gate-email"]')).toBeVisible();
  });

  test('register gate should contain a link to the forms page', async ({ page }) => {
    const link = page.locator('[data-testid="form-link-register"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/forms\/[^?]+\?type=register/);
  });

  test('checkin gate link should point to the correct form type', async ({ page }) => {
    const link = page.locator('[data-testid="form-link-checkin"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/forms\/[^?]+\?type=checkin/);
  });

  test('survey gate link should point to the correct form type', async ({ page }) => {
    const link = page.locator('[data-testid="form-link-survey"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/forms\/[^?]+\?type=survey/);
  });

  test('email gate link should point to the correct form type', async ({ page }) => {
    const link = page.locator('[data-testid="form-link-email"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/forms\/[^?]+\?type=email/);
  });

  test('should render form toggles for each form type', async ({ page }) => {
    for (const type of ['register', 'checkin', 'survey', 'email']) {
      const toggle = page.locator(`[data-testid="form-toggle-${type}"]`);
      await expect(toggle).toBeVisible();
      // Toggles are checkboxes
      const tagName = await toggle.evaluate((el) => el.tagName.toLowerCase());
      expect(tagName).toBe('input');
      const inputType = await toggle.getAttribute('type');
      expect(inputType).toBe('checkbox');
    }
  });

  test('should display registration count with count-num element', async ({ page }) => {
    const countCard = page.locator('[data-testid="count-registrations"]');
    await expect(countCard).toBeVisible();
    await expect(countCard.locator('[data-testid="count-num"]')).toBeVisible();
  });

  test('should display check-in count', async ({ page }) => {
    const countCard = page.locator('[data-testid="count-check-ins"]');
    await expect(countCard).toBeVisible();
    await expect(countCard.locator('[data-testid="count-num"]')).toBeVisible();
  });

  test('should display survey count', async ({ page }) => {
    const countCard = page.locator('[data-testid="count-surveys"]');
    await expect(countCard).toBeVisible();
    await expect(countCard.locator('[data-testid="count-num"]')).toBeVisible();
  });

  test('should display email count', async ({ page }) => {
    const countCard = page.locator('[data-testid="count-emails"]');
    await expect(countCard).toBeVisible();
    await expect(countCard.locator('[data-testid="count-num"]')).toBeVisible();
  });
});

// ===========================================================================
// 8. Forms Card — Feature Locking
// ===========================================================================

test.describe('Forms Card — Feature Locking', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToAdmin(page);
    test.skip(!(await hasEvents(page)), 'No events to select');
    await page.locator('[data-testid^="event-row-"]').first().click();
    await page.waitForSelector('[data-testid^="form-gate-"]', { timeout: 15_000 });
  });

  test('locked gates should have the .feature-locked class', async ({ page }) => {
    const lockedGates = page.locator('.feature-locked');
    const count = await lockedGates.count();

    // Depending on tier some gates may or may not be locked — just validate structure if any exist
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const gate = lockedGates.nth(i);
        await expect(gate.locator('.lock-overlay')).toBeVisible();
      }
    } else {
      // All gates unlocked — pass the test (enterprise tier or all features enabled)
      expect(count).toBe(0);
    }
  });

  test('lock overlay should contain upgrade text', async ({ page }) => {
    const overlays = page.locator('.feature-locked .lock-overlay');
    const count = await overlays.count();
    test.skip(count === 0, 'No locked features on this tier');

    const text = await overlays.first().textContent();
    expect(text?.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 9. Surface Cards
// ===========================================================================

test.describe('Surface Cards', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToAdmin(page);
  });

  test('should render the surface cards container', async ({ page }) => {
    await expect(page.locator('[data-testid="surface-cards"]')).toBeVisible();
  });

  test('should render poster card', async ({ page }) => {
    await expect(page.locator('[data-testid="card-poster"]')).toBeVisible();
  });

  test('should render display card', async ({ page }) => {
    await expect(page.locator('[data-testid="card-display"]')).toBeVisible();
  });

  test('should render public card', async ({ page }) => {
    await expect(page.locator('[data-testid="card-public"]')).toBeVisible();
  });

  test('should render report card', async ({ page }) => {
    await expect(page.locator('[data-testid="card-report"]')).toBeVisible();
  });

  test('poster card should contain a link', async ({ page }) => {
    const link = page.locator('[data-testid="link-poster"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
  });

  test('display card should contain a link', async ({ page }) => {
    const link = page.locator('[data-testid="link-display"]');
    await expect(link).toBeVisible();
  });

  test('public card should contain a link', async ({ page }) => {
    const link = page.locator('[data-testid="link-public"]');
    await expect(link).toBeVisible();
  });

  test('report card should contain a link', async ({ page }) => {
    const link = page.locator('[data-testid="link-report"]');
    await expect(link).toBeVisible();
  });

  test('poster card should have a copy button', async ({ page }) => {
    await expect(page.locator('[data-testid="copy-poster"]')).toBeVisible();
  });

  test('display card should have a copy button', async ({ page }) => {
    await expect(page.locator('[data-testid="copy-display"]')).toBeVisible();
  });

  test('public card should have a copy button', async ({ page }) => {
    await expect(page.locator('[data-testid="copy-public"]')).toBeVisible();
  });

  test('report card should have a copy button', async ({ page }) => {
    await expect(page.locator('[data-testid="copy-report"]')).toBeVisible();
  });
});
