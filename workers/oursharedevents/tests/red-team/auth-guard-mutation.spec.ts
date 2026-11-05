/**
 * OSE-1278 slice 2 (G1 authZ mutation) — the behavioural kill loop over
 * src/auth/admin.ts, so StrykerJS mutation of the admin auth guard reaches
 * break:95 with honesty (survivors are documented EQUIVALENT mutants, not gaps).
 *
 * Slice 1 (auth-jwks-verify.spec.ts) proved the JWKS crypto path runs off the
 * workerd pool. This spec adds the assertions that KILL the ~114 surviving/
 * uncovered mutants at the slice-1 baseline (56.65%): every reachable branch of
 * requireAdmin / extractAdminActor and the two module-private helpers they
 * delegate to (constantTimeEqual, extractBearer, getAdminKey,
 * extractCfAccessPayload) is exercised for its OBSERVABLE behaviour — a wrong
 * key of equal length is rejected, a padded secret is trimmed before compare, a
 * service-token JWT falls through, the 401 body/headers are the ones a client
 * parses, and the two audit log lines carry the fields an operator greps for.
 *
 * Node-clean: requireAdmin/extractAdminActor take hand-built Requests + env and
 * (for the JWKS path) a stubbed fetch — no cloudflare:test, no SELF.fetch, no D1.
 * The JWKS cache is reset per test via __resetJwksCacheForTests() (Stryker-
 * compatible; vi.resetModules breaks per-test coverage). Date is faked with
 * toFake:['Date'] only, so crypto.subtle's real async is untouched.
 */

import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  requireAdmin,
  extractAdminActor,
  verifyCfAccessJWT,
  __resetJwksCacheForTests,
  type AdminEnv,
} from '../../src/auth/admin';

const DOMAIN = 'test.cloudflareaccess.com';
const ADMIN = 'admin@oursharedevents.com';

// ─── JWT helpers ────────────────────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
const enc = (s: string) => new TextEncoder().encode(s);
const seg = (obj: unknown) => b64url(enc(JSON.stringify(obj)));
const nowSec = () => Math.floor(Date.now() / 1000);
const validClaims = (email: string | undefined = ADMIN) => ({
  email,
  iat: nowSec() - 10,
  exp: nowSec() + 3600,
});

let signingKey: CryptoKeyPair;
let attackerKey: CryptoKeyPair;
let realJwk: JsonWebKey;
let attackerJwk: JsonWebKey;

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
  attackerJwk = await crypto.subtle.exportKey('jwk', attackerKey.publicKey);
});

/** RS256-sign a CF-Access-shaped JWT with the given private key. */
async function signJwt(
  claims: Record<string, unknown>,
  priv: CryptoKey = signingKey.privateKey
): Promise<string> {
  const header = seg({ alg: 'RS256', typ: 'JWT', kid: 'test' });
  const payload = seg(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, enc(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

/** An UNSIGNED forged token (junk 3rd segment) — for the local / no-domain path
 *  where the signature is never checked. */
const forged = (claims: Record<string, unknown>) => `${seg({ alg: 'none' })}.${seg(claims)}.sig`;

function jwtReq(jwt: string, extra: Record<string, string> = {}): Request {
  return new Request('https://x/api/v2/admin/sponsors', {
    headers: { 'Cf-Access-Jwt-Assertion': jwt, ...extra },
  });
}
function hdrReq(headers: Record<string, string>): Request {
  return new Request('https://x/api/v2/admin/sponsors', { headers });
}

/** Reset the JWKS cache and stub fetch to serve `keys` (default: the real key). */
function armFetch(keys: JsonWebKey[] = [realJwk], status = 200) {
  __resetJwksCacheForTests();
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys }), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const envDomain = (): AdminEnv =>
  ({
    WORKER_ENV: 'production',
    CF_ACCESS_TEAM_DOMAIN: DOMAIN,
    ALLOWED_ADMIN_EMAILS: ADMIN,
  }) as unknown as AdminEnv;
const envLocal = (extra: Record<string, string> = {}): AdminEnv =>
  ({ ALLOWED_ADMIN_EMAILS: ADMIN, ...extra }) as unknown as AdminEnv; // no WORKER_ENV → local
const envDeployed = (extra: Record<string, string> = {}): AdminEnv =>
  ({ WORKER_ENV: 'production', ...extra }) as unknown as AdminEnv;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  __resetJwksCacheForTests();
});

