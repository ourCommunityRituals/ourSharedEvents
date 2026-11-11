/**
 * OSE-1955 (feature OSE-1948): the two SQL rules behind the event page's sponsor
 * thumbnails, run for real so Stryker can mutate the code around them.
 *
 *   1. Which sponsors the page lists, and whether each shows art: the sponsor
 *      query in `fetchEventPageSocialData` (src/handlers/pages.ts). The two-sided
 *      consent gate (sponsor accepted, organizer accepted under the source-aware
 *      rule), the active flags, the event's own yes to sponsors (OSE-1900), the
 *      order, and `has_logo`: a compact logo, else the header logo, and never an
 *      empty string.
 *   2. Which image the logo proxy serves for a sponsor (`handleSponsorLogo` in
 *      src/handlers/sponsors.ts): `?slot=sidebar` the compact logo, else the
 *      header logo (the same pick as `has_logo`, so the page only asks for art it
 *      will get); no slot, the header logo; `?slot=header`, the header image;
 *      and behind the same consent gate, a 404 with no outbound fetch.
 *
 * The database is Node's own SQLite with every migration applied
 * (tests/helpers/sqlite-d1.ts), so the statements are the shipped ones against
 * the shipped schema. Outbound logo fetches are answered by a stub that records
 * the address asked for. The workers-pool flows (sponsor-thumb-flows.spec.ts)
 * hold the same rules through the router; this file is their node-project twin,
 * fast enough to run once per mutant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sqliteD1, type SqliteD1 } from './helpers/sqlite-d1';
import { fetchEventPageSocialData } from '../src/handlers/pages';
import { handleSponsorLogo } from '../src/handlers/sponsors';

const BRAND = 'brand_sql';
const EVENT = 'evt_sql';

let db: SqliteD1;
let seq = 0;

function event(id: string, settings = '{"useSponsors":true}'): void {
  db.raw
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date, settings_json)
       VALUES (?, ?, ?, ?, 'active', '2026-12-01T18:00:00Z', '2026-12-01T21:00:00Z', ?)`
    )
    .run(id, BRAND, `Event ${id}`, id, settings);
}

interface Sponsor {
  id: string;
  name?: string;
  website?: string | null;
  displayName?: string | null;
  address?: string | null;
  header?: string | null;
  compact?: string | null;
  headerImage?: string | null;
  businessActive?: number;
  placementActive?: number;
  sponsorAccepted?: number;
  organizerAccepted?: number | null;
  source?: string;
  eventId?: string;
}

function sponsor(s: Sponsor): void {
  db.raw
    .prepare(
      `INSERT INTO sponsor_business (id, brand_id, name, website_url, display_name, address_line,
                                     header_image_url, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      s.id,
      BRAND,
      s.name ?? `Sponsor ${s.id}`,
      s.website ?? null,
      s.displayName ?? null,
      s.address ?? null,
      s.headerImage ?? null,
      s.businessActive ?? 1
    );
  db.raw
    .prepare(
      `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, polarity,
                                      is_active, organizer_accepted, sponsor_accepted)
       VALUES (?, ?, ?, 'gold', ?, 1, ?, ?, ?)`
    )
    .run(
      `spl_${s.id}_${++seq}`,
      s.id,
      s.eventId ?? EVENT,
      s.source ?? 'organizer',
      s.placementActive ?? 1,
      s.organizerAccepted === undefined ? 1 : s.organizerAccepted,
      s.sponsorAccepted ?? 1
    );
  for (const [format, url] of [
    ['logo', s.header],
    ['logo_compact', s.compact],
  ] as const) {
    if (url === undefined) continue;
    db.raw
      .prepare(
        `INSERT INTO sponsor_asset (id, sponsor_business_id, format, url) VALUES (?, ?, ?, ?)`
      )
      .run(`sa_${s.id}_${format}_${++seq}`, s.id, format, url);
  }
}

beforeEach(() => {
  db = sqliteD1();
  event(EVENT);
});

/** A D1 that accepts a statement and fails when it runs, as D1 does on an outage. */
function brokenDb() {
  const fail = async () => {
    throw new Error('D1_ERROR: database unavailable');
  };
  const stmt = { bind: () => stmt, first: fail, all: fail, run: fail };
  return { prepare: () => stmt };
}

// ── 1. the page's sponsor list ───────────────────────────────────────────────

async function listed(eventId = EVENT) {
  const social = await fetchEventPageSocialData({ DB: db } as never, eventId);
  return social.sponsors.map((s) => ({ id: s.id, has_logo: Number(s.has_logo) }));
}

