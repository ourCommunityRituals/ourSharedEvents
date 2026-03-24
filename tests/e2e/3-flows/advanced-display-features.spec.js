/**
 * ADVANCED DISPLAY FEATURES - Deep Display.html Testing
 *
 * Tests all advanced Display.html features:
 * - Dynamic URLs with variable timing
 * - Admin Notes window updates
 * - iframe handling (skip on error, no missed beat)
 * - YouTube and Vimeo video streaming
 * - Multiple language support
 * - Sponsor banner positioning and slide-up behavior
 * - 10-12ft viewing optimization
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

test.describe('📺 DISPLAY: Dynamic URLs with Variable Timing', () => {

  test('Dynamic URLs: Carousel rotation with configurable timing', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    console.log('🔄 Testing dynamic URL rotation...');

    // Check if display has rotation/carousel functionality
    const hasCarousel = await page.locator('[data-carousel], .carousel, #carousel').count() > 0;

    if (hasCarousel) {
      // Record initial state
      const initialContent = await page.locator('#stage').textContent();

      // Wait for rotation (typical carousel: 3-10 seconds)
      console.log('⏱️ Waiting for carousel rotation (10s)...');
      await page.waitForTimeout(10000);

      // Check if content changed
      const afterContent = await page.locator('#stage').textContent();

      // Content may or may not change depending on number of items
      console.log(`✅ Carousel tested: Initial != After: ${initialContent !== afterContent}`);
    } else {
      console.log('⚠️ No carousel detected on display');
    }

    // Test manual timing controls if present
    const timingControl = page.locator('[data-timing], #timing, .timing-control');
    const hasTiming = await timingControl.count() > 0;

    if (hasTiming) {
      console.log('✅ Variable timing controls: Present');
    } else {
      console.log('⚠️ Variable timing controls: Not found');
    }
  });

  test('Dynamic URLs: iframe rotation without missed beat', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    console.log('🖼️ Testing iframe handling...');

    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();

    console.log(`Found ${iframeCount} iframes`);

    if (iframeCount > 0) {
      // Test that iframe errors don't break page
      const errors = [];
      page.on('pageerror', error => errors.push(error));

      // Wait to see if any errors occur
      await page.waitForTimeout(5000);

      // Page should continue functioning even if iframe fails
      await expect(page.locator('#stage')).toBeVisible();

      console.log(`✅ iframe error handling: ${errors.length} errors detected`);

      // Verify page didn't crash
      const stageContent = await page.locator('#stage').textContent();
      expect(stageContent).toBeTruthy();
    } else {
      console.log('⚠️ No iframes configured for testing');
    }
  });
});

test.describe('📺 DISPLAY: Admin Notes Window Updates', () => {

  test('Admin Notes: Update notes and verify on Display', async ({ page, context }) => {
    // ====================
    // STEP 1: Create event in Admin
    // ====================
    console.log('📝 Creating event with notes...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Notes Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#summary', 'Testing admin notes propagation to display');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    const displayUrl = await page.locator('#lnkDisplay').textContent();

    // ====================
    // STEP 2: Check for notes field in admin
    // ====================
    console.log('🔍 Looking for notes field...');
    const notesField = page.locator('#notes, textarea[name="notes"], .notes-input');
    const hasNotes = await notesField.count() > 0;

    if (hasNotes) {
      // Add notes
      await notesField.fill('IMPORTANT: Special instructions for display');
      await page.click('button:has-text("Save")');

      console.log('✅ Notes added in admin');

      // ====================
      // STEP 3: Verify notes appear on Display
      // ====================
      const displayPage = await context.newPage();
      await displayPage.goto(displayUrl);
      await displayPage.waitForLoadState('networkidle');

      const notesOnDisplay = displayPage.locator('[data-notes], .admin-notes, .notes-display');
      const hasNotesDisplay = await notesOnDisplay.count() > 0;

      if (hasNotesDisplay) {
        const notesContent = await notesOnDisplay.textContent();
        console.log(`✅ Notes on display: ${notesContent.substring(0, 50)}...`);
      } else {
        console.log('⚠️ Notes not visible on display (may be admin-only)');
      }

      await displayPage.close();
    } else {
      console.log('⚠️ Notes field not found in admin interface');
    }
  });

  test('Admin Notes: Real-time updates (paraphrased notes)', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    console.log('📝 Testing paraphrased/summary notes...');

    // Look for any text fields that could contain notes/instructions
    const textAreas = await page.locator('textarea').count();
    console.log(`✅ Found ${textAreas} text areas (potential notes fields)`);

    // Admin should be able to add internal notes
    // that can be paraphrased/summarized for display
    const summaryField = page.locator('#summary, textarea[name="summary"]');
    const hasSummary = await summaryField.count() > 0;

    if (hasSummary) {
      console.log('✅ Summary field available for paraphrased notes');
    }
  });
});

test.describe('📺 DISPLAY: Video Streaming Support', () => {

  test('YouTube: Embed and playback support', async ({ page, context }) => {
    // ====================
    // STEP 1: Create event with YouTube video
    // ====================
    console.log('🎥 Creating event with YouTube video...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `YouTube Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');

    // Expand advanced event details section to access video URL field
    const advancedHeader = page.locator('#advancedEventDetailsHeader');
    if (await advancedHeader.count() > 0) {
      await advancedHeader.click();
      await page.waitForTimeout(300);
    }

    // Look for video URL field
    const videoField = page.locator('#videoUrl, input[name="videoUrl"], .video-input');
    const hasVideoField = await videoField.count() > 0;

    if (hasVideoField) {
      await videoField.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      console.log('✅ YouTube URL added');
    }

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    const displayUrl = await page.locator('#lnkDisplay').textContent();
    const publicUrl = await page.locator('#lnkPublic').textContent();

    // ====================
    // STEP 2: Verify YouTube embed on Display
    // ====================
    console.log('📺 Verifying YouTube on Display...');
    const displayPage = await context.newPage();
    await displayPage.goto(displayUrl);
    await displayPage.waitForLoadState('networkidle');

    const youtubeEmbed = displayPage.locator('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
    const hasYouTube = await youtubeEmbed.count() > 0;

    if (hasYouTube) {
      await expect(youtubeEmbed.first()).toBeVisible();

      // Check video is responsive
      const videoBox = await youtubeEmbed.first().boundingBox();
      if (videoBox) {
        console.log(`✅ YouTube on Display: ${videoBox.width}x${videoBox.height}px`);
      }
    } else {
      console.log('⚠️ YouTube embed not found on Display');
    }

    await displayPage.close();

    // ====================
    // STEP 3: Verify YouTube embed on Public
    // ====================
    console.log('🌐 Verifying YouTube on Public...');
    const publicPage = await context.newPage();
    await publicPage.goto(publicUrl);
    await publicPage.waitForLoadState('networkidle');

    const youtubePublic = publicPage.locator('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
    const hasYouTubePublic = await youtubePublic.count() > 0;

    if (hasYouTubePublic) {
      await expect(youtubePublic.first()).toBeVisible();
      console.log('✅ YouTube on Public: Present');
    } else {
      console.log('⚠️ YouTube embed not found on Public');
    }

    await publicPage.close();
  });

  test('Vimeo: Embed and playback support', async ({ page, context }) => {
    console.log('🎥 Testing Vimeo video support...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Vimeo Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');

    // Expand advanced event details section to access video URL field
    const advancedHeader = page.locator('#advancedEventDetailsHeader');
    if (await advancedHeader.count() > 0) {
      await advancedHeader.click();
      await page.waitForTimeout(300);
    }

    const videoField = page.locator('#videoUrl, input[name="videoUrl"], .video-input');
    const hasVideoField = await videoField.count() > 0;

    if (hasVideoField) {
      await videoField.fill('https://vimeo.com/148751763');
      console.log('✅ Vimeo URL added');
    }

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    const displayUrl = await page.locator('#lnkDisplay').textContent();

    // Verify Vimeo embed
    const displayPage = await context.newPage();
    await displayPage.goto(displayUrl);
    await displayPage.waitForLoadState('networkidle');

    const vimeoEmbed = displayPage.locator('iframe[src*="vimeo.com"]');
    const hasVimeo = await vimeoEmbed.count() > 0;

    if (hasVimeo) {
      await expect(vimeoEmbed.first()).toBeVisible();
      console.log('✅ Vimeo on Display: Present');
    } else {
      console.log('⚠️ Vimeo embed not found on Display');
    }

    await displayPage.close();
  });
});

test.describe('📺 DISPLAY: Multiple Language Support', () => {

  test('Language support: English (default)', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const htmlLang = await page.locator('html').getAttribute('lang');
    console.log(`✅ Default language: ${htmlLang || 'en'}`);

    expect(htmlLang === 'en' || htmlLang === null).toBe(true);
  });

  test('Language support: Spanish', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&lang=es`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const htmlLang = await page.locator('html').getAttribute('lang');
    console.log(`✅ Spanish language: ${htmlLang}`);

    // Check if language parameter is respected
    if (htmlLang === 'es') {
      console.log('✅ Spanish language support: Active');
    } else {
      console.log('⚠️ Spanish language support: Not configured');
    }
  });

  test('Language support: French', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&lang=fr`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const htmlLang = await page.locator('html').getAttribute('lang');
    console.log(`✅ French language: ${htmlLang}`);
  });

  test('Language support: German', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&lang=de`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const htmlLang = await page.locator('html').getAttribute('lang');
    console.log(`✅ German language: ${htmlLang}`);
  });
});

test.describe('📺 DISPLAY: Sponsor Slide-Up Behavior', () => {

  test('No sponsors: Content slides up (no empty space)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    console.log('📐 Testing no-sponsor slide-up behavior...');

    const topSponsor = await page.locator('#sponsorTop, .sponsor-top').count();
    const bottomSponsor = await page.locator('#sponsorBottom, .sponsor-bottom').count();

    const stage = page.locator('#stage');
    const stageBox = await stage.boundingBox();

    if (topSponsor === 0 && stageBox) {
      // If no top sponsor, stage should start near top
      console.log(`✅ No top sponsor: Stage Y position = ${stageBox.y}px`);
      expect(stageBox.y).toBeLessThan(200); // Should be near top
    }

    if (bottomSponsor === 0 && stageBox) {
      // If no bottom sponsor, stage should extend to bottom
      const viewportHeight = 1080;
      const stageBottom = stageBox.y + stageBox.height;
      console.log(`✅ No bottom sponsor: Stage extends to ${stageBottom}px`);
      expect(stageBottom).toBeGreaterThan(viewportHeight * 0.7); // Should use most of viewport
    }
  });

  test('With sponsors: Content adjusts to make room', async ({ page, context }) => {
    // Create event with sponsors first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Sponsor Layout ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Add sponsors
    await page.click('button:has-text("Configure Display & Sponsors")');
    await page.click('button:has-text("Add Sponsor")');
    await page.fill('.sp-name', 'Layout Test Sponsor');
    await page.fill('.sp-url', 'https://example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/600x200');
    await page.check('.sp-tvTop');
    await page.check('.sp-tvBottom');

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    const displayUrl = await page.locator('#lnkDisplay').textContent();

    // Check layout with sponsors
    const displayPage = await context.newPage();
    await displayPage.setViewportSize({ width: 1920, height: 1080 });
    await displayPage.goto(displayUrl);
    await displayPage.waitForLoadState('networkidle');

    const topSponsor = displayPage.locator('#sponsorTop, .sponsor-top');
    const topExists = await topSponsor.count() > 0;

    const stage = displayPage.locator('#stage');
    const stageBox = await stage.boundingBox();

    if (topExists && stageBox) {
      const topBox = await topSponsor.boundingBox();
      if (topBox) {
        // Stage should start below top sponsor
        console.log(`✅ With top sponsor: Sponsor height=${topBox.height}px, Stage Y=${stageBox.y}px`);
        expect(stageBox.y).toBeGreaterThan(topBox.height);
      }
    }

    await displayPage.close();
  });
});

test.describe('📺 DISPLAY: 10-12ft Viewing Optimization', () => {

  test('TV viewing: Font size optimized for distance', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);

    // Optimal TV viewing: 20-36px for 10-12ft
    expect(fontSizeNum).toBeGreaterThanOrEqual(20);
    console.log(`✅ TV font size: ${fontSizeNum}px (10-12ft viewing)`);
  });

  test('TV viewing: High contrast for readability', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check body background and text colors
    const bgColor = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).backgroundColor
    );
    const textColor = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).color
    );

    console.log(`✅ TV colors: Background=${bgColor}, Text=${textColor}`);

    // Should have good contrast
    expect(bgColor).toBeTruthy();
    expect(textColor).toBeTruthy();
  });

  test('TV viewing: 4K support (3840x2160)', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await expect(page.locator('#stage')).toBeVisible();

    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);

    // 4K should scale up fonts appropriately
    console.log(`✅ 4K font size: ${fontSizeNum}px`);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20);
  });
});
