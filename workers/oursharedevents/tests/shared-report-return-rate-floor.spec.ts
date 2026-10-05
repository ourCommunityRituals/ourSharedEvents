/**
 * Part of OSE-1421 — the SharedReport's remaining unfloored fields (Invariant #7,
 * aggregate-only, K = 5) and the suppression strings that printed what they hid.
 *
 * Three defects, each pinned here against the miniflare D1:
 *
 *   1. `return_rate` was gated at a private constant of 3, not the platform floor
 *      K = CORRIDOR_MAP_MIN_COUNT = 5, so a percentage shipped over a sub-K
 *      denominator (D4, small cell).
 *   2. Its suppression detail printed the number it hides
 *      (`"2 of 3 required distinct anons"`), as did the corridor baseline's
 *      (`"3 of 10 required"`) and the corridor map's hidden-area counts. A
 *      suppression string that prints the count is the count (D4).
 *   3. `sponsor_impressions[].count` shipped raw at every depth, beside campaign
 *      rollups computed from the same rows with the per-bucket floor (D2).
 *
 * Every test ends with the never-who assertion over the payload.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { CORRIDOR_BASELINE_MIN_SAMPLE, CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';

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
  await db.prepare(`DELETE FROM anon_id_returns`).run();
  await db.prepare(`DELETE FROM corridor_density_baseline`).run();
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE 'test-evt-rrf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_impressions WHERE id LIKE 'si-rrf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-rrf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-rrf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-rrf-%'`).run();
  await db.prepare(`DELETE FROM scan_cell_aggregates WHERE event_id LIKE 'test-evt-rrf-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-rrf-%'`).run();
}

async function seedEvent(id: string, h3Res7: string | null = null): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, h3_res7, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', ?, '2026-05-07T19:00:00Z',
               datetime('now'), datetime('now'))`
    )
    .bind(id, `Test ${id}`, id, h3Res7)
    .run();
}

async function seedAnons(eventId: string, n: number): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    await tenv()
      .DB.prepare(
        `INSERT INTO anon_id_returns
           (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count, computed_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      )
      .bind(`${i}`.padStart(32, 'f'), eventId, now, now, now)
      .run();
  }
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
        `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type, created_at)
         VALUES (?, ?, ?, ?, 'p1', 'impression', datetime('now'))`
      )
      .bind(`si-rrf-${sponsorId}-${surface}-${i}`, sponsorId, eventId, surface)
      .run();
  }
}

beforeAll(async () => {
  await applyMigrations();
});

describe('return_rate gates at the platform floor (K), not a private constant', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('the floor it must use is K = 5', () => {
    expect(CORRIDOR_MAP_MIN_COUNT).toBe(5);
  });

  for (const n of [1, 2, 3, 4]) {
    test(`${n} distinct attendee(s): no percentage, no sample size, and a count-free detail`, async () => {
      const id = `test-evt-rrf-sub${n}`;
      await seedEvent(id, CELL);
      await seedAnons(id, n);

      const r = await buildSharedReport(tenv().DB, id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.report.return_rate.venue_pct).toBeNull();
      expect(r.report.return_rate.corridor_pct).toBeNull();
      expect(r.report.return_rate.sample_size).toBeNull();

      const reason = r.report._meta.suppression_reasons.find((s) => s.field === 'return_rate');
      expect(reason?.reason).toBe('below_min_sample_size');
      // Names the floor, never the observed count.
      expect(reason?.detail).toContain(`fewer than ${CORRIDOR_MAP_MIN_COUNT}`);
      expect(numbersIn(reason?.detail)).toEqual([String(CORRIDOR_MAP_MIN_COUNT)]);

      expect(bannedKeysIn(r.report)).toEqual([]);
    });
  }

  test('exactly K distinct attendees: the percentages are published over a sample of K', async () => {
    const id = 'test-evt-rrf-atk';
    await seedEvent(id, CELL);
    await seedAnons(id, CORRIDOR_MAP_MIN_COUNT);

    const r = await buildSharedReport(tenv().DB, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.return_rate.sample_size).toBe(CORRIDOR_MAP_MIN_COUNT);
    expect(r.report.return_rate.venue_pct).not.toBeNull();
    expect(r.report.return_rate.corridor_pct).not.toBeNull();
    expect(r.report._meta.suppression_reasons.map((s) => s.field)).not.toContain('return_rate');
    expect(bannedKeysIn(r.report)).toEqual([]);
  });
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
    await seedAnons(id, 2); // return_rate + this_event_count suppressed
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
});

describe('sponsor_impressions[].count passes the same floor as its rollups', () => {
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

  test('a sub-K (sponsor x surface) row is not published; a row at K is, exactly', async () => {
    const ev = 'test-evt-rrf-imp';
    await seedEvent(ev);
    await seedSponsor('sp-rrf-a', ev);
    await seedImpressions('sp-rrf-a', ev, 'display', 3); // sub-K
    await seedImpressions('sp-rrf-a', ev, 'poster', CORRIDOR_MAP_MIN_COUNT + 2); // clears K

    const r = await buildSharedReport(tenv().DB, ev);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rows = r.report.sponsor_impressions;
    expect(rows.map((x) => x.surface)).toEqual(['poster']);
    expect(rows[0]!.count).toBe(CORRIDOR_MAP_MIN_COUNT + 2);
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
    expect(r.report.sponsor_impressions).toEqual([]);
    expect(r.report.sponsor_class_breakdown.mid.total_impressions).toBe(0);
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
    const published = r.report.sponsor_impressions.reduce((n, x) => n + x.count, 0);
    expect(published).toBe(6);
    expect(r.report.sponsor_class_breakdown.mid.total_impressions).toBe(published);
    expect(bannedKeysIn(r.report)).toEqual([]);
  });
});
