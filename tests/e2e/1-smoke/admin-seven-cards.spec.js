/**
 * Admin Seven-Card Shell Smoke Tests - Story 9
 *
 * Comprehensive E2E tests for the Admin 7-card event management flow:
 * 1. Create event via new card flow
 * 2. Verify all 7 cards are visible and functional
 * 3. Verify navigation to Public/Display/Poster/SharedReport from Admin
 *
 * The 7 Cards:
 * - Card 1: Event Basics - Confirmation of created event
 * - Card 2: Sponsors - Sponsor analytics links
 * - Card 3: Sign-Up Forms - Registration forms management
 * - Card 4: Poster Page - Printable poster with QR
 * - Card 5: TV Display - Bar screen display mode
 * - Card 6: Public Page - Customer-facing event page
 * - Card 7: Shared Report - Post-event analytics
 *
 * Run: npm run test:smoke
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');
const { ADMIN_PAGE } = require('../selectors');

// Configuration
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

// Generate unique test event data
const TEST_EVENT = {
  name: `Seven Card Test ${Date.now()}`,
  date: (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  })(),
  time: '18:00',
  venue: 'Test Bar & Grill',
  summary: 'Automated test for 7-card Admin flow validation',
};

// Timeout config for GAS cold starts
const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

/**
 * Filter out expected GAS-related JavaScript errors
 */
function filterCriticalErrors(errors) {
  return errors.filter(e =>
    !e.message.includes('google.script') &&
    !e.message.includes('google is not defined') &&
    !e.message.includes('Script error')
  );
}

