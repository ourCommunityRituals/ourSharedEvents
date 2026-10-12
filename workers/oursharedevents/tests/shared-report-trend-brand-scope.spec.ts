/**
 * Part of OSE-1421 — `headcount_trend` must never cross brands (Invariant #9).
 *
 * The defect (CCR, three-loop Security-led read): `event_series` has no brand
 * column, the series detector clustered on location + weekday + hour alone, and
 * the trend query filtered on `series_id` only. A report for brand A could carry
 * brand B's floored headcounts as trend points, and a brand B event that happened
 * to share a venue string with A's could be the series anchor.
 *
 * Owner ruling (2026-10-01): `event_series` NEVER groups events across brands.
 * The fix is a brand predicate on the detector AND on the trend read, not a scope
 * flag. Both are exercised here, behaviourally, against the miniflare D1.
 *
 * Every test ends with the never-who assertion over the payload: counts and
 * series labels only, no person-shaped key anywhere in the report.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { detectEventSeriesClusters } from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const BRAND_A = 'test-brand-trend-a';
const BRAND_B = 'test-brand-trend-b';

// Keys that would make a report person-shaped. A report is counts and labels.
const BANNED_KEY =
  /^(anon_id_hash|anonymous_id|anon_id|ip|ip_hash|user_agent|user_agent_hash|session|session_id|device|device_id|fingerprint|email|phone|lat|lon|latitude|longitude)$/i;

function bannedKeysIn(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => bannedKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(BANNED_KEY.test(k) ? [`${path}.${k}`] : []),
      ...bannedKeysIn(v, `${path}.${k}`),
    ]);
  }
  return [];
}

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
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE 'test-evt-trend-%'`).run();
  await db.prepare(`UPDATE events SET series_id = NULL`).run();
  await db.prepare(`DELETE FROM event_series`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-trend-%'`).run();
}

async function seedEvent(opts: {
  id: string;
  brand: string;
  startOffsetDays?: number; // negative = past; default relative to now
  start_date?: string;
  location?: string;
  series_id?: string | null;
}): Promise<void> {
  const start =
    opts.start_date ??
    new Date(Date.now() + (opts.startOffsetDays ?? -7) * 86_400_000).toISOString();
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, series_id, start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      opts.id,
      opts.brand,
      `Test ${opts.id}`,
      opts.id,
      opts.location ?? 'Shared Tap House',
      opts.series_id ?? null,
      start
    )
    .run();
}

async function seedSeries(id: string, anchorEventId: string, state = 'confirmed'): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO event_series (id, venue_id, series_name, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(id, anchorEventId, `Series ${id}`, state)
    .run();
}

async function linkSeries(eventId: string, seriesId: string): Promise<void> {
  await tenv()
    .DB.prepare(`UPDATE events SET series_id = ? WHERE id = ?`)
    .bind(seriesId, eventId)
    .run();
}

async function seedBucket(eventId: string, uniqueAgents: number): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO scan_aggregates
         (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
       VALUES (?, ?, '2026-05-07', NULL, ?, ?, datetime('now'))`
    )
    .bind(`sa-${eventId}`, eventId, uniqueAgents * 3, uniqueAgents)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
});

describe('headcount_trend reads only the reporting event’s own brand', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('two brands share venue + weekday + hour: brand A’s trend carries only brand A instances', async () => {
    // One confirmed series that (through legacy cross-brand clustering) holds
    // instances of BOTH brands at the same venue, weekday and hour.
    const when = (weeks: number) =>
      new Date(Date.UTC(2026, 3, 2 + 7 * weeks, 19, 0, 0)).toISOString();
    await seedEvent({ id: 'test-evt-trend-a1', brand: BRAND_A, start_date: when(0) });
    await seedEvent({ id: 'test-evt-trend-a2', brand: BRAND_A, start_date: when(1) });
    await seedEvent({ id: 'test-evt-trend-b1', brand: BRAND_B, start_date: when(2) });
    await seedEvent({ id: 'test-evt-trend-b2', brand: BRAND_B, start_date: when(3) });
    await seedSeries('srs-trend-x', 'test-evt-trend-a1');
    for (const id of ['a1', 'a2', 'b1', 'b2'])
      await linkSeries(`test-evt-trend-${id}`, 'srs-trend-x');
    await seedBucket('test-evt-trend-a1', 11);
    await seedBucket('test-evt-trend-a2', 12);
    await seedBucket('test-evt-trend-b1', 77);
    await seedBucket('test-evt-trend-b2', 88);

    const r = await buildSharedReport(tenv().DB, 'test-evt-trend-a1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const ids = r.report.headcount_trend.instances.map((i) => i.event_id).sort();
    expect(ids).toEqual(['test-evt-trend-a1', 'test-evt-trend-a2']);
    // Brand B's floored headcounts must not appear anywhere in brand A's report.
    const json = JSON.stringify(r.report);
    expect(json).not.toContain('test-evt-trend-b');
    expect(json).not.toContain('"distinct_scanners":77');
    expect(json).not.toContain('"distinct_scanners":88');

    expect(bannedKeysIn(r.report)).toEqual([]);
  });

  test('a series anchored at another brand’s event is withheld, not shown with its name', async () => {
    await seedEvent({ id: 'test-evt-trend-own', brand: BRAND_A, startOffsetDays: -7 });
    await seedEvent({ id: 'test-evt-trend-foreign-anchor', brand: BRAND_B, startOffsetDays: -14 });
    await seedSeries('srs-trend-foreign', 'test-evt-trend-foreign-anchor');
    await linkSeries('test-evt-trend-own', 'srs-trend-foreign');
    await linkSeries('test-evt-trend-foreign-anchor', 'srs-trend-foreign');
    await seedBucket('test-evt-trend-own', 9);
    await seedBucket('test-evt-trend-foreign-anchor', 60);

    const r = await buildSharedReport(tenv().DB, 'test-evt-trend-own');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.report.headcount_trend.series_id).toBeNull();
    expect(r.report.headcount_trend.series_name).toBeNull();
    expect(r.report.headcount_trend.instances).toEqual([]);
    const reason = r.report._meta.suppression_reasons.find((s) => s.field === 'headcount_trend');
    expect(reason?.reason).toBe('no_series');
    expect(JSON.stringify(r.report)).not.toContain('foreign');
    expect(bannedKeysIn(r.report)).toEqual([]);
  });

  test('a single-brand series still reports every one of its instances (no over-filtering)', async () => {
    await seedEvent({ id: 'test-evt-trend-s1', brand: BRAND_A, startOffsetDays: -21 });
    await seedEvent({ id: 'test-evt-trend-s2', brand: BRAND_A, startOffsetDays: -14 });
    await seedEvent({ id: 'test-evt-trend-s3', brand: BRAND_A, startOffsetDays: -7 });
    await seedSeries('srs-trend-own', 'test-evt-trend-s1');
    for (const id of ['s1', 's2', 's3']) await linkSeries(`test-evt-trend-${id}`, 'srs-trend-own');
    await seedBucket('test-evt-trend-s1', 6);
    await seedBucket('test-evt-trend-s2', 8);
    await seedBucket('test-evt-trend-s3', 10);

    const r = await buildSharedReport(tenv().DB, 'test-evt-trend-s3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.headcount_trend.series_id).toBe('srs-trend-own');
    expect(r.report.headcount_trend.instances.map((i) => i.distinct_scanners)).toEqual([6, 8, 10]);
    expect(bannedKeysIn(r.report)).toEqual([]);
  });
});

describe('the series detector never clusters across brands', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  // Same venue string, weekday and hour: 7 days apart keeps weekday + hour equal.
  async function seedWeekly(prefix: string, brand: string, count: number, firstWeek = 1) {
    for (let i = 0; i < count; i++) {
      await seedEvent({
        id: `test-evt-trend-${prefix}${i}`,
        brand,
        startOffsetDays: -7 * (firstWeek + i),
        location: 'Cluster Corner Pub',
      });
    }
  }

  test('2 events of brand A + 1 of brand B at one venue, weekday, hour: no cluster is proposed', async () => {
    await seedWeekly('a', BRAND_A, 2, 1);
    await seedWeekly('b', BRAND_B, 1, 3);

    const r = await detectEventSeriesClusters({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBe(0);
    const rows = await tenv().DB.prepare(`SELECT id FROM event_series`).all();
    expect(rows.results).toHaveLength(0);
  });

  test('3 + 3 events of two brands: one pending series per brand, each anchored in its own brand', async () => {
    await seedWeekly('a', BRAND_A, 3, 1);
    await seedWeekly('b', BRAND_B, 3, 4);

    const r = await detectEventSeriesClusters({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    expect(r.rowsUpserted).toBe(2);
    const rows = await tenv()
      .DB.prepare(
        `SELECT es.id, e.brand_id AS anchor_brand
           FROM event_series es JOIN events e ON e.id = es.venue_id
          WHERE es.state = 'pending'`
      )
      .all<{ id: string; anchor_brand: string }>();
    expect((rows.results ?? []).map((x) => x.anchor_brand).sort()).toEqual([BRAND_A, BRAND_B]);
  });

  test('brand A’s confirmed series at a venue does not hide brand B’s cluster there', async () => {
    await seedWeekly('a', BRAND_A, 3, 1);
    await seedWeekly('b', BRAND_B, 3, 4);
    // Brand A already has a confirmed series for this venue/weekday/hour.
    await tenv()
      .DB.prepare(
        `INSERT INTO event_series
           (id, venue_id, series_name, day_of_week, hour_of_day, state, created_at, updated_at)
         SELECT 'srs-trend-a-confirmed', e.id, 'A Pub Night',
                CAST(strftime('%w', e.start_date) AS INTEGER),
                CAST(strftime('%H', e.start_date) AS INTEGER),
                'confirmed', datetime('now'), datetime('now')
           FROM events e WHERE e.id = 'test-evt-trend-a0'`
      )
      .run();

    await detectEventSeriesClusters({ DB: tenv().DB });

    const pendingB = await tenv()
      .DB.prepare(
        `SELECT es.id FROM event_series es JOIN events e ON e.id = es.venue_id
          WHERE es.state = 'pending' AND e.brand_id = ?`
      )
      .bind(BRAND_B)
      .all();
    expect(pendingB.results).toHaveLength(1);
    // ...and brand A's own cluster is still suppressed by its own confirmed series.
    const pendingA = await tenv()
      .DB.prepare(
        `SELECT es.id FROM event_series es JOIN events e ON e.id = es.venue_id
          WHERE es.state = 'pending' AND e.brand_id = ?`
      )
      .bind(BRAND_A)
      .all();
    expect(pendingA.results).toHaveLength(0);
  });
});
