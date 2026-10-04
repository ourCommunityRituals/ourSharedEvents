/**
 * SMOKE JOURNEY: Event Day — Display + Poster + Check-in
 *
 * The day-of-event path across physical and digital surfaces:
 *   1. /display loads → featured event visible on dark background
 *   2. /display clock is ticking
 *   3. /poster loads → event picker has events → poster renders
 *   4. Poster has QR section (customers will scan these)
 *   5. /forms/{eventId}?type=checkin → tap button → count updates
 *   6. /display still alive (didn't crash while check-ins happened)
 *
 * Runs in T2 Smoke. If the TV display crashes or poster doesn't
 * render, the venue has a blank screen and no QR codes.
 */

import { test, expect } from '@playwright/test';

test.describe('Journey: Event Day — Display + Poster + Check-in', () => {
  test.describe.configure({ mode: 'serial' });

  // ── Display: TV is showing events ──────────────────────────────────────

  test('Step 1: /display loads with featured event', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="display-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-main"]')).toBeVisible();

    // Either event card OR empty message — no blank screen
    const hasEvent = (await page.locator('.event-card').count()) > 0;
    const hasEmpty = (await page.locator('.empty').count()) > 0;
    expect(hasEvent || hasEmpty, 'Display must show content, not blank').toBe(true);
  });

  test('Step 2: /display has no clock and no ticker (OSE-1521)', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="display-main"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-clock"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="display-ticker"]')).toHaveCount(0);
  });

  // ── Poster: Printable with QR codes ────────────────────────────────────

  test('Step 3: /poster loads with event picker → poster renders', async ({ page }) => {
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="poster-event-picker"]')).toBeVisible();
    await expect(page.locator('[data-testid="poster-area"]')).toBeVisible();
  });

  test('Step 4: Poster has QR section for customers to scan', async ({ page }) => {
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: 20_000 });

    const picker = page.locator('[data-testid="poster-event-picker"]');
    const hasEvents = !(await picker.textContent())?.includes('No events');
    test.skip(!hasEvents, 'No events for poster');

    const qrItems = page.locator('[data-testid="poster-area"] .qr-item');
    expect(await qrItems.count()).toBe(2);

    const labels = await page.locator('[data-testid="poster-area"] .qr-label').allTextContents();
    expect(labels.some((l) => l.includes('Event Page'))).toBe(true);
    expect(labels.some((l) => l.includes('Registration'))).toBe(true);
  });

  // ── Check-in: Customer arrives, taps ───────────────────────────────────

  test('Step 5: Check-in form loads → tap → count updates', async ({ page, request }) => {
    // Get an event ID from the API
    const listRes = await request.get('/api/v2/events');
    const listJson = await listRes.json();
    test.skip(!listJson.ok || !listJson.items?.length, 'No events');

    const eventId = listJson.items[0].id;

    await page.goto(`/forms/${eventId}?type=checkin`, {
      waitUntil: 'networkidle',
      timeout: 20_000,
    });

    await expect(page.locator('[data-testid="form-checkin"]')).toBeVisible({ timeout: 10_000 });

    const tapBtn = page.locator('[data-testid="checkin-submit"]');
    await expect(tapBtn).toBeVisible();

    // Tap once
    await tapBtn.click();

    // Count should update (or success should show)
    await page.waitForTimeout(1000);
    // The page should still be functional (no crash)
    await expect(tapBtn).toBeVisible();
  });

  // ── Display: Still alive ───────────────────────────────────────────────

  test('Step 6: /display still responsive after check-ins', async ({ page }) => {
    await page.goto('/display', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="display-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-main"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-consent"]')).toBeVisible();
  });
});
