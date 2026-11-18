/**
 * Open items against the under-5 floor, pinned as they stand today (OSE-2087).
 *
 * These tests do NOT say the behaviour is right. Each one records a gap the
 * owner has not ruled on yet, listed in docs/brain/CONSTRAINTS.md ("They say
 * less than is so"). They exist so the gap can be run again, not only read:
 * the review of 2026-11-17 saw both once in a scratch spec that was deleted.
 *
 * When the owner rules and the code changes, the matching test here goes red.
 * That is the signal to replace it with a test of the new rule and to take
 * the item off the list. Do not skip it and do not loosen it to get green.
 *
 *   1. Padding. A scan with no `ose_anon` cookie is a new row each time, so
 *      whoever holds a poster's link can add scans of their own. Two scans
 *      read as withheld; three more of the caller's own lift the figure to 5.
 *      The floor then shows a number that says nothing about five people.
 *
 *   2. Audit rows. `GET /api/v2/admin/audit-log?scope=brand` returns one row
 *      per operator action, with the actor, however few there are. The owner's
 *      ruling of 2026-11-16 puts an operator's own action counts under the
 *      floor; this read is not under it.
 *
 * @born-red OSE-2087 | method: one fault at a time in src. (1) event-stats
 *   made to floor scans at 6: the padding test went red at "count 5".
 *   (2) the brand audit-log read made to return no rows under 5: the audit
 *   test went red at "2 rows" | date: 2026-11-18
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const BRAND = 'pin-floor';
const EVENT = 'pin-floor-evt';
const TOKEN = 'qrt_pin-floor-pd';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15';

interface Floored {
  count: number | null;
  suppressed: boolean;
  floor: number;
}

async function applyMigrations() {
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

/** One scan of the poster with no cookie sent, so nothing ties it to the last. */
const scanWithoutCookie = () =>
  SELF.fetch(`https://example.com/q/${TOKEN}`, {
    headers: { 'User-Agent': IPHONE },
    redirect: 'manual',
  });

async function scansAsTheAdminReadsThem(): Promise<Floored> {
  const res = await SELF.fetch(`https://example.com/api/v2/admin/events/${EVENT}/stats`, {
    headers: ADMIN,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { stats: { scans: Floored } }).stats.scans;
}

beforeAll(async () => {
  await applyMigrations();
  const db = tenv().DB;
  await db.batch([
    db.prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(EVENT),
    db.prepare('DELETE FROM poster_deployments WHERE event_id = ?').bind(EVENT),
    db.prepare('DELETE FROM admin_audit_log WHERE brand_id = ?').bind(BRAND),
    db.prepare('DELETE FROM events WHERE id = ?').bind(EVENT),
    db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
         VALUES (?, ?, 'Pinned floor items', ?, 'active', 'Eagles Hall',
                 '2026-12-05T15:00:00.000Z', '2026-12-05T21:00:00.000Z', 'America/Chicago')`
      )
      .bind(EVENT, BRAND, EVENT),
    db
      .prepare(
        `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active)
         VALUES ('pin-floor-pd', ?, ?, 'Table card', 1)`
      )
      .bind(EVENT, TOKEN),
  ]);
});

describe('OPEN ITEM, pinned: a poster-hour can be padded past the floor', () => {
  test('two scans read as withheld; three more of the caller’s own make it 5', async () => {
    // All five scans must land in one poster-hour. Started in the last seconds
    // of an hour they could straddle two, so wait the hour out first.
    const msLeftInHour = 3_600_000 - (Date.now() % 3_600_000);
    if (msLeftInHour < 5_000) await new Promise((r) => setTimeout(r, msLeftInHour + 50));

    for (let i = 0; i < 2; i++) expect((await scanWithoutCookie()).status).toBe(302);
    expect(await scansAsTheAdminReadsThem()).toEqual({ count: null, suppressed: true, floor: 5 });

    for (let i = 0; i < 3; i++) expect((await scanWithoutCookie()).status).toBe(302);
    // The gap: one caller, five rows, and the figure is published.
    expect(await scansAsTheAdminReadsThem()).toEqual({ count: 5, suppressed: false, floor: 5 });
  });
});

describe('OPEN ITEM, pinned: the brand audit-log read returns rows under the floor', () => {
  test('two operator actions come back as two rows, each with its actor', async () => {
    const db = tenv().DB;
    await db.batch(
      ['pin-floor-a1', 'pin-floor-a2'].map((id) =>
        db
          .prepare(
            `INSERT INTO admin_audit_log (id, action, actor, resource_type, resource_id, request_id, outcome, brand_id)
             VALUES (?, 'UPDATE_EVENT', 'operator@pin-floor.example', 'event', ?, ?, 'success', ?)`
          )
          .bind(id, EVENT, `req-${id}`, BRAND)
      )
    );
    const res = await SELF.fetch(
      `https://example.com/api/v2/admin/audit-log?scope=brand&brand=${BRAND}&limit=100`,
      { headers: ADMIN }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { id: string; actor: string | null }[] };
    // The gap: fewer than 5 actions, and each is a readable row.
    expect(body.entries.map((e) => e.id).sort()).toEqual(['pin-floor-a1', 'pin-floor-a2']);
    expect(body.entries.every((e) => e.actor === 'operator@pin-floor.example')).toBe(true);
  });
});
