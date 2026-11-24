/**
 * OSE-272 Session 4 — SharedReport BigQuery export behavioral tests
 *
 * Tests the three export phases end-to-end against the miniflare D1
 * database. BigQuery side is mocked via a captured-call recorder so we
 * can assert per-pool routing without an actual GCP credentials path.
 *
 * Coverage:
 *   - Phase 1 (anon_id_returns export) retired by OSE-2214: no per-phone data
 *   - Phase 2: corridor_density_baseline export, general-pool routing
 *   - Phase 3: event_series export, only 'confirmed' rows leave
 *   - Watermark NOT advanced on failure (S4-Q4)
 *   - Idempotent insertId across re-runs
 *   - Required-tag enforcement on every emitted row
 *   - phaseToPool() boundary mapping
 *   - Orchestrator failure isolation
 *
 * Filename distinguished from the pre-existing tests/shared-report-export.spec.ts
 * (SR-13 — export-JSON button feature flag) — entirely different concern.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';

// Mock the Google auth path BEFORE importing anything that uses it.
// Real WIF/JWT signing would require a valid RSA key — out of scope for
// these tests, which exercise the export-side data-routing logic only.
// The fetch mock below still verifies dataset routing + insertId shape.
vi.mock('../src/google/auth', () => ({
  getGoogleAccessToken: vi.fn(async () => ({ token: 'test-access-token' })),
}));

import {
  roundForPublish,
  exportCorridorDensityBaseline,
  exportEventSeries,
  type SharedReportExportEnv,
} from '../src/lib/shared-report-export';
import { runSharedReportBigQueryExport } from '../src/handlers/shared-report-export';
import {
  phaseToPool,
  PoolRoutingError,
  REGULATORY_POOLS,
  BIGQUERY_DATASETS,
  DECLINED_REGIMES,
} from '../src/lib/pool-contract';
import { poolSchemaViolations } from './helpers/bigquery-pool-schema';

// OSE-1416: every row a test sends must fit its pool table (bigquery/*.schema.json),
// or the real insertAll would reject it. Checked after every test in this file.
const schemaViolations: string[] = [];
afterEach(() => {
  const found = schemaViolations.splice(0);
  expect(found, 'a BigQuery row does not fit its pool table (bigquery/*.schema.json)').toEqual([]);
});

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// BQ env stub — needs to look "configured" per isBigQueryConfigured()
// but the actual auth flow is short-circuited by our fetch mock.
const BQ_ENV_CONFIGURED = {
  WIF_PRIVATE_KEY_PEM:
    '-----BEGIN PRIVATE KEY-----\nMIIE-test-fake-key-for-tests-only\n-----END PRIVATE KEY-----',
  GCP_PROJECT_NUMBER: '123456789012',
  WIF_POOL_ID: 'test-pool',
  WIF_PROVIDER_ID: 'test-provider',
  GCP_PROJECT_ID: 'ose-test',
  BIGQUERY_DATASET_ID: 'oureventring_general',
  // OSE-1416: these cases assert PRODUCTION routing (bare pool names). Staging
  // routing is asserted separately below.
  WORKER_ENV: 'production',
};

const TEST_PEPPER = 'ose-1460-export-pepper';
function makeEnv(pepper: string = TEST_PEPPER): SharedReportExportEnv {
  return {
    DB: tenv().DB,
    ...BQ_ENV_CONFIGURED,
    ANON_ID_HASH_PEPPER: pepper,
  } as SharedReportExportEnv;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

async function clearExportTables(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM bigquery_export_state`).run();
  await db.prepare(`DELETE FROM anon_id_returns`).run();
  await db.prepare(`DELETE FROM corridor_density_baseline`).run();
  await db.prepare(`UPDATE events SET series_id = NULL`).run();
  await db.prepare(`DELETE FROM event_series`).run();
  // OSE-798: `scans` split into scan_placement_events + scan_node_returns.
  await db.prepare(`DELETE FROM scan_placement_events`).run();
  await db.prepare(`DELETE FROM scan_node_returns`).run();
  await db.prepare(`DELETE FROM poster_deployments WHERE id LIKE 'test-pd-exp-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-exp-%'`).run();
  await db.prepare(`DELETE FROM corridors WHERE id LIKE 'test-corr-exp-%'`).run();
  await db.prepare(`DELETE FROM node_hierarchy WHERE id LIKE 'test-node-exp-%'`).run();
}

async function resetForTest(): Promise<void> {
  await applyMigrations();
  await clearExportTables();
}

interface SeedEventOpts {
  id: string;
  phase?: number;
  corridor_id?: string | null;
  event_type_id?: string | null;
}

async function seedEvent(opts: SeedEventOpts): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location,
          corridor_id, event_type_id, legal_clearance_tier,
          start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 'Test Venue',
               ?, ?, ?,
               datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(
      opts.id,
      'test-brand',
      `Test ${opts.id}`,
      opts.id,
      opts.corridor_id ?? null,
      opts.event_type_id ?? null,
      opts.phase ?? 1
    )
    .run();
}

// Real res7 corridor cells (ADR-011): Eagles Hall's corridor and a neighbour.

const RES7_A = '872664544ffffff';
const RES7_B = '872664546ffffff';
const RES7_C = '872664540ffffff';
const RES7_D = '872664545ffffff';

async function seedCorridor(id: string): Promise<void> {
  const db = tenv().DB;
  await db
    .prepare(
      `INSERT OR IGNORE INTO node_hierarchy (id, brand_id, name, level, level_label)
       VALUES (?, 'test-brand', 'Test Node', 4, 'Metro')`
    )
    .bind(`test-node-exp-${id}`)
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO corridors (id, brand_id, name, origin_node_id, destination_node_id)
       VALUES (?, 'test-brand', 'Test Corridor', ?, ?)`
    )
    .bind(id, `test-node-exp-${id}`, `test-node-exp-${id}`)
    .run();
}

async function seedEventTypeRegistry(id: string, uecCode: string, phase = 1): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT OR IGNORE INTO event_type_registry (id, uec_code, name, phase, legal_clearance_tier)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, uecCode, `Type ${uecCode}`, phase, phase)
    .run();
}

/** One confirmed series anchored on a new event of the given tier (phase 3). */
async function seedConfirmedSeries(eventId: string, tier: number): Promise<void> {
  await seedEvent({ id: eventId, phase: tier });
  const at = '2026-05-10T20:00:00.000Z';
  await tenv()
    .DB.prepare(
      `INSERT INTO event_series
         (id, venue_id, series_name, cadence, day_of_week, hour_of_day,
          state, detected_at, confirmed_at, created_at, updated_at)
       VALUES (?, ?, 'Series', 'weekly', 4, 19, 'confirmed', ?, ?, ?, ?)`
    )
    .bind(`srs-${eventId}`, eventId, at, at, at, at)
    .run();
}

