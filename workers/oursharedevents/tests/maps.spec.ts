/**
 * OSE-1263 (OSE-217 slice) — L1 unit for the Static Maps proxy (src/lib/maps.ts).
 *
 * OSE-217's DoD cited an L1 `maps.spec.ts` over `fetchStaticMapImage`'s error
 * branches; it never existed (the only maps coverage was a `toContain` in
 * public-event-page.spec.ts). This covers every branch, and — the CCR Security
 * concern — proves the API key never reaches the client on the success path.
 *
 * Pure-logic node spec (listed in vitest.node-specs.mjs): maps.ts binds no D1 /
 * SELF, only `fetch` / `Response` / `URLSearchParams`, so `fetch` is stubbed for
 * the upstream branches.
 */

import { describe, test, expect, vi, afterEach } from 'vitest';
import { isGoogleMapsConfigured, fetchStaticMapImage } from '../src/lib/maps';

const KEY = 'test-maps-key-DO-NOT-LEAK-abc123';
const withKey = { GOOGLE_MAPS_API_KEY: KEY };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OSE-1263 — isGoogleMapsConfigured', () => {
  test('true only when the key is present and non-empty', () => {
    expect(isGoogleMapsConfigured({ GOOGLE_MAPS_API_KEY: KEY })).toBe(true);
    expect(isGoogleMapsConfigured({})).toBe(false);
    expect(isGoogleMapsConfigured({ GOOGLE_MAPS_API_KEY: '' })).toBe(false);
    expect(isGoogleMapsConfigured({ GOOGLE_MAPS_API_KEY: '   ' })).toBe(false);
  });
});

describe('OSE-1263 — fetchStaticMapImage guard branches (no upstream call)', () => {
  test('503 when the key is not configured', async () => {
    const res = await fetchStaticMapImage({}, 'Chicago, IL');
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('MAPS_NOT_CONFIGURED');
  });

  test('400 when the venue is empty / whitespace', async () => {
    const res = await fetchStaticMapImage(withKey, '   ');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_VENUE');
  });

  test('400 when the venue exceeds 200 chars', async () => {
    const res = await fetchStaticMapImage(withKey, 'x'.repeat(201));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VENUE_TOO_LONG');
  });
});

describe('OSE-1263 — fetchStaticMapImage upstream branches (fetch stubbed)', () => {
  test('200 proxies image bytes with cache + nosniff headers, strips cookies, and NEVER leaks the key', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    let calledUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        calledUrl = String(url);
        return new Response(png, {
          status: 200,
          headers: { 'content-type': 'image/png', 'set-cookie': 'g=1; HttpOnly' },
        });
      })
    );

    const res = await fetchStaticMapImage(withKey, 'Rock Island Public House, Blue Island IL');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toContain('max-age=86400');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // We build a fresh Response, so Google-set cookies do not pass through.
    expect(res.headers.get('set-cookie')).toBeNull();

    // The key IS sent to Google server-side …
    expect(calledUrl).toContain(KEY);
    // … but must NEVER appear in what we return to the client (headers or body).
    const bodyText = await res.clone().text();
    expect(bodyText).not.toContain(KEY);
    for (const [, value] of res.headers) {
      expect(value).not.toContain(KEY);
    }
  });

  test('502 when Google returns a non-200 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 }))
    );
    const res = await fetchStaticMapImage(withKey, 'Chicago, IL');
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('MAPS_UPSTREAM_STATUS');
  });

  test('502 when the upstream fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    const res = await fetchStaticMapImage(withKey, 'Chicago, IL');
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('MAPS_UPSTREAM_ERROR');
  });
});
