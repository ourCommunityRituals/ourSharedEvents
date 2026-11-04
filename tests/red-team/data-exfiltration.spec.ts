/**
 * RED TEAM — Data Exfiltration Probes
 *
 * Verifies that OSE does not expose data through enumeration, unauthenticated
 * access to protected resources, or information-leaking error responses.
 *
 * Threat model:
 *   - Attacker sequentially enumerates event IDs to harvest all event data
 *   - Attacker accesses SharedReport or admin endpoints without credentials
 *   - Attacker crafts requests designed to trigger verbose error responses
 *
 * Environment variables:
 *   BASE_URL        — override target (default: https://stg.oursharedevents.com)
 *   ADMIN_KEY       — valid Bearer token (positive-control / cleanup only)
 *   X_OCR_INTERNAL  — internal auth secret
 *   SMOKE_EVENT_ID  — a real staging event ID (used for positive controls)
 *
 * Test IDs:
 *   EX-001  Sequential ID enumeration → 404 (not 403) for non-existent IDs
 *   EX-002  404 bodies do not disclose DB schema or implementation details
 *   EX-003  SharedReport without token → 401 (not 200 or 500)
 *   EX-004  Admin endpoints without auth → 401/403 (not 500)
 *   EX-005  /api/v2/admin/events without auth → 401/403 (not 500)
 *   EX-006  Error responses do not include stack traces or SQL
 */

import { test, expect, type APIResponse } from '@playwright/test';

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') ?? 'https://stg.oursharedevents.com';

const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';
const SMOKE_EVENT_ID = process.env.SMOKE_EVENT_ID ?? '';

// ─── Page Objects ─────────────────────────────────────────────────────────────

/**
 * Wraps a raw APIResponse and provides assertion helpers specific to
 * information-leakage scenarios.
 */
class SafeResponse {
  constructor(private readonly response: APIResponse) {}

  get status(): number {
    return this.response.status();
  }

  async bodyText(): Promise<string> {
    try {
      return await this.response.text();
    } catch {
      return '';
    }
  }

  async assertNoInternalLeakage(): Promise<void> {
    const body = await this.bodyText();

    const leakPatterns: Array<[RegExp, string]> = [
      [/TypeError:/i, 'JavaScript TypeError'],
      [/ReferenceError:/i, 'JavaScript ReferenceError'],
      [/at\s+\w+\s+\(.*:\d+:\d+\)/m, 'Stack trace line'],
      [/\.ts:\d+/i, 'TypeScript source reference'],
      [/\.js:\d+:\d+/i, 'JS source line reference'],
      [/SELECT\s+.*FROM/i, 'SQL SELECT statement'],
      [/INSERT\s+INTO/i, 'SQL INSERT statement'],
      [/D1_ERROR/i, 'D1 database error code'],
      [/sqlite_/i, 'SQLite internals'],
      [/FOREIGN KEY constraint/i, 'SQLite constraint error'],
      [/wrangler/i, 'Wrangler/toolchain name'],
      [/cloudflare workers/i, 'Platform implementation detail in error'],
      [/secret/i, 'Secret value (case-insensitive)'],
      [/ADMIN_KEY/i, 'ADMIN_KEY env var name'],
      [/X_OCR_INTERNAL/i, 'Internal auth secret name'],
    ];

    for (const [pattern, label] of leakPatterns) {
      expect(
        pattern.test(body),
        `Response body leaks "${label}". Body snippet: ${body.slice(0, 300)}`
      ).toBe(false);
    }
  }
}

// ─── EX-001 / EX-002 — Event ID Enumeration ──────────────────────────────────

