/**
 * OSE-2012 — online or in person on every event (owner decision 2026-11-12,
 * showcase plan S13). `events.attendance_mode`, migration 0108.
 *
 * One section per rule the owner decided:
 *
 *   1. THE MIGRATION: every existing row becomes 'in_person'; nothing else in
 *      the row changes; the database refuses any other value. This is the dry
 *      run on staging-shaped rows that runs on every PR.
 *   2. REQUIRED ON CREATE: a create that does not name the mode is refused.
 *   3. THE PLACE RULE: in person and both need a place; online takes none. On
 *      create, and on any update that names the mode or the place.
 *   4. NO CELL, OFF THE MAP: an online event has no coordinates and no H3 cell,
 *      is never looked up, and the map endpoint never returns it.
 *   5. LINK ONLY: an online event is left out of /events, the landing page and
 *      the sitemap. Its own page still opens.
 *   6. ITS CODES STILL COUNT: a /q scan and a /s click on an online event are
 *      recorded like any other.
 *   7. THE BRAND API STILL RETURNS IT, with the mode.
 *   8. THE PROJECTION GAINED ONE FIELD, and the contract snapshot says so.
 *   9. NO MEETING LINK is stored or published.
 *  10. THE EVENT PAGE SAYS "Online", "In person" or "Online and in person",
 *      with one <h1>.
 *  11. place_kind (0106) IS LEFT ALONE.
 *  12. THE TWO DATABASES DO NOT CROSS: the mode lives in DB only.
 *
 * The staging layer is bruno/ose-api "18. Online or in person (OSE-2012)" and
 * tests/playwright/attendance-mode.spec.ts.
 *
 * @born-red OSE-2012 | method: each section was watched failing on a fault
 * planted in the code it guards (the list, fault by fault, is in the PR) |
 * date: 2026-11-13
 *
 * Runtime-bound (SELF.fetch, env.DB) → workers pool.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { handleCreateEvent, handleUpdateEvent, type EventsEnv } from '../src/handlers/events';
import { runEventPlaceBackfill, runPlaceKindBackfill } from '../src/lib/event-place';
import {
  ATTENDANCE_MODES,
  attendanceModeLabel,
  attendanceModeOf,
  isLinkOnly,
  withoutLinkOnly,
} from '../src/lib/attendance-mode';
import { PUBLIC_EVENT_COLUMNS, toPublicEvent } from '../src/lib/public-event-projection';
import {
  ALLOWED_IDENTIFIERS,
  BANNED_SCHEMA_TERMS,
  findBannedSchemaIdentifiers,
} from '../src/lib/schema-lexicon';
import snapshot from '../src/api-schema-snapshots/public-events.snapshot.json';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv & EventsEnv;
const KEYED = { ...(env as unknown as EventsEnv), GOOGLE_MAPS_API_KEY: 'test-maps-key' };
const ORIGIN = 'https://localhost';
const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
  'Sec-Fetch-Site': 'same-origin',
};
const AS_PERSON = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

// Eagles Hall, Blue Island IL: res-7 cell 872664544ffffff.
const EAGLES = { lat: 41.6573, lon: -87.6806 };
const EAGLES_RES7 = '872664544ffffff';

async function applyAll(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column') ||
        m.includes('already exists') ||
        m.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
  await E.DB.prepare("DELETE FROM events WHERE id LIKE 'evt-mode-%'").run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const post = (body: unknown, e: EventsEnv = E) =>
  handleCreateEvent(
    new Request(`${ORIGIN}/api/v2/admin/events`, {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify(body),
    }),
    e
  );

const put = (id: string, body: unknown, e: EventsEnv = E) =>
  handleUpdateEvent(
    new Request(`${ORIGIN}/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify(body),
    }),
    e,
    id
  );

interface Created {
  id: string;
  place: string;
  attendance_mode: string;
  shortcode: string | null;
}

let n = 0;
async function create(body: Record<string, unknown>, e: EventsEnv = E): Promise<Created> {
  const res = await post({ title: `Mode event ${++n}`, start_date: '2026-12-05', ...body }, e);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as Created;
}

async function refused(res: Response, code: string): Promise<void> {
  expect(res.status).toBe(400);
  expect(((await res.json()) as { code: string }).code).toBe(code);
}

const row = (id: string) =>
  E.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<Record<string, unknown>>();

/** A listed row: root brand, published, live, past its publish grace. */
async function seedListed(
  id: string,
  mode: string,
  o: { brand?: string; location?: string | null; cell?: boolean } = {}
): Promise<void> {
  const online = mode === 'online';
  const cell = o.cell ?? !online;
  await E.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await E.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from,
                         location, lat, lon, h3_res7, start_date, timezone,
                         attendance_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', 1, '2026-01-01T00:00:00.000Z',
             ?, ?, ?, ?, date('now', '+3 day'), 'America/Chicago',
             ?, datetime('now'), datetime('now'))`
  )
    .bind(
      id,
      o.brand ?? 'root',
      `Title of ${id}`,
      id,
      o.location === undefined ? (online ? null : 'Eagles Hall') : o.location,
      cell ? EAGLES.lat : null,
      cell ? EAGLES.lon : null,
      cell ? EAGLES_RES7 : null,
      mode
    )
    .run();
}

// ─── 1. The migration ─────────────────────────────────────────────────────────

describe('1. migration 0108: every existing event becomes in person', () => {
  const statement = (): string => {
    const mine = (JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]).filter((s) =>
      s.includes('attendance_mode')
    );
    expect(mine, 'migration 0108 is one ALTER TABLE').toHaveLength(1);
    expect(mine[0]).toMatch(/^\s*ALTER TABLE events ADD COLUMN attendance_mode\b/);
    return mine[0]!;
  };

  test('dry run: staging-shaped rows all read in_person, and nothing else in them changes', async () => {
    // The table as it stood before 0108, with the kinds of row staging holds:
    // a place by name, by address, by coordinates, and none at all; live,
    // draft and archived.
    await E.DB.prepare('DROP TABLE IF EXISTS dryrun_events').run();
    await E.DB.prepare(
      `CREATE TABLE dryrun_events (id TEXT PRIMARY KEY, status TEXT, location TEXT,
         where_address TEXT, lat REAL, lon REAL, h3_res7 TEXT, place_kind TEXT)`
    ).run();
    const before = [
      ['a', 'active', 'Rock Island Public House', null, 41.65, -87.68, EAGLES_RES7, 'business'],
      [
        'b',
        'active',
        null,
        '13328 Olde Western Ave, Blue Island, IL 60406',
        null,
        null,
        null,
        null,
      ],
      ['c', 'draft', null, null, null, null, null, null],
      ['d', 'archived', '', '', 41.65, -87.68, EAGLES_RES7, 'address'],
      ['e', 'ready', 'Somewhere', null, null, null, null, null],
    ];
    for (const r of before) {
      await E.DB.prepare('INSERT INTO dryrun_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(...r)
        .run();
    }

    await E.DB.prepare(
      statement().replace('ALTER TABLE events', 'ALTER TABLE dryrun_events')
    ).run();

    const after = await E.DB.prepare('SELECT * FROM dryrun_events ORDER BY id').all<
      Record<string, unknown>
    >();
    expect(after.results).toHaveLength(before.length);
    after.results.forEach((r, i) => {
      expect(r.attendance_mode, `row ${r.id}`).toBe('in_person');
      const { attendance_mode: _mode, ...rest } = r;
      expect(Object.values(rest), `row ${r.id} is otherwise as it was`).toEqual(before[i]);
    });
    await E.DB.prepare('DROP TABLE dryrun_events').run();
  });

  test('the column is NOT NULL, defaults to in_person, and takes only the three values', async () => {
    const col = await E.DB.prepare(
      "SELECT \"notnull\" AS nn, dflt_value AS dflt, type FROM pragma_table_info('events') WHERE name = 'attendance_mode'"
    ).first<{ nn: number; dflt: string; type: string }>();
    expect(col).toEqual({ nn: 1, dflt: "'in_person'", type: 'TEXT' });

    // A row written without the column (the stock seed, a fixture) is in person.
    await E.DB.prepare(
      "INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at) VALUES ('evt-mode-default', 'ose-mode', 'D', 'evt-mode-default', 'draft', datetime('now'), datetime('now'))"
    ).run();
    expect((await row('evt-mode-default'))!.attendance_mode).toBe('in_person');

    for (const bad of ['hybrid', 'virtual', 'ONLINE', '']) {
      await expect(
        E.DB.prepare('UPDATE events SET attendance_mode = ? WHERE id = ?')
          .bind(bad, 'evt-mode-default')
          .run(),
        `the database takes '${bad}'`
      ).rejects.toThrow(/CHECK constraint/);
    }
    await expect(
      E.DB.prepare("UPDATE events SET attendance_mode = NULL WHERE id = 'evt-mode-default'").run()
    ).rejects.toThrow(/NOT NULL constraint/);
  });

  test('the migration writes no row and names no other column', () => {
    const sql = statement();
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP)\b/i);
    expect(sql).not.toMatch(/place_kind|location|lat\b|lon\b|h3_/);
  });
});

// ─── 2. Required on create ────────────────────────────────────────────────────

describe('2. the create API requires the mode', () => {
  test('a create that does not name it is refused, and nothing is stored', async () => {
    const title = 'Mode missing sentinel';
    for (const body of [
      { title, location: 'Eagles Hall' },
      { title, location: 'Eagles Hall', attendance_mode: null },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { code: string; error: string };
      expect(json.code).toBe('MISSING_FIELD');
      expect(json.error).toContain('attendance_mode');
    }
    const stored = await E.DB.prepare('SELECT COUNT(*) AS c FROM events WHERE title = ?')
      .bind(title)
      .first<{ c: number }>();
    expect(stored!.c).toBe(0);
  });

  test('a value that is not one of the three is refused', async () => {
    for (const bad of ['hybrid', 'virtual', 'In_Person', '', 1, true, ['online']]) {
      await refused(
        await post({ title: 'Bad mode', location: 'Eagles Hall', attendance_mode: bad }),
        'INVALID_ATTENDANCE_MODE'
      );
    }
  });

  test('each of the three is stored as sent and echoed in the answer', async () => {
    for (const mode of ATTENDANCE_MODES) {
      const made = await create({
        attendance_mode: mode,
        ...(mode === 'online' ? {} : { location: 'Eagles Hall' }),
      });
      expect(made.attendance_mode).toBe(mode);
      expect((await row(made.id))!.attendance_mode).toBe(mode);
    }
  });
});

// ─── 3. The place rule ────────────────────────────────────────────────────────

describe('3. in person and both need a place; online takes none', () => {
  test('create: in person or both with no place is refused', async () => {
    for (const mode of ['in_person', 'both']) {
      for (const noPlace of [{}, { location: '   ' }, { where_address: '' }, { location: null }]) {
        await refused(
          await post({ title: 'No place', attendance_mode: mode, ...noPlace }),
          'LOCATION_REQUIRED'
        );
      }
    }
  });

  test('create: a place name, an address or coordinates each count as a place', async () => {
    for (const mode of ['in_person', 'both']) {
      for (const place of [
        { location: 'Eagles Hall' },
        { where_address: '2427 Grove St, Blue Island, IL 60406' },
        { lat: EAGLES.lat, lon: EAGLES.lon },
      ]) {
        await create({ attendance_mode: mode, ...place });
      }
    }
  });

  test('create: online with any place is refused, never trimmed to fit', async () => {
    for (const place of [
      { location: 'Eagles Hall' },
      { where_address: '2427 Grove St, Blue Island, IL 60406' },
      { lat: EAGLES.lat, lon: EAGLES.lon },
      { lat: EAGLES.lat },
    ]) {
      await refused(
        await post({ title: 'Online with a place', attendance_mode: 'online', ...place }),
        'LOCATION_NOT_ALLOWED'
      );
    }
  });

  test('update: an in-person event cannot give up its place', async () => {
    const { id } = await create({ attendance_mode: 'in_person', location: 'Eagles Hall' });
    await refused(await put(id, { location: null }), 'LOCATION_REQUIRED');
    await refused(await put(id, { location: '  ' }), 'LOCATION_REQUIRED');
    expect((await row(id))!.location).toBe('Eagles Hall');
    // Another kind of place in the same request is still a place.
    expect(
      (await put(id, { location: null, where_address: '2427 Grove St, Blue Island, IL' })).status
    ).toBe(200);
  });

  test('update: an online event cannot be given a place', async () => {
    const { id } = await create({ attendance_mode: 'online' });
    await refused(await put(id, { location: 'Eagles Hall' }), 'LOCATION_NOT_ALLOWED');
    await refused(await put(id, { where_address: '2427 Grove St' }), 'LOCATION_NOT_ALLOWED');
    await refused(await put(id, { lat: EAGLES.lat, lon: EAGLES.lon }), 'LOCATION_NOT_ALLOWED');
    const r = (await row(id))!;
    expect([r.location, r.where_address, r.lat, r.lon, r.h3_res7]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test('update: changing the mode is checked against the place the event would have', async () => {
    const { id } = await create({ attendance_mode: 'in_person', location: 'Eagles Hall' });
    // To online while the place is still there: refused.
    await refused(await put(id, { attendance_mode: 'online' }), 'LOCATION_NOT_ALLOWED');
    expect((await row(id))!.attendance_mode).toBe('in_person');
    // To online with the place cleared in the same request: saved.
    const ok = await put(id, { attendance_mode: 'online', location: null });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { attendance_mode: string }).attendance_mode).toBe('online');
    // Back to in person with no place: refused. With one: saved.
    await refused(await put(id, { attendance_mode: 'in_person' }), 'LOCATION_REQUIRED');
    await refused(await put(id, { attendance_mode: 'both' }), 'LOCATION_REQUIRED');
    expect((await put(id, { attendance_mode: 'both', location: 'Eagles Hall' })).status).toBe(200);
    expect((await row(id))!.attendance_mode).toBe('both');
  });

  test('update: the mode cannot be cleared or set to anything else', async () => {
    const { id } = await create({ attendance_mode: 'in_person', location: 'Eagles Hall' });
    for (const bad of [null, '', 'hybrid', 0]) {
      await refused(await put(id, { attendance_mode: bad }), 'INVALID_ATTENDANCE_MODE');
    }
    expect((await row(id))!.attendance_mode).toBe('in_person');
  });

  test('update: an older event with no place still takes an edit that names neither mode nor place', async () => {
    await E.DB.prepare(
      "INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at) VALUES ('evt-mode-old', 'ose-mode', 'Old', 'evt-mode-old', 'draft', datetime('now'), datetime('now'))"
    ).run();
    expect((await put('evt-mode-old', { title: 'Old, renamed' })).status).toBe(200);
    // The next edit that names the mode or the place must settle it.
    await refused(await put('evt-mode-old', { attendance_mode: 'in_person' }), 'LOCATION_REQUIRED');
    expect((await put('evt-mode-old', { attendance_mode: 'online' })).status).toBe(200);
  });
});

// ─── 4. No cell, off the map ──────────────────────────────────────────────────

describe('4. an online event has no place at all: no coordinates, no cell, off the map', () => {
  const PLACE_COLUMNS = [
    'location',
    'where_address',
    'lat',
    'lon',
    'h3_res9',
    'h3_res7',
    'place_kind',
    'place_checked_at',
  ];
  const placeOf = async (id: string) => {
    const r = (await row(id))!;
    return PLACE_COLUMNS.map((c) => r[c]);
  };
  const NONE = PLACE_COLUMNS.map(() => null);

  test('create: nothing is looked up and no cell is written, even with the lookup set up', async () => {
    const asked = vi.spyOn(globalThis, 'fetch');
    const made = await create({ attendance_mode: 'online', location: '  ' }, KEYED);
    expect(made.place).toBe('no_place');
    expect(asked, 'an online event sent a place lookup').not.toHaveBeenCalled();
    expect(await placeOf(made.id)).toEqual(NONE);
  });

  test('update: an event turned online loses its point, both cells and its kind', async () => {
    const { id } = await create({
      attendance_mode: 'in_person',
      location: 'Eagles Hall',
      ...EAGLES,
    });
    await E.DB.prepare(
      "UPDATE events SET place_kind = 'business', place_checked_at = '2026-11-01T00:00:00Z' WHERE id = ?"
    )
      .bind(id)
      .run();
    expect((await row(id))!.h3_res7).toBe(EAGLES_RES7);

    const res = await put(id, { attendance_mode: 'online', location: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { place: string }).place).toBe('no_place');
    expect(await placeOf(id)).toEqual(NONE);
  });

  test('update: an event placed by coordinates alone loses them when it turns online', async () => {
    // No place text to clear, so nothing but the mode changes in the request:
    // the point and both cells must still go.
    const { id } = await create({ attendance_mode: 'in_person', ...EAGLES });
    await E.DB.prepare("UPDATE events SET place_kind = 'address' WHERE id = ?").bind(id).run();
    expect((await row(id))!.h3_res7).toBe(EAGLES_RES7);

    const res = await put(id, { attendance_mode: 'online' });
    expect(res.status).toBe(200);
    expect(await placeOf(id)).toEqual(NONE);
  });

  test('update: place text sent blank with "online" is stored as no place, not as an empty string', async () => {
    const { id } = await create({
      attendance_mode: 'both',
      location: 'Eagles Hall',
      where_address: '2427 Grove St, Blue Island, IL 60406',
    });
    const res = await put(id, {
      title: 'Now online',
      attendance_mode: 'online',
      location: '   ',
      where_address: '',
    });
    expect(res.status).toBe(200);
    expect(await placeOf(id)).toEqual(NONE);
    expect((await row(id))!.title).toBe('Now online');
  });

  test('the nightly place jobs never give an online event a place', async () => {
    // A row the API would refuse, written directly: online, with place text.
    await E.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, attendance_mode, start_date, created_at, updated_at)
       VALUES ('evt-mode-nightly', 'ose-mode', 'N', 'evt-mode-nightly', 'active', 'Rock Island Public House', 'online', date('now', '+3 day'), datetime('now'), datetime('now'))`
    ).run();
    const google = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'OK',
            results: [
              {
                geometry: { location: { lat: EAGLES.lat, lng: EAGLES.lon } },
                types: ['establishment'],
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
    );
    await runEventPlaceBackfill(KEYED, google as unknown as typeof fetch);
    await runPlaceKindBackfill(KEYED, 50, google as unknown as typeof fetch);
    const r = (await row('evt-mode-nightly'))!;
    expect([r.lat, r.lon, r.h3_res7, r.h3_res9, r.place_kind]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    await E.DB.prepare("DELETE FROM events WHERE id = 'evt-mode-nightly'").run();
  });

  test('the map endpoint returns the in-person event in a cell and never the online one', async () => {
    await seedListed('evt-mode-map-inperson', 'in_person');
    await seedListed('evt-mode-map-both', 'both');
    await seedListed('evt-mode-map-online', 'online');
    // A row the API would never write: online, and still carrying a cell. The
    // map goes by the mode, not by the cell having been cleared.
    await seedListed('evt-mode-map-online-cell', 'online', { cell: true });
    const res = await SELF.fetch(`${ORIGIN}/api/v2/events/map?cell=${EAGLES_RES7}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('evt-mode-map-inperson');
    expect(text).toContain('evt-mode-map-both');
    expect(text).not.toContain('evt-mode-map-online');
  });
});

// ─── 5. Link only ─────────────────────────────────────────────────────────────

describe('5. an online event is link only: off /events, the landing page and the sitemap', () => {
  beforeAll(async () => {
    await seedListed('evt-mode-list-inperson', 'in_person');
    await seedListed('evt-mode-list-both', 'both');
    await seedListed('evt-mode-list-online', 'online');
    // The case a missing place could never catch: an online row that (wrongly)
    // still carries a cell. The rule is the mode, not the absence of a cell.
    await seedListed('evt-mode-list-online-cell', 'online', { cell: true });
  });

  const expectLinkOnly = (body: string, where: string) => {
    expect(body, `${where} lost the in-person event`).toContain('evt-mode-list-inperson');
    expect(body, `${where} lost the both event`).toContain('evt-mode-list-both');
    expect(body, `${where} lists an online event`).not.toContain('evt-mode-list-online');
    expect(body, `${where} names an online event`).not.toContain('Title of evt-mode-list-online');
  };

  test('/events', async () => {
    const res = await SELF.fetch(`${ORIGIN}/events`, { headers: AS_PERSON });
    expect(res.status).toBe(200);
    expectLinkOnly(await res.text(), '/events');
  });

  test('the landing page, in its list and its map', async () => {
    for (const path of ['/', '/?view=list', `/?area=${EAGLES_RES7}`]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: AS_PERSON });
      expect(res.status, path).toBe(200);
      const body = await res.text();
      expect(body, `${path} lists an online event`).not.toContain('evt-mode-list-online');
      expect(body, `${path} names an online event`).not.toContain('Title of evt-mode-list-online');
    }
    const list = await (await SELF.fetch(`${ORIGIN}/?view=list`, { headers: AS_PERSON })).text();
    expect(list).toContain('evt-mode-list-inperson');
  });

  test('the sitemap', async () => {
    const { handleSitemapXml } = await import('../src/lib/crawl-policy');
    const res = await handleSitemapXml(new Request('https://oursharedevents.com/sitemap.xml'), {
      DB: E.DB,
      WORKER_ENV: 'production',
    } as never);
    expect(res.status).toBe(200);
    expectLinkOnly(await res.text(), 'the sitemap');
  });

  test('its own page still opens, for anyone with the link', async () => {
    const res = await SELF.fetch(`${ORIGIN}/events/evt-mode-list-online`, { headers: AS_PERSON });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Title of evt-mode-list-online');
  });

  test('the one rule the surfaces share', () => {
    expect(isLinkOnly({ attendance_mode: 'online' })).toBe(true);
    for (const v of ['in_person', 'both', undefined, null, 'hybrid']) {
      expect(isLinkOnly({ attendance_mode: v }), String(v)).toBe(false);
    }
    expect(
      withoutLinkOnly([
        { id: 1, attendance_mode: 'online' },
        { id: 2, attendance_mode: 'both' },
        { id: 3 },
      ]).map((r) => r.id)
    ).toEqual([2, 3]);
  });
});

// ─── 6. Its codes still count ─────────────────────────────────────────────────

describe('6. an online event’s /q and /s codes still count', () => {
  test('a /s click is counted', async () => {
    const made = await create({ attendance_mode: 'online' });
    expect(made.shortcode, 'an online event gets its short link').toBeTruthy();
    const click = await SELF.fetch(`${ORIGIN}/s/${made.shortcode}`, {
      redirect: 'manual',
      headers: AS_PERSON,
    });
    expect(click.status).toBe(302);
    const link = await E.DB.prepare('SELECT clicks FROM shortlinks WHERE code = ?')
      .bind(made.shortcode)
      .first<{ clicks: number }>();
    expect(link!.clicks).toBe(1);
  });

  test('a /q scan of a placement is recorded, and the placement is a community one', async () => {
    const made = await create({ attendance_mode: 'online' });
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${made.id}/poster-deployments`, {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({ placement_label: 'Clip link' }),
    });
    expect(res.status).toBe(201);
    const dep = (await res.json()) as { id: string; qr_token: string; placement_type: string };
    expect(dep.placement_type).toBe('community');

    const scan = await SELF.fetch(`${ORIGIN}/q/${dep.qr_token}`, {
      redirect: 'manual',
      headers: AS_PERSON,
    });
    expect(scan.status).toBe(302);
    const counted = await E.DB.prepare(
      'SELECT COUNT(*) AS c FROM scan_placement_events WHERE poster_deployment_id = ?'
    )
      .bind(dep.id)
      .first<{ c: number }>();
    expect(counted!.c).toBe(1);
    // Counting it gave the event no place.
    const r = (await row(made.id))!;
    expect([r.lat, r.lon, r.h3_res7, r.h3_res9]).toEqual([null, null, null, null]);
  });
});

