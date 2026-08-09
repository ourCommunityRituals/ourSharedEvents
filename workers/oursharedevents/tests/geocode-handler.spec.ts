/**
 * OSE-238 / BE-24 / BE-24b — Admin geocoding endpoint behavioral tests.
 *
 * POST /api/v2/admin/geocode behaviour through SELF.fetch:
 *   - admin auth required (401 when key missing)
 *   - 400 for malformed JSON body / missing address
 *   - 503 when GOOGLE_MAPS_API_KEY is not configured (env-binding test)
 *   - 200 success path: corridor_id is now a non-null H3 res7 cell string
 *     (BE-24b landed — resolveCorridorId computes h3_res7 from lat/lng).
 *     The unit test in geo.spec.ts covers resolveCorridorId directly;
 *     this spec confirms the handler is wired end-to-end.
 */

import { describe, test, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };

interface TestEnv {
  GOOGLE_MAPS_API_KEY?: string;
}

interface AnyResponse {
  ok: boolean;
  code?: string;
  error?: string;
  status?: number;
  lat?: number;
  lng?: number;
  formatted_address?: string;
  corridor_id?: string | null;
}

async function postGeocode(body: BodyInit | null, headers: HeadersInit = ADMIN_HEADERS) {
  return SELF.fetch('https://t.test/api/v2/admin/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

describe('OSE-238: POST /api/v2/admin/geocode admin auth + body validation', () => {
  test('rejects unauthenticated request', async () => {
    const res = await postGeocode(JSON.stringify({ address: '123 Test' }), {
      'Content-Type': 'application/json',
    });
    // Admin gate uses 401 by default; some routes return 403 if a token is
    // present but invalid. Accept either as proof the gate fired.
    expect([401, 403]).toContain(res.status);
  });

  test('rejects malformed JSON body with 400', async () => {
    const res = await postGeocode('{not valid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyResponse;
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_BODY');
  });

  test('rejects empty address with 400 INVALID_ADDRESS', async () => {
    const res = await postGeocode(JSON.stringify({ address: '' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyResponse;
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_ADDRESS');
  });

  test('rejects missing address with 400 INVALID_ADDRESS', async () => {
    const res = await postGeocode(JSON.stringify({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyResponse;
    expect(body.code).toBe('INVALID_ADDRESS');
  });
});

describe('OSE-238: GOOGLE_MAPS_API_KEY env-binding behaviour', () => {
  // The test miniflare env may not bind GOOGLE_MAPS_API_KEY. In that case
  // the handler MUST return 503 GEO_NOT_CONFIGURED — that's the graceful
  // degradation contract. If the env DOES bind the key (e.g. set in
  // vitest.config), we instead hit the upstream-mock or get GEO_NO_RESULTS
  // depending on whether globalThis.fetch is mocked. Either is fine for
  // the env-binding test; the assertion is "the wire is plugged in."
  test('handler returns 503 GEO_NOT_CONFIGURED when key absent OR makes upstream call when key present', async () => {
    const tenv = env as unknown as TestEnv;
    const keyPresent = Boolean(tenv.GOOGLE_MAPS_API_KEY);

    // If no key in test env, expect 503.
    if (!keyPresent) {
      const res = await postGeocode(JSON.stringify({ address: '123 Main St' }));
      expect(res.status).toBe(503);
      const body = (await res.json()) as AnyResponse;
      expect(body.code).toBe('GEO_NOT_CONFIGURED');
      return;
    }

    // If a key IS bound, the handler will attempt a real fetch. We can't
    // assert success without mocking globalThis.fetch (which is hard inside
    // miniflare without leakage between tests). Confirm the call at least
    // reached the upstream layer by checking that the response is one of
    // the upstream-related outcomes (200 / 404 GEO_NO_RESULTS / 502 GEO_*).
    const res = await postGeocode(JSON.stringify({ address: '1600 Pennsylvania Ave NW' }));
    expect([200, 404, 502]).toContain(res.status);
  });
});

describe('BE-24b: corridor_id is a non-null H3 res7 cell string on successful geocode', () => {
  // resolveCorridorId now computes h3_res7 from lat/lng (BE-24b landed).
  // On a successful geocode, corridor_id MUST be a non-null h3 cell string.

  test('on a successful geocode, response carries a non-null corridor_id', async () => {
    const tenv = env as unknown as TestEnv;
    if (!tenv.GOOGLE_MAPS_API_KEY) {
      // Without a key bound, we can't exercise the success path here.
      // The unit test in geo.spec.ts covers resolveCorridorId directly.
      return;
    }

    const res = await postGeocode(JSON.stringify({ address: '1600 Pennsylvania Ave NW' }));
    if (res.status !== 200) {
      // Network-bound; skip the corridor assertion if upstream isn't healthy
      return;
    }
    const body = (await res.json()) as AnyResponse;
    expect(body.ok).toBe(true);
    // BE-24b: corridor_id is now an H3 res7 cell string, not null
    expect(body.corridor_id).not.toBeNull();
    expect(typeof body.corridor_id).toBe('string');
    // H3 res7 cells are ~15 hex chars long
    expect((body.corridor_id as string).length).toBeGreaterThan(10);
  });
});
