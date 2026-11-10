/**
 * The links a place panel offers (owner, 2026-11-09; epic OSE-1880, OSE-1897).
 *
 * A map tap is never counted and never touches tracking, so a panel button
 * goes straight to its destination: the organizer's own poster links by their
 * saved https targets, never `/q`, `/s`, `/e`, `/r`, `/c` or check-in. Share
 * carries the event page's own link (its `/e/<code>` share code).
 *
 * Three layers here, all in the node project:
 *   - `placeLinksFromRows`, the pure rule;
 *   - `fetchPlaceLinks` against a fake D1 (what it asks, in what chunks, and
 *     that it fails to empty). The real D1 read is in event-place.spec.ts;
 *   - `handleLandingPage` with `?area=`: which events it asks links for, and the
 *     origin a Share carries (the lines Stryker mutates in handlers/pages.ts).
 *
 * @born-red map place links | method: 19 faults injected one at a time (the
 *   left-out kinds emptied, check-in allowed, off-poster rows kept, the https
 *   check dropped, the position sort dropped, a second link of one kind kept,
 *   the share code dropped, an entry made for an empty share code, the read's
 *   catch rethrown, one chunk for every id, ids not de-duplicated, a read that
 *   also writes, the handler asking for every event's links, for none, for the
 *   other areas', for ids mapped to nothing, with no area asked, an origin that
 *   is always empty, the request host as the origin in production); each
 *   turned this file red | date: 2026-11-09
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchPlaceLinks, placeLinksFromRows, type ShortlinkRow } from '../src/lib/map-place-links';
import { PRODUCTION_ORIGIN } from '../src/lib/canonical';
import { BEVERLY, BLUE_ISLAND, MANY, NOW } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => ({ data: state.rows, source: 'live', cacheAge: null }),
  }),
}));
vi.mock('../src/lib/sponsor-titles', async () => ({
  fetchSponsorTitles: async () => new Map(),
}));

import { handleLandingPage } from '../src/handlers/pages';

const link = (
  event_id: string,
  kind: string | null,
  target_url: string | null,
  poster_position: number | null = 1
): ShortlinkRow => ({ event_id, kind, target_url, poster_position });

describe('placeLinksFromRows: which poster links reach the map', () => {
  test('sunny: an https link on the poster is offered, with the share code', () => {
    const out = placeLinksFromRows(
      [link('e1', 'donation', 'https://give.example/e1')],
      [{ event_id: 'e1', code: 'ABC234' }]
    );
    expect([...out.keys()]).toEqual(['e1']);
    expect(out.get('e1')).toEqual({
      shareCode: 'ABC234',
      links: [{ kind: 'donation', href: 'https://give.example/e1' }],
    });
  });

  test('never: the event page, registration and check-in codes are not offered', () => {
    // The card builds the page and the form from the event id; a check-in from
    // the map would poison attendance. A row with no kind is the event page.
    const out = placeLinksFromRows([
      link('e1', 'public', 'https://t.example/events/e1'),
      link('e1', 'register', 'https://t.example/events/e1/register', 2),
      link('e1', 'checkin', 'https://t.example/events/e1/checkin', 3),
      link('e1', null, 'https://t.example/events/e1', 4),
    ]);
    expect(out.size).toBe(0);
  });

  test('rainy: a code the organizer took off the poster is not offered', () => {
    const out = placeLinksFromRows([
      link('e1', 'donation', 'https://give.example/e1', null),
      link('e1', 'tickets', 'https://tix.example/e1', 2),
    ]);
    expect(out.get('e1')!.links).toEqual([{ kind: 'tickets', href: 'https://tix.example/e1' }]);
  });

  test('rainy: only an https target is a link; anything else is dropped', () => {
    const bad = [
      'http://give.example/e1',
      'javascript:alert(1)',
      '//give.example/e1',
      '/s/abc123',
      'give.example',
      '',
      null,
    ];
    const out = placeLinksFromRows(bad.map((t, i) => link('e1', `kind${i}`, t, i + 1)));
    expect(out.size).toBe(0);
  });

  test('edge: links come in poster order, whatever order the rows arrive in', () => {
    const out = placeLinksFromRows([
      link('e1', 'menu', 'https://m.example', 3),
      link('e2', 'tickets', 'https://t.example', 1),
      link('e1', 'donation', 'https://d.example', 1),
      link('e1', 'website', 'https://w.example', 2),
    ]);
    expect(out.get('e1')!.links.map((l) => l.kind)).toEqual(['donation', 'website', 'menu']);
    expect(out.get('e2')!.links.map((l) => l.kind)).toEqual(['tickets']);
  });

  test('edge: two codes of one kind are one button, the first on the poster', () => {
    const out = placeLinksFromRows([
      link('e1', 'donation', 'https://second.example', 2),
      link('e1', 'donation', 'https://first.example', 1),
    ]);
    expect(out.get('e1')!.links).toEqual([{ kind: 'donation', href: 'https://first.example' }]);
  });

  test('edge: an event with a share code and no links still gets its code; no code, no entry', () => {
    const out = placeLinksFromRows(
      [],
      [
        { event_id: 'e1', code: 'ABC234' },
        { event_id: 'e2', code: null },
        { event_id: 'e3', code: '' },
      ]
    );
    expect(out.get('e1')).toEqual({ shareCode: 'ABC234', links: [] });
    expect(out.has('e2')).toBe(false);
    expect(out.has('e3')).toBe(false);
    // A link with no share code: the Share button falls back to the page.
    expect(placeLinksFromRows([link('e4', 'menu', 'https://m.example')]).get('e4')!.shareCode).toBe(
      null
    );
  });

  test('never who: no link the map offers is a tracked short link', () => {
    const out = placeLinksFromRows(
      [
        link('e1', 'donation', 'https://give.example/e1'),
        link('e1', 'tickets', 'https://tix.example/e1', 2),
      ],
      [{ event_id: 'e1', code: 'ABC234' }]
    );
    for (const l of out.get('e1')!.links) {
      expect(new URL(l.href).pathname).not.toMatch(/^\/(q|s|e|r|c)\//);
    }
  });
});

// ── a fake D1 that answers the two reads and records what it was asked ───────
interface Call {
  sql: string;
  binds: unknown[];
}
function fakeDb(
  data: {
    shortlinks?: ShortlinkRow[];
    codes?: { event_id: string; code: string | null }[];
    fail?: boolean;
    bare?: boolean;
  } = {}
) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      const call: Call = { sql, binds: [] };
      calls.push(call);
      const stmt = {
        bind(...v: unknown[]) {
          call.binds = v;
          return stmt;
        },
        all: async () => {
          if (data.fail) throw new Error('D1 down');
          if (data.bare) return {};
          const mine = (r: { event_id: string }) => call.binds.includes(r.event_id);
          if (/FROM shortlinks\b/.test(sql))
            return { results: (data.shortlinks ?? []).filter(mine) };
          if (/FROM event_codes\b/.test(sql)) return { results: (data.codes ?? []).filter(mine) };
          return { results: [] };
        },
        first: async () => null,
        run: async () => ({ success: true }),
      };
      return stmt;
    },
  };
  const asked = (table: string) =>
    calls.filter((c) => new RegExp(`FROM ${table}\\b`).test(c.sql)).map((c) => c.binds);
  return { db: db as unknown as D1Database, calls, asked };
}

describe('fetchPlaceLinks: the read', () => {
  test('sunny: one read of each table for the ids asked, and only reads', async () => {
    const { db, calls } = fakeDb({
      shortlinks: [link('e1', 'donation', 'https://give.example/e1')],
      codes: [{ event_id: 'e1', code: 'ABC234' }],
    });
    const out = await fetchPlaceLinks(db, ['e1', 'e2']);
    expect(out.get('e1')).toEqual({
      shareCode: 'ABC234',
      links: [{ kind: 'donation', href: 'https://give.example/e1' }],
    });
    expect(out.has('e2')).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.sql).toMatch(
      /^SELECT event_id, kind, target_url, poster_position FROM shortlinks\s+WHERE event_id IN \(\?,\?\) AND poster_position IS NOT NULL$/
    );
    expect(calls[1]!.sql).toBe('SELECT event_id, code FROM event_codes WHERE event_id IN (?,?)');
    for (const c of calls) {
      expect(c.binds).toEqual(['e1', 'e2']);
      // A map tap is never counted: nothing is written.
      expect(c.sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|REPLACE)\b/i);
    }
  });

  test('rainy: no database, or no event, asks nothing and gives nothing', async () => {
    const { db, calls } = fakeDb();
    expect((await fetchPlaceLinks(null, ['e1'])).size).toBe(0);
    expect((await fetchPlaceLinks(undefined, ['e1'])).size).toBe(0);
    expect((await fetchPlaceLinks(db, [])).size).toBe(0);
    expect((await fetchPlaceLinks(db, ['', undefined as unknown as string])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('rainy: a failed read gives no links and never throws', async () => {
    const { db } = fakeDb({ fail: true });
    await expect(fetchPlaceLinks(db, ['e1'])).resolves.toEqual(new Map());
  });

  test('rainy: an answer with no rows gives no links', async () => {
    const { db } = fakeDb({ bare: true });
    await expect(fetchPlaceLinks(db, ['e1'])).resolves.toEqual(new Map());
  });

  test('fat finger: an id asked twice, an empty one and a non-string are bound once or not at all', async () => {
    const { db, asked } = fakeDb();
    await fetchPlaceLinks(db, ['e1', 'e1', '', 7 as unknown as string, 'e2']);
    expect(asked('shortlinks')).toEqual([['e1', 'e2']]);
    expect(asked('event_codes')).toEqual([['e1', 'e2']]);
  });

  test('edge: more events than one statement may bind are read in chunks of 80, all of them', async () => {
    const ids = Array.from({ length: 161 }, (_, i) => `e${i}`);
    const { db, asked } = fakeDb({
      shortlinks: [
        link('e0', 'menu', 'https://m.example/0'),
        link('e80', 'menu', 'https://m.example/80'),
        link('e160', 'menu', 'https://m.example/160'),
      ],
      codes: [{ event_id: 'e159', code: 'ZZZ999' }],
    });
    const out = await fetchPlaceLinks(db, ids);
    expect(asked('shortlinks').map((b) => b.length)).toEqual([80, 80, 1]);
    expect(asked('event_codes').map((b) => b.length)).toEqual([80, 80, 1]);
    expect(asked('shortlinks').flat()).toEqual(ids);
    expect([...out.keys()].sort()).toEqual(['e0', 'e159', 'e160', 'e80']);
    expect(out.get('e159')!.shareCode).toBe('ZZZ999');
  });
});

// ── the landing handler, zoomed (src/handlers/pages.ts) ─────────────────────
describe('GET /?area=: the panel links the page asks for, and the origin a Share carries', () => {
  const here = MANY.filter((r) => r.h3_res7 === BLUE_ISLAND).map((r) => String(r.id));
  const there = MANY.filter((r) => r.h3_res7 === BEVERLY).map((r) => String(r.id));
  const data = {
    shortlinks: [
      link('evt_g01', 'donation', 'https://give.example/g01?a=1&b=2'),
      link('evt_g03', 'donation', 'https://give.example/beverly'),
    ],
    codes: [{ event_id: 'evt_g01', code: 'ABC234' }],
  };
  async function page(url: string, env: Record<string, unknown> = {}) {
    const fake = fakeDb(data);
    const res = await handleLandingPage({ DB: fake.db, ...env } as never, null, new Request(url));
    expect(res.status).toBe(200);
    return { html: await res.text(), ...fake };
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    state.rows = MANY;
  });
  afterEach(() => {
    vi.useRealTimers();
    state.rows = [];
  });

  test("sunny: it asks for the links of this area's events, and of no other event", async () => {
    expect(here.length).toBeGreaterThan(1);
    expect(there.length).toBeGreaterThan(1);
    const { html, asked } = await page(`https://stg.test/?area=${BLUE_ISLAND}`);
    expect(asked('shortlinks')).toEqual([here]);
    expect(asked('event_codes')).toEqual([here]);
    expect(html).toContain(`data-zoom="${BLUE_ISLAND}"`);
    // The organizer's link, straight to its destination.
    expect(html).toContain(
      'href="https://give.example/g01?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow" data-testid="amap-link" data-kind="donation"'
    );
    expect(html).not.toContain('give.example/beverly');
  });

  test('sunny: Share carries this site, with the share code where the event has one', async () => {
    const { html } = await page(`https://stg.test/?area=${BLUE_ISLAND}`);
    expect(html).toContain('data-share-url="https://stg.test/e/ABC234"');
    expect(html).toContain('data-share-url="https://stg.test/events/evt_g02/golden-2"');
    expect(html.match(/<script[^>]*data-testid="share-script"/g)).toHaveLength(1);
  });

  test('edge: in production a Share carries the one public address, whatever host answered', async () => {
    const { html } = await page(`https://preview.internal.test/?area=${BLUE_ISLAND}`, {
      WORKER_ENV: 'production',
    });
    expect(html).toContain(`data-share-url="${PRODUCTION_ORIGIN}/e/ABC234"`);
    expect(html).not.toContain('data-share-url="https://preview.internal.test');
  });

  test('rainy: with no area asked, no link is read', async () => {
    const { html, asked } = await page('https://stg.test/');
    expect(asked('shortlinks')).toEqual([]);
    expect(asked('event_codes')).toEqual([]);
    expect(html).not.toContain('data-testid="amap-panel"');
  });

  test('fat finger: a cell that is not an area reads no link and zooms nowhere', async () => {
    const { html, asked } = await page(`https://stg.test/?area=00${BLUE_ISLAND}`);
    expect(asked('shortlinks')).toEqual([]);
    expect(html).not.toContain('data-zoom=');
  });

  test('never who: no link on the zoomed page reaches tracking or check-in', async () => {
    const { html } = await page(`https://stg.test/?area=${BLUE_ISLAND}`);
    const wrap = html.slice(html.indexOf('data-testid="amap-wrap"'));
    const area = wrap.slice(0, wrap.indexOf('data-testid="area-list"'));
    expect(area).toContain('data-testid="amap-panel"');
    for (const m of area.matchAll(/href="([^"]*)"/g)) {
      expect(m[1], m[1]).not.toMatch(/^\/(q|s|e|r|c)\//);
      expect(m[1], m[1]).not.toMatch(/checkin/);
    }
  });
});
