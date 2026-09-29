/**
 * OSE-1080 — object-level admin brand scoping (INVARIANT #9 tenant_isolation).
 *
 * SIBLING OF admin-events-scope.invariant.spec.ts, which armed the wall on the
 * admin events LIST. This one arms the other half: the paths that address ONE
 * object BY ID. Before OSE-1080 those paths took the id straight to SQL with no
 * brand predicate —
 *
 *   PUT  /api/v2/admin/events/:id            → `UPDATE events … WHERE id = ?`
 *   GET  /api/v2/admin/events/:id/stats      → `… WHERE event_id = ?`
 *   PUT  /api/v2/admin/events/:id/flags/:key, /verify-qr, /backup, /uploads,
 *        /forms/*, /shared-report/mint-link, /admin/poster-deployments/:id …
 *
 * — so a brand-A operator who knew (or enumerated) a brand-B id could READ and
 * MUTATE another tenant's event. These tests exercise the REAL request path
 * (`route()`), not a handler in isolation, because the guard's whole contract is
 * ordering: it must sit after auth-identity extraction and before dispatch.
 *
 * The four pinned behaviours:
 *   1. scoped operator: reaches their own object, 404s on another brand's
 *      (404 — not 403 — so an id's existence is never confirmed);
 *   2. a cross-tenant MUTATE attempt leaves the target row byte-identical;
 *   3. deny-mode (authenticated but unmapped) reaches nothing;
 *   4. 'all' mode (key actor + ADMIN_SCOPE_ALL, i.e. CI/automation) is unchanged,
 *      and an ANONYMOUS caller still gets 401 from requireAdmin — the scope guard
 *      must never answer before auth does.
 *
 * @born-red invariant#9 | method: cross-tenant-per-object-read-mutate | armed: 2026-08-28
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { matchAdminObjectTarget } from '../src/lib/admin-object-scope';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const routerEnv = env as unknown as RouterEnv;

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seedEvent(id: string, brandId: string, title: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status)
     VALUES (?, ?, ?, ?, 'active')`
  )
    .bind(id, brandId, title, `slug-${id}`)
    .run();
}

async function seedDeployment(id: string, eventId: string): Promise<void> {
  await env.DB.prepare('INSERT INTO poster_deployments (id, event_id, qr_token) VALUES (?, ?, ?)')
    .bind(id, eventId, `qrt_${id}`)
    .run();
}

async function titleOf(eventId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT title FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ title: string }>();
  return row?.title ?? null;
}

/** base64url-encode a JSON object (no padding), for a decode-only fake JWT. */
function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A CF Access JWT for `email`. CF_ACCESS_TEAM_DOMAIN is unset in the test env, so
 * the signature pre-flight is skipped and extractAdminActor's decode is enough to
 * exercise identity-derived scope — the same technique as the list-scope spec.
 * The emails below are all @example.com because ALLOWED_ADMIN_DOMAINS admits that
 * domain: they must clear requireAdmin's allowlist so the response under test is
 * the SCOPE decision, never an allowlist 403.
 */
function headersAsEmail(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
  };
}

/** CI/automation identity → `key:admin`, which ADMIN_SCOPE_ALL='true' elevates to mode 'all'. */
function headersAsKeyActor(): Record<string, string> {
  return { Authorization: 'Bearer test-admin-key-e2e-2026' };
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Response> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const ctx = createExecutionContext();
  const res = await route(new Request(`https://ose.test${path}`, init), routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const SCOPED = 'a@example.com'; // mapped to brand-A
const UNMAPPED = 'outsider@example.com'; // allowlisted domain, NO membership → deny

beforeAll(async () => {
  await applyMigrations();
  await seedEvent('evt-obj-A1', 'brand-obj-A', 'Brand A Object Event');
  await seedEvent('evt-obj-B1', 'brand-obj-B', 'Brand B Object Event');
  await seedDeployment('pd-obj-A1', 'evt-obj-A1');
  await seedDeployment('pd-obj-B1', 'evt-obj-B1');

  // Server-verified actor → brand-obj-A only. Email actors ignore ADMIN_SCOPE_ALL
  // (it only ever elevates `key:` actors), so the global CI opt-in set in
  // vitest.config.mts cannot mask any assertion below.
  (routerEnv as { ADMIN_BRAND_MEMBERSHIP?: string }).ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    [SCOPED]: ['brand-obj-A'],
  });
});