// ─── requireAdmin: the 401 response contract ────────────────────────────────
// Kills the response-shape cluster (ok:false, code:'UNAUTH', Content-Type,
// WWW-Authenticate, X-Request-Id, the headers object) — a client parses these.
describe('requireAdmin — 401 response shape (unauthenticated)', () => {
  test('body is {ok:false, status:401, code:"UNAUTH", requestId} and status 401', async () => {
    const res = await requireAdmin(hdrReq({}), envDeployed(), 'rid-401');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: false, status: 401, code: 'UNAUTH', requestId: 'rid-401' });
  });

  test('carries the JSON + WWW-Authenticate + X-Request-Id headers', async () => {
    const res = await requireAdmin(hdrReq({}), envDeployed(), 'rid-hdr');
    expect(res!.headers.get('Content-Type')).toBe('application/json');
    expect(res!.headers.get('WWW-Authenticate')).toBe('Bearer realm="OurSharedEvents Admin"');
    expect(res!.headers.get('X-Request-Id')).toBe('rid-hdr');
  });
});

// ─── requireAdmin: DEV_OPEN_ADMIN bypass + its audit warning ─────────────────
describe('requireAdmin — DEV_OPEN_ADMIN warning line', () => {
  test('bypass logs DEV_OPEN_ADMIN_BYPASS with the null worker_env', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await requireAdmin(hdrReq({}), { DEV_OPEN_ADMIN: 'true' } as AdminEnv, 'dev-1');
    expect(res).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warn.mock.calls[0][0] as string);
    expect(logged.event).toBe('DEV_OPEN_ADMIN_BYPASS');
    expect(logged.warning).toContain('must never be enabled in a deployed environment');
    // worker_env: env.WORKER_ENV ?? null  →  the `&&` mutant would also yield null
    // when unset, so pin it to a value: a non-prod WORKER_ENV must be echoed, not
    // nulled.
    warn.mockClear();
    const res2 = await requireAdmin(
      hdrReq({}),
      { DEV_OPEN_ADMIN: 'true', WORKER_ENV: 'development' } as AdminEnv,
      'dev-2'
    );
    expect(res2).toBeNull();
    expect(JSON.parse(warn.mock.calls[0][0] as string).worker_env).toBe('development');
    warn.mockRestore();
  });
});

// ─── requireAdmin: fail-closed misconfig audit line (G4) ─────────────────────
describe('requireAdmin — ADMIN_AUTH_MISCONFIG error line (deployed, no team domain)', () => {
  test('logs level=error, event, and the echoed worker_env, then 401', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await requireAdmin(
      jwtReq(forged(validClaims())),
      envDeployed({ ALLOWED_ADMIN_EMAILS: ADMIN }),
      'mc-1'
    );
    expect(res!.status).toBe(401);
    const logged = JSON.parse(log.mock.calls[0][0] as string);
    expect(logged.level).toBe('error');
    expect(logged.event).toBe('ADMIN_AUTH_MISCONFIG');
    expect(logged.message).toContain('fail-closed');
    expect(logged.worker_env).toBe('production'); // `&&` mutant would null this
    log.mockRestore();
  });
});

