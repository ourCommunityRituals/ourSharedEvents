/**
 * OSE-1801: the admin actor, unit level (node project, so Stryker runs it).
 *
 * The workers-pool race spec (admin-actor-expiry-race.spec.ts) proves the race
 * through the real router. This file pins each piece of auth/admin.ts on its own:
 * the per-request memo, handing the actor to a derived request, requireAdmin's
 * own read, the plain-email rule, the not-yet-valid rule, the trust rule for a
 * deployed worker without the team domain, and the local-dev bypass allowlist.
 *
 * @born-red TL-084 | method: deliberate-fixture-break | date: 2026-11-04 | verified:
 *   each describe below went red with its own line in auth/admin.ts reverted
 *   (memo get/set, inheritAdminActor, the requireAdmin read, PLAIN_EMAIL,
 *   notYetValid, jwtIdentityTrustable, DEV_OPEN_WORKER_ENVS).
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import {
  extractAdminActor,
  inheritAdminActor,
  isDevOpenAdmin,
  isPlainAdminEmail,
  logJwtRefused,
  logNullAdminActorDenied,
  requireAdmin,
  type AdminEnv,
} from '../src/auth/admin';

const seg = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const nowSec = () => Math.floor(Date.now() / 1000);
const token = (claims: Record<string, unknown>) => `${seg({ alg: 'none' })}.${seg(claims)}.sig`;
const human = (email: string, over: Record<string, unknown> = {}) =>
  token({ email, iat: nowSec() - 10, exp: nowSec() + 30, ...over });
const req = (headers: Record<string, string>) => new Request('https://ose.test/x', { headers });

/** Local dev: no WORKER_ENV, no team domain, so the JWT is decoded (not verified). */
const local = (over: Partial<AdminEnv> = {}): AdminEnv =>
  ({ ALLOWED_ADMIN_EMAILS: 'owner@example.com', ...over }) as AdminEnv;

function moveClock(ms: number): void {
  const t0 = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => t0 + ms);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OSE-1801 | one actor per request', () => {
  test('the same Request keeps its actor after the token has expired', () => {
    const r = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
    const env = local();
    expect(extractAdminActor(r, env)).toBe('owner@example.com');
    moveClock(60_000);
    expect(extractAdminActor(r, env)).toBe('owner@example.com');
  });

  test('a fresh Request with the same token reads as no actor once it has expired', () => {
    const jwt = human('owner@example.com');
    const env = local();
    expect(extractAdminActor(req({ 'Cf-Access-Jwt-Assertion': jwt }), env)).toBe(
      'owner@example.com'
    );
    moveClock(60_000);
    expect(extractAdminActor(req({ 'Cf-Access-Jwt-Assertion': jwt }), env)).toBeNull();
  });

  test('a null first answer is kept too (no later read can turn it into an actor)', () => {
    // The request carries a key the env does not know yet; the env then learns it.
    // Re-resolving would now answer key:admin, so only a kept null stays null.
    const r = req({ Authorization: 'Bearer k' });
    const env = local({ ALLOW_ADMIN_KEY_FALLBACK: 'true' }) as AdminEnv & { ADMIN_KEY?: string };
    expect(extractAdminActor(r, env)).toBeNull();
    env.ADMIN_KEY = 'k';
    expect(extractAdminActor(r, env)).toBeNull();
    expect(extractAdminActor(req({ Authorization: 'Bearer k' }), env)).toBe('key:admin');
  });

  test('a second env object is resolved on its own', () => {
    const r = req({ Authorization: 'Bearer k' });
    expect(extractAdminActor(r, local())).toBeNull();
    expect(extractAdminActor(r, local({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'k' }))).toBe(
      'key:admin'
    );
  });
});

