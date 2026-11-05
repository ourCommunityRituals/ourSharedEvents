/**
 * /events search by place name or zip (owner 2026-11-05).
 *
 *   GET /events?q=Oak%20Lawn   every event in any of the owner's Oak Lawn zips
 *   GET /events?q=60453        the events in that zip's own area
 *   GET /events?q=Oak          still a name/venue search: only a whole name is a place
 *
 * An event's zip is the landing page's rule (lib/zip-areas.ts inZipOwnArea): the
 * zip its address ends with, else the nearest zip center. A place is the owner's
 * group of zips (lib/place-names.ts PLACES), overlaps included.
 *
 * @born-red events-place-search | method: (1) the place branch removed from
 *   applyDiscoveryFilters, (2) the address-only rule for a zip outside the Census
 *   table removed, (3) one zip dropped from Oak Lawn's list — each turned a test
 *   red | date: 2026-11-05
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { latLngToCell } from 'h3-js';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';
import { PLACES, findSearchPlace } from '../src/lib/place-names';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

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

const T = {
  oakLawn: 'Place Test Oak Lawn Night',
  bridgeview: 'Place Test Bridgeview Night',
  poBox: 'Place Test PO Box Night',
  mountGreenwood: 'Place Test Mount Greenwood Night',
  evergreenPark: 'Place Test Evergreen Park Night',
  auburnGresham: 'Place Test Auburn Gresham Night',
  blueIsland: 'Place Test Blue Island Night',
};
const ALL = Object.values(T);

const listed = async (q: string) => {
  const res = await SELF.fetch(`https://t.test/events?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  const body = await res.text();
  return { body, titles: ALL.filter((t) => body.includes(t)).sort() };
};

beforeAll(async () => {
  await applyMigrations();
  // Inside Oak Lawn; its address says 60453.
  await seed('place-oak-lawn', T.oakLawn, 41.698, -87.74, '1 Main St, Oak Lawn, IL 60453');
  // At 60455's center (Bridgeview), no address: an owner's Oak Lawn zip.
  await seed('place-bridgeview', T.bridgeview, 41.741, -87.807);
  // 60454 is not a Census zip area. The spot is nearest 60805, so only the
  // address-only rule puts it in Oak Lawn.
  await seed('place-po-box', T.poBox, 41.708, -87.706, 'PO Box 1, Oak Lawn, IL 60454');
  // No address: nearest zip center 60655.
  await seed('place-mount-greenwood', T.mountGreenwood, 41.681, -87.711);
  // No address: nearest zip center 60805.
  await seed('place-evergreen-park', T.evergreenPark, 41.708, -87.706);
  // Its address says 60620: Auburn Gresham and Beverly both claim 60620.
  await seed(
    'place-auburn-gresham',
    T.auburnGresham,
    41.75,
    -87.65,
    '1 W 79th St, Chicago, IL 60620'
  );
  await seed('place-blue-island', T.blueIsland, 41.6571, -87.6798);
});

describe('the owner’s places', () => {
  test('the table is the owner’s list, as given', () => {
    expect(PLACES.map((p) => [p.name, [...p.zips]])).toEqual([
      ['Beverly', ['60643', '60655', '60620']],
      ['Blue Island', ['60406', '60472', '60827']],
      ['Mount Greenwood', ['60655']],
      ['Evergreen Park', ['60805']],
      ['Oak Lawn', ['60453', '60454', '60455', '60457', '60458']],
      ['Auburn Gresham', ['60620', '60621', '60636', '60643', '60652']],
    ]);
  });

  test('a whole name in any case, an alias or a zip is a place; part of a name is text', () => {
    expect(findSearchPlace('oak LAWN')?.label).toBe('Oak Lawn');
    expect(findSearchPlace('  Mt. Greenwood ')?.label).toBe('Mount Greenwood');
    expect(findSearchPlace('60453-1234')?.zips).toEqual(['60453']);
    expect(findSearchPlace('Oak')).toBeNull();
    expect(findSearchPlace('trivia')).toBeNull();
  });
});

describe('GET /events?q=<place>', () => {
  test('Oak Lawn lists the events of all its zips, and nothing else', async () => {
    const { body, titles } = await listed('Oak Lawn');
    expect(titles).toEqual([T.bridgeview, T.oakLawn, T.poBox].sort());
    expect(body).toContain('Events in Oak Lawn');
    expect(body).toContain('3 events in Oak Lawn');
  });

  test('Mount Greenwood (typed as "mt greenwood") lists its own event only', async () => {
    const { body, titles } = await listed('mt greenwood');
    expect(titles).toEqual([T.mountGreenwood]);
    expect(body).toContain('Events in Mount Greenwood');
  });

  test('Beverly lists what its zips share with Mount Greenwood and Auburn Gresham', async () => {
    const { titles } = await listed('Beverly');
    expect(titles).toEqual([T.auburnGresham, T.mountGreenwood].sort());
  });

  test('Auburn Gresham, Evergreen Park and Blue Island each list their own', async () => {
    expect((await listed('Auburn Gresham')).titles).toEqual([T.auburnGresham]);
    expect((await listed('Evergreen Park')).titles).toEqual([T.evergreenPark, T.poBox].sort());
    expect((await listed('Blue Island')).titles).toEqual([T.blueIsland]);
  });

  test('a zip lists that zip’s own area only', async () => {
    const { body, titles } = await listed('60453');
    expect(titles).toEqual([T.oakLawn]);
    expect(body).toContain('Events in 60453');
  });

  test('a place with nothing in it says so by name', async () => {
    const { body, titles } = await listed('60652');
    expect(titles).toEqual([]);
    expect(body).toContain('Nothing in 60652 yet.');
  });

  test('"See all events" from an empty place drops the date window too', async () => {
    const res = await SELF.fetch('https://t.test/events?when=weekend&q=60652');
    const body = await res.text();
    expect(body).toMatch(/<a href="\/events" data-testid="disc-empty-wider">See all events<\/a>/);
  });

  test('part of a name is still a name/venue search', async () => {
    const { body, titles } = await listed('Oak');
    expect(titles).toEqual([T.oakLawn]);
    expect(body).toContain('Matches for “Oak”');
  });

  test('the box says it takes a town or a zip', async () => {
    const { body } = await listed('');
    expect(body).toContain('placeholder="Search by name, venue, town or zip"');
  });
});
