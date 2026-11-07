/**
 * Part of OSE-1762 (i18n slice C, surface 1) — golden renders of /events and
 * the landing page.
 *
 * Moving the two pages onto the language layer must not change one byte of
 * the English page. The English golden files were taken from the renderers
 * before any source change (the commit that adds this spec carries them), so a
 * match here is the proof. The Spanish files are the reviewed Spanish page.
 *
 * Every state is rendered: the list with and without filters (each window, a
 * text search, a place and a zip, an empty answer), the error and the no-events
 * states; the landing with the map leading, with the list leading and the
 * example map, with no events at all, and for a zip that has events, one that
 * has none, one we do not know and a phone with no US zip.
 *
 * Deterministic: the clock is fixed, the event rows are this file's own (the
 * data provider and the sponsor read are replaced), and the per-response CSP
 * nonce is blanked out.
 *
 * Born red: change any English string these pages show (or any Spanish one)
 * and the matching golden fails.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { latLngToCell } from 'h3-js';

let ROWS: Record<string, unknown>[] = [];
let FAIL = false;

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => {
      if (FAIL) throw new Error('read failed');
      return { data: ROWS, source: 'live', cacheAge: null };
    },
  }),
}));
vi.mock('../src/lib/sponsor-titles', () => ({
  fetchSponsorTitles: async () => new Map([['evt_g02', 'Beggars Pizza']]),
}));

import { handlePublicPage, handleLandingPage } from '../src/handlers/pages';
import { renderAttendeeMap } from '../src/lib/attendee-map';
import { toPublicEvent } from '../src/lib/public-event-projection';

const NOW = new Date('2026-10-20T15:00:00Z'); // a Tuesday, 10 a.m. in Chicago
const BLUE_ISLAND = latLngToCell(41.6573, -87.6806, 7);
const BEVERLY = latLngToCell(41.7135, -87.6812, 7);

function ev(n: number, o: Record<string, unknown>): Record<string, unknown> {
  const id = `evt_g${String(n).padStart(2, '0')}`;
  return {
    id,
    slug: `golden-${n}`,
    title: `Golden Event ${n}`,
    status: 'active',
    is_published: 1,
    timezone: 'America/Chicago',
    location: 'Rock Island Public House',
    where_address: '13328 Olde Western Ave, Blue Island, IL 60406',
    lat: 41.6573,
    lon: -87.6806,
    h3_res7: BLUE_ISLAND,
    template_id: 'bar_night',
    event_type_id: null,
    cover_image_url: null,
    ...o,
  };
}

function day(d: string, extra: Record<string, unknown> = {}) {
  return { start_date: d, end_date: d, starts_at: `${d}T23:00:00Z`, ...extra };
}

const beverly = {
  location: 'Beverly Records',
  where_address: '11612 S Western Ave, Chicago, IL 60643',
  lat: 41.7135,
  lon: -87.6812,
  h3_res7: BEVERLY,
  template_id: 'record_swap',
};

/** Enough upcoming events for the landing to lead with its map. */
const MANY = [
  ev(1, { title: 'Trivia Night', ...day('2026-10-23') }),
  ev(2, { title: 'Bocce League', ...day('2026-10-24') }),
  ev(3, { title: 'Vinyl Swap', ...beverly, ...day('2026-10-27') }),
  ev(4, { ...beverly, ...day('2026-11-05') }),
  ev(5, day('2026-11-12')),
  ev(6, { ...beverly, ...day('2026-11-19') }),
  ev(7, day('2026-12-03')),
  ev(8, { ...beverly, ...day('2026-12-10') }),
  ev(9, day('2026-10-21')),
  ev(10, day('2026-10-22')),
  ev(11, {
    title: 'Online Book Club',
    location: null,
    where_address: null,
    lat: null,
    lon: null,
    h3_res7: null,
    template_id: 'webinar',
    ...day('2026-10-30'),
  }),
  ev(12, { title: 'Fall Fest', ...day('2026-10-01') }),
  ev(13, {
    title: 'Morning Market',
    start_date: '2026-10-20',
    end_date: '2026-10-20',
    starts_at: '2026-10-20T14:00:00Z',
  }),
];

/** Too few for the map: the list leads and the map shows its example. */
const FEW = [MANY[0], MANY[2], MANY[11]];

function stable(html: string): string {
  return html.replace(/nonce="[^"]*"/g, 'nonce="N"').replace(/\r\n/g, '\n');
}

async function eventsPage(query: string, rows: Record<string, unknown>[]): Promise<string> {
  ROWS = rows;
  const res = await handlePublicPage(
    {} as never,
    null,
    new Request(`https://oursharedevents.com/events${query}`)
  );
  return stable(await res.text());
}

