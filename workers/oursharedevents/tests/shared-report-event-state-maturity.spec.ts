/**
 * OSE-1172 (slice — event-state / data-maturity axis) on the SharedReport READ path.
 *
 * The design doc (docs/features/SHARED-REPORT-L1-MATRIX.md §3, #491) listed an
 * "Event axis: state ∈ {pre, live, post, ended}" as if the delivered section SET
 * changed per lifecycle phase. Verify-first (2026-09-08) found that is NOT the
 * contract:
 *
 *   • `events.status` is `draft | ready | active | archived` (migration 0034,
 *     documented no-op) — not pre/live/post/ended.
 *   • The read handler (`handlers/shared-report-read.ts`) NEVER consults
 *     `events.status`. Its only gates are NOT_FOUND, REPORT_DISABLED (flag), the
 *     WKRP cross-product refusal, and sponsor_placement existence.
 *   • The builder (`lib/shared-report-builder.ts`) is tier-blind AND state-blind
 *     by design (ADR-017 / Invariant #5): it builds from whatever scan/impression
 *     data exists. The section SET is governed by DEPTH, never by event state.
 *
 * So the honest axis is DATA MATURITY, not lifecycle state: across an event's
 * life the section set is invariant; what changes is data VOLUME flowing through
 * the K=5 floor (empty → suppressed/null; ≥K → published). This spec asserts the
 * real contract, on the wire (SELF.fetch — the read path, not the builder unit):
 *
 *   1. STATE-INVARIANCE — identical data on an `active`, a `draft`, and an
 *      `archived` event yields an IDENTICAL section set + identical
 *      distinct_scanners. Guards against anyone later slipping an event-status
 *      gate into the builder, which would break the tier-blind/state-blind
 *      substrate doctrine.
 *   2. DATA-MATURITY through the K-floor, as seen on the read path — 0 scans →
 *      null; a sub-K bucket → suppressed (never the raw count); a ≥K bucket →
 *      published exact.
 *   3. AVAILABILITY (rainy) — a nonexistent event → 404 NOT_FOUND.
 *
 * @born-red invariant#tenant/#5 | method: event-state-blind-read | armed: 2026-09-08
 *   (1) STATE-INVARIANCE reddens if a `WHERE status = 'active'` gate is added to
 *       the builder's event lookup: the draft/archived reads then empty or 404 and
 *       the section-set / distinct_scanners equality assertions fail.
 *   (2) MATURITY reddens if the per-bucket floor is neutralized (raw SUM): the
 *       sub-K row (agents=3) then publishes 3, tripping `forbid: 3`. Proven at the
 *       builder level in shared-report-kanon-floor.spec.ts; this spec proves the
 *       suppression SURVIVES to the wire through the read handler + serialization.
 *   (3) AVAILABILITY reddens if the handler stops returning 404 for a missing
 *       event.
 *
 * SCOPE NOTE (no silent cap): the plan cell (flag `analytics.shared-report` off)
 * is deliberately NOT duplicated here. Since OSE-682 the page loads on every
 * plan and the read API caps a plan without the paid report at Local; that is
 * covered by `shared-report-free-plan-page.spec.ts` (the page) and the OSE-682
 * block in `shared-report-read.spec.ts` (the API through the router). This spec
 * keeps the main-DB harness single-concern and cross-references those cells.
 *
 * HARNESS NOTE: migrations apply EXACTLY ONCE per isolate — re-applying migration
 * 0018 (ALTER TABLE sponsors RENAME TO sponsors_old) dangles the
 * sponsor_displays FK. Same guard proven in shared-report-kanon-floor.spec.ts.
 *
 * PLATFORM NOTE: this is a workerd-pool spec; the pool SEGFAULTS on native Windows
 * (OSE-696), so the authoritative green is Linux CI (see
 * [[windows-linux-verification-boundary]]). Locally only typecheck/lint were run.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { usePaidReportPlan } from './helpers/paid-report-plan';
import { env, SELF } from 'cloudflare:test';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

// Must equal the SHARED_REPORT_SIGNING_SECRET bound to the worker under test, so
// the token this spec mints verifies in the read handler (same value the sibling
// read-path specs use).
const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';

// ─── Harness ──────────────────────────────────────────────────────────────────

// Apply EXACTLY ONCE per isolate (see header — 0018 rename corrupts FKs on a
// second apply).
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
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-esm-%'`).run();
}

/** Seed a base event with a parametrized `status` — the axis under test. */
async function seedEvent(id: string, status: string): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, ?, 'Test Venue', '2026-05-07T19:00:00Z',
               datetime('now'), datetime('now'))`
    )
    .bind(id, `Test ${id}`, id, status)
    .run();
}

/** Seed one scan_aggregates bucket: `uniqueAgents` = the per-bucket K-floor count. */
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

interface Report {
  distinct_scanners?: number | null;
  [k: string]: unknown;
}

/** Read the report via the wire as an ADMIN token (premium depth = full section set). */
async function readAsAdmin(
  eventId: string
): Promise<{ status: number; body: { ok: boolean; report?: Report; code?: string } }> {
  const token = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    eventId,
    'admin'
  );
  if (!token) throw new Error('mint returned null');
  const res = await SELF.fetch(`https://test.local/api/v2/events/${eventId}/shared-report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { ok: boolean; report?: Report; code?: string };
  return { status: res.status, body };
}

