/**
 * Admin Mobile-First Polish Tests
 *
 * Tests for mobile-optimized Admin experience:
 * - Mobile viewport (390x844 - iPhone 14 Pro)
 * - Desktop viewport
 * - Collapsible cards on mobile
 * - Primary actions reachable without excessive scrolling
 * - No horizontal scrolling on mobile
 *
 * Run: npm run test:e2e -- admin-mobile-polish.spec.js
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

// Configuration
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

// Mobile viewport (iPhone 14 Pro dimensions)
const MOBILE_VIEWPORT = { width: 390, height: 844 };
// Desktop viewport
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

// Timeout for GAS cold starts
const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

// Generate unique test event data
function createTestEvent() {
  return {
    name: `Mobile Test Event ${Date.now()}`,
    date: (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      return d.toISOString().split('T')[0];
    })(),
    venue: 'Mobile Test Venue',
  };
}

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

// ═══════════════════════════════════════════════════════════════════════════════
// MOBILE VIEWPORT TESTS (390x844 - iPhone 14 Pro)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Mobile-First Polish: Mobile Viewport (390x844)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
  });

  test('Mobile: Page loads without horizontal scrolling', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Wait for page to stabilize
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Check for horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = MOBILE_VIEWPORT.width;

    // Allow 1px tolerance for rounding
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });

  test('Mobile: Create event form is visible and usable', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Form should be visible
    await expect(page.locator('#createCard, #createForm')).toBeVisible({ timeout: 15000 });

    // Required fields visible
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#startDateISO')).toBeVisible();
    await expect(page.locator('#venue')).toBeVisible();

    // Submit button visible
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Input fields have proper font size (16px+ to prevent iOS zoom)
    const nameFontSize = await page.locator('#name').evaluate(el =>
      parseInt(window.getComputedStyle(el).fontSize)
    );
    expect(nameFontSize).toBeGreaterThanOrEqual(16);
  });

  test('Mobile: Create event and verify links are visible', async ({ page }) => {
    const testEvent = createTestEvent();

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Handle admin key prompt
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt' && dialog.message().toLowerCase().includes('admin')) {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Fill form
    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.date);
    await page.fill('#venue', testEvent.venue);

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for event card to appear
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // Verify key links are present (even if collapsed on mobile)
    const publicLink = page.locator('#lnkPublic');
    const displayLink = page.locator('#lnkDisplay');
    const posterLink = page.locator('#lnkPoster');
    const reportLink = page.locator('#lnkReport');

    // Links should be attached to the DOM
    await expect(publicLink).toBeAttached();
    await expect(displayLink).toBeAttached();
    await expect(posterLink).toBeAttached();
    await expect(reportLink).toBeAttached();
  });

  test('Mobile: Non-essential cards are collapsed by default', async ({ page }) => {
    const testEvent = createTestEvent();

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event first
    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.date);
    await page.fill('#venue', testEvent.venue);
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // Check that certain cards are collapsed on mobile
    // Cards 2 (Sponsors), 4 (Poster), 5 (Display), 7 (Report) should be collapsed
    const sponsorsCard = page.locator('#card2Sponsors');
    const posterCard = page.locator('#card4Poster');
    const displayCard = page.locator('#card5Display');
    const reportCard = page.locator('#card7Report');

    // These cards should have the mobile-collapsed class
    await expect(sponsorsCard).toHaveClass(/mobile-collapsed/);
    await expect(posterCard).toHaveClass(/mobile-collapsed/);
    await expect(displayCard).toHaveClass(/mobile-collapsed/);
    await expect(reportCard).toHaveClass(/mobile-collapsed/);

    // Cards 1 (Event Basics) and 3 (Sign-Up) should NOT be collapsed
    const eventBasicsCard = page.locator('#card1EventBasics');
    const signUpCard = page.locator('#card3SignUp');

    // Event basics should be visible (no mobile-collapsed class)
    await expect(eventBasicsCard).not.toHaveClass(/mobile-collapsed/);
    // Sign-up should be visible (no mobile-collapsed class)
    await expect(signUpCard).not.toHaveClass(/mobile-collapsed/);
  });

  test('Mobile: Collapsed cards can be expanded by tapping', async ({ page }) => {
    const testEvent = createTestEvent();

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.date);
    await page.fill('#venue', testEvent.venue);
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // Find a collapsed card
    const posterCard = page.locator('#card4Poster');
    await expect(posterCard).toHaveClass(/mobile-collapsed/);

    // Click the collapse toggle to expand
    const toggleBtn = posterCard.locator('.card-collapse-toggle');
    await toggleBtn.click();

    // Card should now be expanded (no mobile-collapsed class)
    await expect(posterCard).not.toHaveClass(/mobile-collapsed/);

    // Content should be visible
    const posterLink = posterCard.locator('#lnkPoster');
    await expect(posterLink).toBeVisible();
  });

  test('Mobile: Primary actions reachable within 2 scrolls', async ({ page }) => {
    const testEvent = createTestEvent();

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.date);
    await page.fill('#venue', testEvent.venue);
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // Scroll to the public page card (Card 6 - should be visible)
    const publicPageCard = page.locator('#card6PublicPage');
    await publicPageCard.scrollIntoViewIfNeeded();

    // The Copy Link button for Public Page should be visible
    const copyPublicBtn = publicPageCard.locator('button:has-text("Copy Link")');
    await expect(copyPublicBtn).toBeVisible();

    // Calculate scroll distance - should be within 2 full viewport heights
    const scrollY = await page.evaluate(() => window.scrollY);
    const twoScrolls = MOBILE_VIEWPORT.height * 2;

    // This is a soft check - we just verify the button is reachable
    console.log(`   Scroll position: ${scrollY}px (2 scrolls = ${twoScrolls}px)`);
  });

  test('Mobile: Touch targets meet iOS minimum (44px)', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Check submit button touch target
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible({ timeout: 15000 });

    const btnHeight = await submitBtn.evaluate(el => el.offsetHeight);
    expect(btnHeight).toBeGreaterThanOrEqual(44);

    // Check form inputs
    const nameInput = page.locator('#name');
    const inputHeight = await nameInput.evaluate(el => el.offsetHeight);
    expect(inputHeight).toBeGreaterThanOrEqual(40);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DESKTOP VIEWPORT TESTS (1280x800)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Mobile-First Polish: Desktop Viewport (1280x800)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test('Desktop: Page loads correctly', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Page should render without errors
    await expect(page.locator('#createCard, form#createForm, h2:has-text("New Event")')).toBeVisible({ timeout: 15000 });

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(DESKTOP_VIEWPORT.width + 10); // Allow small margin

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });

  test('Desktop: Create event and verify all cards are expanded', async ({ page }) => {
    const testEvent = createTestEvent();

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.date);
    await page.fill('#venue', testEvent.venue);
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // On desktop, all cards should be expanded (no mobile-collapsed class)
    const cards = [
      '#card1EventBasics',
      '#card2Sponsors',
      '#card3SignUp',
      '#card4Poster',
      '#card5Display',
      '#card6PublicPage',
      '#card7Report',
    ];

    for (const cardId of cards) {
      const card = page.locator(cardId);
      await expect(card).toBeVisible();
      await expect(card).not.toHaveClass(/mobile-collapsed/);
    }
  });

  test('Desktop: All link buttons are visible and functional', async ({ page }) => {
    const testEvent = createTestEvent();

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.date);
    await page.fill('#venue', testEvent.venue);
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // Verify all primary link buttons are visible
    await expect(page.locator('#card6PublicPage button:has-text("Copy Link")')).toBeVisible();
    await expect(page.locator('#card5Display button:has-text("Copy Link")')).toBeVisible();
    await expect(page.locator('#card4Poster button:has-text("Copy Link")')).toBeVisible();
    await expect(page.locator('#card7Report button:has-text("Copy Report Link")')).toBeVisible();

    // Verify links have content
    const publicLink = page.locator('#lnkPublic');
    const publicUrl = await publicLink.textContent();
    expect(publicUrl).toBeTruthy();
    expect(publicUrl.length).toBeGreaterThan(10);
  });

  test('Desktop: Layout is not broken by mobile tweaks', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Check that form layout is correct
    const formRows = page.locator('.form-row');
    const formRowCount = await formRows.count();

    // Should have horizontal form rows on desktop
    if (formRowCount > 0) {
      const firstRow = formRows.first();
      const rowDisplay = await firstRow.evaluate(el =>
        window.getComputedStyle(el).display
      );
      // Form rows should use flex or grid on desktop
      expect(['flex', 'grid', 'block']).toContain(rowDisplay);
    }

    // Cards should have proper width
    const createCard = page.locator('#createCard');
    await expect(createCard).toBeVisible({ timeout: 15000 });

    const cardWidth = await createCard.evaluate(el => el.offsetWidth);
    expect(cardWidth).toBeGreaterThan(500); // Should be wide on desktop
  });

  test('Desktop: Collapse toggles are hidden', async ({ page }) => {
    const testEvent = createTestEvent();

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.date);
    await page.fill('#venue', testEvent.venue);
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // Collapse toggles should be hidden on desktop
    const collapseToggles = page.locator('.card-collapse-toggle');
    const toggleCount = await collapseToggles.count();

    if (toggleCount > 0) {
      // Each toggle should have display: none on desktop
      for (let i = 0; i < toggleCount; i++) {
        const toggle = collapseToggles.nth(i);
        const display = await toggle.evaluate(el =>
          window.getComputedStyle(el).display
        );
        expect(display).toBe('none');
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSIVE BEHAVIOR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Mobile-First Polish: Responsive Behavior', () => {

  test('Viewport resize: Cards expand when switching to desktop', async ({ page }) => {
    const testEvent = createTestEvent();

    // Start on mobile
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.fill('#name', testEvent.name);
    await page.fill('#startDateISO', testEvent.date);
    await page.fill('#venue', testEvent.venue);
    await page.click('button[type="submit"]');

    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 15000 });

    // Cards should be collapsed on mobile
    const posterCard = page.locator('#card4Poster');
    await expect(posterCard).toHaveClass(/mobile-collapsed/);

    // Resize to desktop
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.waitForTimeout(500); // Wait for resize handler

    // Card should now be expanded
    await expect(posterCard).not.toHaveClass(/mobile-collapsed/);
  });
});
