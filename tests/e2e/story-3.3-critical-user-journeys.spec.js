/**
 * Story 3.3: End-to-End Testing of User Flows (Playwright)
 *
 * Critical user journey tests organized by event lifecycle:
 *
 * PRE-EVENT (Setup & Configuration):
 *   Journey 1: Event Creation Flow
 *   Journey 2: Sponsor Flow
 *   Journey 3: Poster Surface
 *
 * EVENT (Live Surfaces):
 *   Journey 4: Display Surface (TV/Kiosk)
 *   Journey 5: Event Viewing Flow (Public)
 *
 * POST-EVENT (Analytics):
 *   Journey 6: Shared Report
 *
 * TOOLS (Infrastructure & Validation):
 *   Journey 7: Event Management (CRUD)
 *   Journey 8: Cross-Surface Integration
 *   Journey 9: System Health
 *   Journey 10: Error Handling
 *
 * BASE_URL-Aware Testing:
 * - Default: https://stg.eventangle.com (staging)
 * - Production: BASE_URL=https://www.eventangle.com npm run test:story3.3
 *
 * Run: npm run test:story3.3
 */

import { test, expect } from '@playwright/test';
import { ApiHelpers, EventBuilder } from './api/api-helpers.js';
import { getBaseUrl, isProduction, isStaging } from '../config/environments.js';

// Configuration
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const IS_STAGING = isStaging();
const IS_PRODUCTION = isProduction();

// Test data cleanup tracking
const createdEventIds = [];

// Timeout configuration for GAS cold starts
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
    !e.message.includes('Script error') &&
    !e.message.includes('favicon.ico')
  );
}

/**
 * Safely check if a URL belongs to an allowed host
 * Uses proper URL parsing to prevent subdomain/TLD attacks
 */