describe('OSE-1801 | a derived request inherits the actor', () => {
  test('inheritAdminActor hands the resolved actor to the new Request, after expiry too', () => {
    const outer = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
    const env = local();
    expect(extractAdminActor(outer, env)).toBe('owner@example.com');
    moveClock(60_000);
    const inner = new Request(outer.url, { method: 'POST', headers: new Headers(outer.headers) });
    inheritAdminActor(outer, inner, env);
    expect(extractAdminActor(inner, env)).toBe('owner@example.com');
  });

  test('it keeps what the new Request already resolved for another env', () => {
    const outer = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
    const inner = req({ 'Cf-Access-Jwt-Assertion': human('other@example.com') });
    const otherEnv = local({ ALLOWED_ADMIN_EMAILS: 'other@example.com' });
    const env = local();
    expect(extractAdminActor(inner, otherEnv)).toBe('other@example.com');
    expect(extractAdminActor(outer, env)).toBe('owner@example.com');
    moveClock(60_000); // both tokens have expired: only a kept answer survives
    inheritAdminActor(outer, inner, env);
    expect(extractAdminActor(inner, env)).toBe('owner@example.com');
    expect(extractAdminActor(inner, otherEnv)).toBe('other@example.com');
  });

  test('it never widens: a caller with no actor hands on no actor', () => {
    const env = local({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'k' });
    const outer = req({});
    const inner = req({ Authorization: 'Bearer k' });
    inheritAdminActor(outer, inner, env);
    expect(extractAdminActor(inner, env)).toBeNull();
  });
});

describe('OSE-1801 | requireAdmin reads the actor when it is called directly', () => {
  test('after requireAdmin allows a token, the actor survives the token expiring', async () => {
    const r = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
    const env = local();
    expect(await requireAdmin(r, env, 'rid')).toBeNull();
    moveClock(60_000);
    expect(extractAdminActor(r, env)).toBe('owner@example.com');
  });
});

describe('OSE-1801 | an Access email must be a plain address', () => {
  test.each([
    ['owner@example.com', true],
    ["o'brien+events@mail.example.com", true],
    ['admin@localhost', true],
    ['key:ops@example.com', false],
    ['svc:ci@example.com', false],
    ['owner @example.com', false],
    ['"key:ops"@example.com', false],
    ['owner@example.com\n', false],
    ['', false],
    [42, false],
  ])('isPlainAdminEmail(%j) is %s', (email, ok) => {
    expect(isPlainAdminEmail(email)).toBe(ok);
  });

  test('a token whose email reads like a key actor is no actor, and requireAdmin refuses it', async () => {
    const r = req({ 'Cf-Access-Jwt-Assertion': human('key:ops@example.com') });
    const env = local({ ALLOWED_ADMIN_DOMAINS: 'example.com' });
    expect(extractAdminActor(r, env)).toBeNull();
    expect((await requireAdmin(r, env, 'rid'))?.status).toBe(401);
  });

  test('an over-long email is refused', () => {
    const r = req({ 'Cf-Access-Jwt-Assertion': human(`${'a'.repeat(250)}@example.com`) });
    expect(extractAdminActor(r, local())).toBeNull();
  });
});

describe('OSE-1801 | a token that is not valid yet is no actor', () => {
  test('nbf beyond the skew', () => {
    const r = req({
      'Cf-Access-Jwt-Assertion': human('owner@example.com', { nbf: nowSec() + 120 }),
    });
    expect(extractAdminActor(r, local())).toBeNull();
  });
  test('iat beyond the skew', () => {
    const r = req({
      'Cf-Access-Jwt-Assertion': human('owner@example.com', { iat: nowSec() + 120 }),
    });
    expect(extractAdminActor(r, local())).toBeNull();
  });
  test('exactly at the 60 s skew it still counts (the bound is strict)', () => {
    const t = nowSec();
    vi.spyOn(Date, 'now').mockImplementation(() => t * 1000);
    const r = req({
      'Cf-Access-Jwt-Assertion': human('owner@example.com', { iat: t + 60, nbf: t + 60 }),
    });
    expect(extractAdminActor(r, local())).toBe('owner@example.com');
  });

  test('within the 60 s skew it still counts', () => {
    const r = req({
      'Cf-Access-Jwt-Assertion': human('owner@example.com', {
        iat: nowSec() + 30,
        nbf: nowSec() + 30,
      }),
    });
    expect(extractAdminActor(r, local())).toBe('owner@example.com');
  });
});

