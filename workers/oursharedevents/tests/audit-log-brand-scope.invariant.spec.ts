/**
 * AUD-3 Phase B (OSE-1447) — brand-scoped audit log (INVARIANT #9 tenant_isolation).
 *
 * Phase A (#722) made GET /api/v2/admin/audit-log platform-only: every row of
 * every brand, so a brand admin gets 404. Phase B gives a brand owner their own
 * brand's history without reopening that leak:
 *
 *   - every row records brand_id, resolved at insert from its target
 *     (migration 0088 adds the column and backfills older rows the same way);
 *   - `?scope=brand` returns only rows of brands the caller owns, never a row
 *     with a NULL brand (platform actions and unresolvable targets);
 *   - IPs are masked (/24, /48) for every caller except a `key:` actor;
 *   - another tenant's operator who touched this brand's object shows as null;
 *   - every filter and the cursor are validated before SQL runs (400).
 *
 * Every route test runs through `route()`, since the ordering is part of the
 * contract: auth (401) first, then the scope check (400 or 404), then the handler.
 *
 * @born-red invariant#9 | method: brand-scoped-audit-view | armed: 2026-10-01
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { logAdminAction } from '../src/lib/audit-log';
import { maskIp } from '../src/lib/ip-mask';
import { handleListAuditLog } from '../src/handlers/audit';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

async function applyStatements(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
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
    // A signed-in person is a browser on the admin site (admin write guard).
    'Sec-Fetch-Site': 'same-origin',
  };
}

/** `key:admin` + ADMIN_SCOPE_ALL='true' (vitest.workers.config.mts) → scope mode 'all'. */
const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };

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

