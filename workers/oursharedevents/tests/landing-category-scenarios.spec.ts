/**
 * The landing's Type row by category (owner 2026-11-09, OSE-1824): the
 * happy, negative, edge and fat-finger scenarios the renderer spec
 * (tests/landing-area.spec.ts) does not hold, plus the catalog read, the
 * landing handler's use of it and the admin picker endpoint that shares it.
 *
 * Node project (vitest.node-specs.mjs), so Stryker mutates the changed code
 * against it (stryker.conf.mjs). A fake D1 answers the two registry queries by
 * table name, so a mutated SQL string reads nothing and a test goes red.
 *
 * Scenario matrix (pairwise; the PR body carries it):
 *   happy      two types under one category → one chip, both cards carry it
 *   negative   catalog read throws → page still lists every card, no Type row;
 *              no DB → empty catalog; empty results → empty catalog;
 *              admin endpoint: no DB 503, read throws 503 + one log line
 *   edge       one category only → no row; equal catalog order → alphabetical;
 *              "Other" last even after a high display_order
 *   fat finger event_type_id padded, upper-case, 10 000 chars, a number, an
 *              object → "Other"; a hostile category code → a CSS-safe slug
 *
 * @born-red landing-category-scenarios | method: the landing handler's catch
 *   rethrown; the catalog read's SQL table names emptied and its `?? []`
 *   fallbacks dropped; the admin endpoint's Cache-Control and error log
 *   removed; categoryOf trimming/lower-casing the id; the slug left unsanitized;
 *   the category sort's label tie-break removed; the Type row offered for one
 *   category — each turned a test red (9 faults, 9 red; and see the Stryker run) |
 *   date: 2026-11-09
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventTypeCatalog } from '../src/lib/event-type-catalog';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** null: the real read; otherwise what the landing's catalog read does. */
  read: null as null | (() => Promise<EventTypeCatalog>),
}));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => ({ data: state.rows, source: 'live', cacheAge: null }),
  }),
}));
vi.mock('../src/lib/sponsor-titles', async () => ({
  fetchSponsorTitles: async () => new Map(),
}));
vi.mock('../src/lib/event-type-catalog-read', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/event-type-catalog-read')>();
  return {
    ...real,
    readEventTypeCatalog: (db: D1Database | null | undefined) =>
      state.read ? state.read() : real.readEventTypeCatalog(db),
  };
});

import { handleLandingPage } from '../src/handlers/pages';
import { handleAdminListEventTypes } from '../src/handlers/events';
import { readEventTypeCatalog } from '../src/lib/event-type-catalog-read';
import {
  buildEventTypeCatalog,
  categoryByTypeId,
  isEventTypeIdShape,
  OTHER_CATEGORY_CODE,
  type EventTypeCategoryRow,
  type EventTypeRow,
} from '../src/lib/event-type-catalog';
import { renderLandingArea, type LandingAreaItem } from '../src/lib/landing-area';
import { FEW, MANY, NOW, goldenCatalog } from './helpers/list-landing-rows';

// ── a fake D1 that answers the two registry queries by table name ──────────
const CATS: EventTypeCategoryRow[] = [
  { category_code: 'ART', display_name: 'Arts', display_order: 50, is_active: 1 },
  { category_code: 'REC', display_name: 'Sports', display_order: 10, is_active: 1 },
];
const TYPES: EventTypeRow[] = [
  {
    id: 'etr-art-music',
    uec_code: 'ART-MUSIC-001',
    name: 'Live Music',
    description: null,
    category_code: 'ART',
    is_active: 1,
  },
  {
    id: 'etr-art-gallery',
    uec_code: 'ART-GALLERY-001',
    name: 'Gallery',
    description: 'Walls',
    category_code: 'ART',
    is_active: 1,
  },
  {
    id: 'etr-rec-bocce',
    uec_code: 'REC-BOCCE-001',
    name: 'Bocce',
    description: null,
    category_code: 'REC',
    is_active: 1,
  },
];

