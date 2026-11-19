/**
 * A search carries between List, Map and Events (OSE-2165; CCR 2026-11-19 F-05,
 * F-03 in part).
 *
 * Proven on staging before this change: `/?zip=49127` served the header's Events
 * and Map links with no query, so a person who typed a town and tapped Map got
 * the unfiltered map, and `/events` had no way to the map at all. "Chicago" gave
 * 8 cards on the landing and 9 on `/events`, because `/events` matched the typed
 * text and the landing resolved a place.
 *
 * Now:
 *  - The header Events and Map links carry the resolved place (`where` for a
 *    town, `zip` for a known zip), as the language switch does. Only a resolved
 *    label or a known zip; never the text a visitor typed (the address lines go
 *    to the edge logs).
 *  - `/events` shows the same Events | Map header, and its Map link carries the
 *    place the page resolved.
 *  - `/events` resolves a place with the landing's resolver (readTyped), for
 *    `?q=`, `?where=` and `?zip=` alike. It does not merge the two lists (owner
 *    decision F-03, ADR-027).
 *
 * @born-red search-carries | method: each test run against a planted fault:
 *   markLandingNav carrying nothing; the carried query built from the raw typed
 *   text; the /events header without its Map link; /events matching `q` as text
 *   before the resolver; `?where=` ignored on /events; each turned a test red |
 *   date: 2026-11-19
 *
 * Workers pool, real D1.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { latLngToCell } from 'h3-js';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
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

const ORIGIN = 'https://stg.oursharedevents.com';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Chicago's Loop (zip 60601) and Blue Island (60406).
const LOOP = { lat: 41.886, lon: -87.622 };
const BLUE_ISLAND = { lat: 41.6571, lon: -87.6798 };

async function seed(id: string, title: string, at: { lat: number; lon: number }): Promise<void> {
  await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, start_date,
                         timezone, lat, lon, h3_res9, h3_res7, created_at, updated_at)
     VALUES (?, 'root', ?, ?, 'active', 1, 'A hall', ?, 'America/Chicago', ?, ?, ?, ?,
             datetime('now'), datetime('now'))`
  )
    .bind(
      id,
      title,
      id,
      day(5),
      at.lat,
      at.lon,
      latLngToCell(at.lat, at.lon, 9),
      latLngToCell(at.lat, at.lon, 7)
    )
    .run();
}

const T = {
  loop: 'Carry Test Loop Night',
  // In Blue Island, with "Chicago" in its name: the text match found it, the
  // landing's place search does not, and /events now agrees with the landing.
  words: 'Carry Test Chicago Words Night',
  blueIsland: 'Carry Test Blue Island Night',
};

beforeAll(async () => {
  await applyMigrations();
  await seed('carry-loop', T.loop, LOOP);
  await seed('carry-words', T.words, BLUE_ISLAND);
  await seed('carry-blue-island', T.blueIsland, BLUE_ISLAND);
});

const get = (path: string) => SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual' });
const page = async (path: string) => (await get(path)).text();

/** The hrefs of every link with this test id, `&amp;` read back as `&`. */
const hrefs = (html: string, testid: string): string[] =>
  [...html.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(`data-testid="${testid}"`))
    .map((tag) => (tag.match(/href="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&'));
const cards = (html: string) => (html.match(/data-testid="public-event-card-link"/g) ?? []).length;
const mine = (html: string) =>
  Object.values(T)
    .filter((t) => html.includes(t))
    .sort();

describe('the landing header carries the resolved place', () => {
  test('a town: Events and Map carry its label', async () => {
    const html = await page('/?where=Blue%20Island');
    expect(hrefs(html, 'nav-events')).toEqual(['/events?where=Blue%20Island%2C%20IL']);
    expect(hrefs(html, 'nav-map')).toEqual(['/map?where=Blue%20Island%2C%20IL']);
  });

  test('a town typed in lower case, with its state, carries the table label, not the typed text', async () => {
    const html = await page('/?where=blue%20island%2C%20il');
    expect(hrefs(html, 'nav-map')).toEqual(['/map?where=Blue%20Island%2C%20IL']);
  });

  test('a known zip: Events and Map carry the zip', async () => {
    const html = await page('/?zip=60406');
    expect(hrefs(html, 'nav-events')).toEqual(['/events?zip=60406']);
    expect(hrefs(html, 'nav-map')).toEqual(['/map?zip=60406']);
  });

  test('a typed zip in the box carries the zip, not the typed text', async () => {
    const html = await page('/?where=60406');
    expect(hrefs(html, 'nav-map')).toEqual(['/map?zip=60406']);
  });

  test('a name that is many places carries the town name from the table, once', async () => {
    const html = await page('/?where=springfield');
    expect(hrefs(html, 'nav-map')).toEqual(['/map?where=Springfield']);
    expect(hrefs(html, 'nav-events')).toEqual(['/events?where=Springfield']);
  });

  test('the language prefix stays in front of the carried place', async () => {
    const html = await page('/es/?zip=60406');
    expect(hrefs(html, 'nav-events')).toEqual(['/es/events?zip=60406']);
    expect(hrefs(html, 'nav-map')).toEqual(['/es/map?zip=60406']);
  });

  test('on /map the links carry it too, and Map is still the page being read', async () => {
    const html = await page('/map?zip=60406');
    expect(hrefs(html, 'nav-events')).toEqual(['/events?zip=60406']);
    expect(hrefs(html, 'nav-map')).toEqual(['/map?zip=60406']);
    expect(html.match(/aria-current="page"/g) ?? []).toHaveLength(1);
  });

  test('text that is no place is never carried', async () => {
    const typed = 'Zzyzx"><script>alert(1)</script>';
    for (const path of [
      `/?where=${encodeURIComponent(typed)}`,
      `/map?where=${encodeURIComponent(typed)}`,
      '/?where=Zzyzx',
      '/?zip=99999',
      '/?zip=abc',
      '/?nozip=1',
      '/?change=1',
      '/',
    ]) {
      const html = await page(path);
      expect(hrefs(html, 'nav-map'), path).toEqual(['/map']);
      expect(hrefs(html, 'nav-events'), path).toEqual(['/events']);
      expect(
        html.match(/<nav data-testid="landing-nav"[\s\S]*?<\/nav>/)?.[0] ?? '',
        path
      ).not.toMatch(/Zzyzx|script|alert/);
    }
  });
});

describe('/events has the same header, and carries the place it resolved', () => {
  test('a bare /events: Events (this page) and Map, no query', async () => {
    const html = await page('/events');
    expect(hrefs(html, 'nav-events')).toEqual(['/events']);
    expect(hrefs(html, 'nav-map')).toEqual(['/map']);
    expect(html).toMatch(/data-testid="nav-events"[^>]*aria-current="page"/);
  });

  test('a Spanish /events keeps its prefix and its words', async () => {
    const html = await page('/es/events?q=60406');
    expect(hrefs(html, 'nav-map')).toEqual(['/es/map?zip=60406']);
    expect(html).toMatch(/data-testid="nav-map"[^>]*>Mapa</);
  });

  test.each([
    ['?q=Blue%20Island', '/map?where=Blue%20Island%2C%20IL'],
    ['?where=Blue%20Island', '/map?where=Blue%20Island%2C%20IL'],
    ['?q=60406', '/map?zip=60406'],
    ['?zip=60406', '/map?zip=60406'],
    ['?where=60406', '/map?zip=60406'],
    ['?when=week&q=Blue%20Island', '/map?where=Blue%20Island%2C%20IL'],
  ])('/events%s sends Map to %s', async (query, map) => {
    const html = await page(`/events${query}`);
    expect(hrefs(html, 'nav-map')).toEqual([map]);
    expect(hrefs(html, 'nav-events')).toEqual([map.replace('/map', '/events')]);
  });

  test('a search that is words, not a place, is not carried', async () => {
    const typed = 'Zzyzx night';
    const html = await page(`/events?q=${encodeURIComponent(typed)}`);
    expect(hrefs(html, 'nav-map')).toEqual(['/map']);
    expect(hrefs(html, 'nav-events')).toEqual(['/events']);
    const nav = html.match(/<nav[^>]*data-testid="public-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(nav).not.toBe('');
    expect(nav).not.toMatch(/Zzyzx/);
  });

  test('one h1, and the header names the site once', async () => {
    const html = await page('/events?q=Blue%20Island');
    expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
  });
});

describe('/events resolves a place the way the landing does', () => {
  test('"Chicago" lists the same events on both pages, not the one named Chicago in Blue Island', async () => {
    const landing = await page('/?where=Chicago');
    const events = await page('/events?q=Chicago');
    const viaWhere = await page('/events?where=Chicago');
    expect(mine(landing)).toEqual([T.loop]);
    expect(mine(events)).toEqual([T.loop]);
    expect(mine(viaWhere)).toEqual([T.loop]);
    expect(cards(events)).toBe(cards(landing));
    expect(cards(viaWhere)).toBe(cards(landing));
  });

  test('a town and a zip agree with the landing too', async () => {
    for (const [landingPath, eventsPath] of [
      ['/?where=Blue%20Island', '/events?q=Blue%20Island'],
      ['/?zip=60406', '/events?zip=60406'],
      ['/?zip=60406', '/events?q=60406'],
    ]) {
      const landing = await page(landingPath);
      const events = await page(eventsPath);
      expect(mine(events), eventsPath).toEqual(mine(landing));
      expect(mine(events), eventsPath).toEqual([T.blueIsland, T.words].sort());
      expect(cards(events), eventsPath).toBe(cards(landing));
    }
  });

  test('the owner’s own place names still resolve (Oak Lawn, with or without its state)', async () => {
    for (const q of ['Oak Lawn', 'oak lawn, il', 'Oak Lawn Illinois']) {
      const html = await page(`/events?q=${encodeURIComponent(q)}`);
      expect(hrefs(html, 'nav-map'), q).toEqual(['/map?where=Oak%20Lawn%2C%20IL']);
    }
  });

  test('words that are no place stay a name search', async () => {
    const html = await page('/events?q=Words');
    expect(mine(html)).toEqual([T.words]);
  });

  test('the two lists stay two lists: /events lists events the landing map would not lead with', async () => {
    // Not merged (owner decision F-03): the same events, two surfaces, two limiter scopes.
    const html = await page('/events');
    expect(mine(html)).toEqual(Object.values(T).sort());
  });
});
