/**
 * FLOW TESTS - S08: Admin "10-Minute Event" Wizard Flow
 *
 * Purpose: Test the guided "Create & Launch" wizard end-to-end
 * Coverage: 5-step wizard flow for fresh event creation
 *
 * Acceptance Criteria from S08:
 *   - Admin.html includes a clearly labeled "Quick Start" or "Create & Launch" section
 *   - Walks through: Create event → Choose template → Sign-ups → Links/QR → Verify
 *   - Uses existing backend RPCs; no new APIs
 *   - All steps succeed for a fresh event
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

test.describe('🚀 S08: Admin "10-Minute Event" Wizard Flow', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to admin page before each test
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  });

  test('Wizard is visible and has 5 steps', async ({ page }) => {
    // Verify wizard section exists
    const wizard = page.locator('[data-testid="launch-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 10000 });

    // Verify wizard header
    await expect(wizard.locator('h2')).toContainText('Create & Launch');

    // Verify 5 progress steps
    const steps = page.locator('.wizard-progress-step');
    await expect(steps).toHaveCount(5);

    // Verify step labels
    await expect(steps.nth(0).locator('.step-label')).toContainText('Basic Info');
    await expect(steps.nth(1).locator('.step-label')).toContainText('Template');
    await expect(steps.nth(2).locator('.step-label')).toContainText('Sign-Ups');
    await expect(steps.nth(3).locator('.step-label')).toContainText('Your Links');
    await expect(steps.nth(4).locator('.step-label')).toContainText('Launch');

    // Step 1 should be active initially
    await expect(steps.nth(0)).toHaveClass(/active/);
  });

  test('Step 1: Basic Info - validation works', async ({ page }) => {
    // Next button should be disabled initially
    const nextBtn = page.locator('[data-testid="wizard-next-btn"]');
    await expect(nextBtn).toBeDisabled();

    // Fill in event name
    await page.fill('[data-testid="wizard-event-name"]', 'Test Wizard Event');
    await expect(nextBtn).toBeDisabled(); // Still disabled (missing fields)

    // Fill in venue
    await page.fill('[data-testid="wizard-event-venue"]', 'Test Venue');

    // Date should be pre-filled with today, but let's verify Next enables
    await expect(nextBtn).toBeEnabled({ timeout: 2000 });
  });

  test('Step 2: Template selection works', async ({ page }) => {
    // Complete Step 1
    await page.fill('[data-testid="wizard-event-name"]', 'Template Test Event');
    await page.fill('[data-testid="wizard-event-venue"]', 'Test Venue');

    // Click Next to go to Step 2
    await page.click('[data-testid="wizard-next-btn"]');

    // Verify we're on Step 2
    await expect(page.locator('[data-testid="wizard-step-2"]')).toBeVisible();

    // Wait for templates to load
    await page.waitForTimeout(1000); // Give time for RPC

    // Verify template picker is visible
    const templatePicker = page.locator('#wizardTemplatePicker');
    await expect(templatePicker).toBeVisible();

    // Verify we can select a template (if available)
    const templates = page.locator('.wizard-template-card');
    const templateCount = await templates.count();

    if (templateCount > 0) {
      // Click the first template
      await templates.first().click();
      await expect(templates.first()).toHaveClass(/selected/);
    }

    // Next button should be enabled
    await expect(page.locator('[data-testid="wizard-next-btn"]')).toBeEnabled();
  });

  test('Step 3: Sign-Up options are available', async ({ page }) => {
    // Complete Steps 1-2
    await page.fill('[data-testid="wizard-event-name"]', 'Sign-Up Test Event');
    await page.fill('[data-testid="wizard-event-venue"]', 'Test Venue');
    await page.click('[data-testid="wizard-next-btn"]'); // → Step 2
    await page.waitForTimeout(500);
    await page.click('[data-testid="wizard-next-btn"]'); // → Step 3

    // Verify we're on Step 3
    await expect(page.locator('[data-testid="wizard-step-3"]')).toBeVisible();

    // Verify sign-up options are visible
    const existingOption = page.locator('.wizard-signup-option[data-option="existing"]');
    const createOption = page.locator('.wizard-signup-option[data-option="create"]');
    const noneOption = page.locator('.wizard-signup-option[data-option="none"]');

    await expect(existingOption).toBeVisible();
    await expect(createOption).toBeVisible();
    await expect(noneOption).toBeVisible();

    // Test selecting "I have a form already"
    await existingOption.click();
    await expect(existingOption).toHaveClass(/selected/);
    await expect(page.locator('#wizardExistingFormInput')).toBeVisible();

    // Test selecting "No sign-ups needed"
    await noneOption.click();
    await expect(noneOption).toHaveClass(/selected/);
    await expect(page.locator('#wizardExistingFormInput')).not.toBeVisible();

    // Verify Skip button is available
    await expect(page.locator('#wizardSkipBtn')).toBeVisible();
  });

  test('Complete wizard flow: Create event and verify links', async ({ page }) => {
    // Set up dialog handler for admin key prompt
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      }
    });

    const eventName = `Wizard E2E Test ${Date.now()}`;

    // Step 1: Basic Info
    await page.fill('[data-testid="wizard-event-name"]', eventName);
    await page.fill('[data-testid="wizard-event-venue"]', 'E2E Test Venue');
    await page.click('[data-testid="wizard-next-btn"]');

    // Step 2: Template (just proceed with default)
    await page.waitForTimeout(500);
    await page.click('[data-testid="wizard-next-btn"]');

    // Step 3: Sign-Ups (select "No sign-ups needed")
    await expect(page.locator('[data-testid="wizard-step-3"]')).toBeVisible();
    await page.locator('.wizard-signup-option[data-option="none"]').click();

    // Click "Create Event" button
    const createBtn = page.locator('[data-testid="wizard-next-btn"]');
    await expect(createBtn).toContainText('Create Event');
    await createBtn.click();

    // Step 4: Your Links - verify links are generated
    await expect(page.locator('[data-testid="wizard-step-4"]')).toBeVisible({ timeout: 15000 });

    // Verify QR codes are rendered
    await expect(page.locator('#wizardQrPublic img')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#wizardQrPoster img')).toBeVisible();
    await expect(page.locator('#wizardQrDisplay img')).toBeVisible();
    await expect(page.locator('#wizardQrReport img')).toBeVisible();

    // Verify link cards are present
    await expect(page.locator('[data-testid="wizard-link-public"]')).toBeVisible();
    await expect(page.locator('[data-testid="wizard-link-poster"]')).toBeVisible();
    await expect(page.locator('[data-testid="wizard-link-display"]')).toBeVisible();
    await expect(page.locator('[data-testid="wizard-link-report"]')).toBeVisible();

    // Click Next to go to Launch Checklist
    await page.click('[data-testid="wizard-next-btn"]');

    // Step 5: Launch Checklist
    await expect(page.locator('[data-testid="wizard-step-5"]')).toBeVisible();

    // Verify event summary is displayed
    const summary = page.locator('#wizardEventSummary');
    await expect(summary).toContainText(eventName);

    // Verify checklist items exist
    await expect(page.locator('#wizardCheckPublic')).toBeVisible();
    await expect(page.locator('#wizardCheckPoster')).toBeVisible();
    await expect(page.locator('#wizardCheckDisplay')).toBeVisible();
    await expect(page.locator('#wizardCheckReport')).toBeVisible();

    // Verify "Done" button exists
    const doneBtn = page.locator('[data-testid="wizard-finish-btn"]');
    await expect(doneBtn).toBeVisible();
    await expect(doneBtn).toContainText('Done');

    // Click Done and verify transition to dashboard
    await doneBtn.click();

    // Wizard should be hidden
    await expect(page.locator('[data-testid="launch-wizard"]')).not.toBeVisible();

    // Event card should be visible
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#eventInfo')).toContainText(eventName);
  });

  test('Navigation: Can go back through steps', async ({ page }) => {
    // Complete Step 1
    await page.fill('[data-testid="wizard-event-name"]', 'Navigation Test');
    await page.fill('[data-testid="wizard-event-venue"]', 'Test Venue');
    await page.click('[data-testid="wizard-next-btn"]'); // → Step 2

    // Verify on Step 2
    await expect(page.locator('[data-testid="wizard-step-2"]')).toBeVisible();

    // Back button should now be visible
    const backBtn = page.locator('#wizardBackBtn');
    await expect(backBtn).toBeVisible();

    // Click back
    await backBtn.click();

    // Should be on Step 1 again
    await expect(page.locator('[data-testid="wizard-step-1"]')).toBeVisible();

    // Form values should be preserved
    await expect(page.locator('[data-testid="wizard-event-name"]')).toHaveValue('Navigation Test');
  });

  test('Skip button works on Sign-Ups step', async ({ page }) => {
    // Set up dialog handler for admin key prompt
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      }
    });

    // Go through Steps 1-2
    await page.fill('[data-testid="wizard-event-name"]', 'Skip Test Event');
    await page.fill('[data-testid="wizard-event-venue"]', 'Test Venue');
    await page.click('[data-testid="wizard-next-btn"]'); // → Step 2
    await page.waitForTimeout(500);
    await page.click('[data-testid="wizard-next-btn"]'); // → Step 3

    // On Step 3, verify Skip button exists
    const skipBtn = page.locator('#wizardSkipBtn');
    await expect(skipBtn).toBeVisible();

    // Click Skip - should create event without sign-up config
    await skipBtn.click();

    // Should proceed to Step 4 (event created)
    await expect(page.locator('[data-testid="wizard-step-4"]')).toBeVisible({ timeout: 15000 });
  });

  test('Clicking progress step indicators works for completed steps', async ({ page }) => {
    // Complete Step 1
    await page.fill('[data-testid="wizard-event-name"]', 'Progress Click Test');
    await page.fill('[data-testid="wizard-event-venue"]', 'Test Venue');
    await page.click('[data-testid="wizard-next-btn"]'); // → Step 2

    // Step 1 should now be completed (green)
    const step1 = page.locator('.wizard-progress-step[data-step="1"]');
    await expect(step1).toHaveClass(/completed/);

    // Click on Step 1 indicator
    await step1.click();

    // Should navigate back to Step 1
    await expect(page.locator('[data-testid="wizard-step-1"]')).toBeVisible();
    await expect(step1).toHaveClass(/active/);
  });

});

test.describe('🚀 S08: Wizard Accessibility & Mobile', () => {

  test('Wizard is keyboard navigable', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Fill Step 1 using keyboard
    await page.locator('[data-testid="wizard-event-name"]').focus();
    await page.keyboard.type('Keyboard Test Event');
    await page.keyboard.press('Tab');
    // Date field (pre-filled)
    await page.keyboard.press('Tab');
    await page.keyboard.type('Test Venue');

    // Tab to Next button and press Enter
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    // Should be on Step 2
    await expect(page.locator('[data-testid="wizard-step-2"]')).toBeVisible();
  });

  test('Wizard works on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wizard should be visible
    await expect(page.locator('[data-testid="launch-wizard"]')).toBeVisible();

    // Progress steps should be visible (may be scrollable)
    await expect(page.locator('.wizard-progress')).toBeVisible();

    // Should be able to fill form
    await page.fill('[data-testid="wizard-event-name"]', 'Mobile Test');
    await page.fill('[data-testid="wizard-event-venue"]', 'Mobile Venue');

    // Next button should be enabled
    await expect(page.locator('[data-testid="wizard-next-btn"]')).toBeEnabled();
  });

});
