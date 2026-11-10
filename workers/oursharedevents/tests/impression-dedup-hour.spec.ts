/**
 * Part of OSE-1421 — sponsor impression writes are deduplicated for an hour.
 *
 * `sponsor_displays` is the proof layer: its rows feed `sponsor_displays[]`
 * and the campaign / class rollups in the SharedReport. The CCR finding (D7,
 * write-side) was that an unauthenticated public POST could write rows without
 * dedup. Since the CCR, OSE-1310 added the beacon token, the bot filter, a
 * cadence ceiling and a replay dedup in `lib/invalid-traffic.ts`. What was still
 * short of the ticket: the replay memory lasted FIVE MINUTES, so one caller could
 * add a row for the same sponsor, surface and placement every five minutes
 * (12 an hour) instead of once an hour.
 *
 * The dedup stays where it is, a peppered-hash KV key with a TTL: the table has
 * no person-shaped column and must not get one (`red-team/impression-privacy`),
 * so a UNIQUE index over caller + hour cannot live in D1. No migration.
 *
 * Time cannot be advanced inside miniflare KV, so the window is asserted on the
 * stored expiry of the dedup key, together with the behaviour (two identical
 * POSTs, one row).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { IMPRESSION_DEDUP_TTL_SECONDS } from '../src/lib/invalid-traffic';
import { mintBeaconToken } from '../src/lib/beacon-token';

const BRAND = 'brand-dedup-hour';
const HOUR_SECONDS = 3600;

interface TestEnv {
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Keys that would make a row or payload person-shaped.
const BANNED_KEY =
  /^(anon_id_hash|anonymous_id|anon_id|ip|ip_hash|user_agent|user_agent_hash|ua|session|session_id|device|device_id|fingerprint|email|phone|lat|lon|latitude|longitude)$/i;

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
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

async function seedEvent(id: string): Promise<void> {
  await tenv().DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv()
    .DB.prepare(
      // OSE-1900: the event chose to have sponsors, so a beacon for its sponsor counts.
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', datetime('now','+7 days'), datetime('now','+8 days'), '{"useSponsors":true}', datetime('now'), datetime('now'))`
    )
    .bind(id, BRAND, `Event ${id}`, id)
    .run();
}

async function post(
  eventId: string,
  sponsorId: string,
  kind: 'impression' | 'click',
  ip: string,
  surface = 'public'
) {
  const beaconToken = await mintBeaconToken(tenv(), eventId, sponsorId);
  return SELF.fetch(`https://t.test/api/v2/events/${eventId}/sponsors/${sponsorId}/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': BROWSER_UA,
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ surface, placement: 'strip', beacon_token: beaconToken }),
  });
}

async function rows(eventId: string, sponsorId: string): Promise<number> {
  const r = await tenv()
    .DB.prepare('SELECT COUNT(*) AS c FROM sponsor_displays WHERE event_id = ? AND sponsor_id = ?')
    .bind(eventId, sponsorId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

/** Dedup keys now in KV, with the seconds left on each (storage is shared across tests). */
async function dedupKeys(): Promise<Map<string, number>> {
  const listed = await tenv().RATE_LIMIT_KV.list({ prefix: 'ivt:dedup:' });
  const now = Math.floor(Date.now() / 1000);
  return new Map(listed.keys.map((k) => [k.name, (k.expiration ?? 0) - now]));
}

/** Run `act` and return the dedup keys it created: name -> seconds until expiry. */
async function newDedupKeys(act: () => Promise<unknown>): Promise<Map<string, number>> {
  const before = new Set((await dedupKeys()).keys());
  await act();
  return new Map([...(await dedupKeys())].filter(([name]) => !before.has(name)));
}

beforeAll(async () => {
  await applyMigrations();
}, 120_000);