test.describe('EX-001/002 — Event ID enumeration does not leak existence info', () => {
  /**
   * Fabricated IDs that should never exist in staging.
   * Using the evt_ prefix the platform uses so the router does not reject
   * on format before reaching the DB lookup.
   */
  const NONEXISTENT_IDS = [
    'evt_000000000001',
    'evt_000000000002',
    'evt_000000000003',
    'evt_aaaaaaaaaaaaa',
    'evt_zzzzzzzzzzzz',
    'evt_1',
    'evt_99999999',
  ];

  for (const id of NONEXISTENT_IDS) {
    test(`GET /api/v2/events/${id} → 404 (not 403 — no existence leakage)`, async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/v2/events/${id}`);
      const safe = new SafeResponse(response);

      // 404 is the only acceptable response — 403 would disclose existence
      expect(
        response.status(),
        `Event ID enumeration: "${id}" returned ${response.status()} ` +
          `— expected 404 to avoid existence disclosure`
      ).toBe(404);

      await safe.assertNoInternalLeakage();
    });
  }

  test('EX-002 — 404 body does not disclose DB schema or stack trace', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v2/events/evt_redteam_probe`);
    const safe = new SafeResponse(response);

    expect(response.status()).toBe(404);
    await safe.assertNoInternalLeakage();

    // The 404 body SHOULD include a safe, generic message
    const body = await safe.bodyText();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      // Non-JSON 404 is also acceptable
    }

    if (Object.keys(parsed).length > 0) {
      // ok: false expected
      expect(parsed['ok']).toBe(false);

      // Must NOT include the queried ID verbatim in a way that exposes
      // internal query structure (e.g. "no row found for evt_redteam_probe in events table")
      const message = String(parsed['message'] ?? '');
      expect(/events\s+table/i.test(message), `404 message exposes table name: "${message}"`).toBe(
        false
      );
      expect(
        /row\s+not\s+found/i.test(message),
        `404 message exposes internal DB language: "${message}"`
      ).toBe(false);
    }
  });

  test('EX-001 — Sequential numeric IDs all return 404 (no IDOR gap)', async ({ request }) => {
    // Try purely numeric IDs that shouldn't match the evt_ prefix format
    const numericIds = ['1', '2', '100', '1000', '9999'];

    for (const id of numericIds) {
      const response = await request.get(`${BASE_URL}/api/v2/events/${id}`);

      // Must be 400 (bad format) or 404 (not found) — never 200
      expect(
        [400, 404],
        `Numeric event ID "${id}" returned ${response.status()} — expected 400 or 404`
      ).toContain(response.status());

      // Critically: must NOT be 500 (would indicate the ID reached the DB and caused an error)
      expect(
        response.status(),
        `Numeric ID "${id}" caused a 500 — possible unhandled DB error`
      ).not.toBe(500);
    }
  });
});

// ─── EX-003 — SharedReport without token ─────────────────────────────────────
//
// /sharedReport is a public HTML shell (OSE-682: it loads on every plan). It holds
// no report data: the browser fetches the report from
// /api/v2/events/:id/shared-report with the signed link token, and THAT is the
// authentication boundary. These probes used to require the page itself to refuse
// (401/403); it only ever did so because staging sat on the Free plan, which made
// the page answer 403 for a plan reason, not an auth one. The probes now assert
// what actually protects the data: the shell carries none, and the report API
// refuses a missing or fabricated token.

const EX003_EVENT = SMOKE_EVENT_ID || 'test-event-001';

