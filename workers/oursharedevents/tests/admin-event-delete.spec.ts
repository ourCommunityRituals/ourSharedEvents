/**
 * OSE-982 — DELETE /api/v2/admin/events/:id round-trip (L2, live D1).
 *
 * The router had no DELETE for events — only PUT status='archived'. That left
 * two gaps this endpoint closes:
 *   1. FE fat-finger: an admin creates an event by mistake and needs it GONE.
 *   2. DB hygiene: the T4 cross-brand-isolation E2E seeds throwaway isoltest-*
 *      events every deploy and its afterEach cleanup (DELETE /admin/events/:id)
 *      was a permanent no-op because the route didn't exist, so staging
 *      accumulated orphan rows. A real route makes that cleanup work.
 *
 * These tests drive the full worker (SELF.fetch) against a migrated D1, so they
 * exercise the actual router + handler + live FK enforcement, not the handler in
 * isolation. Gates:
 *   G1 — happy path: created event hard-deletes → 200, gone from admin list + DB
 *        (proves the FK-safe cascade clears the auto-created shortlink child too)
 *   G2 — missing id: DELETE of an unknown id → 404 (honest, not silent success)
 *   G3 — activity guard: an event with a recorded scan cannot be deleted → 409,
 *        row survives (protects attendee-derived data from a fat-finger nuke)
 *
 * Auth boundary is intentionally NOT asserted here: this harness runs with the
 * OSE-681 local-dev admin bypass (WORKER_ENV unset), so a credential-less
 * request is allowed through — the same reason admin-allowlist.spec.ts only
 * asserts `not 401/403` on the internal path. The DELETE route is wired through
 * the exact same requireAdmin block as PUT and the sponsor delete, so the guard
 * is covered structurally by those suites.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose982-test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

interface CreateResponse {
  ok: boolean;
  id?: string;
  slug?: string;
}

interface DeleteResponse {
  ok: boolean;
  id?: string;
  deleted?: boolean;
  code?: string;
  error?: string;
}

interface AdminListResponse {
  ok: boolean;
  items: Array<Record<string, unknown>>;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

// Child tables that carry an event_id FK into events(id). FKs are enforced in
// this D1 harness, so a deterministic slate must clear children before events —
// the same children-first ordering the handler's cascade uses.
const EVENT_CHILD_TABLES = [
  'scan_placement_events',
  'scan_node_returns',
  'scan_aggregates',
  'scan_cell_aggregates',
  'sponsor_impressions',
  'sponsor_placement',
  'poster_deployments',
  'shortlinks',
] as const;

/** Wipe this brand's rows (children-first) for a deterministic slate. */
async function cleanSlate(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const t of EVENT_CHILD_TABLES) {
    await tenv.DB.prepare(
      `DELETE FROM ${t} WHERE event_id IN (SELECT id FROM events WHERE brand_id = ?)`
    )
      .bind(BRAND)
      .run();
  }
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
}

async function seedEvent(suffix: string): Promise<string> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify({
      title: `OSE-982 Delete Target (${suffix})`,
      brand_id: BRAND,
      slug: `ose982-${suffix}-${Date.now().toString(36)}`,
      status: 'draft',
    }),
  });
  expect(res.status, 'seed event must create (201)').toBe(201);
  const body = (await res.json()) as CreateResponse;
  expect(body.id).toMatch(/^evt_/);
  return body.id!;
}

async function eventExists(id: string): Promise<boolean> {
  const tenv = env as unknown as TestEnv;
  const row = await tenv.DB.prepare('SELECT id FROM events WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  return !!row;
}

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await cleanSlate();
});

describe('OSE-982 G1 — happy path: fat-finger event hard-deletes', () => {
  test('authenticated DELETE removes the event from the admin list and the DB', async () => {
    const id = await seedEvent('happy');
    expect(await eventExists(id)).toBe(true);

    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'DELETE',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeleteResponse;
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(true);
    expect(body.id).toBe(id);

    // Gone from the DB (hard delete — the row is removed, not just hidden)…
    expect(await eventExists(id), 'event row must be gone after hard delete').toBe(false);

    // …and gone from the admin list surface.
    const listRes = await SELF.fetch('https://t.test/api/v2/admin/events?limit=100', {
      headers: ADMIN_HEADERS,
    });
    const list = (await listRes.json()) as AdminListResponse;
    expect(list.items.some((i) => i.id === id)).toBe(false);
  });

  test('OSE-1459: an event with a derived scan_cell_aggregates row still deletes (FK child cleared)', async () => {
    // scan_cell_aggregates (0087) FKs events(id) and is permanent, so it can
    // outlive the raw scan rows that the activity guard checks. The cascade
    // must clear it, or the event row cannot be removed.
    const id = await seedEvent('cellagg');
    const tenv = env as unknown as TestEnv;
    await tenv.DB.prepare(
      `INSERT INTO scan_cell_aggregates
         (id, event_id, bucket_date, bucket_hour, h3_res9, h3_res7, scan_count)
       VALUES (?, ?, '2026-08-31', 19, '892664cdb13ffff', '872664cdbffffff', 0)`
    )
      .bind(`cell_${id}`, id)
      .run();

    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'DELETE',
      headers: ADMIN_HEADERS,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await eventExists(id)).toBe(false);
    const left = await tenv.DB.prepare(
      'SELECT COUNT(*) AS n FROM scan_cell_aggregates WHERE event_id = ?'
    )
      .bind(id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  test('a second DELETE of the same id is an honest 404 (delete is not idempotently silent)', async () => {
    const id = await seedEvent('twice');
    const first = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'DELETE',
      headers: ADMIN_HEADERS,
    });
    expect(first.status).toBe(200);

    const second = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'DELETE',
      headers: ADMIN_HEADERS,
    });
    expect(second.status).toBe(404);
    const body = (await second.json()) as DeleteResponse;
    expect(body.code).toBe('NOT_FOUND');
  });
});

describe('OSE-982 G2 — missing id: unknown event → 404', () => {
  test('DELETE of an id that never existed returns 404 NOT_FOUND', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/evt_does-not-exist', {
      method: 'DELETE',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as DeleteResponse;
    expect(body.code).toBe('NOT_FOUND');
  });
});

describe('OSE-982 G3 — activity guard: an event that has met reality cannot be nuked', () => {
  test('DELETE of an event with a recorded scan returns 409 and the row survives', async () => {
    const id = await seedEvent('scanned');

    // Record a single anonymous scan against the event (session/return side of
    // the split scan path, OSE-798). Its presence must block the hard delete.
    const tenv = env as unknown as TestEnv;
    await tenv.DB.prepare(
      'INSERT INTO scan_node_returns (id, event_id, scan_bucket) VALUES (?, ?, ?)'
    )
      .bind(`snr_${Date.now().toString(36)}`, id, '2026-08-31')
      .run();

    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'DELETE',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as DeleteResponse;
    expect(body.code).toBe('EVENT_HAS_ACTIVITY');

    // The event with real scan data must survive — archive is the path for it.
    expect(await eventExists(id), 'scanned event must NOT be hard-deleted').toBe(true);
  });
});
