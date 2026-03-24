/**
 * Sponsor Management Workflow E2E Tests
 * Tests complete sponsor management user journeys via Sponsor.html interface
 */

import { test, expect } from '@playwright/test';
import { ApiHelpers } from '../api/api-helpers.js';
import { getCurrentEnvironment } from '../../config/environments.js';

test.describe('Sponsor Management Workflows', () => {
  let api;
  let adminKey;
  let baseUrl;
  const brand = 'root';
  const createdSponsorIds = [];

  test.beforeEach(async ({ request }) => {
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
          if (sponsor.name && sponsor.name.includes('E2E Flow Test')) {
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

  test('Complete sponsor lifecycle: create → view → edit → delete', async ({ page }) => {
    // Step 1: Access Sponsor Management
    await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 2: Authenticate
    await page.waitForSelector('#admin-key-input');
    await page.fill('#admin-key-input', adminKey);
    await page.press('#admin-key-input', 'Enter');
    await page.waitForSelector('#main-content', { state: 'visible' });
    await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

    // Step 3: Create new sponsor
    await page.fill('#sponsor-name', 'E2E Flow Test Complete Lifecycle');
    await page.fill('#sponsor-logo', 'https://via.placeholder.com/300');
    await page.fill('#sponsor-website', 'https://lifecycle-test.example.com');
    await page.selectOption('#sponsor-tier', 'gold');
    await page.fill('#sponsor-description', 'Full lifecycle test sponsor');

    await page.click('button[type="submit"]:has-text("Add Sponsor")');

    // Verify creation
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

    // Step 4: View sponsor in list
    const sponsorCard = page.locator('.sponsor-card')
      .filter({ hasText: 'E2E Flow Test Complete Lifecycle' });
    await expect(sponsorCard).toBeVisible({ timeout: 10000 });
    await expect(sponsorCard).toContainText('gold');
    await expect(sponsorCard).toContainText('https://lifecycle-test.example.com');

    // Track for cleanup
    const listResponse = await api.listSponsors(brand);
    const listData = await listResponse.json();
    const createdSponsor = listData.value.items.find(s => s.name === 'E2E Flow Test Complete Lifecycle');
    if (createdSponsor) {
      createdSponsorIds.push(createdSponsor.id);
    }

    // Step 5: Edit sponsor
    page.once('dialog', async dialog => {
      await dialog.accept('E2E Flow Test UPDATED Lifecycle');
    });

    await sponsorCard.locator('button:has-text("Edit")').click();

    // Verify edit
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });
    const updatedCard = page.locator('.sponsor-card')
      .filter({ hasText: 'E2E Flow Test UPDATED Lifecycle' });
    await expect(updatedCard).toBeVisible({ timeout: 10000 });

    // Step 6: Delete sponsor
    page.once('dialog', async dialog => {
      await dialog.accept();
    });

    await updatedCard.locator('button:has-text("Delete")').click();

    // Verify deletion
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });
    await expect(updatedCard).not.toBeVisible({ timeout: 10000 });

    // Remove from cleanup list
    if (createdSponsor) {
      const index = createdSponsorIds.indexOf(createdSponsor.id);
      if (index > -1) {
        createdSponsorIds.splice(index, 1);
      }
    }
  });

  test('Manage multiple sponsors of different tiers', async ({ page }) => {
    // Access and authenticate
    await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForSelector('#admin-key-input');
    await page.fill('#admin-key-input', adminKey);
    await page.press('#admin-key-input', 'Enter');
    await page.waitForSelector('#main-content', { state: 'visible' });
    await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

    // Create sponsors for each tier
    const tiers = [
      { tier: 'platinum', name: 'E2E Flow Test Platinum Corp' },
      { tier: 'gold', name: 'E2E Flow Test Gold Inc' },
      { tier: 'silver', name: 'E2E Flow Test Silver Ltd' },
      { tier: 'bronze', name: 'E2E Flow Test Bronze LLC' }
    ];

    for (const { tier, name } of tiers) {
      await page.fill('#sponsor-name', name);
      await page.fill('#sponsor-website', `https://${tier}-test.example.com`);
      await page.selectOption('#sponsor-tier', tier);

      await page.click('button[type="submit"]:has-text("Add Sponsor")');
      await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

      // Wait for alert to disappear before next iteration
      await page.waitForTimeout(500);
    }

    // Verify all sponsors are displayed
    for (const { name } of tiers) {
      const card = page.locator('.sponsor-card').filter({ hasText: name });
      await expect(card).toBeVisible({ timeout: 10000 });
    }

    // Verify analytics
    const totalSponsors = await page.locator('#total-sponsors').textContent();
    expect(parseInt(totalSponsors)).toBeGreaterThanOrEqual(4);

    const platinumCount = await page.locator('#platinum-count').textContent();
    expect(parseInt(platinumCount)).toBeGreaterThanOrEqual(1);

    // Track all for cleanup
    const listResponse = await api.listSponsors(brand);
    const listData = await listResponse.json();
    for (const { name } of tiers) {
      const sponsor = listData.value.items.find(s => s.name === name);
      if (sponsor) {
        createdSponsorIds.push(sponsor.id);
      }
    }
  });

  test('First-time user workflow: authenticate → create → view analytics', async ({ page, context }) => {
    // Clear session storage to simulate first-time user
    await context.clearCookies();

    // Access page
    await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Should see auth prompt (first time)
    await expect(page.locator('#auth-prompt')).toBeVisible();
    await expect(page.locator('#main-content')).not.toBeVisible();

    // Authenticate
    await page.fill('#admin-key-input', adminKey);
    await page.click('button:has-text("Unlock Sponsor Management")');

    // Now has access
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 10000 });

    // Wait for initial load
    await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

    // Create first sponsor
    await page.fill('#sponsor-name', 'E2E Flow Test First Sponsor');
    await page.fill('#sponsor-website', 'https://first-sponsor.example.com');

    await page.click('button[type="submit"]:has-text("Add Sponsor")');
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

    // Verify sponsor appears
    const sponsorCard = page.locator('.sponsor-card')
      .filter({ hasText: 'E2E Flow Test First Sponsor' });
    await expect(sponsorCard).toBeVisible({ timeout: 10000 });

    // Verify analytics updated
    const totalSponsors = await page.locator('#total-sponsors').textContent();
    expect(parseInt(totalSponsors)).toBeGreaterThanOrEqual(1);

    // Track for cleanup
    const listResponse = await api.listSponsors(brand);
    const listData = await listResponse.json();
    const createdSponsor = listData.value.items.find(s => s.name === 'E2E Flow Test First Sponsor');
    if (createdSponsor) {
      createdSponsorIds.push(createdSponsor.id);
    }
  });

  test('Returning user workflow: automatic auth → manage sponsors', async ({ page }) => {
    // Access page
    await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // First visit: authenticate
    await page.waitForSelector('#admin-key-input');
    await page.fill('#admin-key-input', adminKey);
    await page.press('#admin-key-input', 'Enter');
    await page.waitForSelector('#main-content', { state: 'visible' });

    // Reload page (simulates returning user)
    await page.reload();

    // Should automatically show main content (session persists)
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#auth-prompt')).not.toBeVisible();

    // Can immediately manage sponsors
    await page.waitForSelector('#loading-sponsors', { state: 'hidden' });
    await page.fill('#sponsor-name', 'E2E Flow Test Returning User');
    await page.fill('#sponsor-website', 'https://returning-user.example.com');

    await page.click('button[type="submit"]:has-text("Add Sponsor")');
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

    // Track for cleanup
    const listResponse = await api.listSponsors(brand);
    const listData = await listResponse.json();
    const createdSponsor = listData.value.items.find(s => s.name === 'E2E Flow Test Returning User');
    if (createdSponsor) {
      createdSponsorIds.push(createdSponsor.id);
    }
  });

  test('Bulk operations workflow: create multiple → verify all → delete all', async ({ page }) => {
    // Access and authenticate
    await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForSelector('#admin-key-input');
    await page.fill('#admin-key-input', adminKey);
    await page.press('#admin-key-input', 'Enter');
    await page.waitForSelector('#main-content', { state: 'visible' });
    await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

    // Create 5 sponsors quickly
    const sponsorNames = [];
    for (let i = 1; i <= 5; i++) {
      const name = `E2E Flow Test Bulk ${i}`;
      sponsorNames.push(name);

      await page.fill('#sponsor-name', name);
      await page.fill('#sponsor-website', `https://bulk-${i}.example.com`);

      await page.click('button[type="submit"]:has-text("Add Sponsor")');
      await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

      // Small delay between creations
      await page.waitForTimeout(500);
    }

    // Verify all 5 appear in list
    for (const name of sponsorNames) {
      const card = page.locator('.sponsor-card').filter({ hasText: name });
      await expect(card).toBeVisible({ timeout: 10000 });
    }

    // Get IDs for cleanup
    const listResponse = await api.listSponsors(brand);
    const listData = await listResponse.json();
    for (const name of sponsorNames) {
      const sponsor = listData.value.items.find(s => s.name === name);
      if (sponsor) {
        createdSponsorIds.push(sponsor.id);
      }
    }

    // Delete all 5
    for (const name of sponsorNames) {
      const card = page.locator('.sponsor-card').filter({ hasText: name });

      page.once('dialog', async dialog => {
        await dialog.accept();
      });

      await card.locator('button:has-text("Delete")').click();
      await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

      // Wait for deletion to complete
      await page.waitForTimeout(500);
    }

    // All should be gone
    for (const name of sponsorNames) {
      const card = page.locator('.sponsor-card').filter({ hasText: name });
      await expect(card).not.toBeVisible();
    }

    // Clear cleanup list since manually deleted
    createdSponsorIds.length = 0;
  });

  test('Error recovery workflow: handle invalid data → retry with valid data', async ({ page }) => {
    // Access and authenticate
    await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForSelector('#admin-key-input');
    await page.fill('#admin-key-input', adminKey);
    await page.press('#admin-key-input', 'Enter');
    await page.waitForSelector('#main-content', { state: 'visible' });
    await page.waitForSelector('#loading-sponsors', { state: 'hidden' });

    // Try to submit with only name (missing required website)
    await page.fill('#sponsor-name', 'E2E Flow Test Invalid');

    // Click submit - should fail HTML5 validation
    const submitButton = page.locator('button[type="submit"]:has-text("Add Sponsor")');
    await submitButton.click();

    // Form should show validation error (browser native)
    const websiteInput = page.locator('#sponsor-website');
    const isInvalid = await websiteInput.evaluate((el) => !el.validity.valid);
    expect(isInvalid).toBe(true);

    // Fix by adding website
    await page.fill('#sponsor-website', 'https://valid-now.example.com');

    // Now should succeed
    await submitButton.click();
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10000 });

    // Track for cleanup
    const listResponse = await api.listSponsors(brand);
    const listData = await listResponse.json();
    const createdSponsor = listData.value.items.find(s => s.name === 'E2E Flow Test Invalid');
    if (createdSponsor) {
      createdSponsorIds.push(createdSponsor.id);
    }
  });
});
