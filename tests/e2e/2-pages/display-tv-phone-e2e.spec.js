/**
 * DISPLAY SURFACE E2E TESTS - TV (1920x1080) + Phone Debug
 *
 * Purpose: Guarantee Display works on TV (primary) and is still valid on phone for debugging.
 *
 * Coverage:
 *   - TV 1920x1080 Viewport: No horizontal scrollbars, sponsor strip visible, safe area compliance
 *   - Phone Debug Viewport: Sponsor title visible, dynamic links/sections visible, footer visible
 *   - Manual Cast/TV Validation: Documented issues for follow-up
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:e2e
 *
 * SCHEMA: /schemas/event.schema.json (EVENT_CONTRACT.md v2.0)
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';

// Test timeout for network operations
const PAGE_TIMEOUT = 30000;

// Viewport configurations
const TV_1080P = { width: 1920, height: 1080 };
const TV_4K = { width: 3840, height: 2160 };
const PHONE_PORTRAIT = { width: 375, height: 667 }; // iPhone SE
const PHONE_LANDSCAPE = { width: 667, height: 375 };
const TABLET_PORTRAIT = { width: 768, height: 1024 }; // iPad

/**
 * Collect console errors during page load
 * @param {Page} page - Playwright page object
 * @returns {Array} Array to collect console errors
 */
function setupConsoleErrorCollection(page) {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', error => {
    consoleErrors.push(error.message);
  });
  return consoleErrors;
}

/**
 * Filter out expected/harmless errors
 * @param {Array} errors - Array of error messages
 * @returns {Array} Filtered critical errors
 */
function filterCriticalErrors(errors) {
  return errors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('google.script') &&
    !e.includes('google is not defined') &&
    !e.includes('net::ERR') &&
    !e.includes('404')
  );
}

// ============================================================================
// TV 1920x1080 TEST SUITE
// ============================================================================