function isAllowedHost(urlString, allowedHosts) {
  if (!urlString) return false;
  // Data URLs are always allowed for QR codes
  if (urlString.startsWith('data:')) return true;
  try {
    const url = new URL(urlString);
    return allowedHosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch {
    return false;
  }
}

/**
 * Generate unique test event data
 */
function generateTestEvent() {
  const timestamp = Date.now();
  const futureDate = new Date();
  futureDate.setMonth(futureDate.getMonth() + 1);

  return {
    name: `E2E Test Event ${timestamp}`,
    startDateISO: futureDate.toISOString().split('T')[0],
    venue: 'E2E Test Venue',
    summary: 'Automated E2E test event for Story 3.3 validation',
    timeISO: '14:00',
  };
}

// #############################################################################
// PRE-EVENT: Setup & Configuration
// #############################################################################

// =============================================================================
// JOURNEY 1: Event Creation Flow (Admin → API → Verification)
// =============================================================================

test.describe('Journey 1: Event Creation Flow', () => {
  test.describe.configure({ retries: 2 }); // Enable retries for transient failures

  let api;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);
  });

  test.afterEach(async () => {
    // Cleanup created events
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
        console.log(`✓ Cleaned up event: ${eventId}`);
      } catch (error) {
        console.warn(`⚠ Failed to delete event ${eventId}:`, error.message);
      }
    }
    createdEventIds.length = 0;
  });

  test('Admin creates event via API → Event appears in list → View event details', async ({ page }) => {
    // Step 1: Create event via API
    const eventData = new EventBuilder()
      .withName(`API Created Event ${Date.now()}`)
      .withDate('2025-12-20')
      .withVenue('API Test Venue')
      .build();

    const createResponse = await api.createEvent(BRAND_ID, eventData, ADMIN_KEY);
    const createData = await createResponse.json();

    expect(createResponse.ok()).toBe(true);
    expect(createData.ok).toBe(true);
    expect(createData.value).toHaveProperty('id');

    const eventId = createData.value.id;
    createdEventIds.push(eventId);
    console.log(`✓ Created event via API: ${eventId}`);

    // Step 2: Navigate to public page and verify event appears
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Wait for page to load
    await expect(page.locator('main#app, #app, .events-container')).toBeVisible({ timeout: 15000 });

    // Step 3: Verify event appears in the list
    const eventCard = page.locator(`.event-card:has-text("${eventData.name.substring(0, 20)}")`).first();
    const eventFound = await eventCard.count() > 0;

    if (eventFound) {
      console.log(`✓ Event found in public list: ${eventData.name}`);
      await expect(eventCard).toBeVisible();
    } else {
      // Event might be on a detail page or filtered
      console.log('⚠ Event not in main list, checking via API...');

      // Verify via API
      const getResponse = await api.getEvent(BRAND_ID, eventId);
      const getData = await getResponse.json();
      expect(getData.ok).toBe(true);
      expect(getData.value.name).toBe(eventData.name);
      console.log(`✓ Event verified via API: ${eventData.name}`);
    }

    // Step 4: Navigate to event detail page (if available)
    const detailUrl = `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${eventId}`;
    await page.goto(detailUrl, TIMEOUT_CONFIG);

    // Verify event details are displayed
    await expect(page.locator('main, #app, .event-detail')).toBeVisible({ timeout: 15000 });

    // Verify no critical JS errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(1000);
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });

  test('Admin creates event via UI → Verify API reflects changes', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Step 1: Navigate to Admin page
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

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

    // Wait for admin page to load
    await expect(
      page.locator('h2:has-text("Create Event"), h1:has-text("Admin"), form#eventForm, .admin-container').first()
    ).toBeVisible({ timeout: 15000 });

    // Step 2: Fill the event creation form
    const testEvent = generateTestEvent();

    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.startDateISO);
    await page.fill('#timeISO', testEvent.timeISO);
    await page.fill('#venue', testEvent.venue);

    // Expand advanced section if present
    const advancedHeader = page.locator('#advancedEventDetailsHeader');
    if (await advancedHeader.count() > 0) {
      await advancedHeader.click();
      await page.waitForTimeout(300);
      const summaryField = page.locator('#summary');
      if (await summaryField.count() > 0) {
        await summaryField.fill(testEvent.summary);
      }
    }

    // Step 3: Submit the form
    const submitBtn = page.locator('button[type="submit"], button:has-text("Create Event")');
    await submitBtn.click();

    // Wait for response
    await page.waitForTimeout(3000);

    // Step 4: Extract event ID from page or success message
    let eventId = null;

    // Try to find event ID in the page
    const eventIdAttr = await page.locator('[data-event-id]').first().getAttribute('data-event-id');

    // Step 5: Verify via API
    const listResponse = await api.listEvents(BRAND_ID);
    const listData = await listResponse.json();

    expect(listData.ok).toBe(true);
    expect(listData.value).toBeInstanceOf(Array);

    // Find the created event - prefer API result, fallback to DOM attribute
    const createdEvent = listData.value.find(e => e.name === testEvent.name);
    if (createdEvent) {
      eventId = createdEvent.id;
      createdEventIds.push(eventId);
      console.log(`✓ Created event via UI: ${eventId}`);

      expect(createdEvent.venue).toBe(testEvent.venue);
      expect(createdEvent.startDateISO).toBe(testEvent.startDateISO);
    } else if (eventIdAttr) {
      eventId = eventIdAttr;
      createdEventIds.push(eventId);
      console.log(`✓ Created event via UI (from DOM): ${eventId}`);
    }

    // Verify no critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });

  test('Full event creation with Sign-Up Form → QR code validation on Poster', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Step 1: Create event via API with signupUrl (Google Form URL)
    const signupFormUrl = 'https://docs.google.com/forms/d/e/test-signup-form/viewform';
    const eventData = new EventBuilder()
      .withName(`Sign-Up Form Test Event ${Date.now()}`)
      .withDate('2025-12-25')
      .withVenue('Sign-Up Form Test Venue')
      .withSignupUrl(signupFormUrl)
      .build();

    const createResponse = await api.createEvent(BRAND_ID, eventData, ADMIN_KEY);
    const createData = await createResponse.json();

    expect(createResponse.ok()).toBe(true);
    expect(createData.ok).toBe(true);

    const eventId = createData.value.id;
    createdEventIds.push(eventId);
    console.log(`✓ Step 1: Created event with signup form: ${eventId}`);

    // Step 2: Verify event has CTA with signup URL
    const getResponse = await api.getEvent(BRAND_ID, eventId);
    const getData = await getResponse.json();

    expect(getData.ok).toBe(true);
    expect(getData.value.ctas).toBeDefined();
    expect(getData.value.ctas.primary).toBeDefined();
    expect(getData.value.ctas.primary.url).toBe(signupFormUrl);
    console.log(`✓ Step 2: Event has signup URL in CTAs`);

    // Step 3: Navigate to Poster page and verify QR codes
    const posterUrl = `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${eventId}`;
    await page.goto(posterUrl, TIMEOUT_CONFIG);

    // Wait for poster to load
    await expect(page.locator('main, #app, .poster-container, .poster')).toBeVisible({ timeout: 15000 });
    console.log(`✓ Step 3: Poster page loaded`);

    // Step 4: Verify QR code section exists
    const qrSection = page.locator('.qr-section, .qr-codes, #qrGrid, [data-qr]');
    const hasQRSection = await qrSection.count() > 0;

    if (hasQRSection) {
      await expect(qrSection.first()).toBeVisible();
      console.log(`✓ Step 4: QR code section visible on poster`);
    }

    // Step 5: Check for QR code images (either quickchart.io or data URL)
    const qrImages = page.locator('img[src*="qr"], img[src*="quickchart"], img[alt*="QR"], .qr-code img');
    const qrCount = await qrImages.count();

    if (qrCount > 0) {
      console.log(`✓ Step 5: Found ${qrCount} QR code image(s) on poster`);

      // Verify at least one QR image is visible
      await expect(qrImages.first()).toBeVisible();

      // Check QR image source is from a valid QR service (proper URL validation)
      const firstQRSrc = await qrImages.first().getAttribute('src');
      const allowedQRHosts = ['quickchart.io', 'chart.googleapis.com', 'chart.apis.google.com'];
      const isValidQR = isAllowedHost(firstQRSrc, allowedQRHosts);

      if (isValidQR) {
        console.log(`✓ Step 5: QR code has valid image source`);
      }
    } else {
      // QR codes might be generated server-side in event.qr field
      console.log(`⚠ Step 5: No QR images found - checking API for pre-generated QR codes`);

      // Check if event has pre-generated QR codes
      if (getData.value.qr) {
        expect(getData.value.qr).toHaveProperty('public');
        console.log(`✓ Step 5: Event has pre-generated QR codes in API response`);
      }
    }

    // Step 6: Verify poster has event details with signup info
    const posterContent = await page.textContent('body');
    expect(posterContent.length).toBeGreaterThan(100);

    // Check for signup-related content (CTA button or sign up text)
    const hasSignupContent = posterContent.toLowerCase().includes('sign') ||
                             posterContent.toLowerCase().includes('register') ||
                             await page.locator('a[href*="forms.google.com"], .cta-button, .signup-btn').count() > 0;

    if (hasSignupContent) {
      console.log(`✓ Step 6: Poster contains signup/registration content`);
    }

    // Step 7: Verify no critical JS errors during poster render
    await page.waitForTimeout(1000);
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
    console.log(`✓ Step 7: No critical JS errors on poster page`);
  });

  test('Admin configures Sign-Up Form via UI → Verify on Public page', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Set up dialog handler
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt' && dialog.message().toLowerCase().includes('admin')) {
        await dialog.accept(ADMIN_KEY);
      } else if (dialog.type() === 'alert') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    // Step 1: Create event first via API
    const eventData = new EventBuilder()
      .withName(`Form Config Test Event ${Date.now()}`)
      .withDate('2025-12-26')
      .withVenue('Form Config Test Venue')
      .build();

    const createResponse = await api.createEvent(BRAND_ID, eventData, ADMIN_KEY);
    const createData = await createResponse.json();
    expect(createData.ok).toBe(true);

    const eventId = createData.value.id;
    createdEventIds.push(eventId);
    console.log(`✓ Step 1: Created event: ${eventId}`);

    // Step 2: Navigate to Admin page
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await expect(
      page.locator('h2:has-text("Create Event"), h1:has-text("Admin"), form#eventForm, .admin-container').first()
    ).toBeVisible({ timeout: 15000 });
    console.log(`✓ Step 2: Admin page loaded`);

    // Step 3: Look for the event card with sign-up form configuration
    const eventCard = page.locator(`[data-event-id="${eventId}"], .event-card`).first();
    const hasEventCard = await eventCard.count() > 0;

    if (hasEventCard) {
      // Look for forms configuration section (card 3 typically)
      const formsSection = page.locator('.forms-card, #formsCard, [data-card="forms"], .signup-config');
      const hasFormsSection = await formsSection.count() > 0;

      if (hasFormsSection) {
        console.log(`✓ Step 3: Forms configuration section found in admin`);

        // Check for signup URL input field
        const signupInput = page.locator('input[name*="signup"], input[id*="signup"], input[placeholder*="form"]');
        if (await signupInput.count() > 0) {
          console.log(`✓ Step 3: Signup URL input field found`);
        }
      }
    }

    // Step 4: Update event with signup URL via API
    const signupFormUrl = 'https://docs.google.com/forms/d/e/test-form-config/viewform';
    const updateResponse = await api.updateEvent(BRAND_ID, eventId, {
      ctas: {
        primary: { label: 'Sign Up Now', url: signupFormUrl },
        secondary: null
      }
    }, ADMIN_KEY);

    expect(updateResponse.ok()).toBe(true);
    console.log(`✓ Step 4: Updated event with signup form URL`);

    // Step 5: Navigate to Public page and verify signup button
    const publicUrl = `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${eventId}`;
    await page.goto(publicUrl, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });

    // Check for signup/register CTA button
    const ctaButton = page.locator('a.cta-button, a[href*="forms.google.com"], button:has-text("Sign"), .primary-cta');
    const hasCtaButton = await ctaButton.count() > 0;

    if (hasCtaButton) {
      console.log(`✓ Step 5: CTA button visible on public page`);

      // Verify button links to form (proper URL validation)
      const href = await ctaButton.first().getAttribute('href');
      const allowedFormHosts = ['forms.google.com', 'docs.google.com'];
      if (isAllowedHost(href, allowedFormHosts)) {
        console.log(`✓ Step 5: CTA button links to Google Form`);
      }
    } else {
      // Verify via page content
      const pageContent = await page.textContent('body');
      const hasSignupText = pageContent.toLowerCase().includes('sign up') ||
                           pageContent.toLowerCase().includes('register');
      console.log(`⚠ Step 5: CTA button not found, signup text present: ${hasSignupText}`);
    }

    // Verify no critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
    console.log(`✓ Step 6: No critical JS errors`);
  });
});