function fakeDb(opts: { results?: 'missing'; fail?: boolean } = {}) {
  const sql: string[] = [];
  const db = {
    prepare(q: string) {
      sql.push(q);
      return {
        all: async () => {
          if (opts.fail) throw new Error('D1 down');
          if (opts.results === 'missing') return {};
          if (/FROM event_type_category_registry\b/.test(q) && /is_active = 1/.test(q))
            return { results: CATS };
          if (/FROM event_type_registry\b/.test(q) && /is_active = 1/.test(q))
            return { results: TYPES };
          return { results: [] };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, sql };
}

// ── the catalog read (src/lib/event-type-catalog-read.ts) ─────────────────
describe('readEventTypeCatalog', () => {
  it('happy: both registry tables, grouped by the pure catalog', async () => {
    const { db, sql } = fakeDb();
    const cat = await readEventTypeCatalog(db);
    expect(cat).toEqual(buildEventTypeCatalog(CATS, TYPES));
    expect(cat.categories.map((c) => c.code)).toEqual(['REC', 'ART']);
    expect(cat.orphans).toBe(0);
    expect(sql).toHaveLength(2);
    for (const col of ['category_code', 'display_name', 'display_order']) {
      expect(sql[0]).toContain(col);
    }
    for (const col of ['id', 'uec_code', 'name', 'description', 'category_code']) {
      expect(sql[1]).toContain(col);
    }
  });

  it('negative: no database (null or undefined) is an empty catalog, never a throw', async () => {
    expect(await readEventTypeCatalog(null)).toEqual({ categories: [], orphans: 0 });
    expect(await readEventTypeCatalog(undefined)).toEqual({ categories: [], orphans: 0 });
  });

  it('negative: a D1 answer without results is an empty catalog', async () => {
    expect(await readEventTypeCatalog(fakeDb({ results: 'missing' }).db)).toEqual({
      categories: [],
      orphans: 0,
    });
  });

  it('negative: a failing D1 rejects (the callers decide what that means)', async () => {
    await expect(readEventTypeCatalog(fakeDb({ fail: true }).db)).rejects.toThrow('D1 down');
  });
});

// ── categoryByTypeId (src/lib/event-type-catalog.ts) ──────────────────────
describe('categoryByTypeId', () => {
  it('maps every type to its category with the catalog position; orphans to Other', () => {
    const map = categoryByTypeId(
      buildEventTypeCatalog(CATS, [
        ...TYPES,
        {
          id: 'etr-zzz',
          uec_code: 'ZZZ-1',
          name: 'Orphan',
          description: null,
          category_code: 'ZZZ',
        },
      ])
    );
    expect(map.get('etr-rec-bocce')).toEqual({ code: 'REC', name: 'Sports', order: 0 });
    expect(map.get('etr-art-music')).toEqual({ code: 'ART', name: 'Arts', order: 1 });
    expect(map.get('etr-art-gallery')).toEqual({ code: 'ART', name: 'Arts', order: 1 });
    expect(map.get('etr-zzz')).toEqual({ code: 'OTHER', name: 'Other', order: 2 });
    expect(map.size).toBe(4);
  });

  it('the "Other" bucket is code OTHER, the value the admin picker API returns', () => {
    // A literal, not the constant compared with itself: mutated, both sides move.
    expect(OTHER_CATEGORY_CODE).toBe('OTHER');
  });

  it('an empty catalog is an empty map', () => {
    expect(categoryByTypeId({ categories: [], orphans: 0 }).size).toBe(0);
  });
});

// ── buildEventTypeCatalog + isEventTypeIdShape (the grouping the map reads) ─
describe('buildEventTypeCatalog grouping', () => {
  const t = (id: string, name: string, code: string | null): EventTypeRow => ({
    id,
    uec_code: id.toUpperCase(),
    name,
    description: null,
    category_code: code,
  });

  it('types are alphabetical inside a category and inside "Other"; orphans are counted', () => {
    const cat = buildEventTypeCatalog(CATS, [
      t('a3', 'Zither Night', 'ART'),
      t('a1', 'Accordion Hour', 'ART'),
      t('a2', 'Mime', 'ART'),
      t('o2', 'Yodel', 'NOPE'),
      t('o1', 'Banjo', null),
    ]);
    expect(cat.categories.map((c) => c.code)).toEqual(['ART', 'OTHER']);
    expect(cat.categories[0].types.map((x) => x.name)).toEqual([
      'Accordion Hour',
      'Mime',
      'Zither Night',
    ]);
    expect(cat.categories[1].types.map((x) => x.name)).toEqual(['Banjo', 'Yodel']);
    expect(cat.orphans).toBe(2);
  });

  it('a category with no type is left out (REC has none here)', () => {
    const cat = buildEventTypeCatalog(CATS, [t('a1', 'Mime', 'ART')]);
    expect(cat.categories.map((c) => c.code)).toEqual(['ART']);
    expect(cat.orphans).toBe(0);
  });

  it.each([
    ['etr-rec-bocce', true],
    ['a', true],
    ['a'.repeat(64), true],
    ['a'.repeat(65), false],
    ['Etr-rec-bocce', false],
    [' etr-rec-bocce', false],
    ['etr rec', false],
    ['-etr', false],
    ['', false],
    [42, false],
    [null, false],
  ])('isEventTypeIdShape(%j) is %s', (v, ok) => {
    expect(isEventTypeIdShape(v)).toBe(ok);
  });
});

// ── the renderer: edge and fat-finger cases ────────────────────────────────
const T0 = Date.parse('2026-09-13T00:00:00.000Z');
const CATALOG = categoryByTypeId(buildEventTypeCatalog(CATS, TYPES));
function ev(id: string, event_type_id: unknown): LandingAreaItem {
  return {
    id,
    name: `Event ${id}`,
    startDateISO: new Date(T0 + 3 * 86_400_000).toISOString(),
    phase: 'pre_event',
    venue: 'A hall',
    lat: 41.9,
    lon: -87.6,
    event_type_id,
  };
}
const area = (items: LandingAreaItem[], cats = CATALOG) =>
  renderLandingArea(items, { now: T0, typeCategories: cats });
const cardClasses = (html: string, id: string) =>
  html
    .match(
      new RegExp(`<article class="([^"]*)" data-testid="area-card" data-event-id="${id}"`)
    )?.[1]
    ?.split(' ') ?? [];

describe('renderer edge cases', () => {
  it('happy: two types in one category are one chip, and both cards carry it', () => {
    const out = area([
      ev('m', 'etr-art-music'),
      ev('g', 'etr-art-gallery'),
      ev('b', 'etr-rec-bocce'),
    ]);
    expect(out.categories).toEqual([
      { slug: 'cat-rec', label: 'Sports' },
      { slug: 'cat-art', label: 'Arts' },
    ]);
    expect(cardClasses(out.html, 'm')).toContain('cat-art');
    expect(cardClasses(out.html, 'g')).toContain('cat-art');
    expect(out.html).toContain('data-testid="toggle-type"');
  });

  it('edge: one category only (two types in it) offers no Type row', () => {
    const out = area([ev('m', 'etr-art-music'), ev('g', 'etr-art-gallery')]);
    expect(out.categories).toEqual([{ slug: 'cat-art', label: 'Arts' }]);
    expect(out.html).not.toContain('data-testid="toggle-type"');
    expect(out.html).not.toContain('name="type"');
    // The card still carries its category class.
    expect(cardClasses(out.html, 'm')).toContain('cat-art');
  });

  it('edge: equal catalog order falls back to the alphabet', () => {
    const tied = new Map([
      ['t-z', { code: 'ZED', name: 'Zebra Club', order: 3 }],
      ['t-a', { code: 'ANT', name: 'Ant Farm', order: 3 }],
    ]);
    expect(area([ev('1', 't-z'), ev('2', 't-a')], tied).categories.map((c) => c.label)).toEqual([
      'Ant Farm',
      'Zebra Club',
    ]);
  });

  it('edge: "Other" sorts after a category with a very high order', () => {
    const far = new Map([['t-far', { code: 'FAR', name: 'Far', order: 1e9 }]]);
    expect(area([ev('1', null), ev('2', 't-far')], far).categories.map((c) => c.slug)).toEqual([
      'cat-far',
      'cat-other',
    ]);
  });

  it.each([
    ['padded with spaces', ' etr-art-music '],
    ['upper case', 'ETR-ART-MUSIC'],
    ['a trailing newline', 'etr-art-music\n'],
    ['10 000 characters', 'etr-art-music'.padEnd(10_000, 'x')],
    ['a number', 42],
    ['an object', { id: 'etr-art-music' }],
    ['an empty string', ''],
  ])('fat finger: an event_type_id %s is "Other", never a guessed category', (_, id) => {
    const out = area([ev('x', id), ev('b', 'etr-rec-bocce')]);
    expect(out.categories).toEqual([
      { slug: 'cat-rec', label: 'Sports' },
      { slug: 'cat-other', label: 'Other' },
    ]);
    const cls = cardClasses(out.html, 'x');
    expect(cls).toContain('cat-other');
    // The raw value never reaches the markup as a class.
    expect(cls.every((k) => k.length < 40)).toBe(true);
  });

  it('fat finger: a hostile category code becomes a CSS-safe slug; the name is escaped', () => {
    const hostile = new Map([
      ['t-h', { code: ' X){}body{display:none} "<', name: 'A "quoted" <b>name</b>', order: 0 }],
    ]);
    const out = area([ev('h', 't-h'), ev('o', null)], hostile);
    expect(out.categories[0].slug).toBe('cat-x-body-display-none');
    expect(out.categories[0].slug).toMatch(/^cat-[a-z0-9-]+$/);
    expect(out.html).not.toContain('body{display:none}');
    expect(out.html).not.toContain('<b>name</b>');
    expect(out.html).toContain('&lt;b&gt;name&lt;/b&gt;');
  });

  it('fat finger: a code with no letters or digits still gets a usable slug', () => {
    const blank = new Map([['t-b', { code: '!!!', name: 'Bangs', order: 0 }]]);
    expect(area([ev('b', 't-b'), ev('o', null)], blank).categories[0].slug).toBe('cat-other');
  });
});

// ── the landing handler (src/handlers/pages.ts handleLandingPage) ───────────
async function landing(): Promise<string> {
  const res = await handleLandingPage(
    {} as never,
    null,
    new Request('https://oursharedevents.com/')
  );
  expect(res.status).toBe(200);
  return res.text();
}
const typeRow = (html: string) =>
  html.match(/data-testid="toggle-type">([\s\S]*?)<\/fieldset>/)?.[1] ?? null;

describe('GET / reads the catalog for its Type row', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    state.read = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    state.read = null;
  });

  it('happy: a catalog gives one chip per category present', async () => {
    state.rows = MANY;
    state.read = async () => goldenCatalog();
    const row = typeRow(await landing());
    expect(row).not.toBeNull();
    expect(row).toContain('Entertainment &amp; Trivia');
    expect(row).toContain('Sports &amp; Recreation');
  });

  it('negative: a failed catalog read still lists every card, all "Other", with no Type row', async () => {
    state.rows = FEW;
    state.read = async () => {
      throw new Error('catalog read failed');
    };
    const html = await landing();
    expect(typeRow(html)).toBeNull();
    const cards = [...html.matchAll(/data-testid="area-card" data-event-id="([^"]+)"/g)];
    expect(cards.length).toBeGreaterThan(0);
    for (const [, id] of cards) expect(cardClasses(html, id)).toContain('cat-other');
    expect(html).not.toContain('data-testid="area-empty"');
  });

  it('negative: no database binding is the real empty catalog — no row, cards shown', async () => {
    state.rows = FEW;
    const html = await landing();
    expect(typeRow(html)).toBeNull();
    expect(html).toContain('data-testid="area-card"');
  });
});

