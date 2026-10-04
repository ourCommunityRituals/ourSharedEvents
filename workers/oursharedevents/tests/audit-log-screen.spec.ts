/**
 * Logs screen (the read side of the admin audit log): who a row belongs to, and
 * the filters the screen sends.
 *
 * The Logs screen reuses `GET /api/v2/admin/audit-log?scope=brand` and adds three
 * things to it, none of which may widen what a reader sees:
 *
 *   - every entry carries `source`: person | sponsor | system | key | unknown.
 *     It is derived from the actor BEFORE masking, so it never reveals which
 *     person; a masked other-tenant operator is still just "person".
 *   - `?source=` narrows by that tag (System jobs tab = `source=system`).
 *   - `?since=` (a day or a full instant) and `?brand=` narrow further. `brand`
 *     can only intersect the caller's own brands: asking for a brand you do not
 *     own is the empty page, never that brand's rows.
 *
 * The brand response also lists `brands`: the caller's own, so the screen can
 * offer a brand filter without a second endpoint.
 *
 * @born-red logs-screen | method: ran against the unchanged handler: no `source`
 * on entries, `source`/`since`/`brand` ignored (so a `brand=` of someone else's
 * was ignored rather than refused), no `brands` list | date: 2026-10-04
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { logAdminAction } from '../src/lib/audit-log';

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

const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };

async function call(path: string, headers: Record<string, string>): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, { method: 'GET', headers }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

interface Entry {
  id: string;
  action: string;
  actor: string | null;
  source: string;
  brand_id: string | null;
  ip: string | null;
}
interface ListBody {
  ok: boolean;
  scope?: string;
  brands?: string[] | null;
  entries: Entry[];
  code?: string;
  pagination: { hasMore: boolean; nextCursor: string | null };
}

const BRAND_A = 'als-a';
const BRAND_B = 'als-b';
const OWNER_A = 'als-owner-a@example.com';
const OWNER_B = 'als-owner-b@example.com';
const EVT_A = 'evt-als-A';
const EVT_B = 'evt-als-B';

async function seedRow(
  id: string,
  f: {
    action: string;
    actor: string | null;
    resource_type: string;
    resource_id: string | null;
    created_at: string;
    outcome?: 'success' | 'denied';
    ip?: string;
  }
): Promise<void> {
  await logAdminAction(tenv, {
    action: f.action,
    actor: f.actor,
    resource_type: f.resource_type,
    resource_id: f.resource_id ?? undefined,
    request_id: `req-${id}`,
    outcome: f.outcome ?? 'success',
    ip: f.ip,
  });
  await tenv.DB.prepare(`UPDATE admin_audit_log SET id = ?, created_at = ? WHERE request_id = ?`)
    .bind(id, f.created_at, `req-${id}`)
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
      .bind(id, brand, `ALS ${id}`, id.toLowerCase())
      .run();
  }
  for (const [email, brand] of [
    [OWNER_A, BRAND_A],
    [OWNER_B, BRAND_B],
  ]) {
    await tenv.DB.prepare(
      `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
    )
      .bind(email, brand)
      .run();
  }

  await seedRow('als-1', {
    action: 'UPDATE_EVENT',
    actor: OWNER_A,
    resource_type: 'event',
    resource_id: EVT_A,
    created_at: '2020-02-01T10:00:09.000Z',
    ip: '203.0.113.77',
  });
  await seedRow('als-2', {
    action: 'DRAFT_EXPIRED',
    actor: 'system:lifecycle',
    resource_type: 'event',
    resource_id: EVT_A,
    created_at: '2020-02-01T10:00:08.000Z',
  });
  await seedRow('als-3', {
    action: 'DRAFT_EXPIRED',
    actor: 'system:lifecycle',
    resource_type: 'event',
    resource_id: EVT_B,
    created_at: '2020-02-01T10:00:07.000Z',
  });
  // A platform-wide job: no target, so no brand. Never in a brand view.
  await seedRow('als-4', {
    action: 'SUBSCRIBERS_RETENTION',
    actor: 'system:lifecycle',
    resource_type: 'subscribers',
    resource_id: null,
    created_at: '2020-02-01T10:00:06.000Z',
  });
  await seedRow('als-5', {
    action: 'SPONSOR_REQUEST',
    actor: 'sponsor:sb-als-x',
    resource_type: 'event',
    resource_id: EVT_A,
    created_at: '2020-02-01T10:00:05.000Z',
  });
  await seedRow('als-6', {
    action: 'UPDATE_EVENT',
    actor: 'key:admin',
    resource_type: 'event',
    resource_id: EVT_A,
    created_at: '2020-02-01T10:00:04.000Z',
  });
  await seedRow('als-7', {
    action: 'UPDATE_EVENT',
    actor: OWNER_B,
    resource_type: 'event',
    resource_id: EVT_A,
    created_at: '2020-02-01T10:00:03.000Z',
  });
  await seedRow('als-8', {
    action: 'UPDATE_EVENT',
    actor: null,
    resource_type: 'event',
    resource_id: EVT_A,
    created_at: '2020-02-01T10:00:02.000Z',
    outcome: 'denied',
  });
  await seedRow('als-9', {
    action: 'UPDATE_EVENT',
    actor: OWNER_B,
    resource_type: 'event',
    resource_id: EVT_B,
    created_at: '2020-02-01T10:00:01.000Z',
  });
});

const ids = (b: ListBody) => b.entries.map((e) => e.id);

describe('Logs screen: every entry says whose action it was, by kind and never by name', () => {
  test('brand view: person, system, sponsor, key and unknown are tagged', async () => {
    const res = await call('/api/v2/admin/audit-log?scope=brand&limit=100', asEmail(OWNER_A));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    const src = Object.fromEntries(body.entries.map((e) => [e.id, e.source]));
    expect(src['als-1']).toBe('person');
    expect(src['als-2']).toBe('system');
    expect(src['als-5']).toBe('sponsor');
    expect(src['als-6']).toBe('key');
    expect(src['als-8']).toBe('unknown');
  });

  test("another brand's operator is tagged person and still shown as nobody", async () => {
    const res = await call('/api/v2/admin/audit-log?scope=brand&limit=100', asEmail(OWNER_A));
    const body = (await res.json()) as ListBody;
    const row = body.entries.find((e) => e.id === 'als-7')!;
    expect(row.source).toBe('person');
    expect(row.actor).toBeNull();
    expect(JSON.stringify(body)).not.toContain(OWNER_B);
  });

  test('platform view tags rows too', async () => {
    const res = await call('/api/v2/admin/audit-log?limit=100', KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    const src = Object.fromEntries(body.entries.map((e) => [e.id, e.source]));
    expect(src['als-4']).toBe('system');
    expect(src['als-1']).toBe('person');
  });
});

describe('Logs screen: ?source= narrows, and never widens', () => {
  test('System jobs for a brand owner: only the brand’s own system rows', async () => {
    const res = await call(
      '/api/v2/admin/audit-log?scope=brand&source=system&limit=100',
      asEmail(OWNER_A)
    );
    const body = (await res.json()) as ListBody;
    expect(ids(body)).toEqual(['als-2']);
  });

  test('a platform-wide job (no brand) never reaches a brand view, even filtered to system', async () => {
    for (const who of [OWNER_A, OWNER_B]) {
      const res = await call(
        '/api/v2/admin/audit-log?scope=brand&source=system&limit=100',
        asEmail(who)
      );
      const body = (await res.json()) as ListBody;
      expect(ids(body)).not.toContain('als-4');
    }
  });

  test('the platform view shows the platform-wide job under source=system', async () => {
    const res = await call('/api/v2/admin/audit-log?source=system&limit=100', KEY);
    const body = (await res.json()) as ListBody;
    expect(ids(body)).toEqual(expect.arrayContaining(['als-2', 'als-3', 'als-4']));
    expect(body.entries.every((e) => e.source === 'system')).toBe(true);
  });

  test('each kind filters to just that kind', async () => {
    for (const [kind, expected] of [
      ['person', ['als-1', 'als-7']],
      ['sponsor', ['als-5']],
      ['key', ['als-6']],
      ['unknown', ['als-8']],
    ] as const) {
      const res = await call(
        `/api/v2/admin/audit-log?scope=brand&source=${kind}&limit=100`,
        asEmail(OWNER_A)
      );
      const body = (await res.json()) as ListBody;
      expect(ids(body).sort(), kind).toEqual([...expected].sort());
    }
  });

  test('an unknown source is a 400, before any SQL', async () => {
    const res = await call('/api/v2/admin/audit-log?scope=brand&source=admin', asEmail(OWNER_A));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ListBody).code).toBe('INVALID_FILTER');
  });

  test('Security tab: outcome=denied returns the refusals of this brand only', async () => {
    const res = await call(
      '/api/v2/admin/audit-log?scope=brand&outcome=denied&limit=100',
      asEmail(OWNER_A)
    );
    const body = (await res.json()) as ListBody;
    expect(ids(body)).toEqual(['als-8']);
    const other = await call(
      '/api/v2/admin/audit-log?scope=brand&outcome=denied&limit=100',
      asEmail(OWNER_B)
    );
    expect(ids((await other.json()) as ListBody)).toEqual([]);
  });
});

describe('Logs screen: ?since= and ?brand=', () => {
  test('since keeps rows at or after the instant', async () => {
    const res = await call(
      '/api/v2/admin/audit-log?scope=brand&since=2020-02-01T10:00:06.000Z&limit=100',
      asEmail(OWNER_A)
    );
    const body = (await res.json()) as ListBody;
    expect(ids(body)).toEqual(['als-1', 'als-2']);
  });

  test('since accepts a plain day, and a day after the rows leaves none', async () => {
    const same = await call(
      '/api/v2/admin/audit-log?scope=brand&since=2020-02-01&limit=100',
      asEmail(OWNER_A)
    );
    expect(ids((await same.json()) as ListBody).length).toBeGreaterThan(0);
    const later = await call(
      '/api/v2/admin/audit-log?scope=brand&since=2020-02-02&limit=100',
      asEmail(OWNER_A)
    );
    expect(ids((await later.json()) as ListBody)).toEqual([]);
  });

  test('a malformed since is a 400', async () => {
    for (const bad of ['yesterday', '2020-13-40', "2020-01-01';--"]) {
      const res = await call(
        `/api/v2/admin/audit-log?scope=brand&since=${encodeURIComponent(bad)}`,
        asEmail(OWNER_A)
      );
      expect(res.status, bad).toBe(400);
      expect(((await res.json()) as ListBody).code).toBe('INVALID_FILTER');
    }
  });

  test("brand=<a brand you do not own> is the empty page, never that brand's rows", async () => {
    const res = await call(
      `/api/v2/admin/audit-log?scope=brand&brand=${BRAND_B}&limit=100`,
      asEmail(OWNER_A)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    expect(body.entries).toEqual([]);
    expect(body.pagination.hasMore).toBe(false);
    expect(JSON.stringify(body)).not.toContain(EVT_B);
  });

  test('brand=<your own> returns your rows', async () => {
    const res = await call(
      `/api/v2/admin/audit-log?scope=brand&brand=${BRAND_A}&limit=100`,
      asEmail(OWNER_A)
    );
    const body = (await res.json()) as ListBody;
    expect(ids(body)).toContain('als-1');
    expect(body.entries.every((e) => e.brand_id === BRAND_A)).toBe(true);
  });

  test('a key actor can ask for any one brand', async () => {
    const res = await call(`/api/v2/admin/audit-log?scope=brand&brand=${BRAND_B}&limit=100`, KEY);
    const body = (await res.json()) as ListBody;
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.brand_id === BRAND_B)).toBe(true);
  });

  test('a malformed brand is a 400', async () => {
    const res = await call(
      `/api/v2/admin/audit-log?scope=brand&brand=${encodeURIComponent("a' OR 1=1")}`,
      asEmail(OWNER_A)
    );
    expect(res.status).toBe(400);
  });

  test('the brand view lists only the caller’s own brands, so the screen can filter by them', async () => {
    const res = await call('/api/v2/admin/audit-log?scope=brand&limit=1', asEmail(OWNER_A));
    const body = (await res.json()) as ListBody;
    expect(body.brands).toEqual([BRAND_A]);
    expect(JSON.stringify(body)).not.toContain(BRAND_B);
  });

  test('an all-brands key actor gets brands: null (no list to enumerate)', async () => {
    const res = await call('/api/v2/admin/audit-log?scope=brand&limit=1', KEY);
    const body = (await res.json()) as ListBody;
    expect(body.brands).toBeNull();
  });
});
