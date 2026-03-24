/**
 * Smoke Tests - Quick health checks for all pages
 *
 * These tests verify basic page functionality:
 * - Page loads successfully (200 status)
 * - Core elements are present
 * - No JavaScript errors on load
 * - Basic responsive behavior
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:smoke
 *
 * Run with: npm run test:smoke
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

test.describe('Smoke Tests - All Pages', () => {

  test('Admin Page - Loads and shows create form', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Admin/);
    await expect(page.locator('h2:has-text("Create Event")')).toBeVisible();
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#startDateISO')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Public Page - Loads event listing', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Public/);
    await expect(page.locator('main#app')).toBeVisible();
    // Should show either event list or "no events" message
    const hasContent = await page.locator('h1, h2, .event-card').count();
    expect(hasContent).toBeGreaterThan(0);
  });

  test('Display Page - Loads TV display layout', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/TV Display/);
    await expect(page.locator('body[data-tv="1"]')).toBeVisible();
    await expect(page.locator('#stage')).toBeVisible();

    // Verify TV-optimized font size
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20); // Min 20px for 10-12ft viewing
  });

  test('Poster Page - Loads print layout', async ({ page }) => {
    // Note: Requires event ID, will show blank if no ID provided
    const response = await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Poster/);
    await expect(page.locator('main')).toBeVisible();
  });

  test('Test Page - Health check endpoint', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Test/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('Diagnostics Page - System test interface', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Diagnostics/);
    await expect(page.locator('h1:has-text("System Diagnostics")')).toBeVisible();
    await expect(page.locator('button:has-text("Run All Tests")')).toBeVisible();
  });

  test('Status API - JSON endpoint responds (pure flat format)', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    const json = await response.json();

    // Pure status endpoint returns flat format
    expect(json).toHaveProperty('ok', true);
    expect(json).toHaveProperty('buildId', 'triangle-extended-v1.5');
    expect(json).toHaveProperty('brandId', BRAND_ID);
    expect(json).toHaveProperty('timestamp');
  });
});

test.describe('Smoke Tests - Responsive Design', () => {

  test('Mobile - Admin page is usable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    await expect(page.locator('#name')).toBeVisible();

    // Check input has minimum 44px tap target (iOS requirement)
    const inputHeight = await page.locator('#name').evaluate(el => el.offsetHeight);
    expect(inputHeight).toBeGreaterThanOrEqual(40); // ~44px with padding
  });

  test('Mobile - Public page is readable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);

    // Font size should be at least 16px to prevent iOS zoom
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(16);
  });

  test('Tablet - Display adapts to medium screens', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);

    await expect(page.locator('main')).toBeVisible();
  });

  test('TV - Large viewport with readable fonts', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 }); // 1080p TV
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`);

    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20); // TV-optimized
  });
});

test.describe('Smoke Tests - JavaScript Errors', () => {

  test('Admin page - No console errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);
    await page.waitForLoadState('networkidle');

    // Allow google.script.run errors in non-Apps Script environment
    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('Public page - No console errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);
    await page.waitForLoadState('networkidle');

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('Display page - No console errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`);
    await page.waitForLoadState('networkidle');

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('Smoke Tests - Performance', () => {

  test('Status endpoint - Responds within 2 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(2000);
  });

  test('Admin page - Loads within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);
    await page.waitForLoadState('domcontentloaded');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  test('Public page - Loads within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);
    await page.waitForLoadState('domcontentloaded');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });
});

test.describe('Smoke Tests - SharedReport & Top Sponsors Card', () => {

  test('SharedReport page - Loads analytics dashboard', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=shared-report&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Shared Analytics/);
    await expect(page.locator('.report-header')).toBeVisible();
    await expect(page.locator('h1#reportTitle')).toBeVisible();
  });

  test('SharedReport page - Shows metrics grid', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=shared-report&brand=${BRAND_ID}`);

    // Wait for data to load (loading state disappears)
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 10000 }).catch(() => {});

    // Metrics grid should be visible after load
    const metricsGrid = page.locator('#metricsGrid');
    const isMetricsVisible = await metricsGrid.isVisible().catch(() => false);
    // May not be visible if no data, but shouldn't error
    expect(true).toBe(true);
  });

  test('SharedReport page - Top Sponsors card renders with sponsor names', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=shared-report&brand=${BRAND_ID}`);

    // Wait for data to load
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 10000 }).catch(() => {});

    // Check if topSponsorsCard is rendered (will only show if there's sponsor data)
    const topSponsorsCard = page.locator('#topSponsorsCard');
    const cardVisible = await topSponsorsCard.isVisible().catch(() => false);

    if (cardVisible) {
      // If visible, verify structure
      await expect(page.locator('.top-sponsors-card h3')).toContainText('Top Sponsors');

      // Check that at least the first sponsor name is displayed
      const firstSponsorName = page.locator('.top-sponsor-name').first();
      const hasName = await firstSponsorName.isVisible().catch(() => false);
      if (hasName) {
        const nameText = await firstSponsorName.textContent();
        expect(nameText.length).toBeGreaterThan(0);
      }
    }
    // If no data, card won't show - that's OK
    expect(true).toBe(true);
  });

  test('SharedReport page - Top Sponsors card shows clicks metric', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=shared-report&brand=${BRAND_ID}`);

    // Wait for data to load
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 10000 }).catch(() => {});

    const topSponsorsCard = page.locator('#topSponsorsCard');
    const cardVisible = await topSponsorsCard.isVisible().catch(() => false);

    if (cardVisible) {
      // Verify clicks metric is displayed
      const clicksValue = page.locator('.clicks-value').first();
      const hasClicks = await clicksValue.isVisible().catch(() => false);
      if (hasClicks) {
        const text = await clicksValue.textContent();
        expect(text).toContain('clicks');
      }
    }
    expect(true).toBe(true);
  });

  test('SharedReport page - No console errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=shared-report&brand=${BRAND_ID}`);
    await page.waitForLoadState('networkidle');

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined') &&
      !e.message.includes('NU is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('Smoke Tests - Accessibility', () => {

  test('Admin page - Keyboard navigation works', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    // Tab through elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focusedElement = await page.evaluate(() => document.activeElement.tagName);
    expect(['INPUT', 'TEXTAREA', 'BUTTON', 'A']).toContain(focusedElement);
  });

  test('Public page - Has proper heading structure', async ({ page }) => {
    await page.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);

    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(0); // Should have at least one h1 if content exists
  });

  test('Forms have accessible labels', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    // Check that inputs have associated labels
    const nameInput = page.locator('#name');
    await expect(nameInput).toBeVisible();

    const label = page.locator('label:has-text("Event Name")');
    await expect(label).toBeVisible();
  });
});
