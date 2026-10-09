/**
 * `scan_node_returns.anonymous_id` holds a keyed scan id, never the cookie value
 * (OSE-1659).
 *
 * The scan path used to store the raw `ose_anon` cookie value next to a
 * user-agent hash, an hour bucket and the event id. Decision (recorded on
 * OSE-1659, 2026-10-09): store a keyed id instead (`lib/scan-node-key.ts`). It
 * is the same for one browser at every event, because the returns count needs
 * that, and it equals no value in any other table.
 *
 * The integration tests drive the real Worker (`SELF.fetch`) and then read both
 * databases, which only a test may do.
 *
 * Format: `<LAYER> | <what> | <assertion>`.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { SCAN_NODE_KEY_PREFIX, isScanNodeKey, scanNodeKey } from '../src/lib/scan-node-key';
import { eventAnonKey } from '../src/lib/event-anon-key';
import { hashAnonIdForReturns } from '../src/lib/anon-id-hash';
import { handleQrScan, type QrScanEnv } from '../src/handlers/qr-scan';
import { handleScanBatch, type ScanMessage } from '../src/lib/scan-buffer';
import { materializeAnonIdReturns } from '../src/lib/shared-report';
import { handleDataSubjectErase, type DataSubjectEnv } from '../src/handlers/data-subject';
import { hashEmail } from '../src/lib/forms-db';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  FORMS_HASH_PEPPER: string;
  ANON_ID_HASH_PEPPER: string;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;
const mainDb = () => tenv().DB;
const formsDb = () => tenv().FORMS_DB;

function newCookieValue(): string {
  return `anon_${crypto.randomUUID()}`;
}

async function applyAll(db: D1Database, statementsJson: string): Promise<void> {
  for (const stmt of JSON.parse(statementsJson) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function newEvent(): Promise<{ eventId: string; token: string }> {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const eventId = `evt-snk-${suffix}`;
  const token = `qrt_snk_${suffix}`;
  await mainDb()
    .prepare(
      `INSERT OR REPLACE INTO events
         (id, brand_id, title, slug, status, legal_clearance_tier, start_date, created_at, updated_at)
       VALUES (?, 'brand-test', ?, ?, 'active', 2, datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(eventId, `Scan key ${eventId}`, eventId)
    .run();
  await mainDb()
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments
         (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'Scan key poster', 1, datetime('now'))`
    )
    .bind(`pd-${eventId}`, eventId, token)
    .run();
  return { eventId, token };
}

async function scan(cookieValue: string, token: string): Promise<void> {
  const res = await SELF.fetch(`https://t.test/q/${token}`, {
    redirect: 'manual',
    headers: { Cookie: `ose_anon=${cookieValue}`, 'User-Agent': 'scan-node-key-spec' },
  });
  expect(res.status).toBe(302);
}

async function storedScanIds(eventId: string): Promise<Array<string | null>> {
  const rows = await mainDb()
    .prepare('SELECT anonymous_id FROM scan_node_returns WHERE event_id = ?')
    .bind(eventId)
    .all<{ anonymous_id: string | null }>();
  return rows.results.map((r) => r.anonymous_id);
}

/** Every non-null value of every column of every table in one database, as text. */
async function everyValue(
  db: D1Database,
  label: string,
  skip: (table: string, column: string) => boolean
): Promise<Array<{ where: string; value: string }>> {
  const tables = await db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
          AND name NOT LIKE 'd1_%'`
    )
    .all<{ name: string }>();
  const out: Array<{ where: string; value: string }> = [];
  for (const { name } of tables.results) {
    const rows = await db.prepare(`SELECT * FROM ${name}`).all<Record<string, unknown>>();
    for (const row of rows.results) {
      for (const [column, value] of Object.entries(row)) {
        if (value === null || value === undefined || skip(name, column)) continue;
        out.push({ where: `${label}.${name}.${column}`, value: String(value) });
      }
    }
  }
  return out;
}

beforeAll(async () => {
  await applyAll(mainDb(), tenv().TEST_MIGRATION_STATEMENTS);
  await applyAll(formsDb(), tenv().TEST_FORMS_MIGRATION_STATEMENTS);
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. The key itself
// ═════════════════════════════════════════════════════════════════════════════

describe('scanNodeKey', () => {
  test('UNIT | one cookie | the same key every time, in the snk1_ format, never the cookie', async () => {
    const cookie = newCookieValue();
    const a = await scanNodeKey(cookie, tenv().ANON_ID_HASH_PEPPER);
    const b = await scanNodeKey(cookie, tenv().ANON_ID_HASH_PEPPER);
    expect(a).toBe(b);
    expect(isScanNodeKey(a)).toBe(true);
    expect(a!.startsWith(SCAN_NODE_KEY_PREFIX)).toBe(true);
    expect(a).not.toContain(cookie);
  });

  test('UNIT | two cookies, or two peppers | different keys', async () => {
    const cookie = newCookieValue();
    const k1 = await scanNodeKey(cookie, tenv().ANON_ID_HASH_PEPPER);
    expect(await scanNodeKey(newCookieValue(), tenv().ANON_ID_HASH_PEPPER)).not.toBe(k1);
    expect(await scanNodeKey(cookie, 'another-pepper-of-at-least-32-chars!')).not.toBe(k1);
  });

  test('UNIT | no pepper | null, never a fallback to the cookie value', async () => {
    expect(await scanNodeKey(newCookieValue(), undefined)).toBeNull();
    expect(await scanNodeKey(newCookieValue(), '')).toBeNull();
  });

  test('UNIT | not the FORMS_DB id nor the returns hash for the same cookie', async () => {
    const cookie = newCookieValue();
    const key = await scanNodeKey(cookie, tenv().ANON_ID_HASH_PEPPER);
    expect(key).not.toBe(await eventAnonKey(cookie, 'evt-any', tenv().FORMS_HASH_PEPPER));
    expect(key).not.toBe(await hashAnonIdForReturns(cookie, tenv().ANON_ID_HASH_PEPPER));
    expect(key).not.toBe(await hashAnonIdForReturns(key!, tenv().ANON_ID_HASH_PEPPER));
  });

  test('UNIT | isScanNodeKey | rejects the cookie value, a forms id and near misses', () => {
    expect(isScanNodeKey(newCookieValue())).toBe(false);
    expect(isScanNodeKey(`evk1_${'a'.repeat(64)}`)).toBe(false);
    expect(isScanNodeKey(`snk1_${'a'.repeat(63)}`)).toBe(false);
    expect(isScanNodeKey(`snk1_${'A'.repeat(64)}`)).toBe(false);
    expect(isScanNodeKey(null)).toBe(false);
    expect(isScanNodeKey(`snk1_${'a'.repeat(64)}`)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. What a real scan stores
// ═════════════════════════════════════════════════════════════════════════════

describe('a real scan stores the keyed id', () => {
  test('INTEGRATION | GET /q/<token> with a cookie | the row holds scanNodeKey(cookie), not the cookie', async () => {
    const cookie = newCookieValue();
    const { eventId, token } = await newEvent();
    await scan(cookie, token);

    const ids = await storedScanIds(eventId);
    expect(ids).toEqual([await scanNodeKey(cookie, tenv().ANON_ID_HASH_PEPPER)]);
    expect(ids[0]).not.toContain(cookie);
  });

  test('INTEGRATION | one cookie at two events | the same key at both, so a return is still countable', async () => {
    const cookie = newCookieValue();
    const a = await newEvent();
    const b = await newEvent();
    await scan(cookie, a.token);
    await scan(cookie, b.token);

    const [idA] = await storedScanIds(a.eventId);
    const [idB] = await storedScanIds(b.eventId);
    expect(isScanNodeKey(idA)).toBe(true);
    expect(idA).toBe(idB);
  });

  test('INTEGRATION | scan, register, check in, then the returns job | the scan column holds no value found in any other table of either database', async () => {
    const cookie = newCookieValue();
    const { eventId, token } = await newEvent();
    await scan(cookie, token);
    const reg = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `ose_anon=${cookie}` },
      body: JSON.stringify({ name: 'Pat Example', email: 'snk-join@example.com' }),
    });
    expect(reg.status).toBe(200);
    const checkin = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `ose_anon=${cookie}` },
    });
    expect(checkin.status).toBe(200);

    // End the event 4 hours ago so the nightly returns job picks it up.
    const nowMs = Date.now();
    await mainDb()
      .prepare('UPDATE events SET start_date = ?, end_date = ? WHERE id = ?')
      .bind(
        new Date(nowMs - 6 * 3600_000).toISOString(),
        new Date(nowMs - 4 * 3600_000).toISOString(),
        eventId
      )
      .run();
    const mat = await materializeAnonIdReturns({
      DB: mainDb(),
      ANON_ID_HASH_PEPPER: tenv().ANON_ID_HASH_PEPPER,
    });
    expect(mat.errors).toBe(0);
    const returns = await mainDb()
      .prepare('SELECT COUNT(*) AS c FROM anon_id_returns WHERE venue_id = ?')
      .bind(eventId)
      .first<{ c: number }>();
    expect(returns!.c, 'the returns job still finds this browser').toBe(1);

    const scanIds = new Set(
      (
        await mainDb()
          .prepare('SELECT anonymous_id FROM scan_node_returns WHERE anonymous_id IS NOT NULL')
          .all<{ anonymous_id: string }>()
      ).results.map((r) => r.anonymous_id)
    );
    expect(scanIds.size).toBeGreaterThan(0);

    const others = [
      ...(await everyValue(
        mainDb(),
        'DB',
        (t, c) => t === 'scan_node_returns' && c === 'anonymous_id'
      )),
      ...(await everyValue(formsDb(), 'FORMS_DB', () => false)),
    ];
    const joinable = [...new Set(others.filter((v) => scanIds.has(v.value)).map((v) => v.where))];
    expect(joinable, `columns that equal a scan_node_returns.anonymous_id: ${joinable}`).toEqual(
      []
    );

    const raw = [...scanIds].filter((v) => v.startsWith('anon_'));
    expect(raw, 'raw ose_anon values left in scan_node_returns').toEqual([]);
  });

  test('INTEGRATION | no ANON_ID_HASH_PEPPER | the scan is still counted, with no id stored', async () => {
    const cookie = newCookieValue();
    const { eventId, token } = await newEvent();
    const noPepper = { ...(env as unknown as QrScanEnv), ANON_ID_HASH_PEPPER: undefined };
    const res = await handleQrScan(
      new Request(`https://t.test/q/${token}`, {
        headers: { Cookie: `ose_anon=${cookie}`, 'User-Agent': 'scan-node-key-spec' },
      }),
      noPepper,
      token
    );
    expect(res.status).toBe(302);
    expect(await storedScanIds(eventId)).toEqual([null]);
    const placed = await mainDb()
      .prepare('SELECT COUNT(*) AS c FROM scan_placement_events WHERE event_id = ?')
      .bind(eventId)
      .first<{ c: number }>();
    expect(placed!.c).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. The write itself refuses a raw value (older producer, queued message)
