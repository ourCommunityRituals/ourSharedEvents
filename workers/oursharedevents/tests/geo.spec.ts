/**
 * OSE-238 / BE-24 — Geocoding lib unit tests.
 *
 * Covers every branch of geocodeVenue + resolveCorridorId (stub) without
 * making a real Google Maps API call. The `fetcher` dependency-injection
 * seam on geocodeVenue lets us pass a fake fetch per test.
 *
 * resolveCorridorId is the Option C stub — always returns null + emits
 * RESOLVE_CORRIDOR_UNAVAILABLE. The test asserts both behaviours so when
 * BE-24b lands a real implementation, the contract change is visible
 * here too.
 */

import { describe, test, expect, vi } from 'vitest';
import { geocodeVenue, resolveCorridorId } from '../src/lib/geo';

interface MockEnv {
  GOOGLE_MAPS_API_KEY?: string;
}

const CONFIGURED: MockEnv = { GOOGLE_MAPS_API_KEY: 'test-key-not-real' };
const UNCONFIGURED: MockEnv = {};

function googleOkResponse(lat: number, lng: number, formatted: string): Response {
  return new Response(
    JSON.stringify({
      status: 'OK',
      results: [
        {
          geometry: { location: { lat, lng } },
          formatted_address: formatted,
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function googleStatusResponse(status: string): Response {
  return new Response(JSON.stringify({ status, results: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('geocodeVenue', () => {
  test('returns GEO_NOT_CONFIGURED (503) when API key is missing', async () => {
    const fetcher = vi.fn();
    const outcome = await geocodeVenue(UNCONFIGURED, '123 Anywhere', fetcher);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('GEO_NOT_CONFIGURED');
      expect(outcome.status).toBe(503);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('returns INVALID_ADDRESS (400) when address is empty or whitespace', async () => {
    const fetcher = vi.fn();
    for (const empty of ['', '   ', '\n\t']) {
      const outcome = await geocodeVenue(CONFIGURED, empty, fetcher);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe('INVALID_ADDRESS');
        expect(outcome.status).toBe(400);
      }
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('returns INVALID_ADDRESS (400) when address exceeds 500 chars', async () => {
    const fetcher = vi.fn();
    const huge = 'a'.repeat(600);
    const outcome = await geocodeVenue(CONFIGURED, huge, fetcher);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('INVALID_ADDRESS');
      expect(outcome.status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('returns ok:true with lat/lng/formatted when Google returns OK', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(googleOkResponse(41.6, -87.7, '123 Test St, Blue Island, IL 60406, USA'));
    const outcome = await geocodeVenue(CONFIGURED, 'Eagles Bowl, Blue Island IL', fetcher);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.lat).toBe(41.6);
      expect(outcome.result.lng).toBe(-87.7);
      expect(outcome.result.formatted_address).toContain('Blue Island');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    // API key MUST be in the URL — that's how Google authenticates.
    const calledUrl = fetcher.mock.calls[0][0] as string;
    expect(calledUrl).toContain('key=test-key-not-real');
    expect(calledUrl).toContain('address=');
  });

  test('returns GEO_NO_RESULTS (404) when Google returns ZERO_RESULTS', async () => {
    const fetcher = vi.fn().mockResolvedValue(googleStatusResponse('ZERO_RESULTS'));
    const outcome = await geocodeVenue(CONFIGURED, 'asdfghjkl nonsense', fetcher);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('GEO_NO_RESULTS');
      expect(outcome.status).toBe(404);
    }
  });

  test('returns GEO_UPSTREAM_STATUS (502) on other Google statuses', async () => {
    // OVER_DAILY_LIMIT, REQUEST_DENIED, INVALID_REQUEST, etc.
    const fetcher = vi.fn().mockResolvedValue(googleStatusResponse('REQUEST_DENIED'));
    const outcome = await geocodeVenue(CONFIGURED, 'any address', fetcher);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('GEO_UPSTREAM_STATUS');
      expect(outcome.status).toBe(502);
    }
  });

  test('returns GEO_UPSTREAM_STATUS (502) when Google HTTP status is non-200', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('upstream error', { status: 500 }));
    const outcome = await geocodeVenue(CONFIGURED, 'any address', fetcher);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('GEO_UPSTREAM_STATUS');
      expect(outcome.status).toBe(502);
    }
  });

  test('returns GEO_UPSTREAM_ERROR (502) when fetch throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const outcome = await geocodeVenue(CONFIGURED, 'any address', fetcher);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('GEO_UPSTREAM_ERROR');
      expect(outcome.status).toBe(502);
    }
  });

  test('returns GEO_UPSTREAM_ERROR (502) when response is not valid JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('not json at all', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const outcome = await geocodeVenue(CONFIGURED, 'any address', fetcher);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('GEO_UPSTREAM_ERROR');
      expect(outcome.status).toBe(502);
    }
  });

  test('returns GEO_NO_RESULTS when OK status but missing geometry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'OK', results: [{ formatted_address: 'no geom' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    const outcome = await geocodeVenue(CONFIGURED, 'any address', fetcher);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('GEO_NO_RESULTS');
    }
  });
});

describe('resolveCorridorId (BE-24b: H3 res7 cell as corridor identifier)', () => {
  test('returns a non-null h3 cell string for valid coordinates', async () => {
    const result = await resolveCorridorId({}, 41.6, -87.7);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  test('returns the correct h3 res7 cell for Eagles Hall ground-truth coordinates', async () => {
    // Eagles Hall, Blue Island IL: lat=41.6571, lon=-87.6798
    // Expected h3_res7 = '872664544ffffff' (same as h3-tagging.spec.ts NCR ground truth)
    const result = await resolveCorridorId({}, 41.6571, -87.6798);
    expect(result).toBe('872664544ffffff');
  });

  test('returns a different cell for a distant location (Chicago Loop ~15km away)', async () => {
    const eagles = await resolveCorridorId({}, 41.6571, -87.6798);
    const loop = await resolveCorridorId({}, 41.8827, -87.6233);
    expect(eagles).not.toBe(loop);
    expect(loop).not.toBeNull();
  });

  test('env parameter is not required for computation (corridor_id is pure geo)', async () => {
    // Geocode API key is irrelevant — computation is purely geometric
    const withKey = await resolveCorridorId({ GOOGLE_MAPS_API_KEY: 'real-key' }, 41.6571, -87.6798);
    const withoutKey = await resolveCorridorId({}, 41.6571, -87.6798);
    expect(withKey).toBe(withoutKey);
  });

  // ── OSE-633: TEST-GEO-01 — RESOLVE_CORRIDOR_ERROR catch branch ─────────────
  // h3-js throws when coordinates are NaN (the only input that triggers the
  // catch branch — out-of-range numeric values are silently wrapped by h3-js).
  // resolveCorridorId must return null (not throw) and emit RESOLVE_CORRIDOR_ERROR.

  test('OSE-633 | TEST-GEO-01 | NaN lat | returns null without throwing', async () => {
    const result = await resolveCorridorId({}, NaN, -87);
    expect(result).toBeNull();
  });

  test('OSE-633 | TEST-GEO-01 | NaN lng | returns null without throwing', async () => {
    const result = await resolveCorridorId({}, 41.6, NaN);
    expect(result).toBeNull();
  });

  test('OSE-633 | TEST-GEO-01 | both NaN | resolveCorridorId is exception-safe (never throws)', async () => {
    await expect(resolveCorridorId({}, NaN, NaN)).resolves.toBeNull();
  });
});
