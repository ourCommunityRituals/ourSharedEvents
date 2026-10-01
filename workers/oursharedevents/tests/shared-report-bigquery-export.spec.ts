/**
 * OSE-272 Session 4 — SharedReport BigQuery export behavioral tests
 *
 * Tests the three export phases end-to-end against the miniflare D1
 * database. BigQuery side is mocked via a captured-call recorder so we
 * can assert per-pool routing without an actual GCP credentials path.
 *
 * Coverage:
 *   - Phase 1: anon_id_returns export, watermark advancement, pool routing
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
  RETURNS_POOL_KEY_SQL,
  exportAnonIdReturns,
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
import corridorReturnsSchema from '../bigquery/corridor_returns_export.schema.json';
import { pepperEpoch } from '../src/lib/anon-id-hash';

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

async function seedAnonIdReturn(opts: {
  hash: string;
  venueId: string;
  computedAt: string;
}): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO anon_id_returns
         (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count, computed_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .bind(opts.hash, opts.venueId, opts.computedAt, opts.computedAt, opts.computedAt)
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

// OSE-1460: the returns phase sends k-floored counts per corridor × event type ×
// pool. No anon_id_hash, no venue, no per-person row ever reaches BigQuery.
describe('OSE-272 Session 4 Phase 1: exportAnonIdReturns → corridor return counts (OSE-1460)', () => {
  // OSE-1460: every run also writes one snapshot marker per pool. These helpers
  // separate the data (row_type 'group') from the markers.
  const groupCalls = (): InsertAllCall[] =>
    bqCalls
      .map((c) => ({ ...c, rows: c.rows.filter((r) => r.json.row_type === 'group') }))
      .filter((c) => c.rows.length > 0);
  const markerRows = (): Array<Record<string, unknown>> =>
    bqCalls.flatMap((c) => c.rows.map((r) => r.json)).filter((j) => j.row_type === 'snapshot');

  const recent = (hoursAgo: number): string =>
    new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

  async function seedPeople(
    venueId: string,
    visits: number[],
    opts: {
      prefix?: string;
      lastSeen?: string;
      computedAt?: string;
      pepper?: string | null;
    } = {}
  ): Promise<void> {
    const epoch = opts.pepper === null ? null : await pepperEpoch(opts.pepper ?? TEST_PEPPER);
    for (let i = 0; i < visits.length; i++) {
      const seen = opts.lastSeen ?? recent(2);
      await tenv()
        .DB.prepare(
          `INSERT INTO anon_id_returns
             (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count, computed_at,
              pepper_epoch)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          `${opts.prefix ?? 'p'}${i}`.padEnd(32, '0'),
          venueId,
          seen,
          seen,
          visits[i],
          opts.computedAt ?? recent(1),
          epoch
        )
        .run();
    }
  }

  async function seedCorridorEvent(id: string, phase = 1, h3: string | null = RES7_A) {
    await seedEventTypeRegistry('et-trivia', 'UEC-TRIVIA', 1);
    await seedEvent({ id, phase, event_type_id: 'et-trivia' });
    await tenv().DB.prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`).bind(h3, id).run();
  }

  beforeEach(async () => {
    await resetForTest();
    installBqMock();
  });
  afterEach(() => {
    uninstallBqMock();
  });

  test('graceful no-op when BQ is not configured', async () => {
    const r = await exportAnonIdReturns({ DB: tenv().DB } as SharedReportExportEnv);
    expect(r.errors).toBe(0);
    expect(r.rowsExported).toBe(0);
    expect(groupCalls()).toHaveLength(0);
  });

  test('exports one floored count row per corridor and type, with no person or venue in it', async () => {
    // Six people; five came to two events, three of them to a third.
    await seedCorridorEvent('test-evt-exp-1');
    await seedCorridorEvent('test-evt-exp-1b');
    await seedCorridorEvent('test-evt-exp-1c');
    await seedPeople('test-evt-exp-1', [1, 1, 1, 1, 1, 1], { prefix: 'm' });
    await seedPeople('test-evt-exp-1b', [1, 1, 1, 1, 1], { prefix: 'm' });
    await seedPeople('test-evt-exp-1c', [1, 1, 1], { prefix: 'm' });

    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(r.rowsExported).toBe(1);
    expect(groupCalls()).toHaveLength(1);
    expect(groupCalls()[0].dataset).toBe('oureventring_general');
    expect(groupCalls()[0].tableId).toBe('corridor_returns_export');
    const row = groupCalls()[0].rows[0].json;
    expect(row).toMatchObject({
      corridor_id: RES7_A,
      venue_id: 'corridor-aggregate',
      uec_code: 'UEC-TRIVIA',
      regulatory_pool: 'general',
      product_id: 'ose',
      window_days: 90,
      people_count: 6,
      returned_2plus: 5,
      returned_3plus: null, // 3 people: under the floor, suppressed
      returned_5plus: null,
    });
    const wire = JSON.stringify(groupCalls()[0].rows);
    expect(wire).not.toContain('anon_id_hash');
    expect(wire).not.toContain('test-evt-exp-1');
    expect(wire).not.toMatch(/m\d0{20,}/); // no seeded hash value
  });

  test('visit_count is not a return: repeat materialization at one event counts zero returns', async () => {
    // materializeAnonIdReturns bumps visit_count on every re-run over the same
    // scans, so a high visit_count at ONE event must not make anyone a returner.
    await seedCorridorEvent('test-evt-exp-vc');
    await seedPeople('test-evt-exp-vc', [9, 9, 9, 9, 9]);
    await exportAnonIdReturns(makeEnv());
    const row = groupCalls()[0].rows[0].json;
    expect(row.people_count).toBe(5);
    expect(row.returned_2plus).toBeNull();
  });

  test('more than 500 groups are sent in chunks of at most 500', async () => {
    const db = tenv().DB;
    await db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
         INSERT INTO event_type_registry (id, uec_code, name, phase, legal_clearance_tier)
         SELECT 'et-chunk-' || i, 'UEC-CHUNK-' || i, 'Chunk ' || i, 1, 1 FROM n`
      )
      .run();
    await db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
         INSERT INTO events (id, brand_id, title, slug, status, location, event_type_id,
                             legal_clearance_tier, h3_res7, start_date, created_at, updated_at)
         SELECT 'test-evt-exp-chunk-' || i, 'test-brand', 'Chunk ' || i, 'test-evt-exp-chunk-' || i,
                'active', 'Test Venue', 'et-chunk-' || i, 1, ?, datetime('now'), datetime('now'), datetime('now')
           FROM n`
      )
      .bind(RES7_A)
      .run();
    const seen = new Date(Date.now() - 7_200_000).toISOString();
    await db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 500),
                       p(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM p WHERE j < 4)
         INSERT INTO anon_id_returns (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count, computed_at, pepper_epoch)
         SELECT printf('%032d', i * 10 + j), 'test-evt-exp-chunk-' || i, ?, ?, 1, ?, ? FROM n, p`
      )
      .bind(seen, seen, seen, await pepperEpoch(TEST_PEPPER))
      .run();
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(r.rowsExported).toBe(501);
    expect(groupCalls().length).toBe(2);
    expect(Math.max(...groupCalls().map((c) => c.rows.length))).toBeLessThanOrEqual(500);
  });

  test('tiers that share a pool are one group: 3 + 3 people at tiers 1 and 2 export as 6', async () => {
    await seedCorridorEvent('test-evt-exp-t1', 1);
    await seedCorridorEvent('test-evt-exp-t2', 2);
    await tenv()
      .DB.prepare(`UPDATE events SET legal_clearance_tier = 2 WHERE id = 'test-evt-exp-t2'`)
      .run();
    await seedPeople('test-evt-exp-t1', [1, 1, 1], { prefix: 'ta' });
    await seedPeople('test-evt-exp-t2', [1, 1, 1], { prefix: 'tb' });
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(groupCalls()).toHaveLength(1);
    expect(groupCalls()[0].rows).toHaveLength(1);
    expect(groupCalls()[0].rows[0].json.people_count).toBe(6);
  });

  test('the SQL pool key agrees with phaseToPool for every tier', async () => {
    for (const tier of [null, 0, 1, 2, 3, 4, 5, 6, 2.5]) {
      const row = await tenv()
        .DB.prepare(`SELECT ${RETURNS_POOL_KEY_SQL} AS k FROM (SELECT ? AS legal_clearance_tier) e`)
        .bind(tier)
        .first<{ k: string }>();
      let pool: string | null;
      try {
        pool = phaseToPool(tier);
      } catch {
        pool = null;
      }
      expect(row!.k === 'general', `tier ${String(tier)}`).toBe(pool === 'general');
    }
  });

  test('every run writes a snapshot marker, even when it has no groups', async () => {
    await seedCorridorEvent('test-evt-exp-mk');
    await seedPeople('test-evt-exp-mk', [1, 1, 1, 1, 1]);
    const r1 = await exportAnonIdReturns(makeEnv());
    expect(r1.snapshotMarkers).toBe(1);
    expect(markerRows()).toHaveLength(1);
    expect(markerRows()[0]).toMatchObject({
      row_type: 'snapshot',
      corridor_id: 'unknown',
      regulatory_pool: 'general',
      groups_in_snapshot: 1,
    });
    // Every group ages out: the next run must still say "this snapshot is empty".
    await tenv()
      .DB.prepare(`UPDATE anon_id_returns SET last_seen_at = ?`)
      .bind(new Date(Date.now() - 100 * 86_400_000).toISOString())
      .run();
    bqCalls = [];
    const r2 = await exportAnonIdReturns(makeEnv());
    expect(r2.errors).toBe(0);
    expect(groupCalls()).toHaveLength(0);
    expect(markerRows()).toHaveLength(1);
    expect(markerRows()[0].groups_in_snapshot).toBe(0);
    expect(r2.rowsExported).toBe(0); // a marker is not data
  });

  test('a group under the floor is withheld, not exported', async () => {
    await seedCorridorEvent('test-evt-exp-small');
    await seedPeople('test-evt-exp-small', [3, 3, 3, 3]);
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(r.rowsSkipped).toBe(1);
    expect(groupCalls()).toHaveLength(0);
  });

  test('one person at two events in a corridor counts once, as a return', async () => {
    await seedCorridorEvent('test-evt-exp-v1');
    await seedCorridorEvent('test-evt-exp-v2');
    await seedPeople('test-evt-exp-v1', [1, 1, 1, 1, 1], { prefix: 'x' });
    await seedPeople('test-evt-exp-v2', [1, 1, 1, 1, 1], { prefix: 'x' });
    await exportAnonIdReturns(makeEnv());
    const row = groupCalls()[0].rows[0].json;
    expect(row.people_count).toBe(5);
    expect(row.returned_2plus).toBe(5);
  });

  test('rows last seen before the window are not counted', async () => {
    await seedCorridorEvent('test-evt-exp-old');
    await seedPeople('test-evt-exp-old', [2, 2, 2, 2, 2], { lastSeen: recent(24 * 120) });
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(groupCalls()).toHaveLength(0);
  });

  test('the window is the event day, not when the row was materialized', async () => {
    await seedCorridorEvent('test-evt-exp-late');
    await tenv()
      .DB.prepare(`UPDATE events SET start_date = date('now', '-120 days') WHERE id = ?`)
      .bind('test-evt-exp-late')
      .run();
    // Materialized (or re-materialized) yesterday, for an event 120 days ago.
    await seedPeople('test-evt-exp-late', [2, 2, 2, 2, 2]);
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(groupCalls()).toHaveLength(0);
  });

  test("an event on the window's first day counts, even materialized at that day's midnight", async () => {
    const floorDay = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    await seedCorridorEvent('test-evt-exp-floor');
    await tenv()
      .DB.prepare(`UPDATE events SET start_date = ? WHERE id = ?`)
      .bind(floorDay, 'test-evt-exp-floor')
      .run();
    await seedPeople('test-evt-exp-floor', [2, 2, 2, 2, 2], {
      lastSeen: `${floorDay}T00:00:00.000Z`,
    });
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(groupCalls()).toHaveLength(1);
  });

  test('every field the export sends is in the checked-in BigQuery schema, with its mode', async () => {
    await seedCorridorEvent('test-evt-exp-schema');
    await seedPeople('test-evt-exp-schema', [2, 2, 2, 2, 2]);
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    const fields = new Map(
      (corridorReturnsSchema as Array<{ name: string; mode: string }>).map((f) => [f.name, f.mode])
    );
    const rows = [...groupCalls().flatMap((c) => c.rows.map((x) => x.json)), ...markerRows()];
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      for (const key of Object.keys(row)) expect(fields.has(key), key).toBe(true);
      for (const [name, mode] of fields) {
        if (mode === 'REQUIRED') expect(row[name] ?? null, name).not.toBeNull();
      }
    }
  });

  test('after a pepper rotation, one browser under two hashes never lifts a group over the floor', async () => {
    // Three real people, seen at two events: once hashed under the old pepper,
    // once under the new. Mixed, the corridor would read six people.
    await seedCorridorEvent('test-evt-exp-rot-1');
    await seedCorridorEvent('test-evt-exp-rot-2');
    await seedPeople('test-evt-exp-rot-1', [1, 1, 1], { prefix: 'old', pepper: 'retired-pepper' });
    await seedPeople('test-evt-exp-rot-2', [1, 1, 1], { prefix: 'new' });
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(groupCalls()).toHaveLength(0);
  });

  test('rows of an unknown pepper (pre-0090) and runs with no pepper count nobody', async () => {
    await seedCorridorEvent('test-evt-exp-nopep');
    await seedPeople('test-evt-exp-nopep', [2, 2, 2, 2, 2], { pepper: null });
    await seedPeople('test-evt-exp-nopep', [2, 2, 2, 2, 2], { prefix: 'q' });
    expect((await exportAnonIdReturns(makeEnv(''))).errors).toBe(0);
    expect(groupCalls()).toHaveLength(0);
    expect(markerRows().length).toBeGreaterThan(0);
  });

  test('a group with no real corridor is withheld', async () => {
    await seedCorridorEvent('test-evt-exp-nocorr', 1, null);
    await seedPeople('test-evt-exp-nocorr', [2, 2, 2, 2, 2]);
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.rowsSkipped).toBe(1);
    expect(groupCalls()).toHaveLength(0);
  });

  test('OSE-1416: on staging the export lands in oureventring_general_stg, never production', async () => {
    await seedCorridorEvent('test-evt-exp-stg');
    await seedPeople('test-evt-exp-stg', [1, 1, 1, 1, 1]);
    const r = await exportAnonIdReturns({ ...makeEnv(), WORKER_ENV: 'staging' });
    expect(r.errors).toBe(0);
    expect(groupCalls().length).toBeGreaterThan(0);
    expect(groupCalls().every((c) => c.dataset === 'oureventring_general_stg')).toBe(true);
  });

  test('phase 4 (HIPAA) group is QUARANTINED — never routed or leaked (OSE-1220)', async () => {
    await seedEventTypeRegistry('et-health', 'UEC-HEALTH', 4);
    await seedEvent({ id: 'test-evt-exp-h1', phase: 4, event_type_id: 'et-health' });
    await tenv()
      .DB.prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`)
      .bind(RES7_A, 'test-evt-exp-h1')
      .run();
    await seedPeople('test-evt-exp-h1', [1, 1, 1, 1, 1]);
    const r = await exportAnonIdReturns(makeEnv());
    expect(groupCalls()).toHaveLength(0);
    expect(r.rowsSkipped).toBeGreaterThanOrEqual(1);
  });

  test('every exported row carries all 6 required tags', async () => {
    await seedCorridorEvent('test-evt-exp-tags');
    await seedPeople('test-evt-exp-tags', [1, 1, 1, 1, 1]);
    await exportAnonIdReturns(makeEnv());
    const row = groupCalls()[0].rows[0].json;
    for (const tag of ['corridor_id', 'venue_id', 'event_type', 'uec_code', 'regulatory_pool']) {
      expect(typeof row[tag]).toBe('string');
    }
    expect(row.product_id).toBe('ose');
  });

  test('watermark advances to the newest source row; every run is its own snapshot', async () => {
    // A rolling window moves continuously, so every run re-snapshots under its
    // own computed_at: two runs never share an insertId or a snapshot identity.
    await seedCorridorEvent('test-evt-exp-w1');
    await seedPeople('test-evt-exp-w1', [1, 1, 1, 1, 1], {
      computedAt: '2026-09-30T15:00:00.000Z',
    });
    await exportAnonIdReturns(makeEnv());
    const first = groupCalls()
      .map((c) => c.rows.map((r) => r.insertId))
      .flat();
    bqCalls = [];
    await exportAnonIdReturns(makeEnv());
    const second = groupCalls()
      .map((c) => c.rows.map((r) => r.insertId))
      .flat();
    expect(second).toHaveLength(first.length);
    expect(second.some((id) => first.includes(id))).toBe(false);
    const state = await tenv()
      .DB.prepare(
        `SELECT last_export_status, last_exported_at FROM bigquery_export_state WHERE table_name = ?`
      )
      .bind('anon_id_returns')
      .first<{ last_export_status: string; last_exported_at: string }>();
    expect(state!.last_export_status).toBe('success');
    expect(state!.last_exported_at).toBe('2026-09-30T15:00:00.000Z');
  });

  test('a group that ages out of the window is absent from the next snapshot', async () => {
    await seedCorridorEvent('test-evt-exp-age');
    await seedPeople('test-evt-exp-age', [1, 1, 1, 1, 1]);
    await exportAnonIdReturns(makeEnv());
    expect(groupCalls()).toHaveLength(1);
    // Nothing new is materialized; the rows simply get old.
    await tenv()
      .DB.prepare(`UPDATE anon_id_returns SET last_seen_at = ?`)
      .bind(new Date(Date.now() - 100 * 86_400_000).toISOString())
      .run();
    bqCalls = [];
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(0);
    expect(groupCalls()).toHaveLength(0);
  });

  test('watermark NOT advanced on BQ failure (S4-Q4)', async () => {
    await seedCorridorEvent('test-evt-exp-f1');
    await seedPeople('test-evt-exp-f1', [1, 1, 1, 1, 1]);
    bqFailNextN = 1;
    const r = await exportAnonIdReturns(makeEnv());
    expect(r.errors).toBe(1);
    const state = await tenv()
      .DB.prepare(
        `SELECT last_export_status, last_exported_at FROM bigquery_export_state WHERE table_name = ?`
      )
      .bind('anon_id_returns')
      .first<{ last_export_status: string; last_exported_at: string }>();
    expect(state!.last_export_status).toBe('failed');
    expect(state!.last_exported_at).toBe('1970-01-01T00:00:00.000Z');
  });

  test('insertIds are keyed by the snapshot, never by a person or an event', async () => {
    await seedCorridorEvent('test-evt-exp-i1');
    await seedPeople('test-evt-exp-i1', [1, 1, 1, 1, 1]);
    await exportAnonIdReturns(makeEnv());
    const group = groupCalls()[0].rows[0];
    const marker = markerRows()[0];
    expect(group.insertId).toBe(
      `cr-${String(group.json.computed_at)}-${RES7_A}-UEC-TRIVIA-general`
    );
    expect(String(marker.computed_at)).toBe(String(group.json.computed_at));
    expect(group.insertId).not.toMatch(/test-evt-exp|p\d0{20,}/);
  });
});

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
           VALUES (?, 4, 19, 5, 9, '2026-05-10T18:00:00.000Z')`
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

  test('runs all 3 phases and returns aggregated result shape', async () => {
    const r = await runSharedReportBigQueryExport(makeEnv());
    expect(r.phases).toHaveLength(3);
    expect(r.phases.map((p) => p.phase)).toEqual([
      'anon_id_returns',
      'corridor_density_baseline',
      'event_series',
    ]);
    expect(typeof r.totalDurationMs).toBe('number');
    expect(typeof r.totalErrors).toBe('number');
    expect(typeof r.totalRowsExported).toBe('number');
  });

  test('failure in one phase does NOT abort others (S4-Q4 isolation)', async () => {
    await seedEvent({ id: 'test-evt-exp-iso1', phase: 1 });
    await tenv()
      .DB.prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`)
      .bind(RES7_A, 'test-evt-exp-iso1')
      .run();
    // OSE-1460: phase 1 only calls BigQuery for a group at or above the floor.
    const seen = new Date(Date.now() - 3_600_000).toISOString();
    for (let i = 0; i < 5; i++) {
      await seedAnonIdReturn({
        hash: `${i}`.repeat(32),
        venueId: 'test-evt-exp-iso1',
        computedAt: seen,
      });
    }
    bqFailNextN = 1; // Phase 1 fails
    const r = await runSharedReportBigQueryExport(makeEnv());
    expect(r.phases).toHaveLength(3);
    const phase1 = r.phases.find((p) => p.phase === 'anon_id_returns');
    expect(phase1!.errors).toBe(1);
    const phase2 = r.phases.find((p) => p.phase === 'corridor_density_baseline');
    expect(phase2!.errors).toBe(0);
    const phase3 = r.phases.find((p) => p.phase === 'event_series');
    expect(phase3!.errors).toBe(0);
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
