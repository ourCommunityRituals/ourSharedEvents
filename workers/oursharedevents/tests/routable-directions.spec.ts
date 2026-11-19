/**
 * OSE-2196 — no route to an event that is private or off the map.
 *
 * Owner ruling, 2026-11-19: "Anything that is listed as private or off map
 * cannot be routed to." Directions are for LISTED places only. One rule decides
 * it, isRoutable / eventRoutableSql in src/domain/event-state.ts: live
 * (status renders on 'public'), on the map (is_published = 1) and past its
 * publish grace (listed_from). Every surface that offers a route asks it:
 *
 *   - the event page, pre-event and live (handlers/pages.ts, renderGeoLink);
 *   - the poster (the bundle's `routable`, handlers/poster-bundle.ts; the
 *     poster's script draws its Google / Apple Maps buttons only on `true`);
 *   - the map panel's "Take me there" (lib/map-place-panel.ts), whose events
 *     come from the list query (lib/data-provider.ts fetchEvents), built on
 *     eventRoutableSql.
 *   - The display (TV) offers no route at all.
 *
 * An off-map event still opens at its link (PO 2026-10-07); it offers no route.
 * A listed event keeps its directions exactly as before (the controls below,
 * and tests/language-layer-golden.spec.ts byte for byte).
 *
 * Runtime-bound (SELF.fetch, env.DB) → workers pool. The staging layer is the
 * Bruno Pages folder "17. Routable (OSE-2196)", on bruno/fixtures/routable-seed.sql.
 *
 * @born-red OSE-2196 | method: each fault applied alone to the source, this
 * file run, the named tests watched red, the fault reverted:
 *   (a1) the pre-event page's isRoutable gate replaced by `true` → "pre-event:
 *        off-map", "no coordinate reaches", the grace case red;
 *   (a2) the live page's gate replaced by `true` → "live: off-map", "no
 *        coordinate reaches", the grace case red;
 *   (b)  the is_published test dropped from isRoutable → the page, poster,
 *        preview and TS-rule cases red;
 *   (c)  the listed_from test dropped from isRoutable → the grace cases and
 *        the TS rule red;
 *   (d)  the bundle's `routable` hard-coded true → both poster cases red;
 *   (e)  eventRoutableSql letting is_published 0 through → the map panel and
 *        the SQL-rule cases red;
 *   (j)  isRoutable always false → both listed controls, the poster control,
 *        the preview and the TS rule red.
 *   date: 2026-11-19
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { eventRoutableSql, isRoutable } from '../src/domain/event-state';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const ORIGIN = 'https://localhost';
const AS_PERSON = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

// Eagles Hall, Blue Island IL: res-7 cell 872664544ffffff. The coordinates are
// written with digits no other part of the page carries, so a search for them
// finds only a coordinate.
const LAT = 41.657317;
const LON = -87.680643;
const RES7 = '872664544ffffff';
const ADDRESS = '2196 South Routable Ave, Blue Island IL 60406';
const OFFMAP_ADDRESS = '9999 West Unlisted Rd, Blue Island IL 60406';

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

interface Seed {
  id: string;
  status?: string;
  isPublished?: number;
  /** SQL expression for listed_from; default NULL (listed as before 0093). */
  listedFromSql?: string;
  /** 'pre' starts three days out; 'live' runs from yesterday to tomorrow. */
  phase?: 'pre' | 'live';
  address?: string;
  cell?: boolean;
}

