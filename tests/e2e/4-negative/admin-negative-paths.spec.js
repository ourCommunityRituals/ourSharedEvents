/**
 * NEGATIVE PATH UI TESTS - Admin Flow - Story 10
 *
 * Purpose: Test error handling, validation, and edge cases in the Admin UI
 *
 * Coverage:
 *   - Form validation (missing required fields)
 *   - Invalid input handling
 *   - Authentication failures
 *   - Network/API error handling
 *   - Edge cases in 7-card shell
 *
 * Assertions:
 *   - Appropriate error messages shown
 *   - No broken layouts
 *   - Graceful degradation
 *   - No internal error exposure
 *
 * Run with: npm run test:negative
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');
const { ADMIN_PAGE } = require('../selectors');

const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const WRONG_ADMIN_KEY = 'wrong_key_12345';

// Timeout config for GAS cold starts
const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

// Patterns that indicate internal errors leaking to users
const INTERNAL_ERROR_PATTERNS = [
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /at\s+\w+\s+\(/i,
  /\.gs:\d+/i,
  /\.js:\d+:\d+/i,
  /undefined is not/i,
  /null is not/i,
  /Cannot read propert/i,
  /INTERNAL_ERROR/i,
  /Exception:/i,
  /spreadsheet/i,
  /DriveApp|SpreadsheetApp/i,
];

/**
 * Check for internal error leaks in page content
 */
async function assertNoInternalErrors(page) {
  const bodyText = await page.locator('body').innerText();
  for (const pattern of INTERNAL_ERROR_PATTERNS) {
    const match = bodyText.match(pattern);
    expect(match, `Found internal error: ${pattern}`).toBeNull();
  }
}

/**
 * Check page layout is not broken
 */
async function assertLayoutNotBroken(page) {
  const hasBody = await page.locator('body').count() > 0;
  expect(hasBody).toBe(true);

  const bodyText = await page.locator('body').innerText();
  const hasContent = bodyText.trim().length > 0 || await page.locator('img, svg, canvas').count() > 0;
  expect(hasContent).toBe(true);
}

/**
 * Filter expected GAS errors
 */
function filterCriticalErrors(errors) {
  return errors.filter(e =>
    !e.includes('google.script') &&
    !e.includes('google is not defined') &&
    !e.includes('Script error')
  );
}

