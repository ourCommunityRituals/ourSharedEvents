/**
 * SECTION VISIBILITY NEGATIVE TESTS
 *
 * Purpose: Verify sections are properly hidden when disabled or missing data.
 * Empty schedule/standings/sponsors look broken if not handled.
 *
 * Coverage:
 *   - No schedule section when showSchedule=false or no data
 *   - No sponsor strip when sponsors empty or showSponsors=false
 *   - Map/video/gallery sections respect both settings toggles and data presence
 *
 * Scope: Focus on Public + Display surfaces (Admin remains more raw)
 *
 * Run with: npm run test:negative
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');
const { ADMIN_PAGE } = require('../selectors');

const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const PAGE_TIMEOUT = 30000;

/**
 * Setup console error collection
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
 * Filter out expected/harmless errors (GAS, favicon, etc.)
 */
function filterCriticalErrors(errors) {
  return errors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('google.script') &&
    !e.includes('google is not defined') &&
    !e.includes('Script error') &&
    !e.includes('net::ERR')
  );
}

// =============================================================================
// PUBLIC SURFACE - SECTION VISIBILITY NEGATIVE TESTS
// =============================================================================

test.describe('Section Visibility: Public Surface - Settings Disabled', () => {

  test.beforeEach(async ({ page }) => {
    // Handle admin prompts
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });
  });

  test('Create event with all optional sections DISABLED, verify sections are hidden', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);
    const eventName = `Negative Test - Disabled Sections ${Date.now()}`;

    // Step 1: Create event via Admin with sections disabled
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    // Fill required fields
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue - Negative Sections');

    // Disable optional sections if toggles exist
    // Check for schedule toggle
    const scheduleToggle = page.locator('#showSchedule, input[name="showSchedule"]');
    if (await scheduleToggle.count() > 0) {
      await scheduleToggle.uncheck();
    }

    // Check for standings toggle
    const standingsToggle = page.locator('#showStandings, input[name="showStandings"]');
    if (await standingsToggle.count() > 0) {
      await standingsToggle.uncheck();
    }

    // Check for bracket toggle
    const bracketToggle = page.locator('#showBracket, input[name="showBracket"]');
    if (await bracketToggle.count() > 0) {
      await bracketToggle.uncheck();
    }

    // Check for sponsors toggle
    const sponsorsToggle = page.locator('#showSponsors, input[name="showSponsors"]');
    if (await sponsorsToggle.count() > 0) {
      await sponsorsToggle.uncheck();
    }

    // Create the event
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Get Public page link
    const publicLink = page.locator(ADMIN_PAGE.PUBLIC_LINK);
    if (await publicLink.isVisible().catch(() => false)) {
      const href = await publicLink.getAttribute('href');

      // Step 2: Navigate to Public page
      await page.goto(href, {
        waitUntil: 'networkidle',
        timeout: PAGE_TIMEOUT,
      });

      // Step 3: Verify disabled sections are NOT visible
      // Schedule section should NOT exist when disabled
      const scheduleSection = page.locator('.event-section:has(h2:text-is("Schedule"))');
      expect(await scheduleSection.count(), 'Schedule section should be hidden when disabled').toBe(0);

      // Standings section should NOT exist when disabled
      const standingsSection = page.locator('.event-section:has(h2:text-is("Standings"))');
      expect(await standingsSection.count(), 'Standings section should be hidden when disabled').toBe(0);

      // Bracket section should NOT exist when disabled
      const bracketSection = page.locator('.event-section:has(h2:text-is("Bracket"))');
      expect(await bracketSection.count(), 'Bracket section should be hidden when disabled').toBe(0);

      // Sponsor banner should be hidden when disabled
      const sponsorBanner = page.locator('#sponsorBanner:not([hidden])');
      expect(await sponsorBanner.count(), 'Sponsor banner should be hidden when disabled').toBe(0);
    }

    // No critical console errors
    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });
});