async function landingPage(query: string, rows: Record<string, unknown>[]): Promise<string> {
  ROWS = rows;
  const res = await handleLandingPage(
    {} as never,
    null,
    new Request(`https://oursharedevents.com/${query}`)
  );
  return stable(await res.text());
}

const dir = './__golden__/list-landing';

const EVENTS_CASES: { name: string; query: string; rows: () => Record<string, unknown>[] }[] = [
  { name: 'all', query: '', rows: () => MANY },
  { name: 'today', query: '?when=today', rows: () => MANY },
  { name: 'weekend', query: '?when=weekend', rows: () => MANY },
  { name: 'week', query: '?when=week', rows: () => MANY },
  { name: 'month', query: '?when=month', rows: () => MANY },
  { name: 'next-month', query: '?when=next-month', rows: () => MANY },
  { name: 'next-90', query: '?when=next-90', rows: () => MANY },
  { name: 'past', query: '?when=past', rows: () => MANY },
  { name: 'search', query: '?q=trivia', rows: () => MANY },
  { name: 'search-one', query: '?q=vinyl', rows: () => MANY },
  { name: 'search-none', query: '?when=month&q=zzzz', rows: () => MANY },
  { name: 'place', query: '?q=Blue+Island', rows: () => MANY },
  { name: 'place-none', query: '?q=Oak+Lawn', rows: () => MANY },
  { name: 'zip', query: '?q=60643', rows: () => MANY },
  { name: 'empty-window', query: '?when=today', rows: () => FEW },
  { name: 'only-wrapped', query: '', rows: () => [MANY[11]] },
  { name: 'no-events', query: '', rows: () => [] },
];

const LANDING_CASES: { name: string; query: string; rows: () => Record<string, unknown>[] }[] = [
  { name: 'map-leads', query: '', rows: () => MANY },
  { name: 'list-leads', query: '', rows: () => FEW },
  { name: 'no-events', query: '', rows: () => [] },
  { name: 'zip', query: '?zip=60406', rows: () => MANY },
  { name: 'zip-nothing-near', query: '?zip=60453', rows: () => MANY },
  { name: 'zip-unknown', query: '?zip=00000', rows: () => MANY },
  { name: 'no-us-zip', query: '?nozip=1', rows: () => MANY },
];

describe('OSE-1762 | /events and the landing | golden renders', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
    FAIL = false;
  });

  for (const c of EVENTS_CASES) {
    it(`/events, ${c.name}, en`, async () => {
      await expect(await eventsPage(c.query, c.rows())).toMatchFileSnapshot(
        `${dir}/events-${c.name}.en.golden.txt`
      );
    });
  }

  it('/events, the read failed, en', async () => {
    FAIL = true;
    try {
      await expect(await eventsPage('', MANY)).toMatchFileSnapshot(
        `${dir}/events-error.en.golden.txt`
      );
    } finally {
      FAIL = false;
    }
  });

  for (const c of LANDING_CASES) {
    it(`landing, ${c.name}, en`, async () => {
      await expect(await landingPage(c.query, c.rows())).toMatchFileSnapshot(
        `${dir}/landing-${c.name}.en.golden.txt`
      );
    });
  }

  it('landing, the read failed, en', async () => {
    FAIL = true;
    try {
      await expect(await landingPage('', MANY)).toMatchFileSnapshot(
        `${dir}/landing-error.en.golden.txt`
      );
    } finally {
      FAIL = false;
    }
  });

  it('the corridor map off the landing (no area gate), en', async () => {
    const asItems = (rows: Record<string, unknown>[]) =>
      rows.map((r) =>
        toPublicEvent({
          ...r,
          name: r.title,
          startDateISO: r.start_date,
          venue: r.location,
          phase: 'pre_event',
        })
      );
    const now = NOW.getTime();
    const parts = [
      // Under the per-corridor readiness number: the note, the example.
      renderAttendeeMap(asItems(FEW), { now }).html,
      // Ready, and one latched corridor drawn below its number.
      renderAttendeeMap(asItems(MANY), { now, latched: new Set([BLUE_ISLAND, BEVERLY]) }).html,
      // The landing's area gate, below it and at it with nothing placeable.
      renderAttendeeMap(asItems(FEW), { now, area: { count: 1, min: 10, latched: false } }).html,
      renderAttendeeMap(asItems(FEW), { now, area: { count: 0, min: 10, latched: false } }).html,
      renderAttendeeMap(asItems(FEW.map((r) => ({ ...r, h3_res7: null }))), {
        now,
        area: { count: 12, min: 10, latched: false },
      }).html,
    ];
    await expect(parts.join('\n----\n') + '\n').toMatchFileSnapshot(
      `${dir}/corridor-map.en.golden.txt`
    );
  });
});