// ─── BigQuery fetch mock ────────────────────────────────────────────────────

interface InsertAllCall {
  url: string;
  dataset: string;
  tableId: string;
  rows: Array<{ insertId: string; json: Record<string, unknown> }>;
}

let bqCalls: InsertAllCall[] = [];
let bqFailNextN = 0;

function installBqMock(): void {
  bqCalls = [];
  bqFailNextN = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // WIF / OAuth token endpoints — return a fake token quickly.
      if (
        url.includes('sts.googleapis.com') ||
        url.includes('iamcredentials.googleapis.com') ||
        url.includes('oauth2.googleapis.com')
      ) {
        return new Response(
          JSON.stringify({
            access_token: 'test-access-token',
            token: 'test-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ) as unknown as Response;
      }

      // BigQuery insertAll endpoint
      const m = url.match(/\/projects\/[^/]+\/datasets\/([^/]+)\/tables\/([^/]+)\/insertAll$/);
      if (m) {
        if (bqFailNextN > 0) {
          bqFailNextN--;
          return new Response('simulated BQ failure', { status: 500 }) as unknown as Response;
        }
        const dataset = m[1];
        const tableId = m[2];
        const body = init?.body ? JSON.parse(init.body as string) : { rows: [] };
        bqCalls.push({ url, dataset, tableId, rows: body.rows ?? [] });
        // Pool datasets only: the legacy flat backup dataset has its own table shape.
        if (/^oureventring_/.test(dataset))
          for (const r of (body.rows ?? []) as Array<{ json: Record<string, unknown> }>)
            schemaViolations.push(...poolSchemaViolations(tableId, r.json));
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }) as unknown as Response;
      }

      // Anything else — unhandled in this test file.
      return new Response('', { status: 404 }) as unknown as Response;
    }
  );
}

