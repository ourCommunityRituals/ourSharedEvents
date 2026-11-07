/**
 * Where are you? By zip code (owner decision 2026-10-10).
 *
 * The landing page asks one question: your zip, typed on a computer, or your
 * phone's location if you choose to share it. Either way the page works from
 * a zip AREA, never a person's spot:
 *
 *   - A typed zip is looked up in the US Census zip-area centers
 *     (zip-areas-data.ts, 33,791 zips) and turned into the area cell the map
 *     already uses (H3 resolution 7, about 2.4 km across).
 *   - A phone that shares its location works out a rough box by itself (a
 *     5-character geohash, about 5 km across) and sends only that. The server
 *     turns the box into the nearest zip and from then on uses the zip. The
 *     exact spot never leaves the phone, and nothing is stored.
 *
 * A zip shows the events in its OWN area, not the towns around it (owner
 * 2026-11-05: what's going on in your area, without the bleed-over; going
 * wider is the person's choice). An event is in a zip's own area when
 * (inZipOwnArea):
 *
 *   1. its address ends in that zip ("…, IL 60453"), the zip the venue itself
 *      gives; or, when its address names no zip we know near the event,
 *   2. its cell's center is nearer that zip's center than any other zip's.
 *
 * and, either way, its area cell lies within NEAR_RING_STEPS rings of the zip's
 * cell (about 10 miles): an outer bound. An address zip whose own bound does not
 * hold the event (a typo, another state) is ignored, so the event falls to
 * rule 2 instead of vanishing. The table has zip centers only, no
 * boundaries; rule 2 cuts the country into one area per zip, so an event
 * shows for one zip at most.
 */
import {
  cellToLatLng,
  getHexagonEdgeLengthAvg,
  greatCircleDistance,
  gridDisk,
  gridDistance,
  isValidCell,
  latLngToCell,
} from 'h3-js';
import { CORRIDOR_RES } from './h3-tagging';
import { ZIP_AREAS, ZIP_AREA_COUNT, ZIP_AREA_RECORD } from './zip-areas-data';

/** The outer bound on a zip's own area: 8 rings of res-7 cells, about 10 miles. */
export const NEAR_RING_STEPS = 8;

export interface ZipArea {
  zip: string;
  lat: number;
  lon: number;
}

// Records start after the opening newline and are ZIP_AREA_RECORD + 1 apart.
const STRIDE = ZIP_AREA_RECORD + 1;
const recordAt = (i: number): string => ZIP_AREAS.substr(1 + i * STRIDE, ZIP_AREA_RECORD);

function parse(rec: string): ZipArea {
  return { zip: rec.slice(0, 5), lat: Number(rec.slice(5, 12)), lon: Number(rec.slice(12, 20)) };
}

/** A 5-digit zip as typed: digits only, after trimming. "60406-1234" keeps the first five. */
export function normalizeZip(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(raw);
  return m ? m[1] : null;
}

/** The zip's area center, or null for a zip that is not a US zip area. */
export function findZipArea(raw: unknown): ZipArea | null {
  const zip = normalizeZip(raw);
  if (!zip) return null;
  let lo = 0;
  let hi = ZIP_AREA_COUNT - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rec = recordAt(mid);
    const key = rec.slice(0, 5);
    if (key === zip) return parse(rec);
    if (key < zip) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** The zip area whose center is nearest the point (a rough box's center). */
export function nearestZipArea(lat: number, lon: number): ZipArea | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < ZIP_AREA_COUNT; i++) {
    const rec = recordAt(i);
    const dLat = Number(rec.slice(5, 12)) - lat;
    const dLon = (Number(rec.slice(12, 20)) - lon) * cosLat;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // Farther than ~1.5 degrees (about 100 miles) from any US zip area: not in the US.
  return best >= 0 && bestD < 2.25 ? parse(recordAt(best)) : null;
}

/** The area cells within NEAR_RING_STEPS of the zip's cell. */
export function nearCells(area: ZipArea, steps = NEAR_RING_STEPS): Set<string> {
  return new Set(gridDisk(latLngToCell(area.lat, area.lon, CORRIDOR_RES), steps));
}

/** US postal state, district, territory and military codes. */
const POSTAL_STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE ' +
    'NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY ' +
    'PR VI GU AS MP AA AE AP'
  ).split(' ')
);

/**
 * The zip an address ends with: "1234 W Example St, Town, IL 60000" → "60000"
 * ("60000-1234", a trailing ", USA" and a final "." are fine). Only a zip at the
 * very end counts, and only when nothing comes before it, or a comma, or a
 * postal state code does: a street number ("12345 S Pulaski Rd"), a box or
 * room ("PO Box 12345", "RM 60453") is never read as one.
 *
 * Linear in the address's length: no pattern here has two whitespace runs that
 * can trade characters, so a padded address costs no more than a short one
 * (this runs on a public page for every event near the zip).
 */
export function addressZip(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const s = address
    .trim()
    .replace(/\.$/, '')
    .replace(/,? ?(?:USA|US|United States)$/i, '')
    .trimEnd();
  const m = /(\d{5})(?:-\d{4})?$/.exec(s);
  if (!m) return null;
  const before = s.slice(0, m.index).trimEnd();
  if (before === '' || before.endsWith(',')) return m[1];
  // The word just before the zip: two letters after a space or comma, in any
  // case ("il", "Il"), that are a postal state code once capitalised.
  const word = before.slice(-3);
  const ok =
    /^[\s,][A-Za-z]{2}$/.test(word) || (before.length === 2 && /^[A-Za-z]{2}$/.test(before));
  return ok && POSTAL_STATES.has(before.slice(-2).toUpperCase()) ? m[1] : null;
}