describe('OSE-1955 the page lists a sponsor only when both sides said yes', () => {
  it('lists an accepted sponsor with all its public fields, in id order', async () => {
    sponsor({ id: 'sp_b', name: 'Bee', website: 'https://bee.example.com/', address: '1 Main' });
    sponsor({ id: 'sp_a', name: 'Ay', displayName: 'Ay & Co' });
    const social = await fetchEventPageSocialData({ DB: db } as never, EVENT);
    expect(social.sponsors).toEqual([
      {
        id: 'sp_a',
        name: 'Ay',
        website_url: null,
        display_name: 'Ay & Co',
        address_line: null,
        has_logo: 0,
      },
      {
        id: 'sp_b',
        name: 'Bee',
        website_url: 'https://bee.example.com/',
        display_name: null,
        address_line: '1 Main',
        has_logo: 0,
      },
    ]);
  });

  it.each([
    ['the sponsor has not accepted', { sponsorAccepted: 0 }],
    ['the organizer said no', { organizerAccepted: 0 }],
    [
      'a sponsor request the organizer has not answered',
      { source: 'sponsor_request', organizerAccepted: null },
    ],
    ['the placement is off', { placementActive: 0 }],
    ['the business is off', { businessActive: 0 }],
  ] as const)('leaves a sponsor out when %s', async (_why, over) => {
    sponsor({ id: 'sp_shown' });
    sponsor({ id: 'sp_hidden', ...over });
    expect(await listed()).toEqual([{ id: 'sp_shown', has_logo: 0 }]);
  });

  it('an organizer placement with no organizer answer yet counts as the organizer’s yes', async () => {
    sponsor({ id: 'sp_org', source: 'organizer', organizerAccepted: null });
    expect(await listed()).toEqual([{ id: 'sp_org', has_logo: 0 }]);
  });

  it('an answered sponsor request shows', async () => {
    sponsor({ id: 'sp_req', source: 'sponsor_request', organizerAccepted: 1 });
    expect(await listed()).toEqual([{ id: 'sp_req', has_logo: 0 }]);
  });

  it.each([
    ['has not chosen sponsors', '{}'],
    ['said no to sponsors', '{"useSponsors":false}'],
    ['has unreadable settings', 'not json'],
  ])('lists no one on an event that %s', async (_why, settings) => {
    event('evt_no', settings);
    sponsor({ id: 'sp_x', eventId: 'evt_no' });
    expect(await listed('evt_no')).toEqual([]);
  });

  it('lists only this event’s placements', async () => {
    event('evt_other');
    sponsor({ id: 'sp_here' });
    sponsor({ id: 'sp_there', eventId: 'evt_other' });
    expect(await listed()).toEqual([{ id: 'sp_here', has_logo: 0 }]);
  });

  it('no database is an empty list, and a database that fails is one too', async () => {
    expect((await fetchEventPageSocialData({} as never, EVENT)).sponsors).toEqual([]);
    const broken = brokenDb();
    expect((await fetchEventPageSocialData({ DB: broken } as never, EVENT)).sponsors).toEqual([]);
  });
});

describe('OSE-1955 has_logo: art when the proxy has an image to serve', () => {
  it.each([
    ['a compact logo', { compact: 'https://cdn.example.com/c.png' }, 1],
    ['a header logo', { header: 'https://cdn.example.com/h.png' }, 1],
    [
      'both',
      { compact: 'https://cdn.example.com/c.png', header: 'https://cdn.example.com/h.png' },
      1,
    ],
    ['no logo row', {}, 0],
    ['an empty compact logo and no header', { compact: '' }, 0],
    ['an empty header logo and no compact', { header: '' }, 0],
    // The proxy's pick is COALESCE(compact, header), so an empty compact hides the
    // header there too: the page shows the name, never an image that 404s.
    [
      'an empty compact logo over a header logo',
      { compact: '', header: 'https://cdn.example.com/h.png' },
      0,
    ],
    ['only a header image (the poster slot)', { headerImage: 'https://cdn.example.com/hi.png' }, 0],
  ] as const)('%s → has_logo %i', async (_what, logos, want) => {
    sponsor({ id: 'sp_logo', ...logos });
    expect(await listed()).toEqual([{ id: 'sp_logo', has_logo: want }]);
  });
});

// ── 2. the logo proxy's pick ─────────────────────────────────────────────────

let asked: string[];

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input instanceof Request ? input.url : input));
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