function uninstallBqMock(): void {
  vi.restoreAllMocks();
}

// ─── Suite ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-272 Session 4: phaseToPool() boundary mapping', () => {
  test('phase 1, 2, 3 → general', () => {
    expect(phaseToPool(1)).toBe('general');
    expect(phaseToPool(2)).toBe('general');
    expect(phaseToPool(3)).toBe('general');
  });
  test('phase 4 (HIPAA) is REFUSED — declined regime, never routed (OSE-1220)', () => {
    // Previously routed 4 → hipaa. HIPAA is now a declined regime: phaseToPool
    // throws rather than producing a pool, so a declined regime cannot receive
    // writes even if a tier-4 event type is somehow seeded.
    expect(() => phaseToPool(4)).toThrow(PoolRoutingError);
  });
  test('phase 5 (COPPA) is REFUSED — declined regime, never routed (OSE-1220)', () => {
    expect(() => phaseToPool(5)).toThrow(PoolRoutingError);
  });
  test('no declined regime is ever a routable pool', () => {
    // The governance layer must not carry hipaa/coppa/soppa as an active pool.
    for (const regime of DECLINED_REGIMES) {
      expect(REGULATORY_POOLS).not.toContain(regime);
      expect(Object.keys(BIGQUERY_DATASETS)).not.toContain(regime);
    }
  });
  test('null / undefined → general (documented Phase-1 default)', () => {
    // Unset tier means Phase 1 (community/recreational), matching the router's
    // `legal_clearance_tier ?? 1`. This legitimate default is preserved.
    expect(phaseToPool(null)).toBe('general');
    expect(phaseToPool(undefined)).toBe('general');
  });
  test('unrecognized phase FAILS CLOSED (OSE-380) — never defaults to general', () => {
    // Previously NaN / out-of-range / non-integer silently fell through to the
    // least-protected 'general' pool (compliance fail-OPEN). Now they throw so
    // malformed HIPAA/COPPA rows can never leak into general.
    expect(() => phaseToPool(Number.NaN)).toThrow(PoolRoutingError);
    expect(() => phaseToPool(0)).toThrow(PoolRoutingError);
    expect(() => phaseToPool(-1)).toThrow(PoolRoutingError);
    expect(() => phaseToPool(6)).toThrow(PoolRoutingError);
    expect(() => phaseToPool(4.5)).toThrow(PoolRoutingError);
    expect(() => phaseToPool(Infinity)).toThrow(PoolRoutingError);
  });
});

// OSE-2214 (owner, 2026-11-23: count the code, never the person): phase 1,
// exportAnonIdReturns (corridor return counts from per-phone hashes), is
// retired with the nightly job that fed it. Its guards that were not about
// returns are kept below on the phases that remain: no-op without BigQuery,
// staging routing, required tags, a held watermark on failure, chunking, and
// the HIPAA quarantine.

