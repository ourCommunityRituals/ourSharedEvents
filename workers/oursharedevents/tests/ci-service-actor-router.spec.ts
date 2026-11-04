/**
 * OSE-1800 — the staging CI service actor through the REAL router.
 *
 * tests/red-team/ci-service-actor.spec.ts proves the auth pieces (when the token
 * is accepted, its one-brand scope, never platform). This proves the composition
 * the staging Bruno suite will rely on: a signed, listed service token on a
 * staging-shaped env reads a Free event the way a brand admin does (capped, with
 * the plan note), is refused when it tries to switch the paid report on, and
 * cannot reach another brand's event.
 *
 * The JWKS fetch is stubbed; the RSA key and the token are real.
 *
 * @born-red OSE-1800 | method: svc-as-platform | verified: making
 *   resolveServiceActorScope return { mode: 'all' } turns "reads a Free event
 *   capped" red (isPlatformActor → true → the full view).
 */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { __resetJwksCacheForTests } from '../src/auth/admin';
import { BRANDS, FIXTURE_CELL, seedBrandFixture, routerEnv } from './helpers/brand-matrix';
import { usePaidReportPlan } from './helpers/paid-report-plan';

const DOMAIN = 'test.cloudflareaccess.com';
const AUD = 'aud-staging-admin-app';
const CN = 'ci-brand-admin.access';
const A = BRANDS[0]!;
const B = BRANDS[1]!;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
const enc = (s: string) => new TextEncoder().encode(s);
let key: CryptoKeyPair;
let jwks: { keys: JsonWebKey[] };

async function svcToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ci' })));
  const payload = b64url(
    enc(
      JSON.stringify({
        common_name: CN,
        aud: [AUD],
        iss: `https://${DOMAIN}`,
        iat: now - 10,
        exp: now + 3600,
      })
    )
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    enc(`${header}.${payload}`)
  );
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

/** The test env, shaped like staging with the CI service actor configured for brand A. */
function stagingEnv(): RouterEnv {
  return Object.assign(Object.create(Object.getPrototypeOf(routerEnv)), routerEnv, {
    WORKER_ENV: 'staging',
    CF_ACCESS_TEAM_DOMAIN: DOMAIN,
    CF_ACCESS_AUD: AUD,
    CI_SERVICE_ACTORS: CN,
    CI_SERVICE_ACTOR_BRAND: A.brandId,
  }) as RouterEnv;
}

async function callAsSvc(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Cf-Access-Jwt-Assertion': await svcToken() };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const ctx = createExecutionContext();
  const res = await route(new Request(`https://ose.test${path}`, init), stagingEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const formsDb = () => (env as unknown as { FORMS_DB: D1Database }).FORMS_DB;
async function setFree(): Promise<void> {
  await usePaidReportPlan();
  await formsDb()
    .prepare(
      `UPDATE feature_flags SET enabled = 0 WHERE scope = 'global' AND flag_key = 'analytics.shared-report'`
    )
    .run();
  await formsDb()
    .prepare(
      `DELETE FROM feature_flags WHERE scope = 'event' AND flag_key = 'analytics.shared-report'`
    )
    .run();
}

beforeAll(async () => {
  key = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  jwks = { keys: [await crypto.subtle.exportKey('jwk', key.publicKey)] };
  await seedBrandFixture();
  const db = (env as unknown as { DB: D1Database }).DB;
  await db
    .prepare(`UPDATE poster_deployments SET h3_res7 = ?, is_active = 1 WHERE id = ?`)
    .bind(FIXTURE_CELL, A.posterDeploymentId)
    .run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetJwksCacheForTests();
});

function armJwks() {
  __resetJwksCacheForTests();
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/cdn-cgi/access/certs')) {
      return new Response(JSON.stringify(jwks), { status: 200 });
    }
    return real(input, init);
  });
}

describe('OSE-1800 | the CI service actor is a brand admin through the router', () => {
  test('reads a Free event the way a brand admin does: capped, with the plan note', async () => {
    await setFree();
    armJwks();
    const res = await callAsSvc('GET', `/api/v2/admin/events/${A.activeEventId}/dashboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.reach as Record<string, unknown>).not.toHaveProperty('scansByDay');
    expect(body).toHaveProperty('plan');
  });

  test('is refused when it tries to switch the paid report on (403, with a reference)', async () => {
    await setFree();
    armJwks();
    const res = await callAsSvc(
      'PUT',
      `/api/v2/admin/events/${A.activeEventId}/flags/analytics.shared-report`,
      { enabled: true }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; requestId: string };
    expect(body.code).toBe('EVENT_FLAG_ABOVE_PLAN');
    expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  test("cannot reach another brand's event", async () => {
    await setFree();
    armJwks();
    const res = await callAsSvc('GET', `/api/v2/admin/events/${B.activeEventId}/dashboard`);
    expect(res.status).toBe(404);
  });

  test('a key-only route refuses it', async () => {
    armJwks();
    const res = await callAsSvc('PUT', '/api/v2/admin/flags/forms.survey', { enabled: true });
    expect(res.status).toBe(403);
  });
});

/** A signed Access token with the given claims (same key as the JWKS stub). */
async function signedToken(claims: Record<string, unknown>): Promise<string> {
  const header = b64url(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ci' })));
  const payload = b64url(enc(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    enc(`${header}.${payload}`)
  );
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

async function callWith(jwt: string, path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } }),
    stagingEnv(),
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const humanClaims = (over: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return {
    email: A.ownerEmail,
    aud: [AUD],
    iss: `https://${DOMAIN}`,
    iat: now - 10,
    exp: now + 3600,
    ...over,
  };
};

describe('OSE-1801 | the router refuses an identity before anything is scoped by it', () => {
  // @born-red TL-087 | method: deliberate-fixture-break | date: 2026-11-04
  test('a token for another Access app of the same team is refused at the pre-flight (INVALID_JWT)', async () => {
    armJwks();
    const res = await callWith(
      await signedToken(humanClaims({ aud: ['some-other-app'] })),
      `/api/v2/admin/events/${A.activeEventId}/dashboard`
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_JWT');
  });

  // @born-red TL-085 | method: deliberate-fixture-break | date: 2026-11-04
  test('a signed token whose email reads like an automation key ("key:…") is no identity (401)', async () => {
    armJwks();
    const res = await callWith(
      await signedToken(humanClaims({ email: 'key:ops@example.com' })),
      `/api/v2/admin/events/${A.activeEventId}/dashboard`
    );
    expect(res.status).toBe(401);
  });

  // @born-red TL-089 | method: deliberate-fixture-break | date: 2026-11-04
  test('a token that is not valid yet (nbf a day ahead) is refused (401)', async () => {
    armJwks();
    const later = Math.floor(Date.now() / 1000) + 86_400;
    const res = await callWith(
      await signedToken(humanClaims({ nbf: later, iat: later })),
      `/api/v2/admin/events/${A.activeEventId}/dashboard`
    );
    expect(res.status).toBe(401);
  });

  test('control: the same owner with a good token reads the dashboard (200)', async () => {
    await setFree();
    armJwks();
    const res = await callWith(
      await signedToken(humanClaims()),
      `/api/v2/admin/events/${A.activeEventId}/dashboard`
    );
    expect(res.status).toBe(200);
  });
});
