/**
 * Where an event is, on the map (owner report 2026-10-11).
 *
 * The landing's zip search (`/?zip=`) lists an event only when its map cell
 * (`h3_res7`) is near the zip, and a cell comes only from `lat`/`lon`. Neither
 * create form sent coordinates, so on staging 3 of 174 live events had a cell
 * and a search for 60406 missed "Criu De Sheela" at Rock Island Public House.
 *
 * So saving an event looks its place up once, here: the street address when
 * there is one, else the place the organizer typed. The answer is kept only
 * when it names a spot (an address, a building or a business). A city, a zip
 * or a part match is not kept: "Rock Island Public House" alone can come back
 * as the city of Rock Island, 150 miles from the bar, and a wrong place is
 * worse than none. A lookup that is not set up, fails or finds nothing never
 * blocks the save.
 *
 * The venue's text goes to Google once per save (admin only), as the poster
 * address does (OSE-1357). It is a public place, never a person or a device.
 *
 * `events.place_checked_at` (migration 0099) records that a lookup was
 * answered, found or not, so the nightly job (`runEventPlaceBackfill`) does not
 * pay for the same unfindable place every night. Editing the place clears it.
 */

import { geocodeVenue } from './geo';
import { type MapsEnv } from './maps';
import { maybeTag } from './h3-tagging';
import { errorLabel } from './error-label';
import { refreshSpineKeys } from './spine-keys-store';

/**
 * Google result types that name a spot. Anything else (locality, postal_code,
 * route, neighborhood, administrative areas) is an area, too wide to place an
 * event in a zip search.
 */
export const SPOT_TYPES: ReadonlySet<string> = new Set([
  'street_address',
  'premise',
  'subpremise',
  'establishment',
  'point_of_interest',
  'intersection',
]);

