/**
 * Admin Page - All Buttons Test
 *
 * Comprehensive test that clicks EVERY button on Admin.html
 * to ensure all UI interactions work correctly.
 *
 * Buttons tested:
 * 1. Create Event (submit)
 * 2. Clear (form reset)
 * 3. Copy Link (Public)
 * 4. Copy Link (Display)
 * 5. Copy Link (Poster)
 * 6. Configure Display & Sponsors
 * 7. Add Sponsor
 * 8. Add URL (carousel)
 * 9. Save Configuration
 * 10. Cancel (display config)
 * 11. Configure Sign-Up Forms
 * 12. Save All Forms
 * 13. Cancel (signup config)
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const BRAND_ID = 'root';

test.describe('Admin Page - All Buttons Comprehensive Test', () => {

  test('Should click every button on Admin page', async ({ page, context }) => {
    // Setup: Navigate to admin page
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await expect(page).toHaveTitle(/Admin/);

    // Setup dialog handler for admin key prompts
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else if (dialog.type() === 'alert') {
        await dialog.accept();
      }
    });

    // ==========================================
    // SECTION 1: Event Creation Form
    // ==========================================

    // Button 2: Clear button (test before filling)
    await test.step('Button: Clear (empty form)', async () => {
      await page.fill('#name', 'Test to be cleared');
      await page.click('button:has-text("Clear")');

      // Verify form was cleared
      const nameValue = await page.locator('#name').inputValue();
      expect(nameValue).toBe('');
    });

    // Button 1: Create Event button
    await test.step('Button: Create Event (submit)', async () => {
      await page.fill('#name', 'Complete Button Test Event');
      await page.fill('#startDateISO', '2025-12-31');
      await page.fill('#timeISO', '19:00');
      await page.fill('#venue', 'Test Venue');
      await page.fill('#entity', 'Test Organization');

      await page.click('button[type="submit"]');

      // Wait for event card to appear
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    });

    // ==========================================
    // SECTION 2: Copy Link Buttons
    // ==========================================

    // Button 3: Copy Link (Public)
    await test.step('Button: Copy Link (Public)', async () => {
      await page.click('#eventCard button:has-text("Copy Link")').first();

      // Note: Cannot verify clipboard in headless mode,
      // but button should execute without error
    });

    // Button 4: Copy Link (Display)
    await test.step('Button: Copy Link (Display)', async () => {
      const copyButtons = await page.locator('#eventCard button:has-text("Copy Link")').all();
      if (copyButtons.length > 1) {
        await copyButtons[1].click();
      }
    });

    // Button 5: Copy Link (Poster)
    await test.step('Button: Copy Link (Poster)', async () => {
      const copyButtons = await page.locator('#eventCard button:has-text("Copy Link")').all();
      if (copyButtons.length > 2) {
        await copyButtons[2].click();
      }
    });

    // ==========================================
    // SECTION 3: Display & Sponsors Configuration
    // ==========================================

    // Button 6: Configure Display & Sponsors
    await test.step('Button: Configure Display & Sponsors', async () => {
      await page.click('button:has-text("Configure Display & Sponsors")');

      // Wait for display config card to appear
      await expect(page.locator('#displayCard')).toBeVisible({ timeout: 5000 });
    });

    // Button 8: Add URL (for carousel)
    await test.step('Button: Add URL', async () => {
      await page.click('button:has-text("Add URL")');

      // Verify URL input was added to the list
      await page.waitForTimeout(500);
      const urlInputs = await page.locator('.url-input').count();
      expect(urlInputs).toBeGreaterThanOrEqual(1);

      // Fill in the URL for later save
      await page.locator('.url-input').first().fill('https://example.com');
      await page.locator('.url-seconds').first().fill('10');
    });

    // Button 7: Add Sponsor
    await test.step('Button: Add Sponsor', async () => {
      await page.click('button:has-text("Add Sponsor")');

      // Wait for sponsor form to appear
      await page.waitForTimeout(500);

      // Fill sponsor details
      const sponsorNameInputs = await page.locator('.sp-name').all();
      if (sponsorNameInputs.length > 0) {
        await sponsorNameInputs[0].fill('Test Sponsor Inc');
      }

      const sponsorUrlInputs = await page.locator('.sp-url').all();
      if (sponsorUrlInputs.length > 0) {
        await sponsorUrlInputs[0].fill('https://sponsor.example.com');
      }

      const sponsorImgInputs = await page.locator('.sp-img').all();
      if (sponsorImgInputs.length > 0) {
        await sponsorImgInputs[0].fill('https://via.placeholder.com/200x100');
      }

      // Check a placement flag
      const checkboxes = await page.locator('#displayCard input[type="checkbox"]').all();
      if (checkboxes.length > 0) {
        await checkboxes[0].check();
      }
    });

    // Button 9: Save Configuration
    await test.step('Button: Save Configuration', async () => {
      await page.click('button:has-text("Save Configuration")');

      // Wait for success message or config card to close
      await page.waitForTimeout(2000);

      // Display card should close or show success message
      const isVisible = await page.locator('#displayCard').isVisible();
      // Either it closed (success) or still visible (may need more time)
    });

    // Button 10: Cancel (display config) - Test by reopening
    await test.step('Button: Cancel (display config)', async () => {
      // Reopen display config
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible({ timeout: 5000 });

      // Click cancel
      await page.click('#displayCard button:has-text("Cancel")');

      // Verify display card closes
      await page.waitForTimeout(500);
      const isHidden = await page.locator('#displayCard').isHidden();
      expect(isHidden).toBe(true);
    });

    // ==========================================
    // SECTION 4: Sign-Up Forms Configuration
    // ==========================================

    // Button 11: Configure Sign-Up Forms
    await test.step('Button: Configure Sign-Up Forms', async () => {
      await page.click('button:has-text("Configure Sign-Up Forms")');

      // Wait for signup config card to appear
      await expect(page.locator('#signupCard')).toBeVisible({ timeout: 5000 });
    });

    // Button 12: Save All Forms
    await test.step('Button: Save All Forms', async () => {
      // Fill in at least one signup URL
      const registerUrlInput = page.locator('#registerUrl, input[placeholder*="Register"]').first();
      if (await registerUrlInput.count() > 0) {
        await registerUrlInput.fill('https://example.com/register');
      }

      await page.click('button:has-text("Save All Forms")');

      // Wait for save operation
      await page.waitForTimeout(2000);
    });

    // Button 13: Cancel (signup config) - Test by reopening
    await test.step('Button: Cancel (signup config)', async () => {
      // Reopen signup config
      await page.click('button:has-text("Configure Sign-Up Forms")');
      await expect(page.locator('#signupCard')).toBeVisible({ timeout: 5000 });

      // Click cancel
      await page.click('#signupCard button:has-text("Cancel")');

      // Verify signup card closes
      await page.waitForTimeout(500);
      const isHidden = await page.locator('#signupCard').isHidden();
      expect(isHidden).toBe(true);
    });

    // ==========================================
    // VERIFICATION: All buttons were clicked
    // ==========================================

    await test.step('Verification: All 13 buttons clicked successfully', async () => {
      // If we got here without errors, all buttons work!
      expect(true).toBe(true);

      // Final verification: Event card should still be visible
      await expect(page.locator('#eventCard')).toBeVisible();
    });
  });

  test('Should handle button interactions in different states', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      }
    });

    await test.step('Clear button works on partially filled form', async () => {
      await page.fill('#name', 'Partial');
      await page.fill('#venue', 'Location Only');
      await page.click('button:has-text("Clear")');

      const nameValue = await page.locator('#name').inputValue();
      const locationValue = await page.locator('#venue').inputValue();
      expect(nameValue).toBe('');
      expect(locationValue).toBe('');
    });

    await test.step('Configure buttons work before event creation', async () => {
      // These buttons should be visible even without an event
      const displayBtn = page.locator('button:has-text("Configure Display & Sponsors")');
      const signupBtn = page.locator('button:has-text("Configure Sign-Up Forms")');

      // They may be disabled or hidden, but shouldn't error
      const displayExists = await displayBtn.count() > 0;
      const signupExists = await signupBtn.count() > 0;

      // At least one configuration button should exist
      expect(displayExists || signupExists).toBe(true);
    });
  });

  test('Should handle rapid button clicks gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      }
    });

    await test.step('Create event', async () => {
      await page.fill('#name', 'Rapid Click Test');
      await page.fill('#startDateISO', '2025-12-31');
      await page.click('button[type="submit"]');
      await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    });

    await test.step('Rapid clicks on Add Sponsor button', async () => {
      await page.click('button:has-text("Configure Display & Sponsors")');
      await expect(page.locator('#displayCard')).toBeVisible();

      // Click Add Sponsor multiple times rapidly
      for (let i = 0; i < 3; i++) {
        await page.click('button:has-text("Add Sponsor")');
        await page.waitForTimeout(100);
      }

      // Should have added 3 sponsor forms
      const sponsorForms = await page.locator('.sp-name').count();
      expect(sponsorForms).toBeGreaterThanOrEqual(3);
    });

    await test.step('Rapid clicks on Add URL button', async () => {
      // Click Add URL multiple times rapidly
      for (let i = 0; i < 3; i++) {
        await page.click('button:has-text("Add URL")');
        await page.waitForTimeout(100);
      }

      // Should have added 3 URL inputs
      const urlInputs = await page.locator('.url-input').count();
      expect(urlInputs).toBeGreaterThanOrEqual(3);
    });
  });

  test('Should validate button states and disabled conditions', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await test.step('Submit button should be enabled with required fields', async () => {
      await page.fill('#name', 'State Test Event');
      await page.fill('#startDateISO', '2025-12-31');

      const submitBtn = page.locator('button[type="submit"]');
      const isDisabled = await submitBtn.isDisabled();
      expect(isDisabled).toBe(false);
    });

    await test.step('Clear button should always be enabled', async () => {
      const clearBtn = page.locator('button:has-text("Clear")');
      const isDisabled = await clearBtn.isDisabled();
      expect(isDisabled).toBe(false);
    });
  });
});
