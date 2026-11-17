/**
 * The public stall list of a fair (OSE-1998, OSE ADR-034 decisions 1 and 5),
 * and the event page's link to it.
 *
 *   GET /events/:id/booths
 *
 * Held here:
 *   1. a live fair with a stall in use renders: the fair's title and date, the
 *      sponsor strip when sponsors are on show (AGENTS.md invariant 6: below
 *      the title and date, above the content and so above the <h1>), exactly
 *      one <h1> "Stalls", then the stalls grouped by category, each row a link
 *      to its own stall page showing "Stall <number>" and the trading name;
 *   2. the groups follow the fixed category list, with "Other" last; a stall
 *      with no category, or with a stored category that is not on the list,
 *      is in "Other"; inside a group the order is the public read's order;
 *      a stall out of use is not listed;
 *   3. a heading is a label from the fixed map, never the stored text;
 *   4. stored text is escaped, never markup;
 *   5. an unknown event, an event that is not public, a public event with no
 *      stall, and one whose stalls are all out of use answer the stall page's
 *      404: the same status, page title and <h1>;
 *   6. no count of any kind, no cookie; noindex exactly when the fair is off
 *      the map, as on the stall page;
 *   7. the route is rate-limited as a public read;
 *   8. the event page offers "See the stalls" exactly when the list opens, and
 *      the link carries no count.
 *
 * Text is read out of the page with the Worker runtime's HTML parser
 * (tests/helpers/visible-text.ts), never with a pattern over the markup.
 *
 * @born-red OSE-1998 | method: written before the route existed (the list
 * address fell to the event page's /events/<id>/<name>: 19 red), then one fault
 * at a time, each restored before the next:
 *   1. the empty-list 404 taken out of the handler: 4 red;
 *   2. the public-state gate removed from readPublicFair: 11 red (both specs);
 *   3. `AND b.is_active = 1` taken out of the list statement: 7 red;
 *   4. a heading taken from the stored category: 2 red;
 *   5. stalls with no or an unknown category put under "food": 1 red;
 *   6. groups in arrival order, not the fixed list: 1 red;
 *   7. rows sorted by name inside a group: 2 red;
 *   8. the escaper taken off the row name: 1 red;
 *   9. "<n> stalls" under each heading: 1 red;
 *  10. the group headings made <h1>: 3 red;
 *  11. the sponsor strip moved under the <h1>: 1 red;
 *  12. the noindex condition inverted: 2 red;
 *  13. a Set-Cookie on the list: 1 red;
 *  14. the rate-limit check taken off the route: 1 red;
 *  15. `is_active = 1` taken out of the event page's has-stalls read: 2 red;
 *  16. the event page's `status === 'active'` condition removed: 2 red;
 *  17. a number in the link's label ("See the 9 stalls"): 2 red;
 *  18. the event page's link never passed: 3 red;
 *  19. "booths" taken out of EVENT_SCREEN_SEGMENTS: 2 red.
 * date: 2026-11-16
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { attrsOf, textsOf, visibleText } from './helpers/visible-text';
import { escapeHtml } from '../src/lib/html-escape';
import { fetchPublicBoothsOf } from '../src/lib/public-booths';
import { BOOTH_CATEGORY_LABELS } from '../src/lib/booth-page-render';
import { BOOTH_LIST_CSS, groupBoothsByCategory } from '../src/lib/booth-list-render';
import { BOOTH_CATEGORIES } from '../src/lib/event-booths';
import { eventPagePath } from '../src/lib/canonical';
import {
  renderEventLiveHtml,
  renderPostEventHtml,
  renderPreEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND = 'brand-bl';
const FAIR = 'evt-bl-fair';
const FAIR_TITLE = 'Riverside Makers Fair';
const PLAIN = 'evt-bl-plain';
const OFFMAP = 'evt-bl-offmap';
const EMPTY = 'evt-bl-empty';
const RETIRED = 'evt-bl-retired';
const RECAP = 'evt-bl-recap';
const PAST = 'evt-bl-past';
const CLOSED = {
  draft: 'evt-bl-draft',
  ready: 'evt-bl-ready',
  archived: 'evt-bl-archived',
} as const;

const HOSTILE_NAME = `<script>alert(1)</script><img src=x onerror="alert(2)">'&`;
const HOSTILE_NUMBER = `<i>9`;
const UNKNOWN_CATEGORY = 'zz-<b>secret</b>';
/** A count no page may print: the seeded scans of one stall. */
const SCANS = 37;