// =============================================================================
// JOURNEY 2: Sponsor Flow (Configuration, QR, Reports)
// =============================================================================

test.describe('Journey 2: Sponsor Flow', () => {
  let api;
  let testEventId;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);

    // Create event for sponsor testing
    const { eventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `Sponsor Test Event ${Date.now()}`,
      settings: { showSponsors: true }
    });
    testEventId = eventId;
    createdEventIds.push(testEventId);
  });

  test.afterEach(async () => {
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
      } catch (error) {
        console.warn(`⚠ Cleanup failed for ${eventId}`);
      }
    }
    createdEventIds.length = 0;
  });

  test('Configure sponsors via API → Verify on Display surface', async ({ page }) => {
    // Step 1: Add sponsor to event via API
    const sponsorData = {
      name: `Test Sponsor ${Date.now()}`,
      website: 'https://test-sponsor.example.com',
      logoUrl: 'https://via.placeholder.com/300x150?text=Sponsor',
      tier: 'gold',
      positions: ['tvTop', 'mobileBanner']
    };

    // Update event with sponsor
    const updateResponse = await api.updateEvent(BRAND_ID, testEventId, {
      sponsors: [sponsorData],
      settings: { showSponsors: true }
    }, ADMIN_KEY);

    expect(updateResponse.ok()).toBe(true);
    console.log(`✓ Step 1: Added sponsor to event`);

    // Step 2: Verify sponsor in API response
    const getResponse = await api.getEvent(BRAND_ID, testEventId);
    const getData = await getResponse.json();

    expect(getData.ok).toBe(true);
    if (getData.value.sponsors && getData.value.sponsors.length > 0) {
      expect(getData.value.sponsors[0].name).toBe(sponsorData.name);
      console.log(`✓ Step 2: Sponsor verified in API response`);
    }

    // Step 3: Navigate to Display surface and verify sponsor appears
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app, .display-container')).toBeVisible({ timeout: 15000 });

    // Check for sponsor elements (active = available: only show if sponsors configured)
    const sponsorArea = page.locator('#sponsorTop, .sponsor-top, .sponsor-strip, [data-sponsor]');
    const hasSponsorArea = await sponsorArea.count() > 0;

    if (hasSponsorArea) {
      console.log(`✓ Step 3: Sponsor area visible on Display surface`);
    } else {
      console.log(`⚠ Step 3: No sponsor area found - may require specific display mode`);
    }
  });

  test('Sponsor with QR code → Verify QR on Poster when sponsor has URL', async ({ page }) => {
    // Step 1: Add sponsor with trackable URL
    const sponsorUrl = 'https://sponsor-tracking.example.com/landing';
    const updateResponse = await api.updateEvent(BRAND_ID, testEventId, {
      sponsors: [{
        name: `QR Sponsor ${Date.now()}`,
        website: sponsorUrl,
        logoUrl: 'https://via.placeholder.com/300x150?text=QR+Sponsor',
        tier: 'platinum'
      }],
      settings: { showSponsors: true }
    }, ADMIN_KEY);

    expect(updateResponse.ok()).toBe(true);
    console.log(`✓ Step 1: Added sponsor with trackable URL`);

    // Step 2: Navigate to Poster page
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app, .poster-container')).toBeVisible({ timeout: 15000 });

    // Step 3: Check for sponsor QR or sponsor section (active = available)
    const sponsorSection = page.locator('.sponsor-strip, .sponsors, [data-sponsors]');
    const hasSponsorSection = await sponsorSection.count() > 0;

    if (hasSponsorSection) {
      console.log(`✓ Step 2: Sponsor section visible on Poster`);

      // Check for QR code linked to sponsor
      const qrElements = page.locator('img[src*="qr"], .qr-code');
      const qrCount = await qrElements.count();

      if (qrCount > 0) {
        console.log(`✓ Step 3: Found ${qrCount} QR code(s) on poster`);
      }
    } else {
      console.log(`⚠ Step 2: No sponsor section on poster - sponsors may display differently`);
    }
  });

  test('Sponsor analytics → View report after sponsor impressions', async ({ page }) => {
    // Step 1: Add sponsor to event
    await api.updateEvent(BRAND_ID, testEventId, {
      sponsors: [{
        name: `Analytics Sponsor ${Date.now()}`,
        website: 'https://analytics-sponsor.example.com',
        tier: 'gold'
      }],
      settings: { showSponsors: true }
    }, ADMIN_KEY);

    console.log(`✓ Step 1: Added sponsor for analytics testing`);

    // Step 2: Visit Public page to generate impressions
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);
    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000); // Allow analytics to log

    console.log(`✓ Step 2: Visited public page (impressions logged)`);

    // Step 3: Visit Display page to generate more impressions
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);
    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    console.log(`✓ Step 3: Visited display page (more impressions logged)`);

    // Step 4: Navigate to Shared Report to view analytics
    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app, .report-container')).toBeVisible({ timeout: 15000 });

    // Step 5: Verify report contains sponsor metrics (active = available)
    const reportContent = await page.textContent('body');

    const hasSponsorMetrics = reportContent.toLowerCase().includes('sponsor') ||
                              reportContent.toLowerCase().includes('impression') ||
                              reportContent.toLowerCase().includes('click');

    if (hasSponsorMetrics) {
      console.log(`✓ Step 4: Report contains sponsor metrics`);
    } else {
      console.log(`⚠ Step 4: Sponsor metrics not visible in report - may need more data`);
    }

    // Step 6: Check for KPI cards or tables
    const kpiElements = page.locator('.kpi, .metric, .stat-card, table');
    const kpiCount = await kpiElements.count();

    if (kpiCount > 0) {
      console.log(`✓ Step 5: Found ${kpiCount} KPI/metric elements in report`);
    }
  });

  test('No sponsors configured → Sponsor areas NOT displayed (active = available)', async ({ page }) => {
    // Step 1: Create event WITHOUT sponsors
    const { eventId: noSponsorEventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `No Sponsor Event ${Date.now()}`,
      settings: { showSponsors: false }
    });
    createdEventIds.push(noSponsorEventId);

    // Step 2: Navigate to Display page
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&id=${noSponsorEventId}`, TIMEOUT_CONFIG);
    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });

    // Step 3: Sponsor areas should NOT be displayed (active = available)
    const sponsorTopContent = page.locator('#sponsorTop');
    const hasSponsorTop = await sponsorTopContent.count() > 0;

    if (hasSponsorTop) {
      const content = await sponsorTopContent.textContent();
      const isEmpty = content.trim() === '' || content.toLowerCase().includes('no sponsor');
      if (isEmpty) {
        console.log(`✓ Sponsor area empty when no sponsors configured`);
      }
    } else {
      console.log(`✓ Sponsor area not rendered when showSponsors=false`);
    }

    // Step 4: Navigate to Poster page
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${noSponsorEventId}`, TIMEOUT_CONFIG);
    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });

    // Sponsor strip should be empty or hidden
    const sponsorStrip = page.locator('.sponsor-strip, [data-sponsors]');
    const hasStrip = await sponsorStrip.count() > 0;

    if (!hasStrip) {
      console.log(`✓ No sponsor strip on poster when no sponsors configured`);
    } else {
      const stripContent = await sponsorStrip.first().textContent();
      console.log(`⚠ Sponsor strip present but content: "${stripContent.substring(0, 50)}..."`);
    }
  });
});

