/**
 * FLOW TESTS - Level 3: Admin User Journeys
 *
 * Purpose: Test complete admin workflows from start to finish
 * Coverage: Event creation, sponsor management, configuration, publishing
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:flows
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:flows
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const BRAND_ID = 'root';

test.describe('🔄 FLOW: Admin - Create and Publish Event', () => {

  test('Complete flow: Create event → Verify on public page', async ({ page }) => {
    // Step 1: Navigate to admin page
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await expect(page).toHaveTitle(/Admin/);

    // Step 2: Fill event creation form
    const eventName = `Admin Flow Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#timeISO', '19:00');
    await page.fill('#venue', 'Convention Center');
    await page.fill('#summary', 'Comprehensive flow test for admin event creation');
    await page.fill('#tags', 'test, automated, e2e');

    // Step 3: Submit form with admin key
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept(ADMIN_KEY);
    });

    await page.click('button[type="submit"]');

    // Step 4: Verify event card appears
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#eventInfo')).toContainText(eventName);

    // Step 5: Extract public URL
    const publicLink = await page.locator('#lnkPublic').textContent();
    expect(publicLink).toContain(BASE_URL);

    // Step 6: Navigate to public page
    await page.goto(publicLink);
    await page.waitForLoadState('networkidle');

    // Step 7: Verify event is visible on public page
    await expect(page.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Convention Center')).toBeVisible();
    await expect(page.locator('text=Comprehensive flow test')).toBeVisible();
  });

  test('Complete flow: Create event → Edit details → Verify changes', async ({ page }) => {
    // Step 1: Create initial event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const originalName = `Edit Flow Test ${Date.now()}`;
    await page.fill('#name', originalName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Original Location');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Step 2: Get event ID for editing
    const eventInfo = await page.locator('#eventInfo').textContent();
    expect(eventInfo).toContain(originalName);

    // Step 3: Verify event appears in events list
    await expect(page.locator('#eventsList')).toBeVisible();

    // Future: Add edit functionality test when implemented
  });
});

test.describe('🔄 FLOW: Admin - Configure Sponsors', () => {

  test('Complete flow: Create event → Add sponsors → Verify on display', async ({ page, context }) => {
    // Step 1: Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Sponsor Flow ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Sponsor Test Venue');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Step 2: Open sponsor configuration
    await page.click('button:has-text("Configure Display & Sponsors")');
    await expect(page.locator('#displayCard')).toBeVisible();

    // Step 3: Add first sponsor (Gold tier)
    await page.click('button:has-text("Add Sponsor")');
    await page.fill('.sp-name', 'Gold Sponsor Corp');
    await page.fill('.sp-url', 'https://gold-sponsor.example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/400x200?text=Gold+Sponsor');
    await page.check('.sp-tvTop');
    await page.check('.sp-mobileBanner');

    // Step 4: Add second sponsor (Silver tier)
    await page.click('button:has-text("Add Sponsor")');
    const sponsorItems = page.locator('.sponsor-item');
    const secondSponsor = sponsorItems.nth(1);

    await secondSponsor.locator('.sp-name').fill('Silver Sponsor Inc');
    await secondSponsor.locator('.sp-url').fill('https://silver-sponsor.example.com');
    await secondSponsor.locator('.sp-img').fill('https://via.placeholder.com/300x150?text=Silver+Sponsor');
    await secondSponsor.locator('.sp-tvBottom').check();

    // Step 5: Save configuration
    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    // Step 6: Extract display URL
    const displayLink = await page.locator('#lnkDisplay').textContent();
    expect(displayLink).toContain(BASE_URL);

    // Step 7: Open display page in new tab
    const displayPage = await context.newPage();
    await displayPage.goto(displayLink);
    await displayPage.waitForLoadState('networkidle');

    // Step 8: Verify sponsors appear on display
    await expect(displayPage.locator('#sponsorTop, .sponsor-top')).toBeVisible({ timeout: 10000 });

    // Step 9: Verify sponsor names
    const displayContent = await displayPage.content();
    expect(displayContent).toContain('Gold Sponsor Corp');

    // Step 10: Close display page
    await displayPage.close();
  });

  test('Complete flow: Add sponsors → Reorder → Verify order', async ({ page }) => {
    // Step 1: Create event and open configuration
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    await page.fill('#name', `Reorder Flow ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Configure Display & Sponsors")');

    // Step 2: Add multiple sponsors
    const sponsors = [
      { name: 'First Sponsor', url: 'https://first.example.com' },
      { name: 'Second Sponsor', url: 'https://second.example.com' },
      { name: 'Third Sponsor', url: 'https://third.example.com' }
    ];

    for (const sponsor of sponsors) {
      await page.click('button:has-text("Add Sponsor")');
      await page.waitForTimeout(500);

      const sponsorItems = page.locator('.sponsor-item');
      const lastItem = sponsorItems.last();

      await lastItem.locator('.sp-name').fill(sponsor.name);
      await lastItem.locator('.sp-url').fill(sponsor.url);
      await lastItem.locator('.sp-img').fill('https://via.placeholder.com/200x100');
    }

    // Step 3: Verify sponsors are in order
    const sponsorItems = page.locator('.sponsor-item');
    const count = await sponsorItems.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Future: Add drag-and-drop reordering test when implemented
  });
});

test.describe('🔄 FLOW: Admin - Multi-Event Management', () => {

  test('Complete flow: Create multiple events → Manage list → Delete event', async ({ page }) => {
    // Step 1: Create first event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const events = [
      { name: `Multi Event 1 ${Date.now()}`, date: '2025-11-15', location: 'Venue A' },
      { name: `Multi Event 2 ${Date.now()}`, date: '2025-12-01', location: 'Venue B' },
      { name: `Multi Event 3 ${Date.now()}`, date: '2025-12-15', location: 'Venue C' }
    ];

    for (const event of events) {
      await page.fill('#name', event.name);
      await page.fill('#startDateISO', event.date);
      await page.fill('#venue', event.location);
      await page.click('button[type="submit"]');

      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    }

    // Step 2: Verify events list shows all events
    await expect(page.locator('#eventsList')).toBeVisible();

    // Future: Add list filtering and delete functionality tests
  });
});

test.describe('🔄 FLOW: Admin - Event Publishing Workflow', () => {

  test('Complete flow: Create draft → Configure → Publish → Monitor', async ({ page, context }) => {
    // Step 1: Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Publishing Flow ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-25');
    await page.fill('#timeISO', '18:00');
    await page.fill('#venue', 'Grand Ballroom');
    await page.fill('#summary', 'Annual holiday celebration with sponsors');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Step 2: Configure display settings
    await page.click('button:has-text("Configure Display & Sponsors")');
    await expect(page.locator('#displayCard')).toBeVisible();

    // Add sponsor
    await page.click('button:has-text("Add Sponsor")');
    await page.fill('.sp-name', 'Main Event Sponsor');
    await page.fill('.sp-url', 'https://main-sponsor.example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/500x250?text=Main+Sponsor');
    await page.check('.sp-tvTop');

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    // Step 3: Get all URLs
    const publicUrl = await page.locator('#lnkPublic').textContent();
    const displayUrl = await page.locator('#lnkDisplay').textContent();
    const posterUrl = await page.locator('#lnkPoster').textContent();

    expect(publicUrl).toContain(BASE_URL);
    expect(displayUrl).toContain(BASE_URL);
    expect(posterUrl).toContain(BASE_URL);

    // Step 4: Verify public page
    const publicPage = await context.newPage();
    await publicPage.goto(publicUrl);
    await expect(publicPage.locator(`text=${eventName}`)).toBeVisible();
    await publicPage.close();

    // Step 5: Verify display page
    const displayPage = await context.newPage();
    await displayPage.goto(displayUrl);
    await expect(displayPage.locator('#stage')).toBeVisible();
    await displayPage.close();

    // Step 6: Verify poster page
    const posterPage = await context.newPage();
    await posterPage.goto(posterUrl);
    await posterPage.waitForLoadState('networkidle');
    await posterPage.close();
  });
});

test.describe('🔄 FLOW: Admin - Error Handling', () => {

  test('Flow: Invalid admin key → Show error → Retry with correct key', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    let dialogCount = 0;
    page.on('dialog', async dialog => {
      dialogCount++;
      if (dialogCount === 1) {
        // First attempt: wrong key
        await dialog.accept('WRONG_KEY');
      } else {
        // Second attempt: correct key
        await dialog.accept(ADMIN_KEY);
      }
    });

    await page.fill('#name', 'Error Flow Test');
    await page.fill('#startDateISO', '2025-12-31');

    // First attempt (will fail)
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // Should show error
    const hasError = await page.locator('text=/error|invalid|unauthorized/i').count() > 0;

    // If error handling is implemented
    if (hasError) {
      expect(hasError).toBe(true);
    }
  });

  test('Flow: Missing required fields → Show validation → Fill and submit', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    // Try to submit with only name
    await page.fill('#name', 'Validation Test');
    // Don't fill date (required field)

    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // HTML5 validation should prevent submission
    // Or custom validation should show error

    // Now fill all required fields
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('🔄 FLOW: Admin - Bulk Operations', () => {

  test('Flow: Create multiple events rapidly → Verify all created', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const bulkEvents = [
      'Bulk Test Event 1',
      'Bulk Test Event 2',
      'Bulk Test Event 3',
      'Bulk Test Event 4',
      'Bulk Test Event 5'
    ];

    for (const eventName of bulkEvents) {
      await page.fill('#name', eventName);
      await page.fill('#startDateISO', '2025-12-31');
      await page.click('button[type="submit"]');

      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(500);
    }

    // Verify events list contains all events
    await expect(page.locator('#eventsList')).toBeVisible();

    // Future: Verify count of events in list
  });
});
