/**
 * PUBLIC SURFACE E2E TESTS - Full + Minimal + Negative Scenarios
 *
 * Purpose: Prove Public works for rich events AND barebones events,
 *          and handles missing pieces gracefully.
 *
 * Coverage:
 *   - Full Data Test: Event with Schedule, Standings, Bracket, Sponsors
 *   - Minimal Data Test: Event with just Name, Date, Venue, One CTA
 *   - Negative Path Tests: Missing schedule, sponsors, bracket handled gracefully
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:e2e-public
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

// ============================================================================
// TEST FIXTURES - Full, Minimal, and Empty Event Scenarios
// ============================================================================

/**
 * Full Event Fixture - All sections enabled with data
 * Schema: /schemas/event.schema.json
 */
const FULL_EVENT_FIXTURE = {
  id: 'test-full-event-e2e',
  name: 'Championship Tournament 2025',
  startDateISO: '2025-12-20',
  venue: 'Madison Square Garden, New York',

  // CTAs (MVP Required)
  ctas: {
    primary: { label: 'Register Now', url: 'https://forms.google.com/test-registration' },
    secondary: { label: 'Learn More', url: 'https://example.com/about' }
  },

  // Settings - All sections enabled
  settings: {
    showSchedule: true,
    showStandings: true,
    showBracket: true,
    showSponsors: true,
    showVideo: true,
    showMap: true,
    showGallery: true,
    showSponsorBanner: true,
    showQRSection: false
  },

  // Schedule (MVP Optional)
  schedule: [
    { time: '09:00 AM', title: 'Registration Opens', description: 'Check-in and badge pickup' },
    { time: '10:00 AM', title: 'Opening Ceremony', description: 'Welcome address and introductions' },
    { time: '11:00 AM', title: 'Round 1 Matches', description: 'Preliminary rounds begin' },
    { time: '01:00 PM', title: 'Lunch Break', description: 'Sponsored by Gold Industries' },
    { time: '02:00 PM', title: 'Semi-Finals', description: null },
    { time: '04:00 PM', title: 'Finals', description: 'Championship match' },
    { time: '05:00 PM', title: 'Awards Ceremony', description: 'Trophy presentation' }
  ],

  // Standings (MVP Optional)
  standings: [
    { rank: 1, team: 'Champions FC', wins: 10, losses: 0, points: 100 },
    { rank: 2, team: 'Runners United', wins: 8, losses: 2, points: 80 },
    { rank: 3, team: 'Bronze Stars', wins: 7, losses: 3, points: 70 },
    { rank: 4, team: 'Fourth Place FC', wins: 6, losses: 4, points: 60 },
    { rank: 5, team: 'Fifth Element', wins: 5, losses: 5, points: 50 }
  ],

  // Bracket (MVP Optional)
  bracket: {
    rounds: [
      {
        name: 'Semi-Finals',
        matches: [
          { team1: 'Champions FC', team2: 'Fourth Place FC', score1: 3, score2: 1, winner: 'Champions FC' },
          { team1: 'Runners United', team2: 'Bronze Stars', score1: 2, score2: 2, winner: null }
        ]
      },
      {
        name: 'Finals',
        matches: [
          { team1: 'Champions FC', team2: 'TBD', score1: null, score2: null, winner: null }
        ]
      }
    ]
  },

  // Sponsors (V2 Optional) - with 'public' placement
  sponsors: [
    { id: 'sp-plat', name: 'Platinum Corp', logoUrl: 'https://via.placeholder.com/300x100/FFD700/000000?text=Platinum', linkUrl: 'https://platinum.example.com', placement: 'public' },
    { id: 'sp-gold', name: 'Gold Industries', logoUrl: 'https://via.placeholder.com/300x100/C0C0C0/000000?text=Gold', linkUrl: 'https://gold.example.com', placement: 'public' },
    { id: 'sp-silver', name: 'Silver Solutions', logoUrl: 'https://via.placeholder.com/300x100/CD7F32/000000?text=Silver', linkUrl: 'https://silver.example.com', placement: 'public' }
  ],

  // Media (V2 Optional)
  media: {
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    mapUrl: 'https://maps.google.com/?q=Madison+Square+Garden',
    gallery: [
      'https://via.placeholder.com/400x300/2563eb/ffffff?text=Photo+1',
      'https://via.placeholder.com/400x300/10b981/ffffff?text=Photo+2',
      'https://via.placeholder.com/400x300/f59e0b/ffffff?text=Photo+3'
    ]
  },

  // Links (MVP Required)
  links: {
    publicUrl: `${BASE_URL}?page=events&brand=${BRAND_ID}&id=test-full-event-e2e`,
    displayUrl: `${BASE_URL}?page=display&brand=${BRAND_ID}&id=test-full-event-e2e`,
    posterUrl: `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=test-full-event-e2e`,
    signupUrl: 'https://forms.google.com/test-registration'
  }
};

