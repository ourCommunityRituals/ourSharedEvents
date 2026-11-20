/**
 * The attendee map's own address: GET /map (owner, 2026-11-11 and 2026-11-17;
 * OSE-1990).
 *
 * /map is the landing page opened on its map view. The landing keeps its own
 * list and map. What changes at /map: the map view is the one open, the area
 * leads the page, and the page's links (a hexagon, Back to all areas, the
 * language switch, the canonical) name /map. What does not change: what the map
 * draws. The landing's 10-event rule (LIST_MAX) holds here too, so /map is no
 * way round it.
 *
 * Sunny, rainy, edge and never-who cases, against real D1 (workers pool).
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { latLngToCell } from 'h3-js';
import { LIST_MAX } from '../src/lib/landing-area';

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
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

const ORIGIN = 'https://stg.oursharedevents.com';
const BLUE_ISLAND = latLngToCell(41.657731, -87.680213, 7);
const BEVERLY = latLngToCell(41.717329, -87.673159, 7);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function seed(id: string, cell: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, location, is_published, h3_res7)
     VALUES (?, 'root', ?, ?, 'active', ?, 'Hall', 1, ?)`
  )
    .bind(id, `Map page ${id}`, `slug-${id}`, day(10), cell)
    .run();
}

const get = (path: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', headers });
const page = async (path: string, headers: Record<string, string> = {}) =>
  (await get(path, headers)).text();

/** Which view radio is the one checked when the page loads. */
function openView(html: string): 'list' | 'map' | null {
  const checked = (id: string) =>
    new RegExp(`<input type="radio" name="view" id="${id}"[^>]*\\schecked`).test(html);
  if (checked('view-map') && !checked('view-list')) return 'map';
  if (checked('view-list') && !checked('view-map')) return 'list';
  return null;
}
const hrefs = (html: string, testid: string): string[] =>
  [...html.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(`data-testid="${testid}"`))
    .map((tag) => (tag.match(/href="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&'));
const areaLeads = (html: string): boolean =>
  html.indexOf('data-testid="landing-area"') < html.indexOf('data-testid="landing-doors"');

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare(`DELETE FROM shortlinks WHERE event_id LIKE 'mp-%'`).run();
  await tenv.DB.prepare(`DELETE FROM events WHERE id LIKE 'mp-%'`).run();
  await tenv.DB.prepare('DELETE FROM corridor_readiness_latch').run();
  // One short of the landing's rule.
  for (let i = 0; i < LIST_MAX - 1; i++) await seed(`mp-${i}`, i % 2 ? BLUE_ISLAND : BEVERLY);
});

describe('/map below the 10-event rule', () => {
  test('the seed holds one fewer than the rule', async () => {
    const row = await tenv.DB.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE brand_id = 'root' AND id LIKE 'mp-%'`
    ).first<{ n: number }>();
    expect(row?.n).toBe(LIST_MAX - 1);
  });

  test('the landing opens on the list, with the doors first', async () => {
    const html = await page('/');
    expect(openView(html)).toBe('list');
    expect(areaLeads(html)).toBe(false);
  });

  test('/map opens on the map view, with the area first', async () => {
    const res = await get('/map');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(openView(html)).toBe('map');
    expect(areaLeads(html)).toBe(true);
  });

  test('/map is no way round the rule: the note and the example, and no real area', async () => {
    const html = await page('/map');
    expect(html).toContain('data-testid="amap-example"');
    expect(html).not.toContain('data-cell=');
    expect(html).not.toContain(BLUE_ISLAND);
    expect(html).not.toContain(BEVERLY);
  });

  test('the list is still there at /map: every card, one tap away', async () => {
    const html = await page('/map');
    expect(html).toContain('for="view-list"');
    for (let i = 0; i < LIST_MAX - 1; i++) expect(html, `mp-${i}`).toContain(`Map page mp-${i}`);
  });
});

describe('/map at the 10-event rule', () => {
  beforeAll(async () => {
    await seed('mp-tenth', BLUE_ISLAND);
  });

  test('the map is drawn, with both areas', async () => {
    const html = await page('/map');
    expect(openView(html)).toBe('map');
    expect(html).toContain('data-testid="amap"');
    expect(html).toContain(`data-cell="${BLUE_ISLAND}"`);
    expect(html).toContain(`data-cell="${BEVERLY}"`);
    expect(html).not.toContain('data-testid="amap-example"');
  });

  test('every hexagon link stays on /map; the landing keeps its own', async () => {
    const onMap = hrefs(await page('/map'), 'amap-zoom');
    expect(onMap.length).toBeGreaterThanOrEqual(2);
    for (const h of onMap) expect(h).toMatch(/^\/map\?area=[0-9a-f]{15}$/);

    const onLanding = hrefs(await page('/'), 'amap-zoom');
    expect(onLanding.length).toBe(onMap.length);
    for (const h of onLanding) expect(h).toMatch(/^\/\?area=[0-9a-f]{15}$/);
  });

  test('zoomed in at /map: only that area, and Back to all areas returns to /map', async () => {
    const html = await page(`/map?area=${BLUE_ISLAND}`);
    expect(hrefs(html, 'amap-back')).toEqual(['/map']);
    expect(html).toContain('Map page mp-tenth');
    // mp-0 is in Beverly.
    expect(html).not.toContain('Map page mp-0<');
  });

  test('a zoom keeps the search it came with, and nothing else from the address', async () => {
    const html = await page(`/map?area=${BLUE_ISLAND}&zip=60406&utm_source=x&evil=%22%3E`);
    expect(hrefs(html, 'amap-back')).toEqual(['/map?zip=60406']);
    expect(html).not.toContain('utm_source');
    expect(html).not.toContain('evil=');
  });
});

describe('/map: rainy and edge', () => {
  test.each([
    ['not a cell', 'hello'],
    ['a finer cell', latLngToCell(41.657731, -87.680213, 9)],
    ['a padded cell', `00${BLUE_ISLAND}`],
    ['a cell cut short', BLUE_ISLAND.slice(0, 14)],
    ['markup', '%22%3E%3Cscript%3E'],
  ])('?area=%s is ignored: the whole map, nothing echoed', async (_name, value) => {
    const res = await get(`/map?area=${value}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`data-cell="${BEVERLY}"`);
    expect(html).not.toContain('data-testid="amap-back"');
    expect(html).not.toContain('<script>"');
    // Nothing typed is written back into a link or the canonical.
    expect(html).not.toContain(`${decodeURIComponent(value)}"`);
    for (const h of hrefs(html, 'amap-zoom')) expect(h).toMatch(/^\/map\?area=[0-9a-f]{15}$/);
  });

  test.each(['/map/', '/map/x', '/maps', '/MAP'])('%s is not the map page', async (path) => {
    const res = await get(path);
    const html = await res.text();
    expect(res.status === 200 && openView(html) === 'map', `${path}: ${res.status}`).toBe(false);
  });

  test('an area with nothing upcoming says so at /map, with the way back to /map', async () => {
    const empty = latLngToCell(41.8781, -87.6298, 7); // the Loop: no seeded event
    const html = await page(`/map?area=${empty}`);
    expect(html).toContain('data-testid="amap-zoom-empty"');
    expect(hrefs(html, 'amap-back')).toEqual(['/map']);
  });
});

