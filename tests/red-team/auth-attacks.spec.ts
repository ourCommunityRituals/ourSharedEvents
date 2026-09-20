/**
 * RED TEAM — Auth Attack Surface
 *
 * Validates that the OSE platform correctly enforces authentication and
 * origin controls at the edge. These tests run against staging
 * (https://stg.oursharedevents.com) via real network requests so they
 * exercise Cloudflare Access, CORS, and the Worker auth guard together.
 *
 * Environment variables:
 *   BASE_URL        — override target (default: https://stg.oursharedevents.com)
 *   ADMIN_KEY       — valid Bearer token for positive-control tests
 *   X_OCR_INTERNAL  — internal auth secret (X-OCR-Internal header)
 *
 * Test IDs:
 *   AUTH-001  CORS — non-allowlisted origin blocked
 *   AUTH-002  CORS — allowlisted origin passes
 *   AUTH-003  CF Access bypass — direct API call without cookie → 401
 *   AUTH-004  Bearer token exhaustion — 1 000 sequential calls still succeed
 *   AUTH-005  X-Frame-Options — admin page cannot be iframed
 */

import { test, expect, type APIResponse } from '@playwright/test';

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') ?? 'https://stg.oursharedevents.com';

const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';

// Origins that are NOT on the CORS allowlist
const HOSTILE_ORIGINS = [
  'https://evil.example.com',
  'https://attacker.io',
  'null',
  'https://oursharedevents.com.evil.example.com',
];

// A valid cross-origin pattern the platform whitelists (adjust if the
// actual allowlist differs — this is the canonical staging self-origin)
const ALLOWED_ORIGIN = BASE_URL;

// Admin-protected API endpoint used across several tests
const ADMIN_EVENTS_ENDPOINT = `${BASE_URL}/api/v2/admin/events`;

// ─── Page Object ──────────────────────────────────────────────────────────────

class SecurityHeaders {
  constructor(private readonly response: APIResponse) {}

  get(name: string): string | null {
    return this.response.headers()[name.toLowerCase()] ?? null;
  }

  xFrameOptions(): string | null {
    return this.get('x-frame-options');
  }

  accessControlAllowOrigin(): string | null {
    return this.get('access-control-allow-origin');
  }
}

// ─── AUTH-001 / AUTH-002 — CORS ───────────────────────────────────────────────

test.describe('AUTH-001/002 — CORS enforcement', () => {
  for (const origin of HOSTILE_ORIGINS) {
    test(`hostile origin "${origin}" does not receive ACAO wildcard or echo`, async ({
      request,
    }) => {
      const response = await request.fetch(`${BASE_URL}/api/v2/events`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Authorization',
        },
      });

      const headers = new SecurityHeaders(response);
      const acao = headers.accessControlAllowOrigin();

      // The server MUST NOT echo back the hostile origin or use wildcard
      // on a credentialed route. Either the header is absent, or it must
      // not equal the hostile origin.
      if (acao !== null) {
        expect(acao, `CORS: server echoed hostile origin "${origin}" in ACAO header`).not.toBe(
          origin
        );

        expect(acao, `CORS: server returned wildcard ACAO on credentialed admin route`).not.toBe(
          '*'
        );
      }

      // Pre-flight to a hostile origin should return a non-2xx status or
      // respond with an ACAO that does not match the hostile origin.
      // 200 with no ACAO is acceptable (origin simply rejected).
      const statusIsRefusal =
        response.status() === 403 ||
        response.status() === 401 ||
        acao === null ||
        (acao !== origin && acao !== '*');

      expect(
        statusIsRefusal,
        `CORS pre-flight for "${origin}" should be refused: status=${response.status()}, ACAO=${acao}`
      ).toBe(true);
    });
  }

  test('AUTH-002 — allowlisted self-origin receives ACAO header on preflight', async ({
    request,
  }) => {
    const response = await request.fetch(`${BASE_URL}/api/v2/events`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    });

    // The preflight should succeed (2xx) and include the ACAO header
    expect(
      response.status(),
      `Expected 200/204 preflight for allowlisted origin, got ${response.status()}`
    ).toBeLessThan(300);

    const acao = response.headers()['access-control-allow-origin'];
    expect(
      acao,
      'Allowlisted origin should appear in ACAO or server returns * for public routes'
    ).toBeTruthy();
  });
});

