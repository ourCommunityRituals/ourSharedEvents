/**
 * A venue someone owns, and the roll-up of everything held there (OSE-2221).
 *
 *   GET    /api/v2/admin/venues                         venues the caller owns or runs events at
 *   POST   /api/v2/admin/venues                         make a venue, owned by a brand in scope
 *   PUT    /api/v2/admin/venues/:id/operators           list a brand as an operator at the venue
 *   DELETE /api/v2/admin/venues/:id/operators/:brand    take an operator off the venue's list
 *   GET    /api/v2/admin/venues/:id/rollup              traffic and sponsors at the venue, per operator
 *   PUT    /api/v2/admin/events/:id/venue               hold an event at a venue (or clear it)
 *   PUT    /api/v2/admin/venues/:id/room-ceiling        the voting room-size ceiling (platform admins only)
 *
 * Owner, 2026-11-23: a bar owner has several event operators on the property,
 * each its own brand, and sees all the activity at the place and the
 * sponsorship it carries. An operator on the property uses the platform; an
 * existing arrangement can be kept off it ("grandfathered"). A company can own
 * a venue: ownership is a brand, so a parent reaches its venues down the brand
 * tree (lib/brand-tree.ts).
 *
 * WHO COUNTS AT A VENUE. An event counts for a venue when it is held there
 * (`events.host_venue_id`) AND its brand is the owner's brand, a brand below it,
 * or a brand the venue lists as 'on_platform'. Both halves are needed: the venue
 * lists the operator, and the operator's own admin holds the event there. Take
 * the operator off the list and its events stop counting at once (the rule is
 * read at every roll-up, never stored). A 'grandfathered' operator is listed and
 * never counted, and cannot hold an event at the venue.
 *
 * WHAT THE OWNER SEES. Floored totals only: per operator and in total, poster
 * scans (per code, the poster-hour cells every scan figure is a sum of), link
 * taps (per code, floored per event), sponsors on show and distinct sponsor
 * businesses. Never an event row, a title, a form, a person. The owner cannot
 * edit an operator's event: the venue grants no brand scope at all, and
 * resolveAdminBrandScopeAsync is not touched here.
 *
 * ISOLATION (#9). A venue by id is reached only by its owner (owner brand in
 * scope); a miss is 404, the same as an unknown id. The list shows venues the
 * caller owns and venues where a brand in its scope is listed, so an operator
 * can find the venue to hold its events at. The platform and public brands own
 * no venue and are no operator (the table refuses them too): the public brand is
 * every free organizer at once.
 */

import { extractAdminActor, type AdminEnv } from '../auth/admin';
import {
  PLATFORM_BRAND_ID,
  PUBLIC_BRAND_ID,
  resolveAdminBrandScopeAsync,
  type AdminBrandScopeEnv,
  type AdminBrandScope,
} from '../lib/admin-brand-scope';
import { withDescendants } from '../lib/brand-tree';
import { corsHeaders } from '../lib/cors';
import { floorTotalOfParts, type FlooredCount } from '../lib/count-floor';
import { errorLabel } from '../lib/error-label';
import { TAP_CODE_SQL } from '../lib/pre-event-activity';
import { scanHourSql } from '../lib/scan-cells';
import { PLACEMENT_ON_SHOW_SQL } from '../lib/sponsor-card';

export interface VenuesEnv extends AdminEnv, AdminBrandScopeEnv {
  DB: D1Database;
}

const BRAND_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const VENUE_ID_RE = /^ven_[a-f0-9]{32}$/;
const OPERATOR_STATUSES = ['on_platform', 'grandfathered'] as const;
type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

function rid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function json(request: Request, reqId: string, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': reqId },
  });
}

function fail(request: Request, reqId: string, status: number, code: string, error: string) {
  return json(request, reqId, { ok: false, status, code, error, requestId: reqId }, status);
}

