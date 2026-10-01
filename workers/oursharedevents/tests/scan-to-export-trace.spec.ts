/**
 * OSE-616 (QR Path to Done, rung 5) — scan → export persistence trace.
 *
 * One scan at the Eagles Hall poster, followed through every hop of the real
 * pipeline, with the geography asserted at each one:
 *
 *   /q/:token scan      → the scan row has no place of its own; its place is the
 *                         poster placement's res9 node (89266454447ffff)
 *   /s/:code click      → attributed to the event, located at the venue's res7
 *                         corridor node; the click record holds no place itself
 *   scan_aggregates     → hour bucket for the event, tagged with the venue's
 *                         res9 + res7 (a live scan at the venue)
 *   anon_id_returns     → the scanner's anonymous return row for the event
 *   corridor baseline   → keyed by the res7 corridor node (872664544ffffff)
 *   BigQuery export     → every row carries corridor_id = the res7 node and
 *                         NOTHING finer: no res9, no coordinate, no placement
 *   export_manifest     → one row per phase: counts + corridor coverage only
 *
 * The H3 rule this traces (PO, 2026-10-01): res9 is for physical places only —
 * the poster placement and live scans at the venue. A shortlink click resolves
 * to the event, located at the venue's res7. The corridor is the res7
 * node, and it is the finest grain that ever crosses the D1 → BigQuery boundary.
 *
 * The cron phases run in-process (runSharedReportMaterialization →
 * runSharedReportBigQueryExport), exactly as scheduled() calls them; BigQuery is
 * a recording fetch mock. The event is created exactly as the API stores one:
 * a calendar-day start_date/end_date ("YYYY-MM-DD") plus an IANA timezone, no
 * hand-written ISO instants. The return-rate phase only reads events that
 * ENDED 2–26 hours ago, so the test picks a zone whose end-of-day falls inside
 * that window right now (dateOnlyFixture) — the same day-end rule the public
 * page and the materializer use (phaseTimesFor).
 *
 * Not traced here, and why: corridor registry ids + definition_version
 * (OSE-613 / OSE-603, not built); per-placement scan aggregation (scan_aggregates
 * tags every scan with the venue's cells, so a pre-event scan at a poster is not
 * yet aggregated at the poster's node — follow-up ticket).
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';

vi.mock('../src/google/auth', () => ({
  getGoogleAccessToken: vi.fn(async () => ({ token: 'test-access-token' })),
}));

import { runSharedReportMaterialization } from '../src/handlers/shared-report-materialize';
import { runSharedReportBigQueryExport } from '../src/handlers/shared-report-export';
import {
  exportCorridorDensityBaseline,
  type SharedReportExportEnv,
} from '../src/lib/shared-report-export';
import {
  assertCorridorGrainRow,
  canonicalCorridorId,
  ExportGeographyError,
  h3Resolution,
  isCorridorId,
} from '../src/lib/export-geography';
import { phaseTimesFor } from '../src/lib/event-datetime';
import { bigQueryInsertRows } from '../src/cloud/bigquery';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};

/** The canonical fixture: Eagles Hall, Blue Island IL. */
const EAGLES = { lat: 41.6571, lon: -87.6798 };
const EAGLES_RES9 = '89266454447ffff'; // physical node (poster + venue)
const EAGLES_RES7 = '872664544ffffff'; // the corridor

const BQ_ENV = {
  WIF_PRIVATE_KEY_PEM:
    '-----BEGIN PRIVATE KEY-----\nMIIE-test-fake-key-for-tests-only\n-----END PRIVATE KEY-----',
  GCP_PROJECT_NUMBER: '123456789012',
  WIF_POOL_ID: 'test-pool',
  WIF_PROVIDER_ID: 'test-provider',
  GCP_PROJECT_ID: 'ose-test',
  BIGQUERY_DATASET_ID: 'oureventring_general',
  WORKER_ENV: 'staging',
};
const exportEnv = (): SharedReportExportEnv =>
  ({ DB: tenv().DB, ...BQ_ENV }) as SharedReportExportEnv;

// ── BigQuery recorder ────────────────────────────────────────────────────────

interface InsertCall {
  dataset: string;
  table: string;
  rows: Array<{ insertId: string; json: Record<string, unknown> }>;
}
let bqCalls: InsertCall[] = [];

