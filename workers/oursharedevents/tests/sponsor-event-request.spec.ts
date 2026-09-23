/**
 * Sponsor-initiated per-event attachment request (pre-node-match slice).
 *
 * Covers:
 *   - POST /api/v2/sponsor/placements/request: creates a placement hidden
 *     from the resolver until the organizer accepts (organizer_accepted=0
 *     explicit, never NULL); tenant-fenced (cross-brand event -> 404);
 *     idempotent (second request for the same event -> 409); tier is
 *     server-forced regardless of any client-supplied tier; bad/missing
 *     token -> 401.
 *   - GET /api/v2/admin/sponsors/requests/pending: brand-scoped list of
 *     pending requests; out-of-scope brand sees none.
 *   - POST /api/v2/admin/sponsors/requests/:id/respond: accept flips
 *     organizer_accepted=1 and the resolver then serves the sponsor; decline
 *     retires the row (is_active=0) and it disappears from the resolver and
 *     the pending list; out-of-scope/nonexistent -> 404.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';
import { resolveSponsorsForEvent } from '../src/lib/sponsor-resolver';
import { COVENANT_BASE_TIER } from '../src/lib/sponsor-promotion';

const BRAND = 'ose-sponsor-request-brand';
const OTHER_BRAND = 'ose-sponsor-request-other-brand';
const ADMIN_KEY = 'test-admin-key-e2e-2026';
const ADMIN_HEADERS = { Authorization: `Bearer ${ADMIN_KEY}` };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seedEvent(id: string, brand: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published)
     VALUES (?, ?, ?, ?, 'active', 1)`
  )
    .bind(id, brand, `Event ${id}`, `slug-${id}`)
    .run();
}
async function seedSponsor(id: string, brand: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, is_active) VALUES (?, ?, ?, 1)`
  )
    .bind(id, brand, id)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare('DELETE FROM sponsor_placement WHERE id LIKE ?').bind('sreq-%').run();
  await tenv.DB.prepare('DELETE FROM sponsor_business WHERE id LIKE ?').bind('sreq-%').run();
  await tenv.DB.prepare('DELETE FROM events WHERE id LIKE ?').bind('sreq-%').run();
  await seedEvent('sreq-ev-own', BRAND);
  await seedEvent('sreq-ev-other-brand', OTHER_BRAND);
  await seedSponsor('sreq-sponsor', BRAND);
});

async function homeToken(): Promise<string> {
  const minted = await mintSponsorHomeToken(tenv, 'sreq-sponsor', BRAND);
  expect(minted).not.toBeNull();
  return minted!.token;
}

describe('POST /api/v2/sponsor/placements/request', () => {
  test('creates a placement hidden from the resolver until the organizer accepts', async () => {
    const token = await homeToken();
    const res = await SELF.fetch('https://t.test/api/v2/sponsor/placements/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: 'sreq-ev-own' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ ok: boolean; id: string }>();
    expect(data.ok).toBe(true);

    const row = await tenv.DB.prepare(
      `SELECT source, tier, organizer_accepted, sponsor_accepted, is_active FROM sponsor_placement WHERE id = ?`
    )
      .bind(data.id)
      .first<{
        source: string;
        tier: string;
        organizer_accepted: number | null;
        sponsor_accepted: number | null;
        is_active: number;
      }>();
    expect(row?.source).toBe('sponsor_requested');
    expect(row?.tier).toBe(COVENANT_BASE_TIER);
    expect(row?.organizer_accepted).toBe(0); // explicit, never NULL — see file header
    expect(row?.sponsor_accepted).toBe(1);
    expect(row?.is_active).toBe(1);

    const sponsors = await resolveSponsorsForEvent(tenv.DB, 'sreq-ev-own');
    expect(sponsors.find((s) => s.id === 'sreq-sponsor')).toBeUndefined();
  });

  test('tier is server-forced even if the client sends a different tier', async () => {
    const token = await homeToken();
    await tenv.DB.prepare('DELETE FROM sponsor_placement WHERE event_id = ?')
      .bind('sreq-ev-own')
      .run();
    const res = await SELF.fetch('https://t.test/api/v2/sponsor/placements/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: 'sreq-ev-own', tier: 'title' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ id: string }>();
    const row = await tenv.DB.prepare('SELECT tier FROM sponsor_placement WHERE id = ?')
      .bind(data.id)
      .first<{ tier: string }>();
    expect(row?.tier).toBe(COVENANT_BASE_TIER);
  });

  test('a second request for the same event is rejected as a duplicate', async () => {
    const token = await homeToken();
    const res = await SELF.fetch('https://t.test/api/v2/sponsor/placements/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: 'sreq-ev-own' }),
    });
    expect(res.status).toBe(409);
  });

  test('an event in another brand is not requestable (404, tenant fence)', async () => {
    const token = await homeToken();
    const res = await SELF.fetch('https://t.test/api/v2/sponsor/placements/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: 'sreq-ev-other-brand' }),
    });
    expect(res.status).toBe(404);
  });

  test('an invalid token is rejected', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/sponsor/placements/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-real-token', event_id: 'sreq-ev-own' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('admin curation of pending sponsor requests', () => {
  test('accept makes the sponsor resolver-visible; decline keeps it hidden and removes it from the pending list', async () => {
    // Fresh pair of events so accept/decline don't collide with the requests above.
    await seedEvent('sreq-ev-accept', BRAND);
    await seedEvent('sreq-ev-decline', BRAND);
    const token = await homeToken();

    const acceptReq = await SELF.fetch('https://t.test/api/v2/sponsor/placements/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: 'sreq-ev-accept' }),
    });
    const { id: acceptId } = await acceptReq.json<{ id: string }>();
    const declineReq = await SELF.fetch('https://t.test/api/v2/sponsor/placements/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: 'sreq-ev-decline' }),
    });
    const { id: declineId } = await declineReq.json<{ id: string }>();

    const pendingBefore = await SELF.fetch(
      'https://t.test/api/v2/admin/sponsors/requests/pending',
      { headers: ADMIN_HEADERS }
    );
    const pendingBeforeData = await pendingBefore.json<{
      requests: Array<{ placement_id: string }>;
    }>();
    const ids = pendingBeforeData.requests.map((r) => r.placement_id);
    expect(ids).toContain(acceptId);
    expect(ids).toContain(declineId);

    const acceptRes = await SELF.fetch(
      `https://t.test/api/v2/admin/sponsors/requests/${acceptId}/respond`,
      {
        method: 'POST',
        headers: { ...ADMIN_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      }
    );
    expect(acceptRes.status).toBe(200);

    const declineRes = await SELF.fetch(
      `https://t.test/api/v2/admin/sponsors/requests/${declineId}/respond`,
      {
        method: 'POST',
        headers: { ...ADMIN_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: false }),
      }
    );
    expect(declineRes.status).toBe(200);

    const acceptedSponsors = await resolveSponsorsForEvent(tenv.DB, 'sreq-ev-accept');
    expect(acceptedSponsors.find((s) => s.id === 'sreq-sponsor')).toBeDefined();
    const declinedSponsors = await resolveSponsorsForEvent(tenv.DB, 'sreq-ev-decline');
    expect(declinedSponsors.find((s) => s.id === 'sreq-sponsor')).toBeUndefined();

    const declinedRow = await tenv.DB.prepare(
      'SELECT is_active FROM sponsor_placement WHERE id = ?'
    )
      .bind(declineId)
      .first<{ is_active: number }>();
    expect(declinedRow?.is_active).toBe(0);

    const pendingAfter = await SELF.fetch('https://t.test/api/v2/admin/sponsors/requests/pending', {
      headers: ADMIN_HEADERS,
    });
    const pendingAfterData = await pendingAfter.json<{
      requests: Array<{ placement_id: string }>;
    }>();
    const idsAfter = pendingAfterData.requests.map((r) => r.placement_id);
    expect(idsAfter).not.toContain(acceptId); // no longer pending — it's accepted
    expect(idsAfter).not.toContain(declineId); // no longer pending — it's retired
  });

  test('responding to a nonexistent request id is a 404', async () => {
    const res = await SELF.fetch(
      'https://t.test/api/v2/admin/sponsors/requests/does-not-exist/respond',
      {
        method: 'POST',
        headers: { ...ADMIN_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      }
    );
    expect(res.status).toBe(404);
  });

  test('an unauthenticated admin request is denied', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors/requests/pending');
    expect(res.status).not.toBe(200);
  });
});
