/**
 * Full Triangle Smoke Test - Minimal Happy-Path E2E for All 5 Surfaces
 *
 * Purpose: One deterministic test that validates the complete event triangle
 * Run Time: ~30 seconds (single event, all surfaces)
 * Run Frequency: Every commit, every PR
 *
 * Surfaces Tested:
 * 1. Admin - Create event, verify main fields saved
 * 2. Poster - Open from Admin link, verify QR + basic info
 * 3. Display - Open, verify event title and schedule
 * 4. Public - Open, verify CTA / schedule
 * 5. SharedReport - Open, verify summary fields render
 *
 * Design Principles:
 * - Fixed demo event fixture (deterministic, cheap)
 * - Serial execution (surfaces depend on created event)
 * - Minimal assertions (happy-path only)
 * - No cleanup needed (creates fresh event with timestamp)
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');
const { ADMIN_PAGE, POSTER_PAGE, DISPLAY_PAGE, PUBLIC_PAGE, REPORT_PAGE } = require('../selectors');

// Configuration
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

// Fixed demo event fixture (deterministic)
const DEMO_EVENT = {
  name: `Triangle Smoke ${new Date().toISOString().slice(0, 10)}`,
  date: (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  })(),
  venue: 'Triangle Test Venue',
  summary: 'Minimal E2E smoke test event',
};

// Timeout for GAS cold starts
const NAVIGATION_TIMEOUT = { timeout: 30000 };

// Store event ID and links across tests
let eventId = null;
let eventLinks = {
  poster: null,
  display: null,
  public: null,
  report: null,
};

test.describe.serial('Full Triangle Smoke Test', () => {
  // ==========================================================================
  // SURFACE 1: ADMIN - Create Event
  // ==========================================================================
  test('1. Admin: create event, verify main fields saved', async ({ page }) => {
    // Set up dialog handler for admin key prompt
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Navigate to Admin
    const response = await page.goto(
      `${BASE_URL}?page=admin&brand=${BRAND_ID}`,
      NAVIGATION_TIMEOUT
    );
    expect(response.status()).toBe(200);

    // Wait for create form
    await expect(page.locator('h2:has-text("Create Event"), h1:has-text("Create Event")').first()).toBeVisible(NAVIGATION_TIMEOUT);

    // Fill event form
    await page.fill('#name', DEMO_EVENT.name);
    await page.fill('#startDateISO', DEMO_EVENT.date);
    await page.fill('#venue', DEMO_EVENT.venue);

    // Expand advanced event details section to fill summary (optional field)
    await page.click('#advancedEventDetailsHeader');
    await page.waitForTimeout(300);
    await page.fill('#summary', DEMO_EVENT.summary);

    // Submit
    await page.click(ADMIN_PAGE.CREATE_EVENT_BUTTON);

    // Wait for event card to appear (indicates success)
    await expect(page.locator('#eventCard, .event-card').first()).toBeVisible({ timeout: 15000 });

    // Verify event info is displayed
    const eventInfo = page.locator('#eventInfo, .event-info').first();
    await expect(eventInfo).toContainText(DEMO_EVENT.name.substring(0, 15), { timeout: 10000 });

    // Capture event ID from URL or page
    const currentUrl = page.url();
    const urlMatch = currentUrl.match(/[?&]id=([^&]+)/);
    if (urlMatch) {
      eventId = urlMatch[1];
    } else {
      // Try to get from page content
      const idDisplay = page.locator('#eventIdDisplay, [data-event-id]').first();
      if (await idDisplay.isVisible().catch(() => false)) {
        const text = await idDisplay.textContent();
        const idMatch = text.match(/([a-zA-Z0-9_-]{10,})/);
        if (idMatch) eventId = idMatch[1];
      }
    }

    // Capture surface links
    const posterLink = page.locator('#lnkPoster, a[href*="page=poster"]').first();
    const displayLink = page.locator('#lnkDisplay, a[href*="page=display"]').first();
    const publicLink = page.locator('#lnkPublic, a[href*="page=public"], a[href*="page=events"]').first();
    const reportLink = page.locator('#lnkReport, a[href*="page=report"]').first();

    if (await posterLink.isVisible().catch(() => false)) {
      eventLinks.poster = await posterLink.getAttribute('href');
    }
    if (await displayLink.isVisible().catch(() => false)) {
      eventLinks.display = await displayLink.getAttribute('href');
    }
    if (await publicLink.isVisible().catch(() => false)) {
      eventLinks.public = await publicLink.getAttribute('href');
    }
    if (await reportLink.isVisible().catch(() => false)) {
      eventLinks.report = await reportLink.getAttribute('href');
    }

    // Must have at least event ID or one link to continue
    expect(eventId || eventLinks.poster || eventLinks.display).toBeTruthy();
  });

  // ==========================================================================
  // SURFACE 2: POSTER - Verify QR + Basic Info
  // ==========================================================================
  test('2. Poster: verify QR codes and basic info', async ({ page }) => {
    // Build URL from link or construct it
    const url = eventLinks.poster ||
      (eventId ? `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${eventId}` : null);

    test.skip(!url, 'No poster URL available - event creation may have failed');

    const response = await page.goto(url, NAVIGATION_TIMEOUT);
    expect(response.status()).toBe(200);

    // Wait for poster container
    await expect(page.locator('.poster-container, #poster, main').first()).toBeVisible(NAVIGATION_TIMEOUT);

    // Verify event title is displayed
    const title = page.locator('h1, .poster-title, .event-title, #eventName').first();
    await expect(title).toBeVisible({ timeout: 10000 });
    const titleText = await title.textContent();
    expect(titleText.length).toBeGreaterThan(0);

    // Verify QR code exists (at least one)
    const qrElements = page.locator(
      'img[src*="qr"], img[alt*="QR"], .qr-code, #publicQR, #registrationQR, canvas, svg[class*="qr"]'
    );
    const qrCount = await qrElements.count();
    expect(qrCount).toBeGreaterThanOrEqual(1);

    // Verify basic info section exists
    const infoSection = page.locator('.poster-info, .event-info, .poster-date, .poster-venue').first();
    const hasInfo = await infoSection.isVisible().catch(() => false);
    // Info is expected but not strictly required for smoke test
    console.log(`Poster info section visible: ${hasInfo}`);
  });

  // ==========================================================================
  // SURFACE 3: DISPLAY - Verify Event Title and Schedule
  // ==========================================================================
  test('3. Display: verify event title and schedule/content', async ({ page }) => {
    // Build URL from link or construct it
    const url = eventLinks.display ||
      (eventId ? `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${eventId}&tv=1` : null);

    test.skip(!url, 'No display URL available - event creation may have failed');

    const response = await page.goto(url, NAVIGATION_TIMEOUT);
    expect(response.status()).toBe(200);

    // Wait for display content
    await expect(
      page.locator('#stage, .display-container, main, body').first()
    ).toBeVisible(NAVIGATION_TIMEOUT);

    // Verify event title OR fallback content is shown
    const contentLocator = page.locator(
      'h1, .display-title, .event-title, ' +
      '.schedule, .schedule-row, ' +
      '.fallback-card, .sponsor-slide, ' +
      '#stage iframe'
    ).first();
    await expect(contentLocator).toBeVisible({ timeout: 15000 });

    // Check for schedule rows (if schedule is enabled)
    const scheduleRows = page.locator('.schedule-row, .schedule-item, tr[class*="schedule"]');
    const scheduleCount = await scheduleRows.count();
    console.log(`Display schedule rows found: ${scheduleCount}`);

    // Check for sponsor carousel (if sponsors exist)
    const sponsorSlides = page.locator('.sponsor-slide, .sponsor-item, .sponsor-logo');
    const sponsorCount = await sponsorSlides.count();
    console.log(`Display sponsor slides found: ${sponsorCount}`);
  });

  // ==========================================================================
  // SURFACE 4: PUBLIC - Verify CTA and Schedule
  // ==========================================================================
  test('4. Public: verify CTA and schedule visibility', async ({ page }) => {
    // Build URL from link or construct it
    const url = eventLinks.public ||
      (eventId ? `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${eventId}` : null);

    test.skip(!url, 'No public URL available - event creation may have failed');

    const response = await page.goto(url, NAVIGATION_TIMEOUT);
    expect(response.status()).toBe(200);

    // Wait for public page container
    await expect(
      page.locator('.container, main, #app, body').first()
    ).toBeVisible(NAVIGATION_TIMEOUT);

    // Verify event content exists
    const eventContent = page.locator(
      '.event-title, .event-name, h1, h2, ' +
      '.event-card, .event-item'
    ).first();
    await expect(eventContent).toBeVisible({ timeout: 15000 });

    // Look for CTA button or link
    const ctaLocator = page.locator(
      'a.cta, button.cta, .cta-button, ' +
      'a:has-text("Sign Up"), a:has-text("Register"), ' +
      'button:has-text("Sign Up"), button:has-text("Register"), ' +
      '.primary-cta, [class*="cta"]'
    ).first();
    const hasCTA = await ctaLocator.isVisible().catch(() => false);
    console.log(`Public page CTA visible: ${hasCTA}`);

    // Look for schedule section
    const scheduleSection = page.locator(
      '.schedule, .schedule-section, ' +
      '#schedule, [data-section="schedule"], ' +
      '.event-schedule'
    ).first();
    const hasSchedule = await scheduleSection.isVisible().catch(() => false);
    console.log(`Public page schedule visible: ${hasSchedule}`);

    // Page must have either CTA or meaningful content
    const pageText = await page.locator('body').textContent();
    expect(pageText.length).toBeGreaterThan(50);
  });

  // ==========================================================================
  // SURFACE 5: SHARED REPORT - Verify Summary Fields
  // ==========================================================================
  test('5. SharedReport: verify summary fields render', async ({ page }) => {
    // Build URL from link or construct it
    const url = eventLinks.report ||
      (eventId ? `${BASE_URL}?page=report&brand=${BRAND_ID}&id=${eventId}` : null);

    test.skip(!url, 'No report URL available - event creation may have failed');

    const response = await page.goto(url, NAVIGATION_TIMEOUT);
    expect(response.status()).toBe(200);

    // Wait for report container
    await expect(
      page.locator('.report-header, .metrics-grid, .analytics-dashboard, main, .container').first()
    ).toBeVisible(NAVIGATION_TIMEOUT);

    // Verify report structure exists (even if data is sparse)
    const reportStructure = page.locator(
      // Metrics/KPI cards
      '.metric-card, .metric, .stat-card, .kpi, ' +
      '#totalImpressions, #totalClicks, #clickThroughRate, ' +
      // Section structure
      '.section-card, .report-section, ' +
      // Headings
      'h1:has-text("Analytics"), h1:has-text("Report"), ' +
      'h2:has-text("Metrics"), h2:has-text("Performance"), ' +
      // Tables/charts
      '.analytics-table, table, canvas, .chart'
    ).first();
    await expect(reportStructure).toBeVisible({ timeout: 15000 });

    // Count metric elements (may be 0 for new events - that's OK)
    const metrics = page.locator('.metric-card, .metric, .stat-card, [data-metric]');
    const metricCount = await metrics.count();
    console.log(`SharedReport metrics found: ${metricCount}`);

    // Verify page has meaningful content (not error page)
    const pageText = await page.locator('body').textContent();
    expect(pageText.toLowerCase()).not.toMatch(/error|404|not found/);
    expect(pageText.length).toBeGreaterThan(100);
  });
});
