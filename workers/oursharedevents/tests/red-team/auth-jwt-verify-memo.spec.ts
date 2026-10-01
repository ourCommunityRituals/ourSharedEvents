/**
 * Per-request CF Access signature memo (architecture review 2026-10-01) —
 * node-clean half, so Stryker (node project only) kills the memo mutants in
 * src/auth/admin.ts. The route() wiring half is admin-jwt-verify-memo.spec.ts.
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
import {
  verifyCfAccessJWT,
  requireAdmin,
  __resetJwksCacheForTests,
  type AdminEnv,
} from '../../src/auth/admin';

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

describe('signature verdict is shared within ONE request only', () => {
  test('two checks on the same request → one RSA verification', async () => {
    armJwks();
    const jwt = await signJwt(claims());
    const r = req(jwt);
    const verify = spyVerify();
    expect(await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).toEqual({
      valid: true,
      email: ADMIN,
    });
    expect(await verifyCfAccessJWT(jwt, DOMAIN, { request: r, expectedAud: AUD })).toEqual({
      valid: true,
      email: ADMIN,
    });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  test('a different request with the same token verifies again', async () => {
    armJwks();
    const jwt = await signJwt(claims());
    const verify = spyVerify();
    await verifyCfAccessJWT(jwt, DOMAIN, { request: req(jwt) });
    await verifyCfAccessJWT(jwt, DOMAIN, { request: req(jwt) });
    expect(verify).toHaveBeenCalledTimes(2);
  });

  test('no request passed → no memo (every call verifies)', async () => {
    armJwks();
    const jwt = await signJwt(claims());
    const verify = spyVerify();
    await verifyCfAccessJWT(jwt, DOMAIN);
    await verifyCfAccessJWT(jwt, DOMAIN);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  test('a different token on the same request is verified on its own', async () => {
    armJwks();
    const good = await signJwt(claims());
    const forged = await signJwt(claims(), attackerKey.privateKey);
    const r = req(good);
    expect((await verifyCfAccessJWT(good, DOMAIN, { request: r })).valid).toBe(true);
    expect((await verifyCfAccessJWT(forged, DOMAIN, { request: r })).valid).toBe(false);
  });
});

describe('a memo hit never skips a claim check', () => {
  test('aud pin is enforced on the memo hit', async () => {
    armJwks();
    const jwt = await signJwt(claims());
    const r = req(jwt);
    // Pre-flight shape: no aud pin → valid, verdict memoised.
    expect((await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).valid).toBe(true);
    // requireAdmin shape with a DIFFERENT expected aud → must still fail.
    expect(
      await verifyCfAccessJWT(jwt, DOMAIN, { request: r, expectedAud: 'some-other-app' })
    ).toEqual({ valid: false });
  });

  test('iss pin is enforced on the memo hit', async () => {
    armJwks();
    const jwt = await signJwt(claims({ iss: 'https://evil.cloudflareaccess.com' }));
    const r = req(jwt);
    expect((await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).valid).toBe(true);
    expect(await verifyCfAccessJWT(jwt, DOMAIN, { request: r, expectedAud: AUD })).toEqual({
      valid: false,
    });
  });

  test('expiry is enforced on the memo hit', async () => {
    armJwks();
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-01T12:00:00Z');
    vi.setSystemTime(t0);
    const jwt = await signJwt(claims({ iat: nowSec() - 10, exp: nowSec() + 30 }));
    const r = req(jwt);
    expect((await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).valid).toBe(true);
    vi.setSystemTime(new Date(t0.getTime() + 60_000));
    expect(await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).toEqual({ valid: false });
  });
});

describe('failure verdicts', () => {
  test('a bad signature stays invalid on the memo path', async () => {
    armJwks();
    const forged = await signJwt(claims(), attackerKey.privateKey);
    const r = req(forged);
    const verify = spyVerify();
    expect(await verifyCfAccessJWT(forged, DOMAIN, { request: r })).toEqual({ valid: false });
    expect(await verifyCfAccessJWT(forged, DOMAIN, { request: r })).toEqual({ valid: false });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  test('a JWKS fetch failure is evicted, not replayed', async () => {
    const jwt = await signJwt(claims());
    const r = req(jwt);
    armJwks(500);
    expect(await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).toEqual({ valid: false });
    armJwks(200); // JWKS recovers within the same request
    expect(await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).toEqual({
      valid: true,
      email: ADMIN,
    });
  });
});

describe('requireAdmin reuses the pre-flight verdict', () => {
  test('pre-flight then requireAdmin on the same request → one RSA pass', async () => {
    armJwks();
    const jwt = await signJwt(claims());
    const r = req(jwt);
    const verify = spyVerify();
    expect((await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).valid).toBe(true);
    const env = {
      WORKER_ENV: 'production',
      CF_ACCESS_TEAM_DOMAIN: DOMAIN,
      CF_ACCESS_AUD: AUD,
      ALLOWED_ADMIN_EMAILS: ADMIN,
    } as unknown as AdminEnv;
    expect(await requireAdmin(r, env, 'rid-memo')).toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  test('requireAdmin still refuses a wrong-aud token the pre-flight accepted', async () => {
    armJwks();
    const jwt = await signJwt(claims({ aud: ['another-app'] }));
    const r = req(jwt);
    expect((await verifyCfAccessJWT(jwt, DOMAIN, { request: r })).valid).toBe(true);
    const env = {
      WORKER_ENV: 'production',
      CF_ACCESS_TEAM_DOMAIN: DOMAIN,
      CF_ACCESS_AUD: AUD,
      ALLOWED_ADMIN_EMAILS: ADMIN,
    } as unknown as AdminEnv;
    const res = await requireAdmin(r, env, 'rid-memo-aud');
    expect(res?.status).toBe(401);
  });
});
