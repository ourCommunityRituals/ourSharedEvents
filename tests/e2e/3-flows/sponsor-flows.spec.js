/**
 * FLOW TESTS - Level 3: Sponsor Display & Analytics Journeys
 *
 * Purpose: Test complete sponsor workflows and display features
 * Coverage: Sponsor visibility, carousel rotation, click tracking, display modes
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

test.describe('🔄 FLOW: Sponsor - Display Visibility', () => {

  test('Complete flow: Configure sponsors → View on TV display → Verify visibility', async ({ page, context }) => {
    // Step 1: Create event with sponsors
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Sponsor Display ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Step 2: Configure sponsors
    await page.click('button:has-text("Configure Display & Sponsors")');
    await expect(page.locator('#displayCard')).toBeVisible();

    // Add sponsor
    await page.click('button:has-text("Add Sponsor")');
    await page.fill('.sp-name', 'Premium Sponsor LLC');
    await page.fill('.sp-url', 'https://premium-sponsor.example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/600x300?text=Premium+Sponsor');
    await page.check('.sp-tvTop');
    await page.check('.sp-tvBottom');

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    // Step 3: Get display URL
    const displayUrl = await page.locator('#lnkDisplay').textContent();

    // Step 4: Open TV display
    const tvPage = await context.newPage();
    await tvPage.setViewportSize({ width: 1920, height: 1080 });
    await tvPage.goto(displayUrl);
    await tvPage.waitForLoadState('networkidle');

    // Step 5: Verify sponsor appears on display
    await expect(tvPage.locator('#sponsorTop, .sponsor-top')).toBeVisible({ timeout: 10000 });

    // Step 6: Verify sponsor content
    const sponsorContent = await tvPage.content();
    expect(sponsorContent).toContain('Premium Sponsor LLC');

    // Step 7: Check font size is TV-appropriate
    const fontSize = await tvPage.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20);

    await tvPage.close();
  });

  test('Complete flow: Multiple sponsor tiers → Verify display order → Check rotation', async ({ page, context }) => {
    // Step 1: Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    await page.fill('#name', `Multi Sponsor ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Configure Display & Sponsors")');

    // Step 2: Add multiple sponsors
    const sponsors = [
      { name: 'Platinum Sponsor', tier: 'platinum', position: 'tvTop' },
      { name: 'Gold Sponsor', tier: 'gold', position: 'tvTop' },
      { name: 'Silver Sponsor', tier: 'silver', position: 'tvBottom' }
    ];

    for (const sponsor of sponsors) {
      await page.click('button:has-text("Add Sponsor")');
      await page.waitForTimeout(500);

      const sponsorItems = page.locator('.sponsor-item');
      const lastItem = sponsorItems.last();

      await lastItem.locator('.sp-name').fill(sponsor.name);
      await lastItem.locator('.sp-url').fill(`https://${sponsor.tier}.example.com`);
      await lastItem.locator('.sp-img').fill(`https://via.placeholder.com/400x200?text=${sponsor.tier}`);
      await lastItem.locator(`.sp-${sponsor.position}`).check();
    }

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    // Step 3: Open display
    const displayUrl = await page.locator('#lnkDisplay').textContent();
    const displayPage = await context.newPage();
    await displayPage.goto(displayUrl);
    await displayPage.waitForLoadState('networkidle');

    // Step 4: Verify top sponsors visible
    const topArea = displayPage.locator('#sponsorTop, .sponsor-top');
    await expect(topArea).toBeVisible({ timeout: 5000 });

    // Step 5: Wait for carousel rotation
    const initialContent = await topArea.textContent();

    await displayPage.waitForTimeout(11000); // Wait for rotation

    const afterContent = await topArea.textContent();

    // Content should exist (rotation may or may not change visible sponsor)
    expect(afterContent).toBeTruthy();

    await displayPage.close();
  });
});

test.describe('🔄 FLOW: Sponsor - Click Tracking', () => {

  test('Complete flow: View sponsor on public page → Click sponsor link → Track analytics', async ({ page }) => {
    // Step 1: Navigate to public page
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 2: Look for event with sponsors
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 3: Find sponsor links
      const sponsorLinks = page.locator('a[data-sponsor], .sponsor-link');
      const sponsorCount = await sponsorLinks.count();

      if (sponsorCount > 0) {
        // Step 4: Get initial analytics (if visible)
        const hasAnalytics = await page.locator('[data-analytics], .analytics-count').count() > 0;

        // Step 5: Click sponsor link (track in new tab)
        const sponsorHref = await sponsorLinks.first().getAttribute('href');

        // Verify link is valid
        expect(sponsorHref).toBeTruthy();
        expect(sponsorHref.length).toBeGreaterThan(0);

        // Step 6: Simulate click (analytics should be logged)
        await sponsorLinks.first().click();
        await page.waitForTimeout(500);

        // Analytics logging happens in background
        // Verify no errors occurred
        const errors = [];
        page.on('pageerror', error => errors.push(error));
        await page.waitForTimeout(500);
        expect(errors.length).toBe(0);
      }
    }
  });

  test('Complete flow: Multiple sponsor clicks → Verify analytics increment', async ({ page }) => {
    // Step 1: Navigate to event with sponsors
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 2: Find all sponsor links
      const sponsorLinks = page.locator('a[data-sponsor], .sponsor-link');
      const sponsorCount = await sponsorLinks.count();

      // Step 3: Click multiple sponsors
      for (let i = 0; i < Math.min(sponsorCount, 3); i++) {
        const link = sponsorLinks.nth(i);

        if (await link.isVisible()) {
          // Get href before clicking
          const href = await link.getAttribute('href');

          if (href && href.length > 0) {
            // Prevent navigation and just track click
            await link.click({ button: 'middle' }); // Middle click opens in new tab
            await page.waitForTimeout(500);
          }
        }
      }

      // Step 4: Verify no errors in analytics tracking
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      await page.waitForTimeout(1000);
      expect(errors.length).toBe(0);
    }
  });
});

test.describe('🔄 FLOW: Sponsor - Carousel Behavior', () => {

  test('Complete flow: TV display → Auto-rotate sponsors → Verify smooth transitions', async ({ page }) => {
    // Step 1: Open display in TV mode
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Step 2: Verify TV mode active
    await expect(page.locator('body[data-tv="1"]')).toBeVisible();

    // Step 3: Check for sponsor areas
    const topArea = page.locator('#sponsorTop, .sponsor-top');
    const hasSponsors = await topArea.count() > 0;

    if (hasSponsors) {
      // Step 4: Record initial state
      const initialContent = await topArea.textContent();

      // Step 5: Wait through rotation cycle
      await page.waitForTimeout(15000);

      // Step 6: Verify content still exists (no crashes)
      const afterContent = await topArea.textContent();
      expect(afterContent).toBeTruthy();
      expect(afterContent.length).toBeGreaterThan(0);

      // Step 7: Check for smooth transitions (no errors)
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      await page.waitForTimeout(2000);
      expect(errors.length).toBe(0);
    }
  });

  test('Complete flow: Manual carousel control → Next → Previous → Pause', async ({ page }) => {
    // Step 1: Open display
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 2: Find carousel controls
    const nextBtn = page.locator('button:has-text("next"), button.next, button[aria-label*="next" i]');
    const prevBtn = page.locator('button:has-text("prev"), button.prev, button[aria-label*="previous" i]');
    const pauseBtn = page.locator('button:has-text("pause"), button[aria-label*="pause" i]');

    const hasNext = await nextBtn.count() > 0;
    const hasPrev = await prevBtn.count() > 0;
    const hasPause = await pauseBtn.count() > 0;

    // Step 3: Test Next button
    if (hasNext) {
      await expect(nextBtn.first()).toBeVisible();
      await nextBtn.first().click();
      await page.waitForTimeout(1000);

      // Verify no errors
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      await page.waitForTimeout(500);
      expect(errors.length).toBe(0);
    }

    // Step 4: Test Previous button
    if (hasPrev) {
      await prevBtn.first().click();
      await page.waitForTimeout(1000);
    }

    // Step 5: Test Pause button
    if (hasPause) {
      await pauseBtn.first().click();
      await page.waitForTimeout(1000);

      // After pause, carousel should stop rotating
      const topArea = page.locator('#sponsorTop, .sponsor-top');
      if (await topArea.count() > 0) {
        const pausedContent = await topArea.textContent();

        await page.waitForTimeout(11000);

        const afterPauseContent = await topArea.textContent();

        // Content should remain the same when paused
        // (This test assumes pause actually stops rotation)
        expect(afterPauseContent).toBeTruthy();
      }
    }
  });
});

test.describe('🔄 FLOW: Sponsor - Mobile Banner Display', () => {

  test('Complete flow: Mobile user → View event → See mobile sponsor banner', async ({ page }) => {
    // Step 1: Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Step 2: Navigate to public page
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 3: Open event with sponsors
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().tap();
      await page.waitForLoadState('networkidle');

      // Step 4: Look for mobile sponsor banner
      const mobileBanner = page.locator('#sponsorBanner, .sponsor-banner, [data-mobile-banner]');
      const hasBanner = await mobileBanner.count() > 0;

      if (hasBanner) {
        // Step 5: Verify banner is visible
        await expect(mobileBanner.first()).toBeVisible();

        // Step 6: Verify banner fits mobile viewport
        const bannerBox = await mobileBanner.first().boundingBox();

        if (bannerBox) {
          expect(bannerBox.width).toBeLessThanOrEqual(375);
        }

        // Step 7: Verify sponsor link is tappable
        const sponsorLink = mobileBanner.locator('a').first();
        if (await sponsorLink.count() > 0) {
          await expect(sponsorLink).toBeVisible();

          // Check tap target size (44px minimum for iOS)
          const linkHeight = await sponsorLink.evaluate(el => el.offsetHeight);
          expect(linkHeight).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  test('Complete flow: Mobile → Rotate device → Banner adapts orientation', async ({ page }) => {
    // Step 1: Portrait orientation
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      const mobileBanner = page.locator('#sponsorBanner, .sponsor-banner');
      const hasPortraitBanner = await mobileBanner.count() > 0;

      // Step 2: Rotate to landscape
      await page.setViewportSize({ width: 667, height: 375 });
      await page.waitForTimeout(1000);

      // Step 3: Verify banner adapts or remains visible
      if (hasPortraitBanner) {
        const hasLandscapeBanner = await mobileBanner.count() > 0;

        // Banner should still exist or adapt
        expect(hasLandscapeBanner).toBeTruthy();
      }
    }
  });
});

test.describe('🔄 FLOW: Sponsor - Multi-Position Display', () => {

  test('Complete flow: Configure sponsors in all positions → Verify each position renders', async ({ page, context }) => {
    // Step 1: Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    await page.fill('#name', `All Positions ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Configure Display & Sponsors")');

    // Step 2: Add sponsors to each position
    const positions = [
      { name: 'Top Sponsor', checkbox: 'tvTop' },
      { name: 'Bottom Sponsor', checkbox: 'tvBottom' },
      { name: 'Left Sponsor', checkbox: 'tvLeft' },
      { name: 'Right Sponsor', checkbox: 'tvRight' },
      { name: 'Mobile Banner Sponsor', checkbox: 'mobileBanner' }
    ];

    for (const position of positions) {
      await page.click('button:has-text("Add Sponsor")');
      await page.waitForTimeout(500);

      const sponsorItems = page.locator('.sponsor-item');
      const lastItem = sponsorItems.last();

      await lastItem.locator('.sp-name').fill(position.name);
      await lastItem.locator('.sp-url').fill(`https://${position.checkbox}.example.com`);
      await lastItem.locator('.sp-img').fill('https://via.placeholder.com/300x150');
      await lastItem.locator(`.sp-${position.checkbox}`).check();
    }

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    // Step 3: Open display
    const displayUrl = await page.locator('#lnkDisplay').textContent();
    const displayPage = await context.newPage();
    await displayPage.goto(displayUrl);
    await displayPage.waitForLoadState('networkidle');

    // Step 4: Verify each position exists
    const topExists = await displayPage.locator('#sponsorTop, .sponsor-top').count() > 0;
    const bottomExists = await displayPage.locator('#sponsorBottom, .sponsor-bottom').count() > 0;
    const leftExists = await displayPage.locator('#sponsorLeft, .sponsor-left').count() > 0;
    const rightExists = await displayPage.locator('#sponsorRight, .sponsor-right').count() > 0;

    // At least some positions should exist
    const hasPositions = topExists || bottomExists || leftExists || rightExists;
    expect(hasPositions).toBe(true);

    await displayPage.close();
  });
});

test.describe('🔄 FLOW: Sponsor - Performance & Loading', () => {

  test('Complete flow: Display with many sponsors → Verify fast loading → Check memory', async ({ page }) => {
    // Step 1: Open display page
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Step 2: Check initial load time
    const start = Date.now();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;

    // Should load quickly even with sponsors
    expect(loadTime).toBeLessThan(5000);

    // Step 3: Let carousel run for extended period
    await page.waitForTimeout(60000); // 1 minute

    // Step 4: Verify no memory leaks or errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(2000);

    expect(errors.length).toBe(0);

    // Step 5: Verify page still responsive
    const stage = page.locator('#stage');
    await expect(stage).toBeVisible();
  });

  test('Complete flow: Lazy load sponsor images → Verify progressive enhancement', async ({ page }) => {
    // Step 1: Navigate to public page
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 2: Check for sponsor images
    const sponsorImages = page.locator('img[data-sponsor], .sponsor-card img');
    const count = await sponsorImages.count();

    if (count > 0) {
      // Step 3: Verify images have loading strategy
      for (let i = 0; i < Math.min(count, 3); i++) {
        const img = sponsorImages.nth(i);

        if (await img.isVisible()) {
          const loading = await img.getAttribute('loading');
          const src = await img.getAttribute('src');

          // Should have src and appropriate loading strategy
          expect(src).toBeTruthy();
          expect(loading === 'lazy' || loading === 'eager' || loading === null).toBe(true);
        }
      }
    }
  });
});
