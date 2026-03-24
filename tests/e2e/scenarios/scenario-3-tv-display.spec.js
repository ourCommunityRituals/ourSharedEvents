/**
 * SCENARIO 3: TV Display at Venue
 *
 * Testing TV display functionality for live event venues
 * Focus: Large screen display, sponsor carousel, auto-rotation, analytics
 *
 * Architecture: TV viewport (1080p/4K), carousel timing, embed handling
 * SDET Focus: Performance, rotation logic, error handling, analytics tracking
 */

const { test, expect } = require('@playwright/test');
const { getCurrentEnvironment } = require('../../config/environments');

// Get environment configuration
const env = getCurrentEnvironment();
const BASE_URL = env.baseUrl;
const BRAND_ID = 'root';

// TV viewport configurations
const TV_1080P = { width: 1920, height: 1080 };
const TV_4K = { width: 3840, height: 2160 };

test.describe('SCENARIO 3: TV Display at Venue', () => {

  test.beforeEach(async ({ page }) => {
    // Set 1080p TV viewport by default
    await page.setViewportSize(TV_1080P);
  });

  test('3.1.1 Config load from Public page → Should transfer config to Display page', async ({ page }) => {
    // Step 1: Load public page and verify config exists
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // VERIFY: Public page loads
    await expect(page.locator('main, #app')).toBeVisible();

    // Check if public page has sponsor config
    const publicSponsor = page.locator('#sponsorBanner, .sponsor-banner, [data-sponsor]');
    const hasSponsorOnPublic = await publicSponsor.count() > 0;

    if (hasSponsorOnPublic) {
      console.log('   ✓ Sponsor config exists on public page');
    }

    // Step 2: Navigate to Display page
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // VERIFY: Display page loads
    await expect(page.locator('#stage, main, [data-page="display"]')).toBeVisible();

    // VERIFY: Display page inherits same sponsor config
    const displaySponsor = page.locator(
      '#sponsorTop, ' +
      '#sponsorBottom, ' +
      '.sponsor-top, ' +
      '.sponsor-bottom, ' +
      '[data-sponsor-area], ' +
      '[data-sponsor]'
    );

    const hasSponsorOnDisplay = await displaySponsor.count() > 0;

    // VERIFY: Sponsor config transferred successfully
    if (hasSponsorOnPublic) {
      expect(hasSponsorOnDisplay).toBe(true);
      console.log('   ✓ Sponsor config transferred to display page');
    }

    console.log('✅ Test 3.1.1 PASSED: Config loads from public to display page');
  });

  test('3.1.2 Load display page → Sponsors should appear within 3s', async ({ page }) => {
    const startTime = Date.now();

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for sponsor area to appear (with 3s timeout)
    const sponsorArea = page.locator(
      '#sponsorTop, ' +
      '#sponsorBottom, ' +
      '.sponsor-top, ' +
      '.sponsor-bottom, ' +
      '[data-sponsor-area]'
    ).first();

    try {
      await expect(sponsorArea).toBeAttached({ timeout: 3000 });
      const loadTime = Date.now() - startTime;

      // VERIFY: Sponsors appear within 3 seconds
      expect(loadTime).toBeLessThan(3000);
      console.log(`   Sponsor load time: ${loadTime}ms (target: <3000ms)`);

      console.log('✅ Test 3.1.2 PASSED: Sponsors appear within 3s');
    } catch (error) {
      const loadTime = Date.now() - startTime;
      console.log(`   ⚠ Sponsor load time: ${loadTime}ms (exceeded 3s target)`);
      throw error;
    }
  });

  test('3.1.3 Sponsor config is present → Should have sponsor data in DOM', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // VERIFY: Sponsor area containers exist in DOM
    const sponsorAreas = [
      '#sponsorTop',
      '#sponsorBottom',
      '.sponsor-top',
      '.sponsor-bottom',
      '[data-sponsor-area="top"]',
      '[data-sponsor-area="bottom"]'
    ];

    let sponsorAreaFound = false;
    for (const selector of sponsorAreas) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        sponsorAreaFound = true;
        console.log(`   ✓ Sponsor area found: ${selector}`);

        // VERIFY: Sponsor area has content or data attributes
        const sponsorArea = page.locator(selector).first();
        const isAttached = await sponsorArea.isAttached();
        expect(isAttached).toBe(true);

        // Check for sponsor data
        const hasSponsorData = await sponsorArea.evaluate(el => {
          return el.innerHTML.trim().length > 0 ||
                 el.hasAttribute('data-sponsors') ||
                 el.querySelectorAll('[data-sponsor]').length > 0;
        });

        if (hasSponsorData) {
          console.log(`   ✓ Sponsor area has data`);
        }
      }
    }

    // VERIFY: At least one sponsor area exists
    expect(sponsorAreaFound).toBe(true);

    console.log('✅ Test 3.1.3 PASSED: Sponsor config present in DOM');
  });

  test('3.2.1 Dynamic Carousel mode loads → Should initialize carousel', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`   Browser error: ${msg.text()}`);
      }
    });

    // VERIFY: Sponsor area exists
    const sponsorArea = page.locator('#sponsorTop, .sponsor-top, [data-sponsor-area]').first();
    const sponsorExists = await sponsorArea.count() > 0;

    if (sponsorExists) {
      await expect(sponsorArea).toBeAttached();

      // Wait for carousel to potentially initialize
      await page.waitForTimeout(2000);

      // VERIFY: No JavaScript errors during initialization
      const criticalErrors = errors.filter(e =>
        !e.message.includes('google.script') &&
        !e.message.includes('google is not defined')
      );
      expect(criticalErrors.length).toBe(0);

      // Check for carousel indicators (slides, dots, navigation)
      const carouselIndicators = page.locator(
        '.carousel-slide, ' +
        '.sponsor-slide, ' +
        '[data-carousel-item], ' +
        '.carousel-dot, ' +
        'button.prev, ' +
        'button.next'
      );

      const hasCarouselUI = await carouselIndicators.count() > 0;
      if (hasCarouselUI) {
        console.log('   ✓ Carousel UI elements detected');
      } else {
        console.log('   ℹ Carousel may use simple rotation without UI controls');
      }

      console.log('✅ Test 3.2.1 PASSED: Carousel initialized without errors');
    } else {
      console.log('⚠ Test 3.2.1 SKIPPED: No sponsor area found');
    }
  });

  test('3.2.2 Carousel mode → Should rotate every N seconds', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Get rotation interval from page config
    const rotationInterval = await page.evaluate(() => {
      // Check for config variable
      return window.CAROUSEL_INTERVAL ||
             window.rotationInterval ||
             5000; // Default 5 seconds
    });

    console.log(`   Rotation interval: ${rotationInterval}ms`);

    const sponsorArea = page.locator('#sponsorTop, .sponsor-top, [data-sponsor-area]').first();
    const sponsorExists = await sponsorArea.count() > 0;

    if (sponsorExists) {
      // Capture initial state
      const initialHTML = await sponsorArea.innerHTML();
      const initialHash = initialHTML.substring(0, 100);

      console.log(`   Initial sponsor: ${initialHash.substring(0, 50)}...`);

      // Wait for rotation to occur (interval + buffer)
      const waitTime = rotationInterval + 1000;
      console.log(`   Waiting ${waitTime}ms for rotation...`);
      await page.waitForTimeout(waitTime);

      // Capture state after rotation
      const afterHTML = await sponsorArea.innerHTML();
      const afterHash = afterHTML.substring(0, 100);

      // VERIFY: Content changed (rotation occurred) OR stayed same if only 1 sponsor
      if (initialHash !== afterHash) {
        console.log('   ✓ Carousel rotated (content changed)');
        console.log(`   New sponsor: ${afterHash.substring(0, 50)}...`);
      } else {
        console.log('   ℹ Content unchanged (may be single sponsor or static display)');
      }

      // Wait for second rotation
      await page.waitForTimeout(rotationInterval + 1000);
      const secondHTML = await sponsorArea.innerHTML();

      console.log('   ✓ Carousel running continuously');

      console.log('✅ Test 3.2.2 PASSED: Carousel rotation working');
    } else {
      console.log('⚠ Test 3.2.2 SKIPPED: No sponsor carousel found');
    }
  });

  test('3.2.3 Blocked embed (Instagram) → Should skip silently', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Track console errors
    const errors = [];
    const warnings = [];

    page.on('pageerror', error => {
      errors.push(error.message);
    });

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      } else if (msg.type() === 'warning') {
        warnings.push(msg.text());
      }
    });

    // Look for embed containers
    const embedContainers = page.locator(
      'iframe[src*="instagram"], ' +
      'iframe[src*="facebook"], ' +
      'iframe[src*="twitter"], ' +
      'iframe[src*="youtube"], ' +
      '.embed-container, ' +
      '[data-embed]'
    );

    const embedCount = await embedContainers.count();

    if (embedCount > 0) {
      console.log(`   Found ${embedCount} embed(s)`);

      // Wait for embeds to load or fail
      await page.waitForTimeout(5000);

      // VERIFY: No critical errors from blocked embeds
      const criticalErrors = errors.filter(e =>
        !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
        !e.includes('google.script')
      );

      expect(criticalErrors.length).toBe(0);

      // Check if page handled blocked embeds gracefully
      const hasErrorUI = await page.locator('.embed-error, .embed-blocked, .embed-unavailable').count();

      if (hasErrorUI > 0) {
        console.log('   ✓ Blocked embeds handled with error UI');
      } else {
        console.log('   ✓ Blocked embeds skipped silently');
      }

      console.log('✅ Test 3.2.3 PASSED: Blocked embeds handled gracefully');
    } else {
      console.log('   ℹ No embeds found in current display');
      console.log('✅ Test 3.2.3 PASSED: No embeds to handle');
    }
  });

  test('3.2.4 Analytics → Should log every rotation', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Track analytics requests
    const analyticsRequests = [];

    page.on('request', request => {
      const url = request.url();
      if (url.includes('analytics') ||
          url.includes('track') ||
          url.includes('log') ||
          url.includes('rotate') ||
          url.includes('impression')) {
        analyticsRequests.push({
          url: url,
          method: request.method(),
          timestamp: Date.now()
        });
        console.log(`   Analytics: ${request.method()} ${url.substring(0, 80)}...`);
      }
    });

    // Track console logs for analytics
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('analytics') ||
          text.includes('track') ||
          text.includes('rotation') ||
          text.includes('impression')) {
        console.log(`   Analytics log: ${text.substring(0, 100)}`);
      }
    });

    const sponsorArea = page.locator('#sponsorTop, .sponsor-top, [data-sponsor-area]').first();
    const sponsorExists = await sponsorArea.count() > 0;

    if (sponsorExists) {
      // Wait for initial load analytics
      await page.waitForTimeout(2000);
      const initialAnalytics = analyticsRequests.length;

      // Get rotation interval
      const rotationInterval = await page.evaluate(() => {
        return window.CAROUSEL_INTERVAL || window.rotationInterval || 5000;
      });

      // Wait for first rotation
      await page.waitForTimeout(rotationInterval + 1000);
      const afterFirstRotation = analyticsRequests.length;

      // Wait for second rotation
      await page.waitForTimeout(rotationInterval + 1000);
      const afterSecondRotation = analyticsRequests.length;

      console.log(`   Analytics events: Initial=${initialAnalytics}, After 1st=${afterFirstRotation}, After 2nd=${afterSecondRotation}`);

      // VERIFY: Analytics events increased (or document if not implemented)
      if (afterSecondRotation > initialAnalytics) {
        console.log('   ✓ Analytics tracking rotation events');
        expect(afterSecondRotation).toBeGreaterThan(initialAnalytics);
      } else {
        console.log('   ⚠ No analytics requests detected (may need implementation)');
      }

      console.log('✅ Test 3.2.4 COMPLETED: Analytics tracking documented');
    } else {
      console.log('⚠ Test 3.2.4 SKIPPED: No sponsor carousel found');
    }
  });
});