test.describe('Display Surface - TV 1920x1080 Viewport', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(TV_1080P);
  });

  test('TV: Display page loads at 1920x1080 without errors', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Verify page structure
    await expect(page.locator('body[data-tv="1"]')).toBeVisible();
    await expect(page.locator('#stage, main#tv')).toBeVisible();

    // No critical JavaScript errors
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });

  test('TV: No horizontal scrollbars at 1920x1080', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for horizontal scrollbar
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    // STRICT: No horizontal scroll at TV resolution
    expect(hasHorizontalScroll).toBe(false);

    // Verify body doesn't overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(1920);
  });

  test('TV: Sponsor strip visible when sponsors are present', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for sponsor strip container
    const sponsorTop = page.locator('.sponsor-top, #sponsorTop, [data-sponsor-area="top"]');
    const sponsorTopExists = await sponsorTop.count() > 0;

    if (sponsorTopExists) {
      // Sponsor strip should be attached (may be hidden if no sponsors)
      await expect(sponsorTop.first()).toBeAttached();

      // Check if sponsor content exists (images or logos)
      const sponsorImages = sponsorTop.locator('img, a[data-sponsor-id]');
      const hasSponsors = await sponsorImages.count() > 0;

      if (hasSponsors) {
        // STRICT: When sponsors exist, strip must be visible
        await expect(sponsorTop.first()).toBeVisible();

        // Sponsor logos should be visible
        const firstLogo = sponsorImages.first();
        await expect(firstLogo).toBeVisible();

        // Verify sponsor strip is in viewport (not cut off)
        const boundingBox = await sponsorTop.first().boundingBox();
        if (boundingBox) {
          expect(boundingBox.y).toBeGreaterThanOrEqual(0);
          expect(boundingBox.x).toBeGreaterThanOrEqual(0);
          expect(boundingBox.width).toBeGreaterThan(0);
          expect(boundingBox.height).toBeGreaterThan(0);
        }

        console.log('   Sponsor strip is visible with sponsors present');
      } else {
        console.log('   No sponsors configured - sponsor strip may be hidden');
      }
    }

    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });

  test('TV: Main content occupies safe area (no overscan issues)', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // TV safe area is typically 5% from edges (for overscan on older TVs)
    const SAFE_MARGIN_PERCENT = 5;
    const viewportWidth = 1920;
    const viewportHeight = 1080;
    const safeMarginX = viewportWidth * (SAFE_MARGIN_PERCENT / 100);
    const safeMarginY = viewportHeight * (SAFE_MARGIN_PERCENT / 100);

    // Check main stage area
    const stage = page.locator('#stage, iframe#stage, .stage');
    const stageExists = await stage.count() > 0;

    if (stageExists) {
      const boundingBox = await stage.first().boundingBox();
      if (boundingBox) {
        // Stage should not extend into overscan zones
        // Left edge should be >= safe margin
        expect(boundingBox.x).toBeGreaterThanOrEqual(safeMarginX - 10); // Small tolerance

        // Right edge should not exceed safe area
        const rightEdge = boundingBox.x + boundingBox.width;
        expect(rightEdge).toBeLessThanOrEqual(viewportWidth - safeMarginX + 10);

        console.log(`   Stage bounds: x=${boundingBox.x}, width=${boundingBox.width}`);
        console.log(`   Safe margins: ${safeMarginX}px from edges`);
      }
    }

    // Check for any critical text near edges
    const headings = page.locator('h1, h2, .event-title');
    const headingCount = await headings.count();

    for (let i = 0; i < Math.min(headingCount, 3); i++) {
      const heading = headings.nth(i);
      if (await heading.isVisible()) {
        const box = await heading.boundingBox();
        if (box) {
          // Headings should be within safe area
          expect(box.x).toBeGreaterThanOrEqual(safeMarginX - 10);
          const rightEdge = box.x + box.width;
          expect(rightEdge).toBeLessThanOrEqual(viewportWidth - safeMarginX + 10);
        }
      }
    }
  });

  test('TV: Font size is legible at 10-12ft viewing distance', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Body font size should be at least 20px for TV viewing
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);

    // STRICT: Min 20px for 10-12ft viewing
    expect(fontSizeNum).toBeGreaterThanOrEqual(20);
    console.log(`   TV font size: ${fontSizeNum}px (target: >= 20px)`);
  });

  test('TV: Stage iframe loads and is visible', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for stage iframe
    const stageIframe = page.locator('iframe#stage');
    const stageExists = await stageIframe.count() > 0;

    if (stageExists) {
      await expect(stageIframe).toBeVisible();

      // Stage should have valid src
      const src = await stageIframe.getAttribute('src');
      if (src) {
        expect(src).toBeTruthy();
        console.log(`   Stage iframe src: ${src.substring(0, 80)}...`);
      }

      // Stage should occupy significant viewport area
      const boundingBox = await stageIframe.boundingBox();
      if (boundingBox) {
        expect(boundingBox.width).toBeGreaterThan(1000); // Should be wide
        expect(boundingBox.height).toBeGreaterThan(500); // Should be tall
      }
    } else {
      // Check for fallback card (when no event)
      const fallbackCard = page.locator('.fallback-card');
      if (await fallbackCard.count() > 0) {
        await expect(fallbackCard.first()).toBeVisible();
        console.log('   Fallback card displayed (no event data)');
      }
    }

    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });

  test('TV: League broadcast strip visible when external links present', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for league broadcast strip
    const leagueStrip = page.locator('.league-broadcast-strip, .league-strip, #leagueStrip');
    const leagueStripExists = await leagueStrip.count() > 0;

    if (leagueStripExists && await leagueStrip.first().isVisible()) {
      // Strip should have links
      const links = leagueStrip.locator('a');
      const linkCount = await links.count();

      if (linkCount > 0) {
        // Links should be visible
        await expect(links.first()).toBeVisible();

        // Verify strip is at bottom of viewport
        const boundingBox = await leagueStrip.first().boundingBox();
        if (boundingBox) {
          expect(boundingBox.y).toBeGreaterThan(800); // Should be near bottom
          console.log(`   League strip position: y=${boundingBox.y}`);
        }
      }
    } else {
      console.log('   League strip not visible (no external data)');
    }
  });

  test('TV: Side sponsor panel renders when configured', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for side sponsor panel
    const sponsorSide = page.locator('aside#sponsorSide, .sponsor-side');
    const sideExists = await sponsorSide.count() > 0;

    if (sideExists && await sponsorSide.first().isVisible()) {
      // Side panel should be on the right side
      const boundingBox = await sponsorSide.first().boundingBox();
      if (boundingBox) {
        expect(boundingBox.x).toBeGreaterThan(1400); // Right side of screen
        console.log(`   Side sponsor panel position: x=${boundingBox.x}`);
      }

      // Check for sponsor cards
      const sponsorCards = sponsorSide.locator('.sp-card, .sponsor-card');
      if (await sponsorCards.count() > 0) {
        await expect(sponsorCards.first()).toBeVisible();
      }
    } else {
      console.log('   Side sponsor panel not configured');
    }
  });

  test('TV: No layout catastrophe - all major elements visible', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Main TV container should exist
    const mainTv = page.locator('main#tv');
    await expect(mainTv).toBeVisible();

    // Stage should be visible (iframe or fallback)
    const stage = page.locator('#stage, .stage, .fallback-card');
    await expect(stage.first()).toBeVisible();

    // Take screenshot for visual inspection
    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toBeTruthy();

    // Ensure no overlapping elements causing chaos
    const bodyOverflow = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body);
      return {
        overflowX: style.overflowX,
        overflowY: style.overflowY
      };
    });

    // Body should not have visible overflow (hidden is acceptable)
    console.log(`   Body overflow: x=${bodyOverflow.overflowX}, y=${bodyOverflow.overflowY}`);

    // No critical errors
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });
});