// ── the admin picker endpoint (src/handlers/events.ts) ─────────────────────
describe('GET /api/v2/admin/event-types', () => {
  const req = () => new Request('https://oursharedevents.com/api/v2/admin/event-types');

  it('happy: the catalog in the envelope, private-cached for five minutes', async () => {
    const res = await handleAdminListEventTypes(req(), { DB: fakeDb().db } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, ...buildEventTypeCatalog(CATS, TYPES) });
  });

  it('negative: no database is a 503 DB_NOT_CONFIGURED', async () => {
    const res = await handleAdminListEventTypes(req(), {} as never);
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: false,
      code: 'DB_NOT_CONFIGURED',
      error: 'Database not available',
    });
  });

  it('negative: a failed read is a 503 DB_ERROR and one log line naming the handler', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await handleAdminListEventTypes(req(), {
        DB: fakeDb({ fail: true }).db,
      } as never);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        ok: false,
        code: 'DB_ERROR',
        error: 'Failed to list event types',
      });
      expect(log).toHaveBeenCalledTimes(1);
      const line = JSON.parse(String(log.mock.calls[0][0])) as Record<string, unknown>;
      expect(line.type).toBe('DB_ERROR');
      expect(line.handler).toBe('handleAdminListEventTypes');
      expect(typeof line.error).toBe('string');
    } finally {
      log.mockRestore();
    }
  });
});

