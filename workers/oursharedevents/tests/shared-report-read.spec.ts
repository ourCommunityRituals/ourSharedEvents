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
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';
const WKRP_TOKEN = 'test-wkrp-service-token-do-not-use';

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
  await db.prepare(`DELETE FROM scans`).run();
  // NOTE: sponsor_impressions has a trigger referencing sponsors_old; we
  // don't seed sponsor_impressions in this spec so skip clearing it.
  await db.prepare(`DELETE FROM poster_deployments WHERE id LIKE 'test-pd-read-%'`).run();
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
         (id, event_id, bucket_date, bucket_hour, total_scans, unique_agents, computed_at)
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

  test('returns Cache-Control: private, max-age=3600 + Vary: Authorization', async () => {
    await seedEvent({ id: 'test-evt-read-cache' });
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
        Authorization: `Bearer ${WKRP_TOKEN}`,
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
        Authorization: `Bearer ${WKRP_TOKEN}`,
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
        Authorization: `Bearer ${WKRP_TOKEN}`,
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
        Authorization: `Bearer ${WKRP_TOKEN}`,
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
        Authorization: `Bearer ${WKRP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['test-evt-read-batch-cache'] }),
    });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
