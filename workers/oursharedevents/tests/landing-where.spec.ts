/**
 * Landing "where are you?" over HTTP (owner 2026-10-10).
 *
 *   GET /?zip=NNNNN   lists only the events in the zip's own area, results first
 *                     (owner 2026-11-05: the zip in the event's address, else the
 *                     nearest zip center; never the towns around it).
 *   GET /?where=...   a town name first, then a zip (owner 2026-11-06). One name can
 *                     be many places: every match is offered, labelled by town and
 *                     state, and the events of all of them are listed.
 *   POST /near g=...  a phone's 5-character box → 303 to /?zip= of the nearest zip.
 *   The landing alone may ask for location (Permissions-Policy geolocation=(self)).
 *
 * Limits on the page script itself: tests/landing-where-unit.spec.ts. The name
 * lookup itself: tests/place-search.spec.ts.
 *
 * @born-red place-name-search | method: run against the code before the change
 *   (?where= ignored: every place test red), then with readWhere taking the first
 *   match of a many-match name and with the handler's place filter removed; each
 *   turned a test red | date: 2026-11-06
 * @born-red landing-where | method: filter removed (far event listed), /near reading
 *   ?g= from the address, /near answering 200 with a body, landing policy left at
 *   geolocation=() — each turned its test red | date: 2026-10-10
 * @born-red landing-zip-own-area | method: the handler's filter put back to the old
 *   8-ring nearCells test (60655 listed its Oak Lawn and Evergreen Park neighbours;
 *   the box zip listed Blue Island) — each turned its test red | date: 2026-11-05
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { latLngToCell } from 'h3-js';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const NEAR = 'where-near-blue-island';
const FAR = 'where-far-los-angeles';
const OAK_LAWN = 'where-oak-lawn';
const EVERGREEN_PARK = 'where-evergreen-park';
const SPRINGFIELD_IL = 'where-springfield-il';
const SPRINGFIELD_MA = 'where-springfield-ma';
const MOUNT_GREENWOOD = 'where-mount-greenwood';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function seed(
  id: string,
  title: string,
  lat: number,
  lon: number,
  address: string | null = null
): Promise<void> {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, where_address,
                           start_date, timezone, lat, lon, h3_res9, h3_res7, created_at, updated_at)
       VALUES (?, 'root', ?, ?, 'active', 1, 'A hall', ?, ?, 'America/Chicago', ?, ?, ?, ?,
               datetime('now'), datetime('now'))`
    )
    .bind(
      id,
      title,
      id,
      address,
      inDays(4),
      lat,
      lon,
      latLngToCell(lat, lon, 9),
      latLngToCell(lat, lon, CORRIDOR_RES)
    )
    .run();
}

const page = async (path: string) => {
  const res = await SELF.fetch(`https://t.test${path}`);
  return { res, body: await res.text() };
};

const near = (body: string, contentType = 'application/x-www-form-urlencoded') =>
  SELF.fetch('https://t.test/near', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': contentType },
    body,
  });

beforeAll(async () => {
  await applyMigrations();
  await seed(NEAR, 'Where Test Blue Island Night', 41.6571, -87.6798);
  await seed(
    FAR,
    'Where Test Los Angeles Night',
    34.0522,
    -118.2437,
    '1 Main St, Los Angeles, CA 90012'
  );
  // One res-7 ring from Mount Greenwood (60655), each inside its own town: the
  // old 8-ring "near" listed both for 60655. One says its zip, one does not.
  await seed(
    OAK_LAWN,
    'Where Test Oak Lawn Night',
    41.698,
    -87.74,
    '1 Main St, Oak Lawn, IL 60453'
  );
  await seed(EVERGREEN_PARK, 'Where Test Evergreen Park Night', 41.708, -87.706);
  await seed(MOUNT_GREENWOOD, 'Where Test Mount Greenwood Night', 41.681, -87.711);
  // One name, two places (owner 2026-11-06).
  await seed(
    SPRINGFIELD_IL,
    'Where Test Springfield Illinois Night',
    39.7817,
    -89.6501,
    '1 Capitol Ave, Springfield, IL 62701'
  );
  await seed(SPRINGFIELD_MA, 'Where Test Springfield Massachusetts Night', 42.1015, -72.5898);
});

describe('GET / with a place name first (owner 2026-11-06)', () => {
  test('one name, many places: every match to choose from, and the events of all of them', async () => {
    const { res, body } = await page('/?where=Springfield');
    expect(res.status).toBe(200);
    expect(body).toContain('data-testid="where-choices"');
    const choices = body.match(/data-testid="where-choice"/g) ?? [];
    expect(choices.length).toBeGreaterThanOrEqual(20);
    expect(body).toContain('href="/?where=Springfield%2C%20IL"');
    expect(body).toContain('href="/?where=Springfield%2C%20MA"');
    // Brought together: not an error, and not one picked for the person.
    expect(body).not.toContain('data-testid="where-msg"');
    expect(body).toContain('Where Test Springfield Illinois Night');
    expect(body).toContain('Where Test Springfield Massachusetts Night');
    expect(body).not.toContain('Where Test Blue Island Night');
    expect(body).toMatch(/data-testid="area-heading">In every place called Springfield /);
  });

  test('a chosen place lists its own events only', async () => {
    const { body } = await page('/?where=Springfield%2C%20IL');
    expect(body).toContain('Where Test Springfield Illinois Night');
    expect(body).not.toContain('Where Test Springfield Massachusetts Night');
    expect(body).not.toContain('data-testid="where-choices"');
    expect(body).toMatch(/data-testid="area-heading">Near Springfield, IL /);
  });

  test('a town name lists that town, not its neighbours', async () => {
    const { body } = await page('/?where=oak%20lawn');
    expect(body).toContain('Where Test Oak Lawn Night');
    expect(body).not.toContain('Where Test Mount Greenwood Night');
    expect(body).not.toContain('Where Test Los Angeles Night');
  });

  test('a zip typed in the same box works as before', async () => {
    const { body } = await page('/?where=60453');
    expect(body).toContain('Where Test Oak Lawn Night');
    expect(body).toMatch(/data-testid="area-heading">Near 60453 /);
  });

  test('an unknown name says so and lists everything; coordinates are never read', async () => {
    const { body } = await page('/?where=Nowhereville');
    expect(body).toContain("We couldn't find a place called Nowhereville.");
    expect(body).toContain('Where Test Blue Island Night');
    const coords = (await page('/?where=' + encodeURIComponent('41.6571,-87.6798'))).body;
    expect(coords).toContain("We couldn't find a place called");
    expect(coords).not.toMatch(/data-testid="area-heading">Near /);
  });

  test('a place with nothing in it says so', async () => {
    const { body } = await page('/?where=Anchorage');
    expect(body).toContain('Nothing in Anchorage, AK yet.');
    expect(body).not.toContain('Where Test');
  });

  test('sets no cookie', async () => {
    const { res } = await page('/?where=Springfield');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('GET / with a zip', () => {
  test('lists the event near the zip and not the far one', async () => {
    const { res, body } = await page('/?zip=60406');
    expect(res.status).toBe(200);
    expect(body).toContain('Where Test Blue Island Night');
    expect(body).not.toContain('Where Test Los Angeles Night');
    expect(body).toMatch(/data-testid="area-heading">Near 60406 /);
    expect(body).toContain('value="60406"');
  });

  test('a far zip lists the far event only', async () => {
    const { body } = await page('/?zip=90012');
    expect(body).toContain('Where Test Los Angeles Night');
    expect(body).not.toContain('Where Test Blue Island Night');
  });

  test('a zip lists its own area only, not the towns next to it (owner 2026-11-05)', async () => {
    const mg = (await page('/?zip=60655')).body;
    expect(mg).toContain('Where Test Mount Greenwood Night');
    expect(mg).not.toContain('Where Test Oak Lawn Night');
    expect(mg).not.toContain('Where Test Evergreen Park Night');
    expect(mg).not.toContain('Where Test Blue Island Night');
    const ol = (await page('/?zip=60453')).body;
    expect(ol).toContain('Where Test Oak Lawn Night');
    expect(ol).not.toContain('Where Test Mount Greenwood Night');
    const ep = (await page('/?zip=60805')).body;
    expect(ep).toContain('Where Test Evergreen Park Night');
    expect(ep).not.toContain('Where Test Mount Greenwood Night');
    const bi = (await page('/?zip=60406')).body;
    expect(bi).not.toContain('Where Test Mount Greenwood Night');
    expect(bi).not.toContain('Where Test Oak Lawn Night');
  });

  test('a zip with nothing near says so and points to all events', async () => {
    const { body } = await page('/?zip=99501'); // Anchorage
    expect(body).toContain('data-testid="area-empty-near"');
    expect(body).toContain('Nothing near 99501 yet.');
    expect(body).not.toContain('Where Test');
  });

  test('results come before the organizer buttons', async () => {
    const { body } = await page('/?zip=60406');
    expect(body.indexOf('data-testid="landing-area"')).toBeLessThan(
      body.indexOf('data-testid="landing-doors"')
    );
  });

  test('no zip lists everything, as before; an unknown zip says so and lists everything', async () => {
    for (const path of ['/', '/?zip=99999']) {
      const { body } = await page(path);
      expect(body, path).toContain('Where Test Blue Island Night');
      expect(body, path).toContain('Where Test Los Angeles Night');
    }
    expect((await page('/?zip=99999')).body).toContain("We couldn't find zip 99999.");
    expect((await page('/')).body).toMatch(/data-testid="area-heading">Coming up</);
  });

  test('the zip box is on every landing answer, first after the heading', async () => {
    const { body } = await page('/');
    const h1 = body.indexOf('data-testid="landing-h1"');
    const form = body.indexOf('data-testid="where-form"');
    expect(h1).toBeGreaterThan(0);
    expect(form).toBeGreaterThan(h1);
    expect(form).toBeLessThan(body.indexOf('data-testid="landing-doors"'));
    expect(form).toBeLessThan(body.indexOf('data-testid="landing-area"'));
  });

  test('sets no cookie', async () => {
    const { res } = await page('/?zip=60406');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('POST /near', () => {
  test("a box near Blue Island goes to the box's nearest zip, and shows that zip's own area", async () => {
    const res = await near('g=dp3su');
    expect(res.status).toBe(303);
    // The box (about 5 km) is centered in Posen, next to Blue Island.
    expect(res.headers.get('Location')).toBe('/?zip=60469');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const { body } = await page('/?zip=60469');
    expect(body).toMatch(/data-testid="area-heading">Near 60469 /);
    // Blue Island's event is in Blue Island's own area, not Posen's.
    expect(body).not.toContain('Where Test Blue Island Night');
  });

  test('a box outside the US goes to the zip box with a note', async () => {
    const res = await near('g=u09tv'); // Paris
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/?nozip=1');
    expect((await page('/?nozip=1')).body).toContain("couldn't find a US zip where you are");
  });

  test('refuses anything that is not exactly a 5-character box', async () => {
    for (const body of ['', 'g=', 'g=dp3s', 'g=dp3sux', 'g=41.6571,-87.6798', 'lat=41&lon=-87']) {
      const res = await near(body);
      expect(res.status, body).toBe(400);
      expect(res.headers.get('Location'), body).toBeNull();
    }
  });

  test('never reads the box from the address, and needs a form body', async () => {
    const viaQuery = await SELF.fetch('https://t.test/near?g=dp3su', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(viaQuery.status).toBe(400);
    expect((await near('{"g":"dp3su"}', 'application/json')).status).toBe(400);
  });

  test('GET /near goes back to the landing page', async () => {
    const res = await SELF.fetch('https://t.test/near?g=dp3su', { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
  });
});

describe('who may ask for location', () => {
  test('the landing page may, for itself only; other pages may not', async () => {
    const landing = (await page('/')).res.headers.get('Permissions-Policy') ?? '';
    expect(landing).toContain('geolocation=(self)');
    expect(landing).toContain('camera=()');
    expect(landing).toContain('microphone=()');
    for (const path of ['/events', `/events/${NEAR}`]) {
      const p = (await page(path)).res.headers.get('Permissions-Policy') ?? '';
      expect(p, path).toContain('geolocation=()');
    }
  });
});
