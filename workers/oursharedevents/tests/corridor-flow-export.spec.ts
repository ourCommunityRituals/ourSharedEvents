/**
 * OSE-2216: weekly corridor flow export (boundary doc section 4.1.2).
 *
 * Runs the exporter against the miniflare D1 with BigQuery mocked at fetch, and
 * checks the rules the PO approved in OCR-docs #185:
 *   - scans on posters only, production events only;
 *   - each poster-hour floored before the sum (ADR-026 rule B), a flow under 5
 *     withheld, every value rounded down to a multiple of 5;
 *   - both ends res-7, a real event type, nothing else about the place;
 *   - a week is sent once, after it ends, with a marker; a failed send is
 *     retried the next night, never skipped.
 * Every row sent must also fit bigquery/corridor_flow_export.schema.json.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';

vi.mock('../src/google/auth', () => ({
  getGoogleAccessToken: vi.fn(async () => ({ token: 'test-access-token' })),
}));

import {
  CORRIDOR_FLOW_STATE,
  exportCorridorFlows,
  weekStartOf,
  type CorridorFlowExportEnv,
} from '../src/lib/corridor-flow-export';
import { runSharedReportBigQueryExport } from '../src/handlers/shared-report-export';
import { poolSchemaViolations } from './helpers/bigquery-pool-schema';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const BQ_ENV = {
  WIF_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nMIIE-test\n-----END PRIVATE KEY-----',
  GCP_PROJECT_NUMBER: '123456789012',
  WIF_POOL_ID: 'test-pool',
  WIF_PROVIDER_ID: 'test-provider',
  GCP_PROJECT_ID: 'ose-test',
  BIGQUERY_DATASET_ID: 'oureventring_general',
  WORKER_ENV: 'production',
};
const makeEnv = (): CorridorFlowExportEnv =>
  ({ DB: tenv().DB, ...BQ_ENV }) as unknown as CorridorFlowExportEnv;

// Real res-7 cells near Eagles Hall (ADR-011).
const RES7_A = '872664544ffffff';
const RES7_B = '872664546ffffff';
const RES9 = '892664544cbffff';

// The week of Monday 2026-11-02; the run happens on Tuesday 2026-11-10.
const WEEK = '2026-11-02';
const IN_WEEK = '2026-11-03';
const RUN_AT = new Date('2026-11-10T03:00:00.000Z');

// ─── BigQuery mock ──────────────────────────────────────────────────────────

interface Call {
  dataset: string;
  table: string;
  rows: Array<{ insertId: string; json: Record<string, unknown> }>;
}
let calls: Call[] = [];
let failNext = 0;
const violations: string[] = [];

function installBqMock(): void {
  calls = [];
  failNext = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
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
      if (failNext > 0) {
        failNext--;
        return new Response('simulated BQ failure', { status: 500 });
      }
      const body = JSON.parse(String(init?.body ?? '{"rows":[]}'));
      calls.push({ dataset: m[1], table: m[2], rows: body.rows ?? [] });
      for (const r of body.rows ?? []) violations.push(...poolSchemaViolations(m[2], r.json));
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('', { status: 404 });
  });
}

const sent = () => calls.flatMap((c) => c.rows.map((r) => r.json));
const flows = () => sent().filter((r) => r.row_type === 'flow');
const markers = () => sent().filter((r) => r.row_type === 'week');

// ─── Seeding ────────────────────────────────────────────────────────────────

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function clear(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM bigquery_export_state`).run();
  await db.prepare(`DELETE FROM scan_placement_events`).run();
  await db.prepare(`DELETE FROM poster_deployments WHERE id LIKE 'cf-pd-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'cf-evt-%'`).run();
}

async function seedEvent(
  id: string,
  cell: string | null,
  opts: { type?: string | null; dataClass?: string; tier?: number | null } = {}
): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, data_class, event_type_id,
                           legal_clearance_tier, start_date, h3_res7)
       VALUES (?, 'cf-brand', ?, ?, 'active', ?, ?, ?, '2026-11-05', ?)`
    )
    .bind(
      id,
      `Event ${id}`,
      id,
      opts.dataClass ?? 'production',
      opts.type === undefined ? 'etr-rec-bocce' : opts.type,
      opts.tier === undefined ? 1 : opts.tier,
      cell
    )
    .run();
}

async function seedPoster(id: string, eventId: string, cell: string | null): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token, is_active, h3_res7)
       VALUES (?, ?, ?, 1, ?)`
    )
    .bind(id, eventId, `tok-${id}`, cell)
    .run();
}

let scanSeq = 0;
async function seedScans(
  eventId: string,
  posterId: string,
  n: number,
  bucket = `${IN_WEEK}T18:00`
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await tenv()
      .DB.prepare(
        `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
         VALUES (?, ?, ?, ?)`
      )
      .bind(`cf-scan-${scanSeq++}`, eventId, posterId, bucket)
      .run();
  }
}

/** One event in corridor B with one poster in corridor A. */
async function seedPair(n: number, opts: Parameters<typeof seedEvent>[2] = {}): Promise<void> {
  await seedEvent('cf-evt-1', RES7_B, opts);
  await seedPoster('cf-pd-1', 'cf-evt-1', RES7_A);
  await seedScans('cf-evt-1', 'cf-pd-1', n);
}

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await clear();
  installBqMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  const found = violations.splice(0);
  expect(found, 'a row does not fit bigquery/corridor_flow_export.schema.json').toEqual([]);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('OSE-2216 corridor flows: what a row is', () => {
  test('weekStartOf gives the UTC Monday', () => {
    expect(weekStartOf(new Date('2026-11-02T00:00:00Z'))).toBe('2026-11-02');
    expect(weekStartOf(new Date('2026-11-08T23:59:59Z'))).toBe('2026-11-02');
    expect(weekStartOf(new Date('2026-11-09T00:00:00Z'))).toBe('2026-11-09');
  });

  test('one flow: week, both res-7 cells, the event type, scans rounded down to 5', async () => {
    await seedPair(13);
    const r = await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(r.errors).toBe(0);
    expect(flows()).toHaveLength(1);
    const row = flows()[0];
    expect(row).toMatchObject({
      week: WEEK,
      source_cell: RES7_A,
      destination_cell: RES7_B,
      uec_code: 'REC-BOCCE-001',
      scans: 10,
      corridor_id: RES7_A,
      venue_id: 'corridor-aggregate',
      regulatory_pool: 'general',
      product_id: 'ose',
    });
    expect(Object.keys(row).sort()).toEqual(
      [
        'computed_at',
        'corridor_id',
        'destination_cell',
        'event_type',
        'exported_at',
        'product_id',
        'regulatory_pool',
        'row_type',
        'scans',
        'source_cell',
        'uec_code',
        'venue_id',
        'week',
      ].sort()
    );
    expect(calls.every((c) => c.dataset === 'oureventring_general')).toBe(true);
    expect(calls.every((c) => c.table === 'corridor_flow_export')).toBe(true);
  });

  test('each poster-hour is floored before the sum: 7 + 3 publishes 5, not 10', async () => {
    await seedEvent('cf-evt-1', RES7_B);
    await seedPoster('cf-pd-1', 'cf-evt-1', RES7_A);
    await seedPoster('cf-pd-2', 'cf-evt-1', RES7_A);
    await seedScans('cf-evt-1', 'cf-pd-1', 7);
    await seedScans('cf-evt-1', 'cf-pd-2', 3);
    await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(flows().map((f) => f.scans)).toEqual([5]);
  });

  test('one poster in two hours is two parts: 4 + 4 is withheld', async () => {
    await seedEvent('cf-evt-1', RES7_B);
    await seedPoster('cf-pd-1', 'cf-evt-1', RES7_A);
    await seedScans('cf-evt-1', 'cf-pd-1', 4, `${IN_WEEK}T18:00`);
    await seedScans('cf-evt-1', 'cf-pd-1', 4, `${IN_WEEK}T19:00`);
    const r = await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(flows()).toEqual([]);
    expect(r.rowsSkipped).toBe(1);
  });

  test('a flow under 5 is left out entirely, and the week still gets its marker', async () => {
    await seedPair(4);
    await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(flows()).toEqual([]);
    expect(markers()).toEqual([
      expect.objectContaining({ week: WEEK, flows_in_week: 0, corridor_id: 'unknown' }),
    ]);
  });

  test('synthetic and demo events never leave', async () => {
    // One production flow A -> B starts the history; the synthetic and demo
    // traffic runs B -> A in the same week and must not appear.
    await seedPair(10);
    await seedEvent('cf-evt-2', RES7_A, { dataClass: 'synthetic' });
    await seedPoster('cf-pd-2', 'cf-evt-2', RES7_B);
    await seedScans('cf-evt-2', 'cf-pd-2', 20);
    await seedEvent('cf-evt-3', RES7_A, { dataClass: 'demo' });
    await seedPoster('cf-pd-3', 'cf-evt-3', RES7_B);
    await seedScans('cf-evt-3', 'cf-pd-3', 20);
    await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(flows().map((f) => [f.source_cell, f.destination_cell, f.scans])).toEqual([
      [RES7_A, RES7_B, 10],
    ]);
  });

  test('with no production scan at all there is no history to start', async () => {
    await seedPair(20, { dataClass: 'synthetic' });
    const r = await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(r.rowsRead).toBe(0);
    expect(calls).toEqual([]);
  });

  test('an event with no type is withheld, never sent as "unknown"', async () => {
    await seedPair(20, { type: null });
    const r = await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(flows()).toEqual([]);
    expect(r.rowsSkipped).toBe(1);
  });

  test('an unclassifiable clearance tier is withheld from every pool', async () => {
    await seedPair(20, { tier: 9 });
    const r = await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(flows()).toEqual([]);
    expect(r.rowsSkipped).toBe(1);
  });

  test('a cell stored in capitals is sent lower case, one corridor one spelling', async () => {
    await seedEvent('cf-evt-1', RES7_B.toUpperCase());
    await seedPoster('cf-pd-1', 'cf-evt-1', RES7_A.toUpperCase());
    await seedScans('cf-evt-1', 'cf-pd-1', 5);
    await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(flows()[0]).toMatchObject({ source_cell: RES7_A, destination_cell: RES7_B });
  });

  test('a cell finer than res 7 never leaves (the row is withheld)', async () => {
    await seedEvent('cf-evt-1', RES7_B);
    await seedPoster('cf-pd-1', 'cf-evt-1', RES9);
    await seedScans('cf-evt-1', 'cf-pd-1', 20);
    await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(flows()).toEqual([]);
    expect(JSON.stringify(sent())).not.toContain(RES9);
  });

  test('no poster id, token or hour is in anything sent', async () => {
    await seedPair(20);
    await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    const text = JSON.stringify(calls);
    expect(text).not.toContain('cf-pd-1');
    expect(text).not.toContain('tok-cf-pd-1');
    expect(text).not.toContain('cf-evt-1');
    expect(text).not.toContain('T18:00');
  });
});

