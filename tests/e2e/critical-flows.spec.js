/**
 * End-to-End Tests for Critical User Flows
 *
 * Run with: npx playwright test
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:e2e
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:e2e
 *
 * Environment variables:
 * - BASE_URL: Target deployment URL (defaults to eventangle.com)
 * - ADMIN_KEY: Admin secret for testing
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('./config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const BRAND_ID = 'root';

test.describe('Critical User Flows - E2E', () => {

  test('Flow 1: Admin creates event and views on public page', async ({ page }) => {
    // Step 1: Navigate to admin page
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await expect(page).toHaveTitle(/Admin/);

    // Step 2: Fill event creation form
    await page.fill('#name', 'E2E Test Event');
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#timeISO', '19:00');
    await page.fill('#venue', 'Test Venue');

    // Expand advanced event details section to fill summary (optional field)
    await page.click('#advancedEventDetailsHeader');
    await page.waitForTimeout(300);
    await page.fill('#summary', 'This is a test event for E2E validation');

    // Step 3: Submit form (will prompt for admin key)
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept(ADMIN_KEY);
    });

    await page.click('button[type="submit"]');

    // Step 4: Wait for event card to appear
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Step 5: Extract public URL
    const publicLink = await page.locator('#lnkPublic').textContent();
    expect(publicLink).toContain(BASE_URL);

    // Step 6: Navigate to public page
    await page.goto(publicLink, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 7: Verify event details are displayed
    await expect(page.locator('h1')).toContainText('E2E Test Event');
    await expect(page.locator('text=Test Venue')).toBeVisible();
    await expect(page.locator('text=This is a test event')).toBeVisible();
  });

  test('Flow 2: Configure display with sponsors', async ({ page, context }) => {
    // Step 1: Create event first (reuse logic from Flow 1)
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    await page.fill('#name', 'Sponsor Test Event');
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Step 2: Click "Configure Display & Sponsors"
    await page.click('button:has-text("Configure Display & Sponsors")');
    await expect(page.locator('#displayCard')).toBeVisible();

    // Step 3: Add sponsor
    await page.click('button:has-text("Add Sponsor")');
    await page.fill('.sp-name', 'Test Sponsor Inc');
    await page.fill('.sp-url', 'https://example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/200x100');
    await page.check('.sp-tvTop');
    await page.check('.sp-mobileBanner');

    // Step 4: Save configuration
    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=Display configuration saved!')).toBeVisible({ timeout: 5000 });

    // Step 5: Extract display URL
    const displayLink = await page.locator('#lnkDisplay').textContent();

    // Step 6: Open display page in new tab
    const displayPage = await context.newPage();
    await displayPage.goto(displayLink);

    // Step 7: Verify sponsor appears
    await expect(displayPage.locator('#sponsorTop')).toBeVisible({ timeout: 10000 });
    await expect(displayPage.locator('text=Test Sponsor Inc')).toBeVisible();
  });

  test('Flow 3: Public page shows sponsor banner and logs analytics', async ({ page }) => {
    // This test requires a pre-created event with sponsors
    // For now, we'll test the public page structure

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Should show events list or event detail
    await expect(page.locator('h1')).toBeVisible();

    // If event list is shown
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Click first event
      await eventCards.first().locator('a').click();

      // Should navigate to event detail
      await expect(page.locator('.event-detail')).toBeVisible({ timeout: 5000 });
    }
  });

  test('Flow 4: Display page carousel mode', async ({ page }) => {
    // Navigate to display page with TV parameter
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Should show TV display layout
    await expect(page.locator('body[data-tv="1"]')).toBeVisible();
    await expect(page.locator('#stage')).toBeVisible();

    // Should have large font size for TV viewing
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );

    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20); // Minimum 20px for TV
  });

  test('Flow 5: Health check and status endpoints', async ({ page }) => {
    // Test status endpoint (pure, flat format)
    const statusResponse = await page.goto(`${BASE_URL}?page=status`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    expect(statusResponse.ok()).toBeTruthy();

    const statusJson = await statusResponse.json();
    // Pure status endpoint returns flat format
    expect(statusJson).toHaveProperty('ok', true);
    expect(statusJson).toHaveProperty('buildId', 'triangle-extended-v1.5');
    expect(statusJson).toHaveProperty('brandId');
    expect(statusJson).toHaveProperty('timestamp');
  });

  test('Flow 6: Shortlink redirect', async ({ page, context }) => {
    // This test requires a pre-created shortlink
    // For now, we'll test the redirect mechanism structure

    await page.goto(`${BASE_URL}?page=r&t=invalid-token`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Should show "not found" message
    await expect(page.locator('h1')).toContainText(/not found|invalid/i);
  });

  test('Flow 7: Responsive design - Mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Should be readable on mobile
    await expect(page.locator('h1')).toBeVisible();

    // Check that events grid is single column on mobile
    const gridCols = await page.locator('.events-grid').evaluate(el =>
      window.getComputedStyle(el).gridTemplateColumns
    );

    // On mobile, should be single column (roughly matches "1fr")
    expect(gridCols).not.toContain('minmax'); // Desktop uses minmax
  });

  test('Flow 8: Accessibility - Keyboard navigation', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Tab through form fields
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Should be able to focus on form inputs
    const focusedElement = await page.evaluate(() => document.activeElement.tagName);
    expect(['INPUT', 'TEXTAREA', 'BUTTON']).toContain(focusedElement);
  });
});

test.describe('Security Tests', () => {

  test('Should reject API calls without admin key', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Attempt to create event without admin key
    page.on('dialog', async dialog => {
      await dialog.dismiss(); // Cancel the prompt
    });

    await page.fill('#name', 'Unauthorized Test');
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    // Should show error
    await expect(page.locator('text=/error|invalid/i')).toBeVisible({ timeout: 5000 });
  });

  test('Should sanitize XSS attempts in event name', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const xssPayload = '<script>alert("XSS")</script>';
    await page.fill('#name', xssPayload);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Verify event name is escaped (no script tag executed)
    const eventInfo = await page.locator('#eventInfo').textContent();
    expect(eventInfo).not.toContain('<script>');
  });
});

test.describe('Performance Tests', () => {

  test('Status endpoint should respond within 500ms', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}?page=status`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(500);
  });

  test('Public page should load within 3 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(3000);
  });
});
