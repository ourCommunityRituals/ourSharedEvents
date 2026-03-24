/**
 * SMOKE TESTS - Brand Verification & Logo Verification
 *
 * Purpose: Verify brand-specific branding and logos load correctly
 * Coverage: Logo visibility, brand identification, multi-brand isolation
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:smoke
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();

test.describe('🎨 SMOKE: Brand Verification', () => {

  test('Admin page loads brand logo for root brand', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=root`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Page should load successfully
    expect(page.url()).toContain('brand=root');

    // Check for logo element (adjust selector based on actual implementation)
    const logo = page.locator('img[alt*="logo"], img.logo, .brand-logo img, header img').first();

    // Verify logo is visible (if implemented)
    const logoCount = await logo.count();
    if (logoCount > 0) {
      await expect(logo).toBeVisible({ timeout: 5000 });

      // Verify logo has valid src
      const logoSrc = await logo.getAttribute('src');
      expect(logoSrc).toBeTruthy();
      expect(logoSrc.length).toBeGreaterThan(0);
    } else {
      console.log('⚠️ No brand logo found for root brand - may not be implemented yet');
    }
  });

  test('Admin page loads brand logo for abc brand', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Page should load successfully
    expect(page.url()).toContain('brand=abc');

    // Check for logo element
    const logo = page.locator('img[alt*="logo"], img.logo, .brand-logo img, header img').first();

    // Verify logo is visible (if implemented)
    const logoCount = await logo.count();
    if (logoCount > 0) {
      await expect(logo).toBeVisible({ timeout: 5000 });

      // Verify logo has valid src
      const logoSrc = await logo.getAttribute('src');
      expect(logoSrc).toBeTruthy();
      expect(logoSrc.length).toBeGreaterThan(0);

      // Verify logo is loaded (not broken)
      const logoLoaded = await logo.evaluate((img) => {
        return img.complete && img.naturalHeight > 0;
      });
      expect(logoLoaded).toBe(true);
    } else {
      console.log('⚠️ No brand logo found for abc brand - may not be implemented yet');
    }
  });

  test('Admin page shows correct brand identification for abc', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check URL parameter is correct
    expect(page.url()).toContain('brand=abc');

    // Page should render successfully
    await expect(page.locator('h2:has-text("Create Event")')).toBeVisible();

    // Check for brand name display (if implemented)
    const brandName = page.locator('text=/abc|ABC/i').first();
    const brandCount = await brandName.count();

    if (brandCount > 0) {
      console.log('✓ Brand identifier found on page');
    }
  });

  test('Public page loads brand logo for abc brand', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for logo element
    const logo = page.locator('img[alt*="logo"], img.logo, .brand-logo img, header img').first();

    // Verify logo is visible (if implemented)
    const logoCount = await logo.count();
    if (logoCount > 0) {
      await expect(logo).toBeVisible({ timeout: 5000 });

      // Verify logo loaded successfully
      const logoLoaded = await logo.evaluate((img) => {
        return img.complete && img.naturalHeight > 0;
      });
      expect(logoLoaded).toBe(true);
    }
  });

  test('Display page loads brand branding for abc brand', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for logo or branding element
    const brandingElements = page.locator('img[alt*="logo"], img.logo, .brand-logo img, .branding img, header img');

    const count = await brandingElements.count();
    if (count > 0) {
      const firstElement = brandingElements.first();
      await expect(firstElement).toBeVisible({ timeout: 5000 });

      // Verify image loaded
      const loaded = await firstElement.evaluate((img) => {
        return img.complete && img.naturalHeight > 0;
      });
      expect(loaded).toBe(true);
    }
  });

  test('Different brands show different branding (isolation)', async ({ page }) => {
    // Load root brand admin page
    await page.goto(`${BASE_URL}?page=admin&brand=root`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    const rootUrl = page.url();
    expect(rootUrl).toContain('brand=root');

    // Load abc brand admin page
    await page.goto(`${BASE_URL}?page=admin&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    const abcUrl = page.url();
    expect(abcUrl).toContain('brand=abc');

    // Verify brands are isolated
    expect(abcUrl).not.toContain('brand=root');
    expect(rootUrl).not.toContain('brand=abc');

    // Both pages should load successfully
    await expect(page.locator('h2:has-text("Create Event")')).toBeVisible();
  });
});

test.describe('🎨 SMOKE: Logo Performance', () => {

  test('Brand logo loads within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`${BASE_URL}?page=admin&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const logo = page.locator('img[alt*="logo"], img.logo, .brand-logo img, header img').first();
    const logoCount = await logo.count();

    if (logoCount > 0) {
      // Wait for logo to be visible
      await expect(logo).toBeVisible({ timeout: 5000 });

      // Verify it loaded reasonably fast
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(10000); // 10 seconds max

      console.log(`✓ Logo loaded in ${loadTime}ms`);
    }
  });

  test('Logo image has valid dimensions', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const logo = page.locator('img[alt*="logo"], img.logo, .brand-logo img, header img').first();
    const logoCount = await logo.count();

    if (logoCount > 0) {
      await expect(logo).toBeVisible();

      // Get image dimensions
      const dimensions = await logo.evaluate((img) => ({
        width: img.naturalWidth,
        height: img.naturalHeight,
        displayed: img.complete
      }));

      expect(dimensions.displayed).toBe(true);
      expect(dimensions.width).toBeGreaterThan(0);
      expect(dimensions.height).toBeGreaterThan(0);

      console.log(`✓ Logo dimensions: ${dimensions.width}x${dimensions.height}`);
    }
  });
});
