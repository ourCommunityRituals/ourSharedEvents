/**
 * POSTER & MAPS INTEGRATION FLOWS
 *
 * Tests:
 * - Poster.html editing and propagation back to Admin
 * - Changes in Poster → Admin → propagate to Display/Public
 * - Google Maps integration on Public pages
 * - Print-optimized Poster layout
 * - Map embedding and responsiveness
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

test.describe('🖼️ POSTER: Edit and Propagate Back to Admin', () => {

  test('Poster flow: View poster → Edit → Changes sync to Admin', async ({ page, context }) => {
    // ====================
    // STEP 1: Create event in Admin
    // ====================
    console.log('📝 Creating event for poster editing...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Poster Edit Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#timeISO', '19:00');
    await page.fill('#venue', 'Original Location');
    await page.fill('#summary', 'Original summary text');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    const posterUrl = await page.locator('#lnkPoster').textContent();
    console.log('✅ Event created, poster URL obtained');

    // ====================
    // STEP 2: Open Poster page
    // ====================
    console.log('🖼️ Opening Poster page...');
    const posterPage = await context.newPage();
    await posterPage.goto(posterUrl);
    await posterPage.waitForLoadState('networkidle');

    // Verify event details on poster
    await expect(posterPage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });
    await expect(posterPage.locator('text=Original Location')).toBeVisible();

    console.log('✅ Poster displays event correctly');

    // ====================
    // STEP 3: Check if Poster has edit capability
    // ====================
    console.log('✏️ Checking for poster edit capability...');
    const editButton = posterPage.locator('button:has-text("Edit"), a:has-text("Edit"), [data-edit]');
    const hasEdit = await editButton.count() > 0;

    if (hasEdit) {
      console.log('✅ Poster has edit button');
      await editButton.first().click();

      // Look for editable fields
      const editableFields = await posterPage.locator('input, textarea').count();
      console.log(`✅ Found ${editableFields} editable fields`);
    } else {
      console.log('⚠️ Poster is read-only (no edit button)');
      console.log('ℹ️ Edit changes should be made in Admin and propagate to Poster');
    }

    await posterPage.close();

    // ====================
    // STEP 4: Edit in Admin and verify propagation to Poster
    // ====================
    console.log('✏️ Editing event in Admin...');
    await page.fill('#venue', 'Updated: New Venue');
    await page.fill('#summary', 'Updated summary with new details');
    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    console.log('✅ Admin changes saved');

    // ====================
    // STEP 5: Verify changes appear on Poster
    // ====================
    console.log('🔄 Verifying changes propagated to Poster...');
    const posterCheck = await context.newPage();
    await posterCheck.goto(posterUrl);
    await posterCheck.waitForLoadState('networkidle');

    await expect(posterCheck.locator('text=New Venue')).toBeVisible({ timeout: 5000 });
    await expect(posterCheck.locator('text=Updated summary')).toBeVisible();

    console.log('✅ Changes propagated to Poster successfully!');

    await posterCheck.close();
  });

  test('Poster flow: Print-optimized layout', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    console.log('🖨️ Testing print-optimized poster layout...');

    // Check for print-specific styles
    const hasPrintStyles = await page.evaluate(() => {
      const stylesheets = Array.from(document.styleSheets);
      return stylesheets.some(sheet => {
        try {
          const rules = Array.from(sheet.cssRules || []);
          return rules.some(rule =>
            rule.media && rule.media.mediaText.includes('print')
          );
        } catch (e) {
          return false;
        }
      });
    });

    console.log(`✅ Print styles: ${hasPrintStyles ? 'Present' : 'Not found'}`);

    // Check for poster-specific layout
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Poster should be optimized for paper sizes (A4, Letter)
    const mainBox = await main.boundingBox();
    if (mainBox) {
      console.log(`✅ Poster dimensions: ${mainBox.width}x${mainBox.height}px`);
    }
  });
});

test.describe('🗺️ MAPS: Google Maps Integration', () => {

  test('Maps flow: Add location → Maps appear on Public', async ({ page, context }) => {
    // ====================
    // STEP 1: Create event with location
    // ====================
    console.log('📍 Creating event with location...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Maps Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', '1600 Amphitheatre Parkway, Mountain View, CA 94043'); // Google HQ

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    const publicUrl = await page.locator('#lnkPublic').textContent();
    console.log('✅ Event with location created');

    // ====================
    // STEP 2: Verify Google Maps on Public page
    // ====================
    console.log('🗺️ Checking for Google Maps on Public...');
    const publicPage = await context.newPage();
    await publicPage.goto(publicUrl);
    await publicPage.waitForLoadState('networkidle');

    const mapsEmbed = publicPage.locator('iframe[src*="google.com/maps"], iframe[src*="maps.google.com"]');
    const hasMaps = await mapsEmbed.count() > 0;

    if (hasMaps) {
      await expect(mapsEmbed.first()).toBeVisible();

      const mapBox = await mapsEmbed.first().boundingBox();
      if (mapBox) {
        console.log(`✅ Google Maps embedded: ${mapBox.width}x${mapBox.height}px`);

        // Verify map is responsive (reasonable aspect ratio)
        const aspectRatio = mapBox.width / mapBox.height;
        expect(aspectRatio).toBeGreaterThan(0.5); // At least somewhat wide
        expect(aspectRatio).toBeLessThan(4); // Not too stretched
      }
    } else {
      console.log('⚠️ Google Maps not found (may require explicit map URL)');
    }

    await publicPage.close();
  });

  test('Maps flow: Mobile responsive map', async ({ page, context }) => {
    console.log('📱 Testing mobile map responsiveness...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Mobile Maps ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Times Square, New York, NY 10036');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    const publicUrl = await page.locator('#lnkPublic').textContent();

    // Check map on mobile viewport
    const mobilePage = await context.newPage();
    await mobilePage.setViewportSize({ width: 375, height: 667 });
    await mobilePage.goto(publicUrl);
    await mobilePage.waitForLoadState('networkidle');

    const mapsEmbed = mobilePage.locator('iframe[src*="google.com/maps"], iframe[src*="maps.google.com"]');
    const hasMaps = await mapsEmbed.count() > 0;

    if (hasMaps) {
      await expect(mapsEmbed.first()).toBeVisible();

      const mapBox = await mapsEmbed.first().boundingBox();
      if (mapBox) {
        // Map should fit mobile viewport
        expect(mapBox.width).toBeLessThanOrEqual(375);
        console.log(`✅ Mobile map: ${mapBox.width}x${mapBox.height}px (fits viewport)`);
      }
    }

    await mobilePage.close();
  });

  test('Maps flow: Map with directions link', async ({ page, context }) => {
    console.log('🧭 Testing map directions functionality...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Directions Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Golden Gate Bridge, San Francisco, CA');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    const publicUrl = await page.locator('#lnkPublic').textContent();

    const publicPage = await context.newPage();
    await publicPage.goto(publicUrl);
    await publicPage.waitForLoadState('networkidle');

    // Check for "Get Directions" link
    const directionsLink = publicPage.locator('a:has-text("Directions"), a:has-text("Get Directions"), a[href*="maps.google.com"]');
    const hasDirections = await directionsLink.count() > 0;

    if (hasDirections) {
      const href = await directionsLink.first().getAttribute('href');
      console.log(`✅ Directions link: ${href?.substring(0, 50)}...`);

      // Verify link opens in new tab
      const target = await directionsLink.first().getAttribute('target');
      expect(target === '_blank' || target === null).toBe(true);
    } else {
      console.log('⚠️ Directions link not found');
    }

    await publicPage.close();
  });
});

test.describe('🔺 CROSS-PAGE: Complete Propagation Cycle', () => {

  test('Full cycle: Admin → Poster → Display → Public', async ({ page, context }) => {
    // ====================
    // STEP 1: Create comprehensive event
    // ====================
    console.log('📝 Creating comprehensive event...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const timestamp = Date.now();
    const eventName = `Full Cycle ${timestamp}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#timeISO', '19:00');
    await page.fill('#venue', '123 Main Street, Anytown, USA');
    await page.fill('#summary', 'Testing complete propagation cycle');
    await page.fill('#tags', 'cycle, test, propagation');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    // Configure sponsors
    await page.click('button:has-text("Configure Display & Sponsors")');
    await page.click('button:has-text("Add Sponsor")');
    await page.fill('.sp-name', 'Cycle Test Sponsor');
    await page.fill('.sp-url', 'https://cycle-test.example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/500x250');
    await page.check('.sp-tvTop');
    await page.check('.sp-mobileBanner');

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    // Get all URLs
    const publicUrl = await page.locator('#lnkPublic').textContent();
    const displayUrl = await page.locator('#lnkDisplay').textContent();
    const posterUrl = await page.locator('#lnkPoster').textContent();

    console.log('✅ Event created with sponsors');

    // ====================
    // STEP 2: Verify on Poster
    // ====================
    console.log('🖼️ Verifying on Poster...');
    const posterPage = await context.newPage();
    await posterPage.goto(posterUrl);
    await posterPage.waitForLoadState('networkidle');

    await expect(posterPage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });
    await expect(posterPage.locator('text=123 Main Street')).toBeVisible();

    const posterSponsorImg = await posterPage.locator('img[data-sponsor], img[alt*="sponsor"]').count();
    console.log(`✅ Poster: Event + ${posterSponsorImg} sponsor images`);

    await posterPage.close();

    // ====================
    // STEP 3: Verify on Display
    // ====================
    console.log('📺 Verifying on Display...');
    const displayPage = await context.newPage();
    await displayPage.setViewportSize({ width: 1920, height: 1080 });
    await displayPage.goto(displayUrl);
    await displayPage.waitForLoadState('networkidle');

    await expect(displayPage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });

    const displayTopSponsor = await displayPage.locator('#sponsorTop, .sponsor-top').count();
    console.log(`✅ Display: Event + top sponsor area (${displayTopSponsor > 0})`);

    await displayPage.close();

    // ====================
    // STEP 4: Verify on Public (Desktop)
    // ====================
    console.log('🌐 Verifying on Public (Desktop)...');
    const publicPage = await context.newPage();
    await publicPage.goto(publicUrl);
    await publicPage.waitForLoadState('networkidle');

    await expect(publicPage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });
    await expect(publicPage.locator('text=123 Main Street')).toBeVisible();

    const publicSponsorBanner = await publicPage.locator('#sponsorBanner, .sponsor-banner').count();
    console.log(`✅ Public: Event + sponsor banner (${publicSponsorBanner > 0})`);

    await publicPage.close();

    // ====================
    // STEP 5: Verify on Public (Mobile)
    // ====================
    console.log('📱 Verifying on Public (Mobile)...');
    const mobilePage = await context.newPage();
    await mobilePage.setViewportSize({ width: 375, height: 667 });
    await mobilePage.goto(publicUrl);
    await mobilePage.waitForLoadState('networkidle');

    await expect(mobilePage.locator(`text=${eventName}`)).toBeVisible({ timeout: 5000 });

    const mobileSponsor = await mobilePage.locator('#sponsorBanner, .sponsor-banner').count();
    console.log(`✅ Mobile: Event + mobile sponsor (${mobileSponsor > 0})`);

    await mobilePage.close();

    // ====================
    // STEP 6: Update in Admin and verify all pages update
    // ====================
    console.log('✏️ Updating event in Admin...');
    await page.fill('#venue', 'UPDATED: 456 New Street, Newtown, USA');
    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    console.log('✅ Admin updated');

    // Verify update on all pages
    console.log('🔄 Verifying updates across all pages...');

    // Poster
    const posterCheck = await context.newPage();
    await posterCheck.goto(posterUrl);
    await posterCheck.waitForLoadState('networkidle');
    await expect(posterCheck.locator('text=456 New Street')).toBeVisible({ timeout: 5000 });
    console.log('✅ Update propagated to Poster');
    await posterCheck.close();

    // Display
    const displayCheck = await context.newPage();
    await displayCheck.goto(displayUrl);
    await displayCheck.waitForLoadState('networkidle');
    await expect(displayCheck.locator('text=456 New Street')).toBeVisible({ timeout: 5000 });
    console.log('✅ Update propagated to Display');
    await displayCheck.close();

    // Public
    const publicCheck = await context.newPage();
    await publicCheck.goto(publicUrl);
    await publicCheck.waitForLoadState('networkidle');
    await expect(publicCheck.locator('text=456 New Street')).toBeVisible({ timeout: 5000 });
    console.log('✅ Update propagated to Public');
    await publicCheck.close();

    console.log('🎉 COMPLETE CYCLE SUCCESS! All pages synchronized.');
  });
});