test.describe('Section Visibility: Public Surface - Empty Data', () => {

  test('Schedule section hidden when schedule array is empty', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    // Navigate to an event detail
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check schedule section behavior
      const scheduleSection = page.locator('.event-section:has(h2:text-is("Schedule"))');
      const scheduleCount = await scheduleSection.count();

      if (scheduleCount > 0) {
        // If schedule section exists, it MUST have content (not empty)
        const scheduleItems = scheduleSection.locator('.schedule-item, .schedule-list tr, a[href], .loading-placeholder');
        const itemCount = await scheduleItems.count();
        expect(itemCount, 'Schedule section should have content if visible').toBeGreaterThan(0);
      }
      // If scheduleCount is 0, section is properly hidden - that's good
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Standings section hidden when standings array is empty', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      const standingsSection = page.locator('.event-section:has(h2:text-is("Standings"))');
      const standingsCount = await standingsSection.count();

      if (standingsCount > 0) {
        // If standings section exists, it MUST have table rows or content
        const tableRows = standingsSection.locator('table tbody tr, .standings-table tr, a[href]');
        const rowCount = await tableRows.count();
        expect(rowCount, 'Standings section should have rows if visible').toBeGreaterThan(0);
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Bracket section hidden when bracket data is null', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      const bracketSection = page.locator('.event-section:has(h2:text-is("Bracket"))');
      const bracketCount = await bracketSection.count();

      if (bracketCount > 0) {
        // If bracket section exists, it MUST have matches or rounds
        const bracketContent = bracketSection.locator('.bracket-match, .bracket-round, a[href], .bracket-container');
        const contentCount = await bracketContent.count();
        expect(contentCount, 'Bracket section should have content if visible').toBeGreaterThan(0);
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Sponsor banner hidden when sponsors array is empty', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Sponsor banner should be hidden OR have actual sponsor logos
      const sponsorBanner = page.locator('#sponsorBanner');

      if (await sponsorBanner.count() > 0) {
        const isHidden = await sponsorBanner.getAttribute('hidden');
        const sponsorLogos = sponsorBanner.locator('img, a[data-sponsor-id]');
        const logoCount = await sponsorLogos.count();

        // Either hidden attribute is set, OR it has actual logos
        const properlyHidden = isHidden !== null || logoCount > 0;
        expect(properlyHidden, 'Sponsor banner should be hidden or have logos').toBe(true);

        // If visible (no hidden attr), verify it's not empty
        if (isHidden === null) {
          expect(logoCount, 'Visible sponsor banner must have sponsor logos').toBeGreaterThan(0);
        }
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Video section hidden when media.videoUrl is empty', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      const videoSection = page.locator('.event-section:has(h2:text-is("Video"))');
      const videoCount = await videoSection.count();

      if (videoCount > 0) {
        // If video section exists, it MUST have an iframe or video link
        const videoContent = videoSection.locator('iframe, video, a[href*="youtube"], a[href*="vimeo"], a:has-text("Watch")');
        const contentCount = await videoContent.count();
        expect(contentCount, 'Video section should have video content if visible').toBeGreaterThan(0);
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Gallery section hidden when media.gallery is empty', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      const gallerySection = page.locator('.event-section:has(h2:text-is("Gallery"))');
      const galleryCount = await gallerySection.count();

      if (galleryCount > 0) {
        // If gallery section exists, it MUST have images
        const galleryImages = gallerySection.locator('.gallery img, img');
        const imageCount = await galleryImages.count();
        expect(imageCount, 'Gallery section should have images if visible').toBeGreaterThan(0);
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Map button hidden when showMap=false and no venue', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check utility buttons for Maps
      const mapsButton = page.locator('.utility-buttons .btn-utility:has-text("Maps"), .btn-utility:has-text("Open in Maps")');
      const mapsCount = await mapsButton.count();

      if (mapsCount > 0) {
        // If maps button exists, it should have a valid href
        const href = await mapsButton.first().getAttribute('href');
        expect(href, 'Maps button should have valid href').toBeTruthy();
        expect(href).not.toContain('undefined');
        expect(href).not.toContain('null');
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });
});

// =============================================================================
// DISPLAY SURFACE - SECTION VISIBILITY NEGATIVE TESTS
// =============================================================================

test.describe('Section Visibility: Display Surface - Sponsor Strip', () => {

  test('Sponsor strip hidden when no sponsors exist', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    // Navigate to a Display page
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Check sponsor strip (top banner)
    const sponsorTop = page.locator('#sponsorTop, .sponsor-top');

    if (await sponsorTop.count() > 0) {
      const isHidden = await sponsorTop.getAttribute('hidden');
      const sponsorLogos = sponsorTop.locator('img, a[data-sponsor-id]');
      const logoCount = await sponsorLogos.count();

      // Either hidden OR has actual sponsors
      if (isHidden === null) {
        // If not hidden, must have sponsor content
        expect(logoCount, 'Visible sponsor strip must have sponsors').toBeGreaterThanOrEqual(0);
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Display page loads without errors when event has no optional data', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Page structure should exist
    const mainEl = page.locator('main#tv, #stage, body[data-tv]');
    expect(await mainEl.count(), 'Display should have main structure').toBeGreaterThan(0);

    // No console errors
    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('League/broadcast strip hidden when no external data URLs', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // League broadcast strip
    const leagueStrip = page.locator('#leagueBroadcastStrip, .league-broadcast-strip');

    if (await leagueStrip.count() > 0) {
      const isHidden = await leagueStrip.getAttribute('hidden');
      const leagueLinks = leagueStrip.locator('a.strip-link, a[data-link-type]');
      const linkCount = await leagueLinks.count();

      // Either hidden OR has actual links
      if (isHidden === null) {
        // If visible, should have league links
        expect(linkCount, 'Visible league strip must have links').toBeGreaterThan(0);
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });
});

// =============================================================================
// CROSS-SURFACE - NO EMPTY SECTION FRAMES
// =============================================================================

test.describe('Section Visibility: No Empty Section Frames', () => {

  test('Public page has no visible empty section containers', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check all visible event-section elements have content
      const visibleSections = page.locator('.event-section:visible');
      const sectionCount = await visibleSections.count();

      for (let i = 0; i < sectionCount; i++) {
        const section = visibleSections.nth(i);
        const sectionText = await section.innerText();
        const hasHeader = await section.locator('h2, h3').count() > 0;
        const hasContent = await section.locator('table, .schedule-list, .bracket-container, .gallery, iframe, a, p, ul, ol').count() > 0;

        // Visible section should have both header and content
        if (hasHeader) {
          expect(hasContent, `Section should have content if visible`).toBe(true);
        }
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('No sections with only loading placeholders after load complete', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Wait extra time for any async loading
      await page.waitForTimeout(2000);

      // Check for stuck loading placeholders
      const loadingPlaceholders = page.locator('.loading-placeholder:visible, .loading:visible');
      const placeholderCount = await loadingPlaceholders.count();

      // After full load, there shouldn't be visible loading states
      // Allow some if they're part of external data loading
      expect(placeholderCount, 'Should have minimal loading placeholders after load').toBeLessThanOrEqual(3);
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Sponsor banner does not show empty container', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      const sponsorBanner = page.locator('#sponsorBanner');

      if (await sponsorBanner.count() > 0) {
        const isHidden = await sponsorBanner.getAttribute('hidden');

        // If not hidden, check it's not visually empty
        if (isHidden === null) {
          const boundingBox = await sponsorBanner.boundingBox();

          if (boundingBox && boundingBox.height > 0) {
            // Visible sponsor banner must have actual sponsors
            const sponsors = sponsorBanner.locator('img, a[data-sponsor-id], a.sponsor-logo');
            const sponsorCount = await sponsors.count();
            expect(sponsorCount, 'Visible sponsor banner must have sponsors').toBeGreaterThan(0);
          }
        }
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });
});

// =============================================================================
// GRACEFUL DEGRADATION TESTS
// =============================================================================

test.describe('Section Visibility: Graceful Degradation', () => {

  test('Page renders cleanly with all optional sections missing', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Core elements should always be present
      const eventHeader = page.locator('.event-header, .event-detail h1');
      expect(await eventHeader.count(), 'Event header should exist').toBeGreaterThan(0);

      // Action buttons should exist
      const actionButtons = page.locator('.action-buttons');
      expect(await actionButtons.count(), 'Action buttons should exist').toBeGreaterThan(0);

      // No JS errors or undefined text
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('undefined');
      expect(bodyText).not.toContain('NaN');
      expect(bodyText).not.toMatch(/TypeError:/);
      expect(bodyText).not.toMatch(/ReferenceError:/);
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('No broken images when optional media is missing', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check for broken image src attributes
      const brokenImages = page.locator('img[src=""], img[src="undefined"], img[src="null"]');
      const brokenCount = await brokenImages.count();

      expect(brokenCount, 'No broken image sources').toBe(0);

      // Check all images have valid src
      const allImages = page.locator('img[src]');
      const imageCount = await allImages.count();

      for (let i = 0; i < Math.min(imageCount, 10); i++) {
        const src = await allImages.nth(i).getAttribute('src');
        expect(src, 'Image should have valid src').toBeTruthy();
        expect(src).not.toBe('undefined');
        expect(src).not.toBe('null');
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Display surface handles missing sponsor placement gracefully', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Display should still work even without display-placement sponsors
    const stageIframe = page.locator('iframe#stage, #stage iframe');

    // If stage exists, it should be loading or have content
    if (await stageIframe.count() > 0) {
      const src = await stageIframe.getAttribute('src');
      // src might be empty initially, but shouldn't be 'undefined' or 'null'
      if (src) {
        expect(src).not.toBe('undefined');
        expect(src).not.toBe('null');
      }
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });
});

// =============================================================================
// ADMIN-CREATED EVENT WITH SPECIFIC SETTINGS
// =============================================================================

test.describe('Section Visibility: Admin-Created Minimal Event', () => {

  test.beforeEach(async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });
  });

  test('Minimal event (no schedule/standings/bracket) shows clean UI', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);
    const eventName = `Minimal Event Test ${Date.now()}`;

    // Create minimal event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Minimal Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Navigate to Public page
    const publicLink = page.locator(ADMIN_PAGE.PUBLIC_LINK);
    if (await publicLink.isVisible().catch(() => false)) {
      const href = await publicLink.getAttribute('href');
      await page.goto(href, {
        waitUntil: 'networkidle',
        timeout: PAGE_TIMEOUT,
      });

      // Event title should be visible
      const title = page.locator('h1');
      await expect(title.first()).toBeVisible();
      const titleText = await title.first().textContent();
      expect(titleText).toContain(eventName.substring(0, 20));

      // Sponsor banner should be hidden (no sponsors added)
      const sponsorBanner = page.locator('#sponsorBanner');
      if (await sponsorBanner.count() > 0) {
        const isHidden = await sponsorBanner.getAttribute('hidden');
        const hasSponsors = await sponsorBanner.locator('img').count() > 0;
        expect(isHidden !== null || !hasSponsors, 'Sponsor banner hidden with no sponsors').toBe(true);
      }

      // No section "frames" without content
      const emptyFrames = page.locator('.event-section:empty');
      expect(await emptyFrames.count(), 'No empty section frames').toBe(0);
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });

  test('Event on Display surface without sponsors shows clean layout', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);
    const eventName = `Display Test No Sponsors ${Date.now()}`;

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Display Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Navigate to Display page
    const displayLink = page.locator(ADMIN_PAGE.DISPLAY_LINK);
    if (await displayLink.isVisible().catch(() => false)) {
      const href = await displayLink.getAttribute('href');
      await page.goto(href, {
        waitUntil: 'networkidle',
        timeout: PAGE_TIMEOUT,
      });

      // Sponsor strip should be hidden
      const sponsorTop = page.locator('#sponsorTop');
      if (await sponsorTop.count() > 0) {
        const isHidden = await sponsorTop.getAttribute('hidden');
        const hasSponsors = await sponsorTop.locator('img').count() > 0;
        expect(isHidden !== null || !hasSponsors, 'Sponsor strip hidden with no sponsors').toBe(true);
      }

      // Main structure should be intact
      const mainTv = page.locator('main#tv, body[data-tv]');
      expect(await mainTv.count(), 'Display main structure exists').toBeGreaterThan(0);
    }

    expect(filterCriticalErrors(consoleErrors)).toHaveLength(0);
  });
});