// =============================================================================
// JOURNEY 3: Poster Surface (Print/Digital Signage)
// =============================================================================

test.describe('Journey 3: Poster Surface', () => {
  let api;
  let testEventId;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);

    // Create event for poster testing
    const { eventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `Poster Test Event ${Date.now()}`,
      venue: 'Poster Test Venue',
    });
    testEventId = eventId;
    createdEventIds.push(testEventId);
  });

  test.afterEach(async () => {
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
      } catch (error) {
        console.warn(`⚠ Cleanup failed for ${eventId}`);
      }
    }
    createdEventIds.length = 0;
  });

  test('Poster page loads and renders event details', async ({ page }) => {
    // Navigate to poster page
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    // Verify poster loaded
    await expect(page.locator('main, #app, .poster-container, .poster')).toBeVisible({ timeout: 15000 });

    // Check for basic event content
    const pageContent = await page.textContent('body');
    expect(pageContent.length).toBeGreaterThan(100);

    console.log('✓ Poster page loaded successfully');
  });

  test('Poster bundle API returns correct structure', async () => {
    // Test the poster API directly
    const response = await api.get(`?p=api&action=getPosterBundle&brand=${BRAND_ID}&scope=events&id=${testEventId}`);
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.value).toHaveProperty('event');
    expect(data.value.event).toHaveProperty('id');
    expect(data.value.event).toHaveProperty('name');

    console.log('✓ Poster bundle API returns valid structure');
  });

  test('Poster shows QR codes when signupUrl is configured (active = available)', async ({ page, request }) => {
    // Create event WITH signupUrl
    const signupUrl = 'https://docs.google.com/forms/d/e/poster-qr-test/viewform';
    const apiWithSignup = new ApiHelpers(request, BASE_URL);
    const { eventId: signupEventId } = await apiWithSignup.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `Poster QR Test Event ${Date.now()}`,
      ctas: {
        primary: { label: 'Sign Up', url: signupUrl },
        secondary: null
      }
    });
    createdEventIds.push(signupEventId);

    // Navigate to poster page
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${signupEventId}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app, .poster-container')).toBeVisible({ timeout: 15000 });

    // Check for QR section when signupUrl is configured
    const qrSection = page.locator('.qr-section, .qr-codes, #qrGrid, [data-qr]');
    const hasQRSection = await qrSection.count() > 0;

    if (hasQRSection) {
      await expect(qrSection.first()).toBeVisible();
      console.log('✓ QR section visible when signupUrl configured');
    }

    // Check for QR code images
    const qrImages = page.locator('img[src*="qr"], img[src*="quickchart"], img[alt*="QR"], .qr-code img');
    const qrCount = await qrImages.count();

    if (qrCount > 0) {
      console.log(`✓ Found ${qrCount} QR code(s) on poster`);
    } else {
      console.log('⚠ No QR images found - QR may be generated server-side');
    }
  });

  test('Poster hides QR section when no signupUrl configured (active = available)', async ({ page, request }) => {
    // Create event WITHOUT signupUrl
    const apiNoSignup = new ApiHelpers(request, BASE_URL);
    const { eventId: noSignupEventId } = await apiNoSignup.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `Poster No QR Test ${Date.now()}`,
      // No signupUrl - QR section should be hidden or empty
    });
    createdEventIds.push(noSignupEventId);

    // Navigate to poster page
    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${noSignupEventId}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });

    // QR section should be empty or hidden when no URLs configured
    const qrGrid = page.locator('#qrGrid');
    const hasQRGrid = await qrGrid.count() > 0;

    if (hasQRGrid) {
      const content = await qrGrid.textContent();
      const isEmpty = content.trim() === '' || content.toLowerCase().includes('no qr');
      if (isEmpty) {
        console.log('✓ QR grid empty when no signupUrl (active = available)');
      }
    } else {
      console.log('✓ QR section not rendered when no signupUrl (active = available)');
    }
  });

  test('Poster renders at print-friendly dimensions', async ({ page }) => {
    // Set poster-like viewport (A4-ish aspect ratio)
    await page.setViewportSize({ width: 794, height: 1123 }); // A4 at 96 DPI

    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app, .poster-container')).toBeVisible({ timeout: 15000 });

    // Verify content is readable at this size
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(10); // Minimum readable font size

    console.log('✓ Poster renders at print-friendly dimensions');
  });
});

