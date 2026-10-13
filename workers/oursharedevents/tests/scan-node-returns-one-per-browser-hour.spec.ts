/**
 * OSE-923: scan_node_returns holds one row per browser, event and hour.
 *
 * Never who, only how many. The WHO table is what scan_aggregates.total_scans
 * counts (COUNT(*)). A browser that scanned two posters in one hour left two
 * rows, so the same person counted twice. Migration 0101 adds a UNIQUE index.
 *
 * What moves, on purpose (the before/after characterization below):
 *   total_scans            browser-poster-hours -> browser-hours (goes down)
 * What must not move:
 *   distinct_agent_hashes  the distinct-scanner count
 *   scan_placement_events  per-poster scan counts (dashboards, poster reach)
 *
 * Seen red against 0100 (no index): the second-poster scan adds a WHO row and
 * total_scans is 3, not 2.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { buildScanStatements, type ScanMessage } from '../src/lib/scan-buffer';
import { aggregateScanBuckets } from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const db = () => tenv().DB;

const EVT = 'evt_one_per_browser_hour';
const HOUR = '2026-10-10T19:00';
const key = (n: number) => `snk1_${String(n).padStart(64, '0')}`;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await db().prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

let n = 0;
async function scan(browser: number | null, poster: string, bucket = HOUR): Promise<void> {
  n++;
  const msg = {
    placement_row_id: `spe_opb_${n}`,
    return_row_id: `snr_opb_${n}`,
    event_id: EVT,
    deployment_id: poster,
    anon_id: browser === null ? null : key(browser),
    ua_hash: browser === null ? `ua_${n}` : null,
    country: null,
    scan_bucket: bucket,
  } as unknown as ScanMessage;
  await db().batch(buildScanStatements(db(), msg));
}

async function count(table: string): Promise<number> {
  const r = await db()
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE event_id = ?`)
    .bind(EVT)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

async function aggregate() {
  await db().prepare('DELETE FROM scan_aggregates WHERE event_id = ?').bind(EVT).run();
  await aggregateScanBuckets({ DB: db() } as never);
  return db()
    .prepare('SELECT total_scans, distinct_agent_hashes FROM scan_aggregates WHERE event_id = ?')
    .bind(EVT)
    .first<{ total_scans: number; distinct_agent_hashes: number }>();
}

beforeAll(async () => {
  await applyMigrations();
  await db()
    .prepare(
      `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, start_date, created_at, updated_at)
       VALUES (?, 'b', 'One per browser hour', ?, 'active', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(EVT, EVT)
    .run();
  for (const p of ['pd_opb_a', 'pd_opb_b']) {
    await db()
      .prepare('INSERT OR IGNORE INTO poster_deployments (id, event_id, qr_token) VALUES (?, ?, ?)')
      .bind(p, EVT, `qrt_${p}`)
      .run();
  }
});

beforeEach(async () => {
  await db().prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(EVT).run();
  await db().prepare('DELETE FROM scan_node_returns WHERE event_id = ?').bind(EVT).run();
});

describe('one WHO row per browser, event and hour', () => {
  test('before/after: a second poster in the same hour is one scan, the scanner count is unchanged', async () => {
    await scan(1, 'pd_opb_a');
    await scan(1, 'pd_opb_b'); // same browser, other poster, same hour
    await scan(2, 'pd_opb_a');

    // Before 0101 the WHO table had 3 rows. After: 2 (browser 1 once, browser 2 once).
    expect(await count('scan_node_returns')).toBe(2);
    // Per-poster scans are untouched: all three scans are placed.
    expect(await count('scan_placement_events')).toBe(3);

    const agg = await aggregate();
    expect(agg?.total_scans).toBe(2); // was 3
    expect(agg?.distinct_agent_hashes).toBe(2); // unchanged
  });

  test('the same browser in another hour is another row', async () => {
    await scan(1, 'pd_opb_a', '2026-10-10T19:00');
    await scan(1, 'pd_opb_a', '2026-10-10T20:00');
    expect(await count('scan_node_returns')).toBe(2);
  });

  test('scans with no id (user-agent fallback) are not collapsed', async () => {
    await scan(null, 'pd_opb_a');
    await scan(null, 'pd_opb_a');
    expect(await count('scan_node_returns')).toBe(2);
  });

  test('a direct duplicate insert is refused by the index, not just ignored by the writer', async () => {
    await scan(7, 'pd_opb_a');
    await expect(
      db()
        .prepare(
          `INSERT INTO scan_node_returns (id, event_id, anonymous_id, scan_bucket, created_at)
           VALUES ('snr_dup_direct', ?, ?, ?, '2026-10-10 19:00:00')`
        )
        .bind(EVT, key(7), HOUR)
        .run()
    ).rejects.toThrow(/UNIQUE/i);
  });
});

describe('migration 0101 on rows already stored', () => {
  test('collapses existing duplicates to the earliest row, and again does nothing', async () => {
    const all: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
    const del = all.find((s) => /DELETE\s+FROM\s+scan_node_returns/i.test(s));
    expect(del, 'the migration DELETE is in the applied list').toBeTruthy();

    // Drop the index so duplicates can be seeded as they would exist before 0101.
    await db().prepare('DROP INDEX IF EXISTS idx_snr_event_anon_bucket').run();
    await db()
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, anonymous_id, scan_bucket, created_at)
         VALUES ('snr_b', ?, ?, ?, '2026-10-10 19:00:00'),
                ('snr_a', ?, ?, ?, '2026-10-10 19:00:00'),
                ('snr_c', ?, ?, ?, '2026-10-10 19:00:00'),
                ('snr_nil1', ?, NULL, ?, '2026-10-10 19:00:00'),
                ('snr_nil2', ?, NULL, ?, '2026-10-10 19:00:00')`
      )
      .bind(EVT, key(9), HOUR, EVT, key(9), HOUR, EVT, key(8), HOUR, EVT, HOUR, EVT, HOUR)
      .run();

    for (const pass of [1, 2]) {
      await db().prepare(del!).run();
      const r = await db()
        .prepare('SELECT id FROM scan_node_returns WHERE event_id = ? ORDER BY id')
        .bind(EVT)
        .all<{ id: string }>();
      expect(
        r.results.map((x) => x.id),
        `pass ${pass}`
      ).toEqual([
        'snr_a', // earliest of the browser-9 duplicates
        'snr_c',
        'snr_nil1', // no id: never collapsed
        'snr_nil2',
      ]);
    }
    await db()
      .prepare(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_snr_event_anon_bucket ON scan_node_returns(event_id, anonymous_id, scan_bucket)'
      )
      .run();
  });
});
