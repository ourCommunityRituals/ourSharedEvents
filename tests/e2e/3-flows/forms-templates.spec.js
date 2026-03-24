/**
 * FLOW TESTS - Google Forms Template Creation
 *
 * Purpose: Test end-to-end flow of creating forms from templates
 * Run Time: ~2-3 minutes
 *
 * User Journey:
 * 1. Admin creates/selects event
 * 2. Opens Forms Templates panel
 * 3. Creates forms from templates (check-in, walk-in, survey)
 * 4. Verifies shortlinks are generated
 * 5. Verifies copy functionality works
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:flows
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:flows
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

test.describe('Google Forms Templates Flow', () => {
  let eventId;

  test.beforeAll(async ({ request }) => {
    // Create a test event for form template testing
    const response = await request.post(`${BASE_URL}`, {
      params: {
        action: 'create'
      },
      data: {
        brandId: BRAND_ID,
        scope: 'events',
        templateId: 'event',
        adminKey: ADMIN_KEY,
        data: {
          name: `Forms Template Test Event ${Date.now()}`,
          dateISO: new Date().toISOString().split('T')[0],
          location: 'Test Venue'
        }
      }
    });

    const json = await response.json();
    expect(json.ok).toBe(true);
    eventId = json.value.id;
  });

  test('Admin can open Forms Templates panel', async ({ page }) => {
    // Navigate to admin page with the test event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}&p=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for page to load
    await expect(page.locator('main#app')).toBeVisible();

    // Click "Create Forms from Templates" button
    await expect(page.locator('button:has-text("Create Forms from Templates")')).toBeVisible();
    await page.locator('button:has-text("Create Forms from Templates")').click();

    // Verify Forms Templates card is visible
    await expect(page.locator('#formsCard')).toBeVisible();
    await expect(page.locator('h2:has-text("Google Forms Templates")')).toBeVisible();
  });

  test('Check-in form template creates form with shortlink', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}&p=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await expect(page.locator('main#app')).toBeVisible();

    // Open Forms Templates panel
    await page.locator('button:has-text("Create Forms from Templates")').click();
    await expect(page.locator('#formsCard')).toBeVisible();

    // Click "Create Check-In Form" button
    await page.locator('button:has-text("Create Check-In Form")').click();

    // Wait for form creation (this may take a few seconds)
    await page.waitForTimeout(3000);

    // Verify shortlink is displayed
    await expect(page.locator('#check-in-shortlink')).toBeVisible();

    // Verify the shortlink value is not empty
    const shortlinkValue = await page.locator('#check-in-shortlink').inputValue();
    expect(shortlinkValue).toContain(BASE_URL);
    expect(shortlinkValue).toContain('?page=r&t=');

    // Verify "Edit Form" link is visible
    await expect(page.locator('a:has-text("Edit Form")')).toBeVisible();

    // Verify "View Responses" link is visible
    await expect(page.locator('a:has-text("View Responses")')).toBeVisible();
  });

  test('Walk-in form template creates form with shortlink', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}&p=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.locator('button:has-text("Create Forms from Templates")').click();
    await expect(page.locator('#formsCard')).toBeVisible();

    // Click "Create Walk-In Form" button
    await page.locator('button:has-text("Create Walk-In Form")').click();
    await page.waitForTimeout(3000);

    // Verify shortlink is displayed
    await expect(page.locator('#walk-in-shortlink')).toBeVisible();
    const shortlinkValue = await page.locator('#walk-in-shortlink').inputValue();
    expect(shortlinkValue).toContain(BASE_URL);
    expect(shortlinkValue).toContain('?page=r&t=');
  });

  test('Survey form template creates form with shortlink', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}&p=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.locator('button:has-text("Create Forms from Templates")').click();
    await expect(page.locator('#formsCard')).toBeVisible();

    // Click "Create Survey Form" button
    await page.locator('button:has-text("Create Survey Form")').click();
    await page.waitForTimeout(3000);

    // Verify shortlink is displayed
    await expect(page.locator('#survey-shortlink')).toBeVisible();
    const shortlinkValue = await page.locator('#survey-shortlink').inputValue();
    expect(shortlinkValue).toContain(BASE_URL);
    expect(shortlinkValue).toContain('?page=r&t=');
  });

  test('Copy button functionality works', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}&p=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.locator('button:has-text("Create Forms from Templates")').click();

    // Use existing check-in form or create new one
    const checkInShortlink = page.locator('#check-in-shortlink');
    if (!(await checkInShortlink.isVisible())) {
      await page.locator('button:has-text("Create Check-In Form")').click();
      await page.waitForTimeout(3000);
    }

    // Get the shortlink value before copying
    const originalValue = await checkInShortlink.inputValue();

    // Click copy button
    await page.locator('button:has-text("Copy Shortlink")').first().click();

    // Verify input shows "Copied!" temporarily
    await expect(checkInShortlink).toHaveValue('Copied!');

    // Wait for it to revert back
    await page.waitForTimeout(1500);
    await expect(checkInShortlink).toHaveValue(originalValue);
  });

  test('Forms Templates panel can be closed', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}&p=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.locator('button:has-text("Create Forms from Templates")').click();
    await expect(page.locator('#formsCard')).toBeVisible();

    // Click "Close" button
    await page.locator('#formsCard button:has-text("Close")').click();

    // Verify panel is hidden
    await expect(page.locator('#formsCard')).toBeHidden();
  });

  test('Form creation requires an event to be selected', async ({ page }) => {
    // Navigate to admin page without selecting an event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}&p=events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Clear any selected event (if there is one)
    await page.evaluate(() => {
      window.currentEventId = null;
    });

    await page.locator('button:has-text("Create Forms from Templates")').click();
    await page.locator('button:has-text("Create Check-In Form")').click();

    // Should show alert
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Please select or create an event first');
      await dialog.accept();
    });
  });
});
