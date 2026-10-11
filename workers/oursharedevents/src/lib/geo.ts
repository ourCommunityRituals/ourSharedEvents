/**
 * Google Maps Geocoding helper — OSE-238 / BE-24 / BE-24b.
 *
 * Companion to `lib/maps.ts` (Static Maps, OSE-217). Same auth pattern (server-
 * side API key, never exposed to the browser); same graceful-degradation
 * philosophy (return a structured failure outcome, never throw).
 *
 * Shipping scope (Co-Arch Option C, 2026-05-14):
 *
 *   - `geocodeVenue(env, address)` — full implementation. Hits
 *     `geocoding-backend.googleapis.com` with the existing GOOGLE_MAPS_API_KEY
 *     secret. Returns a discriminated outcome so callers can map to the
 *     correct HTTP status without re-implementing classification.
 *
 *   - `resolveCorridorId(env, lat, lng)` — STUB. Always returns null + emits a
 *     structured `RESOLVE_CORRIDOR_UNAVAILABLE` log line. Corridor geometry
 *     resolution requires a schema decision (add `bounds_geo_json TEXT` to
 *     corridors and seed from brain YAML, vs. compute from node positions)
 *     that's deferred to follow-on story BE-24b. The stub is load-bearing:
 *     once a strategy is picked, the stub becomes the implementation site
 *     without any caller changes — corridor_id stays nullable in events
 *     (per OSE-236) so null returns don't break downstream stories.
 *
 * GCP prerequisites:
 *   - geocoding-backend.googleapis.com must be enabled on
 *     project-7cc9adcd-ed55-47aa-958 (sibling to OSE-217's
 *     static-maps-backend.googleapis.com). If not enabled, this lib still
 *     ships safely — geocodeVenue returns GEO_UPSTREAM_STATUS gracefully.
 *
 * Test strategy: the optional `fetcher` parameter on geocodeVenue lets unit
 * tests inject a fake fetch without mucking with globalThis. The handler-side
 * spec uses SELF.fetch + the same fetcher seam through env binding.
 */

import { latLngToCell } from 'h3-js';
import { isGoogleMapsConfigured, type MapsEnv } from './maps';

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
  /** Google's result types, e.g. ['street_address'] or ['locality', 'political']. */
  types?: string[];
  /** True when Google matched only part of the query. */
  partial_match?: boolean;
}

/**
 * Discriminated outcome shape. Every code maps to a single HTTP status the
 * handler returns, so the lib owns classification, not the caller.
 */
export type GeocodeOutcome =
  | { ok: true; result: GeocodeResult }
  | {
      ok: false;
      code:
        | 'GEO_NOT_CONFIGURED'
        | 'INVALID_ADDRESS'
        | 'GEO_NO_RESULTS'
        | 'GEO_UPSTREAM_ERROR'
        | 'GEO_UPSTREAM_STATUS';
      error: string;
      status: number;
    };

type Fetcher = typeof fetch;

const ADDRESS_MAX = 500;

/**
 * Hit the Google Geocoding API and translate the response into a discriminated
 * outcome. Never throws — every failure path returns `{ ok: false }` with a
 * classified code so handlers don't have to map errors twice.
 *
 * `fetcher` is the dependency-injection seam for unit tests. Production calls
 * use globalThis.fetch.
 */
