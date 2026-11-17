/**
 * The landing's reads start together (OSE-2094).
 *
 * T2 Pages on staging measured `/` and its aliases at 3.2 to 4.5 s in the
 * minute after a deploy (main runs 43908415554, 43908470815, 43920685044),
 * while every other page stayed under the 3000 ms budget. The handler waited on
 * the event list, then the latch read, then the sponsor titles, then the
 * event-type catalog: four D1 round trips one after another, although the last
 * three do not need the list. They now start with the list.
 *
 * What this holds:
 *   - the event list, latch, sponsor-title and catalog reads are all sent before
 *     any of them answers (one round trip, not four);
 *   - their answers still reach the page (latched area leads with the map, the
 *     sponsor by its title, the Type row);
 *   - each still falls back on its own when it fails, and the cards still show;
 *   - a failed list read serves the empty area and leaves no read rejected.
 *
 * Node project (vitest.node-specs.mjs). A fake D1 records each query when it is
 * sent and answers by table name; the data provider's list read is a promise
 * the test answers when it chooses.
 *
 * @born-red landing-reads-together | method: the spec run against main's handler
 *   (e7d2160): the first case fails, only the list read sent before it answers.
 *   Then six faults in the new code, each turning a case red: the `.catch` dropped
 *   from the latch read, or from the catalog read (a failed read takes the cards
 *   with it, and a failed list leaves a rejection); the latch result, the sponsor
 *   titles or the catalog result not passed to the page; the latch read awaited
 *   before the list read is sent (6 faults, 6 red) | date: 2026-11-16
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventTypeCatalog } from '../src/lib/event-type-catalog';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const state = vi.hoisted(() => ({
  /** What the data provider's list read returns. */
  list: (() => Promise.resolve({ data: [], source: 'live', cacheAge: null })) as () => Promise<{
    data: Record<string, unknown>[];
    source: string;
    cacheAge: null;
  }>,
  /** Order in which reads were sent, by name. */
  sent: [] as string[],
  /** What the catalog read does (it records itself as sent). */
  catalog: null as null | (() => Promise<EventTypeCatalog>),
}));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: () => {
      state.sent.push('events');
      return state.list();
    },
  }),
}));
vi.mock('../src/lib/event-type-catalog-read', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/event-type-catalog-read')>();
  return {
    ...real,
    readEventTypeCatalog: (db: D1Database | null | undefined) => {
      state.sent.push('catalog');
      return state.catalog ? state.catalog() : real.readEventTypeCatalog(db);
    },
  };
});

import { handleLandingPage } from '../src/handlers/pages';
import { LANDING_AREA_LATCH_KEY } from '../src/lib/corridor-latch';
import { FEW, MANY, NOW, SPONSORED_EVENT, goldenCatalog } from './helpers/list-landing-rows';

type Table = 'latch' | 'sponsors';

/** A fake D1: records each read as it is sent, answers by table, can fail one. */
function fakeDb(
  opts: { fail?: Table[]; areaLatched?: boolean; hold?: Promise<void> } = {}
): D1Database {
  const tableOf = (q: string): Table | 'other' =>
    /FROM corridor_readiness_latch\b/.test(q)
      ? 'latch'
      : /FROM sponsor_placement\b/.test(q)
        ? 'sponsors'
        : 'other';
  const answer = async (q: string) => {
    const t = tableOf(q);
    if (t !== 'other') state.sent.push(t);
    // Held: sent, but not answered until the test lets it go.
    if (opts.hold) await opts.hold;
    if (t !== 'other' && opts.fail?.includes(t)) throw new Error(`D1 ${t} down`);
    if (t === 'latch') {
      return { results: opts.areaLatched ? [{ h3_res7: LANDING_AREA_LATCH_KEY }] : [] };
    }
    if (t === 'sponsors') {
      return { results: [{ event_id: SPONSORED_EVENT, title: 'Beggars Pizza' }] };
    }
    return { results: [] };
  };
  const stmt = (q: string) => {
    const s = {
      bind: () => s,
      all: () => answer(q),
      first: () => answer(q).then((r) => (r as { results: unknown[] }).results[0] ?? null),
      run: () => answer(q),
    };
    return s;
  };
  return { prepare: (q: string) => stmt(q) } as unknown as D1Database;
}

const live = (rows: Record<string, unknown>[]) => ({
  data: rows,
  source: 'live',
  cacheAge: null as null,
});

function landing(db: D1Database | undefined): Promise<Response> {
  return handleLandingPage({ DB: db } as never, null, new Request('https://oursharedevents.com/'));
}

