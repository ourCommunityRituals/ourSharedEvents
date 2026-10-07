// ─── GET /api/v2/maps/venue-image?event=<id> — venue map thumbnail ───────────
//
// Every cache miss here is a BILLED Google Static Maps load (free for 10,000 a
// month, then $2.00 per 1,000). The route used to take `?venue=<free text>`,
// with no limit and only a browser cache, so a script varying the text could
// spend the allowance and keep going. Three things bound it now:
//
//   1. The caller names an EVENT, never a place. The venue text comes from the
//      events row, so the set of billable strings is the set of venues on
//      public events — an admin wrote each one. `?venue=` is refused.
//   2. The image is cached at the edge, keyed by the venue text. Events at the
//      same venue share one image, and a repeat view is not a Google request.
//   3. The route is rate-limited where it is declared (router.ts,
//      publicReadLimited), like every other public read.
//
// The gate is the public event page's own (handlePublicEventPage): not
// draft/ready, and either on the map or live. A live event's page opens by link
// while it is off the map (PO 2026-10-07), and it shows this image. It is
// deliberately not narrowed to "listed", because the page also shows it during
// the publish grace window and after the event.

import { fetchStaticMapImage, isGoogleMapsConfigured, type MapsEnv } from '../lib/maps';

export interface VenueImageEnv extends MapsEnv {
  DB: D1Database;
}

/** A failed upstream fetch is remembered this long, so a dead key or a bad
 *  address is asked about at most once a minute per colo. */
export const VENUE_IMAGE_NEGATIVE_TTL_S = 60;

const EVENT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function refuse(status: number, code: string, error: string): Response {
  return Response.json(
    { ok: false, status, code, error },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** One key per venue, however it was typed: case and spacing do not re-bill. */
export function venueCacheKey(venue: string): string {
  return venue.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function handleVenueImage(request: Request, env: VenueImageEnv): Promise<Response> {
  const eventId = new URL(request.url).searchParams.get('event') ?? '';
  if (!EVENT_ID_RE.test(eventId)) {
    return refuse(400, 'INVALID_EVENT', 'event param is required');
  }
  if (!isGoogleMapsConfigured(env)) {
    return refuse(503, 'MAPS_NOT_CONFIGURED', 'Google Maps API key not set');
  }

  let row: { location: string | null; where_address: string | null } | null;
  try {
    row = await env.DB.prepare(
      `SELECT location, where_address FROM events
        WHERE id = ?
          AND (is_published = 1 OR LOWER(COALESCE(status, '')) = 'active')
          AND LOWER(COALESCE(status, '')) NOT IN ('draft', 'ready')`
    )
      .bind(eventId)
      .first<{ location: string | null; where_address: string | null }>();
  } catch {
    return refuse(503, 'DB_UNAVAILABLE', 'Event service unavailable');
  }

  // Same precedence as the page that renders the <img>. One 404 for a missing
  // event, an unpublished one and one with no venue, so the route cannot be
  // used to tell a draft from nothing.
  const venue = (row?.location || row?.where_address || '').trim();
  if (!venue) {
    return refuse(404, 'NOT_FOUND', 'No venue map for that event');
  }

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const keyPart = encodeURIComponent(venueCacheKey(venue));
  const cacheKey = new Request(`https://venue-image-cache.invalid/?v=${keyPart}`);
  const failKey = new Request(`https://venue-image-cache.invalid/?failed=1&v=${keyPart}`);
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) return hit;
    if (await cache.match(failKey).catch(() => undefined)) {
      return refuse(502, 'MAPS_UPSTREAM_ERROR', 'Venue map unavailable');
    }
  }

  const res = await fetchStaticMapImage(env, venue);
  if (!cache) return res;
  if (res.status === 200) {
    await cache.put(cacheKey, res.clone()).catch(() => undefined);
  } else if (res.status === 502) {
    // An empty 200: the Cache API stores it (it will not store every status).
    const marker = new Response('', {
      status: 200,
      headers: { 'Cache-Control': `public, max-age=${VENUE_IMAGE_NEGATIVE_TTL_S}` },
    });
    await cache.put(failKey, marker).catch(() => undefined);
  }
  return res;
}