describe('/map: a search made there answers there', () => {
  const action = (html: string) =>
    html.match(/<form class="where-form" method="get" action="([^"]*)"/)?.[1] ?? null;

  test('the box answers at /map, in each language; the landing keeps its own', async () => {
    expect(action(await page('/map'))).toBe('/map');
    expect(action(await page('/es/map'))).toBe('/es/map');
    expect(action(await page('/'))).toBe('/');
    expect(action(await page('/es/'))).toBe('/es/');
  });

  test('a name that is many places: every choice narrows it at /map', async () => {
    const html = await page('/map?where=Springfield');
    const choices = hrefs(html, 'where-choice');
    expect(choices.length).toBeGreaterThan(1);
    for (const h of choices) expect(h.startsWith('/map?where=Springfield')).toBe(true);
    expect(hrefs(html, 'where-change')).toEqual(['/map?change=1']);
    // The landing's choices stay on the landing.
    const landing = hrefs(await page('/?where=Springfield'), 'where-choice');
    expect(landing.length).toBe(choices.length);
    for (const h of landing) expect(h.startsWith('/?where=Springfield')).toBe(true);
  });

  const canonicals = (html: string) => html.match(/<link rel="canonical"[^>]*>/g) ?? [];

  test('a search that finds events is still the map page: the map view, and the canonical is /map', async () => {
    // A zip, one town, and a name that is many places. The seed has events in each.
    for (const path of ['/map?zip=60406', '/map?where=Blue%20Island', '/map?where=Beverly']) {
      const html = await page(path);
      expect(openView(html), path).toBe('map');
      expect(areaLeads(html), path).toBe(true);
      expect(html, path).toContain('for="view-list"');
      expect(canonicals(html), path).toHaveLength(1);
      expect(canonicals(html)[0], path).toContain(`href="${ORIGIN}/map"`);
      expect(hrefs(html, 'where-change'), path).toEqual(['/map?change=1']);
    }
  });

  test('a search that finds nothing says so at /map, and Change returns to /map', async () => {
    // The same three kinds of search, in places the seed has nothing.
    for (const path of ['/map?zip=99501', '/map?where=Oak%20Lawn', '/map?where=Springfield']) {
      const html = await page(path);
      expect(html, path).toContain('data-testid="area-empty-near"');
      expect(html, path).not.toContain('Map page mp-');
      expect(canonicals(html), path).toHaveLength(1);
      expect(canonicals(html)[0], path).toContain(`href="${ORIGIN}/map"`);
      expect(hrefs(html, 'where-change'), path).toEqual(['/map?change=1']);
    }
  });

  test('a typed name is escaped at /map as on the landing', async () => {
    const html = await page('/map?where=' + encodeURIComponent('"><script>x</script>'));
    expect(html).not.toContain('<script>x</script>');
    expect(action(html)).toBe('/map');
  });
});

