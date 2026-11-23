/**
 * OSE-1784 (owner, 2026-11-23, "one number, from the posters"): the SharedReport
 * counts people in ONE grain, the published poster rows.
 *
 * The defect: three people figures came from three grains, each floored on its
 * own. `return_rate.sample_size` and `corridor_density.this_event_count` were
 * the whole-event distinct count (anon_id_returns), `distinct_scanners` summed
 * scan_aggregates hours, and `poster_attribution` summed poster-hours. Hours of
 * 7 and 3 different people at one poster published a poster sum of 5 beside a
 * sample size of 10, so the 3 under the floor could be read off by subtraction.
 *
 * The rule now: distinct_scanners, this_event_count (and its density ratios)
 * and this event's headcount_trend instance are the sum of the published
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
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
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
    distinct_scanners: rep.distinct_scanners,
    'return_rate.sample_size': rep.return_rate.sample_size,
    'corridor_density.this_event_count': rep.corridor_density.this_event_count,
    'headcount_trend (this event)':
      rep.headcount_trend.instances.find((i) => i.event_id === id)?.distinct_scanners ?? null,
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
    // Every people figure is that same 5; none is the whole-event 10.
    expect(peopleFigures(rep, id)).toEqual({
      distinct_scanners: 5,
      'return_rate.sample_size': null,
      'corridor_density.this_event_count': 5,
      'headcount_trend (this event)': 5,
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
          if (name === 'return_rate.sample_size') {
            if (v !== null) gaps.push(`${a}+${b}: sample_size published as ${v}`);
          } else if (v !== sum) {
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
      distinct_scanners: null,
      'return_rate.sample_size': null,
      'corridor_density.this_event_count': null,
      'headcount_trend (this event)': null,
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
    const inst = rep.headcount_trend.instances.find((i) => i.event_id === other);
    expect(inst?.distinct_scanners).toBe(5);
  });
});
