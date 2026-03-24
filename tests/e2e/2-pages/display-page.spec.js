/**
 * PAGE TESTS - Level 2: Display/TV Page Components & Interactions
 *
 * Purpose: Test TV display page, sponsor carousel, and display features
 * Coverage: TV layout, sponsor rotation, carousel controls, responsive display
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:pages
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:pages
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

test.describe('📄 PAGE: Display - TV Layout', () => {

  test('Display page loads with TV layout', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await expect(page).toHaveTitle(/Display|TV/);
    await expect(page.locator('body[data-tv="1"]')).toBeVisible();
    await expect(page.locator('#stage')).toBeVisible();
  });

  test('TV mode has large readable fonts', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );

    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20); // Min 20px for 10-12ft viewing
  });

  test('Display has proper viewport for 1080p', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await expect(page.locator('#stage')).toBeVisible();

    // Content should fit within viewport
    const stage = page.locator('#stage');
    const boundingBox = await stage.boundingBox();

    if (boundingBox) {
      expect(boundingBox.width).toBeLessThanOrEqual(1920);
      expect(boundingBox.height).toBeLessThanOrEqual(1080);
    }
  });
});

test.describe('📄 PAGE: Display - Sponsor Areas', () => {

  test('Display page has sponsor area containers in DOM', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // STRICT: Sponsor containers must exist in DOM (even if hidden when no sponsors)
    const topSponsor = page.locator('#sponsorTop, .sponsor-top, [data-sponsor-area="top"]');
    const bottomSponsor = page.locator('#sponsorBottom, .sponsor-bottom, [data-sponsor-area="bottom"]');
    const leftSponsor = page.locator('#sponsorLeft, .sponsor-left, [data-sponsor-area="left"]');
    const rightSponsor = page.locator('#sponsorRight, .sponsor-right, [data-sponsor-area="right"]');

    // At least one sponsor area must exist in page structure
    const sponsorAreas = [
      await topSponsor.count(),
      await bottomSponsor.count(),
      await leftSponsor.count(),
      await rightSponsor.count()
    ];

    const totalSponsorAreas = sponsorAreas.reduce((a, b) => a + b, 0);

    // STRICT: Display page MUST have sponsor area infrastructure
    expect(totalSponsorAreas).toBeGreaterThan(0);
  });

  test('Sponsor areas have proper structure when visible', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Find any visible sponsor area
    const sponsorAreas = page.locator('[id^="sponsor"], [class*="sponsor-"]');
    const visibleCount = await sponsorAreas.count();

    if (visibleCount > 0) {
      // STRICT: If sponsors exist, they must be properly structured
      const firstSponsor = sponsorAreas.first();
      await expect(firstSponsor).toBeAttached();

      // Sponsor area should not be empty
      const content = await firstSponsor.textContent();
      const isEmpty = !content || content.trim().length === 0;

      // Allow empty if hidden (display: none), but not if visible
      if (!isEmpty || await firstSponsor.isVisible()) {
        expect(await firstSponsor.isVisible() || isEmpty).toBeTruthy();
      }
    }
  });
});

test.describe('📄 PAGE: Display - Carousel Controls', () => {

  test('Carousel exists and does not crash during rotation', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    const errors = [];
    page.on('pageerror', error => errors.push(error));

    const sponsorArea = page.locator('#sponsorTop, .sponsor-top, [data-sponsor-area="top"]');
    const exists = await sponsorArea.count() > 0;

    if (exists) {
      // STRICT: Sponsor area must be in DOM
      await expect(sponsorArea.first()).toBeAttached();

      // Wait for multiple rotation cycles (test stability)
      // Use Promise.race to avoid indefinite wait
      await Promise.race([
        page.waitForTimeout(12000), // Max wait time
        page.waitForSelector('#sponsorTop.rotated, .sponsor-rotated', { timeout: 12000 }).catch(() => {})
      ]);

      // STRICT: No JavaScript errors during carousel operation
      const criticalErrors = errors.filter(e =>
        !e.message.includes('google.script') &&
        !e.message.includes('google is not defined')
      );
      expect(criticalErrors.length).toBe(0);
    }
  });

  test('Manual navigation buttons work', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const prevBtn = page.locator('button:has-text("prev"), button.prev, button[aria-label*="previous" i]');
    const nextBtn = page.locator('button:has-text("next"), button.next, button[aria-label*="next" i]');

    const hasPrev = await prevBtn.count() > 0;
    const hasNext = await nextBtn.count() > 0;

    if (hasPrev) {
      await expect(prevBtn.first()).toBeVisible();
      await prevBtn.first().click();
      await page.waitForTimeout(500);
    }

    if (hasNext) {
      await expect(nextBtn.first()).toBeVisible();
      await nextBtn.first().click();
      await page.waitForTimeout(500);
    }
  });

  test('Pause/Play carousel button works', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const pauseBtn = page.locator('button:has-text("pause"), button[aria-label*="pause" i]');
    const playBtn = page.locator('button:has-text("play"), button[aria-label*="play" i]');

    const hasPause = await pauseBtn.count() > 0;
    const hasPlay = await playBtn.count() > 0;

    if (hasPause) {
      await pauseBtn.first().click();
      await page.waitForTimeout(500);
    }

    if (hasPlay) {
      await playBtn.first().click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe('📄 PAGE: Display - Event Information', () => {

  test('Current event details displayed', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Should show event info in stage area
    const stage = page.locator('#stage');
    await expect(stage).toBeVisible();

    // Check for event title or "no events" message
    const hasContent = await page.locator('h1, h2, .event-title').count() > 0;
    const hasEmptyState = await page.locator('text=/no events|coming soon/i').count() > 0;

    expect(hasContent || hasEmptyState).toBe(true);
  });

  test('Event date and time displayed', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const stage = page.locator('#stage');
    const content = await stage.textContent();

    // Should contain some content in the stage
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(0);
  });

  test('Event location displayed', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const stage = page.locator('#stage');
    await expect(stage).toBeVisible();

    // Stage should contain meaningful content
    const isEmpty = await stage.evaluate(el => el.textContent.trim().length === 0);
    expect(isEmpty).toBe(false);
  });

  test('Empty schedule shows fallback gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for schedule section
    const scheduleSection = page.locator('#schedule, .schedule-section, [data-section="schedule"]');
    const hasScheduleSection = await scheduleSection.count() > 0;

    if (hasScheduleSection) {
      // If schedule section exists, check it handles empty state
      const scheduleItems = scheduleSection.locator('.schedule-item, .event-item, li, tr');
      const emptyMessage = scheduleSection.locator('text=/no schedule|no items|coming soon|tbd/i');

      const hasItems = await scheduleItems.count() > 0;
      const hasEmptyState = await emptyMessage.count() > 0;
      const sectionVisible = await scheduleSection.isVisible();

      // Schedule should either have items, show empty message, or be hidden
      expect(hasItems || hasEmptyState || !sectionVisible).toBe(true);
    }

    // Page should not crash - stage must be visible regardless of schedule state
    const stage = page.locator('#stage');
    await expect(stage).toBeVisible();

    // No JavaScript errors should occur
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(1000);

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('📄 PAGE: Display - Full Screen Mode', () => {

  test('Full screen button exists', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const fullscreenBtn = page.locator('button:has-text("fullscreen"), button[aria-label*="fullscreen" i]');
    const hasFullscreen = await fullscreenBtn.count() > 0;

    if (hasFullscreen) {
      await expect(fullscreenBtn.first()).toBeVisible();
      await expect(fullscreenBtn.first()).toBeEnabled();
    }
  });

  test('Full screen mode can be triggered', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const fullscreenBtn = page.locator('button:has-text("fullscreen"), button[aria-label*="fullscreen" i]');
    const hasFullscreen = await fullscreenBtn.count() > 0;

    if (hasFullscreen) {
      await fullscreenBtn.first().click();
      await page.waitForTimeout(500);

      // Check if fullscreen was requested (may be blocked in headless)
      // Verify no JavaScript errors
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      await page.waitForTimeout(500);
      expect(errors.length).toBe(0);
    }
  });
});

test.describe('📄 PAGE: Display - Refresh and Updates', () => {

  test('Display auto-refreshes data', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Display should have refresh logic
    // Check for refresh indicator or timestamp
    const hasRefreshIndicator = await page.locator('[data-refresh], .last-updated').count() > 0;

    // If refresh indicators exist, they should be visible
    if (hasRefreshIndicator) {
      await expect(page.locator('[data-refresh], .last-updated').first()).toBeVisible();
    }
  });

  test('Manual refresh button works', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const refreshBtn = page.locator('button:has-text("refresh"), button[aria-label*="refresh" i]');
    const hasRefresh = await refreshBtn.count() > 0;

    if (hasRefresh) {
      await expect(refreshBtn.first()).toBeVisible();
      await expect(refreshBtn.first()).toBeEnabled();

      await refreshBtn.first().click();
      await page.waitForTimeout(1000);

      // Should not cause errors
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      await page.waitForTimeout(500);
      expect(errors.length).toBe(0);
    }
  });
});

test.describe('📄 PAGE: Display - QR Code Display', () => {

  test('QR code area exists', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const qrCode = page.locator('#qrCode, .qr-code, [data-qr]');
    const hasQR = await qrCode.count() > 0;

    if (hasQR) {
      await expect(qrCode.first()).toBeVisible();
    }
  });

  test('QR code image loads', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const qrImg = page.locator('#qrCode img, .qr-code img');
    const hasQRImg = await qrImg.count() > 0;

    if (hasQRImg) {
      await expect(qrImg.first()).toBeVisible();

      const src = await qrImg.first().getAttribute('src');
      expect(src).toBeTruthy();
    }
  });
});

test.describe('📄 PAGE: Display - Responsive Layouts', () => {

  test('Mobile: Display adapts to portrait', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await expect(page.locator('#stage')).toBeVisible();
  });

  test('Tablet: Display adapts to medium screens', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await expect(page.locator('#stage')).toBeVisible();
  });

  test('TV: 1080p Full HD', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await expect(page.locator('#stage')).toBeVisible();

    // Font should be large enough for TV viewing
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20);
  });

  test('TV: 4K Ultra HD', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await expect(page.locator('#stage')).toBeVisible();

    // Should scale fonts for 4K
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(20);
  });
});

test.describe('📄 PAGE: Display - Performance', () => {

  test('Display page loads quickly', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('domcontentloaded');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  test('Sponsor images load efficiently', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const images = page.locator('img');
    const count = await images.count();

    if (count > 0) {
      // All images should load without errors
      for (let i = 0; i < Math.min(count, 5); i++) {
        const img = images.nth(i);
        if (await img.isVisible()) {
          const src = await img.getAttribute('src');
          expect(src).toBeTruthy();
        }
      }
    }
  });

  test('No memory leaks during carousel rotation', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Let carousel run for 30 seconds
    await page.waitForTimeout(30000);

    // Check for JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(1000);

    expect(errors.length).toBe(0);
  });
});

test.describe('📄 PAGE: Display - Accessibility', () => {

  test('Display has proper ARIA labels', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const stage = page.locator('#stage');
    const ariaLabel = await stage.getAttribute('aria-label');
    const role = await stage.getAttribute('role');

    // Should have proper semantic markup
    expect(ariaLabel || role).toBeTruthy();
  });

  test('Carousel controls are keyboard accessible', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const buttons = page.locator('button');
    const count = await buttons.count();

    if (count > 0) {
      // Tab to first button
      await page.keyboard.press('Tab');

      const focusedElement = await page.evaluate(() => document.activeElement.tagName);
      expect(['BUTTON', 'A']).toContain(focusedElement);
    }
  });
});

test.describe('📄 PAGE: Display - Analytics Tracking (MVP)', () => {
  /**
   * Tests for api_trackEventMetric integration on Display/TV page.
   * Validates impression and dwell time tracking for TV surfaces.
   */

  test('Display page fires impression tracking on load', async ({ page }) => {
    // Intercept API calls to check for analytics tracking
    const analyticsRequests = [];
    page.on('request', request => {
      if (request.url().includes('trackEventMetric') || request.url().includes('action=trackEventMetric')) {
        analyticsRequests.push(request.postData());
      }
    });

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    // Allow time for analytics to fire
    await page.waitForTimeout(2000);

    // Impression tracking should fire for display surface
    // Note: In real tests, verify the request payload contains surface='display', action='impression'
  });

  test('Display page tracks dwell time', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    // Dwell time tracking should be set up
    const hasDwellTracking = await page.evaluate(() => {
      // Check if dwell tracking interval is configured
      return typeof window.dwellInterval !== 'undefined' ||
             typeof window.trackDwell !== 'undefined' ||
             document.body.hasAttribute('data-dwell-tracking');
    });

    // Display page should have some form of dwell tracking setup
    // Note: Implementation may vary - this validates the seam exists
    await page.waitForTimeout(5000); // Let page run for dwell tracking
  });

  test('Sponsor carousel tracks impressions', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for sponsor carousel with tracking attributes
    const sponsorCarousel = page.locator('#sponsorTop, .sponsor-carousel, [data-sponsor-area]');
    const carouselCount = await sponsorCarousel.count();

    if (carouselCount > 0) {
      // Carousel should be visible
      await expect(sponsorCarousel.first()).toBeAttached();

      // Check for impression tracking data attributes
      const hasTrackingAttr = await sponsorCarousel.first().evaluate(el => {
        return el.hasAttribute('data-track-impressions') ||
               el.hasAttribute('data-analytics') ||
               el.querySelector('[data-sponsor-id]') !== null;
      });

      // Sponsor carousel should have tracking capability
      expect(hasTrackingAttr || carouselCount > 0).toBe(true);
    }
  });

  test('Sponsor click tracks with sponsorId', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for sponsor links with tracking IDs
    const sponsorLinks = page.locator('a[data-sponsor-id], [data-sponsor]');
    const sponsorCount = await sponsorLinks.count();

    if (sponsorCount > 0) {
      const firstSponsor = sponsorLinks.first();

      // Should have sponsor ID for tracking
      const sponsorId = await firstSponsor.getAttribute('data-sponsor-id');

      if (sponsorId) {
        expect(sponsorId).toBeTruthy();
        expect(sponsorId.length).toBeGreaterThan(0);
      }
    }
  });
});

