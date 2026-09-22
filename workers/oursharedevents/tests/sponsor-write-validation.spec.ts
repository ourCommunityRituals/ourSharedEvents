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
import { IMPRESSION_WRITE_MAX } from '../src/lib/invalid-traffic';

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

/**
 * A beacon as a real surface sends it.
 *
 * OSE-1310: the IVT filter refuses clients that send no User-Agent, because a
 * browser rendering a sponsor card always sends one. `SELF.fetch` sends none by
 * default, so a test that omits it is exercising the bot path, not the write
 * path. Sending a browser UA — and a distinct CF-Connecting-IP per caller, so
 * each test gets its own dedup/cadence bucket — is what makes these tests
 * faithful to the surface they stand for.
 */
const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let callerSeq = 0;

async function post(
  eventId: string,
  sponsorId: string,
  kind: 'impression' | 'click',
  init: { ua?: string; ip?: string; placement?: string } = {}
) {
  const ip = init.ip ?? `203.0.113.${(callerSeq++ % 250) + 1}`;
  return SELF.fetch(`https://t.test/api/v2/events/${eventId}/sponsors/${sponsorId}/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': init.ua ?? BROWSER_UA,
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ surface: 'public', placement: init.placement ?? 'strip' }),
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

// ─── OSE-1310 — invalid-traffic filtration ───────────────────────────────────
//
// D3 proved the (event, sponsor) PAIR is real. These prove the SEEING is real.
// Born-red: against the pre-OSE-1310 handler every case below returned 201 and
// wrote a row into the proof layer.

describe('OSE-1310 | invalid-traffic filtration on the proof layer', () => {
  test('a declared bot UA is accepted but NOT counted (202, no row)', async () => {
    const ev = 'evt_ivt_bot';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_ivt_bot', eventId: ev, isActive: 1 });

    const res = await post(ev, 'spon_ivt_bot', 'impression', {
      ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ counted: false });
    expect(await impressionRows(ev, 'spon_ivt_bot')).toBe(0);
  });

  test('a client sending NO User-Agent is not counted (202, no row)', async () => {
    const ev = 'evt_ivt_noua';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_ivt_noua', eventId: ev, isActive: 1 });

    // A browser always sends a UA; a scripted client that sends none is not a view.
    const res = await post(ev, 'spon_ivt_noua', 'impression', { ua: '' });
    expect(res.status).toBe(202);
    expect(await impressionRows(ev, 'spon_ivt_noua')).toBe(0);
  });

  test('the filter never leaks WHICH rule tripped', async () => {
    const ev = 'evt_ivt_opaque';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_ivt_opaque', eventId: ev, isActive: 1 });

    const res = await post(ev, 'spon_ivt_opaque', 'impression', { ua: 'curl/8.4.0' });
    const body = JSON.stringify(await res.json());
    // A reason code would tell a flooder how to tune around the filter.
    for (const reason of ['bot', 'duplicate', 'flood', 'reason']) {
      expect(body).not.toContain(reason);
    }
  });

  test('replaying the SAME beacon from the same caller counts exactly once', async () => {
    const ev = 'evt_ivt_dedup';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_ivt_dedup', eventId: ev, isActive: 1 });

    const ip = '203.0.113.201';
    const first = await post(ev, 'spon_ivt_dedup', 'impression', { ip });
    expect(first.status).toBe(201);

    // The replay attack: same pair, same surface, same caller, in a tight loop.
    for (let i = 0; i < 5; i++) {
      const replay = await post(ev, 'spon_ivt_dedup', 'impression', { ip });
      expect(replay.status).toBe(202);
    }

    expect(await impressionRows(ev, 'spon_ivt_dedup')).toBe(1);
  });

  test('a click is NOT swallowed as a duplicate of its own impression', async () => {
    const ev = 'evt_ivt_kind';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_ivt_kind', eventId: ev, isActive: 1 });

    const ip = '203.0.113.202';
    expect((await post(ev, 'spon_ivt_kind', 'impression', { ip })).status).toBe(201);
    // Same caller, same card, immediately after — a real and distinct signal.
    expect((await post(ev, 'spon_ivt_kind', 'click', { ip })).status).toBe(201);

    expect(await impressionRows(ev, 'spon_ivt_kind')).toBe(2);
  });

  test('a different caller seeing the same card IS counted', async () => {
    const ev = 'evt_ivt_distinct';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_ivt_distinct', eventId: ev, isActive: 1 });

    // Dedup must not collapse genuinely distinct people into one impression.
    expect(
      (await post(ev, 'spon_ivt_distinct', 'impression', { ip: '203.0.113.211' })).status
    ).toBe(201);
    expect(
      (await post(ev, 'spon_ivt_distinct', 'impression', { ip: '203.0.113.212' })).status
    ).toBe(201);

    expect(await impressionRows(ev, 'spon_ivt_distinct')).toBe(2);
  });

  test('a flood from one caller is capped well below the read allowance', async () => {
    const ev = 'evt_ivt_flood';
    await seedEvent(ev, BRAND);
    await seedSplitSponsor(tenv().DB, { id: 'spon_ivt_flood', eventId: ev, isActive: 1 });

    const ip = '203.0.113.220';
    // Vary `placement` so dedup never fires — this isolates the cadence ceiling.
    // Pre-OSE-1310 all 60 were written; the read-sized 120/min limit never bit.
    for (let i = 0; i < 60; i++) {
      await post(ev, 'spon_ivt_flood', 'impression', { ip, placement: `slot-${i}` });
    }

    const written = await impressionRows(ev, 'spon_ivt_flood');
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThanOrEqual(IMPRESSION_WRITE_MAX + 1);
    expect(written).toBeLessThan(60);
  });
});