// ─── requireAdmin Method 3 (Bearer ADMIN_KEY) — constantTimeEqual + helpers ──
describe('requireAdmin — Bearer ADMIN_KEY comparison (constant-time + parse + trim)', () => {
  const en = (extra: Record<string, string>) =>
    envDeployed({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ...extra });

  test('correct key authenticates (null)', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer right-key' }),
      en({ ADMIN_KEY: 'right-key' }),
      'k1'
    );
    expect(res).toBeNull();
  });

  test('WRONG key of EQUAL length is rejected (kills length-only / always-equal mutants)', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer wrong-key' }), // same length as 'right-key'
      en({ ADMIN_KEY: 'right-key' }),
      'k2'
    );
    expect(res!.status).toBe(401);
  });

  test('key of DIFFERENT length is rejected (kills the length-check-removed mutant)', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer right-keyEXTRA' }),
      en({ ADMIN_KEY: 'right-key' }),
      'k3'
    );
    expect(res!.status).toBe(401);
  });

  test('single-char wrong key of equal length is rejected (loop must XOR every byte)', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer secreX' }),
      en({ ADMIN_KEY: 'secret' }),
      'k4'
    );
    expect(res!.status).toBe(401);
  });

  test('ADMIN_KEY is trimmed before compare (padded env value still matches)', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer tok' }),
      en({ ADMIN_KEY: '   tok   ' }),
      'k5'
    );
    expect(res).toBeNull();
  });

  test('legacy ADMIN_TOKEN alias is honoured when ADMIN_KEY is unset', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer legacy' }),
      en({ ADMIN_TOKEN: 'legacy' }),
      'k6'
    );
    expect(res).toBeNull();
  });

  test('Authorization must START with Bearer (prefix junk is rejected — regex ^ anchor)', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'xBearer tok' }),
      en({ ADMIN_KEY: 'tok' }),
      'k7'
    );
    expect(res!.status).toBe(401);
  });

  test('extra whitespace after Bearer is consumed by \\s+ (multi-space still matches)', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer     tok' }), // 5 spaces
      en({ ADMIN_KEY: 'tok' }),
      'k8'
    );
    expect(res).toBeNull(); // \s -> \s+ mutant would leave leading spaces on the token → 401
  });

  test('case-insensitive scheme is accepted (bearer)', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'bearer tok' }),
      en({ ADMIN_KEY: 'tok' }),
      'k9'
    );
    expect(res).toBeNull();
  });
});

// ─── requireAdmin Method 2 (X-OCR-Internal) — trim + flag + missing header ───
describe('requireAdmin — X-OCR-Internal comparison', () => {
  const en = (extra: Record<string, string>) =>
    envDeployed({ ALLOW_OCR_INTERNAL: 'true', ...extra });

  test('correct secret authenticates', async () => {
    const res = await requireAdmin(
      hdrReq({ 'X-OCR-Internal': 'sec' }),
      en({ X_OCR_INTERNAL: 'sec' }),
      'o1'
    );
    expect(res).toBeNull();
  });

  test('secret is trimmed before compare (padded env value still matches)', async () => {
    const res = await requireAdmin(
      hdrReq({ 'X-OCR-Internal': 'sec' }),
      en({ X_OCR_INTERNAL: '  sec  ' }),
      'o2'
    );
    expect(res).toBeNull();
  });

  test('flag on + secret configured but NO header present → 401 (kills always-true guard)', async () => {
    const res = await requireAdmin(hdrReq({}), en({ X_OCR_INTERNAL: 'sec' }), 'o3');
    expect(res!.status).toBe(401);
  });

  test('wrong secret → 401', async () => {
    const res = await requireAdmin(
      hdrReq({ 'X-OCR-Internal': 'nope' }),
      en({ X_OCR_INTERNAL: 'sec' }),
      'o4'
    );
    expect(res!.status).toBe(401);
  });
});

// ─── requireAdmin: cfJwt guard (L225) ────────────────────────────────────────
describe('requireAdmin — the Cf-Access-Jwt-Assertion presence guard', () => {
  test('no JWT header + valid ADMIN_KEY + team domain set → authenticates (guard must not run the JWT path)', async () => {
    // If `if (cfJwt)` is forced true, verifyCfAccessJWT(null,domain) rejects and
    // returns 401 before Methods 2/3 — so a keyed request would wrongly 401.
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer k' }),
      envDeployed({
        CF_ACCESS_TEAM_DOMAIN: DOMAIN,
        ALLOW_ADMIN_KEY_FALLBACK: 'true',
        ADMIN_KEY: 'k',
      }),
      'g1'
    );
    expect(res).toBeNull();
  });
});

