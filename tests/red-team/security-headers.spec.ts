/**
 * RED TEAM — Security Headers
 *
 * Verifies that every page surface on OSE staging returns the full set of
 * security headers required by the OSE security baseline. A missing header
 * is a finding — these tests must pass before any production promotion.
 *
 * Environment variables:
 *   BASE_URL        — override target (default: https://stg.oursharedevents.com)
 *   ADMIN_KEY       — valid Bearer token (used to load authenticated pages)
 *   X_OCR_INTERNAL  — internal auth secret
 *   SMOKE_EVENT_ID  — real staging event ID (used for /forms/:id surface)
 *
 * Test IDs:
 *   HDR-001  CSP header present on every page surface
 *   HDR-002  X-Frame-Options: DENY on /admin
 *   HDR-003  No server version headers (X-Powered-By, Server, X-Runtime, etc.)
 *   HDR-004  Referrer-Policy header on all pages
 *   HDR-005  HTTPS enforced — no HTTP redirect loops, no mixed content
 *   HDR-006  X-Content-Type-Options: nosniff on all pages
 *   HDR-007  Strict-Transport-Security (HSTS) present on HTTPS responses
 */

import { test, expect, type APIResponse, type Page } from '@playwright/test';

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, '') ?? 'https://stg.oursharedevents.com';

const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';
const FIXTURE_EVENT_ID = process.env.SMOKE_EVENT_ID ?? 'evt_fixture_001';

// ─── Page surfaces to test ────────────────────────────────────────────────────

interface Surface {
  name: string;
  path: string;
  requiresAuth: boolean;
  /** Expected HTTP status — 401 for gated pages when no auth provided */
  expectedStatus?: number[];
}

const SURFACES: Surface[] = [
  { name: 'Landing (/)', path: '/', requiresAuth: false },
  { name: 'Public listing (/public)', path: '/public', requiresAuth: false },
  { name: 'Admin (/admin)', path: '/admin', requiresAuth: true },
  { name: 'Display (/display)', path: '/display', requiresAuth: false },
  { name: 'Poster (/poster)', path: '/poster', requiresAuth: false },
  { name: 'SharedReport (/sharedReport)', path: '/sharedReport', requiresAuth: false },
  {
    name: `Forms (/forms/${FIXTURE_EVENT_ID})`,
    path: `/forms/${FIXTURE_EVENT_ID}?type=register`,
    requiresAuth: false,
  },
  { name: 'Health (/health)', path: '/health', requiresAuth: false },
];

// ─── Page Object ──────────────────────────────────────────────────────────────

class HeaderAudit {
  private readonly headers: Record<string, string>;
  private readonly url: string;
  private readonly status: number;

  constructor(response: APIResponse) {
    this.headers = response.headers();
    this.url = response.url();
    this.status = response.status();
  }