describe('OSE-1801 | a deployed worker without the team domain names the key, not the token', () => {
  // @born-red TL-086 | method: deliberate-fixture-break | date: 2026-11-04
  test.each(['staging', 'production'])(
    'on %s with no CF_ACCESS_TEAM_DOMAIN, a forged email plus a valid key is the key actor',
    (workerEnv) => {
      const r = req({
        'Cf-Access-Jwt-Assertion': human('owner@brand-b.test'),
        Authorization: 'Bearer k',
      });
      const env = local({
        WORKER_ENV: workerEnv,
        ALLOW_ADMIN_KEY_FALLBACK: 'true',
        ADMIN_KEY: 'k',
      });
      expect(extractAdminActor(r, env)).toBe('key:admin');
    }
  );

  test('locally (no WORKER_ENV) the decoded email still names the actor', () => {
    const r = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
    expect(extractAdminActor(r, local())).toBe('owner@example.com');
  });

  test('with the team domain set, the email names the actor (the router verified it)', () => {
    const r = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
    expect(
      extractAdminActor(r, local({ WORKER_ENV: 'staging', CF_ACCESS_TEAM_DOMAIN: 't.example' }))
    ).toBe('owner@example.com');
  });
});

describe('OSE-1801 | the local-dev bypass opens only on local names', () => {
  // @born-red TL-088 | method: deliberate-fixture-break | date: 2026-11-04
  test.each([
    [undefined, true],
    ['development', true],
    ['test', true],
    ['staging', false],
    ['production', false],
    ['Production', false],
    ['prod', false],
    ['preview', false],
    ['staging ', false],
    ['', false],
  ])('WORKER_ENV=%j with DEV_OPEN_ADMIN=true → %s', (workerEnv, open) => {
    expect(isDevOpenAdmin(local({ WORKER_ENV: workerEnv, DEV_OPEN_ADMIN: 'true' }))).toBe(open);
  });

  test.each([undefined, 'false', 'TRUE', '1'])('DEV_OPEN_ADMIN=%j never opens', (flag) => {
    expect(isDevOpenAdmin(local({ DEV_OPEN_ADMIN: flag }))).toBe(false);
  });
});

describe('OSE-1801 | a refused null actor leaves one structured line', () => {
  test('logNullAdminActorDenied names the site and the environment', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logNullAdminActorDenied('event-create', local({ WORKER_ENV: 'staging' }), 'rid-1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toEqual({
      level: 'warn',
      event: 'ADMIN_NULL_ACTOR_DENIED',
      site: 'event-create',
      worker_env: 'staging',
      request_id: 'rid-1',
    });
  });

  test('logJwtRefused names the reason and where, and nothing from the token', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logJwtRefused('audience', 'preflight', local({ WORKER_ENV: 'production' }), 'rid-2');
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toEqual({
      level: 'warn',
      event: 'ADMIN_JWT_REFUSED',
      reason: 'audience',
      where: 'preflight',
      worker_env: 'production',
      request_id: 'rid-2',
    });
  });
});

