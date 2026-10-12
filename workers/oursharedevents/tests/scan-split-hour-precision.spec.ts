/**
 * OSE-923 (CCR N-DS-2): the two scan split tables keep no time finer than the hour.
 *
 * scan_placement_events (WHERE) and scan_node_returns (WHO) are written in one
 * batch. Both used to store `created_at = datetime('now')`, to the second, so a
 * join on (event_id, created_at) re-linked who to where one scan at a time,
 * whatever the bucket size. OSE-1659 (a keyed id at rest) does not touch that.
 *
 *   1. the adversarial join, through the real write: scans from distinct
 *      browsers at distinct seconds in one hour, then (event_id, created_at)
 *      cannot isolate any browser to a poster;
 *   2. the stamp is the scan's bucket, not a clock, so a queued scan processed
 *      later still lands in its own hour;
 *   3. migration 0100 truncates rows already stored (its own statements run on
 *      seeded second-precision rows) and is idempotent;
 *   4. only lib/scan-buffer.ts writes the two tables, so no other writer can
 *      bring seconds back;
 *   5. retention reads scan_bucket, not created_at.
 *
 * Seen red against main (2026-10-11): 1 and 2 fail on the second-precision write,
 * 3 has nothing to run, 5 deletes by created_at.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { buildScanStatements, hourStamp, type ScanMessage } from '../src/lib/scan-buffer';
import { runScanReturnsRetention } from '../src/lib/scan-returns-retention';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;
const db = () => tenv().DB;

const EVT = 'evt_scan_hour_precision';
const BUCKET = '2026-10-10T19:00';
const KEY = (n: number) => `snk1_${String(n).padStart(64, '0')}`; // keyed-id shape

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await db().prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function seedEventAndPosters(): Promise<void> {
  await db()
    .prepare(
      `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, created_at, updated_at)
       VALUES (?, 'b', 'Hour precision', ?, 'active', datetime('now'), datetime('now'))`
    )
    .bind(EVT, EVT)
    .run();
  for (const p of ['pd_hp_a', 'pd_hp_b', 'pd_hp_c']) {
    await db()
      .prepare('INSERT OR IGNORE INTO poster_deployments (id, event_id, qr_token) VALUES (?, ?, ?)')
      .bind(p, EVT, `qrt_${p}`)
      .run();
  }
}

/** One scan through the real statement builder. */
async function scan(n: number, poster: string, bucket = BUCKET): Promise<void> {
  const msg: ScanMessage = {
    placement_row_id: `spe_hp_${n}`,
    return_row_id: `snr_hp_${n}`,
    event_id: EVT,
    deployment_id: poster,
    anon_id: KEY(n),
    ua_hash: null,
    country: null,
    scan_bucket: bucket,
  } as ScanMessage;
  await db().batch(buildScanStatements(db(), msg));
}

const clear = async () => {
  await db().prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(EVT).run();
  await db().prepare('DELETE FROM scan_node_returns WHERE event_id = ?').bind(EVT).run();
};

beforeAll(async () => {
  await applyMigrations();
  await seedEventAndPosters();
});
beforeEach(clear);

describe('hourStamp', () => {
  test('is the bucket hour in the table shape, no clock', () => {
    expect(hourStamp('2026-10-10T19:00')).toBe('2026-10-10 19:00:00');
    expect(hourStamp('2026-01-02T03:00')).toBe('2026-01-02 03:00:00');
  });
});

describe('the adversarial join (event_id + created_at)', () => {
  test('distinct browsers at distinct seconds in one hour cannot be isolated to a poster', async () => {
    // Three browsers, three posters, same hour. Written one after another, so a
    // second-precision stamp would differ between them.
    await scan(1, 'pd_hp_a');
    await new Promise((r) => setTimeout(r, 1100));
    await scan(2, 'pd_hp_b');
    await new Promise((r) => setTimeout(r, 1100));
    await scan(3, 'pd_hp_c');

    const rows = await db()
      .prepare(
        `SELECT n.anonymous_id AS who, COUNT(DISTINCT s.poster_deployment_id) AS posters
           FROM scan_node_returns n
           JOIN scan_placement_events s
             ON s.event_id = n.event_id AND s.created_at = n.created_at
          WHERE n.event_id = ?
          GROUP BY n.anonymous_id`
      )
      .bind(EVT)
      .all<{ who: string; posters: number }>();

    expect(rows.results).toHaveLength(3);
    // Every browser matches every poster: the join isolates nobody.
    for (const r of rows.results) expect(r.posters, r.who).toBe(3);
  });

  test('neither table stores a second, whatever the write time', async () => {
    await scan(4, 'pd_hp_a');
    for (const table of ['scan_placement_events', 'scan_node_returns']) {
      const r = await db()
        .prepare(`SELECT DISTINCT created_at AS t FROM ${table} WHERE event_id = ?`)
        .bind(EVT)
        .all<{ t: string }>();
      expect(
        r.results.map((x) => x.t),
        table
      ).toEqual(['2026-10-10 19:00:00']);
    }
  });

  test('a scan processed in a later hour keeps its own bucket hour', async () => {
    await scan(5, 'pd_hp_a', '2020-03-04T05:00');
    const r = await db()
      .prepare('SELECT created_at AS t FROM scan_node_returns WHERE id = ?')
      .bind('snr_hp_5')
      .first<{ t: string }>();
    expect(r?.t).toBe('2020-03-04 05:00:00');
  });
});