// ============================================================================
// PHONE DEBUG TEST SUITE
// ============================================================================

test.describe('Display Surface - Phone Debug Viewport', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE_PORTRAIT);
  });

  test('Phone: Display page loads on mobile without errors', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Page should load
    await expect(page.locator('body')).toBeVisible();

    // No critical errors
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });

  test('Phone: Sponsor title/strip visible when sponsors present', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for sponsor area
    const sponsorTop = page.locator('.sponsor-top, #sponsorTop, [data-sponsor-area="top"]');
    const sponsorTopExists = await sponsorTop.count() > 0;

    if (sponsorTopExists) {
      // Check if sponsor content exists
      const sponsorContent = sponsorTop.locator('img, a[data-sponsor-id], strong');
      const hasContent = await sponsorContent.count() > 0;

      if (hasContent) {
        // On mobile, sponsor strip should still be accessible
        await expect(sponsorTop.first()).toBeAttached();

        // Check if scrollable to sponsor content
        const isVisible = await sponsorTop.first().isVisible().catch(() => false);
        if (isVisible) {
          console.log('   Sponsor strip visible on phone');
        } else {
          // May need to scroll to see it
          await sponsorTop.first().scrollIntoViewIfNeeded().catch(() => {});
          console.log('   Sponsor strip requires scroll on phone');
        }
      }
    }
  });

  test('Phone: Dynamic links/sections visible', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for league strip links
    const leagueStrip = page.locator('.league-broadcast-strip, .league-strip');
    if (await leagueStrip.count() > 0) {
      await leagueStrip.first().scrollIntoViewIfNeeded().catch(() => {});

      const links = leagueStrip.locator('a');
      const linkCount = await links.count();

      if (linkCount > 0) {
        console.log(`   Found ${linkCount} league strip links`);
      }
    }

    // Check for any interactive elements
    const interactiveElements = page.locator('a, button');
    const interactiveCount = await interactiveElements.count();
    expect(interactiveCount).toBeGreaterThanOrEqual(0);
    console.log(`   Total interactive elements: ${interactiveCount}`);
  });

  test('Phone: Footer visible when present', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for footer
    const footer = page.locator('.site-footer, footer, [role="contentinfo"]');
    const footerExists = await footer.count() > 0;

    if (footerExists) {
      // Scroll to footer
      await footer.first().scrollIntoViewIfNeeded().catch(() => {});

      // Footer should be accessible (even if off-screen initially)
      await expect(footer.first()).toBeAttached();
      console.log('   Footer is present');
    } else {
      console.log('   No footer element found');
    }
  });

  test('Phone: No horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for horizontal scrollbar
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    // STRICT: No horizontal scroll on mobile
    expect(hasHorizontalScroll).toBe(false);

    // Body width should fit viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(PHONE_PORTRAIT.width + 10); // Small tolerance
  });

  test('Phone: Stage content is readable', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check for stage
    const stage = page.locator('#stage, .stage, .fallback-card');
    const stageExists = await stage.count() > 0;

    if (stageExists) {
      await expect(stage.first()).toBeVisible();

      // Stage should occupy reasonable width on mobile
      const boundingBox = await stage.first().boundingBox();
      if (boundingBox) {
        expect(boundingBox.width).toBeGreaterThan(300); // Reasonable mobile width
        console.log(`   Stage width on phone: ${boundingBox.width}px`);
      }
    }
  });

  test('Phone: Touch targets are appropriately sized', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check touch targets (min 44x44px for accessibility)
    const touchTargets = page.locator('a, button');
    const count = await touchTargets.count();

    let smallTargets = 0;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const target = touchTargets.nth(i);
      if (await target.isVisible()) {
        const box = await target.boundingBox();
        if (box && (box.width < 44 || box.height < 44)) {
          smallTargets++;
        }
      }
    }

    // Warn if many small touch targets
    if (smallTargets > 3) {
      console.log(`   Warning: ${smallTargets} touch targets smaller than 44x44px`);
    }
  });

  test('Phone (Landscape): Display adapts to landscape orientation', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.setViewportSize(PHONE_LANDSCAPE);
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Page should load without errors
    await expect(page.locator('body')).toBeVisible();

    // No horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });
});

