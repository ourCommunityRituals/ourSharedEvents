/**
 * OSE-242 — Cross-surface phase coherence (bundled gap #1 from CCR-4 audit).
 *
 * Verifies that ALL surfaces consume the canonical `computeEventPhase()`
 * via the API enrichment layer in `events.ts`. For the same event at the
 * same moment in time, every endpoint MUST return the identical phase.
 *
 * Drift between endpoints = flywheel-incomplete. This is the L2
 * verification mechanism for #2 (the canonical resolver), and it is what
 * Loop 4 of the CCR-4 audit identified as "the same gate seen from two
 * sides" — bundled with #2 in this PR rather than shipped as a separate
 * story.
 *
 * Future expansion: when each surface ships its own HTML rendering layer
 * that branches on phase (Display LIVE NOW, Public lifecycle handler,
 * SharedReport gating), this spec adds Playwright-style assertions that
 * the rendered output matches the API phase. For now we verify the API
 * layer because all surfaces consume from it.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  handleListEvents,
  handleGetEvent,
  handleAdminListEvents,
  type EventsEnv,
} from '../src/handlers/events';
import {
  computeEventPhase,
  assertSurfaceCoherence,
  type EventPhase,
} from '../src/domain/event-phase';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;
const eventsEnv = (): EventsEnv => env as unknown as EventsEnv;
const db = () => tenv().DB;

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await db().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }

  // Clean slate for this spec
  await db().prepare("DELETE FROM events WHERE brand_id = 'phase-coherence'").run();

  // Three fixture events spanning the matrix's 3 lifecycle columns. Dates
  // are chosen relative to a fixed past/future so the test is deterministic
  // regardless of when CI runs.
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneYear = 365 * oneDay;
  const yesterday = new Date(now - oneDay).toISOString();
  const tomorrow = new Date(now + oneDay).toISOString();
  const farFuture = new Date(now + oneYear).toISOString();
  const farFuturePlus = new Date(now + oneYear + oneDay).toISOString();
  const farPast = new Date(now - oneYear - oneDay).toISOString();
  const farPastPlus = new Date(now - oneYear).toISOString();

  // Event A — active, currently live (yesterday → tomorrow)
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      'evt_active_live',
      'phase-coherence',
      'Active Live Event',
      'active-live',
      'active',
      yesterday,
      tomorrow
    )
    .run();

  // Event B — active, scheduled in far future
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      'evt_active_pre',
      'phase-coherence',
      'Active Pre Event',
      'active-pre',
      'active',
      farFuture,
      farFuturePlus
    )
    .run();

  // Event C — archived, status forces post_event regardless of dates
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      'evt_archived',
      'phase-coherence',
      'Archived Event',
      'archived',
      'archived',
      farPast,
      farPastPlus
    )
    .run();

  // Event D — active but unpublished: admin-only parking state. It must never
  // appear in public listing APIs even though its lifecycle status is active.
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      'evt_active_unpublished',
      'phase-coherence',
      'Active Unpublished Event',
      'active-unpublished',
      'active',
      0,
      farFuture,
      farFuturePlus
    )
    .run();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchPublicList(): Promise<Record<string, unknown>[]> {
  const res = await handleListEvents(
    new Request('https://test/api/v2/events?brand=phase-coherence'),
    eventsEnv()
  );
  const body = (await res.json()) as { items: Record<string, unknown>[] };
  return body.items;
}

async function fetchPublicSingle(id: string): Promise<Record<string, unknown> | null> {
  const res = await handleGetEvent(
    new Request(`https://test/api/v2/events/${id}`),
    eventsEnv(),
    id
  );
  if (res.status !== 200) return null;
  const body = (await res.json()) as { item: Record<string, unknown> };
  return body.item;
}

async function fetchAdminList(): Promise<Record<string, unknown>[]> {
  // OSE-666/B1: the admin list is now brand-scoped and fail-closed. Authenticate
  // as the automation key (key:admin + ADMIN_SCOPE_ALL in the test env) so this
  // cross-surface coherence check sees the full admin view, as before.
  const res = await handleAdminListEvents(
    new Request('https://test/api/v2/admin/events', {
      headers: { Authorization: 'Bearer test-admin-key-e2e-2026' },
    }),
    eventsEnv()
  );
  const body = (await res.json()) as { items: Record<string, unknown>[] };
  return body.items.filter((e) => e.brand_id === 'phase-coherence');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OSE-242 cross-surface phase coherence (#1 bundled with #2)', () => {
  test('public list endpoint enriches every event with phase', async () => {
    const items = await fetchPublicList();
    expect(items.length).toBeGreaterThanOrEqual(2); // active_live + active_pre (archived filtered by API)
    for (const e of items) {
      expect(e.phase).toBeDefined();
      expect(['pre_event', 'event', 'post_event']).toContain(e.phase);
    }
  });

  test('public list endpoint omits unpublished events server-side', async () => {
    const items = await fetchPublicList();
    expect(items.map((e) => e.id)).not.toContain('evt_active_unpublished');
  });

  test('public single endpoint enriches the event with phase', async () => {
    const e = await fetchPublicSingle('evt_active_live');
    expect(e).not.toBeNull();
    expect(e!.phase).toBe<EventPhase>('event');
  });

  test('admin list endpoint enriches every event with phase (including archived and unpublished)', async () => {
    const items = await fetchAdminList();
    expect(items.length).toBe(4); // all fixtures visible to admin
    for (const e of items) {
      expect(e.phase).toBeDefined();
      expect(['pre_event', 'event', 'post_event']).toContain(e.phase);
    }
  });

  test('canonical phase per event matches across all 3 endpoints', async () => {
    const adminList = await fetchAdminList();
    for (const adminEvent of adminList) {
      const id = adminEvent.id as string;

      // Single-event endpoint (admin gets it via list; public via /events/:id when active)
      const singlePhase =
        adminEvent.status === 'active' ? (await fetchPublicSingle(id))?.phase : adminEvent.phase;

      // Public list (active only)
      const publicList = await fetchPublicList();
      const publicListEvent = publicList.find((e) => e.id === id);
      const publicListPhase = publicListEvent?.phase;

      const observations = [
        { surface: 'admin-list', phase: adminEvent.phase as EventPhase },
        ...(singlePhase ? [{ surface: 'single', phase: singlePhase as EventPhase }] : []),
        ...(publicListPhase
          ? [{ surface: 'public-list', phase: publicListPhase as EventPhase }]
          : []),
      ];

      const result = assertSurfaceCoherence(observations);
      expect(result.ok, `Phase divergence for event ${id}: ${JSON.stringify(observations)}`).toBe(
        true
      );
    }
  });

  test('phase matches direct computeEventPhase() call (canonical resolver invariant)', async () => {
    const adminList = await fetchAdminList();
    for (const e of adminList) {
      const expected = computeEventPhase({
        status: e.status as string,
        start_date: e.start_date as string | null,
        end_date: e.end_date as string | null,
      });
      expect(e.phase, `Event ${e.id} phase mismatch with canonical resolver`).toBe(expected);
    }
  });

  test('archived event resolves to post_event regardless of dates (status forces)', async () => {
    const adminList = await fetchAdminList();
    const archived = adminList.find((e) => e.id === 'evt_archived');
    expect(archived).toBeDefined();
    expect(archived!.phase).toBe<EventPhase>('post_event');
  });

  test('active event scheduled far in the future resolves to pre_event (time decides)', async () => {
    const adminList = await fetchAdminList();
    const future = adminList.find((e) => e.id === 'evt_active_pre');
    expect(future).toBeDefined();
    expect(future!.phase).toBe<EventPhase>('pre_event');
  });

  test('active event currently in window resolves to event (time decides)', async () => {
    const adminList = await fetchAdminList();
    const live = adminList.find((e) => e.id === 'evt_active_live');
    expect(live).toBeDefined();
    expect(live!.phase).toBe<EventPhase>('event');
  });
});

describe('OSE-242 phase wiring is the matrix injection point', () => {
  test('all 3 events have phase resolved via the same canonical helper (no surface drift)', async () => {
    const adminList = await fetchAdminList();
    const phasesById = new Map<string, EventPhase>();
    for (const e of adminList) {
      phasesById.set(e.id as string, e.phase as EventPhase);
    }

    // Cross-check via single-event endpoint for active events
    for (const id of ['evt_active_live', 'evt_active_pre']) {
      const single = await fetchPublicSingle(id);
      if (single) {
        expect(single.phase).toBe(phasesById.get(id));
      }
    }
  });
});