function reserved(brand: string): boolean {
  return brand === PLATFORM_BRAND_ID || brand === PUBLIC_BRAND_ID;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function scopeOf(request: Request, env: VenuesEnv): Promise<AdminBrandScope> {
  return resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
}

function inScope(scope: AdminBrandScope, brand: string): boolean {
  return scope.mode === 'all' || (scope.mode === 'scoped' && scope.brandIds.includes(brand));
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Run a body; a thrown D1 error becomes a logged 503, never a partial answer. */
async function guarded(
  request: Request,
  reqId: string,
  body: () => Promise<Response>
): Promise<Response> {
  try {
    return await body();
  } catch (e) {
    console.error(
      JSON.stringify({ type: 'VENUES_DB_ERROR', requestId: reqId, error: errorLabel(e) })
    );
    return fail(request, reqId, 503, 'DB_UNAVAILABLE', 'Venue data could not be read');
  }
}

interface VenueRow {
  id: string;
  brand_id: string;
  name: string;
}

/** The venue, when the caller owns it (its brand is in scope); otherwise null. */
async function ownedVenue(
  env: VenuesEnv,
  scope: AdminBrandScope,
  id: string
): Promise<VenueRow | null> {
  if (!VENUE_ID_RE.test(id) || scope.mode === 'deny') return null;
  const row = await env.DB.prepare('SELECT id, brand_id, name FROM venues WHERE id = ?')
    .bind(id)
    .first<VenueRow>();
  return row && inScope(scope, row.brand_id) ? row : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v2/admin/venues
// ─────────────────────────────────────────────────────────────────────────────

export async function handleListVenues(request: Request, env: VenuesEnv): Promise<Response> {
  const reqId = rid();
  const scope = await scopeOf(request, env);
  if (scope.mode === 'deny') {
    return fail(request, reqId, 403, 'BRAND_SCOPE_DENIED', 'No brand membership for this caller');
  }
  const named = new URL(request.url).searchParams.get('brand_id');
  if (scope.mode === 'all' && (!named || !BRAND_ID_RE.test(named))) {
    return fail(request, reqId, 400, 'BRAND_REQUIRED', 'Name one brand with ?brand_id=');
  }
  const brands = scope.mode === 'all' ? [named as string] : scope.brandIds;
  return guarded(request, reqId, async () => {
    const rows = await listFor(env.DB, brands);
    return json(request, reqId, {
      ok: true,
      venues: rows.map((r) => ({
        id: r.id,
        name: r.name,
        owner_brand: r.brand_id,
        role: r.role,
        ...(r.role === 'operator' ? { operator_brand: r.operator, status: r.status } : {}),
      })),
    });
  });
}

async function listFor(db: D1Database, brands: string[]) {
  const usable = brands.filter((b) => !reserved(b)).slice(0, 90);
  if (usable.length === 0) return [];
  const marks = usable.map(() => '?').join(', ');
  const rs = await db
    .prepare(
      `SELECT v.id, v.brand_id, v.name, 'owner' AS role, NULL AS status, NULL AS operator
         FROM venues v WHERE v.brand_id IN (${marks})
       UNION ALL
       SELECT v.id, v.brand_id, v.name, 'operator' AS role, vo.status, vo.brand_id AS operator
         FROM venue_operators vo JOIN venues v ON v.id = vo.venue_id
        WHERE vo.brand_id IN (${marks}) AND v.brand_id NOT IN (${marks})
       ORDER BY 3, 1`
    )
    .bind(...usable, ...usable, ...usable)
    .all<VenueRow & { role: string; status: string | null; operator: string | null }>();
  return rs.results ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v2/admin/venues
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCreateVenue(request: Request, env: VenuesEnv): Promise<Response> {
  const reqId = rid();
  const scope = await scopeOf(request, env);
  if (scope.mode === 'deny') {
    return fail(request, reqId, 403, 'BRAND_SCOPE_DENIED', 'No brand membership for this caller');
  }
  const body = await readBody(request);
  if (!body) return fail(request, reqId, 400, 'INVALID_BODY', 'Send a JSON object');
  const brand = body.brand_id;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (typeof brand !== 'string' || !BRAND_ID_RE.test(brand)) {
    return fail(request, reqId, 400, 'INVALID_BRAND_ID', 'brand_id is not a brand slug');
  }
  if (name.length < 1 || name.length > 120) {
    return fail(request, reqId, 400, 'INVALID_NAME', 'name is 1 to 120 characters');
  }
  if (reserved(brand)) {
    return fail(request, reqId, 403, 'BRAND_FORBIDDEN', 'This brand cannot own a venue');
  }
  if (!inScope(scope, brand)) {
    return fail(request, reqId, 403, 'BRAND_FORBIDDEN', `Not entitled to brand_id "${brand}"`);
  }
  return guarded(request, reqId, async () => {
    const id = `ven_${crypto.randomUUID().replace(/-/g, '')}`;
    await env.DB.prepare('INSERT INTO venues (id, brand_id, name) VALUES (?, ?, ?)')
      .bind(id, brand, name)
      .run();
    return json(request, reqId, { ok: true, id, name, owner_brand: brand }, 201);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v2/admin/venues/:id/room-ceiling  (OSE-2234, owner 2026-11-26)
// ─────────────────────────────────────────────────────────────────────────────

const ROOM_CAP_RANGE = [10, 50000] as const;

/**
 * Set the ceiling on a voting room size at a venue. Platform admins only: the
 * router puts requirePlatformScope in front, so a venue's owner, an operator
 * there, or any brand admin gets the router's 404. The owner chose this
 * (decision cards 2026-11-26: a ceiling the host does not pick; "Permit limit,
 * else 500"):
 *   { "room_kind": "indoor",  "room_cap": N }    N = the building's fire-marshal capacity (required)
 *   { "room_kind": "outdoor", "room_cap": N }    N = the permit's attendance limit
 *   { "room_kind": "outdoor", "room_cap": null } no permit limit: the 500 default applies
 * Any other field is refused. The ceiling binds a set's first open only; a
 * room size already fixed is not touched (lib/vote-sets.ts ROOM_CEILING_SQL).
 */
export async function handlePutVenueRoomCeiling(
  request: Request,
  env: VenuesEnv,
  venueId: string
): Promise<Response> {
  const reqId = rid();
  const body = await readBody(request);
  return guarded(request, reqId, async () => {
    if (!VENUE_ID_RE.test(venueId))
      return fail(request, reqId, 404, 'NOT_FOUND', 'Venue not found');
    const venue = await env.DB.prepare('SELECT id, room_kind, room_cap FROM venues WHERE id = ?')
      .bind(venueId)
      .first<{ id: string; room_kind: string | null; room_cap: number | null }>();
    if (!venue) return fail(request, reqId, 404, 'NOT_FOUND', 'Venue not found');
    if (!body) return fail(request, reqId, 400, 'INVALID_BODY', 'Send a JSON object');
    const extra = Object.keys(body).filter((k) => k !== 'room_kind' && k !== 'room_cap');
    if (extra.length)
      return fail(request, reqId, 400, 'UNKNOWN_FIELD', 'Send room_kind and room_cap only');
    const kind = body.room_kind;
    if (kind !== 'indoor' && kind !== 'outdoor')
      return fail(request, reqId, 400, 'INVALID_ROOM_KIND', "room_kind is 'indoor' or 'outdoor'");
    const cap = body.room_cap ?? null;
    if (cap === null) {
      if (kind === 'indoor')
        return fail(
          request,
          reqId,
          400,
          'ROOM_CAP_NEEDED',
          "An indoor venue needs its building's fire-marshal capacity as room_cap"
        );
    } else if (
      typeof cap !== 'number' ||
      !Number.isInteger(cap) ||
      cap < ROOM_CAP_RANGE[0] ||
      cap > ROOM_CAP_RANGE[1]
    ) {
      return fail(
        request,
        reqId,
        400,
        'INVALID_ROOM_CAP',
        `room_cap is a whole number from ${ROOM_CAP_RANGE[0]} to ${ROOM_CAP_RANGE[1]}, or null outdoors`
      );
    }
    await env.DB.prepare('UPDATE venues SET room_kind = ?, room_cap = ? WHERE id = ?')
      .bind(kind, cap, venue.id)
      .run();
    // The old and new values ride in the reply so the router's audit row can
    // keep both (CCR loop 4): a raised limit is reconstructable later.
    return json(request, reqId, {
      ok: true,
      venue_id: venue.id,
      room_kind: kind,
      room_cap: cap,
      was: { room_kind: venue.room_kind, room_cap: venue.room_cap },
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v2/admin/venues/:id/operators  ·  DELETE …/operators/:brand
// ─────────────────────────────────────────────────────────────────────────────

export async function handlePutVenueOperator(
  request: Request,
  env: VenuesEnv,
  venueId: string
): Promise<Response> {
  const reqId = rid();
  const scope = await scopeOf(request, env);
  const body = await readBody(request);
  return guarded(request, reqId, async () => {
    const venue = await ownedVenue(env, scope, venueId);
    if (!venue) return fail(request, reqId, 404, 'NOT_FOUND', 'Venue not found');
    if (!body) return fail(request, reqId, 400, 'INVALID_BODY', 'Send a JSON object');
    const brand = body.brand_id;
    const status = body.status ?? 'on_platform';
    if (typeof brand !== 'string' || !BRAND_ID_RE.test(brand)) {
      return fail(request, reqId, 400, 'INVALID_BRAND_ID', 'brand_id is not a brand slug');
    }
    if (!OPERATOR_STATUSES.includes(status as OperatorStatus)) {
      return fail(
        request,
        reqId,
        400,
        'INVALID_STATUS',
        "status is 'on_platform' or 'grandfathered'"
      );
    }
    if (reserved(brand)) {
      return fail(request, reqId, 403, 'BRAND_FORBIDDEN', 'This brand cannot run a venue');
    }
    await env.DB.prepare(
      `INSERT INTO venue_operators (venue_id, brand_id, status) VALUES (?, ?, ?)
       ON CONFLICT (venue_id, brand_id) DO UPDATE SET status = excluded.status`
    )
      .bind(venue.id, brand, status)
      .run();
    return json(request, reqId, { ok: true, venue_id: venue.id, brand_id: brand, status });
  });
}

export async function handleDeleteVenueOperator(
  request: Request,
  env: VenuesEnv,
  venueId: string,
  brand: string
): Promise<Response> {
  const reqId = rid();
  const scope = await scopeOf(request, env);
  return guarded(request, reqId, async () => {
    const venue = await ownedVenue(env, scope, venueId);
    if (!venue) return fail(request, reqId, 404, 'NOT_FOUND', 'Venue not found');
    if (!BRAND_ID_RE.test(brand)) {
      return fail(request, reqId, 400, 'INVALID_BRAND_ID', 'brand_id is not a brand slug');
    }
    const res = await env.DB.prepare(
      'DELETE FROM venue_operators WHERE venue_id = ? AND brand_id = ?'
    )
      .bind(venue.id, brand)
      .run();
    if (num(res.meta?.changes) === 0) {
      return fail(request, reqId, 404, 'NOT_FOUND', 'That brand is not listed at this venue');
    }
    return json(request, reqId, { ok: true, venue_id: venue.id, brand_id: brand, removed: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v2/admin/events/:id/venue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The brands whose events count at a venue: the owner, the brands below it, and
 * the operators listed 'on_platform'. Read at every call, never stored.
 */
async function countingBrands(db: D1Database, venue: VenueRow): Promise<string[]> {
  return (await countingSets(db, venue)).all;
}

async function countingSets(
  db: D1Database,
  venue: VenueRow
): Promise<{ own: string[]; all: string[] }> {
  const own = (await withDescendants(db, [venue.brand_id])).filter((b) => !reserved(b));
  const ops = await db
    .prepare(
      `SELECT brand_id FROM venue_operators WHERE venue_id = ? AND status = 'on_platform'
        ORDER BY brand_id`
    )
    .bind(venue.id)
    .all<{ brand_id: string }>();
  const out = [...own];
  for (const r of ops.results ?? []) if (!out.includes(r.brand_id)) out.push(r.brand_id);
  return { own, all: out.filter((b) => !reserved(b)) };
}

/**
 * The voting room-size ceiling (OSE-2234, owner 2026-11-26) comes from the
 * event's venue, and with no venue or an unset venue it is 500. So a host
 * could lift a platform-set limit by clearing the venue, or by moving to a
 * venue the platform has not set, and then open voting with a bigger room
 * (CCR loop 4). An event at a venue with a room limit moves only to another
 * venue whose room limit the platform has set. Held in the one statement: its
 * one `?` is the new venue id, or null to clear.
 */
const CEILING_KEPT_SQL = `(
  (SELECT v.room_cap FROM venues v WHERE v.id = events.host_venue_id) IS NULL
  OR (SELECT n.room_cap FROM venues n WHERE n.id = ?) IS NOT NULL
)`;

function ceilingLocked(request: Request, reqId: string): Response {
  return fail(
    request,
    reqId,
    409,
    'VENUE_ROOM_LIMIT_KEPT',
    "This event's venue has a room limit set by the platform, so it can move only to another venue with a room limit set; ask the platform"
  );
}

/**
 * The event in the path is proved in the caller's brand scope by the router's
 * guardAdminObjectScope before this runs. This holds it at a venue that counts
 * its brand, or clears it (`venue_id: null`).
 */
export async function handleSetEventVenue(
  request: Request,
  env: VenuesEnv,
  eventId: string
): Promise<Response> {
  const reqId = rid();
  const body = await readBody(request);
  if (!body || !('venue_id' in body)) {
    return fail(request, reqId, 400, 'INVALID_BODY', 'Send { "venue_id": "ven_…" } or null');
  }
  const venueId = body.venue_id;
  if (venueId !== null && (typeof venueId !== 'string' || !VENUE_ID_RE.test(venueId))) {
    return fail(request, reqId, 400, 'INVALID_VENUE_ID', 'venue_id is not a venue id');
  }
  return guarded(request, reqId, async () => {
    const event = await env.DB.prepare('SELECT id, brand_id FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ id: string; brand_id: string | null }>();
    if (!event) return fail(request, reqId, 404, 'NOT_FOUND', 'Event not found');
    if (venueId === null) {
      const cleared = await env.DB.prepare(
        `UPDATE events SET host_venue_id = NULL WHERE id = ? AND ${CEILING_KEPT_SQL}`
      )
        .bind(event.id, null)
        .run();
      if ((cleared.meta?.changes ?? 0) === 0) return ceilingLocked(request, reqId);
      return json(request, reqId, { ok: true, event_id: event.id, venue_id: null });
    }
    const brand = event.brand_id ?? '';
    if (reserved(brand)) {
      return fail(
        request,
        reqId,
        409,
        'VENUE_NEEDS_BRAND',
        'An event in the shared public brand cannot be held at a venue; give it its own brand'
      );
    }
    const venue = await env.DB.prepare('SELECT id, brand_id, name FROM venues WHERE id = ?')
      .bind(venueId)
      .first<VenueRow>();
    // An unknown venue and a venue that does not list this brand read alike, so
    // the answer never confirms that a venue id exists.
    if (!venue || !(await countingBrands(env.DB, venue)).includes(brand)) {
      return fail(
        request,
        reqId,
        403,
        'VENUE_NOT_LISTED',
        'This brand is not listed on the platform at that venue; ask the venue to list it'
      );
    }
    const moved = await env.DB.prepare(
      `UPDATE events SET host_venue_id = ? WHERE id = ? AND ${CEILING_KEPT_SQL}`
    )
      .bind(venue.id, event.id, venue.id)
      .run();
    if ((moved.meta?.changes ?? 0) === 0) return ceilingLocked(request, reqId);
    return json(request, reqId, { ok: true, event_id: event.id, venue_id: venue.id });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v2/admin/venues/:id/rollup
// ─────────────────────────────────────────────────────────────────────────────

interface Line {
  brand: string;
  events: number;
  poster_scans: FlooredCount;
  link_taps: FlooredCount;
  sponsors_on_show: number;
  businesses_on_show: number;
}

const DC = `(e.data_class = 'production' OR ? = 'all')`;

async function readLine(
  db: D1Database,
  venueId: string,
  brand: string,
  dc: string
): Promise<{ line: Line; scanCells: number[]; tapsPerEvent: (number | null)[] }> {
  const [events, scans, taps, sponsors] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM events e
          WHERE e.brand_id = ? AND e.host_venue_id = ? AND ${DC}`
      )
      .bind(brand, venueId, dc)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM scan_placement_events s
           JOIN events e ON e.id = s.event_id
           JOIN poster_deployments pd ON pd.id = s.poster_deployment_id
          WHERE e.brand_id = ? AND e.host_venue_id = ? AND ${DC} AND pd.is_vote_code = 0
          GROUP BY s.poster_deployment_id, ${scanHourSql('s')}`
      )
      .bind(brand, venueId, dc)
      .all<{ n: number }>(),
    db
      .prepare(
        `SELECT sl.event_id AS event_id, COALESCE(SUM(sl.clicks), 0) AS taps
           FROM shortlinks sl JOIN events e ON e.id = sl.event_id
          WHERE e.brand_id = ? AND e.host_venue_id = ? AND ${DC}
          GROUP BY sl.event_id, ${TAP_CODE_SQL}`
      )
      .bind(brand, venueId, dc)
      .all<{ event_id: string; taps: number }>(),
    db
      .prepare(
        `SELECT SUM(CASE WHEN ${PLACEMENT_ON_SHOW_SQL} THEN 1 ELSE 0 END) AS on_show,
                COUNT(DISTINCT CASE WHEN ${PLACEMENT_ON_SHOW_SQL} THEN sb.id END) AS businesses
           FROM sponsor_placement sp JOIN events e ON e.id = sp.event_id
           JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
          WHERE e.brand_id = ? AND e.host_venue_id = ? AND ${DC}`
      )
      .bind(brand, venueId, dc)
      .first<{ on_show: number; businesses: number }>(),
  ]);
  const scanCells = (scans.results ?? []).map((r) => num(r.n));
  const byEvent = new Map<string, number[]>();
  for (const t of taps.results ?? []) {
    const list = byEvent.get(t.event_id) ?? [];
    list.push(num(t.taps));
    byEvent.set(t.event_id, list);
  }
  const tapsPerEvent = [...byEvent.values()].map((codes) => floorTotalOfParts(codes).count);
  return {
    scanCells,
    tapsPerEvent,
    line: {
      brand,
      events: num(events?.n),
      poster_scans: floorTotalOfParts(scanCells),
      link_taps: floorTotalOfParts(tapsPerEvent),
      sponsors_on_show: num(sponsors?.on_show),
      businesses_on_show: num(sponsors?.businesses),
    },
  };
}

export async function handleVenueRollup(
  request: Request,
  env: VenuesEnv,
  venueId: string
): Promise<Response> {
  const reqId = rid();
  const dcParam = new URL(request.url).searchParams.get('data_class');
  const dc = dcParam === null ? 'production' : dcParam;
  if (dc !== 'production' && dc !== 'all') {
    return fail(request, reqId, 400, 'INVALID_FILTER', "data_class must be 'production' or 'all'");
  }
  const scope = await scopeOf(request, env);
  return guarded(request, reqId, async () => {
    const venue = await ownedVenue(env, scope, venueId);
    if (!venue) return fail(request, reqId, 404, 'NOT_FOUND', 'Venue not found');
    const { own, all: brands } = await countingSets(env.DB, venue);
    const read = await Promise.all(brands.map((b) => readLine(env.DB, venue.id, b, dc)));
    const grandfathered = await env.DB.prepare(
      `SELECT brand_id FROM venue_operators WHERE venue_id = ? AND status = 'grandfathered'
        ORDER BY brand_id`
    )
      .bind(venue.id)
      .all<{ brand_id: string }>();
    return json(request, reqId, {
      ok: true,
      venue: { id: venue.id, name: venue.name, owner_brand: venue.brand_id },
      scope: { data_class: dc },
      generated_at: new Date().toISOString(),
      // Each line is built by the same floor rule as the total, from the same
      // parts, so the floored lines add up to the floored total.
      totals: {
        events: read.reduce((s, r) => s + r.line.events, 0),
        poster_scans: floorTotalOfParts(read.flatMap((r) => r.scanCells)),
        link_taps: floorTotalOfParts(read.flatMap((r) => r.tapsPerEvent)),
        sponsors_on_show: read.reduce((s, r) => s + r.line.sponsors_on_show, 0),
        // A sponsor shows only at events of its own brand (two-sided consent,
        // PLACEMENT_ON_SHOW_SQL), so no business is on two lines: the footprint
        // is the sum of the lines.
        businesses_on_show: read.reduce((s, r) => s + r.line.businesses_on_show, 0),
      },
      by_operator: read.map((r) => ({
        ...r.line,
        // owner: the venue's own brand; venture: a brand below it in the tree;
        // operator: a brand the venue lists as on the platform.
        role:
          r.line.brand === venue.brand_id
            ? 'owner'
            : own.includes(r.line.brand)
              ? 'venture'
              : 'operator',
      })),
      grandfathered: (grandfathered.results ?? []).map((r) => r.brand_id),
    });
  });
}