interface Entry {
  id: string;
  action: string;
  actor: string | null;
  brand_id: string | null;
  ip: string | null;
  resource_type: string | null;
  resource_id: string | null;
}
interface ListBody {
  ok: boolean;
  scope?: string;
  entries: Entry[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
  code?: string;
}

const BRAND_A = 'alb-a';
const BRAND_B = 'alb-b';
const OWNER_A = 'alb-owner-a@example.com';
const ORGANIZER_A = 'alb-organizer-a@example.com';
const OWNER_B = 'alb-owner-b@example.com';
const UNMAPPED = 'alb-nobody@example.com';
const EVT_A = 'evt-alb-A';
const EVT_B = 'evt-alb-B';
const SPONSOR_A = 'sb-alb-A';
const PLACEMENT_B = 'sp-alb-B';

const IPV4_FULL = /\b(?:\d{1,3}\.){3}\d{1,3}\b(?!\/)/;
const HEX64 = /\b[0-9a-f]{64}\b/i;

async function seedRow(
  id: string,
  fields: {
    action: string;
    actor: string | null;
    resource_type: string | null;
    resource_id: string | null;
    ip: string | null;
    created_at: string;
  }
): Promise<void> {
  await logAdminAction(tenv, {
    action: fields.action,
    actor: fields.actor,
    resource_type: fields.resource_type ?? undefined,
    resource_id: fields.resource_id ?? undefined,
    request_id: `req-${id}`,
    outcome: 'success',
    ip: fields.ip ?? undefined,
  });
  // Pin id/created_at so the ordering and cursor assertions are deterministic.
  // (Test fixture only; the product never updates audit rows.)
  await tenv.DB.prepare(`UPDATE admin_audit_log SET id = ?, created_at = ? WHERE request_id = ?`)
    .bind(id, fields.created_at, `req-${id}`)
    .run();
}

beforeAll(async () => {
  await applyStatements(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await applyStatements(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);

  for (const [id, brand] of [
    [EVT_A, BRAND_A],
    [EVT_B, BRAND_B],
  ]) {
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, 'active')`
    )
      .bind(id, brand, `ALB ${id}`, id.toLowerCase())
      .run();
  }
  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, is_active) VALUES (?, ?, ?, 1)`
  )
    .bind(SPONSOR_A, BRAND_A, 'ALB Sponsor A')
    .run();
  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, is_active) VALUES (?, ?, ?, 1)`
  )
    .bind('sb-alb-B', BRAND_B, 'ALB Sponsor B')
    .run();
  await tenv.DB.prepare(
    `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active)
     VALUES (?, ?, ?, 'standard', 'organizer', 1)`
  )
    .bind(PLACEMENT_B, 'sb-alb-B', EVT_B)
    .run();

  for (const [email, brand, role] of [
    [OWNER_A, BRAND_A, 'brand_owner'],
    [ORGANIZER_A, BRAND_A, 'organizer'],
    [OWNER_B, BRAND_B, 'brand_owner'],
  ]) {
    await tenv.DB.prepare(
      `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, ?)`
    )
      .bind(email, brand, role)
      .run();
  }

  // Brand A history: its own owner, an automation key, and a brand-B admin
  // probing brand A's event (denied in real life; the identity must not leak).
  await seedRow('alb-1', {
    action: 'UPDATE_EVENT',
    actor: OWNER_A,
    resource_type: 'event',
    resource_id: EVT_A,
    ip: '203.0.113.77',
    created_at: '2020-01-01T10:00:05.000Z',
  });
  await seedRow('alb-2', {
    action: 'UPDATE_SPONSOR',
    actor: 'key:admin',
    resource_type: 'sponsor',
    resource_id: SPONSOR_A,
    ip: '2001:db8:85a3:1:2:3:4:5',
    created_at: '2020-01-01T10:00:04.000Z',
  });
  await seedRow('alb-3', {
    action: 'UPDATE_EVENT',
    actor: OWNER_B,
    resource_type: 'event',
    resource_id: EVT_A,
    ip: '198.51.100.9',
    created_at: '2020-01-01T10:00:03.000Z',
  });
  await seedRow('alb-3b', {
    action: 'UPDATE_EVENT',
    actor: OWNER_B,
    resource_type: 'event',
    resource_id: EVT_A,
    ip: '198.51.100.9',
    created_at: '2020-01-01T10:00:02.500Z',
  });
  await seedRow('alb-4', {
    action: 'SET_EVENT_FLAG',
    actor: OWNER_A,
    resource_type: 'flag',
    resource_id: `${EVT_A}/qr_v2`,
    ip: '::ffff:192.0.2.44',
    created_at: '2020-01-01T10:00:02.000Z',
  });
  // Brand B history.
  await seedRow('alb-5', {
    action: 'ANSWER_SPONSOR_REQUEST',
    actor: OWNER_B,
    resource_type: 'sponsor_placement',
    resource_id: PLACEMENT_B,
    ip: '198.51.100.10',
    created_at: '2020-01-01T10:00:01.000Z',
  });
  // Platform rows: never in any brand view.
  await seedRow('alb-6', {
    action: 'SET_FLAG',
    actor: 'key:admin',
    resource_type: 'flag',
    resource_id: 'qr_v2',
    ip: '192.0.2.1',
    created_at: '2020-01-01T10:00:00.900Z',
  });
  await seedRow('alb-7', {
    action: 'PLATFORM_SCOPE_DENIED',
    actor: OWNER_A,
    resource_type: 'platform',
    resource_id: '/api/v2/admin/subscribers',
    ip: '203.0.113.77',
    created_at: '2020-01-01T10:00:00.800Z',
  });
  await seedRow('alb-8', {
    action: 'UPDATE_EVENT',
    actor: OWNER_A,
    resource_type: 'event',
    resource_id: 'evt-alb-gone',
    ip: '203.0.113.77',
    created_at: '2020-01-01T10:00:00.700Z',
  });
});

async function brandRow(id: string): Promise<string | null> {
  const row = await tenv.DB.prepare('SELECT brand_id FROM admin_audit_log WHERE id = ?')
    .bind(id)
    .first<{ brand_id: string | null }>();
  return row?.brand_id ?? null;
}

// ── Write side: the INSERT resolves the tenant ───────────────────────────────

describe('AUD-3 B — logAdminAction records the target brand', () => {
  test.each([
    ['alb-1', 'event', BRAND_A],
    ['alb-2', 'sponsor_business', BRAND_A],
    ['alb-4', 'per-event flag "<event>/<key>"', BRAND_A],
    ['alb-5', 'sponsor_placement → its event', BRAND_B],
  ])('%s (%s) → %s', async (id, _label, brand) => {
    expect(await brandRow(id)).toBe(brand);
  });

  test.each([
    ['alb-6', 'global flag'],
    ['alb-7', 'platform refusal'],
    ['alb-8', 'event that does not exist'],
  ])('%s (%s) → NULL (platform-only, fail closed)', async (id) => {
    expect(await brandRow(id)).toBeNull();
  });

  test('an explicit brand_id wins over resolution (sponsor_draft writer)', async () => {
    await logAdminAction(tenv, {
      action: 'SPONSOR_ELIGIBILITY_DECISION',
      actor: 'key:admin',
      resource_type: 'sponsor_draft',
      resource_id: BRAND_B,
      brand_id: BRAND_B,
      request_id: 'req-alb-draft',
      outcome: 'denied',
    });
    const row = await tenv.DB.prepare('SELECT brand_id FROM admin_audit_log WHERE request_id = ?')
      .bind('req-alb-draft')
      .first<{ brand_id: string }>();
    expect(row?.brand_id).toBe(BRAND_B);
  });
});

// ── Migration 0088 backfill ─────────────────────────────────────────────────

describe('AUD-3 B — migration 0088 backfill', () => {
  const backfill = (): string[] =>
    (JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]).filter((s) =>
      /UPDATE\s+admin_audit_log\s+SET\s+brand_id/i.test(s)
    );

  test('resolves legacy rows, keeps recorded values, and is idempotent', async () => {
    const legacy: Array<[string, string, string]> = [
      ['alb-legacy-event', 'event', EVT_A],
      ['alb-legacy-forms', 'forms-export', EVT_B],
      ['alb-legacy-flag', 'flag', `${EVT_B}/x`],
      ['alb-legacy-global', 'flag', 'x'],
      ['alb-legacy-sponsor', 'sponsor', SPONSOR_A],
      ['alb-legacy-placement', 'sponsor_placement', PLACEMENT_B],
      ['alb-legacy-draft', 'sponsor_draft', BRAND_A],
      ['alb-legacy-gone', 'event', 'evt-never'],
    ];
    for (const [id, type, rid] of legacy) {
      await tenv.DB.prepare(
        `INSERT INTO admin_audit_log (id, action, actor, resource_type, resource_id, request_id, outcome)
         VALUES (?, 'LEGACY', 'key:admin', ?, ?, ?, 'success')`
      )
        .bind(id, type, rid, `req-${id}`)
        .run();
    }
    // A value already recorded is never rewritten by the backfill.
    await tenv.DB.prepare(
      `INSERT INTO admin_audit_log (id, action, actor, resource_type, resource_id, request_id, outcome, brand_id)
       VALUES ('alb-legacy-kept', 'LEGACY', 'key:admin', 'event', ?, 'req-kept', 'success', 'recorded')`
    )
      .bind(EVT_A)
      .run();

    const stmts = backfill();
    expect(stmts.length).toBe(5);
    for (let run = 0; run < 2; run++) {
      for (const s of stmts) await tenv.DB.prepare(s).run();
      expect(await brandRow('alb-legacy-event')).toBe(BRAND_A);
      expect(await brandRow('alb-legacy-forms')).toBe(BRAND_B);
      expect(await brandRow('alb-legacy-flag')).toBe(BRAND_B);
      expect(await brandRow('alb-legacy-global')).toBeNull();
      expect(await brandRow('alb-legacy-sponsor')).toBe(BRAND_A);
      expect(await brandRow('alb-legacy-placement')).toBe(BRAND_B);
      expect(await brandRow('alb-legacy-draft')).toBe(BRAND_A);
      expect(await brandRow('alb-legacy-gone')).toBeNull();
      expect(await brandRow('alb-legacy-kept')).toBe('recorded');
    }
  });
});

// ── Read side: who may read what ─────────────────────────────────────────────

const BRAND_PATH = '/api/v2/admin/audit-log?scope=brand&limit=100';

describe('AUD-3 B — GET /audit-log?scope=brand access matrix', () => {
  test('unauthenticated → 401 (auth runs before scope)', async () => {
    expect((await call('GET', BRAND_PATH)).status).toBe(401);
  });

  test('a brand-A owner sees brand A rows only, never brand B or platform rows', async () => {
    const res = await call('GET', BRAND_PATH, asEmail(OWNER_A));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    expect(body.scope).toBe('brand');
    const ids = body.entries.map((e) => e.id);
    for (const id of ['alb-1', 'alb-2', 'alb-3', 'alb-4']) expect(ids).toContain(id);
    for (const id of ['alb-5', 'alb-6', 'alb-7', 'alb-8']) expect(ids).not.toContain(id);
    expect(body.entries.every((e) => e.brand_id === BRAND_A)).toBe(true);
  });

  test('a brand-B owner sees brand B rows only', async () => {
    const body = (await (await call('GET', BRAND_PATH, asEmail(OWNER_B))).json()) as ListBody;
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.brand_id === BRAND_B)).toBe(true);
  });

  test('IPs are masked for brand callers; no full IPv4 or 64-hex hash leaves', async () => {
    const res = await call('GET', BRAND_PATH, asEmail(OWNER_A));
    const text = await res.text();
    expect(text).not.toMatch(IPV4_FULL);
    expect(text).not.toMatch(HEX64);
    const byId = Object.fromEntries((JSON.parse(text) as ListBody).entries.map((e) => [e.id, e]));
    expect(byId['alb-1'].ip).toBe('203.0.113.0/24');
    expect(byId['alb-2'].ip).toBe('2001:db8:85a3::/48');
    expect(byId['alb-4'].ip).toBe('192.0.2.0/24');
  });

  test("another tenant's operator on this brand's object is shown as null", async () => {
    const body = (await (await call('GET', BRAND_PATH, asEmail(OWNER_A))).json()) as ListBody;
    const byId = Object.fromEntries(body.entries.map((e) => [e.id, e]));
    expect(byId['alb-3'].actor).toBeNull();
    expect(byId['alb-1'].actor).toBe(OWNER_A);
    expect(byId['alb-2'].actor).toBe('key:admin');
  });

  test('an actor filter cannot confirm a hidden identity', async () => {
    const res = await call(
      'GET',
      `${BRAND_PATH}&actor=${encodeURIComponent(OWNER_B)}`,
      asEmail(OWNER_A)
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListBody).entries).toEqual([]);
  });

  test('a brand member without brand_owner gets 404, and the refusal is audited', async () => {
    const res = await call('GET', BRAND_PATH, asEmail(ORGANIZER_A));
    expect(res.status).toBe(404);
    const row = await tenv.DB.prepare(
      `SELECT outcome, brand_id FROM admin_audit_log
        WHERE action = 'AUDIT_LOG_SCOPE_DENIED' AND actor = ? ORDER BY created_at DESC LIMIT 1`
    )
      .bind(ORGANIZER_A)
      .first<{ outcome: string; brand_id: string | null }>();
    expect(row?.outcome).toBe('denied');
    expect(row?.brand_id).toBeNull();
  });

  test('an unmapped email gets 404 byte-identical to an unknown route', async () => {
    const refused = await call('GET', BRAND_PATH, asEmail(UNMAPPED));
    const unknown = await call('GET', '/api/v2/admin/no-such-route-alb', asEmail(UNMAPPED));
    expect(refused.status).toBe(404);
    expect(await refused.text()).toBe(await unknown.text());
  });

  test('without scope the route stays platform-only (Phase A unchanged)', async () => {
    expect((await call('GET', '/api/v2/admin/audit-log', asEmail(OWNER_A))).status).toBe(404);
  });

  test('a key actor in scope mode all sees every brand row, IPs as stored (masked at write), still no NULL rows', async () => {
    const body = (await (await call('GET', BRAND_PATH, KEY)).json()) as ListBody;
    const ids = body.entries.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['alb-1', 'alb-5']));
    expect(body.entries.every((e) => e.brand_id !== null)).toBe(true);
    expect(body.entries.find((e) => e.id === 'alb-1')?.ip).toBe('203.0.113.0/24');
    expect(body.entries.find((e) => e.id === 'alb-3')?.actor).toBe(OWNER_B);
  });
});

// ── Fat-finger and injection: 400 before SQL, never 500 ──────────────────────

describe('AUD-3 B — input validation', () => {
  test.each([
    ['scope=all', 'INVALID_SCOPE'],
    ['scope=BRAND', 'INVALID_SCOPE'],
    ['scope=brand&cursor=not-a-date', 'INVALID_CURSOR'],
    ['scope=brand&cursor=2020-01-01T10:00:04.0Z', 'INVALID_CURSOR'],
    ['scope=brand&cursor=2020-01-01T10:00:04Z', 'INVALID_CURSOR'],
    ['scope=brand&cursor=2026-99-99T99:99:99.999Z', 'INVALID_CURSOR'],
    ['scope=brand&cursor=2026-02-30T10:00:00.000Z', 'INVALID_CURSOR'],
    ["scope=brand&cursor=2026-10-01' OR 1=1--", 'INVALID_CURSOR'],
    ["scope=brand&actor=x' OR '1'='1", 'INVALID_FILTER'],
    ['scope=brand&action=update_event;DROP', 'INVALID_FILTER'],
    [`scope=brand&action=${'A'.repeat(129)}`, 'INVALID_FILTER'],
    [`scope=brand&actor=${'a'.repeat(10_000)}`, 'INVALID_FILTER'],
    ['scope=brand&actor=аdmin@example.com', 'INVALID_FILTER'],
    ['scope=brand&resource_type=Event', 'INVALID_FILTER'],
    ['scope=brand&outcome=maybe', 'INVALID_FILTER'],
  ])('%s → 400 %s', async (qs, code) => {
    const res = await call('GET', `/api/v2/admin/audit-log?${qs}`, asEmail(OWNER_A));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ListBody).code).toBe(code);
  });

  test('the platform view validates the same way', async () => {
    const res = await call('GET', '/api/v2/admin/audit-log?cursor=yesterday', KEY);
    expect(res.status).toBe(400);
  });

  test('a valid cursor pages backward', async () => {
    const res = await call(
      'GET',
      `/api/v2/admin/audit-log?scope=brand&cursor=2020-01-01T10:00:04.000Z`,
      asEmail(OWNER_A)
    );
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as ListBody).entries.map((e) => e.id);
    expect(ids).toEqual(['alb-3', 'alb-3b', 'alb-4']);
  });
});

// ── Review fixes (Copilot on #737) ──────────────────────────────────────────

describe('AUD-3 B — no leak through pagination, no N+1, creates and deletes attributed', () => {
  test('an owner of 150 brands still gets their page (D1 binds at most 100 parameters)', async () => {
    const owner = 'alb-wide-owner@example.com';
    const brands = [BRAND_A, ...Array.from({ length: 149 }, (_, i) => `alb-wide-${i}`)];
    const insert = tenv.DB.prepare(
      `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
    );
    await tenv.DB.batch(brands.map((b) => insert.bind(owner, b)));
    try {
      const res = await call(
        'GET',
        `${BRAND_PATH}&action=UPDATE_EVENT&cursor=2030-01-01T00:00:00.000Z`,
        asEmail(owner)
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListBody;
      expect(body.entries.map((e) => e.id)).toContain('alb-1');
      expect(body.entries.every((e) => e.brand_id === BRAND_A)).toBe(true);
    } finally {
      await tenv.DB.prepare('DELETE FROM admin_brand_memberships WHERE email = ?')
        .bind(owner)
        .run();
    }
  });

  test('a hidden actor filter returns the canonical empty page, even past limit', async () => {
    const res = await call(
      'GET',
      `/api/v2/admin/audit-log?scope=brand&limit=1&actor=${encodeURIComponent(OWNER_B)}`,
      asEmail(OWNER_A)
    );
    const body = (await res.json()) as ListBody;
    expect(body.entries).toEqual([]);
    expect(body.pagination).toEqual({ limit: 1, hasMore: false, nextCursor: null });
  });

  test('a page with many human actors costs one membership query, not one per actor', async () => {
    for (let i = 0; i < 6; i++) {
      await seedRow(`alb-many-${i}`, {
        action: 'UPDATE_EVENT',
        actor: `alb-many-${i}@example.com`,
        resource_type: 'event',
        resource_id: EVT_A,
        ip: '203.0.113.5',
        created_at: `2019-01-01T10:00:0${i}.000Z`,
      });
    }
    let prepares = 0;
    const db = new Proxy(tenv.DB, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (sql: string) => {
            prepares++;
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const res = await handleListAuditLog(
      new Request(
        'https://ose.test/api/v2/admin/audit-log?scope=brand&cursor=2019-12-31T00:00:00.000Z'
      ),
      { DB: db } as never,
      { kind: 'brand', brandIds: [BRAND_A], maskIps: true },
      'req-alb-n1'
    );
    const body = (await res.json()) as ListBody;
    expect(body.entries.length).toBe(6);
    expect(body.entries.every((e) => e.actor === null)).toBe(true);
    expect(prepares).toBe(2); // the page + one batched membership lookup
  });

  test('a failed membership lookup hides every operator; it never falls back to the env map', async () => {
    const db = new Proxy(tenv.DB, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('admin_brand_memberships')) throw new Error('D1_ERROR: simulated');
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const res = await handleListAuditLog(
      new Request('https://ose.test/api/v2/admin/audit-log?scope=brand&limit=100'),
      // A stale env map that still names OWNER_A as a member of brand A.
      { DB: db, ADMIN_BRAND_MEMBERSHIP: JSON.stringify({ [OWNER_A]: [BRAND_A] }) } as never,
      { kind: 'brand', brandIds: [BRAND_A], maskIps: true },
      'req-alb-memfail'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    const own = body.entries.find((e) => e.id === 'alb-1');
    expect(own).toBeDefined();
    expect(own!.actor).toBeNull();
  });

  test('CREATE_EVENT and DELETE_EVENT rows carry the brand', async () => {
    const created = await call('POST', '/api/v2/admin/events', asEmail(OWNER_A), {
      title: 'ALB Created Event',
      brand_id: BRAND_A,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const createRow = await tenv.DB.prepare(
      `SELECT brand_id, resource_id FROM admin_audit_log WHERE action = 'CREATE_EVENT' AND resource_id = ?`
    )
      .bind(id)
      .first<{ brand_id: string; resource_id: string }>();
    expect(createRow?.brand_id).toBe(BRAND_A);

    const deleted = await call('DELETE', `/api/v2/admin/events/${id}`, asEmail(OWNER_A));
    expect(deleted.status).toBeLessThan(400);
    const deleteRow = await tenv.DB.prepare(
      `SELECT brand_id FROM admin_audit_log WHERE action = 'DELETE_EVENT' AND resource_id = ?`
    )
      .bind(id)
      .first<{ brand_id: string | null }>();
    expect(deleteRow?.brand_id).toBe(BRAND_A);
  });

  test('CREATE_SPONSOR rows carry the brand', async () => {
    const created = await call('POST', '/api/v2/admin/sponsors', asEmail(OWNER_A), {
      name: 'ALB Created Sponsor',
      tier: 'gold',
      event_id: EVT_A,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const row = await tenv.DB.prepare(
      `SELECT brand_id FROM admin_audit_log WHERE action = 'CREATE_SPONSOR' AND resource_id = ?`
    )
      .bind(id)
      .first<{ brand_id: string | null }>();
    expect(row?.brand_id).toBe(BRAND_A);
  });
});

describe('AUD-3 B — pagination never skips rows that share a timestamp', () => {
  test('three rows at the same millisecond come back across three pages', async () => {
    for (const id of ['alb-tie-a', 'alb-tie-b', 'alb-tie-c']) {
      await seedRow(id, {
        action: 'UPDATE_EVENT',
        actor: OWNER_A,
        resource_type: 'event',
        resource_id: EVT_A,
        ip: '203.0.113.7',
        created_at: '2018-06-01T12:00:00.000Z',
      });
    }
    const seen: string[] = [];
    let cursor = '2018-06-02T00:00:00.000Z';
    for (let i = 0; i < 4; i++) {
      const res = await call(
        'GET',
        `/api/v2/admin/audit-log?scope=brand&limit=1&cursor=${encodeURIComponent(cursor)}`,
        asEmail(OWNER_A)
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListBody;
      seen.push(...body.entries.map((e) => e.id));
      if (!body.pagination.nextCursor) break;
      cursor = body.pagination.nextCursor;
    }
    expect(seen.filter((id) => id.startsWith('alb-tie-')).sort()).toEqual([
      'alb-tie-a',
      'alb-tie-b',
      'alb-tie-c',
    ]);
  });

  test('a cursor with a malformed id part is refused', async () => {
    const res = await call(
      'GET',
      `/api/v2/admin/audit-log?scope=brand&cursor=${encodeURIComponent("2018-06-02T00:00:00.000Z~x' OR 1=1")}`,
      asEmail(OWNER_A)
    );
    expect(res.status).toBe(400);
  });
});

// ── Every tier: security is never tier-gated (OSE-1444 doctrine) ─────────────

describe('AUD-3 B — identical results under every tier preset', () => {
  test('free, mid and enterprise give the same brand view', async () => {
    const seen: string[] = [];
    for (const tier of ['free', 'mid', 'enterprise']) {
      const applied = await call('POST', '/api/v2/admin/flags/apply-tier', KEY, { tier });
      expect(applied.status).toBe(200);
      const res = await call(
        'GET',
        `${BRAND_PATH}&cursor=2020-01-01T10:00:06.000Z`,
        asEmail(OWNER_A)
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListBody;
      seen.push(JSON.stringify(body.entries.map((e) => [e.id, e.actor, e.ip])));
      expect((await call('GET', BRAND_PATH, asEmail(ORGANIZER_A))).status).toBe(404);
    }
    expect(new Set(seen).size).toBe(1);
  });
});

// ── Unit: the IP masker ──────────────────────────────────────────────────────

describe('AUD-3 B — maskIp', () => {
  test.each([
    ['203.0.113.77', '203.0.113.0/24'],
    [' 10.1.2.3 ', '10.1.2.0/24'],
    ['2001:db8:85a3:0:0:8a2e:370:7334', '2001:db8:85a3::/48'],
    ['2001:DB8::1', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
    ['::ffff:192.0.2.44', '192.0.2.0/24'],
    ['::ffff:c000:0280', '192.0.2.0/24'],
    ['0:0:0:0:0:FFFF:C633:6409', '198.51.100.0/24'],
    ['256.1.1.1', null],
    ['1.2.3', null],
    ['2001:db8::1::2', null],
    ['1:2:3:4:5:6:7:8:9', null],
    ['not-an-ip', null],
    ['', null],
    [null, null],
  ])('%s → %s', (input, out) => {
    expect(maskIp(input as string | null)).toBe(out);
  });
});
