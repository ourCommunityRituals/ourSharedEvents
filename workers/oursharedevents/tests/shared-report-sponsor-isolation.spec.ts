/**
 * OSE-1172 (slice 1) — sponsor-slice isolation on the SharedReport READ path.
 *
 * The covenant-critical never-who assertion the deep-dive matrix (OSE-1167 → C)
 * most needed and did NOT yet have: two sponsors on ONE event, sharing ONE
 * campaign, and a sponsor token scoped to one of them must see ITS OWN rows only —
 * never the peer's, and never a campaign total that laundered the peer's count in.
 *
 * The existing OSE-816 depth tests (shared-report-read.spec.ts) seed a SINGLE
 * sponsor and prove section-stripping; with one sponsor a cross-sponsor leak is
 * unobservable. This spec seeds TWO and exercises the real request path
 * (SELF.fetch), so it bites on the handler's scoping logic:
 *
 *   • src/handlers/shared-report-read.ts:110-117 — filter sponsor_impressions to
 *     the token's sponsor_id; a sponsor token with NO sponsor_id sees ZERO rows
 *     (OSE-595 fail-closed), not every competitor's data.
 *   • src/handlers/shared-report-read.ts:119-157 — Q6: RE-DERIVE campaign_summary
 *     from the scoped rows, so two sponsors sharing a campaign_id cannot read each
 *     other's totals through the campaign aggregate (the builder derives it
 *     pre-scope over ALL sponsors — passing that through would leak).
 *   • src/lib/report-depth.ts:169-188 — the same slice isolation, defence-in-depth,
 *     inside filterReportByDepth (sponsor role).
 *
 * @born-red invariant#tenant | method: cross-sponsor-slice-read | armed: 2026-09-06
 *   PROVEN 2026-09-06: neutralizing the Q6 re-derivation (119-157) reddens the
 *   three campaign_summary assertions (peer-leak → 16 not 7, size-independent →
 *   16 not 9, fail-closed → leaked total instead of empty). "row isolation" is
 *   defended IN DEPTH (handler sponsor_id filter 110-117 AND filterReportByDepth
 *   report-depth.ts:169-188), so it holds unless BOTH are neutralized — a
 *   regression in either alone is still caught by the campaign assertions.
 *
 * HARNESS NOTE: seeding sponsor_impressions requires migrations to apply EXACTLY
 * ONCE per isolate — re-applying migration 0018 (ALTER TABLE sponsors RENAME TO
 * sponsors_old) rewrites the sponsor_impressions FK to a table it then drops,
 * dangling it so any later INSERT raises "no such table: sponsors_old". Same
 * migrate-once guard proven in shared-report-kanon-floor.spec.ts (see its header).
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';

// ─── Harness ──────────────────────────────────────────────────────────────────

// Apply EXACTLY ONCE per isolate (see header — 0018 rename corrupts the
// sponsor_impressions FK on a second apply).
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
  // Child rows first (FK order): sponsor_impressions → asset/placement → business.
  await db.prepare(`DELETE FROM sponsor_impressions WHERE id LIKE 'si-iso-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-iso-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-iso-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-iso-%'`).run();
  await db.prepare(`DELETE FROM campaigns WHERE id LIKE 'camp-iso-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-iso-%'`).run();
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

async function seedCampaign(id: string, title: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO campaigns (id, brand_id, title, status, created_at, updated_at)
       VALUES (?, 'test-brand', ?, 'active', datetime('now'), datetime('now'))`
    )
    .bind(id, title)
    .run();
}

async function seedScanAggregate(eventId: string, uniqueAgents: number): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO scan_aggregates
         (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
       VALUES (?, ?, '2026-05-07', NULL, ?, ?, datetime('now'))`
    )
    .bind(`sa-${eventId}`, eventId, uniqueAgents * 3, uniqueAgents)
    .run();
}

/**
 * Seed N sponsor_impressions rows for one (sponsor × surface) bucket — the grain
 * the builder GROUP BYs on, so COUNT(*) = n is the count the reader sees.
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
        `si-iso-${opts.sponsor_id}-${opts.surface}-${i}`,
        opts.sponsor_id,
        opts.event_id,
        opts.surface
      )
      .run();
  }
}

/** Mint a sponsor signed-link token. Omit sponsorId to exercise the OSE-595 no-scope path. */
async function mintSponsor(eventId: string, sponsorId?: string): Promise<string> {
  const t = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    eventId,
    'sponsor',
    undefined,
    { depth: 'mid', ...(sponsorId ? { sponsor_id: sponsorId } : {}) }
  );
  if (!t) throw new Error('mint returned null');
  return t;
}