describe('OSE-272 Session 4 Phase 2: exportCorridorDensityBaseline', () => {
  beforeEach(async () => {
    await resetForTest();
    installBqMock();
  });
  afterEach(() => {
    uninstallBqMock();
  });

  test('routes to general pool only (v1 simplification)', async () => {
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(RES7_A, 4, 19, 42, 120, '2026-05-10T18:00:00.000Z')
      .run();

    const r = await exportCorridorDensityBaseline(makeEnv());
    expect(r.errors).toBe(0);
    expect(r.rowsExported).toBe(1);
    expect(bqCalls).toHaveLength(1);
    expect(bqCalls[0].dataset).toBe('oureventring_general');
    expect(bqCalls[0].tableId).toBe('corridor_density_baseline_export');
    const row = bqCalls[0].rows[0].json;
    expect(row.venue_id).toBe('corridor-aggregate');
    expect(row.regulatory_pool).toBe('general');
    expect(row.corridor_id).toBe(RES7_A);
  });

  test('ADR-011: legacy-keyed baseline rows are withheld, never collapsed onto "unknown"', async () => {
    // Two legacy named keys in the same bucket with one computed_at: exported
    // as 'unknown' they would share an insertId and BigQuery would keep one.
    await seedCorridor('test-corr-exp-A');
    await seedCorridor('test-corr-exp-B');
    for (const key of ['test-corr-exp-A', 'test-corr-exp-B', RES7_A]) {
      await tenv()
        .DB.prepare(
          `INSERT INTO corridor_density_baseline
             (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
           VALUES (?, 4, 19, 12, 30, '2026-05-10T18:00:00.000Z')`
        )
        .bind(key)
        .run();
    }

    const r = await exportCorridorDensityBaseline(makeEnv());
    expect(r.errors).toBe(0);
    expect(r.rowsRead).toBe(3);
    expect(r.rowsSkipped).toBe(2);
    expect(r.rowsExported).toBe(1);
    const sent = bqCalls.flatMap((c) => c.rows.map((x) => x.json.corridor_id));
    expect(sent).toEqual([RES7_A]);
  });

  test('counts are floored like the read path, and 90d - 30d never names a group under K', async () => {
    const rows: Array<[string, number, number]> = [
      [RES7_A, 4, 9], // both under 10 → the row is withheld
      [RES7_B, 12, 30], // rounded 10 / 30: both published
      [RES7_C, 27, 30], // rounded 25 / 30: exact 30 - 27 = 3 is gone
      [RES7_D, 3, 11], // rounded 0 / 10: 30d under 10 → null, 90d published
    ];
    for (const [key, w30, w90] of rows) {
      await tenv()
        .DB.prepare(
          `INSERT INTO corridor_density_baseline
             (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
           VALUES (?, 2, 18, ?, ?, '2026-05-10T18:00:00.000Z')`
        )
        .bind(key, w30, w90)
        .run();
    }
    const r = await exportCorridorDensityBaseline(makeEnv());
    expect(r.errors).toBe(0);
    expect(r.rowsSkipped).toBe(1);
    const sent = Object.fromEntries(
      bqCalls.flatMap((c) =>
        c.rows.map((x) => [x.json.corridor_id, [x.json.window_30d_count, x.json.window_90d_count]])
      )
    );
    expect(sent).toEqual({
      [RES7_B]: [10, 30],
      [RES7_C]: [25, 30],
      [RES7_D]: [null, 10],
    });
  });

  test('watermark advances on success', async () => {
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(RES7_B, 3, 20, 10, 30, '2026-05-10T19:00:00.000Z')
      .run();
    await exportCorridorDensityBaseline(makeEnv());
    const state = await tenv()
      .DB.prepare(`SELECT last_exported_at FROM bigquery_export_state WHERE table_name = ?`)
      .bind('corridor_density_baseline')
      .first<{ last_exported_at: string }>();
    expect(state!.last_exported_at).toBe('2026-05-10T19:00:00.000Z');
  });
});

describe('OSE-272 Session 4 Phase 3: exportEventSeries', () => {
  beforeEach(async () => {
    await resetForTest();
    installBqMock();
  });
  afterEach(() => {
    uninstallBqMock();
  });

  test('only `confirmed` rows are exported; pending and rejected stay internal', async () => {
    await seedEvent({ id: 'test-evt-exp-srs-anchor', phase: 1 });
    const futureIso = '2026-05-10T20:00:00.000Z';
    for (const state of ['pending', 'confirmed', 'rejected'] as const) {
      await tenv()
        .DB.prepare(
          `INSERT INTO event_series
             (id, venue_id, series_name, cadence, day_of_week, hour_of_day,
              state, detected_at, confirmed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'weekly', 4, 19, ?, ?, ?, ?, ?)`
        )
        .bind(
          `srs-${state}`,
          'test-evt-exp-srs-anchor',
          `Series ${state}`,
          state,
          futureIso,
          state === 'confirmed' ? futureIso : null,
          futureIso,
          futureIso
        )
        .run();
    }
    const r = await exportEventSeries(makeEnv());
    expect(r.rowsRead).toBe(1);
    expect(r.rowsExported).toBe(1);
    expect(bqCalls).toHaveLength(1);
    expect(bqCalls[0].rows[0].json.state).toBe('confirmed');
  });
});