describe('an identical impression beacon from one caller counts once an hour', () => {
  test('the window constant is one hour', () => {
    expect(IMPRESSION_DEDUP_TTL_SECONDS).toBe(HOUR_SECONDS);
  });

  test('two identical POSTs yield one row, and the memory of the first outlives five minutes', async () => {
    const ev = 'evt_dedup_hour_a';
    await seedEvent(ev);
    await seedSplitSponsor(tenv().DB, { id: 'spon_dedup_hour_a', eventId: ev, isActive: 1 });
    const ip = '203.0.113.31';

    let first!: Response;
    const created = await newDedupKeys(async () => {
      first = await post(ev, 'spon_dedup_hour_a', 'impression', ip);
    });
    expect(first.status).toBe(201);
    const replay = await post(ev, 'spon_dedup_hour_a', 'impression', ip);
    expect(replay.status).toBe(202);
    expect(await rows(ev, 'spon_dedup_hour_a')).toBe(1);

    // The dedup key must live out the hour, not five minutes: this is what makes
    // a post five minutes later (or 59) still the same impression.
    const ttls = [...created.values()];
    expect(ttls).toHaveLength(1);
    expect(ttls[0], 'dedup key expires within the hour').toBeLessThanOrEqual(HOUR_SECONDS);
    expect(ttls[0], 'dedup key outlives five minutes').toBeGreaterThan(HOUR_SECONDS - 120);
  });

  test('a different caller, and the same caller on another surface, are still counted', async () => {
    const ev = 'evt_dedup_hour_b';
    await seedEvent(ev);
    await seedSplitSponsor(tenv().DB, { id: 'spon_dedup_hour_b', eventId: ev, isActive: 1 });

    expect((await post(ev, 'spon_dedup_hour_b', 'impression', '203.0.113.41')).status).toBe(201);
    expect((await post(ev, 'spon_dedup_hour_b', 'impression', '203.0.113.42')).status).toBe(201);
    expect(
      (await post(ev, 'spon_dedup_hour_b', 'impression', '203.0.113.41', 'display')).status
    ).toBe(201);
    expect(await rows(ev, 'spon_dedup_hour_b')).toBe(3);
  });

  test('a click keeps its own, shorter window: the hour applies to impressions only', async () => {
    const ev = 'evt_dedup_hour_c';
    await seedEvent(ev);
    await seedSplitSponsor(tenv().DB, { id: 'spon_dedup_hour_c', eventId: ev, isActive: 1 });

    let res!: Response;
    const created = await newDedupKeys(async () => {
      res = await post(ev, 'spon_dedup_hour_c', 'click', '203.0.113.51');
    });
    expect(res.status).toBe(201);
    const ttls = [...created.values()];
    expect(ttls).toHaveLength(1);
    expect(ttls[0], 'click dedup is unchanged (five minutes)').toBeLessThanOrEqual(300);
  });
});

describe('never who: the write keeps nothing person-shaped, and nothing finer than the hour is added', () => {
  test('the row has no per-person column; the dedup key holds neither the address nor the card', async () => {
    const ev = 'evt_dedup_hour_d';
    await seedEvent(ev);
    await seedSplitSponsor(tenv().DB, { id: 'spon_dedup_hour_d', eventId: ev, isActive: 1 });
    const ip = '203.0.113.61';

    let res!: Response;
    const created = await newDedupKeys(async () => {
      res = await post(ev, 'spon_dedup_hour_d', 'impression', ip);
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).filter((k) => BANNED_KEY.test(k))).toEqual([]);

    const cols = (
      (await tenv().DB.prepare(`PRAGMA table_info(sponsor_displays)`).all()).results as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(cols.filter((c) => BANNED_KEY.test(c))).toEqual([]);

    expect(created.size).toBe(1);
    const key = [...created.keys()][0]!;
    expect(key).not.toContain(ip);
    expect(key).not.toContain('spon_dedup_hour_d');
    expect(key).not.toContain(ev);
    expect(await tenv().RATE_LIMIT_KV.get(key)).toBe('1');
  });
});
