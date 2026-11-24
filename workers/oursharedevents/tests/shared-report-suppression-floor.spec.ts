/**
 * The SharedReport's suppression lines and sponsor rows pass the floor
 * (Invariant #7, aggregate-only, K = 5) without printing what they hide.
 *
 * Moved here from `shared-report-return-rate-floor.spec.ts` (OSE-1421) when
 * OSE-2214 retired `return_rate`: these guards were never about the return
 * rate, and they keep running without it.
 *
 *   - A suppression detail names the floor, never an observed count (D4).
 *   - The launch-day map writes one hidden-area line, the same whether the scan
 *     figure is published or withheld.
 *   - `sponsor_displays[].count` passes the same floor as its rollups (D2).
 *
 * Every test ends with the never-who assertion over the payload.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { CORRIDOR_BASELINE_MIN_SAMPLE, CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
import { clearPosterHours, seedPosterHour } from './helpers/seed-poster-hours';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const CELL = '872664544ffffff'; // a valid res-7 cell

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

/**
 * A suppression detail may name the floor, never an observed count. The only
 * numbers allowed in a detail are the published floors themselves.
 */
const ALLOWED_NUMBERS = new Set([
  String(CORRIDOR_MAP_MIN_COUNT),
  String(CORRIDOR_BASELINE_MIN_SAMPLE),
]);
function numbersIn(text: string | undefined): string[] {
  return (text ?? '').match(/\d+/g) ?? [];
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
  await db.prepare(`DELETE FROM corridor_density_baseline`).run();
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE 'test-evt-rrf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_displays WHERE id LIKE 'si-rrf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-rrf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-rrf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-rrf-%'`).run();
  await db.prepare(`DELETE FROM scan_cell_aggregates WHERE event_id LIKE 'test-evt-rrf-%'`).run();
  await db.prepare(`UPDATE events SET series_id = NULL WHERE id LIKE 'test-evt-rrf-%'`).run();
  await db.prepare(`DELETE FROM event_series WHERE id LIKE 'ser-rrf-%'`).run();
  await clearPosterHours(db, 'test-evt-rrf-');
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-rrf-%'`).run();
}

/**
 * The event, and an earlier event of its confirmed series (OSE-1652). The
 * earlier event has no cell.
 */
async function seedEvent(id: string, h3Res7: string | null = null): Promise<void> {
  const db = tenv().DB;
  const insert = (eventId: string, cell: string | null) =>
    db
      .prepare(
        `INSERT INTO events
           (id, brand_id, title, slug, status, location, h3_res7, start_date, created_at, updated_at)
         VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', ?, '2026-05-07T19:00:00Z',
                 datetime('now'), datetime('now'))`
      )
      .bind(eventId, `Test ${eventId}`, eventId, cell)
      .run();
  await insert(id, h3Res7);
  await insert(`${id}-prev`, null);
  await db
    .prepare(
      `INSERT INTO event_series (id, venue_id, series_name, state) VALUES (?, ?, 'Test series', 'confirmed')`
    )
    .bind(`ser-rrf-${id}`, `${id}-prev`)
    .run();
  await db
    .prepare(`UPDATE events SET series_id = ? WHERE id IN (?, ?)`)
    .bind(`ser-rrf-${id}`, id, `${id}-prev`)
    .run();
}

async function seedImpressions(
  sponsorId: string,
  eventId: string,
  surface: string,
  n: number
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await tenv()
      .DB.prepare(
        `INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type, created_at)
         VALUES (?, ?, ?, ?, 'p1', 'impression', datetime('now'))`
      )
      .bind(`si-rrf-${sponsorId}-${surface}-${i}`, sponsorId, eventId, surface)
      .run();
  }
}
beforeAll(async () => {
  await applyMigrations();
});