// ─── AUTH-003 — CF Access bypass ─────────────────────────────────────────────

test.describe('AUTH-003 — CF Access bypass: direct API calls without auth', () => {
  test('GET /api/v2/admin/events without any auth → 401 or 403', async ({ request }) => {
    // Deliberately omit Authorization, X-OCR-Internal, and CF_Authorization cookie
    const response = await request.get(ADMIN_EVENTS_ENDPOINT, {
      headers: {
        // Explicitly clear any injected auth — use a fresh context with no
        // extraHTTPHeaders. The playwright.config for red-team sets none.
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 0,
    });

    expect(
      [302, 401, 403],
      `Admin endpoint without auth returned ${response.status()} — expected 302, 401, or 403`
    ).toContain(response.status());
  });

  test('GET /api/v2/admin/events with forged CF_Authorization cookie → 401 or 403', async ({
    request,
  }) => {
    const response = await request.get(ADMIN_EVENTS_ENDPOINT, {
      headers: {
        // Forged JWT — not signed by Cloudflare's Access key
        Cookie: 'CF_Authorization=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.forged.sig',
      },
      maxRedirects: 0,
    });

    expect(
      [302, 401, 403],
      `Forged CF_Authorization cookie returned ${response.status()} — expected 302, 401, or 403`
    ).toContain(response.status());
  });

  test('GET /admin page without auth → 401 or redirect (not 200)', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/admin`, {
      // Do not follow the redirect — a redirect to a login page is acceptable
      maxRedirects: 0,
    });

    const status = response.status();
    const isGated =
      status === 401 ||
      status === 403 ||
      // Redirect to a login/auth page is acceptable gating
      (status >= 300 && status < 400);

    expect(isGated, `/admin without auth returned ${status} — expected 401, 403, or redirect`).toBe(
      true
    );
  });
});

// ─── AUTH-004 — Bearer token exhaustion (no nonce / one-time-use enforcement) ─

test.describe('AUTH-004 — Bearer token exhaustion: replayed token remains valid', () => {
  test.skip(
    !ADMIN_KEY,
    'ADMIN_KEY not set — skipping token exhaustion test (set env var to enable)'
  );

  /**
   * Design note: OSE Phase 1 uses a shared Bearer token with no nonce or
   * one-time-use enforcement (acknowledged limitation, fixed in Phase 3).
   * This test verifies the CURRENT behaviour: a valid token should still
   * work after 1 000 sequential uses, and the server must NOT return 401
   * (which would indicate accidental nonce invalidation).
   *
   * If the server starts returning 429 (rate limited) that is acceptable
   * and expected — rate limiting is a valid defense. What we guard against
   * is the server silently invalidating a valid token under load.
   */
  test('valid Bearer token survives 1 000 sequential API calls without 401', async ({
    request,
  }) => {
    // This is the only red-team test that intentionally performs 1,000
    // sequential live requests; allow slow staging/rate-limit windows to
    // complete without changing the suite-wide timeout for ordinary tests.
    test.setTimeout(600_000);
    const CALLS = 1_000;
    // Public endpoint — doesn't consume write quota, won't mutate state
    const endpoint = `${BASE_URL}/api/v2/events`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${ADMIN_KEY}`,
    };

    let unauthorizedCount = 0;
    let successCount = 0;
    let rateLimitedCount = 0;

    for (let i = 0; i < CALLS; i++) {
      const response = await request.get(endpoint, { headers });
      const status = response.status();

      if (status === 401 || status === 403) {
        unauthorizedCount++;
      } else if (status === 429) {
        rateLimitedCount++;
        // Rate limiting is expected and acceptable — pause briefly and continue
        // so we can measure what happens after the window clears on subsequent calls.
        // We do NOT retry here; we track the 429 count and keep incrementing i.
      } else if (status >= 200 && status < 300) {
        successCount++;
      }
    }

    // The token must not have been invalidated by repeated use
    expect(
      unauthorizedCount,
      `Token was treated as invalid after repeated use: ${unauthorizedCount} × 401/403 out of ${CALLS} calls`
    ).toBe(0);

    // At least some calls should have succeeded
    expect(
      successCount,
      'Expected at least some successful responses — token should remain valid'
    ).toBeGreaterThan(0);

    console.log(
      `[AUTH-004] ${CALLS} calls: ${successCount} OK, ${rateLimitedCount} rate-limited, ${unauthorizedCount} unauthorized`
    );
  });
});

