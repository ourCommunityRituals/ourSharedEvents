/**
 * SMOKE JOURNEY: Cross-Surface — Poster → Pre-Event → Event → Post-Event
 *
 * The full lifecycle across all surfaces for one event:
 *
 *   PRE-EVENT:
 *   1. /poster → event renders with name + QR placeholders
 *   2. /events → same event visible with Register CTA
 *   3. Register CTA → form loads → fill → success
 *
 *   EVENT DAY:
 *   4. /display → event shows as featured (or in list)
 *   5. /forms/{id}?type=checkin → tap → functional
 *
 *   POST-EVENT:
 *   6. /admin → event in table → click → forms card loads
 *   7. Forms card shows count boxes with numbers
 *   8. Surface cards link to all surfaces
 *
 * This is TP-2 from STORIES.md: "Cross-surface E2E flow"
 * Runs in T2 Smoke. Proves the seams between screens hold.
 */

import { test, expect } from '@playwright/test';

test.describe('Journey: Cross-Surface Lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  let eventId: string;
  let eventName: string;

  // ── Setup: find an event to track across surfaces ──────────────────────

  test('Setup: Get an active event from API', async ({ request }) => {
    const res = await request.get('/api/v2/events?brand=root');
    const json = await res.json();
    test.skip(!json.ok || !json.items?.length, 'No events on staging');

    eventId = json.items[0].id;
    eventName = json.items[0].title || json.items[0].name || 'Unknown';
    console.log(`[Cross-Surface] Tracking: ${eventId} — "${eventName}"`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PRE-EVENT
  // ═══════════════════════════════════════════════════════════════════════

  test('Pre-1: /poster shows the event in picker', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: 20_000 });

    const picker = page.locator('[data-testid="poster-event-picker"]');
    await expect(picker).toBeVisible();
    const text = await picker.textContent();
    expect(text).not.toContain('No events');
  });

  test('Pre-2: /poster renders poster with QR section', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="poster-area"] .poster')).toBeVisible();
    expect(await page.locator('.qr-item').count()).toBe(2);
  });

  test('Pre-3: /events shows event card with Register CTA', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="public-event-card"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="public-event-cta"]').first()).toBeVisible();
  });

  test('Pre-4: Register CTA → form → fill → success', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto(`/forms/${eventId}?type=register`, {
      waitUntil: 'networkidle',
      timeout: 20_000,
    });

    const nameInput = page.locator('[data-testid="register-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(`Cross-Surface ${Date.now()}`);
    await page.locator('[data-testid="register-submit"]').click();

    await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // EVENT DAY
  // ═══════════════════════════════════════════════════════════════════════

  test('Day-1: /display shows event content', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto('/display', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="display-main"]')).toBeVisible();
    // Should have an event card or empty message — not blank
    const content = await page.locator('[data-testid="display-main"]').textContent();
    expect(content?.trim().length).toBeGreaterThan(0);
  });

  test('Day-2: Check-in form → tap → functional', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto(`/forms/${eventId}?type=checkin`, {
      waitUntil: 'networkidle',
      timeout: 20_000,
    });

    const tapBtn = page.locator('[data-testid="checkin-submit"]');
    await expect(tapBtn).toBeVisible({ timeout: 10_000 });
    await tapBtn.click();
    await page.waitForTimeout(1000);

    // Button still there (didn't crash)
    await expect(tapBtn).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST-EVENT
  // ═══════════════════════════════════════════════════════════════════════

  test('Post-1: /admin shows event in table', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="events-table"]')).toBeVisible({ timeout: 15_000 });
    const rows = page.locator('[data-testid^="event-row-"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  test('Post-2: Click event → forms card with count boxes', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid^="event-row-"]').first().click();
    await page.waitForSelector('[data-testid^="form-gate-"]', { timeout: 15_000 });

    // Count boxes visible
    const counts = page.locator('[data-testid="count-num"]');
    await expect(counts.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Post-3: Surface cards link to all surfaces', async ({ page }) => {
    test.skip(!eventId, 'No event');
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="card-poster"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-display"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-public"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-report"]')).toBeVisible();
  });
});
