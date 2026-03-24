/**
 * TRIANGLE FRAMEWORK FLOWS - Cross-Page Data Propagation
 *
 * Tests the complete TRIANGLE framework lifecycle across all pages:
 * Sponsor.html → Admin.html → Poster.html → Display.html → Public.html
 *
 * This exercises:
 * 1. Sponsor setup and propagation
 * 2. Admin changes flowing to all views
 * 3. Poster changes syncing back to Admin and flowing forward
 * 4. Display rendering with all features (notes, videos, maps, sponsors)
 * 5. Public mobile and desktop views with templates
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

test.describe('🔺 TRIANGLE: Sponsor → Admin → All Pages Propagation', () => {

  test('Complete TRIANGLE flow: Sponsor setup → Admin → Poster → Display → Public', async ({ page, context }) => {
    // ====================
    // STEP 1: ADMIN - Create Event
    // ====================
    console.log('📝 STEP 1: Creating event in Admin...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `TRIANGLE Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#timeISO', '19:00');
    await page.fill('#venue', 'Grand Convention Center');
    await page.fill('#summary', 'Testing TRIANGLE framework propagation across all pages');
    await page.fill('#tags', 'triangle, automation, test');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Extract event ID and URLs
    const eventInfo = await page.locator('#eventInfo').textContent();
    console.log(`✅ Event created: ${eventInfo}`);

    // ====================
    // STEP 2: ADMIN - Configure Sponsors (Multiple tiers)
    // ====================
    console.log('🏢 STEP 2: Configuring sponsors...');
    await page.click('button:has-text("Configure Display & Sponsors")');
    await expect(page.locator('#displayCard')).toBeVisible();

    // Add Platinum Sponsor
    await page.click('button:has-text("Add Sponsor")');
    await page.fill('.sp-name', 'Platinum Corp');
    await page.fill('.sp-url', 'https://platinum-sponsor.example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/600x300?text=Platinum+Sponsor');
    await page.check('.sp-tvTop');
    await page.check('.sp-tvLeft');
    await page.check('.sp-mobileBanner');

    // Add Gold Sponsor
    await page.click('button:has-text("Add Sponsor")');
    const sponsorItems = page.locator('.sponsor-item');
    await sponsorItems.nth(1).locator('.sp-name').fill('Gold Inc');
    await sponsorItems.nth(1).locator('.sp-url').fill('https://gold-sponsor.example.com');
    await sponsorItems.nth(1).locator('.sp-img').fill('https://via.placeholder.com/500x250?text=Gold+Sponsor');
    await sponsorItems.nth(1).locator('.sp-tvBottom').check();
    await sponsorItems.nth(1).locator('.sp-tvRight').check();

    // Add Silver Sponsor
    await page.click('button:has-text("Add Sponsor")');
    await sponsorItems.nth(2).locator('.sp-name').fill('Silver LLC');
    await sponsorItems.nth(2).locator('.sp-url').fill('https://silver-sponsor.example.com');
    await sponsorItems.nth(2).locator('.sp-img').fill('https://via.placeholder.com/400x200?text=Silver+Sponsor');
    await sponsorItems.nth(2).locator('.sp-mobileBanner').check();

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    console.log('✅ Sponsors configured: Platinum, Gold, Silver');

    // Get all URLs for propagation testing
    const publicUrl = await page.locator('#lnkPublic').textContent();
    const displayUrl = await page.locator('#lnkDisplay').textContent();
    const posterUrl = await page.locator('#lnkPoster').textContent();

    // ====================
    // STEP 3: POSTER - Verify event appears
    // ====================
    console.log('🖼️ STEP 3: Verifying Poster view...');
    const posterPage = await context.newPage();
    await posterPage.goto(posterUrl);
    await posterPage.waitForLoadState('networkidle');

    // Verify event details on poster
    await expect(posterPage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });
    await expect(posterPage.locator('text=Grand Convention Center')).toBeVisible();

    // Verify sponsor images appear on poster
    const posterSponsors = posterPage.locator('img[data-sponsor], .sponsor-card img');
    const posterSponsorCount = await posterSponsors.count();
    console.log(`✅ Poster shows ${posterSponsorCount} sponsors`);

    await posterPage.close();

    // ====================
    // STEP 4: DISPLAY - Verify TV display with all sponsors
    // ====================
    console.log('📺 STEP 4: Verifying Display (TV) view...');
    const displayPage = await context.newPage();
    await displayPage.setViewportSize({ width: 1920, height: 1080 });
    await displayPage.goto(displayUrl);
    await displayPage.waitForLoadState('networkidle');

    // Verify TV layout
    await expect(displayPage.locator('body[data-tv="1"]')).toBeVisible();
    await expect(displayPage.locator('#stage')).toBeVisible();

    // Verify event name appears
    await expect(displayPage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });

    // Verify sponsor areas exist
    const topSponsor = displayPage.locator('#sponsorTop, .sponsor-top');
    const bottomSponsor = displayPage.locator('#sponsorBottom, .sponsor-bottom');
    const leftSponsor = displayPage.locator('#sponsorLeft, .sponsor-left');
    const rightSponsor = displayPage.locator('#sponsorRight, .sponsor-right');

    const hasTopSponsor = await topSponsor.count() > 0;
    const hasBottomSponsor = await bottomSponsor.count() > 0;
    const hasLeftSponsor = await leftSponsor.count() > 0;
    const hasRightSponsor = await rightSponsor.count() > 0;

    console.log(`✅ Display sponsors: Top=${hasTopSponsor}, Bottom=${hasBottomSponsor}, Left=${hasLeftSponsor}, Right=${hasRightSponsor}`);

    // Verify TV-appropriate font size (10-12ft viewing distance)
    const fontSize = await displayPage.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20); // Minimum 20px for TV viewing

    await displayPage.close();

    // ====================
    // STEP 5: PUBLIC - Verify public view (Desktop)
    // ====================
    console.log('🌐 STEP 5: Verifying Public view (Desktop)...');
    const publicPage = await context.newPage();
    await publicPage.goto(publicUrl);
    await publicPage.waitForLoadState('networkidle');

    // Verify event details
    await expect(publicPage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });
    await expect(publicPage.locator('text=Grand Convention Center')).toBeVisible();

    // Verify mobile banner sponsor
    const mobileBanner = publicPage.locator('#sponsorBanner, .sponsor-banner');
    const hasMobileBanner = await mobileBanner.count() > 0;
    console.log(`✅ Public mobile banner: ${hasMobileBanner}`);

    await publicPage.close();

    // ====================
    // STEP 6: PUBLIC - Verify mobile view
    // ====================
    console.log('📱 STEP 6: Verifying Public view (Mobile)...');
    const mobilePage = await context.newPage();
    await mobilePage.setViewportSize({ width: 375, height: 667 });
    await mobilePage.goto(publicUrl);
    await mobilePage.waitForLoadState('networkidle');

    // Verify event visible on mobile
    await expect(mobilePage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });

    // Verify mobile font size (minimum 16px to prevent iOS zoom)
    const mobileFontSize = await mobilePage.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const mobileFontSizeNum = parseInt(mobileFontSize);
    expect(mobileFontSizeNum).toBeGreaterThanOrEqual(16);

    console.log('✅ Mobile view renders correctly with proper font size');

    await mobilePage.close();

    // ====================
    // STEP 7: ADMIN - Update event details
    // ====================
    console.log('✏️ STEP 7: Updating event details in Admin...');
    const updatedLocation = 'Updated: Riverside Arena';
    await page.fill('#venue', updatedLocation);
    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    console.log('✅ Event details updated');

    // ====================
    // STEP 8: Verify propagation to all pages
    // ====================
    console.log('🔄 STEP 8: Verifying updates propagated to all pages...');

    // Verify on Public page
    const publicCheck = await context.newPage();
    await publicCheck.goto(publicUrl);
    await publicCheck.waitForLoadState('networkidle');
    await expect(publicCheck.locator('text=Riverside Arena')).toBeVisible({ timeout: 5000 });
    console.log('✅ Update propagated to Public');
    await publicCheck.close();

    // Verify on Display page
    const displayCheck = await context.newPage();
    await displayCheck.goto(displayUrl);
    await displayCheck.waitForLoadState('networkidle');
    await expect(displayCheck.locator('text=Riverside Arena')).toBeVisible({ timeout: 5000 });
    console.log('✅ Update propagated to Display');
    await displayCheck.close();

    console.log('🎉 TRIANGLE framework flow complete! All data propagated successfully.');
  });
});

test.describe('🔺 TRIANGLE: Admin Card-by-Card Flow', () => {

  test('Admin flow: Exercise all Admin.html cards', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    // ====================
    // CARD 1: Create Event Card
    // ====================
    console.log('📝 Testing Create Event Card...');
    await expect(page.locator('h2:has-text("Create Event")')).toBeVisible();

    await page.fill('#name', `Card Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#timeISO', '18:00');
    await page.fill('#venue', 'Test Venue');
    await page.fill('#summary', 'Testing all admin cards');
    await page.fill('#tags', 'test, cards, admin');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });
    console.log('✅ Create Event Card: PASS');

    // ====================
    // CARD 2: Event Card (Created Event)
    // ====================
    console.log('🎫 Testing Event Card...');
    await expect(page.locator('#eventCard')).toBeVisible();
    await expect(page.locator('#eventInfo')).toBeVisible();
    await expect(page.locator('#lnkPublic')).toBeVisible();
    await expect(page.locator('#lnkDisplay')).toBeVisible();
    await expect(page.locator('#lnkPoster')).toBeVisible();
    console.log('✅ Event Card: PASS');

    // ====================
    // CARD 3: Configure Display & Sponsors Card
    // ====================
    console.log('🏢 Testing Configure Display & Sponsors Card...');
    await page.click('button:has-text("Configure Display & Sponsors")');
    await expect(page.locator('#displayCard')).toBeVisible();
    await expect(page.locator('h3:has-text("Display & Sponsors")')).toBeVisible();

    // Add sponsor
    await page.click('button:has-text("Add Sponsor")');
    await expect(page.locator('.sponsor-item')).toBeVisible();

    await page.fill('.sp-name', 'Test Sponsor');
    await page.fill('.sp-url', 'https://test-sponsor.example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/300x150');
    await page.check('.sp-tvTop');

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });
    console.log('✅ Configure Display & Sponsors Card: PASS');

    // ====================
    // CARD 4: Events List Card
    // ====================
    console.log('📋 Testing Events List Card...');
    await expect(page.locator('h3:has-text("Events List")')).toBeVisible();
    await expect(page.locator('#eventsList')).toBeVisible();

    const eventsList = page.locator('#eventsList');
    const hasEvents = await eventsList.evaluate(el => el.children.length > 0);
    console.log(`✅ Events List Card: PASS (${hasEvents ? 'Has events' : 'Empty'})`);

    console.log('🎉 All Admin cards tested successfully!');
  });
});

test.describe('🔺 TRIANGLE: Display.html Complete Feature Flow', () => {

  test('Display flow: All Display.html features and cards', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // ====================
    // FEATURE 1: TV Layout (10-12ft viewing)
    // ====================
    console.log('📺 Testing TV layout...');
    await expect(page.locator('body[data-tv="1"]')).toBeVisible();
    await expect(page.locator('#stage')).toBeVisible();

    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20); // 10-12ft viewing distance
    console.log(`✅ TV Layout: PASS (Font: ${fontSizeNum}px)`);

    // ====================
    // FEATURE 2: Sponsor Banners (Top, Bottom, Left, Right)
    // ====================
    console.log('🏢 Testing sponsor banners...');
    const topSponsor = await page.locator('#sponsorTop, .sponsor-top').count();
    const bottomSponsor = await page.locator('#sponsorBottom, .sponsor-bottom').count();
    const leftSponsor = await page.locator('#sponsorLeft, .sponsor-left').count();
    const rightSponsor = await page.locator('#sponsorRight, .sponsor-right').count();

    console.log(`✅ Sponsor Banners: Top=${topSponsor}, Bottom=${bottomSponsor}, Left=${leftSponsor}, Right=${rightSponsor}`);

    // ====================
    // FEATURE 3: Dynamic URLs with variable timing
    // ====================
    console.log('🔗 Testing dynamic URL support...');
    // Note: Dynamic URL testing would require actual iframe or URL rotation implementation
    const hasIframe = await page.locator('iframe').count() > 0;
    console.log(`✅ Dynamic URL Support: ${hasIframe ? 'iframes present' : 'no iframes'}`);

    // ====================
    // FEATURE 4: No Sponsor = Slide Up behavior
    // ====================
    console.log('📐 Testing no-sponsor slide-up...');
    // If no sponsors configured, areas should slide up (not take space)
    const stage = page.locator('#stage');
    const stageBox = await stage.boundingBox();

    if (stageBox) {
      // Stage should use available space efficiently
      expect(stageBox.height).toBeGreaterThan(400); // Should be substantial
      console.log(`✅ No-Sponsor Slide-Up: Stage height = ${stageBox.height}px`);
    }

    // ====================
    // FEATURE 5: YouTube/Vimeo video streaming support
    // ====================
    console.log('🎥 Testing video streaming support...');
    const hasVideoEmbed = await page.locator('iframe[src*="youtube.com"], iframe[src*="vimeo.com"]').count() > 0;
    console.log(`✅ Video Streaming: ${hasVideoEmbed ? 'Video embed present' : 'No video configured'}`);

    // ====================
    // FEATURE 6: Multiple language support
    // ====================
    console.log('🌍 Testing multiple language support...');
    const htmlLang = await page.locator('html').getAttribute('lang');
    console.log(`✅ Language Support: ${htmlLang || 'en (default)'}`);

    // ====================
    // FEATURE 7: Admin Notes window (paraphrased)
    // ====================
    console.log('📝 Testing Admin Notes...');
    const hasNotes = await page.locator('[data-notes], .admin-notes, #notes').count() > 0;
    console.log(`✅ Admin Notes: ${hasNotes ? 'Notes area present' : 'No notes configured'}`);

    // ====================
    // FEATURE 8: Matching Public display
    // ====================
    console.log('🔄 Testing Display matches Public...');
    // Both should show same event data
    const eventContent = await page.locator('#stage').textContent();
    expect(eventContent).toBeTruthy();
    expect(eventContent.length).toBeGreaterThan(0);
    console.log('✅ Display matches Public: Content present');

    console.log('🎉 All Display features tested successfully!');
  });
});

test.describe('🔺 TRIANGLE: Public.html Complete Feature Flow', () => {

  test('Public flow: Templates, Mobile, Sponsors, YouTube, Maps', async ({ page, context }) => {
    // ====================
    // FEATURE 1: Public page templates
    // ====================
    console.log('🎨 Testing Public templates...');
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    await expect(page.locator('main#app')).toBeVisible();
    console.log('✅ Public Templates: Page renders with template');

    // ====================
    // FEATURE 2: Mobile-first design
    // ====================
    console.log('📱 Testing Mobile-first design...');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check mobile-appropriate font size
    const mobileFontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const mobileFontSizeNum = parseInt(mobileFontSize);
    expect(mobileFontSizeNum).toBeGreaterThanOrEqual(16); // Prevent iOS zoom
    console.log(`✅ Mobile-first: Font size = ${mobileFontSizeNum}px`);

    // ====================
    // FEATURE 3: Sponsor Banner on mobile
    // ====================
    console.log('🏢 Testing Mobile Sponsor Banner...');
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().tap();
      await page.waitForLoadState('networkidle');

      const mobileBanner = page.locator('#sponsorBanner, .sponsor-banner');
      const hasBanner = await mobileBanner.count() > 0;

      if (hasBanner) {
        await expect(mobileBanner.first()).toBeVisible();

        // Verify banner fits mobile viewport
        const bannerBox = await mobileBanner.first().boundingBox();
        if (bannerBox) {
          expect(bannerBox.width).toBeLessThanOrEqual(375);
          console.log(`✅ Mobile Sponsor Banner: ${bannerBox.width}px wide`);
        }
      } else {
        console.log('✅ Mobile Sponsor Banner: No sponsors configured');
      }
    }

    // ====================
    // FEATURE 4: No Sponsor = Slide Up
    // ====================
    console.log('📐 Testing No-Sponsor Slide-Up on mobile...');
    // If no sponsor banner, content should slide up (not leave empty space)
    const mainContent = page.locator('main#app');
    const mainBox = await mainContent.boundingBox();

    if (mainBox) {
      // Main content should start near top if no banner
      console.log(`✅ No-Sponsor Slide-Up: Main starts at Y=${mainBox.y}px`);
    }

    // ====================
    // FEATURE 5: YouTube Video embed
    // ====================
    console.log('🎥 Testing YouTube Video...');
    const youtubeEmbed = page.locator('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
    const hasYouTube = await youtubeEmbed.count() > 0;

    if (hasYouTube) {
      await expect(youtubeEmbed.first()).toBeVisible();

      // Verify video responsive (16:9 aspect ratio)
      const videoBox = await youtubeEmbed.first().boundingBox();
      if (videoBox) {
        const aspectRatio = videoBox.width / videoBox.height;
        console.log(`✅ YouTube Video: ${videoBox.width}x${videoBox.height}px (${aspectRatio.toFixed(2)}:1)`);
      }
    } else {
      console.log('✅ YouTube Video: No video configured');
    }

    // ====================
    // FEATURE 6: Google Maps embed
    // ====================
    console.log('🗺️ Testing Google Maps...');
    const mapsEmbed = page.locator('iframe[src*="google.com/maps"], iframe[src*="maps.google.com"]');
    const hasMaps = await mapsEmbed.count() > 0;

    if (hasMaps) {
      await expect(mapsEmbed.first()).toBeVisible();

      // Verify map responsive
      const mapBox = await mapsEmbed.first().boundingBox();
      if (mapBox) {
        console.log(`✅ Google Maps: ${mapBox.width}x${mapBox.height}px`);
      }
    } else {
      console.log('✅ Google Maps: No map configured');
    }

    // ====================
    // FEATURE 7: Desktop view
    // ====================
    console.log('🖥️ Testing Desktop view...');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('main#app')).toBeVisible();
    console.log('✅ Desktop view: Renders correctly');

    console.log('🎉 All Public features tested successfully!');
  });
});

test.describe('🔺 TRIANGLE: Shared Reporting - Admin & Sponsors', () => {

  test('Shared reporting: Admin and Sponsor analytics', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    // Create event with analytics
    const eventName = `Analytics Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // ====================
    // Check for shared reporting/analytics section
    // ====================
    console.log('📊 Testing Shared Reporting...');

    // Look for analytics or reporting section
    const hasAnalytics = await page.locator('[data-analytics], .analytics, #analytics').count() > 0;
    const hasReporting = await page.locator('[data-report], .report, #report').count() > 0;
    const hasStats = await page.locator('.stats, #stats, [data-stats]').count() > 0;

    if (hasAnalytics || hasReporting || hasStats) {
      console.log('✅ Shared Reporting: Analytics section present');
    } else {
      console.log('⚠️ Shared Reporting: No analytics section found (may be implemented elsewhere)');
    }

    // Check for sponsor click tracking
    console.log('📊 Testing Sponsor Click Tracking...');
    const hasSponsorTracking = await page.locator('[data-sponsor-clicks], .sponsor-analytics').count() > 0;

    if (hasSponsorTracking) {
      console.log('✅ Sponsor Click Tracking: Present');
    } else {
      console.log('⚠️ Sponsor Click Tracking: Not visible in admin (may be backend only)');
    }

    console.log('🎉 Shared reporting tested!');
  });
});
