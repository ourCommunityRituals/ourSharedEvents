/**
 * OSE-1278 (G1 follow-on) — node-clean coverage for the CF Access JWT signature
 * path (verifyCfAccessJWT / _fetchJwks / _getJwks in src/auth/admin.ts), so
 * StrykerJS mutation can reach it off the workerd pool.
 *
 * The other admin specs run requireAdmin with CF_ACCESS_TEAM_DOMAIN UNSET, so the
 * JWKS signature-verify branch never executes (105 no-coverage mutants at the
 * OSE-1278 baseline). This harness sets the domain, generates a real RSA keypair,
 * signs a CF-Access-shaped JWT, and stubs fetch to serve the matching JWKS — so
 * the crypto path runs for real. The module-level JWKS cache is reset per test via
 * __resetJwksCacheForTests() (stryker-compatible — vi.resetModules breaks Stryker
 * per-test coverage).
 */

import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  requireAdmin,
  verifyCfAccessJWT,
  __resetJwksCacheForTests,
  type AdminEnv,
} from '../../src/auth/admin';

const DOMAIN = 'test.cloudflareaccess.com';
const ALLOWLISTED = 'admin@oursharedevents.com';

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
const enc = (s: string) => new TextEncoder().encode(s);

let signingKey: CryptoKeyPair;
let attackerKey: CryptoKeyPair;
let jwks: { keys: JsonWebKey[] };