// ─── extractAdminActor — every branch (was entirely uncovered) ───────────────
describe('extractAdminActor', () => {
  test('CF Access human JWT → returns the email', () => {
    const actor = extractAdminActor(
      jwtReq(forged(validClaims('who@oursharedevents.com'))),
      {} as AdminEnv
    );
    expect(actor).toBe('who@oursharedevents.com');
  });

  test('service-token JWT (valid, no email) → not an email; falls through to key checks', () => {
    const actor = extractAdminActor(
      jwtReq(forged({ iat: nowSec() - 10, exp: nowSec() + 3600 })), // no email claim
      {} as AdminEnv
    );
    expect(actor).toBeNull();
  });

  test('expired JWT is not trusted for actor identity', () => {
    const actor = extractAdminActor(
      jwtReq(forged({ email: ADMIN, iat: nowSec() - 7200, exp: nowSec() - 3600 })),
      {} as AdminEnv
    );
    expect(actor).toBeNull();
  });

  test('X-OCR-Internal match → "key:ocr-internal" (only when flag === "true")', () => {
    const req = hdrReq({ 'X-OCR-Internal': 'sec' });
    expect(
      extractAdminActor(req, { ALLOW_OCR_INTERNAL: 'true', X_OCR_INTERNAL: 'sec' } as AdminEnv)
    ).toBe('key:ocr-internal');
    // flag off → the correct secret must NOT yield an actor
    expect(extractAdminActor(req, { X_OCR_INTERNAL: 'sec' } as AdminEnv)).toBeNull();
    // flag on, padded env secret is trimmed
    expect(
      extractAdminActor(req, { ALLOW_OCR_INTERNAL: 'true', X_OCR_INTERNAL: '  sec  ' } as AdminEnv)
    ).toBe('key:ocr-internal');
    // wrong secret → null
    expect(
      extractAdminActor(hdrReq({ 'X-OCR-Internal': 'x' }), {
        ALLOW_OCR_INTERNAL: 'true',
        X_OCR_INTERNAL: 'sec',
      } as AdminEnv)
    ).toBeNull();
  });

  test('Bearer ADMIN_KEY match → "key:admin" (only when fallback flag === "true")', () => {
    const req = hdrReq({ Authorization: 'Bearer k' });
    expect(
      extractAdminActor(req, { ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'k' } as AdminEnv)
    ).toBe('key:admin');
    expect(extractAdminActor(req, { ADMIN_KEY: 'k' } as AdminEnv)).toBeNull();
    expect(
      extractAdminActor(hdrReq({ Authorization: 'Bearer wrong' }), {
        ALLOW_ADMIN_KEY_FALLBACK: 'true',
        ADMIN_KEY: 'k',
      } as AdminEnv)
    ).toBeNull();
  });

  test('no credentials at all → null', () => {
    expect(extractAdminActor(hdrReq({}), {} as AdminEnv)).toBeNull();
  });
});

// ─── extractCfAccessPayload branches (via requireAdmin local / no-domain path) ─
// Local env (no WORKER_ENV, no team domain) trusts the unverified payload by
// design — the legitimate place to exercise the payload-decode branch logic.
describe('extractCfAccessPayload — decode + exp/iat/segment branches (local path)', () => {
  test('valid allowlisted human JWT → authenticates', async () => {
    const res = await requireAdmin(jwtReq(forged(validClaims())), envLocal(), 'p1');
    expect(res).toBeNull();
  });

  test('non-allowlisted human JWT → 403 (kills valid/email logical + allowlist-deny mutants)', async () => {
    const res = await requireAdmin(
      jwtReq(forged(validClaims('stranger@nowhere.test'))),
      envLocal(),
      'p2'
    );
    expect(res!.status).toBe(403);
  });

  test('4-segment JWT is rejected (parts.length !== 3 guard)', async () => {
    const four = `${forged(validClaims())}.extra`;
    const res = await requireAdmin(jwtReq(four), envLocal(), 'p3');
    expect(res!.status).toBe(401); // falls through to 401; mutant that drops the guard would auth
  });

  test('missing iat → not trusted (needs BOTH exp and iat)', async () => {
    const res = await requireAdmin(
      jwtReq(forged({ email: ADMIN, exp: nowSec() + 3600 })),
      envLocal(),
      'p4'
    );
    expect(res!.status).toBe(401);
  });

  test('missing exp → not trusted', async () => {
    const res = await requireAdmin(
      jwtReq(forged({ email: ADMIN, iat: nowSec() - 10 })),
      envLocal(),
      'p5'
    );
    expect(res!.status).toBe(401);
  });

  test('expired exp (<= now) → not trusted (equality boundary)', async () => {
    const res = await requireAdmin(
      jwtReq(forged({ email: ADMIN, iat: nowSec() - 7200, exp: nowSec() - 1 })),
      envLocal(),
      'p6'
    );
    expect(res!.status).toBe(401);
  });

  test('malformed base64 payload → caught → not trusted (catch branch)', async () => {
    const res = await requireAdmin(
      jwtReq(`${seg({ alg: 'none' })}.!!!not-base64!!!.sig`),
      envLocal(),
      'p7'
    );
    expect(res!.status).toBe(401);
  });
});

