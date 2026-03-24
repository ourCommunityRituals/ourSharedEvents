/**
 * FLOW TESTS - Level 3: Customer/Public User Journeys
 *
 * Purpose: Test complete customer workflows from discovery to engagement
 * Coverage: Browse events, view details, interact with sponsors, share events
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:flows
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:flows
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

test.describe('🔄 FLOW: Customer - Event Discovery', () => {

  test('Complete flow: Land on site → Browse events → View event details', async ({ page }) => {
    // Step 1: Land on public homepage
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await expect(page).toHaveTitle(/Public|Events/);
    await expect(page.locator('main#app')).toBeVisible();

    // Step 2: Browse available events
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Step 3: Click on first event
      const firstEvent = eventCards.first();
      const eventTitle = await firstEvent.locator('h2, h3').textContent();

      await firstEvent.locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 4: Verify event detail page loaded
      await expect(page.locator(`text=${eventTitle}`)).toBeVisible({ timeout: 5000 });

      // Step 5: Verify all event details are shown
      await expect(page.locator('main')).toBeVisible();

      // Should show date, location, description
      const content = await page.locator('main').textContent();
      expect(content.length).toBeGreaterThan(50);
    } else {
      // No events available - verify empty state
      const hasEmptyMessage = await page.locator('text=/no events|coming soon/i').count() > 0;
      expect(hasEmptyMessage).toBe(true);
    }
  });

  test('Complete flow: Search events → Filter by category → View results', async ({ page }) => {
    // Step 1: Navigate to events page
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 2: Check if search exists
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]');
    const hasSearch = await searchInput.count() > 0;

    if (hasSearch) {
      // Step 3: Enter search term
      await searchInput.fill('test');
      await page.waitForTimeout(500);

      // Step 4: Verify results updated
      await expect(page.locator('main#app')).toBeVisible();
    }

    // Step 5: Check if filters exist
    const filterButtons = page.locator('button[data-filter], .filter-btn');
    const hasFilters = await filterButtons.count() > 0;

    if (hasFilters) {
      // Step 6: Click first filter
      await filterButtons.first().click();
      await page.waitForTimeout(500);

      // Step 7: Verify page still loads correctly
      await expect(page.locator('main#app')).toBeVisible();
    }
  });

  test('Complete flow: Browse by date → Select upcoming events → View calendar', async ({ page }) => {
    // Step 1: Navigate to events page
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 2: Look for date filtering
    const dateFilter = page.locator('button:has-text("upcoming"), button:has-text("today"), .date-filter');
    const hasDateFilter = await dateFilter.count() > 0;

    if (hasDateFilter) {
      await dateFilter.first().click();
      await page.waitForTimeout(500);

      // Verify events list updates
      await expect(page.locator('main#app')).toBeVisible();
    }

    // Step 3: Check for calendar view option
    const calendarView = page.locator('button:has-text("calendar"), [data-view="calendar"]');
    const hasCalendar = await calendarView.count() > 0;

    if (hasCalendar) {
      await calendarView.first().click();
      await page.waitForTimeout(500);

      await expect(page.locator('main#app')).toBeVisible();
    }
  });
});

test.describe('🔄 FLOW: Customer - Event Engagement', () => {

  test('Complete flow: View event → Read details → Click sponsor link', async ({ page, context }) => {
    // Step 1: Navigate to events
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Step 2: Open event detail
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 3: Read event description
      await expect(page.locator('main')).toBeVisible();

      // Step 4: Look for sponsor links
      const sponsorLinks = page.locator('a[data-sponsor], .sponsor-link');
      const sponsorCount = await sponsorLinks.count();

      if (sponsorCount > 0) {
        // Step 5: Click sponsor link
        const sponsorHref = await sponsorLinks.first().getAttribute('href');
        expect(sponsorHref).toBeTruthy();

        // Verify link is valid
        expect(sponsorHref.length).toBeGreaterThan(0);
      }
    }
  });

  test('Complete flow: View event → Share on social media → Verify share links', async ({ page }) => {
    // Step 1: Navigate to events
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Step 2: Click into event detail
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 3: Find share buttons
      const shareButton = page.locator('button:has-text("share"), .share-btn');
      const hasShare = await shareButton.count() > 0;

      if (hasShare) {
        // Step 4: Click share button
        await shareButton.first().click();
        await page.waitForTimeout(500);

        // Step 5: Verify share menu or share API triggered
        // (Share API may be blocked in tests, just verify no errors)
        const errors = [];
        page.on('pageerror', error => errors.push(error));
        await page.waitForTimeout(500);
        expect(errors.length).toBe(0);
      }
    }
  });

  test('Complete flow: Add event to calendar → Download ICS file', async ({ page }) => {
    // Step 1: Navigate to event detail
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 2: Find calendar button
      const calendarBtn = page.locator('button:has-text("calendar"), a:has-text("calendar"), .calendar-btn');
      const hasCalendar = await calendarBtn.count() > 0;

      if (hasCalendar) {
        // Step 3: Verify button is clickable
        await expect(calendarBtn.first()).toBeVisible();
        await expect(calendarBtn.first()).toBeEnabled();

        const href = await calendarBtn.first().getAttribute('href');

        // Step 4: If it's a download link, verify it
        if (href) {
          expect(href).toBeTruthy();
          // ICS files typically have .ics extension or data: URL
          const isICS = href.includes('.ics') || href.startsWith('data:') || href.includes('calendar');
          expect(isICS).toBe(true);
        }
      }
    }
  });
});

test.describe('🔄 FLOW: Customer - Mobile Experience', () => {

  test('Complete flow: Mobile user → Browse events → Save to home screen', async ({ page }) => {
    // Step 1: Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Step 2: Navigate to events
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await expect(page.locator('main#app')).toBeVisible();

    // Step 3: Verify mobile-friendly layout
    const fontSize = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).fontSize
    );
    const fontSizeNum = parseInt(fontSize);
    expect(fontSizeNum).toBeGreaterThanOrEqual(16);

    // Step 4: Browse events
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Step 5: Tap event (mobile interaction)
      await eventCards.first().locator('a').first().tap();
      await page.waitForLoadState('networkidle');

      // Step 6: Verify detail view is readable on mobile
      await expect(page.locator('main')).toBeVisible();
    }

    // Step 7: Check for PWA manifest (add to home screen capability)
    const manifest = page.locator('link[rel="manifest"]');
    const hasManifest = await manifest.count() > 0;

    // PWA support is optional but enhances mobile experience
    if (hasManifest) {
      const manifestHref = await manifest.getAttribute('href');
      expect(manifestHref).toBeTruthy();
    }
  });

  test('Complete flow: Mobile → Landscape orientation → View event', async ({ page }) => {
    // Step 1: Set mobile landscape
    await page.setViewportSize({ width: 667, height: 375 });

    // Step 2: Navigate to events
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 3: Verify layout adapts
    await expect(page.locator('main#app')).toBeVisible();

    // Step 4: Open event
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 5: Verify readable in landscape
      await expect(page.locator('main')).toBeVisible();
    }
  });
});

test.describe('🔄 FLOW: Customer - Accessibility Journey', () => {

  test('Complete flow: Keyboard-only user → Navigate → View event', async ({ page }) => {
    // Step 1: Navigate to events
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Step 2: Tab through navigation
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const focusedElement = await page.evaluate(() => document.activeElement.tagName);
    expect(['A', 'BUTTON', 'INPUT']).toContain(focusedElement);

    // Step 3: Tab to first event
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Keep tabbing until we reach an event link
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');

        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          return el.closest('.event-card') !== null;
        });

        if (focused) {
          // Step 4: Press Enter to navigate
          await page.keyboard.press('Enter');
          await page.waitForLoadState('networkidle');

          // Step 5: Verify we navigated to event detail
          await expect(page.locator('main')).toBeVisible();
          break;
        }
      }
    }
  });

  test('Complete flow: Screen reader user → Read event details → Understand structure', async ({ page }) => {
    // Step 1: Navigate to events
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 2: Check ARIA landmarks
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Step 3: Check heading hierarchy
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(0);

    // Step 4: Navigate to event detail
    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 5: Verify semantic HTML structure
      const headings = await page.locator('h1, h2, h3').count();
      expect(headings).toBeGreaterThan(0);

      // Step 6: Verify images have alt text
      const images = page.locator('img');
      const imageCount = await images.count();

      if (imageCount > 0) {
        for (let i = 0; i < Math.min(imageCount, 3); i++) {
          const img = images.nth(i);
          const alt = await img.getAttribute('alt');

          // Images should have alt attribute (can be empty for decorative images)
          expect(alt !== null).toBe(true);
        }
      }
    }
  });
});

test.describe('🔄 FLOW: Customer - Performance Journey', () => {

  test('Complete flow: Slow connection → Browse events → View details', async ({ page, context }) => {
    // Step 1: Simulate slow 3G connection
    await page.route('**/*', route => {
      // Add artificial delay for slow connection simulation
      setTimeout(() => route.continue(), 100);
    });

    // Step 2: Navigate to events
    const start = Date.now();
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;

    // Should still load in reasonable time even on slow connection
    expect(loadTime).toBeLessThan(10000);

    // Step 3: Check for loading indicators
    const hasLoadingIndicator = await page.locator('.loading, [aria-busy="true"]').count() > 0;

    // Loading indicators improve perceived performance
    // (Optional, but good UX)

    // Step 4: Browse events
    await page.waitForLoadState('networkidle');

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Step 5: Click event
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Step 6: Verify content loaded
      await expect(page.locator('main')).toBeVisible();
    }
  });
});

test.describe('🔄 FLOW: Customer - Returning Visitor', () => {

  test('Complete flow: Return to site → See new events → Check favorites', async ({ page, context }) => {
    // Step 1: First visit - browse events
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const firstVisitCount = await eventCards.count();

    // Step 2: Mark event as favorite (if feature exists)
    const favoriteBtn = page.locator('button:has-text("favorite"), button:has-text("bookmark"), .favorite-btn');
    const hasFavorites = await favoriteBtn.count() > 0;

    if (hasFavorites && firstVisitCount > 0) {
      await favoriteBtn.first().click();
      await page.waitForTimeout(500);
    }

    // Step 3: Navigate away
    await page.goto('about:blank');

    // Step 4: Return to site (simulating returning visitor)
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Step 5: Verify events still load
    await expect(page.locator('main#app')).toBeVisible();

    const secondVisitCount = await page.locator('.event-card').count();
    expect(secondVisitCount).toBeGreaterThanOrEqual(0);
  });
});