beforeAll(async () => {
  // OSE-682: this spec asserts paid sections, so it runs on a paid plan.
  await usePaidReportPlan();
  await applyMigrations();
});

// ─── 1. State-invariance ──────────────────────────────────────────────────────

describe('OSE-1172 — the SharedReport section set is event-STATUS-blind (state-invariance)', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('identical data on active / draft / archived events → identical section set + value', async () => {
    // Same data shape, only `status` differs. A ≥K bucket so a real value publishes.
    for (const [id, status] of [
      ['test-evt-esm-active', 'active'],
      ['test-evt-esm-draft', 'draft'],
      ['test-evt-esm-archived', 'archived'],
    ] as const) {
      await seedEvent(id, status);
      await seedBucket(id, '1', 7);
    }

    const active = await readAsAdmin('test-evt-esm-active');
    const draft = await readAsAdmin('test-evt-esm-draft');
    const archived = await readAsAdmin('test-evt-esm-archived');

    // All three are served (status never gates availability)…
    expect(active.status).toBe(200);
    expect(draft.status).toBe(200);
    expect(archived.status).toBe(200);

    // …and structurally identical: same section keys (the SET is depth-governed,
    // not state-governed) and the same floored value.
    const keys = (r: typeof active) => Object.keys(r.body.report ?? {}).sort();
    expect(keys(draft)).toEqual(keys(active));
    expect(keys(archived)).toEqual(keys(active));
    expect(draft.body.report?.distinct_scanners).toBe(active.body.report?.distinct_scanners);
    expect(archived.body.report?.distinct_scanners).toBe(active.body.report?.distinct_scanners);
    // Sanity: the shared value is the real floored count, not null.
    expect(active.body.report?.distinct_scanners).toBe(7);
  });
});

// ─── 2. Data-maturity through the K-floor, on the read path ─────────────────────

describe('OSE-1172 — data maturity flows through the K=5 floor to the wire (not the section set)', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  // `expect` discriminant:
  //   'null'       — no contributing buckets at all → strictly null (hasAnyBucket false).
  //   'suppressed' — a sub-K bucket contributes nothing → null OR a floored 0 (the
  //                  builder may express "nothing cleared the floor" either way — see
  //                  shared-report-kanon-floor.spec.ts, which hedges the same). The
  //                  load-bearing part is `forbid`: it must NEVER be the raw count.
  //   'exact'      — a ≥K bucket publishes its true count.
  const cases: {
    name: string;
    agents: number;
    mode: 'null' | 'suppressed' | 'exact';
    forbid: number | null;
    value: number | null;
  }[] = [
    {
      name: 'no scans yet (young event) → distinct_scanners null',
      agents: 0,
      mode: 'null',
      forbid: null,
      value: null,
    },
    {
      name: 'a sub-K bucket → suppressed, NEVER the raw count',
      agents: 3,
      mode: 'suppressed',
      forbid: 3,
      value: null,
    },
    { name: 'a ≥K bucket → published exact', agents: 5, mode: 'exact', forbid: null, value: 5 },
  ];
  test.each(cases)('$name', async ({ agents, mode, forbid, value }) => {
    const id = `test-evt-esm-mat-${agents}`;
    await seedEvent(id, 'active');
    if (agents > 0) await seedBucket(id, '1', agents);

    const { status, body } = await readAsAdmin(id);
    expect(status).toBe(200);
    const got = body.report?.distinct_scanners;

    if (mode === 'null') expect(got).toBeNull();
    if (mode === 'suppressed') expect(got === null || got === 0).toBe(true);
    if (mode === 'exact') expect(got).toBe(value);
    // The whole point of the floor: a sub-K bucket must never surface its raw count.
    if (typeof forbid === 'number') expect(got).not.toBe(forbid);
  });
});

// ─── 3. Availability (rainy) ────────────────────────────────────────────────────

describe('OSE-1172 — availability gate on the read path', () => {
  beforeEach(async () => {
    await applyMigrations();
    await clearTables();
  });

  test('a nonexistent event → 404 NOT_FOUND (a signed token does not conjure a report)', async () => {
    const { status, body } = await readAsAdmin('test-evt-esm-does-not-exist');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
  });
});