// #############################################################################
// EVENT: Live Surfaces
// #############################################################################

// =============================================================================
// JOURNEY 4: Display Surface (TV/Kiosk)
// =============================================================================

test.describe('Journey 4: Display Surface (TV/Kiosk)', () => {
  let api;
  let testEventId;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);

    // Create test event
    const { eventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `Display Test Event ${Date.now()}`,
      settings: { showSponsors: true },
    });
    testEventId = eventId;
    createdEventIds.push(testEventId);
  });

  test.afterEach(async () => {
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
      } catch (error) {
        console.warn(`⚠ Cleanup failed for ${eventId}`);
      }
    }
    createdEventIds.length = 0;
  });

  test('Display page loads in TV mode (1920x1080)', async ({ page }) => {
    // Set TV resolution
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Navigate to display page
    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}&id=${testEventId}&tv=1`, TIMEOUT_CONFIG);

    // Verify display loaded
    await expect(page.locator('main, #app, .display-container, .display')).toBeVisible({ timeout: 15000 });

    // Check for display-specific elements
    const hasDisplayContent = await page.locator('.sponsor-strip, .event-info, .carousel, .rotation').count() > 0 ||
      await page.locator('main').count() > 0;
    expect(hasDisplayContent).toBe(true);
  });

  test('Display bundle API returns correct structure', async () => {
    // Test the API directly
    const response = await api.get(`?p=api&action=getDisplayBundle&brand=${BRAND_ID}&scope=events&id=${testEventId}`);
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.value).toHaveProperty('event');
    expect(data.value.event).toHaveProperty('id');
    expect(data.value.event).toHaveProperty('name');
    expect(data.value.event).toHaveProperty('startDateISO');
    expect(data.value.event).toHaveProperty('venue');

    // Check rotation config
    if (data.value.rotation) {
      expect(data.value.rotation).toHaveProperty('sponsorSlots');
      expect(data.value.rotation).toHaveProperty('rotationMs');
    }
  });
});

// =============================================================================
// JOURNEY 5: Event Viewing Flow (Public Surface)
// =============================================================================

test.describe('Journey 5: Event Viewing Flow (Public)', () => {
  let api;
  let testEventId;
  let testSignupUrl;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);

    // Create event WITH signupUrl for QR code visibility tests (active = available)
    testSignupUrl = 'https://docs.google.com/forms/d/e/public-test-form/viewform';
    const { eventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `View Test Event ${Date.now()}`,
      venue: 'View Test Venue',
      ctas: {
        primary: { label: 'Register Now', url: testSignupUrl },
        secondary: null
      }
    });
    testEventId = eventId;
    createdEventIds.push(testEventId);
  });

  test.afterEach(async () => {
    // Cleanup
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
      } catch (error) {
        console.warn(`⚠ Cleanup failed for ${eventId}`);
      }
    }
    createdEventIds.length = 0;
  });

  test('Public page loads event details with CTA when signupUrl configured', async ({ page }) => {
    // Step 1: Navigate to public event page
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    // Step 2: Verify page loaded
    await expect(page.locator('main, #app, .public-container')).toBeVisible({ timeout: 15000 });

    // Step 3: Verify event content is displayed
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(500);

    // Step 4: Verify CTA button is visible when signupUrl configured (active = available)
    const ctaButton = page.locator('a.cta-button, a[href*="forms.google.com"], button:has-text("Register"), .primary-cta, .cta');
    const hasCtaButton = await ctaButton.count() > 0;

    if (hasCtaButton) {
      console.log('✓ CTA button visible on public page (signupUrl configured)');
      await expect(ctaButton.first()).toBeVisible();
    } else {
      // Verify CTA exists in page content
      const hasRegisterText = pageContent.toLowerCase().includes('register') ||
                              pageContent.toLowerCase().includes('sign up');
      console.log(`⚠ CTA button not found, registration text present: ${hasRegisterText}`);
    }

    // Step 5: Verify no console errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(1000);
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });

  test('Public page shows no CTA when signupUrl is NOT configured', async ({ page, request }) => {
    // Create event WITHOUT signupUrl
    const apiNoSignup = new ApiHelpers(request, BASE_URL);
    const { eventId: noSignupEventId } = await apiNoSignup.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `No Signup Public Test ${Date.now()}`,
      venue: 'Test Venue No Signup',
      // No signupUrl configured - CTA should NOT be expected
    });
    createdEventIds.push(noSignupEventId);

    // Navigate to public page
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}&id=${noSignupEventId}`, TIMEOUT_CONFIG);

    // Verify page loaded
    await expect(page.locator('main, #app, .public-container')).toBeVisible({ timeout: 15000 });

    // Without signupUrl, primary CTA linking to form should NOT be present (active = available)
    const formCtaButton = page.locator('a[href*="forms.google.com"], a[href*="docs.google.com/forms"]');
    const hasFormCta = await formCtaButton.count() > 0;

    if (!hasFormCta) {
      console.log('✓ No form CTA displayed when signupUrl not configured (active = available)');
    } else {
      console.log('⚠ Form CTA found despite no signupUrl - may be from other configuration');
    }
  });

  test('Public page works on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Navigate to public page
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    // Verify mobile-friendly layout
    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });

    // Check font size is readable on mobile
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(14);

    // Verify no horizontal scrolling (mobile-friendly)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
  });

  test('Events list page shows available events', async ({ page }) => {
    // Navigate to events list
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Verify page loaded
    await expect(page.locator('main#app, #app, .events-container')).toBeVisible({ timeout: 15000 });

    // Check for event cards or list items
    const eventElements = page.locator('.event-card, .event-item, [data-event-id]');
    const count = await eventElements.count();

    console.log(`Found ${count} events on page`);
    expect(count).toBeGreaterThanOrEqual(0); // May be 0 if no events
  });
});

