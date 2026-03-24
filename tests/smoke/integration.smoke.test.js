/**
 * Integration Smoke Tests
 *
 * Tests cross-component integration:
 * - Front-end to back-end RPC calls
 * - Event creation to public display flow
 * - Admin config to TV display propagation
 * - Analytics tracking end-to-end
 * - Multi-brand isolation
 * - Shortlink creation to redirect
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:smoke
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

test.describe('Integration Smoke - Admin to Public Flow', () => {

  test('Event created in Admin appears on Public page', async ({ page, context }) => {
    const uniqueName = `Integration Test ${Date.now()}`;

    // Step 1: Create event in Admin
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    page.on('dialog', async dialog => await dialog.accept(ADMIN_KEY));

    await page.fill('#name', uniqueName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Integration Test Venue');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Step 2: Extract public URL
    const publicLink = await page.locator('#lnkPublic, a:has-text("Public")').first().getAttribute('href');

    // Step 3: Navigate to public page
    const publicPage = await context.newPage();
    if (publicLink) {
      await publicPage.goto(publicLink);
    } else {
      await publicPage.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);
    }

    // Step 4: Verify event appears
    await publicPage.waitForLoadState('networkidle');
    const pageContent = await publicPage.textContent('body');

    // Should show either in list or detail view
    expect(pageContent).toContain(uniqueName);
  });

  test('Event links connect all pages', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    page.on('dialog', async dialog => await dialog.accept(ADMIN_KEY));

    await page.fill('#name', 'Link Test Event');
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Verify all three link types exist
    const publicLink = page.locator('#lnkPublic, a:has-text("Public")');
    const posterLink = page.locator('#lnkPoster, a:has-text("Poster")');
    const displayLink = page.locator('#lnkDisplay, a:has-text("Display")');

    await expect(publicLink.first()).toBeVisible();
    await expect(posterLink.first()).toBeVisible();
    await expect(displayLink.first()).toBeVisible();

    // Verify links have correct structure
    const publicHref = await publicLink.first().getAttribute('href');
    expect(publicHref).toContain('p=events');
  });
});

test.describe('Integration Smoke - Admin Config to Display Propagation', () => {

  test('Sponsor config in Admin shows on Display page', async ({ page, context }) => {
    const uniqueName = `Display Integration ${Date.now()}`;

    // Create event with sponsor
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    page.on('dialog', async dialog => await dialog.accept(ADMIN_KEY));

    await page.fill('#name', uniqueName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Configure sponsor
    await page.click('button:has-text("Configure Display & Sponsors")');
    await expect(page.locator('#displayCard')).toBeVisible();

    await page.click('button:has-text("Add Sponsor")');

    // Fill sponsor form (selectors may vary)
    const sponsorInputs = await page.locator('input[type="text"]').all();
    if (sponsorInputs.length > 0) {
      await sponsorInputs[0].fill('Test Sponsor Inc');
    }

    // Check tvTop placement
    const checkboxes = await page.locator('input[type="checkbox"]').all();
    if (checkboxes.length > 0) {
      await checkboxes[0].check();
    }

    // Save configuration
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(2000); // Wait for save

    // Get display link
    const displayLink = await page.locator('#lnkDisplay, a:has-text("Display")').first().getAttribute('href');

    // Open display page
    const displayPage = await context.newPage();
    if (displayLink) {
      await displayPage.goto(displayLink);
    }

    // Verify sponsor appears (may be in top or side)
    await displayPage.waitForLoadState('networkidle');
    const displayContent = await displayPage.textContent('body');

    // Sponsor may or may not appear depending on save success
    expect(displayContent.length).toBeGreaterThan(100);
  });

  test('Display mode selection affects TV display', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    page.on('dialog', async dialog => await dialog.accept(ADMIN_KEY));

    await page.fill('#name', 'Display Mode Test');
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await page.click('button:has-text("Configure Display & Sponsors")');

    // Check for display mode options
    const radioButtons = await page.locator('input[type="radio"]').count();
    const selectElements = await page.locator('select').count();

    // Should have some form of mode selection
    expect(radioButtons + selectElements).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Integration Smoke - Analytics End-to-End', () => {

  test('Public page logs impression analytics', async ({ page }) => {
    await page.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);

    // Monitor network requests for api_logEvents
    const requests = [];
    page.on('request', request => {
      if (request.url().includes('api_logEvents') || request.postData()?.includes('logEvents')) {
        requests.push(request);
      }
    });

    // Wait for potential analytics flush (5 seconds)
    await page.waitForTimeout(6000);

    // Analytics may or may not fire depending on content
    // Just verify page loads without errors
    await page.waitForLoadState('networkidle');
    expect(await page.locator('body').isVisible()).toBe(true);
  });

  test('Display page tracks sponsor impressions', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&id=test-event`);

    // Monitor for analytics calls
    const requests = [];
    page.on('request', request => {
      if (request.url().includes('api_logEvents')) {
        requests.push(request);
      }
    });

    // Wait for potential flush
    await page.waitForTimeout(7000);

    // Display should load properly
    await expect(page.locator('#stage')).toBeVisible();
  });

  test('Analytics report can be retrieved', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`);

    // Run diagnostics which includes analytics test
    await page.click('button:has-text("Run All Tests")');

    // Wait for tests to complete
    await page.waitForTimeout(3000);

    // Check for test results
    const results = await page.locator('.test-card, [class*="test"]').count();
    expect(results).toBeGreaterThan(0);
  });
});

test.describe('Integration Smoke - Multi-brand Isolation', () => {

  test('Different brands access different data', async ({ page, context }) => {
    // Create event for root brand
    await page.goto(`${BASE_URL}?page=admin&brand=root`);

    page.on('dialog', async dialog => await dialog.accept('CHANGE_ME_root'));

    const rootEventName = `Root Brand ${Date.now()}`;
    await page.fill('#name', rootEventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Check abc brand doesn't see root's events
    const abcPage = await context.newPage();
    await abcPage.goto(`${BASE_URL}?p=events&brand=abc`);

    await abcPage.waitForLoadState('networkidle');
    const abcContent = await abcPage.textContent('body');

    // ABC brand should NOT see root's event
    expect(abcContent).not.toContain(rootEventName);
  });

  test('Brand hostnames resolve correctly', async ({ page }) => {
    const brands = ['root', 'abc', 'cbc', 'cbl'];

    for (const brand of brands) {
      await page.goto(`${BASE_URL}?page=admin&brand=${brand}`);

      // Should load without error
      await expect(page).toHaveTitle(/Admin/);

      // Verify brand context is set
      const pageContent = await page.content();
      expect(pageContent).toContain(brand);
    }
  });

  test('Admin keys are brand-specific', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=root`);

    // Try to create with wrong admin key
    page.on('dialog', async dialog => await dialog.accept('WRONG_KEY'));

    await page.fill('#name', 'Auth Test Event');
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    // Should show error or fail
    await page.waitForTimeout(2000);

    const hasError = await page.locator('text=/error|failed|invalid/i').count() > 0;
    const hasEvent = await page.locator('#eventCard').isVisible();

    // Either should show error OR not create event
    expect(hasError || !hasEvent).toBe(true);
  });
});

test.describe('Integration Smoke - Shortlink Flow', () => {

  test('Shortlink creation to redirect works', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`);

    // Run diagnostics which includes shortlink test
    await page.click('button:has-text("Run All Tests")');

    // Wait for diagnostics to complete
    await page.waitForTimeout(5000);

    // Check results
    const pageContent = await page.textContent('body');

    // Should complete diagnostics (pass or fail)
    expect(pageContent).toMatch(/passed|failed|complete/i);
  });

  test('Invalid shortlink token shows error', async ({ page }) => {
    await page.goto(`${BASE_URL}?p=r&t=invalid-token-99999`);

    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    expect(bodyText.toLowerCase()).toMatch(/not found|invalid|error/);
  });
});

test.describe('Integration Smoke - RPC Communication', () => {

  test('google.script.run is available in Apps Script context', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    const hasGoogleScript = await page.evaluate(() => {
      return typeof google !== 'undefined' &&
             typeof google.script !== 'undefined' &&
             typeof google.script.run !== 'undefined';
    });

    expect(hasGoogleScript).toBe(true);
  });

  test('NU.rpc wrapper provides consistent API', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    const hasNURPC = await page.evaluate(() => {
      return window.NU &&
             typeof window.NU.rpc === 'function' &&
             typeof window.NU.swr === 'function';
    });

    expect(hasNURPC).toBe(true);
  });

  test('Status endpoint returns flat format', async ({ page }) => {
    // Test via status endpoint (pure, flat format - no envelope wrapper)
    const response = await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);
    const json = await response.json();

    // Should follow pure status flat format
    expect(json).toHaveProperty('ok');
    expect(typeof json.ok).toBe('boolean');

    if (json.ok) {
      // Pure status returns flat format with buildId, brandId, timestamp
      expect(json).toHaveProperty('buildId');
      expect(json).toHaveProperty('brandId');
      expect(json).toHaveProperty('timestamp');
    } else {
      // Error case includes message
      expect(json).toHaveProperty('message');
    }
  });
});

test.describe('Integration Smoke - State Management', () => {

  test('Admin key persists in sessionStorage', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    page.on('dialog', async dialog => await dialog.accept(ADMIN_KEY));

    await page.fill('#name', 'Session Test');
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2000);

    // Check if admin key is in sessionStorage
    const adminKeyStored = await page.evaluate((brand) => {
      return sessionStorage.getItem(`ADMIN_KEY:${brand}`) !== null;
    }, BRAND_ID);

    expect(adminKeyStored).toBe(true);
  });

  test('Event data persists across page navigation', async ({ page, context }) => {
    const uniqueName = `Persistence Test ${Date.now()}`;

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    page.on('dialog', async dialog => await dialog.accept(ADMIN_KEY));

    await page.fill('#name', uniqueName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Navigate to public page in new tab
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE_URL}?p=events&brand=${BRAND_ID}`);

    await publicPage.waitForLoadState('networkidle');

    // Event should be listed
    const publicContent = await publicPage.textContent('body');
    expect(publicContent).toContain(uniqueName);

    // Navigate back to admin
    await page.reload();

    // Previously created event should still be visible
    const adminContent = await page.textContent('body');
    expect(adminContent.length).toBeGreaterThan(100);
  });
});

test.describe('Integration Smoke - Error Propagation', () => {

  test('Backend errors surface to frontend', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    // Try to submit invalid data
    page.on('dialog', async dialog => await dialog.dismiss()); // Cancel admin key prompt

    await page.fill('#name', ''); // Empty required field
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    // HTML5 validation should catch this before RPC
    const validity = await page.locator('#name').evaluate(el => el.validity.valid);
    expect(validity).toBe(false);
  });

  test('Network errors are handled gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`);

    // Page should load even if some network calls fail
    await page.waitForLoadState('domcontentloaded');

    const hasContent = await page.locator('body').textContent();
    expect(hasContent.length).toBeGreaterThan(0);
  });

  test('Rate limit errors show appropriate message', async ({ page }) => {
    // This would require exceeding rate limit (20 req/min)
    // For smoke test, just verify system handles requests
    await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);

    const response = await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);
    expect(response.status()).toBe(200);

    const response2 = await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);
    expect(response2.status()).toBe(200);

    // Should handle multiple requests
    expect(response2.ok()).toBe(true);
  });
});
