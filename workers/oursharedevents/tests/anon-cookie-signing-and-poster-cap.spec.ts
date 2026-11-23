/**
 * OSE-1496 — the signed `ose_anon` cookie and the per-poster-hour scan cap.
 *
 * Owner decision 2026-11-23 (decision card): sign the cookie, and count at most
 * 100 scans per poster per hour, read as "100 or more" above that.
 *
 *   1. Signing. A cookie the Worker did not sign (made up, tampered, signed
 *      with another key, too long) is ignored: the visitor is new and gets a
 *      fresh signed cookie, and nothing derived from the made-up value is
 *      stored, on /q or on the forms.
 *   2. The cap. The 101st scan of one poster in one hour is not stored, the
 *      visitor is still sent to the event, the next hour counts again, many
 *      scans at once never pass 100, and the room's vote code is not capped.
 *   3. The wording. A scan figure that includes a capped poster-hour carries
 *      `at_least`, which the admin reads as "or more".
 *
 * Format: `OSE-1496 | <LAYER> | <case> | <assertion>`.
 */

import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleQrScan, type QrScanEnv } from '../src/handlers/qr-scan';
import { handleFormCheckin, type FormsEnv } from '../src/handlers/forms';
import {
  getOrCreateAnonId,
  signAnonId,
  verifyAnonCookie,
  MAX_LEGACY_LEN,
} from '../src/lib/anonymous-id';
import { scanNodeKey } from '../src/lib/scan-node-key';
import { eventAnonKey } from '../src/lib/event-anon-key';
import {
  POSTER_HOUR_CAP,
  prunePosterHourTally,
  takePosterHourPlace,
} from '../src/lib/poster-hour-cap';
import { scansByPoster, scansByLocalDay, scansOf, type ScanCell } from '../src/lib/scan-cells';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS?: string;
  ANON_ID_HASH_PEPPER: string;
  FORMS_HASH_PEPPER: string;
}
const tenv = () => env as unknown as TestEnv;
const PEPPER = () => tenv().ANON_ID_HASH_PEPPER;