describe('OSE-2216 corridor flows: weeks, append only', () => {
  test('the current week is not sent until it has ended', async () => {
    await seedEvent('cf-evt-1', RES7_B);
    await seedPoster('cf-pd-1', 'cf-evt-1', RES7_A);
    await seedScans('cf-evt-1', 'cf-pd-1', 10, '2026-11-10T01:00');
    await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(calls).toEqual([]);
    await exportCorridorFlows(makeEnv(), { now: new Date('2026-11-16T03:00:00Z') });
    expect(flows()).toEqual([expect.objectContaining({ week: '2026-11-09', scans: 10 })]);
  });

  test('a week is sent once: the next night sends nothing again', async () => {
    await seedPair(10);
    await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    await exportCorridorFlows(makeEnv(), { now: new Date('2026-11-11T03:00:00Z') });
    expect(calls.length).toBe(first);
    const state = await tenv()
      .DB.prepare(`SELECT last_exported_at FROM bigquery_export_state WHERE table_name = ?`)
      .bind(CORRIDOR_FLOW_STATE)
      .first<{ last_exported_at: string }>();
    expect(state?.last_exported_at).toBe(WEEK);
  });

  test('every complete week gets a marker, empty weeks included', async () => {
    await seedPair(10);
    const r = await exportCorridorFlows(makeEnv(), { now: new Date('2026-11-24T03:00:00Z') });
    expect(r.weeksExported).toBe(3);
    expect(markers().map((m) => [m.week, m.flows_in_week])).toEqual([
      ['2026-11-02', 1],
      ['2026-11-09', 0],
      ['2026-11-16', 0],
    ]);
  });

  test('a first run over a long history is bounded per night', async () => {
    await seedPair(10);
    const r = await exportCorridorFlows(makeEnv(), {
      now: new Date('2026-12-28T03:00:00Z'),
      maxWeeks: 2,
    });
    expect(r.weeksExported).toBe(2);
    expect(markers().map((m) => m.week)).toEqual(['2026-11-02', '2026-11-09']);
  });

  test('a failed send is retried the next night with the same insertIds, never skipped', async () => {
    await seedPair(10);
    failNext = 1;
    const r1 = await exportCorridorFlows(makeEnv(), { now: RUN_AT });
    expect(r1.errors).toBe(1);
    const state = await tenv()
      .DB.prepare(
        `SELECT last_exported_at, last_export_status FROM bigquery_export_state WHERE table_name = ?`
      )
      .bind(CORRIDOR_FLOW_STATE)
      .first<{ last_exported_at: string; last_export_status: string }>();
    expect(state?.last_export_status).toBe('failed');
    expect(state?.last_exported_at).not.toBe(WEEK);

    const r2 = await exportCorridorFlows(makeEnv(), { now: new Date('2026-11-11T03:00:00Z') });
    expect(r2.errors).toBe(0);
    expect(flows()).toHaveLength(1);
    const ids = calls.flatMap((c) => c.rows.map((x) => x.insertId));
    expect(ids).toContain(`cf-${WEEK}-${RES7_A}-${RES7_B}-REC-BOCCE-001-general`);
    expect(ids).toContain(`cf-${WEEK}-week-general`);
  });

  test('a week holding more parts than the bound fails closed: nothing of it is sent', async () => {
    await seedEvent('cf-evt-1', RES7_B);
    await seedPoster('cf-pd-1', 'cf-evt-1', RES7_A);
    await seedScans('cf-evt-1', 'cf-pd-1', 5, `${IN_WEEK}T18:00`);
    await seedScans('cf-evt-1', 'cf-pd-1', 5, `${IN_WEEK}T19:00`);
    const r = await exportCorridorFlows(makeEnv(), { now: RUN_AT, maxParts: 1 });
    expect(r.errors).toBe(1);
    expect(calls).toEqual([]);
  });

  test('BigQuery not configured: nothing runs and no state is written', async () => {
    await seedPair(10);
    const r = await exportCorridorFlows({ DB: tenv().DB } as CorridorFlowExportEnv, {
      now: RUN_AT,
    });
    expect(r.ran).toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe('OSE-2216 corridor flows: the nightly export runs it', () => {
  test('runSharedReportBigQueryExport has a corridor_flows phase', async () => {
    const out = await runSharedReportBigQueryExport(makeEnv() as never);
    expect(out.phases.map((p) => p.phase)).toContain('corridor_flows');
  });
});
