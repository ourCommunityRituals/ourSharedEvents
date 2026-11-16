/**
 * The SharedReport class breakdown at the floor
 * (`report.sponsor_class_breakdown.{local,mid,premium}`), OSE-2089.
 *
 * What it must hold (AGENTS.md invariant 2, owner 2026-11-14: a count of people
 * or their actions under 5 is withheld for every reader, in words, never 0, and
 * nothing published may give it back):
 *
 *   1. `total_displays` counts actions. Each (sponsor x surface) part passes the
 *      floor before it is summed (`floorTotalOfParts`), so a class total is the
 *      sum of the `sponsor_displays` rows published for that class.
 *   2. A class with no part at the floor has its total WITHHELD: null, with one
 *      `_meta.suppression_reasons` entry that carries the words. Never 0. A class
 *      with no sponsor at all reads the same as one whose sponsors have 1 to 4.
 *   3. `sponsor_count` counts businesses (the `entity` class of
 *      lib/dashboard-contract.ts) and has no floor. Owner ruling 2026-11-16: it
 *      is each sponsor taking part in the event, placed and accepted by both
 *      sides, so it does not move with displays at all.
 *
 * The neighbour block reads the whole report twice, one display apart, inside a
 * group under the floor: nothing may differ. Its control makes the same change
 * above the floor, where the report must move.
 *
 * @born-red, on main's builder (6911a06, 2026-11-16), 17 of 55 failed, each with
 *   "expected +0 to be null" or no withheld note: the nine 0, 1 and 4 cases, the
 *   empty class, "4 + 4 + 4", three of the note cases, both sponsor_count tests
 *   (they assert the null beside the count) and "0 reads the same as 4". The
 *   hidden neighbour pairs and the controls passed on main and are guards: 0 to
 *   4 already read alike there, as "0". What changed is what they read as.
 * Faults planted in the new code, one at a time, each seen red:
 *   - a withheld total written as 0;
 *   - the raw class sum floored (rows under the floor let into the sum);
 *   - the note left out; the note written once per withheld class.
 *
 * Page twin: tests/withheld-count-words.spec.ts, "the report class breakdown".
 * Staging twin: bruno/ose-api/18. Campaigns (S14), request 83.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { usePaidReportPlan } from './helpers/paid-report-plan';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
import { fewerThan } from '../src/lib/withheld-words';
import { mintSignedLinkToken, type SignedLinkRole } from '../src/lib/shared-report-auth';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const K = CORRIDOR_MAP_MIN_COUNT;
const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';
const EVT = 'test-evt-cf-1';
const WITHHELD_FIELD = 'sponsor_class_breakdown.total_displays';

type ClassName = 'local' | 'mid' | 'premium';
const CLASSES: ClassName[] = ['local', 'mid', 'premium'];

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
  await db.prepare(`DELETE FROM sponsor_displays WHERE id LIKE 'si-cf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-cf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-cf-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-cf-%'`).run();
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE 'test-evt-cf-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-cf-%'`).run();
}

async function seedEvent(id: string): Promise<void> {
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
  // A fixed materialised signal, so two reads of one dataset are the same text.
  await db
    .prepare(
      `INSERT INTO scan_aggregates
         (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
       VALUES (?, ?, '2026-05-07', NULL, 60, 20, '2026-05-08 03:00:00')`
    )
    .bind(`sa-${id}`, id)
    .run();
}

/** A sponsor placed at the event in one class: local, mid (silver) or premium (gold). */
async function seedSponsor(id: string, cls: ClassName): Promise<void> {
  await seedSplitSponsor(tenv().DB, {
    id,
    eventId: EVT,
    name: `Sponsor ${id}`,
    tier: cls === 'premium' ? 'gold' : 'silver',
    isLocal: cls === 'local' ? 1 : 0,
  });
}

