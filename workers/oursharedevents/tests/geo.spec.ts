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

import { describe, test, expect, vi, beforeEach } from 'vitest';
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

describe('resolveCorridorId (Option C stub, OSE-238)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Replace + reset between cases so call counts are deterministic.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  test('always returns null (corridor resolution deferred to BE-24b)', async () => {
    const result = await resolveCorridorId({}, 41.6, -87.7);
    expect(result).toBeNull();
  });

  test('emits structured RESOLVE_CORRIDOR_UNAVAILABLE log line on the call', async () => {
    // Find the call that came FROM this test (not any other tests that
    // share the spec-level beforeEach reset). The spy is reset per-test
    // above; any other console.log invocations inside the lib itself
    // would still count here.
    await resolveCorridorId({}, 41.6, -87.7);
    expect(logSpy).toHaveBeenCalled();
    const stubLog = logSpy.mock.calls
      .map((args) => args[0])
      .filter((arg): arg is string => typeof arg === 'string')
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.type === 'RESOLVE_CORRIDOR_UNAVAILABLE');
    expect(stubLog, 'RESOLVE_CORRIDOR_UNAVAILABLE log not emitted').toBeDefined();
    expect(stubLog!.lat).toBe(41.6);
    expect(stubLog!.lng).toBe(-87.7);
    expect(stubLog!.reason).toContain('BE-24b');
    // ISO timestamp present so log aggregators can sort.
    expect(stubLog!.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('returns null even when env carries an API key (the stub is the point)', async () => {
    const result = await resolveCorridorId({ GOOGLE_MAPS_API_KEY: 'real-key' }, 0, 0);
    expect(result).toBeNull();
  });
});
