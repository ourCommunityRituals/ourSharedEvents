/**
 * One report for a parent company over every venture below it (Part of OSE-2241).
 *
 * Owner, 2026-11-27: "one shared report that sits as [the parent company] over
 * all of their entities, so they can see all of the traffic, all of the
 * reporting, and all of the sponsor traffic", to show a corporate sponsor the
 * company's combined footprint. The family is the brand tree (migration 0118,
 * lib/brand-tree.ts): the parent and every brand below it.
 *
 * WHAT IT SHOWS. Traffic, never people:
 *   - poster scans: the poster-hour cells every scan figure is a sum of
 *     (lib/scan-cells.ts), vote codes left out, as in the venue roll-up;
 *   - link taps: shortlink clicks, per code, floored per event;
 *   - sponsor traffic: logo displays and taps from `sponsor_displays`, per
 *     event and sponsor, only for placements both sides agreed to;
 *   - sponsors on show, and the names of the businesses on show (a sponsor is
 *     named only where the sponsor and the organizer both said yes,
 *     PLACEMENT_ON_SHOW_SQL; never its own traffic figure);
 *   - the footprint: the res-7 map cells (about 5 km², never an address) the
 *     family's events are in, and the venues they are held at.
 * Never an event id, a title, a form, a registration or a person.
 *
 * THE FLOOR. Every part is floored before it joins a sum (floorTotalOfParts:
 * under 5 is withheld, from 5 up rounded down to a multiple of 5). A venture's
 * line is the floored sum of its own cells; the family total is the floored
 * sum of the venture lines, so a small venture is floored on its own before it
 * is added, and the lines add up to the total. The other breakdowns (venue,
 * night, map cell) are other floored sums of the same floored cells, so no
 * figure can be differenced down to a part under the floor.
 */
import { floorTotalOfParts, type FlooredCount } from './count-floor';
import { TAP_CODE_SQL } from './pre-event-activity';
import { scanHourSql } from './scan-cells';
import { PLACEMENT_ON_SHOW_SQL, sponsorTitle } from './sponsor-card';
import { withDescendants } from './brand-tree';
import { PLATFORM_BRAND_ID, PUBLIC_BRAND_ID } from './admin-brand-scope';

export type FamilyDataClass = 'production' | 'all';

export const BRAND_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** The platform and public brands are never a family (the public brand is every free organizer). */
export function familyBrandAllowed(brand: string): boolean {
  return BRAND_ID_RE.test(brand) && brand !== PLATFORM_BRAND_ID && brand !== PUBLIC_BRAND_ID;
}

export interface TrafficLine {
  events: number;
  poster_scans: FlooredCount;
  link_taps: FlooredCount;
  sponsor_displays: FlooredCount;
  sponsor_taps: FlooredCount;
}

export interface VentureLine extends TrafficLine {
  brand: string;
  role: 'parent' | 'venture';
  sponsors_on_show: number;
}

export interface PlaceLine {
  events: number;
  poster_scans: FlooredCount;
}

export interface FamilyReport {
  family: { parent: string; ventures: string[] };
  scope: { data_class: FamilyDataClass };
  generated_at: string;
  totals: TrafficLine & {
    ventures: number;
    venues: number;
    map_cells: number;
    sponsors_on_show: number;
    businesses_on_show: number;
  };
  by_venture: VentureLine[];
  by_venue: Array<PlaceLine & { name: string }>;
  by_night: Array<PlaceLine & { night: string }>;
  footprint: Array<PlaceLine & { cell: string }>;
  sponsors: string[];
}

const NIGHTS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const H3_RE = /^[0-9a-f]{15}$/;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function push<K>(m: Map<K, number[]>, k: K, v: number): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** The parts of each key, floored and summed. */
function floorEach<K>(m: Map<K, number[]>, k: K): FlooredCount {
  return floorTotalOfParts(m.get(k) ?? []);
}

/**
 * Build the report for `parent` and every brand below it. The caller has
 * already checked that it may read `parent`; this reads only the family.
 */