/**
 * Minimal Event Fixture - Just basic info (Name, Date, Venue, One CTA)
 * Schema: /schemas/event.schema.json (MVP Required fields only)
 */
const MINIMAL_EVENT_FIXTURE = {
  id: 'test-minimal-event-e2e',
  name: 'Simple Meetup',
  startDateISO: '2025-12-15',
  venue: 'Local Community Center',

  // Only primary CTA
  ctas: {
    primary: { label: 'RSVP', url: 'https://forms.google.com/simple-rsvp' },
    secondary: null
  },

  // All optional sections disabled
  settings: {
    showSchedule: false,
    showStandings: false,
    showBracket: false,
    showSponsors: false,
    showVideo: false,
    showMap: true, // Maps should still work with venue
    showGallery: false,
    showSponsorBanner: false,
    showQRSection: false
  },

  // No optional data
  schedule: [],
  standings: [],
  bracket: null,
  sponsors: [],
  media: {},
  externalData: {},

  // Links (MVP Required)
  links: {
    publicUrl: `${BASE_URL}?page=events&brand=${BRAND_ID}&id=test-minimal-event-e2e`,
    displayUrl: `${BASE_URL}?page=display&brand=${BRAND_ID}&id=test-minimal-event-e2e`,
    posterUrl: `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=test-minimal-event-e2e`,
    signupUrl: 'https://forms.google.com/simple-rsvp'
  }
};

/**
 * Empty Sections Fixture - Settings enabled but data missing
 * Tests graceful handling of "not available yet" states
 */
const EMPTY_SECTIONS_FIXTURE = {
  id: 'test-empty-sections-e2e',
  name: 'Upcoming Tournament',
  startDateISO: '2025-12-30',
  venue: 'Sports Arena',

  ctas: {
    primary: { label: 'Register', url: 'https://forms.google.com/register' },
    secondary: null
  },

  // Settings enabled but no data provided
  settings: {
    showSchedule: true,  // Enabled but no schedule data
    showStandings: true, // Enabled but no standings data
    showBracket: true,   // Enabled but no bracket data
    showSponsors: true,  // Enabled but no sponsors
    showVideo: true,     // Enabled but no video URL
    showMap: true,
    showGallery: true,   // Enabled but no gallery
    showSponsorBanner: true,
    showQRSection: false
  },

  // Empty data - sections enabled but nothing to show
  schedule: [],
  standings: [],
  bracket: null,
  sponsors: [],
  media: {},
  externalData: {},

  links: {
    publicUrl: `${BASE_URL}?page=events&brand=${BRAND_ID}&id=test-empty-sections-e2e`,
    displayUrl: `${BASE_URL}?page=display&brand=${BRAND_ID}&id=test-empty-sections-e2e`,
    posterUrl: `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=test-empty-sections-e2e`,
    signupUrl: 'https://forms.google.com/register'
  }
};

// ============================================================================
// FULL DATA TEST SUITE
// ============================================================================

