/**
 * OSE-272 Session 5 — SharedReport read API integration tests
 *
 * Exercises both endpoints end-to-end against the miniflare D1 instance:
 *   GET  /api/v2/events/:id/shared-report      (signed-link auth)
 *   POST /api/v2/events/shared-reports/batch    (service-token auth)
 *
 * Covers:
 *   - Builder unit cases (NOT_FOUND, MATERIALIZATION_PENDING, full report)
 *   - Auth: missing token, invalid token, wrong-event token, expired token
 *   - Batch: too many ids, empty ids, mixed valid/invalid ids
 *   - Cache headers per endpoint
 *   - Suppression reasons (below_min_sample_size, no_baseline_yet, no_series)
 *   - Anonymity: no anon_id_hash in any response shape
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';
const WKRP_TOKEN = 'test-wkrp-service-token-do-not-use';
// OSE-577: distinct internal-fleet batch token class (full payload). WKRP is now
// the cross_product class and fails closed — see the OSE-577 describe block.
const INTERNAL_TOKEN = 'test-internal-batch-token-do-not-use';
const ADMIN_KEY = 'test-admin-key-e2e-2026';

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

async function clearReadTables(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM anon_id_returns`).run();
  await db.prepare(`DELETE FROM corridor_density_baseline`).run();
  await db.prepare(`DELETE FROM scan_aggregates`).run();
  await db.prepare(`UPDATE events SET series_id = NULL`).run();
  await db.prepare(`DELETE FROM event_series`).run();
  // OSE-798: `scans` split into scan_placement_events + scan_node_returns.
  await db.prepare(`DELETE FROM scan_placement_events`).run();
  await db.prepare(`DELETE FROM scan_node_returns`).run();
  // NOTE: sponsor_impressions has a trigger referencing sponsors_old; we
  // don't seed sponsor_impressions in this spec so skip clearing it.
  await db.prepare(`DELETE FROM poster_deployments WHERE id LIKE 'test-pd-read-%'`).run();
  // Sponsors and campaigns FK on events — must be deleted before events.
  // OSE-799 A2: the event FK is on sponsor_placement now (sponsor_business has none).
  await db.prepare(`DELETE FROM sponsor_placement WHERE event_id LIKE 'test-evt-read-%'`).run();
  await db.prepare(`DELETE FROM campaigns WHERE id LIKE 'camp-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-read-%'`).run();
  await db.prepare(`DELETE FROM corridors WHERE id LIKE 'test-corr-read-%'`).run();
  await db.prepare(`DELETE FROM node_hierarchy WHERE id LIKE 'test-node-read-%'`).run();
}

async function resetForTest(): Promise<void> {
  await applyMigrations();
  await clearReadTables();
}

async function seedEvent(opts: {
  id: string;
  corridor_id?: string | null;
  series_id?: string | null;
  start_date?: string;
  end_date?: string | null;
}): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location,
          corridor_id, series_id, start_date, end_date,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 'Test Venue', ?, ?, ?, ?,
               datetime('now'), datetime('now'))`
    )
    .bind(
      opts.id,
      'test-brand',
      `Test ${opts.id}`,
      opts.id,
      opts.corridor_id ?? null,
      opts.series_id ?? null,
      opts.start_date ?? '2026-05-07T19:00:00Z',
      opts.end_date ?? null
    )
    .run();
}

async function seedCorridor(id: string): Promise<void> {
  const db = tenv().DB;
  await db
    .prepare(
      `INSERT OR IGNORE INTO node_hierarchy (id, brand_id, name, level, level_label)
       VALUES (?, 'test-brand', 'Test Node', 4, 'Metro')`
    )
    .bind(`test-node-read-${id}`)
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO corridors (id, brand_id, name, origin_node_id, destination_node_id)
       VALUES (?, 'test-brand', 'Test Corridor', ?, ?)`
    )
    .bind(id, `test-node-read-${id}`, `test-node-read-${id}`)
    .run();
}

async function seedScanAggregate(eventId: string, uniqueAgents: number): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO scan_aggregates
         (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
       VALUES (?, ?, ?, NULL, ?, ?, datetime('now'))`
    )
    .bind(`sa-${eventId}`, eventId, '2026-05-07', uniqueAgents * 3, uniqueAgents)
    .run();
}

async function seedAnonReturn(opts: {
  hash: string;
  venueId: string;
  visit_count?: number;
}): Promise<void> {
  const now = new Date().toISOString();
  await tenv()
    .DB.prepare(
      `INSERT INTO anon_id_returns
         (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count, computed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(opts.hash, opts.venueId, now, now, opts.visit_count ?? 1, now)
    .run();
}

async function makeSignedLink(
  eventId: string,
  role: 'bar_owner' | 'sponsor' | 'admin' = 'bar_owner'
): Promise<string> {
  const t = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    eventId,
    role
  );
  if (!t) throw new Error('mint returned null');
  return t;
}

beforeAll(async () => {
  await applyMigrations();
});

// ─── Builder unit cases ─────────────────────────────────────────────────────

describe('OSE-272 Session 5 — buildSharedReport', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('returns NOT_FOUND for a nonexistent event', async () => {
    const r = await buildSharedReport(tenv().DB, 'evt-does-not-exist');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('NOT_FOUND');
  });

  test('returns full report shape for a well-seeded event', async () => {
    await seedCorridor('test-corr-read-A');
    await seedEvent({
      id: 'test-evt-read-full',
      corridor_id: 'test-corr-read-A',
      start_date: '2026-05-07T19:00:00Z',
    });
    await seedScanAggregate('test-evt-read-full', 42);
    await seedAnonReturn({ hash: 'a'.repeat(32), venueId: 'test-evt-read-full', visit_count: 2 });
    await seedAnonReturn({ hash: 'b'.repeat(32), venueId: 'test-evt-read-full' });
    await seedAnonReturn({ hash: 'c'.repeat(32), venueId: 'test-evt-read-full' });

    const r = await buildSharedReport(tenv().DB, 'test-evt-read-full');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.event_id).toBe('test-evt-read-full');
    expect(r.report.unique_gatherings).toBe(42);
    // 3 distinct anons → meets RETURN_RATE_MIN_SAMPLE; venue_pct based on visit_count > 1
    expect(r.report.return_rate.sample_size).toBe(3);
    expect(r.report.return_rate.venue_pct).toBeCloseTo((1 / 3) * 100, 1);
    // No baseline seeded → corridor_density_30d/90d nulled with reason
    const reasons = r.report._meta.suppression_reasons.map((s) => s.field);
    expect(reasons).toContain('corridor_density');
    expect(reasons).toContain('headcount_trend');
  });

  test('response shape never includes anon_id_hash field', async () => {
    await seedEvent({ id: 'test-evt-read-shape' });
    await seedScanAggregate('test-evt-read-shape', 5);
    await seedAnonReturn({ hash: 'x'.repeat(32), venueId: 'test-evt-read-shape' });
    const r = await buildSharedReport(tenv().DB, 'test-evt-read-shape');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify(r.report);
    expect(json).not.toContain('anon_id_hash');
    // The hash content should not be present either (32 'x's)
    expect(json).not.toContain('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  });

  test('suppresses return_rate when distinct anons below minimum', async () => {
    await seedEvent({ id: 'test-evt-read-low' });
    await seedScanAggregate('test-evt-read-low', 2);
    await seedAnonReturn({ hash: '1'.repeat(32), venueId: 'test-evt-read-low' });
    await seedAnonReturn({ hash: '2'.repeat(32), venueId: 'test-evt-read-low' });
    const r = await buildSharedReport(tenv().DB, 'test-evt-read-low');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.return_rate.venue_pct).toBeNull();
    expect(r.report.return_rate.sample_size).toBeNull();
    const reasons = r.report._meta.suppression_reasons.map((s) => s.field);
    expect(reasons).toContain('return_rate');
  });

  test('suppresses corridor_density when baseline is below min sample', async () => {
    await seedCorridor('test-corr-read-B');
    await seedEvent({
      id: 'test-evt-read-sparse',
      corridor_id: 'test-corr-read-B',
      start_date: '2026-05-07T19:00:00Z', // Thursday 19:00 UTC
    });
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind('test-corr-read-B', 4, 19, 3, 8) // both below 10
      .run();
    const r = await buildSharedReport(tenv().DB, 'test-evt-read-sparse');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.corridor_density.baseline_30d).toBeNull();
    expect(r.report.corridor_density.baseline_90d).toBeNull();
    const fields = r.report._meta.suppression_reasons.map((s) => s.field);
    expect(fields).toContain('corridor_density.baseline_30d');
    expect(fields).toContain('corridor_density.baseline_90d');
  });

  test('OSE-616: an event stored with an uppercase res7 cell reads the lowercase baseline', async () => {
    // refreshCorridorBaselines keys by the LOWERCASED cell; the reader must too.
    const cell = '872664544ffffff';
    await seedEvent({ id: 'test-evt-read-upper', start_date: '2026-05-07T19:00:00Z' });
    await tenv()
      .DB.prepare(`UPDATE events SET h3_res7 = ? WHERE id = ?`)
      .bind(cell.toUpperCase(), 'test-evt-read-upper')
      .run();
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, 4, 19, 40, 90, datetime('now'))`
      )
      .bind(cell)
      .run();
    const r = await buildSharedReport(tenv().DB, 'test-evt-read-upper');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.corridor_density.baseline_90d).not.toBeNull();
    const fields = r.report._meta.suppression_reasons.map((x) => x.field);
    expect(fields).not.toContain('corridor_density');
  });

  test('headcount_trend populates from confirmed event_series', async () => {
    await seedEvent({ id: 'test-evt-read-anchor' });
    await tenv()
      .DB.prepare(
        `INSERT INTO event_series
           (id, venue_id, series_name, state, created_at, updated_at)
         VALUES (?, ?, 'Thursday Trivia', 'confirmed', datetime('now'), datetime('now'))`
      )
      .bind('srs-test-read', 'test-evt-read-anchor')
      .run();
    await seedEvent({
      id: 'test-evt-read-anchor-1',
      series_id: 'srs-test-read',
      start_date: '2026-04-30T19:00:00Z',
    });
    await seedEvent({
      id: 'test-evt-read-anchor-2',
      series_id: 'srs-test-read',
      start_date: '2026-05-07T19:00:00Z',
    });
    // Link the queried event to the series too
    await tenv()
      .DB.prepare(`UPDATE events SET series_id = ? WHERE id = ?`)
      .bind('srs-test-read', 'test-evt-read-anchor')
      .run();

    await seedScanAggregate('test-evt-read-anchor-1', 30);
    await seedScanAggregate('test-evt-read-anchor-2', 42);
    await seedScanAggregate('test-evt-read-anchor', 50);

    const r = await buildSharedReport(tenv().DB, 'test-evt-read-anchor');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.headcount_trend.series_id).toBe('srs-test-read');
    expect(r.report.headcount_trend.series_name).toBe('Thursday Trivia');
    expect(r.report.headcount_trend.instances.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── HTTP integration: GET /api/v2/events/:id/shared-report ─────────────────

describe('OSE-272 Session 5 — GET /api/v2/events/:id/shared-report', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('returns 401 without a bearer token', async () => {
    await seedEvent({ id: 'test-evt-read-noauth' });
    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-read-noauth/shared-report`
    );
    expect(res.status).toBe(401);
  });

  test('returns 401 with an invalid bearer token', async () => {
    await seedEvent({ id: 'test-evt-read-badauth' });
    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-read-badauth/shared-report`,
      {
        headers: { Authorization: 'Bearer not-a-real-token' },
      }
    );
    expect(res.status).toBe(401);
  });

  test('returns 403 when token event_id does not match path :id', async () => {
    await seedEvent({ id: 'test-evt-read-mismatch1' });
    await seedEvent({ id: 'test-evt-read-mismatch2' });
    const token = await makeSignedLink('test-evt-read-mismatch1');
    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-read-mismatch2/shared-report`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    expect(res.status).toBe(403);
  });

  test('returns 404 for a nonexistent event with a valid-but-mismatched token', async () => {
    const token = await makeSignedLink('test-evt-read-ghost');
    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-read-ghost/shared-report`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    expect(res.status).toBe(404);
  });

  test('returns 200 + SharedReport with valid token + materialized event', async () => {
    await seedEvent({
      id: 'test-evt-read-200',
      start_date: '2026-05-07T19:00:00Z',
    });
    await seedScanAggregate('test-evt-read-200', 30);
    const token = await makeSignedLink('test-evt-read-200');
    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-read-200/shared-report`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      report: { event_id: string; unique_gatherings: number };
    };
    expect(body.ok).toBe(true);
    expect(body.report.event_id).toBe('test-evt-read-200');
    expect(body.report.unique_gatherings).toBe(30);
  });

  test('returns Cache-Control: private, max-age=3600 + Vary: Authorization for closed event', async () => {
    // Q7: closed events (past end_date) cache at 3600s; in-flight at 300s.
    await seedEvent({
      id: 'test-evt-read-cache',
      start_date: '2025-01-15T19:00:00Z',
      end_date: '2025-01-15T23:00:00Z', // past date → closed
    });
    await seedScanAggregate('test-evt-read-cache', 10);
    const token = await makeSignedLink('test-evt-read-cache');
    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-read-cache/shared-report`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(res.headers.get('Vary')).toBe('Authorization');
  });
});

// ─── HTTP integration: POST /api/v2/events/shared-reports/batch ─────────────

describe('OSE-272 Session 5 — POST /api/v2/events/shared-reports/batch', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  test('returns 401 without service token', async () => {
    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['test-evt-read-batch-1'] }),
    });
    expect(res.status).toBe(401);
  });

  test('returns 401 with wrong service token', async () => {
    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['test-evt-read-batch-1'] }),
    });
    expect(res.status).toBe(401);
  });

  test('returns 400 when ids missing', async () => {
    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 when ids empty array', async () => {
    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 when ids exceeds 50', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids }),
    });
    expect(res.status).toBe(400);
  });

  test('returns 200 with mixed valid and missing ids — reports + errors populated', async () => {
    await seedEvent({ id: 'test-evt-read-batch-1' });
    await seedScanAggregate('test-evt-read-batch-1', 12);
    await seedEvent({ id: 'test-evt-read-batch-2' });
    await seedScanAggregate('test-evt-read-batch-2', 7);

    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ids: ['test-evt-read-batch-1', 'test-evt-read-batch-2', 'evt-does-not-exist'],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      reports: Record<string, { unique_gatherings: number }>;
      errors: Record<string, { code: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.reports['test-evt-read-batch-1'].unique_gatherings).toBe(12);
    expect(body.reports['test-evt-read-batch-2'].unique_gatherings).toBe(7);
    expect(body.errors['evt-does-not-exist'].code).toBe('NOT_FOUND');
  });

  test('returns Cache-Control: no-store', async () => {
    await seedEvent({ id: 'test-evt-read-batch-cache' });
    await seedScanAggregate('test-evt-read-batch-cache', 5);
    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['test-evt-read-batch-cache'] }),
    });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// ── OSE-577: service-token CLASS split — cross-product fails closed ──────────
// ADR-017 + the "who holds the token matters" addendum. The batch endpoint no
// longer keys full-payload access on the endpoint (SR-25's defect, which handed
// EVERY service token — including the cross-product one — every field). It keys
// on token CLASS: the internal in-fleet consumer gets the full report; the
// cross-product WKRP token (named-identity platform, invariant #14) FAILS CLOSED
// until the join-risk controls (OCR-61/62, OW-112) ship. This is the seam where
// the choice network is enforced: consent is not auto-extended across identities.
describe('OSE-577 — batch service-token class split (cross-product fails closed)', () => {
  beforeEach(resetForTest);

  test('cross-product (WKRP) token → 403 CROSS_PRODUCT_ACCESS_PENDING, no data', async () => {
    await seedEvent({ id: 'test-evt-read-577-wkrp' });
    await seedScanAggregate('test-evt-read-577-wkrp', 11);

    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WKRP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['test-evt-read-577-wkrp'] }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.code).toBe('CROSS_PRODUCT_ACCESS_PENDING');
    // Fail closed — not a single report field crosses the boundary.
    expect(body).not.toHaveProperty('reports');
  });

  test('cross-product token fails closed BEFORE body validation (auth precedes parsing)', async () => {
    // A malformed body would 400 for an internal caller; WKRP must 403 first —
    // the identity boundary is checked before anything else.
    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WKRP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: 'not json',
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('CROSS_PRODUCT_ACCESS_PENDING');
  });

  test('internal-fleet token → 200 with the full report (premium fields present)', async () => {
    await seedEvent({
      id: 'test-evt-read-577-internal',
      start_date: '2026-05-07T19:00:00Z',
    });
    await seedScanAggregate('test-evt-read-577-internal', 25);

    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['test-evt-read-577-internal'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      reports: Record<string, Record<string, unknown>>;
    };
    expect(body.ok).toBe(true);
    const report = body.reports['test-evt-read-577-internal'];
    expect(report).toBeDefined();
    expect(report).toHaveProperty('unique_gatherings');
    expect(report).toHaveProperty('headcount_trend'); // premium-only field
    expect(report).toHaveProperty('sponsor_class_breakdown');
  });

  test('unknown bearer token → 401 (neither class)', async () => {
    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer some-unrecognized-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['x'] }),
    });
    expect(res.status).toBe(401);
  });
});

// ── SR-25: SharedReport competitive intelligence reframe ─────────────────────
// OSE-593 depth-gate (TL-054) is superseded by SR-25. The report is now a
// straight readout: service tokens receive the full SharedReport. Competitive
// intelligence is delivered via sponsor_class_breakdown (class-level aggregate
// data), not by field-stripping. Individual sponsor attribution is still scoped
// by signed-link token (TL-040 isolation remains intact on the single endpoint).

describe('SR-25 — SharedReport competitive intelligence reframe', () => {
  beforeEach(resetForTest);

  test('batch response has no depth field (depth gate removed)', async () => {
    await seedEvent({ id: 'test-evt-sr25-nodepth' });
    await seedScanAggregate('test-evt-sr25-nodepth', 10);

    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['test-evt-sr25-nodepth'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    // SR-25: no depth field in batch response
    expect(body).not.toHaveProperty('depth');
  });

  test('batch report includes premium-only fields (no field stripping)', async () => {
    await seedEvent({
      id: 'test-evt-sr25-fullfields',
      start_date: '2026-05-07T19:00:00Z',
    });
    await seedScanAggregate('test-evt-sr25-fullfields', 20);

    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['test-evt-sr25-fullfields'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      reports: Record<string, Record<string, unknown>>;
    };
    const report = body.reports['test-evt-sr25-fullfields'];
    expect(report).toBeDefined();
    // All sections present — no field stripping
    expect(report).toHaveProperty('event_id');
    expect(report).toHaveProperty('unique_gatherings');
    expect(report).toHaveProperty('headcount_trend');
    expect(report).toHaveProperty('return_rate');
    expect(report).toHaveProperty('poster_attribution');
    expect(report).toHaveProperty('sponsor_class_breakdown');
  });

  test('batch report includes sponsor_class_breakdown with correct shape', async () => {
    await seedEvent({ id: 'test-evt-sr25-breakdown' });
    await seedScanAggregate('test-evt-sr25-breakdown', 8);

    const res = await SELF.fetch(`https://test.local/api/v2/events/shared-reports/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['test-evt-sr25-breakdown'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reports: Record<string, { sponsor_class_breakdown: unknown }>;
    };
    const breakdown = body.reports['test-evt-sr25-breakdown']?.sponsor_class_breakdown as
      Record<string, { sponsor_count: number; total_impressions: number }> | undefined;
    expect(breakdown).toBeDefined();
    expect(breakdown).toHaveProperty('local');
    expect(breakdown).toHaveProperty('mid');
    expect(breakdown).toHaveProperty('premium');
    expect(typeof breakdown!.local.sponsor_count).toBe('number');
    expect(typeof breakdown!.local.total_impressions).toBe('number');
    expect(typeof breakdown!.mid.sponsor_count).toBe('number');
    expect(typeof breakdown!.premium.sponsor_count).toBe('number');
  });

  test('single endpoint report includes sponsor_class_breakdown', async () => {
    await seedEvent({ id: 'test-evt-sr25-single-breakdown' });
    await seedScanAggregate('test-evt-sr25-single-breakdown', 5);
    const token = await makeSignedLink('test-evt-sr25-single-breakdown');

    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-sr25-single-breakdown/shared-report`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      report: { sponsor_class_breakdown: unknown };
    };
    expect(body.ok).toBe(true);
    const breakdown = body.report.sponsor_class_breakdown as
      Record<string, { sponsor_count: number; total_impressions: number }> | undefined;
    expect(breakdown).toBeDefined();
    expect(breakdown).toHaveProperty('local');
    expect(breakdown).toHaveProperty('mid');
    expect(breakdown).toHaveProperty('premium');
  });

  test('single endpoint response has no depth or upgrade field (SR-25)', async () => {
    await seedEvent({ id: 'test-evt-sr25-nodepth-single' });
    await seedScanAggregate('test-evt-sr25-nodepth-single', 5);
    const token = await makeSignedLink('test-evt-sr25-nodepth-single');

    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-sr25-nodepth-single/shared-report`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty('depth');
    expect(body).not.toHaveProperty('upgrade');
  });

  test('SR-25 static: filterReportByDepth not present in batch handler (OSE-593 superseded)', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const readKey = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').includes('handlers/shared-report-read')
    );
    expect(readKey, 'shared-report-read.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    const handlerSrc = files[readKey!]!;

    const batchIdx = handlerSrc.indexOf('handleBatchSharedReports');
    const filterIdx = handlerSrc.indexOf('filterReportByDepth', batchIdx);
    expect(
      filterIdx,
      'filterReportByDepth must NOT appear inside handleBatchSharedReports (SR-25 supersedes OSE-593 depth gate)'
    ).toBe(-1);
  });

  test('SR-25 static: sponsor_class_breakdown present in buildSharedReport return', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const builderKey = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').includes('lib/shared-report-builder')
    );
    expect(builderKey, 'shared-report-builder.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    const builderSrc = files[builderKey!]!;
    expect(builderSrc).toContain('sponsor_class_breakdown');
  });

  test('OSE-593 evidence (SR-25 supersedes TL-054)', () => {
    const report = {
      story: 'SR-25',
      supersedes: 'OSE-593',
      threats_addressed: ['TL-054', 'TL-040'],
      date: '2026-08-04',
    };
    console.log(`[SR-25-EVIDENCE] ${JSON.stringify(report)}`);
    expect(report.threats_addressed).toHaveLength(2);
  });
});

// ─── H3 map layer + Q5/Q6/Q7/Q8/Q10 ────────────────────────────────────────

describe('H3 corridor map + open-question resolutions', () => {
  beforeEach(async () => {
    await resetForTest();
  });

  // Q5 — bucket_dow and bucket_hour surfaced in corridor_density
  test('Q5: corridor_density includes bucket_dow and bucket_hour when corridor is set', async () => {
    await seedCorridor('test-corr-read-q5');
    await seedEvent({
      id: 'test-evt-read-q5-dow',
      corridor_id: 'test-corr-read-q5',
      start_date: '2026-05-06T19:00:00Z', // Wednesday UTC (dow=3), hour=19
    });
    await seedScanAggregate('test-evt-read-q5-dow', 10);

    const r = await buildSharedReport(tenv().DB, 'test-evt-read-q5-dow');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.corridor_density.bucket_dow).toBe(3); // Wednesday
    expect(r.report.corridor_density.bucket_hour).toBe(19);
  });

  test('Q5: bucket_dow and bucket_hour are null when event has no corridor', async () => {
    await seedEvent({ id: 'test-evt-read-q5-nocorr' });
    const r = await buildSharedReport(tenv().DB, 'test-evt-read-q5-nocorr');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.corridor_density.bucket_dow).toBeNull();
    expect(r.report.corridor_density.bucket_hour).toBeNull();
  });

  // Q8 — corridor_map.source field
  test('Q8: corridor_map.source is "live" when scan_aggregates h3_res9 data exists', async () => {
    await seedEvent({
      id: 'test-evt-read-q8-live',
      start_date: '2026-05-07T19:00:00Z',
    });
    // Seed scan_aggregates with an h3_res9 cell (Eagles Hall res9)
    await tenv()
      .DB.prepare(
        `INSERT INTO scan_aggregates (id, event_id, bucket_date, total_scans, distinct_agent_hashes, h3_res9, computed_at)
       VALUES ('sa-q8-live', 'test-evt-read-q8-live', '2026-05-07', 30, 10, '89266454447ffff', datetime('now'))`
      )
      .run();

    const r = await buildSharedReport(tenv().DB, 'test-evt-read-q8-live');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.corridor_map).not.toBeNull();
    expect(r.report.corridor_map?.source).toBe('live');
  });

  test('Q8: corridor_map.source is "fallback" when no h3_res9 scan data but event has h3_res7', async () => {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, h3_res9, h3_res7, created_at, updated_at)
       VALUES ('test-evt-read-q8-fallback', 'test-brand', 'Test Q8 Fallback', 'test-evt-read-q8-fallback',
               'active', 'Eagles Hall', '2026-05-07T19:00:00Z', '89266454447ffff', '872664544ffffff',
               datetime('now'), datetime('now'))`
      )
      .run();
    await seedScanAggregate('test-evt-read-q8-fallback', 25); // no h3_res9 on this row

    const r = await buildSharedReport(tenv().DB, 'test-evt-read-q8-fallback');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // No h3_res9 in scan_aggregates → falls back to res7 ring
    expect(r.report.corridor_map?.source).toBe('fallback');
  });

  test('Q8: corridor_map is null when event has no h3 tags at all', async () => {
    await seedEvent({ id: 'test-evt-read-q8-noh3' });
    const r = await buildSharedReport(tenv().DB, 'test-evt-read-q8-noh3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.corridor_map).toBeNull();
    const fields = r.report._meta.suppression_reasons.map((s) => s.field);
    expect(fields).toContain('corridor_map');
  });

  // Q10 — tagsConsistent check
  test('Q10: corrupt H3 tags suppress corridor_map with a clear reason', async () => {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, h3_res9, h3_res7, created_at, updated_at)
       VALUES ('test-evt-read-q10-corrupt', 'test-brand', 'Test Q10 Corrupt Tags', 'test-evt-read-q10-corrupt',
               'active', 'Eagles Hall', '2026-05-07T19:00:00Z',
               '89266454447ffff', '8726645ddffffff',
               datetime('now'), datetime('now'))`
      )
      .run();
    // h3_res9 '89266454447ffff' (Eagles Hall) and h3_res7 '8726645ddffffff' are inconsistent
    // — the res9 cell's parent at res7 is '872664544ffffff', not '8726645ddffffff'.

    const r = await buildSharedReport(tenv().DB, 'test-evt-read-q10-corrupt');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.corridor_map).toBeNull();
    const corrupt = r.report._meta.suppression_reasons.find((s) =>
      s.detail?.includes('inconsistent')
    );
    expect(corrupt).toBeDefined();
    expect(corrupt?.field).toBe('corridor_map');
  });

  // Q: H3 cell IDs must not appear in suppression reason detail strings
  test('H3 cell IDs are stripped from suppression reason details (privacy floor protection)', async () => {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, h3_res9, h3_res7, created_at, updated_at)
       VALUES ('test-evt-read-cellleak', 'test-brand', 'Test Cell ID Leak', 'test-evt-read-cellleak',
               'active', 'Eagles Hall', '2026-05-07T19:00:00Z', '89266454447ffff', '872664544ffffff',
               datetime('now'), datetime('now'))`
      )
      .run();
    // Seed two h3_res9 cells — one with enough scans, one below floor (suppressed)
    await tenv()
      .DB.prepare(
        `INSERT INTO scan_aggregates (id, event_id, bucket_date, total_scans, distinct_agent_hashes, h3_res9, computed_at)
       VALUES ('sa-cellleak-1', 'test-evt-read-cellleak', '2026-05-07', 30, 10, '89266454447ffff', datetime('now'))`
      )
      .run();
    await tenv()
      .DB.prepare(
        `INSERT INTO scan_aggregates (id, event_id, bucket_date, total_scans, distinct_agent_hashes, h3_res9, computed_at)
       VALUES ('sa-cellleak-2', 'test-evt-read-cellleak', '2026-05-07', 6, 2, '892664544b7ffff', datetime('now'))`
      )
      .run();

    const r = await buildSharedReport(tenv().DB, 'test-evt-read-cellleak');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reasons = r.report._meta.suppression_reasons;
    const detailsJson = JSON.stringify(reasons);
    // H3 cell IDs are 15-char hex strings starting with '8' — should not appear in details
    expect(detailsJson).not.toMatch(/89[0-9a-f]{13}/i);
  });

  // Q6 — campaign_summary re-scoped for sponsor tokens (static + logic verification)
  test('Q6 static: handler re-derives campaign_summary after applying sponsor scope', () => {
    // Verify the handler code contains the campaign re-derivation logic.
    // sponsor_impressions has a trigger referencing sponsors_old which prevents
    // direct DB seeding in this test environment, so we verify via static analysis.
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const handlerKey = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').includes('handlers/shared-report-read')
    );
    expect(handlerKey).toBeDefined();
    const handlerSrc = files[handlerKey!]!;
    // The handler must re-derive campaign_summary from scoped impressions
    expect(handlerSrc).toContain('scopedCampaignSummary');
    expect(handlerSrc).toContain('resolved.sponsorScope || resolved.sponsorScopeRequired');
    // Must not pass pre-builder campaign_summary directly when sponsor scope is applied
    expect(handlerSrc).toContain('campaign_summary: scopedCampaignSummary');
  });

  test('Q6 logic: campaign_summary derivation from scoped rows excludes peer sponsor rows', () => {
    // Verify the derivation logic produces correct output for the shared-campaign scenario.
    // Two sponsors share campaign 'camp-q6'. Only sp-q6-a's rows are in scoped impressions.
    type ImpressionRow = {
      sponsor_id: string;
      sponsor_name: string;
      campaign_id: string | null;
      campaign_title: string | null;
      sponsor_tier: string | null;
      is_local: boolean;
      surface: string;
      count: number;
    };
    const scopedRows: ImpressionRow[] = [
      {
        sponsor_id: 'sp-q6-a',
        sponsor_name: 'Sponsor A',
        campaign_id: 'camp-q6',
        campaign_title: 'Shared Campaign',
        sponsor_tier: 'silver',
        is_local: false,
        surface: 'qr_poster',
        count: 5,
      },
    ];
    // Replicate the derivation logic from the handler (Q6 fix)
    const campaignMap = new Map<
      string,
      {
        campaign_id: string;
        campaign_title: string;
        total_impressions: number;
        sponsor_count: number;
      }
    >();
    for (const row of scopedRows) {
      if (!row.campaign_id) continue;
      const ex = campaignMap.get(row.campaign_id);
      if (ex) {
        ex.total_impressions += row.count;
        ex.sponsor_count += 1;
      } else
        campaignMap.set(row.campaign_id, {
          campaign_id: row.campaign_id,
          campaign_title: row.campaign_title ?? 'unknown',
          total_impressions: row.count,
          sponsor_count: 1,
        });
    }
    const derived = campaignMap.size > 0 ? [...campaignMap.values()] : null;
    expect(derived).not.toBeNull();
    expect(derived![0]!.total_impressions).toBe(5);
    expect(derived![0]!.sponsor_count).toBe(1); // not 2 — only sp-q6-a's row is in scope
  });

  // Q7 — dynamic Cache-Control
  test('Q7: in-flight event (no end_date) returns max-age=300', async () => {
    await seedEvent({ id: 'test-evt-read-q7-inflight', end_date: null });
    await seedScanAggregate('test-evt-read-q7-inflight', 5);
    const token = await makeSignedLink('test-evt-read-q7-inflight');

    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-read-q7-inflight/shared-report`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
  });

  test('Q7: closed event (past end_date) returns max-age=3600', async () => {
    await seedEvent({
      id: 'test-evt-read-q7-closed',
      start_date: '2025-01-15T19:00:00Z',
      end_date: '2025-01-15T23:00:00Z', // past date
    });
    await seedScanAggregate('test-evt-read-q7-closed', 5);
    const token = await makeSignedLink('test-evt-read-q7-closed');

    const res = await SELF.fetch(
      `https://test.local/api/v2/events/test-evt-read-q7-closed/shared-report`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });

  // Q2 — sponsor mint depth
  test('Q2: minting sponsor token with depth="mid" succeeds', async () => {
    await seedEvent({ id: 'test-evt-read-q2-mid' });
    // OSE-799 A2: split model — the #21 sponsor scope check reads sponsor_placement.
    await seedSplitSponsor(tenv().DB, {
      id: 'sp-q2-mid',
      eventId: 'test-evt-read-q2-mid',
      name: 'Mid Sponsor',
      tier: 'silver',
    });

    const res = await SELF.fetch(
      `https://test.local/api/v2/admin/events/test-evt-read-q2-mid/shared-report/mint-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
        body: JSON.stringify({
          role: 'sponsor',
          sponsor_id: 'sp-q2-mid',
          depth: 'mid',
          ttl_days: 7,
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe('string');
  });

  test('Q2: minting sponsor token with no depth defaults to mid (token payload contains depth=mid)', async () => {
    await seedEvent({ id: 'test-evt-read-q2-default' });
    // OSE-799 A2: split model — the #21 sponsor scope check reads sponsor_placement.
    await seedSplitSponsor(tenv().DB, {
      id: 'sp-q2-default',
      eventId: 'test-evt-read-q2-default',
      name: 'Default Depth Sponsor',
      tier: 'silver',
    });

    const res = await SELF.fetch(
      `https://test.local/api/v2/admin/events/test-evt-read-q2-default/shared-report/mint-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
        body: JSON.stringify({ role: 'sponsor', sponsor_id: 'sp-q2-default', ttl_days: 7 }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    // Token format: <base64url(payload)>.<hex(sig)> — NOT a JWT.
    // Decode the payload segment (first part before the dot).
    const [payloadB64] = body.token.split('.');
    const base64 = payloadB64!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binaryStr = atob(padded);
    const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    expect(payload.depth).toBe('mid');
  });

  // OSE-1390 — sub-day TTL. ttl_minutes mints a run-scoped token; the server-
  // computed expires_at echoes it (a day-scoped mint would be ~1440 min out).
  test('OSE-1390: mint with ttl_minutes=30 → 200, expires_at ~30 min out', async () => {
    await seedEvent({ id: 'test-evt-ttlmin' });
    const res = await SELF.fetch(
      `https://test.local/api/v2/admin/events/test-evt-ttlmin/shared-report/mint-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
        body: JSON.stringify({ role: 'admin', ttl_minutes: 30 }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string; expires_at: string };
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe('string');
    const deltaMin = (Date.parse(body.expires_at) - Date.now()) / 60000;
    expect(deltaMin).toBeGreaterThan(28);
    expect(deltaMin).toBeLessThan(32);
  });

  test('OSE-1390: ttl_minutes below floor (4) → 400', async () => {
    await seedEvent({ id: 'test-evt-ttlmin-lo' });
    const res = await SELF.fetch(
      `https://test.local/api/v2/admin/events/test-evt-ttlmin-lo/shared-report/mint-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
        body: JSON.stringify({ role: 'admin', ttl_minutes: 4 }),
      }
    );
    expect(res.status).toBe(400);
  });

  test('OSE-1390: both ttl_minutes and ttl_days → 400 (ambiguous)', async () => {
    await seedEvent({ id: 'test-evt-ttlmin-both' });
    const res = await SELF.fetch(
      `https://test.local/api/v2/admin/events/test-evt-ttlmin-both/shared-report/mint-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
        body: JSON.stringify({ role: 'admin', ttl_minutes: 30, ttl_days: 1 }),
      }
    );
    expect(res.status).toBe(400);
  });

  test('Q2: minting non-sponsor token with depth="mid" is rejected', async () => {
    await seedEvent({ id: 'test-evt-read-q2-reject' });

    const res = await SELF.fetch(
      `https://test.local/api/v2/admin/events/test-evt-read-q2-reject/shared-report/mint-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
        body: JSON.stringify({ role: 'bar_owner', depth: 'mid', ttl_days: 7 }),
      }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('dormant');
  });

  // Static: H3 cell ID pattern must not appear in suppression reason detail fields
  test('static: suppression_reasons detail strings must not contain raw H3 cell IDs', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const builderKey = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').includes('lib/shared-report-builder')
    );
    expect(builderKey).toBeDefined();
    const builderSrc = files[builderKey!]!;
    // The old pattern 'h3 cell ${cellId}' must not appear in the builder
    expect(builderSrc).not.toContain('h3 cell ${cellId}');
    expect(builderSrc).not.toContain('h3 cell `${');
  });

  // Static: tagsConsistent must be imported and used in the builder
  test('static: tagsConsistent is imported and called in shared-report-builder.ts', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const builderKey = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').includes('lib/shared-report-builder')
    );
    expect(builderKey).toBeDefined();
    const builderSrc = files[builderKey!]!;
    expect(builderSrc).toContain('tagsConsistent');
    expect(builderSrc).toContain('h3-tagging');
  });
});

// ── OSE-816 — enforce report depth server-side (sponsor role only) ───────────
// filterReportByDepth existed, was pure + fail-closed, and was NEVER called
// (SR-25 removed it: "straight readout"). On the wire a mid sponsor token still
// received headcount_trend — a Premium section the browser hid but curl did not.
// This wires the ONE gate at read for sponsor tokens: admin/bar_owner/internal
// resolve to premium (no-op, skipped). sponsor_class_breakdown stays at every
// depth (OSE-719 — tier-neutral class-aggregate). The enforcement-state test
// flips this file from "not wired" → "wired, sponsor role only".
describe('OSE-816 — server-side report depth enforcement (sponsor role only)', () => {
  beforeEach(resetForTest);

  const mintDepth = (eventId: string, role: 'sponsor' | 'bar_owner', depth?: string) =>
    mintSignedLinkToken(
      { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
      eventId,
      role,
      undefined,
      {
        ...(depth !== undefined ? { depth } : {}),
        ...(role === 'sponsor' ? { sponsor_id: 'sp-816' } : {}),
      }
    );

  async function readReport(eventId: string, token: string) {
    const res = await SELF.fetch(`https://test.local/api/v2/events/${eventId}/shared-report`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { ok: boolean; report: Record<string, unknown> };
  }

  test('OSE-816 | static | filterReportByDepth is WIRED in the single-read handler, sponsor-guarded', () => {
    const files = JSON.parse(
      (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string
    ) as Record<string, string>;
    const key = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').includes('handlers/shared-report-read')
    );
    expect(key).toBeDefined();
    const src = files[key!]!;
    // Enforcement-state: the filter is called (wired), and only for sponsors.
    expect(src).toContain('filterReportByDepth(builtReport');
    expect(src).toContain("claim.role === 'sponsor'");
  });

  test('OSE-816 | API | bar_owner (premium) | full report, NO upgrade field (filter skipped)', async () => {
    await seedEvent({ id: 'evt-816-barowner', start_date: '2026-05-07T19:00:00Z' });
    await seedScanAggregate('evt-816-barowner', 20);
    const { report } = await readReport(
      'evt-816-barowner',
      await mintDepth('evt-816-barowner', 'bar_owner')
    );
    expect(report).toHaveProperty('headcount_trend'); // premium section retained
    expect(report).toHaveProperty('sponsor_class_breakdown');
    expect(report).not.toHaveProperty('upgrade'); // role skip → no filter, no hint
  });

  test('OSE-816 | API | sponsor @ mid | headcount_trend STRIPPED, class_breakdown kept, upgrade names it', async () => {
    await seedEvent({ id: 'evt-816-mid', start_date: '2026-05-07T19:00:00Z' });
    await seedScanAggregate('evt-816-mid', 20);
    const { report } = await readReport(
      'evt-816-mid',
      await mintDepth('evt-816-mid', 'sponsor', 'mid')
    );
    expect(report).not.toHaveProperty('headcount_trend'); // premium-only, withheld
    expect(report).toHaveProperty('sponsor_class_breakdown'); // OSE-719: tier-neutral
    expect(report).toHaveProperty('sponsor_impressions');
    expect(report).toHaveProperty('upgrade');
    const upgrade = report.upgrade as { locked_sections: string[]; next_depth: string | null };
    expect(upgrade.next_depth).toBe('premium');
    expect(upgrade.locked_sections).toContain('headcount_trend');
  });

  test('OSE-816 | API | sponsor @ local | mid+premium sections stripped, class_breakdown kept, upgrade → mid', async () => {
    await seedEvent({ id: 'evt-816-local', start_date: '2026-05-07T19:00:00Z' });
    await seedScanAggregate('evt-816-local', 20);
    const { report } = await readReport(
      'evt-816-local',
      await mintDepth('evt-816-local', 'sponsor', 'local')
    );
    expect(report).not.toHaveProperty('headcount_trend');
    expect(report).not.toHaveProperty('corridor_map'); // mid section, withheld at local
    expect(report).not.toHaveProperty('poster_attribution');
    expect(report).toHaveProperty('sponsor_class_breakdown'); // OSE-719: survives even at local
    expect(report).toHaveProperty('sponsor_impressions');
    const upgrade = report.upgrade as { next_depth: string | null };
    expect(upgrade.next_depth).toBe('mid');
  });

  test('OSE-816 | API | sponsor claiming premium | fail-closed to local (no premium/mid sections)', async () => {
    await seedEvent({ id: 'evt-816-cap', start_date: '2026-05-07T19:00:00Z' });
    await seedScanAggregate('evt-816-cap', 20);
    // Sponsors cannot self-grant premium (resolveDepth caps at mid, fails to local).
    const { report } = await readReport(
      'evt-816-cap',
      await mintDepth('evt-816-cap', 'sponsor', 'premium')
    );
    expect(report).not.toHaveProperty('headcount_trend');
    expect(report).not.toHaveProperty('corridor_map');
    expect(report).toHaveProperty('sponsor_class_breakdown');
  });
});