describe('/map: "Use my location" answers there', () => {
  const near = (body: string) =>
    SELF.fetch(`${ORIGIN}/near`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  /** The hidden fields of the location form, in order: [name, value]. */
  const nearFields = (html: string): string[][] => {
    const form = html.match(/<form id="near-form"[\s\S]*?<\/form>/)?.[0] ?? '';
    return [...form.matchAll(/<input type="hidden" name="([^"]*)"(?: value="([^"]*)")? \/>/g)].map(
      (m) => [m[1], m[2] ?? '']
    );
  };

  test('the form on /map says it is the map page; the landing form is as it was', async () => {
    expect(nearFields(await page('/map'))).toEqual([
      ['g', ''],
      ['page', 'map'],
    ]);
    expect(nearFields(await page('/es/map'))).toEqual([
      ['g', ''],
      ['lang', 'es'],
      ['page', 'map'],
    ]);
    expect(nearFields(await page('/'))).toEqual([['g', '']]);
    expect(nearFields(await page('/es/'))).toEqual([
      ['g', ''],
      ['lang', 'es'],
    ]);
  });

  test('a box sent from /map goes to /map for the nearest zip, in the page language', async () => {
    const res = await near('g=dp3su&page=map');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/map?zip=60469');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect((await near('g=dp3su&page=map&lang=es')).headers.get('Location')).toBe(
      '/es/map?zip=60469'
    );
    // Outside the US: the note, on the map page.
    expect((await near('g=u09tv&page=map')).headers.get('Location')).toBe('/map?nozip=1');
    const html = await page('/map?nozip=1');
    expect(html).toContain('data-testid="where-msg"');
    expect(openView(html)).toBe('map');
  });

  test('a box sent from the landing still goes to the landing', async () => {
    expect((await near('g=dp3su')).headers.get('Location')).toBe('/?zip=60469');
    expect((await near('g=dp3su&lang=es')).headers.get('Location')).toBe('/es/?zip=60469');
  });

  test('one word is taken for the page, never an address: anything else is the landing', async () => {
    for (const p of ['Map', 'map/', '/map', 'maps', 'https://example.com', '//example.com', '']) {
      const res = await near(`g=dp3su&page=${encodeURIComponent(p)}`);
      expect(res.status, p).toBe(303);
      expect(res.headers.get('Location'), p).toBe('/?zip=60469');
    }
  });

  test('a box that is not a box is refused from /map as from the landing', async () => {
    const res = await near('g=41.6571,-87.6798&page=map');
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });
});

