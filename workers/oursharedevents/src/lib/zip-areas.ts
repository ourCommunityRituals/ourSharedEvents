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
 *      gives; or, when its address names no zip we know,
 *   2. its cell's center is nearer that zip's center than any other zip's.
 *
 * and, either way, its area cell lies within NEAR_RING_STEPS rings of the zip's
 * cell (about 10 miles): an outer bound, so a mistyped address zip cannot pull
 * in an event from another state. The table has zip centers only, no
 * boundaries; rule 2 cuts the country into one area per zip, so an event
 * shows for one zip at most.
 */
import { cellToLatLng, gridDisk, isValidCell, latLngToCell } from 'h3-js';
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

/**
 * The zip an address ends with: "1234 W Example St, Town, IL 60000" → "60000"
 * ("60000-1234" and a trailing ", USA" are fine). Only a zip at the very end
 * counts, so a 5-digit street number ("12345 S Pulaski Rd") is never read as one.
 */
export function addressZip(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const m = /(?:^|[\s,])(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA|US|United States))?\s*\.?\s*$/i.exec(
    address
  );
  return m ? m[1] : null;
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

/**
 * A test for "is this event in the zip's own area?" (see the top of this file).
 * Build it once per request; the neighbouring zips are read at most once.
 */
export function inZipOwnArea(area: ZipArea): (event: PlacedEvent) => boolean {
  const bound = nearCells(area);
  let around: ZipArea[] | null = null;
  return (event) => {
    const res7 = event.h3_res7;
    if (typeof res7 !== 'string' || !bound.has(res7)) return false;
    const said = addressZip(event.where_address);
    if (said && findZipArea(said)) return said === area.zip;
    // No zip we know in the address: the zip whose center is nearest the
    // event's finest cell (the res-9 placement when it has one).
    const res9 = event.h3_res9;
    const [lat, lon] = cellToLatLng(typeof res9 === 'string' && isValidCell(res9) ? res9 : res7);
    around ??= zipsAround(area);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const dist = (z: ZipArea) => (z.lat - lat) ** 2 + ((z.lon - lon) * cosLat) ** 2;
    const mine = dist(area);
    // A tie goes to the lower zip, so no point belongs to two.
    return around.every(
      (z) => z.zip === area.zip || dist(z) > mine || (dist(z) === mine && z.zip > area.zip)
    );
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