/** Let every queued read get sent (macrotask, so all microtasks drain first). */
const settle = () => new Promise((r) => setTimeout(r, 0));

const cardCount = (html: string) =>
  (html.match(/data-testid="public-event-card-link"/g) ?? []).length;
/** Cards a healthy read of these rows shows (a fixture row can be off the list). */
async function healthyCards(rows: Record<string, unknown>[]): Promise<number> {
  const keep = state.list;
  state.list = () => Promise.resolve(live(rows));
  const n = cardCount(await (await landing(fakeDb())).text());
  state.list = keep;
  expect(n).toBeGreaterThan(0);
  return n;
}
const typeRow = (html: string) =>
  html.match(/data-testid="toggle-type">([\s\S]*?)<\/fieldset>/)?.[1] ?? null;
const leadsWithMap = (html: string) => /id="view-map"[^>]*\bchecked\b/.test(html);

describe('GET / starts its reads together (OSE-2094)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    state.sent = [];
    state.catalog = async () => goldenCatalog();
    state.list = () => Promise.resolve(live(FEW));
  });
  afterEach(() => {
    vi.useRealTimers();
    state.catalog = null;
  });

  it('sends all four reads before any of them answers', async () => {
    const expected = await healthyCards(FEW);
    state.sent = [];
    // Every read is held: sent, and not answered until the test lets it go.
    const gate = deferred<void>();
    state.list = async () => {
      await gate.promise;
      return live(FEW);
    };
    state.catalog = async () => {
      await gate.promise;
      return goldenCatalog();
    };
    const page = landing(fakeDb({ hold: gate.promise }));
    await settle();
    // Nothing has answered yet, and every read is already on its way.
    expect([...state.sent].sort()).toEqual(['catalog', 'events', 'latch', 'sponsors']);
    gate.resolve();
    const res = await page;
    expect(res.status).toBe(200);
    expect(cardCount(await res.text())).toBe(expected);
  });

  it('their answers reach the page: latched area leads with the map, sponsor by title, Type row', async () => {
    state.list = () => Promise.resolve(live(MANY));
    const many = await (await landing(fakeDb({ areaLatched: true }))).text();
    expect(many).toContain('Beggars Pizza');
    expect(typeRow(many)).not.toBeNull();

    // Fewer than LIST_MAX events lead with the list unless the area is latched.
    state.list = () => Promise.resolve(live(FEW));
    expect(leadsWithMap(await (await landing(fakeDb())).text())).toBe(false);
    expect(leadsWithMap(await (await landing(fakeDb({ areaLatched: true }))).text())).toBe(true);
  });

  it('a failed latch read: every card still shows, and the list leads as unlatched', async () => {
    const expected = await healthyCards(FEW);
    const html = await (await landing(fakeDb({ fail: ['latch'], areaLatched: true }))).text();
    expect(cardCount(html)).toBe(expected);
    expect(leadsWithMap(html)).toBe(false);
  });

  it('a failed sponsor read: every card still shows, with no sponsor line', async () => {
    const expected = await healthyCards(MANY);
    state.list = () => Promise.resolve(live(MANY));
    const html = await (await landing(fakeDb({ fail: ['sponsors'] }))).text();
    expect(cardCount(html)).toBe(expected);
    expect(html).not.toContain('Beggars Pizza');
  });

  it('a failed catalog read (thrown or rejected): every card still shows, with no Type row', async () => {
    const expected = await healthyCards(MANY);
    state.list = () => Promise.resolve(live(MANY));
    state.catalog = () => {
      throw new Error('catalog down');
    };
    const thrown = await (await landing(fakeDb())).text();
    expect(cardCount(thrown)).toBe(expected);
    expect(typeRow(thrown)).toBeNull();

    state.catalog = () => Promise.reject(new Error('catalog down'));
    const rejected = await (await landing(fakeDb())).text();
    expect(cardCount(rejected)).toBe(expected);
    expect(typeRow(rejected)).toBeNull();
  });

  it('a failed list read serves the empty area and leaves no read rejected', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      state.list = () => Promise.reject(new Error('D1 events down'));
      state.catalog = () => Promise.reject(new Error('catalog down'));
      const res = await landing(fakeDb({ fail: ['latch', 'sponsors'] }));
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(cardCount(html)).toBe(0);
      expect(html).toContain('data-testid="area-empty"');
      await settle();
      await settle();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('no database bound: the page still serves the list it was given', async () => {
    const expected = await healthyCards(FEW);
    const res = await landing(undefined);
    expect(res.status).toBe(200);
    expect(cardCount(await res.text())).toBe(expected);
  });
});
