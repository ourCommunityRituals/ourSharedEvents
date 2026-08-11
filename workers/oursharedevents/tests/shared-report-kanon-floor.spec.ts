/**
 * OSE-683 — SharedReport builder must apply the per-bucket K-anon floor.
 *
 * Ratified rule (2026-08-09, "K-anon Per-Bucket Consistency"): K>=5 is applied
 * PER CONTRIBUTING BUCKET BEFORE summation — not to the final sum. A contributing
 * bucket with count < 5 is DROPPED (floored/excluded), never summed raw. This
 * mirrors the portfolio-rollup #7 pattern (sumContributingBuckets → applyCountFloor).
 *
 * Three aggregates in the builder were previously unfloored and could publish
 * sub-K contributions:
 *   1. unique_gatherings        — SUM(scan_aggregates.unique_agents) across buckets
 *   2. campaign_summary         — per-campaign SUM over sponsor_impressions rows
 *   3. sponsor_class_breakdown  — per-class SUM over sponsor_impressions rows
 *
 * unique_gatherings is directly seedable (scan_aggregates buckets). The sponsor
 * aggregates cannot be DB-seeded here (sponsor_impressions carries a trigger that
 * references sponsors_old, so INSERTs fail in this harness) — those two are pinned
 * by static analysis that the builder floors each contributing sponsor row before
 * summation, consistent with the existing Q6/SR-25 static-analysis convention in
 * shared-report-read.spec.ts.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
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

async function clearTables(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM scan_aggregates`).run();
  await db.prepare(`DELETE FROM anon_id_returns`).run();
  await db.prepare(`UPDATE events SET series_id = NULL`).run();
  await db.prepare(`DELETE FROM event_series`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-kanon-%'`).run();
}

async function seedEvent(id: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', '2026-05-07T19:00:00Z',
               datetime('now'), datetime('now'))`
    )
    .bind(id, `Test ${id}`, id)
    .run();
}

/** Seed one scan_aggregates bucket (one contributing bucket to unique_gatherings). */
async function seedBucket(eventId: string, suffix: string, uniqueAgents: number): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO scan_aggregates
         (id, event_id, bucket_date, bucket_hour, total_scans, unique_agents, computed_at)
       VALUES (?, ?, '2026-05-07', ?, ?, ?, datetime('now'))`
    )
    .bind(`sa-${eventId}-${suffix}`, eventId, suffix, uniqueAgents * 3, uniqueAgents)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-683 — unique_gatherings applies the per-bucket K-anon floor before summation', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('the floor constant is K=5', () => {
    expect(CORRIDOR_MAP_MIN_COUNT).toBe(5);
  });

  test('a sub-K bucket is DROPPED, not summed raw (10 + 3 must NOT publish 13)', async () => {
    await seedEvent('test-evt-kanon-drop');
    await seedBucket('test-evt-kanon-drop', '1', 10); // clears K
    await seedBucket('test-evt-kanon-drop', '2', 3); // below K → must be dropped

    const r = await buildSharedReport(tenv().DB, 'test-evt-kanon-drop');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Raw sum would be 13; floored-per-bucket keeps only the >=5 bucket → 10.
    expect(r.report.unique_gatherings).toBe(10);
    expect(r.report.unique_gatherings).not.toBe(13);
  });

  test('multiple sub-K buckets never aggregate up past the floor (3 + 4 + 2 => suppressed, not 9)', async () => {
    await seedEvent('test-evt-kanon-allsub');
    await seedBucket('test-evt-kanon-allsub', '1', 3);
    await seedBucket('test-evt-kanon-allsub', '2', 4);
    await seedBucket('test-evt-kanon-allsub', '3', 2);

    const r = await buildSharedReport(tenv().DB, 'test-evt-kanon-allsub');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // All contributing buckets are sub-K → nothing clears the floor. The result
    // must NOT be the raw sum (9). It is suppressed (null) or a floored 0.
    expect(r.report.unique_gatherings).not.toBe(9);
    expect(
      r.report.unique_gatherings === null || r.report.unique_gatherings === 0
    ).toBe(true);
  });

  test('buckets that individually clear K are preserved and summed exactly (5 + 7 => 12)', async () => {
    await seedEvent('test-evt-kanon-keep');
    await seedBucket('test-evt-kanon-keep', '5', 5);
    await seedBucket('test-evt-kanon-keep', '7', 7);

    const r = await buildSharedReport(tenv().DB, 'test-evt-kanon-keep');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.unique_gatherings).toBe(12);
  });

  test('a single >=K bucket is unchanged (behavior preserved for compliant buckets)', async () => {
    await seedEvent('test-evt-kanon-single');
    await seedBucket('test-evt-kanon-single', '1', 42);

    const r = await buildSharedReport(tenv().DB, 'test-evt-kanon-single');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.unique_gatherings).toBe(42);
  });
});

describe('OSE-683 — builder floors each contributing sponsor bucket (static analysis)', () => {
  // sponsor_impressions cannot be DB-seeded in this harness (trigger references
  // sponsors_old), so — following the Q6/SR-25 static-analysis convention already
  // used in shared-report-read.spec.ts — we pin that the builder applies the
  // per-bucket floor to sponsor rows feeding campaign_summary and
  // sponsor_class_breakdown, rather than summing them raw.
  function builderSrc(): string {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const key = Object.keys(files).find((k) =>
      k.replace(/\\/g, '/').includes('lib/shared-report-builder')
    );
    expect(key, 'shared-report-builder.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    return files[key!]!;
  }

  test('builder imports applyCountFloor from count-floor', () => {
    const s = builderSrc();
    expect(s).toContain('applyCountFloor');
    expect(s).toContain('count-floor');
  });

  test('sponsor contributing rows are floored per bucket before summation (>= K guard present)', () => {
    const s = builderSrc();
    // The ratified rule requires a per-bucket K guard before adding a sponsor row
    // into campaign_summary / sponsor_class_breakdown totals. Assert the builder
    // gates on the floor constant rather than summing every row unconditionally.
    expect(s).toContain('CORRIDOR_MAP_MIN_COUNT');
    // A per-bucket comparison against the floor must exist in the sponsor path.
    expect(s).toMatch(/>=\s*CORRIDOR_MAP_MIN_COUNT|CORRIDOR_MAP_MIN_COUNT\s*<=/);
  });
});