describe('CCR 2026-11-04 | only a local WORKER_ENV trusts an unverified Access JWT', () => {
  // @born-red TL-086 | method: deliberate-fixture-break | date: 2026-11-04
  test.each(['preview', 'Production', 'staging ', 'prod', '', 'staging', 'production'])(
    'WORKER_ENV=%j, no team domain: a forged email is no actor, and requireAdmin refuses it',
    async (workerEnv) => {
      const r = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
      const env = local({ WORKER_ENV: workerEnv });
      expect(extractAdminActor(r, env)).toBeNull();
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect((await requireAdmin(r, env, 'rid'))?.status).toBe(401);
      // requireAdmin itself refuses to trust the token here (fail closed), and says so.
      expect(
        log.mock.calls.some((c) => String(c[0]).includes('"event":"ADMIN_AUTH_MISCONFIG"'))
      ).toBe(true);
      // ...and the token is not read at all: the 401 is the key methods finding no
      // key, not the pinned-actor check catching a trusted forgery (that second
      // check must not be what holds this line).
      expect(warn.mock.calls.some((c) => String(c[0]).includes('ADMIN_JWT_REFUSED'))).toBe(false);
    }
  );

  test.each([undefined, 'development', 'test'])(
    'WORKER_ENV=%j (local): the decoded email still names the actor',
    (workerEnv) => {
      const r = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
      expect(extractAdminActor(r, local({ WORKER_ENV: workerEnv }))).toBe('owner@example.com');
    }
  );
});

describe('CCR 2026-11-04 | requireAdmin allows only the actor the request was pinned to', () => {
  // @born-red TL-090 | method: deliberate-fixture-break | date: 2026-11-04
  test('a token not valid yet at entry pins no actor; valid later, requireAdmin still refuses it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = req({
      'Cf-Access-Jwt-Assertion': human('owner@example.com', {
        iat: nowSec() + 120,
        exp: nowSec() + 3600,
      }),
    });
    const env = local();
    expect(extractAdminActor(r, env)).toBeNull(); // route() entry: not valid yet
    moveClock(120_000); // the token becomes valid during the request
    const res = await requireAdmin(r, env, 'rid');
    expect(res?.status).toBe(401);
    expect(await res!.json()).toEqual({ ok: false, status: 401, code: 'UNAUTH', requestId: 'rid' });
    expect(res!.headers.get('Content-Type')).toBe('application/json');
    expect(res!.headers.get('WWW-Authenticate')).toBe('Bearer realm="OurSharedEvents Admin"');
    expect(res!.headers.get('X-Request-Id')).toBe('rid');
    expect(warn.mock.calls.map((c) => JSON.parse(String(c[0])))).toContainEqual(
      expect.objectContaining({
        reason: 'actor_mismatch',
        where: 'requireAdmin',
        request_id: 'rid',
      })
    );
  });

  test('control: the same token valid at entry is allowed', async () => {
    const r = req({ 'Cf-Access-Jwt-Assertion': human('owner@example.com') });
    expect(await requireAdmin(r, local(), 'rid')).toBeNull();
  });
});

describe('CCR 2026-11-04 | token claim edges', () => {
  test.each([
    ['nbf', 'far future'],
    ['iat', '9999999999'],
    ['nbf', null],
  ])('a non-numeric %s (%j) is no identity', (claim, value) => {
    const r = req({
      'Cf-Access-Jwt-Assertion': human('owner@example.com', { [claim]: value }),
    });
    expect(extractAdminActor(r, local())).toBeNull();
  });

  test.each(['', null])(
    'an email claim of %j is no email: the request falls to the key methods',
    async (email) => {
      const r = req({
        'Cf-Access-Jwt-Assertion': token({ email, iat: nowSec() - 10, exp: nowSec() + 30 }),
        Authorization: 'Bearer k',
      });
      const env = local({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'k' });
      expect(extractAdminActor(r, env)).toBe('key:admin');
      expect(await requireAdmin(r, env, 'rid')).toBeNull();
    }
  );

  test('an array holding an address is not an address', () => {
    expect(isPlainAdminEmail(['owner@example.com'])).toBe(false);
  });

  test('254 characters is the longest address accepted', () => {
    const at254 = 'a'.repeat(254 - '@example.com'.length) + '@example.com';
    expect(at254.length).toBe(254);
    expect(isPlainAdminEmail(at254)).toBe(true);
    expect(isPlainAdminEmail('a' + at254)).toBe(false);
  });
});
