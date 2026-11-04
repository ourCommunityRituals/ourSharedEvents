/**
 * OSE-1800 — a staging CI identity that is a BRAND admin, not a platform admin.
 *
 * On staging every CI caller used to be a `key:` actor, and ADMIN_SCOPE_ALL makes
 * a key actor a platform admin, so the staging chain could not exercise a brand
 * admin's capped (who × plan) view. A Cloudflare Access SERVICE TOKEN's JWT has a
 * `common_name` and no `email`; this adds one actor class for it:
 *
 *   `svc:<common_name>` — accepted ONLY when ALL of these hold:
 *     1. the JWT signature verifies against the team JWKS (CF_ACCESS_TEAM_DOMAIN set);
 *     2. the Access audience is pinned (CF_ACCESS_AUD set) and the token carries it;
 *     3. WORKER_ENV === 'staging';
 *     4. the common_name is listed in CI_SERVICE_ACTORS.
 *   Its scope is exactly one brand (CI_SERVICE_ACTOR_BRAND), never `all`, never
 *   the platform brand. Anything else falls through exactly as before.
 *
 * Node project: a real RSA key signs real tokens; only the JWKS fetch is stubbed.
 *
 * @born-red OSE-1800 | method: drop-each-condition | verified: removing any one of
 *   the four checks in serviceActorName (auth/admin.ts) turns its matching
 *   "refused when …" test red; letting CI_SERVICE_ACTOR_BRAND be the platform
 *   brand turns "never the platform brand" red.
 */
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  requireAdmin,
  extractAdminActor,
  __resetJwksCacheForTests,
  type AdminEnv,
} from '../../src/auth/admin';
import {
  resolveAdminBrandScopeAsync,
  PLATFORM_BRAND_ID,
  type AdminBrandScopeEnv,
} from '../../src/lib/admin-brand-scope';
import { isPlatformActor, requireKeyActor } from '../../src/lib/admin-object-scope';
import { adminWriteRefusal } from '../../src/lib/admin-write-guard';

const DOMAIN = 'test.cloudflareaccess.com';
const AUD = 'aud-staging-admin-app';
const CN = 'ci-brand-admin.access';
const BRAND = 'ci-brand';

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
  jwks = { keys: [await crypto.subtle.exportKey('jwk', signingKey.publicKey)] };
});

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
/** A service token's Access JWT: common_name, no email. */
const svcClaims = (over: Record<string, unknown> = {}) => ({
  common_name: CN,
  aud: [AUD],
  iss: `https://${DOMAIN}`,
  iat: nowSec() - 10,
  exp: nowSec() + 3600,
  ...over,
});

type Env = AdminEnv & AdminBrandScopeEnv & Record<string, unknown>;
const stagingEnv = (over: Record<string, unknown> = {}): Env =>
  ({
    WORKER_ENV: 'staging',
    CF_ACCESS_TEAM_DOMAIN: DOMAIN,
    CF_ACCESS_AUD: AUD,
    ALLOWED_ADMIN_EMAILS: 'owner@example.com',
    CI_SERVICE_ACTORS: CN,
    CI_SERVICE_ACTOR_BRAND: BRAND,
    ADMIN_SCOPE_ALL: 'true', // staging runs key actors unscoped; svc must not inherit it
    ...over,
  }) as unknown as Env;

const req = (jwt: string, init: RequestInit = {}, path = '/api/v2/admin/events') =>
  new Request(`https://stg.example${path}`, {
    ...init,
    headers: { 'Cf-Access-Jwt-Assertion': jwt, ...(init.headers ?? {}) },
  });

function armFetch() {
  __resetJwksCacheForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(jwks), { status: 200 }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetJwksCacheForTests();
});