/**
 * An event row. inZipOwnArea reads only its cells and its address; the index
 * signature lets a whole listed row be passed in.
 */
export interface PlacedEvent {
  [field: string]: unknown;
  h3_res7?: unknown;
  h3_res9?: unknown;
  where_address?: unknown;
}

// The other zips that could be nearer a point in the 8-ring bound: every zip
// whose center is within twice the bound's reach (8 rings is under 20 km, so
// 0.5 degrees, about 55 km, is ample).
const NEIGHBOUR_DEG = 0.5;

function zipsAround(area: ZipArea): ZipArea[] {
  const lonDeg = NEIGHBOUR_DEG / Math.max(0.1, Math.cos((area.lat * Math.PI) / 180));
  const out: ZipArea[] = [];
  for (let i = 0; i < ZIP_AREA_COUNT; i++) {
    const rec = recordAt(i);
    const lat = Number(rec.slice(5, 12));
    const lon = Number(rec.slice(12, 20));
    if (Math.abs(lat - area.lat) <= NEIGHBOUR_DEG && Math.abs(lon - area.lon) <= lonDeg) {
      out.push({ zip: rec.slice(0, 5), lat, lon });
    }
  }
  return out;
}

// The 8-ring bound's reach in km: cell centers are sqrt(3) edges apart.
const BOUND_KM = NEAR_RING_STEPS * Math.sqrt(3) * getHexagonEdgeLengthAvg(CORRIDOR_RES, 'km');

/**
 * Is the res-7 cell within NEAR_RING_STEPS rings of the zip's own cell? When H3
 * cannot count the rings (the path crosses a pentagon; all twelve are at sea),
 * the straight-line distance between the two centers decides instead, so a
 * valid address zip is never dropped for that reason alone.
 */
export function withinBound(zip: ZipArea, res7: string): boolean {
  try {
    return gridDistance(latLngToCell(zip.lat, zip.lon, CORRIDOR_RES), res7) <= NEAR_RING_STEPS;
  } catch {
    if (!isValidCell(res7)) return false;
    return greatCircleDistance([zip.lat, zip.lon], cellToLatLng(res7), 'km') <= BOUND_KM;
  }
}

/**
 * A test for "is this event in the zip's own area?" (see the top of this file).
 * Build it once per request; the neighbouring zips are read at most once.
 */
export function inZipOwnArea(area: ZipArea): (event: PlacedEvent) => boolean {
  return inZipsOwnArea([area]);
}

/**
 * A test for "is this event in the own area of any of these zips?": a town of
 * many zips, or a set of towns (lib/place-search.ts). The same answer as asking
 * inZipOwnArea of each zip in turn, at the cost of one: an event is in a zip's
 * own area when that zip's bound holds it and it is that zip's (by its address,
 * else by the nearest zip center), and an event is only ever one zip's.
 * Build it once per request; each neighbourhood of zips is read at most once.
 */
export function inZipsOwnArea(areas: readonly ZipArea[]): (event: PlacedEvent) => boolean {
  const bounds = areas.map((area) => ({ area, cells: nearCells(area) }));
  const around = new Map<string, ZipArea[]>();
  return (event) => {
    const res7 = event.h3_res7;
    if (typeof res7 !== 'string') return false;
    const holding = bounds.filter((b) => b.cells.has(res7)).map((b) => b.area);
    if (holding.length === 0) return false;
    // The address's zip decides when it is a zip we know whose own 8-ring bound
    // holds the event; a zip from far away (a typo) is ignored, not trusted.
    const said = findZipArea(addressZip(event.where_address));
    if (said && withinBound(said, res7)) return holding.some((a) => a.zip === said.zip);
    // Otherwise: the zip whose center is nearest the event's finest cell (the
    // res-9 placement when it has one). That zip is within the bound's reach of
    // the event, so it is among the zips around any zip whose bound holds it.
    const res9 = event.h3_res9;
    const [lat, lon] = cellToLatLng(typeof res9 === 'string' && isValidCell(res9) ? res9 : res7);
    const first = holding[0];
    let near = around.get(first.zip);
    if (!near) {
      near = zipsAround(first);
      around.set(first.zip, near);
    }
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const dist = (z: ZipArea) => (z.lat - lat) ** 2 + ((z.lon - lon) * cosLat) ** 2;
    // A tie goes to the lower zip, so no point belongs to two.
    let best = first;
    let bestD = dist(first);
    for (const z of near) {
      const d = dist(z);
      if (d < bestD || (d === bestD && z.zip < best.zip)) {
        best = z;
        bestD = d;
      }
    }
    return holding.some((a) => a.zip === best.zip);
  };
}

// ── The phone's rough box: a 5-character geohash ────────────────────────────

const GEOHASH = '0123456789bcdefghjkmnpqrstuvwxyz';
/** Exactly five geohash characters: a box about 5 km by 5 km, never finer. */
export const ROUGH_BOX = /^[0-9b-hjkmnp-z]{5}$/;

/** The center of a 5-character geohash box, or null if it is not one. */
export function roughBoxCenter(raw: unknown): { lat: number; lon: number } | null {
  if (typeof raw !== 'string' || !ROUGH_BOX.test(raw)) return null;
  let even = true;
  const lat = [-90, 90];
  const lon = [-180, 180];
  for (const ch of raw) {
    const v = GEOHASH.indexOf(ch);
    for (let b = 4; b >= 0; b--) {
      const bit = (v >> b) & 1;
      const r = even ? lon : lat;
      const mid = (r[0] + r[1]) / 2;
      if (bit) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}
