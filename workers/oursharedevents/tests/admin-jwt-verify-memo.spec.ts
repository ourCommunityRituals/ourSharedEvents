/**
 * Per-request CF Access signature memo — route() wiring half (workers pool).
 * Memo semantics + Stryker kills live in tests/red-team/auth-jwt-verify-memo.spec.ts.
 *
 * One admin request used to RSA-verify the same CF Access JWT twice: once in
 * the router pre-flight, again in requireAdmin. verifyCfAccessJWT now accepts
 * `opts.request` and shares the SIGNATURE verdict within that one request.
 *
 * What this spec pins (each case is a way the memo could weaken auth):
 *   - one RSA pass per request, not per call (the point of the change);
 *   - nothing is shared across requests, or when no request is passed;
 *   - a memo hit still enforces the aud pin and the expiry;
 *   - a bad signature stays bad on the memo path;
 *   - a JWKS failure is evicted, not replayed as a verdict;
 *   - the router + requireAdmin wiring really shares the verdict end to end.
 */

import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { __resetJwksCacheForTests, type AdminEnv } from '../src/auth/admin';
import { route, type RouterEnv } from '../src/router';

const DOMAIN = 'test.cloudflareaccess.com';
const ADMIN = 'admin@oursharedevents.com';
const AUD = 'ose-admin-aud';

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
const enc = (s: string) => new TextEncoder().encode(s);
const seg = (obj: unknown) => b64url(enc(JSON.stringify(obj)));
const nowSec = () => Math.floor(Date.now() / 1000);
const claims = (extra: Record<string, unknown> = {}) => ({
  email: ADMIN,
  iss: `https://${DOMAIN}`,
  aud: [AUD],
  iat: nowSec() - 10,
  exp: nowSec() + 3600,
  ...extra,
});

let signingKey: CryptoKeyPair;
let attackerKey: CryptoKeyPair;
let realJwk: JsonWebKey;

beforeAll(async () => {
  const alg = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };
  signingKey = (await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;
  attackerKey = (await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;
  realJwk = await crypto.subtle.exportKey('jwk', signingKey.publicKey);
});

async function signJwt(
  c: Record<string, unknown>,
  priv: CryptoKey = signingKey.privateKey
): Promise<string> {
  const header = seg({ alg: 'RS256', typ: 'JWT', kid: 'test' });
  const payload = seg(c);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, enc(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

/** Serve the real public key as the team JWKS; returns the fetch mock. */
function armJwks(status = 200) {
  __resetJwksCacheForTests();
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ keys: [realJwk] }), { status })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Count RSA verifications (calls through to the real implementation). */
const spyVerify = () => vi.spyOn(crypto.subtle, 'verify');

const req = (jwt: string, path = '/api/v2/admin/flags/tiers') =>
  new Request(`https://localhost${path}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  __resetJwksCacheForTests();
});

describe('end to end: router pre-flight + requireAdmin share one verdict', () => {
  const env = (): AdminEnv =>
    ({
      WORKER_ENV: 'production',
      CF_ACCESS_TEAM_DOMAIN: DOMAIN,
      CF_ACCESS_AUD: AUD,
      ALLOWED_ADMIN_EMAILS: ADMIN,
    }) as unknown as AdminEnv;
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  test('route(): an authenticated admin GET costs one RSA verification', async () => {
    armJwks();
    const jwt = await signJwt(claims());
    const verify = spyVerify();
    const res = await route(req(jwt), env() as unknown as RouterEnv, ctx);
    expect(res.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  test('route(): a forged token is still refused', async () => {
    armJwks();
    const forged = await signJwt(claims(), attackerKey.privateKey);
    const res = await route(req(forged), env() as unknown as RouterEnv, ctx);
    expect(res.status).toBe(401);
  });
});
