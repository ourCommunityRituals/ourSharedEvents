/**
 * R-001 — Admin front-door sign-in page behavioral tests.
 *
 * Before R-001, an unauthenticated GET to /admin returned a raw JSON
 * 401 dump rendered as page text in the browser. This was the literal
 * first interaction a prospect had with the admin product.
 *
 * After R-001:
 *   - GET /admin with `Accept: text/html` and no auth → 401 + HTML sign-in page
 *   - GET /admin with `Accept: application/json` and no auth → 401 + JSON (unchanged)
 *   - GET /admin with valid auth → 200 + admin dashboard (unchanged)
 *   - POST /api/v2/admin/events with no auth → 401 + JSON (unchanged — APIs still get JSON)
 *
 * These tests guard the HTML-vs-JSON branching so it never regresses.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('R-001 admin front-door', () => {
  test('unauth GET /admin with Accept:text/html returns 401 + HTML sign-in page', async () => {
    const res = await SELF.fetch('https://test.local/admin', {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(401);
    const contentType = res.headers.get('Content-Type') ?? '';
    expect(contentType).toMatch(/text\/html/);
    const body = await res.text();
    // It's a real HTML page, not JSON
    expect(body).toMatch(/<!DOCTYPE html>/i);
    expect(body).toMatch(/Admin sign-in required/);
    // Critical: must NOT contain the JSON error shape
    expect(body).not.toMatch(/"ok":\s*false/);
    expect(body).not.toMatch(/"code":\s*"UNAUTH"/);
  });

  test('unauth GET /admin with Accept:text/html includes a sign-in CTA and request-access path', async () => {
    const res = await SELF.fetch('https://test.local/admin', {
      headers: { Accept: 'text/html' },
    });
    const body = await res.text();
    // Sign-in CTA and prospect path both present
    expect(body).toMatch(/data-testid="signin-cta"/);
    expect(body).toMatch(/data-testid="signin-request-access"/);
    // No internal jargon leaking — no raw "UNAUTH", no JSON shape
    expect(body).not.toMatch(/\bUNAUTH\b/);
  });

  test('unauth /admin alias /manage with Accept:text/html also returns the sign-in page', async () => {
    const res = await SELF.fetch('https://test.local/manage', {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toMatch(/Admin sign-in required/);
  });

  test('unauth GET /admin with Accept:application/json still returns JSON 401 (API consumers preserved)', async () => {
    const res = await SELF.fetch('https://test.local/admin', {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(401);
    const contentType = res.headers.get('Content-Type') ?? '';
    expect(contentType).toMatch(/application\/json/);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('UNAUTH');
  });

  test('unauth API endpoints still return JSON 401 (no HTML leak)', async () => {
    const res = await SELF.fetch('https://test.local/api/v2/admin/events', {
      headers: { Accept: 'text/html' }, // even browser-style Accept must NOT get HTML on API
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    // The API path is unchanged — JSON dump still returned
    expect(body).toMatch(/"ok":\s*false/);
  });

  test('sign-in page sets Content-Security-Policy header (defense in depth)', async () => {
    const res = await SELF.fetch('https://test.local/admin', {
      headers: { Accept: 'text/html' },
    });
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).not.toBeNull();
    expect(csp!).toMatch(/default-src 'self'/);
  });

  test('sign-in page is robots-noindex (not for crawlers)', async () => {
    const res = await SELF.fetch('https://test.local/admin', {
      headers: { Accept: 'text/html' },
    });
    const body = await res.text();
    expect(body).toMatch(/<meta name="robots" content="noindex"/);
  });
});
