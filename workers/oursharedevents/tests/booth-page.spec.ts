/**
 * The public stall page (OSE-1998, OSE ADR-034 decisions 1 and 5).
 *
 *   GET /events/:id/booths/:number
 *
 * Held here:
 *   1. a stall in use of a live fair renders: the fair's title and date, the
 *      sponsor strip when the fair has sponsors on show (AGENTS.md invariant 6:
 *      below the title and date, above the content), the stall's number, name
 *      and category, a link to the fair's page; exactly one <h1>;
 *   2. the number is read in any case and as typed on the table card;
 *   3. an unknown event, an event that is not public, an unknown number and a
 *      stall out of use answer the same 404, byte for byte;
 *   4. a hostile name or number is escaped, never markup;
 *   5. no cookie, no count of any kind;
 *   6. the route is rate-limited as a public read.
 *
 * @born-red OSE-1998 | method: written before the route existed (every
 * address fell to the router's own 404: 21 of 28 red; the 404 copy check
 * then went red once more until it compared the escaped copy), then five
 * faults, one at a time, each restored before the next:
 *   1. `AND b.is_active = 1` taken out of the by-number statement: 3 red;
 *   2. the public-state gate in the handler removed: 5 red;
 *   3. the escaper on the stall name removed: 1 red;
 *   4. the sponsor strip moved under the stall card: 1 red;
 *   5. the rate-limit check taken off the route: 1 red.
 * date: 2026-11-14
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { BOOTH_NOT_OPEN_COPY, parseBoothNumberSegment } from '../src/handlers/booth-page';
import { escapeHtml } from '../src/lib/html-escape';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND = 'brand-bp';
const FAIR = 'evt-bp-fair';
const PLAIN = 'evt-bp-plain';
const OFFMAP = 'evt-bp-offmap';
const SIBLING = 'evt-bp-sibling';
const CLOSED = {
  draft: 'evt-bp-draft',
  ready: 'evt-bp-ready',
  archived: 'evt-bp-archived',
} as const;

const HOSTILE_NAME = `<script>alert(1)</script><img src=x onerror="alert(2)">'&`;
const HOSTILE_NUMBER = `<i>9`;
/** A count no page should ever print: the stall's seeded scans. */
const SCANS = 37;

let nextIp = 1;
async function get(
  path: string,
  over: Partial<RouterEnv> = {}
): Promise<{ status: number; body: string; headers: Headers }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      headers: { 'CF-Connecting-IP': `192.0.2.${nextIp++ % 250}`, Accept: 'text/html' },
    }),
    { ...routerEnv, ...over } as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.text(), headers: res.headers };
}

const page = (eventId: string, number: string) =>
  `/events/${eventId}/booths/${encodeURIComponent(number)}`;

/** A body with its per-request nonce taken out, for "the same as missing". */
const same = (body: string) => body.replace(/nonce="[^"]*"/g, 'nonce=""');

function countH1(body: string): number {
  return [...body.toLowerCase().matchAll(/<h1[\s>]/g)].length;
}

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

async function seedEvent(
  id: string,
  opts: { status?: string; published?: 0 | 1; sponsors?: boolean } = {}
): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date,
                         timezone, settings_json)
     VALUES (?, ?, ?, ?, ?, ?, '2099-06-06', '2099-06-06', 'America/Chicago', ?)`
  )
    .bind(
      id,
      BRAND,
      id === FAIR ? 'Spring Makers Fair' : `Fair ${id}`,
      id === FAIR ? 'spring-makers-fair' : id,
      opts.status ?? 'active',
      opts.published ?? 1,
      opts.sponsors ? '{"useSponsors":true}' : '{}'
    )
    .run();
}

async function seedBooth(
  id: string,
  eventId: string,
  number: string,
  name: string,
  opts: { category?: string | null; active?: 0 | 1 } = {}
): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO event_booths (id, event_id, number, name, category, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, eventId, number, name, opts.category ?? null, opts.active ?? 1)
    .run();
}

beforeAll(applyMigrations);

beforeEach(async () => {
  const db = tenv.DB;
  await db.prepare(`DELETE FROM scan_placement_events WHERE event_id LIKE 'evt-bp-%'`).run();
  await db.prepare(`DELETE FROM poster_deployments WHERE event_id LIKE 'evt-bp-%'`).run();
  await db.prepare(`DELETE FROM event_booths WHERE event_id LIKE 'evt-bp-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE event_id LIKE 'evt-bp-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sb-bp-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'evt-bp-%'`).run();

  await seedEvent(FAIR, { sponsors: true });
  await seedEvent(PLAIN);
  await seedEvent(OFFMAP, { published: 0 });
  await seedEvent(SIBLING);
  for (const [status, id] of Object.entries(CLOSED)) await seedEvent(id, { status });

  await seedBooth('bth-bp-a12', FAIR, 'A12', 'Juniper Ceramics', { category: 'craft' });
  await seedBooth('bth-bp-b7', FAIR, 'B7', 'Hollow Bread');
  await seedBooth('bth-bp-c3', FAIR, 'C/3', 'Slash Stall', { category: 'food' });
  await seedBooth('bth-bp-evil', FAIR, HOSTILE_NUMBER, HOSTILE_NAME, { category: 'other' });
  await seedBooth('bth-bp-x1', FAIR, 'X1', 'Closed Stall', { active: 0 });
  await seedBooth('bth-bp-plain', PLAIN, 'A12', 'Plain Stall');
  await seedBooth('bth-bp-offmap', OFFMAP, '1', 'Offmap Stall');
  await seedBooth('bth-bp-sibling', SIBLING, 'Z5', 'Sibling Stall');
  for (const id of Object.values(CLOSED)) await seedBooth(`bth-bp-${id}`, id, '1', 'Closed Fair');

  // The fair's sponsors: one on show, one the sponsor has not accepted.
  await seedSplitSponsor(db, {
    id: 'sb-bp-on',
    eventId: FAIR,
    brandId: BRAND,
    name: 'Corner Hardware',
    websiteUrl: 'https://corner-hardware.example',
  });
  await seedSplitSponsor(db, {
    id: 'sb-bp-pending',
    eventId: FAIR,
    brandId: BRAND,
    name: 'Pending Bank',
    sponsorAccepted: 0,
  });

  // The stall has a table card and scans: none of it may show.
  await db
    .prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, booth_id)
       VALUES ('pd-bp-a12', ?, 'qrt_pd-bp-a12', 'Table card', 1, 'bth-bp-a12')`
    )
    .bind(FAIR)
    .run();
  for (let i = 0; i < SCANS; i++) {
    await db
      .prepare(
        `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
         VALUES (?, ?, 'pd-bp-a12', ?)`
      )
      .bind(`spe-bp-${i}`, FAIR, `2099-06-06T1${i % 10}`)
      .run();
  }
});

