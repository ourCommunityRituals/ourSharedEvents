/**
 * W1 (OSE-2095; owner 2026-11-16): the ZIP at the Where step, stored on the
 * event, and zip and town search that reads it.
 *
 * The rule: the zip finds an event; only the organizer's tap on our own map
 * places it. A zip is never turned into a stored cell, so an event found by its
 * zip alone still has no h3_res7 and lights no hexagon.
 *
 *   1. STORE: create and update take `zip_code` (five digits; ZIP+4 keeps five),
 *      refuse a malformed one with INVALID_ZIP_CODE, store none for an online
 *      event (and clear it when an event turns online). A zip the Census table
 *      lacks still saves, and the answer says so.
 *   2. SEARCH: a listed event with no cell is found by `/?zip=`, `/?where=<town>`
 *      and `/events?q=` under its own zip and under no other. The box wins over
 *      the address. An event with a cell keeps today's rule.
 *   3. NOT PUBLISHED: the public list and the brand API carry no zip.
 *   4. REPEAT copies it.
 *
 * The staging layer is bruno/ose-api "19. The ZIP at the Where step (W1)" and
 * tests/playwright/where-step-zip.spec.ts.
 *
 * @born-red event-zip | method: (1) the no-cell branch in inZipsOwnArea put back
 *   behind the cell test ("return false" before the zip), (2) normalizeZip
 *   skipped in readZipField (the raw string stored), (3) the online clear list
 *   without zip_code, (4) zip_code added to PUBLIC_EVENT_COLUMNS, (5) zip_code
 *   dropped from the repeat copy list; each turned a test red | date: 2026-11-16
 *
 * Runtime-bound (SELF.fetch, env.DB) → workers pool.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { latLngToCell } from 'h3-js';
import { handleCreateEvent, handleUpdateEvent, type EventsEnv } from '../src/handlers/events';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';
import { buildRepeatBody, REPEAT_SOURCE_COLUMNS } from '../src/lib/event-repeat';
import { PUBLIC_EVENT_COLUMNS, toPublicEvent } from '../src/lib/public-event-projection';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv & EventsEnv;
const ORIGIN = 'https://localhost';
const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
  'Sec-Fetch-Site': 'same-origin',
};

async function applyAll(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/duplicate column|already exists|no such column/.test(m)) continue;
      throw e;
    }
  }
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const post = (body: Record<string, unknown>) =>
  handleCreateEvent(
    new Request(`${ORIGIN}/api/v2/admin/events`, {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({ start_date: inDays(6), ...body }),
    }),
    E
  );

const put = (id: string, body: Record<string, unknown>) =>
  handleUpdateEvent(
    new Request(`${ORIGIN}/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify(body),
    }),
    E,
    id
  );

interface Created {
  id: string;
  warnings: { code: string }[];
  place: string;
}

async function create(body: Record<string, unknown>): Promise<Created> {
  const res = await post({ attendance_mode: 'in_person', ...body });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Created;
}

const zipOf = async (id: string) =>
  (await E.DB.prepare('SELECT zip_code FROM events WHERE id = ?').bind(id).first<{
    zip_code: string | null;
  }>())!.zip_code;

const cellOf = async (id: string) =>
  (await E.DB.prepare('SELECT h3_res7, h3_res9, lat, lon FROM events WHERE id = ?').bind(id).first<{
    h3_res7: string | null;
    h3_res9: string | null;
    lat: number | null;
    lon: number | null;
  }>())!;

const page = async (path: string) => {
  const res = await SELF.fetch(`https://t.test${path}`);
  expect(res.status).toBe(200);
  return res.text();
};

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
  await E.DB.prepare("DELETE FROM events WHERE title LIKE 'Zip W1 %'").run();
});

// ── 1. Store ─────────────────────────────────────────────────────────────────

describe('W1 store: create and update keep the ZIP as five digits', () => {
  test('sunny: a create with a ZIP stores it, and no cell is made from it', async () => {
    const ev = await create({ title: 'Zip W1 Store', location: 'Eagles Hall', zip_code: '60406' });
    expect(await zipOf(ev.id)).toBe('60406');
    expect(ev.warnings).toEqual([]);
    // The zip is words: no cell, no point.
    expect(await cellOf(ev.id)).toEqual({ h3_res7: null, h3_res9: null, lat: null, lon: null });
  });

  test('edge: ZIP+4 and spaces keep the five digits; both mode stores it too', async () => {
    const a = await create({ title: 'Zip W1 Plus4', location: 'A hall', zip_code: '60406-1234' });
    expect(await zipOf(a.id)).toBe('60406');
    const b = await create({ title: 'Zip W1 Spaces', location: 'A hall', zip_code: '  60406 ' });
    expect(await zipOf(b.id)).toBe('60406');
    const c = await create({
      title: 'Zip W1 Both',
      location: 'A hall',
      zip_code: '60406',
      attendance_mode: 'both',
    });
    expect(await zipOf(c.id)).toBe('60406');
  });

  test('automation may omit it: no ZIP, none stored; blank is none', async () => {
    const a = await create({ title: 'Zip W1 None', location: 'A hall' });
    expect(await zipOf(a.id)).toBeNull();
    const b = await create({ title: 'Zip W1 Blank', location: 'A hall', zip_code: '' });
    expect(await zipOf(b.id)).toBeNull();
  });

  test('fat finger: four digits, letters, inner spaces, a street, a number are each a 400', async () => {
    for (const bad of ['6040', '6O406', 'abcde', '604 06', '60406 S Pulaski Rd', '604061', 60406]) {
      const before = await E.DB.prepare(
        "SELECT COUNT(*) AS n FROM events WHERE title = 'Zip W1 Bad'"
      ).first<{ n: number }>();
      const res = await post({
        title: 'Zip W1 Bad',
        location: 'A hall',
        attendance_mode: 'in_person',
        zip_code: bad,
      });
      expect(res.status, `zip_code ${JSON.stringify(bad)}`).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('INVALID_ZIP_CODE');
      const after = await E.DB.prepare(
        "SELECT COUNT(*) AS n FROM events WHERE title = 'Zip W1 Bad'"
      ).first<{ n: number }>();
      expect(after!.n, 'nothing is written on a refused create').toBe(before!.n);
    }
  });

  test('rainy: a ZIP the Census table lacks (a PO-box ZIP) saves, and the answer says so', async () => {
    const ev = await create({ title: 'Zip W1 PO Box', location: 'Post office', zip_code: '60454' });
    expect(await zipOf(ev.id)).toBe('60454');
    expect(ev.warnings.map((w) => w.code)).toEqual(['ZIP_NOT_IN_TABLE']);
  });

  test('online stores none, and says it did not', async () => {
    const ev = (await (
      await post({ title: 'Zip W1 Online', attendance_mode: 'online', zip_code: '60406' })
    ).json()) as Created;
    expect(await zipOf(ev.id)).toBeNull();
    expect(ev.warnings.map((w) => w.code)).toEqual(['ZIP_NOT_STORED_ONLINE']);
  });

  test('update sets, changes and clears it; a malformed one is refused and nothing changes', async () => {
    const ev = await create({ title: 'Zip W1 Update', location: 'A hall' });
    expect((await put(ev.id, { zip_code: '60406' })).status).toBe(200);
    expect(await zipOf(ev.id)).toBe('60406');
    expect((await put(ev.id, { zip_code: '60643-0001' })).status).toBe(200);
    expect(await zipOf(ev.id)).toBe('60643');
    const bad = await put(ev.id, { zip_code: '6064', title: 'Zip W1 Update Renamed' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('INVALID_ZIP_CODE');
    expect(await zipOf(ev.id)).toBe('60643');
    const row = await E.DB.prepare('SELECT title FROM events WHERE id = ?')
      .bind(ev.id)
      .first<{ title: string }>();
    expect(row!.title, 'a refused PUT writes nothing').toBe('Zip W1 Update');
    const odd = await put(ev.id, { zip_code: '60454' });
    expect(((await odd.json()) as Created).warnings.map((w) => w.code)).toEqual([
      'ZIP_NOT_IN_TABLE',
    ]);
    expect((await put(ev.id, { zip_code: '' })).status).toBe(200);
    expect(await zipOf(ev.id)).toBeNull();
    await put(ev.id, { zip_code: '60406' });
    expect((await put(ev.id, { zip_code: null })).status).toBe(200);
    expect(await zipOf(ev.id)).toBeNull();
  });

  test('turning an event online clears its ZIP; a ZIP sent to an online event is not stored', async () => {
    const ev = await create({ title: 'Zip W1 Goes Online', location: 'A hall', zip_code: '60406' });
    const res = await put(ev.id, { attendance_mode: 'online', location: '' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await zipOf(ev.id)).toBeNull();
    const again = await put(ev.id, { zip_code: '60406' });
    expect(((await again.json()) as Created).warnings.map((w) => w.code)).toEqual([
      'ZIP_NOT_STORED_ONLINE',
    ]);
    expect(await zipOf(ev.id)).toBeNull();
  });
});

// ── 2. Search ────────────────────────────────────────────────────────────────

describe('W1 search: an event with no cell is found under its own zip, and no other', () => {
  const T = {
    box: 'Zip W1 Search Box Night',
    addr: 'Zip W1 Search Address Night',
    disagree: 'Zip W1 Search Disagree Night',
    po: 'Zip W1 Search PO Night',
    none: 'Zip W1 Search Nozip Night',
    cellFar: 'Zip W1 Search Cell Far Zip Night',
  };
  beforeAll(async () => {
    const live = { status: 'active', is_published: true };
    // The ZIP box alone, no cell (the place name finds nothing: no key here).
    await create({ ...live, title: T.box, location: 'Eagles Hall', zip_code: '60406' });
    // No box: the zip its address ends with.
    await create({
      ...live,
      title: T.addr,
      location: 'A hall',
      where_address: '1 Main St, Blue Island, IL 60406',
    });
    // The box and the address disagree: the box wins.
    await create({
      ...live,
      title: T.disagree,
      location: 'A hall',
      where_address: '1 W 111th St, Chicago, IL 60643',
      zip_code: '60406',
    });
    // A PO-box zip the Census table lacks, given in the box only.
    await create({ ...live, title: T.po, location: 'Post office', zip_code: '60454' });
    // No zip at all: found by no zip.
    await create({ ...live, title: T.none, location: 'Somewhere' });
    // A cell here (Mount Greenwood, 60655) and a zip from another state: the
    // far zip is ignored, the cell decides, as before.
    const lat = 41.6939;
    const lon = -87.7025;
    const ev = await create({
      ...live,
      title: T.cellFar,
      location: 'A hall',
      zip_code: '90210',
      lat,
      lon,
    });
    expect((await cellOf(ev.id)).h3_res7).toBe(latLngToCell(lat, lon, CORRIDOR_RES));
  });

  const seen = (html: string) =>
    Object.values(T)
      .filter((t) => html.includes(t))
      .sort();

  test('sunny: /?zip=60406 lists the box, the address and the disagreeing box', async () => {
    expect(seen(await page('/?zip=60406'))).toEqual([T.addr, T.box, T.disagree].sort());
  });

  test('/?where=Blue Island and /events?q= find them too, through the same rule', async () => {
    expect(seen(await page('/?where=Blue%20Island'))).toEqual([T.addr, T.box, T.disagree].sort());
    expect(seen(await page('/events?q=60406'))).toEqual([T.addr, T.box, T.disagree].sort());
    expect(seen(await page('/events?q=Blue%20Island'))).toEqual([T.addr, T.box, T.disagree].sort());
  });

  test('edge: the address zip the box overrode does not find it', async () => {
    expect(seen(await page('/?zip=60643'))).not.toContain(T.disagree);
    expect(seen(await page('/events?q=60643'))).not.toContain(T.disagree);
  });

  test('rainy: a PO-box zip in the box matches by that zip alone', async () => {
    expect(seen(await page('/events?q=60454'))).toEqual([T.po]);
    expect(seen(await page('/events?q=Oak%20Lawn'))).toContain(T.po);
  });

  test('an event with a cell is found as before: the far zip is ignored', async () => {
    expect(seen(await page('/?zip=60655'))).toEqual([T.cellFar]);
    expect(seen(await page('/events?q=90210'))).toEqual([]);
  });

  test('an event with no zip and no cell is in no zip', async () => {
    for (const z of ['60406', '60643', '60655', '60454']) {
      expect(seen(await page(`/events?q=${z}`))).not.toContain(T.none);
    }
  });

  test('no hexagon is lit from a zip: the found events still have no cell', async () => {
    const { results } = await E.DB.prepare(
      'SELECT h3_res7, h3_res9, lat, lon FROM events WHERE title IN (?, ?, ?, ?)'
    )
      .bind(T.box, T.addr, T.disagree, T.po)
      .all<{ h3_res7: unknown; h3_res9: unknown; lat: unknown; lon: unknown }>();
    expect(results).toHaveLength(4);
    for (const r of results)
      expect(r).toEqual({ h3_res7: null, h3_res9: null, lat: null, lon: null });
  });
});

// ── 3. Not published ─────────────────────────────────────────────────────────

describe('W1 not published: the ZIP never reaches a public response', () => {
  test('the projection allowlist has no zip, and drops one from a row', () => {
    expect(PUBLIC_EVENT_COLUMNS as readonly string[]).not.toContain('zip_code');
    expect(toPublicEvent({ id: 'x', title: 't', zip_code: '60406' })).not.toHaveProperty(
      'zip_code'
    );
  });

  test('the public events API answers without zip_code', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events?brand=root');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    const mine = body.items.filter((i) => String(i.title ?? '').startsWith('Zip W1 Search'));
    expect(mine.length).toBeGreaterThan(0);
    for (const item of mine) expect(item).not.toHaveProperty('zip_code');
    expect(JSON.stringify(body)).not.toContain('"zip_code"');
  });
});

// ── 4. Repeat ────────────────────────────────────────────────────────────────

describe('W1 repeat: "Repeat this event" copies the ZIP', () => {
  test('the source read and the copy both carry it', () => {
    expect(REPEAT_SOURCE_COLUMNS as readonly string[]).toContain('zip_code');
    const src = Object.fromEntries(REPEAT_SOURCE_COLUMNS.map((c) => [c, null])) as Record<
      string,
      unknown
    >;
    Object.assign(src, {
      id: 'e',
      brand_id: 'root',
      title: 'R',
      slug: 'r',
      location: 'A hall',
      zip_code: '60406',
      start_date: '2026-11-20',
      attendance_mode: 'in_person',
    });
    const body = buildRepeatBody(src as never, '2026-11-16', 'abc123');
    expect(body.zip_code).toBe('60406');
  });
});

// ── 5. The wizard's fill-in route ────────────────────────────────────────────

describe('W1 POST /api/v2/admin/zip-suggest: the fill-in, by the server rules', () => {
  const ask = (body: unknown, headers: Record<string, string> = ADMIN, method = 'POST') =>
    SELF.fetch('https://t.test/api/v2/admin/zip-suggest', {
      method,
      headers,
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });

  test('sunny: an address that ends in a ZIP, and a one-ZIP town', async () => {
    const a = await ask({ address: '1 Main St, Blue Island, IL 60406-1234' });
    expect(a.status).toBe(200);
    expect(a.headers.get('Cache-Control')).toBe('no-store');
    expect(await a.json()).toEqual({ ok: true, zip: '60406', from: 'address' });
    const b = await ask({ address: '3200 W 95th St, Evergreen Park, IL' });
    expect(await b.json()).toEqual({
      ok: true,
      zip: '60805',
      from: 'town',
      town: 'Evergreen Park, IL',
    });
  });

  test('edge: a town of many ZIPs and a street number fill nothing', async () => {
    expect(await (await ask({ address: '1 Main St, Blue Island, IL' })).json()).toEqual({
      ok: true,
      zip: null,
      from: null,
    });
    expect(await (await ask({ address: '12345 S Pulaski Rd' })).json()).toEqual({
      ok: true,
      zip: null,
      from: null,
    });
  });

  test('rainy: not signed in is refused; a body that is not an object is a 400', async () => {
    const anon = await ask(
      { address: 'x' },
      { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }
    );
    expect([401, 403]).toContain(anon.status);
    const arr = await ask(['60406']);
    expect(arr.status).toBe(400);
    expect(((await arr.json()) as { code: string }).code).toBe('INVALID_BODY');
  });

  test('it is a POST: a GET with the address in the URL is not served', async () => {
    const res = await SELF.fetch(
      'https://t.test/api/v2/admin/zip-suggest?address=1%20Main%20St%2C%20IL%2060406',
      { headers: ADMIN }
    );
    expect(res.status).not.toBe(200);
  });
});