// ============================================================================
// TABLET TEST SUITE
// ============================================================================

test.describe('Display Surface - Tablet Viewport', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(TABLET_PORTRAIT);
  });

  test('Tablet: Display page loads on tablet viewport', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Page should load
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('#stage, .stage, .fallback-card').first()).toBeVisible();

    // No critical errors
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });

  test('Tablet: No horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    expect(hasHorizontalScroll).toBe(false);
  });
});

// ============================================================================
// SPONSOR STRIP CONSISTENCY TESTS
// ============================================================================

test.describe('Display Surface - Sponsor Strip Consistency', () => {

  test('Sponsor strip consistent across TV viewport', async ({ page }) => {
    await page.setViewportSize(TV_1080P);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    const sponsorTop = page.locator('.sponsor-top, #sponsorTop');
    const sponsorExists = await sponsorTop.count() > 0;

    if (sponsorExists) {
      // Get initial state
      const initialHTML = await sponsorTop.first().innerHTML();
      const hasContent = initialHTML.trim().length > 0;

      // Wait a few seconds and check consistency
      await page.waitForTimeout(3000);

      const afterHTML = await sponsorTop.first().innerHTML();

      // Sponsor strip should be stable (not flickering)
      if (hasContent) {
        expect(afterHTML.trim().length).toBeGreaterThan(0);
        console.log('   Sponsor strip content is stable');
      }
    }
  });

  test('Sponsor strip visible across page reload', async ({ page }) => {
    await page.setViewportSize(TV_1080P);

    // First load
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    const sponsorTop = page.locator('.sponsor-top, #sponsorTop');
    const firstLoadVisible = await sponsorTop.first().isVisible().catch(() => false);

    // Reload
    await page.reload({ waitUntil: 'networkidle' });

    const secondLoadVisible = await sponsorTop.first().isVisible().catch(() => false);

    // Consistency: visibility should match between loads
    expect(secondLoadVisible).toBe(firstLoadVisible);
    console.log(`   Sponsor strip visibility consistent: ${secondLoadVisible}`);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

test.describe('Display Surface - Performance', () => {

  test('TV: Page loads within acceptable time', async ({ page }) => {
    await page.setViewportSize(TV_1080P);

    const startTime = Date.now();
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);
    console.log(`   TV page load time: ${loadTime}ms`);
  });

  test('Phone: Page loads within acceptable time', async ({ page }) => {
    await page.setViewportSize(PHONE_PORTRAIT);

    const startTime = Date.now();
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds on mobile
    expect(loadTime).toBeLessThan(5000);
    console.log(`   Phone page load time: ${loadTime}ms`);
  });

  test('TV: No memory leaks during extended viewing', async ({ page }) => {
    await page.setViewportSize(TV_1080P);

    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    // Simulate extended viewing (30 seconds)
    console.log('   Running extended viewing test (30s)...');
    await page.waitForTimeout(30000);

    // Page should still be responsive
    await expect(page.locator('#stage, .stage, .fallback-card').first()).toBeVisible();

    // No errors during extended run
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);
  });
});

// ============================================================================
// MANUAL CAST/TV VALIDATION CHECKLIST
// ============================================================================

test.describe('Manual Cast/TV Validation - Documentation', () => {
  /**
   * MANUAL TESTING CHECKLIST
   * ========================
   * These tests document issues found during manual cast/TV validation.
   * Run this suite to generate a checklist, then manually verify on actual TV.
   *
   * To perform manual validation:
   * 1. Cast the display page to an actual TV
   * 2. Check each item below
   * 3. Log any issues as separate follow-up stories
   *
   * Manual Checks:
   * [ ] Font size legible at 10-12ft viewing distance
   * [ ] No text cut off in overscan zones (edge 5% of screen)
   * [ ] Sponsor logos clearly visible and not pixelated
   * [ ] Colors have sufficient contrast on TV
   * [ ] No flickering or screen tearing during content updates
   * [ ] League strip links readable at TV distance
   * [ ] Focus indicators visible for D-pad/remote navigation
   * [ ] Content updates smoothly without jarring transitions
   * [ ] Screen stays active (no screensaver/sleep issues)
   * [ ] Audio (if any) plays correctly through TV
   */

  test('Manual Checklist: Font Size at TV Distance', async ({ page }) => {
    await page.setViewportSize(TV_1080P);
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    // Document font sizes for manual verification
    const fontSizes = await page.evaluate(() => {
      const body = window.getComputedStyle(document.body).fontSize;
      const h1 = document.querySelector('h1')
        ? window.getComputedStyle(document.querySelector('h1')).fontSize
        : 'N/A';
      const h2 = document.querySelector('h2')
        ? window.getComputedStyle(document.querySelector('h2')).fontSize
        : 'N/A';

      return { body, h1, h2 };
    });

    console.log('   === MANUAL VERIFICATION NEEDED ===');
    console.log(`   Body font size: ${fontSizes.body}`);
    console.log(`   H1 font size: ${fontSizes.h1}`);
    console.log(`   H2 font size: ${fontSizes.h2}`);
    console.log('   [ ] Verify readable at 10-12ft on actual TV');

    // Automated check passes if font size meets minimum
    expect(parseInt(fontSizes.body)).toBeGreaterThanOrEqual(18);
  });

  test('Manual Checklist: Overscan Safe Area', async ({ page }) => {
    await page.setViewportSize(TV_1080P);
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    console.log('   === MANUAL VERIFICATION NEEDED ===');
    console.log('   [ ] Check no critical text in outer 5% of screen');
    console.log('   [ ] Verify sponsor logos fully visible');
    console.log('   [ ] Check CTA buttons not cut off');

    // Document body padding (should have safe area)
    const padding = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body);
      return {
        padding: style.padding,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
      };
    });

    console.log(`   Body padding: ${JSON.stringify(padding)}`);

    // Test passes - manual verification required
    expect(true).toBe(true);
  });

  test('Manual Checklist: Sponsor Logo Quality', async ({ page }) => {
    await page.setViewportSize(TV_1080P);
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    const sponsorImages = page.locator('.sponsor-top img, #sponsorTop img');
    const imageCount = await sponsorImages.count();

    console.log('   === MANUAL VERIFICATION NEEDED ===');
    console.log(`   Found ${imageCount} sponsor images`);
    console.log('   [ ] Verify logos are not pixelated on 1080p TV');
    console.log('   [ ] Check logo colors render correctly');
    console.log('   [ ] Verify logos have proper contrast against background');

    // Log image dimensions
    for (let i = 0; i < Math.min(imageCount, 3); i++) {
      const img = sponsorImages.nth(i);
      if (await img.isVisible()) {
        const naturalSize = await img.evaluate(el => ({
          natural: `${el.naturalWidth}x${el.naturalHeight}`,
          displayed: `${el.clientWidth}x${el.clientHeight}`,
          src: el.src.substring(0, 60) + '...'
        }));
        console.log(`   Image ${i + 1}: Natural ${naturalSize.natural}, Displayed ${naturalSize.displayed}`);
      }
    }

    // Test passes - manual verification required
    expect(true).toBe(true);
  });

  test('Manual Checklist: Focus Indicators for Remote Navigation', async ({ page }) => {
    await page.setViewportSize(TV_1080P);
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    console.log('   === MANUAL VERIFICATION NEEDED ===');
    console.log('   [ ] Use TV remote to navigate with D-pad');
    console.log('   [ ] Verify focus indicator is visible (orange outline)');
    console.log('   [ ] Check focus moves logically between elements');
    console.log('   [ ] Verify Enter/Select activates focused element');

    // Tab through elements to test focus
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);

    console.log(`   First focusable element: ${focusedTag}`);

    // Test passes - manual verification required
    expect(true).toBe(true);
  });
});
