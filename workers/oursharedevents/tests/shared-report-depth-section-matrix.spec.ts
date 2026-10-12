/**
 * OSE-1172 (slice — depth × section-gating matrix) on the SharedReport READ path.
 *
 * The "heart" of the L1 matrix (docs/features/SHARED-REPORT-L1-MATRIX.md, dim 1 =
 * Depth). It proves ADR-017's one rule ON THE WIRE, cheaply: the delivered section
 * SET rises additively with the viewer's depth, by OMISSION only — and the withheld
 * sections are named in the printed refusal (`report.upgrade.locked_sections`).
 *
 * WHY THIS LAYER (not a duplicate): depth gating is proven today at the LIB level
 * (report-depth.spec.ts, filterReportByDepth in isolation) and as an EXPENSIVE
 * staging E2E (sharedreport-depth.spec.ts, T4f/Playwright). There is no L1
 * workers-pool assertion that the gate survives to the wire through the read
 * handler + serialization. This is exactly the "push the matrix DOWN to the cheap
 * layer" goal of the OSE-1167 epic: the same tier×section cells, run per-PR in
 * Vitest (SELF.fetch) instead of only against staging.
 *
 * CONTRACT (ADR-017 / REPORT-DEPTH.md / DEPTH_SECTIONS in lib/report-depth.ts):
 *   • local  (free): event meta + distinct_scanners + sponsor_impressions (own) +
 *     sponsor_class_breakdown. The paid sections are ABSENT.
 *   • mid    (paid): adds campaign_summary, poster_attribution, return_rate,
 *     corridor_density, corridor_map (the map = the paid value line, OSE-682).
 *   • premium        : adds headcount_trend (cross-event). admin/bar_owner/internal
 *     resolve to premium; a premium/admin response carries NO `upgrade` key.
 *   • sponsor caps at mid; the filter is omission-only (same numbers, fewer
 *     sections — Invariant #5); the refusal is PRINTED in
 *     report.upgrade.locked_sections + next_depth (handler shared-report-read.ts:180).
 *
 * The builder emits a FIXED-SHAPE report (shared-report-builder.ts:703-734 — every
 * section key is always present, null/empty when no data), so an ABSENT paid key at
 * `local`/`mid` is the DEPTH FILTER removing a key the builder DID produce — the
 * assertions are non-vacuous with a minimal seed (no need to populate every section).
 *
 * @born-red invariant#5/depth | method: depth-section-omission-on-wire | armed: 2026-09-09
 *   Neutralize the one gate (`handlers/shared-report-read.ts:178-181` — skip
 *   filterReportByDepth for the sponsor role, return the full built report) and the
 *   `local` case reddens: corridor_map / campaign_summary / headcount_trend become
 *   present (not.toHaveProperty fails) and `upgrade` disappears (next_depth fails).
 *   The lib-level report-depth.spec.ts proves the filter in isolation; THIS proves
 *   it is WIRED into the single read path and survives serialization.
 *
 * HARNESS NOTE: migrations apply EXACTLY ONCE per isolate (0018 rename dangles the
 * sponsor_impressions FK on a second apply — see shared-report-kanon-floor.spec.ts).
 *
 * PLATFORM NOTE: workerd-pool spec; the pool SEGFAULTS on native Windows (OSE-696),
 * so the authoritative green is Linux CI (T0 workers `tests` shard). Local = review
 * + typecheck only. See [[windows-linux-verification-boundary]].
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

// Must equal the SHARED_REPORT_SIGNING_SECRET bound to the worker under test.
const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';

const EVENT = 'test-evt-dm-1';
const SPONSOR = 'sp-dm-1';

// ─── Harness ──────────────────────────────────────────────────────────────────

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
  await db.prepare(`DELETE FROM sponsor_impressions WHERE id LIKE 'si-dm-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-dm-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-dm-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-dm-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-dm-%'`).run();
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

async function seedScan(eventId: string, uniqueAgents: number): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO scan_aggregates
         (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
       VALUES (?, ?, '2026-05-07', NULL, ?, ?, datetime('now'))`
    )
    .bind(`sa-dm-${eventId}`, eventId, uniqueAgents * 3, uniqueAgents)
    .run();
}

async function seedImpression(sponsorId: string, eventId: string, surface: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type, created_at)
       VALUES (?, ?, ?, ?, 'p1', 'impression', datetime('now'))`
    )
    .bind(`si-dm-${sponsorId}-${surface}`, sponsorId, eventId, surface)
    .run();
}

/** Read the report on the wire for a given role/depth. */
async function readAs(
  role: 'sponsor' | 'admin',
  opts: { depth?: string; sponsor_id?: string } = {}
): Promise<{ status: number; report: Record<string, unknown> }> {
  const token = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    EVENT,
    role,
    undefined,
    opts
  );
  if (!token) throw new Error('mint returned null');
  const res = await SELF.fetch(`https://test.local/api/v2/events/${EVENT}/shared-report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { ok: boolean; report?: Record<string, unknown> };
  return { status: res.status, report: body.report ?? {} };
}

beforeAll(async () => {
  await applyMigrations();
});

// ─── Depth × section matrix ─────────────────────────────────────────────────

interface DepthProfile {
  name: string;
  role: 'sponsor' | 'admin';
  depth?: string;
  present: string[];
  absent: string[];
  upgrade: { next_depth: string; lockedIncludes: string[] } | null;
}

// Expected sets HARDCODED from REPORT-DEPTH.md / DEPTH_SECTIONS — asserted
// independently of the module that does the filtering, so a wrong change to
// DEPTH_SECTIONS reddens here too (assert the contract, don't re-derive it).
const PROFILES: DepthProfile[] = [
  {
    name: 'LOCAL sponsor → base sections only; paid sections omitted; mid locked',
    role: 'sponsor',
    depth: 'local',
    present: ['distinct_scanners', 'sponsor_impressions', 'sponsor_class_breakdown'],
    absent: [
      'campaign_summary',
      'poster_attribution',
      'return_rate',
      'corridor_density',
      'corridor_map',
      'headcount_trend',
    ],
    upgrade: { next_depth: 'mid', lockedIncludes: ['corridor_map', 'campaign_summary'] },
  },
  {
    name: 'MID sponsor → map + optimization present; headcount_trend (premium) omitted; premium locked',
    role: 'sponsor',
    depth: 'mid',
    present: [
      'distinct_scanners',
      'sponsor_impressions',
      'sponsor_class_breakdown',
      'campaign_summary',
      'poster_attribution',
      'return_rate',
      'corridor_density',
      'corridor_map',
    ],
    absent: ['headcount_trend'],
    upgrade: { next_depth: 'premium', lockedIncludes: ['headcount_trend'] },
  },
  {
    name: 'ADMIN → full premium depth; no upgrade hint',
    role: 'admin',
    present: [
      'distinct_scanners',
      'sponsor_impressions',
      'sponsor_class_breakdown',
      'campaign_summary',
      'corridor_map',
      'headcount_trend',
    ],
    absent: [],
    upgrade: null,
  },
];

describe('OSE-1172 — SharedReport depth × section gating on the read path (ADR-017, omission-only)', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
    // One minimally-populated event + sponsor. The builder emits ALL section keys
    // regardless (fixed shape), so an absent paid key below is the FILTER at work.
    await seedEvent(EVENT);
    await seedScan(EVENT, 5);
    await seedSplitSponsor(tenv().DB, {
      id: SPONSOR,
      eventId: EVENT,
      name: 'DM Sponsor',
      tier: 'primary',
    });
    await seedImpression(SPONSOR, EVENT, 'poster');
  });

  test.each(PROFILES)('$name', async ({ role, depth, present, absent, upgrade }) => {
    const opts = role === 'sponsor' ? { depth, sponsor_id: SPONSOR } : {};
    const { status, report } = await readAs(role, opts);

    expect(status).toBe(200);
    for (const key of present) expect(report).toHaveProperty(key);
    for (const key of absent) expect(report).not.toHaveProperty(key);

    if (upgrade === null) {
      // premium/admin: the refusal field is absent because nothing is withheld.
      expect(report).not.toHaveProperty('upgrade');
    } else {
      const u = report.upgrade as { next_depth: string; locked_sections: string[] };
      expect(u.next_depth).toBe(upgrade.next_depth);
      for (const s of upgrade.lockedIncludes) expect(u.locked_sections).toContain(s);
      // Omission-only: a locked section must NOT also be delivered in the payload.
      for (const s of upgrade.lockedIncludes) expect(report).not.toHaveProperty(s);
    }
  });
});