describe('/map: its own address in every language', () => {
  test('the canonical is /map, once', async () => {
    const html = await page('/map?ref=x');
    const tags = html.match(/<link rel="canonical"[^>]*>/g) ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain(`href="${ORIGIN}/map"`);
  });

  test('/es/map is the same page in Spanish, and its links stay on /es/map', async () => {
    const res = await get('/es/map');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<html[^>]*\blang="es"/);
    expect(openView(html)).toBe('map');
    const zooms = hrefs(html, 'amap-zoom');
    expect(zooms.length).toBeGreaterThanOrEqual(2);
    for (const h of zooms) expect(h).toMatch(/^\/es\/map\?area=[0-9a-f]{15}$/);
    expect(html).toContain(`href="${ORIGIN}/es/map"`);
  });

  test('the alternates name /map in each language, never the landing', async () => {
    const html = await page('/map');
    const alts = html.match(/<link rel="alternate" hreflang="[^"]*" href="[^"]*"/g) ?? [];
    expect(alts.length).toBeGreaterThanOrEqual(2);
    for (const a of alts) expect(a).toMatch(/\/map"$/);
  });

  test('one h1, as on every page', async () => {
    expect((await page('/map')).match(/<h1[\s>]/g) ?? []).toHaveLength(1);
  });
});

// The way to the map (owner, 2026-11-17): the top menu of the landing and of
// /map offers Events and then Map. On /map the Map link says it is this page.
describe('the top menu: the way to the map, and which page this is', () => {
  /** The header menu's links, in the order they are written. */
  const menu = (html: string) => {
    const nav = html.match(/<nav data-testid="landing-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
    return [...nav.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map((m) => ({
      id: m[1].match(/data-testid="([^"]*)"/)?.[1] ?? '',
      href: m[1].match(/href="([^"]*)"/)?.[1] ?? '',
      words: m[2].trim(),
      current: m[1].match(/aria-current="([^"]*)"/)?.[1] ?? null,
    }));
  };
  const pageMarks = (html: string) => html.match(/aria-current="page"/g) ?? [];

  test.each([
    ['/', '/events', 'Events', '/map', 'Map'],
    ['/home', '/events', 'Events', '/map', 'Map'],
    ['/es/', '/es/events', 'Eventos', '/es/map', 'Mapa'],
    ['/pl/', '/pl/events', 'Wydarzenia', '/pl/map', 'Mapa'],
    ['/ar/', '/ar/events', 'الفعاليات', '/ar/map', 'الخريطة'],
  ])(
    'the landing at %s offers Events and then Map, in its language, and marks neither',
    async (path, events, eventsWords, map, mapWords) => {
      const html = await page(path);
      expect(menu(html)).toEqual([
        { id: 'nav-events', href: events, words: eventsWords, current: null },
        { id: 'nav-map', href: map, words: mapWords, current: null },
      ]);
      expect(pageMarks(html)).toHaveLength(0);
    }
  );

  test.each([
    ['/map', '/events', 'Events', '/map', 'Map'],
    ['/es/map', '/es/events', 'Eventos', '/es/map', 'Mapa'],
    ['/pl/map', '/pl/events', 'Wydarzenia', '/pl/map', 'Mapa'],
    ['/ar/map', '/ar/events', 'الفعاليات', '/ar/map', 'الخريطة'],
  ])(
    'at %s the Map link is the page being read, once, and Events is not',
    async (path, events, eventsWords, map, mapWords) => {
      const html = await page(path);
      expect(menu(html)).toEqual([
        { id: 'nav-events', href: events, words: eventsWords, current: null },
        { id: 'nav-map', href: map, words: mapWords, current: 'page' },
      ]);
      expect(pageMarks(html)).toHaveLength(1);
    }
  );

  test('the landing marks no link, whichever view it opens on', async () => {
    // At the rule the landing opens on its map, and a zoom keeps it there; a
    // search opens it on the list. It is the landing each time.
    for (const [path, view] of [
      ['/', 'map'],
      [`/?area=${BLUE_ISLAND}`, 'map'],
      ['/?zip=60406', 'list'],
    ]) {
      const html = await page(path);
      expect(openView(html), path).toBe(view);
      expect(
        menu(html).map((l) => l.current),
        path
      ).toEqual([null, null]);
      expect(pageMarks(html), path).toHaveLength(0);
    }
  });

  test('a zoom or a search at /map keeps the mark; a zoom carries nothing, a search carries its place (OSE-2165)', async () => {
    for (const [path, query] of [
      [`/map?area=${BLUE_ISLAND}`, ''],
      ['/map?zip=60406', '?zip=60406'],
      ['/map?where=Springfield', '?where=Springfield'],
      ['/map?nozip=1', ''],
      ['/map?change=1', ''],
    ]) {
      const html = await page(path);
      expect(menu(html)[1], path).toEqual({
        id: 'nav-map',
        href: `/map${query}`,
        words: 'Map',
        current: 'page',
      });
      expect(menu(html)[0].href, path).toBe(`/events${query}`);
      expect(pageMarks(html), path).toHaveLength(1);
    }
  });

  test('nothing a visitor types reaches the menu or adds a mark', async () => {
    const typed = '"><a href="/x" data-testid="nav-map" aria-current="page">x</a>';
    const html = await page(`/map?where=${encodeURIComponent(typed)}&area=${typed.length}`);
    expect(menu(html)).toEqual([
      { id: 'nav-events', href: '/events', words: 'Events', current: null },
      { id: 'nav-map', href: '/map', words: 'Map', current: 'page' },
    ]);
    expect(pageMarks(html)).toHaveLength(1);
    expect(hrefs(html, 'nav-map')).toEqual(['/map']);
  });

  test('the page being read is said in weight as well as in colour', async () => {
    const html = await page('/map');
    // One rule draws the name and the page being read: heavy, in the text colour.
    const rule = html.match(/\[aria-current='page'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/font-weight:\s*700/);
    expect(rule).toMatch(/color:\s*var\(--text\)/);
  });

  test('the menu is still one nav with a name, and the page still has one h1', async () => {
    for (const path of ['/', '/map', '/ar/map']) {
      const html = await page(path);
      expect(html.match(/<nav data-testid="landing-nav" aria-label="[^"]+"/g), path).toHaveLength(
        1
      );
      expect(html.match(/<h1[\s>]/g) ?? [], path).toHaveLength(1);
    }
  });
});