// ── Path matching (pure — no runtime, no DB) ──────────────────────────────────

describe('OSE-1080 — which paths the object-scope wall covers', () => {
  test('every /admin/events/:id sub-resource resolves to that event', () => {
    for (const path of [
      '/api/v2/admin/events/evt-1',
      '/api/v2/admin/events/evt-1/stats',
      '/api/v2/admin/events/evt-1/verify-qr',
      '/api/v2/admin/events/evt-1/unverify-qr',
      '/api/v2/admin/events/evt-1/backup',
      '/api/v2/admin/events/evt-1/uploads',
      '/api/v2/admin/events/evt-1/poster-deployments',
      '/api/v2/admin/events/evt-1/flags/config.demo',
      '/api/v2/admin/events/evt-1/forms/registrations',
      '/api/v2/admin/events/evt-1/forms/export',
      '/api/v2/admin/events/evt-1/shared-report/mint-link',
      '/api/v2/admin/events/evt-1/preview',
    ]) {
      expect(matchAdminObjectTarget(path), path).toEqual({ kind: 'event', id: 'evt-1' });
    }
  });

  test('a poster-deployment id is its own target (it has no brand_id column)', () => {
    expect(matchAdminObjectTarget('/api/v2/admin/poster-deployments/pd-1')).toEqual({
      kind: 'poster-deployment',
      id: 'pd-1',
    });
  });

  test('collection routes are NOT objects — they must not be looked up as ids', () => {
    for (const path of [
      '/api/v2/admin/events',
      '/api/v2/admin/events/backfill-h3-cells',
      '/api/v2/admin/events/portfolio-rollup',
      '/api/v2/admin/poster-deployments/backfill-h3',
    ]) {
      expect(matchAdminObjectTarget(path), path).toBeNull();
    }
  });

  test('PUBLIC paths are intentionally out of scope and never matched', () => {
    for (const path of [
      '/api/v2/events/evt-1',
      '/api/v2/events/evt-1/sponsors',
      '/api/v2/events/evt-1/shared-report',
      '/poster',
      '/display',
    ]) {
      expect(matchAdminObjectTarget(path), path).toBeNull();
    }
  });
});

// ── Read paths ────────────────────────────────────────────────────────────────

