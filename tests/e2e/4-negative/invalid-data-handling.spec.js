/**
 * INVALID DATA HANDLING TESTS - Story 4.4
 *
 * Purpose: Test error handling when API returns invalid or unexpected data
 *
 * Coverage:
 *   - Malformed JSON responses
 *   - Empty response bodies
 *   - Unexpected schema (missing/extra fields)
 *   - Null values in required fields
 *   - Extremely large payloads
 *   - XSS payload injection attempts
 *
 * Assertions:
 *   - No JSON parse errors exposed to user
 *   - Defensive rendering handles missing data
 *   - No browser freeze on large data
 *   - XSS payloads are escaped
 *   - Page remains usable
 *
 * @see docs/qa/NEGATIVE_TEST_PLAN.md - Test plan document
 * @see src/mvp/GlobalErrorHandler.html - Error handler implementation
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

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
  /JSON\.parse/i,
  /Unexpected token/i,
  /at position \d+/i,
  /at\s+\w+\s+\(/i,
  /\.gs:\d+/i,
  /\.js:\d+:\d+/i,
  /undefined is not/i,
  /null is not/i,
  /Cannot read propert/i,
];

/**
 * Check for internal error leaks in page content
 */
async function assertNoInternalErrors(page) {
  const bodyText = await page.locator('body').innerText();
  for (const pattern of INTERNAL_ERROR_PATTERNS) {
    const match = bodyText.match(pattern);
    expect(match, `Internal error leaked to UI: ${pattern}`).toBeNull();
  }
}

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

/**
 * Check that XSS is not executed
 */
async function assertNoXSSExecution(page) {
  // Check if any XSS alert was triggered
  const xssTriggered = await page.evaluate(() => {
    return window.__xss_triggered__ === true;
  }).catch(() => false);

  expect(xssTriggered, 'XSS should not be executed').toBe(false);
}

