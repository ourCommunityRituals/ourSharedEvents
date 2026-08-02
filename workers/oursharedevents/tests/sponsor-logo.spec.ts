/**
 * OSE-288 — Sponsor Logo Proxy unit tests
 *
 * Pure-function coverage for `src/lib/sponsor-logo.ts`.
 * Tests run without a live D1 DB or Worker runtime; fetch() is mocked
 * inline via vi.stubGlobal so each test controls upstream behaviour.
 *
 * Coverage:
 *   validateLogoUrl —
 *     - null / undefined / empty → valid, url: null
 *     - non-string → invalid, INVALID_URL
 *     - >500 chars → invalid, TOO_LONG
 *     - unparseable string → invalid, INVALID_URL
 *     - javascript: / data: / ftp: → invalid, INVALID_SCHEME
 *     - http:// → valid
 *     - https:// → valid
 *   sponsorLogoPath —
 *     - plain id → expected path
 *     - id with slashes → percent-encoded
 *   fetchAndProxyLogo —
 *     - network failure → ok: false
 *     - upstream non-200 → ok: false, UPSTREAM_NNN
 *     - disallowed content-type → ok: false, CONTENT_TYPE_NOT_ALLOWED
 *     - response > 2 MB → ok: false, RESPONSE_TOO_LARGE
 *     - happy path (png) → ok: true, correct headers on Response
 *     - content-type with charset → stripped correctly
 */

import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  validateLogoUrl,
  sponsorLogoPath,
  fetchAndProxyLogo,
  LOGO_MAX_BYTES,
} from '../src/lib/sponsor-logo';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── validateLogoUrl ───────────────────────────────────────────────────────────

describe('validateLogoUrl', () => {
  test.each([null, undefined, ''])('returns valid + null url for empty-ish input %s', (input) => {
    const r = validateLogoUrl(input);
    expect(r.valid).toBe(true);
    expect(r.url).toBeNull();
    expect(r.error).toBeUndefined();
  });

  test('rejects non-string (number)', () => {
    const r = validateLogoUrl(42);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('INVALID_URL');
  });

  test('rejects non-string (object)', () => {
    const r = validateLogoUrl({ href: 'https://example.com' });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('INVALID_URL');
  });

  test('rejects string longer than 500 chars', () => {
    const r = validateLogoUrl('https://example.com/' + 'a'.repeat(490));
    expect(r.valid).toBe(false);
    expect(r.error).toBe('TOO_LONG');
  });

  test('rejects unparseable string', () => {
    const r = validateLogoUrl('not a url at all !!');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('INVALID_URL');
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,<h1>x</h1>',
    'ftp://files.example.com/logo.png',
  ])('rejects disallowed scheme: %s', (url) => {
    const r = validateLogoUrl(url);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('INVALID_SCHEME');
  });

  test('accepts http:// URL', () => {
    const url = 'http://example.com/logo.png';
    const r = validateLogoUrl(url);
    expect(r.valid).toBe(true);
    expect(r.url).toBe(url);
  });

  test('accepts https:// URL', () => {
    const url = 'https://cdn.example.com/sponsors/acme.png';
    const r = validateLogoUrl(url);
    expect(r.valid).toBe(true);
    expect(r.url).toBe(url);
  });
});

// ── sponsorLogoPath ───────────────────────────────────────────────────────────

describe('sponsorLogoPath', () => {
  test('returns correct path for plain id', () => {
    expect(sponsorLogoPath('abc123')).toBe('/api/v2/sponsors/abc123/logo');
  });

  test('percent-encodes id containing slashes', () => {
    expect(sponsorLogoPath('a/b')).toBe('/api/v2/sponsors/a%2Fb/logo');
  });
});

// ── fetchAndProxyLogo ─────────────────────────────────────────────────────────

function makeFetchStub(opts: {
  throws?: boolean;
  status?: number;
  contentType?: string;
  bodyBytes?: ArrayBuffer;
}) {
  return vi.fn(async () => {
    if (opts.throws) throw new Error('network failure');
    const bytes = opts.bodyBytes ?? new ArrayBuffer(100);
    return {
      ok: (opts.status ?? 200) >= 200 && (opts.status ?? 200) < 300,
      status: opts.status ?? 200,
      headers: {
        get: (name: string) => (name === 'content-type' ? (opts.contentType ?? 'image/png') : null),
      },
      arrayBuffer: async () => bytes,
    };
  });
}

describe('fetchAndProxyLogo', () => {
  test('returns ok:false when fetch throws (network failure)', async () => {
    vi.stubGlobal('fetch', makeFetchStub({ throws: true }));
    const r = await fetchAndProxyLogo('https://example.com/logo.png');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('network failure');
  });

  test('returns ok:false with UPSTREAM_404 when upstream returns 404', async () => {
    vi.stubGlobal('fetch', makeFetchStub({ status: 404 }));
    const r = await fetchAndProxyLogo('https://example.com/logo.png');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UPSTREAM_404');
  });

  test('returns ok:false with UPSTREAM_500 when upstream returns 500', async () => {
    vi.stubGlobal('fetch', makeFetchStub({ status: 500 }));
    const r = await fetchAndProxyLogo('https://example.com/logo.png');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UPSTREAM_500');
  });

  test('returns ok:false when content-type is not allowed', async () => {
    vi.stubGlobal('fetch', makeFetchStub({ contentType: 'text/html' }));
    const r = await fetchAndProxyLogo('https://example.com/logo.html');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CONTENT_TYPE_NOT_ALLOWED');
  });

  test('strips charset from content-type before validation', async () => {
    vi.stubGlobal('fetch', makeFetchStub({ contentType: 'image/svg+xml; charset=utf-8' }));
    const r = await fetchAndProxyLogo('https://example.com/logo.svg');
    expect(r.ok).toBe(true);
  });

  test('returns ok:false when response body exceeds 2 MB', async () => {
    const big = new ArrayBuffer(LOGO_MAX_BYTES + 1);
    vi.stubGlobal('fetch', makeFetchStub({ bodyBytes: big }));
    const r = await fetchAndProxyLogo('https://example.com/logo.png');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('RESPONSE_TOO_LARGE');
  });

  test('happy path: returns ok:true with hardened response headers', async () => {
    vi.stubGlobal('fetch', makeFetchStub({ contentType: 'image/png' }));
    const r = await fetchAndProxyLogo('https://example.com/logo.png');
    expect(r.ok).toBe(true);
    expect(r.response).toBeDefined();

    const headers = r.response!.headers;
    expect(headers.get('Content-Type')).toBe('image/png');
    expect(headers.get('Cache-Control')).toMatch(/public/);
    expect(headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
  });

  test.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'])(
    'accepts allowed content-type: %s',
    async (ct) => {
      vi.stubGlobal('fetch', makeFetchStub({ contentType: ct }));
      const r = await fetchAndProxyLogo('https://example.com/logo');
      expect(r.ok).toBe(true);
    }
  );
});