describe('/map: never who', () => {
  beforeAll(async () => {
    // One event gets a place, and two codes on its poster: a giving link and a
    // check-in code. The map may offer the first and never the second.
    await tenv.DB.prepare(`UPDATE events SET lat = ?, lon = ? WHERE id = 'mp-tenth'`)
      .bind(41.657731, -87.680213)
      .run();
    await tenv.DB.prepare(
      `INSERT INTO shortlinks (code, event_id, kind, target_url, poster_position) VALUES
         ('mpgive', 'mp-tenth', 'donation', 'https://give.example/map-page', 1),
         ('mpchek', 'mp-tenth', 'checkin', '${ORIGIN}/forms/mp-tenth?type=checkin', 2)`
    ).run();
  });

  test('no cookie is set, with or without a zoom', async () => {
    for (const path of ['/map', `/map?area=${BLUE_ISLAND}`, '/es/map']) {
      const res = await get(path);
      expect(res.headers.get('Set-Cookie'), path).toBeNull();
      await res.arrayBuffer();
    }
  });

  test('no link on the page at /map reaches a scan code or check-in', async () => {
    const html = await page(`/map?area=${BLUE_ISLAND}`);
    const all = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(all.length).toBeGreaterThan(0);
    for (const h of all) expect(h).not.toMatch(/^\/(q|s)\/|\/checkin(\b|$)/);
  });

  // The landing's own rule for the zoomed map (tests/map-place-links.spec.ts),
  // held at /map against real rows: the place's panel offers the giving link,
  // and nothing in the map reaches tracking or check-in.
  test('the zoomed map at /map offers the giving link and never the check-in code', async () => {
    const html = await page(`/map?area=${BLUE_ISLAND}`);
    const wrap = html.slice(html.indexOf('data-testid="amap-wrap"'));
    const area = wrap.slice(0, wrap.indexOf('data-testid="area-list"'));
    expect(area).toContain('data-testid="amap-panel"');
    expect(area).toContain('href="https://give.example/map-page"');
    const inMap = [...area.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(inMap.length).toBeGreaterThan(1);
    for (const h of inMap) {
      expect(h, h).not.toMatch(/^\/(q|s|e|r|c)\//);
      expect(h, h).not.toMatch(/checkin/);
    }
  });
});