// ─── verifyCfAccessJWT — JWKS signature branches (domain set) ─────────────────
describe('verifyCfAccessJWT — signature + segment + some/every branches (domain path)', () => {
  test('valid signature + allowlisted email → authenticates', async () => {
    armFetch();
    const res = await requireAdmin(jwtReq(await signJwt(validClaims())), envDomain(), 'v1');
    expect(res).toBeNull();
  });

  test('wrong-key signature → 401', async () => {
    armFetch(); // JWKS has the real key only
    const res = await requireAdmin(
      jwtReq(await signJwt(validClaims(), attackerKey.privateKey)),
      envDomain(),
      'v2'
    );
    expect(res!.status).toBe(401);
  });

  test('multi-key JWKS: token signed by ONE listed key verifies (some, not every)', async () => {
    armFetch([realJwk, attackerJwk]); // two keys; sig matches only the first
    const res = await requireAdmin(jwtReq(await signJwt(validClaims())), envDomain(), 'v3');
    expect(res).toBeNull(); // `every` mutant would 401 here (attacker key fails)
  });

  test('multi-key JWKS: token signed by a NON-listed key → 401', async () => {
    const strangerKey = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    armFetch([realJwk, attackerJwk]);
    const res = await requireAdmin(
      jwtReq(await signJwt(validClaims(), strangerKey.privateKey)),
      envDomain(),
      'v4'
    );
    expect(res!.status).toBe(401);
  });

  test('4-segment JWT → 401 (parts.length !== 3 guard in the verify path)', async () => {
    armFetch();
    const res = await requireAdmin(
      jwtReq(`${await signJwt(validClaims())}.extra`),
      envDomain(),
      'v5'
    );
    expect(res!.status).toBe(401);
  });

  test('expired token with a valid signature → 401 (exp checked before trust)', async () => {
    armFetch();
    const jwt = await signJwt({ email: ADMIN, iat: nowSec() - 7200, exp: nowSec() - 1 });
    const res = await requireAdmin(jwtReq(jwt), envDomain(), 'v6');
    expect(res!.status).toBe(401);
  });

  test('fetch targets the team-domain certs URL', async () => {
    const fetchMock = armFetch();
    await requireAdmin(jwtReq(await signJwt(validClaims())), envDomain(), 'v7');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://${DOMAIN}/cdn-cgi/access/certs`);
  });

  test('JWKS endpoint non-OK BUT with a valid body → still 401 (res.ok is enforced)', async () => {
    // status 503, yet the body is a real JWKS: only the `if (!res.ok) throw` guard
    // stops it. The mutant that drops the guard would parse the keys and verify.
    __resetJwksCacheForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ keys: [realJwk] }), { status: 503 }))
    );
    const res = await requireAdmin(jwtReq(await signJwt(validClaims())), envDomain(), 'v8');
    expect(res!.status).toBe(401);
  });
});

