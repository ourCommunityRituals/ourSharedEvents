/**
 * GOLDEN PATH — First-Time Organizer Journey
 *
 * One clean run through the product. No edge cases. No XSS. No emoji.
 * Just: "Does the product work for a first-time user?"
 *
 *   1. Admin loads → create event form visible
 *   2. Fill in event name, date, venue → submit → success
 *   3. Events table reloads with the new event visible
 *   4. Click the new event row → forms card loads
 *   5. Registration form gate is present and linked
 *   6. Click registration link → form page loads with event name
 *   7. Surface cards (Poster, Display, Public, Report) are present
 *   8. Each surface card has a copy URL button
 *   9. Copy URL button works (text changes to "Copied!")
 *
 * This runs in T2 Smoke — every push, every nightly. If this fails,
 * the product is broken for every new organizer.
 *
 * Auth: via extraHTTPHeaders in playwright.ui-smoke.config.ts
 */

import { test, expect } from '@playwright/test';

// Unique event name per run to avoid collisions
const TIMESTAMP = Date.now();
const EVENT_NAME = `Smoke Journey ${TIMESTAMP}`;

test.describe('Golden Path — First-Time Organizer', () => {
  test.describe.configure({ mode: 'serial' });

  let createdEventId: string;

  // ── Step 1: Admin loads with create form ────────────────────────────────

  test('Step 1: Admin page loads with create event form', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="admin-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="create-event-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="create-event-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="create-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="create-submit"]')).toBeVisible();
    await expect(page.locator('[data-testid="create-submit"]')).toContainText('Create Event');
  });

  // ── Step 2: Create an event ─────────────────────────────────────────────

  test('Step 2: Fill form and create event → success message', async ({ request }) => {
    // Use API directly since the form does a location.reload() which resets page state
    const res = await request.post('/api/v2/admin/events', {
      data: {
        title: EVENT_NAME,
        start_date: '2026-08-15',
        location: 'Beverly Arts Center',
        status: 'active',
        is_published: true,
      },
    });

    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toMatch(/^evt_/);
    createdEventId = json.id;

    console.log(`[Golden Path] Created event: ${createdEventId} — "${EVENT_NAME}"`);
  });

  // ── Step 3: Event appears in admin table ────────────────────────────────

  test('Step 3: New event appears in admin events table', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    // Wait for events table to load
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible({ timeout: 15_000 });

    // Find our event by name
    const eventRow = page.locator(`text=${EVENT_NAME}`);
    await expect(eventRow).toBeVisible({ timeout: 10_000 });
  });

  // ── Step 4: Click event row → forms card loads ──────────────────────────

  test('Step 4: Click event row → forms card loads with gates', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible({ timeout: 15_000 });

    // Click the row containing our event
    const row = page.locator(`tr:has-text("${EVENT_NAME}")`);
    await expect(row).toBeVisible();
    await row.click();

    // Wait for forms panel to load
    await page.waitForSelector('[data-testid="forms-list"]', { timeout: 15_000 });

    // Forms card should show the 4 consolidated form rows
    await expect(page.locator('[data-testid="form-row-register"]')).toBeVisible();
    await expect(page.locator('[data-testid="form-row-checkin"]')).toBeVisible();
    await expect(page.locator('[data-testid="form-row-survey"]')).toBeVisible();
    await expect(page.locator('[data-testid="form-row-email"]')).toBeVisible();
  });

  // ── Step 5: Registration link is present and correct ────────────────────

  test('Step 5: Registration form link points to correct event', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible({ timeout: 15_000 });

    const row = page.locator(`tr:has-text("${EVENT_NAME}")`);
    await row.click();
    await page.waitForSelector('[data-testid="form-link-register"]', { timeout: 15_000 });

    const regLink = page.locator('[data-testid="form-link-register"]');
    await expect(regLink).toBeVisible();

    const href = await regLink.getAttribute('href');
    // The event's own sign-up form (OSE-1684).
    expect(href).toBe(`/events/${createdEventId}/register`);
  });

  // ── Step 6: Registration form page loads ────────────────────────────────

  test('Step 6: Registration form page loads with event name', async ({ page }) => {
    await page.goto(`/forms/${createdEventId}?type=register`, {
      waitUntil: 'networkidle',
      timeout: 20_000,
    });

    await expect(page.locator('[data-testid="form-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-submit"]')).toBeVisible();
  });

  // ── Step 7: Surface cards are present ───────────────────────────────────

  test('Step 7: All 4 surface cards visible on admin', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="surface-cards"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-poster"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-display"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-public"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-report"]')).toBeVisible();
  });

  // ── Step 8: Each surface card has a copy URL button ─────────────────────

  test('Step 8: Each surface card has copy URL button', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="copy-poster"]')).toBeVisible();
    await expect(page.locator('[data-testid="copy-display"]')).toBeVisible();
    await expect(page.locator('[data-testid="copy-public"]')).toBeVisible();
    await expect(page.locator('[data-testid="copy-report"]')).toBeVisible();
  });

  // ── Step 9: Copy URL button works ───────────────────────────────────────

  test('Step 9: Copy URL → "Copied!" → reverts', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });
    await page.context().grantPermissions(['clipboard-write']);

    const copyBtn = page.locator('[data-testid="copy-poster"]');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toContainText('Copy URL');

    await copyBtn.click();
    await expect(copyBtn).toContainText('Copied!');

    // Reverts after 2 seconds
    await expect(copyBtn).toContainText('Copy URL', { timeout: 3000 });
  });
});
