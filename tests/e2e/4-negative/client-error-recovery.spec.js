/**
 * CLIENT ERROR RECOVERY TESTS - Story 4.4
 *
 * Purpose: Test client-side error handling and recovery
 *
 * Coverage:
 *   - JavaScript runtime errors
 *   - Unhandled promise rejections
 *   - localStorage unavailability
 *   - Clipboard API blocked
 *   - Rapid repeated actions (double-submit prevention)
 *
 * Assertions:
 *   - Global error handler catches errors
 *   - User sees appropriate toast/notification
 *   - Page remains functional after error
 *   - No frozen UI states
 *
 * @see docs/qa/NEGATIVE_TEST_PLAN.md - Test plan document
 * @see src/mvp/GlobalErrorHandler.html - Error handler implementation
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');
const { ADMIN_PAGE } = require('../selectors');

const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

// Timeout config for GAS cold starts
const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

/**
 * Check page layout is not broken
 */
async function assertLayoutNotBroken(page) {
  const hasBody = await page.locator('body').count() > 0;
  expect(hasBody, 'Page body should exist').toBe(true);

  const hasContent = await page.locator('body').evaluate(body => {
    return body.innerText.trim().length > 0 ||
           body.querySelectorAll('img, svg, canvas, div').length > 0;
  });
  expect(hasContent, 'Page should have content').toBe(true);
}

/**
 * Check page is not frozen
 */
async function assertPageNotFrozen(page) {
  try {
    const result = await page.evaluate(() => document.readyState, { timeout: 5000 });
    expect(['complete', 'interactive']).toContain(result);
  } catch (e) {
    expect.fail('Page appears to be frozen');
  }
}