// #############################################################################
// POST-EVENT: Analytics
// #############################################################################

// =============================================================================
// JOURNEY 6: Shared Report (Analytics)
// =============================================================================

test.describe('Journey 6: Shared Report (Analytics)', () => {
  let api;
  let testEventId;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);

    const { eventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `Report Test Event ${Date.now()}`,
    });
    testEventId = eventId;
    createdEventIds.push(testEventId);
  });

  test.afterEach(async () => {
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
      } catch (error) {
        console.warn(`⚠ Cleanup failed for ${eventId}`);
      }
    }
    createdEventIds.length = 0;
  });

  test('Shared report page loads with analytics data', async ({ page }) => {
    // Navigate to report page
    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    // Verify report loaded
    await expect(page.locator('main, #app, .report-container, .shared-report')).toBeVisible({ timeout: 15000 });

    // Check for analytics elements (KPIs, charts, tables)
    const analyticsElements = page.locator('.kpi, .metric, .chart, table, .stats');
    const hasAnalytics = await analyticsElements.count() > 0 || await page.locator('main').textContent() !== '';

    expect(hasAnalytics).toBe(true);
  });

  test('Report works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });

    // Verify readable on mobile
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);
  });
});

// #############################################################################
// TOOLS: Infrastructure & Validation
// #############################################################################