describe('OSE-1800 | the CI service actor is accepted on staging, as a brand admin', () => {
  test('a signed, listed service token on staging is authenticated as svc:<common_name>', async () => {
    armFetch();
    const r = req(await signJwt(svcClaims()));
    expect(await requireAdmin(r, stagingEnv(), 'rid')).toBeNull();
    expect(extractAdminActor(r, stagingEnv())).toBe(`svc:${CN}`);
  });

  test('its scope is exactly the configured brand, never all', async () => {
    const scope = await resolveAdminBrandScopeAsync(`svc:${CN}`, stagingEnv());
    expect(scope).toEqual({ mode: 'scoped', brandIds: [BRAND] });
  });

  test('it is not a platform admin, so the who × plan caps apply to it', async () => {
    armFetch();
    const r = req(await signJwt(svcClaims()));
    expect(await isPlatformActor(r, stagingEnv())).toBe(false);
  });

  test('a key-only route refuses it', async () => {
    const r = req(
      await signJwt(svcClaims()),
      { method: 'PUT' },
      '/api/v2/admin/flags/forms.survey'
    );
    const res = requireKeyActor(r, stagingEnv());
    expect(res?.status).toBe(403);
  });

  test('the write guard treats it as automation (no Sec-Fetch-Site needed), JSON still required', async () => {
    const jwt = await signJwt(svcClaims());
    const url = new URL('https://stg.example/api/v2/admin/events/e1/flags/forms.survey');
    const json = req(
      jwt,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' } },
      url.pathname
    );
    expect(adminWriteRefusal(json, stagingEnv(), url)).toBeNull();
    const form = req(
      jwt,
      { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      url.pathname
    );
    expect(adminWriteRefusal(form, stagingEnv(), url)?.kind).toBe('content-type');
  });
});

describe('OSE-1800 | refused unless every condition holds', () => {
  const refusedBy = async (claims: Record<string, unknown>, env: Env, priv?: CryptoKey) => {
    armFetch();
    const r = req(await signJwt(claims, priv));
    const res = await requireAdmin(r, env, 'rid');
    return { status: res?.status ?? 200, actor: extractAdminActor(r, env) };
  };

  test('refused when the common_name is not listed', async () => {
    const out = await refusedBy(svcClaims({ common_name: 'someone-else.access' }), stagingEnv());
    expect(out.status).toBe(401);
    expect(out.actor).toBeNull();
  });

  test('refused on production (WORKER_ENV)', async () => {
    const out = await refusedBy(svcClaims(), stagingEnv({ WORKER_ENV: 'production' }));
    expect(out.status).toBe(401);
    expect(out.actor).toBeNull();
  });

  test('refused when the Access audience is not pinned', async () => {
    const out = await refusedBy(svcClaims(), stagingEnv({ CF_ACCESS_AUD: '' }));
    expect(out.status).toBe(401);
    expect(out.actor).toBeNull();
  });

  test('refused when the token was issued for another Access app', async () => {
    const out = await refusedBy(svcClaims({ aud: ['some-other-app'] }), stagingEnv());
    expect(out.status).toBe(401);
    expect(out.actor).toBeNull();
  });

  test('refused when no team domain is set (the signature cannot be checked)', async () => {
    const out = await refusedBy(svcClaims(), stagingEnv({ CF_ACCESS_TEAM_DOMAIN: '' }));
    expect(out.status).toBe(401);
    expect(out.actor).toBeNull();
  });

  test('refused when the signature is not the team key', async () => {
    const out = await refusedBy(svcClaims(), stagingEnv(), attackerKey.privateKey);
    expect(out.status).toBe(401);
  });

  test('refused when no audience is pinned, even for a token whose aud is empty', async () => {
    const env = stagingEnv({ CF_ACCESS_AUD: '' });
    const out = await refusedBy(svcClaims({ aud: [''] }), env);
    expect(out.status).toBe(401);
    expect(out.actor).toBeNull();
  });

  test('no team domain: an actor is never derived, even from a token issued as "https://"', async () => {
    const env = stagingEnv({ CF_ACCESS_TEAM_DOMAIN: '' });
    const r = req(await signJwt(svcClaims({ iss: 'https://' })));
    expect(extractAdminActor(r, env)).toBeNull();
  });

  test('refused when the token comes from another Access team', async () => {
    const out = await refusedBy(
      svcClaims({ iss: 'https://other-team.cloudflareaccess.com' }),
      stagingEnv()
    );
    expect(out.status).toBe(401);
    expect(out.actor).toBeNull();
  });

  test('refused when the listed setting is absent', async () => {
    const out = await refusedBy(svcClaims(), stagingEnv({ CI_SERVICE_ACTORS: undefined }));
    expect(out.status).toBe(401);
    expect(out.actor).toBeNull();
  });
});

describe('OSE-1800 | its brand can never be the platform or every brand', () => {
  test('never the platform brand', async () => {
    const scope = await resolveAdminBrandScopeAsync(
      `svc:${CN}`,
      stagingEnv({ CI_SERVICE_ACTOR_BRAND: PLATFORM_BRAND_ID })
    );
    expect(scope).toEqual({ mode: 'deny' });
  });

  test('no configured brand → no brand at all', async () => {
    const scope = await resolveAdminBrandScopeAsync(
      `svc:${CN}`,
      stagingEnv({ CI_SERVICE_ACTOR_BRAND: undefined })
    );
    expect(scope).toEqual({ mode: 'deny' });
  });

  test('a list of brands is not one brand → denied', async () => {
    const scope = await resolveAdminBrandScopeAsync(
      `svc:${CN}`,
      stagingEnv({ CI_SERVICE_ACTOR_BRAND: 'ci-brand,other-brand' })
    );
    expect(scope).toEqual({ mode: 'deny' });
  });

  test('outside staging the svc scope is denied even if a caller hands one in', async () => {
    const scope = await resolveAdminBrandScopeAsync(
      `svc:${CN}`,
      stagingEnv({ WORKER_ENV: 'production' })
    );
    expect(scope).toEqual({ mode: 'deny' });
  });
});

describe('OSE-1800 | email and key actors are unchanged', () => {
  test('an email token is still an email actor', async () => {
    armFetch();
    const r = req(
      await signJwt({ ...svcClaims(), common_name: undefined, email: 'owner@example.com' })
    );
    expect(await requireAdmin(r, stagingEnv(), 'rid')).toBeNull();
    expect(extractAdminActor(r, stagingEnv())).toBe('owner@example.com');
  });
});