describe('OSE-272 Session 4 orchestrator: runSharedReportBigQueryExport', () => {
  beforeEach(async () => {
    await resetForTest();
    installBqMock();
  });
  afterEach(() => {
    uninstallBqMock();
  });

  test('runs the 3 remaining phases (the returns export is retired) and returns aggregated result shape', async () => {
    const r = await runSharedReportBigQueryExport(makeEnv());
    // OSE-2214: no phase reads per-phone data; anon_id_returns is not exported.
    expect(r.phases.map((p) => p.phase)).toEqual([
      'corridor_density_baseline',
      'event_series',
      'corridor_flows', // OSE-2216
    ]);
    expect(typeof r.totalDurationMs).toBe('number');
    expect(typeof r.totalErrors).toBe('number');
    expect(typeof r.totalRowsExported).toBe('number');
  });

  test('OSE-2214: no BigQuery call goes to the retired returns table, even with return rows left in D1', async () => {
    await seedEvent({ id: 'test-evt-exp-ret1', phase: 1 });
    const seen = new Date(Date.now() - 3_600_000).toISOString();
    for (let i = 0; i < 10; i++) {
      await tenv()
        .DB.prepare(
          `INSERT INTO anon_id_returns
             (anon_id_hash, venue_id, first_seen_at, last_seen_at, return_count, computed_at)
           VALUES (?, 'test-evt-exp-ret1', ?, ?, 2, ?)`
        )
        .bind(`${i}`.repeat(32), seen, seen, seen)
        .run();
    }
    const r = await runSharedReportBigQueryExport(makeEnv());
    expect(r.totalErrors).toBe(0);
    expect(bqCalls.map((c) => c.tableId)).not.toContain('corridor_returns_export');
    const state = await tenv()
      .DB.prepare(
        `SELECT COUNT(*) AS n FROM bigquery_export_state WHERE table_name = 'anon_id_returns'`
      )
      .first<{ n: number }>();
    expect(state!.n).toBe(0);
  });

  test('failure in one phase does NOT abort others (S4-Q4 isolation)', async () => {
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, 4, 19, 10, 30, '2026-05-10T18:00:00.000Z')`
      )
      .bind(RES7_A)
      .run();
    await seedConfirmedSeries('test-evt-exp-iso1', 1);
    bqFailNextN = 1; // Phase 2 fails; phase 3 still runs and exports
    const r = await runSharedReportBigQueryExport(makeEnv());
    expect(r.phases).toHaveLength(3);
    const phase2 = r.phases.find((p) => p.phase === 'corridor_density_baseline');
    expect(phase2!.errors).toBe(1);
    const phase3 = r.phases.find((p) => p.phase === 'event_series');
    expect(phase3!.errors).toBe(0);
    expect(phase3!.rowsExported).toBe(1);
    const phase4 = r.phases.find((p) => p.phase === 'corridor_flows');
    expect(phase4!.errors).toBe(0);
  });

  test('logs SHARED_REPORT_EXPORT_COMPLETE with structured payload', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runSharedReportBigQueryExport(makeEnv());
    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    const completeLog = calls.find(
      (c) => typeof c === 'string' && c.includes('SHARED_REPORT_EXPORT_COMPLETE')
    );
    expect(completeLog).toBeDefined();
    const parsed = JSON.parse(completeLog!) as Record<string, unknown>;
    expect(parsed.type).toBe('SHARED_REPORT_EXPORT_COMPLETE');
    expect(parsed.phases).toBeDefined();
    logSpy.mockRestore();
  });
});

// OSE-2214: guards that lived on the retired returns phase and were not about
// returns, kept on the phases that remain.
describe('OSE-2214: export guards kept from the retired returns phase', () => {
  beforeEach(async () => {
    await resetForTest();
    installBqMock();
  });
  afterEach(() => {
    uninstallBqMock();
  });

  async function seedBaseline(corridor: string, computedAt = '2026-05-10T18:00:00.000Z') {
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, 4, 19, 10, 30, ?)`
      )
      .bind(corridor, computedAt)
      .run();
  }

  test('graceful no-op when BQ is not configured', async () => {
    await seedBaseline(RES7_A);
    await seedConfirmedSeries('test-evt-exp-nobq', 1);
    const bare = { DB: tenv().DB } as SharedReportExportEnv;
    for (const r of [await exportCorridorDensityBaseline(bare), await exportEventSeries(bare)]) {
      expect(r.errors).toBe(0);
      expect(r.rowsExported).toBe(0);
    }
    expect(bqCalls).toHaveLength(0);
  });

  test('OSE-1416: on staging both phases land in oureventring_general_stg, never production', async () => {
    await seedBaseline(RES7_A);
    await seedConfirmedSeries('test-evt-exp-stg', 1);
    const stg = { ...makeEnv(), WORKER_ENV: 'staging' } as SharedReportExportEnv;
    expect((await exportCorridorDensityBaseline(stg)).errors).toBe(0);
    expect((await exportEventSeries(stg)).errors).toBe(0);
    expect(bqCalls).toHaveLength(2);
    expect(bqCalls.every((c) => c.dataset === 'oureventring_general_stg')).toBe(true);
  });

  test('phase 4 (HIPAA) series is QUARANTINED — never routed or leaked (OSE-1220)', async () => {
    await seedConfirmedSeries('test-evt-exp-h1', 4);
    const r = await exportEventSeries(makeEnv());
    expect(bqCalls).toHaveLength(0);
    expect(r.rowsExported).toBe(0);
    expect(r.rowsSkipped).toBeGreaterThanOrEqual(1);
  });

  test('every exported row carries all 6 required tags', async () => {
    await seedBaseline(RES7_A);
    await seedConfirmedSeries('test-evt-exp-tags', 1);
    await exportCorridorDensityBaseline(makeEnv());
    await exportEventSeries(makeEnv());
    const rows = bqCalls.flatMap((c) => c.rows.map((r) => r.json));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      for (const tag of ['corridor_id', 'venue_id', 'event_type', 'uec_code', 'regulatory_pool']) {
        expect(typeof row[tag]).toBe('string');
        expect(row[tag]).not.toBe('');
      }
      expect(row.product_id).toBe('ose');
    }
  });

  test('watermark NOT advanced on BQ failure (S4-Q4)', async () => {
    await seedBaseline(RES7_A);
    bqFailNextN = 1;
    const r = await exportCorridorDensityBaseline(makeEnv());
    expect(r.errors).toBe(1);
    const state = await tenv()
      .DB.prepare(
        `SELECT last_export_status, last_exported_at FROM bigquery_export_state WHERE table_name = ?`
      )
      .bind('corridor_density_baseline')
      .first<{ last_export_status: string; last_exported_at: string }>();
    expect(state!.last_export_status).toBe('failed');
    expect(state!.last_exported_at).toBe('1970-01-01T00:00:00.000Z');
  });

  test('more than 500 rows in one timestamp group are sent in chunks of at most 500', async () => {
    // 3 corridors × 7 days × 24 hours = 504 rows, one computed_at.
    const db = tenv().DB;
    const stmts: D1PreparedStatement[] = [];
    for (const corridor of [RES7_A, RES7_B, RES7_C])
      for (let dow = 0; dow < 7; dow++)
        for (let hour = 0; hour < 24; hour++)
          stmts.push(
            db
              .prepare(
                `INSERT INTO corridor_density_baseline
                   (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
                 VALUES (?, ?, ?, 10, 30, '2026-05-10T18:00:00.000Z')`
              )
              .bind(corridor, dow, hour)
          );
    await db.batch(stmts);
    const r = await exportCorridorDensityBaseline(makeEnv());
    expect(r.errors).toBe(0);
    expect(r.rowsExported).toBe(504);
    expect(bqCalls.map((c) => c.rows.length)).toEqual([500, 4]);
  });
});

describe('roundForPublish', () => {
  test('rounds down to a multiple of 5; junk and negatives are 0', () => {
    expect([0, 4, 5, 9, 10, 14, 15, 99].map(roundForPublish)).toEqual([0, 0, 5, 5, 10, 10, 15, 95]);
    expect([Number.NaN, -3, 7.9].map(roundForPublish)).toEqual([0, 0, 5]);
  });
});