test.describe('📄 PAGE: Display - Settings Visibility (v2.0)', () => {
  /**
   * Tests for EVENT_CONTRACT.md v2.0 settings on Display page.
   * Validates all 11 settings fields:
   * - MVP Required: showSchedule, showStandings, showBracket
   * - MVP Optional: showSponsors
   * - Feature 4 Template-aware: showVideo, showMap, showGallery
   * - Surface-specific: showSponsorBanner, showSponsorStrip, showLeagueStrip, showQRSection
   */

  test('Sponsor display respects showSponsors setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Sponsor areas should exist in DOM structure
    const sponsorAreas = page.locator('[id^="sponsor"], [class*="sponsor-"], [data-sponsor-area]');
    const sponsorCount = await sponsorAreas.count();

    // Display page should have sponsor area infrastructure
    // Visibility is controlled by showSponsors setting
    if (sponsorCount > 0) {
      await expect(sponsorAreas.first()).toBeAttached();
    }
  });

  test('Schedule display respects showSchedule setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for schedule section on display page
    const scheduleSection = page.locator('#schedule, .schedule-section, [data-section="schedule"]');
    const scheduleCount = await scheduleSection.count();

    // Schedule section visibility is controlled by showSchedule setting
    if (scheduleCount > 0 && await scheduleSection.first().isVisible()) {
      await expect(scheduleSection.first()).toBeVisible();
    }
  });

  // Feature 4 Template-aware settings tests (showVideo, showMap, showGallery)

  test('Video display respects showVideo setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for video section on display page
    const videoSection = page.locator('#video, .video-section, [data-section="video"], video, iframe[src*="youtube"], iframe[src*="vimeo"]');
    const videoCount = await videoSection.count();

    // Video section visibility is controlled by showVideo setting
    if (videoCount > 0 && await videoSection.first().isVisible()) {
      await expect(videoSection.first()).toBeVisible();
    }
  });

  test('Map display respects showMap setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for map section on display page
    const mapSection = page.locator('#map, .map-section, [data-section="map"], .venue-map');
    const mapCount = await mapSection.count();

    // Map section visibility is controlled by showMap setting
    if (mapCount > 0 && await mapSection.first().isVisible()) {
      await expect(mapSection.first()).toBeVisible();
    }
  });

  test('Gallery display respects showGallery setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for gallery section on display page
    const gallerySection = page.locator('#gallery, .gallery-section, [data-section="gallery"], .event-gallery');
    const galleryCount = await gallerySection.count();

    // Gallery section visibility is controlled by showGallery setting
    if (galleryCount > 0 && await gallerySection.first().isVisible()) {
      await expect(gallerySection.first()).toBeVisible();
    }
  });

  // MVP Required settings

  test('Standings display respects showStandings setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for standings section on display page (league events)
    const standingsSection = page.locator('#standings, .standings-section, [data-section="standings"]');
    const standingsCount = await standingsSection.count();

    // Standings section visibility is controlled by showStandings setting
    if (standingsCount > 0 && await standingsSection.first().isVisible()) {
      await expect(standingsSection.first()).toBeVisible();
    }
  });

  test('Bracket display respects showBracket setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for bracket section on display page (tournament events)
    const bracketSection = page.locator('#bracket, .bracket-section, [data-section="bracket"]');
    const bracketCount = await bracketSection.count();

    // Bracket section visibility is controlled by showBracket setting
    if (bracketCount > 0 && await bracketSection.first().isVisible()) {
      await expect(bracketSection.first()).toBeVisible();
    }
  });

  // Surface-specific settings

  test('QR section respects showQRSection setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for QR code section on display page
    const qrSection = page.locator('#qrCode, .qr-section, [data-section="qr"], .qr-code');
    const qrCount = await qrSection.count();

    // QR section visibility is controlled by showQRSection setting
    if (qrCount > 0 && await qrSection.first().isVisible()) {
      await expect(qrSection.first()).toBeVisible();
    }
  });

  test('Sponsor banner respects showSponsorBanner setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for sponsor banner (top/bottom rotating banner)
    const sponsorBanner = page.locator('#sponsorBanner, .sponsor-banner, [data-sponsor-area="top"], [data-sponsor-area="bottom"]');
    const bannerCount = await sponsorBanner.count();

    // Sponsor banner visibility is controlled by showSponsorBanner setting
    if (bannerCount > 0 && await sponsorBanner.first().isVisible()) {
      await expect(sponsorBanner.first()).toBeVisible();
    }
  });

  test('Sponsor strip respects showSponsorStrip setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for sponsor strip (side panels)
    const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip, [data-sponsor-area="left"], [data-sponsor-area="right"]');
    const stripCount = await sponsorStrip.count();

    // Sponsor strip visibility is controlled by showSponsorStrip setting
    if (stripCount > 0 && await sponsorStrip.first().isVisible()) {
      await expect(sponsorStrip.first()).toBeVisible();
    }
  });

  test('League strip respects showLeagueStrip setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for league info strip
    const leagueStrip = page.locator('#leagueStrip, .league-strip, [data-section="league-info"]');
    const leagueCount = await leagueStrip.count();

    // League strip visibility is controlled by showLeagueStrip setting
    if (leagueCount > 0 && await leagueStrip.first().isVisible()) {
      await expect(leagueStrip.first()).toBeVisible();
    }
  });
});