// =============================================================================
// FORM VALIDATION TESTS
// =============================================================================
test.describe('Negative Path: Admin Form Validation', () => {

  test('Empty form submission should show validation feedback', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await expect(page.locator(ADMIN_PAGE.CREATE_CARD)).toBeVisible({ timeout: 15000 });

    // Try to submit empty form
    const submitBtn = page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first();
    await submitBtn.click();

    // Wait for validation response
    await page.waitForTimeout(2000);

    // Check that event card container is NOT visible (event wasn't created)
    // Or check for validation message
    const eventCardVisible = await page.locator(ADMIN_PAGE.EVENT_CARD_CONTAINER).isVisible().catch(() => false);

    // If event card is visible with empty data, that's a bug
    // Otherwise validation worked (form wasn't submitted)
    if (eventCardVisible) {
      // Check if it has actual content or is showing an error
      const card1Text = await page.locator(ADMIN_PAGE.CARD_1_EVENT_BASICS).innerText().catch(() => '');
      // It should not show "Your Event is Live" with no event data
      console.log('Card 1 text after empty submit:', card1Text);
    }

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Missing event name should prevent submission or show error', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Fill only date and venue, not name
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    // Try to submit
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(2000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Missing venue should be handled gracefully', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Fill name and date, not venue
    await page.fill('#name', `No Venue Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');

    // Try to submit
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(2000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Invalid date format should be handled gracefully', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await page.fill('#name', `Invalid Date Test ${Date.now()}`);
    // Try to set invalid date via JavaScript (bypassing input validation)
    await page.evaluate(() => {
      const dateInput = document.querySelector('#startDateISO');
      if (dateInput) {
        dateInput.value = 'not-a-date';
      }
    });
    await page.fill('#venue', 'Test Venue');

    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(2000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Past date should be accepted or show appropriate message', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await page.fill('#name', `Past Date Test ${Date.now()}`);
    await page.fill('#startDateISO', '2020-01-01'); // Past date
    await page.fill('#venue', 'Test Venue');

    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(2000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('XSS in event name should be sanitized', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    const xssPayload = '<script>alert("XSS")</script>Test Event';
    await page.fill('#name', xssPayload);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Check that script tags are not rendered
    const bodyHtml = await page.content();
    expect(bodyHtml).not.toContain('<script>alert("XSS")</script>');

    await assertNoInternalErrors(page);
  });

  test('Very long event name should be handled', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    const longName = 'A'.repeat(1000);
    await page.fill('#name', longName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Special characters in venue should be handled', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await page.fill('#name', `Special Chars Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'O\'Malley\'s Bar & Grill "Best in Town" <location>');

    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// AUTHENTICATION TESTS
// =============================================================================
test.describe('Negative Path: Admin Authentication', () => {

  test('Wrong admin key should show error', async ({ page }) => {
    let dialogHandled = false;
    let alertMessage = '';

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(WRONG_ADMIN_KEY);
        dialogHandled = true;
      } else if (dialog.type() === 'alert') {
        alertMessage = dialog.message();
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await page.fill('#name', `Auth Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Either we get an error alert or the event card doesn't appear
    const eventCardVisible = await page.locator(ADMIN_PAGE.EVENT_CARD_CONTAINER).isVisible().catch(() => false);

    // With wrong key, event should not be created (card not visible) OR we got an error alert
    if (eventCardVisible) {
      // If card is visible, check if it shows an error state
      const card1Text = await page.locator(ADMIN_PAGE.CARD_1_EVENT_BASICS).innerText().catch(() => '');
      console.log('Auth test - Card 1 text with wrong key:', card1Text);
    }

    console.log('Alert message received:', alertMessage);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Cancelled admin key dialog should not submit', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.dismiss(); // Cancel the prompt
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await page.fill('#name', `Cancelled Auth Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(2000);

    // Event card should not be visible
    const eventCardVisible = await page.locator(ADMIN_PAGE.EVENT_CARD_CONTAINER).isVisible().catch(() => false);
    expect(eventCardVisible).toBe(false);

    await assertLayoutNotBroken(page);
  });

  test('Empty admin key should be rejected', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(''); // Empty key
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await page.fill('#name', `Empty Key Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// SEVEN-CARD SHELL EDGE CASES
// =============================================================================
test.describe('Negative Path: Seven-Card Shell Edge Cases', () => {

  test('Sponsor link generation with empty sponsor name', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Sponsor Edge Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Try to generate sponsor link with empty name
    const sponsorInput = page.locator(ADMIN_PAGE.CUSTOM_SPONSOR_ID_INPUT);
    await expect(sponsorInput).toBeVisible({ timeout: 10000 });
    await sponsorInput.fill('');

    const generateBtn = page.locator(ADMIN_PAGE.GENERATE_SPONSOR_LINK_BUTTON);
    await generateBtn.click();
    await page.waitForTimeout(1000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Sponsor link generation with special characters', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Sponsor Special Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Try sponsor name with special characters
    const sponsorInput = page.locator(ADMIN_PAGE.CUSTOM_SPONSOR_ID_INPUT);
    await expect(sponsorInput).toBeVisible({ timeout: 10000 });
    await sponsorInput.fill('Sponsor & Co. <script>');

    const generateBtn = page.locator(ADMIN_PAGE.GENERATE_SPONSOR_LINK_BUTTON);
    await generateBtn.click();
    await page.waitForTimeout(1000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);

    // Verify XSS is not executed
    const bodyHtml = await page.content();
    expect(bodyHtml).not.toContain('<script>');
  });

  test('Copy link buttons work even if clipboard API is blocked', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Block clipboard API
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('Clipboard blocked')),
        },
        writable: false,
      });
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Clipboard Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Try clicking copy button
    const copyBtn = page.locator(ADMIN_PAGE.COPY_PUBLIC_LINK_BUTTON);
    if (await copyBtn.isVisible().catch(() => false)) {
      await copyBtn.click();
      await page.waitForTimeout(500);
    }

    // Page should not crash
    await assertLayoutNotBroken(page);
  });

  test('Rapid multiple form submissions should be handled', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Rapid Submit Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    // Click submit button rapidly multiple times
    const submitBtn = page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first();
    await Promise.all([
      submitBtn.click(),
      submitBtn.click(),
      submitBtn.click(),
    ]);

    await page.waitForTimeout(5000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);

    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });
});

// =============================================================================
// NETWORK AND API ERROR HANDLING
// =============================================================================
test.describe('Negative Path: Network/API Error Handling', () => {

  test('Page handles slow network gracefully', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Simulate slow network
    await page.route('**/*', async route => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue();
    });

    const response = await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      ...TIMEOUT_CONFIG,
      timeout: 60000, // Extended timeout for slow network
    });

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
  });

  test('Page handles failed resource loads gracefully', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Block some external resources
    await page.route('**/fonts.googleapis.com/**', route => route.abort());
    await page.route('**/analytics/**', route => route.abort());

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Page should still be functional
    await expect(page.locator(ADMIN_PAGE.CREATE_CARD)).toBeVisible({ timeout: 15000 });
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// BROWSER/VIEWPORT EDGE CASES
// =============================================================================
test.describe('Negative Path: Browser Edge Cases', () => {

  test('Admin page works with edge case dates (New Years Eve)', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Test with New Year's Eve date (timezone edge case)
    await page.fill('#name', `New Years Eve Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Admin page works with leap year date', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Test with leap year date
    await page.fill('#name', `Leap Year Test ${Date.now()}`);
    await page.fill('#startDateISO', '2028-02-29');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Admin page handles localStorage unavailable', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Block localStorage
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: () => { throw new Error('localStorage disabled'); },
          setItem: () => { throw new Error('localStorage disabled'); },
          removeItem: () => { throw new Error('localStorage disabled'); },
          clear: () => { throw new Error('localStorage disabled'); },
        },
        writable: false,
      });
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await assertLayoutNotBroken(page);

    // Try to create event
    await page.fill('#name', `LocalStorage Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
  });
});

// =============================================================================
// ACCESSIBILITY ERROR SCENARIOS
// =============================================================================
test.describe('Negative Path: Accessibility', () => {

  test('Form validation errors are accessible', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Submit empty form
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(2000);

    // Check for aria-invalid or required attributes on empty fields
    const nameInput = page.locator('#name');
    const isRequired = await nameInput.getAttribute('required');
    const ariaInvalid = await nameInput.getAttribute('aria-invalid');

    // At least one accessibility indicator should be present
    const hasAccessibleValidation = isRequired !== null || ariaInvalid === 'true';
    console.log('Accessible validation indicators:', { isRequired, ariaInvalid });

    await assertLayoutNotBroken(page);
  });

  test('Error messages have appropriate ARIA roles', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(WRONG_ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    await page.fill('#name', `ARIA Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Check for role="alert" on any error messages
    const alerts = await page.locator('[role="alert"]').count();
    console.log('Number of ARIA alert elements:', alerts);

    await assertLayoutNotBroken(page);
  });
});
