/**
 * D3 (CCR 2026-09-14) — impression/click write validation.
 *
 * The public impression/click endpoints inserted attacker-supplied
 * (event_id, sponsor_id) straight into sponsor_impressions — which feeds the
 * SharedReport proof layer — with no check that the sponsor is actually placed
 * on the event or brand-matched. A fabricated pair polluted a sponsor's numbers.
 *
 * The fix rejects any (event, sponsor) that is not a resolved, active,
 * brand-matched placement (404, no insert). These are born-red: against the
 * pre-fix handler every case below returned 201 and wrote a row.
 *
 * Workers pool (SELF.fetch + env.DB). sponsor_impressions lives in the main DB.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';

const BRAND = 'brand-d3';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
function tenv(): TestEnv {
  return env as unknown as TestEnv;
}

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

async function seedEvent(id: string, brandId: string): Promise<void> {
  await tenv().DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', datetime('now','+7 days'), datetime('now','+8 days'), datetime('now'), datetime('now'))`
    )
    .bind(id, brandId, `Event ${id}`, id)
    .run();
}

async function post(eventId: string, sponsorId: string, kind: 'impression' | 'click') {
  return SELF.fetch(`https://t.test/api/v2/events/${eventId}/sponsors/${sponsorId}/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surface: 'public', placement: 'strip' }),
  });
}

async function impressionRows(eventId: string, sponsorId: string): Promise<number> {
  const row = await tenv()
    .DB.prepare(
      'SELECT COUNT(*) AS c FROM sponsor_impressions WHERE event_id = ? AND sponsor_id = ?'
    )
    .bind(eventId, sponsorId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

beforeAll(async () => {
  await applyMigrations();
}, 120_000);

describe('D3 | impression/click write validation', () => {
  test('logs an impression for a sponsor actually placed on the event (201 + row)', async () => {
    const ev = 'evt_d3_valid';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_valid', eventId: ev, isActive: 1 });

    const res = await post(ev, 'spon_valid', 'impression');
    expect(res.status).toBe(201);
    expect(await impressionRows(ev, 'spon_valid')).toBe(1);
  });

  test('logs a click for a placed sponsor (201 + row)', async () => {
    const ev = 'evt_d3_click';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_click', eventId: ev, isActive: 1 });

    const res = await post(ev, 'spon_click', 'click');
    expect(res.status).toBe(201);
    expect(await impressionRows(ev, 'spon_click')).toBe(1);
  });

  test('rejects a sponsor with no placement on the event (404, no write)', async () => {
    const ev = 'evt_d3_ghost';
    await seedEvent(ev, BRAND);
    // spon_ghost is never seeded / never placed.
    const res = await post(ev, 'spon_ghost', 'impression');
    expect(res.status).toBe(404);
    expect(await impressionRows(ev, 'spon_ghost')).toBe(0);
  });

  test('rejects a CROSS-BRAND sponsor even if a placement row exists (404, no write)', async () => {
    const ev = 'evt_d3_xbrand';
    await seedEvent(ev, BRAND);
    // Placement attached to this event, but the business belongs to another brand.
    await seedSplitSponsor(tenv().DB, {
      id: 'spon_other_brand',
      eventId: ev,
      brandId: 'brand-OTHER',
      isActive: 1,
    });

    const res = await post(ev, 'spon_other_brand', 'impression');
    expect(res.status).toBe(404);
    expect(await impressionRows(ev, 'spon_other_brand')).toBe(0);
  });

  test('rejects an INACTIVE placement (404, no write)', async () => {
    const ev = 'evt_d3_inactive';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_inactive', eventId: ev, isActive: 0 });

    const res = await post(ev, 'spon_inactive', 'click');
    expect(res.status).toBe(404);
    expect(await impressionRows(ev, 'spon_inactive')).toBe(0);
  });
});
