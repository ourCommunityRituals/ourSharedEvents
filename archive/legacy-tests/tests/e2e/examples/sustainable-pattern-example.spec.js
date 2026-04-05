/**
 * Sustainable Pattern Example
 *
 * This file demonstrates best practices for:
 * - Sustainability: Clean, maintainable code
 * - Easy to understand: Clear test names and structure
 * - Mobile support: Works on desktop, mobile, and TV
 *
 * Run this test with:
 *   npx playwright test examples/sustainable-pattern-example.spec.js
 *
 * Run on specific device:
 *   npx playwright test examples/sustainable-pattern-example.spec.js --project="Mobile Chrome"
 */

import { test, expect } from '../fixtures';
import { AdminPage } from '../pages/AdminPage';
import { config } from '../config';

/**
 * Test Suite: Admin Event Management
 */
test.describe('Admin Event Management (Sustainable Pattern)', () => {
  // Track test data for cleanup
  let createdEventIds = [];

  /**
   * Cleanup after each test
   * Sustainability: Prevents test pollution
   */
  test.afterEach(async ({ api }) => {
    // Delete any events created during this test
    for (const eventId of createdEventIds) {
      await api.deleteEvent(eventId);
      console.log(`🧹 Cleaned up event: ${eventId}`);
    }
    createdEventIds = [];
  });

  /**
   * Example 1: Basic event creation
   *
   * What this demonstrates:
   * ✅ Using authenticatedAdminPage fixture (no manual auth setup)
   * ✅ Using AdminPage page object (no raw selectors)
   * ✅ Auto-waiting (no waitForTimeout)
   * ✅ Strong assertions
   * ✅ Automatic cleanup
   */
  test('should create event - basic pattern', async ({ authenticatedAdminPage }) => {
    // STEP 1: Create page object
    const adminPage = new AdminPage(authenticatedAdminPage);

    // STEP 2: Perform action
    const eventName = config.testData.event.name();
    const eventId = await adminPage.createEvent(
      eventName,
      '2025-12-31',
      'Example event for testing'
    );

    // Track for cleanup
    createdEventIds.push(eventId);

    // STEP 3: Verify result (strong assertions)
    await adminPage.verifyEventCreated(eventName);
    expect(eventId).toMatch(/^evt_\w+/); // Verify ID format
  });

  /**
   * Example 2: Event with sponsors
   *
   * What this demonstrates:
   * ✅ Multiple page object methods in sequence
   * ✅ Mobile-aware interactions (works on all devices)
   * ✅ Clear test steps
   */
  test('should create event with sponsors - flow pattern', async ({
    authenticatedAdminPage,
    mobile,
  }) => {
    const adminPage = new AdminPage(authenticatedAdminPage);

    // Mobile: Log device type for debugging
    if (mobile.isMobile) {
      console.log('📱 Running on mobile device');
    }

    // Create event
    const eventId = await adminPage.createEvent('Tech Conference 2025');
    createdEventIds.push(eventId);

    // Add sponsors
    await adminPage.addSponsor(
      'TechCorp Solutions',
      'https://techcorp.example.com',
      'https://via.placeholder.com/150'
    );

    await adminPage.addSponsor('Innovation Labs', 'https://innovationlabs.example.com');

    // Verify links are available
    const links = await adminPage.getEventLinks();
    expect(links.public).toContain('p=events');
    expect(links.display).toContain('display');
  });

  /**
   * Example 3: Forms templates creation
   *
   * What this demonstrates:
   * ✅ Testing new features (forms templates)
   * ✅ Waiting for async operations
   * ✅ URL validation
   */
  test('should create forms from templates', async ({ authenticatedAdminPage }) => {
    const adminPage = new AdminPage(authenticatedAdminPage);

    // Create event first
    const eventId = await adminPage.createEvent('Event with Forms');
    createdEventIds.push(eventId);

    // Create check-in form
    const checkinShortlink = await adminPage.createFormFromTemplate('check-in');
    expect(checkinShortlink).toMatch(/https?:\/\/.+/);

    // Create walk-in form
    const walkinShortlink = await adminPage.createFormFromTemplate('walk-in');
    expect(walkinShortlink).toMatch(/https?:\/\/.+/);

    // Create survey form
    const surveyShortlink = await adminPage.createFormFromTemplate('survey');
    expect(surveyShortlink).toMatch(/https?:\/\/.+/);

    // Verify all shortlinks are different
    expect(checkinShortlink).not.toBe(walkinShortlink);
    expect(walkinShortlink).not.toBe(surveyShortlink);
  });

  /**
   * Example 4: Using API fixture
   *
   * What this demonstrates:
   * ✅ Mixing UI and API approaches
   * ✅ Fast test setup via API
   * ✅ UI verification after API action
   */
  test('should verify UI shows API-created event', async ({ authenticatedAdminPage, api }) => {
    // Create event via API (faster than UI)
    const eventName = config.testData.event.name();
    const eventId = await api.createEvent(eventName);
    createdEventIds.push(eventId);

    // Refresh page to see the new event
    await authenticatedAdminPage.reload();
    await authenticatedAdminPage.waitForLoadState('networkidle');

    // Verify event appears in UI
    const adminPage = new AdminPage(authenticatedAdminPage);
    await expect(authenticatedAdminPage.locator(`text="${eventName}"`)).toBeVisible();
  });

  /**
   * Example 5: Mobile-specific test
   *
   * What this demonstrates:
   * ✅ Device-specific behavior
   * ✅ Mobile helper utilities
   * ✅ Responsive design testing
   */
  test('should work on mobile devices', async ({ authenticatedAdminPage, mobile }) => {
    // Skip if not mobile
    test.skip(!mobile.isMobile, 'This test is mobile-specific');

    const adminPage = new AdminPage(authenticatedAdminPage);

    // Mobile: May need to open menu
    await mobile.openMenu();

    // Create event (same code works on mobile!)
    const eventId = await adminPage.createEvent('Mobile Test Event');
    createdEventIds.push(eventId);

    // Verify event card is visible in viewport
    const eventCard = authenticatedAdminPage.locator(adminPage.eventCard);
    await expect(eventCard).toBeVisibleInViewport();
  });

  /**
   * Example 6: Error handling pattern
   *
   * What this demonstrates:
   * ✅ Graceful failure handling
   * ✅ Screenshot on error
   * ✅ Helpful error messages
   */
  test('should handle errors gracefully', async ({ authenticatedAdminPage }) => {
    const adminPage = new AdminPage(authenticatedAdminPage);

    try {
      // Try to create event with invalid data
      await adminPage.fill(adminPage.eventNameInput, ''); // Empty name
      await adminPage.click(adminPage.eventSubmitButton);

      // Expect error message or validation
      const errorMessage = authenticatedAdminPage.locator(
        '[data-testid="error-message"], .error, [role="alert"]'
      );
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    } catch (error) {
      // Take screenshot for debugging
      await adminPage.screenshot('error-handling-test');
      throw error;
    }
  });
});

/**
 * Performance Test Suite
 *
 * What this demonstrates:
 * ✅ Testing across different devices
 * ✅ Performance awareness
 */
test.describe('Performance Tests', () => {
  test('should load admin page quickly', async ({ authenticatedAdminPage, mobile }) => {
    const startTime = Date.now();

    // Page already loaded by fixture
    const loadTime = Date.now() - startTime;

    // Mobile: Allow longer load time
    const maxLoadTime = mobile.isMobile ? 5000 : 3000;

    console.log(`⏱️  Load time: ${loadTime}ms (max: ${maxLoadTime}ms)`);
    expect(loadTime).toBeLessThan(maxLoadTime);
  });
});