describe('OSE-1080 / INVARIANT #9 — object-level admin READ is brand-scoped', () => {
  test('scoped operator CAN read stats for their own event', async () => {
    const res = await call('GET', '/api/v2/admin/events/evt-obj-A1/stats', headersAsEmail(SCOPED));
    expect(res.status).toBe(200);
  });

  test('scoped operator CANNOT read stats for another brand — 404, not 403', async () => {
    const res = await call('GET', '/api/v2/admin/events/evt-obj-B1/stats', headersAsEmail(SCOPED));
    // 404 keeps the id indistinguishable from one that does not exist; a 403
    // would confirm it exists and hand an attacker an enumeration oracle.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; code: string; stats?: unknown };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.stats).toBeUndefined();
  });

  test('OSE-1355 draft preview is brand-scoped: another brand id → 404, page never rendered', async () => {
    const res = await call(
      'GET',
      '/api/v2/admin/events/evt-obj-B1/preview',
      headersAsEmail(SCOPED)
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('Brand B Object Event');
    expect(text).not.toContain('admin-draft-preview-toolbar');
  });

  test('a cross-tenant miss is byte-identical to a genuinely unknown id', async () => {
    const cross = await call(
      'GET',
      '/api/v2/admin/events/evt-obj-B1/stats',
      headersAsEmail(SCOPED)
    );
    const unknown = await call(
      'GET',
      '/api/v2/admin/events/evt-does-not-exist/stats',
      headersAsEmail(SCOPED)
    );
    expect(cross.status).toBe(unknown.status);
    const a = (await cross.json()) as { ok: boolean; code: string };
    const b = (await unknown.json()) as { ok: boolean; code: string };
    expect(a.ok).toBe(b.ok);
    expect(a.code).toBe(b.code);
  });

  test('poster deployments inherit their EVENT brand: own reachable, other brand 404', async () => {
    const own = await call(
      'GET',
      '/api/v2/admin/poster-deployments/pd-obj-A1',
      headersAsEmail(SCOPED)
    );
    expect(own.status).toBe(200);

    const other = await call(
      'GET',
      '/api/v2/admin/poster-deployments/pd-obj-B1',
      headersAsEmail(SCOPED)
    );
    expect(other.status).toBe(404);
  });
});

// ── Mutate paths ──────────────────────────────────────────────────────────────

describe('OSE-1080 / INVARIANT #9 — object-level admin MUTATE is brand-scoped', () => {
  test('scoped operator CAN update their own event', async () => {
    const res = await call('PUT', '/api/v2/admin/events/evt-obj-A1', headersAsEmail(SCOPED), {
      title: 'Brand A Object Event (edited by owner)',
    });
    expect(res.status).toBe(200);
    expect(await titleOf('evt-obj-A1')).toBe('Brand A Object Event (edited by owner)');
  });

  test('scoped operator CANNOT update another brand’s event, and the row is untouched', async () => {
    const before = await titleOf('evt-obj-B1');
    const res = await call('PUT', '/api/v2/admin/events/evt-obj-B1', headersAsEmail(SCOPED), {
      title: 'PWNED BY BRAND A',
    });
    expect(res.status).toBe(404);
    // The wall is only real if the write never happened.
    expect(await titleOf('evt-obj-B1')).toBe(before);
    expect(await titleOf('evt-obj-B1')).not.toBe('PWNED BY BRAND A');
  });

  test('cross-tenant event-flag override is refused (sub-resource of the event)', async () => {
    const res = await call(
      'PUT',
      '/api/v2/admin/events/evt-obj-B1/flags/config.demo',
      headersAsEmail(SCOPED),
      { enabled: true }
    );
    expect(res.status).toBe(404);
  });

  test('cross-tenant QR verify is refused (state transition never runs)', async () => {
    const res = await call(
      'POST',
      '/api/v2/admin/events/evt-obj-B1/verify-qr',
      headersAsEmail(SCOPED)
    );
    expect(res.status).toBe(404);
    const status = await env.DB.prepare('SELECT status FROM events WHERE id = ?')
      .bind('evt-obj-B1')
      .first<{ status: string }>();
    expect(status?.status).toBe('active'); // unchanged by the refused call
  });

  test('cross-tenant SharedReport mint-link is refused (no token is minted)', async () => {
    const res = await call(
      'POST',
      '/api/v2/admin/events/evt-obj-B1/shared-report/mint-link',
      headersAsEmail(SCOPED),
      { role: 'sponsor' }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { token?: string };
    expect(body.token).toBeUndefined();
  });
});

// ── Fail-closed + unchanged-paths ─────────────────────────────────────────────

describe('OSE-1080 / INVARIANT #9 — fail-closed defaults and untouched paths', () => {
  test('deny mode (authenticated but unmapped) reaches NO object', async () => {
    for (const path of [
      '/api/v2/admin/events/evt-obj-A1/stats',
      '/api/v2/admin/events/evt-obj-B1/stats',
      '/api/v2/admin/poster-deployments/pd-obj-A1',
    ]) {
      const res = await call('GET', path, headersAsEmail(UNMAPPED));
      expect(res.status, path).toBe(404);
    }
  });

  test('deny mode cannot mutate either — the update is refused and the row stands', async () => {
    const before = await titleOf('evt-obj-A1');
    const res = await call('PUT', '/api/v2/admin/events/evt-obj-A1', headersAsEmail(UNMAPPED), {
      title: 'unmapped operator write',
    });
    expect(res.status).toBe(404);
    expect(await titleOf('evt-obj-A1')).toBe(before);
  });

  test("'all' mode (key actor + ADMIN_SCOPE_ALL) is unchanged — CI reaches every brand", async () => {
    for (const id of ['evt-obj-A1', 'evt-obj-B1']) {
      const res = await call('GET', `/api/v2/admin/events/${id}/stats`, headersAsKeyActor());
      expect(res.status, id).toBe(200);
    }
    const put = await call('PUT', '/api/v2/admin/events/evt-obj-B1', headersAsKeyActor(), {
      description: 'automation edit',
    });
    expect(put.status).toBe(200);
  });

  test('an ANONYMOUS caller still gets 401 — the scope guard never answers before auth', async () => {
    // 404-before-401 would tell an unauthenticated prober that credentials were
    // not the blocker. requireAdmin must own this response.
    for (const [method, path] of [
      ['GET', '/api/v2/admin/events/evt-obj-B1/stats'],
      ['PUT', '/api/v2/admin/events/evt-obj-B1'],
      ['POST', '/api/v2/admin/events/evt-obj-B1/shared-report/mint-link'],
    ] as const) {
      const res = await call(method, path, {}, method === 'GET' ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  test('collection routes still work for a scoped operator (not swallowed as ids)', async () => {
    const rollup = await call(
      'GET',
      '/api/v2/admin/events/portfolio-rollup',
      headersAsEmail(SCOPED)
    );
    expect(rollup.status).toBe(200);
  });
});

// ── Path-normalization bypass class ───────────────────────────────────────────
//
// The wall's soundness rests on ONE property: the guard's matcher is a SUPERSET
// of every router matcher that dispatches to an event/deployment handler, and
// both read the identical `url.pathname`. If that ever drifts — e.g. the guard
// regex loses its `(?:\/.*)?` subtree tail while the router keeps dispatching
// sub-resources — a normalized path (trailing slash, doubled slash, %2F, case,
// query string) could reach a mutating handler the guard no longer recognizes.
// These lock that class shut so the drift is caught here, not in production.
//
// Born-red proof (2026-08-28): narrowing ADMIN_EVENT_OBJECT_PATH to
// `…events\/([^/]+)$` (dropping the subtree tail) turns the sub-resource probes
// below red — the shipped superset regex keeps them green.
describe('OSE-1080 / INVARIANT #9 — normalization cannot smuggle a cross-tenant object past the guard', () => {
  // Every variant addresses brand-B's event or deployment; a brand-A operator
  // must be answered 404 (or a route 404), never 200, and brand-B must be left
  // byte-identical.
  const crossTenantVariants: ReadonlyArray<readonly [string, string]> = [
    ['PUT', '/api/v2/admin/events/evt-obj-B1'], // baseline
    ['PUT', '/api/v2/admin/events/evt-obj-B1/'], // trailing slash
    ['GET', '/api/v2/admin/events/evt-obj-B1/stats'], // baseline sub-resource
    ['GET', '/api/v2/admin/events/evt-obj-B1/stats/'], // trailing slash on sub-resource
    ['GET', '/api/v2/admin/events/evt-obj-B1//stats'], // doubled slash before sub-resource
    ['GET', '/api/v2/admin/events/evt-obj-B1%2Fstats'], // percent-encoded slash
    ['GET', '/api/v2/admin/events/evt-obj-B1/STATS'], // upper-case sub-resource
    ['PUT', '/api/v2/admin/events/evt-obj-B1?impersonate=brand-obj-A'], // query string
    ['GET', '/api/v2/admin/poster-deployments/pd-obj-B1/'], // deployment, trailing slash
  ];

  for (const [method, path] of crossTenantVariants) {
    test(`${method} ${path} never reaches a handler as 200 and never mutates brand B`, async () => {
      const before = await titleOf('evt-obj-B1');
      const res = await call(
        method,
        path,
        headersAsEmail(SCOPED),
        method === 'GET' ? undefined : { title: 'PWNED VIA NORMALIZATION' }
      );
      expect(res.status, `${method} ${path} returned ${res.status}`).not.toBe(200);
      // The wall is only real if no normalized spelling let the write through.
      expect(await titleOf('evt-obj-B1'), `${method} ${path} mutated brand B`).toBe(before);
    });
  }

  test('the matcher recognizes trailing-slash + sub-resource spellings as the SAME event target (superset property)', () => {
    for (const path of [
      '/api/v2/admin/events/evt-1/',
      '/api/v2/admin/events/evt-1/stats/',
      '/api/v2/admin/events/evt-1//stats',
    ]) {
      expect(matchAdminObjectTarget(path), path).toEqual({ kind: 'event', id: 'evt-1' });
    }
  });
});
