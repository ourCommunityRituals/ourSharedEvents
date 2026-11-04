import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { route } from '../src/router';
import { bindCorsEnv, corsHeaders, corsOrigin } from '../src/lib/cors';

/**
 * OSE-1417 — production must not trust the staging origin in CORS.
 *
 * Before this change `lib/cors.ts` held one static allowlist that included
 * https://stg.oursharedevents.com, so the production Worker echoed it back as
 * Access-Control-Allow-Origin. Staging runs looser admin fallbacks, so prod
 * trusting it widened prod's attack surface for no benefit.
 *
 * The allowlist is now per env: the staging origin is honoured only when
 * WORKER_ENV === 'staging'. route() binds each request to its env; a request
 * that never went through route() gets the production set (fail closed).
 */

const STG = 'https://stg.oursharedevents.com';
const PROD = 'https://oursharedevents.com';

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function envFor(workerEnv: string): Parameters<typeof route>[1] {
  return { ...(env as object), WORKER_ENV: workerEnv } as unknown as Parameters<typeof route>[1];
}

function preflight(workerEnv: string, origin: string): Promise<Response> {
  return route(
    new Request('https://t.test/api/v2/events', { method: 'OPTIONS', headers: { Origin: origin } }),
    envFor(workerEnv),
    ctx
  );
}

// A handler response (not the preflight): the map refuses coordinate-shaped
// params with 400 before touching D1, and that 400 carries corsHeaders().
function handlerResponse(workerEnv: string, origin: string): Promise<Response> {
  return route(
    new Request('https://t.test/api/v2/events/map?lat=41.8&lng=-87.6', {
      headers: { Origin: origin },
    }),
    envFor(workerEnv),
    ctx
  );
}

describe('OSE-1417 | CORS allowlist is per environment', () => {
  test('production preflight does NOT allow the staging origin', async () => {
    const res = await preflight('production', STG);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  test('staging preflight allows the staging origin', async () => {
    const res = await preflight('staging', STG);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STG);
  });

  test('staging preflight allows the stg-full and stg-empty origins; production does not', async () => {
    for (const origin of [
      'https://stg-full.oursharedevents.com',
      'https://stg-empty.oursharedevents.com',
    ]) {
      const staging = await preflight('staging', origin);
      expect(staging.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const prod = await preflight('production', origin);
      expect(prod.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  test('production preflight still allows production origins', async () => {
    for (const origin of [PROD, 'https://www.oursharedevents.com']) {
      const res = await preflight('production', origin);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
  });

  test('production handler response does NOT carry ACAO for the staging origin', async () => {
    const res = await handlerResponse('production', STG);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  test('staging handler response carries ACAO for the staging origin', async () => {
    const res = await handlerResponse('staging', STG);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STG);
  });

  test('development and test envs do not trust the staging origin either', async () => {
    for (const workerEnv of ['development', 'test']) {
      const res = await preflight(workerEnv, STG);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  test('an unbound request fails closed to the production set', () => {
    const req = new Request('https://t.test/x', { headers: { Origin: STG } });
    expect(corsOrigin(req)).toBeNull();
    expect(corsHeaders(req)).toEqual({});
    const prodReq = new Request('https://t.test/x', { headers: { Origin: PROD } });
    expect(corsOrigin(prodReq)).toBe(PROD);
  });

  test('bindCorsEnv scopes the staging origin to the bound request only', () => {
    const bound = new Request('https://t.test/x', { headers: { Origin: STG } });
    const other = new Request('https://t.test/x', { headers: { Origin: STG } });
    bindCorsEnv(bound, { WORKER_ENV: 'staging' });
    expect(corsOrigin(bound)).toBe(STG);
    expect(corsOrigin(other)).toBeNull();
  });

  test('unknown origins are refused in every env', async () => {
    for (const workerEnv of ['production', 'staging']) {
      const res = await preflight(workerEnv, 'https://evil.example');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });
});
