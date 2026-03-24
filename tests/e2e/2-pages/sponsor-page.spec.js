/**
 * Sponsor Page E2E Tests
 * Tests the Sponsor Management interface (Sponsor.html)
 */

import { test, expect } from '@playwright/test';
import { ApiHelpers } from '../api/api-helpers.js';
import { getCurrentEnvironment } from '../../config/environments.js';

test.describe('Sponsor Page', () => {
  let api;
  let adminKey;
  let baseUrl;
  const brand = 'root';
  const createdSponsorIds = [];

  test.beforeEach(async ({ request, page }) => {
    const env = getCurrentEnvironment();
    api = new ApiHelpers(request, env.baseUrl);
    baseUrl = env.baseUrl;
    adminKey = process.env.ADMIN_KEY;

    if (!adminKey) {
      test.skip('ADMIN_KEY not set');
    }

    // Clean up any existing test sponsors
    try {
      const listResponse = await api.listSponsors(brand);
      const listData = await listResponse.json();
      if (listData.ok && listData.value && listData.value.items) {
        for (const sponsor of listData.value.items) {
          if (sponsor.name && sponsor.name.includes('E2E Test')) {
            await api.deleteSponsor(brand, sponsor.id, adminKey);
          }
        }
      }
    } catch (error) {
      console.warn('Pre-test cleanup failed:', error.message);
    }
  });

  test.afterEach(async () => {
    // Clean up created sponsors
    for (const sponsorId of createdSponsorIds) {
      try {
        await api.deleteSponsor(brand, sponsorId, adminKey);
      } catch (error) {
        console.warn(`Failed to delete sponsor ${sponsorId}:`, error.message);
      }
    }
    createdSponsorIds.length = 0;
  });

  test.describe('Authentication & Access', () => {
    test('shows auth prompt when no admin key', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Should show auth prompt
      const authPrompt = page.locator('#auth-prompt');
      await expect(authPrompt).toBeVisible();

      // Main content should be hidden
      const mainContent = page.locator('#main-content');
      await expect(mainContent).not.toBeVisible();

      // Should have password input
      const keyInput = page.locator('#admin-key-input');
      await expect(keyInput).toBeVisible();
      await expect(keyInput).toHaveAttribute('type', 'password');
    });

    test('unlocks interface with valid admin key', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Wait for auth prompt
      await page.waitForSelector('#auth-prompt');

      // Enter admin key
      await page.fill('#admin-key-input', adminKey);

      // Click unlock button
      await page.click('button:has-text("Unlock Sponsor Management")');

      // Main content should be visible
      await expect(page.locator('#main-content')).toBeVisible({ timeout: 10000 });

      // Auth prompt should be hidden
      await expect(page.locator('#auth-prompt')).not.toBeVisible();

      // Should show sponsor management interface
      await expect(page.locator('h1:has-text("Sponsor Management")')).toBeVisible();
    });

    test('allows Enter key to submit admin key', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);

      // Press Enter
      await page.press('#admin-key-input', 'Enter');

      // Should unlock
      await expect(page.locator('#main-content')).toBeVisible({ timeout: 10000 });
    });

    test('persists admin key in session storage', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.click('button:has-text("Unlock Sponsor Management")');

      await expect(page.locator('#main-content')).toBeVisible({ timeout: 10000 });

      // Check session storage
      const storedKey = await page.evaluate(() => sessionStorage.getItem('adminKey'));
      expect(storedKey).toBeTruthy();

      // Reload page - should not show auth prompt
      await page.reload();
      await expect(page.locator('#main-content')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('#auth-prompt')).not.toBeVisible();
    });
  });

  test.describe('Sponsor List Display', () => {
    test('shows empty state when no sponsors exist', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });

      // Wait for loading to finish
      await page.waitForSelector('#loading-sponsors', { state: 'hidden', timeout: 10000 });

      // Should show empty state
      const emptyState = page.locator('#empty-sponsors');
      const isVisible = await emptyState.isVisible();

      if (isVisible) {
        await expect(emptyState).toContainText('No Sponsors Yet');
      }
    });

    test('displays sponsor cards with correct information', async ({ page }) => {
      // Create test sponsor via API
      const { sponsorId } = await api.createTestSponsor(brand, adminKey, {
        name: 'E2E Test Display Sponsor',
        website: 'https://test-display.example.com',
        tier: 'gold',
        logo: 'https://via.placeholder.com/200',
        description: 'Test sponsor for display verification'
      });
      createdSponsorIds.push(sponsorId);

      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });

      // Wait for sponsors to load
      await page.waitForSelector('#loading-sponsors', { state: 'hidden', timeout: 10000 });

      // Find the sponsor card
      const sponsorCard = page.locator('.sponsor-card').filter({ hasText: 'E2E Test Display Sponsor' });
      await expect(sponsorCard).toBeVisible({ timeout: 10000 });

      // Check card contents
      await expect(sponsorCard).toContainText('E2E Test Display Sponsor');
      await expect(sponsorCard).toContainText('gold');
      await expect(sponsorCard).toContainText('https://test-display.example.com');
      await expect(sponsorCard).toContainText('Test sponsor for display verification');

      // Check action buttons
      await expect(sponsorCard.locator('button:has-text("Edit")')).toBeVisible();
      await expect(sponsorCard.locator('button:has-text("Delete")')).toBeVisible();
    });

    test('displays tier badges with correct styling', async ({ page }) => {
      // Create sponsors with different tiers
      const tiers = ['platinum', 'gold', 'silver', 'bronze'];

      for (const tier of tiers) {
        const { sponsorId } = await api.createTestSponsor(brand, adminKey, {
          name: `E2E Test ${tier.toUpperCase()} Sponsor`,
          tier: tier
        });
        createdSponsorIds.push(sponsorId);
      }

      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Check each tier badge
      for (const tier of tiers) {
        const badge = page.locator(`.tier-badge.tier-${tier}`);
        await expect(badge).toBeVisible({ timeout: 10000 });
        await expect(badge).toContainText(tier);
      }
    });
  });

  test.describe('Sponsor Analytics', () => {
    test('displays correct analytics counts', async ({ page }) => {
      // Create sponsors with different tiers
      const { sponsorId: platinumId } = await api.createTestSponsor(brand, adminKey, {
        name: 'E2E Test Platinum Analytics',
        tier: 'platinum'
      });
      const { sponsorId: goldId } = await api.createTestSponsor(brand, adminKey, {
        name: 'E2E Test Gold Analytics',
        tier: 'gold'
      });

      createdSponsorIds.push(platinumId, goldId);

      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Wait for analytics to update
      await page.waitForTimeout(1000);

      // Check analytics values
      const totalSponsors = await page.locator('#total-sponsors').textContent();
      const platinumCount = await page.locator('#platinum-count').textContent();
      const goldCount = await page.locator('#gold-count').textContent();

      expect(parseInt(totalSponsors)).toBeGreaterThanOrEqual(2);
      expect(parseInt(platinumCount)).toBeGreaterThanOrEqual(1);
      expect(parseInt(goldCount)).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Create Sponsor Workflow', () => {
    test('creates sponsor with all fields filled', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Fill out the form
      await page.fill('#sponsor-name', 'E2E Test Created Sponsor');
      await page.fill('#sponsor-logo', 'https://via.placeholder.com/300');
      await page.fill('#sponsor-website', 'https://created-test.example.com');
      await page.selectOption('#sponsor-tier', 'platinum');
      await page.fill('#sponsor-description', 'This is a test sponsor created via E2E test');

      // Submit form
      await page.click('button[type="submit"]:has-text("Add Sponsor")');

      // Wait for success message
      await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.alert-success')).toContainText('added successfully');

      // Form should be cleared
      await expect(page.locator('#sponsor-name')).toHaveValue('');

      // Sponsor should appear in list
      await expect(page.locator('.sponsor-card').filter({ hasText: 'E2E Test Created Sponsor' }))
        .toBeVisible({ timeout: 10000 });

      // Track for cleanup
      const listResponse = await api.listSponsors(brand);
      const listData = await listResponse.json();
      const createdSponsor = listData.value.items.find(s => s.name === 'E2E Test Created Sponsor');
      if (createdSponsor) {
        createdSponsorIds.push(createdSponsor.id);
      }
    });

    test('creates sponsor with minimal required fields', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Fill only required fields
      await page.fill('#sponsor-name', 'E2E Test Minimal Sponsor');
      await page.fill('#sponsor-website', 'https://minimal-test.example.com');

      // Submit form
      await page.click('button[type="submit"]:has-text("Add Sponsor")');

      // Wait for success
      await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

      // Sponsor should appear
      await expect(page.locator('.sponsor-card').filter({ hasText: 'E2E Test Minimal Sponsor' }))
        .toBeVisible({ timeout: 10000 });

      // Track for cleanup
      const listResponse = await api.listSponsors(brand);
      const listData = await listResponse.json();
      const createdSponsor = listData.value.items.find(s => s.name === 'E2E Test Minimal Sponsor');
      if (createdSponsor) {
        createdSponsorIds.push(createdSponsor.id);
      }
    });

    test('shows loading state while creating sponsor', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Fill form
      await page.fill('#sponsor-name', 'E2E Test Loading State');
      await page.fill('#sponsor-website', 'https://loading-test.example.com');

      // Click submit and immediately check loading state
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // Button should be disabled during submission
      await expect(submitButton).toBeDisabled({ timeout: 1000 });

      // Eventually succeeds
      await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

      // Button re-enabled
      await expect(submitButton).toBeEnabled();

      // Cleanup
      const listResponse = await api.listSponsors(brand);
      const listData = await listResponse.json();
      const createdSponsor = listData.value.items.find(s => s.name === 'E2E Test Loading State');
      if (createdSponsor) {
        createdSponsorIds.push(createdSponsor.id);
      }
    });
  });

  test.describe('Edit Sponsor Workflow', () => {
    test('edits sponsor name successfully', async ({ page }) => {
      // Create test sponsor
      const { sponsorId } = await api.createTestSponsor(brand, adminKey, {
        name: 'E2E Test Edit Original'
      });
      createdSponsorIds.push(sponsorId);

      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Find the sponsor card
      const sponsorCard = page.locator('.sponsor-card').filter({ hasText: 'E2E Test Edit Original' });
      await expect(sponsorCard).toBeVisible({ timeout: 10000 });

      // Click edit button and handle prompt
      page.once('dialog', async dialog => {
        expect(dialog.type()).toBe('prompt');
        expect(dialog.message()).toContain('Edit Sponsor Name');
        await dialog.accept('E2E Test Edit Updated');
      });

      await sponsorCard.locator('button:has-text("Edit")').click();

      // Wait for success message
      await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.alert-success')).toContainText('updated successfully');

      // Sponsor should show new name
      await expect(page.locator('.sponsor-card').filter({ hasText: 'E2E Test Edit Updated' }))
        .toBeVisible({ timeout: 10000 });

      // Old name should not appear
      await expect(page.locator('.sponsor-card').filter({ hasText: 'E2E Test Edit Original' }))
        .not.toBeVisible();
    });

    test('cancels edit when user cancels prompt', async ({ page }) => {
      // Create test sponsor
      const { sponsorId } = await api.createTestSponsor(brand, adminKey, {
        name: 'E2E Test Edit Cancel'
      });
      createdSponsorIds.push(sponsorId);

      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Find the sponsor card
      const sponsorCard = page.locator('.sponsor-card').filter({ hasText: 'E2E Test Edit Cancel' });
      await expect(sponsorCard).toBeVisible({ timeout: 10000 });

      // Click edit and cancel
      page.once('dialog', async dialog => {
        await dialog.dismiss();
      });

      await sponsorCard.locator('button:has-text("Edit")').click();

      // Name should remain unchanged
      await expect(sponsorCard).toContainText('E2E Test Edit Cancel');
    });
  });

  test.describe('Delete Sponsor Workflow', () => {
    test('deletes sponsor after confirmation', async ({ page }) => {
      // Create test sponsor
      const { sponsorId } = await api.createTestSponsor(brand, adminKey, {
        name: 'E2E Test Delete Confirm'
      });
      createdSponsorIds.push(sponsorId);

      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Find the sponsor card
      const sponsorCard = page.locator('.sponsor-card').filter({ hasText: 'E2E Test Delete Confirm' });
      await expect(sponsorCard).toBeVisible({ timeout: 10000 });

      // Click delete and confirm
      page.once('dialog', async dialog => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Are you sure');
        expect(dialog.message()).toContain('E2E Test Delete Confirm');
        await dialog.accept();
      });

      await sponsorCard.locator('button:has-text("Delete")').click();

      // Wait for success message
      await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.alert-success')).toContainText('deleted successfully');

      // Sponsor card should disappear
      await expect(sponsorCard).not.toBeVisible({ timeout: 10000 });

      // Remove from cleanup list since already deleted
      const index = createdSponsorIds.indexOf(sponsorId);
      if (index > -1) {
        createdSponsorIds.splice(index, 1);
      }
    });

    test('cancels delete when user dismisses confirmation', async ({ page }) => {
      // Create test sponsor
      const { sponsorId } = await api.createTestSponsor(brand, adminKey, {
        name: 'E2E Test Delete Cancel'
      });
      createdSponsorIds.push(sponsorId);

      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });
      await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

      // Find the sponsor card
      const sponsorCard = page.locator('.sponsor-card').filter({ hasText: 'E2E Test Delete Cancel' });
      await expect(sponsorCard).toBeVisible({ timeout: 10000 });

      // Click delete and cancel
      page.once('dialog', async dialog => {
        await dialog.dismiss();
      });

      await sponsorCard.locator('button:has-text("Delete")').click();

      // Sponsor should still be there
      await expect(sponsorCard).toBeVisible();
    });
  });

  test.describe('Navigation & UI', () => {
    test('has back to dashboard link', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });

      // Check breadcrumb link
      const breadcrumbLink = page.locator('.nav-breadcrumb a');
      await expect(breadcrumbLink).toBeVisible();
      await expect(breadcrumbLink).toHaveAttribute('href', /brand=root/);

      // Check bottom button
      const backButton = page.locator('a.btn-secondary:has-text("Back to Triangle Dashboard")');
      await expect(backButton).toBeVisible();
    });

    test('displays page title and subtitle', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });

      // Check title
      await expect(page.locator('h1:has-text("Sponsor Management")')).toBeVisible();

      // Check subtitle
      await expect(page.locator('.subtitle')).toContainText('Manage sponsor relationships');
    });

    test('is mobile responsive', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Authenticate
      await page.waitForSelector('#admin-key-input');
      await page.fill('#admin-key-input', adminKey);
      await page.press('#admin-key-input', 'Enter');
      await page.waitForSelector('#main-content', { state: 'visible' });

      // Page should be visible and usable
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('#add-sponsor-form')).toBeVisible();
    });
  });
});