beforeAll(async () => {
  const alg = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };
  signingKey = (await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;
  attackerKey = (await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', signingKey.publicKey);
  jwks = { keys: [jwk] };
});

/** Sign a CF-Access-shaped JWT with the given private key. */
async function signJwt(
  claims: Record<string, unknown>,
  priv: CryptoKey = signingKey.privateKey
): Promise<string> {
  const header = b64url(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test' })));
  const payload = b64url(enc(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, enc(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const validClaims = (email = ALLOWLISTED) => ({ email, iat: nowSec() - 10, exp: nowSec() + 3600 });

function req(jwt: string): Request {
  return new Request('https://x/api/v2/admin/sponsors', {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
}
const envWithDomain = (): AdminEnv =>
  ({
    WORKER_ENV: 'production',
    CF_ACCESS_TEAM_DOMAIN: DOMAIN,
    ALLOWED_ADMIN_EMAILS: ALLOWLISTED,
  }) as unknown as AdminEnv;

/** Reset the JWKS cache and install a fetch stub serving the JWKS (static import,
 *  stryker-compatible — no vi.resetModules). */
function armFetch(fetchImpl?: () => Promise<Response>) {
  __resetJwksCacheForTests();
  const fetchMock = vi.fn(
    fetchImpl ?? (async () => new Response(JSON.stringify(jwks), { status: 200 }))
  );
  vi.stubGlobal('fetch', fetchMock);
  return { requireAdmin, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetJwksCacheForTests();
});

describe('OSE-1278 — CF Access JWT signature verification (domain set)', () => {
  test('valid signature + allowlisted email → authenticated (null)', async () => {
    const { requireAdmin } = armFetch();
    const res = await requireAdmin(req(await signJwt(validClaims())), envWithDomain(), 'ok');
    expect(res).toBeNull();
  });

  test('valid signature + NON-allowlisted email → 403 (allowlist still applies)', async () => {
    const { requireAdmin } = armFetch();
    const res = await requireAdmin(
      req(await signJwt(validClaims('stranger@nowhere.test'))),
      envWithDomain(),
      'x'
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  test('WRONG-key signature (JWKS has the real key) → 401', async () => {
    const { requireAdmin } = armFetch();
    const forged = await signJwt(validClaims(), attackerKey.privateKey);
    const res = await requireAdmin(req(forged), envWithDomain(), 'x');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('expired token (valid signature) → 401', async () => {
    const { requireAdmin } = armFetch();
    const jwt = await signJwt({ email: ALLOWLISTED, iat: nowSec() - 7200, exp: nowSec() - 3600 });
    const res = await requireAdmin(req(jwt), envWithDomain(), 'x');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('missing exp → 401', async () => {
    const { requireAdmin } = armFetch();
    const jwt = await signJwt({ email: ALLOWLISTED, iat: nowSec() - 10 });
    const res = await requireAdmin(req(jwt), envWithDomain(), 'x');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('malformed JWT (2 segments) → 401', async () => {
    const { requireAdmin } = armFetch();
    const res = await requireAdmin(req('only.twoparts'), envWithDomain(), 'x');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('JWKS endpoint returns non-OK → fail closed (401), never trusts the JWT', async () => {
    const { requireAdmin } = armFetch(async () => new Response('unavailable', { status: 503 }));
    const res = await requireAdmin(req(await signJwt(validClaims())), envWithDomain(), 'x');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('JWKS is cached: two verifications fetch the key only once', async () => {
    const { requireAdmin, fetchMock } = armFetch();
    await requireAdmin(req(await signJwt(validClaims())), envWithDomain(), 'a');
    await requireAdmin(req(await signJwt(validClaims())), envWithDomain(), 'b');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── OSE-1377 — audience + issuer pin (dark unless CF_ACCESS_AUD is set) ──────
const AUD = 'ose-admin-aud-tag-abc123';
const envWithAud = (): AdminEnv =>
  ({
    WORKER_ENV: 'production',
    CF_ACCESS_TEAM_DOMAIN: DOMAIN,
    CF_ACCESS_AUD: AUD,
    ALLOWED_ADMIN_EMAILS: ALLOWLISTED,
  }) as unknown as AdminEnv;

const audClaims = (over: Record<string, unknown> = {}) => ({
  ...validClaims(),
  aud: [AUD],
  iss: `https://${DOMAIN}`,
  ...over,
});

describe('OSE-1377 — audience + issuer pin (CF_ACCESS_AUD set)', () => {
  test('valid sig + correct aud + correct iss + allowlisted email → authenticated (null)', async () => {
    const { requireAdmin } = armFetch();
    const res = await requireAdmin(req(await signJwt(audClaims())), envWithAud(), 'ok');
    expect(res).toBeNull();
  });

  test('valid sig but WRONG aud → 401 (a signature-valid token for another same-team app)', async () => {
    const { requireAdmin } = armFetch();
    const res = await requireAdmin(
      req(await signJwt(audClaims({ aud: ['some-other-app-aud'] }))),
      envWithAud(),
      'x'
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('valid sig but MISSING aud → 401', async () => {
    const { requireAdmin } = armFetch();
    const res = await requireAdmin(
      req(await signJwt(audClaims({ aud: undefined }))),
      envWithAud(),
      'x'
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('valid sig but WRONG iss → 401', async () => {
    const { requireAdmin } = armFetch();
    const res = await requireAdmin(
      req(await signJwt(audClaims({ iss: 'https://evil.cloudflareaccess.com' }))),
      envWithAud(),
      'x'
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('aud as a single string (not an array) is accepted', async () => {
    const { requireAdmin } = armFetch();
    const res = await requireAdmin(req(await signJwt(audClaims({ aud: AUD }))), envWithAud(), 'ok');
    expect(res).toBeNull();
  });

  test('DARK: CF_ACCESS_AUD unset → aud/iss NOT enforced (backward compatible)', async () => {
    const { requireAdmin } = armFetch();
    // Token carries NO aud/iss, but with CF_ACCESS_AUD unset (envWithDomain) it
    // still authenticates — proving the pin is a no-op until activated.
    const res = await requireAdmin(req(await signJwt(validClaims())), envWithDomain(), 'ok');
    expect(res).toBeNull();
  });
});

describe('OSE-1801 | verifyCfAccessJWT refuses a token that is not an identity, before the signature', () => {
  test('nbf beyond the skew: { valid: false }', async () => {
    armFetch();
    const jwt = await signJwt({ ...validClaims(), nbf: nowSec() + 3600 });
    expect(await verifyCfAccessJWT(jwt, DOMAIN)).toEqual({ valid: false });
  });

  test('iat beyond the skew: { valid: false }', async () => {
    armFetch();
    const jwt = await signJwt({ ...validClaims(), iat: nowSec() + 3600 });
    expect(await verifyCfAccessJWT(jwt, DOMAIN)).toEqual({ valid: false });
  });

  test('an email that is not a plain address ("key:…"): { valid: false }', async () => {
    armFetch();
    const jwt = await signJwt(validClaims('key:ops@oursharedevents.com'));
    expect(await verifyCfAccessJWT(jwt, DOMAIN)).toEqual({ valid: false });
  });

  test('control: the same good token verifies with its email', async () => {
    armFetch();
    const jwt = await signJwt(validClaims());
    expect(await verifyCfAccessJWT(jwt, DOMAIN)).toEqual({ valid: true, email: ALLOWLISTED });
  });
});
