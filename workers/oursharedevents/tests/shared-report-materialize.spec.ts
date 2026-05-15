/**
 * OSE-272 Session 3 — SharedReport materialization behavioral tests
 *
 * Tests the three cron phases end-to-end against the miniflare D1
 * database with realistic scan + event + sponsor data.
 *
 * Coverage:
 *   - Phase 1: anon_id_returns upsert from scans.anonymous_id
 *   - Phase 2: corridor_density_baseline rolling window refresh
 *   - Phase 3: event_series auto-detector (Q2 hybrid lifecycle)
 *   - Failure-isolation: a phase failure does not abort other phases
 *   - Pepper missing: graceful skip with structured warning, no errors
 *   - Idempotency: re-running the cron over the same data is safe
 *   - Anonymity: no raw anon_id ever persisted; hash determinism preserved
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  materializeAnonIdReturns,
  refreshCorridorBaselines,
  detectEventSeriesClusters,
  type SharedReportMaterializeEnv,
} from '../src/lib/shared-report';
import { runSharedReportMaterialization } from '../src/handlers/shared-report-materialize';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// Real-looking test pepper. NOT the production value — tests use a
// distinct constant so determinism is reproducible across CI runs.
const TEST_PEPPER = 'ose-272-test-pepper-do-not-use-in-prod-deadbeef';

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

async function clearPipelineTables(): Promise<void> {
  // FK-aware delete order:
  //
  //   events.series_id  → event_series.id   (need events.series_id=NULL or events deleted before event_series rows for those events)
  //   event_series.venue_id → events.id     (need event_series rows deleted before events with those IDs)
  //   scans.event_id    → events.id         (need scans deleted before events)
  //   scans.poster_deployment_id → poster_deployments.id
  //   anon_id_returns.venue_id → events.id  (need anon_id_returns deleted before events)
  //   poster_deployments.event_id → events.id (need poster_deployments deleted before events)
  //   corridor_density_baseline.corridor_id → corridors.id
  //   events.corridor_id → corridors.id     (need corridor_id=NULL or events deleted before corridors)
  //
  // Strategy: clear the leaf tables, NULL the forward FKs (events.series_id),
  // then delete events, then delete corridors. This avoids relying on FK
  // suspension (PRAGMA foreign_keys = OFF), which we want preserved for the
  // assertions that exercise FK enforcement.
  const db = tenv().DB;
  await db.prepare(`DELETE FROM anon_id_returns`).run();
  await db.prepare(`DELETE FROM corridor_density_baseline`).run();
  // Break the events → event_series back-reference before deleting event_series
  await db.prepare(`UPDATE events SET series_id = NULL`).run();
  await db.prepare(`DELETE FROM event_series`).run();
  await db.prepare(`DELETE FROM scans`).run();
  await db.prepare(`DELETE FROM poster_deployments WHERE id LIKE 'test-pd-mat-%'`).run();
  // Only clear events we explicitly seed (preserve any pre-seeded events)
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-mat-%'`).run();
  await db.prepare(`DELETE FROM corridors WHERE id LIKE 'test-corr-mat-%'`).run();
  // node_hierarchy is FK-referenced by corridors; clean only test rows AFTER corridors.
  await db.prepare(`DELETE FROM node_hierarchy WHERE id LIKE 'test-node-mat-%'`).run();
}

async function seedEvent(opts: {
  id: string;
  corridor_id?: string | null;
  start_offset_hours?: number; // negative = past
  end_offset_hours?: number;
  location?: string;
  status?: string;
}): Promise<void> {
  const nowMs = Date.now();
  const start =
    opts.start_offset_hours != null
      ? new Date(nowMs + opts.start_offset_hours * 3600_000).toISOString()
      : null;
  const end =
    opts.end_offset_hours != null
      ? new Date(nowMs + opts.end_offset_hours * 3600_000).toISOString()
      : null;
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, corridor_id, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      opts.id,
      'test-brand',
      `Test ${opts.id}`,
      opts.id,
      opts.status ?? 'active',
      opts.location ?? 'Test Venue',
      opts.corridor_id ?? null,
      start,
      end,
      new Date(nowMs).toISOString(),
      new Date(nowMs).toISOString()
    )
    .run();
}

async function seedPosterDeployment(eventId: string): Promise<string> {
  const id = `test-pd-mat-${eventId}`;
  await tenv()
    .DB.prepare(
      `INSERT OR IGNORE INTO poster_deployments
         (id, event_id, qr_token, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    )
    .bind(id, eventId, `qr-${id}`)
    .run();
  return id;
}

async function seedScan(eventId: string, anonId: string | null): Promise<void> {
  const posterId = await seedPosterDeployment(eventId);
  await tenv()
    .DB.prepare(
      `INSERT INTO scans
         (id, event_id, poster_deployment_id, scan_bucket, anonymous_id, created_at)
       VALUES (?, ?, ?, '2026-W20', ?, datetime('now'))`
    )
    .bind(`scan-${crypto.randomUUID()}`, eventId, posterId, anonId)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
});

// Each test re-applies migrations (idempotent) before clearing tables.
// vitest-pool-workers isolates miniflare state per-test in some configs;
// running migrations every time is the safe path. Idempotency is
// guaranteed by `CREATE TABLE IF NOT EXISTS` + the ALTER-table re-run
// guard in applyMigrations.
async function resetForTest(): Promise<void> {
  await applyMigrations();
  await clearPipelineTables();
}

// ─── Phase 1 — anon_id_returns materialization ──────────────────────────────

describe('OSE-272 Phase 1: materializeAnonIdReturns', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('graceful skip when ANON_ID_HASH_PEPPER is missing — no rows, no errors', async () => {
    await seedEvent({ id: 'test-evt-mat-skip', end_offset_hours: -4 });
    await seedScan('test-evt-mat-skip', 'anon_test_skip');
    const r = await materializeAnonIdReturns({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBe(0);
    const count = await tenv()
      .DB.prepare(`SELECT COUNT(*) AS c FROM anon_id_returns`)
      .first<{ c: number }>();
    expect(count!.c).toBe(0);
  });

  test('upserts a row for each distinct anonymous_id at an ended event', async () => {
    await seedEvent({ id: 'test-evt-mat-1', end_offset_hours: -4 });
    await seedScan('test-evt-mat-1', 'anon_aaa');
    await seedScan('test-evt-mat-1', 'anon_bbb');
    await seedScan('test-evt-mat-1', 'anon_aaa'); // duplicate — same event, same anon
    const r = await materializeAnonIdReturns({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    });
    expect(r.errors).toBe(0);
    // Two distinct anons → two rows. The duplicate scan is collapsed by
    // the SELECT DISTINCT in the materializer (PK protects from dup row).
    expect(r.rowsUpserted).toBe(2);
    const rows = await tenv()
      .DB.prepare(`SELECT * FROM anon_id_returns WHERE venue_id = ?`)
      .bind('test-evt-mat-1')
      .all();
    expect(rows.results).toHaveLength(2);
  });

  test('never persists raw anonymous_id — only the hash', async () => {
    await seedEvent({ id: 'test-evt-mat-hash', end_offset_hours: -4 });
    await seedScan('test-evt-mat-hash', 'anon_uniquemarker123');
    await materializeAnonIdReturns({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    });
    const row = await tenv()
      .DB.prepare(`SELECT anon_id_hash FROM anon_id_returns WHERE venue_id = ?`)
      .bind('test-evt-mat-hash')
      .first<{ anon_id_hash: string }>();
    expect(row).not.toBeNull();
    // Must be 32 hex chars
    expect(row!.anon_id_hash).toMatch(/^[a-f0-9]{32}$/);
    // Must NOT contain the raw anon string anywhere
    expect(row!.anon_id_hash).not.toContain('uniquemarker123');
  });

  test('idempotent — re-running on same scans bumps visit_count, not row count', async () => {
    await seedEvent({ id: 'test-evt-mat-idem', end_offset_hours: -4 });
    await seedScan('test-evt-mat-idem', 'anon_idem');
    const env1: SharedReportMaterializeEnv = {
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    };
    await materializeAnonIdReturns(env1);
    await materializeAnonIdReturns(env1);
    await materializeAnonIdReturns(env1);
    const row = await tenv()
      .DB.prepare(`SELECT visit_count FROM anon_id_returns WHERE venue_id = ?`)
      .bind('test-evt-mat-idem')
      .first<{ visit_count: number }>();
    expect(row).not.toBeNull();
    // 3 re-runs on the SAME scan event → visit_count bumps each time
    expect(row!.visit_count).toBe(3);
    // Still exactly one row (PK protects)
    const count = await tenv()
      .DB.prepare(`SELECT COUNT(*) AS c FROM anon_id_returns WHERE venue_id = ?`)
      .bind('test-evt-mat-idem')
      .first<{ c: number }>();
    expect(count!.c).toBe(1);
  });

  test('skips events with NULL anonymous_id scans (no row written)', async () => {
    await seedEvent({ id: 'test-evt-mat-nullanon', end_offset_hours: -4 });
    await seedScan('test-evt-mat-nullanon', null);
    const r = await materializeAnonIdReturns({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBe(0);
  });

  test('skips events outside the lookback window (end_date too old OR too recent)', async () => {
    // Event ended 50 hours ago (older than ceiling): should be skipped
    await seedEvent({ id: 'test-evt-mat-old', end_offset_hours: -50 });
    await seedScan('test-evt-mat-old', 'anon_old');
    // Event ending in 1 hour (still in progress): should be skipped
    await seedEvent({ id: 'test-evt-mat-new', end_offset_hours: 1 });
    await seedScan('test-evt-mat-new', 'anon_new');
    const r = await materializeAnonIdReturns({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    });
    expect(r.rowsUpserted).toBe(0);
  });
});

// ─── Phase 2 — corridor_density_baseline refresh ────────────────────────────

describe('OSE-272 Phase 2: refreshCorridorBaselines', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('skips events without corridor_id', async () => {
    await seedEvent({
      id: 'test-evt-mat-nocorr',
      start_offset_hours: -24,
      end_offset_hours: -22,
    });
    const r = await refreshCorridorBaselines({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBe(0);
  });

  test('emits baseline cells for events with corridor_id', async () => {
    // Seed node_hierarchy + corridors (corridors has NOT NULL FK to node_hierarchy)
    // Schema: id, brand_id, name, origin_node_id, destination_node_id, ...
    // We don't filter on corridor metadata in Phase 2; we only need the FK
    // chain to be satisfied so events.corridor_id can reference a real row.
    const db = tenv().DB;
    await db
      .prepare(
        `INSERT OR IGNORE INTO node_hierarchy
           (id, brand_id, name, level, level_label)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind('test-node-mat-origin', 'test-brand', 'Origin Node', 4, 'Metro')
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO node_hierarchy
           (id, brand_id, name, level, level_label)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind('test-node-mat-dest', 'test-brand', 'Destination Node', 4, 'Metro')
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO corridors
           (id, brand_id, name, origin_node_id, destination_node_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        'test-corr-mat-A',
        'test-brand',
        'Test Corridor A',
        'test-node-mat-origin',
        'test-node-mat-dest'
      )
      .run();

    // Seed an event in that corridor with a Thursday 7 PM start (something deterministic)
    // We use a known past date: 2026-05-07T19:00:00Z is a Thursday
    await db
      .prepare(
        `INSERT INTO events
           (id, brand_id, title, slug, status, location, corridor_id, start_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .bind(
        'test-evt-mat-corr-A',
        'test-brand',
        'Corridor A Trivia',
        'test-evt-mat-corr-A',
        'active',
        'Test Bar A',
        'test-corr-mat-A',
        '2026-05-07T19:00:00Z'
      )
      .run();

    // Seed anon_id_returns rows so the LEFT JOIN produces non-zero counts.
    // Phase 2 deliberately skips cells with zero distinct hashes (storage
    // savings per design); to assert a row IS written, we need at least
    // one hash linked to this event via venue_id.
    const nowIso = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await db
        .prepare(
          `INSERT INTO anon_id_returns
             (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count, computed_at)
           VALUES (?, ?, ?, ?, 1, ?)`
        )
        .bind(`${i}`.padStart(32, 'a'), 'test-evt-mat-corr-A', nowIso, nowIso, nowIso)
        .run();
    }

    const r = await refreshCorridorBaselines({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    // At least one cell written for (corridor, dow, hour)
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);
  });
});

// ─── Phase 3 — event_series auto-detector (Q2 hybrid) ──────────────────────

describe('OSE-272 Phase 3: detectEventSeriesClusters', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('does not emit pending row when cluster < 3 events', async () => {
    // 2 events at same location + dow + hour → below threshold
    await seedEvent({
      id: 'test-evt-mat-cluster1a',
      start_offset_hours: -7 * 24,
      location: 'Beverly Tap',
    });
    await seedEvent({
      id: 'test-evt-mat-cluster1b',
      start_offset_hours: -14 * 24,
      location: 'Beverly Tap',
    });
    const r = await detectEventSeriesClusters({ DB: tenv().DB });
    expect(r.rowsUpserted).toBe(0);
  });

  test('emits pending row when cluster >= 3 events at same (location, dow, hour)', async () => {
    // 3 events spread weekly, same time + location
    for (let i = 1; i <= 3; i++) {
      await tenv()
        .DB.prepare(
          `INSERT INTO events
             (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          `test-evt-mat-cluster-${i}`,
          'test-brand',
          'Thursday Trivia',
          `test-evt-mat-cluster-${i}`,
          'Lincoln Park Tap',
          `2026-04-${String(2 + 7 * i).padStart(2, '0')}T19:00:00Z`
        )
        .run();
    }
    const r = await detectEventSeriesClusters({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBe(1);
    const row = await tenv()
      .DB.prepare(`SELECT * FROM event_series WHERE state = 'pending'`)
      .first<{ series_name: string; day_of_week: number; hour_of_day: number; state: string }>();
    expect(row).not.toBeNull();
    expect(row!.state).toBe('pending');
    expect(row!.series_name).toContain('auto-detected');
  });

  test('idempotent — re-running does NOT emit duplicate pending rows', async () => {
    for (let i = 1; i <= 3; i++) {
      await tenv()
        .DB.prepare(
          `INSERT INTO events
             (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          `test-evt-mat-idem-${i}`,
          'test-brand',
          'Tuesday Bocce',
          `test-evt-mat-idem-${i}`,
          'Idempotent Pub',
          `2026-04-${String(7 + 7 * i).padStart(2, '0')}T20:00:00Z`
        )
        .run();
    }
    await detectEventSeriesClusters({ DB: tenv().DB });
    await detectEventSeriesClusters({ DB: tenv().DB });
    await detectEventSeriesClusters({ DB: tenv().DB });
    const rows = await tenv()
      .DB.prepare(
        `SELECT id FROM event_series WHERE series_name LIKE '%(auto-detected)%' AND series_name LIKE 'Tuesday%'`
      )
      .all();
    expect(rows.results).toHaveLength(1);
  });

  test('respects rejected-cluster suppression (no re-prompting)', async () => {
    // Seed an anchor event + a rejected series at (location, Thu, 19)
    await seedEvent({
      id: 'test-evt-mat-rej-anchor',
      start_offset_hours: -7 * 24,
      location: 'Rejection Tap',
    });
    await tenv()
      .DB.prepare(
        `INSERT INTO event_series
           (id, venue_id, series_name, day_of_week, hour_of_day, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'rejected', datetime('now'), datetime('now'))`
      )
      .bind('rejected-srs', 'test-evt-mat-rej-anchor', 'Old Rejected', 4, 19)
      .run();

    // Now seed 3 more events that would otherwise trigger a pending row
    for (let i = 1; i <= 3; i++) {
      await tenv()
        .DB.prepare(
          `INSERT INTO events
             (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          `test-evt-mat-rej-${i}`,
          'test-brand',
          'Thursday Trivia',
          `test-evt-mat-rej-${i}`,
          'Rejection Tap',
          `2026-04-${String(2 + 7 * i).padStart(2, '0')}T19:00:00Z`
        )
        .run();
    }

    const r = await detectEventSeriesClusters({ DB: tenv().DB });
    // The anchor's venue_id matches the rejected row's venue_id; clustering
    // groups by location string and anchor=MIN(id). Since `test-evt-mat-rej-anchor`
    // has the lower id timestamp, anchor will be it. Rejection should suppress
    // pending emission at (anchor_event_id=test-evt-mat-rej-anchor, dow=4, hour=19).
    const pendingRows = await tenv()
      .DB.prepare(
        `SELECT id FROM event_series
           WHERE state = 'pending' AND venue_id = ?`
      )
      .bind('test-evt-mat-rej-anchor')
      .all();
    expect(pendingRows.results).toHaveLength(0);
    // The skipped count reflects suppression
    expect(r.rowsSkipped).toBeGreaterThanOrEqual(1);
  });
});

// ─── Orchestrator — runSharedReportMaterialization ──────────────────────────

describe('OSE-272 Session 3: runSharedReportMaterialization (cron orchestrator)', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('runs all 3 phases and returns aggregated result shape', async () => {
    const r = await runSharedReportMaterialization({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    });
    expect(r.phases).toHaveLength(3);
    expect(r.phases.map((p) => p.phase)).toEqual([
      'anon_id_returns',
      'corridor_density_baseline',
      'event_series_detector',
    ]);
    expect(r.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  test('reports ok=true when zero errors across all phases (empty DB)', async () => {
    const r = await runSharedReportMaterialization({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    });
    expect(r.ok).toBe(true);
    expect(r.totalErrors).toBe(0);
  });

  test('continues running phases even if pepper is missing (Phase 1 silently skips)', async () => {
    await seedEvent({ id: 'test-evt-mat-orch', end_offset_hours: -4 });
    await seedScan('test-evt-mat-orch', 'anon_orch');
    const r = await runSharedReportMaterialization({ DB: tenv().DB });
    // Phase 1 noops gracefully (pepper missing); Phases 2-3 still run
    expect(r.phases).toHaveLength(3);
    expect(r.totalErrors).toBe(0);
    expect(r.phases[0].rowsUpserted).toBe(0); // anon_id_returns skipped
  });
});
