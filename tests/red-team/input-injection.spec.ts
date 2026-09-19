/**
 * RED TEAM — Input Injection Tests
 *
 * Verifies that OSE correctly sanitizes, rejects, or size-limits hostile
 * input submitted through the public-facing form endpoints. These tests
 * check the boundary between the network and the application layer — not
 * the browser DOM — so most use the Playwright APIRequestContext (fetch).
 *
 * Threat model:
 *   - XSS stored via form name field, reflected on admin or display surfaces
 *   - SQL injection via event ID path parameter or form body field
 *   - Oversized payload (17 KB) bypassing body-size limits
 *   - Malformed JSON causing verbose error responses
 *
 * Environment variables:
 *   BASE_URL        — override target (default: https://stg.oursharedevents.com)
 *   ADMIN_KEY       — valid Bearer token (used to read-back stored values)
 *   X_OCR_INTERNAL  — internal auth secret
 *   SMOKE_EVENT_ID  — a real staging event ID for form submission tests
 *
 * Test IDs:
 *   INJ-001  XSS payload in form name field → stored sanitized or rejected
 *   INJ-002  SQL injection in event ID path → 400 or safe query (not 500)
 *   INJ-003  SQL injection in form body field → 400 or sanitized
 *   INJ-004  Oversized payload (17 KB) → 413 or 400 (not 200 or 500)
 *   INJ-005  Malformed JSON body → 400 with safe error message
 *   INJ-006  XSS payload not reflected unescaped in subsequent GET response
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') ?? 'https://stg.oursharedevents.com';

const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';

/**
 * Use SMOKE_EVENT_ID when available (a real event on staging).
 * Fallback: a fixture ID. If the event doesn't exist the endpoint returns
 * 404 before reaching form processing — we note that in assertions.
 */
const FIXTURE_EVENT_ID = process.env.SMOKE_EVENT_ID ?? 'evt_fixture_001';

// ─── Payloads ─────────────────────────────────────────────────────────────────

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'; DROP TABLE events; --",
  '<svg onload=alert(document.cookie)>',
  'javascript:alert(1)',
  '{{7*7}}', // template injection probe
];

const SQL_INJECTION_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE events; --",
  "' UNION SELECT id, title, 1, 1, 1, 1 FROM events --",
  '1; SELECT * FROM events',
  "' OR 1=1 --",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adminHeaders(): Record<string, string> {
  if (X_OCR_INTERNAL) return { 'X-OCR-Internal': X_OCR_INTERNAL };
  if (ADMIN_KEY) return { Authorization: `Bearer ${ADMIN_KEY}` };
  return {};
}

/**
 * Check that a response body contains no unescaped HTML special characters
 * that could indicate XSS reflection in a JSON field value.
 */
function assertNoUnescapedHtml(value: string, label: string): void {
  // In a JSON API response the dangerous chars should be escaped or absent
  const unescapedTagPattern = /<script|<img|<svg|onerror=|onload=/i;
  expect(
    unescapedTagPattern.test(value),
    `Unescaped HTML/JS found in ${label}: ${value.slice(0, 200)}`
  ).toBe(false);
}

/**
 * Assert a response body does not contain internal implementation details.
 */
async function assertSafeErrorBody(body: string, label: string): Promise<void> {
  const leakPatterns: Array<[RegExp, string]> = [
    [/TypeError:/i, 'JS error type'],
    [/at\s+\w+\s+\(.*:\d+:\d+\)/m, 'stack trace'],
    [/SELECT\s+.*FROM/i, 'SQL statement'],
    [/sqlite_/i, 'SQLite internals'],
    [/D1_ERROR/i, 'D1 error code'],
  ];

  for (const [pattern, description] of leakPatterns) {
    expect(
      pattern.test(body),
      `${label} — response body leaks "${description}": ${body.slice(0, 300)}`
    ).toBe(false);
  }
}

// ─── INJ-001 — XSS in form name field ────────────────────────────────────────

