/**
 * Admin mutation integrity — architecture review 2026-10-01.
 *
 * Four defects found by the review, each pinned here behaviourally (born-red
 * against the pre-fix code):
 *
 *   1. Audit outcome. Ten admin mutations (CREATE_EVENT, CREATE_SPONSOR,
 *      UPDATE/DELETE_SPONSOR, UPDATE_SPONSOR_EVENT_TYPES/AREAS, SET_FLAG,
 *      APPLY_TIER, SET/REMOVE_EVENT_FLAG) wrote outcome='success' to the
 *      append-only admin_audit_log whatever the handler returned, so a rejected
 *      400 read as a completed write.
 *   2. Audit correlation. VERIFY_QR / UNVERIFY_QR audited under a fresh
 *      crypto.randomUUID(), not the request id requireAdmin put on the response,
 *      so the log row could not be joined to the request.
 *   3. Atomic replace. PUT /sponsors/:id/event-types ran DELETE, then a separate
 *      INSERT batch: a failing insert left the sponsor with no associations.
 *   4. Portfolio rollup at scale. One `?` per brand event in IN (...) — past
 *      D1's 100-bound-parameter cap the query threw, the catch returned 0 and
 *      the strip silently under-reported.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { handlePortfolioRollup, type PortfolioRollupEnv } from '../src/handlers/portfolio-rollup';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;

async function applyAll(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column name') ||
        m.includes('already exists') ||
        m.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await applyAll(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
});

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

async function auditRows(action: string, requestId?: string) {
  const sql = requestId
    ? 'SELECT outcome, request_id FROM admin_audit_log WHERE action = ? AND request_id = ?'
    : 'SELECT outcome, request_id FROM admin_audit_log WHERE action = ? ORDER BY created_at DESC';
  const rs = await tenv.DB.prepare(sql)
    .bind(...(requestId ? [action, requestId] : [action]))
    .all<{ outcome: string; request_id: string }>();
  return rs.results ?? [];
}

describe('1 — a rejected admin mutation is audited as denied, never success', () => {
  test('CREATE_SPONSOR with an invalid body → 4xx and a denied audit row', async () => {
    const before = (await auditRows('CREATE_SPONSOR')).length;
    const res = await SELF.fetch('https://localhost/api/v2/admin/sponsors', {
      method: 'POST',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await tick();
    const rows = await auditRows('CREATE_SPONSOR');
    expect(rows.length).toBe(before + 1);
    expect(rows[0].outcome).toBe('denied');
  });

  test('SET_FLAG with an invalid body → 4xx and a denied audit row', async () => {
    const before = (await auditRows('SET_FLAG')).length;
    const res = await SELF.fetch('https://localhost/api/v2/admin/flags/forms.register', {
      method: 'PUT',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await tick();
    const rows = await auditRows('SET_FLAG');
    expect(rows.length).toBe(before + 1);
    expect(rows[0].outcome).toBe('denied');
  });
});

describe('2 — VERIFY_QR / UNVERIFY_QR audit under the request id the caller saw', () => {
  for (const [action, path] of [
    ['VERIFY_QR', 'verify-qr'],
    ['UNVERIFY_QR', 'unverify-qr'],
  ] as const) {
    test(`${action} denied: audit request_id === response X-Request-Id`, async () => {
      const res = await SELF.fetch(`https://localhost/api/v2/admin/events/evt-int-qr/${path}`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
      const rid = res.headers.get('X-Request-Id');
      expect(rid, 'requireAdmin labels its 401 with the request id').toBeTruthy();
      await tick();
      const rows = await auditRows(action, rid!);
      expect(rows, 'the denied audit row must carry the same request id').toHaveLength(1);
      expect(rows[0].outcome).toBe('denied');
    });
  }
});

describe('3 — replacing sponsor event types is atomic', () => {
  test('a failing replace leaves the previous associations intact', async () => {
    await tenv.DB.prepare(
      `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status)
       VALUES ('evt-int-set', 'br-int', 'Integrity', 'slug-int-set', 'active')`
    ).run();
    await seedSplitSponsor(tenv.DB, {
      id: 'sp-int-set',
      eventId: 'evt-int-set',
      name: 'Integrity Sponsor',
      tier: 'gold',
    });
    const put = (template_ids: string[]) =>
      SELF.fetch('https://localhost/api/v2/admin/sponsors/sp-int-set/event-types', {
        method: 'PUT',
        headers: { ...ADMIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_ids }),
      });

    expect((await put(['bar_night'])).status).toBe(200);

    // A duplicate id violates UNIQUE(sponsor_id, template_id) on the 2nd insert.
    const bad = await put(['bar_night', 'bar_night']);
    expect(bad.status).toBe(503);

    const rows = await tenv.DB.prepare(
      'SELECT template_id FROM sponsor_event_types WHERE sponsor_id = ?'
    )
      .bind('sp-int-set')
      .all<{ template_id: string }>();
    expect(
      (rows.results ?? []).map((r) => r.template_id),
      'the DELETE must roll back with the failed INSERT'
    ).toEqual(['bar_night']);

    await tick();
    const audit = await auditRows('UPDATE_SPONSOR_EVENT_TYPES');
    expect(audit[0].outcome, 'the failed replace is audited as denied').toBe('denied');
  });
});

describe('4 — portfolio rollup is correct past the 100-parameter cap', () => {
  test('120 brand events: registrations on an event past #100 still count', async () => {
    const brand = 'br-int-many';
    const ids = Array.from({ length: 120 }, (_, i) => `evt-many-${String(i).padStart(3, '0')}`);
    await tenv.DB.batch(
      ids.map((id) =>
        tenv.DB.prepare(
          `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status)
           VALUES (?, ?, ?, ?, 'active')`
        ).bind(id, brand, `Event ${id}`, `slug-${id}`)
      )
    );
    const last = ids[ids.length - 1];
    await tenv.FORMS_DB.batch(
      Array.from({ length: 6 }, (_, i) =>
        tenv.FORMS_DB.prepare(
          `INSERT OR IGNORE INTO form_registrations (id, event_id, registration_bucket, status)
           VALUES (?, ?, '2026-01', 'confirmed')`
        ).bind(`reg-many-${i}`, last)
      )
    );
    await seedSplitSponsor(tenv.DB, {
      id: 'sp-int-many',
      eventId: last,
      name: 'Many Sponsor',
      tier: 'gold',
    });

    const res = await handlePortfolioRollup(
      new Request(`https://x/api/v2/admin/events/portfolio-rollup?brand_id=${brand}`, {
        headers: ADMIN,
      }),
      env as unknown as PortfolioRollupEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rollup: {
        events: number;
        activeSponsors: number;
        registrations: { count: number | null; suppressed: boolean };
      };
    };
    expect(body.rollup.events).toBe(120);
    expect(body.rollup.activeSponsors).toBe(1);
    expect(body.rollup.registrations.suppressed).toBe(false);
    expect(body.rollup.registrations.count).toBe(6);
  });
});
