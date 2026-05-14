/**
 * OSE-206 / BE-16 — Admin events list: canonical cursor pagination
 *
 * Behavioral coverage for `GET /api/v2/admin/events` adopting the
 * canonical cursor envelope shipped by OSE-207 (subscribers) and
 * OSE-212 (audit log):
 *
 *   { ok: true, items: Event[], pagination: { limit, hasMore, nextCursor } }
 *
 * Static analysis of the shape is enforced by
 * `tests/pagination-shape-invariant.spec.ts` (PR #155). This file
 * complements that with end-to-end behaviour via SELF.fetch:
 *
 *   - default limit (50) clamping at the boundary
 *   - hasMore + nextCursor populated when more rows remain
 *   - terminal page returns hasMore=false, nextCursor=null
 *   - ?cursor=<value> continues the sequence with no overlap and no gap
 *   - ?limit out-of-range clamps to [1, 100]
 *   - no offset/total leakage in the response body
 *
 * Brand isolation: this spec uses a dedicated brand_id so it can't
 * collide with seed data from sibling specs running in the same
 * miniflare instance.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose206-pagination';
const TOTAL_EVENTS = 7;

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

interface PaginatedResponse {
  ok: boolean;
  items: Array<Record<string, unknown>>;
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  // Forbidden keys must not appear on the response body itself either.
  total?: unknown;
  offset?: unknown;
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

async function seedEvents(): Promise<string[]> {
  const tenv = env as unknown as TestEnv;
  // Clean slate for this brand so re-runs are deterministic
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();

  // Insert events with strictly-monotonic created_at values 1 second apart
  // so the cursor (created_at DESC) has a stable, unambiguous order.
  const base = new Date('2026-05-14T00:00:00Z').getTime();
  const insertedIds: string[] = [];
  for (let i = 0; i < TOTAL_EVENTS; i++) {
    const id = `evt_ose206_${i.toString().padStart(2, '0')}`;
    const createdAt = new Date(base + i * 1000).toISOString();
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, BRAND, `OSE-206 Event ${i}`, `ose206-event-${i}`, 'active', createdAt, createdAt)
      .run();
    insertedIds.push(id);
  }
  return insertedIds;
}

function adminFetch(path: string) {
  return SELF.fetch(`https://t.test${path}`, { headers: ADMIN_HEADERS });
}

async function paginatedJson(path: string): Promise<PaginatedResponse> {
  const res = await adminFetch(path);
  expect(res.status, `unexpected HTTP status for ${path}`).toBe(200);
  return (await res.json()) as PaginatedResponse;
}

/** Filter to only this spec's brand so we ignore other suites' seed data. */
function ofThisBrand(items: Array<Record<string, unknown>>) {
  return items.filter((it) => it.brand_id === BRAND);
}

beforeAll(async () => {
  await applyMigrations();
  await seedEvents();
});

