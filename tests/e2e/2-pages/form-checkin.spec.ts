/**
 * PAGE TESTS - Level 2: Check-in Form Page
 *
 * Purpose: Test the public check-in form at /forms/{eventId}?type=checkin
 * Coverage: Button display, tap interaction, count updates, visual feedback
 *
 * Public page - no authentication required.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
const TEST_EVENT_ID = process.env.TEST_EVENT_ID || 'test-event-001';
const FORM_URL = `${BASE_URL}/forms/${TEST_EVENT_ID}?type=checkin`;

test.describe('Check-in Form - Page Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('page loads with checkin container', async ({ page }) => {
    const container = page.locator('[data-testid="form-checkin"]');
    await expect(container).toBeVisible();
  });

  test('form header displays event name', async ({ page }) => {
    const header = page.locator('[data-testid="form-header"]');
    await expect(header).toBeVisible();

    const eventName = page.locator('[data-testid="form-event-name"]');
    await expect(eventName).toBeVisible();
    const text = await eventName.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('check-in button is visible', async ({ page }) => {
    const button = page.locator('[data-testid="checkin-submit"]');
    await expect(button).toBeVisible();
  });

  test('check-in button is large and circular (180x180px)', async ({ page }) => {
    const button = page.locator('[data-testid="checkin-submit"]');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();

    // Button should be approximately 180x180 (allow some tolerance for borders/padding)
    expect(box!.width).toBeGreaterThanOrEqual(170);
    expect(box!.width).toBeLessThanOrEqual(200);
    expect(box!.height).toBeGreaterThanOrEqual(170);
    expect(box!.height).toBeLessThanOrEqual(200);

    // Check for circular shape via border-radius
    const borderRadius = await button.evaluate((el) => getComputedStyle(el).borderRadius);
    // 50% or 90px makes it circular
    const isCircular =
      borderRadius === '50%' || borderRadius === '90px' || parseInt(borderRadius) >= 85;
    expect(isCircular).toBe(true);
  });

  test('count display is present', async ({ page }) => {
    // The count element is present but intentionally HIDDEN until a check-in populates it
    // (there is no GET-count endpoint — GET returns 404; the count appears after the POST).
    // Assert PRESENCE, not visibility. The populated/visible state is covered by
    // 'tap button updates count display' below.
    const count = page.locator('[data-testid="checkin-count"]');
    await expect(count).toBeAttached();
  });
});

test.describe('Check-in Form - Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  test('tap button sends POST to checkin API', async ({ page }) => {
    const apiPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/v2/events/${TEST_EVENT_ID}/forms/checkin`) &&
        req.method() === 'POST'
    );

    const button = page.locator('[data-testid="checkin-submit"]');
    await button.click();

    const request = await apiPromise;
    expect(request.method()).toBe('POST');
  });

  test('tap button updates count display', async ({ page }) => {
    const countEl = page.locator('[data-testid="checkin-count"]');
    const countBefore = await countEl.textContent();

    const button = page.locator('[data-testid="checkin-submit"]');
    await button.click();

    // Wait for count to update after API response
    await page.waitForTimeout(2000);

    const countAfter = await countEl.textContent();
    // OSE-1657: the page confirms the check-in; it adds the total only when the
    // answer publishes one (5 or more), so a number is not required.
    expect(countAfter).toMatch(/^You're checked in/);
  });

  test('tap button provides visual feedback (animation)', async ({ page }) => {
    const button = page.locator('[data-testid="checkin-submit"]');

    // Click and immediately check for animation class or style change
    await button.click();

    // Check for animation/transition properties or class changes
    const hasAnimation = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return (
        style.animationName !== 'none' ||
        style.transition !== '' ||
        el.classList.contains('animate') ||
        el.classList.contains('pulse') ||
        el.classList.contains('active') ||
        el.classList.contains('tapped')
      );
    });
    expect(hasAnimation).toBe(true);
  });

  test('API response includes ok and count', async ({ page }) => {
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v2/events/${TEST_EVENT_ID}/forms/checkin`) && res.status() === 200
    );

    const button = page.locator('[data-testid="checkin-submit"]');
    await button.click();

    const response = await responsePromise;
    const body = await response.json();
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('count');
    // OSE-1657: floored like the admin count — a number from 5 on, else null.
    expect(body.count === null || typeof body.count === 'number').toBe(true);
    expect(typeof body.suppressed).toBe('boolean');
    expect(body.floor).toBe(5);
    if (body.suppressed) expect(body.count).toBeNull();
    else expect(body.count).toBeGreaterThanOrEqual(5);
  });
});
