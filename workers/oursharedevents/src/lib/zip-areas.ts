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
 * Events "near" a zip are the events whose area cell lies within
 * NEAR_RING_STEPS rings of the zip's cell, about 10 miles.
 */
import { gridDisk, latLngToCell } from 'h3-js';
import { CORRIDOR_RES } from './h3-tagging';
import { ZIP_AREAS, ZIP_AREA_COUNT, ZIP_AREA_RECORD } from './zip-areas-data';

/** Rings of res-7 cells around the zip's cell: 8 rings is about 10 miles. */
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
