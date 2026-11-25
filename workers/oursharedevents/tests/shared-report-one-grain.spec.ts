/**
 * OSE-1784 (owner, 2026-11-23, "one number, from the posters"): the SharedReport
 * counts people in ONE grain, the published poster rows.
 *
 * The defect: three people figures came from three grains, each floored on its
 * own. `return_rate.sample_size` and `corridor_density.this_event_count` were
 * the whole-event distinct count (anon_id_returns), `scans` summed
 * scan_aggregates hours, and `poster_attribution` summed poster-hours. Hours of
 * 7 and 3 different people at one poster published a poster sum of 5 beside a
 * sample size of 10, so the 3 under the floor could be read off by subtraction.
 *
 * The rule now: scans, this_event_count (and its density ratios)
 * and this event's scan_trend instance are the sum of the published
 * poster rows, through `floorTotalOfParts`; the sample size is never published.
 * The neighbour harness (shared-report-neighbour-floor.spec.ts) holds the same
 * rule over every dataset it builds, in its field registry ("poster sum").
 *
 * @born-red OSE-1784 | method: the real case on main's builder (sample_size 10
 * and this_event_count 10 beside a poster sum of 5) | date: 2026-11-23
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { buildSharedReport, type SharedReport } from '../src/lib/shared-report-builder';
import { CORRIDOR_MAP_MIN_COUNT, refreshCorridorBaselines } from '../src/lib/shared-report';
import { clearPosterHours, seedPosterHour } from './helpers/seed-poster-hours';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const K = CORRIDOR_MAP_MIN_COUNT;

const PREFIX = 'test-evt-grain-';
const CELL7 = '872664544ffffff';
// 2026-05-07 is a Thursday (dow 4); the event starts at 19:00 UTC.
const START = '2026-05-07T19:00:00Z';

let migrated = false;
async function applyMigrations(): Promise<void> {
  if (migrated) return;
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
  migrated = true;
}

async function clearTables(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM anon_id_returns WHERE venue_id LIKE ?`).bind(`${PREFIX}%`).run();
  await db.prepare(`DELETE FROM corridor_density_baseline WHERE corridor_id = ?`).bind(CELL7).run();
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE ?`).bind(`${PREFIX}%`).run();
  await clearPosterHours(db, PREFIX);
  await db.prepare(`UPDATE events SET series_id = NULL WHERE id LIKE ?`).bind(`${PREFIX}%`).run();
  await db.prepare(`DELETE FROM event_series WHERE id LIKE 'ser-grain-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE ?`).bind(`${PREFIX}%`).run();
}

/**
 * One event in a corridor with a baseline and a confirmed series, so every
 * people figure is in the report. `hours` are scans at its one poster, hour by
 * hour (different people each hour); `attendees` are anon_id_returns rows, and
 * `bucketPeople` a scan_aggregates hour the report must not count from.
 */
async function seedEvent(
  id: string,
  opts: { hours: number[]; attendees: number; bucketPeople?: number }
): Promise<void> {
  const db = tenv().DB;
  await db
    .prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, h3_res7, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(id, `Grain ${id}`, id, CELL7, START)
    .run();
  const series = `ser-grain-${id}`;
  await db
    .prepare(
      `INSERT INTO event_series (id, venue_id, series_name, state, created_at, updated_at)
       VALUES (?, ?, 'Thursday League', 'confirmed', datetime('now'), datetime('now'))`
    )
    .bind(series, id)
    .run();
  await db.prepare(`UPDATE events SET series_id = ? WHERE id = ?`).bind(series, id).run();
  await db
    .prepare(
      `INSERT OR REPLACE INTO corridor_density_baseline
         (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
       VALUES (?, 4, 19, 40, 80, datetime('now'))`
    )
    .bind(CELL7)
    .run();
  for (const [i, n] of opts.hours.entries()) await seedPosterHour(db, id, 19 + i, n);
  for (let i = 0; i < opts.attendees; i++) {
    await db
      .prepare(
        `INSERT INTO anon_id_returns
           (anon_id_hash, venue_id, first_seen_at, last_seen_at, return_count, computed_at)
         VALUES (?, ?, datetime('now'), datetime('now'), 1, datetime('now'))`
      )
      .bind(`grain${id}${String(i).padStart(40, '0')}`, id)
      .run();
  }
  if (opts.bucketPeople) {
    await db
      .prepare(
        `INSERT INTO scan_aggregates
           (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
         VALUES (?, ?, '2026-05-07', 19, ?, ?, datetime('now'))`
      )
      .bind(`sa-${id}`, id, opts.bucketPeople * 2, opts.bucketPeople)
      .run();
  }
}

async function build(id: string): Promise<SharedReport> {
  const r = await buildSharedReport(tenv().DB, id);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('report did not build');
  return r.report;
}

