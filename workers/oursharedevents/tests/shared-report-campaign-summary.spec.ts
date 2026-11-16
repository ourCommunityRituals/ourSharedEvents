/**
 * The SharedReport campaign summary (`report.campaign_summary`).
 *
 * What it must hold (AGENTS.md invariant 2, owner 2026-11-14: a count of people
 * or their actions under 5 is withheld for every reader, in words, never 0, and
 * nothing published may give it back):
 *
 *   1. `sponsor_count` is the number of DISTINCT sponsors in the campaign at this
 *      event: placed and accepted by both sides. It counts businesses that
 *      agreed to be shown (the `entity` class of lib/dashboard-contract.ts), so
 *      it is exact, and it does not move with displays under the floor.
 *   2. `total_displays` and `displays_by_surface` count actions. Each (sponsor x
 *      surface) part passes the floor before it is summed (`floorTotalOfParts`),
 *      so the total is the sum of the rows published beside it.
 *   3. A campaign is listed because a placement is in it, never because of a
 *      display. With every part under the floor it stays listed and its total is
 *      withheld (null, with the `_meta.suppression_reasons` entry that carries
 *      the words). 0 reads the same as 1 to 4.
 *   4. A sponsor's own link reads only that sponsor's campaign and numbers.
 *
 * The neighbour block reads the whole report twice, one display apart, inside a
 * group under the floor: nothing may differ. Its control makes the same change
 * above the floor, where the report must move.
 *
 * @born-red, on main's builder and handler (2026-11-16), 13 of 50 failed:
 *   - "a sponsor on three surfaces counts once": received 3; "two sponsors on
 *     four surfaces": received 4; the sponsor's own link: received 3.
 *   - the 0, 1 and 4 cases, "4 + 4 + 4", the order, "0 reads the same as 4" and
 *     the sponsor's own withheld campaign: the campaign was not in the summary.
 *   The hidden neighbour pairs passed on main: leaving a campaign out gave no
 *   count away. It could not be told from "no campaign", which is what changed.
 * Faults planted in the new code, one at a time, each seen red:
 *   - campaigns listed from the published display rows, not the placements;
 *   - the consent rule left out of the placement read;
 *   - a sponsor counted once per row;
 *   - a withheld total written as 0;
 *   - the unscoped summary handed to a sponsor link; every link of the event
 *     handed to a sponsor link; a peer's withheld note left on a sponsor link.
 *
 * Staging twin: bruno/ose-api/18. Campaigns (S14), requests 80 to 83.
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
const EVT = 'test-evt-cs-1';
const WITHHELD_FIELD = 'campaign_summary.total_displays';

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
  await db.prepare(`DELETE FROM sponsor_displays WHERE id LIKE 'si-cs-%'`).run();
  await db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'sp-cs-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'sp-cs-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sp-cs-%'`).run();
  await db.prepare(`UPDATE events SET campaign_id = NULL WHERE id LIKE 'test-evt-cs-%'`).run();
  await db.prepare(`DELETE FROM campaigns WHERE id LIKE 'camp-cs-%'`).run();
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE 'test-evt-cs-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'test-evt-cs-%'`).run();
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

async function seedCampaign(id: string, title: string, brand = 'test-brand'): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO campaigns (id, brand_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', '2026-05-01 00:00:00', '2026-05-01 00:00:00')`
    )
    .bind(id, brand, title)
    .run();
}

async function seedSponsor(
  id: string,
  campaignId: string | null,
  consent: { sponsorAccepted?: number | null; organizerAccepted?: number | null } = {}
): Promise<void> {
  await seedSplitSponsor(tenv().DB, {
    id,
    eventId: EVT,
    name: `Sponsor ${id}`,
    tier: 'gold',
    campaignId,
    ...consent,
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
      .bind(`si-cs-${sponsorId}-${surface}-${i}`, sponsorId, EVT, surface)
      .run();
  }
}

interface CampaignRow {
  campaign_id: string;
  campaign_title: string;
  total_displays: number | null;
  sponsor_count: number;
  displays_by_surface: Record<string, number>;
}
interface Report {
  sponsor_displays: Array<{
    sponsor_id: string;
    surface: string;
    count: number;
    campaign_id: string | null;
  }>;
  campaign_summary: CampaignRow[] | null;
  sponsor_class_breakdown: Record<string, { sponsor_count: number; total_displays: number }>;
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

const campaign = (r: Report, id: string): CampaignRow | undefined =>
  (r.campaign_summary ?? []).find((c) => c.campaign_id === id);
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

// ─── 1. Distinct sponsors ───────────────────────────────────────────────────

describe('campaign_summary.sponsor_count counts each sponsor once', () => {
  test('a sponsor on three surfaces counts once', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await setDisplays('sp-cs-a', 'poster', 6);
    await setDisplays('sp-cs-a', 'display', 7);
    await setDisplays('sp-cs-a', 'public', 8);

    const row = campaign(await built(), 'camp-cs-a')!;
    expect(row.sponsor_count).toBe(1);
    expect(row.total_displays).toBe(21);
    expect(row.displays_by_surface).toEqual({ poster: 6, display: 7, public: 8 });
  });

  test('two sponsors on four surfaces count as two, the same as the class breakdown', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-a');
    await setDisplays('sp-cs-a', 'poster', 6);
    await setDisplays('sp-cs-a', 'display', 7);
    await setDisplays('sp-cs-a', 'public', 8);
    await setDisplays('sp-cs-b', 'poster', 9);

    const r = await built();
    const row = campaign(r, 'camp-cs-a')!;
    expect(row.sponsor_count).toBe(2);
    const classes = Object.values(r.sponsor_class_breakdown);
    expect(classes.reduce((n, c) => n + c.sponsor_count, 0)).toBe(2);
    // Two sponsors on one surface add up on that surface.
    expect(row.displays_by_surface.poster).toBe(15);
    expect(row.total_displays).toBe(30);
  });

  test('it is a count of placements: it does not move with displays', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-a');
    await setDisplays('sp-cs-a', 'poster', 9);
    const counts: number[] = [];
    for (const n of [0, 1, K - 1, K, K + 1]) {
      await setDisplays('sp-cs-b', 'poster', n);
      counts.push(campaign(await built(), 'camp-cs-a')!.sponsor_count);
    }
    expect(counts).toEqual([2, 2, 2, 2, 2]);
  });

  test('a sponsor in no campaign, or in another campaign, is not counted', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedCampaign('camp-cs-b', 'Campaign B');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-b');
    await seedSponsor('sp-cs-c', null);
    for (const s of ['sp-cs-a', 'sp-cs-b', 'sp-cs-c']) await setDisplays(s, 'poster', 6);

    const r = await built();
    expect(campaign(r, 'camp-cs-a')!.sponsor_count).toBe(1);
    expect(campaign(r, 'camp-cs-b')!.sponsor_count).toBe(1);
    expect(r.campaign_summary).toHaveLength(2);
  });
});

// ─── 2. The display measures at the floor ───────────────────────────────────

describe('campaign display counts at 0, 1, 4, 5 and 6', () => {
  for (const n of [0, 1, K - 1]) {
    test(`${n} displays: the campaign is listed and its total is withheld, in words`, async () => {
      await seedCampaign('camp-cs-a', 'Campaign A');
      await seedSponsor('sp-cs-a', 'camp-cs-a');
      await setDisplays('sp-cs-a', 'poster', n);

      const r = await built();
      const row = campaign(r, 'camp-cs-a');
      expect(row, 'a campaign under the floor is listed, not left out').toBeDefined();
      expect(row!.campaign_title).toBe('Campaign A');
      expect(row!.total_displays).toBeNull();
      expect(row!.displays_by_surface).toEqual({});
      expect(row!.sponsor_count).toBe(1);
      // The words come from lib/withheld-words.ts, once, and name no campaign.
      const notes = withheldNotes(r);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.reason).toBe('below_min_sample_size');
      expect(notes[0]!.detail).toContain(fewerThan(K, '', true));
      expect(JSON.stringify(notes)).not.toContain('camp-cs-a');
      // The exact count is nowhere in the campaign row.
      expect(Object.values(row!).filter((v) => typeof v === 'number')).toEqual([1]);
    });
  }

  for (const n of [K, K + 1]) {
    test(`${n} displays: published exactly, with no withheld note`, async () => {
      await seedCampaign('camp-cs-a', 'Campaign A');
      await seedSponsor('sp-cs-a', 'camp-cs-a');
      await setDisplays('sp-cs-a', 'poster', n);

      const r = await built();
      const row = campaign(r, 'camp-cs-a')!;
      expect(row.total_displays).toBe(n);
      expect(row.displays_by_surface).toEqual({ poster: n });
      expect(withheldNotes(r)).toEqual([]);
    });
  }

  test('the total is the sum of the parts published beside it (7 + 3 is 7, 6 + 4 is 6)', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-a');
    await setDisplays('sp-cs-a', 'poster', 7);
    await setDisplays('sp-cs-a', 'display', 3); // under the floor: dropped
    await setDisplays('sp-cs-b', 'public', 6);
    await setDisplays('sp-cs-b', 'poster', 4); // under the floor: not added to poster

    const r = await built();
    const row = campaign(r, 'camp-cs-a')!;
    expect(row.displays_by_surface).toEqual({ poster: 7, public: 6 });
    expect(row.total_displays).toBe(13);
    const rows = r.sponsor_displays.filter((d) => d.campaign_id === 'camp-cs-a');
    expect(rows.reduce((n, d) => n + d.count, 0)).toBe(row.total_displays);
    expect(Object.values(row.displays_by_surface).reduce((a, b) => a + b, 0)).toBe(
      row.total_displays
    );
    // A published campaign beside a withheld part says nothing more about it.
    expect(withheldNotes(r)).toEqual([]);
  });

  test('many small parts never add up to a published total (4 + 4 + 4 is withheld)', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    for (const s of ['sp-cs-a', 'sp-cs-b', 'sp-cs-c']) {
      await seedSponsor(s, 'camp-cs-a');
      await setDisplays(s, 'poster', K - 1);
    }
    const row = campaign(await built(), 'camp-cs-a')!;
    expect(row.total_displays).toBeNull();
    expect(row.displays_by_surface).toEqual({});
    expect(row.sponsor_count).toBe(3);
  });

  test('published campaigns come first, largest first; withheld ones follow by id', async () => {
    for (const c of ['camp-cs-a', 'camp-cs-b', 'camp-cs-c', 'camp-cs-d']) await seedCampaign(c, c);
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-b');
    await seedSponsor('sp-cs-c', 'camp-cs-c');
    await seedSponsor('sp-cs-d', 'camp-cs-d');
    await setDisplays('sp-cs-a', 'poster', 2);
    await setDisplays('sp-cs-b', 'poster', 6);
    await setDisplays('sp-cs-c', 'poster', 9);
    await setDisplays('sp-cs-d', 'poster', 4);
    const order = (await built()).campaign_summary!.map((c) => c.campaign_id);
    expect(order).toEqual(['camp-cs-c', 'camp-cs-b', 'camp-cs-a', 'camp-cs-d']);
  });
});

// ─── 3. Which campaigns are listed ──────────────────────────────────────────

describe('a campaign is listed for a placement, never for a display', () => {
  test('no placement in a campaign: campaign_summary is null', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedSponsor('sp-cs-a', null);
    await setDisplays('sp-cs-a', 'poster', 9);
    const r = await built();
    expect(r.campaign_summary).toBeNull();
    expect(withheldNotes(r)).toEqual([]);
  });

  test("another brand's campaign is not listed, by id or by title", async () => {
    await seedCampaign('camp-cs-x', 'Other Brand Campaign', 'other-brand');
    await seedSponsor('sp-cs-a', 'camp-cs-x');
    await setDisplays('sp-cs-a', 'poster', 9);
    const r = await built();
    expect(r.campaign_summary).toBeNull();
    expect(JSON.stringify(r)).not.toContain('Other Brand Campaign');
  });

  test('a sponsor that has not accepted, or was declined, is not counted and lists no campaign', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedCampaign('camp-cs-b', 'Campaign B');
    await seedCampaign('camp-cs-c', 'Campaign C');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-a');
    // Has not answered. Written here: the seed helper turns a null into a yes.
    await tenv()
      .DB.prepare(
        `UPDATE sponsor_placement SET sponsor_accepted = NULL WHERE sponsor_business_id = 'sp-cs-b'`
      )
      .run();
    await seedSponsor('sp-cs-c', 'camp-cs-b', { organizerAccepted: 0 }); // declined
    await seedSponsor('sp-cs-d', 'camp-cs-c', { sponsorAccepted: 0 });
    const r = await built();
    expect(r.campaign_summary!.map((c) => c.campaign_id)).toEqual(['camp-cs-a']);
    expect(campaign(r, 'camp-cs-a')!.sponsor_count).toBe(1);
    expect(JSON.stringify(r)).not.toContain('Campaign B');
    expect(JSON.stringify(r)).not.toContain('Campaign C');
  });

  test('an event that did not choose sponsors lists no campaign', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await setDisplays('sp-cs-a', 'poster', K - 1);
    await tenv()
      .DB.prepare(`UPDATE events SET settings_json = '{"useSponsors":false}' WHERE id = ?`)
      .bind(EVT)
      .run();
    expect((await built()).campaign_summary).toBeNull();
  });

  test('a sponsor no longer placed keeps its published rows in its campaign total', async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-a', { organizerAccepted: 0 });
    await setDisplays('sp-cs-a', 'poster', 6);
    // Under the floor it is as if it had none: one sponsor, one row.
    await setDisplays('sp-cs-b', 'poster', K - 1);
    const under = campaign(await built(), 'camp-cs-a')!;
    expect([under.sponsor_count, under.total_displays]).toEqual([1, 6]);
    // Its row is published from 5 up, so the total and the count hold it too.
    await setDisplays('sp-cs-b', 'poster', K);
    const r = await built();
    const row = campaign(r, 'camp-cs-a')!;
    expect([row.sponsor_count, row.total_displays]).toEqual([2, 6 + K]);
    const rows = r.sponsor_displays.filter((d) => d.campaign_id === 'camp-cs-a');
    expect(rows.reduce((n, d) => n + d.count, 0)).toBe(row.total_displays);
  });

  test("the event's campaign is the one read for every placement (OSE ADR-030 D8)", async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedCampaign('camp-cs-e', 'Event Campaign');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', null);
    await setDisplays('sp-cs-a', 'poster', 6);
    await tenv()
      .DB.prepare(`UPDATE events SET campaign_id = 'camp-cs-e' WHERE id = ?`)
      .bind(EVT)
      .run();
    const r = await built();
    expect(r.campaign_summary!.map((c) => c.campaign_id)).toEqual(['camp-cs-e']);
    expect(campaign(r, 'camp-cs-e')!.sponsor_count).toBe(2);
    expect(campaign(r, 'camp-cs-e')!.total_displays).toBe(6);
  });
});

// ─── 4. A sponsor's own link ────────────────────────────────────────────────

describe("a sponsor's own link reads its own campaign only", () => {
  beforeEach(async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedCampaign('camp-cs-b', 'Campaign B');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-a');
    await seedSponsor('sp-cs-c', 'camp-cs-b');
    await setDisplays('sp-cs-b', 'poster', 9);
    await setDisplays('sp-cs-c', 'poster', 2);
  });

  test("a sponsor's own link: a sponsor on three surfaces counts once", async () => {
    await setDisplays('sp-cs-a', 'poster', 6);
    await setDisplays('sp-cs-a', 'display', 7);
    await setDisplays('sp-cs-a', 'public', 8);
    const { report } = await read('sponsor', 'sp-cs-a');
    expect(report.campaign_summary).toHaveLength(1);
    const row = campaign(report, 'camp-cs-a')!;
    // One: itself. Never the co-sponsor, and never one per surface.
    expect(row.sponsor_count).toBe(1);
    expect(row.total_displays).toBe(21);
    expect(withheldNotes(report)).toEqual([]);
  });

  test("a sponsor's own link: its campaign under the floor is listed and withheld", async () => {
    await setDisplays('sp-cs-a', 'poster', K - 1);
    const { report, text } = await read('sponsor', 'sp-cs-a');
    expect(report.campaign_summary).toHaveLength(1);
    const row = campaign(report, 'camp-cs-a')!;
    expect(row.total_displays).toBeNull();
    expect(row.displays_by_surface).toEqual({});
    expect(row.sponsor_count).toBe(1);
    expect(withheldNotes(report)).toHaveLength(1);
    // Nothing of the co-sponsor's 9 displays, and nothing of the other campaign.
    expect(text).not.toContain('camp-cs-b');
    expect(text).not.toContain('Campaign B');
  });

  test("a peer's withheld campaign leaves no note on this sponsor's report", async () => {
    await setDisplays('sp-cs-a', 'poster', 6);
    // camp-cs-b is withheld (2 displays) for the organizer...
    expect(withheldNotes((await read('bar_owner')).report)).toHaveLength(1);
    // ...and sp-cs-a, who is not in it, is told nothing about it.
    const { report } = await read('sponsor', 'sp-cs-a');
    expect(withheldNotes(report)).toEqual([]);
  });

  test('a sponsor link that names no sponsor reads no campaign', async () => {
    const { report } = await read('sponsor');
    expect(report.campaign_summary).toBeNull();
    expect(withheldNotes(report)).toEqual([]);
  });
});

// ─── 5. Neighbour datasets ──────────────────────────────────────────────────

describe('one display more, inside a group under the floor, changes nothing', () => {
  beforeEach(async () => {
    await seedCampaign('camp-cs-a', 'Campaign A');
    await seedCampaign('camp-cs-b', 'Campaign B');
    await seedSponsor('sp-cs-a', 'camp-cs-a');
    await seedSponsor('sp-cs-b', 'camp-cs-a');
    await seedSponsor('sp-cs-c', 'camp-cs-b');
    await setDisplays('sp-cs-b', 'poster', 9);
  });

  const READERS: Array<[string, SignedLinkRole, string | undefined]> = [
    ['organizer link', 'bar_owner', undefined],
    ["the sponsor's own link", 'sponsor', undefined], // sponsor id filled in per lever
  ];
  // The lever, and the sponsor whose link is read for it.
  const LEVERS: Array<[string, string, string]> = [
    ['the only sponsor of a campaign', 'sp-cs-c', 'poster'],
    ['a second surface of a sponsor', 'sp-cs-b', 'display'],
    ['a second sponsor of a campaign', 'sp-cs-a', 'poster'],
  ];
  const HIDDEN: Array<[number, number]> = [];
  for (let n = 0; n < K - 1; n++) HIDDEN.push([n, n + 1]);

  for (const [lever, sponsor, surface] of LEVERS) {
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

      test(`control: ${lever}, ${K} -> ${K + 1} displays, ${reader}: the campaign total moves by one`, async () => {
        const id = sponsor === 'sp-cs-c' ? 'camp-cs-b' : 'camp-cs-a';
        await setDisplays(sponsor, surface, K);
        const before = await read(role, who);
        await setDisplays(sponsor, surface, K + 1);
        const after = await read(role, who);
        expect(after.text).not.toBe(before.text);
        expect(campaign(after.report, id)!.total_displays).toBe(
          (campaign(before.report, id)!.total_displays as number) + 1
        );
      });
    }
  }

  test('0 reads the same as 4, and 4 does not read the same as 5', async () => {
    await setDisplays('sp-cs-c', 'poster', 0);
    const zero = await read('bar_owner');
    await setDisplays('sp-cs-c', 'poster', K - 1);
    const four = await read('bar_owner');
    await setDisplays('sp-cs-c', 'poster', K);
    const five = await read('bar_owner');
    expect(four.text).toBe(zero.text);
    expect(campaign(zero.report, 'camp-cs-b')!.total_displays).toBeNull();
    expect(campaign(five.report, 'camp-cs-b')!.total_displays).toBe(K);
  });
});