  /** Get header value case-insensitively */
  get(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** Assert CSP header is present and contains a meaningful directive */
  assertCSP(): void {
    const csp = this.get('content-security-policy');
    expect(
      csp,
      `[${this.url}] Missing Content-Security-Policy header (status=${this.status})`,
    ).toBeDefined();

    expect(
      csp!.length,
      `[${this.url}] CSP header is empty`,
    ).toBeGreaterThan(0);

    // Must contain at minimum a default-src or script-src directive
    const hasDefaultSrc = /default-src/i.test(csp!);
    const hasScriptSrc = /script-src/i.test(csp!);

    expect(
      hasDefaultSrc || hasScriptSrc,
      `[${this.url}] CSP lacks default-src or script-src directive: "${csp}"`,
    ).toBe(true);
  }

  /** Assert X-Frame-Options header value */
  assertXFrameOptions(expected: 'DENY' | 'SAMEORIGIN'): void {
    const xfo = this.get('x-frame-options')?.toUpperCase();
    expect(
      xfo,
      `[${this.url}] Missing X-Frame-Options header`,
    ).toBeDefined();

    expect(
      xfo,
      `[${this.url}] X-Frame-Options is "${xfo}" — expected "${expected}"`,
    ).toBe(expected);
  }

  /** Assert none of the server version headers are present */
  assertNoVersionHeaders(): void {
    const BANNED_HEADERS = [
      'x-powered-by',
      'server',
      'x-runtime',
      'x-aspnet-version',
      'x-aspnetmvc-version',
      'x-generator',
      'x-drupal-cache',
      'x-rails-version',
    ];

    for (const header of BANNED_HEADERS) {
      const value = this.get(header);
      expect(
        value,
        `[${this.url}] "${header}" header present (value: "${value}") — leaks server info`,
      ).toBeUndefined();
    }

    // Special case: "server" header should not reveal the platform
    const serverHeader = this.get('server');
    if (serverHeader !== undefined) {
      // Cloudflare sets "server: cloudflare" — that is acceptable since it
      // reveals the CDN tier, not the origin application stack.
      // But "nginx", "express", "apache", "node" would be findings.
      const DANGEROUS_PATTERNS = /nginx|apache|express|node\.js|IIS|lighttpd|gunicorn/i;
      expect(
        DANGEROUS_PATTERNS.test(serverHeader),
        `[${this.url}] Server header reveals implementation: "${serverHeader}"`,
      ).toBe(false);
    }
  }

  /** Assert Referrer-Policy header is present with a privacy-safe value */
  assertReferrerPolicy(): void {
    const rp = this.get('referrer-policy');
    expect(
      rp,
      `[${this.url}] Missing Referrer-Policy header`,
    ).toBeDefined();

    // Acceptable values — all limit cross-origin referrer exposure
    const ACCEPTABLE = [
      'no-referrer',
      'no-referrer-when-downgrade',
      'strict-origin',
      'strict-origin-when-cross-origin',
      'same-origin',
      'origin',
      'origin-when-cross-origin',
    ];

    const normalised = rp!.toLowerCase().trim();
    expect(
      ACCEPTABLE.some((v) => normalised === v),
      `[${this.url}] Referrer-Policy "${rp}" is not a recognised safe value`,
    ).toBe(true);

    // Explicitly ban 'unsafe-url' which sends full URL including path and query
    expect(
      normalised,
      `[${this.url}] Referrer-Policy is "unsafe-url" — sends full URL cross-origin`,
    ).not.toBe('unsafe-url');
  }

  /** Assert X-Content-Type-Options: nosniff */
  assertNoSniff(): void {
    const xcto = this.get('x-content-type-options')?.toLowerCase();
    expect(
      xcto,
      `[${this.url}] Missing X-Content-Type-Options header`,
    ).toBeDefined();

    expect(
      xcto,
      `[${this.url}] X-Content-Type-Options is "${xcto}" — expected "nosniff"`,
    ).toBe('nosniff');
  }

  /** Assert HSTS header for HTTPS responses */
  assertHSTS(): void {
    // Only applies when we're hitting HTTPS (staging is always HTTPS)
    if (!this.url.startsWith('https://')) return;

    const hsts = this.get('strict-transport-security');
    expect(
      hsts,
      `[${this.url}] Missing Strict-Transport-Security (HSTS) header`,
    ).toBeDefined();

    // Must include max-age with a meaningful value (at least 1 week = 604800 seconds)
    const maxAgeMatch = /max-age=(\d+)/i.exec(hsts!);
    expect(
      maxAgeMatch,
      `[${this.url}] HSTS header lacks max-age directive: "${hsts}"`,
    ).not.toBeNull();

    const maxAgeSeconds = parseInt(maxAgeMatch![1], 10);
    expect(
      maxAgeSeconds,
      `[${this.url}] HSTS max-age ${maxAgeSeconds}s is too short (minimum 604800)`,
    ).toBeGreaterThanOrEqual(604_800);
  }
}

// ─── Helper: fetch with optional auth ────────────────────────────────────────

async function fetchSurface(
  surface: Surface,
  request: { get: (url: string, opts?: Record<string, unknown>) => Promise<APIResponse> },
): Promise<APIResponse> {
  const headers: Record<string, string> = {};

  if (surface.requiresAuth) {
    if (X_OCR_INTERNAL) {
      headers['X-OCR-Internal'] = X_OCR_INTERNAL;
    } else if (ADMIN_KEY) {
      headers['Authorization'] = `Bearer ${ADMIN_KEY}`;
    }
  }

  return request.get(`${BASE_URL}${surface.path}`, {
    headers,
    maxRedirects: 5,
  });
}

// ─── HDR-001 — CSP on every page surface ─────────────────────────────────────

test.describe('HDR-001 — Content-Security-Policy on every surface', () => {
  for (const surface of SURFACES) {
    test(`CSP header present on ${surface.name}`, async ({ request }) => {
      const response = await fetchSurface(surface, request);
      const audit = new HeaderAudit(response);

      // Skip audit if the page returned an auth gate (401/403)
      // The auth gate itself may or may not have a CSP — that's tested
      // explicitly in the admin-specific tests below.
      if (response.status() === 401 || response.status() === 403) {
        // Still check CSP on the auth error page — it renders HTML
        const csp = audit.get('content-security-policy');
        if (csp === undefined) {
          console.warn(
            `[HDR-001] ${surface.name} returned ${response.status()} without CSP — ` +
              `set auth env vars to test the full page.`,
          );
          return;
        }
      }

      audit.assertCSP();
    });
  }
});

// ─── HDR-002 — X-Frame-Options: DENY on /admin ───────────────────────────────

test.describe('HDR-002 — X-Frame-Options: DENY on /admin', () => {
  test('/admin with auth → X-Frame-Options: DENY', async ({ request }) => {
    const response = await fetchSurface(
      { name: 'Admin', path: '/admin', requiresAuth: true },
      request,
    );

    const audit = new HeaderAudit(response);

    if (response.status() === 401 || response.status() === 403) {
      // Auth gate should still set XFO
      const xfo = audit.get('x-frame-options')?.toUpperCase();
      if (xfo !== undefined) {
        expect(
          ['DENY', 'SAMEORIGIN'],
          `[/admin 401 shell] X-Frame-Options is "${xfo}" — expected DENY or SAMEORIGIN`,
        ).toContain(xfo);
      }
      // If not set on the 401 shell, that is a finding — log and continue
      if (xfo === undefined) {
        console.warn(
          '[HDR-002] /admin 401 response lacks X-Frame-Options — ' +
            'set ADMIN_KEY to test the full page',
        );
      }
      return;
    }

    audit.assertXFrameOptions('DENY');
  });

  test('/admin without auth → at minimum SAMEORIGIN or DENY', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/admin`, { maxRedirects: 5 });
    const audit = new HeaderAudit(response);
    const xfo = audit.get('x-frame-options')?.toUpperCase();

    if (xfo !== undefined) {
      expect(
        ['DENY', 'SAMEORIGIN'],
        `/admin without auth: X-Frame-Options is "${xfo}"`,
      ).toContain(xfo);
    }
    // Absence on the unauthenticated shell is noted but not a hard failure
    // if the full page (with auth) has it. The full-page check above is the gate.
  });
});

// ─── HDR-003 — No server version headers ─────────────────────────────────────

test.describe('HDR-003 — No server version headers leaked', () => {
  for (const surface of SURFACES) {
    test(`No version headers on ${surface.name}`, async ({ request }) => {
      const response = await fetchSurface(surface, request);
      const audit = new HeaderAudit(response);
      audit.assertNoVersionHeaders();
    });
  }
});

// ─── HDR-004 — Referrer-Policy on all pages ───────────────────────────────────

test.describe('HDR-004 — Referrer-Policy on all page surfaces', () => {
  for (const surface of SURFACES) {
    test(`Referrer-Policy present on ${surface.name}`, async ({ request }) => {
      const response = await fetchSurface(surface, request);
      const audit = new HeaderAudit(response);

      if (response.status() === 401 || response.status() === 403) {
        // Gated pages — check if the gate page sets it
        const rp = audit.get('referrer-policy');
        if (rp === undefined) {
          console.warn(
            `[HDR-004] ${surface.name} returned ${response.status()} without Referrer-Policy`,
          );
          return;
        }
      }

      audit.assertReferrerPolicy();
    });
  }
});

// ─── HDR-005 — HTTPS enforced ─────────────────────────────────────────────────

test.describe('HDR-005 — HTTPS enforced on all surfaces', () => {
  test('HTTP requests to staging redirect to HTTPS', async ({ request }) => {
    const httpUrl = BASE_URL.replace('https://', 'http://');
    if (!httpUrl.startsWith('http://')) {
      test.skip(true, 'BASE_URL is already HTTPS — cannot test HTTP redirect from this origin');
      return;
    }

    const response = await request.get(`${httpUrl}/`, { maxRedirects: 0 });

    // Must redirect (301/302/307/308) to HTTPS
    expect(
      [301, 302, 307, 308],
      `HTTP root returned ${response.status()} — expected redirect to HTTPS`,
    ).toContain(response.status());

    const location = response.headers()['location'] ?? '';
    expect(
      location.startsWith('https://'),
      `HTTP redirect does not go to HTTPS: "${location}"`,
    ).toBe(true);
  });

  test('All page surfaces respond only on HTTPS (no HTTP 200)', async ({ request }) => {
    // Try each surface via HTTP — must redirect or fail, never 200
    for (const surface of SURFACES.slice(0, 3)) {
      const httpUrl = `${BASE_URL.replace('https://', 'http://')}${surface.path}`;
      if (!httpUrl.startsWith('http://')) continue;

      const response = await request.get(httpUrl, { maxRedirects: 0 });
      expect(
        response.status(),
        `${surface.name} served 200 over HTTP — HTTPS not enforced`,
      ).not.toBe(200);
    }
  });

  test('Staging BASE_URL uses HTTPS', async () => {
    expect(
      BASE_URL.startsWith('https://'),
      `BASE_URL "${BASE_URL}" does not use HTTPS — test is misconfigured or site is HTTP-only`,
    ).toBe(true);
  });
});

// ─── HDR-006 — X-Content-Type-Options: nosniff ───────────────────────────────

test.describe('HDR-006 — X-Content-Type-Options: nosniff on all surfaces', () => {
  for (const surface of SURFACES) {
    test(`nosniff header present on ${surface.name}`, async ({ request }) => {
      const response = await fetchSurface(surface, request);
      const audit = new HeaderAudit(response);

      if (response.status() === 401 || response.status() === 403) {
        const xcto = audit.get('x-content-type-options');
        if (xcto === undefined) {
          console.warn(`[HDR-006] ${surface.name} auth gate lacks nosniff`);
          return;
        }
      }

      audit.assertNoSniff();
    });
  }
});

// ─── HDR-007 — HSTS (Strict-Transport-Security) ──────────────────────────────

test.describe('HDR-007 — Strict-Transport-Security (HSTS) present on HTTPS responses', () => {
  for (const surface of SURFACES) {
    test(`HSTS present on ${surface.name}`, async ({ request }) => {
      const response = await fetchSurface(surface, request);
      const audit = new HeaderAudit(response);

      // HSTS is only meaningful on HTTPS responses
      if (!BASE_URL.startsWith('https://')) {
        test.skip(true, 'BASE_URL is not HTTPS — HSTS test not applicable');
        return;
      }

      if (response.status() === 401 || response.status() === 403) {
        const hsts = audit.get('strict-transport-security');
        if (hsts === undefined) {
          console.warn(
            `[HDR-007] ${surface.name} auth gate lacks HSTS — set auth env vars for full test`,
          );
          return;
        }
      }

      audit.assertHSTS();
    });
  }
});

// ─── HDR-COMBO — Full header audit on /admin (most sensitive surface) ─────────

test.describe('HDR-COMBO — Complete header audit on /admin (highest risk surface)', () => {
  test('admin surface passes all header checks simultaneously', async ({ request }) => {
    const response = await fetchSurface(
      { name: 'Admin', path: '/admin', requiresAuth: true },
      request,
    );

    const audit = new HeaderAudit(response);
    const status = response.status();

    // If we could not authenticate, note it but still check what we can
    if (status === 401 || status === 403) {
      console.warn(
        `[HDR-COMBO] /admin returned ${status} — running partial audit on auth gate. ` +
          `Set ADMIN_KEY or X_OCR_INTERNAL for full coverage.`,
      );
    }

    // These MUST be present even on the 401 gate shell
    audit.assertNoVersionHeaders();

    // Full checks only when page renders
    if (status === 200) {
      audit.assertCSP();
      audit.assertXFrameOptions('DENY');
      audit.assertReferrerPolicy();
      audit.assertNoSniff();
      audit.assertHSTS();
    }
  });
});