async function logo(id: string, slot?: string) {
  const q = slot === undefined ? '' : `?slot=${slot}`;
  const res = await handleSponsorLogo(
    new Request(`https://t.test/api/v2/sponsors/${id}/logo${q}`),
    { DB: db } as never,
    id
  );
  return { status: res.status, asked: [...asked], rid: res.headers.get('X-Request-Id') };
}

const C = 'https://cdn.example.com/compact.png';
const H = 'https://cdn.example.com/header.png';
const I = 'https://cdn.example.com/header-image.png';

describe('OSE-1955 the logo proxy serves the art the page asked for', () => {
  it('slot=sidebar: the compact logo when there is one', async () => {
    sponsor({ id: 'sp_both', compact: C, header: H, headerImage: I });
    expect(await logo('sp_both', 'sidebar')).toMatchObject({ status: 200, asked: [C] });
  });

  it('slot=sidebar: the header logo when there is no compact one', async () => {
    sponsor({ id: 'sp_h', header: H });
    expect(await logo('sp_h', 'sidebar')).toMatchObject({ status: 200, asked: [H] });
  });

  it('slot=sidebar: no logo at all is a 404 and no fetch', async () => {
    sponsor({ id: 'sp_none', headerImage: I });
    const r = await logo('sp_none', 'sidebar');
    expect(r).toMatchObject({ status: 404, asked: [] });
    expect(r.rid).toBeTruthy();
  });

  it('no slot, or any other slot: the header logo, never the compact one', async () => {
    sponsor({ id: 'sp_both', compact: C, header: H, headerImage: I });
    expect(await logo('sp_both')).toMatchObject({ status: 200, asked: [H] });
    asked.length = 0;
    expect(await logo('sp_both', 'Sidebar')).toMatchObject({ status: 200, asked: [H] });
    sponsor({ id: 'sp_c', compact: C });
    asked.length = 0;
    expect(await logo('sp_c')).toMatchObject({ status: 404, asked: [] });
  });

  it('slot=header: the header image, and a 404 when there is none', async () => {
    sponsor({ id: 'sp_both', compact: C, header: H, headerImage: I });
    expect(await logo('sp_both', 'header')).toMatchObject({ status: 200, asked: [I] });
    sponsor({ id: 'sp_h', compact: C, header: H });
    asked.length = 0;
    expect(await logo('sp_h', 'header')).toMatchObject({ status: 404, asked: [] });
  });

  it.each([
    ['the sponsor has not accepted', { sponsorAccepted: 0 }],
    ['the organizer said no', { organizerAccepted: 0 }],
    [
      'a sponsor request the organizer has not answered',
      { source: 'sponsor_request', organizerAccepted: null },
    ],
    ['the placement is off', { placementActive: 0 }],
    ['the business is off', { businessActive: 0 }],
  ] as const)('404 and no fetch when %s', async (_why, over) => {
    sponsor({ id: 'sp_gate', compact: C, header: H, headerImage: I, ...over });
    for (const slot of ['sidebar', undefined, 'header']) {
      expect(await logo('sp_gate', slot)).toMatchObject({ status: 404, asked: [] });
    }
  });

  it('404 and no fetch on an event that has not chosen sponsors', async () => {
    event('evt_no', '{}');
    sponsor({ id: 'sp_off', compact: C, eventId: 'evt_no' });
    expect(await logo('sp_off', 'sidebar')).toMatchObject({ status: 404, asked: [] });
  });

  it('the asked sponsor only: another sponsor’s placement does not open the gate', async () => {
    sponsor({ id: 'sp_open', compact: C });
    db.raw
      .prepare(
        `INSERT INTO sponsor_business (id, brand_id, name) VALUES ('sp_closed', ?, 'Closed')`
      )
      .run(BRAND);
    db.raw
      .prepare(
        `INSERT INTO sponsor_asset (id, sponsor_business_id, format, url) VALUES ('sa_cl', 'sp_closed', 'logo_compact', ?)`
      )
      .run(C);
    expect(await logo('sp_closed', 'sidebar')).toMatchObject({ status: 404, asked: [] });
  });

  it('a database that fails is a 503 with a request id, and no fetch', async () => {
    const broken = brokenDb();
    const res = await handleSponsorLogo(
      new Request('https://t.test/api/v2/sponsors/sp_x/logo?slot=sidebar'),
      { DB: broken } as never,
      'sp_x'
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
    expect(asked).toEqual([]);
  });
});
