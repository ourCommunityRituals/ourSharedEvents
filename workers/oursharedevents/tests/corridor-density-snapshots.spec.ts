/**
 * OSE — corridor_density_snapshots behavioral tests
 *
 * Verifies the append-only snapshot log written alongside every
 * corridor_density_baseline UPSERT during the nightly cron.
 *
 * Coverage:
 *   - A snapshot row is written when refreshCorridorBaselines runs
 *   - Re-running on the same date does NOT create a duplicate (INSERT OR IGNORE)
 *   - Snapshot row values match the baseline values
 *   - The snapshot table is NEVER written by user-facing read API handlers
 *     (static gate: shared-report-builder.ts and shared-report-read.ts)
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  refreshCorridorBaselines,
  type SharedReportMaterializeEnv,
} from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

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

async function clearSnapshotTables(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM corridor_density_snapshots`).run();
  await db.prepare(`DELETE FROM corridor_density_baseline`).run();
  await db.prepare(`DELETE FROM anon_id_returns`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-cds-%'`).run();
  await db.prepare(`DELETE FROM corridors WHERE id LIKE 'test-cds-corr-%'`).run();
  await db.prepare(`DELETE FROM node_hierarchy WHERE id LIKE 'test-cds-node-%'`).run();
}

async function seedCorridorAndEvent(opts: {
  corridorId: string;
  eventId: string;
  startDate: string; // ISO — must be within 90d window
}): Promise<void> {
  const db = tenv().DB;

  await db
    .prepare(
      `INSERT OR IGNORE INTO node_hierarchy
         (id, brand_id, name, level, level_label)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(`test-cds-node-origin`, 'test-brand', 'CDS Origin Node', 4, 'Metro')
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO node_hierarchy
         (id, brand_id, name, level, level_label)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(`test-cds-node-dest`, 'test-brand', 'CDS Dest Node', 4, 'Metro')
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO corridors
         (id, brand_id, name, origin_node_id, destination_node_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      opts.corridorId,
      'test-brand',
      `CDS Corridor ${opts.corridorId}`,
      'test-cds-node-origin',
      'test-cds-node-dest'
    )
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO events
         (id, brand_id, title, slug, status, location, corridor_id, start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      opts.eventId,
      'test-brand',
      `CDS Event ${opts.eventId}`,
      opts.eventId,
      'active',
      'CDS Test Venue',
      opts.corridorId,
      opts.startDate
    )
    .run();
}

async function seedAnonIdReturn(eventId: string, hashSuffix: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const hash = hashSuffix.padStart(32, 'a');
  await tenv()
    .DB.prepare(
      `INSERT OR IGNORE INTO anon_id_returns
         (anon_id_hash, venue_id, first_seen_at, last_seen_at, return_count, computed_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .bind(hash, eventId, nowIso, nowIso, nowIso)
    .run();
}

async function resetForTest(): Promise<void> {
  await applyMigrations();
  await clearSnapshotTables();
}

// Relative date helper: returns an ISO timestamp N days in the past.
// Replaces hardcoded dates that drifted outside the 90-day rolling window
// as wall-clock time advanced past the original authoring date (May 2026).
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400 * 1000).toISOString();
}

beforeAll(async () => {
  await applyMigrations();
});

// ─── Schema gate — corridor_density_snapshots table shape ────────────────────

describe('corridor_density_snapshots: table exists with expected columns', () => {
  test('table has all required columns after migration 0044', async () => {
    await applyMigrations();
    const cols = await tenv()
      .DB.prepare(`PRAGMA table_info(corridor_density_snapshots)`)
      .all<{ name: string }>();
    const colNames = cols.results.map((c) => c.name).sort();
    expect(colNames).toContain('id');
    expect(colNames).toContain('corridor_id');
    expect(colNames).toContain('bucket_dow');
    expect(colNames).toContain('bucket_hour');
    expect(colNames).toContain('snapshot_date');
    expect(colNames).toContain('window_30d_count');
    expect(colNames).toContain('window_90d_count');
    expect(colNames).toContain('computed_at');
  });

  test('table has no per-attendee identity columns', async () => {
    await applyMigrations();
    const cols = await tenv()
      .DB.prepare(`PRAGMA table_info(corridor_density_snapshots)`)
      .all<{ name: string }>();
    const colNames = cols.results.map((c) => c.name);
    expect(colNames).not.toContain('anon_id');
    expect(colNames).not.toContain('anon_id_hash');
    expect(colNames).not.toContain('ip_hash');
    expect(colNames).not.toContain('email');
  });
});

// ─── Behavioral tests — snapshot written alongside baseline ──────────────────

describe('corridor_density_snapshots: written by refreshCorridorBaselines', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('writes a snapshot row when a baseline row is upserted', async () => {
    await seedCorridorAndEvent({
      corridorId: 'test-cds-corr-A',
      eventId: 'test-cds-evt-A',
      startDate: daysAgoIso(30), // 30 days ago — safely within the 90-day rolling window
    });
    await seedAnonIdReturn('test-cds-evt-A', '1');

    const r = await refreshCorridorBaselines({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);

    const snapshotCount = await tenv()
      .DB.prepare(`SELECT COUNT(*) AS c FROM corridor_density_snapshots`)
      .first<{ c: number }>();
    expect(snapshotCount!.c).toBeGreaterThanOrEqual(1);
  });

  test('snapshot row values match the baseline row', async () => {
    await seedCorridorAndEvent({
      corridorId: 'test-cds-corr-B',
      eventId: 'test-cds-evt-B',
      startDate: daysAgoIso(30), // 30 days ago — safely within the 90-day rolling window — dow=4, hour=19
    });
    await seedAnonIdReturn('test-cds-evt-B', '2');
    await seedAnonIdReturn('test-cds-evt-B', '3');

    await refreshCorridorBaselines({ DB: tenv().DB });

    const baseline = await tenv()
      .DB.prepare(
        `SELECT corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count
         FROM corridor_density_baseline
         WHERE corridor_id = ?`
      )
      .bind('test-cds-corr-B')
      .first<{
        corridor_id: string;
        bucket_dow: number;
        bucket_hour: number;
        window_30d_count: number;
        window_90d_count: number;
      }>();
    expect(baseline).not.toBeNull();

    const snapshot = await tenv()
      .DB.prepare(
        `SELECT corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, snapshot_date
         FROM corridor_density_snapshots
         WHERE corridor_id = ?`
      )
      .bind('test-cds-corr-B')
      .first<{
        corridor_id: string;
        bucket_dow: number;
        bucket_hour: number;
        window_30d_count: number;
        window_90d_count: number;
        snapshot_date: string;
      }>();
    expect(snapshot).not.toBeNull();

    expect(snapshot!.corridor_id).toBe(baseline!.corridor_id);
    expect(snapshot!.bucket_dow).toBe(baseline!.bucket_dow);
    expect(snapshot!.bucket_hour).toBe(baseline!.bucket_hour);
    expect(snapshot!.window_30d_count).toBe(baseline!.window_30d_count);
    expect(snapshot!.window_90d_count).toBe(baseline!.window_90d_count);

    const todayDate = new Date().toISOString().slice(0, 10);
    expect(snapshot!.snapshot_date).toBe(todayDate);
  });

  test('re-running on the same date does NOT create a duplicate (INSERT OR IGNORE is idempotent)', async () => {
    await seedCorridorAndEvent({
      corridorId: 'test-cds-corr-C',
      eventId: 'test-cds-evt-C',
      startDate: daysAgoIso(30),
    });
    await seedAnonIdReturn('test-cds-evt-C', '4');

    const sharedEnv: SharedReportMaterializeEnv = { DB: tenv().DB };

    await refreshCorridorBaselines(sharedEnv);
    await refreshCorridorBaselines(sharedEnv);
    await refreshCorridorBaselines(sharedEnv);

    const snapshotCount = await tenv()
      .DB.prepare(`SELECT COUNT(*) AS c FROM corridor_density_snapshots WHERE corridor_id = ?`)
      .bind('test-cds-corr-C')
      .first<{ c: number }>();
    expect(snapshotCount!.c).toBe(1);
  });

  test('snapshot id is deterministic — cds_<corridor>_<dow>_<hour>_<date>', async () => {
    await seedCorridorAndEvent({
      corridorId: 'test-cds-corr-D',
      eventId: 'test-cds-evt-D',
      startDate: daysAgoIso(30),
    });
    await seedAnonIdReturn('test-cds-evt-D', '5');

    await refreshCorridorBaselines({ DB: tenv().DB });

    const todayDate = new Date().toISOString().slice(0, 10);
    const snapshot = await tenv()
      .DB.prepare(`SELECT id FROM corridor_density_snapshots WHERE corridor_id = ?`)
      .bind('test-cds-corr-D')
      .first<{ id: string }>();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.id).toMatch(/^cds_test-cds-corr-D_\d+_\d+_\d{4}-\d{2}-\d{2}$/);
    expect(snapshot!.id).toContain(todayDate);
  });

  test('no snapshot written when baseline UPSERT would have been skipped (zero counts)', async () => {
    await seedCorridorAndEvent({
      corridorId: 'test-cds-corr-E',
      eventId: 'test-cds-evt-E',
      startDate: daysAgoIso(30),
    });
    // No anon_id_returns seeded — zero counts, baseline skips, snapshot skips

    await refreshCorridorBaselines({ DB: tenv().DB });

    const snapshotCount = await tenv()
      .DB.prepare(`SELECT COUNT(*) AS c FROM corridor_density_snapshots WHERE corridor_id = ?`)
      .bind('test-cds-corr-E')
      .first<{ c: number }>();
    expect(snapshotCount!.c).toBe(0);
  });
});

// ─── Static gate — snapshot table is NOT written by user-facing read API ─────

describe('corridor_density_snapshots: read API never writes to snapshot table', () => {
  function loadSource(relPath: string): string | null {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const entry = Object.entries(sources).find(([p]) => p.replace(/\\/g, '/').endsWith(relPath));
    return entry ? entry[1] : null;
  }

  test('shared-report-builder.ts does not INSERT/UPDATE/DELETE corridor_density_snapshots', () => {
    const src = loadSource('src/lib/shared-report-builder.ts');
    expect(src, 'shared-report-builder.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/INSERT.*corridor_density_snapshots/i);
    expect(src!).not.toMatch(/UPDATE.*corridor_density_snapshots/i);
    expect(src!).not.toMatch(/DELETE.*corridor_density_snapshots/i);
  });

  test('shared-report-read.ts does not INSERT/UPDATE/DELETE corridor_density_snapshots', () => {
    const src = loadSource('src/handlers/shared-report-read.ts');
    expect(src, 'shared-report-read.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/INSERT.*corridor_density_snapshots/i);
    expect(src!).not.toMatch(/UPDATE.*corridor_density_snapshots/i);
    expect(src!).not.toMatch(/DELETE.*corridor_density_snapshots/i);
  });

  test('corridor_density_snapshots writes exist ONLY in shared-report.ts (the cron lib)', () => {
    const src = loadSource('src/lib/shared-report.ts');
    expect(src, 'shared-report.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(
      src!,
      'shared-report.ts must INSERT into corridor_density_snapshots — it is the only permitted writer'
    ).toMatch(/INSERT.*corridor_density_snapshots/i);
  });
});