/** The text an event's place is looked up by: its address, else its place. */
export function eventPlaceText(whereAddress: unknown, location: unknown): string | null {
  for (const v of [whereAddress, location]) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export type PlaceLookup =
  | { found: true; lat: number; lon: number }
  | {
      found: false;
      /**
       * NOT_FOUND and NOT_A_SPOT are answers. NO_TEXT, NOT_SET_UP and
       * LOOKUP_FAILED (Google unreachable or erroring) are not: nothing was
       * learned, so place_checked_at stays as it was and the nightly job tries.
       */
      reason: 'NO_TEXT' | 'NOT_SET_UP' | 'NOT_FOUND' | 'NOT_A_SPOT' | 'LOOKUP_FAILED';
    };

/** Whether a lookup was answered, so place_checked_at should be stamped. */
export function lookupWasAnswered(r: PlaceLookup): boolean {
  return r.found || r.reason === 'NOT_FOUND' || r.reason === 'NOT_A_SPOT';
}

/**
 * What the create and update answers say about the map, so the organizer can
 * be told when a place was not found: 'on_map', 'not_found' (looked up, no
 * spot), or 'not_looked_up' (no place text, lookups not set up, or Google did
 * not answer; the nightly job tries again).
 */
export type PlaceState = 'on_map' | 'not_found' | 'not_looked_up';

export function placeState(r: PlaceLookup): PlaceState {
  if (r.found) return 'on_map';
  return lookupWasAnswered(r) ? 'not_found' : 'not_looked_up';
}

export async function lookUpEventPlace(
  env: MapsEnv,
  whereAddress: unknown,
  location: unknown,
  fetcher: typeof fetch = globalThis.fetch
): Promise<PlaceLookup> {
  const text = eventPlaceText(whereAddress, location);
  if (!text) return { found: false, reason: 'NO_TEXT' };
  const outcome = await geocodeVenue(env, text, fetcher);
  if (!outcome.ok) {
    if (outcome.code === 'GEO_NOT_CONFIGURED') return { found: false, reason: 'NOT_SET_UP' };
    if (outcome.code === 'GEO_NO_RESULTS' || outcome.code === 'INVALID_ADDRESS') {
      return { found: false, reason: 'NOT_FOUND' };
    }
    return { found: false, reason: 'LOOKUP_FAILED' };
  }
  const { lat, lng, types, partial_match } = outcome.result;
  const isSpot = (types ?? []).some((t) => SPOT_TYPES.has(t));
  if (!isSpot || partial_match === true) return { found: false, reason: 'NOT_A_SPOT' };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { found: false, reason: 'NOT_FOUND' };
  return { found: true, lat, lon: lng };
}

/**
 * Store a lookup's answer on the event. Found: the coordinates and both cells.
 * Answered but not found: no coordinates (the old ones, if any, described a
 * place the event no longer names). Not asked: nothing changes.
 */
export async function savePlaceLookup(
  db: D1Database,
  eventId: string,
  r: PlaceLookup,
  now: string = new Date().toISOString()
): Promise<void> {
  if (r.found) {
    const tags = maybeTag(r.lat, r.lon);
    await db
      .prepare(
        'UPDATE events SET lat = ?, lon = ?, h3_res9 = ?, h3_res7 = ?, place_checked_at = ?, venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?'
      )
      .bind(r.lat, r.lon, tags?.h3_res9 ?? null, tags?.h3_res7 ?? null, now, eventId)
      .run();
    return;
  }
  if (!lookupWasAnswered(r)) return;
  await db
    .prepare(
      'UPDATE events SET lat = NULL, lon = NULL, h3_res9 = NULL, h3_res7 = NULL, place_checked_at = ?, venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?'
    )
    .bind(now, eventId)
    .run();
}

/** Events looked up per nightly run: at most this many billed lookups a night. */
export const PLACE_BACKFILL_MAX = 25;

export interface EventPlaceBackfillEnv extends MapsEnv {
  DB?: D1Database;
}

export interface EventPlaceBackfillResult {
  checked: number;
  found: number;
  errors: number;
}

/**
 * Nightly: look up the places of events saved before lookups existed. Takes
 * events that are not archived, not over, have place text, no coordinates and
 * were never looked up, soonest first, at most PLACE_BACKFILL_MAX a run. Does
 * nothing until the Maps key is set, so no row is stamped by a lookup that
 * could not happen.
 */
export async function runEventPlaceBackfill(
  env: EventPlaceBackfillEnv,
  fetcher: typeof fetch = globalThis.fetch
): Promise<EventPlaceBackfillResult> {
  const result: EventPlaceBackfillResult = { checked: 0, found: 0, errors: 0 };
  if (!env.DB || !env.GOOGLE_MAPS_API_KEY) return result;
  let rows: { id: string; where_address: string | null; location: string | null }[] = [];
  try {
    const res = await env.DB.prepare(
      `SELECT id, where_address, location FROM events
        WHERE status != 'archived'
          AND lat IS NULL AND lon IS NULL
          AND place_checked_at IS NULL
          AND (TRIM(COALESCE(where_address, '')) != '' OR TRIM(COALESCE(location, '')) != '')
          AND (start_date IS NULL OR substr(COALESCE(end_date, start_date), 1, 10) >= date('now', '-1 day'))
        ORDER BY start_date IS NULL, start_date, id
        LIMIT ?`
    )
      .bind(PLACE_BACKFILL_MAX)
      .all<{ id: string; where_address: string | null; location: string | null }>();
    rows = res.results ?? [];
  } catch (err) {
    result.errors++;
    console.error(
      JSON.stringify({
        type: 'EVENT_PLACE_BACKFILL_ERROR',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return result;
  }
  for (const row of rows) {
    try {
      const r = await lookUpEventPlace(env, row.where_address, row.location, fetcher);
      await savePlaceLookup(env.DB, row.id, r);
      if (lookupWasAnswered(r)) await refreshSpineKeys(env.DB, row.id);
      if (lookupWasAnswered(r)) result.checked++;
      if (r.found) result.found++;
    } catch {
      result.errors++;
    }
  }
  console.log(
    JSON.stringify({ type: 'EVENT_PLACE_BACKFILL', ...result, timestamp: new Date().toISOString() })
  );
  return result;
}
