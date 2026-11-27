/**
 * One report for a parent company over every venture (Part of OSE-2241).
 *
 * Owner, 2026-11-27: a parent company sees all the traffic, the events and
 * the sponsor traffic of every venture below it in one report, and shares it
 * with a corporate sponsor as one link.
 *
 * What this holds:
 *   - each venture is floored on its own before it joins the family total, and
 *     the lines add up to the total;
 *   - a venture's member, another company and the public brand cannot read the
 *     parent's report (404, the same as an unknown brand);
 *   - a sponsor and its traffic count only where both sides said yes;
 *   - the answer holds no event id, title or person;
 *   - the signed link reads its own brand only; a changed token, an event
 *     SharedReport token and a link minted by a venture are all refused;
 *   - the page has no script, is never cached and reads by name.
 *
 * @born-red OSE-2241 | method: (1) the family total summed the raw venture
 *   cells and floored once; (2) brandInScope returned true for any brand; (3)
 *   the sponsor queries dropped PLACEMENT_ON_SHOW_SQL; (4) the token was signed
 *   without the family-report domain | date: 2026-11-27 | verified: (1) turned
 *   "each venture floored on its own" red, (2) the three isolation tests, (3)
 *   the consent test, (4) the event-token test; the rest stayed green.
 */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';
import { footprintSvg, FOOTPRINT_CITIES } from '../src/handlers/family-report';
import { seedPosterHour } from './helpers/seed-poster-hours';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const routerEnv = env as unknown as RouterEnv;

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function as(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
    'Sec-Fetch-Site': 'same-origin',
  };
}

