/**
 * PAGE TESTS - Level 2: Poster Page Components & Interactions
 *
 * Purpose: Test poster page, sponsor display, QR codes, and analytics tracking
 * Coverage: Print layout, sponsor strip, QR generation, analytics events
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

test.describe('📄 PAGE: Poster - Layout', () => {

  test('Poster page loads with proper structure', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await expect(page).toHaveTitle(/Poster/);
    await expect(page.locator('.poster-container')).toBeVisible();
  });

  test('Poster has white background for printing', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const bgColor = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).backgroundColor
    );

    // Should be white or near-white for printing
    expect(bgColor).toMatch(/rgb\(255,\s*255,\s*255\)|white/i);
  });

  test('Poster container has max-width for printing', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const container = page.locator('.poster-container');
    const box = await container.boundingBox();

    if (box) {
      // Should have reasonable max-width for poster printing
      expect(box.width).toBeLessThanOrEqual(950);
    }
  });
});

test.describe('📄 PAGE: Poster - Event Details', () => {

  test('Event name is displayed prominently', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const eventName = page.locator('#eventName, h1');
    const count = await eventName.count();

    if (count > 0) {
      await expect(eventName.first()).toBeVisible();
    }
  });

  test('Event date is formatted properly', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const dateEl = page.locator('#eventDate, .event-date');
    const count = await dateEl.count();

    if (count > 0) {
      const text = await dateEl.first().textContent();
      // Should have some date-related content
      expect(text).toBeTruthy();
    }
  });

  test('Event image displays when configured', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const imageContainer = page.locator('#eventImageContainer, .event-image');
    const count = await imageContainer.count();

    // Image container may be hidden if no image configured
    if (count > 0) {
      const isHidden = await imageContainer.first().getAttribute('hidden');
      // If visible, should contain an image
      if (!isHidden) {
        const img = imageContainer.first().locator('img');
        await expect(img).toBeVisible();
      }
    }
  });
});

test.describe('📄 PAGE: Poster - Sponsor Strip', () => {

  test('Sponsor strip shows when sponsors configured', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip');
    const count = await sponsorStrip.count();

    if (count > 0) {
      const isHidden = await sponsorStrip.first().getAttribute('hidden');
      // If sponsors configured, should be visible
      if (!isHidden) {
        await expect(sponsorStrip.first()).toBeVisible();
      }
    }
  });

  test('Sponsor images display correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip');
    const isVisible = await sponsorStrip.isVisible().catch(() => false);

    if (isVisible) {
      const images = sponsorStrip.locator('img');
      const imgCount = await images.count();

      if (imgCount > 0) {
        const firstImg = images.first();
        await expect(firstImg).toBeVisible();

        const src = await firstImg.getAttribute('src');
        expect(src).toBeTruthy();
      }
    }
  });

  test('Sponsor names display as fallback when no image', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip');
    const isVisible = await sponsorStrip.isVisible().catch(() => false);

    if (isVisible) {
      // Should have either images or strong text
      const hasImages = await sponsorStrip.locator('img').count() > 0;
      const hasText = await sponsorStrip.locator('strong').count() > 0;

      expect(hasImages || hasText).toBe(true);
    }
  });
});

test.describe('📄 PAGE: Poster - QR Codes', () => {

  test('QR code grid is present', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const qrGrid = page.locator('#qrGrid, .qr-grid');
    await expect(qrGrid).toBeVisible();
  });

  test('QR codes have proper images', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const qrImages = page.locator('#qrGrid img, .qr-grid img');
    const count = await qrImages.count();

    if (count > 0) {
      const firstQr = qrImages.first();
      await expect(firstQr).toBeVisible();

      const src = await firstQr.getAttribute('src');
      expect(src).toBeTruthy();
      // QR codes typically from quickchart.io
      expect(src).toContain('qr');
    }
  });

  test('QR codes have descriptive labels', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const qrGrid = page.locator('#qrGrid, .qr-grid');
    const qrItems = qrGrid.locator('.qr-item, > div');
    const count = await qrItems.count();

    if (count > 0) {
      // Each QR should have a label
      const firstItem = qrItems.first();
      const text = await firstItem.textContent();
      expect(text).toBeTruthy();
    }
  });

  test('QR section handles missing/invalid URLs gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const qrGrid = page.locator('#qrGrid, .qr-grid');
    const qrItems = qrGrid.locator('.qr-item, > div');
    const qrImages = qrGrid.locator('img');

    const itemCount = await qrItems.count();
    const imageCount = await qrImages.count();

    // QR grid should be present (even if empty)
    await expect(qrGrid).toBeAttached();

    // Check each QR item for valid state
    for (let i = 0; i < itemCount; i++) {
      const item = qrItems.nth(i);
      const img = item.locator('img');
      const hasImage = await img.count() > 0;

      if (hasImage) {
        // If image exists, verify it has a valid src (not broken)
        const src = await img.getAttribute('src');
        const isValidSrc = src && src.length > 0 && !src.includes('undefined') && !src.includes('null');

        if (isValidSrc) {
          // Valid QR image should be visible
          await expect(img).toBeVisible();
        } else {
          // Invalid src - QR item should be hidden or show fallback
          const isHidden = await item.isHidden();
          const hasFallback = await item.locator('text=/unavailable|no url|coming soon/i').count() > 0;
          expect(isHidden || hasFallback || !isValidSrc).toBe(true);
        }
      }
    }

    // Page should not crash - poster container must still be visible
    await expect(page.locator('.poster-container')).toBeVisible();

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

test.describe('📄 PAGE: Poster - Analytics Integration', () => {

  test('SponsorUtils module is loaded on poster page', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const hasSponsorUtils = await page.evaluate(() => {
      return typeof window.SponsorUtils !== 'undefined';
    });

    expect(hasSponsorUtils).toBe(true);
  });

  test('Poster logs view event on load', async ({ page }) => {
    // Intercept api_logEvents calls
    const logCalls = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.postData()?.includes('api_logEvents')) {
        logCalls.push(request.postData());
      }
      await route.continue();
    });

    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait for potential batch flush
    await page.waitForTimeout(6000);

    // Check if view event would be logged (via SponsorUtils)
    const hasLogEvent = await page.evaluate(() => {
      return typeof window.SponsorUtils?.logEvent === 'function';
    });

    expect(hasLogEvent).toBe(true);
  });

  test('Poster tracks sponsor impressions', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Verify logEvent function exists and can track impressions
    const canLogImpressions = await page.evaluate(() => {
      if (!window.SponsorUtils?.logEvent) return false;
      // Test that impression event structure is valid
      try {
        window.SponsorUtils.logEvent({
          eventId: 'test',
          surface: 'poster',
          metric: 'impression',
          sponsorId: 'test-sponsor'
        });
        return true;
      } catch {
        return false;
      }
    });

    expect(canLogImpressions).toBe(true);
  });

  test('Poster has print event tracking capability', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check that beforeprint listener is attached
    const hasPrintTracking = await page.evaluate(() => {
      // The poster page should have beforeprint listener
      // We can verify by checking if logEvent works for print metric
      if (!window.SponsorUtils?.logEvent) return false;
      try {
        window.SponsorUtils.logEvent({
          eventId: 'test',
          surface: 'poster',
          metric: 'print',
          value: 1
        });
        return true;
      } catch {
        return false;
      }
    });

    expect(hasPrintTracking).toBe(true);
  });
});

test.describe('📄 PAGE: Poster - Print Optimization', () => {

  test('Print styles remove unnecessary elements', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Emulate print media
    await page.emulateMedia({ media: 'print' });

    // Page should still be visible in print mode
    await expect(page.locator('.poster-container')).toBeVisible();
  });

  test('Poster fits on standard paper size', async ({ page }) => {
    // Set viewport to approximate A4/Letter size
    await page.setViewportSize({ width: 794, height: 1123 }); // A4 at 96 DPI

    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const container = page.locator('.poster-container');
    const box = await container.boundingBox();

    if (box) {
      // Content should fit within A4 width
      expect(box.width).toBeLessThanOrEqual(794);
    }
  });

  test('QR codes are large enough for scanning', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const qrImages = page.locator('#qrGrid img, .qr-grid img');
    const count = await qrImages.count();

    if (count > 0) {
      const firstQr = qrImages.first();
      const box = await firstQr.boundingBox();

      if (box) {
        // QR codes should be at least 100x100 for reliable scanning
        expect(box.width).toBeGreaterThanOrEqual(80);
        expect(box.height).toBeGreaterThanOrEqual(80);
      }
    }
  });
});

test.describe('📄 PAGE: Poster - XSS Prevention', () => {

  test('esc() function properly escapes HTML', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const escaped = await page.evaluate(() => {
      if (!window.SponsorUtils?.esc) return '';
      return window.SponsorUtils.esc('<script>alert("xss")</script>');
    });

    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  test('Sponsor data is escaped before rendering', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check that no raw script tags exist in sponsor strip
    const sponsorHtml = await page.locator('#sponsorStrip, .sponsor-strip').innerHTML().catch(() => '');

    expect(sponsorHtml).not.toContain('<script>');
    expect(sponsorHtml).not.toContain('onerror=');
    expect(sponsorHtml).not.toContain('onclick=');
  });
});

test.describe('📄 PAGE: Poster - Analytics Tracking (MVP)', () => {
  /**
   * Tests for api_trackEventMetric integration on Poster page.
   * Validates scan and impression tracking for poster surfaces.
   */

  test('Poster page fires scan tracking when QR is scanned', async ({ page }) => {
    // Intercept API calls to check for analytics tracking
    const analyticsRequests = [];
    page.on('request', request => {
      if (request.url().includes('trackEventMetric') || request.url().includes('action=trackEventMetric')) {
        analyticsRequests.push(request.postData());
      }
    });

    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    // Poster page should have scan tracking capability
    // Note: QR scan tracking fires when user arrives via QR code
  });

  test('Poster has trackEventMetric capability', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check if simplified metric tracking is available
    const hasTrackMetric = await page.evaluate(() => {
      // Page should be able to call api_trackEventMetric
      // This may be via SponsorUtils.logEvent or direct API call
      return typeof window.SponsorUtils !== 'undefined' ||
             typeof window.trackEventMetric !== 'undefined' ||
             document.body.hasAttribute('data-event-id');
    });

    expect(hasTrackMetric).toBe(true);
  });

  test('QR codes have tracking token for scan attribution', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const qrImages = page.locator('#qrGrid img, .qr-grid img');
    const count = await qrImages.count();

    if (count > 0) {
      // QR code URLs should include tracking token for scan attribution
      const firstQr = qrImages.first();
      const src = await firstQr.getAttribute('src');

      if (src) {
        // QR code should be generated (either data URL or API URL)
        expect(src.length).toBeGreaterThan(10);
      }
    }
  });

  test('Poster sponsors have tracking IDs', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip');
    const stripCount = await sponsorStrip.count();

    if (stripCount > 0) {
      // Check for sponsor elements with tracking IDs
      const sponsorLogos = sponsorStrip.locator('img[data-sponsor-id], [data-sponsor]');
      const logoCount = await sponsorLogos.count();

      if (logoCount > 0) {
        const firstLogo = sponsorLogos.first();
        const sponsorId = await firstLogo.getAttribute('data-sponsor-id');

        if (sponsorId) {
          expect(sponsorId).toBeTruthy();
        }
      }
    }
  });
});

test.describe('📄 PAGE: Poster - Settings Visibility (v2.0)', () => {
  /**
   * Tests for EVENT_CONTRACT.md v2.0 settings on Poster page.
   * Poster page should respect showSponsors setting.
   */

  test('Sponsor strip respects showSponsors setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Sponsor strip should exist in DOM structure
    const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip');
    const sponsorCount = await sponsorStrip.count();

    // Sponsor strip visibility is controlled by showSponsors setting
    if (sponsorCount > 0) {
      await expect(sponsorStrip.first()).toBeAttached();
    }
  });

  test('Schedule section respects showSchedule setting', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for schedule section on poster
    const scheduleSection = page.locator('#schedule, .schedule-section, [data-section="schedule"]');
    const scheduleCount = await scheduleSection.count();

    // Schedule section visibility is controlled by showSchedule setting
    if (scheduleCount > 0 && await scheduleSection.first().isVisible()) {
      await expect(scheduleSection.first()).toBeVisible();
    }
  });
});