let nextIp = 1;
async function get(
  path: string,
  over: Partial<RouterEnv> = {}
): Promise<{ status: number; body: string; headers: Headers }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      headers: { 'CF-Connecting-IP': `203.0.113.${(nextIp++ % 250) + 1}`, Accept: 'text/html' },
    }),
    { ...routerEnv, ...over } as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.text(), headers: res.headers };
}

const list = (eventId: string) => `/events/${eventId}/booths`;
const stall = (eventId: string, number: string) =>
  `/events/${eventId}/booths/${encodeURIComponent(number)}`;

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
  opts: { status?: string; published?: 0 | 1; sponsors?: boolean; date?: string } = {}
): Promise<void> {
  const date = opts.date ?? '2099-06-06';
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date,
                         timezone, settings_json, listed_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'America/Chicago', ?, ?)`
  )
    .bind(
      id,
      BRAND,
      id === FAIR ? FAIR_TITLE : `Fair ${id}`,
      id === FAIR ? 'riverside-makers-fair' : id,
      opts.status ?? 'active',
      opts.published ?? 1,
      date,
      date,
      opts.sponsors ? '{"useSponsors":true}' : '{}',
      opts.status === 'archived' ? '2026-01-01T00:00:00.000Z' : null
    )
    .run();
}

async function seedBooth(
  id: string,
  eventId: string,
  number: string,
  name: string,
  opts: { category?: string | null; active?: 0 | 1; sort?: number } = {}
): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, eventId, number, name, opts.category ?? null, opts.active ?? 1, opts.sort ?? 0)
    .run();
}

beforeAll(applyMigrations);

beforeEach(async () => {
  const db = tenv.DB;
  await db.prepare(`DELETE FROM scan_placement_events WHERE event_id LIKE 'evt-bl-%'`).run();
  await db.prepare(`DELETE FROM poster_deployments WHERE event_id LIKE 'evt-bl-%'`).run();
  await db.prepare(`DELETE FROM event_booths WHERE event_id LIKE 'evt-bl-%'`).run();
  await db.prepare(`DELETE FROM sponsor_placement WHERE event_id LIKE 'evt-bl-%'`).run();
  await db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'sb-bl-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'evt-bl-%'`).run();

  await seedEvent(FAIR, { sponsors: true });
  await seedEvent(PLAIN);
  await seedEvent(OFFMAP, { published: 0 });
  await seedEvent(EMPTY);
  await seedEvent(RETIRED);
  await seedEvent(PAST, { date: '2001-03-03' });
  // Archived but published: the event page shows its recap, the list does not open.
  await seedEvent(RECAP, { status: 'archived', date: '2001-03-03' });
  for (const [status, id] of Object.entries(CLOSED)) await seedEvent(id, { status });

  // The fair, out of order on purpose: the page must sort, not the seed.
  await seedBooth('bth-bl-u1', FAIR, 'U1', 'Unknown Cat Stall', { category: UNKNOWN_CATEGORY });
  await seedBooth('bth-bl-o1', FAIR, 'O1', 'Odd Things', { category: 'other', sort: 1 });
  await seedBooth('bth-bl-b2', FAIR, 'B2', 'Pine Crafts', { category: 'craft', sort: 2 });
  await seedBooth('bth-bl-k4', FAIR, 'K4', 'Old Books', { category: 'books' });
  await seedBooth('bth-bl-f1', FAIR, 'F1', 'Hollow Bread', { category: 'food', sort: 5 });
  await seedBooth('bth-bl-n1', FAIR, 'N1', 'No Category Stall');
  await seedBooth('bth-bl-b1', FAIR, 'B1', 'Oak Turnery', { category: 'craft', sort: 2 });
  await seedBooth('bth-bl-a9', FAIR, 'A9', 'Early Craft', { category: 'craft', sort: 1 });
  await seedBooth('bth-bl-evil', FAIR, HOSTILE_NUMBER, HOSTILE_NAME, { category: 'art' });
  await seedBooth('bth-bl-x1', FAIR, 'X1', 'Closed Stall', { category: 'craft', active: 0 });

  await seedBooth('bth-bl-plain', PLAIN, 'P1', 'Plain Stall', { category: 'food' });
  await seedBooth('bth-bl-offmap', OFFMAP, 'M1', 'Offmap Stall');
  await seedBooth('bth-bl-retired', RETIRED, 'R1', 'Retired Stall', { active: 0 });
  await seedBooth('bth-bl-past', PAST, 'T1', 'Past Stall');
  await seedBooth('bth-bl-recap', RECAP, 'C1', 'Recap Stall');
  for (const id of Object.values(CLOSED)) await seedBooth(`bth-${id}`, id, '1', 'Closed Fair');

  // The fair's sponsors: one on show, one the sponsor has not accepted.
  await seedSplitSponsor(db, {
    id: 'sb-bl-on',
    eventId: FAIR,
    brandId: BRAND,
    name: 'Corner Hardware',
    websiteUrl: 'https://corner-hardware.example',
  });
  await seedSplitSponsor(db, {
    id: 'sb-bl-pending',
    eventId: FAIR,
    brandId: BRAND,
    name: 'Pending Bank',
    sponsorAccepted: 0,
  });

  // A stall with a table card and scans: none of it may show.
  await db
    .prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, booth_id)
       VALUES ('pd-bl-b2', ?, 'qrt_pd-bl-b2', 'Table card', 1, 'bth-bl-b2')`
    )
    .bind(FAIR)
    .run();
  for (let i = 0; i < SCANS; i++) {
    await db
      .prepare(
        `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
         VALUES (?, ?, 'pd-bl-b2', ?)`
      )
      .bind(`spe-bl-${i}`, FAIR, `2099-06-06T1${i % 10}`)
      .run();
  }
});

/** The rows of the page, group by group: [category, [number, name][]]. */
async function groupsOf(body: string): Promise<Array<[string, string, string[]]>> {
  const categories = await attrsOf(body, '[data-testid="booth-list-group"]', 'data-category');
  const titles = await textsOf(body, '[data-testid="booth-list-group-title"]');
  const out: Array<[string, string, string[]]> = [];
  for (const [i, category] of categories.entries()) {
    const names = await textsOf(
      body,
      `[data-category="${category}"] [data-testid="booth-list-row-name"]`
    );
    out.push([category, titles[i], names]);
  }
  return out;
}

describe('a live fair with stalls in use renders its list', () => {
  test('200, HTML, the fair, one <h1> "Stalls", the stalls, a link to the fair', async () => {
    const res = await get(list(FAIR));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await textsOf(res.body, '[data-testid="booth-event-title"]')).toEqual([FAIR_TITLE]);
    expect(await textsOf(res.body, '[data-testid="booth-event-when"]')).toEqual([
      expect.stringMatching(/^Saturday, June 6, 2099/),
    ]);
    expect(await textsOf(res.body, 'h1')).toEqual(['Stalls']);
    expect(await textsOf(res.body, 'title')).toEqual([`Stalls · ${FAIR_TITLE}`]);
    expect(await attrsOf(res.body, '[data-testid="booth-list-event-link"]', 'href')).toEqual([
      `/events/${FAIR}/riverside-makers-fair`,
    ]);
    expect(await textsOf(res.body, '[data-testid="booth-list-back"]')).toEqual(['Back']);
  });

  test('the groups follow the fixed list, "Other" last, each in the public read’s order', async () => {
    const { body } = await get(list(FAIR));
    expect(await groupsOf(body)).toEqual([
      ['food', 'Food and drink', ['Hollow Bread']],
      ['craft', 'Craft', ['Early Craft', 'Oak Turnery', 'Pine Crafts']],
      ['art', 'Art', [expect.any(String)]],
      ['books', 'Books', ['Old Books']],
      ['other', 'Other', ['No Category Stall', 'Unknown Cat Stall', 'Odd Things']],
    ]);
  });

  test('inside every group, the order is the order of the public read', async () => {
    const { body } = await get(list(FAIR));
    const read = await fetchPublicBoothsOf(tenv.DB, FAIR, BRAND);
    const numbers = await textsOf(body, '[data-testid="booth-list-row-number"]');
    const fromRead = groupBoothsByCategory(read).flatMap((g) =>
      g.booths.map((b) => `Stall ${b.number}`)
    );
    // The read's own order survives grouping: rows of one group appear in the read's order.
    expect(numbers.length).toBe(read.length);
    expect(numbers.map((n) => n.replace(/&lt;/g, '<').replace(/&gt;/g, '>'))).toEqual(fromRead);
    for (const g of groupBoothsByCategory(read)) {
      const idx = g.booths.map((b) => read.indexOf(b));
      expect(idx, g.category).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  test('each row is a link to its stall page, "Stall <number>" and the name', async () => {
    const { body } = await get(list(FAIR));
    const hrefs = await attrsOf(body, '[data-testid="booth-list-row"]', 'href');
    expect(hrefs).toContain(`/events/${FAIR}/booths/B2`);
    expect(hrefs).toContain(`/events/${FAIR}/booths/${encodeURIComponent(HOSTILE_NUMBER)}`);
    expect(await textsOf(body, '[data-testid="booth-list-row-number"]')).toContain('Stall B2');
    // Every row's link opens that stall's page.
    for (const href of hrefs) {
      const res = await get(href);
      expect(res.status, href).toBe(200);
    }
  });

  test('a stall out of use is not listed', async () => {
    const { body } = await get(list(FAIR));
    const text = await visibleText(body);
    expect(text).not.toContain('Closed Stall');
    expect(text).not.toContain('X1');
    expect(await attrsOf(body, '[data-testid="booth-list-row"]', 'href')).not.toContain(
      `/events/${FAIR}/booths/X1`
    );
  });

  test('a heading is only ever a label from the fixed map', async () => {
    const { body } = await get(list(FAIR));
    const titles = await textsOf(body, '[data-testid="booth-list-group-title"]');
    const labels = Object.values(BOOTH_CATEGORY_LABELS);
    for (const t of titles) expect(labels).toContain(t);
    const categories = await attrsOf(body, '[data-testid="booth-list-group"]', 'data-category');
    for (const c of categories) expect(BOOTH_CATEGORIES as readonly string[]).toContain(c);
    // The stored text of an unknown category reaches no part of the page.
    expect(body).not.toContain('zz-');
    expect(body).not.toContain('secret');
  });

  test('exactly one <h1>, below the fair and its sponsor strip', async () => {
    const { body } = await get(list(FAIR));
    expect((await textsOf(body, 'h1')).length).toBe(1);
    const title = body.indexOf('data-testid="booth-event-title"');
    const when = body.indexOf('data-testid="booth-event-when"');
    const strip = body.indexOf('data-testid="booth-sponsor-strip"');
    const h1 = body.indexOf('data-testid="booth-list-title"');
    const firstGroup = body.indexOf('data-testid="booth-list-group"');
    expect(title).toBeGreaterThan(-1);
    expect(when).toBeGreaterThan(title);
    expect(strip).toBeGreaterThan(when);
    expect(h1).toBeGreaterThan(strip);
    expect(firstGroup).toBeGreaterThan(h1);
    expect(await textsOf(body, '[data-testid="booth-sponsor-strip"] .sponsor-panel-name')).toEqual([
      'Corner Hardware',
    ]);
    expect(body).not.toContain('Pending Bank');
  });

  test('a fair with no sponsor on show has no strip', async () => {
    const res = await get(list(PLAIN));
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('booth-sponsor-strip');
    expect(await textsOf(res.body, '[data-testid="booth-list-row-name"]')).toEqual(['Plain Stall']);
  });

  test('the page carries the house security headers and is cached privately', async () => {
    const res = await get(list(FAIR));
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });

  test('the page’s own CSS is layout inside the 400-character inline budget', () => {
    expect(BOOTH_LIST_CSS.length).toBeLessThanOrEqual(400);
    expect(BOOTH_LIST_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|color|background|rgb|hsl/i);
  });
});

describe('noindex, as on the stall page', () => {
  test('a live fair off the map opens by link and asks not to be indexed', async () => {
    const res = await get(list(OFFMAP));
    expect(res.status).toBe(200);
    expect(await attrsOf(res.body, 'meta[name="robots"]', 'content')).toEqual(['noindex']);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  test('a listed fair is indexable', async () => {
    const res = await get(list(FAIR));
    expect(await attrsOf(res.body, 'meta[name="robots"]', 'content')).toEqual([]);
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });
});

describe('stored text is hostile input', () => {
  test('a name and number shaped like markup are escaped', async () => {
    const { body } = await get(list(FAIR));
    expect(body).not.toContain('<script>alert(1)');
    expect(body).not.toContain('<img src=x');
    expect(body).not.toContain('<i>9');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(
      await textsOf(body, '[data-category="art"] [data-testid="booth-list-row-number"]')
    ).toEqual(['Stall &lt;i&gt;9']);
    expect((await textsOf(body, 'h1')).length).toBe(1);
  });
});

describe('every closed list answers the stall page’s 404', () => {
  const CASES: Array<[string, string]> = [
    ['an unknown event', list('evt-bl-nobody')],
    ['a draft fair', list(CLOSED.draft)],
    ['a ready fair', list(CLOSED.ready)],
    ['an archived fair', list(CLOSED.archived)],
    ['an archived fair whose page shows its recap', list(RECAP)],
    ['a live event with no stall', list(EMPTY)],
    ['a live event whose stalls are all out of use', list(RETIRED)],
    ['an event id that is not an id', `/events/bad%20id/booths`],
  ];

  /** What a probe compares: the status, the page title and the one <h1>. */
  async function shapeOf(path: string) {
    const res = await get(path);
    return {
      status: res.status,
      title: await textsOf(res.body, 'title'),
      h1: await textsOf(res.body, 'h1'),
    };
  }

  test.each(CASES)('%s: the same status, title and <h1> as an unknown stall', async (_l, path) => {
    const stallPage404 = await shapeOf(stall('evt-bl-nobody', 'A12'));
    expect(stallPage404.status).toBe(404);
    expect(stallPage404.h1).toEqual(['We couldn&#39;t find that stall']);
    expect(await shapeOf(path)).toEqual(stallPage404);
  });

  test('none of them names a stall or a fair', async () => {
    for (const [label, path] of CASES) {
      const text = await visibleText((await get(path)).body);
      expect(text, label).not.toContain('Closed Fair');
      expect(text, label).not.toContain('Recap Stall');
      expect(text, label).not.toContain('Retired Stall');
    }
  });

  test('a language prefix is not a list address', async () => {
    const res = await get(`/es${list(FAIR)}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('Pine Crafts');
  });

  test('an event named "Booths" keeps its plain address, so it never meets the list', () => {
    expect(eventPagePath('evt-bl-x', 'booths')).toBe('/events/evt-bl-x');
    expect(eventPagePath('evt-bl-x', 'booths-and-more')).toBe('/events/evt-bl-x/booths-and-more');
  });

  test('the list address is not taken as an event name', async () => {
    // Before this route, /events/<id>/booths was the event page's "named"
    // address and forwarded to the fair's own name.
    const res = await get(list(EMPTY));
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('no cookie and no count', () => {
  test('neither the list nor its 404 sets a cookie', async () => {
    expect((await get(list(FAIR))).headers.get('set-cookie')).toBeNull();
    expect((await get(list(EMPTY))).headers.get('set-cookie')).toBeNull();
  });

  test('the page says nothing about how many: no count, no total, no scans', async () => {
    const { body } = await get(list(FAIR));
    const text = await visibleText(body);
    for (const word of [
      /\bscan/i,
      /\bvisit/i,
      /\bcount/i,
      /\btotal/i,
      /\bpeople\b/i,
      /\bsigned up\b/i,
      /\bchecked in\b/i,
      /\bfewer than\b/i,
      /\bsales?\b/i,
    ]) {
      expect(text, String(word)).not.toMatch(word);
    }
    // The only digits are the date, the seeded stall numbers and names, the
    // fair's title and the footer's year: no count of stalls, of a group or
    // of scans.
    const seeded = [
      'Saturday, June 6, 2099',
      escapeHtml(HOSTILE_NAME),
      'Stall &lt;i&gt;9',
      'Stall U1',
      'Stall O1',
      'Stall B2',
      'Stall K4',
      'Stall F1',
      'Stall N1',
      'Stall B1',
      'Stall A9',
    ];
    let rest = text.replace(/©\s*\d{4}/g, '');
    for (const s of seeded) rest = rest.split(s).join('');
    expect(rest).not.toMatch(/\d/);
    expect(text).not.toContain(String(SCANS));
  });
});

describe('the route is rate-limited as a public read', () => {
  test('past the limit: 429, an HTML page, and no stall is read', async () => {
    const keys: string[] = [];
    const tripped = {
      get: async (k: string) => {
        keys.push(k);
        return JSON.stringify({ count: 100_000, resetAt: Date.now() + 60_000, max: 360 });
      },
      put: async () => undefined,
    } as unknown as KVNamespace;
    const res = await get(list(FAIR), { RATE_LIMIT_KV: tripped } as Partial<RouterEnv>);
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.body).not.toContain('Pine Crafts');
    expect(keys.length).toBeGreaterThan(0);
  });
});

describe('the event page links to the list exactly when it opens', () => {
  const linkOf = async (body: string) => ({
    text: await textsOf(body, '[data-testid="event-stalls-link"]'),
    href: await attrsOf(body, '[data-testid="event-stalls-link"]', 'href'),
  });

  test('a live fair with a stall in use: "See the stalls", no count, to its list', async () => {
    const res = await get(`/events/${FAIR}/riverside-makers-fair`);
    expect(res.status).toBe(200);
    expect(await linkOf(res.body)).toEqual({
      text: ['See the stalls'],
      href: [`/events/${FAIR}/booths`],
    });
    // It sits in the row of secondary actions, below the title, date and sponsors.
    expect(
      await textsOf(res.body, '[data-testid="event-actions"] [data-testid="event-stalls-link"]')
    ).toEqual(['See the stalls']);
    const link = res.body.indexOf('data-testid="event-stalls-link"');
    expect(link).toBeGreaterThan(res.body.indexOf('data-testid="event-when"'));
    expect(link).toBeGreaterThan(res.body.indexOf('data-testid="pre-sponsor-strip"'));
  });

  test('in Spanish the label is translated; the link still carries no count', async () => {
    const res = await get(`/es/events/${FAIR}/riverside-makers-fair`);
    expect(res.status).toBe(200);
    const { text } = await linkOf(res.body);
    expect(text).toEqual(['Ver los puestos']);
    expect(text.join('')).not.toMatch(/\d/);
  });

  test('no stall in use, or a list that would not open: no link', async () => {
    for (const id of [EMPTY, RETIRED, RECAP]) {
      const res = await get(`/events/${id}`);
      expect(res.status, id).toBe(200);
      expect(res.body, id).not.toContain('event-stalls-link');
      expect(res.body, id).not.toContain('/booths');
    }
  });

  test('the link shows exactly where the list opens', async () => {
    for (const id of [FAIR, PLAIN, OFFMAP, EMPTY, RETIRED, PAST, RECAP]) {
      const pageRes = await get(`/events/${id}`);
      const listRes = await get(list(id));
      const linked = pageRes.body.includes('data-testid="event-stalls-link"');
      expect(linked, id).toBe(listRes.status === 200);
    }
  });

  test('every phase shows it when given the list, and none without', () => {
    const row = {
      id: 'evt-bl-row',
      brand_id: BRAND,
      title: 'A fair',
      slug: 'a-fair',
      status: 'active',
      description: null,
      location: null,
      start_date: '2099-06-06',
      end_date: '2099-06-06',
      timezone: 'America/Chicago',
      what_short: null,
      who_host: null,
      why_purpose: null,
      how_details: null,
      where_address: null,
      lat: null,
      lon: null,
    } as PublicEventRow;
    const url = 'https://ose.test/events/evt-bl-row/a-fair';
    const stallsHref = '/events/evt-bl-row/booths';
    const pages = {
      pre: [renderPreEventHtml(row, url, undefined, { stallsHref }), renderPreEventHtml(row, url)],
      live: [
        renderEventLiveHtml(row, url, undefined, { stallsHref }),
        renderEventLiveHtml(row, url),
      ],
      post: [
        renderPostEventHtml(row, url, [], undefined, { stallsHref }),
        renderPostEventHtml(row, url, []),
      ],
    };
    for (const [phase, [withList, without]] of Object.entries(pages)) {
      expect(withList, phase).toContain(
        `<a class="ose-calendar-link" data-testid="event-stalls-link" href="${stallsHref}">See the stalls</a>`
      );
      expect(without, phase).not.toContain('event-stalls-link');
    }
  });
});
