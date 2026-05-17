/**
 * OSE-320 — `GET /api/v2/uec/resolve` Playwright contract spec.
 *
 * Resolves a canonical UEC code identifier to its full metadata + QR.
 * UEC is the semantic-category contract for any URL the platform emits
 * (QR, shortlinks, deep links) — not QR-specific.
 *
 * This is the FE-layer test for the per-story 3-layer pyramid. The
 * endpoint returns JSON (not HTML), so Playwright exercises it via
 * `request` API mode — proves the contract works against a deployed
 * surface (vs in-process via SELF.fetch which is the vitest layer).
 *
 * What this catches that vitest doesn't:
 *   - Real network path through CF Workers runtime (vs miniflare)
 *   - Edge caching behavior (Cache-Control respected by the runtime)
 *   - CORS / CDN / origin-rewriting issues that only surface in deploy
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names follow
 *   `OSE-320 | FE | GET /api/v2/uec/resolve (<condition>) | <assertion>`
 *
 * Note on the FE qualifier: the standard's "FE" qualifier names the
 * RUNNER's perspective — Playwright observes from outside the worker.
 * Even though this is a JSON endpoint, the test is FE-shaped because
 * it's exercising the externally-observable behavior of the deployed
 * surface (not the internal worker invocation).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

interface QrGenerateSuccess {
  ok: boolean;
  code: {
    id: string;
    label: string;
    scan_hex: string;
    display_hex: string;
    url_path: string;
    wcag_grade: string;
  };
  qr: {
    data_uri: string;
    encoded_url: string;
  };
  uec_version: string;
}

interface QrGenerateError {
  ok: false;
  error: string;
  message: string;
  invalid_code: string | null;
  valid_codes: {
    ids: string[];
    labels: string[];
  };
}

test.describe('OSE-320 /api/v2/uec/resolve — contract via real network', () => {
  test('OSE-320 | FE | GET /api/v2/uec/resolve?code=green (canonical label) | 200 with code metadata + QR data URI', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/v2/uec/resolve?code=green`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    const body = (await res.json()) as QrGenerateSuccess;
    expect(body.ok).toBe(true);
    expect(body.code.id).toBe('ENTER');
    expect(body.code.label).toBe('Green');
    expect(body.code.scan_hex).toBe('#1A6B2F');
    expect(body.code.display_hex).toBe('#2D6A4F');
    expect(body.code.url_path).toBe('/enter');
    expect(body.code.wcag_grade).toBe('AAA');
    expect(body.qr.data_uri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(body.qr.encoded_url).toBe(`${BASE_URL}/enter`);
    expect(body.uec_version).toBe('1.1');
  });

  test('OSE-320 | FE | GET /api/v2/uec/resolve?code=SPONSOR (canonical id) | 200 with blue scan_hex', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/v2/uec/resolve?code=SPONSOR`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as QrGenerateSuccess;
    expect(body.code.id).toBe('SPONSOR');
    expect(body.code.scan_hex).toBe('#1A3A8A');
    expect(body.qr.encoded_url).toBe(`${BASE_URL}/sponsor`);
  });

  test('OSE-320 | FE | GET /api/v2/uec/resolve?code=%20GREEN%20 (whitespace + case) | 200 resolves cleanly', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/v2/uec/resolve?code=${encodeURIComponent(' GREEN ')}`
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as QrGenerateSuccess;
    expect(body.code.id).toBe('ENTER');
  });

  test('OSE-320 | FE | GET /api/v2/uec/resolve (no code param) | 400 MISSING_CODE with valid_codes', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/v2/uec/resolve`);
    expect(res.status()).toBe(400);
    const body = (await res.json()) as QrGenerateError;
    expect(body.ok).toBe(false);
    expect(body.error).toBe('MISSING_CODE');
    expect(body.valid_codes.ids).toContain('ENTER');
    expect(body.valid_codes.labels).toContain('Green');
  });

  test('OSE-320 | FE | GET /api/v2/uec/resolve?code=xyz (non-canonical) | 400 INVALID_CODE with full valid_codes list', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/v2/uec/resolve?code=xyz`);
    expect(res.status()).toBe(400);
    const body = (await res.json()) as QrGenerateError;
    expect(body.error).toBe('INVALID_CODE');
    expect(body.invalid_code).toBe('xyz');
    expect(body.valid_codes.ids).toHaveLength(11);
    // No raw stack traces / internal jargon
    expect(body.message).not.toMatch(/TypeError|undefined|at .+\.ts:\d+/);
  });

  test('OSE-320 | FE | GET /api/v2/uec/resolve?code=green (canonical) | Cache-Control header present', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/v2/uec/resolve?code=green`);
    expect(res.status()).toBe(200);
    const cc = res.headers()['cache-control'];
    expect(cc).toBeTruthy();
    expect(cc).toMatch(/max-age=\d+/);
  });

  test('OSE-320 | FE | GET /api/v2/uec/resolve?code=green | rendered QR image loads in browser', async ({
    page,
    request,
  }) => {
    // Real-browser confirmation that the data URI is a valid PNG. We fetch
    // the JSON, then load the data URI into an <img>, then verify the image
    // dimensions match a reasonable QR size. This catches base64 corruption
    // and PNG header issues that pure-JSON validation can miss.
    const res = await request.get(`${BASE_URL}/api/v2/uec/resolve?code=green`);
    const body = (await res.json()) as QrGenerateSuccess;
    await page.setContent(
      `<!doctype html><html><body><img id="qr" src="${body.qr.data_uri}"></body></html>`
    );
    const dims = await page.evaluate(() => {
      const img = document.getElementById('qr') as HTMLImageElement;
      return new Promise<{ w: number; h: number }>((resolve, reject) => {
        if (img.complete && img.naturalWidth > 0) {
          resolve({ w: img.naturalWidth, h: img.naturalHeight });
        } else {
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => reject(new Error('img failed to load'));
        }
      });
    });
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
    expect(dims.w).toBe(dims.h); // QR codes are square
  });
});