test.describe('INJ-001 — XSS payload in form name field is stored sanitized', () => {
  for (const payload of XSS_PAYLOADS) {
    test(`XSS payload "${payload.slice(0, 40)}" is rejected or sanitized`, async ({ request }) => {
      const endpoint = `${BASE_URL}/api/v2/events/${FIXTURE_EVENT_ID}/forms/register`;

      const response = await request.post(endpoint, {
        data: {
          name: payload,
          email: 'redteam@example.com',
        },
        headers: { 'Content-Type': 'application/json' },
      });

      const status = response.status();
      let body = '';
      try {
        body = await response.text();
      } catch {
        body = '';
      }

      // 404 means the fixture event doesn't exist — that's OK, the test
      // still verifies the payload didn't cause a 500 or leak info.
      if (status === 404) {
        // Event not found — form was never processed; nothing stored.
        // Still verify no leakage in the 404 response.
        await assertSafeErrorBody(body, `XSS probe 404 for "${payload.slice(0, 40)}"`);
        return;
      }

      // Any 4xx is an acceptable rejection (400 = validation error)
      // 201 / 200 means it was accepted — we must then verify sanitization
      if (status >= 400 && status < 500) {
        // Rejected at the API layer — correct
        await assertSafeErrorBody(body, `XSS rejection for "${payload.slice(0, 40)}"`);
        return;
      }

      // 500 is always wrong
      expect(status, `XSS payload caused a 500: "${payload.slice(0, 60)}"`).not.toBe(500);

      if (status >= 200 && status < 300) {
        // Accepted — body MUST NOT echo back unescaped payload
        assertNoUnescapedHtml(body, `POST response echoing "${payload.slice(0, 40)}"`);

        // If accepted, check the echo in the response JSON
        try {
          const json = JSON.parse(body);
          const storedName = JSON.stringify(json);
          assertNoUnescapedHtml(storedName, `stored name field for "${payload.slice(0, 40)}"`);
        } catch {
          // Non-JSON response — already checked body above
        }
      }
    });
  }
});

// ─── INJ-006 — XSS not reflected unescaped in subsequent GET ─────────────────

test.describe('INJ-006 — XSS payload not reflected unescaped in GET response', () => {
  test.skip(
    !ADMIN_KEY && !X_OCR_INTERNAL,
    'Admin auth not set — skipping XSS readback test (set ADMIN_KEY or X_OCR_INTERNAL)'
  );

  test('Stored XSS payload appears escaped in admin GET /api/v2/admin/events', async ({
    request,
  }) => {
    const UNIQUE_PAYLOAD = `<script>alert('xss-${Date.now()}')</script>`;

    // 1. Submit the payload via the public email-signup form
    const eventId = FIXTURE_EVENT_ID;
    await request.post(`${BASE_URL}/api/v2/events/${eventId}/forms/email-signup`, {
      data: { name: UNIQUE_PAYLOAD, email: 'redteam-xss@example.com' },
      headers: { 'Content-Type': 'application/json' },
    });

    // 2. Read it back through the admin endpoint
    const readResponse = await request.get(`${BASE_URL}/api/v2/admin/events`, {
      headers: adminHeaders(),
      maxRedirects: 0,
    });

    if (
      readResponse.status() === 401 ||
      readResponse.status() === 403 ||
      (readResponse.status() >= 300 && readResponse.status() < 400)
    ) {
      test.skip(true, 'Admin endpoint is gated — cannot verify readback');
      return;
    }

    const body = await readResponse.text();

    // The payload should NOT appear unescaped in the JSON body.
    // If it's stored, it must be HTML-entity-encoded or stripped.
    assertNoUnescapedHtml(body, 'admin GET response after XSS submission');
  });
});

// ─── INJ-002 — SQL injection in event ID path ────────────────────────────────

