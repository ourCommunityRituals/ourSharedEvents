/**
 * OSE-683 — SharedReport builder must apply the per-bucket K-anon floor.
 *
 * Ratified rule (2026-08-09, "K-anon Per-Bucket Consistency"): K>=5 is applied
 * PER CONTRIBUTING BUCKET BEFORE summation — not to the final sum. A contributing
 * bucket with count < 5 is DROPPED (floored/excluded), never summed raw. This
 * mirrors the portfolio-rollup #7 pattern (sumContributingBuckets → applyCountFloor).
 *
 * Four aggregates in the builder were previously unfloored and could publish
 * sub-K contributions:
 *   1. unique_gatherings        — SUM(scan_aggregates.distinct_agent_hashes) across buckets
 *   2. campaign_summary         — per-campaign SUM over sponsor_impressions rows
 *   3. sponsor_class_breakdown  — per-class SUM over sponsor_impressions rows
 *   4. headcount_trend[]        — per-instance SUM(distinct_agent_hashes) across buckets
 *
 * HARNESS NOTE (OSE-683 completion): earlier iterations claimed sponsor_impressions
 * "carries a trigger referencing sponsors_old" and fell back to static analysis for
 * the two sponsor aggregates. That was a MISDIAGNOSIS. There is no such trigger in
 * any migration (grep sponsors_old → only the 0018 table-recreate pattern). The real
 * reason a bare INSERT fails is the sponsor_impressions FOREIGN KEYs
 * (sponsor_id → sponsors(id), event_id → events(id)): miniflare/D1 enforces them, so
 * the parent events + sponsors rows must be seeded FIRST. Once parented, the INSERT
 * succeeds and campaign_summary / sponsor_class_breakdown get REAL runtime coverage
 * below — no migration change required (this is a test-seed ordering fix, not a
 * schema bug, so the forward-migration-only constitution is untouched).
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// HARNESS FIX (OSE-683): migrations must apply EXACTLY ONCE per isolate.
// Re-applying is NOT idempotent because migration 0018 does
// `ALTER TABLE sponsors RENAME TO sponsors_old` — and SQLite (>=3.25) rewrites
// foreign-key references in OTHER tables when a table is renamed, so on a second
// apply the FK in sponsor_impressions (REFERENCES sponsors(id)) is silently
// rewritten to REFERENCES sponsors_old(id). 0018 then drops sponsors_old, leaving
// sponsor_impressions with a dangling FK → any later INSERT/DELETE raises
// "no such table: main.sponsors_old". This is the actual cause of the historical
// "trigger references sponsors_old" seed failure (there is no such trigger — see
// file header). Guarding to a single apply lets sponsor_impressions be seeded for
// real. No migration change: this is a test-harness idempotency fix, so the
// forward-migration-only constitution is untouched. In production, migrations
// apply once, so 0018 is correct as written.
let migrated = false;
async function applyMigrations(): Promise<void> {
  if (migrated) return;
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
  migrated = true;
}

async function clearTables(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM scan_aggregates`).run();
  await db.prepare(`DELETE FROM anon_id_returns`).run();
  // Child rows first (FK order). OSE-799 A2: the split added sponsor_placement +
  // sponsor_asset (both children of sponsor_business; placement also references
  // campaigns). Delete them BEFORE sponsor_business/campaigns or the campaign
  // delete trips the placement→campaign FK.
  await db.prepare(`DELETE FROM sponsor_impressions WHERE id LIKE 'si-kanon-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-kanon-%'`).run();
  await db
    .prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-kanon-%'`)
    .run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-kanon-%'`).run();
  await db.prepare(`DELETE FROM campaigns WHERE id LIKE 'camp-kanon-%'`).run();
  await db.prepare(`UPDATE events SET series_id = NULL`).run();
  await db.prepare(`DELETE FROM event_series`).run();
  await db.prepare(`DELETE FROM shortlinks WHERE event_id LIKE 'test-evt-kanon-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-kanon-%'`).run();
}

/** Seed a campaign (parent of campaign-linked sponsors). */
async function seedCampaign(id: string, title: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO campaigns (id, brand_id, title, status, created_at, updated_at)
       VALUES (?, 'test-brand', ?, 'active', datetime('now'), datetime('now'))`
    )
    .bind(id, title)
    .run();
}

/** Seed a sponsor (FK parent of sponsor_impressions). */
async function seedSponsor(opts: {
  id: string;
  event_id: string;
  name?: string;
  tier?: string;
  is_local?: number;
  campaign_id?: string | null;
}): Promise<void> {
  // OSE-799 A2: split model. is_local → placement.locality_band, campaign_id →
  // placement.campaign_id (the SharedReport impressions JOIN reads them there).
  await seedSplitSponsor(tenv().DB, {
    id: opts.id,
    eventId: opts.event_id,
    name: opts.name ?? `Sponsor ${opts.id}`,
    tier: opts.tier ?? 'primary',
    isLocal: opts.is_local ?? 0,
    campaignId: opts.campaign_id ?? null,
  });
}

/**
 * Seed N sponsor_impressions rows for one (sponsor × surface) bucket — the grain
 * the builder GROUP BYs on. `n` distinct rows => COUNT(*)=n for that bucket, so
 * `n` is exactly the per-bucket count the per-bucket K-anon floor sees.
 */
async function seedImpressions(opts: {
  sponsor_id: string;
  event_id: string;
  surface: string;
  n: number;
}): Promise<void> {
  const db = tenv().DB;
  for (let i = 0; i < opts.n; i++) {
    await db
      .prepare(
        `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type, created_at)
         VALUES (?, ?, ?, ?, 'p1', 'impression', datetime('now'))`
      )
      .bind(
        `si-kanon-${opts.sponsor_id}-${opts.surface}-${i}`,
        opts.sponsor_id,
        opts.event_id,
        opts.surface
      )
      .run();
  }
}

/** Seed an event_series row (parent for headcount_trend). */
async function seedSeries(id: string, anchorEventId: string, state: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO event_series (id, venue_id, series_name, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(id, anchorEventId, `Series ${id}`, state)
    .run();
}

async function setEventSeries(eventId: string, seriesId: string): Promise<void> {
  await tenv()
    .DB.prepare(`UPDATE events SET series_id = ? WHERE id = ?`)
    .bind(seriesId, eventId)
    .run();
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
         (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
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

  // Rc — click_outs (the /s/ digital signal, finally counted on the SharedReport).
  // Same per-kind K-anon floor as unique_gatherings; floored per kind AND on the total.
  test('click_outs: public 6 shows, donate 3 suppressed, total (9) clears the floor', async () => {
    await seedEvent('test-evt-kanon-cko');
    const db = tenv().DB;
    await db
      .prepare(
        `INSERT INTO shortlinks (code, event_id, kind, clicks, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('ckoPUB', 'test-evt-kanon-cko', 'public', 6)
      .run();
    await db
      .prepare(
        `INSERT INTO shortlinks (code, event_id, kind, clicks, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('ckoDON', 'test-evt-kanon-cko', 'donate', 3)
      .run();

    const r = await buildSharedReport(tenv().DB, 'test-evt-kanon-cko');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const co = r.report.click_outs;
    expect(co).toBeDefined();
    expect(co).not.toBeNull();
    expect(co!.by_kind.public).toBe(6); // clears K → exact
    expect(co!.by_kind.donate).toBeNull(); // sub-K → suppressed
    expect(co!.total).toBe(9); // 6 + 3 clears K as its own aggregate
  });

  test('click_outs: an all-sub-K event suppresses each kind AND the total', async () => {
    await seedEvent('test-evt-kanon-cko-sub');
    await tenv()
      .DB.prepare(
        `INSERT INTO shortlinks (code, event_id, kind, clicks, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .bind('ckoPB2', 'test-evt-kanon-cko-sub', 'public', 2)
      .run();

    const r = await buildSharedReport(tenv().DB, 'test-evt-kanon-cko-sub');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.click_outs!.by_kind.public).toBeNull(); // 2 < 5 → suppressed
    expect(r.report.click_outs!.total).toBeNull(); // total 2 < 5 → suppressed
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
    expect(r.report.unique_gatherings === null || r.report.unique_gatherings === 0).toBe(true);
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

describe('OSE-683 — campaign_summary floors each sponsor bucket before summation (RUNTIME)', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('a sub-K (sponsor × surface) row is DROPPED from the campaign total (7 + 3 must NOT publish 10)', async () => {
    const evt = 'test-evt-kanon-camp-drop';
    await seedEvent(evt);
    await seedCampaign('camp-kanon-1', 'Spring Push');
    await seedSponsor({
      id: 'sp-kanon-a',
      event_id: evt,
      tier: 'gold',
      campaign_id: 'camp-kanon-1',
    });
    // Two buckets for the SAME campaign: poster clears K (7), qr is sub-K (3).
    await seedImpressions({ sponsor_id: 'sp-kanon-a', event_id: evt, surface: 'poster', n: 7 });
    await seedImpressions({ sponsor_id: 'sp-kanon-a', event_id: evt, surface: 'qr', n: 3 });

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cs = r.report.campaign_summary;
    expect(cs).not.toBeNull();
    const row = cs!.find((c) => c.campaign_id === 'camp-kanon-1');
    expect(row).toBeDefined();
    // Raw sum would be 10; per-bucket floored keeps only the >=5 bucket → 7.
    expect(row!.total_impressions).toBe(7);
    expect(row!.total_impressions).not.toBe(10);
    // The sub-K surface must not appear in the per-surface breakdown at all.
    expect(row!.impressions_by_surface.poster).toBe(7);
    expect(row!.impressions_by_surface.qr).toBeUndefined();
  });

  test('a campaign whose only bucket is sub-K never publishes (campaign is fully suppressed)', async () => {
    const evt = 'test-evt-kanon-camp-allsub';
    await seedEvent(evt);
    await seedCampaign('camp-kanon-2', 'Tiny Campaign');
    await seedSponsor({
      id: 'sp-kanon-b',
      event_id: evt,
      tier: 'silver',
      campaign_id: 'camp-kanon-2',
    });
    await seedImpressions({ sponsor_id: 'sp-kanon-b', event_id: evt, surface: 'poster', n: 4 }); // sub-K

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cs = r.report.campaign_summary;
    // No surviving bucket → campaign_summary must be null (nothing to publish),
    // and must NEVER carry the sub-K value 4.
    if (cs !== null) {
      const row = cs.find((c) => c.campaign_id === 'camp-kanon-2');
      expect(row).toBeUndefined();
    } else {
      expect(cs).toBeNull();
    }
  });

  test('a bucket that clears K is summed exactly (6 published)', async () => {
    const evt = 'test-evt-kanon-camp-keep';
    await seedEvent(evt);
    await seedCampaign('camp-kanon-3', 'Healthy Campaign');
    await seedSponsor({
      id: 'sp-kanon-c',
      event_id: evt,
      tier: 'bronze',
      campaign_id: 'camp-kanon-3',
    });
    await seedImpressions({ sponsor_id: 'sp-kanon-c', event_id: evt, surface: 'display', n: 6 });

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = r.report.campaign_summary!.find((c) => c.campaign_id === 'camp-kanon-3');
    expect(row!.total_impressions).toBe(6);
  });
});

describe('OSE-683 — sponsor_class_breakdown floors each sponsor bucket before summation (RUNTIME)', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('a sub-K sponsor row is DROPPED from the class total (premium 8 + 2 must NOT publish 10)', async () => {
    const evt = 'test-evt-kanon-class-drop';
    await seedEvent(evt);
    // premium (non-local, gold): one surface clears K (8), one is sub-K (2).
    await seedSponsor({ id: 'sp-kanon-p', event_id: evt, tier: 'gold', is_local: 0 });
    await seedImpressions({ sponsor_id: 'sp-kanon-p', event_id: evt, surface: 'poster', n: 8 });
    await seedImpressions({ sponsor_id: 'sp-kanon-p', event_id: evt, surface: 'qr', n: 2 });

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.report.sponsor_class_breakdown;
    // Raw sum would be 10; per-bucket floored keeps only the >=5 bucket → 8.
    expect(b.premium.total_impressions).toBe(8);
    expect(b.premium.total_impressions).not.toBe(10);
    expect(b.premium.sponsor_count).toBe(1);
  });

  test('a sponsor whose only bucket is sub-K does not count into ANY class (count and total both 0)', async () => {
    const evt = 'test-evt-kanon-class-allsub';
    await seedEvent(evt);
    // local sponsor, single sub-K bucket (3) → must not enter the 'local' class.
    await seedSponsor({ id: 'sp-kanon-l', event_id: evt, tier: 'primary', is_local: 1 });
    await seedImpressions({ sponsor_id: 'sp-kanon-l', event_id: evt, surface: 'poster', n: 3 });

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.report.sponsor_class_breakdown;
    expect(b.local.sponsor_count).toBe(0);
    expect(b.local.total_impressions).toBe(0);
    // And it certainly must not have leaked the raw 3 into any class total.
    expect(b.local.total_impressions).not.toBe(3);
    expect(b.mid.total_impressions).toBe(0);
    expect(b.premium.total_impressions).toBe(0);
  });

  test('classes with surviving buckets sum exactly (mid=5, premium=6)', async () => {
    const evt = 'test-evt-kanon-class-keep';
    await seedEvent(evt);
    await seedSponsor({ id: 'sp-kanon-m', event_id: evt, tier: 'silver', is_local: 0 }); // mid
    await seedSponsor({ id: 'sp-kanon-q', event_id: evt, tier: 'platinum', is_local: 0 }); // premium
    await seedImpressions({ sponsor_id: 'sp-kanon-m', event_id: evt, surface: 'poster', n: 5 });
    await seedImpressions({ sponsor_id: 'sp-kanon-q', event_id: evt, surface: 'poster', n: 6 });

    const r = await buildSharedReport(tenv().DB, evt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.report.sponsor_class_breakdown;
    expect(b.mid.total_impressions).toBe(5);
    expect(b.mid.sponsor_count).toBe(1);
    expect(b.premium.total_impressions).toBe(6);
    expect(b.premium.sponsor_count).toBe(1);
  });
});

describe('OSE-683 — headcount_trend applies the per-bucket K-anon floor per instance', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('a trend instance sums its buckets per-bucket-floored (10 + 3 must NOT publish 13)', async () => {
    const anchor = 'test-evt-kanon-trend-a';
    const other = 'test-evt-kanon-trend-b';
    await seedEvent(anchor);
    await seedEvent(other);
    await seedSeries('series-kanon-1', anchor, 'confirmed');
    await setEventSeries(anchor, 'series-kanon-1');
    await setEventSeries(other, 'series-kanon-1');
    // anchor instance: one bucket clears K (10), one sub-K (3) → must publish 10.
    await seedBucket(anchor, '1', 10);
    await seedBucket(anchor, '2', 3);
    // other instance: a single compliant bucket (7).
    await seedBucket(other, '1', 7);

    const r = await buildSharedReport(tenv().DB, anchor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const trend = r.report.headcount_trend;
    expect(trend.series_id).toBe('series-kanon-1');
    const a = trend.instances.find((i) => i.event_id === anchor);
    const b = trend.instances.find((i) => i.event_id === other);
    expect(a).toBeDefined();
    // Raw SUM would be 13; per-bucket floored keeps only the >=5 bucket → 10.
    expect(a!.unique_gatherings).toBe(10);
    expect(a!.unique_gatherings).not.toBe(13);
    expect(b!.unique_gatherings).toBe(7);
  });

  test('a trend instance whose buckets are all sub-K is suppressed (not the raw sum 3+4)', async () => {
    const anchor = 'test-evt-kanon-trend-sub-a';
    const sub = 'test-evt-kanon-trend-sub-b';
    await seedEvent(anchor);
    await seedEvent(sub);
    await seedSeries('series-kanon-2', anchor, 'confirmed');
    await setEventSeries(anchor, 'series-kanon-2');
    await setEventSeries(sub, 'series-kanon-2');
    await seedBucket(anchor, '1', 9); // anchor healthy so the report builds a trend
    await seedBucket(sub, '1', 3); // sub-K
    await seedBucket(sub, '2', 4); // sub-K

    const r = await buildSharedReport(tenv().DB, anchor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const subInst = r.report.headcount_trend.instances.find((i) => i.event_id === sub);
    expect(subInst).toBeDefined();
    // Raw sum would be 7; all buckets sub-K → suppressed (null), never 7.
    expect(subInst!.unique_gatherings).not.toBe(7);
    expect(subInst!.unique_gatherings).toBeNull();
  });
});

describe('OSE-683 — builder floors each contributing sponsor bucket (static guard)', () => {
  // Belt-and-suspenders: alongside the RUNTIME coverage above, keep a lightweight
  // static guard (Q6/SR-25 convention) so a future refactor that summed sponsor
  // rows raw would trip here even if the runtime seed path regressed.
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
