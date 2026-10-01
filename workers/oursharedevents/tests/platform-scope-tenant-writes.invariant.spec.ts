/**
 * AUD-3 (OSE-1447) + R-3 (OSE-845) — platform scope and tenant-scoped writes
 * (INVARIANT #9 tenant_isolation).
 *
 * The CCR of 2026-09-30 (PR #715, worksheet `.claude/outputs/CCR-ACCESS-CONTROL-
 * AUDIT-ISOLATION-2026-09-30.md`) found admin routes that only asked "is this an
 * admin?" and never "which tenant may this admin touch?":
 *
 *   S2   platform-owned reads (subscribers, rate-limit stats, cross-brand audit
 *        log, confidential briefing pages) served to every brand admin;
 *   S12  data-subject erase deleting across every tenant;
 *   S14  event create taking `brand_id` from the body (default 'root');
 *   S15  H3 backfills rewriting rows across every tenant;
 *   S16  sponsor create with an `event_id` taking that event's brand unchecked;
 *   S17  sponsor-draft promotion never checking the caller's brand.
 *
 * Platform-owned routes become key-actor only (there is deliberately no human
 * super-admin, Feature G / OSE-832): an email actor gets 404, the same as a route
 * that does not exist. Tenant writes resolve the caller's brand scope first.
 *
 * Every test runs through `route()` because the contract is ordering: auth (401)
 * first, then scope (404/403), then the handler.
 *
 * @born-red invariant#9 | method: platform-scope + cross-tenant-create | armed: 2026-10-01
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { PLATFORM_BRAND_ID } from '../src/lib/admin-brand-scope';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const routerEnv = env as unknown as RouterEnv;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse((env as unknown as TestEnv).TEST_MIGRATION_STATEMENTS);
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

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode-only CF Access JWT (CF_ACCESS_TEAM_DOMAIN is unset in tests). */
function asEmail(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
  };
}

/** `key:admin` + ADMIN_SCOPE_ALL='true' (vitest.workers.config.mts) → scope mode 'all'. */
function asKeyActor(): Record<string, string> {
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

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const SCOPED_A = 'pst-a@example.com'; // member of brand pst-A only
const PLATFORM_MEMBER = 'pst-platform@example.com'; // member of the reserved platform brand
const BRAND_A = 'pst-a';
const BRAND_B = 'pst-b';

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, 'active')`
  )
    .bind('evt-pst-A', BRAND_A, 'PST Brand A Event', 'pst-a-event')
    .run();
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, 'active')`
  )
    .bind('evt-pst-B', BRAND_B, 'PST Brand B Event', 'pst-b-event')
    .run();
  await env.DB.prepare(
    `INSERT INTO sponsor_business_draft (draft_token, brand_id, event_id, name, status)
     VALUES (?, ?, ?, ?, 'draft')`
  )
    .bind('sbd-pst-B', BRAND_B, 'evt-pst-B', 'PST Brand B Draft Sponsor')
    .run();

  (routerEnv as { ADMIN_BRAND_MEMBERSHIP?: string }).ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    [SCOPED_A]: [BRAND_A],
    [PLATFORM_MEMBER]: [PLATFORM_BRAND_ID],
  });
});

// ── S2 / S12 / S15: platform-owned routes are key-actor only ──────────────────

const PLATFORM_ROUTES: Array<[string, string, unknown?]> = [
  ['GET', '/api/v2/admin/subscribers'],
  ['GET', '/api/v2/admin/security/rate-limit-stats'],
  ['GET', '/api/v2/admin/audit-log'],
  ['POST', '/api/v2/admin/data-subject/erase', { email: 'someone@example.org' }],
  ['POST', '/api/v2/admin/events/backfill-h3-cells', {}],
  ['POST', '/api/v2/admin/poster-deployments/backfill-h3', {}],
  ['GET', '/briefing'],
  ['GET', '/overview'],
  ['GET', '/summary'],
];

describe('AUD-3 — platform-owned routes refuse brand-scoped admins', () => {
  for (const [method, path, body] of PLATFORM_ROUTES) {
    test(`${method} ${path}: brand-scoped email admin gets 404`, async () => {
      const res = await call(method, path, asEmail(SCOPED_A), body);
      expect(res.status).toBe(404);
    });

    test(`${method} ${path}: key actor is not refused by scope`, async () => {
      const res = await call(method, path, asKeyActor(), body);
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(401);
    });

    test(`${method} ${path}: a platform-brand member is not refused by scope`, async () => {
      const res = await call(method, path, asEmail(PLATFORM_MEMBER), body);
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(401);
    });

    test(`${method} ${path}: anonymous caller still gets 401 (auth answers first)`, async () => {
      const res = await call(method, path, {}, body);
      expect(res.status).toBe(401);
    });
  }

  test('S12: a brand-A admin cannot erase another tenant’s subscriber', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM subscribers');
    const res = await call('POST', '/api/v2/admin/data-subject/erase', asEmail(SCOPED_A), {
      email: 'victim@example.org',
    });
    expect(res.status).toBe(404);
    expect(await count('SELECT COUNT(*) AS n FROM subscribers')).toBe(before);
  });
});

// ── S14 / R-3: event create is tenant-scoped ──────────────────────────────────