test.describe('EX-003 — SharedReport data requires a signed link token', () => {
  test('GET /sharedReport without token → a shell with no report data', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/sharedReport`, { maxRedirects: 0 });
    expect(response.status(), '/sharedReport must not 5xx').toBeLessThan(500);
    const body = await response.text();
    // No server-rendered report payload: no JSON report object, no counts.
    expect(body, 'the shell must not embed a report payload').not.toMatch(
      /"distinct_scanners"\s*:\s*\d/
    );
    expect(body, 'the shell must not embed sponsor display rows').not.toMatch(
      /"sponsor_displays"\s*:\s*\[\s*\{/
    );
  });

  test('GET the report API without token → 401', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/api/v2/events/${encodeURIComponent(EX003_EVENT)}/shared-report`
    );
    expect(
      response.status(),
      `report API without a token returned ${response.status()} — expected 401`
    ).toBe(401);
    const body = await response.text();
    expect(body, 'a refusal carries no report').not.toContain('"report"');
  });

  test('GET the report API with fabricated token → 401 or 403', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/api/v2/events/${encodeURIComponent(EX003_EVENT)}/shared-report`,
      { headers: { Authorization: 'Bearer fabricated.token.value' } }
    );
    expect(
      [401, 403],
      `report API with fabricated token returned ${response.status()} — expected 401 or 403`
    ).toContain(response.status());
    const body = await response.text();
    expect(body, 'a refusal carries no report').not.toContain('"report"');
  });
});

// ─── EX-004 / EX-005 — Admin endpoints without auth ──────────────────────────

test.describe('EX-004/005 — Admin endpoints gate unauthenticated access', () => {
  const ADMIN_ENDPOINTS = [
    '/api/v2/admin/events',
    '/api/v2/admin/events/evt_fixture_001',
    '/api/v2/admin/feature-flags',
    '/admin',
  ];

  for (const endpoint of ADMIN_ENDPOINTS) {
    test(`${endpoint} without auth → 401 or 403 (not 200 or 500)`, async ({ request }) => {
      const response = await request.get(`${BASE_URL}${endpoint}`, {
        maxRedirects: 0,
      });

      const status = response.status();
      const safe = new SafeResponse(response);

      // 200 means the endpoint served content without auth — data exposure
      expect(
        status,
        `${endpoint} returned 200 without auth — unauthenticated access to admin resource`
      ).not.toBe(200);

      // 500 means the auth guard panicked instead of rejecting cleanly
      expect(
        status,
        `${endpoint} returned 500 without auth — auth guard threw an unhandled error`
      ).not.toBe(500);

      // Must be a gating response
      const isGated = status === 401 || status === 403 || (status >= 300 && status < 400);

      expect(
        isGated,
        `${endpoint} without auth returned ${status} — expected 401, 403, or redirect`
      ).toBe(true);

      await safe.assertNoInternalLeakage();
    });
  }
});

// ─── EX-006 — Error responses do not include stack traces or SQL ──────────────

test.describe('EX-006 — Error responses are safe (no stack traces, no SQL)', () => {
  const PROBE_INPUTS = [
    { path: '/api/v2/events/not-an-id-at-all', label: 'malformed ID' },
    { path: '/api/v2/events/evt_%27%20OR%20%271%27%3D%271', label: 'SQL injection in path' },
    { path: '/api/v2/events/../../etc/passwd', label: 'path traversal' },
    { path: '/api/v2/events/' + 'a'.repeat(500), label: '500-char ID (too long)' },
  ];

  for (const { path, label } of PROBE_INPUTS) {
    test(`${label} → error response does not leak internals`, async ({ request }) => {
      const response = await request.get(`${BASE_URL}${path}`);
      const safe = new SafeResponse(response);

      // Must not be 200 (that would mean we matched something)
      expect(response.status(), `${label}: expected a 4xx error, got 200`).not.toBe(200);

      // Must not be 500 (unhandled error)
      expect(
        response.status(),
        `${label}: server returned 500 — possible unhandled error from input`
      ).not.toBe(500);

      await safe.assertNoInternalLeakage();
    });
  }

  test('POST to read-only endpoint returns 405 without stack trace', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/v2/events`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });

    // POST to a GET-only endpoint: 405 Method Not Allowed or 401 (auth first)
    expect(
      [401, 403, 405],
      `POST /api/v2/events returned ${response.status()} — expected 401, 403, or 405`
    ).toContain(response.status());

    const safe = new SafeResponse(response);
    await safe.assertNoInternalLeakage();
  });
});