async function send(req: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(req, routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function call(method: string, path: string, email: string, body?: unknown) {
  const headers = as(email);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return send(new Request(`https://ose.test${path}`, init));
}

const CO = 'fr-co';
const CLUB = 'fr-club';
const LEAGUE = 'fr-league';
const OTHER = 'fr-other';
const CO_ADMIN = 'fr-co@example.com';
const CLUB_ADMIN = 'fr-club@example.com';
const OTHER_ADMIN = 'fr-other@example.com';

const CELL_A = '872664c1affffff';
const CELL_B = '872664c1effffff';

interface Floored {
  count: number | null;
  suppressed: boolean;
}
interface Report {
  family: { parent: string; ventures: string[] };
  totals: {
    ventures: number;
    events: number;
    poster_scans: Floored;
    sponsor_displays: Floored;
    businesses_on_show: number;
    map_cells: number;
    venues: number;
  };
  by_venture: Array<{
    brand: string;
    role: string;
    events: number;
    poster_scans: Floored;
    sponsor_displays: Floored;
  }>;
  by_venue: Array<{ name: string; events: number }>;
  footprint: Array<{ cell: string }>;
  sponsors: string[];
}

async function event(id: string, brand: string, cell: string, venue: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, h3_res7, host_venue_id, settings_json)
     VALUES (?, ?, ?, ?, 'active', '2026-11-04', ?, ?, '{"useSponsors":true}')
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(id, brand, `Secret title ${id}`, `slug-${id}`, cell, venue)
    .run();
}

async function sponsor(id: string, brand: string, eventId: string, organizerYes: number) {
  await env.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`
  )
    .bind(id, brand, `Sponsor ${id}`)
    .run();
  await env.DB.prepare(
    `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted, organizer_accepted)
     VALUES (?, ?, ?, 'standard', 'organizer', 1, 1, ?) ON CONFLICT(id) DO NOTHING`
  )
    .bind(`sp-${id}`, id, eventId, organizerYes)
    .run();
  for (let i = 0; i < 12; i++) {
    await env.DB.prepare(
      `INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type)
       VALUES (?, ?, ?, 'public', 'strip', 'display') ON CONFLICT(id) DO NOTHING`
    )
      .bind(`sd-${id}-${i}`, id, eventId)
      .run();
  }
}

async function report(brand: string, email = CO_ADMIN): Promise<Response> {
  return call('GET', `/api/v2/admin/brands/${brand}/family-report`, email);
}

beforeAll(async () => {
  await applyMigrations();
  for (const child of [CLUB, LEAGUE]) {
    await env.DB.prepare(
      `INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES (?, ?) ON CONFLICT(brand_id) DO NOTHING`
    )
      .bind(child, CO)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO venues (id, brand_id, name) VALUES ('ven_${'f'.repeat(32)}', ?, 'The Clubhouse')
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(CO)
    .run();
  (routerEnv as { ADMIN_BRAND_MEMBERSHIP?: string }).ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    [CO_ADMIN]: [CO],
    [CLUB_ADMIN]: [CLUB],
    [OTHER_ADMIN]: [OTHER],
  });
  await event('fr-e-co', CO, CELL_A);
  await event('fr-e-club', CLUB, CELL_A, `ven_${'f'.repeat(32)}`);
  await event('fr-e-league', LEAGUE, CELL_B);
  await event('fr-e-other', OTHER, CELL_B);
  // The club: 7 scans in one poster-hour. The league: 3 in each of two
  // poster-hours (6 in all, every cell under the floor). The parent: none.
  // The other company: 40, and must never appear.
  await seedPosterHour(env.DB, 'fr-e-club', 20, 7);
  await seedPosterHour(env.DB, 'fr-e-league', 19, 3);
  await seedPosterHour(env.DB, 'fr-e-league', 21, 3);
  await seedPosterHour(env.DB, 'fr-e-other', 19, 40);
  // A sponsor both sides agreed to, and one the organizer has not.
  await sponsor('fr-sb-yes', CLUB, 'fr-e-club', 1);
  await sponsor('fr-sb-no', CLUB, 'fr-e-club', 0);
});

describe('the parent reads one report over every venture', () => {
  test('the family is the parent and every brand below it', async () => {
    const res = await report(CO);
    expect(res.status).toBe(200);
    const r = (await res.json()) as Report;
    expect(r.family.parent).toBe(CO);
    expect(r.family.ventures.sort()).toEqual([CLUB, LEAGUE]);
    expect(r.totals.ventures).toBe(3);
    expect(r.totals.events).toBe(3);
    expect(r.by_venture.find((l) => l.brand === CO)?.role).toBe('parent');
  });

  test('each venture is floored on its own before it is added', async () => {
    const r = (await (await report(CO)).json()) as Report;
    const line = (b: string) => r.by_venture.find((l) => l.brand === b)!;
    expect(line(CLUB).poster_scans.count).toBe(5); // 7 → rounded down to 5
    expect(line(LEAGUE).poster_scans.suppressed).toBe(true); // 3 + 3, each cell under 5
    // Raw 7 + 3 + 3 = 13 would publish 10; floored per venture it is 5.
    expect(r.totals.poster_scans.count).toBe(5);
    const sum = r.by_venture.reduce((s, l) => s + (l.poster_scans.count ?? 0), 0);
    expect(sum).toBe(r.totals.poster_scans.count);
  });

  test('the footprint and the venues come from the family only', async () => {
    const r = (await (await report(CO)).json()) as Report;
    expect(r.footprint.map((c) => c.cell).sort()).toEqual([CELL_A, CELL_B]);
    expect(r.by_venue).toEqual([expect.objectContaining({ name: 'The Clubhouse', events: 1 })]);
  });

  test('a sponsor and its traffic count only where both sides said yes', async () => {
    const r = (await (await report(CO)).json()) as Report;
    expect(r.sponsors).toEqual(['Sponsor fr-sb-yes']);
    expect(r.totals.businesses_on_show).toBe(1);
    // 12 displays of the agreed sponsor → 10; the other sponsor's 12 never join.
    expect(r.totals.sponsor_displays.count).toBe(10);
  });

  test('no event id, title or person in the answer', async () => {
    const text = await (await report(CO)).text();
    expect(text).not.toMatch(/fr-e-|Secret title|"(event_id|title|email|anon[a-z_]*)"/);
  });
});

describe('no one else reads the parent report', () => {
  test('a venture member cannot read the parent: 404', async () => {
    expect((await report(CO, CLUB_ADMIN)).status).toBe(404);
  });

  test('a venture member reads only its own venture', async () => {
    const r = (await (await report(CLUB, CLUB_ADMIN)).json()) as Report;
    expect(r.by_venture.map((l) => l.brand)).toEqual([CLUB]);
  });

  test('another company cannot read it: 404', async () => {
    expect((await report(CO, OTHER_ADMIN)).status).toBe(404);
  });

  test('the public and platform brands have no family report', async () => {
    for (const b of ['root', 'ose-platform']) {
      expect((await report(b, OTHER_ADMIN)).status, b).toBe(404);
    }
  });
});

describe('the signed link', () => {
  async function mint(brand: string, email = CO_ADMIN, body: unknown = {}) {
    return call('POST', `/api/v2/admin/brands/${brand}/family-report/mint-link`, email, body);
  }
  function readByLink(token: string) {
    return send(
      new Request('https://ose.test/api/v2/family-report', {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
  }

  test('the parent mints a link and it reads the same family', async () => {
    const res = await mint(CO);
    expect(res.status).toBe(200);
    const { token, path } = (await res.json()) as { token: string; path: string };
    expect(path).toBe(`/family-report?token=${encodeURIComponent(token)}`);
    const read = await readByLink(token);
    expect(read.status).toBe(200);
    const r = (await read.json()) as Report;
    expect(r.family.parent).toBe(CO);
    expect(r.totals.poster_scans.count).toBe(5);
  });

  test('a venture member cannot mint the parent link, and the try is audited', async () => {
    expect((await mint(CO, CLUB_ADMIN)).status).toBe(404);
    const row = await env.DB.prepare(
      `SELECT outcome FROM admin_audit_log WHERE action = 'MINT_FAMILY_REPORT_LINK'
        AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
    )
      .bind(CO)
      .first<{ outcome: string }>();
    expect(row?.outcome).toBe('denied');
  });

  test('a link lives 1 to 90 days', async () => {
    for (const ttl_days of [0, 91, 1.5, '7']) {
      expect((await mint(CO, CO_ADMIN, { ttl_days })).status, String(ttl_days)).toBe(400);
    }
  });

  test('a changed token, no token and an event SharedReport token are refused', async () => {
    const { token } = (await (await mint(CO)).json()) as { token: string };
    const [payload, sig] = token.split('.');
    const forged = `${b64url({ kind: 'family', brand: OTHER, dc: 'all', exp: 9999999999 })}.${sig}`;
    expect((await readByLink(forged)).status).toBe(401);
    expect((await readByLink(`${payload}.${'0'.repeat(64)}`)).status).toBe(401);
    expect((await send(new Request('https://ose.test/api/v2/family-report'))).status).toBe(401);
    const eventToken = await mintSignedLinkToken(
      routerEnv as unknown as { SHARED_REPORT_SIGNING_SECRET?: string },
      'fr-e-co',
      'admin'
    );
    expect(eventToken).toBeTruthy();
    expect((await readByLink(eventToken as string)).status).toBe(401);
  });

  test('the page: by name, no script, never cached, never indexed', async () => {
    const { token } = (await (await mint(CO)).json()) as { token: string };
    const res = await send(
      new Request(`https://ose.test/family-report?token=${encodeURIComponent(token)}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'none'");
    const html = await res.text();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).not.toContain('<script');
    expect(html).toContain('<svg class="fp-map"');
    expect(html).not.toMatch(/fr-e-|Secret title/);
  });

  test('the map always spans the whole region, Milwaukee to Kankakee, Rockford to St. Joseph', () => {
    // With no area yet, the frame and every city still draw.
    for (const svg of [
      footprintSvg([]),
      footprintSvg([
        {
          cell: '872664c1affffff',
          events: 1,
          poster_scans: { count: 5, suppressed: false, floor: 5 },
        } as never,
      ]),
    ]) {
      for (const [name] of FOOTPRINT_CITIES) expect(svg).toContain(`>${name}</text>`);
    }
    expect(FOOTPRINT_CITIES.map(([n]) => n)).toEqual([
      'Milwaukee',
      'Rockford',
      'Kankakee',
      'Valparaiso',
      'South Bend',
      'St. Joseph',
    ]);
    // An area far outside the region widens the frame instead of being cut off.
    const near = footprintSvg([]).match(/viewBox="0 0 (\d+) (\d+)"/)!;
    const far = footprintSvg([
      {
        cell: '872830828ffffff',
        events: 1,
        poster_scans: { count: 5, suppressed: false, floor: 5 },
      } as never,
    ]).match(/viewBox="0 0 (\d+) (\d+)"/)!;
    expect(Number(far[1]) / Number(far[2])).not.toBeCloseTo(Number(near[1]) / Number(near[2]), 2);
  });

  test('the page with a bad link says so, and shows nothing', async () => {
    const res = await send(new Request('https://ose.test/family-report?token=nope.nope'));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('not valid');
  });
});