describe('a stall in use of a live fair renders', () => {
  test('200, HTML, with the fair, the stall and a link to the fair’s page', async () => {
    const res = await get(page(FAIR, 'A12'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.body).toContain('data-testid="booth-event-title">Spring Makers Fair</p>');
    expect(res.body).toMatch(/data-testid="booth-event-when">Saturday, June 6, 2099/);
    expect(res.body).toContain('data-testid="booth-number">Stall A12</p>');
    expect(res.body).toContain('data-testid="booth-name">Juniper Ceramics</h1>');
    expect(res.body).toContain('data-testid="booth-category">Craft</p>');
    expect(res.body).toContain(`href="/events/${FAIR}/spring-makers-fair"`);
    expect(res.body).toContain('<title>Stall A12 · Juniper Ceramics · Spring Makers Fair</title>');
  });

  test('exactly one <h1>, and it is the stall', async () => {
    const res = await get(page(FAIR, 'A12'));
    expect(countH1(res.body)).toBe(1);
    expect(res.body).toMatch(/<h1[^>]*>Juniper Ceramics<\/h1>/);
  });

  test('a stall with no category shows none', async () => {
    const res = await get(page(FAIR, 'B7'));
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('data-testid="booth-category"');
  });

  test('the number is read in any case, and as typed on the card', async () => {
    const lower = await get(page(FAIR, 'a12'));
    expect(lower.status).toBe(200);
    expect(lower.body).toContain('Stall A12');
    const slash = await get(page(FAIR, 'C/3'));
    expect(slash.status).toBe(200);
    expect(slash.body).toContain('Slash Stall');
    const spaced = await get(`/events/${FAIR}/booths/%20B7%20`);
    expect(spaced.status).toBe(200);
  });

  test('a live fair that is off the map opens by link, and asks not to be indexed', async () => {
    const res = await get(page(OFFMAP, '1'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('<meta name="robots" content="noindex" />');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const listed = await get(page(FAIR, 'A12'));
    expect(listed.body).not.toContain('noindex');
  });

  test('the page carries the house security headers and is cached privately', async () => {
    const res = await get(page(FAIR, 'A12'));
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });
});

describe('the sponsor strip (AGENTS.md invariant 6)', () => {
  test('a fair with a sponsor on show: below the title and date, above the stall', async () => {
    const { body } = await get(page(FAIR, 'A12'));
    const title = body.indexOf('data-testid="booth-event-title"');
    const when = body.indexOf('data-testid="booth-event-when"');
    const strip = body.indexOf('data-testid="booth-sponsor-strip"');
    const stall = body.indexOf('data-testid="booth"');
    const h1 = body.indexOf('<h1');
    expect(title).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(when);
    expect(when).toBeGreaterThan(title);
    expect(stall).toBeGreaterThan(strip);
    expect(h1).toBeGreaterThan(strip);
    expect(body).toContain('Corner Hardware');
    expect(body).toMatch(
      /<a class="sponsor-panel-main" href="https:\/\/corner-hardware\.example" rel="noopener noreferrer nofollow"/
    );
  });

  test('a sponsor that has not accepted is not shown', async () => {
    const { body } = await get(page(FAIR, 'A12'));
    expect(body).not.toContain('Pending Bank');
  });

  test('a fair with no sponsor on show has no strip', async () => {
    const { body, status } = await get(page(PLAIN, 'A12'));
    expect(status).toBe(200);
    expect(body).not.toContain('booth-sponsor-strip');
    expect(body).not.toContain('Corner Hardware');
  });

  test('a fair that has not opted in to sponsors has no strip', async () => {
    await tenv.DB.prepare(`UPDATE events SET settings_json = '{}' WHERE id = ?`).bind(FAIR).run();
    const { body } = await get(page(FAIR, 'A12'));
    expect(body).not.toContain('booth-sponsor-strip');
  });
});

describe('every closed address answers the same 404', () => {
  const CASES: Array<[string, string]> = [
    ['an unknown event', page('evt-bp-nobody', 'A12')],
    ['a draft fair', page(CLOSED.draft, '1')],
    ['a ready fair', page(CLOSED.ready, '1')],
    ['an archived fair', page(CLOSED.archived, '1')],
    ['an unknown number', page(FAIR, 'Q99')],
    ['a stall out of use', page(FAIR, 'X1')],
    ['a stall of another event', page(FAIR, 'Z5')],
    ['a number longer than a stall number can be', page(FAIR, 'A'.repeat(21))],
    ['a number that is not valid percent-encoding', `/events/${FAIR}/booths/%E0%A4%A`],
    ['an event id that is not an id', `/events/bad%20id/booths/A12`],
  ];

  test.each(CASES)('%s: 404, the house not-found page', async (_label, path) => {
    const res = await get(path);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.body).toContain(escapeHtml(BOOTH_NOT_OPEN_COPY));
    expect(countH1(res.body)).toBe(1);
  });

  test('all of them are byte-identical but for the nonce', async () => {
    const bodies = await Promise.all(CASES.map(([, path]) => get(path)));
    const first = same(bodies[0].body);
    for (const [i, b] of bodies.entries()) expect(same(b.body), CASES[i][0]).toBe(first);
  });

  test('a closed fair’s stall name never reaches the page', async () => {
    for (const id of Object.values(CLOSED)) {
      expect((await get(page(id, '1'))).body).not.toContain('Closed Fair');
    }
    expect((await get(page(FAIR, 'X1'))).body).not.toContain('Closed Stall');
  });

  test('a language prefix is not a stall address', async () => {
    const res = await get(`/es${page(FAIR, 'A12')}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('Juniper Ceramics');
  });
});

describe('stored text is hostile input', () => {
  test('a name and number shaped like markup are escaped', async () => {
    const res = await get(page(FAIR, HOSTILE_NUMBER));
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('<script>alert(1)');
    expect(res.body).not.toContain('<img src=x');
    expect(res.body).not.toContain('<i>9');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.body).toContain('Stall &lt;i&gt;9');
    expect(countH1(res.body)).toBe(1);
  });

  test('a number with a control character is refused before any read', () => {
    expect(parseBoothNumberSegment('A%0A12')).toBeNull();
    expect(parseBoothNumberSegment('%E0%A4%A')).toBeNull();
    expect(parseBoothNumberSegment('%20')).toBeNull();
    expect(parseBoothNumberSegment('a12')).toBe('a12');
  });
});

describe('no cookie and no count', () => {
  test('neither the page nor the 404 sets a cookie', async () => {
    expect((await get(page(FAIR, 'A12'))).headers.get('set-cookie')).toBeNull();
    expect((await get(page(FAIR, 'Q99'))).headers.get('set-cookie')).toBeNull();
  });

  test('the page says nothing about how many scanned, visited or signed up', async () => {
    const { body } = await get(page(FAIR, 'A12'));
    const text = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain(String(SCANS));
    for (const word of [
      /\bscan/i,
      /\bvisit/i,
      /\bcount/i,
      /\bpeople\b/i,
      /\bsigned up\b/i,
      /\bchecked in\b/i,
      /\bfewer than\b/i,
      /\bsales?\b/i,
    ]) {
      expect(text, String(word)).not.toMatch(word);
    }
    // The only digits are the date, the stall number and the footer's year.
    const digits = text
      .replace(/Saturday, June 6, 2099/g, '')
      .replace(/A12/g, '')
      .replace(/©\s*\d{4}/g, '');
    expect(digits).not.toMatch(/\d/);
  });
});

describe('the route is rate-limited as a public read', () => {
  test('past the limit: 429, an HTML page, and the stall is not read', async () => {
    const keys: string[] = [];
    const tripped = {
      get: async (k: string) => {
        keys.push(k);
        return JSON.stringify({ count: 100_000, resetAt: Date.now() + 60_000, max: 360 });
      },
      put: async () => undefined,
    } as unknown as KVNamespace;
    const res = await get(page(FAIR, 'A12'), { RATE_LIMIT_KV: tripped } as Partial<RouterEnv>);
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.body).not.toContain('Juniper Ceramics');
    expect(keys.length).toBeGreaterThan(0);
  });
});