/** Set one (sponsor x surface) part to exactly `n` displays. */
async function setDisplays(sponsorId: string, surface: string, n: number): Promise<void> {
  const db = tenv().DB;
  await db
    .prepare(`DELETE FROM sponsor_displays WHERE sponsor_id = ? AND event_id = ? AND surface = ?`)
    .bind(sponsorId, EVT, surface)
    .run();
  for (let i = 0; i < n; i++) {
    await db
      .prepare(
        `INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type, created_at)
         VALUES (?, ?, ?, ?, 'p1', 'display', '2026-05-07 20:00:00')`
      )
      .bind(`si-cf-${sponsorId}-${surface}-${i}`, sponsorId, EVT, surface)
      .run();
  }
}

interface ClassRow {
  sponsor_count: number;
  total_displays: number | null;
}
interface Report {
  sponsor_displays: Array<{ sponsor_id: string; surface: string; count: number }>;
  sponsor_class_breakdown: Record<ClassName, ClassRow>;
  _meta: { suppression_reasons: Array<{ field: string; reason: string; detail?: string }> };
}

async function built(): Promise<Report> {
  const r = await buildSharedReport(tenv().DB, EVT);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('report not built');
  return r.report as unknown as Report;
}

/** The report as the read route returns it, and its text for a whole-report compare. */
async function read(
  role: SignedLinkRole,
  sponsorId?: string
): Promise<{ report: Report; text: string }> {
  const token = await mintSignedLinkToken(
    { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
    EVT,
    role,
    undefined,
    role === 'sponsor' ? { depth: 'mid', ...(sponsorId ? { sponsor_id: sponsorId } : {}) } : {}
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

const withheldNotes = (r: Report) =>
  r._meta.suppression_reasons.filter((s) => s.field === WITHHELD_FIELD);

beforeAll(async () => {
  await usePaidReportPlan();
  await applyMigrations();
});

beforeEach(async () => {
  await clearTables();
  await seedEvent(EVT);
});

// ─── 1. One class at the floor ──────────────────────────────────────────────

describe('a class total at 0, 1, 4, 5 and 6 displays', () => {
  for (const cls of CLASSES) {
    for (const n of [0, 1, K - 1]) {
      test(`${cls}, ${n} displays: the total is withheld (null), never 0`, async () => {
        await seedSponsor('sp-cf-a', cls);
        await setDisplays('sp-cf-a', 'poster', n);

        const row = (await built()).sponsor_class_breakdown[cls];
        expect(row.total_displays).toBeNull();
        // The exact count is nowhere in the class row: the 1 is the sponsor.
        expect(row).toEqual({ sponsor_count: 1, total_displays: null });
      });
    }

    for (const n of [K, K + 1]) {
      test(`${cls}, ${n} displays: published exactly`, async () => {
        await seedSponsor('sp-cf-a', cls);
        await setDisplays('sp-cf-a', 'poster', n);

        const row = (await built()).sponsor_class_breakdown[cls];
        expect(row).toEqual({ sponsor_count: 1, total_displays: n });
      });
    }
  }

  test('a class with no sponsor at all reads the same as one whose sponsor has 4', async () => {
    await seedSponsor('sp-cf-a', 'local');
    await setDisplays('sp-cf-a', 'poster', K - 1);

    const scb = (await built()).sponsor_class_breakdown;
    expect(scb.mid.total_displays).toBeNull();
    expect(scb.local.total_displays).toBe(scb.mid.total_displays);
    expect(scb.premium.total_displays).toBe(scb.mid.total_displays);
    // The sponsors taking part are counted: one local, none in the others.
    expect(scb.local.sponsor_count).toBe(1);
    expect(scb.mid.sponsor_count).toBe(0);
    expect(scb.premium.sponsor_count).toBe(0);
  });

  test('the total is the sum of the rows published for the class (7 + 3 is 7, 6 + 5 is 11)', async () => {
    await seedSponsor('sp-cf-a', 'premium');
    await seedSponsor('sp-cf-b', 'premium');
    await setDisplays('sp-cf-a', 'poster', 7);
    await setDisplays('sp-cf-b', 'poster', 3);
    let r = await built();
    expect(r.sponsor_class_breakdown.premium).toEqual({ sponsor_count: 2, total_displays: 7 });

    await setDisplays('sp-cf-a', 'poster', 6);
    await setDisplays('sp-cf-b', 'poster', 5);
    r = await built();
    expect(r.sponsor_class_breakdown.premium).toEqual({ sponsor_count: 2, total_displays: 11 });
    expect(r.sponsor_displays.reduce((n, row) => n + row.count, 0)).toBe(11);
  });

  test('many small parts never add up to a published total (4 + 4 + 4 is withheld)', async () => {
    await seedSponsor('sp-cf-a', 'mid');
    await seedSponsor('sp-cf-b', 'mid');
    await setDisplays('sp-cf-a', 'poster', K - 1);
    await setDisplays('sp-cf-a', 'display', K - 1);
    await setDisplays('sp-cf-b', 'poster', K - 1);

    const r = await built();
    expect(r.sponsor_class_breakdown.mid).toEqual({ sponsor_count: 2, total_displays: null });
    expect(r.sponsor_displays).toEqual([]);
  });
});

// ─── 2. The words ───────────────────────────────────────────────────────────

describe('a withheld class total is said in words, once', () => {
  test('one note for the three classes, from lib/withheld-words.ts, naming no class', async () => {
    const notes = withheldNotes(await built());
    expect(notes).toHaveLength(1);
    expect(notes[0]!.reason).toBe('below_min_sample_size');
    expect(notes[0]!.detail).toContain(fewerThan(K, '', true));
    expect(notes[0]!.detail).not.toMatch(/local|mid|premium|anchor/i);
  });

  test('one class withheld, two published: still one note', async () => {
    await seedSponsor('sp-cf-a', 'local');
    await seedSponsor('sp-cf-b', 'mid');
    await seedSponsor('sp-cf-c', 'premium');
    await setDisplays('sp-cf-a', 'poster', K);
    await setDisplays('sp-cf-b', 'poster', K);
    await setDisplays('sp-cf-c', 'poster', K - 1);
    expect(withheldNotes(await built())).toHaveLength(1);
  });

  test('every class published: no note', async () => {
    await seedSponsor('sp-cf-a', 'local');
    await seedSponsor('sp-cf-b', 'mid');
    await seedSponsor('sp-cf-c', 'premium');
    for (const s of ['sp-cf-a', 'sp-cf-b', 'sp-cf-c']) await setDisplays(s, 'poster', K);
    const r = await built();
    expect(withheldNotes(r)).toEqual([]);
    for (const cls of CLASSES) expect(r.sponsor_class_breakdown[cls].total_displays).toBe(K);
  });

  test('the read route carries the note to an organizer link and to a sponsor link', async () => {
    await seedSponsor('sp-cf-a', 'premium');
    await setDisplays('sp-cf-a', 'poster', K + 2);
    for (const [role, who] of [
      ['bar_owner', undefined],
      ['sponsor', 'sp-cf-a'],
    ] as Array<[SignedLinkRole, string | undefined]>) {
      const { report } = await read(role, who);
      expect(report.sponsor_class_breakdown.premium.total_displays, role).toBe(K + 2);
      expect(report.sponsor_class_breakdown.local.total_displays, role).toBeNull();
      expect(report.sponsor_class_breakdown.mid.total_displays, role).toBeNull();
      expect(withheldNotes(report), role).toHaveLength(1);
    }
  });
});

// Owner ruling 2026-11-16 (OSE-2089): a count at or over the floor is open
// knowledge between the sponsors of an event, and the class view is never taken
// from a sponsor at any depth. In a class of two, a sponsor can work out the
// other's total; that is accepted. This pins the ruling, so scoping the class
// breakdown on a sponsor link is a decision, not an accident.
describe("a sponsor's own link reads the whole-event class breakdown (owner ruling)", () => {
  test('the class totals are the same on a sponsor link as on the organizer link', async () => {
    await seedSponsor('sp-cf-a', 'premium');
    await seedSponsor('sp-cf-b', 'premium');
    await setDisplays('sp-cf-a', 'poster', K + 2);
    await setDisplays('sp-cf-b', 'poster', K + 1);
    const organizer = await read('bar_owner');
    const sponsor = await read('sponsor', 'sp-cf-a');
    expect(sponsor.report.sponsor_class_breakdown).toEqual(
      organizer.report.sponsor_class_breakdown
    );
    expect(sponsor.report.sponsor_class_breakdown.premium).toEqual({
      sponsor_count: 2,
      total_displays: 2 * K + 3,
    });
    // Its own rows only: the peer's row is not on the link.
    expect(sponsor.report.sponsor_displays.map((r) => r.sponsor_id)).toEqual(['sp-cf-a']);
  });

  test("a peer under the floor stays withheld on a sponsor's link", async () => {
    await seedSponsor('sp-cf-a', 'premium');
    await seedSponsor('sp-cf-b', 'premium');
    await setDisplays('sp-cf-a', 'poster', K + 2);
    await setDisplays('sp-cf-b', 'poster', K - 1);
    const { report } = await read('sponsor', 'sp-cf-a');
    expect(report.sponsor_class_breakdown.premium).toEqual({
      sponsor_count: 2,
      total_displays: K + 2,
    });
  });
});

// ─── 3. sponsor_count ───────────────────────────────────────────────────────

// Owner ruling 2026-11-16: the count is of each sponsor taking part in the
// event. It is read from the placements, so it does not move with displays.
// @born-red | method: run against the builder that counted sponsors with a
// published row: 14 tests of this file failed (a placed sponsor under the floor
// read sponsor_count 0) | date: 2026-11-16
describe('sponsor_count counts the sponsors taking part in the event', () => {
  test('it does not move with displays: 0, 1, 4, 5 and 6 all read 1', async () => {
    await seedSponsor('sp-cf-a', 'premium');
    const seen: Array<[number, number | null, number]> = [];
    for (const n of [0, 1, K - 1, K, K + 1]) {
      await setDisplays('sp-cf-a', 'poster', n);
      const r = await built();
      const row = r.sponsor_class_breakdown.premium;
      seen.push([row.sponsor_count, row.total_displays, r.sponsor_displays.length]);
    }
    // [sponsor_count, total_displays, rows published]
    expect(seen).toEqual([
      [1, null, 0],
      [1, null, 0],
      [1, null, 0],
      [1, K, 1],
      [1, K + 1, 1],
    ]);
  });

  test('a sponsor on three surfaces counts once, and it is never withheld', async () => {
    await seedSponsor('sp-cf-a', 'local');
    await setDisplays('sp-cf-a', 'poster', 6);
    await setDisplays('sp-cf-a', 'display', 7);
    await setDisplays('sp-cf-a', 'public', 8);
    const scb = (await built()).sponsor_class_breakdown;
    expect(scb.local).toEqual({ sponsor_count: 1, total_displays: 21 });
    // An entity count is a number in every class, beside a withheld total too.
    expect(scb.mid).toEqual({ sponsor_count: 0, total_displays: null });
    expect(scb.premium).toEqual({ sponsor_count: 0, total_displays: null });
  });

  test('each class counts its own sponsors, shown or not', async () => {
    await seedSponsor('sp-cf-a', 'local');
    await seedSponsor('sp-cf-b', 'local');
    await seedSponsor('sp-cf-c', 'mid');
    await seedSponsor('sp-cf-d', 'premium');
    await setDisplays('sp-cf-a', 'poster', K);
    const scb = (await built()).sponsor_class_breakdown;
    expect(scb.local).toEqual({ sponsor_count: 2, total_displays: K });
    expect(scb.mid).toEqual({ sponsor_count: 1, total_displays: null });
    expect(scb.premium).toEqual({ sponsor_count: 1, total_displays: null });
  });

  test('a sponsor that has not accepted, or was declined, is not counted (invariant 6)', async () => {
    await seedSponsor('sp-cf-a', 'premium');
    // Has not answered. Written here: the seed helper turns a null into a yes.
    await tenv()
      .DB.prepare(
        `UPDATE sponsor_placement SET sponsor_accepted = NULL WHERE sponsor_business_id = 'sp-cf-a'`
      )
      .run();
    await seedSplitSponsor(tenv().DB, {
      id: 'sp-cf-d',
      eventId: EVT,
      tier: 'gold',
      sponsorAccepted: 0,
    });
    await seedSplitSponsor(tenv().DB, {
      id: 'sp-cf-b',
      eventId: EVT,
      tier: 'gold',
      organizerAccepted: 0,
    });
    await seedSponsor('sp-cf-c', 'premium');
    expect((await built()).sponsor_class_breakdown.premium.sponsor_count).toBe(1);
  });

  test('an event that did not choose sponsors counts none', async () => {
    await seedSponsor('sp-cf-a', 'premium');
    await tenv()
      .DB.prepare(`UPDATE events SET settings_json = '{"useSponsors":false}' WHERE id = ?`)
      .bind(EVT)
      .run();
    expect((await built()).sponsor_class_breakdown.premium.sponsor_count).toBe(0);
  });

  test('a sponsor no longer placed still counts while its row is published', async () => {
    await seedSponsor('sp-cf-a', 'premium');
    await setDisplays('sp-cf-a', 'poster', K + 1);
    await tenv()
      .DB.prepare(`UPDATE sponsor_placement SET is_active = 0 WHERE sponsor_business_id = ?`)
      .bind('sp-cf-a')
      .run();
    expect((await built()).sponsor_class_breakdown.premium).toEqual({
      sponsor_count: 1,
      total_displays: K + 1,
    });
  });
});

// ─── 4. Neighbour datasets ──────────────────────────────────────────────────

describe('one display more, inside a group under the floor, changes nothing', () => {
  beforeEach(async () => {
    await seedSponsor('sp-cf-a', 'premium');
    await seedSponsor('sp-cf-b', 'premium');
    await seedSponsor('sp-cf-c', 'local');
    await setDisplays('sp-cf-b', 'poster', 9);
  });

  const READERS: Array<[string, SignedLinkRole]> = [
    ['organizer link', 'bar_owner'],
    ["the sponsor's own link", 'sponsor'],
  ];
  // The lever, the sponsor whose link is read for it, the surface and its class.
  const LEVERS: Array<[string, string, string, ClassName]> = [
    ['the only sponsor of a class', 'sp-cf-c', 'poster', 'local'],
    ['a second surface of a sponsor', 'sp-cf-b', 'display', 'premium'],
    ['a second sponsor of a class', 'sp-cf-a', 'poster', 'premium'],
  ];
  const HIDDEN: Array<[number, number]> = [];
  for (let n = 0; n < K - 1; n++) HIDDEN.push([n, n + 1]);

  for (const [lever, sponsor, surface, cls] of LEVERS) {
    for (const [reader, role] of READERS) {
      const who = role === 'sponsor' ? sponsor : undefined;
      for (const [a, b] of HIDDEN) {
        test(`${lever}, ${a} -> ${b} displays, ${reader}: the whole report is the same`, async () => {
          await setDisplays(sponsor, surface, a);
          const before = await read(role, who);
          await setDisplays(sponsor, surface, b);
          const after = await read(role, who);
          expect(after.text).toBe(before.text);
        });
      }

      test(`control: ${lever}, ${K} -> ${K + 1} displays, ${reader}: the class total moves by one`, async () => {
        await setDisplays(sponsor, surface, K);
        const before = await read(role, who);
        await setDisplays(sponsor, surface, K + 1);
        const after = await read(role, who);
        expect(after.text).not.toBe(before.text);
        expect(after.report.sponsor_class_breakdown[cls].total_displays).toBe(
          (before.report.sponsor_class_breakdown[cls].total_displays as number) + 1
        );
      });
    }
  }

  test('0 reads the same as 4, and 4 does not read the same as 5', async () => {
    await setDisplays('sp-cf-c', 'poster', 0);
    const zero = await read('bar_owner');
    await setDisplays('sp-cf-c', 'poster', K - 1);
    const four = await read('bar_owner');
    await setDisplays('sp-cf-c', 'poster', K);
    const five = await read('bar_owner');
    expect(four.text).toBe(zero.text);
    expect(zero.report.sponsor_class_breakdown.local.total_displays).toBeNull();
    expect(five.report.sponsor_class_breakdown.local.total_displays).toBe(K);
    expect(five.text).not.toBe(four.text);
  });
});
