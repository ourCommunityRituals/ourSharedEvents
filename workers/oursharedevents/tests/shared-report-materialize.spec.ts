/**
 * OSE-272 Session 3 — SharedReport materialization behavioral tests
 *
 * Tests the three cron phases end-to-end against the miniflare D1
 * database with realistic scan + event + sponsor data.
 *
 * Coverage:
 *   - Phase 1 (anon_id_returns) retired by OSE-2214: no per-phone row is written
 *   - Phase 2: corridor_density_baseline rolling window refresh
 *   - Phase 3: event_series auto-detector (Q2 hybrid lifecycle)
 *   - Failure-isolation: a phase failure does not abort other phases
 *   - Pepper missing: graceful skip with structured warning, no errors
 *   - Idempotency: re-running the cron over the same data is safe
 *   - Anonymity: no raw anon_id ever persisted; hash determinism preserved
 */

import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  aggregateScanBuckets,
  refreshCorridorBaselines,
  detectEventSeriesClusters,
  type SharedReportMaterializeEnv,
} from '../src/lib/shared-report';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { runSharedReportMaterialization } from '../src/handlers/shared-report-materialize';
import { seedPosterHour } from './helpers/seed-poster-hours';

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
  //   scan_node_returns.event_id → events.id (need cleared before events)
  //   scan_placement_events.event_id → events.id; .poster_deployment_id → poster_deployments.id
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
  // corridor_density_snapshots references corridors via FK — must be cleared
  // before corridors (migration 0044 appends snapshot rows alongside baselines).
  await db.prepare(`DELETE FROM corridor_density_snapshots`).run();
  await db.prepare(`DELETE FROM corridor_density_baseline`).run();
  // scan_aggregates references events(id) via FK — must clear before events.
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE 'test-evt-mat-%'`).run();
  // Break the events → event_series back-reference before deleting event_series
  await db.prepare(`UPDATE events SET series_id = NULL`).run();
  await db.prepare(`DELETE FROM event_series`).run();
  await db.prepare(`DELETE FROM scan_placement_events`).run();
  await db.prepare(`DELETE FROM scan_node_returns`).run();
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

// OSE-798: scan-bucket aggregation reads the SESSION side
// (scan_node_returns: anonymous_id / user_agent_hash / country_code, keyed by
// event_id + scan_bucket). No poster_deployment_id lives on this side, so we
// seed scan_node_returns only — the placement table is irrelevant here.
async function seedScan(
  eventId: string,
  anonId: string | null,
  bucket = '2026-W20'
): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO scan_node_returns
         (id, event_id, anonymous_id, scan_bucket, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
    .bind(`snr-${crypto.randomUUID()}`, eventId, anonId, bucket)
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
/**
 * Seeds `n` scans (default five, K) in one hour at a poster of its own. OSE-1784
 * (owner, 2026-11-23, "posters too"): the corridor baseline adds up each
 * event's published poster figure, so an event a test expects in the baseline
 * needs a poster-hour of K scans, and `n` scans there count as `n` rounded down
 * to a multiple of 5. OSE-2214: no anon_id_returns row is seeded.
 */
async function seedReturners(venueId: string, prefix: string, n = 5): Promise<void> {
  await seedPosterHour(tenv().DB, venueId, 19, n, `test-pd-mat-${venueId}-${prefix}`);
}

async function resetForTest(): Promise<void> {
  await applyMigrations();
  await clearPipelineTables();
}

// ─── Phase 1 — retired (OSE-2214) ───────────────────────────────────────────
//
// The nightly job no longer hashes phones into anon_id_returns: OSE counts
// scans of the code, never people (owner, 2026-11-23). These guard that a
// legacy id left in scan_node_returns still produces no per-phone row.

describe('OSE-2214: the nightly job writes no per-phone return row', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('scans carrying a legacy phone id at an ended event write no anon_id_returns row', async () => {
    await seedEvent({ id: 'test-evt-mat-retired', start_offset_hours: -6, end_offset_hours: -4 });
    for (let i = 0; i < 6; i++) await seedScan('test-evt-mat-retired', `anon_legacy_${i}`);
    const r = await runSharedReportMaterialization({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    });
    expect(r.totalErrors).toBe(0);
    expect(r.phases.map((p) => p.phase)).not.toContain('anon_id_returns');
    const rows = await tenv()
      .DB.prepare(`SELECT COUNT(*) AS n FROM anon_id_returns`)
      .first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  test('the scan roll-up clears a phone id or browser hash an older Worker wrote after 0119', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-late', start_offset_hours: -24 });
    await db
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, scan_bucket, anonymous_id, user_agent_hash, created_at)
         VALUES ('snr-late-1', 'test-evt-mat-late', '2026-11-24T10:00', ?, 'ua-hash', datetime('now'))`
      )
      .bind(`snk1_${'ab'.repeat(32)}`)
      .run();
    await aggregateScanBuckets({ DB: db });
    const row = await db
      .prepare(
        `SELECT anonymous_id, user_agent_hash FROM scan_node_returns WHERE id = 'snr-late-1'`
      )
      .first<{ anonymous_id: string | null; user_agent_hash: string | null }>();
    expect(row).toEqual({ anonymous_id: null, user_agent_hash: null });
  });

  test('the scan roll-up counts every scan and tells no browser apart', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-nodist', start_offset_hours: -24 * 2 });
    const bucket = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 13) + ':00';
    for (const [id, anon] of [
      ['snr-nd-1', 'anon_x'],
      ['snr-nd-2', 'anon_y'],
      ['snr-nd-3', null],
    ] as const) {
      await db
        .prepare(
          `INSERT INTO scan_node_returns (id, event_id, scan_bucket, anonymous_id, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        )
        .bind(id, 'test-evt-mat-nodist', bucket, anon)
        .run();
    }
    await aggregateScanBuckets({ DB: db });
    const row = await db
      .prepare(`SELECT total_scans, distinct_agent_hashes FROM scan_aggregates WHERE event_id = ?`)
      .bind('test-evt-mat-nodist')
      .first<{ total_scans: number; distinct_agent_hashes: number }>();
    expect(row!.total_scans).toBe(3);
    expect(row!.distinct_agent_hashes).toBe(0);
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

    // Use a relative date (30 days ago) so the event stays within the 90-day
    // rolling window regardless of when CI runs. The hardcoded 2026-05-07
    // date drifted outside the window as wall-clock time advanced past Aug 2026.
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
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
        thirtyDaysAgoIso
      )
      .run();

    // Seed anon_id_returns rows so the LEFT JOIN produces non-zero counts.
    // Phase 2 deliberately skips cells with zero distinct hashes (storage
    // savings per design); to assert a row IS written, we need at least
    // one hash linked to this event via venue_id.
    const nowIso = new Date().toISOString();
    // Five people (K) at a poster: the baseline adds up published poster
    // figures (OSE-1784), so a poster-hour of 5 is what puts the event in it.
    await seedPosterHour(db, 'test-evt-mat-corr-A', 19, 5, 'test-pd-mat-corr-A');
    for (let i = 0; i < 5; i++) {
      await db
        .prepare(
          `INSERT INTO anon_id_returns
             (anon_id_hash, venue_id, first_seen_at, last_seen_at, return_count, computed_at)
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
    // 3 events spread weekly, same time + location — relative dates so they stay
    // within the SERIES_DETECTOR_LOOKBACK_DAYS (56 d) window as time passes.
    for (let i = 1; i <= 3; i++) {
      await seedEvent({
        id: `test-evt-mat-cluster-${i}`,
        start_offset_hours: -(7 * i * 24),
        location: 'Lincoln Park Tap',
      });
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
    // Relative dates — same logic as the cluster test above.
    for (let i = 1; i <= 3; i++) {
      await seedEvent({
        id: `test-evt-mat-idem-${i}`,
        start_offset_hours: -(7 * i * 24),
        location: 'Idempotent Pub',
      });
    }
    await detectEventSeriesClusters({ DB: tenv().DB });
    await detectEventSeriesClusters({ DB: tenv().DB });
    await detectEventSeriesClusters({ DB: tenv().DB });
    const rows = await tenv()
      .DB.prepare(`SELECT id FROM event_series WHERE series_name LIKE '%(auto-detected)%'`)
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
    // Derive day_of_week + hour_of_day from the anchor's actual start_date so
    // the rejected series matches whatever dow/hour the relative seed lands on.
    await tenv()
      .DB.prepare(
        `INSERT INTO event_series
           (id, venue_id, series_name, day_of_week, hour_of_day, state, created_at, updated_at)
         SELECT ?, ?, ?,
           CAST(strftime('%w', start_date) AS INTEGER),
           CAST(strftime('%H', start_date) AS INTEGER),
           'rejected', datetime('now'), datetime('now')
         FROM events WHERE id = ?`
      )
      .bind('rejected-srs', 'test-evt-mat-rej-anchor', 'Old Rejected', 'test-evt-mat-rej-anchor')
      .run();

    // Seed 3 more events at the same location — relative dates within the lookback window.
    for (let i = 1; i <= 3; i++) {
      await seedEvent({
        id: `test-evt-mat-rej-${i}`,
        start_offset_hours: -(7 * i * 24),
        location: 'Rejection Tap',
      });
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

// ─── OSE-631: refreshCorridorBaselines — h3_res7 COALESCE path ──────────────
//
// BE-24b (migration 0046) introduced COALESCE(h3_res7, corridor_id) so events
// with h3_res7 directly use the H3 cell string as the corridor key — no FK
// to the corridors table required. The existing Phase 2 tests only seed
// events with corridor_id (the legacy path). These three tests cover the
// new path and verify COALESCE priority.

describe('OSE-631: refreshCorridorBaselines — h3_res7 COALESCE path', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('h3_res7-only event (corridor_id=NULL) uses h3_res7 as the corridor key', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-h3-only', start_offset_hours: -24 * 10 });
    await db
      .prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`)
      .bind('872664544ffffff', 'test-evt-mat-h3-only')
      .run();
    await seedReturners('test-evt-mat-h3-only', 'a');

    const r = await refreshCorridorBaselines({ DB: db });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);

    // Baseline row must be stored under the h3 cell string, not a corridors FK
    const row = await db
      .prepare(`SELECT corridor_id FROM corridor_density_baseline WHERE corridor_id = ?`)
      .bind('872664544ffffff')
      .first<{ corridor_id: string }>();
    expect(row).not.toBeNull();
    expect(row!.corridor_id).toBe('872664544ffffff');
  });

  test('OSE-616: one cell in two spellings is ONE lowercase baseline row; stale uppercase rows are removed', async () => {
    const db = tenv().DB;
    const cell = '872664544ffffff';
    // Same start instant → same (dow, hour) bucket; one event stores the cell uppercased.
    const startIso = new Date(Date.now() - 24 * 10 * 3600_000).toISOString();
    for (const [id, spelling, anon] of [
      ['test-evt-mat-case-lo', cell, 'b'],
      ['test-evt-mat-case-up', cell.toUpperCase(), 'c'],
    ] as const) {
      await seedEvent({ id, start_offset_hours: -24 * 10 });
      await db
        .prepare(`UPDATE events SET h3_res7 = ?, start_date = ? WHERE id = ?`)
        .bind(spelling, startIso, id)
        .run();
      await seedReturners(id, anon);
    }
    // A stale row left under the uppercase spelling by an earlier run, and a
    // legacy key that only LOOKS H3-shaped (15 chars, leading 8, not lowercase).
    for (const key of [cell.toUpperCase(), '8NORTH-CORRIDOR']) {
      await db
        .prepare(
          `INSERT INTO corridor_density_baseline
             (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
           VALUES (?, 0, 0, 1, 1, '2026-01-01T00:00:00.000Z')`
        )
        .bind(key)
        .run();
    }

    const r = await refreshCorridorBaselines({ DB: db });
    expect(r.errors).toBe(0);

    const rows = await db
      .prepare(
        `SELECT corridor_id, window_90d_count FROM corridor_density_baseline
           WHERE LOWER(corridor_id) = ?`
      )
      .bind(cell)
      .all<{ corridor_id: string; window_90d_count: number }>();
    expect(rows.results).toEqual([{ corridor_id: cell, window_90d_count: 10 }]);
    // Not a real cell → not ours to delete; the export withholds it instead.
    const legacy = await db
      .prepare(`SELECT COUNT(*) AS n FROM corridor_density_baseline WHERE corridor_id = ?`)
      .bind('8NORTH-CORRIDOR')
      .first<{ n: number }>();
    expect(legacy?.n).toBe(1);
    await db
      .prepare(`DELETE FROM corridor_density_baseline WHERE corridor_id = '8NORTH-CORRIDOR'`)
      .run();
  });

  // ADR-026 rule B (OSE-1946). The report shows an event's own count
  // (this_event_count) beside the baseline of its bucket. If the bucket also
  // held an event whose own count is withheld, the difference would name it.
  // Since OSE-1784 the baseline is the sum of published poster figures: the
  // 11-person event adds the 10 it publishes, an event under K adds nothing, an
  // event of exactly K adds 5 (pair).
  test.each([
    [4, 10],
    [5, 15],
  ])(
    'rule B: a bucket of an 11-person event (published 10) and a %i-person event stores %i',
    async (other, expected) => {
      const db = tenv().DB;
      const cell = '872664544ffffff';
      const startIso = new Date(Date.now() - 24 * 10 * 3600_000).toISOString();
      const nowIso = new Date().toISOString();
      for (const [id, people, prefix] of [
        ['test-evt-mat-ruleb-pub', 11, 'd'],
        ['test-evt-mat-ruleb-other', other, 'e'],
      ] as const) {
        await seedEvent({ id, start_offset_hours: -24 * 10 });
        await db
          .prepare(`UPDATE events SET h3_res7 = ?, start_date = ? WHERE id = ?`)
          .bind(cell, startIso, id)
          .run();
        await seedPosterHour(db, id, 19, people, `test-pd-mat-${id}`);
        for (let i = 0; i < people; i++) {
          await db
            .prepare(
              `INSERT INTO anon_id_returns
                 (anon_id_hash, venue_id, first_seen_at, last_seen_at, return_count, computed_at)
               VALUES (?, ?, ?, ?, 1, ?)`
            )
            .bind(
              `${prefix}${String(i).padStart(2, '0')}`.padEnd(32, '0'),
              id,
              nowIso,
              nowIso,
              nowIso
            )
            .run();
        }
      }

      const r = await refreshCorridorBaselines({ DB: db });
      expect(r.errors).toBe(0);
      const row = await db
        .prepare(
          `SELECT window_30d_count, window_90d_count FROM corridor_density_baseline
            WHERE corridor_id = ?`
        )
        .bind(cell)
        .first<{ window_30d_count: number; window_90d_count: number }>();
      expect(row).toEqual({ window_30d_count: expected, window_90d_count: expected });
    }
  );

  // Rule B must also hold for a row an earlier run left behind. A bucket whose
  // events are all withheld now counts 0; skipping it kept the old count, which
  // the report still read: a baseline made only of withheld events (three of 4
  // people publishing 10). The bucket must hold no row. An event of K rewrites it.
  // @born-red TL-094 | method: deliberate-fixture-break | date: 2026-11-10
  test.each([
    [4, null],
    [5, { window_30d_count: 5, window_90d_count: 5 }],
  ])(
    'rule B: a stored baseline of 15 over a lone %i-person event becomes %j',
    async (people, expected) => {
      const db = tenv().DB;
      const cell = '872664544ffffff';
      const startIso = new Date(Date.now() - 24 * 10 * 3600_000).toISOString();
      const start = new Date(startIso);
      const id = 'test-evt-mat-ruleb-stale';
      await seedEvent({ id, start_offset_hours: -24 * 10 });
      await db
        .prepare(`UPDATE events SET h3_res7 = ?, start_date = ? WHERE id = ?`)
        .bind(cell, startIso, id)
        .run();
      await seedReturners(id, 'f', people);
      await db
        .prepare(
          `INSERT INTO corridor_density_baseline
             (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
           VALUES (?, ?, ?, 15, 15, '2026-01-01T00:00:00.000Z')`
        )
        .bind(cell, start.getUTCDay(), start.getUTCHours())
        .run();

      const r = await refreshCorridorBaselines({ DB: db });
      expect(r.errors).toBe(0);
      const row = await db
        .prepare(
          `SELECT window_30d_count, window_90d_count FROM corridor_density_baseline
            WHERE corridor_id = ? AND bucket_dow = ? AND bucket_hour = ?`
        )
        .bind(cell, start.getUTCDay(), start.getUTCHours())
        .first<{ window_30d_count: number; window_90d_count: number }>();
      expect(row).toEqual(expected);
    }
  );

  test('h3_res7 wins over corridor_id when both are set (COALESCE left-priority)', async () => {
    const db = tenv().DB;
    await db
      .prepare(
        `INSERT OR IGNORE INTO node_hierarchy (id, brand_id, name, level, level_label)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind('test-node-mat-coalesce', 'test-brand', 'Coalesce Node', 4, 'Metro')
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO corridors (id, brand_id, name, origin_node_id, destination_node_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        'test-corr-mat-coalesce',
        'test-brand',
        'Coalesce Corridor',
        'test-node-mat-coalesce',
        'test-node-mat-coalesce'
      )
      .run();
    await seedEvent({
      id: 'test-evt-mat-coalesce',
      corridor_id: 'test-corr-mat-coalesce',
      start_offset_hours: -24 * 10,
    });
    // Both h3_res7 and corridor_id are set — COALESCE must pick h3_res7
    await db
      .prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`)
      .bind('872664544ffffff', 'test-evt-mat-coalesce')
      .run();
    await seedReturners('test-evt-mat-coalesce', 'b');

    const r = await refreshCorridorBaselines({ DB: db });
    expect(r.errors).toBe(0);

    // Row stored under h3_res7 key
    const h3Row = await db
      .prepare(`SELECT corridor_id FROM corridor_density_baseline WHERE corridor_id = ?`)
      .bind('872664544ffffff')
      .first<{ corridor_id: string }>();
    expect(h3Row).not.toBeNull();

    // No row stored under the legacy corridor_id key — COALESCE chose h3
    const legacyRow = await db
      .prepare(`SELECT corridor_id FROM corridor_density_baseline WHERE corridor_id = ?`)
      .bind('test-corr-mat-coalesce')
      .first();
    expect(legacyRow).toBeNull();
  });

  test('legacy corridor_id-only event still produces a baseline row (backward compat)', async () => {
    const db = tenv().DB;
    await db
      .prepare(
        `INSERT OR IGNORE INTO node_hierarchy (id, brand_id, name, level, level_label)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind('test-node-mat-legacy', 'test-brand', 'Legacy Node', 4, 'Metro')
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO corridors (id, brand_id, name, origin_node_id, destination_node_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        'test-corr-mat-legacy',
        'test-brand',
        'Legacy Corridor',
        'test-node-mat-legacy',
        'test-node-mat-legacy'
      )
      .run();
    await seedEvent({
      id: 'test-evt-mat-legacy-compat',
      corridor_id: 'test-corr-mat-legacy',
      start_offset_hours: -24 * 10,
    });
    await seedReturners('test-evt-mat-legacy-compat', 'c');

    const r = await refreshCorridorBaselines({ DB: db });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);

    const row = await db
      .prepare(`SELECT corridor_id FROM corridor_density_baseline WHERE corridor_id = ?`)
      .bind('test-corr-mat-legacy')
      .first<{ corridor_id: string }>();
    expect(row).not.toBeNull();
    expect(row!.corridor_id).toBe('test-corr-mat-legacy');
  });

  // OSE-631 (mutation-hardening). The three tests above assert WHICH key a
  // baseline row lands under, but none assert the window COUNTS — so a mutation
  // that points the 30-day window at the 90-day floor (making the two counts
  // identical), or otherwise corrupts the rolling-window arithmetic, survives
  // the whole suite. The 30d-vs-90d split is the entire product of this table,
  // so pin it: an event aged inside the 31–90 day band populates the 90-day
  // window while leaving the 30-day window empty.
  test('rolling windows split — 45-day-old event: window_30d_count=0, window_90d_count=5 (6 people at a poster publish 5)', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-window-split', start_offset_hours: -45 * 24 });
    await db
      .prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`)
      .bind('872664540ffffff', 'test-evt-mat-window-split')
      .run();
    // Six DISTINCT anon hashes (over K, so rule B counts the event; not five, so
    // a count that is only the floor cannot pass) → the 90-day window counts 6.
    await seedReturners('test-evt-mat-window-split', 'd', 6);

    const r = await refreshCorridorBaselines({ DB: db });
    expect(r.errors).toBe(0);
    // The row is still written — the 90-day window is non-empty even though the
    // 30-day window is 0 (this also kills the skip-condition &&→|| mutant).
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);

    const row = await db
      .prepare(
        `SELECT window_30d_count, window_90d_count
           FROM corridor_density_baseline WHERE corridor_id = ?`
      )
      .bind('872664540ffffff')
      .first<{ window_30d_count: number; window_90d_count: number }>();
    expect(row).not.toBeNull();
    expect(row!.window_30d_count).toBe(0);
    expect(row!.window_90d_count).toBe(5);
  });
});

// ─── OSE-634: SRE-OBS-01 — CORRIDOR_BASELINE_REFRESH_COMPLETE log ────────────

describe('OSE-634: refreshCorridorBaselines — CORRIDOR_BASELINE_REFRESH_COMPLETE structured log', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('OSE-634 | SRE-OBS-01 | emits CORRIDOR_BASELINE_REFRESH_COMPLETE log on every run', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await refreshCorridorBaselines({ DB: tenv().DB });
      const calls = consoleSpy.mock.calls.map((c) => {
        try {
          return JSON.parse(String(c[0]));
        } catch {
          return null;
        }
      });
      const completionLog = calls.find((c) => c?.type === 'CORRIDOR_BASELINE_REFRESH_COMPLETE');
      expect(completionLog, 'CORRIDOR_BASELINE_REFRESH_COMPLETE log was not emitted').toBeDefined();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('OSE-634 | SRE-OBS-01 | completion log contains required SRE fields', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await refreshCorridorBaselines({ DB: tenv().DB });
      const calls = consoleSpy.mock.calls.map((c) => {
        try {
          return JSON.parse(String(c[0]));
        } catch {
          return null;
        }
      });
      const log = calls.find((c) => c?.type === 'CORRIDOR_BASELINE_REFRESH_COMPLETE');
      expect(typeof log.rows_upserted).toBe('number');
      expect(typeof log.rows_skipped).toBe('number');
      expect(typeof log.errors).toBe('number');
      expect(typeof log.duration_ms).toBe('number');
      expect(log.duration_ms).toBeGreaterThanOrEqual(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('OSE-634 | SRE-OBS-01 | completion log emitted even when no corridors exist (empty DB)', async () => {
    // Ensure no corridor/event data interferes
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const r = await refreshCorridorBaselines({ DB: tenv().DB });
      expect(r.errors).toBe(0);
      const calls = consoleSpy.mock.calls.map((c) => {
        try {
          return JSON.parse(String(c[0]));
        } catch {
          return null;
        }
      });
      const log = calls.find((c) => c?.type === 'CORRIDOR_BASELINE_REFRESH_COMPLETE');
      expect(log).toBeDefined();
      expect(log.rows_upserted).toBe(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ─── OSE-634: SRE-OBS-01 — the run's summary line ───────────────────────────
//
// SHARED_REPORT_MATERIALIZE_COMPLETE is the materialization summary: one line a
// run, written whatever the phases found, so a quiet healthy run and a broken
// run read differently. It is aggregate-only: no event, cell or person is named
// in it, and a counter that counts people or their scans is withheld under the
// floor (AGENTS.md invariant 2).

const SUMMARY_KEYS = [
  'count_floor',
  'ok',
  'phases',
  'timestamp',
  'total_duration_ms',
  'total_errors',
  'type',
];
const SUMMARY_PHASE_KEYS = [
  'duration_ms',
  'errors',
  'events_processed',
  'phase',
  'rows_skipped',
  'rows_upserted',
];

interface SummaryPhase {
  phase: string;
  events_processed: number;
  rows_upserted: number | null;
  rows_skipped: number | null;
  errors: number;
  duration_ms: number;
}

/** Runs `fn` and returns every structured console.log line of the given type. */
async function logLinesOf(
  type: string,
  fn: () => Promise<unknown>
): Promise<Record<string, unknown>[]> {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await fn();
    const lines: Record<string, unknown>[] = [];
    for (const call of spy.mock.calls) {
      // One argument only: a second one would be an unsealed way out.
      expect(call).toHaveLength(1);
      try {
        const parsed = JSON.parse(String(call[0])) as Record<string, unknown>;
        if (parsed.type === type) lines.push(parsed);
      } catch {
        // not a structured line
      }
    }
    return lines;
  } finally {
    spy.mockRestore();
    errSpy.mockRestore();
  }
}

function phaseOf(line: Record<string, unknown>, name: string): SummaryPhase {
  const found = (line.phases as SummaryPhase[]).find((p) => p.phase === name);
  expect(found, `phase ${name} is missing from the summary line`).toBeDefined();
  return found!;
}

describe('OSE-634: runSharedReportMaterialization — the summary line', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('OSE-634 | SRE-OBS-01 | nothing in the window | one summary line, ok, every phase at zero', async () => {
    const before = Date.now();
    const lines = await logLinesOf('SHARED_REPORT_MATERIALIZE_COMPLETE', () =>
      runSharedReportMaterialization({ DB: tenv().DB, ANON_ID_HASH_PEPPER: TEST_PEPPER })
    );
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(Object.keys(line).sort()).toEqual(SUMMARY_KEYS);
    expect(line.ok).toBe(true);
    expect(line.total_errors).toBe(0);
    expect(line.count_floor).toBe(5);
    expect(typeof line.total_duration_ms).toBe('number');
    const at = Date.parse(String(line.timestamp));
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    const phases = line.phases as SummaryPhase[];
    expect(phases.map((p) => p.phase)).toEqual([
      'scan_aggregation',
      'h3_cell_backfill',
      'corridor_density_baseline',
      'event_series_detector',
    ]);
    for (const p of phases) {
      expect(Object.keys(p).sort()).toEqual(SUMMARY_PHASE_KEYS);
      // A healthy empty run says zero events and zero errors, in numbers.
      expect(p.events_processed).toBe(0);
      expect(p.errors).toBe(0);
      expect(p.duration_ms).toBeGreaterThanOrEqual(0);
    }
    // Rows that are places or events are exact, so zero reads as zero.
    expect(phaseOf(line, 'corridor_density_baseline').rows_upserted).toBe(0);
    expect(phaseOf(line, 'h3_cell_backfill').rows_upserted).toBe(0);
    expect(phaseOf(line, 'event_series_detector').rows_upserted).toBe(0);
    expect(phaseOf(line, 'scan_aggregation').rows_upserted).toBe(0);
  });

  test('OSE-634 | SRE-OBS-01 | seeded run | the summary and the baseline line are both written', async () => {
    await seedEvent({
      id: 'test-evt-mat-sum',
      start_offset_hours: -6,
      end_offset_hours: -4,
    });
    for (let i = 0; i < 6; i++) await seedScan('test-evt-mat-sum', `anon_sum_${i}`);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let types: unknown[];
    let summary: Record<string, unknown> | undefined;
    try {
      const r = await runSharedReportMaterialization({
        DB: tenv().DB,
        ANON_ID_HASH_PEPPER: TEST_PEPPER,
      });
      expect(r.totalErrors).toBe(0);
      const parsed = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
      types = parsed.map((l) => l.type);
      summary = parsed.find((l) => l.type === 'SHARED_REPORT_MATERIALIZE_COMPLETE');
    } finally {
      spy.mockRestore();
    }
    expect(types.filter((t) => t === 'CORRIDOR_BASELINE_REFRESH_COMPLETE')).toHaveLength(1);
    expect(types.filter((t) => t === 'SHARED_REPORT_MATERIALIZE_COMPLETE')).toHaveLength(1);
    // The summary is the last word of the run.
    expect(types[types.length - 1]).toBe('SHARED_REPORT_MATERIALIZE_COMPLETE');
    // OSE-2214: no phase counts people; the scan roll-up wrote one hour row.
    expect((summary!.phases as SummaryPhase[]).map((p) => p.phase)).not.toContain(
      'anon_id_returns'
    );
    expect(phaseOf(summary!, 'scan_aggregation').rows_upserted).toBe(1);
  });

  test('OSE-634 | SRE-OBS-01 | never who | a people counter under the floor is withheld, not zero and not exact', async () => {
    await seedEvent({
      id: 'test-evt-mat-few',
      start_offset_hours: -6,
      end_offset_hours: -4,
    });
    for (let i = 0; i < 3; i++) await seedScan('test-evt-mat-few', `anon_few_${i}`);
    let result: Awaited<ReturnType<typeof runSharedReportMaterialization>> | undefined;
    const lines = await logLinesOf('SHARED_REPORT_MATERIALIZE_COMPLETE', async () => {
      result = await runSharedReportMaterialization({
        DB: tenv().DB,
        ANON_ID_HASH_PEPPER: TEST_PEPPER,
      });
    });
    expect(result!.totalErrors).toBe(0);
    // OSE-2214: the per-phone phase is gone, so no people counter is written.
    expect((lines[0].phases as SummaryPhase[]).map((p) => p.phase)).not.toContain(
      'anon_id_returns'
    );
    // Scans skipped by the roll-up are people's actions: under the floor the
    // line gives null, never 0 and never the exact number.
    expect(phaseOf(lines[0], 'scan_aggregation').rows_skipped).toBeNull();
    // No event is named anywhere in the line.
    expect(JSON.stringify(lines[0])).not.toContain('test-evt-mat-few');
  });

  test('OSE-634 | SRE-OBS-01 | a phase fails | ok is false and the other phases are still reported', async () => {
    const real = tenv().DB;
    const failing = new Proxy(real, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (/corridor_density_baseline/.test(sql)) throw new Error('injected failure');
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const lines = await logLinesOf('SHARED_REPORT_MATERIALIZE_COMPLETE', () =>
      runSharedReportMaterialization({ DB: failing, ANON_ID_HASH_PEPPER: TEST_PEPPER })
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].ok).toBe(false);
    expect(lines[0].total_errors).toBeGreaterThanOrEqual(1);
    expect((lines[0].phases as SummaryPhase[]).length).toBe(4);
    expect(phaseOf(lines[0], 'corridor_density_baseline').errors).toBeGreaterThanOrEqual(1);
    expect(phaseOf(lines[0], 'event_series_detector').errors).toBe(0);
  });
});

describe('OSE-634: refreshCorridorBaselines — which kind of key the baseline was built from', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('OSE-634 | SRE-OBS-01 | an H3 key and no legacy key | the line counts one and zero', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-h3a', start_offset_hours: -24 * 3 });
    await seedEvent({ id: 'test-evt-mat-h3b', start_offset_hours: -24 * 4 });
    // Two events, one cell (one of them stored in capitals): one key.
    await db
      .prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`)
      .bind('872664540ffffff', 'test-evt-mat-h3a')
      .run();
    await db
      .prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`)
      .bind('872664540FFFFFF', 'test-evt-mat-h3b')
      .run();
    const lines = await logLinesOf('CORRIDOR_BASELINE_REFRESH_COMPLETE', () =>
      refreshCorridorBaselines({ DB: db })
    );
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]).sort()).toEqual([
      'duration_ms',
      'errors',
      'h3_key_count',
      'legacy_key_count',
      'rows_skipped',
      'rows_upserted',
      'type',
    ]);
    expect(lines[0].h3_key_count).toBe(1);
    expect(lines[0].legacy_key_count).toBe(0);
    // The key itself never reaches the line.
    expect(JSON.stringify(lines[0])).not.toContain('872664540');
  });

  test('OSE-634 | SRE-OBS-01 | nothing to read | both key counts are zero', async () => {
    const lines = await logLinesOf('CORRIDOR_BASELINE_REFRESH_COMPLETE', () =>
      refreshCorridorBaselines({ DB: tenv().DB })
    );
    expect(lines[0].h3_key_count).toBe(0);
    expect(lines[0].legacy_key_count).toBe(0);
  });
});

// ─── OSE-632: aggregateScanBuckets ───────────────────────────────────────────

describe('OSE-632: aggregateScanBuckets — scan bucket aggregation', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('OSE-632 | BE-SCAN-2 | scans for an event | produces a scan_aggregates row', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-agg', start_offset_hours: -24 * 10 });
    // OSE-798: scan-bucket aggregation reads the session side (scan_node_returns).
    const bucket = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 13) + ':00';
    await db
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, scan_bucket, anonymous_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('snr-agg-1', 'test-evt-mat-agg', bucket, 'anon_aaa')
      .run();
    await db
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, scan_bucket, anonymous_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('snr-agg-2', 'test-evt-mat-agg', bucket, 'anon_bbb')
      .run();

    const r = await aggregateScanBuckets({ DB: db });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);
    expect(r.eventsProcessed).toBe(1);

    const row = await db
      .prepare(`SELECT total_scans, distinct_agent_hashes FROM scan_aggregates WHERE event_id = ?`)
      .bind('test-evt-mat-agg')
      .first<{ total_scans: number; distinct_agent_hashes: number }>();
    expect(row).not.toBeNull();
    expect(row!.total_scans).toBe(2);
    // OSE-2214: no browser is told apart; the figure is always 0.
    expect(row!.distinct_agent_hashes).toBe(0);
  });

  test('OSE-632 | BE-SCAN-2 | same anon scans twice in bucket | one row, distinct_agent_hashes stays 0', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-agg-dedup', start_offset_hours: -24 * 5 });
    const bucket = new Date(Date.now() - 12 * 3600 * 1000).toISOString().slice(0, 13) + ':00';
    await db
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, scan_bucket, anonymous_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('snr-dedup-1', 'test-evt-mat-agg-dedup', bucket, 'anon_same')
      .run();
    await db
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, scan_bucket, anonymous_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('snr-dedup-2', 'test-evt-mat-agg-dedup', bucket, 'anon_same')
      .run()
      // OSE-923 (migration 0101): the second scan in the browser's hour is refused
      // by the UNIQUE index. The writer is INSERT OR IGNORE; this seeds it the same way.
      .catch(() => undefined);

    await aggregateScanBuckets({ DB: db });

    const row = await db
      .prepare(`SELECT total_scans, distinct_agent_hashes FROM scan_aggregates WHERE event_id = ?`)
      .bind('test-evt-mat-agg-dedup')
      .first<{ total_scans: number; distinct_agent_hashes: number }>();
    // One row per browser-hour: total_scans was 2 before 0101.
    expect(row!.total_scans).toBe(1);
    expect(row!.distinct_agent_hashes).toBe(0);
  });

  test('OSE-632 | BE-SCAN-2 | running twice is idempotent | same row count, no duplicates', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-agg-idem', start_offset_hours: -24 * 7 });
    const bucket = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 13) + ':00';
    await db
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, scan_bucket, anonymous_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('snr-idem-1', 'test-evt-mat-agg-idem', bucket, 'anon_idem')
      .run();

    await aggregateScanBuckets({ DB: db });
    await aggregateScanBuckets({ DB: db });
    await aggregateScanBuckets({ DB: db });

    const count = await db
      .prepare(`SELECT COUNT(*) AS c FROM scan_aggregates WHERE event_id = ?`)
      .bind('test-evt-mat-agg-idem')
      .first<{ c: number }>();
    expect(count!.c).toBe(1);
  });

  test('OSE-632 | BE-SCAN-2 | scan_bucket format | bucket_date and bucket_hour extracted correctly', async () => {
    const db = tenv().DB;
    await seedEvent({ id: 'test-evt-mat-agg-bucket', start_offset_hours: -24 * 3 });
    // Specific bucket: 2026-07-15T14:00
    const bucket = '2026-07-15T14:00';
    await db
      .prepare(
        `INSERT INTO scan_node_returns (id, event_id, scan_bucket, anonymous_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('snr-bucket-1', 'test-evt-mat-agg-bucket', bucket, 'anon_bucket')
      .run();

    await aggregateScanBuckets({ DB: db });

    const row = await db
      .prepare(`SELECT bucket_date, bucket_hour FROM scan_aggregates WHERE event_id = ?`)
      .bind('test-evt-mat-agg-bucket')
      .first<{ bucket_date: string; bucket_hour: number }>();
    expect(row).not.toBeNull();
    expect(row!.bucket_date).toBe('2026-07-15');
    expect(row!.bucket_hour).toBe(14);
  });

  test('OSE-632 | BE-SCAN-2 | no scans | result is zero rows, no errors', async () => {
    const r = await aggregateScanBuckets({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBe(0);
    expect(r.eventsProcessed).toBe(0);
  });
});

// ─── Orchestrator — runSharedReportMaterialization ──────────────────────────

describe('OSE-272 Session 3: runSharedReportMaterialization (cron orchestrator)', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('runs the 4 remaining phases (the returns phase is retired) and returns aggregated result shape', async () => {
    const r = await runSharedReportMaterialization({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: TEST_PEPPER,
    });
    expect(r.phases.map((p) => p.phase)).toEqual([
      'scan_aggregation',
      'h3_cell_backfill',
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

  test('runs every phase without the pepper: no phase needs it any more', async () => {
    await seedEvent({ id: 'test-evt-mat-orch', end_offset_hours: -4 });
    await seedScan('test-evt-mat-orch', 'anon_orch');
    const r = await runSharedReportMaterialization({ DB: tenv().DB });
    expect(r.phases).toHaveLength(4);
    expect(r.totalErrors).toBe(0);
  });
});