async function applyAll(db: D1Database, json: string | undefined): Promise<void> {
  if (!json) return;
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

const EVENT = 'evt-ose-1496';
const POSTER = 'pd-ose-1496-poster';
const POSTER_TOKEN = 'qrt_ose1496_poster_token';
const VOTE = 'pd-ose-1496-vote';
const VOTE_TOKEN = 'qrt_ose1496_vote_token';

beforeAll(async () => {
  await applyAll(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await applyAll(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  const db = tenv().DB;
  await db
    .prepare(
      `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date, created_at, updated_at)
       VALUES (?, 'brand-test', 'Cap test', ?, 'active', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(EVENT, EVENT)
    .run();
  await db
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'Poster', 1, datetime('now'))`
    )
    .bind(POSTER, EVENT, POSTER_TOKEN)
    .run();
  await db
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, is_vote_code, created_at)
       VALUES (?, ?, ?, 'Vote code', 1, 1, datetime('now'))`
    )
    .bind(VOTE, EVENT, VOTE_TOKEN)
    .run();
});

beforeEach(async () => {
  const db = tenv().DB;
  await db.prepare('DELETE FROM scan_node_returns WHERE event_id = ?').bind(EVENT).run();
  await db.prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(EVENT).run();
  await db.prepare('DELETE FROM scan_poster_hour_tally').run();
});

function scanEnv(over: Partial<QrScanEnv> = {}): QrScanEnv {
  return { DB: tenv().DB, ANON_ID_HASH_PEPPER: PEPPER(), ...over };
}

function scanReq(token: string, cookie?: string): Request {
  return new Request(`https://t.test/q/${token}`, {
    headers: {
      'User-Agent': 'ose-1496-spec',
      ...(cookie !== undefined ? { Cookie: `ose_anon=${cookie}` } : {}),
    },
  });
}

async function placementRows(poster: string): Promise<number> {
  const row = await tenv()
    .DB.prepare('SELECT COUNT(*) AS c FROM scan_placement_events WHERE poster_deployment_id = ?')
    .bind(poster)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

async function storedScanKeys(): Promise<Array<string | null>> {
  const res = await tenv()
    .DB.prepare('SELECT anonymous_id FROM scan_node_returns WHERE event_id = ?')
    .bind(EVENT)
    .all<{ anonymous_id: string | null }>();
  return (res.results ?? []).map((r) => r.anonymous_id);
}

const cookieOf = (res: Response) =>
  /ose_anon=([^;]+)/.exec(res.headers.get('Set-Cookie') ?? '')?.[1];

// ── 1. Signing ───────────────────────────────────────────────────────────────

describe('OSE-1496 | the ose_anon cookie is signed', () => {
  const ID = 'anon_0f0f0f0f-1111-4222-8333-444455556666';

  test('OSE-1496 | UNIT | a value the Worker signed | verifies back to its id', async () => {
    const value = await signAnonId(ID, PEPPER());
    expect(value.startsWith(`${ID}_s1_`)).toBe(true);
    expect(value).toMatch(/^anon_[A-Za-z0-9_-]+$/);
    expect(await verifyAnonCookie(value, PEPPER())).toBe(ID);
  });

  test('OSE-1496 | SECURITY | unsigned, tampered, another key, another id, too long | none verifies', async () => {
    const good = await signAnonId(ID, PEPPER());
    const sig = good.slice(good.indexOf('_s1_') + 4);
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    const forged = [
      ID, // the old, unsigned shape
      `${ID}_s1_${flipped}`, // one character of the signature changed
      await signAnonId(ID, 'another-pepper-that-is-at-least-32-chars'), // another key
      `anon_0f0f0f0f-1111-4222-8333-444455556667_s1_${sig}`, // signature moved to another id
      `${ID}_s1_${sig}x`, // longer than a signature
      `${'anon_' + 'a'.repeat(200)}_s1_${sig}`, // over-long id
      '',
    ];
    for (const value of forged) expect(await verifyAnonCookie(value, PEPPER())).toBeNull();
  });

  test('OSE-1496 | UNIT | a signed cookie | is read as the same visitor, and no new cookie is set', async () => {
    const value = await signAnonId(ID, PEPPER());
    const v = await getOrCreateAnonId(scanReq(POSTER_TOKEN, value), PEPPER());
    expect(v).toEqual({ anonId: ID, isNew: false, cookieValue: value });
  });

  test('OSE-1496 | SECURITY | a made-up cookie | is replaced by a fresh signed one', async () => {
    const v = await getOrCreateAnonId(scanReq(POSTER_TOKEN, ID), PEPPER());
    expect(v.isNew).toBe(true);
    expect(v.anonId).not.toBe(ID);
    expect(await verifyAnonCookie(v.cookieValue, PEPPER())).toBe(v.anonId);
  });

  test('OSE-1496 | UNIT | no pepper configured | the old unsigned cookie is read, capped in length', async () => {
    const ok = await getOrCreateAnonId(scanReq(POSTER_TOKEN, ID), undefined);
    expect(ok).toEqual({ anonId: ID, isNew: false, cookieValue: ID });
    const long = `anon_${'a'.repeat(MAX_LEGACY_LEN)}`;
    expect((await getOrCreateAnonId(scanReq(POSTER_TOKEN, long), undefined)).isNew).toBe(true);
  });

  test('OSE-1496 | INTEGRATION | /q with a made-up cookie | stores nothing derived from it, and sets a signed cookie', async () => {
    const res = await handleQrScan(scanReq(POSTER_TOKEN, ID), scanEnv(), POSTER_TOKEN);
    expect(res.status).toBe(302);
    const set = cookieOf(res);
    expect(set).toBeDefined();
    const newId = await verifyAnonCookie(set!, PEPPER());
    expect(newId).not.toBeNull();
    const keys = await storedScanKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(await scanNodeKey(ID, PEPPER()));
    expect(keys[0]).toBe(await scanNodeKey(newId!, PEPPER()));
  });

  test('OSE-1496 | INTEGRATION | /q with the signed cookie | stores the keyed id of its id, sets no cookie', async () => {
    const value = await signAnonId(ID, PEPPER());
    const res = await handleQrScan(scanReq(POSTER_TOKEN, value), scanEnv(), POSTER_TOKEN);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(await storedScanKeys()).toEqual([await scanNodeKey(ID, PEPPER())]);
  });

  test('OSE-1496 | SECURITY | a check-in with a made-up cookie | does not store the keyed id of the made-up value', async () => {
    const req = new Request(`https://t.test/api/v2/events/${EVENT}/forms/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `ose_anon=${ID}` },
    });
    const res = await handleFormCheckin(req, env as unknown as FormsEnv, EVENT);
    expect(res.status).toBe(200);
    const forgedKey = await eventAnonKey(ID, EVENT, tenv().FORMS_HASH_PEPPER);
    const row = await tenv()
      .FORMS_DB.prepare('SELECT COUNT(*) AS c FROM checkin_counts WHERE last_anonymous_id = ?')
      .bind(forgedKey)
      .first<{ c: number }>();
    expect(Number(row?.c ?? 0)).toBe(0);
    expect(await verifyAnonCookie(cookieOf(res) ?? '', PEPPER())).not.toBeNull();
  });
});

// ── 2. The cap ───────────────────────────────────────────────────────────────

describe('OSE-1496 | at most 100 scans per poster per hour', () => {
  test('OSE-1496 | INTEGRATION | 101 different visitors in one hour | 100 stored, the 101st still sent to the event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-23T19:05:00Z'));
      let last: Response | null = null;
      for (let i = 0; i <= POSTER_HOUR_CAP; i++) {
        last = await handleQrScan(scanReq(POSTER_TOKEN), scanEnv(), POSTER_TOKEN);
      }
      expect(await placementRows(POSTER)).toBe(POSTER_HOUR_CAP);
      expect(last!.status).toBe(302);
      expect(last!.headers.get('Location')).toContain(EVENT);

      vi.setSystemTime(new Date('2026-11-23T20:01:00Z')); // the next hour counts again
      await handleQrScan(scanReq(POSTER_TOKEN), scanEnv(), POSTER_TOKEN);
      expect(await placementRows(POSTER)).toBe(POSTER_HOUR_CAP + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('OSE-1496 | INTEGRATION | 130 scans at once | never more than 100 stored', async () => {
    await Promise.all(
      Array.from({ length: POSTER_HOUR_CAP + 30 }, () =>
        handleQrScan(scanReq(POSTER_TOKEN), scanEnv(), POSTER_TOKEN)
      )
    );
    // Run inside one hour unless the clock crosses one; either way no hour passes 100.
    const res = await tenv()
      .DB.prepare(
        `SELECT MAX(n) AS m FROM (SELECT COUNT(*) AS n FROM scan_placement_events
          WHERE poster_deployment_id = ? GROUP BY substr(scan_bucket, 1, 13))`
      )
      .bind(POSTER)
      .first<{ m: number }>();
    expect(Number(res?.m)).toBeLessThanOrEqual(POSTER_HOUR_CAP);
  });

  test('OSE-1496 | UNIT | the counter | stops at cap + 1, so it never records a crowd size past the cap', async () => {
    for (let i = 0; i < POSTER_HOUR_CAP + 20; i++) {
      await takePosterHourPlace(tenv().DB, 'pd-counter-only', '2026-11-23T10');
    }
    const row = await tenv()
      .DB.prepare('SELECT scans FROM scan_poster_hour_tally WHERE poster_deployment_id = ?')
      .bind('pd-counter-only')
      .first<{ scans: number }>();
    expect(row?.scans).toBe(POSTER_HOUR_CAP + 1);
  });

  test('OSE-1496 | INTEGRATION | the room vote code | is not capped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-23T21:05:00Z'));
      for (let i = 0; i < POSTER_HOUR_CAP + 3; i++) {
        await handleQrScan(scanReq(VOTE_TOKEN), scanEnv(), VOTE_TOKEN);
      }
      expect(await placementRows(VOTE)).toBe(POSTER_HOUR_CAP + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  test('OSE-1496 | RAINY | the tally write fails | the scan is still counted (fails open)', async () => {
    const db = tenv().DB;
    const broken = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('scan_poster_hour_tally')) throw new Error('D1 unavailable');
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const res = await handleQrScan(scanReq(POSTER_TOKEN), scanEnv({ DB: broken }), POSTER_TOKEN);
    expect(res.status).toBe(302);
    expect(await placementRows(POSTER)).toBe(1);
  });

  test('OSE-1496 | UNIT | the cron prune | deletes hours older than two days and keeps the rest', async () => {
    const db = tenv().DB;
    await db
      .prepare(
        `INSERT INTO scan_poster_hour_tally (poster_deployment_id, scan_hour, scans)
         VALUES ('pd-old', '2026-11-20T10', 3), ('pd-new', '2026-11-23T09', 3)`
      )
      .run();
    await prunePosterHourTally(db, new Date('2026-11-23T10:30:00Z'));
    const res = await db
      .prepare('SELECT poster_deployment_id AS p FROM scan_poster_hour_tally ORDER BY p')
      .all<{ p: string }>();
    expect((res.results ?? []).map((r) => r.p)).toEqual(['pd-new']);
  });
});

// ── 3. The wording ───────────────────────────────────────────────────────────

describe('OSE-1496 | a figure that includes a capped poster-hour reads "or more"', () => {
  const cell = (poster: string, hour: string, n: number): ScanCell => ({ poster, hour, n });

  test('OSE-1496 | UNIT | a poster-hour at the cap | marks the poster, the total and the day at_least', () => {
    const cells = [
      cell('a', '2026-11-23T19', POSTER_HOUR_CAP),
      cell('a', '2026-11-23T20', 7),
      cell('b', '2026-11-23T19', 9),
    ];
    expect(scansByPoster(cells).get('a')?.at_least).toBe(true);
    expect(scansByPoster(cells).get('b')?.at_least).toBeUndefined();
    expect(scansOf(cells).at_least).toBe(true);
    const days = scansByLocalDay(cells, 'UTC', new Date('2026-11-23T22:00:00Z'), 1);
    expect(days[0].count.at_least).toBe(true);
  });

  test('OSE-1496 | UNIT | every poster-hour under the cap | no figure is marked', () => {
    const cells = [cell('a', '2026-11-23T19', POSTER_HOUR_CAP - 1), cell('b', '2026-11-23T19', 9)];
    expect(scansOf(cells).at_least).toBeUndefined();
    expect(scansByPoster(cells).get('a')?.at_least).toBeUndefined();
  });

  test('OSE-1496 | UNIT | the admin page | appends "or more" wherever it prints a scan figure', async () => {
    const html: string = (await import('../src/templates/admin.html')).default as unknown as string;
    expect(html).toContain("scans + (pd.scans.at_least ? ' or more scans' : ' scans')");
    expect(html).toContain("a.scans.at_least ? ' or more poster scans' : ' poster scans'");
    expect(html).toContain("String(scansN) + (a.scans.at_least ? ' or more' : '')");
    expect(html).toContain("x.scans.at_least ? n + ' or more' : n");
  });
});
