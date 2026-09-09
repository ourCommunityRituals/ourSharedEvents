/**
 * Red Team: shared-report-depth-escalation.spec.ts  (Part of OSE-1270)
 *
 * The adversarial complement to the OSE-1172 depth × section matrix
 * (shared-report-depth-section-matrix.spec.ts). That spec proves the HAPPY
 * ladder; this one ATTACKS it: a sponsor tries to READ a paid section their
 * depth does not entitle, via the untrusted claim fields and the request line.
 *
 * Distinct from tests/red-team/shared-report-theft.spec.ts, which covers depth
 * escalation for the **bar_owner** role (claiming admin depth). The **sponsor**
 * ceiling (cap at 'mid', fail-closed to 'local') exercised END-TO-END on the wire
 * had no adversarial coverage — resolveDepth's cap was proven only at the unit
 * level (report-depth.spec.ts). This closes that gap on SELF.fetch.
 *
 * Attacks (each asserts the attack finds NOTHING — a test that cannot detect the
 * violation earns no credit, per impression-privacy.spec.ts):
 *   ESC-1  Sponsor mints/receives a token with a crafted depth:'premium' claim →
 *          the read MUST cap at 'mid' (headcount_trend, the premium-only section,
 *          stays absent). Sponsors cannot self-grant premium.
 *   ESC-2  Sponsor with a garbage depth:'cosmic' claim → fail-closed to 'local'
 *          (never the nearest valid value), so even the Mid paid sections
 *          (corridor_map) stay absent.
 *   ESC-3  Sponsor with a legitimate 'local' token appends ?depth=premium on the
 *          request line → the query string MUST be ignored (depth comes from the
 *          signed claim, never the URL).
 *
 * @born-red depth-escalation/sponsor | armed: 2026-09-09
 *   ESC-1 reds if resolveDepth's SPONSOR_MAX cap (report-depth.ts:138-142) is
 *   removed (sponsor gets requested 'premium' → headcount_trend leaks). ESC-2
 *   reds if fail-closed 'local' is changed to nearest-valid. ESC-3 reds if the
 *   handler ever reads a depth query param.
 *
 * NOTE (sibling attack, OSE-1270 DoD item 1 — NOT in this spec): the forms
 * PHASE_REQUIRED bypass on an unknown event (survey/email PII written for a
 * never-cleared phantom event, router.ts:1295 `eventRow`-null pass-through) is a
 * confirmed hole whose fail-closed fix is a SEC-critical change touching the
 * regulatory gate and breaking forms-e2e Scenario 8 — held for a dedicated
 * signed-off PR.
 *
 * PLATFORM NOTE: workers-pool spec; workerd segfaults on native Windows (OSE-696)
 * → authoritative green is Linux CI. See [[windows-linux-verification-boundary]].
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from '../helpers/seed-sponsor';
import { mintSignedLinkToken } from '../../src/lib/shared-report-auth';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';
const EVENT = 'test-evt-esc-1';
const SPONSOR = 'sp-esc-1';

// ─── Harness (mirrors shared-report-depth-section-matrix.spec.ts) ──────────────

let migrated = false;
async function applyMigrations(): Promise<void> {
  if (migrated) return;
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists') || msg.includes('no such column')) continue;
      throw e;
    }
  }
  migrated = true;
}

async function clearTables(): Promise<void> {
  const db = tenv().DB;
  await db.prepare(`DELETE FROM scan_aggregates`).run();
  await db.prepare(`DELETE FROM sponsor_impressions WHERE id LIKE 'si-esc-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-esc-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-esc-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-esc-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-esc-%'`).run();
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
    .bind(`sa-esc-${eventId}`, eventId, uniqueAgents * 3, uniqueAgents)
    .run();
}

/** Mint a sponsor signed-link token carrying an arbitrary (possibly crafted) depth claim. */
async function mintSponsor(depth: string): Promise<string> {
  const t = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    EVENT,
    'sponsor',
    undefined,
    { depth, sponsor_id: SPONSOR }
  );
  if (!t) throw new Error('mint returned null');
  return t;
}

async function read(token: string, query = ''): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`https://test.local/api/v2/events/${EVENT}/shared-report${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; report?: Record<string, unknown> };
  return body.report ?? {};
}

beforeAll(async () => {
  await applyMigrations();
});

describe('Red team: SharedReport sponsor depth-escalation (OSE-1270 — cap holds on the wire)', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
    await seedEvent(EVENT);
    await seedScan(EVENT, 5);
    await seedSplitSponsor(tenv().DB, { id: SPONSOR, eventId: EVENT, name: 'Esc Sponsor', tier: 'primary' });
  });

  test('ESC-1: a crafted depth:"premium" sponsor claim is capped at mid — headcount_trend stays absent', async () => {
    const report = await read(await mintSponsor('premium'));
    // Premium-only section must NOT leak to a sponsor…
    expect(report).not.toHaveProperty('headcount_trend');
    // …but the Mid sections the cap DOES allow are present (proves it capped to
    // mid, not fail-closed to local — the assertion bites on the exact ceiling).
    expect(report).toHaveProperty('corridor_map');
    const upgrade = report.upgrade as { next_depth?: string } | undefined;
    expect(upgrade?.next_depth).toBe('premium');
  });

  test('ESC-2: a garbage depth:"cosmic" claim fails closed to local — even Mid sections stay absent', async () => {
    const report = await read(await mintSponsor('cosmic'));
    expect(report).not.toHaveProperty('corridor_map'); // Mid section — not granted
    expect(report).not.toHaveProperty('headcount_trend'); // Premium section — not granted
    expect(report).toHaveProperty('unique_gatherings'); // local base still delivered
    const upgrade = report.upgrade as { next_depth?: string } | undefined;
    expect(upgrade?.next_depth).toBe('mid'); // local → next rung is mid
  });

  test('ESC-3: a ?depth=premium query string on a local token is ignored (depth comes from the signed claim only)', async () => {
    const localToken = await mintSponsor('local');
    const report = await read(localToken, '?depth=premium');
    expect(report).not.toHaveProperty('corridor_map');
    expect(report).not.toHaveProperty('headcount_trend');
    const upgrade = report.upgrade as { next_depth?: string } | undefined;
    expect(upgrade?.next_depth).toBe('mid');
  });
});
