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
  validateHttpsUrl,
  sponsorLogoPath,
  fetchAndProxyLogo,
  isBlockedLogoHost,
  readCapped,
  LOGO_MAX_BYTES,
  LOGO_MAX_REDIRECTS,
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

// ── validateHttpsUrl (events.what_url — public OUTBOUND link, https-only) ───────

describe('validateHttpsUrl', () => {
  test.each([null, undefined, ''])('optional: valid + null url for empty-ish %s', (input) => {
    const r = validateHttpsUrl(input);
    expect(r.valid).toBe(true);
    expect(r.url).toBeNull();
  });

  test('accepts https:// URL', () => {
    const url = 'https://example.org/donate';
    const r = validateHttpsUrl(url);
    expect(r.valid).toBe(true);
    expect(r.url).toBe(url);
  });

  test('REJECTS http:// (downgrade risk on a public outbound link)', () => {
    const r = validateHttpsUrl('http://example.org/donate');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('INVALID_SCHEME');
    expect(r.url).toBeNull();
  });

  test.each(['javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'ftp://x/y'])(
    'rejects disallowed scheme: %s',
    (url) => {
      const r = validateHttpsUrl(url);
      expect(r.valid).toBe(false);
    }
  );

  test('rejects over-length + unparseable, like the base validator', () => {
    expect(validateHttpsUrl('https://x.example/' + 'a'.repeat(500)).valid).toBe(false);
    expect(validateHttpsUrl('not a url !!').valid).toBe(false);
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
    // A real Response, so the body is a stream: OSE-1433 reads it with a cap
    // instead of arrayBuffer().
    const bytes = opts.bodyBytes ?? new ArrayBuffer(100);
    return new Response(bytes, {
      status: opts.status ?? 200,
      headers: { 'content-type': opts.contentType ?? 'image/png' },
    });
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

// ── OSE-1433: host rule, redirects, streaming cap ─────────────────────────────
//
// @born-red OSE-1433 | method: these cases run against origin/main's
//   sponsor-logo.ts (no host rule, redirect:'follow', arrayBuffer-then-check)
//   fail; green with the change | date: 2026-10-01

describe('OSE-1433 | a logo host must be a public DNS name', () => {
  test.each([
    'http://localhost/l.png',
    'http://LOCALHOST./l.png',
    'https://api.localhost/l.png',
    'http://127.0.0.1/l.png',
    'http://2130706433/l.png', // decimal 127.0.0.1
    'http://0x7f.1/l.png', // hex short form
    'http://10.0.0.5/l.png',
    'http://192.168.1.1/l.png',
    'http://169.254.169.254/latest/meta-data', // cloud metadata
    'http://[::1]/l.png',
    'http://[fd00::1]/l.png',
    'http://intranet/l.png', // single-label
    'http://printer.local/l.png',
    'http://db.internal/l.png',
    'http://nas.home.arpa/l.png',
  ])('refuses %s on write (INVALID_HOST)', (u) => {
    const r = validateLogoUrl(u);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('INVALID_HOST');
  });

  test.each(['https://cdn.example.com/l.png', 'http://images.shop.example.org/logo.svg'])(
    'accepts a public name: %s',
    (u) => expect(validateLogoUrl(u).valid).toBe(true)
  );

  test('the outbound-link validator is unchanged (a browser follows it, not the Worker)', () => {
    // validateHttpsUrl shares the scheme/parse/length checks but not the host rule.
    expect(validateHttpsUrl('https://intranet/page').valid).toBe(true);
  });

  test('isBlockedLogoHost is the same rule the fetch re-checks', () => {
    expect(isBlockedLogoHost(new URL('http://2130706433/').hostname)).toBe(true);
    expect(isBlockedLogoHost('cdn.example.com')).toBe(false);
  });

  test('at fetch time a blocked host is refused without any request', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await fetchAndProxyLogo('http://169.254.169.254/latest/meta-data');
    expect(r).toEqual({ ok: false, error: 'BLOCKED_HOST' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('OSE-1433 | redirects are followed by hand, capped, and re-checked', () => {
  const png = () =>
    new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  const to = (location: string, status = 302) =>
    new Response(null, { status, headers: { location } });

  test('fetch never follows on its own', async () => {
    const f = vi.fn(async () => png());
    vi.stubGlobal('fetch', f);
    await fetchAndProxyLogo('https://cdn.example.com/l.png');
    expect(f).toHaveBeenCalledWith(
      'https://cdn.example.com/l.png',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  test(`a chain of ${LOGO_MAX_REDIRECTS} redirects is followed`, async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(to('https://cdn.example.com/a'))
      .mockResolvedValueOnce(to('/b', 301)) // relative Location
      .mockResolvedValueOnce(to('https://cdn2.example.com/c', 307))
      .mockResolvedValueOnce(png());
    vi.stubGlobal('fetch', f);
    const r = await fetchAndProxyLogo('https://start.example.com/l.png');
    expect(r.ok).toBe(true);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      'https://start.example.com/l.png',
      'https://cdn.example.com/a',
      'https://cdn.example.com/b',
      'https://cdn2.example.com/c',
    ]);
  });

  test(`a chain longer than ${LOGO_MAX_REDIRECTS} is refused`, async () => {
    const f = vi.fn(async () => to('https://loop.example.com/again'));
    vi.stubGlobal('fetch', f);
    const r = await fetchAndProxyLogo('https://loop.example.com/start');
    expect(r).toEqual({ ok: false, error: 'TOO_MANY_REDIRECTS' });
    expect(f).toHaveBeenCalledTimes(LOGO_MAX_REDIRECTS + 1);
  });

  test('a redirect to a blocked host is refused before it is requested', async () => {
    const f = vi.fn(async () => to('http://169.254.169.254/latest/meta-data'));
    vi.stubGlobal('fetch', f);
    const r = await fetchAndProxyLogo('https://cdn.example.com/l.png');
    expect(r).toEqual({ ok: false, error: 'BLOCKED_HOST' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('a redirect with no Location is an upstream error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302 }))
    );
    expect(await fetchAndProxyLogo('https://cdn.example.com/l.png')).toEqual({
      ok: false,
      error: 'UPSTREAM_302',
    });
  });
});

describe('OSE-1433 | an oversized body is cut off while streaming', () => {
  /** A stream of 64 KB chunks that never ends; counts how many were pulled. */
  function endless() {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    return { body, pulled: () => pulled, cancelled: () => cancelled };
  }

  test('readCapped stops one chunk past the cap and cancels the stream', async () => {
    const s = endless();
    const out = await readCapped(new Response(s.body), LOGO_MAX_BYTES);
    expect(out).toBeNull();
    expect(s.cancelled()).toBe(true);
    // Never more than the cap plus one chunk (and the stream's one-chunk lookahead).
    expect(s.pulled() * 64 * 1024).toBeLessThanOrEqual(LOGO_MAX_BYTES + 2 * 64 * 1024);
  });

  test('an endless upstream with no Content-Length is refused, not buffered', async () => {
    const s = endless();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(s.body, { headers: { 'content-type': 'image/png' } }))
    );
    const r = await fetchAndProxyLogo('https://cdn.example.com/huge.png');
    expect(r).toEqual({ ok: false, error: 'RESPONSE_TOO_LARGE' });
    expect(s.cancelled()).toBe(true);
  });

  test('a declared Content-Length over the cap is refused before reading', async () => {
    const s = endless();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(s.body, {
            headers: { 'content-type': 'image/png', 'content-length': String(LOGO_MAX_BYTES + 1) },
          })
      )
    );
    const r = await fetchAndProxyLogo('https://cdn.example.com/huge.png');
    expect(r).toEqual({ ok: false, error: 'RESPONSE_TOO_LARGE' });
    expect(s.pulled()).toBeLessThanOrEqual(1);
  });

  test('a body at or under the cap is returned whole', async () => {
    const bytes = new Uint8Array(1000).fill(7);
    const out = await readCapped(new Response(bytes), LOGO_MAX_BYTES);
    expect(out).toEqual(bytes);
  });
});