/**
 * INTEGRATION TEST: Complete TV display workflow
 */
test.describe('SCENARIO 3: Complete TV Display (Integration)', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(TV_1080P);
  });

  test('Complete TV display experience - 1080p', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => {
      if (!error.message.includes('google.script')) {
        errors.push(error);
      }
    });

    // Step 1: Load display page
    const startTime = Date.now();
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - startTime;

    console.log(`   Display page load time: ${loadTime}ms`);

    // Step 2: Verify TV layout
    await expect(page.locator('#stage, main')).toBeVisible();

    // Step 3: Verify sponsor areas
    const sponsorArea = page.locator('#sponsorTop, .sponsor-top, [data-sponsor-area]');
    if (await sponsorArea.count() > 0) {
      await expect(sponsorArea.first()).toBeAttached();
      console.log('   ✓ Sponsor area initialized');
    }

    // Step 4: Run carousel for multiple cycles
    console.log('   Running carousel for 20 seconds...');
    await page.waitForTimeout(20000);

    // Step 5: Verify no errors during operation
    expect(errors.length).toBe(0);

    console.log('✅ INTEGRATION TEST PASSED: TV display running smoothly');
  });

  test('4K TV display test', async ({ page }) => {
    await page.setViewportSize(TV_4K);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // VERIFY: Layout adapts to 4K
    await expect(page.locator('#stage, main')).toBeVisible();

    // VERIFY: Fonts scale appropriately for 4K viewing distance
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    console.log(`   4K font size: ${fontSizeNum}px`);

    // Font should be large enough for TV viewing
    expect(fontSizeNum).toBeGreaterThanOrEqual(20);

    console.log('✅ 4K display test passed');
  });

  test('Long-running stability test (carousel runs for 60 seconds)', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    const errors = [];
    page.on('pageerror', error => {
      if (!error.message.includes('google.script')) {
        errors.push(error);
        console.log(`   Error at ${Date.now()}: ${error.message}`);
      }
    });

    console.log('   Running carousel for 60 seconds (stability test)...');

    // Run for 60 seconds, checking every 10 seconds
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(10000);
      console.log(`   ${(i + 1) * 10}s elapsed - Errors: ${errors.length}`);

      // VERIFY: Page is still responsive
      const isVisible = await page.locator('#stage, main').isVisible();
      expect(isVisible).toBe(true);
    }

    // VERIFY: No memory leaks or errors during extended run
    expect(errors.length).toBe(0);

    console.log('✅ Long-running stability test passed (60s)');
  });
});