describe('no below_min_sample_size detail prints an observed count', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('corridor baselines under the floor say that, not how far under', async () => {
    const id = 'test-evt-rrf-base';
    await seedEvent(id, CELL);
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, 4, 19, 3, 7, datetime('now'))`
      )
      .bind(CELL)
      .run();

    const r = await buildSharedReport(tenv().DB, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const reasons = r.report._meta.suppression_reasons.filter(
      (s) =>
        s.field === 'corridor_density.baseline_30d' || s.field === 'corridor_density.baseline_90d'
    );
    expect(reasons).toHaveLength(2);
    for (const s of reasons) {
      expect(s.reason).toBe('below_min_sample_size');
      expect(s.detail).toContain(`fewer than ${CORRIDOR_BASELINE_MIN_SAMPLE}`);
      expect(numbersIn(s.detail)).toEqual([String(CORRIDOR_BASELINE_MIN_SAMPLE)]);
    }
    expect(bannedKeysIn(r.report)).toEqual([]);
  });

  test('across a report that suppresses several fields, every sub-floor detail names only a floor', async () => {
    const id = 'test-evt-rrf-all';
    await seedEvent(id, CELL);
    // Two scans in one poster hour: the scan figure is withheld.
    await seedPosterHour(tenv().DB, id, 19, 2);
    // A poster-area cell under the floor: the map's own hidden-area line.
    await tenv()
      .DB.prepare(
        `INSERT INTO scan_cell_aggregates (id, event_id, h3_res9, bucket_date, bucket_hour, scan_count, computed_at)
         VALUES ('sca-rrf-1', ?, '8926645441bffff', '2026-05-07', 19, 2, datetime('now'))`
      )
      .bind(id)
      .run();
    await tenv()
      .DB.prepare(
        `INSERT INTO corridor_density_baseline
           (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
         VALUES (?, 4, 19, 4, 6, datetime('now'))`
      )
      .bind(CELL)
      .run();

    const r = await buildSharedReport(tenv().DB, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const sub = r.report._meta.suppression_reasons.filter(
      (s) => s.reason === 'below_min_sample_size'
    );
    expect(sub.length).toBeGreaterThanOrEqual(4);
    for (const s of sub) {
      const stray = numbersIn(s.detail).filter((n) => !ALLOWED_NUMBERS.has(n));
      expect(stray, `${s.field}: "${s.detail}" prints a non-floor number`).toEqual([]);
    }
    expect(bannedKeysIn(r.report)).toEqual([]);
  });

  // The test above reaches the map's line through poster cells. An event with
  // no poster scans yet takes the other path: the neighbourhood preview, drawn
  // by the map renderer, which writes its own hidden-area line. That line had no
  // test: printing the number of hidden areas in it left every spec here green.
  //
  // Seen red: with `${suppressedCells.length} areas not shown ...` in the
  // builder (as a template literal, and as string concatenation, which the
  // source gate in aggregate-only.invariant does not read), and with the
  // pre-fix loop ("area 1 of 6 suppressed ...", one line per area).
  test('the launch-day map (no map cells yet): one hidden-area line, naming only the floor, the same whether the head count is published or withheld', async () => {
    const seen: Array<{ hidden: number; detail: string | undefined }> = [];
    for (const [id, people] of [
      ['test-evt-rrf-map-shown', 20],
      ['test-evt-rrf-map-held', 3],
    ] as const) {
      await seedEvent(id, CELL);
      // OSE-1784: the scan figure is the poster sum. The posters have scans but
      // no map cells are materialized yet, so the map is the launch-day one.
      await seedPosterHour(tenv().DB, id, 19, people);

      const r = await buildSharedReport(tenv().DB, id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.report.corridor_map?.source).toBe('fallback');
      expect(r.report.scans).toBe(people >= CORRIDOR_MAP_MIN_COUNT ? people : null);
      const lines = r.report._meta.suppression_reasons.filter((s) => s.field === 'corridor_map');
      expect(lines, 'one line, not one per hidden area').toHaveLength(1);
      expect(lines[0]!.reason).toBe('below_min_sample_size');
      expect(numbersIn(lines[0]!.detail)).toEqual([String(CORRIDOR_MAP_MIN_COUNT)]);
      seen.push({ hidden: r.report.corridor_map!.suppressed.length, detail: lines[0]!.detail });
      expect(bannedKeysIn(r.report)).toEqual([]);
    }
    // The two maps hide a different number of areas (the event's own cell is
    // one of them only when its head count is withheld), and say the same thing.
    expect(seen[0]!.hidden).not.toBe(seen[1]!.hidden);
    expect(seen[0]!.detail).toBe(seen[1]!.detail);
  });
});

describe('sponsor_displays[].count passes the same floor as its rollups', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  async function seedSponsor(id: string, eventId: string): Promise<void> {
    await seedSplitSponsor(tenv().DB, {
      id,
      eventId,
      name: `Sponsor ${id}`,
      tier: 'primary',
      isLocal: 0,
    });
  }

  test('a sub-K (sponsor x surface) row is not published; a row at K is, rounded down to a multiple of 5', async () => {
    const ev = 'test-evt-rrf-imp';
    await seedEvent(ev);
    await seedSponsor('sp-rrf-a', ev);
    await seedImpressions('sp-rrf-a', ev, 'display', 3); // sub-K
    await seedImpressions('sp-rrf-a', ev, 'poster', CORRIDOR_MAP_MIN_COUNT + 2); // clears K

    const r = await buildSharedReport(tenv().DB, ev);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rows = r.report.sponsor_displays;
    expect(rows.map((x) => x.surface)).toEqual(['poster']);
    expect(rows[0]!.count).toBe(CORRIDOR_MAP_MIN_COUNT);
    // Every published count clears the floor, the same rule the rollups apply.
    expect(rows.every((x) => x.count >= CORRIDOR_MAP_MIN_COUNT)).toBe(true);
    // The sub-K row's count appears nowhere in the payload.
    expect(JSON.stringify(r.report)).not.toContain('"count":3');
    expect(bannedKeysIn(r.report)).toEqual([]);
  });

  test('an event whose only impressions are sub-K publishes no sponsor rows at all', async () => {
    const ev = 'test-evt-rrf-imp-sub';
    await seedEvent(ev);
    await seedSponsor('sp-rrf-b', ev);
    await seedImpressions('sp-rrf-b', ev, 'display', 2);
    await seedImpressions('sp-rrf-b', ev, 'poster', 4);

    const r = await buildSharedReport(tenv().DB, ev);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.sponsor_displays).toEqual([]);
    // OSE-2089: withheld (null), never 0.
    expect(r.report.sponsor_class_breakdown.mid.total_displays).toBeNull();
    expect(bannedKeysIn(r.report)).toEqual([]);
  });

  test('the rows and the class rollup agree: nothing a reader can subtract to a sub-K cohort', async () => {
    const ev = 'test-evt-rrf-imp-agree';
    await seedEvent(ev);
    await seedSponsor('sp-rrf-c', ev);
    await seedImpressions('sp-rrf-c', ev, 'poster', 6);
    await seedImpressions('sp-rrf-c', ev, 'display', 4); // sub-K

    const r = await buildSharedReport(tenv().DB, ev);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const published = r.report.sponsor_displays.reduce((n, x) => n + x.count, 0);
    expect(published).toBe(5);
    expect(r.report.sponsor_class_breakdown.mid.total_displays).toBe(published);
    expect(bannedKeysIn(r.report)).toEqual([]);
  });
});