describe('R-3 — event create resolves the caller’s brand scope', () => {
  test('S14: brand-A admin creating with brand_id = B is refused and no row is created', async () => {
    const res = await call('POST', '/api/v2/admin/events', asEmail(SCOPED_A), {
      title: 'PST Cross Tenant Create',
      brand_id: BRAND_B,
    });
    expect(res.status).toBe(403);
    expect((await res.json<{ code?: string }>()).code).toBe('BRAND_FORBIDDEN');
    expect(
      await count('SELECT COUNT(*) AS n FROM events WHERE title = ?', 'PST Cross Tenant Create')
    ).toBe(0);
  });

  test('S14: brand-A admin with no brand_id gets their own brand, never root', async () => {
    const res = await call('POST', '/api/v2/admin/events', asEmail(SCOPED_A), {
      title: 'PST Default Brand Create',
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT brand_id FROM events WHERE title = ?')
      .bind('PST Default Brand Create')
      .first<{ brand_id: string }>();
    expect(row?.brand_id).toBe(BRAND_A);
  });

  test('brand-A admin creating inside brand A still succeeds (no lock-out)', async () => {
    const res = await call('POST', '/api/v2/admin/events', asEmail(SCOPED_A), {
      title: 'PST Own Brand Create',
      brand_id: BRAND_A,
    });
    expect(res.status).toBe(201);
  });

  test('an unmapped admin (deny scope) cannot create an event at all', async () => {
    const res = await call('POST', '/api/v2/admin/events', asEmail('pst-nobody@example.com'), {
      title: 'PST Deny Create',
    });
    expect(res.status).toBe(403);
    expect(await count('SELECT COUNT(*) AS n FROM events WHERE title = ?', 'PST Deny Create')).toBe(
      0
    );
  });

  test('regression lock: an update body cannot move an event to another brand', async () => {
    const res = await call('PUT', '/api/v2/admin/events/evt-pst-A', asEmail(SCOPED_A), {
      title: 'PST Brand A Event',
      brand_id: BRAND_B,
    });
    expect(res.status).toBeLessThan(500);
    const row = await env.DB.prepare('SELECT brand_id FROM events WHERE id = ?')
      .bind('evt-pst-A')
      .first<{ brand_id: string }>();
    expect(row?.brand_id).toBe(BRAND_A);
  });
});

// ── S16 / S17: sponsor writes are tenant-scoped ───────────────────────────────

describe('AUD-3 — sponsor create and promote resolve the caller’s brand scope', () => {
  test('S16: brand-A admin creating a sponsor on a brand-B event is refused and nothing is written', async () => {
    const res = await call('POST', '/api/v2/admin/sponsors', asEmail(SCOPED_A), {
      name: 'PST Cross Tenant Sponsor',
      tier: 'gold',
      event_id: 'evt-pst-B',
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ code?: string }>()).code).toBe('EVENT_NOT_FOUND');
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM sponsor_business WHERE name = ?',
        'PST Cross Tenant Sponsor'
      )
    ).toBe(0);
  });

  test('S16: an out-of-scope event is indistinguishable from a missing one', async () => {
    const foreign = await call('POST', '/api/v2/admin/sponsors', asEmail(SCOPED_A), {
      name: 'PST Oracle Probe Foreign',
      tier: 'gold',
      event_id: 'evt-pst-B',
    });
    const missing = await call('POST', '/api/v2/admin/sponsors', asEmail(SCOPED_A), {
      name: 'PST Oracle Probe Missing',
      tier: 'gold',
      event_id: 'evt-does-not-exist',
    });
    expect(foreign.status).toBe(missing.status);
    expect((await foreign.json<{ code?: string }>()).code).toBe(
      (await missing.json<{ code?: string }>()).code
    );
  });

  test('S16: brand-A admin creating a sponsor on their own event still succeeds', async () => {
    const res = await call('POST', '/api/v2/admin/sponsors', asEmail(SCOPED_A), {
      name: 'PST Own Event Sponsor',
      tier: 'gold',
      event_id: 'evt-pst-A',
    });
    expect(res.status).toBe(201);
  });

  test('S17: brand-A admin promoting a brand-B draft gets 404 and the draft is untouched', async () => {
    const res = await call('POST', '/api/v2/admin/sponsors/promote', asEmail(SCOPED_A), {
      draft_token: 'sbd-pst-B',
    });
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(
      'SELECT status, promoted_sponsor_id FROM sponsor_business_draft WHERE draft_token = ?'
    )
      .bind('sbd-pst-B')
      .first<{ status: string; promoted_sponsor_id: string | null }>();
    expect(row?.status).toBe('draft');
    expect(row?.promoted_sponsor_id).toBeNull();
  });

  test('S17: an out-of-scope draft is indistinguishable from a missing one', async () => {
    const foreign = await call('POST', '/api/v2/admin/sponsors/promote', asEmail(SCOPED_A), {
      draft_token: 'sbd-pst-B',
    });
    const missing = await call('POST', '/api/v2/admin/sponsors/promote', asEmail(SCOPED_A), {
      draft_token: 'sbd-does-not-exist',
    });
    expect(foreign.status).toBe(missing.status);
    expect((await foreign.json<{ code?: string }>()).code).toBe(
      (await missing.json<{ code?: string }>()).code
    );
  });
});
