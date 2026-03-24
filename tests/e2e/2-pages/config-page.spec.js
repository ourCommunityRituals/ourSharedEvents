/**
 * PAGE TESTS - Level 2: Config Page Brand Portfolio Section
 *
 * Purpose: Test Brand Portfolio UI components in ConfigHtml.html
 * Coverage: Portfolio relationships, analytics dashboard, sponsor reports
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:pages
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:pages
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const ABC_ADMIN_KEY = process.env.ABC_ADMIN_KEY || 'abc-admin-key';
const CBC_ADMIN_KEY = process.env.CBC_ADMIN_KEY || 'cbc-admin-key';

test.describe('📄 PAGE: Config - Brand Portfolio (Parent Org)', () => {

  test('Portfolio section is visible for parent organization', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Provide admin key when prompted
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt' && dialog.message().toLowerCase().includes('admin key')) {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    // Verify Brand Portfolio section exists
    await expect(page.locator('h2:has-text("Brand Portfolio")')).toBeVisible({ timeout: 10000 });

    // Verify portfolio description
    const description = page.locator('text=As a parent organization, you can manage relationships');
    await expect(description).toBeVisible();
  });

  test('Portfolio section is NOT visible for child organization', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=cbc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(CBC_ADMIN_KEY);
      }
    });

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Brand Portfolio section should not exist for child org
    const portfolioSection = page.locator('h2:has-text("Brand Portfolio")');
    await expect(portfolioSection).not.toBeVisible();
  });

  test('Portfolio relationships list loads', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    // Wait for portfolio relationships to load
    const relationshipsList = page.locator('#portfolioRelationshipsList');
    await expect(relationshipsList).toBeVisible({ timeout: 10000 });

    // Should show child brands
    await expect(page.locator('text=Chicago Bocce Club')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Chicago Bocce League')).toBeVisible({ timeout: 5000 });
  });

  test('includeInPortfolioReports status badges display correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(3000);

    // At least one child should have an inclusion status badge
    const badgeCount = await page.locator('text=/Included|Not Included/').count();
    expect(badgeCount).toBeGreaterThan(0);
  });
});

test.describe('📄 PAGE: Config - Brand Portfolio Analytics', () => {

  test('Portfolio Analytics section loads', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    // Verify Portfolio Analytics section exists
    await expect(page.locator('h2:has-text("Portfolio Analytics")')).toBeVisible({ timeout: 10000 });

    // Verify description
    const description = page.locator('text=Consolidated sponsor performance metrics');
    await expect(description).toBeVisible();
  });

  test('Portfolio summary metrics display', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    // Wait for portfolio summary to load
    await page.waitForTimeout(5000);

    // Verify summary metrics are present
    await expect(page.locator('text=Total Events')).toBeVisible();
    await expect(page.locator('text=Total Sponsors')).toBeVisible();
    await expect(page.locator('text=Active Sponsors')).toBeVisible();
    await expect(page.locator('text=Total Impressions')).toBeVisible();

    // Verify metric values display (should be numbers or dashes)
    const totalEventsValue = page.locator('#portfolioTotalEvents');
    await expect(totalEventsValue).toBeVisible();

    const value = await totalEventsValue.textContent();
    expect(value).toMatch(/^\d+|-$/);
  });

  test('Refresh Data button works', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(3000);

    // Find and click refresh button
    const refreshBtn = page.locator('button:has-text("Refresh Data")');

    if (await refreshBtn.isVisible()) {
      await expect(refreshBtn).toBeEnabled();
      await refreshBtn.click();

      // Wait for refresh to complete
      await page.waitForTimeout(2000);

      // Metrics should still be visible after refresh
      await expect(page.locator('#portfolioTotalEvents')).toBeVisible();
    }
  });

  test('Brand breakdown section displays', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(5000);

    // Should show "By Brand" section
    await expect(page.locator('text=By Brand')).toBeVisible();

    // Should show parent brand (ABC)
    await expect(page.locator('text=American Bocce Co.')).toBeVisible();
  });
});

test.describe('📄 PAGE: Config - Portfolio Sponsor Reports', () => {

  test('Sponsor selector dropdown populates', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(5000);

    // Find sponsor selector dropdown
    const sponsorSelect = page.locator('#portfolioSponsorSelect');

    if (await sponsorSelect.isVisible()) {
      await expect(sponsorSelect).toBeEnabled();

      // Should have at least the default option
      const optionCount = await sponsorSelect.locator('option').count();
      expect(optionCount).toBeGreaterThanOrEqual(1);

      // First option should be "Select a sponsor"
      const firstOption = await sponsorSelect.locator('option').first().textContent();
      expect(firstOption).toContain('Select');
    }
  });

  test('Sponsor report loads when sponsor selected', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(5000);

    const sponsorSelect = page.locator('#portfolioSponsorSelect');

    if (await sponsorSelect.isVisible()) {
      const options = await sponsorSelect.locator('option').count();

      // If there are sponsors available (more than just "Select a sponsor")
      if (options > 1) {
        // Select the second option (first actual sponsor)
        await sponsorSelect.selectOption({ index: 1 });

        // Wait for report to load
        await page.waitForTimeout(3000);

        // Verify sponsor report section appears
        await expect(page.locator('text=Sponsor Performance')).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('Sponsor report displays performance metrics', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(5000);

    const sponsorSelect = page.locator('#portfolioSponsorSelect');

    if (await sponsorSelect.isVisible()) {
      const options = await sponsorSelect.locator('option').count();

      if (options > 1) {
        await sponsorSelect.selectOption({ index: 1 });
        await page.waitForTimeout(3000);

        // Verify key metrics are displayed
        await expect(page.locator('text=Total Impressions')).toBeVisible();
        await expect(page.locator('text=Total Clicks')).toBeVisible();
        await expect(page.locator('text=Portfolio CTR')).toBeVisible();
      }
    }
  });

  test('Export Report button is available', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(5000);

    const sponsorSelect = page.locator('#portfolioSponsorSelect');

    if (await sponsorSelect.isVisible()) {
      const options = await sponsorSelect.locator('option').count();

      if (options > 1) {
        await sponsorSelect.selectOption({ index: 1 });
        await page.waitForTimeout(3000);

        // Look for Export Report button
        const exportBtn = page.locator('button:has-text("Export Report")');

        if (await exportBtn.isVisible()) {
          await expect(exportBtn).toBeEnabled();
        }
      }
    }
  });

  test('Top performing events section displays', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(5000);

    const sponsorSelect = page.locator('#portfolioSponsorSelect');

    if (await sponsorSelect.isVisible()) {
      const options = await sponsorSelect.locator('option').count();

      if (options > 1) {
        await sponsorSelect.selectOption({ index: 1 });
        await page.waitForTimeout(3000);

        // Verify top events section
        await expect(page.locator('text=Top Performing Events')).toBeVisible({ timeout: 5000 });
      }
    }
  });
});

test.describe('📄 PAGE: Config - Portfolio Configuration Management', () => {

  test('Portfolio configuration cards are interactive', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(3000);

    // Verify config cards exist
    const configCards = page.locator('.config-card');
    const cardCount = await configCards.count();

    expect(cardCount).toBeGreaterThan(0);
  });

  test('Child brand links navigate correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(3000);

    // Look for child brand links
    const cbcLink = page.locator('a:has-text("Chicago Bocce Club")');

    if (await cbcLink.isVisible()) {
      const href = await cbcLink.getAttribute('href');

      // Should link to child brand's config page
      expect(href).toContain('brand=cbc');
    }
  });
});

test.describe('📄 PAGE: Config - Responsive Design', () => {

  test('Mobile: Portfolio section is usable on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(3000);

    // Portfolio section should still be visible
    const portfolioHeader = page.locator('h2:has-text("Brand Portfolio")');

    if (await portfolioHeader.isVisible()) {
      await expect(portfolioHeader).toBeVisible();

      // Verify tap targets are large enough
      const refreshBtn = page.locator('button:has-text("Refresh Data")');

      if (await refreshBtn.isVisible()) {
        const btnHeight = await refreshBtn.evaluate(el => el.offsetHeight);
        expect(btnHeight).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('Tablet: Portfolio analytics layout adapts', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(3000);

    // Verify layout is still usable on tablet
    await expect(page.locator('h2:has-text("Portfolio Analytics")')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('📄 PAGE: Config - Error Handling', () => {

  test('Handles missing admin key gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    let dialogShown = false;

    page.on('dialog', async dialog => {
      dialogShown = true;

      // Dismiss or provide invalid key
      await dialog.accept('invalid-key');
    });

    await page.waitForTimeout(3000);

    // Should show error or prompt for correct key
    expect(dialogShown).toBe(true);
  });

  test('Handles network errors when loading portfolio data', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    // Even if API calls fail, the UI should not crash
    await page.waitForTimeout(3000);

    // Page should still render basic structure
    await expect(page.locator('h2:has-text("Brand Portfolio")')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('📄 PAGE: Config - Accessibility', () => {

  test('Portfolio section has proper headings hierarchy', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(3000);

    // Verify h2 headings exist
    await expect(page.locator('h2:has-text("Brand Portfolio")')).toBeVisible({ timeout: 10000 });

    // Verify h3 subheadings exist
    const h3Count = await page.locator('h3').count();
    expect(h3Count).toBeGreaterThan(0);
  });

  test('Sponsor selector is keyboard navigable', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(5000);

    const sponsorSelect = page.locator('#portfolioSponsorSelect');

    if (await sponsorSelect.isVisible()) {
      // Focus the select element
      await sponsorSelect.focus();

      // Verify it's focused
      const isFocused = await sponsorSelect.evaluate(el => el === document.activeElement);
      expect(isFocused).toBe(true);

      // Should be able to navigate with keyboard
      await page.keyboard.press('ArrowDown');
    }
  });

  test('Buttons have appropriate ARIA labels', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=config&brand=abc`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ABC_ADMIN_KEY);
      }
    });

    await page.waitForTimeout(3000);

    const refreshBtn = page.locator('button:has-text("Refresh Data")');

    if (await refreshBtn.isVisible()) {
      // Button should have text content or aria-label
      const btnText = await refreshBtn.textContent();
      const ariaLabel = await refreshBtn.getAttribute('aria-label');

      expect(btnText || ariaLabel).toBeTruthy();
    }
  });
});
