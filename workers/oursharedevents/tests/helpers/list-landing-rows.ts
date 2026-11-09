/**
 * Event rows for the /events and landing render specs (OSE-1762): the raw D1
 * shape the data provider returns, fixed in time against NOW. MANY is enough
 * upcoming events for the landing to lead with its map; FEW is too few, so the
 * list leads and the map shows its example. Between them every state of both
 * pages renders: each window, a wrapped event, a live one, an online one with
 * no venue, two neighborhoods, a consented sponsor (evt_g02).
 *
 * `named` lets a caller swap the organizer-written fields (title, venue,
 * address, type) for sentinels, so a language check can take them out.
 */
import { latLngToCell } from 'h3-js';
import { buildEventTypeCatalog, type EventTypeCatalog } from '../../src/lib/event-type-catalog';

export const NOW = new Date('2026-10-20T15:00:00Z'); // a Tuesday, 10 a.m. in Chicago
export const BLUE_ISLAND = latLngToCell(41.6573, -87.6806, 7);
export const BEVERLY = latLngToCell(41.7135, -87.6812, 7);
export const SPONSORED_EVENT = 'evt_g02';

type Row = Record<string, unknown>;

function ev(n: number, o: Row): Row {
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
    // Real registry ids (0024): the landing's Type row is their categories.
    event_type_id: 'etr-ent-trivia',
    cover_image_url: null,
    ...o,
  };
}

function day(d: string, extra: Row = {}): Row {
  return { start_date: d, end_date: d, starts_at: `${d}T23:00:00Z`, ...extra };
}

const beverly = {
  location: 'Beverly Records',
  where_address: '11612 S Western Ave, Chicago, IL 60643',
  lat: 41.7135,
  lon: -87.6812,
  h3_res7: BEVERLY,
  template_id: 'record_swap',
  event_type_id: 'etr-mkt-swap',
};

export const MANY: Row[] = [
  ev(1, { title: 'Trivia Night', ...day('2026-10-23') }),
  ev(2, { title: 'Bocce League', event_type_id: 'etr-rec-bocce', ...day('2026-10-24') }),
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
    event_type_id: 'etr-lit-bookclub',
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

export const FEW: Row[] = [MANY[0], MANY[2], MANY[11]];

/**
 * The event-type catalog for these rows, as the registry has it (0024/0076),
 * for a spec that replaces lib/event-type-catalog-read. `names` swaps the
 * category names (a sentinel per category, for the Spanish leak check).
 */
export function goldenCatalog(names?: Record<string, string>): EventTypeCatalog {
  const cat = (code: string, name: string, order: number) => ({
    category_code: code,
    display_name: names?.[code] ?? name,
    display_order: order,
  });
  const type = (id: string, uec: string, name: string, code: string) => ({
    id,
    uec_code: uec,
    name,
    description: null,
    category_code: code,
  });
  return buildEventTypeCatalog(
    [
      cat('REC', 'Sports & Recreation', 10),
      cat('ENT', 'Entertainment & Trivia', 30),
      cat('MKT', 'Neighborhood Markets', 70),
      cat('LIT', 'Literary & Book Clubs', 140),
    ],
    [
      type('etr-rec-bocce', 'REC-BOCCE-001', 'Bocce', 'REC'),
      type('etr-ent-trivia', 'ENT-TRIVIA-001', 'Trivia Night', 'ENT'),
      type('etr-mkt-swap', 'MKT-SWAP-001', 'Swap Meet', 'MKT'),
      type('etr-lit-bookclub', 'LIT-BOOKCLUB-001', 'Book Club', 'LIT'),
    ]
  );
}

/**
 * The same rows with every organizer-written word a ZZ sentinel. The town in
 * the address stays (it names the map's area, and a zip search reads it), but
 * the street and venue do not.
 */
export function sentinel(rows: Row[]): Row[] {
  return rows.map((r) => ({
    ...r,
    title: `ZZTITLE${String(r.id).slice(-2)}`,
    location: r.location ? 'ZZVENUE' : null,
    where_address: r.where_address ? String(r.where_address).replace(/^[^,]+/, 'ZZSTREET') : null,
    // The landing no longer shows it (its Type row is categories), but a sentinel keeps it out.
    template_id: r.template_id ? `zz${String(r.template_id).replace(/_/g, '')}` : null,
  }));
}