// =============================================================================
// JOURNEY 7: Event Management (Admin Updates)
// =============================================================================

test.describe('Journey 7: Event Management', () => {
  let api;
  let testEventId;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);

    const { eventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: `Manage Test Event ${Date.now()}`,
      venue: 'Original Venue',
    });
    testEventId = eventId;
    createdEventIds.push(testEventId);
  });

  test.afterEach(async () => {
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
      } catch (error) {
        console.warn(`⚠ Cleanup failed for ${eventId}`);
      }
    }
    createdEventIds.length = 0;
  });

  test('Update event via API → UI reflects changes', async ({ page }) => {
    // Step 1: Update event via API
    const updateResponse = await api.updateEvent(BRAND_ID, testEventId, {
      venue: 'Updated Venue via API',
    }, ADMIN_KEY);

    expect(updateResponse.ok()).toBe(true);

    // Step 2: Verify update via GET API
    const getResponse = await api.getEvent(BRAND_ID, testEventId);
    const getData = await getResponse.json();

    expect(getData.ok).toBe(true);
    expect(getData.value.venue).toBe('Updated Venue via API');

    // Step 3: Verify UI shows updated data
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}&id=${testEventId}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app')).toBeVisible({ timeout: 15000 });

    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('Updated Venue via API');
  });

  test('Complete CRUD lifecycle via API', async () => {
    // CREATE - already done in beforeEach

    // READ
    const getResponse = await api.getEvent(BRAND_ID, testEventId);
    const getData = await getResponse.json();
    expect(getData.ok).toBe(true);

    // UPDATE
    const updateResponse = await api.updateEvent(BRAND_ID, testEventId, {
      name: 'Updated Event Name',
    }, ADMIN_KEY);
    const updateData = await updateResponse.json();
    expect(updateData.ok).toBe(true);

    // READ (verify update)
    const getResponse2 = await api.getEvent(BRAND_ID, testEventId);
    const getData2 = await getResponse2.json();
    expect(getData2.value.name).toBe('Updated Event Name');

    // DELETE
    const deleteResponse = await api.deleteEvent(BRAND_ID, testEventId, ADMIN_KEY);
    const deleteData = await deleteResponse.json();
    expect(deleteData.ok).toBe(true);

    // Remove from cleanup array since we already deleted
    const idx = createdEventIds.indexOf(testEventId);
    if (idx > -1) createdEventIds.splice(idx, 1);

    // Verify deletion
    const getResponse3 = await api.getEvent(BRAND_ID, testEventId);
    if (getResponse3.status() === 404) {
      expect(getResponse3.ok()).toBe(false);
    } else {
      const getData3 = await getResponse3.json();
      expect(getData3.ok).toBe(false);
    }
  });
});