/** Every published people figure of a report, by name. */
function peopleFigures(rep: SharedReport, id: string): Record<string, number | null> {
  return {
    scans: rep.scans,
    'corridor_density.this_event_count': rep.corridor_density.this_event_count,
    'scan_trend (this event)':
      rep.scan_trend.instances.find((i) => i.event_id === id)?.scans ?? null,
  };
}

const posterSum = (rep: SharedReport): number =>
  rep.poster_attribution.reduce((sum, p) => sum + p.scan_count, 0);

beforeAll(applyMigrations);

describe('one people figure, from the posters (OSE-1784)', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('the real case: hours of 7 and 3 people at one poster publish 5 everywhere, never 10', async () => {
    const id = `${PREFIX}real`;
    // 10 different people: 7 in the first hour, 3 in the second.
    await seedEvent(id, { hours: [7, 3], attendees: 10, bucketPeople: 10 });
    const rep = await build(id);

    // The poster row: the 7-hour rounded to 5, the 3-hour under the floor.
    expect(rep.poster_attribution.map((p) => p.scan_count)).toEqual([5]);
    expect(posterSum(rep)).toBe(5);
    // Every figure is that same 5; none is the whole-event 10. (return_rate and
    // its sample size were retired by OSE-2214, so no key is left to check.)
    expect('return_rate' in rep).toBe(false);
    expect(peopleFigures(rep, id)).toEqual({
      scans: 5,
      'corridor_density.this_event_count': 5,
      'scan_trend (this event)': 5,
    });
    // And the density ratios are worked out from it, not from the 10.
    expect(rep.corridor_density.density_ratio_30d).toBeCloseTo(5 / 40, 9);
    expect(rep.corridor_density.density_ratio_90d).toBeCloseTo(5 / 80, 9);
  });

  test('no two people figures differ, for any split of up to 14 people over two hours', async () => {
    const gaps: string[] = [];
    let n = 0;
    for (let a = 0; a <= 14; a++) {
      for (let b = 0; b <= 14 - a; b++) {
        await clearTables();
        const id = `${PREFIX}split-${n++}`;
        await seedEvent(id, { hours: [a, b], attendees: a + b, bucketPeople: a + b });
        const rep = await build(id);
        const sum = rep.poster_attribution.length > 0 ? posterSum(rep) : null;
        for (const [name, v] of Object.entries(peopleFigures(rep, id))) {
          if (v !== sum) {
            gaps.push(`${a}+${b}: ${name} = ${v}, poster sum = ${sum}`);
          }
        }
        // A published figure is never a count under the floor.
        if (sum !== null) expect(sum).toBeGreaterThanOrEqual(K);
      }
    }
    expect(gaps).toEqual([]);
  });

  test('scan_aggregates hours no longer reach any people figure', async () => {
    const id = `${PREFIX}buckets`;
    await seedEvent(id, { hours: [], attendees: 0, bucketPeople: 42 });
    const rep = await build(id);
    expect(rep.poster_attribution).toEqual([]);
    expect(peopleFigures(rep, id)).toEqual({
      scans: null,
      'corridor_density.this_event_count': null,
      'scan_trend (this event)': null,
    });
    // Withheld in words that name only the floor.
    const note = rep._meta.suppression_reasons.find(
      (s) => s.field === 'corridor_density.this_event_count'
    );
    expect(note?.reason).toBe('below_min_sample_size');
    expect(note?.detail?.match(/\d+/g)).toEqual([String(K)]);
    // The aggregate row still dates the report.
    expect(rep._meta.materialized_at).not.toBeNull();
  });

  // OSE-1784 (owner, 2026-11-23, "posters too"): the corridor baseline is the
  // sum of the events' published poster figures. Before, it counted distinct
  // people, so an event alone in its slot published its people (15) beside its
  // poster sum (10), and the difference said someone was there whom no
  // published figure counts.
  test('an event alone in its slot: the baseline it builds is its own poster sum, never its people', async () => {
    const id = `${PREFIX}alone`;
    const start = new Date(Date.now() - 10 * 86400_000);
    // A fixed hour, so the slot's own hour is never the people figure (15);
    // a run at 15:00 UTC once read bucket_hour 15 as a leak.
    start.setUTCHours(4, 0, 0, 0);
    // 12 and 3 at one poster: 10 published; 15 different people came.
    await seedEvent(id, { hours: [12, 3], attendees: 15 });
    await tenv()
      .DB.prepare(`UPDATE events SET start_date = ? WHERE id = ?`)
      .bind(start.toISOString(), id)
      .run();
    await tenv()
      .DB.prepare(`DELETE FROM corridor_density_baseline WHERE corridor_id = ?`)
      .bind(CELL7)
      .run();

    const r = await refreshCorridorBaselines({ DB: tenv().DB });
    expect(r.errors).toBe(0);
    const row = await tenv()
      .DB.prepare(
        `SELECT window_30d_count, window_90d_count FROM corridor_density_baseline
          WHERE corridor_id = ? AND bucket_dow = ? AND bucket_hour = ?`
      )
      .bind(CELL7, start.getUTCDay(), start.getUTCHours())
      .first<{ window_30d_count: number; window_90d_count: number }>();
    expect(row).toEqual({ window_30d_count: 10, window_90d_count: 10 });

    const rep = await build(id);
    expect(posterSum(rep)).toBe(10);
    expect(rep.corridor_density.this_event_count).toBe(10);
    // Like divided by like: the event is the whole of its baseline.
    expect(rep.corridor_density.density_ratio_30d).toBe(1);
    // Timestamps are taken out first: their minutes and seconds are clock
    // readings, not figures, and can read :15 on any run.
    const figures = JSON.stringify(rep).replace(/"\d{4}-\d\d-\d\dT[^"]*"/g, '""');
    expect(figures).not.toMatch(/:15\b/);
  });

  // The baseline must be the report's own figure, summed, whatever the event
  // holds: two events in one slot, several posters, an hour under the floor,
  // the room's vote code, and scans filed against another event's poster.
  test('two events in one slot: the baseline is the sum of their this_event_count, every edge included', async () => {
    const db = tenv().DB;
    const a = `${PREFIX}pair-a`;
    const b = `${PREFIX}pair-b`;
    const start = new Date(Date.now() - 10 * 86400_000);
    start.setUTCMinutes(0, 0, 0);
    // a: poster 1 has hours of 7 and 3 (5 published), poster 2 has 6 (5).
    await seedEvent(a, { hours: [7, 3], attendees: 16 });
    await seedPosterHour(db, a, 21, 6, `${a}-p2`);
    // a's vote code: 9 scans in one hour, never a people figure.
    await seedPosterHour(db, a, 22, 9, `${a}-vote`);
    await db
      .prepare(`UPDATE poster_deployments SET is_vote_code = 1 WHERE id = ?`)
      .bind(`${a}-vote`)
      .run();
    // b: 12 in one hour (10 published).
    await seedEvent(b, { hours: [12], attendees: 12 });
    // Five scans filed under b at a's poster: neither event's figure.
    for (let i = 0; i < 5; i++) {
      await db
        .prepare(
          `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
           VALUES (?, ?, ?, '2026-05-07T19:00')`
        )
        .bind(`${b}-stray-${i}`, b, `${a}-poster`)
        .run();
    }
    for (const id of [a, b]) {
      await db
        .prepare(`UPDATE events SET start_date = ? WHERE id = ?`)
        .bind(start.toISOString(), id)
        .run();
    }
    await db
      .prepare(`DELETE FROM corridor_density_baseline WHERE corridor_id = ?`)
      .bind(CELL7)
      .run();

    const r = await refreshCorridorBaselines({ DB: db });
    expect(r.errors).toBe(0);
    const ra = await build(a);
    const rb = await build(b);
    expect(ra.corridor_density.this_event_count).toBe(10);
    expect(rb.corridor_density.this_event_count).toBe(10);
    const row = await db
      .prepare(
        `SELECT window_30d_count, window_90d_count FROM corridor_density_baseline
          WHERE corridor_id = ? AND bucket_dow = ? AND bucket_hour = ?`
      )
      .bind(CELL7, start.getUTCDay(), start.getUTCHours())
      .first<{ window_30d_count: number; window_90d_count: number }>();
    expect(row).toEqual({ window_30d_count: 20, window_90d_count: 20 });
    expect(ra.corridor_density.baseline_30d).toBe(20);
    expect(ra.corridor_density.density_ratio_30d).toBeCloseTo(10 / 20, 9);
  });

  test('another instance of the series is its own poster sum', async () => {
    const id = `${PREFIX}anchor`;
    const other = `${PREFIX}other`;
    await seedEvent(id, { hours: [12], attendees: 12 });
    await tenv()
      .DB.prepare(
        `INSERT INTO events
           (id, brand_id, title, slug, status, location, start_date, series_id, created_at, updated_at)
         VALUES (?, 'test-brand', 'Earlier', ?, 'active', 'Test Venue', '2026-04-30T19:00:00Z',
                 ?, datetime('now'), datetime('now'))`
      )
      .bind(other, other, `ser-grain-${id}`)
      .run();
    // 9 and 4 at the other event's poster: 5 published, never 13 or 10.
    await seedPosterHour(tenv().DB, other, 19, 9);
    await seedPosterHour(tenv().DB, other, 20, 4);
    const rep = await build(id);
    const inst = rep.scan_trend.instances.find((i) => i.event_id === other);
    expect(inst?.scans).toBe(5);
  });
});
