/**
 * OSE-1357 poster tiers (PO, 2026-09-30) — API half (workers pool, SELF.fetch + D1).
 * UI half: tests/poster-tiers-ui.spec.ts (node + jsdom).
 *
 *   Tier 1 — codes of any type: a native REGISTER code (the event's own
 *            registration form, built server-side) and a SPONSOR code (https
 *            only); the external `workshop` link is relabelled so the two
 *            aren't confused.
 *   Tier 2 — where posters go: a placement is AT THE VENUE (an area of the
 *            event's own location — address + map spot default to the event's)
 *            or IN THE COMMUNITY (its own address); each row carries its scan
 *            count, floored (OSE-1656: the poster's hours with 5 or more).
 *   Tier 3 — the reach picture: pre-event-activity gains `reach` — placements
 *            ranked by scans, split venue vs community (floored the same way,
 *            OSE-1656), plus taps per code from shortlinks.clicks FLOORED at
 *            K=5 at every grain shown — never a small number, never derivable by
 *            subtraction (PO 2026-09-30). Never who: taps carry no location,
 *            scans resolve only to their poster, nothing person-shaped.
 *
 * @born-red poster tiers | method: spec written before the change and run
 *   against origin/main (edb9406: no register/sponsor kinds, no placement_type
 *   column, no per-row scans, no `reach` in pre-event-activity) with the change
 *   set aside in a tagged stash — red; green after | date: 2026-09-30
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { floorTaps } from '../src/lib/poster-reach';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
import { AS_PERSON } from './helpers/person-agent';

const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
} as const;

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;

const ORIGIN = 'https://t.test';
const BRAND = 'poster-tiers-0930';
const EVT = 'evt-poster-tiers-0930';
const EVT_REACH = 'evt-poster-tiers-reach-0930';
const VENUE_ADDRESS = 'Harbor Country Park, 12 Red Arrow Hwy, Sawyer, MI';
const SPONSOR_URL = 'https://harborbocce.example.org/sponsor';

async function applyMigrations(): Promise<void> {
  const sets: Array<[D1Database, string]> = [
    [tenv().DB, tenv().TEST_MIGRATION_STATEMENTS],
    [tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS],
  ];
  for (const [db, json] of sets) {
    for (const stmt of JSON.parse(json) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/duplicate column name|already exists|no such column/.test(msg)) continue;
        throw e;
      }
    }
  }
}

interface Code {
  kind: string;
  word: string;
  tone: string;
  code: string;
  url: string;
  target_url: string | null;
  points_to: string;
}
interface CodesBody {
  ok: boolean;
  limit: number;
  kinds: Array<{ kind: string; word: string; choice: string; needs_url: boolean }>;
  codes: Code[];
  code?: string;
}

const codesUrl = (id: string) => `${ORIGIN}/api/v2/admin/events/${id}/poster-codes`;
async function putCodes(body: unknown, id = EVT) {
  const res = await SELF.fetch(codesUrl(id), {
    method: 'PUT',
    headers: ADMIN,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as CodesBody };
}
async function follow(code: string): Promise<string | null> {
  const res = await SELF.fetch(`${ORIGIN}/s/${code}`, { redirect: 'manual', headers: AS_PERSON });
  expect(res.status).toBe(302);
  return res.headers.get('Location');
}
async function createPd(eventId: string, body: Record<string, unknown>) {
  const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${eventId}/poster-deployments`, {
    method: 'POST',
    headers: ADMIN,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
async function seedScans(eventId: string, pdId: string, n: number) {
  const bucket = new Date().toISOString().slice(0, 13) + ':00';
  for (let i = 0; i < n; i++) {
    await tenv()
      .DB.prepare(
        `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
         VALUES (?, ?, ?, ?)`
      )
      .bind(`spe-tiers-${pdId}-${i}`, eventId, pdId, bucket)
      .run();
  }
}

beforeAll(async () => {
  await applyMigrations();
  for (const t of ['scan_placement_events', 'poster_deployments', 'shortlinks']) {
    await tenv()
      .DB.prepare(`DELETE FROM ${t} WHERE event_id IN (SELECT id FROM events WHERE brand_id = ?)`)
      .bind(BRAND)
      .run();
  }
  await tenv().DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
  for (const id of [EVT, EVT_REACH]) {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, start_date, timezone,
                             location, where_address, lat, lon)
         VALUES (?, ?, 'Harbor County Bocce', ?, 'active', '2099-10-24', 'America/Chicago',
                 'Harbor Country Park', ?, 41.8837, -86.5922)`
      )
      .bind(id, BRAND, `slug-${id}`, VENUE_ADDRESS)
      .run();
  }
});

// ── Tier 1 — codes of any type ───────────────────────────────────────────────

describe('Tier 1 | a native REGISTER code and a SPONSOR code', () => {
  test('both are offered; REGISTER is internal (no link), SPONSOR needs a link; the external one is relabelled', async () => {
    const res = await SELF.fetch(codesUrl(EVT), { headers: ADMIN });
    const body = (await res.json()) as CodesBody;
    const reg = body.kinds.find((k) => k.kind === 'register');
    const spo = body.kinds.find((k) => k.kind === 'sponsor');
    const ext = body.kinds.find((k) => k.kind === 'workshop');
    expect(reg).toMatchObject({ word: 'REGISTER', needs_url: false });
    expect(spo).toMatchObject({ word: 'SPONSOR', needs_url: true });
    expect(ext?.choice).toBe('External registration link');
    expect(reg!.choice).not.toBe(ext!.choice);
  });

  test('REGISTER routes /s/ to the event’s own registration form — built server-side, no identity', async () => {
    const { status, body } = await putCodes({
      codes: [
        { kind: 'register', target_url: 'https://evil.example/ignored' },
        { kind: 'sponsor', target_url: SPONSOR_URL },
      ],
    });
    expect(status, JSON.stringify(body)).toBe(200);
    const reg = body.codes.find((c) => c.kind === 'register')!;
    expect(reg.word).toBe('REGISTER');
    expect(reg.target_url).toBeNull(); // a client-sent target is dropped
    const expected = `${ORIGIN}/forms/${EVT}?type=register`;
    expect(reg.points_to).toBe(expected);
    const loc = await follow(reg.code);
    expect(loc).toBe(expected);
    // Nothing but the event id and the form type: no token, deployment or person.
    const u = new URL(loc!);
    expect([...u.searchParams.keys()]).toEqual(['type']);
  });

  test('SPONSOR routes /s/ to the organizer’s https sponsorship page', async () => {
    const res = await SELF.fetch(codesUrl(EVT), { headers: ADMIN });
    const body = (await res.json()) as CodesBody;
    const spo = body.codes.find((c) => c.kind === 'sponsor')!;
    expect(spo.word).toBe('SPONSOR');
    expect(spo.target_url).toBe(SPONSOR_URL);
    expect(await follow(spo.code)).toBe(SPONSOR_URL);
  });

  for (const bad of [
    'javascript:alert(1)',
    'http://harborbocce.example.org/sponsor',
    'data:text/html,<script>alert(1)</script>',
    'harborbocce.example.org',
    '',
  ]) {
    test(`SPONSOR target ${JSON.stringify(bad)} → 400 INVALID_TARGET, nothing written`, async () => {
      const before = await SELF.fetch(codesUrl(EVT), { headers: ADMIN }).then(
        (r) => r.json() as Promise<CodesBody>
      );
      const { status, body } = await putCodes({ codes: [{ kind: 'sponsor', target_url: bad }] });
      expect(status).toBe(400);
      expect(body.code).toBe('INVALID_TARGET');
      const after = await SELF.fetch(codesUrl(EVT), { headers: ADMIN }).then(
        (r) => r.json() as Promise<CodesBody>
      );
      expect(after.codes.map((c) => [c.kind, c.target_url])).toEqual(
        before.codes.map((c) => [c.kind, c.target_url])
      );
    });
  }

  test('the poster bundle prints both with their word (never /q/)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v2/events/${EVT}/poster-bundle`);
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      slots: Array<{ kind: string; word: string; uec: { id: string }; url: string }>;
    };
    const byKind = Object.fromEntries(bundle.slots.map((s) => [s.kind, s]));
    expect(byKind.register).toMatchObject({ word: 'REGISTER', uec: { id: 'ENTER' } });
    expect(byKind.sponsor).toMatchObject({ word: 'SPONSOR', uec: { id: 'SPONSOR' } });
    for (const s of bundle.slots) expect(s.url).toMatch(/\/s\/[A-Za-z0-9]{6}$/);
  });
});

// ── Tier 2 — at the venue vs in the community ────────────────────────────────

describe('Tier 2 | placements: venue areas and community places', () => {
  let venueId = '';
  let communityId = '';

  beforeAll(async () => {
    const v = await createPd(EVT, { placement_label: 'Front door', placement_type: 'venue' });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    venueId = String(v.body.id);
    const c = await createPd(EVT, {
      placement_label: 'Harbor Library',
      location_desc: 'Community board by the entrance',
      address: '100 Library Ln, Sawyer, MI',
      latitude: 41.88,
      longitude: -86.6,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    communityId = String(c.body.id);
    await seedScans(EVT, venueId, 5);
    await seedScans(EVT, communityId, 3);
  });

  test('a venue area takes the event’s own address and map spot (organizer-entered, never a device)', async () => {
    const row = await tenv()
      .DB.prepare(
        'SELECT placement_type, address, latitude, longitude, h3_res9 FROM poster_deployments WHERE id = ?'
      )
      .bind(venueId)
      .first<{
        placement_type: string;
        address: string;
        latitude: number;
        longitude: number;
        h3_res9: string | null;
      }>();
    expect(row).toMatchObject({
      placement_type: 'venue',
      address: VENUE_ADDRESS,
      latitude: 41.8837,
      longitude: -86.5922,
    });
    expect(row!.h3_res9).toMatch(/^89[0-9a-f]{13}$/);
  });

  test('a venue area may name its own address; omitting the type means community', async () => {
    const own = await createPd(EVT, {
      placement_label: 'Stage left',
      placement_type: 'venue',
      address: 'Pavilion B',
    });
    expect(own.body).toMatchObject({ placement_type: 'venue', address: 'Pavilion B' });
    const row = await tenv()
      .DB.prepare('SELECT placement_type FROM poster_deployments WHERE id = ?')
      .bind(communityId)
      .first<{ placement_type: string }>();
    expect(row?.placement_type).toBe('community');
    await tenv().DB.prepare('DELETE FROM poster_deployments WHERE id = ?').bind(own.body.id).run();
  });

  test('fat-finger: an unknown placement type → 400; a venue area for an unknown event → 404', async () => {
    const bad = await createPd(EVT, { placement_label: 'Roof', placement_type: 'moon' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_PLACEMENT_TYPE');
    const none = await createPd('evt-does-not-exist-0930', {
      placement_label: 'Bar',
      placement_type: 'venue',
    });
    expect(none.status).toBe(404);
    const upd = await SELF.fetch(`${ORIGIN}/api/v2/admin/poster-deployments/${communityId}`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify({ placement_type: 'attic' }),
    });
    expect(upd.status).toBe(400);
  });

  test('the database refuses any third value (CHECK constraint)', async () => {
    await expect(
      tenv()
        .DB.prepare(
          `INSERT INTO poster_deployments (id, event_id, qr_token, placement_type)
           VALUES ('pd-tiers-check', ?, 'qrt-tiers-check', 'backyard')`
        )
        .bind(EVT)
        .run()
    ).rejects.toThrow(/CHECK/i);
  });

  // Both posters' scans are in one hour: the venue's 5 clear the floor, the
  // community poster's 3 do not (OSE-1656: withheld, like none).
  test('the list carries each placement’s type and its floored scan count', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${EVT}/poster-deployments`, {
      headers: ADMIN,
    });
    const body = (await res.json()) as {
      items: Array<{ id: string; placement_type: string; scans: unknown }>;
    };
    const byId = Object.fromEntries(body.items.map((i) => [i.id, i]));
    expect(byId[venueId]).toMatchObject({ placement_type: 'venue', scans: shown(5) });
    expect(byId[communityId]).toMatchObject({ placement_type: 'community', scans: HELD });
  });

  test('a real /q/ scan lands on its own placement’s count, and nowhere else', async () => {
    const tok = await tenv()
      .DB.prepare('SELECT qr_token FROM poster_deployments WHERE id = ?')
      .bind(communityId)
      .first<{ qr_token: string }>();
    const scan = await SELF.fetch(`${ORIGIN}/q/${tok!.qr_token}`, { redirect: 'manual' });
    expect(scan.status).toBe(302);
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${EVT}/poster-deployments`, {
      headers: ADMIN,
    });
    const body = (await res.json()) as { items: Array<{ id: string; scans: unknown }> };
    const byId = Object.fromEntries(body.items.map((i) => [i.id, i.scans]));
    // The scan landed on the community poster and nowhere else...
    const rows = async (pd: string) =>
      (
        await tenv()
          .DB.prepare(
            'SELECT COUNT(*) AS n FROM scan_placement_events WHERE poster_deployment_id = ?'
          )
          .bind(pd)
          .first<{ n: number }>()
      )?.n;
    expect(await rows(communityId)).toBe(4);
    expect(await rows(venueId)).toBe(5);
    // ...and 3 to 4 at a poster under the floor moves nothing anyone reads.
    expect(byId[communityId]).toEqual(HELD);
    expect(byId[venueId]).toEqual(shown(5));
  });

  test('a PUT can move a placement between venue and community', async () => {
    const put = await SELF.fetch(`${ORIGIN}/api/v2/admin/poster-deployments/${communityId}`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify({ placement_type: 'venue' }),
    });
    expect(put.status).toBe(200);
    const get = await SELF.fetch(`${ORIGIN}/api/v2/admin/poster-deployments/${communityId}`, {
      headers: ADMIN,
    });
    expect(((await get.json()) as { item: { placement_type: string } }).item.placement_type).toBe(
      'venue'
    );
    await SELF.fetch(`${ORIGIN}/api/v2/admin/poster-deployments/${communityId}`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify({ placement_type: 'community' }),
    });
  });
});

// ── Tier 3 — the reach picture ───────────────────────────────────────────────

interface Floored {
  count: number | null;
  suppressed: boolean;
  floor: number;
}
interface Reach {
  venue: {
    scans: Floored;
    places: number;
    placements: Array<{ id: string; label: string; scans: Floored; active: boolean }>;
  };
  community: {
    scans: Floored;
    places: number;
    placements: Array<{
      id: string;
      label: string;
      description: string | null;
      address: string | null;
      scans: Floored;
    }>;
  };
  taps: {
    total: Floored;
    codes: Array<Record<string, unknown> & { taps: Floored }>;
    other: { codes: number; taps: Floored } | null;
  };
  totals: { scans: Floored; taps: Floored };
}

const shown = (n: number): Floored => ({ count: n, suppressed: false, floor: 5 });
const HELD: Floored = { count: null, suppressed: true, floor: 5 };

describe('Tier 3 | reach: placements ranked by scans, venue vs community, taps per code', () => {
  let reach: Reach;
  let raw = '';

  beforeAll(async () => {
    const ids: Record<string, string> = {};
    for (const [label, type, n, extra] of [
      ['Bar', 'venue', 11, {}],
      ['Front door', 'venue', 23, {}],
      ['Stage left', 'venue', 0, {}],
      [
        'Café',
        'community',
        4,
        { address: '5 Front St, Sawyer, MI', latitude: 41.9, longitude: -86.6 },
      ],
      [
        'Harbor Library',
        'community',
        9,
        { address: '100 Library Ln, Sawyer, MI', latitude: 41.88, longitude: -86.6 },
      ],
    ] as const) {
      const r = await createPd(EVT_REACH, {
        placement_label: label,
        ...(type === 'venue' ? { placement_type: 'venue' } : {}),
        ...extra,
      });
      expect(r.status).toBe(201);
      ids[label] = String(r.body.id);
      await seedScans(EVT_REACH, ids[label], n);
    }
    // A retired community poster with no scans drops out of the picture.
    const gone = await createPd(EVT_REACH, { placement_label: 'Old post office' });
    await SELF.fetch(`${ORIGIN}/api/v2/admin/poster-deployments/${gone.body.id}`, {
      method: 'DELETE',
      headers: ADMIN,
    });

    // Codes on the poster, then real taps through /s/ (the counter is the only signal).
    const put = await putCodes(
      {
        codes: [
          { kind: 'donation', target_url: 'https://give.example.org/bocce' },
          { kind: 'register' },
        ],
      },
      EVT_REACH
    );
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const byKind = Object.fromEntries(put.body.codes.map((c) => [c.kind, c.code]));
    for (const [kind, n] of [
      ['public', 12],
      ['donation', 6],
      ['register', 2],
    ] as const) {
      for (let i = 0; i < n; i++) await follow(byKind[kind]);
    }

    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${EVT_REACH}/pre-event-activity`, {
      headers: ADMIN,
    });
    expect(res.status).toBe(200);
    raw = await res.text();
    reach = (JSON.parse(raw) as { reach: Reach }).reach;
  });

  // Each poster's scans are in one hour, so a poster's figure is its own
  // count when it is 5 or more, and withheld otherwise (OSE-1656).
  test('venue areas, most-scanned first (an active area with none to show still shows)', () => {
    expect(reach.venue.placements.map((p) => [p.label, p.scans])).toEqual([
      ['Front door', shown(23)],
      ['Bar', shown(11)],
      ['Stage left', HELD],
    ]);
    expect(reach.venue.scans).toEqual(shown(34));
    expect(reach.venue.places).toBe(1); // every area shares the venue's res-7 cell
  });

  test('community places, most-scanned first, with their description/address; retired + unscanned drop out', () => {
    expect(reach.community.placements.map((p) => [p.label, p.scans])).toEqual([
      ['Harbor Library', shown(9)],
      ['Café', HELD],
    ]);
    expect(reach.community.placements[0].address).toBe('100 Library Ln, Sawyer, MI');
    // The café's 4 never joins the sum (it read 13, which gave the 4 back).
    expect(reach.community.scans).toEqual(shown(9));
    expect(reach.community.places).toBeGreaterThanOrEqual(1);
  });

  test('link taps per code, floored: a small code never joins a sum, so no figure gives it back', () => {
    // Raw: EVENT 12, DONATE 6, REGISTER 2. REGISTER (2) is under the floor and
    // joins no sum. DONATE, the smallest listed code, sits with it in "other
    // links" (so that group is never one code); the group's figure and the
    // total count only the codes that clear the floor: 6, and 12 + 6 = 18.
    // As raw sums they were 8 and 20, and each moved when REGISTER gained a tap.
    expect(reach.taps.codes.map((c) => [c.kind, c.word, c.taps.count])).toEqual([
      ['public', 'EVENT', 12],
    ]);
    expect(reach.taps.other).toEqual({
      codes: 2,
      taps: { count: 6, suppressed: false, floor: 5 },
    });
    expect(reach.taps.total).toEqual({ count: 18, suppressed: false, floor: 5 });
    expect(raw).not.toMatch(/"taps":\s*\{\s*"count":\s*2\b/);
    const shown = reach.taps.codes.reduce((t, c) => t + (c.taps.count ?? 0), 0);
    expect(reach.taps.total.count! - shown).toBe(reach.taps.other!.taps.count);
  });

  test('totals: scans and taps each floored on their own grain — and the card’s own totals agree', () => {
    expect(reach.totals).toEqual({ scans: shown(43), taps: shown(18) });
    expect(reach.totals).not.toHaveProperty('reach'); // scans + taps would un-floor taps
    const activity = (JSON.parse(raw) as { activity: { scans: Floored; clicks: Floored } })
      .activity;
    expect(activity.scans).toEqual(reach.totals.scans);
    expect(activity.clicks).toEqual(reach.totals.taps);
  });

  test('never who: a tap carries no location; nothing person-shaped anywhere in reach', () => {
    for (const c of reach.taps.codes)
      expect(Object.keys(c).sort()).toEqual(['kind', 'taps', 'word']);
    const json = JSON.stringify(reach);
    for (const banned of [
      'anonymous_id',
      'user_agent',
      'ua_hash',
      'ip',
      'country',
      'country_code',
      'email',
      'name',
      'lat',
      'lon',
      'latitude',
      'longitude',
      'h3_res9',
      'scan_bucket',
      'session',
    ]) {
      expect(json, banned).not.toMatch(new RegExp(`"${banned}"`));
    }
  });
});

describe('Tier 3 | floorTaps — K=5 at the finest grain, closed to subtraction', () => {
  const K = CORRIDOR_MAP_MIN_COUNT;
  const exposed = (f: ReturnType<typeof floorTaps>) => [
    ...f.codes.map((c) => c.taps),
    ...(f.other ? [f.other.taps] : []),
    f.total,
  ];

  test('K is the shared floor (5), not a local number', () => {
    expect(K).toBe(5);
  });

  test('every code under the floor: nothing listed, the group and total floored', () => {
    const f = floorTaps([
      { kind: 'public', taps: 3 },
      { kind: 'donation', taps: 1 },
    ]);
    expect(f.codes).toEqual([]);
    expect(f.other).toEqual({ codes: 2, taps: { count: null, suppressed: true, floor: 5 } });
    expect(f.total).toEqual({ count: null, suppressed: true, floor: 5 });
  });

  test('the subtraction case: a small code joins neither sum', () => {
    // EVENT 40, DONATE 3. A total of 43 moves to 44 when DONATE gains a tap,
    // and 43 beside a listed 40 is the 3. The 3 joins no sum: 40 it is.
    const f = floorTaps([
      { kind: 'public', taps: 40 },
      { kind: 'donation', taps: 3 },
    ]);
    expect(f.codes).toEqual([]);
    expect(f.other).toEqual({ codes: 2, taps: { count: 40, suppressed: false, floor: 5 } });
    expect(f.total).toEqual({ count: 40, suppressed: false, floor: 5 });
  });

  test('the reported case: 10, 2, 1 lists 10 with a total of 10, and one more withheld tap changes nothing', () => {
    const at = (checkin: number) =>
      floorTaps([
        { kind: 'public', taps: 10 },
        { kind: 'register', taps: 2 },
        { kind: 'checkin', taps: checkin },
      ]);
    expect(at(1).codes.map((c) => c.taps.count)).toEqual([10]);
    expect(at(1).other).toEqual({ codes: 2, taps: { count: null, suppressed: true, floor: 5 } });
    expect(at(1).total).toEqual({ count: 10, suppressed: false, floor: 5 });
    expect(at(2)).toEqual(at(1));
  });

  test('small codes never add up: 4 + 4 + 3 + 4 publishes no group figure and no total', () => {
    const f = floorTaps(
      [4, 4, 3, 4].map((taps, i) => ({
        kind: ['public', 'checkin', 'register', 'donation'][i]!,
        taps,
      }))
    );
    const none = { count: null, suppressed: true, floor: 5 };
    expect(f).toEqual({ codes: [], other: { codes: 4, taps: none }, total: none });
  });

  test('property: over many random mixes, every figure is a sum of counts at or above the floor, and none moves with a withheld code', () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    const kinds = ['public', 'checkin', 'register', 'donation', 'sponsor', 'signup'];
    let neighbours = 0;
    for (let run = 0; run < 400; run++) {
      const raw = kinds
        .slice(0, 1 + rnd(kinds.length))
        .map((kind) => ({ kind, taps: rnd(3) === 0 ? rnd(5) : rnd(30) }));
      const f = floorTaps(raw);
      for (const x of exposed(f)) {
        expect(x.count === null || x.count >= K, JSON.stringify(raw)).toBe(true);
        expect(x.suppressed).toBe(x.count === null);
      }
      // The codes not listed are never one lone code beside listed ones.
      const hidden = raw.filter((r) => !f.codes.some((c) => c.kind === r.kind));
      expect(f.other?.codes ?? 0, JSON.stringify(raw)).toBe(hidden.length);
      if (f.codes.length) expect(hidden.length, JSON.stringify(raw)).not.toBe(1);
      // Each sum is exactly the counts that clear the floor on their own.
      const clear = (rows: { taps: number }[]) =>
        rows.filter((r) => r.taps >= K).reduce((t, r) => t + r.taps, 0);
      expect(f.total.count ?? 0, JSON.stringify(raw)).toBe(clear(raw));
      expect(f.other?.taps.count ?? 0, JSON.stringify(raw)).toBe(clear(hidden));
      // So what subtraction gives is a figure that is published anyway.
      const listed = f.codes.reduce((t, c) => t + c.taps.count!, 0);
      expect((f.total.count ?? 0) - listed).toBe(f.other?.taps.count ?? 0);
      // One more tap on any code that stays under the floor: nothing changes.
      raw.forEach((r, i) => {
        if (r.taps + 1 >= K) return;
        const more = raw.map((x, j) => (j === i ? { ...x, taps: x.taps + 1 } : x));
        expect(floorTaps(more), JSON.stringify(raw)).toEqual(f);
        neighbours++;
      });
    }
    expect(neighbours).toBeGreaterThan(100);
  });
});

describe('never who — structural', () => {
  const src = (rel: string): string => {
    const files = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const hit = Object.entries(files).find(([k]) => k.split('\\').join('/').endsWith(rel));
    expect(hit, `${rel} must be in the source bundle`).toBeDefined();
    return hit![1].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  };

  test('the reach module reads only placements, scan_placement_events and the tap counter', () => {
    const code = src('/src/lib/poster-reach.ts');
    for (const banned of [
      'scan_node_returns',
      'anonymous_id',
      'request',
      '.cf',
      'CF-',
      'headers',
      'FORMS_DB',
      'navigator',
    ]) {
      expect(code, banned).not.toContain(banned);
    }
    // Scans are read through the one cell reader (OSE-1656), which reads
    // scan_placement_events and nothing person-shaped either.
    expect(code).toContain('readEventScanCells');
    expect(code).toContain('SUM(clicks)');
    const cells = src('/src/lib/scan-cells.ts');
    expect(cells).toContain('FROM scan_placement_events');
    for (const banned of ['scan_node_returns', 'anonymous_id', 'request', 'FORMS_DB']) {
      expect(cells, banned).not.toContain(banned);
    }
  });

  test('the sponsor surface does not read the organizer’s reach picture (stays floored)', () => {
    for (const rel of ['/src/handlers/sponsor-home.ts', '/src/lib/sponsor-home-render.ts']) {
      expect(src(rel), rel).not.toContain('poster-reach');
    }
  });
});