// ─── verifyCfAccessJWT — DIRECT unit tests ──────────────────────────────────
// The exported verify function decides valid vs invalid independently of the
// downstream extractCfAccessPayload re-parse, so its own segment/exp branches
// are only observable by calling it directly.
describe('verifyCfAccessJWT — direct (segment + exp branches)', () => {
  test('valid signed token → { valid:true, email }', async () => {
    armFetch();
    expect(await verifyCfAccessJWT(await signJwt(validClaims()), DOMAIN)).toEqual({
      valid: true,
      email: ADMIN,
    });
  });

  test('4-segment token → { valid:false } (parts.length !== 3, verify path)', async () => {
    armFetch();
    const four = `${await signJwt(validClaims())}.extra`;
    expect(await verifyCfAccessJWT(four, DOMAIN)).toEqual({ valid: false, reason: 'malformed' });
  });

  test('missing exp → { valid:false } (kills the || → && and guard mutants)', async () => {
    armFetch();
    const noExp = await signJwt({ email: ADMIN, iat: nowSec() - 10 });
    expect(await verifyCfAccessJWT(noExp, DOMAIN)).toEqual({ valid: false, reason: 'expired' });
  });

  test('exp exactly == now is expired (<= boundary, deterministic under fake time)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    armFetch();
    const atNow = await signJwt({ email: ADMIN, iat: nowSec() - 10, exp: nowSec() }); // exp === floor(now)
    // `<=` → expired → invalid. The `<` mutant would treat exp==now as still valid.
    expect(await verifyCfAccessJWT(atNow, DOMAIN)).toEqual({ valid: false, reason: 'expired' });
  });

  test('wrong-key signature → { valid:false }', async () => {
    armFetch(); // real key only
    const forgedSig = await signJwt(validClaims(), attackerKey.privateKey);
    expect(await verifyCfAccessJWT(forgedSig, DOMAIN)).toEqual({
      valid: false,
      reason: 'signature',
    });
  });
});

// ─── requireAdmin: the L234 401 (JWT verification failed, domain set) ─────────
// A distinct 401 from the final one — assert its full shape so the body/header
// mutants on that branch die too.
describe('requireAdmin — verification-failed 401 response shape (domain set)', () => {
  test('invalid JWT under a set team domain → 401 with the UNAUTH contract', async () => {
    armFetch(); // real key; sign with attacker → verification fails
    const res = await requireAdmin(
      jwtReq(await signJwt(validClaims(), attackerKey.privateKey)),
      envDomain(),
      'vf-1'
    );
    expect(res!.status).toBe(401);
    expect(await res!.json()).toEqual({
      ok: false,
      status: 401,
      code: 'UNAUTH',
      requestId: 'vf-1',
    });
    expect(res!.headers.get('Content-Type')).toBe('application/json');
    expect(res!.headers.get('WWW-Authenticate')).toBe('Bearer realm="OurSharedEvents Admin"');
  });
});

// ─── constantTimeEqual: the prefix case (length guard removed → false positive)─
describe('requireAdmin — constant-time compare rejects a prefix token', () => {
  test('a token that is a strict PREFIX of the key is rejected (kills length-check removal)', async () => {
    // 'right-key' is the first 9 chars of the 10-char key; dropping `a.length !==
    // b.length` would loop only over the shorter token, match, and authenticate.
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer right-key' }),
      envDeployed({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'right-keyX' }),
      'pfx'
    );
    expect(res!.status).toBe(401);
  });
});

// ─── getAdminKey: legacy-alias trim + both-absent optional-chaining ───────────
describe('requireAdmin — getAdminKey (legacy alias, trim, absence)', () => {
  test('padded ADMIN_TOKEN alias is trimmed before compare', async () => {
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer legacy' }),
      envDeployed({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_TOKEN: '  legacy  ' }),
      'la1'
    );
    expect(res).toBeNull();
  });

  test('fallback flag on + a Bearer token but NEITHER key configured → 401 (no throw)', async () => {
    // Exercises env.ADMIN_TOKEN?.trim() with ADMIN_TOKEN undefined: the optional
    // chain must short-circuit to null. Dropping `?.` would throw on undefined.
    const res = await requireAdmin(
      hdrReq({ Authorization: 'Bearer whatever' }),
      envDeployed({ ALLOW_ADMIN_KEY_FALLBACK: 'true' }),
      'la2'
    );
    expect(res!.status).toBe(401);
  });
});

// ─── requireAdmin OCR: no configured secret (optional-chaining) ───────────────
describe('requireAdmin — X-OCR-Internal with the flag on but no secret configured', () => {
  test('header present, X_OCR_INTERNAL unset → 401 (optional chain short-circuits, no throw)', async () => {
    const res = await requireAdmin(
      hdrReq({ 'X-OCR-Internal': 'anything' }),
      envDeployed({ ALLOW_OCR_INTERNAL: 'true' }),
      'os1'
    );
    expect(res!.status).toBe(401);
  });
});