// ═════════════════════════════════════════════════════════════════════════════

describe('the scan write never stores a raw cookie value', () => {
  test('INTEGRATION | a queued message carrying an anon_ value (from the previous Worker) | stored as NULL', async () => {
    const { eventId } = await newEvent();
    const msg: ScanMessage = {
      placement_row_id: `spe_${crypto.randomUUID()}`,
      return_row_id: `snr_${crypto.randomUUID()}`,
      event_id: eventId,
      deployment_id: `pd-${eventId}`,
      anon_id: newCookieValue(),
      ua_hash: null,
      country: null,
      scan_bucket: '2026-10-09T12:00',
    };
    const message = { body: msg, attempts: 1, ack: () => {}, retry: () => {} };
    await handleScanBatch(
      { queue: 'ose-scans', messages: [message] } as unknown as MessageBatch<ScanMessage>,
      { DB: mainDb() }
    );
    expect(await storedScanIds(eventId)).toEqual([null]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Erasure finds the keyed rows
// ═════════════════════════════════════════════════════════════════════════════

describe('erasure reaches the keyed rows', () => {
  test('INTEGRATION | an email linked to a cookie by a legacy form row | its keyed scan rows and returns are deleted', async () => {
    const cookie = newCookieValue();
    const email = `snk-erase-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const { eventId, token } = await newEvent();
    await scan(cookie, token);
    const key = await scanNodeKey(cookie, tenv().ANON_ID_HASH_PEPPER);
    expect(await storedScanIds(eventId)).toEqual([key]);

    // A pre-0016 form row: the only shape that still links an email to a cookie.
    const emailHash = await hashEmail(email, tenv().FORMS_HASH_PEPPER, { requirePepper: true });
    await formsDb()
      .prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash, anonymous_id)
         VALUES (?, ?, '2026-10', 'confirmed', ?, ?)`
      )
      .bind(`reg-snk-${crypto.randomUUID()}`, eventId, emailHash, cookie)
      .run();
    const returnsHash = await hashAnonIdForReturns(key!, tenv().ANON_ID_HASH_PEPPER);
    await mainDb()
      .prepare(
        `INSERT INTO anon_id_returns (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count)
         VALUES (?, ?, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 1)`
      )
      .bind(returnsHash, eventId)
      .run();

    const res = await handleDataSubjectErase(
      new Request('https://t.test/api/v2/admin/data-subject/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
      env as unknown as DataSubjectEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body.scanReturnsDeleted).toBe(1);
    expect(body.anonIdReturnsDeleted).toBe(1);
    expect(await storedScanIds(eventId)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Migration 0095 clears raw values already stored
// ═════════════════════════════════════════════════════════════════════════════

describe('migration 0095 clears raw cookie values already in scan_node_returns', () => {
  function scrubStatements(): string[] {
    const all: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
    return all.filter((s) =>
      /^UPDATE\s+scan_node_returns\s+SET\s+anonymous_id\s*=\s*NULL\b/i.test(s.trim())
    );
  }

  test('MIGRATION | the scrub statement exists | exactly one', () => {
    expect(scrubStatements()).toHaveLength(1);
  });

  test('MIGRATION | a raw value, a keyed id and no id | raw is cleared; the key, the rows and their other columns stay', async () => {
    const { eventId } = await newEvent();
    const key = `snk1_${'cd'.repeat(32)}`;
    const cases: Array<[string, string | null]> = [
      ['raw', newCookieValue()],
      ['key', key],
      ['none', null],
    ];
    for (const [suffix, value] of cases) {
      await mainDb()
        .prepare(
          `INSERT INTO scan_node_returns (id, event_id, anonymous_id, user_agent_hash, scan_bucket)
           VALUES (?, ?, ?, 'ua-hash', '2026-10-09T12:00')`
        )
        .bind(`snr-mig-${suffix}-${eventId}`, eventId, value)
        .run();
    }
    for (const stmt of scrubStatements()) await mainDb().prepare(stmt).run();

    const rows = await mainDb()
      .prepare(
        'SELECT id, anonymous_id, user_agent_hash FROM scan_node_returns WHERE event_id = ? ORDER BY id'
      )
      .bind(eventId)
      .all<{ id: string; anonymous_id: string | null; user_agent_hash: string }>();
    expect(
      rows.results.map((r) => [r.id.split('-')[2], r.anonymous_id, r.user_agent_hash])
    ).toEqual([
      ['key', key, 'ua-hash'],
      ['none', null, 'ua-hash'],
      ['raw', null, 'ua-hash'],
    ]);
  });
});