// ─── 7. The brand API still returns it ────────────────────────────────────────

describe('7. the brand API returns online events, with the mode', () => {
  test('GET /api/v2/events?brand= lists all three modes', async () => {
    const BRAND = 'ose-mode-brand';
    await seedListed('evt-mode-api-inperson', 'in_person', { brand: BRAND });
    await seedListed('evt-mode-api-online', 'online', { brand: BRAND });
    await seedListed('evt-mode-api-both', 'both', { brand: BRAND });
    const res = await SELF.fetch(`${ORIGIN}/api/v2/events?brand=${BRAND}`);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: Record<string, unknown>[] };
    const modes = Object.fromEntries(items.map((i) => [i.id, i.attendance_mode]));
    expect(modes).toEqual({
      'evt-mode-api-inperson': 'in_person',
      'evt-mode-api-online': 'online',
      'evt-mode-api-both': 'both',
    });
    const online = items.find((i) => i.id === 'evt-mode-api-online')!;
    expect([online.location, online.lat, online.lon, online.h3_res7, online.venue]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test('GET /api/v2/events/:id carries the mode too', async () => {
    await seedListed('evt-mode-api-one', 'online', { brand: 'ose-mode-brand' });
    const res = await SELF.fetch(`${ORIGIN}/api/v2/events/evt-mode-api-one`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { item: { attendance_mode: string } }).item.attendance_mode).toBe(
      'online'
    );
  });
});

// ─── 8. The projection gained one field ───────────────────────────────────────

describe('8. the public projection gained attendance_mode and nothing else', () => {
  // The allowlist as it stood before this story (snapshot v1.3.0), by hand.
  const BEFORE = [
    'brand_id',
    'corridor_id',
    'cover_image_url',
    'created_at',
    'description',
    'end_date',
    'h3_res7',
    'how_details',
    'id',
    'lat',
    'legal_clearance_tier',
    'location',
    'lon',
    'slug',
    'start_date',
    'starts_at',
    'status',
    'timezone',
    'title',
    'updated_at',
    'what_short',
    'where_address',
    'who_host',
    'why_purpose',
  ];

  test('the allowlist is the old list plus the one field', () => {
    expect([...PUBLIC_EVENT_COLUMNS].sort()).toEqual([...BEFORE, 'attendance_mode'].sort());
  });

  test('the contract snapshot is v1.5.0 and lists the same columns on both endpoints', () => {
    expect(snapshot.version).toBe('1.5.0');
    for (const endpoint of ['GET /api/v2/events', 'GET /api/v2/events/:id'] as const) {
      expect(snapshot.endpoints[endpoint].projected_columns, endpoint).toEqual(
        [...PUBLIC_EVENT_COLUMNS].sort()
      );
    }
  });

  test('a row passes the mode through and nothing new beside it', () => {
    const out = toPublicEvent({
      id: 'e',
      attendance_mode: 'online',
      meeting_url: 'https://meet.example/abc',
      join_url: 'https://meet.example/abc',
      place_kind: 'business',
    });
    expect(out).toEqual({ id: 'e', attendance_mode: 'online' });
  });
});

// ─── 9. No meeting link ───────────────────────────────────────────────────────

describe('9. no meeting link is stored or published', () => {
  const LINKISH = /meet|join|stream|zoom|webinar|conference|call_url|online_url|virtual/i;

  test('no column in either database could hold one', async () => {
    for (const db of [E.DB, E.FORMS_DB]) {
      const cols = await db
        .prepare(
          `SELECT m.name AS tbl, p.name AS col FROM sqlite_master m, pragma_table_info(m.name) p
            WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'`
        )
        .all<{ tbl: string; col: string }>();
      expect(cols.results.length).toBeGreaterThan(50);
      for (const { tbl, col } of cols.results) {
        expect(col, `${tbl}.${col} looks like a meeting link`).not.toMatch(LINKISH);
      }
    }
  });

  test('a link sent on create or update is not kept, and no answer carries it', async () => {
    const SECRET = 'https://meet.example/secret-room-91';
    const sent = { meeting_url: SECRET, join_url: SECRET, online_url: SECRET, stream_url: SECRET };
    const made = await create({ attendance_mode: 'online', status: 'active', ...sent });
    await E.DB.prepare(
      "UPDATE events SET is_published = 1, listed_from = '2026-01-01T00:00:00.000Z', brand_id = 'ose-mode-link' WHERE id = ?"
    )
      .bind(made.id)
      .run();
    expect((await put(made.id, { title: 'Still online', ...sent })).status).toBe(200);

    expect(JSON.stringify(await row(made.id))).not.toContain('secret-room-91');
    for (const path of [
      `/api/v2/events/${made.id}`,
      '/api/v2/events?brand=ose-mode-link',
      `/events/${made.id}`,
      `/api/v2/admin/events/${made.id}`,
    ]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: { ...ADMIN, ...AS_PERSON } });
      expect(await res.text(), path).not.toContain('secret-room-91');
    }
  });
});