export async function geocodeVenue(
  env: MapsEnv,
  address: string,
  fetcher: Fetcher = globalThis.fetch
): Promise<GeocodeOutcome> {
  // Validate inputs BEFORE checking config. Rationale: an empty or
  // oversized address is a 400 (client error) regardless of whether the
  // server happens to have an API key configured. Reversing the order
  // would mask client errors as "service unavailable" in env-less test
  // setups, and more importantly, return the wrong HTTP class even in
  // production if the key ever rotated to empty.
  const trimmed = typeof address === 'string' ? address.trim() : '';
  if (!trimmed) {
    return {
      ok: false,
      code: 'INVALID_ADDRESS',
      error: 'address is required',
      status: 400,
    };
  }
  if (trimmed.length > ADDRESS_MAX) {
    return {
      ok: false,
      code: 'INVALID_ADDRESS',
      error: `address must be ${ADDRESS_MAX} chars or fewer`,
      status: 400,
    };
  }

  if (!isGoogleMapsConfigured(env)) {
    return {
      ok: false,
      code: 'GEO_NOT_CONFIGURED',
      error: 'Google Maps API key not set',
      status: 503,
    };
  }

  const params = new URLSearchParams({
    address: trimmed,
    key: env.GOOGLE_MAPS_API_KEY!,
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;

  let upstream: Response;
  try {
    upstream = await fetcher(url);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'GEO_FETCH_ERROR',
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      })
    );
    return {
      ok: false,
      code: 'GEO_UPSTREAM_ERROR',
      error: 'Failed to reach Google Geocoding API',
      status: 502,
    };
  }

  if (!upstream.ok) {
    console.warn(
      JSON.stringify({
        type: 'GEO_UPSTREAM_STATUS',
        status: upstream.status,
        timestamp: new Date().toISOString(),
      })
    );
    return {
      ok: false,
      code: 'GEO_UPSTREAM_STATUS',
      error: `Google Geocoding returned ${upstream.status}`,
      status: 502,
    };
  }

  let payload: GoogleGeocodeResponse;
  try {
    payload = (await upstream.json()) as GoogleGeocodeResponse;
  } catch (err) {
    return {
      ok: false,
      code: 'GEO_UPSTREAM_ERROR',
      error: 'Google response was not valid JSON',
      status: 502,
    };
  }

  // The Google envelope uses a string `status` field. Anything other than
  // "OK" is a failure; classify the most common ones so ops can grep them.
  if (payload.status !== 'OK') {
    if (payload.status === 'ZERO_RESULTS') {
      return {
        ok: false,
        code: 'GEO_NO_RESULTS',
        error: 'Address did not resolve to any location',
        status: 404,
      };
    }
    console.warn(
      JSON.stringify({
        type: 'GEO_UPSTREAM_STATUS',
        googleStatus: payload.status,
        timestamp: new Date().toISOString(),
      })
    );
    return {
      ok: false,
      code: 'GEO_UPSTREAM_STATUS',
      error: `Google Geocoding status: ${payload.status}`,
      status: 502,
    };
  }

  const first = payload.results?.[0];
  if (!first?.geometry?.location) {
    return {
      ok: false,
      code: 'GEO_NO_RESULTS',
      error: 'Address resolved with no location data',
      status: 404,
    };
  }

  return {
    ok: true,
    result: {
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
      formatted_address: first.formatted_address ?? trimmed,
      types: Array.isArray(first.types) ? first.types : [],
      partial_match: first.partial_match === true,
    },
  };
}

/**
 * BE-24b: Resolve corridor identifier from lat/lng via H3 res7 cell.
 *
 * Treats the H3 resolution-7 cell string (~5km² / ~2mi² hexagon) as the
 * canonical corridor identifier. This eliminates the corridors table
 * indirection for density purposes — the cell string IS the corridor_id
 * stored in events, corridor_density_baseline, and corridor_density_snapshots.
 *
 * Resolution choice: res7 (~5km²) maps to the NCR "corridor" concept — large
 * enough to span a commercial strip, small enough to be commercially distinct
 * from adjacent neighborhoods.
 *
 * Returns null only if the h3 cell computation fails (invalid coordinates).
 */
export async function resolveCorridorId(
  _env: MapsEnv,
  lat: number,
  lng: number
): Promise<string | null> {
  try {
    return latLngToCell(lat, lng, 7);
  } catch {
    console.log(
      JSON.stringify({
        type: 'RESOLVE_CORRIDOR_ERROR',
        reason: 'h3_cell_computation_failed',
        lat,
        lng,
      })
    );
    return null;
  }
}

// ─── Internal types for the Google response envelope ─────────────────────────

interface GoogleGeocodeResponse {
  status: string;
  results?: Array<{
    geometry?: { location?: { lat: number; lng: number } };
    formatted_address?: string;
    types?: string[];
    partial_match?: boolean;
  }>;
  error_message?: string;
}
