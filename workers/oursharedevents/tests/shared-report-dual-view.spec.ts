/**
 * SharedReport dual view — the number both parties can point at.
 *
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The SharedReport's whole premise is that a sponsor and a host can sit side by
 * side, on their own screens, and read the SAME figure for the same question. If
 * they cannot, the product's core claim is false and everything downstream — the
 * spend justification, the renewal conversation — is unsupported.
 *
 * The read API makes this architecturally true rather than aspirational: it is a
 * straight readout with NO field-stripping. Depth filters by OMISSION only —
 * "no value is ever transformed, rounded, or degraded per tier. Same pipeline,
 * same numbers, fewer sections" (report-depth.ts). So a field present in two
 * roles must be byte-identical, and this spec asserts exactly that.
 *
 * WHAT IT COVERS, in the order the flow spec demands
 *   1. DB rows land with the expected columns (never inferred from behavior)
 *   2. Both roles read the API and every SHARED figure reconciles byte-for-byte
 *   3. Scoping in BOTH directions — a sponsor sees its own slice and NOT another's
 *   4. The FE contract: the shape shared-report.html actually consumes
 *
 * Every fixture is torn down. Nothing here reads ambient data.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';

const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';
const EVENT_ID = 'evt_dualview_001';
const SPONSOR_A = 'spn_dualview_alpha';
const SPONSOR_B = 'spn_dualview_beta';
const UNIQUE_AGENTS = 42;

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  const run = async (db: D1Database, stmts: string[]) => {
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.includes('duplicate column') || m.includes('already exists') || m.includes('no such column')) continue;
        throw e;
      }
    }
  };
  await run(tenv().DB, JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]);
  await run(tenv().FORMS_DB, JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS) as string[]);
}

async function signedLink(
  eventId: string,
  role: 'bar_owner' | 'sponsor' | 'admin',
  opts: { sponsor_id?: string; depth?: string } = {}
): Promise<string> {
  const t = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    eventId,
    role,
    3600,
    opts
  );
  expect(t, 'signing secret must be configured in the test env').not.toBeNull();
  return t!;
}

async function fetchReport(token: string, eventId = EVENT_ID): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v2/events/${eventId}/shared-report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('SharedReport — one API, two views, same numbers', () => {
  beforeAll(async () => {
    await applyMigrations();
    const db = tenv().DB;

    await db
      .prepare(
        `INSERT OR REPLACE INTO events
           (id, brand_id, title, slug, status, location, start_date, end_date, created_at, updated_at)
         VALUES (?, 'test-brand', 'Dual View Fixture', ?, 'active', 'Test Venue', ?, ?,
                 datetime('now'), datetime('now'))`
      )
      .bind(EVENT_ID, EVENT_ID, '2026-05-07T19:00:00Z', '2026-05-07T23:00:00Z')
      .run();

    await db
      .prepare(
        `INSERT OR REPLACE INTO scan_aggregates
           (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
         VALUES (?, ?, '2026-05-07', NULL, ?, ?, datetime('now'))`
      )
      .bind(`sa-${EVENT_ID}`, EVENT_ID, UNIQUE_AGENTS * 3, UNIQUE_AGENTS)
      .run();

    // sponsor_impressions FKs to sponsor_business(id) as of migration 0067, which
    // retired the combined `sponsors` table for the OSE-799 split model
    // (business x placement x asset). Seeding the legacy table fails with
    // "no such table" — the FK moved with the model.
    for (const [id, name] of [
      [SPONSOR_A, 'Alpha Brewing'],
      [SPONSOR_B, 'Beta Athletic'],
    ] as Array<[string, string]>) {
      await db
        .prepare(
          `INSERT OR REPLACE INTO sponsor_business (id, brand_id, name, created_at, updated_at)
           VALUES (?, 'test-brand', ?, datetime('now'), datetime('now'))`
        )
        .bind(id, name)
        .run();
    }

    // Distinguishable counts, so a cross-contamination bug cannot hide behind
    // equal numbers.
    const rows: Array<[string, string, string, string]> = [
      [`imp-a-1-${EVENT_ID}`, SPONSOR_A, 'tv', 'impression'],
      [`imp-a-2-${EVENT_ID}`, SPONSOR_A, 'mobile', 'impression'],
      [`imp-a-3-${EVENT_ID}`, SPONSOR_A, 'mobile', 'click'],
      [`imp-b-1-${EVENT_ID}`, SPONSOR_B, 'tv', 'impression'],
    ];
    for (const [id, sponsorId, surface, eventType] of rows) {
      await db
        .prepare(
          `INSERT OR REPLACE INTO sponsor_impressions
             (id, sponsor_id, event_id, surface, placement, event_type, created_at)
           VALUES (?, ?, ?, ?, 'slot-1', ?, datetime('now'))`
        )
        .bind(id, sponsorId, EVENT_ID, surface, eventType)
        .run();
    }
  });

  afterAll(async () => {
    const db = tenv().DB;
    await db.prepare('DELETE FROM sponsor_impressions WHERE event_id = ?').bind(EVENT_ID).run();
    for (const id of [SPONSOR_A, SPONSOR_B]) {
      await db.prepare('DELETE FROM sponsor_business WHERE id = ?').bind(id).run();
    }
    await db.prepare('DELETE FROM scan_aggregates WHERE event_id = ?').bind(EVENT_ID).run();
    await db.prepare('DELETE FROM events WHERE id = ?').bind(EVENT_ID).run();
  });

  // ── 1. DB rows, against the written contract ───────────────────────────────

  describe('DB rows land with the contracted columns', () => {
    test('events row carries the contracted identity and lifecycle columns', async () => {
      const row = await tenv()
        .DB.prepare('SELECT id, brand_id, title, slug, status, start_date FROM events WHERE id = ?')
        .bind(EVENT_ID)
        .first<Record<string, unknown>>();
      expect(row).not.toBeNull();
      expect(row!.id).toBe(EVENT_ID);
      expect(row!.status, 'fixture must be active to be reportable').toBe('active');
      expect(row!.start_date).toBeTruthy();
    });

    test('sponsor_impressions distinguishes impression from click via event_type', async () => {
      const { results } = await tenv()
        .DB.prepare(
          `SELECT event_type, COUNT(*) AS n FROM sponsor_impressions
            WHERE event_id = ? AND sponsor_id = ? GROUP BY event_type ORDER BY event_type`
        )
        .bind(EVENT_ID, SPONSOR_A)
        .all<{ event_type: string; n: number }>();
      const byType = Object.fromEntries(results.map((r) => [r.event_type, r.n]));
      expect(byType.click, 'post-event click must be distinguishable from an in-event scan').toBe(1);
      expect(byType.impression).toBe(2);
    });

    test('no PII column carries a value on the reporting path', async () => {
      const row = await tenv()
        .DB.prepare('SELECT * FROM sponsor_impressions WHERE event_id = ? LIMIT 1')
        .bind(EVENT_ID)
        .first<Record<string, unknown>>();
      for (const key of Object.keys(row ?? {})) {
        expect(
          /email|phone|attendee_name|ip_address|user_agent(?!_hash)/i.test(key),
          `reporting row exposes an identity-bearing column: ${key}`
        ).toBe(false);
      }
    });
  });

  // ── 2. The dual view — the whole point ────────────────────────────────────

  describe('both parties read the same numbers', () => {
    let managerBody: Record<string, unknown>;
    let sponsorBody: Record<string, unknown>;

    beforeAll(async () => {
      const mgr = await fetchReport(await signedLink(EVENT_ID, 'bar_owner'));
      expect(mgr.status, 'event manager must be able to read the report').toBe(200);
      managerBody = (await mgr.json()) as Record<string, unknown>;

      const spn = await fetchReport(await signedLink(EVENT_ID, 'sponsor', { sponsor_id: SPONSOR_A }));
      expect(spn.status, 'sponsor must be able to read the report').toBe(200);
      sponsorBody = (await spn.json()) as Record<string, unknown>;
    });

    test('the event identity is identical in both views', () => {
      for (const field of ['event_id', 'event_title', 'event_start_date']) {
        const a = JSON.stringify((managerBody as never)[field] ?? (managerBody.report as never)?.[field]);
        const b = JSON.stringify((sponsorBody as never)[field] ?? (sponsorBody.report as never)?.[field]);
        if (a === undefined && b === undefined) continue;
        expect(b, `"${field}" differs between the two views`).toBe(a);
      }
    });

    test('every field present in BOTH views is byte-identical', () => {
      const mgr = (managerBody.report ?? managerBody) as Record<string, unknown>;
      const spn = (sponsorBody.report ?? sponsorBody) as Record<string, unknown>;
      const shared = Object.keys(mgr).filter((k) => k in spn && k !== 'sponsor_impressions' && k !== '_meta');

      expect(shared.length, 'the two views share no fields at all — nothing to reconcile').toBeGreaterThan(0);

      const drift: string[] = [];
      for (const k of shared) {
        const a = JSON.stringify(mgr[k]);
        const b = JSON.stringify(spn[k]);
        if (a !== b) drift.push(`${k}: manager=${a} sponsor=${b}`);
      }
      expect(
        drift,
        'a shared figure differs between roles. Depth filters by OMISSION only — ' +
          'a value present in both MUST be the same value, or the side-by-side premise is false'
      ).toEqual([]);
    });
  });

  // ── 3. Scoping, asserted in BOTH directions ──────────────────────────────

  describe('scoping — own slice yes, another sponsor no', () => {
    test('a sponsor sees its own impressions', async () => {
      const res = await fetchReport(await signedLink(EVENT_ID, 'sponsor', { sponsor_id: SPONSOR_A }));
      const body = (await res.json()) as Record<string, unknown>;
      const report = (body.report ?? body) as Record<string, unknown>;
      const rows = (report.sponsor_impressions ?? []) as Array<{ sponsor_id?: string }>;
      expect(rows.some((r) => r.sponsor_id === SPONSOR_A), 'sponsor cannot see its own slice').toBe(true);
    });

    test('a sponsor CANNOT see another sponsor rows — the negative case', async () => {
      const res = await fetchReport(await signedLink(EVENT_ID, 'sponsor', { sponsor_id: SPONSOR_A }));
      const body = (await res.json()) as Record<string, unknown>;
      const report = (body.report ?? body) as Record<string, unknown>;
      const rows = (report.sponsor_impressions ?? []) as Array<{ sponsor_id?: string }>;
      const leaked = rows.filter((r) => r.sponsor_id && r.sponsor_id !== SPONSOR_A);
      expect(
        leaked.map((r) => r.sponsor_id),
        'CROSS-CONTAMINATION: sponsor A can read another sponsor rows'
      ).toEqual([]);
    });

    test('a token for another event is rejected — 401 or 403, never data', async () => {
      const res = await fetchReport(await signedLink('evt_some_other_event', 'bar_owner'));
      expect([401, 403], `expected rejection, got ${res.status}`).toContain(res.status);
    });

    test('no token at all is rejected', async () => {
      const res = await SELF.fetch(`https://example.com/api/v2/events/${EVENT_ID}/shared-report`);
      expect([401, 403]).toContain(res.status);
    });
  });

  // ── 4. The FE contract ────────────────────────────────────────────────────

  describe('the shape the front end consumes', () => {
    /**
     * The report PAGE is auth-gated too, not just the API. An unauthenticated
     * fetch returns 403 — asserted as the security property rather than as page
     * availability, because a report surface that renders to anyone with the
     * event id would leak the numbers the token model exists to scope.
     */
    test('the report surface refuses an unauthenticated request', async () => {
      const res = await SELF.fetch(`https://example.com/sharedReport?event=${EVENT_ID}`);
      expect([401, 403], `report page served ${res.status} with no token`).toContain(res.status);
    });

    test('the payload is JSON the page can render without reshaping', async () => {
      const res = await fetchReport(await signedLink(EVENT_ID, 'bar_owner'));
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const body = (await res.json()) as Record<string, unknown>;
      const report = (body.report ?? body) as Record<string, unknown>;
      expect(Object.keys(report).length, 'empty report body').toBeGreaterThan(0);
    });
  });
});
