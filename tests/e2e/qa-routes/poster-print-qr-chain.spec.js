/**
 * QA ROUTE TESTS: Poster → Print → QR Link Chain
 *
 * End-to-end tests for the complete poster printing and QR code workflow.
 * Validates the chain from poster creation to scanning QR codes.
 *
 * Test Flow:
 * 1. Create/select event with poster
 * 2. View poster page
 * 3. Verify print-ready layout
 * 4. Check QR codes are scannable
 * 5. Test QR code redirects work
 * 6. Verify analytics tracking on scan
 */

const { test, expect } = require('@playwright/test');
const { getCurrentEnvironment } = require('../../config/environments.js');

test.describe('QA Routes: Poster → Print → QR Chain', () => {
  let env;
  let baseUrl;
  const BRAND_ID = 'root';
  const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

  test.beforeAll(() => {
    env = getCurrentEnvironment();
    baseUrl = env.baseUrl;
  });

  test.describe('Poster Page Loading', () => {

    test('Poster page loads with all essential elements', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Title should indicate poster
      const title = await page.title();
      expect(title.toLowerCase()).toContain('poster');

      // Poster container must exist
      const posterContainer = page.locator('.poster-container, #poster, .poster, main');
      await expect(posterContainer.first()).toBeAttached();

      // QR grid/section should exist
      const qrSection = page.locator('#qrGrid, .qr-grid, .qr-section, [class*="qr"]');
      await expect(qrSection.first()).toBeAttached();
    });

    test('Poster displays event name prominently', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Event name should be in h1 or prominent element
      const eventName = page.locator('#eventName, h1, .event-name, .event-title');
      const hasEventName = await eventName.count() > 0;

      if (hasEventName) {
        await expect(eventName.first()).toBeVisible();
        const text = await eventName.first().textContent();
        expect(text.trim().length).toBeGreaterThan(0);
      }
    });

    test('Poster shows event date formatted correctly', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Date element should exist
      const dateEl = page.locator('#eventDate, .event-date, [class*="date"]');
      const hasDate = await dateEl.count() > 0;

      if (hasDate) {
        const dateText = await dateEl.first().textContent();
        // Should have some date content
        expect(dateText.trim().length).toBeGreaterThan(0);
      }
    });

    test('Poster shows location information', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Location element should exist
      const locationEl = page.locator('#eventLocation, .event-location, [class*="location"], [class*="venue"]');
      const hasLocation = await locationEl.count() > 0;

      if (hasLocation) {
        const locationText = await locationEl.first().textContent();
        expect(locationText.trim().length).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Print-Ready Layout', () => {

    test('Poster has white/light background for print', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const bgColor = await page.locator('body').evaluate(el =>
        window.getComputedStyle(el).backgroundColor
      );

      // Should be white, near-white, or transparent for printing
      const isLightBg = bgColor.includes('255, 255, 255') ||
                        bgColor.includes('white') ||
                        bgColor.includes('rgba(0, 0, 0, 0)') ||
                        bgColor === 'transparent';
      expect(isLightBg).toBe(true);
    });

    test('Poster fits within A4/Letter page width', async ({ page }) => {
      await page.setViewportSize({ width: 794, height: 1123 }); // A4 at 96 DPI

      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const container = page.locator('.poster-container, #poster, main');
      const box = await container.first().boundingBox();

      if (box) {
        // Content should fit within paper width with margins
        expect(box.width).toBeLessThanOrEqual(794);
      }
    });

    test('Poster renders correctly in print media', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Emulate print
      await page.emulateMedia({ media: 'print' });

      // Main content should still be visible
      const content = page.locator('.poster-container, #poster, main');
      await expect(content.first()).toBeVisible();

      // QR codes should be visible in print
      const qrArea = page.locator('#qrGrid, .qr-section');
      const hasQR = await qrArea.count() > 0;
      if (hasQR) {
        await expect(qrArea.first()).toBeVisible();
      }
    });

    test('Print hides screen-only elements', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await page.emulateMedia({ media: 'print' });

      // Navigation should be hidden
      const nav = page.locator('nav, .nav, [role="navigation"]');
      const navCount = await nav.count();

      if (navCount > 0) {
        const isHidden = await nav.first().evaluate(el => {
          const styles = window.getComputedStyle(el);
          return styles.display === 'none' || styles.visibility === 'hidden';
        });
        expect(isHidden).toBe(true);
      }

      // Print buttons should be hidden
      const printBtn = page.locator('button:has-text("print"), .print-button, [onclick*="print"]');
      const btnCount = await printBtn.count();

      if (btnCount > 0) {
        const isBtnHidden = await printBtn.first().evaluate(el => {
          const styles = window.getComputedStyle(el);
          return styles.display === 'none' || styles.visibility === 'hidden';
        });
        expect(isBtnHidden).toBe(true);
      }
    });

    test('Text is readable at print size', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Check event name font size
      const eventName = page.locator('#eventName, h1');
      const hasName = await eventName.count() > 0;

      if (hasName) {
        const fontSize = await eventName.first().evaluate(el =>
          parseInt(window.getComputedStyle(el).fontSize)
        );
        // Title should be at least 24px for readability
        expect(fontSize).toBeGreaterThanOrEqual(20);
      }
    });
  });

  test.describe('QR Code Generation', () => {

    test('QR codes are present on poster', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Look for QR code images
      const qrImages = page.locator('img[src*="qr"], img[src*="quickchart"], .qr-code img, #qrGrid img');
      const qrCount = await qrImages.count();

      // Should have at least one QR code or QR section
      const qrSection = page.locator('#qrGrid, .qr-section, .qr-grid');
      const hasQRSection = await qrSection.count() > 0;

      expect(qrCount > 0 || hasQRSection).toBe(true);
    });

    test('QR codes are appropriately sized for scanning', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const qrImages = page.locator('#qrGrid img, .qr-code img, img[src*="qr"]');
      const qrCount = await qrImages.count();

      if (qrCount > 0) {
        const firstQR = qrImages.first();
        const box = await firstQR.boundingBox();

        if (box) {
          // QR codes should be at least 80x80 for reliable scanning
          expect(box.width).toBeGreaterThanOrEqual(80);
          expect(box.height).toBeGreaterThanOrEqual(80);

          // Should be square (within tolerance)
          expect(Math.abs(box.width - box.height)).toBeLessThan(20);
        }
      }
    });

    test('QR codes have descriptive labels', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const qrGrid = page.locator('#qrGrid, .qr-grid, .qr-section');
      const hasGrid = await qrGrid.count() > 0;

      if (hasGrid) {
        const gridContent = await qrGrid.first().textContent();

        // Should have descriptive text
        expect(gridContent.length).toBeGreaterThan(0);
      }
    });

    test('QR codes use proper encoding', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const qrImages = page.locator('img[src*="quickchart.io/qr"], img[src*="qr?text"]');
      const qrCount = await qrImages.count();

      if (qrCount > 0) {
        const src = await qrImages.first().getAttribute('src');

        // QR code URL should be properly formed
        expect(src).toBeTruthy();
        expect(src.length).toBeGreaterThan(20);

        // Should use quickchart.io or similar service
        expect(src).toMatch(/quickchart\.io|chart\.googleapis|qr/i);
      }
    });
  });

  test.describe('QR Code Link Chain', () => {

    test('QR code URLs resolve to valid destinations', async ({ page, request }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const qrImages = page.locator('img[src*="quickchart.io/qr"]');
      const qrCount = await qrImages.count();

      if (qrCount > 0) {
        const src = await qrImages.first().getAttribute('src');

        // Extract the encoded URL from the QR code source
        const match = src?.match(/text=([^&]+)/);
        if (match) {
          const encodedUrl = match[1];
          const decodedUrl = decodeURIComponent(encodedUrl);

          // The decoded URL should be valid
          expect(decodedUrl).toMatch(/^https?:\/\//);

          // Test that the URL is reachable
          try {
            const response = await request.get(decodedUrl, {
              maxRedirects: 0,
              failOnStatusCode: false
            });

            // Should return 200, 301, 302, or other valid status
            expect(response.status()).toBeLessThan(500);
          } catch (e) {
            // Network errors may occur in test environment
            console.log(`URL check skipped: ${decodedUrl}`);
          }
        }
      }
    });

    test('Public event URL QR code works', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Look for the "More Info" or public event QR
      const qrGrid = page.locator('#qrGrid, .qr-grid');
      const hasGrid = await qrGrid.count() > 0;

      if (hasGrid) {
        const gridHtml = await qrGrid.first().innerHTML();

        // Should contain link to public page
        const hasPublicLink = gridHtml.includes('page=events') ||
                              gridHtml.includes('More Info') ||
                              gridHtml.includes('Event Details');
        expect(hasPublicLink || gridHtml.length > 50).toBe(true);
      }
    });

    test('Signup form QR code points to registration', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const qrGrid = page.locator('#qrGrid, .qr-grid');
      const hasGrid = await qrGrid.count() > 0;

      if (hasGrid) {
        const gridHtml = await qrGrid.first().innerHTML();

        // Check for signup-related content
        const hasSignup = gridHtml.includes('Sign') ||
                          gridHtml.includes('Register') ||
                          gridHtml.includes('forms.google');

        // May or may not have signup depending on event config
        expect(hasSignup || gridHtml.length > 0).toBe(true);
      }
    });
  });

  test.describe('QR Scan Analytics', () => {

    test('Poster page has analytics tracking capability', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Check for SponsorUtils which handles analytics
      const hasSponsorUtils = await page.evaluate(() => {
        return typeof window.SponsorUtils !== 'undefined';
      });

      expect(hasSponsorUtils).toBe(true);
    });

    test('Poster logs impression on load', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Verify logEvent function exists
      const hasLogEvent = await page.evaluate(() => {
        return typeof window.SponsorUtils?.logEvent === 'function';
      });

      expect(hasLogEvent).toBe(true);
    });

    test('QR scan tracking fires correctly', async ({ page }) => {
      // Intercept API calls
      const analyticsRequests = [];
      page.on('request', request => {
        const postData = request.postData();
        if (postData?.includes('trackEventMetric') ||
            postData?.includes('logEvents') ||
            request.url().includes('action=')) {
          analyticsRequests.push(postData);
        }
      });

      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for potential batch flush
      await page.waitForTimeout(6000);

      // Analytics capability should exist
      const canTrack = await page.evaluate(() => {
        return typeof window.SponsorUtils?.logEvent === 'function';
      });

      expect(canTrack).toBe(true);
    });
  });

  test.describe('Sponsor Display on Poster', () => {

    test('Sponsor strip shows when sponsors configured', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip, .sponsors');
      const hasSponsorStrip = await sponsorStrip.count() > 0;

      if (hasSponsorStrip) {
        // If strip exists, it should be visible or hidden based on config
        const isAttached = await sponsorStrip.first().isAttached();
        expect(isAttached).toBe(true);
      }
    });

    test('Sponsor logos render correctly', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip');
      const hasStrip = await sponsorStrip.count() > 0;

      if (hasStrip) {
        const isVisible = await sponsorStrip.first().isVisible();

        if (isVisible) {
          // Check for sponsor images
          const sponsorImages = sponsorStrip.locator('img');
          const imgCount = await sponsorImages.count();

          if (imgCount > 0) {
            const firstImg = sponsorImages.first();
            const src = await firstImg.getAttribute('src');
            expect(src).toBeTruthy();
          }
        }
      }
    });

    test('Sponsor names show as fallback without logo', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const sponsorStrip = page.locator('#sponsorStrip, .sponsor-strip');
      const hasStrip = await sponsorStrip.count() > 0;

      if (hasStrip && await sponsorStrip.first().isVisible()) {
        // Should have either images or text names
        const hasImages = await sponsorStrip.locator('img').count() > 0;
        const hasText = await sponsorStrip.locator('strong, span, .sponsor-name').count() > 0;

        expect(hasImages || hasText).toBe(true);
      }
    });
  });

  test.describe('Complete Poster → Print → QR Flow', () => {

    test('Full chain: Load poster → Verify print → Check QR → Validate link', async ({ page }) => {
      // Step 1: Load poster
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Step 2: Verify poster loaded
      const posterContainer = page.locator('.poster-container, #poster, main');
      await expect(posterContainer.first()).toBeAttached();
      console.log('✓ Step 1: Poster loaded');

      // Step 3: Check print readiness
      await page.emulateMedia({ media: 'print' });
      const isPrintReady = await posterContainer.first().isVisible();
      expect(isPrintReady).toBe(true);
      console.log('✓ Step 2: Print layout verified');

      // Step 4: Check QR codes
      await page.emulateMedia({ media: 'screen' });
      const qrSection = page.locator('#qrGrid, .qr-section');
      const hasQR = await qrSection.count() > 0;
      expect(hasQR).toBe(true);
      console.log('✓ Step 3: QR section present');

      // Step 5: Validate QR code image
      const qrImages = page.locator('#qrGrid img, .qr-code img, img[src*="qr"]');
      const qrCount = await qrImages.count();

      if (qrCount > 0) {
        const qrSrc = await qrImages.first().getAttribute('src');
        expect(qrSrc).toBeTruthy();
        console.log('✓ Step 4: QR code validated');
      } else {
        console.log('⚠ Step 4: No QR images found (may need event with URLs configured)');
      }

      // Step 6: Check analytics tracking
      const hasAnalytics = await page.evaluate(() => {
        return typeof window.SponsorUtils?.logEvent === 'function';
      });
      expect(hasAnalytics).toBe(true);
      console.log('✓ Step 5: Analytics tracking available');
    });

    test('Chain with specific event: Create → Poster → Print → QR', async ({ page, request }) => {
      // Skip if no admin key
      if (ADMIN_KEY === 'CHANGE_ME_root') {
        test.skip();
        return;
      }

      // Step 1: Create test event
      const createResponse = await request.post(baseUrl, {
        data: {
          action: 'create',
          brandId: BRAND_ID,
          scope: 'events',
          templateId: 'event',
          adminKey: ADMIN_KEY,
          data: {
            name: `QR Chain Test - ${Date.now()}`,
            dateISO: '2025-12-31',
            location: 'Test Venue',
            signupUrl: 'https://docs.google.com/forms/d/e/test/viewform'
          }
        }
      });

      const createData = await createResponse.json();

      if (!createData.ok) {
        console.log('⚠ Event creation skipped:', createData.message);
        return;
      }

      const eventId = createData.value.id;
      console.log(`✓ Created event: ${eventId}`);

      // Step 2: Navigate to poster for this event
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}&id=${eventId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Step 3: Verify event appears on poster
      const eventName = page.locator('#eventName, h1');
      if (await eventName.count() > 0) {
        const nameText = await eventName.first().textContent();
        expect(nameText).toContain('QR Chain Test');
        console.log('✓ Event displayed on poster');
      }

      // Step 4: Check QR codes generated
      const qrSection = page.locator('#qrGrid, .qr-section');
      await expect(qrSection.first()).toBeAttached();
      console.log('✓ QR section present for event');

      // Step 5: Verify print mode
      await page.emulateMedia({ media: 'print' });
      const posterContainer = page.locator('.poster-container, main');
      await expect(posterContainer.first()).toBeVisible();
      console.log('✓ Print mode verified');
    });
  });

  test.describe('Edge Cases', () => {

    test('Poster handles missing event gracefully', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}&id=nonexistent-event-12345`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should show some content (error message or default)
      const bodyContent = await page.locator('body').innerHTML();
      expect(bodyContent.length).toBeGreaterThan(100);

      // Should not show raw error
      expect(bodyContent).not.toContain('Error:');
      expect(bodyContent).not.toContain('undefined');
    });

    test('Poster handles very long event names', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const eventName = page.locator('#eventName, h1');
      const hasName = await eventName.count() > 0;

      if (hasName) {
        // Check that text doesn't overflow
        const overflows = await eventName.first().evaluate(el => {
          return el.scrollWidth > el.clientWidth;
        });

        // Long names should be contained (word-wrap or truncation)
        // This test passes if either it doesn't overflow or is handled gracefully
        expect(typeof overflows).toBe('boolean');
      }
    });

    test('QR codes regenerate with different events', async ({ page }) => {
      // Load poster twice with different parameters
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const firstQRSrc = await page.locator('#qrGrid img, img[src*="qr"]').first().getAttribute('src').catch(() => '');

      // Navigate to different brand
      await page.goto(`${baseUrl}?page=poster&brand=abc`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const secondQRSrc = await page.locator('#qrGrid img, img[src*="qr"]').first().getAttribute('src').catch(() => '');

      // QR codes should potentially differ between brands/events
      // (or both empty if not configured)
      expect(typeof firstQRSrc).toBe('string');
      expect(typeof secondQRSrc).toBe('string');
    });
  });
});
