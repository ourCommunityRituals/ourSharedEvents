/**
 * "Come back to my events" — the admin list's lifecycle filters + the PUT
 * status transition guard + created_by capture (migration 0075).
 *
 * The gap this closes, measured 2026-09-16: every event created through the
 * admin UI landed as a draft, the list could not be filtered by status or
 * narrowed to the caller's own rows (nothing recorded who created a row), and
 * `PUT status` bypassed the state machine that verify-qr enforces. So an
 * organizer could not find their drafts, and if they had, could not
 * legitimately move them.
 *
 * Runtime-bound (env.DB via the handler + SELF.fetch) → workers pool.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleAdminListEvents, handleCreateEvent, type EventsEnv } from '../src/handlers/events';

const BRAND = 'ose-lifecycle-list';
const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await tenv.DB.prepare(stmt).run();
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

function jwtFor(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
}

function reqAsEmail(email: string, query = ''): Request {
  return new Request(`https://x/api/v2/admin/events${query}`, {
    headers: { 'Cf-Access-Jwt-Assertion': jwtFor(email) },
  });
}

const eventsEnv = env as unknown as EventsEnv;

interface Row {
  id: string;
  status: string;
  created_by: string | null;
  is_published: number;
}
interface ListBody {
  ok: boolean;
  items: Row[];
  filters?: { status: string | null; mine: boolean };
  code?: string;
}

async function list(req: Request): Promise<ListBody> {
  const res = await handleAdminListEvents(req, eventsEnv);
  return (await res.json()) as ListBody;
}

async function seed(id: string, status: string, createdBy: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, BRAND, `Lifecycle ${id}`, `slug-${id}`, status, createdBy)
    .run();
}

const ME = 'me@lifecycle.test';
const OTHER = 'other@lifecycle.test';

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
  await seed('lc-draft-mine', 'draft', ME);
  await seed('lc-draft-other', 'draft', OTHER);
  await seed('lc-ready-mine', 'ready', ME);
  await seed('lc-active-other', 'active', OTHER);
  await seed('lc-archived-legacy', 'archived', null);
  // Both operators are members of the same brand — "mine" must be a FILTER
  // inside the brand, never a permission boundary.
  eventsEnv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ [ME]: [BRAND], [OTHER]: [BRAND] });
});

const ofBrand = (items: Row[]) => items.filter((r) => r.id.startsWith('lc-'));

describe('admin list — ?status= lifecycle filter', () => {
  test('no filter returns every state (drafts included) and echoes filters', async () => {
    const body = await list(reqAsEmail(ME));
    const ids = ofBrand(body.items)
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(
      [
        'lc-active-other',
        'lc-archived-legacy',
        'lc-draft-mine',
        'lc-draft-other',
        'lc-ready-mine',
      ].sort()
    );
    expect(body.filters).toEqual({ status: null, mine: false });
  });

  test('?status=draft returns only drafts', async () => {
    const body = await list(reqAsEmail(ME, '?status=draft'));
    const rows = ofBrand(body.items);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status === 'draft')).toBe(true);
    expect(body.filters?.status).toBe('draft');
  });

  test.each(['ready', 'active', 'archived'])('?status=%s returns only that state', async (st) => {
    const body = await list(reqAsEmail(ME, `?status=${st}`));
    const rows = ofBrand(body.items);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe(st);
  });

  test('?status=all is the same as no filter', async () => {
    const body = await list(reqAsEmail(ME, '?status=all'));
    expect(ofBrand(body.items).length).toBe(5);
  });

  test('an unknown status is refused (400), never silently ignored', async () => {
    const res = await handleAdminListEvents(reqAsEmail(ME, '?status=published'), eventsEnv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ListBody;
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_STATUS');
  });

  test('rows carry created_by and is_published so the UI can label them', async () => {
    const body = await list(reqAsEmail(ME, '?status=draft'));
    const mine = ofBrand(body.items).find((r) => r.id === 'lc-draft-mine');
    expect(mine?.created_by).toBe(ME);
    expect(mine?.is_published).toBe(1);
  });
});

describe("admin list — ?mine=1 narrows to the caller's own rows", () => {
  test('mine=1 returns only rows this actor created', async () => {
    const body = await list(reqAsEmail(ME, '?mine=1'));
    const ids = ofBrand(body.items)
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(['lc-draft-mine', 'lc-ready-mine']);
    expect(body.filters?.mine).toBe(true);
  });

  test('mine=1 composes with status', async () => {
    const body = await list(reqAsEmail(ME, '?mine=1&status=draft'));
    expect(ofBrand(body.items).map((r) => r.id)).toEqual(['lc-draft-mine']);
  });

  test('the other operator sees THEIR rows under mine=1 — a filter, not a leak', async () => {
    const body = await list(reqAsEmail(OTHER, '?mine=1'));
    const ids = ofBrand(body.items)
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(['lc-active-other', 'lc-draft-other']);
  });

  test('legacy rows with no creator are excluded by mine=1 but present without it', async () => {
    const withMine = await list(reqAsEmail(ME, '?mine=1'));
    expect(ofBrand(withMine.items).some((r) => r.id === 'lc-archived-legacy')).toBe(false);
    const without = await list(reqAsEmail(ME));
    expect(ofBrand(without.items).some((r) => r.id === 'lc-archived-legacy')).toBe(true);
  });

  test('a key actor has no personal identity: mine=1 is a no-op (echoed mine:false), not an empty list', async () => {
    const res = await SELF.fetch(`https://t.test/api/v2/admin/events?mine=1`, {
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    expect(body.filters?.mine).toBe(false);
  });
});

describe('POST create records created_by from the server-verified actor', () => {
  test('a CF Access email actor is stored on the row', async () => {
    // Handler-level, like admin-events-scope.invariant.spec.ts: the router's
    // requireAdmin verifies the JWT signature (which a test cannot mint), so
    // the actor-derivation seam is exercised directly with a decode-only token.
    const req = new Request('https://x/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': jwtFor(ME) },
      body: JSON.stringify({ title: 'Created by me', brand_id: BRAND }),
    });
    const res = await handleCreateEvent(req, eventsEnv);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = await env.DB.prepare('SELECT created_by, status FROM events WHERE id = ?')
      .bind(id)
      .first<{ created_by: string; status: string }>();
    expect(row?.created_by).toBe(ME);
    // And it is a draft — which is exactly why the list needs the filter.
    expect(row?.status).toBe('draft');
  });
});

describe('PUT status goes through the state machine', () => {
  async function put(id: string, status: string) {
    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ status }),
    });
    return {
      res,
      body: (await res.json()) as {
        ok: boolean;
        code?: string;
        from?: string;
        to?: string;
        allowed?: string[];
      },
    };
  }
  async function statusOf(id: string): Promise<string> {
    const row = await env.DB.prepare('SELECT status FROM events WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    return row?.status ?? '';
  }

  test('draft → active directly is refused (409) with the allowed edges named', async () => {
    await seed('lc-put-1', 'draft', ME);
    const { res, body } = await put('lc-put-1', 'active');
    expect(res.status).toBe(409);
    expect(body.code).toBe('INVALID_TRANSITION');
    expect(body.from).toBe('draft');
    expect(body.to).toBe('active');
    expect(body.allowed).toEqual(['ready', 'archived']);
    expect(await statusOf('lc-put-1')).toBe('draft');
  });

  test('draft → ready → active (the honest path) succeeds', async () => {
    await seed('lc-put-2', 'draft', ME);
    expect((await put('lc-put-2', 'ready')).res.status).toBe(200);
    expect(await statusOf('lc-put-2')).toBe('ready');
    expect((await put('lc-put-2', 'active')).res.status).toBe(200);
    expect(await statusOf('lc-put-2')).toBe('active');
  });

  test('draft → archived and archived → draft (the expiry round-trip) both succeed', async () => {
    await seed('lc-put-3', 'draft', ME);
    expect((await put('lc-put-3', 'archived')).res.status).toBe(200);
    expect((await put('lc-put-3', 'draft')).res.status).toBe(200);
    expect(await statusOf('lc-put-3')).toBe('draft');
  });

  test('same-state write is a no-op success, not a violation', async () => {
    await seed('lc-put-4', 'ready', ME);
    expect((await put('lc-put-4', 'ready')).res.status).toBe(200);
  });

  test('non-status fields are untouched by the guard', async () => {
    await seed('lc-put-5', 'draft', ME);
    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/lc-put-5`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(res.status).toBe(200);
  });
});