test.describe('INJ-002 — SQL injection payloads in event ID path parameter', () => {
  for (const payload of SQL_INJECTION_PAYLOADS) {
    const encodedPayload = encodeURIComponent(payload);

    test(`SQL injection in path "${payload.slice(0, 40)}" → 400 or 404 (not 500)`, async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v2/events/${encodedPayload}`);

      const status = response.status();
      const body = await response.text();

      // 500 means the injection reached the DB and caused an unhandled error
      expect(status, `SQL injection in path caused 500: "${payload}"`).not.toBe(500);

      // Must be 400 (invalid format) or 404 (not found after safe lookup)
      expect(
        [400, 404],
        `SQL injection in path returned ${status} — expected 400 or 404: "${payload}"`
      ).toContain(status);

      await assertSafeErrorBody(body, `SQL injection in path "${payload.slice(0, 40)}"`);
    });
  }
});

// ─── INJ-003 — SQL injection in form body ────────────────────────────────────

test.describe('INJ-003 — SQL injection payloads in form body fields', () => {
  for (const payload of SQL_INJECTION_PAYLOADS) {
    test(`SQL injection in email field "${payload.slice(0, 40)}" → 400 or 404 (not 500)`, async ({
      request,
    }) => {
      const response = await request.post(
        `${BASE_URL}/api/v2/events/${FIXTURE_EVENT_ID}/forms/register`,
        {
          data: {
            name: 'Red Team Test',
            email: payload,
          },
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const status = response.status();
      const body = await response.text();

      expect(status, `SQL injection in email body caused 500: "${payload}"`).not.toBe(500);

      // Valid responses: 400 (validation), 404 (event not found), 422 (unprocessable)
      // Not 200/201 — a SQL payload is not a valid email address
      if (status >= 200 && status < 300) {
        // Accepted — verify the payload was not echoed unescaped
        await assertSafeErrorBody(body, `SQL injection accepted in body "${payload.slice(0, 40)}"`);
      } else {
        expect(
          [400, 404, 422],
          `SQL injection in body returned ${status} — expected 400, 404, or 422: "${payload}"`
        ).toContain(status);
        await assertSafeErrorBody(body, `SQL injection rejected: "${payload.slice(0, 40)}"`);
      }
    });
  }
});

// ─── INJ-004 — Oversized payload ─────────────────────────────────────────────

test.describe('INJ-004 — Oversized payload is rejected cleanly', () => {
  test('17 KB JSON payload → 413 or 400 (not 200 or 500)', async ({ request }) => {
    // 17 KB string that exceeds any reasonable field size limit
    const SEVENTEEN_KB = 'A'.repeat(17 * 1024);

    const response = await request.post(
      `${BASE_URL}/api/v2/events/${FIXTURE_EVENT_ID}/forms/register`,
      {
        data: {
          name: SEVENTEEN_KB,
          email: 'oversize@example.com',
        },
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const status = response.status();
    const body = await response.text();

    expect(status, `17 KB payload returned 500 — unhandled oversized input`).not.toBe(500);

    expect(status, `17 KB payload returned 200 — accepted without size validation`).not.toBe(200);

    expect(status, `17 KB payload returned 201 — accepted without size validation`).not.toBe(201);

    // Must be 400 (validation reject), 413 (too large), 404 (event not found first)
    expect(
      [400, 404, 413],
      `17 KB payload returned ${status} — expected 400, 413, or 404`
    ).toContain(status);

    await assertSafeErrorBody(body, '17 KB payload response');
  });

  test('17 KB JSON body at the top level → 413 or 400', async ({ request }) => {
    // Build a JSON body that is 17 KB total
    const largeBody = JSON.stringify({
      name: 'Normal Name',
      email: 'normal@example.com',
      extra: 'X'.repeat(17 * 1024),
    });

    const response = await request.post(
      `${BASE_URL}/api/v2/events/${FIXTURE_EVENT_ID}/forms/register`,
      {
        data: largeBody,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    expect(response.status()).not.toBe(500);
    expect([400, 404, 413]).toContain(response.status());
  });
});

// ─── INJ-005 — Malformed JSON body ───────────────────────────────────────────

test.describe('INJ-005 — Malformed JSON body returns 400 with safe error message', () => {
  const MALFORMED_BODIES = [
    { label: 'truncated JSON', body: '{"name": "test"' },
    { label: 'invalid escape sequence', body: '{"name": "\\z"}' },
    { label: 'trailing comma', body: '{"name": "test",}' },
    { label: 'bare string', body: 'just a string, not JSON' },
    { label: 'null byte injection', body: '{"name": "test\x00value"}' },
    { label: 'array instead of object', body: '[1, 2, 3]' },
    { label: 'deeply nested', body: JSON.stringify(buildDeepObject(200)) },
  ];

  for (const { label, body } of MALFORMED_BODIES) {
    test(`Malformed JSON "${label}" → 400 with safe message`, async ({ request }) => {
      const response = await request.post(
        `${BASE_URL}/api/v2/events/${FIXTURE_EVENT_ID}/forms/register`,
        {
          data: body,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const status = response.status();
      const responseBody = await response.text();

      // 500 means the JSON parse error was unhandled
      expect(status, `Malformed JSON "${label}" caused 500`).not.toBe(500);

      // 200/201 means malformed input was accepted — unexpected
      if (status === 200 || status === 201) {
        // Only acceptable if it parsed something safe (e.g. array body
        // was coerced to empty). Check for no injection in response.
        await assertSafeErrorBody(responseBody, `Malformed JSON accepted "${label}"`);
      } else {
        expect(
          [400, 404, 415, 422, 429],
          `Malformed JSON "${label}" returned ${status} — expected a safe client or rate-limit response`
        ).toContain(status);
      }

      await assertSafeErrorBody(responseBody, `Malformed JSON "${label}" response body`);

      // The error message should be generic — no parser internals
      if (responseBody.includes('SyntaxError') || responseBody.includes('Unexpected token')) {
        throw new Error(
          `Malformed JSON "${label}" — raw parser error leaked to client: ${responseBody.slice(0, 200)}`
        );
      }
    });
  }
});

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Build a deeply nested object to probe JSON depth limits.
 * { a: { a: { a: ... } } } N levels deep.
 */
function buildDeepObject(depth: number): Record<string, unknown> {
  let obj: Record<string, unknown> = { value: 'leaf' };
  for (let i = 0; i < depth; i++) {
    obj = { a: obj };
  }
  return obj;
}