interface ImpressionRow {
  sponsor_id: string;
  surface: string;
  count: number;
  campaign_id: string | null;
}
interface CampaignRow {
  campaign_id: string;
  total_impressions: number;
  sponsor_count: number;
  impressions_by_surface: Record<string, number>;
}
interface Report {
  sponsor_impressions?: ImpressionRow[];
  campaign_summary?: CampaignRow[] | null;
  [k: string]: unknown;
}

async function readReport(eventId: string, sponsorId?: string): Promise<Report> {
  const token = await mintSponsor(eventId, sponsorId);
  const res = await SELF.fetch(`https://test.local/api/v2/events/${eventId}/shared-report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; report: Report };
  expect(body.ok).toBe(true);
  return body.report;
}

beforeAll(async () => {
  await applyMigrations();
});

// ─── Sponsor-slice isolation ──────────────────────────────────────────────────

describe('OSE-1172 — sponsor-slice isolation on the SharedReport read path (TL-040 / OSE-595 / Q6)', () => {
  const EVT = 'test-evt-iso-1';
  const CAMPAIGN = 'camp-iso-shared';
  const SP_A = 'sp-iso-a';
  const SP_B = 'sp-iso-b';
  const A_POSTER = 7; // clears K=5
  const B_POSTER = 9; // higher volume than A → isolation must not be size/order dependent
  const COMBINED = A_POSTER + B_POSTER; // 16 — the number a leak would surface

  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
    await seedEvent(EVT);
    await seedScanAggregate(EVT, 20);
    await seedCampaign(CAMPAIGN, 'Shared Corridor Push');
    // Two sponsors, one event, ONE shared campaign — the peer-leak trap.
    await seedSplitSponsor(tenv().DB, {
      id: SP_A,
      eventId: EVT,
      name: 'Sponsor A',
      tier: 'silver',
      campaignId: CAMPAIGN,
    });
    await seedSplitSponsor(tenv().DB, {
      id: SP_B,
      eventId: EVT,
      name: 'Sponsor B',
      tier: 'silver',
      campaignId: CAMPAIGN,
    });
    await seedImpressions({ sponsor_id: SP_A, event_id: EVT, surface: 'poster', n: A_POSTER });
    await seedImpressions({ sponsor_id: SP_B, event_id: EVT, surface: 'poster', n: B_POSTER });
  });

  test('row isolation (TL-040): sp-A token sees ONLY sp-A impression rows, never sp-B', async () => {
    const report = await readReport(EVT, SP_A);
    const rows = report.sponsor_impressions ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.sponsor_id === SP_A)).toBe(true);
    expect(rows.some((r) => r.sponsor_id === SP_B)).toBe(false);
  });

  test('no peer leak via a SHARED campaign (Q6): sp-A campaign total is sp-A only, not the combined total', async () => {
    const report = await readReport(EVT, SP_A);
    const row = (report.campaign_summary ?? []).find((c) => c.campaign_id === CAMPAIGN);
    expect(row).toBeDefined();
    // A alone = 7. Combined with B (9) = 16 would be a peer leak.
    expect(row!.total_impressions).toBe(A_POSTER);
    expect(row!.total_impressions).not.toBe(COMBINED);
    // The aggregate must never reveal that a co-sponsor shares the campaign.
    expect(row!.sponsor_count).toBe(1);
    expect(row!.impressions_by_surface.poster).toBe(A_POSTER);
  });

  test('isolation is not size/order dependent: sp-B (higher volume) still sees only its own slice', async () => {
    const report = await readReport(EVT, SP_B);
    const rows = report.sponsor_impressions ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.sponsor_id === SP_B)).toBe(true);
    const row = (report.campaign_summary ?? []).find((c) => c.campaign_id === CAMPAIGN);
    expect(row!.total_impressions).toBe(B_POSTER);
    expect(row!.total_impressions).not.toBe(COMBINED);
  });

  test('fail-closed (OSE-595): a sponsor token with NO sponsor_id sees ZERO impression rows', async () => {
    const report = await readReport(EVT); // sponsor role, no sponsor_id claim
    expect(report.sponsor_impressions ?? []).toEqual([]);
    // and the re-derived campaign_summary carries nothing to leak
    const summary = report.campaign_summary;
    expect(summary === null || (Array.isArray(summary) && summary.length === 0)).toBe(true);
  });
});