test.describe('Admin Seven-Card Shell Smoke Tests', () => {
  let page;
  let errors = [];

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    errors = [];
    page.on('pageerror', error => errors.push(error));

    // Set up dialog handler for admin key prompt
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt' && dialog.message().toLowerCase().includes('admin')) {
        await dialog.accept(ADMIN_KEY);
      } else if (dialog.type() === 'alert') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('Phase 1: Create Event Form loads correctly', async () => {
    // Load Admin page
    const response = await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);

    // Verify Create Card (Phase 1) is visible
    await expect(page.locator(ADMIN_PAGE.CREATE_CARD)).toBeVisible({ timeout: 15000 });

    // Verify form elements are present
    await expect(page.locator(ADMIN_PAGE.EVENT_NAME_INPUT).first()).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.EVENT_DATE_INPUT).first()).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.EVENT_LOCATION_INPUT).first()).toBeVisible();

    // Verify Create Event button exists
    await expect(page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first()).toBeVisible();

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });

  test('Phase 2: Create event and verify Seven-Card Shell appears', async () => {
    // Load Admin page
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Fill out the event creation form
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);

    // Time field might be optional
    const timeInput = page.locator('#timeISO');
    if (await timeInput.isVisible()) {
      await timeInput.fill(TEST_EVENT.time);
    }

    await page.fill('#venue', TEST_EVENT.venue);

    // Summary field might be optional
    const summaryInput = page.locator('#summary');
    if (await summaryInput.isVisible()) {
      await summaryInput.fill(TEST_EVENT.summary);
    }

    // Click Create Event button
    const submitBtn = page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first();
    await submitBtn.click();

    // Wait for event creation to complete
    await page.waitForTimeout(3000);

    // Verify Seven-Card Shell (eventCard container) becomes visible
    await expect(page.locator(ADMIN_PAGE.EVENT_CARD_CONTAINER)).toBeVisible({ timeout: 15000 });

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });

  test('Card 1: Event Basics shows event confirmation', async () => {
    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify Card 1 is visible
    const card1 = page.locator(ADMIN_PAGE.CARD_1_EVENT_BASICS);
    await expect(card1).toBeVisible({ timeout: 15000 });

    // Verify card contains success indicator
    await expect(card1.locator('text=Your Event is Live')).toBeVisible();

    // Verify event info section exists
    await expect(page.locator(ADMIN_PAGE.EVENT_INFO)).toBeVisible();
  });

  test('Card 2: Sponsors card is visible with sponsor link generator', async () => {
    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify Card 2 is visible
    const card2 = page.locator(ADMIN_PAGE.CARD_2_SPONSORS);
    await expect(card2).toBeVisible({ timeout: 15000 });

    // Verify sponsor input and generate button exist
    await expect(page.locator(ADMIN_PAGE.CUSTOM_SPONSOR_ID_INPUT)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.GENERATE_SPONSOR_LINK_BUTTON)).toBeVisible();
  });

  test('Card 3: Sign-Up Forms card is visible', async () => {
    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify Card 3 is visible
    const card3 = page.locator(ADMIN_PAGE.CARD_3_SIGNUP);
    await expect(card3).toBeVisible({ timeout: 15000 });

    // Verify signup count display exists
    await expect(page.locator(ADMIN_PAGE.SIGNUP_COUNT)).toBeVisible();

    // Verify Configure Forms button exists
    await expect(page.locator(ADMIN_PAGE.CONFIGURE_SIGNUP_BUTTON)).toBeVisible();
  });

  test('Card 4: Poster Page card has link and QR preview', async () => {
    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify Card 4 is visible
    const card4 = page.locator(ADMIN_PAGE.CARD_4_POSTER);
    await expect(card4).toBeVisible({ timeout: 15000 });

    // Verify poster link element exists
    const posterLink = page.locator(ADMIN_PAGE.POSTER_LINK);
    await expect(posterLink).toBeVisible();

    // Verify link has href
    const href = await posterLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toContain('page=poster');

    // Verify action buttons
    await expect(page.locator(ADMIN_PAGE.COPY_POSTER_LINK_BUTTON)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.OPEN_POSTER_BUTTON)).toBeVisible();
  });

  test('Card 5: TV Display card has link and settings', async () => {
    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify Card 5 is visible
    const card5 = page.locator(ADMIN_PAGE.CARD_5_DISPLAY);
    await expect(card5).toBeVisible({ timeout: 15000 });

    // Verify display link element exists
    const displayLink = page.locator(ADMIN_PAGE.DISPLAY_LINK);
    await expect(displayLink).toBeVisible();

    // Verify link has href
    const href = await displayLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toContain('page=display');

    // Verify action buttons
    await expect(page.locator(ADMIN_PAGE.COPY_DISPLAY_LINK_BUTTON)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.OPEN_DISPLAY_BUTTON)).toBeVisible();
  });

  test('Card 6: Public Page card has link and QR preview', async () => {
    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify Card 6 is visible
    const card6 = page.locator(ADMIN_PAGE.CARD_6_PUBLIC);
    await expect(card6).toBeVisible({ timeout: 15000 });

    // Verify public link element exists
    const publicLink = page.locator(ADMIN_PAGE.PUBLIC_LINK);
    await expect(publicLink).toBeVisible();

    // Verify link has href
    const href = await publicLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toContain('page=public');

    // Verify action buttons
    await expect(page.locator(ADMIN_PAGE.COPY_PUBLIC_LINK_BUTTON)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.OPEN_PUBLIC_BUTTON)).toBeVisible();
  });

  test('Card 7: Shared Report card has link', async () => {
    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify Card 7 is visible
    const card7 = page.locator(ADMIN_PAGE.CARD_7_REPORT);
    await expect(card7).toBeVisible({ timeout: 15000 });

    // Verify report link element exists
    const reportLink = page.locator(ADMIN_PAGE.REPORT_LINK);
    await expect(reportLink).toBeVisible();

    // Verify link has href
    const href = await reportLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toContain('page=report');

    // Verify action buttons
    await expect(page.locator(ADMIN_PAGE.COPY_REPORT_LINK_BUTTON)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.VIEW_REPORT_BUTTON)).toBeVisible();
  });

  test('All 7 cards are visible after event creation', async () => {
    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', TEST_EVENT.name);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify all 7 cards are visible
    await expect(page.locator(ADMIN_PAGE.CARD_1_EVENT_BASICS)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(ADMIN_PAGE.CARD_2_SPONSORS)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.CARD_3_SIGNUP)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.CARD_4_POSTER)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.CARD_5_DISPLAY)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.CARD_6_PUBLIC)).toBeVisible();
    await expect(page.locator(ADMIN_PAGE.CARD_7_REPORT)).toBeVisible();

    // Also verify Create Another Event button
    await expect(page.locator(ADMIN_PAGE.CREATE_ANOTHER_BUTTON)).toBeVisible();

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('Admin to Surface Navigation Tests', () => {
  let createdEventId = null;

  test.beforeAll(async ({ browser }) => {
    // Create an event to use for navigation tests
    const page = await browser.newPage();

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt' && dialog.message().toLowerCase().includes('admin')) {
        await dialog.accept(ADMIN_KEY);
      } else if (dialog.type() === 'alert') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Navigation Test ${Date.now()}`);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Try to capture event ID
    const eventIdElement = page.locator('#eventIdDisplay, [data-event-id]').first();
    if (await eventIdElement.isVisible().catch(() => false)) {
      createdEventId = await eventIdElement.textContent();
    }

    await page.close();
  });

  test('Navigate from Admin to Public Page via Card 6 link', async ({ page }) => {
    // Set up dialog handler
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Public Nav Test ${Date.now()}`);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Get the public link href
    const publicLink = page.locator(ADMIN_PAGE.PUBLIC_LINK);
    await expect(publicLink).toBeVisible({ timeout: 15000 });
    const publicUrl = await publicLink.getAttribute('href');
    expect(publicUrl).toBeTruthy();

    // Navigate to Public page
    await page.goto(publicUrl, TIMEOUT_CONFIG);
    expect(page.url()).toContain('page=public');

    // Verify Public page loaded
    await expect(page.locator('main, .container, #app').first()).toBeVisible({ timeout: 15000 });
  });

  test('Navigate from Admin to Display Page via Card 5 link', async ({ page }) => {
    // Set up dialog handler
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Display Nav Test ${Date.now()}`);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Get the display link href
    const displayLink = page.locator(ADMIN_PAGE.DISPLAY_LINK);
    await expect(displayLink).toBeVisible({ timeout: 15000 });
    const displayUrl = await displayLink.getAttribute('href');
    expect(displayUrl).toBeTruthy();

    // Navigate to Display page
    await page.goto(displayUrl, TIMEOUT_CONFIG);
    expect(page.url()).toContain('page=display');

    // Verify Display page loaded
    await expect(page.locator('body, #stage, main').first()).toBeVisible({ timeout: 15000 });
  });

  test('Navigate from Admin to Poster Page via Card 4 link', async ({ page }) => {
    // Set up dialog handler
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Poster Nav Test ${Date.now()}`);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Get the poster link href
    const posterLink = page.locator(ADMIN_PAGE.POSTER_LINK);
    await expect(posterLink).toBeVisible({ timeout: 15000 });
    const posterUrl = await posterLink.getAttribute('href');
    expect(posterUrl).toBeTruthy();

    // Navigate to Poster page
    await page.goto(posterUrl, TIMEOUT_CONFIG);
    expect(page.url()).toContain('page=poster');

    // Verify Poster page loaded
    await expect(page.locator('main, .poster-container, body').first()).toBeVisible({ timeout: 15000 });
  });

  test('Navigate from Admin to SharedReport Page via Card 7 link', async ({ page }) => {
    // Set up dialog handler
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Report Nav Test ${Date.now()}`);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Get the report link href
    const reportLink = page.locator(ADMIN_PAGE.REPORT_LINK);
    await expect(reportLink).toBeVisible({ timeout: 15000 });
    const reportUrl = await reportLink.getAttribute('href');
    expect(reportUrl).toBeTruthy();

    // Navigate to SharedReport page
    await page.goto(reportUrl, TIMEOUT_CONFIG);
    expect(page.url()).toContain('page=report');

    // Verify SharedReport page loaded
    await expect(page.locator('main, .container, body').first()).toBeVisible({ timeout: 15000 });
  });

  test('All 4 surface links from Admin are reachable (Public, Display, Poster, Report)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Set up dialog handler
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Multi-Surface Test ${Date.now()}`);
    await page.fill('#startDateISO', TEST_EVENT.date);
    await page.fill('#venue', TEST_EVENT.venue);
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Collect all surface URLs
    const surfaces = [
      { name: 'Public', selector: ADMIN_PAGE.PUBLIC_LINK, pageParam: 'public' },
      { name: 'Display', selector: ADMIN_PAGE.DISPLAY_LINK, pageParam: 'display' },
      { name: 'Poster', selector: ADMIN_PAGE.POSTER_LINK, pageParam: 'poster' },
      { name: 'Report', selector: ADMIN_PAGE.REPORT_LINK, pageParam: 'report' },
    ];

    for (const surface of surfaces) {
      const link = page.locator(surface.selector);
      await expect(link).toBeVisible({ timeout: 10000 });
      const href = await link.getAttribute('href');
      expect(href, `${surface.name} link should have href`).toBeTruthy();
      expect(href, `${surface.name} link should contain page=${surface.pageParam}`).toContain(`page=${surface.pageParam}`);

      // Navigate to surface and verify it loads
      const response = await page.goto(href, TIMEOUT_CONFIG);
      expect(response.status(), `${surface.name} page should return 200`).toBe(200);

      // Verify page has content
      const bodyText = await page.locator('body').innerText();
      expect(bodyText.length, `${surface.name} page should have content`).toBeGreaterThan(0);

      // Navigate back to admin
      await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
      await page.fill('#name', `Multi-Surface Test ${Date.now()}`);
      await page.fill('#startDateISO', TEST_EVENT.date);
      await page.fill('#venue', TEST_EVENT.venue);
      await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
      await page.waitForTimeout(3000);
    }
  });
});
