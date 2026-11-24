/**
 * The SharedReport's "nothing yet" note at the floor (OSE-2093).
 *
 * `_meta.suppression_reasons` carries `{ field: '_event', reason:
 * 'materialization_pending' }` when a report has essentially no signal. It was
 * pushed only when the RAW count of people seen at the event was exactly 0, so
 * at a small event the note was there with nobody and gone with 1 to 4: every
 * reader could tell 0 attendees from 1 to 4 (AGENTS.md invariant 2: a count of
 * people under 5 is withheld, and 0 reads the same as 1 to 4).
 *
 * Each pair below reads the whole report twice through the real route, one
 * person apart under the floor: nothing may differ. The control makes the same
 * change at the floor, where the report must move.
 *
 * @born-red, on main's builder (e7d2160, 2026-11-16), 6 of 22 failed: the
 * 0 -> 1 pair for both readers and both scan shapes (the report text differed),
 * and the note count, which read [1, 0, 0, 0] for 0, 1, 4 and 5 people where
 * [1, 1, 1, 0] is expected. The 1 -> 2, 2 -> 3 and 3 -> 4 pairs and the controls
 * passed on main and are guards.
 *
 * OSE-2214 (owner, 2026-11-23): the report no longer reads people at all, so the
 * pairs now move one SCAN at a time in one poster hour; the rule is the same.
 *
 * Staging twin: bruno/ose-api/18. Campaigns (S14), requests 85 to 88. On a local
 * worker with the staging fixture, request 88 went red on main's builder
 * ("expected +0 to deeply equal 1") and the folder is green with the change.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { usePaidReportPlan } from './helpers/paid-report-plan';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
import { mintSignedLinkToken, type SignedLinkRole } from '../src/lib/shared-report-auth';
import { clearPosterHours, seedPosterHour } from './helpers/seed-poster-hours';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const K = CORRIDOR_MAP_MIN_COUNT;
const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';
const EVT = 'test-evt-pn-1';

// ─── Harness ────────────────────────────────────────────────────────────────

// Once per isolate: a second apply of migration 0018 breaks the sponsor_displays
// foreign key (see the header of shared-report-kanon-floor.spec.ts).
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
  await db.prepare(`DELETE FROM sponsor_displays WHERE id LIKE 'si-pn-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-pn-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-pn-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-pn-%'`).run();
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE 'test-evt-pn-%'`).run();
  await clearPosterHours(db, 'test-evt-pn-');
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-pn-%'`).run();
}

/** Scan buckets the event has: none, or two hours that are each under the floor. */
type Scans = 'no scan buckets' | 'scan buckets under the floor';

async function seedEvent(id: string, scans: Scans): Promise<void> {
  const db = tenv().DB;
  await db
    .prepare(
      `INSERT INTO events
         (id, brand_id, title, slug, status, location, start_date, settings_json, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', '2026-05-07T19:00:00Z',
               '{"useSponsors":true}', '2026-05-01 00:00:00', '2026-05-01 00:00:00')`
    )
    .bind(id, `Test ${id}`, id)
    .run();
  if (scans === 'scan buckets under the floor') {
    for (const hour of [19, 20]) {
      await db
        .prepare(
          `INSERT INTO scan_aggregates
             (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
           VALUES (?, ?, '2026-05-07', ?, ?, ?, '2026-05-08 03:00:00')`
        )
        .bind(`sa-${id}-${hour}`, id, hour, K - 1, K - 1)
        .run();
      // OSE-1784: people are counted in poster-hours, so the same hours under
      // the floor are scans at a poster too.
      await seedPosterHour(db, id, hour, K - 1);
    }
  }
}

/**
 * Set the scans at one poster hour of the event to exactly `n` (OSE-2214: the
 * report counts scans of the code, never people; anon_id_returns is no longer
 * read). Hour 21 is apart from the shapes' hours 19 and 20.
 */
async function setScansInOneHour(n: number): Promise<void> {
  const db = tenv().DB;
  await db
    .prepare(`DELETE FROM scan_placement_events WHERE event_id = ? AND scan_bucket LIKE '%T21:%'`)
    .bind(EVT)
    .run();
  await seedPosterHour(db, EVT, 21, n);
}
const STAMP = '2026-05-08 03:00:00';

interface Report {
  scans: number | null;
  _meta: { suppression_reasons: Array<{ field: string; reason: string; detail?: string }> };
}

/** The report as the read route returns it, and its text for a whole-report compare. */
async function read(role: SignedLinkRole): Promise<{ report: Report; text: string }> {
  const token = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    EVT,
    role,
    undefined,
    role === 'sponsor' ? { depth: 'mid' } : {}
  );
  if (!token) throw new Error('mint returned null');
  const res = await SELF.fetch(`https://test.local/api/v2/events/${EVT}/shared-report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  const body = JSON.parse(text) as { ok: boolean; report: Report };
  expect(body.ok).toBe(true);
  return { report: body.report, text };
}

const pendingNotes = (r: Report) => r._meta.suppression_reasons.filter((s) => s.field === '_event');

beforeAll(async () => {
  await usePaidReportPlan();
  await applyMigrations();
});

const READERS: Array<[string, SignedLinkRole]> = [
  ['organizer link', 'bar_owner'],
  ['sponsor link', 'sponsor'],
];
const SHAPES: Scans[] = ['no scan buckets', 'scan buckets under the floor'];

for (const scans of SHAPES) {
  describe(`one scan more under the floor changes nothing (${scans})`, () => {
    beforeEach(async () => {
      await clearTables();
      await seedEvent(EVT, scans);
    });

    for (const [reader, role] of READERS) {
      for (let a = 0; a < K - 1; a++) {
        test(`${a} -> ${a + 1} scans in one hour, ${reader}: the whole report is the same`, async () => {
          await setScansInOneHour(a);
          const before = await read(role);
          await setScansInOneHour(a + 1);
          const after = await read(role);
          expect(after.text).toBe(before.text);
        });
      }

      test(`control: ${K - 1} -> ${K} scans in one hour, ${reader}: the report moves`, async () => {
        await setScansInOneHour(K - 1);
        const before = await read(role);
        await setScansInOneHour(K);
        const after = await read(role);
        expect(after.text).not.toBe(before.text);
        // OSE-2214: what moves is the scan figure, from withheld to 5.
        expect(before.report.scans).toBeNull();
        expect(after.report.scans).toBe(K);
      });
    }

    test('0 and 4 scans in an hour carry the same "nothing yet" note; 5 carry none', async () => {
      const notes: number[] = [];
      for (const n of [0, 1, K - 1, K]) {
        await setScansInOneHour(n);
        notes.push(pendingNotes((await read('bar_owner')).report).length);
      }
      expect(notes).toEqual([1, 1, 1, 0]);
    });
  });
}