export async function buildFamilyReport(
  db: D1Database,
  parent: string,
  dc: FamilyDataClass
): Promise<FamilyReport> {
  const brands = (await withDescendants(db, [parent])).filter(familyBrandAllowed);
  const ph = brands.map(() => '?').join(', ');
  const DC = `(e.data_class = 'production' OR ? = 'all')`;
  const binds = [...brands, dc];

  const [events, scans, taps, sponsorTraffic, onShow] = await Promise.all([
    db
      .prepare(
        `SELECT e.brand_id AS brand, e.host_venue_id AS venue, v.name AS venue_name,
                e.h3_res7 AS cell, CAST(strftime('%w', e.start_date) AS INTEGER) AS dow
           FROM events e LEFT JOIN venues v ON v.id = e.host_venue_id
          WHERE e.brand_id IN (${ph}) AND ${DC}`
      )
      .bind(...binds)
      .all<{
        brand: string;
        venue: string | null;
        venue_name: string | null;
        cell: string | null;
        dow: number | null;
      }>(),
    db
      .prepare(
        `SELECT e.brand_id AS brand, e.host_venue_id AS venue, e.h3_res7 AS cell,
                CAST(strftime('%w', e.start_date) AS INTEGER) AS dow, COUNT(*) AS n
           FROM scan_placement_events s
           JOIN events e ON e.id = s.event_id
           JOIN poster_deployments pd ON pd.id = s.poster_deployment_id
          WHERE e.brand_id IN (${ph}) AND ${DC} AND pd.is_vote_code = 0
          GROUP BY e.brand_id, s.poster_deployment_id, ${scanHourSql('s')}`
      )
      .bind(...binds)
      .all<{
        brand: string;
        venue: string | null;
        cell: string | null;
        dow: number | null;
        n: number;
      }>(),
    db
      .prepare(
        `SELECT e.brand_id AS brand, sl.event_id AS event_id, COALESCE(SUM(sl.clicks), 0) AS taps
           FROM shortlinks sl JOIN events e ON e.id = sl.event_id
          WHERE e.brand_id IN (${ph}) AND ${DC}
          GROUP BY sl.event_id, ${TAP_CODE_SQL}`
      )
      .bind(...binds)
      .all<{ brand: string; event_id: string; taps: number }>(),
    db
      .prepare(
        `SELECT e.brand_id AS brand,
                SUM(CASE WHEN d.event_type = 'click' THEN 0 ELSE 1 END) AS displays,
                SUM(CASE WHEN d.event_type = 'click' THEN 1 ELSE 0 END) AS taps
           FROM sponsor_displays d
           JOIN events e ON e.id = d.event_id
           JOIN sponsor_placement sp ON sp.event_id = d.event_id AND sp.sponsor_business_id = d.sponsor_id
           JOIN sponsor_business sb ON sb.id = d.sponsor_id
          WHERE e.brand_id IN (${ph}) AND ${DC} AND ${PLACEMENT_ON_SHOW_SQL}
          GROUP BY d.event_id, d.sponsor_id`
      )
      .bind(...binds)
      .all<{ brand: string; displays: number; taps: number }>(),
    db
      .prepare(
        `SELECT e.brand_id AS brand, sb.id AS business, sb.name AS name, sb.display_name AS display_name
           FROM sponsor_placement sp
           JOIN events e ON e.id = sp.event_id
           JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
          WHERE e.brand_id IN (${ph}) AND ${DC} AND ${PLACEMENT_ON_SHOW_SQL}`
      )
      .bind(...binds)
      .all<{ brand: string; business: string; name: string; display_name: string | null }>(),
  ]);

  // ── the parts, keyed by each breakdown ──
  const eventsBy = {
    brand: new Map<string, number>(),
    venue: new Map<string, number>(),
    night: new Map<number, number>(),
    cell: new Map<string, number>(),
  };
  const venueNames = new Map<string, string>();
  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const e of events.results ?? []) {
    bump(eventsBy.brand, e.brand);
    if (e.venue) {
      bump(eventsBy.venue, e.venue);
      venueNames.set(e.venue, e.venue_name ?? 'A venue');
    }
    if (e.dow !== null && e.dow >= 0 && e.dow <= 6) bump(eventsBy.night, e.dow);
    if (e.cell && H3_RE.test(e.cell)) bump(eventsBy.cell, e.cell);
  }

  const scanCells = {
    brand: new Map<string, number[]>(),
    venue: new Map<string, number[]>(),
    night: new Map<number, number[]>(),
    cell: new Map<string, number[]>(),
  };
  for (const s of scans.results ?? []) {
    const n = num(s.n);
    push(scanCells.brand, s.brand, n);
    if (s.venue) push(scanCells.venue, s.venue, n);
    if (s.dow !== null && s.dow >= 0 && s.dow <= 6) push(scanCells.night, s.dow, n);
    if (s.cell && H3_RE.test(s.cell)) push(scanCells.cell, s.cell, n);
  }

  // Taps: per code, floored per event (as the venue roll-up), then per venture.
  const tapsByEvent = new Map<string, { brand: string; codes: number[] }>();
  for (const t of taps.results ?? []) {
    const cur = tapsByEvent.get(t.event_id) ?? { brand: t.brand, codes: [] };
    cur.codes.push(num(t.taps));
    tapsByEvent.set(t.event_id, cur);
  }
  const tapParts = new Map<string, number[]>();
  for (const { brand, codes } of tapsByEvent.values()) {
    push(tapParts, brand, floorTotalOfParts(codes).count ?? 0);
  }

  const displayParts = new Map<string, number[]>();
  const sponsorTapParts = new Map<string, number[]>();
  for (const r of sponsorTraffic.results ?? []) {
    push(displayParts, r.brand, num(r.displays));
    push(sponsorTapParts, r.brand, num(r.taps));
  }

  const onShowBy = new Map<string, number>();
  const businesses = new Map<string, string>();
  for (const r of onShow.results ?? []) {
    bump(onShowBy, r.brand);
    businesses.set(r.business, sponsorTitle({ name: r.name, display_name: r.display_name }));
  }

  // ── the lines ──
  const by_venture: VentureLine[] = brands.map((brand) => ({
    brand,
    role: brand === parent ? 'parent' : 'venture',
    events: eventsBy.brand.get(brand) ?? 0,
    poster_scans: floorEach(scanCells.brand, brand),
    link_taps: floorEach(tapParts, brand),
    sponsor_displays: floorEach(displayParts, brand),
    sponsor_taps: floorEach(sponsorTapParts, brand),
    sponsors_on_show: onShowBy.get(brand) ?? 0,
  }));

  // Each venture floored on its own before it joins the family total.
  const sumOfLines = (pick: (l: VentureLine) => FlooredCount) =>
    floorTotalOfParts(by_venture.map((l) => pick(l).count ?? 0));

  const place = <K>(m: Map<K, number>, cells: Map<K, number[]>, k: K): PlaceLine => ({
    events: m.get(k) ?? 0,
    poster_scans: floorEach(cells, k),
  });

  const by_venue = [...eventsBy.venue.keys()]
    .map((id) => ({
      name: venueNames.get(id) ?? 'A venue',
      ...place(eventsBy.venue, scanCells.venue, id),
    }))
    .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  const by_night = [...eventsBy.night.keys()]
    .sort((a, b) => a - b)
    .map((d) => ({ night: NIGHTS[d], ...place(eventsBy.night, scanCells.night, d) }));
  const footprint = [...eventsBy.cell.keys()]
    .sort()
    .map((cell) => ({ cell, ...place(eventsBy.cell, scanCells.cell, cell) }));

  return {
    family: { parent, ventures: brands.filter((b) => b !== parent) },
    scope: { data_class: dc },
    generated_at: new Date().toISOString(),
    totals: {
      ventures: brands.length,
      events: by_venture.reduce((s, l) => s + l.events, 0),
      poster_scans: sumOfLines((l) => l.poster_scans),
      link_taps: sumOfLines((l) => l.link_taps),
      sponsor_displays: sumOfLines((l) => l.sponsor_displays),
      sponsor_taps: sumOfLines((l) => l.sponsor_taps),
      venues: by_venue.length,
      map_cells: footprint.length,
      sponsors_on_show: by_venture.reduce((s, l) => s + l.sponsors_on_show, 0),
      businesses_on_show: businesses.size,
    },
    by_venture,
    by_venue,
    by_night,
    footprint,
    sponsors: [...businesses.values()].sort((a, b) => a.localeCompare(b)),
  };
}
