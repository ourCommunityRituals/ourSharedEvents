/**
 * OSE-2214 (owner, 2026-11-23): "This should not be counting people, but traffic
 * of the clicks … The system is not tracking the person, but qr code."
 *
 * The SharedReport publishes scans of the code, never people:
 *   - the figure is `scans` (was `distinct_scanners`), and the trend is
 *     `scan_trend` (was `headcount_trend`);
 *   - `return_rate` is gone: it followed one phone across events;
 *   - a poster hour that reached the cap of 100 stored scans marks its row
 *     `hour_cap_reached`, so the page can say "or more".
 *
 * @born-red OSE-2214 | method: these tests on main's builder (distinct_scanners,
 * return_rate present, no hour_cap_reached) | date: 2026-11-23
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { buildSharedReport, type SharedReport } from '../src/lib/shared-report-builder';
import { POSTER_HOUR_CAP } from '../src/lib/poster-hour-cap';
import { clearPosterHours, seedPosterHour } from './helpers/seed-poster-hours';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const PREFIX = 'test-evt-code-';

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

async function seedEvent(id: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', '2026-05-07T19:00:00Z', datetime('now'), datetime('now'))`
    )
    .bind(id, `Code ${id}`, id)
    .run();
}

async function build(id: string): Promise<SharedReport> {
  const r = await buildSharedReport(tenv().DB, id);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('report did not build');
  return r.report;
}

beforeAll(applyMigrations);
beforeEach(async () => {
  const db = tenv().DB;
  await clearPosterHours(db, PREFIX);
  await db.prepare(`DELETE FROM events WHERE id LIKE ?`).bind(`${PREFIX}%`).run();
});

describe('OSE-2214: the report counts scans of the code, never people', () => {
  test('OSE-2214 | UNIT | buildSharedReport | the figure is `scans`; no people-named key and no return_rate', async () => {
    const id = `${PREFIX}names`;
    await seedEvent(id);
    await seedPosterHour(tenv().DB, id, 19, 7);
    const report = (await build(id)) as unknown as Record<string, unknown>;
    expect(report.scans).toBe(5);
    expect('distinct_scanners' in report).toBe(false);
    expect('headcount_trend' in report).toBe(false);
    expect('scan_trend' in report).toBe(true);
    expect('return_rate' in report).toBe(false);
  });

  test('OSE-2214 | UNIT | poster_attribution | an hour that reached the cap marks the row, so the count reads "or more"', async () => {
    const id = `${PREFIX}cap`;
    await seedEvent(id);
    await seedPosterHour(tenv().DB, id, 19, POSTER_HOUR_CAP);
    await seedPosterHour(tenv().DB, id, 20, 6);
    const report = await build(id);
    expect(report.poster_attribution).toHaveLength(1);
    expect(report.poster_attribution[0].scan_count).toBe(POSTER_HOUR_CAP + 5);
    expect(report.poster_attribution[0].hour_cap_reached).toBe(true);
    // The headline and the corridor count are the same number, so both read "or more".
    expect(report.scans_at_least).toBe(true);
  });

  test('OSE-2214 | UNIT | poster_attribution | an hour one under the cap is not marked', async () => {
    const id = `${PREFIX}under`;
    await seedEvent(id);
    await seedPosterHour(tenv().DB, id, 19, POSTER_HOUR_CAP - 1);
    const report = await build(id);
    expect(report.poster_attribution[0].hour_cap_reached).toBe(false);
    expect(report.scans_at_least).toBe(false);
  });
});