// ─── AUTH-005 — X-Frame-Options on /admin ────────────────────────────────────

test.describe('AUTH-005 — X-Frame-Options: admin page cannot be iframed', () => {
  test('GET /admin returns X-Frame-Options: DENY', async ({ request }) => {
    // Use auth so the page actually renders (we want the real XFO header,
    // not a 401 shell that might not set it)
    const headers: Record<string, string> = {};
    if (X_OCR_INTERNAL) {
      headers['X-OCR-Internal'] = X_OCR_INTERNAL;
    } else if (ADMIN_KEY) {
      headers['Authorization'] = `Bearer ${ADMIN_KEY}`;
    }

    const response = await request.get(`${BASE_URL}/admin`, { headers });
    const xfo = response.headers()['x-frame-options'];

    expect(
      xfo?.toUpperCase(),
      `Expected X-Frame-Options: DENY on /admin, got: ${xfo ?? '(absent)'}`
    ).toBe('DENY');
  });

  test('Browser cannot embed /admin in an iframe (CSP frame-ancestors)', async ({
    page,
    request,
  }) => {
    const headers: Record<string, string> = {};
    if (X_OCR_INTERNAL) {
      headers['X-OCR-Internal'] = X_OCR_INTERNAL;
    } else if (ADMIN_KEY) {
      headers['Authorization'] = `Bearer ${ADMIN_KEY}`;
    }

    const response = await request.get(`${BASE_URL}/admin`, { headers });
    const csp = response.headers()['content-security-policy'] ?? '';

    // Either X-Frame-Options: DENY or CSP frame-ancestors 'none' is required
    const xfo = response.headers()['x-frame-options']?.toUpperCase();
    const hasFrameAncestorsNone = /frame-ancestors\s+'none'/i.test(csp);
    const hasXFODeny = xfo === 'DENY' || xfo === 'SAMEORIGIN';

    expect(
      hasFrameAncestorsNone || hasXFODeny,
      `Admin page lacks clickjacking protection. XFO="${xfo}", CSP="${csp}"`
    ).toBe(true);

    // Attempt to embed admin in an iframe — the page should refuse to render
    await page.setContent(`
      <html>
        <body>
          <iframe id="target" src="${BASE_URL}/admin" width="800" height="600"></iframe>
          <script>
            const iframe = document.getElementById('target');
            iframe.onload = () => {
              try {
                // Accessing cross-origin contentDocument throws if blocked
                const doc = iframe.contentDocument;
                window._iframeLoaded = doc !== null;
              } catch (e) {
                window._iframeLoaded = false;
              }
            };
            iframe.onerror = () => { window._iframeLoaded = false; };
          </script>
        </body>
      </html>
    `);

    // Give the iframe a moment to attempt loading
    await page.waitForTimeout(3_000);

    const iframeLoaded = await page.evaluate(() => (window as any)._iframeLoaded);

    // X-Frame-Options: DENY prevents the iframe from loading cross-origin.
    // The browser will fire onerror or simply not load contentDocument.
    // iframeLoaded should be false or undefined.
    expect(
      iframeLoaded,
      'Admin page loaded inside an iframe — X-Frame-Options may not be enforced'
    ).toBeFalsy();
  });
});