describe('buildEventTypeCatalog keeps only active rows', () => {
  it('an inactive type is skipped; is_active 1 or absent is kept; no description is null', () => {
    const cat = buildEventTypeCatalog(CATS, [
      { ...TYPES[0], is_active: 0 },
      { ...TYPES[1], is_active: 1 },
      { ...TYPES[2], is_active: undefined, description: undefined as unknown as null },
    ]);
    const ids = cat.categories.flatMap((c) => c.types.map((t) => t.id));
    expect(ids.sort()).toEqual(['etr-art-gallery', 'etr-rec-bocce']);
    const bocce = cat.categories.find((c) => c.code === 'REC')?.types[0];
    expect(bocce).toEqual({
      id: 'etr-rec-bocce',
      uec_code: 'REC-BOCCE-001',
      name: 'Bocce',
      description: null,
    });
    expect(cat.categories.find((c) => c.code === 'ART')?.types[0].description).toBe('Walls');
  });

  it('an inactive category is left out and its types count as orphans', () => {
    const cat = buildEventTypeCatalog([{ ...CATS[0], is_active: 0 }, CATS[1]], TYPES);
    expect(cat.categories.map((c) => c.code)).toEqual(['REC', 'OTHER']);
    expect(cat.orphans).toBe(2);
  });
});
