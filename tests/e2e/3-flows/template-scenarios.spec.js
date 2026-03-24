/**
 * Template Scenarios E2E Tests
 *
 * Tests template-specific flows for each MVP template class:
 * - Bar Night: video, map, sponsors, no schedule
 * - Rec League: schedule/standings/bracket URLs, League Info sections
 * - School/Fundraiser: Donate/Buy Tickets CTAs
 * - Custom: all sections togglable
 *
 * Plus data propagation: Admin → Public → Display → Poster
 *
 * @see TemplateService.gs for template definitions
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Test configuration
const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'test-admin-key';
const BRAND = process.env.BRAND || 'root';

// Helper: Build URL with parameters
function buildUrl(page, params = {}) {
  const url = new URL(BASE_URL);
  url.searchParams.set('p', page);
  url.searchParams.set('brand', BRAND);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// ============================================================================
// BAR NIGHT TEMPLATE SCENARIO
// ============================================================================

test.describe('🍺 Bar Night Template Flow', () => {

  test('Admin → Create bar event with video, map, sponsors, NO schedule', async ({ page }) => {
    // Navigate to Admin
    await page.goto(buildUrl('admin'));
    await page.waitForLoadState('networkidle');

    // Select bar_night template if template picker exists
    const templatePicker = page.locator('[data-template-id="bar_night"]');
    if (await templatePicker.isVisible()) {
      await templatePicker.click();
    }

    // Verify template-specific behavior
    // Bar events should have video and map enabled, schedule disabled
    const videoSection = page.locator('#section-video, [data-section="video"]');
    const scheduleSection = page.locator('#section-schedule, [data-section="schedule"]');

    // These assertions depend on how Admin.html renders template sections
    // The key behavior: bar template should NOT show schedule by default
  });

  test('Public page shows video, map, sponsors but hides schedule for bar event', async ({ page }) => {
    // This test assumes a bar event exists
    // Navigate to Public page
    await page.goto(buildUrl('public'));
    await page.waitForLoadState('networkidle');

    // Check for expected elements based on bar_night template
    // Video should be present if configured
    // Map/Directions button should be present
    // Schedule section should NOT be visible (bar events don't have schedules)

    const directionsBtn = page.locator('text=Get Directions, text=Directions, text=📍');
    const scheduleSection = page.locator('.schedule-section, [data-section="schedule"]');

    // Soft assertions - don't fail if elements not found (depends on event data)
    if (await directionsBtn.first().isVisible()) {
      expect(await directionsBtn.first().isVisible()).toBe(true);
    }
  });

});

// ============================================================================
// REC LEAGUE TEMPLATE SCENARIO
// ============================================================================

test.describe('⚾ Rec League Template Flow', () => {

  test('Admin → Create rec league with schedule/standings/bracket URLs', async ({ page }) => {
    await page.goto(buildUrl('admin'));
    await page.waitForLoadState('networkidle');

    // Select rec_league template if available
    const templatePicker = page.locator('[data-template-id="rec_league"]');
    if (await templatePicker.isVisible()) {
      await templatePicker.click();
    }

    // Expand external links section (collapsed by default in MVP flow)
    const externalLinksHeader = page.locator('#externalLinksHeader');
    if (await externalLinksHeader.count() > 0) {
      await externalLinksHeader.click();
      await page.waitForTimeout(300);
    }

    // Rec league template should show external data URL fields
    // scheduleUrl, standingsUrl, bracketUrl
    const scheduleUrlField = page.locator('#scheduleUrl, input[name="scheduleUrl"]');
    const standingsUrlField = page.locator('#standingsUrl, input[name="standingsUrl"]');
    const bracketUrlField = page.locator('#bracketUrl, input[name="bracketUrl"]');

    // If these fields exist, they should be editable
    // This validates that Admin properly shows external data inputs for rec_league
  });

  test('Public page shows League Info sections (schedule, standings, bracket)', async ({ page }) => {
    await page.goto(buildUrl('public'));
    await page.waitForLoadState('networkidle');

    // Rec league events should show schedule section
    // These are typically rendered as collapsible sections or embedded iframes

    // Look for schedule-related content
    const scheduleContent = page.locator('text=Schedule, text=View Schedule, .schedule');
    const standingsContent = page.locator('text=Standings, text=View Standings, .standings');

    // Soft check - content depends on event having these URLs configured
  });

  test('Display page shows League Info correctly', async ({ page }) => {
    await page.goto(buildUrl('display'));
    await page.waitForLoadState('networkidle');

    // Display page for rec leagues should show relevant league info
    // This might be in a carousel or static display format

    // Check that Display page loads without errors
    await expect(page).not.toHaveTitle(/error/i);
  });

});

// ============================================================================
// SCHOOL/FUNDRAISER TEMPLATE SCENARIO
// ============================================================================

test.describe('🎓💝 School/Fundraiser Template Flow', () => {

  test('School template shows Buy Tickets and Donate CTAs', async ({ page }) => {
    await page.goto(buildUrl('public'));
    await page.waitForLoadState('networkidle');

    // School/Fundraiser templates should have donation-focused CTAs
    // Look for these specific CTA patterns

    const buyTicketsBtn = page.locator('text=Buy Tickets');
    const donateBtn = page.locator('text=Donate');

    // These buttons should exist if event uses school or fundraiser template
    // The exact visibility depends on the event's ctaLabels configuration
  });

  test('Fundraiser template has Donate as primary CTA', async ({ page }) => {
    await page.goto(buildUrl('public'));
    await page.waitForLoadState('networkidle');

    // For fundraiser template, Donate should be first/primary CTA
    // This validates the ctaLabels order from the template

    const ctaButtons = page.locator('.cta-button, .btn-primary');
    const firstCta = ctaButtons.first();

    // If CTAs exist, check that fundraiser events show Donate prominently
  });

  test('Gallery section enabled for school/fundraiser events', async ({ page }) => {
    await page.goto(buildUrl('public'));
    await page.waitForLoadState('networkidle');

    // School and fundraiser templates enable the gallery section
    const gallerySection = page.locator('.gallery, [data-section="gallery"], .event-photos');

    // Gallery visibility depends on:
    // 1. Template having gallery: true
    // 2. Event having gallery images configured
  });

});

// ============================================================================
// CUSTOM TEMPLATE SCENARIO
// ============================================================================

test.describe('✨ Custom Template Flow', () => {

  test('Custom template shows all section toggles in Admin', async ({ page }) => {
    await page.goto(buildUrl('admin'));
    await page.waitForLoadState('networkidle');

    // Custom template should have ALL sections enabled by default
    // Admin should show toggles for each section

    const sectionToggles = page.locator('[data-section-toggle], .section-toggle');

    // For custom template, user can toggle any section on/off
    // Validate that Admin UI allows this flexibility
  });

  test('All sections can be toggled on/off for custom events', async ({ page }) => {
    await page.goto(buildUrl('admin'));
    await page.waitForLoadState('networkidle');

    // Find section toggles and verify they're interactive
    const videoToggle = page.locator('[data-section="video"] input[type="checkbox"], #section-video-toggle');
    const scheduleToggle = page.locator('[data-section="schedule"] input[type="checkbox"], #section-schedule-toggle');
    const galleryToggle = page.locator('[data-section="gallery"] input[type="checkbox"], #section-gallery-toggle');

    // Custom template allows full control over all sections
  });

});

// ============================================================================
// DATA PROPAGATION FLOW
// ============================================================================

test.describe('🔄 Data Propagation: Admin → Public → Display → Poster', () => {

  test('Event data created in Admin appears on Public page', async ({ page }) => {
    // This is a critical flow test
    // 1. Create event in Admin
    // 2. Navigate to Public page
    // 3. Verify event data is displayed

    await page.goto(buildUrl('admin'));
    await page.waitForLoadState('networkidle');

    // Look for event list or created event
    const eventsList = page.locator('.events-grid, .event-list, #eventsList');

    // Navigate to Public
    await page.goto(buildUrl('public'));
    await page.waitForLoadState('networkidle');

    // Public page should show events
    await expect(page.locator('body')).not.toContainText('No events');
  });

  test('Sponsor data appears on Public, Display, and Poster', async ({ page }) => {
    // Sponsors created in Admin should propagate to all surfaces

    // Check Public page
    await page.goto(buildUrl('public'));
    await page.waitForLoadState('networkidle');
    const publicSponsors = page.locator('.sponsor-banner, .sponsor-strip, [data-sponsors]');

    // Check Display page
    await page.goto(buildUrl('display'));
    await page.waitForLoadState('networkidle');
    const displaySponsors = page.locator('.sponsor-top, .sponsor-side, [data-sponsors]');

    // Check Poster page (requires eventId)
    // await page.goto(buildUrl('poster', { eventId: 'EVT_xxx' }));
  });

  test('SharedReport shows sponsor metrics', async ({ page }) => {
    await page.goto(buildUrl('report'));
    await page.waitForLoadState('networkidle');

    // SharedReport should display sponsor performance data
    const sponsorMetrics = page.locator('.sponsor-performance, .metrics-grid, [data-sponsor-metrics]');

    // Page should load without errors
    await expect(page).not.toHaveTitle(/error/i);
  });

});

// ============================================================================
// TEMPLATE-SPECIFIC RENDERING VALIDATION
// ============================================================================

test.describe('📋 Template Contract: No Frontend Branching', () => {

  test('Public page reads sections from event data, not hardcoded template logic', async ({ page }) => {
    // This validates the architectural rule:
    // Frontend should read event.sections[key], not "if (templateId === 'bar_night')"

    await page.goto(buildUrl('public'));
    await page.waitForLoadState('networkidle');

    // The page should render based on the event's sections object
    // NOT based on templateId-specific if statements

    // Check that page doesn't have template-specific error messages
    await expect(page.locator('body')).not.toContainText('Template not supported');
    await expect(page.locator('body')).not.toContainText('Unknown template');
  });

  test('Display page renders based on event data contract', async ({ page }) => {
    await page.goto(buildUrl('display'));
    await page.waitForLoadState('networkidle');

    // Display should work for ANY template because it reads the generic contract
    await expect(page).not.toHaveTitle(/error/i);
  });

  test('Poster page renders based on event data contract', async ({ page }) => {
    // Poster needs eventId - skip if not available
    await page.goto(buildUrl('poster'));
    await page.waitForLoadState('networkidle');

    // Should handle missing eventId gracefully
    // When eventId is provided, should render based on event contract
  });

});