// ─── requireAdmin: local trusted-JWT service token falls through (L265) ───────
describe('requireAdmin — trusted service-token JWT falls through to Methods 2/3 (local)', () => {
  test('local env, valid JWT with NO email + valid ADMIN_KEY → authenticates via Method 3', async () => {
    // extractCfAccessPayload returns {valid:true, email:undefined}; `valid && email`
    // is false so it must fall through. The `valid || email` mutant would enter the
    // allowlist with an undefined email and 403 instead.
    const res = await requireAdmin(
      jwtReq(forged({ iat: nowSec() - 10, exp: nowSec() + 3600 }), { Authorization: 'Bearer k' }),
      envLocal({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'k' }),
      'svc-local'
    );
    expect(res).toBeNull();
  });
});

// ─── extractAdminActor: OCR asymmetric / no-secret (L180, L182) ───────────────
describe('extractAdminActor — X-OCR-Internal edge cases', () => {
  test('flag on, header present, NO secret configured → null (no throw)', () => {
    expect(
      extractAdminActor(hdrReq({ 'X-OCR-Internal': 'anything' }), {
        ALLOW_OCR_INTERNAL: 'true',
      } as AdminEnv)
    ).toBeNull();
  });

  test('flag on, secret configured, NO header → null (kills the || short-circuit)', () => {
    expect(
      extractAdminActor(hdrReq({}), {
        ALLOW_OCR_INTERNAL: 'true',
        X_OCR_INTERNAL: 'sec',
      } as AdminEnv)
    ).toBeNull();
  });
});

// ─── extractCfAccessPayload: exp exactly now (via local requireAdmin) ─────────
describe('requireAdmin — exp == now is expired on the local trust path', () => {
  test('local env, JWT exp === now → 401 (<= boundary)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    const res = await requireAdmin(
      jwtReq(forged({ email: ADMIN, iat: nowSec() - 10, exp: nowSec() })),
      envLocal(),
      'exp-now'
    );
    expect(res!.status).toBe(401);
  });
});

// ─── JWKS cache: TTL window + age (L46 TTL value, L63 cache-age guard) ────────
describe('verifyCfAccessJWT — JWKS cache TTL', () => {
  test('within the TTL the key is reused (no refetch after 5 minutes)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    const fetchMock = armFetch();
    await requireAdmin(jwtReq(await signJwt(validClaims())), envDomain(), 'c1');
    vi.setSystemTime(new Date('2026-09-09T00:05:00Z')); // +5 min, well under 1h TTL
    await requireAdmin(jwtReq(await signJwt(validClaims())), envDomain(), 'c2');
    // A shrunk TTL (60/60*1000 = 1s, or 60*60/1000 = 3.6ms) would have expired the
    // cache and refetched. The real 1h TTL keeps it at one fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('past the TTL the key is refetched (rotated key then validates)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    // First call caches the REAL key.
    const first = armFetch([realJwk]);
    await requireAdmin(jwtReq(await signJwt(validClaims())), envDomain(), 'c3');
    expect(first).toHaveBeenCalledTimes(1);
    // +2h (past the 1h TTL): rotate JWKS to the attacker key and sign with it.
    vi.setSystemTime(new Date('2026-09-09T02:00:00Z'));
    const second = vi.fn(
      async () => new Response(JSON.stringify({ keys: [attackerJwk] }), { status: 200 })
    );
    vi.stubGlobal('fetch', second);
    const rotated = await signJwt(
      { email: ADMIN, iat: nowSec() - 10, exp: nowSec() + 3600 },
      attackerKey.privateKey
    );
    const res = await requireAdmin(jwtReq(rotated), envDomain(), 'c4');
    // Original refetches → attacker key now the live key → validates → null.
    // The `cache always fresh` mutant keeps the stale real key → sig fails → 401.
    expect(second).toHaveBeenCalledTimes(1);
    expect(res).toBeNull();
  });
});