async function seed(s: Seed): Promise<void> {
  const live = s.phase === 'live';
  await E.DB.prepare('DELETE FROM events WHERE id = ?').bind(s.id).run();
  await E.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from,
                         location, where_address, lat, lon, h3_res7, start_date, end_date,
                         timezone, created_at, updated_at)
     VALUES (?, 'root', ?, ?, ?, ?, ${s.listedFromSql ?? 'NULL'},
             'Eagles Hall', ?, ?, ?, ?,
             ${live ? "date('now', '-1 day')" : "date('now', '+3 day')"},
             ${live ? "date('now', '+1 day')" : "date('now', '+3 day')"},
             'America/Chicago', datetime('now'), datetime('now'))`
  )
    .bind(
      s.id,
      `Title of ${s.id}`,
      s.id,
      s.status ?? 'active',
      s.isPublished ?? 1,
      s.address ?? ADDRESS,
      LAT,
      LON,
      s.cell ? RES7 : null
    )
    .run();
}

const page = async (id: string): Promise<string> => {
  const res = await SELF.fetch(`${ORIGIN}/events/${id}`, { headers: AS_PERSON });
  expect(res.status, `/events/${id}`).toBe(200);
  return res.text();
};

/** Every outbound maps link in a page, of any kind. */
const MAPS_LINK =
  /href="(?:https?:\/\/(?:www\.)?google\.[a-z.]+\/maps|https?:\/\/maps\.google|https?:\/\/maps\.apple\.com|geo:|maps:)[^"]*"/gi;

function expectNoRoute(html: string, where: string): void {
  expect(html, `${where}: a Directions menu`).not.toMatch(/data-testid="geo-link/);
  expect(html, `${where}: the directions class`).not.toContain('ose-directions-menu');
  expect(html.match(MAPS_LINK) ?? [], `${where}: a maps link`).toEqual([]);
}

function expectNoCoordinate(html: string, where: string): void {
  expect(html, `${where}: the latitude`).not.toContain(String(LAT));
  expect(html, `${where}: the longitude`).not.toContain(String(LON));
  // The coordinates as a link writes them (41.657317%2C-87.680643, ll=…).
  expect(html, `${where}: a coordinate pair`).not.toMatch(/41\.657\d*(?:%2C|,)\s*-87\.680/);
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
  await E.DB.prepare("DELETE FROM events WHERE id LIKE 'rt-%' OR id LIKE 'rtp-%'").run();

  // Off the map (is_published = 0), live, with exact coordinates and an address.
  await seed({ id: 'rt-offmap-pre', isPublished: 0 });
  await seed({ id: 'rt-offmap-live', isPublished: 0, phase: 'live' });
  // Listed controls: the same event on the map.
  await seed({ id: 'rt-listed-pre' });
  await seed({ id: 'rt-listed-live', phase: 'live' });
  // Listed, but still inside its publish grace: off the map for now.
  await seed({
    id: 'rt-grace-pre',
    listedFromSql: "strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')",
  });
  await seed({
    id: 'rt-grace-live',
    phase: 'live',
    listedFromSql: "strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')",
  });
});

// ─── 1. The event page ────────────────────────────────────────────────────────

describe('1. the event page offers no route to an off-map event', () => {
  test('pre-event: an active, off-map event has no Directions menu', async () => {
    const html = await page('rt-offmap-pre');
    // It still opens for anyone with its link (PO 2026-10-07).
    expect(html).toContain('Title of rt-offmap-pre');
    expect(html).toContain('data-testid="event-where"');
    expectNoRoute(html, 'off-map pre-event page');
  });

  test('live: an active, off-map event has no Directions menu', async () => {
    const html = await page('rt-offmap-live');
    expect(html).toContain('Title of rt-offmap-live');
    expect(html, 'the live page rendered').toContain('data-testid="event-where-live"');
    expectNoRoute(html, 'off-map live page');
  });

  test('no coordinate reaches an off-map event page, pre-event or live', async () => {
    expectNoCoordinate(await page('rt-offmap-pre'), 'off-map pre-event page');
    expectNoCoordinate(await page('rt-offmap-live'), 'off-map live page');
  });

  test('inside the publish grace (listed, not yet on the map): no route', async () => {
    expectNoRoute(await page('rt-grace-pre'), 'grace pre-event page');
    expectNoRoute(await page('rt-grace-live'), 'grace live page');
  });

  test('control: a listed event keeps its Directions menu, at its coordinates, pre-event', async () => {
    const html = await page('rt-listed-pre');
    expect(html).toContain('data-testid="geo-link"');
    expect(html).toContain(
      `href="https://www.google.com/maps/search/?api=1&amp;query=${LAT}%2C${LON}"`
    );
    expect(html).toContain(`href="https://maps.apple.com/?ll=${LAT},${LON}&amp;q=Eagles%20Hall"`);
  });

  test('control: a listed event keeps its Directions menu, live', async () => {
    const html = await page('rt-listed-live');
    expect(html).toContain('data-testid="geo-link-live"');
    expect(html).toContain(`query=${LAT}%2C${LON}`);
  });
});

// ─── 2. The poster ────────────────────────────────────────────────────────────

describe('2. the poster offers no route to an off-map event', () => {
  const bundle = async (id: string) => {
    const res = await SELF.fetch(`${ORIGIN}/api/v2/events/${id}/poster-bundle`);
    expect(res.status, `${id} poster bundle`).toBe(200);
    return (await res.json()) as {
      routable: unknown;
      event: Record<string, unknown>;
    };
  };

  test('an off-map event: the bundle says routable false', async () => {
    expect((await bundle('rt-offmap-pre')).routable).toBe(false);
    expect((await bundle('rt-offmap-live')).routable).toBe(false);
  });

  test('inside the publish grace: routable false', async () => {
    expect((await bundle('rt-grace-pre')).routable).toBe(false);
  });

  test('control: a listed event: routable true', async () => {
    expect((await bundle('rt-listed-pre')).routable).toBe(true);
    expect((await bundle('rt-listed-live')).routable).toBe(true);
  });

  test('the listing columns read for it never leave the handler', async () => {
    const b = await bundle('rt-offmap-pre');
    expect(Object.keys(b.event)).not.toContain('is_published');
    expect(Object.keys(b.event)).not.toContain('listed_from');
  });
});

// ─── 3. The map panel ─────────────────────────────────────────────────────────

describe('3. the map panel offers "Take me there" to listed events only', () => {
  beforeAll(async () => {
    await seed({ id: 'rt-map-listed', cell: true });
    await seed({ id: 'rt-map-offmap', isPublished: 0, cell: true, address: OFFMAP_ADDRESS });
    await seed({
      id: 'rt-map-grace',
      cell: true,
      address: OFFMAP_ADDRESS,
      listedFromSql: "strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')",
    });
  });

  test('the zoomed map routes to the listed event and never to the off-map ones', async () => {
    const res = await SELF.fetch(`${ORIGIN}/?area=${RES7}`, { headers: AS_PERSON });
    expect(res.status).toBe(200);
    const html = await res.text();
    const go = [...html.matchAll(/<a [^>]*data-testid="amap-go-(?:google|apple)"[^>]*>/g)].map(
      (m) => m[0]
    );
    // The control: the listed event's panel has its two buttons.
    expect(
      go.some((a) => a.includes(encodeURIComponent(ADDRESS))),
      'listed: Take me there'
    ).toBe(true);
    // Neither off-map event reaches the map's page at all, so no route to it.
    expect(html).not.toContain('Title of rt-map-offmap');
    expect(html).not.toContain('Title of rt-map-grace');
    expect(html).not.toContain(encodeURIComponent(OFFMAP_ADDRESS));
    expect(html).not.toContain(OFFMAP_ADDRESS);
  });
});

// ─── 4. One rule ──────────────────────────────────────────────────────────────

describe('4. one rule: isRoutable and eventRoutableSql agree on every marker', () => {
  const cases: Array<{
    id: string;
    status: string;
    pub: number;
    listedFrom: string | null;
    want: boolean;
  }> = [];
  const past = '2026-01-01T00:00:00.000Z';
  const future = '2999-01-01T00:00:00.000Z';
  for (const status of ['draft', 'ready', 'active', 'archived', 'ACTIVE', '']) {
    for (const pub of [0, 1]) {
      for (const listedFrom of [null, past, future, 'not-a-date']) {
        // The stored state exactly: a stray 'ACTIVE' is not a state.
        const want =
          status === 'active' && pub === 1 && (listedFrom === null || listedFrom === past);
        cases.push({ id: `rtp-${cases.length}`, status, pub, listedFrom, want });
      }
    }
  }

  test('the TS rule', () => {
    for (const c of cases) {
      expect(
        isRoutable({ status: c.status, is_published: c.pub, listed_from: c.listedFrom }),
        JSON.stringify(c)
      ).toBe(c.want);
    }
  });

  test('the SQL rule selects exactly the rows the TS rule allows', async () => {
    for (const c of cases) {
      await E.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from, created_at, updated_at)
         VALUES (?, 'rtp-brand', 'T', ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
        .bind(c.id, c.id, c.status, c.pub, c.listedFrom)
        .run();
    }
    const { results } = await E.DB.prepare(
      `SELECT id, status, is_published, listed_from FROM events
        WHERE brand_id = 'rtp-brand' AND ${eventRoutableSql()}`
    ).all<{ id: string; status: string; is_published: number; listed_from: string | null }>();
    const sql = new Set((results ?? []).map((r) => r.id));
    for (const c of cases) {
      expect(sql.has(c.id), JSON.stringify(c)).toBe(c.want);
    }
  });

  test('an admin draft preview answers for the event once published', () => {
    expect(isRoutable({ status: 'draft', is_published: 1 }, { asPublished: true })).toBe(true);
    expect(isRoutable({ status: 'draft', is_published: 0 }, { asPublished: true })).toBe(false);
    expect(isRoutable({ status: 'draft', is_published: 1 })).toBe(false);
  });
});