// =============================================================================
// MALFORMED JSON TESTS
// =============================================================================
test.describe('DATA-001: Malformed JSON Response', () => {

  test('Page handles completely invalid JSON gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not valid json at all'
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles truncated JSON gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok": true, "value": {"events": [{"name": "Test"'
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles JSON with BOM character gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '\uFEFF{"ok": true, "value": {"events": []}}'
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles JSON with trailing comma gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok": true, "value": {"events": []},}'
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// EMPTY RESPONSE TESTS
// =============================================================================
test.describe('DATA-002: Empty Response Body', () => {

  test('Page handles empty response body gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: ''
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles null JSON response gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: 'null'
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles empty object response gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles empty array response gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: { events: [] }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// UNEXPECTED SCHEMA TESTS
// =============================================================================
test.describe('DATA-003: Unexpected Schema', () => {

  test('Page handles missing required fields gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          // Missing 'events' field
          somethingElse: 'data'
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles events with missing properties gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            { id: '1' }, // Missing name, date, venue
            { name: 'Event 2' }, // Missing id, date, venue
            { id: '3', name: 'Event 3', date: '2025-12-31' }, // Missing venue
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles extra unexpected fields gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            {
              id: '1',
              name: 'Test Event',
              date: '2025-12-31',
              venue: 'Test Venue',
              unexpectedField: 'some value',
              anotherUnexpected: { nested: true },
              constructor: { prototype: 'ignored' }, // Suspicious-looking field
              toString: 'override attempt', // Another suspicious field
            }
          ],
          extraTopLevel: 'ignored',
          anotherExtra: [1, 2, 3]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles wrong data types gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: 'this should be an array', // String instead of array
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// NULL VALUES TESTS
// =============================================================================
test.describe('DATA-004: Null Values in Required Fields', () => {

  test('Page handles null event name gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            { id: '1', name: null, date: '2025-12-31', venue: 'Test Venue' }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles null date gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            { id: '1', name: 'Test Event', date: null, venue: 'Test Venue' }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles undefined values gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            { id: '1', name: 'Test Event', date: undefined, venue: undefined }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles all-null event gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            { id: null, name: null, date: null, venue: null }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// LARGE PAYLOAD TESTS
// =============================================================================
test.describe('DATA-005: Extremely Large Payload', () => {

  test('Page handles large number of events gracefully', async ({ page }) => {
    // Generate 1000 events
    const events = [];
    for (let i = 0; i < 1000; i++) {
      events.push({
        id: `event-${i}`,
        name: `Test Event ${i}`,
        date: '2025-12-31',
        venue: `Venue ${i}`
      });
    }

    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: { events }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(5000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles very long string values gracefully', async ({ page }) => {
    const longString = 'A'.repeat(100000); // 100KB string

    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            { id: '1', name: longString, date: '2025-12-31', venue: longString }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(5000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles deeply nested objects gracefully', async ({ page }) => {
    // Create deeply nested object
    let nested = { level: 50 };
    for (let i = 49; i >= 0; i--) {
      nested = { level: i, child: nested };
    }

    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            { id: '1', name: 'Test', date: '2025-12-31', venue: 'Test', metadata: nested }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// XSS PAYLOAD TESTS
// =============================================================================
test.describe('DATA-006: XSS Payload Handling', () => {

  test('Script tags in event name are escaped', async ({ page }) => {
    // Set up XSS detection
    await page.addInitScript(() => {
      window.__xss_triggered__ = false;
      window.xssTest = () => { window.__xss_triggered__ = true; };
    });

    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            {
              id: '1',
              name: '<script>window.xssTest()</script>Test Event',
              date: '2025-12-31',
              venue: 'Test Venue'
            }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoXSSExecution(page);
    await assertLayoutNotBroken(page);

    // Check that script tag is not rendered as HTML
    const pageContent = await page.content();
    expect(pageContent).not.toContain('<script>window.xssTest()</script>');
  });

  test('Event handler XSS in venue is escaped', async ({ page }) => {
    await page.addInitScript(() => {
      window.__xss_triggered__ = false;
      window.xssTest = () => { window.__xss_triggered__ = true; };
    });

    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            {
              id: '1',
              name: 'Test Event',
              date: '2025-12-31',
              venue: '<img src=x onerror="window.xssTest()">'
            }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoXSSExecution(page);
    await assertLayoutNotBroken(page);
  });

  test('JavaScript protocol XSS in links is escaped', async ({ page }) => {
    await page.addInitScript(() => {
      window.__xss_triggered__ = false;
      window.xssTest = () => { window.__xss_triggered__ = true; };
    });

    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            {
              id: '1',
              name: 'Test Event',
              date: '2025-12-31',
              venue: 'Test Venue',
              links: {
                registration: 'javascript:window.xssTest()'
              }
            }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoXSSExecution(page);
    await assertLayoutNotBroken(page);
  });

  test('SVG XSS payload is escaped', async ({ page }) => {
    await page.addInitScript(() => {
      window.__xss_triggered__ = false;
      window.xssTest = () => { window.__xss_triggered__ = true; };
    });

    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            {
              id: '1',
              name: '<svg onload="window.xssTest()">Test</svg>',
              date: '2025-12-31',
              venue: 'Test Venue'
            }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoXSSExecution(page);
    await assertLayoutNotBroken(page);
  });

  test('HTML entities in data are handled correctly', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        value: {
          events: [
            {
              id: '1',
              name: '&lt;script&gt;alert(1)&lt;/script&gt;',
              date: '2025-12-31',
              venue: 'O\'Malley\'s Bar & Grill "Best" <local>'
            }
          ]
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// MULTI-SURFACE INVALID DATA TESTS
// =============================================================================
test.describe('All Surfaces Handle Invalid Data', () => {

  const surfaces = ['public', 'display', 'poster'];

  for (const surface of surfaces) {
    test(`${surface} handles malformed JSON gracefully`, async ({ page }) => {
      await page.route('**/api/**', route => route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json'
      }));

      await page.goto(`${BASE_URL}?page=${surface}&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
      await page.waitForTimeout(3000);

      await assertNoInternalErrors(page);
      await assertLayoutNotBroken(page);
      await assertPageNotFrozen(page);
    });

    test(`${surface} handles missing data fields gracefully`, async ({ page }) => {
      await page.route('**/api/**', route => route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          value: {}
        })
      }));

      await page.goto(`${BASE_URL}?page=${surface}&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
      await page.waitForTimeout(3000);

      await assertNoInternalErrors(page);
      await assertLayoutNotBroken(page);
      await assertPageNotFrozen(page);
    });
  }
});