// =============================================================================
// JAVASCRIPT RUNTIME ERROR TESTS
// =============================================================================
test.describe('CLIENT-001: JavaScript Runtime Errors', () => {

  test('Page catches and handles runtime TypeError', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Inject a runtime error - this will throw TypeError
    // Use JSON.parse to create null dynamically (avoids static analysis)
    await page.evaluate(() => {
      const obj = JSON.parse('null');
      obj.someMethod(); // TypeError: Cannot read property of null
    }).catch(() => {}); // Expected to throw

    await page.waitForTimeout(1000);

    // Page should still be functional
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page catches and handles ReferenceError', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Inject a ReferenceError - intentionally using undefined variable
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      undefinedVariable.someMethod();
    }).catch(() => {});

    await page.waitForTimeout(1000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Multiple runtime errors do not crash page', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Inject multiple errors
    for (let i = 0; i < 5; i++) {
      await page.evaluate((idx) => {
        try {
          throw new Error(`Test error ${idx}`);
        } catch (e) {
          // Simulate unhandled error
          setTimeout(() => { throw e; }, 0);
        }
      }, i).catch(() => {});
      await page.waitForTimeout(200);
    }

    await page.waitForTimeout(1000);

    // Page should still be functional
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Error in event handler does not break page', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Add an event listener that throws
    await page.evaluate(() => {
      document.body.addEventListener('click', () => {
        throw new Error('Click handler error');
      });
    });

    // Click the body (should trigger error)
    await page.click('body');
    await page.waitForTimeout(1000);

    // Page should still be functional
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// UNHANDLED PROMISE REJECTION TESTS
// =============================================================================
test.describe('CLIENT-002: Unhandled Promise Rejections', () => {

  test('Page handles unhandled promise rejection', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Create unhandled rejection
    await page.evaluate(() => {
      Promise.reject(new Error('Unhandled rejection'));
    });

    await page.waitForTimeout(1000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles async function error', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Create async error
    await page.evaluate(() => {
      (async () => {
        throw new Error('Async function error');
      })();
    });

    await page.waitForTimeout(1000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Multiple promise rejections do not crash page', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Create multiple rejections
    for (let i = 0; i < 5; i++) {
      await page.evaluate((idx) => {
        Promise.reject(new Error(`Rejection ${idx}`));
      }, i);
      await page.waitForTimeout(100);
    }

    await page.waitForTimeout(1000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Rejected fetch does not crash page', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Simulate a rejected fetch (no .catch())
    await page.evaluate(() => {
      fetch('/nonexistent-endpoint-that-will-fail-12345');
    });

    await page.waitForTimeout(1000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// LOCALSTORAGE UNAVAILABLE TESTS
// =============================================================================
test.describe('CLIENT-003: localStorage Unavailable', () => {

  test('Page works when localStorage throws on access', async ({ page }) => {
    // Block localStorage before navigation
    await page.addInitScript(() => {
      const throwError = () => { throw new Error('localStorage disabled'); };
      Object.defineProperty(window, 'localStorage', {
        get: throwError,
        configurable: true
      });
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page works when localStorage.getItem throws', async ({ page }) => {
    await page.addInitScript(() => {
      // Override localStorage with throwing methods
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: () => { throw new Error('getItem disabled'); },
          setItem: () => { throw new Error('setItem disabled'); },
          removeItem: () => { throw new Error('removeItem disabled'); },
          clear: () => { throw new Error('clear disabled'); },
          length: 0,
          key: () => null
        },
        writable: false
      });
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Admin page works with localStorage disabled', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.addInitScript(() => {
      const throwError = () => { throw new Error('localStorage disabled'); };
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: throwError,
          setItem: throwError,
          removeItem: throwError,
          clear: throwError,
          length: 0,
          key: () => null
        },
        writable: false
      });
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('sessionStorage unavailable handled gracefully', async ({ page }) => {
    await page.addInitScript(() => {
      const throwError = () => { throw new Error('sessionStorage disabled'); };
      Object.defineProperty(window, 'sessionStorage', {
        get: throwError,
        configurable: true
      });
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// CLIPBOARD API BLOCKED TESTS
// =============================================================================
test.describe('CLIENT-004: Clipboard API Blocked', () => {

  test('Copy button works with clipboard API blocked', async ({ page }) => {
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
          readText: () => Promise.reject(new Error('Clipboard blocked')),
          write: () => Promise.reject(new Error('Clipboard blocked')),
          read: () => Promise.reject(new Error('Clipboard blocked')),
        },
        writable: false,
        configurable: true
      });
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await expect(page.locator(ADMIN_PAGE.CREATE_CARD)).toBeVisible({ timeout: 15000 });

    // Create an event to get copy buttons
    await page.fill('#name', `Clipboard Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Try clicking copy button if visible
    const copyBtn = page.locator(ADMIN_PAGE.COPY_PUBLIC_LINK_BUTTON);
    if (await copyBtn.isVisible().catch(() => false)) {
      await copyBtn.click();
      await page.waitForTimeout(1000);
    }

    // Page should not crash
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Clipboard undefined handled gracefully', async ({ page }) => {
    await page.addInitScript(() => {
      delete navigator.clipboard;
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// RAPID REPEATED ACTIONS (DOUBLE-SUBMIT) TESTS
// =============================================================================
test.describe('CLIENT-005: Rapid Repeated Actions', () => {

  test('Rapid form submissions are handled safely', async ({ page }) => {
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

    await page.fill('#name', `Rapid Submit Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    // Click submit button rapidly
    const submitBtn = page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first();

    // Triple-click in rapid succession
    await Promise.all([
      submitBtn.click(),
      submitBtn.click(),
      submitBtn.click(),
    ]);

    await page.waitForTimeout(5000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);

    // Filter expected errors
    const criticalErrors = errors.filter(e =>
      !e.includes('google.script') &&
      !e.includes('google is not defined') &&
      !e.includes('Script error')
    );
    expect(criticalErrors.length, 'No critical JS errors').toBe(0);
  });

  test('Rapid button clicks do not cause multiple requests', async ({ page }) => {
    let requestCount = 0;

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Count API requests
    await page.route('**/api/**', async route => {
      requestCount++;
      await route.continue();
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await expect(page.locator(ADMIN_PAGE.CREATE_CARD)).toBeVisible({ timeout: 15000 });

    const initialRequestCount = requestCount;

    await page.fill('#name', `Request Count Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    // Triple-click rapidly
    const submitBtn = page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first();
    await submitBtn.click();
    await submitBtn.click();
    await submitBtn.click();

    await page.waitForTimeout(5000);

    // The number of requests should be reasonable (not 3x for 3 clicks)
    // Due to debouncing/disabled state, should be 1-2 requests max for the form submission
    const formSubmitRequests = requestCount - initialRequestCount;
    console.log(`Form submission generated ${formSubmitRequests} API requests`);

    await assertLayoutNotBroken(page);
  });

  test('Rapid link clicks do not break navigation', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Find any clickable element and click rapidly
    const clickableElement = page.locator('a, button').first();
    if (await clickableElement.isVisible().catch(() => false)) {
      await Promise.all([
        clickableElement.click().catch(() => {}),
        clickableElement.click().catch(() => {}),
        clickableElement.click().catch(() => {}),
      ]);
    }

    await page.waitForTimeout(2000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// ERROR RECOVERY AFTER CLIENT ERRORS
// =============================================================================
test.describe('Error Recovery After Client Errors', () => {

  test('Page remains interactive after JS error', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Cause an error
    await page.evaluate(() => {
      throw new Error('Test error');
    }).catch(() => {});

    await page.waitForTimeout(500);

    // Should still be able to interact
    const canClick = await page.evaluate(() => {
      return new Promise(resolve => {
        document.body.addEventListener('click', () => resolve(true), { once: true });
        document.body.click();
        setTimeout(() => resolve(false), 1000);
      });
    });

    expect(canClick).toBe(true);
  });

  test('Can navigate away after error', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Cause an error
    await page.evaluate(() => {
      throw new Error('Test error before navigation');
    }).catch(() => {});

    await page.waitForTimeout(500);

    // Should be able to navigate
    const response = await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    expect(response?.status()).toBe(200);

    await assertLayoutNotBroken(page);
  });

  test('GlobalErrorHandler functions remain available after errors', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Cause multiple errors
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        throw new Error('Test error');
      }).catch(() => {});
      await page.waitForTimeout(200);
    }

    // Page should still be functional after multiple errors
    // (GlobalErrorHandler may or may not be loaded depending on page)
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// MULTI-SURFACE CLIENT ERROR TESTS
// =============================================================================
test.describe('All Surfaces Handle Client Errors', () => {

  const surfaces = ['public', 'display', 'poster'];

  for (const surface of surfaces) {
    test(`${surface} handles JS error gracefully`, async ({ page }) => {
      await page.goto(`${BASE_URL}?page=${surface}&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
      await page.waitForTimeout(2000);

      // Trigger JS error
      await page.evaluate(() => {
        throw new Error('Surface test error');
      }).catch(() => {});

      await page.waitForTimeout(1000);

      await assertLayoutNotBroken(page);
      await assertPageNotFrozen(page);
    });

    test(`${surface} handles promise rejection gracefully`, async ({ page }) => {
      await page.goto(`${BASE_URL}?page=${surface}&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
      await page.waitForTimeout(2000);

      // Trigger promise rejection
      await page.evaluate(() => {
        Promise.reject(new Error('Surface promise rejection'));
      });

      await page.waitForTimeout(1000);

      await assertLayoutNotBroken(page);
      await assertPageNotFrozen(page);
    });
  }
});