describe('migration 0100 on rows already stored', () => {
  /** The migration's own statements, taken from the applied list. */
  function migrationStatements(): string[] {
    const all: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
    return all.filter((s) =>
      /UPDATE\s+scan_(placement_events|node_returns)\s+SET created_at/.test(s)
    );
  }

  test('truncates second-precision rows on both tables, and again does nothing', async () => {
    const stmts = migrationStatements();
    expect(stmts.length).toBe(4);

    await db()
      .prepare(
        `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket, created_at)
         VALUES ('spe_old', ?, 'pd_hp_a', '2026-10-09T18:00', '2026-10-09 18:42:17')`
      )
      .bind(EVT)
      .run();
    await db()
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, anonymous_id, scan_bucket, created_at)
         VALUES ('snr_old', ?, NULL, '2026-10-09T18:00', '2026-10-09 18:42:17'),
                ('snr_odd', ?, NULL, 'bucket-x', '2026-10-09 07:13:59')`
      )
      .bind(EVT, EVT)
      .run();

    for (const pass of [1, 2]) {
      for (const s of stmts) await db().prepare(s).run();
      const rows = await db()
        .prepare(
          `SELECT id, created_at FROM (
             SELECT id, created_at FROM scan_placement_events WHERE event_id = ?
             UNION ALL SELECT id, created_at FROM scan_node_returns WHERE event_id = ?)
           ORDER BY id`
        )
        .bind(EVT, EVT)
        .all<{ id: string; created_at: string }>();
      expect(rows.results, `pass ${pass}`).toEqual([
        { id: 'snr_odd', created_at: '2026-10-09 07:00:00' }, // unexpected bucket: hour of its stamp
        { id: 'snr_old', created_at: '2026-10-09 18:00:00' },
        { id: 'spe_old', created_at: '2026-10-09 18:00:00' },
      ]);
    }
  });
});

describe('nothing else writes the split tables', () => {
  test('only lib/scan-buffer.ts inserts into them', () => {
    const files = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const writers = Object.entries(files)
      .filter(([p]) => /[\\/]src[\\/]/.test(p))
      .filter(([, text]) =>
        /INSERT\s+(OR\s+\w+\s+)?INTO\s+scan_(placement_events|node_returns)\b/i.test(text)
      )
      .map(([p]) => p.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/'));
    expect(writers).toEqual(['src/lib/scan-buffer.ts']);
  });
});

describe('retention reads the hour bucket, not created_at', () => {
  test('a row with an old bucket is swept even when created_at is recent, and the reverse is kept', async () => {
    await db()
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, anonymous_id, scan_bucket, created_at)
         VALUES ('snr_ret_old', ?, NULL, '2020-01-01T00:00', datetime('now')),
                ('snr_ret_new', ?, NULL, strftime('%Y-%m-%dT%H:00', 'now'), '2020-01-01 00:00:00')`
      )
      .bind(EVT, EVT)
      .run();
    const res = await runScanReturnsRetention({
      DB: db(),
      FORMS_DB: (env as unknown as { FORMS_DB: D1Database }).FORMS_DB,
      SCAN_RETURNS_RETENTION_DAYS: '30',
    } as never);
    expect(res.scanReturnsDeleted).toBeGreaterThanOrEqual(1);
    const left = await db()
      .prepare('SELECT id FROM scan_node_returns WHERE event_id = ? ORDER BY id')
      .bind(EVT)
      .all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual(['snr_ret_new']);
  });
});
