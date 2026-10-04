/**
 * Logs and Settings, in a real browser, against the local worker.
 *
 * An admin opens Logs from the admin page, sees the action they just caused
 * (tagged by kind, never by attendee), moves between the four tabs with the
 * keyboard, finds Cost honestly empty, and reads Settings, which says what is
 * fixed for everyone. Nothing on either page can change anything.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts, Chromium).
 */
import { test, expect, type Page } from '@playwright/test';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';

test.beforeEach(async ({ page }) => {
  expect(
    ADMIN_BEARER,
    'OSE_ADMIN_BEARER must be set (playwright.mobile.config.ts sets it)'
  ).not.toBe('');
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
});

test.beforeAll(async ({ request }) => {
  // One action that must show in the log: creating an event writes an audit row.
  await createLiveEvent(request, ADMIN_BEARER, `Logs journey ${Date.now()}`);
});

async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId('logs-status').or(page.getByTestId('logs-error'))).not.toHaveText(
    'Loading the log.'
  );
}

test('the admin page links to Logs and Settings, and each links back', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/admin');
  await page.getByTestId('admin-nav-logs').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Logs');
  await page.getByTestId('logs-nav-settings').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await page.getByTestId('settings-nav-logs').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Logs');
  await page.getByTestId('logs-nav-admin').click();
  await expect(page).toHaveURL(/\/admin$/);
});

test('Logs: the action just taken is there, tagged by kind, with no full address', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/api/v2/admin/screens/logs');
  await settled(page);
  const rows = page.getByTestId('logs-row');
  await expect(rows.first()).toBeVisible();
  const create = rows.filter({ hasText: 'Create event' }).first();
  await expect(create).toBeVisible();
  await expect(create.getByTestId('logs-row-source')).toHaveText('Key');
  const text = (await page.getByTestId('logs-list').textContent()) ?? '';
  expect(text, 'no full IPv4 address in the log').not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b(?!\/)/);
});

test('Logs: four tabs by keyboard; Cost is honestly empty; nothing errors', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/api/v2/admin/screens/logs');
  await settled(page);

  const activity = page.getByTestId('logs-tab-activity');
  await activity.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('logs-tab-system')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('logs-heading')).toHaveText('System jobs');
  await settled(page);
  await expect(page.getByTestId('logs-error')).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('logs-heading')).toHaveText('Security');
  await settled(page);
  await expect(page.getByTestId('logs-error')).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('logs-heading')).toHaveText('Cost');
  const cost = page.getByTestId('logs-cost-empty');
  await expect(cost).toBeVisible();
  await expect(cost).toContainText('Not recorded yet.');
  await expect(page.getByTestId('logs-row')).toHaveCount(0);
});

test('Logs: the whole-platform view answers a platform key', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/api/v2/admin/screens/logs');
  await settled(page);
  await page.getByTestId('logs-view').selectOption('platform');
  await settled(page);
  await expect(page.getByTestId('logs-error')).toHaveCount(0);
  await expect(page.getByTestId('logs-row').first()).toBeVisible();
});

test('Settings: read only, the plan shown, and what is fixed for everyone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/api/v2/admin/screens/settings');
  await expect(page.getByTestId('settings-fixed')).toBeVisible();
  await expect(page.getByTestId('settings-readonly')).toContainText('Read only');
  await expect(page.getByTestId('settings-plan-name')).not.toHaveText('');
  await expect(page.getByTestId('settings-fixed-privacy_line')).toContainText(
    'Never who, only how many.'
  );
  await expect(page.getByTestId('settings-fixed-count_floor')).toContainText('5');
  await expect(page.getByTestId('settings-fixed-security_same_on_every_plan')).toContainText(
    'every plan'
  );
  // Enterprise items are named, not hidden.
  await expect(
    page.getByTestId('settings-plan-item').filter({ hasText: 'White-label' })
  ).toBeVisible();
  // Nothing to press: no control on the page that could look like it saves.
  await expect(page.locator('main input, main select, main textarea, main button')).toHaveCount(0);
  await expect(page.getByTestId('settings-error')).toHaveCount(0);
});