// ─── 10. The event page ───────────────────────────────────────────────────────

describe('10. the event page says how people take part', () => {
  const LABELS = {
    in_person: 'In person',
    online: 'Online',
    both: 'Online and in person',
  } as const;

  test('each mode shows its label once, in the Where card, on a page with one <h1>', async () => {
    for (const mode of ATTENDANCE_MODES) {
      const id = `evt-mode-page-${mode.replace('_', '')}`;
      await seedListed(id, mode);
      const res = await SELF.fetch(`${ORIGIN}/events/${id}`, { headers: AS_PERSON });
      expect(res.status, mode).toBe(200);
      const html = await res.text();
      const lines = [
        ...html.matchAll(/<span data-testid="event-mode" data-mode="([a-z_]+)">([^<]*)<\/span>/g),
      ];
      expect(lines, `${mode}: one mode line`).toHaveLength(1);
      expect([lines[0]![1], lines[0]![2]]).toEqual([mode, LABELS[mode]]);
      expect(html.match(/<h1[\s>]/g) ?? [], `${mode}: one <h1>`).toHaveLength(1);
      // The line sits inside the Where card.
      const where = html.slice(html.indexOf('data-testid="event-where'));
      expect(where.indexOf('event-mode')).toBeGreaterThan(-1);
      expect(where.indexOf('event-mode')).toBeLessThan(where.indexOf('</section>'));
    }
  });

  test('with a place, the label and the place name share one line; online has the label alone', async () => {
    // One line, so a page with a place is no taller than it was and its main
    // action stays above the fold (the workability audit measures that).
    await seedListed('evt-mode-page-line', 'both');
    const html = await (
      await SELF.fetch(`${ORIGIN}/events/evt-mode-page-line`, { headers: AS_PERSON })
    ).text();
    expect(html).toMatch(
      /<p><span data-testid="event-mode" data-mode="both">Online and in person<\/span> · <strong>[^<]*(<[^>]+>)?Eagles Hall/
    );

    await seedListed('evt-mode-page-line-online', 'online');
    const online = await (
      await SELF.fetch(`${ORIGIN}/events/evt-mode-page-line-online`, { headers: AS_PERSON })
    ).text();
    expect(online).toContain(
      '<p><span data-testid="event-mode" data-mode="online">Online</span></p>'
    );
  });

  test('an online event’s page shows no place, no map and no directions', async () => {
    await seedListed('evt-mode-page-noplace', 'online');
    const html = await (
      await SELF.fetch(`${ORIGIN}/events/evt-mode-page-noplace`, { headers: AS_PERSON })
    ).text();
    expect(html).not.toContain('data-testid="venue-map"');
    expect(html).not.toMatch(/data-testid="[^"]*directions/);
    expect(html).not.toContain('Eagles Hall');
  });

  test('the label is written in the page’s language, and has no markup or colour of its own', async () => {
    await seedListed('evt-mode-page-es', 'both');
    const html = await (
      await SELF.fetch(`${ORIGIN}/es/events/evt-mode-page-es`, { headers: AS_PERSON })
    ).text();
    expect(html).toContain('data-mode="both">En línea y presencial</span>');
    for (const lang of ['en', 'es', 'pl', 'ar'] as const) {
      for (const mode of ATTENDANCE_MODES) {
        const label = attendanceModeLabel(mode, lang);
        expect(label.length, `${lang} ${mode}`).toBeGreaterThan(3);
        expect(label).not.toMatch(/[<>&"]/);
      }
      expect(new Set(ATTENDANCE_MODES.map((m) => attendanceModeLabel(m, lang))).size).toBe(3);
    }
    expect(html).not.toMatch(/event-mode"[^>]*style=/);
  });

  test('the page never prints the word the lexicon bans, in any mode or phase', async () => {
    // "attendance" claims a number of people (OSE-1201). The field's own name
    // is the one allowed use; it stays out of every rendered page.
    for (const mode of ATTENDANCE_MODES) {
      const id = `evt-mode-lex-${mode.replace('_', '')}`;
      await seedListed(id, mode);
      for (const start of ["date('now', '+3 day')", "date('now')", "date('now', '-9 day')"]) {
        await E.DB.prepare(
          `UPDATE events SET start_date = ${start}, end_date = ${start} WHERE id = ?`
        )
          .bind(id)
          .run();
        const html = await (
          await SELF.fetch(`${ORIGIN}/events/${id}`, { headers: AS_PERSON })
        ).text();
        expect(html, `${mode} ${start}`).toContain('data-testid="event-mode"');
        expect(html, `${mode} ${start}`).not.toMatch(/attendance/i);
      }
    }
  });

  test('a value that is not a mode reads as in person', () => {
    for (const v of [undefined, null, '', 'hybrid', 3]) {
      expect(attendanceModeOf(v)).toBe('in_person');
    }
  });
});

// ─── The name and the lexicon ─────────────────────────────────────────────────

describe('the lexicon lint allows this one name and nothing near it', () => {
  test('attendance_mode is the only allowed identifier, by exact match', () => {
    expect([...ALLOWED_IDENTIFIERS.keys()]).toEqual(['attendance_mode']);
    const col = (name: string) => ({ kind: 'column', name, table: 'events' });
    expect(findBannedSchemaIdentifiers([col('attendance_mode')])).toEqual([]);
    for (const name of [
      'attendance',
      'attendance_count',
      'attendance_mode_total',
      'total_attendance',
      'attendanceMode',
      'attendance_modes',
      'idx_events_attendance',
    ]) {
      expect(findBannedSchemaIdentifiers([col(name)]), name).toHaveLength(1);
    }
    expect(BANNED_SCHEMA_TERMS.has('attendance'), 'the word is still banned').toBe(true);
  });

  test('the column can only ever hold a word: the database refuses a number', async () => {
    await E.DB.prepare(
      "INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at) VALUES ('evt-mode-word', 'ose-mode', 'W', 'evt-mode-word', 'draft', datetime('now'), datetime('now'))"
    ).run();
    for (const n of [0, 4, 250, '37']) {
      await expect(
        E.DB.prepare("UPDATE events SET attendance_mode = ? WHERE id = 'evt-mode-word'")
          .bind(n)
          .run()
      ).rejects.toThrow(/CHECK constraint/);
    }
  });
});

// ─── 11. place_kind is left alone ─────────────────────────────────────────────

describe('11. place_kind (0106) stays as it is', () => {
  test('changing in person to both keeps the place, its cell and its kind', async () => {
    const { id } = await create({
      attendance_mode: 'in_person',
      location: 'Eagles Hall',
      ...EAGLES,
    });
    await E.DB.prepare("UPDATE events SET place_kind = 'business' WHERE id = ?").bind(id).run();
    const before = (await row(id))!;
    expect((await put(id, { attendance_mode: 'both' })).status).toBe(200);
    const after = (await row(id))!;
    for (const c of ['location', 'lat', 'lon', 'h3_res7', 'h3_res9', 'place_kind']) {
      expect(after[c], c).toEqual(before[c]);
    }
    expect(after.place_kind).toBe('business');
    expect(after.attendance_mode).toBe('both');
  });

  test('place_kind still takes only what the place lookup writes, and is not published', async () => {
    expect(PUBLIC_EVENT_COLUMNS as readonly string[]).not.toContain('place_kind');
    const col = await E.DB.prepare(
      "SELECT \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('events') WHERE name = 'place_kind'"
    ).first<{ nn: number; dflt: string | null }>();
    expect(col).toEqual({ nn: 0, dflt: null });
  });
});

// ─── 12. The two databases do not cross ───────────────────────────────────────

describe('12. the mode lives in the anonymous database only', () => {
  test('FORMS_DB has no attendance_mode column, and no forms migration names it', async () => {
    const cols = await E.FORMS_DB.prepare(
      `SELECT m.name AS tbl FROM sqlite_master m, pragma_table_info(m.name) p
        WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'
          AND p.name = 'attendance_mode'`
    ).all<{ tbl: string }>();
    expect(cols.results).toEqual([]);
    expect(E.TEST_FORMS_MIGRATION_STATEMENTS).not.toContain('attendance_mode');
    const inDb = await E.DB.prepare(
      `SELECT m.name AS tbl FROM sqlite_master m, pragma_table_info(m.name) p
        WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'
          AND p.name = 'attendance_mode'`
    ).all<{ tbl: string }>();
    expect(inDb.results.map((r) => r.tbl)).toEqual(['events']);
  });
});