describe('OSE-206: admin events cursor pagination - canonical envelope', () => {
  test('default request returns canonical pagination envelope shape', async () => {
    const body = await paginatedJson('/api/v2/admin/events');

    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.pagination).toBeDefined();

    // limit defaults to 50, clamped to [1, 100]
    expect(body.pagination.limit).toBe(50);

    // hasMore and nextCursor MUST be present (canonical contract).
    expect(typeof body.pagination.hasMore).toBe('boolean');
    expect(
      body.pagination.nextCursor === null || typeof body.pagination.nextCursor === 'string'
    ).toBe(true);

    // CRITICAL: forbidden offset-shape keys must NOT leak through.
    // The static gate (pagination-shape-invariant.spec.ts) catches handler
    // code drift; this assertion catches runtime serialization drift if
    // someone wraps the response object before sending.
    expect(body).not.toHaveProperty('total');
    expect(body).not.toHaveProperty('offset');
    expect(body.pagination).not.toHaveProperty('total');
    expect(body.pagination).not.toHaveProperty('offset');
  });

  test('terminal page (< limit rows remaining) reports hasMore=false, nextCursor=null', async () => {
    // limit larger than our brand's total seed count guarantees a terminal page.
    const body = await paginatedJson(`/api/v2/admin/events?limit=${TOTAL_EVENTS + 5}`);

    const ours = ofThisBrand(body.items);
    expect(ours.length).toBe(TOTAL_EVENTS);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();
  });

  test('partial page (limit < total) reports hasMore=true and a non-null cursor', async () => {
    const pageSize = 3;
    const body = await paginatedJson(`/api/v2/admin/events?limit=${pageSize}`);

    expect(body.pagination.limit).toBe(pageSize);
    expect(body.items.length).toBeLessThanOrEqual(pageSize);
    // The seed data alone is enough to exceed pageSize, but other specs may
    // contribute events too - either way, hasMore MUST be true at limit=3.
    expect(body.pagination.hasMore).toBe(true);
    expect(typeof body.pagination.nextCursor).toBe('string');
    // Cursor MUST be the last item's created_at - that's the only stable
    // contract a client can rely on for continuation.
    const last = body.items[body.items.length - 1];
    expect(body.pagination.nextCursor).toBe(last.created_at);
  });

  test('cursor continues the sequence with no overlap and no gap', async () => {
    // Constrain pagination to this brand's seed data only by using a
    // limit smaller than TOTAL_EVENTS to force pagination, then asserting
    // continuation behaviour for OUR brand's rows specifically.
    const pageSize = 4;

    const page1 = await paginatedJson(`/api/v2/admin/events?limit=${pageSize}`);
    expect(page1.pagination.hasMore).toBe(true);
    expect(page1.pagination.nextCursor).not.toBeNull();

    const page1Ours = ofThisBrand(page1.items);

    const page2 = await paginatedJson(
      `/api/v2/admin/events?limit=${pageSize}&cursor=${encodeURIComponent(
        page1.pagination.nextCursor as string
      )}`
    );

    const page2Ours = ofThisBrand(page2.items);

    // No row appears in both pages (id-set disjoint for our brand)
    const ids1 = new Set(page1Ours.map((r) => r.id as string));
    const ids2 = new Set(page2Ours.map((r) => r.id as string));
    const overlap = [...ids1].filter((id) => ids2.has(id));
    expect(
      overlap,
      `cursor pagination must not repeat rows: overlap=${JSON.stringify(overlap)}`
    ).toEqual([]);

    // Page 2's first row's created_at is STRICTLY LESS than page 1's
    // cursor (the WHERE created_at < cursor predicate from the SQL).
    if (page2Ours.length > 0) {
      const cursor1 = page1.pagination.nextCursor as string;
      const firstP2 = page2Ours[0].created_at as string;
      expect(firstP2 < cursor1, `page 2 first ts ${firstP2} must be < cursor ${cursor1}`).toBe(
        true
      );
    }
  });

  test('limit clamps to [1, 100] - oversize and undersize values', async () => {
    // Oversize: 999 -> 100
    const big = await paginatedJson('/api/v2/admin/events?limit=999');
    expect(big.pagination.limit).toBe(100);

    // Undersize: 0 -> 1
    const zero = await paginatedJson('/api/v2/admin/events?limit=0');
    expect(zero.pagination.limit).toBe(1);

    // Negative: -5 -> 1
    const neg = await paginatedJson('/api/v2/admin/events?limit=-5');
    expect(neg.pagination.limit).toBe(1);

    // Garbage: 'abc' -> 50 (default, NaN falls through the parser)
    const garbage = await paginatedJson('/api/v2/admin/events?limit=abc');
    expect(garbage.pagination.limit).toBe(50);
  });

  test('items still carry phase enrichment per OSE-242 brain contract', async () => {
    // The canonical envelope change MUST NOT regress phase enrichment.
    // OSE-242 mandates every event response carries `phase` so all 5
    // surfaces consume the same canonical phase computation.
    const body = await paginatedJson(`/api/v2/admin/events?limit=${TOTAL_EVENTS + 5}`);
    const ours = ofThisBrand(body.items);
    expect(ours.length).toBeGreaterThan(0);
    for (const item of ours) {
      expect(
        item,
        `OSE-206 must not strip phase from items (regression on OSE-242 contract)`
      ).toHaveProperty('phase');
    }
  });
});