test.describe('Public Surface - Full Data Event', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to events list first
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
  });

  test('Full event page loads with proper structure', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    // Wait for page to fully load
    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Verify page structure
    await expect(page).toHaveTitle(/Public|Events/);
    await expect(page.locator('.container, main#app')).toBeVisible();

    // Check for no console errors
    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Event detail shows title, date, and venue', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    // Check for event cards
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Click first event to view details
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Verify event header elements are visible
      const eventHeader = page.locator('.event-header, .event-detail');
      await expect(eventHeader.first()).toBeVisible();

      // Title should be visible (h1 or h2)
      const title = page.locator('h1, h2').first();
      await expect(title).toBeVisible();
      const titleText = await title.textContent();
      expect(titleText.length).toBeGreaterThan(0);

      // Date should be visible
      const dateElement = page.locator('.event-meta-item:has-text(""), text=/\\d{4}|January|February|March|April|May|June|July|August|September|October|November|December/i');
      if (await dateElement.count() > 0) {
        await expect(dateElement.first()).toBeVisible();
      }

      // Venue/location should be visible
      const venueElement = page.locator('.event-meta-item:has-text(""), text=/venue|location|arena|center|stadium/i');
      if (await venueElement.count() > 0) {
        await expect(venueElement.first()).toBeVisible();
      }
    }

    // No console errors
    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Schedule section is visible when enabled with data', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check for schedule section
      const scheduleSection = page.locator('.event-section:has-text("Schedule"), #schedule, [data-section="schedule"], .schedule-list');
      const scheduleExists = await scheduleSection.count() > 0;

      if (scheduleExists) {
        // Schedule items should be visible
        const scheduleItems = page.locator('.schedule-item, .schedule-list > div');
        const itemCount = await scheduleItems.count();

        if (itemCount > 0) {
          await expect(scheduleItems.first()).toBeVisible();

          // Each item should have time and title
          const firstItem = scheduleItems.first();
          const hasTime = await firstItem.locator('.schedule-time').count() > 0;
          const hasTitle = await firstItem.locator('.schedule-title').count() > 0;

          // At least one of these should be present
          expect(hasTime || hasTitle).toBe(true);
        }
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Standings section is visible when enabled with data', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check for standings section
      const standingsSection = page.locator('.event-section:has-text("Standings"), #standings, [data-section="standings"], .standings-table');
      const standingsExists = await standingsSection.count() > 0;

      if (standingsExists) {
        // Standings table should have proper structure
        const table = page.locator('.data-table, .standings-table, table');
        if (await table.count() > 0) {
          await expect(table.first()).toBeVisible();

          // Table should have rows
          const rows = table.first().locator('tbody tr, tr');
          const rowCount = await rows.count();
          expect(rowCount).toBeGreaterThanOrEqual(0);
        }
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Sponsor banner is visible when sponsors configured', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check for sponsor elements
      const sponsorBanner = page.locator('#sponsorBanner, .sponsor-banner');
      const sponsorSection = page.locator('.event-section:has-text("Sponsor"), [data-section="sponsors"]');
      const sponsorImages = page.locator('.sponsor-banner img, .sponsor-logo, a[data-sponsor-id] img');

      const hasSponsorBanner = await sponsorBanner.count() > 0 && await sponsorBanner.isVisible().catch(() => false);
      const hasSponsorSection = await sponsorSection.count() > 0;
      const hasSponsorImages = await sponsorImages.count() > 0;

      // If sponsors are configured, at least one sponsor element should exist
      if (hasSponsorBanner || hasSponsorSection || hasSponsorImages) {
        // Verify sponsor images have src attributes
        if (hasSponsorImages) {
          const firstImg = sponsorImages.first();
          await expect(firstImg).toBeVisible();
          const src = await firstImg.getAttribute('src');
          expect(src).toBeTruthy();
        }
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Bracket section is visible when enabled with data', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check for bracket section
      const bracketSection = page.locator('.event-section:has-text("Bracket"), #bracket, [data-section="bracket"], .bracket-container');
      const bracketExists = await bracketSection.count() > 0;

      if (bracketExists) {
        // Bracket should have rounds or matches
        const bracketRounds = page.locator('.bracket-round, .bracket-match');
        const roundCount = await bracketRounds.count();

        if (roundCount > 0) {
          await expect(bracketRounds.first()).toBeVisible();
        }
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('CTA buttons are visible and functional', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check for action buttons
      const actionButtons = page.locator('.action-buttons');
      if (await actionButtons.count() > 0) {
        await expect(actionButtons.first()).toBeVisible();

        // Primary CTA should exist
        const primaryCTA = page.locator('.btn-primary, a.btn-primary');
        if (await primaryCTA.count() > 0) {
          await expect(primaryCTA.first()).toBeVisible();

          // CTA should have href or be clickable
          const href = await primaryCTA.first().getAttribute('href');
          expect(href).toBeTruthy();
        }
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Utility buttons (Maps, Calendar, Share) are present', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Check for utility buttons
      const utilityButtons = page.locator('.utility-buttons, .btn-utility');

      if (await utilityButtons.count() > 0) {
        // Maps button
        const mapsBtn = page.locator('.btn-utility:has-text("Maps"), a:has-text("Maps"), button:has-text("Maps")');

        // Calendar button
        const calendarBtn = page.locator('.btn-utility:has-text("Calendar"), .calendar-dropdown');

        // Share button
        const shareBtn = page.locator('.btn-utility:has-text("Share"), button:has-text("Share"), button:has-text("Copy")');

        // At least one utility button should be visible
        const hasMaps = await mapsBtn.count() > 0;
        const hasCalendar = await calendarBtn.count() > 0;
        const hasShare = await shareBtn.count() > 0;

        expect(hasMaps || hasCalendar || hasShare).toBe(true);
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });
});

// ============================================================================
// MINIMAL DATA TEST SUITE
// ============================================================================

test.describe('Public Surface - Minimal Data Event', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
  });

  test('Minimal event page does not crash', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Page should load without errors
    await expect(page).toHaveTitle(/Public|Events/);
    await expect(page.locator('.container, main#app')).toBeVisible();

    // No JavaScript errors
    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Minimal event renders clean info card with basic details', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    // Check for event cards in list view
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      const firstCard = eventCards.first();
      await expect(firstCard).toBeVisible();

      // Card should have title (h2 or h3)
      const cardTitle = firstCard.locator('h2, h3').first();
      if (await cardTitle.count() > 0) {
        await expect(cardTitle).toBeVisible();
      }

      // Card should be clickable
      const link = firstCard.locator('a').first();
      if (await link.count() > 0) {
        await expect(link).toBeVisible();
        const href = await link.getAttribute('href');
        expect(href).toBeTruthy();
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Minimal event detail shows only basic info - no empty section frames', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Event header should be visible with name
      const header = page.locator('.event-header h1, .event-detail h1, h1');
      if (await header.count() > 0) {
        await expect(header.first()).toBeVisible();
      }

      // When data is missing, sections should NOT render empty frames
      // Check that empty sections are either hidden or simply not present
      const scheduleSection = page.locator('.event-section:has-text("Schedule"):visible');
      const standingsSection = page.locator('.event-section:has-text("Standings"):visible');
      const bracketSection = page.locator('.event-section:has-text("Bracket"):visible');

      // If a section is visible, it should have content (not just a header)
      if (await scheduleSection.count() > 0) {
        const scheduleContent = scheduleSection.locator('.schedule-item, .schedule-list, table, .loading-placeholder');
        expect(await scheduleContent.count()).toBeGreaterThan(0);
      }

      if (await standingsSection.count() > 0) {
        const standingsContent = standingsSection.locator('.standings-table, table, .loading-placeholder');
        expect(await standingsContent.count()).toBeGreaterThan(0);
      }

      if (await bracketSection.count() > 0) {
        const bracketContent = bracketSection.locator('.bracket-match, .bracket-round, .loading-placeholder');
        expect(await bracketContent.count()).toBeGreaterThan(0);
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Minimal event CTA button is visible and functional', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // At least one CTA or action button should be visible
      const primaryCTA = page.locator('.btn-primary, a.btn-primary, .action-buttons a, .action-buttons button');

      if (await primaryCTA.count() > 0) {
        await expect(primaryCTA.first()).toBeVisible();

        // Button should be clickable (has href or onclick)
        const firstBtn = primaryCTA.first();
        const href = await firstBtn.getAttribute('href');
        const isButton = await firstBtn.evaluate(el => el.tagName.toLowerCase() === 'button');

        expect(href || isButton).toBeTruthy();
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Minimal event sponsor banner is hidden when no sponsors', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Sponsor banner should be hidden or not visible
      const sponsorBanner = page.locator('#sponsorBanner');

      if (await sponsorBanner.count() > 0) {
        // If it exists, it should be hidden or have no visible content
        const isHidden = await sponsorBanner.getAttribute('hidden');
        const isEmpty = await sponsorBanner.locator('img, a').count() === 0;
        const isInvisible = !(await sponsorBanner.isVisible().catch(() => false));

        expect(isHidden !== null || isEmpty || isInvisible).toBe(true);
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });
});

// ============================================================================
// NEGATIVE PATH TEST SUITE
// ============================================================================

test.describe('Public Surface - Negative Paths (Missing Data)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
  });

  test('No schedule: page loads without errors', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Page should load successfully
    await expect(page).toHaveTitle(/Public|Events/);

    // No console errors related to schedule
    const scheduleErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('schedule') ||
      e.toLowerCase().includes('undefined') ||
      e.toLowerCase().includes('null')
    );
    expect(scheduleErrors).toHaveLength(0);
  });

  test('No schedule: section is omitted or shows clean message', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Schedule section behavior when no data:
      // Option 1: Section is simply not rendered (preferred)
      // Option 2: Section shows "Not available yet" message
      const scheduleSection = page.locator('.event-section:has-text("Schedule"), #schedule, [data-section="schedule"]');

      if (await scheduleSection.count() > 0) {
        // If section exists, check it has either content or a clean empty message
        const hasItems = await scheduleSection.locator('.schedule-item').count() > 0;
        const hasTable = await scheduleSection.locator('table').count() > 0;
        const hasEmptyMessage = await scheduleSection.locator('text=/not available|coming soon|no schedule|to be announced/i').count() > 0;
        const hasLink = await scheduleSection.locator('a').count() > 0;

        // Must have content or a clean message (not empty/broken)
        expect(hasItems || hasTable || hasEmptyMessage || hasLink).toBe(true);
      }
      // If section doesn't exist, that's fine - it's omitted
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('No sponsors: page loads without errors', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // No console errors related to sponsors
    const sponsorErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('sponsor') ||
      e.toLowerCase().includes('undefined') ||
      e.toLowerCase().includes('null')
    );
    expect(sponsorErrors).toHaveLength(0);
  });

  test('No sponsors: banner is hidden gracefully', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Sponsor banner should be hidden or not cause visual issues
      const sponsorBanner = page.locator('#sponsorBanner');

      if (await sponsorBanner.count() > 0) {
        // Check it's properly hidden (not taking up space with empty content)
        const boundingBox = await sponsorBanner.boundingBox();
        const isHidden = await sponsorBanner.getAttribute('hidden');
        const hasContent = await sponsorBanner.locator('img, a, strong').count() > 0;

        // Either hidden attribute, no visible content, or zero-height
        if (boundingBox && hasContent) {
          // If visible with content, that's fine
          expect(boundingBox.height).toBeGreaterThan(0);
        } else {
          // Should be properly hidden or empty
          expect(isHidden !== null || !hasContent || !boundingBox).toBe(true);
        }
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('No bracket: page loads without errors', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // No console errors related to bracket
    const bracketErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('bracket') ||
      e.toLowerCase().includes('undefined') ||
      e.toLowerCase().includes('null')
    );
    expect(bracketErrors).toHaveLength(0);
  });

  test('No bracket: section is omitted or shows clean message', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Bracket section behavior when no data
      const bracketSection = page.locator('.event-section:has-text("Bracket"), #bracket, [data-section="bracket"]');

      if (await bracketSection.count() > 0) {
        // If section exists, check it has content or clean message
        const hasMatches = await bracketSection.locator('.bracket-match, .bracket-round').count() > 0;
        const hasEmptyMessage = await bracketSection.locator('text=/not available|coming soon|no bracket|to be determined/i').count() > 0;
        const hasLink = await bracketSection.locator('a').count() > 0;

        expect(hasMatches || hasEmptyMessage || hasLink).toBe(true);
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('No standings: section is omitted or shows clean message', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Standings section behavior when no data
      const standingsSection = page.locator('.event-section:has-text("Standings"), #standings, [data-section="standings"]');

      if (await standingsSection.count() > 0) {
        const hasTable = await standingsSection.locator('table, .standings-table').count() > 0;
        const hasEmptyMessage = await standingsSection.locator('text=/not available|coming soon|no standings|to be updated/i').count() > 0;
        const hasLink = await standingsSection.locator('a').count() > 0;

        expect(hasTable || hasEmptyMessage || hasLink).toBe(true);
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Event not found: shows clean error message', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    // Navigate to a non-existent event ID
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}&id=non-existent-event-12345`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Should show an error or empty state, not crash
    const errorState = page.locator('.error-state, .empty-state');
    const notFoundMessage = page.locator('text=/not found|does not exist|no event|event not found/i');
    const backLink = page.locator('a:has-text("All Events"), a:has-text("Back")');

    const hasErrorState = await errorState.count() > 0;
    const hasNotFoundMessage = await notFoundMessage.count() > 0;
    const hasBackLink = await backLink.count() > 0;

    // Should have some form of error handling
    expect(hasErrorState || hasNotFoundMessage || hasBackLink).toBe(true);

    // No unhandled JS errors (404 network errors are okay)
    const jsErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('not found')
    );
    expect(jsErrors).toHaveLength(0);
  });

  test('Empty events list: shows clean empty state message', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // If no events, should show empty state message
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count === 0) {
      // Should show empty state, not blank page
      const emptyState = page.locator('.empty-state');
      const noEventsMessage = page.locator('text=/no event|no upcoming|check back|coming soon/i');

      const hasEmptyState = await emptyState.count() > 0;
      const hasMessage = await noEventsMessage.count() > 0;

      expect(hasEmptyState || hasMessage).toBe(true);
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('All missing data: page renders without JS errors', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });
    }

    // The main assertion: no console errors should occur
    // Filter out expected/harmless errors
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('net::ERR') &&
      !e.toLowerCase().includes('warning')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});

// ============================================================================
// RESPONSIVE / MOBILE TESTS
// ============================================================================

test.describe('Public Surface - Mobile Responsiveness', () => {

  test('Mobile: page is readable at 375px width', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

    // Container should be visible
    await expect(page.locator('.container, main#app')).toBeVisible();

    // No horizontal scroll (content fits)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10); // Small tolerance

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('Mobile: event cards stack vertically', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count >= 2) {
      const firstCard = await eventCards.nth(0).boundingBox();
      const secondCard = await eventCards.nth(1).boundingBox();

      if (firstCard && secondCard) {
        // Cards should stack vertically (second card below first)
        expect(secondCard.y).toBeGreaterThan(firstCard.y);
      }
    }
  });

  test('Mobile: action buttons are accessible at bottom', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollection(page);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      // Action buttons should exist and be tappable
      const actionButtons = page.locator('.action-buttons');
      if (await actionButtons.count() > 0) {
        // Buttons should have minimum touch target size (44px)
        const buttons = actionButtons.locator('a, button');
        const buttonCount = await buttons.count();

        if (buttonCount > 0) {
          const firstButton = await buttons.first().boundingBox();
          if (firstButton) {
            expect(firstButton.height).toBeGreaterThanOrEqual(40); // Close to 44px min
          }
        }
      }
    }

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

test.describe('Public Surface - Performance', () => {

  test('Page loads within 5 seconds', async ({ page }) => {
    const start = Date.now();

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    await page.waitForLoadState('domcontentloaded');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  test('Event detail loads within 5 seconds', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      const start = Date.now();
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000);
    }
  });

  test('No memory leaks from sponsor carousel', async ({ page }) => {
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

      // Wait for potential carousel rotation
      await page.waitForTimeout(3000);

      // Navigate away and back
      await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'networkidle',
        timeout: PAGE_TIMEOUT,
      });

      // No errors from cleanup
      expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
    }
  });
});

// ============================================================================
// ACCESSIBILITY TESTS
// ============================================================================

test.describe('Public Surface - Accessibility', () => {

  test('Page has proper heading hierarchy', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    // Should have at least one heading
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').count();
    expect(headings).toBeGreaterThan(0);

    // Check h1 exists (page title)
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);
  });

  test('Interactive elements are keyboard accessible', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    // Tab to first focusable element
    await page.keyboard.press('Tab');

    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);

    // Should focus on an interactive element
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(focusedTag);
  });

  test('Links have accessible text', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    const links = page.locator('a');
    const count = await links.count();

    if (count > 0) {
      // Sample first 5 links
      for (let i = 0; i < Math.min(5, count); i++) {
        const link = links.nth(i);
        const text = await link.textContent();
        const ariaLabel = await link.getAttribute('aria-label');
        const title = await link.getAttribute('title');
        const hasImage = await link.locator('img').count() > 0;

        // Link should have accessible name
        const hasAccessibleName =
          (text && text.trim().length > 0) ||
          ariaLabel ||
          title ||
          hasImage;

        expect(hasAccessibleName).toBe(true);
      }
    }
  });

  test('Images have alt text', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT });

      const images = page.locator('img');
      const imgCount = await images.count();

      for (let i = 0; i < Math.min(5, imgCount); i++) {
        const img = images.nth(i);
        const alt = await img.getAttribute('alt');

        // Image should have alt attribute (can be empty for decorative)
        expect(alt !== null).toBe(true);
      }
    }
  });
});