function installBqMock(insertResponse: Record<string, unknown> = {}): void {
  bqCalls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (/sts\.googleapis|iamcredentials\.googleapis|oauth2\.googleapis/.test(url)) {
        return new Response(JSON.stringify({ access_token: 't', token: 't', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const m = url.match(/\/datasets\/([^/]+)\/tables\/([^/]+)\/insertAll$/);
      if (m) {
        const body = init?.body ? JSON.parse(init.body as string) : { rows: [] };
        bqCalls.push({ dataset: m[1], table: m[2], rows: body.rows ?? [] });
        return new Response(JSON.stringify(insertResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    }
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

async function applyMigrations(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function clearPipeline(): Promise<void> {
  const db = tenv().DB;
  for (const t of [
    'bigquery_export_state',
    'anon_id_returns',
    'corridor_density_baseline',
    'corridor_density_snapshots',
    'scan_aggregates',
    'scan_placement_events',
    'scan_node_returns',
    'export_manifest',
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

/**
 * A (calendar day, IANA zone) pair whose local end-of-day is 4–24h ago — well
 * inside the materializer's 2–26h window. A zone's day-ends are 24h apart, so
 * across these offsets (+14 … −11) one always lands in a 20h window.
 */
function dateOnlyFixture(): { day: string; zone: string } {
  const now = Date.now();
  const zones = [
    'Pacific/Kiritimati',
    'Asia/Tokyo',
    'Asia/Kolkata',
    'Europe/London',
    'America/Chicago',
    'Pacific/Honolulu',
    'Pacific/Pago_Pago',
  ];
  for (const zone of zones) {
    for (let back = -1; back <= 2; back++) {
      const day = new Date(now - back * 86_400_000).toISOString().slice(0, 10);
      const end = phaseTimesFor({ start_date: day, end_date: day, timezone: zone }).end_date;
      const endMs = end ? Date.parse(end) : NaN;
      if (endMs >= now - 24 * 3600_000 && endMs <= now - 4 * 3600_000) return { day, zone };
    }
  }
  throw new Error('no (day, zone) pair ends 4–24h ago — widen the zone list');
}

let eventId = '';
let deploymentId = '';
let qrToken = '';

beforeAll(async () => {
  await applyMigrations(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await applyMigrations(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  await clearPipeline();

  // Time fixture (see header): a date-only event whose day ended in the window.
  const when = dateOnlyFixture();

  // The event, created the way an organiser creates it (admin API), at the
  // Eagles Hall venue — the API tags it with the venue's res9 + res7.
  const created = await SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: ADMIN,
    body: JSON.stringify({
      title: 'OSE-616 Trace — Eagles Hall',
      status: 'active',
      lat: EAGLES.lat,
      lon: EAGLES.lon,
      start_date: when.day,
      end_date: when.day,
      timezone: when.zone,
    }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  eventId = ((await created.json()) as { id: string }).id;

  // The poster, placed at the venue address through the admin API.
  const placed = await SELF.fetch(
    `https://t.test/api/v2/admin/events/${eventId}/poster-deployments`,
    {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({
        placement_label: 'OSE-616 Trace — front door',
        latitude: EAGLES.lat,
        longitude: EAGLES.lon,
      }),
    }
  );
  expect(placed.status, await placed.clone().text()).toBe(201);
  ({ id: deploymentId, qr_token: qrToken } = (await placed.json()) as {
    id: string;
    qr_token: string;
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ── The trace ────────────────────────────────────────────────────────────────

describe('OSE-616 trace: one Eagles Hall scan, scan → aggregate → corridor → export', () => {
  test('hop 0 — the venue and the poster are tagged at the Eagles nodes', async () => {
    const evt = await tenv()
      .DB.prepare('SELECT h3_res9, h3_res7 FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ h3_res9: string; h3_res7: string }>();
    expect(evt).toEqual({ h3_res9: EAGLES_RES9, h3_res7: EAGLES_RES7 });

    const pd = await tenv()
      .DB.prepare('SELECT h3_res9, h3_res7 FROM poster_deployments WHERE id = ?')
      .bind(deploymentId)
      .first<{ h3_res9: string; h3_res7: string }>();
    expect(pd).toEqual({ h3_res9: EAGLES_RES9, h3_res7: EAGLES_RES7 });
  });

  test('hop 1 — the scan is recorded; its only place is the poster res9 node', async () => {
    const scan = await SELF.fetch(`https://t.test/q/${qrToken}`, { redirect: 'manual' });
    expect(scan.status).toBe(302);

    const placement = await tenv()
      .DB.prepare(
        `SELECT pd.h3_res9 AS cell, pd.h3_res7 AS corridor
           FROM scan_placement_events spe
           JOIN poster_deployments pd ON pd.id = spe.poster_deployment_id
          WHERE spe.event_id = ?`
      )
      .bind(eventId)
      .all<{ cell: string; corridor: string }>();
    expect(placement.results).toEqual([{ cell: EAGLES_RES9, corridor: EAGLES_RES7 }]);

    const node = await tenv()
      .DB.prepare(
        'SELECT COUNT(*) AS n FROM scan_node_returns WHERE event_id = ? AND anonymous_id IS NOT NULL'
      )
      .bind(eventId)
      .first<{ n: number }>();
    expect(node?.n).toBe(1);
  });

  test('hop 1b — a shortlink click resolves to the event, at the venue res7 only', async () => {
    // PO decision (2026-10-01, H3 resolution ADR): a /s/ click is attributed to
    // its event and located at the event venue's res7 corridor node — never
    // res9. The click record holds no place of its own; its corridor is the
    // event's, so nothing finer than res7 can ever be attached to a click.
    const code = 'T616ck';
    await tenv()
      .DB.prepare(
        `INSERT OR REPLACE INTO shortlinks (code, event_id, kind) VALUES (?, ?, 'public')`
      )
      .bind(code, eventId)
      .run();
    const click = await SELF.fetch(`https://t.test/s/${code}`, { redirect: 'manual' });
    expect(click.status).toBe(302);

    const row = await tenv()
      .DB.prepare(
        `SELECT s.clicks AS clicks, s.event_id AS event_id, e.h3_res7 AS corridor
           FROM shortlinks s JOIN events e ON e.id = s.event_id WHERE s.code = ?`
      )
      .bind(code)
      .first<{ clicks: number; event_id: string; corridor: string }>();
    expect(row).toEqual({ clicks: 1, event_id: eventId, corridor: EAGLES_RES7 });
    expect(isCorridorId(row?.corridor)).toBe(true);

    const cols = await tenv().DB.prepare('PRAGMA table_info(shortlinks)').all<{ name: string }>();
    for (const c of cols.results ?? []) {
      expect(c.name).not.toMatch(/h3|lat|lon|lng|geo|placement|deployment/i);
    }
  });

  test('hops 2–4 — the nightly job aggregates at the venue node and keys the corridor at res7', async () => {
    const run = await runSharedReportMaterialization({
      DB: tenv().DB,
      ANON_ID_HASH_PEPPER: 'ose-616-trace-pepper',
    });
    expect(run.totalErrors, JSON.stringify(run.phases)).toBe(0);

    // scan_aggregates: one hour bucket, a live scan at the venue → venue nodes.
    const agg = await tenv()
      .DB.prepare('SELECT total_scans, h3_res9, h3_res7 FROM scan_aggregates WHERE event_id = ?')
      .bind(eventId)
      .all<{ total_scans: number; h3_res9: string; h3_res7: string }>();
    expect(agg.results).toEqual([{ total_scans: 1, h3_res9: EAGLES_RES9, h3_res7: EAGLES_RES7 }]);

    // anon_id_returns: the scanner's return row for this event (hashed, never raw).
    const ret = await tenv()
      .DB.prepare('SELECT anon_id_hash, visit_count FROM anon_id_returns WHERE venue_id = ?')
      .bind(eventId)
      .all<{ anon_id_hash: string; visit_count: number }>();
    expect(ret.results).toHaveLength(1);
    expect(ret.results![0].visit_count).toBe(1);

    // Corridor baseline: keyed by the res7 corridor node, never the res9 node.
    const base = await tenv()
      .DB.prepare('SELECT corridor_id, window_30d_count FROM corridor_density_baseline')
      .all<{ corridor_id: string; window_30d_count: number }>();
    expect(base.results).toEqual([{ corridor_id: EAGLES_RES7, window_30d_count: 1 }]);
  });

  test('hop 5 — the export carries the res7 corridor and nothing finer', async () => {
    installBqMock();
    const run = await runSharedReportBigQueryExport(exportEnv());
    vi.restoreAllMocks();
    expect(run.totalErrors, JSON.stringify(run.phases)).toBe(0);

    const byTable = Object.fromEntries(bqCalls.map((c) => [c.table, c]));
    expect(Object.keys(byTable).sort()).toEqual([
      'anon_id_returns_export',
      'corridor_density_baseline_export',
    ]);
    for (const c of bqCalls) expect(c.dataset).toBe('oureventring_general_stg');

    const rows = bqCalls.flatMap((c) => c.rows.map((r) => r.json));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // The corridor is the res7 node — before OSE-616 the event-joined tables
      // sent corridor_id 'unknown' (events.corridor_id has no writer).
      expect(row.corridor_id, JSON.stringify(row)).toBe(EAGLES_RES7);
      // Structurally corridor grain: the guard the exporter runs, re-run here.
      expect(() => assertCorridorGrainRow(row)).not.toThrow();
    }
    // Belt and braces: the poster/venue res9 node appears nowhere in the payload.
    expect(JSON.stringify(bqCalls)).not.toContain(EAGLES_RES9);
  });

  test('hop 6 — the manifest records each phase with corridor coverage, no row data', async () => {
    const rows = await tenv()
      .DB.prepare(
        `SELECT actor, event_id, rows_exported, outcome, details
           FROM export_manifest WHERE event_id = 'cron:shared-report'`
      )
      .all<{
        actor: string;
        event_id: string;
        rows_exported: number;
        outcome: string;
        details: string;
      }>();
    const byPhase = Object.fromEntries(
      (rows.results ?? []).map((r) => [JSON.parse(r.details).phase as string, r])
    );
    // Every phase that ran is on record — including event_series, which ran
    // with nothing past its watermark ("ran, nothing new" ≠ "did not run").
    expect(Object.keys(byPhase).sort()).toEqual([
      'anon_id_returns',
      'corridor_density_baseline',
      'event_series',
    ]);
    expect(byPhase.event_series.rows_exported).toBe(0);
    expect(JSON.parse(byPhase.event_series.details).rows_read).toBe(0);
    for (const [phase, r] of Object.entries(byPhase)) {
      expect(r.actor).toBe('cron:scheduler');
      expect(r.outcome).toBe('success');
      const d = JSON.parse(r.details);
      const expected = phase === 'event_series' ? 0 : 1;
      expect(r.rows_exported).toBe(expected);
      expect(d.corridor_id_present).toBe(expected);
      expect(d.corridor_id_unknown).toBe(0);
      // Counts, routing and coverage only: no hash, no cell, no event row.
      expect(r.details).not.toContain(EAGLES_RES9);
      expect(r.details).not.toMatch(/anon_id_hash|anonymous_id/);
    }
  });
});

// ── The strip, attacked ──────────────────────────────────────────────────────

describe('OSE-616 geography strip: sub-corridor rows are rejected, not trimmed', () => {
  test('the guard rejects sub-corridor columns and res8+ cells, and allows the corridor', () => {
    expect(() => assertCorridorGrainRow({ corridor_id: EAGLES_RES7, n: 1 })).not.toThrow();
    expect(() => assertCorridorGrainRow({ corridor_id: 'unknown' })).not.toThrow();
    for (const bad of [
      { h3_res9: EAGLES_RES9 },
      { h3_res7: EAGLES_RES7 },
      { lat: 41.6571 },
      { longitude: -87.6798 },
      { where_address: '13030 S Western Ave' },
      { poster_deployment_id: 'pd_1' },
      { corridor_id: EAGLES_RES9 },
      { note: EAGLES_RES9 },
      { corridor_id: EAGLES_RES9.toUpperCase() },
      { note: '89266454447FFFF' },
    ]) {
      expect(() => assertCorridorGrainRow(bad), JSON.stringify(bad)).toThrow(ExportGeographyError);
    }
    expect(h3Resolution(EAGLES_RES9)).toBe(9);
    expect(h3Resolution(EAGLES_RES7)).toBe(7);
    expect(isCorridorId(EAGLES_RES7)).toBe(true);
    expect(isCorridorId(EAGLES_RES9)).toBe(false);
    expect(isCorridorId('unknown')).toBe(false);
    expect(h3Resolution(EAGLES_RES9.toUpperCase())).toBe(9);
  });

  test('an unconfigured BigQuery leaves no manifest row — the phases never ran', async () => {
    await clearPipeline();
    const r = await runSharedReportBigQueryExport({ DB: tenv().DB } as SharedReportExportEnv);
    expect(r.phases.every((p) => !p.ran && p.errors === 0)).toBe(true);
    const n = await tenv()
      .DB.prepare(`SELECT COUNT(*) AS n FROM export_manifest WHERE event_id = 'cron:shared-report'`)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  test('corridor_id is a valid res7-or-coarser H3 cell or the explicit unknown — nothing else', () => {
    // H3-shaped but not a real cell (res7 with its unused digits not set to 7).
    const malformed = '870000000000000';
    expect(h3Resolution(malformed)).toBe(7);
    expect(isCorridorId(malformed)).toBe(false);
    expect(() => assertCorridorGrainRow({ corridor_id: malformed })).toThrow(ExportGeographyError);
    // A legacy named id is not geography: guard rejects it raw, the canonical
    // mapping turns it into 'unknown' before it reaches a row.
    expect(() => assertCorridorGrainRow({ corridor_id: 'corr_blue_island' })).toThrow(
      ExportGeographyError
    );
    expect(canonicalCorridorId('corr_blue_island')).toBe('unknown');
    expect(canonicalCorridorId(null)).toBe('unknown');
    expect(canonicalCorridorId(EAGLES_RES7)).toBe(EAGLES_RES7);
    // An H3-shaped value passes through so the guard judges it (res9 fails),
    // lowercased so one corridor has one spelling in the warehouse.
    expect(canonicalCorridorId(EAGLES_RES9)).toBe(EAGLES_RES9);
    expect(canonicalCorridorId(EAGLES_RES7.toUpperCase())).toBe(EAGLES_RES7);
    expect(isCorridorId(EAGLES_RES7.toUpperCase())).toBe(true);
  });

  test('BigQuery rejecting rows inside an HTTP 200 fails the phase: watermark held', async () => {
    await clearPipeline();
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, 1, 18, 3, 3, ?)`
      )
      .bind(EAGLES_RES7, new Date().toISOString())
      .run();

    installBqMock({
      insertErrors: [{ index: 0, errors: [{ reason: 'invalid', message: 'no such field' }] }],
    });
    const result = await exportCorridorDensityBaseline(exportEnv());
    vi.restoreAllMocks();

    expect(bqCalls).toHaveLength(1);
    expect(result.errors).toBe(1);
    expect(result.rowsExported).toBe(0);
    const state = await tenv()
      .DB.prepare(
        `SELECT last_export_status, last_exported_at, last_error FROM bigquery_export_state WHERE table_name = 'corridor_density_baseline'`
      )
      .first<{ last_export_status: string; last_exported_at: string; last_error: string }>();
    expect(state?.last_export_status).toBe('failed');
    expect(state?.last_error).toMatch(/rejected 1\/1 rows/);
    expect(state?.last_exported_at).toBe('1970-01-01T00:00:00.000Z');
  });

  test('an uppercase baseline key exports as the one lowercase corridor id', async () => {
    await clearPipeline();
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, 1, 18, 3, 3, ?)`
      )
      .bind(EAGLES_RES7.toUpperCase(), new Date().toISOString())
      .run();

    installBqMock();
    const result = await exportCorridorDensityBaseline(exportEnv());
    vi.restoreAllMocks();

    expect(result.errors).toBe(0);
    expect(bqCalls.flatMap((c) => c.rows.map((r) => r.json.corridor_id))).toEqual([EAGLES_RES7]);
  });

  test('the legacy insertAll client also fails on rows rejected inside an HTTP 200', async () => {
    installBqMock({
      insertErrors: [{ index: 0, errors: [{ reason: 'invalid', message: 'bad' }] }],
    });
    const attempt = bigQueryInsertRows(
      {
        ...BQ_ENV,
        WORKER_ENV: 'development',
        BIGQUERY_DATASET_ID: 'oursharedevents_backup_dev',
      } as never,
      'events_backup',
      [{ id: 'evt_1' }]
    );
    await expect(attempt).rejects.toThrow(/rejected 1\/1 rows/);
    vi.restoreAllMocks();
    expect(bqCalls).toHaveLength(1);
  });

  test('a res9 corridor key in the baseline fails the phase closed: nothing sent, watermark held', async () => {
    await clearPipeline();
    // A legacy events.corridor_id holding a res9 node would flow into the
    // baseline key (COALESCE(h3_res7, corridor_id)) — seed that state directly.
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, 1, 18, 3, 3, ?)`
      )
      .bind(EAGLES_RES9, new Date().toISOString())
      .run();

    installBqMock();
    const result = await exportCorridorDensityBaseline(exportEnv());
    vi.restoreAllMocks();

    expect(result.errors).toBe(1);
    expect(result.rowsExported).toBe(0);
    expect(bqCalls).toEqual([]);
    const state = await tenv()
      .DB.prepare(
        `SELECT last_export_status, last_exported_at, last_error FROM bigquery_export_state WHERE table_name = 'corridor_density_baseline'`
      )
      .first<{ last_export_status: string; last_exported_at: string; last_error: string }>();
    expect(state?.last_export_status).toBe('failed');
    expect(state?.last_error).toMatch(/res9 cell/);
    expect(state?.last_exported_at).toBe('1970-01-01T00:00:00.000Z');
  });
});