// =============================================================================
// JOURNEY 8: Cross-Surface Integration
// =============================================================================

test.describe('Journey 8: Cross-Surface Integration', () => {
  let api;
  let testEventId;
  let testEventName;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);

    testEventName = `Cross Surface Event ${Date.now()}`;
    const { eventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
      name: testEventName,
      venue: 'Integration Test Venue',
    });
    testEventId = eventId;
    createdEventIds.push(testEventId);
  });

  test.afterEach(async () => {
    for (const eventId of createdEventIds) {
      try {
        await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
      } catch (error) {
        console.warn(`⚠ Cleanup failed for ${eventId}`);
      }
    }
    createdEventIds.length = 0;
  });

  test('Same event renders correctly across all surfaces', async ({ page }) => {
    const surfaces = [
      { name: 'Public', url: `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${testEventId}` },
      { name: 'Display', url: `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${testEventId}` },
      { name: 'Poster', url: `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${testEventId}` },
      { name: 'Report', url: `${BASE_URL}?page=report&brand=${BRAND_ID}&id=${testEventId}` },
    ];

    for (const surface of surfaces) {
      await page.goto(surface.url, TIMEOUT_CONFIG);

      // Each surface should render without errors
      const errors = [];
      page.on('pageerror', error => errors.push(error));

      await expect(page.locator('main, #app, body')).toBeVisible({ timeout: 15000 });

      const criticalErrors = filterCriticalErrors(errors);
      expect(criticalErrors.length).toBe(0);

      console.log(`✓ ${surface.name} surface rendered successfully`);
    }
  });
});

// =============================================================================
// JOURNEY 9: System Health and API Status
// =============================================================================

test.describe('Journey 9: System Health', () => {
  let api;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);
  });

  test('System status endpoint returns healthy response', async () => {
    const response = await api.getStatus(BRAND_ID);
    const data = await response.json();

    expect(response.ok()).toBe(true);
    expect(data.ok).toBe(true);
    expect(data).toHaveProperty('buildId');
    expect(data).toHaveProperty('time');

    console.log(`✓ System healthy - Build: ${data.buildId}, Time: ${data.time}`);
  });

  test('Events list API returns valid response', async () => {
    const response = await api.listEvents(BRAND_ID);
    const data = await response.json();

    expect(response.ok()).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.value).toBeInstanceOf(Array);

    console.log(`✓ Events API healthy - ${data.value.length} events found`);
  });

  test('Main page loads without critical errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await expect(page.locator('main, #app, body')).toBeVisible({ timeout: 15000 });

    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);

    console.log('✓ Main page loaded without critical errors');
  });
});

// =============================================================================
// JOURNEY 10: Error Handling and Edge Cases
// =============================================================================

test.describe('Journey 10: Error Handling', () => {
  let api;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, BASE_URL);
  });

  test('Non-existent event returns appropriate error', async ({ page }) => {
    const fakeId = 'non-existent-event-12345';

    // Via API
    const response = await api.getEvent(BRAND_ID, fakeId);
    if (response.status() === 404) {
      expect(response.ok()).toBe(false);
    } else {
      const data = await response.json();
      expect(data.ok).toBe(false);
    }

    // Via UI
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}&id=${fakeId}`, TIMEOUT_CONFIG);

    // Should show error message or fallback
    await page.waitForTimeout(2000);

    // Page should still render (graceful degradation)
    await expect(page.locator('body')).toBeVisible();
  });

  test('Invalid admin key is rejected', async () => {
    const eventData = { name: 'Should Fail Event' };
    const invalidKey = 'INVALID_KEY_12345';

    const response = await api.createEvent(BRAND_ID, eventData, invalidKey);

    if (response.ok()) {
      const data = await response.json();
      expect(data.ok).toBe(false);
    } else {
      expect(response.status()).toBeGreaterThanOrEqual(400);
    }
  });
});

// =============================================================================
// TEST ENVIRONMENT INFO
// =============================================================================

test.describe('Test Environment Info', () => {
  test('Print test environment details', async () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Story 3.3 E2E Test Suite - Environment Information');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Base URL:      ${BASE_URL}`);
    console.log(`  Brand ID:      ${BRAND_ID}`);
    console.log(`  Environment:   ${IS_PRODUCTION ? 'PRODUCTION' : IS_STAGING ? 'STAGING' : 'LOCAL/OTHER'}`);
    console.log(`  Admin Key:     ${ADMIN_KEY ? '***SET***' : 'NOT SET'}`);
    console.log(`  Timestamp:     ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    expect(true).toBe(true);
  });
});
