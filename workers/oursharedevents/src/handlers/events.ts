/**
 * Events API handler.
 *
 * GET  /api/v2/events              – list active events for a brand
 * GET  /api/v2/events/:id          – single event by ID
 * GET  /api/v2/admin/events        – admin list (includes archived)
 * POST /api/v2/admin/events        – create event (admin)
 * PUT  /api/v2/admin/events/:id    – update event (admin)
 * DELETE /api/v2/admin/events/:id  – hard-delete event, scan-guarded (admin, OSE-982)
 * GET  /api/v2/admin/event-templates – list seeded event templates (admin, OSE-868)
 *
 * Data source: D1 database (DB binding)
 */

import {
  coreValuesMissing,
  coreValuesRefusal,
  isPublishStep,
  logCoreValuesRefused,
} from '../lib/core-values';
import { corsHeaders } from '../lib/cors';
import { isJsonContentType } from '../lib/content-type';
import {
  cursorAfter,
  decodeUpcomingCursor,
  upcomingFloor,
  upcomingSql,
} from '../lib/admin-events-upcoming';
import {
  assertRenderable,
  VALID_EVENT_STATES,
  parseEventState,
  isValidTransition,
  getAllowedTransitions,
  type EventState,
} from '../domain/event-state';
import { enrichWithPhase } from '../lib/event-enrich.js';
import {
  clearMapDefaultSql,
  mapStillDefaultSql,
  useSponsorsSql,
  validateSettingsPatch,
  withMapDefaultMarker,
} from '../lib/event-settings';
import { logAdminAction } from '../lib/audit-log';
import { toPublicEvent } from '../lib/public-event-projection.js';
import {
  fetchPublicSeriesByEvent,
  fetchPublicSeriesOf,
  type PublicSeries,
} from '../lib/public-series.js';
import { fetchSponsorTitles } from '../lib/sponsor-titles';
import { createShortlink } from '../lib/shortlinks';
import { ensureEventCode } from '../lib/event-code';
import { maybeTag } from '../lib/h3-tagging';
import {
  eventPlaceText,
  lookUpEventPlace,
  placeState,
  savePlaceLookup,
  type PlaceState,
} from '../lib/event-place';
import { type MapsEnv } from '../lib/maps';
import {
  refreshSpineKeys,
  SPINE_KEYS_CLEAR_SQL,
  suppliedSpineKeyField,
  touchesSpineKeyInputs,
} from '../lib/spine-keys-store';
import {
  getDataProvider,
  invalidateSponsorsCache,
  type DataProviderEnv,
} from '../lib/data-provider.js';
import type { DataProviderCtx } from '@ocr/data-provider';
import {
  extractAdminActor,
  isAutomationActor,
  isDevOpenAdmin,
  logNullAdminActorDenied,
  type AdminEnv,
} from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import { validateLogoUrl, validateHttpsUrl } from '../lib/sponsor-logo';
import { isUploadedArtworkPath } from '../lib/event-thumb';
import { errorLabel } from '../lib/error-label';

// OSE-1658: the one answer for an artwork address that is not an upload.
const INVALID_COVER = 'INVALID_COVER_IMAGE_URL';
const INVALID_COVER_MESSAGE =
  'cover_image_url must be an uploaded file under /api/v2/uploads/ (upload it in Poster art), or null to clear';
import { WHAT_URL_TYPES, isValidWhatUrlType } from '../lib/what-url-types';
import { isEventTypeIdShape } from '../lib/event-type-catalog';
import { readEventTypeCatalog } from '../lib/event-type-catalog-read';
import { isValidIanaTimezone, zonedDateTimeToUtcIso, zonedTimePart } from '../lib/event-datetime';
import { listedFromForPublish } from '../lib/publish-grace';
import { explicitMapChoice, mapState } from '../lib/map-default';

// ─── Phase enrichment ──────────────────────────────────────────────────────────
//
// Moved to `lib/event-enrich.ts` by OSE-1243, when the server-rendered public
// page became a second consumer that reads the DataProvider directly. It stays
// one function so surfaces cannot re-derive phase or field names locally.

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EventsEnv extends DataProviderEnv, AdminEnv, AdminBrandScopeEnv, MapsEnv {
  WORKER_ENV?: string;
  DB?: D1Database;
  PUBLISH_GRACE_MINUTES?: string;
}

/**
 * OSE-1344 — resolve a client-supplied `event_type_id` against the registry.
 * null id → { ok, id: null } (clearing is allowed); a malformed or
 * unknown/inactive id → { ok: false } so the caller answers 400, never a
 * silent NULL — a picker that posts an id that does not exist is a bug we
 * want to see.
 *
 * DELIBERATELY does NOT touch `events.legal_clearance_tier`. Invariant #4
 * (OSE-380, tests/regulatory-label-unavailable.spec.ts): the tier is never
 * settable through the create/update API, directly OR by derivation — every
 * app-created event stays Phase 1 / general until the regulatory.phaseN flags
 * exist. The type is a classification for discovery; the tier is a legal
 * ceiling. They are joined at report/export time, not written here.
 */
async function resolveEventType(
  db: D1Database,
  raw: unknown
): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (raw === null || raw === undefined) return { ok: true, id: null };
  if (!isEventTypeIdShape(raw)) return { ok: false };
  const row = await db
    .prepare('SELECT id FROM event_type_registry WHERE id = ? AND is_active = 1')
    .bind(raw)
    .first<{ id: string }>();
  if (!row) return { ok: false };
  return { ok: true, id: row.id };
}

/**
 * OSE-1615: the spine keys are computed by the server (lib/spine-keys.ts). A
 * body that names one is refused whole, whatever the value, null included.
 */
function spineKeyRefused(field: string, rid: string): Response {
  return errorResponse(
    'SERVER_COMPUTED_FIELD',
    `${field} is computed by the server and cannot be sent`,
    400,
    rid
  );
}

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function errorResponse(code: string, message: string, status: number, rid: string): Response {
  return Response.json(
    {
      ok: false,
      status,
      code,
      error: message,
      requestId: rid,
      timestamp: new Date().toISOString(),
    },
    { status, headers: { 'X-Request-Id': rid } }
  );
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/events?brand=root
 *
 * Returns active events for a brand. Defaults to 'root' brand.
 * Uses DataProvider for live → CF cache → mock fallback chain.
 */
export async function handleListEvents(
  request: Request,
  env: EventsEnv,
  ctx?: DataProviderCtx
): Promise<Response> {
  const rid = requestId();
  const url = new URL(request.url);
  const brand = url.searchParams.get('brand') || 'root';

  // OSE-INV9 — tenant isolation: the DataProvider executes
  // WHERE brand_id = ? AND status = 'active'
  // on every public list request. Brand-scoping is the primary
  // cross-tenant isolation gate for the highest-traffic public surface.
  try {
    const dp = getDataProvider(env, ctx);
    const result = await dp.listEvents(brand);
    // OSE-1247 — enrich, then project. The projection is an allowlist, so a
    // column added to the SELECT for an internal reason does not reach the
    // public response by default.
    const items = result.data.map((e: unknown) =>
      toPublicEvent(enrichWithPhase(e as Record<string, unknown>))
    );
    // OSE-1522: the consented sponsor's title per listed event, for surfaces
    // that show many titles at once (the TV's "also coming up"). A sibling of
    // `items`, not a field on them, so the public event projection (the
    // allowlist, snapshot v1.3.0) is untouched. Same on-show rule as the cards
    // (lib/sponsor-titles); fails to empty.
    const listed = new Set(items.map((i) => String((i as { id?: unknown }).id ?? '')));
    const sponsor_titles: Record<string, string> = {};
    for (const [eventId, title] of await fetchSponsorTitles(env.DB, brand)) {
      if (listed.has(eventId)) sponsor_titles[eventId] = title;
    }
    // OSE-2018: the confirmed series each listed event sits on. A sibling of
    // `items`, like `sponsor_titles`, so the event projection is untouched.
    // Only `confirmed`, only the event's own brand (lib/public-series); fails to empty.
    const series: Record<string, PublicSeries> = {};
    for (const [eventId, s] of await fetchPublicSeriesByEvent(env.DB, brand)) {
      if (listed.has(eventId)) series[eventId] = s;
    }
    return Response.json(
      { ok: true, status: 200, items, sponsor_titles, series },
      {
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
          'X-Data-Source': result.source,
          'X-Request-Id': rid,
        },
      }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleListEvents',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query events', 503, rid);
  }
}

/**
 * GET /api/v2/events/:id
 *
 * Returns a single event by ID. Checks brand isolation.
 * Uses DataProvider for live → CF cache → mock fallback chain.
 */
export async function handleGetEvent(
  request: Request,
  env: EventsEnv,
  id: string,
  ctx?: DataProviderCtx
): Promise<Response> {
  const rid = requestId();

  try {
    const dp = getDataProvider(env, ctx);
    const result = await dp.getEvent(id);

    if (!result.data) {
      return errorResponse('NOT_FOUND', `Event not found: ${id}`, 404, rid);
    }

    const row = result.data as unknown as Record<string, unknown>;

    const { allowed, reason } = assertRenderable(
      parseEventState((row.status as string) ?? ''),
      'public'
    );
    if (!allowed) {
      return Response.json(
        { ok: false, status: 403, code: 'NOT_RENDERABLE', error: reason },
        { status: 403, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
      );
    }

    return Response.json(
      // OSE-1247 — same projection as the list. If the two endpoints described
      // the same event with different field sets, the narrower one would be
      // security theatre: a caller wanting the extra fields would just use the
      // other route.
      // OSE-2018: `series` is a sibling of `item`, never a field on it.
      {
        ok: true,
        status: 200,
        item: toPublicEvent(enrichWithPhase(row)),
        series: await fetchPublicSeriesOf(env.DB, String(row.id ?? id)),
      },
      {
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
          'X-Data-Source': result.source,
          'X-Request-Id': rid,
        },
      }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleGetEvent',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query event', 503, rid);
  }
}

/**
 * GET /api/v2/admin/events
 *   ?limit=<1-100, default 50>
 *   ?cursor=<ISO timestamp - page backward past this created_at>
 *
 * Returns events (including archived) for the admin dashboard in the
 * canonical cursor-paginated shape:
 *
 *   { ok: true, items: Event[], pagination: { limit, hasMore, nextCursor } }
 *
 * Cursor key is `created_at DESC` to match the reference implementations
 * in `audit.ts` (OSE-212) and `subscribers.ts` (OSE-207). The pagination
 * shape is statically enforced by
 * `tests/pagination-shape-invariant.spec.ts` (PR #155).
 *
 * Note: this is a behavioral change from the prior unbounded
 * `ORDER BY updated_at DESC` no-pagination response. FE consumers in
 * pages.ts read `data.items` directly and remain compatible (the
 * envelope is additive). If/when the admin UI grows past 50 events,
 * file a follow-on story to teach the dashboard to iterate via
 * `nextCursor` - same playbook the audit-log and subscribers admin
 * views will eventually need.
 */
export async function handleAdminListEvents(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();
  const url = new URL(request.url);

  // Match audit.ts / subscribers.ts parsing exactly.
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
  const cursor = url.searchParams.get('cursor') ?? null;

  // Lifecycle filters (migration 0075 / "come back to my events"):
  //   ?status=draft|ready|active|archived — allowlisted against the state
  //     machine; anything else is 400 (strict-in, never silently ignored).
  //   ?mine=1 — only rows whose created_by equals the caller's server-verified
  //     actor id. A FILTER on top of brand scope, never a widening of it: a key
  //     actor (no personal identity) gets the same brand-scoped set either way.
  const rawStatus = url.searchParams.get('status');
  const statusFilter =
    rawStatus == null || rawStatus === '' || rawStatus === 'all'
      ? null
      : (VALID_EVENT_STATES as readonly string[]).includes(rawStatus)
        ? rawStatus
        : undefined;
  if (statusFilter === undefined) {
    return errorResponse(
      'INVALID_STATUS',
      `status must be one of: ${VALID_EVENT_STATES.join(', ')}`,
      400,
      rid
    );
  }
  const mineRaw = url.searchParams.get('mine');
  const mine = mineRaw === '1' || mineRaw === 'true';

  // ?sort=upcoming — "Soonest first" (lib/admin-events-upcoming). Reorders the
  // same scoped + filtered set and pages with its own opaque cursor. Absent or
  // `created` keeps the created_at DESC default; anything else is 400.
  const rawSort = url.searchParams.get('sort');
  const sort =
    rawSort == null || rawSort === '' || rawSort === 'created'
      ? 'created'
      : rawSort === 'upcoming'
        ? 'upcoming'
        : null;
  if (sort === null) {
    return errorResponse('INVALID_SORT', 'sort must be one of: created, upcoming', 400, rid);
  }
  const upcomingAfter = sort === 'upcoming' && cursor ? decodeUpcomingCursor(cursor) : null;
  if (sort === 'upcoming' && cursor && !upcomingAfter) {
    return errorResponse('INVALID_CURSOR', 'cursor does not belong to this listing', 400, rid);
  }
  // The floor is fixed by page one and carried in the cursor, so a list paged
  // across midnight keeps one ordering.
  const floor = upcomingAfter ? upcomingAfter.f : upcomingFloor();

  if (!env.DB) {
    return Response.json(
      {
        ok: true,
        items: [],
        pagination: { limit, hasMore: false, nextCursor: null },
      },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  }

  // OSE-666 / B1 (#9 tenant_isolation) — derive the caller's brand scope from
  // the SERVER-VERIFIED actor identity, never from a client `?brand_id=`. An
  // unscopable operator is denied (zero rows), never handed the whole table.
  const actor = extractAdminActor(request, env);
  const scope = await resolveAdminBrandScopeAsync(actor, env);
  if (scope.mode === 'deny') {
    return Response.json(
      { ok: true, items: [], pagination: { limit, hasMore: false, nextCursor: null } },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  }

  try {
    const EVENT_SELECT_COLS =
      'e.id, e.brand_id, e.title, e.slug, e.status, e.description, e.location,' +
      ' e.start_date, e.end_date, e.timezone, e.starts_at, e.cover_image_url, e.created_at, e.updated_at,' +
      ' e.legal_clearance_tier, e.event_type_id, etr.name AS event_type_name,' +
      ' e.what_short, e.who_host, e.why_purpose, e.how_details, e.where_address,' +
      ' e.who_story, e.who_image_url, e.what_video_url,' +
      ' e.lat, e.lon, e.corridor_id, e.h3_res9, e.h3_res7,' +
      ' e.is_published, e.created_by, e.listed_from, e.data_class,' +
      // OSE-1560 — is the map setting still the default (the organizer has not
      // chosen)? A flag, not the raw settings blob.
      ` CASE WHEN ${mapStillDefaultSql('e')} THEN 1 ELSE 0 END AS map_default,` +
      // OSE-1900 — has the event opted in to sponsors (absent means off)? A
      // flag for the admin's switch, not the raw settings blob.
      ` CASE WHEN ${useSponsorsSql('e')} THEN 1 ELSE 0 END AS use_sponsors`;

    // WHERE is composed from server-derived scope, the allowlisted lifecycle
    // filters, and the opaque cursor only — never a caller-chosen brand.
    const whereParts: string[] = [];
    const bindings: (string | number)[] = [];
    const upcoming = sort === 'upcoming' ? upcomingSql(floor, upcomingAfter) : null;
    if (upcoming?.where) {
      whereParts.push(upcoming.where.sql);
      bindings.push(...upcoming.where.binds);
    } else if (cursor && sort === 'created') {
      whereParts.push('e.created_at < ?');
      bindings.push(cursor);
    }
    if (scope.mode === 'scoped') {
      const placeholders = scope.brandIds.map(() => '?').join(', ');
      whereParts.push(`e.brand_id IN (${placeholders})`);
      bindings.push(...scope.brandIds);
    }
    if (statusFilter) {
      whereParts.push('e.status = ?');
      bindings.push(statusFilter);
    }
    // "Only mine" is meaningful only for a personal (email) actor; a key actor
    // has no creator identity to match, so the flag is a no-op for it rather
    // than an empty list.
    if (mine && actor && !isAutomationActor(actor)) {
      whereParts.push('e.created_by = ?');
      bindings.push(actor);
    }
    const whereClause = whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : '';
    // ORDER BY binds come after every WHERE bind, in text order, then LIMIT.
    const orderBy = upcoming ? upcoming.orderBy.sql : ' ORDER BY e.created_at DESC';
    if (upcoming) bindings.push(...upcoming.orderBy.binds);
    bindings.push(limit + 1);
    const adminListSql =
      'SELECT ' +
      EVENT_SELECT_COLS +
      ' FROM events e LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id' +
      whereClause +
      orderBy +
      ' LIMIT ?';

    const result = await env.DB.prepare(adminListSql)
      .bind(...bindings)
      .all();

    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map(enrichWithPhase);
    // Cursor key MUST come from the source row, not the enriched value -
    // enrichWithPhase copies created_at through unchanged, but explicit
    // is safer and matches audit.ts pattern.
    const last = page[page.length - 1] as Record<string, unknown> | undefined;
    const nextCursor =
      hasMore && last
        ? sort === 'upcoming'
          ? cursorAfter(last, floor)
          : ((last.created_at as string) ?? null)
        : null;

    return Response.json(
      {
        ok: true,
        items,
        pagination: { limit, hasMore, nextCursor },
        // Echo the applied filters so the client renders what the server did,
        // not what it asked for (a key actor asking ?mine=1 sees mine:false).
        filters: {
          status: statusFilter,
          mine: Boolean(mine && actor && !isAutomationActor(actor)),
          sort,
        },
      },
      {
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'no-store',
          'X-Request-Id': rid,
        },
      }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminListEvents',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query events', 503, rid);
  }
}

// ─── Admin: Create / Update helpers ─────────────────────────────────────────

const MAX_BODY = 16 * 1024;

/** Allowed brand IDs — lowercase alphanumeric, hyphens, underscores */
const BRAND_PATTERN = /^[a-z0-9_-]{1,64}$/;

/** ISO date: YYYY-MM-DD */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidBrand(brand: string): boolean {
  return BRAND_PATTERN.test(brand);
}

function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE_PATTERN.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) return false;
  // JS normalizes impossible days (2026-02-31 → March 3) instead of failing,
  // so round-trip: the parsed calendar date must be the one that was sent.
  return parsed.toISOString().slice(0, 10) === date;
}

function isValidContentType(request: Request): boolean {
  return isJsonContentType(request.headers.get('content-type'));
}

/** Tries a derived slug gets before create answers 409 SLUG_TAKEN. */
const SLUG_ATTEMPTS = 5;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

/**
 * OSE-1900: record one write of the sponsors switch. It is a consent decision,
 * so each write gets its own audit row saying which way it went (the router's
 * CREATE_EVENT or UPDATE_EVENT row says only that the event changed). Call it
 * once the write has landed and before any later step that can fail, so the
 * log neither claims a change that did not happen nor misses one that did.
 *
 * It also drops the event's cached sponsor list, as every sponsor write does.
 * No public reader serves that list from the cache today (each asks for a live
 * read), so the drop is what keeps the rule true if one ever does: off hides
 * every placement on the next read, not when a cache entry runs out.
 */
async function recordSponsorsSwitch(
  request: Request,
  env: EventsEnv,
  eventId: string,
  on: boolean,
  rid: string
): Promise<void> {
  await invalidateSponsorsCache(eventId);
  await logAdminAction(env as { DB: D1Database }, {
    action: 'EVENT_SPONSORS_SWITCH',
    actor: extractAdminActor(request, env),
    resource_type: 'event',
    resource_id: eventId,
    request_id: rid,
    outcome: 'success',
    details: { use_sponsors: on },
  });
}

/**
 * POST /api/v2/admin/events
 *
 * Creates a new event. Required: title. Optional: all other fields.
 * Auto-generates id (evt_UUID) and slug from title.
 */
export async function handleCreateEvent(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();

  if (!env.DB) {
    return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);
  }

  // Content-Type check
  if (!isValidContentType(request)) {
    return errorResponse('BAD_CONTENT_TYPE', 'Content-Type must be application/json', 400, rid);
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) {
      return errorResponse('PAYLOAD_TOO_LARGE', 'Body must be under 16KB', 400, rid);
    }
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400, rid);
  }

  const suppliedKey = suppliedSpineKeyField(body);
  if (suppliedKey) return spineKeyRefused(suppliedKey, rid);

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (!title) {
    return errorResponse('MISSING_FIELD', 'Missing required field: title', 400, rid);
  }

  // Brand validation, then brand SCOPE (R-3 / OSE-845, Invariant #9). The target
  // brand is resolved from the server-verified actor, never trusted from the body:
  // a scoped admin may only create inside a brand they belong to, an unmapped
  // admin creates nothing, and only 'all' (key actor + ADMIN_SCOPE_ALL) may fall
  // back to 'root'. Same rules as sponsors' resolvePoolBrand.
  const requestedBrand = typeof body.brand_id === 'string' ? body.brand_id.slice(0, 64) : '';
  if (requestedBrand && !isValidBrand(requestedBrand)) {
    return errorResponse(
      'INVALID_BRAND',
      'brand_id must be lowercase alphanumeric, hyphens, or underscores (1-64 chars)',
      400,
      rid
    );
  }
  // A null actor is allowed only when the DEV_OPEN_ADMIN local-dev bypass is
  // really on (re-tested here, never inferred from the null). Anywhere else a
  // null actor creates nothing (OSE-1801).
  const actor = extractAdminActor(request, env);
  if (actor === null && !isDevOpenAdmin(env)) {
    logNullAdminActorDenied('event-create', env, rid);
    return errorResponse(
      'BRAND_FORBIDDEN',
      'Your admin sign-in could not be confirmed for this request. Sign in again and retry.',
      403,
      rid
    );
  }
  // The bypass is re-tested in this condition too, so the grant below never rests
  // on the early return above staying where it is (CCR 2026-11-04 R1-03).
  const scope =
    actor !== null
      ? await resolveAdminBrandScopeAsync(actor, env)
      : isDevOpenAdmin(env)
        ? ({ mode: 'all' } as const)
        : ({ mode: 'deny' } as const);
  if (scope.mode === 'deny') {
    return errorResponse(
      'BRAND_FORBIDDEN',
      'Your admin account is not a member of any brand, so it cannot create events',
      403,
      rid
    );
  }
  if (scope.mode === 'scoped' && requestedBrand && !scope.brandIds.includes(requestedBrand)) {
    return errorResponse(
      'BRAND_FORBIDDEN',
      `Not entitled to brand_id "${requestedBrand}"`,
      403,
      rid
    );
  }
  const brandId = requestedBrand || (scope.mode === 'scoped' ? scope.brandIds[0] : 'root');

  // data_class (migration 0052): every row is labelled at write time. A person's
  // event is 'production', the default. Automation (a key or the CI service
  // actor) may label its own test event 'synthetic', which the dashboards leave
  // out by default; the nightly staging lifecycle job does
  // (scripts/lifecycle/). 'demo' is the mock-data class and is never written here. Absent
  // or null means the default; anything else is refused before any write.
  let dataClass: 'production' | 'synthetic' = 'production';
  if (body.data_class !== undefined && body.data_class !== null) {
    if (body.data_class !== 'production' && body.data_class !== 'synthetic') {
      return errorResponse(
        'INVALID_DATA_CLASS',
        "data_class must be 'production' or 'synthetic'",
        400,
        rid
      );
    }
    if (body.data_class === 'synthetic' && !isAutomationActor(actor)) {
      return errorResponse(
        'DATA_CLASS_FORBIDDEN',
        'Only automation may label an event synthetic',
        403,
        rid
      );
    }
    dataClass = body.data_class;
  }

  const id = `evt_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  // A slug the caller chose is kept as is (and still answers 409 when taken).
  // A derived one starts from the title; a title with no letters or digits
  // ("!!!") would derive '' and collide with the next such title, so it is
  // 'event'.
  const slugDerived = typeof body.slug !== 'string';
  const slugBase = slugDerived ? slugify(title) || 'event' : (body.slug as string).slice(0, 100);
  let slug = slugBase;
  // OSE-1425 (owner, 2026-11-13): creation is the start of the lifecycle. A
  // signed-in person's event is always a draft, whatever the body says; it goes
  // live only through ready → verify-qr or PUT status, which check the step.
  // Automation (a key or the CI service actor) may still create an event in
  // another state, as the staging lifecycle job, the stock seed and the staging
  // specs do. A live one is written with qr_verified = 1 in the same INSERT
  // below, so `active ⟺ qr_verified = 1` holds at this door too.
  const requestedStatus =
    typeof body.status === 'string' &&
    (VALID_EVENT_STATES as readonly string[]).includes(body.status)
      ? body.status
      : 'draft';
  const status = isAutomationActor(actor) ? requestedStatus : 'draft';
  const description = typeof body.description === 'string' ? body.description.slice(0, 2000) : null;
  const location = typeof body.location === 'string' ? body.location.slice(0, 500) : null;

  // OSE-239a: 5W content fields (added by OSE-236 schema migration 0029).
  // All optional; bounded by reasonable max lengths. trimStr() inline-equivalent
  // here so an empty string after trim persists as null rather than ''. This
  // matters because L2 tests / FE consumers MUST be able to distinguish
  // "field intentionally blank" from "field never populated".
  const trimOrNull = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim().slice(0, max);
    return trimmed.length > 0 ? trimmed : null;
  };
  const whatShort = trimOrNull(body.what_short, 300);
  const whoHost = trimOrNull(body.who_host, 200);
  const whyPurpose = trimOrNull(body.why_purpose, 2000);
  const howDetails = trimOrNull(body.how_details, 2000);
  const whereAddress = trimOrNull(body.where_address, 500);

  // OSE-664: rich WHO / WHAT authoring — the supply side of the pre-event funnel.
  // who_story is the host/artist story (rich text, the WHO conversion engine);
  // stored raw and escaped on render (esc()) so an authored <script> can never
  // execute on the public funnel. The media URLs are references (never embeds):
  // validated http(s)-only via the canonical validateLogoUrl scheme guard, so a
  // javascript:/data: payload is rejected here (born-red) and never reaches D1.
  const whoStory = trimOrNull(body.who_story, 4000);
  const whoImage = validateLogoUrl(body.who_image_url);
  if (!whoImage.valid) {
    return errorResponse(
      'INVALID_URL',
      'who_image_url must be a http(s) URL under 500 chars',
      400,
      rid
    );
  }
  const whatVideo = validateLogoUrl(body.what_video_url);
  if (!whatVideo.valid) {
    return errorResponse(
      'INVALID_URL',
      'what_video_url must be a http(s) URL under 500 chars',
      400,
      rid
    );
  }
  // OSE what_url — the WHAT card's optional external link (fundraiser donation
  // site, tickets, external RSVP, …). HTTPS-ONLY: it is a public outbound link the
  // visitor's own browser follows, so plain http:// is a mixed-content/downgrade
  // risk and is rejected (unlike the proxied media URLs). null clears it.
  const whatLink = validateHttpsUrl(body.what_url);
  if (!whatLink.valid) {
    return errorResponse(
      'INVALID_URL',
      'what_url must be an https:// URL under 500 chars',
      400,
      rid
    );
  }
  const whoImageUrl = whoImage.url;
  const whatVideoUrl = whatVideo.url;
  const whatUrl = whatLink.url;

  // R3 (OSE-1319) — typed external-link controls. `what_url_enabled` gates
  // whether the link renders at all (a staged-but-OFF url stays dark, so an
  // organizer can prep a fundraiser link before flipping it live); `what_url_type`
  // picks the CTA label on the public page + the destination-slot label on the
  // poster. Strict-in: an out-of-vocabulary type is a 400 — the admin dropdown
  // only ever emits valid values, so this only fires on a direct-API fat-finger.
  const whatUrlEnabled = body.what_url_enabled === true || body.what_url_enabled === 1 ? 1 : 0;
  let whatUrlType: string | null = null;
  if (body.what_url_type != null && body.what_url_type !== '') {
    if (!isValidWhatUrlType(body.what_url_type)) {
      return errorResponse(
        'INVALID_WHAT_URL_TYPE',
        `what_url_type must be one of: ${WHAT_URL_TYPES.join(', ')}`,
        400,
        rid
      );
    }
    whatUrlType = body.what_url_type;
  }

  // Date validation
  const startDate = typeof body.start_date === 'string' ? body.start_date.slice(0, 30) : null;
  if (startDate !== null && !isValidIsoDate(startDate)) {
    return errorResponse('INVALID_DATE', 'start_date must be YYYY-MM-DD format', 400, rid);
  }
  const endDate = typeof body.end_date === 'string' ? body.end_date.slice(0, 30) : null;
  if (endDate !== null && !isValidIsoDate(endDate)) {
    return errorResponse('INVALID_DATE', 'end_date must be YYYY-MM-DD format', 400, rid);
  }
  const timezone =
    typeof body.timezone === 'string' ? body.timezone.slice(0, 50) : 'America/Chicago';
  // OSE-1313 — an explicitly-supplied timezone must be a real IANA zone; a typo
  // stored here would garble Intl on every render. The default is valid, so only
  // validate when the client actually sent one (stays additive).
  if (typeof body.timezone === 'string' && !isValidIanaTimezone(timezone)) {
    return errorResponse('INVALID_TIMEZONE', 'timezone must be a valid IANA zone', 400, rid);
  }
  // OSE-1313 — optional wall-clock start time (HH:MM, 24h) in the event's zone.
  // When present with a date, persist the canonical UTC instant in starts_at;
  // start_date stays the local calendar date. Absent time → starts_at NULL
  // (date-only event, prior behaviour).
  // Not sliced: zonedDateTimeToUtcIso checks the WHOLE string is HH:MM, so
  // "18:00garbage" is refused rather than silently stored as 18:00.
  if (
    'start_time' in body &&
    body.start_time !== null &&
    body.start_time !== undefined &&
    typeof body.start_time !== 'string'
  ) {
    return errorResponse('INVALID_TIME', 'start_time must be HH:MM (24h)', 400, rid);
  }
  const startTime = typeof body.start_time === 'string' ? body.start_time : null;
  let startsAt: string | null = null;
  if (startTime !== null) {
    if (startDate === null) {
      return errorResponse('INVALID_TIME', 'start_time requires start_date', 400, rid);
    }
    startsAt = zonedDateTimeToUtcIso(startDate.slice(0, 10), startTime, timezone);
    if (startsAt === null) {
      return errorResponse(
        'INVALID_TIME',
        'start_time must be HH:MM (24h) and exist on that date in the timezone',
        400,
        rid
      );
    }
  }
  // OSE-1658 (owner decision A, 2026-10-11): artwork is an uploaded file under
  // /api/v2/uploads/, or nothing. Refused, never cut to fit.
  const coverRaw = body.cover_image_url;
  const coverImageUrl =
    coverRaw === undefined || coverRaw === null || coverRaw === '' ? null : coverRaw;
  if (coverImageUrl !== null && !isUploadedArtworkPath(coverImageUrl)) {
    return errorResponse(INVALID_COVER, INVALID_COVER_MESSAGE, 400, rid);
  }
  const templateId = typeof body.template_id === 'string' ? body.template_id.slice(0, 64) : null;

  // OSE-1344 — the Category → Type picker posts `event_type_id`. Optional (an
  // event with only a title still saves), validated against the registry when
  // present. Both create paths in admin.html send it when the organizer picked.
  const eventType = await resolveEventType(env.DB, body.event_type_id);
  if (!eventType.ok) {
    return errorResponse(
      'INVALID_EVENT_TYPE',
      'event_type_id is not an active event type',
      400,
      rid
    );
  }

  // OSE-869 — per-event section switches (lib/event-settings.ts). Optional; a
  // body without `settings` stores '{}' (every section on). Strict on write.
  let settingsJson = '{}';
  // OSE-1900: set when the create names the sponsors switch (true or false).
  let useSponsorsAtCreate: boolean | undefined;
  if ('settings' in body && body.settings !== undefined) {
    const v = validateSettingsPatch(body.settings);
    if (!v.ok) return errorResponse('INVALID_SETTINGS', v.error, 400, rid);
    settingsJson = JSON.stringify(v.value);
    useSponsorsAtCreate = v.value.useSponsors;
  }

  // OSE-489: capture-time H3 tagging — computation happens here (admin create),
  // never in the scan/read hot path.
  const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
  const lon = typeof body.lon === 'number' && Number.isFinite(body.lon) ? body.lon : null;
  const h3Tags = maybeTag(lat, lon);

  // OSE-1245 — publication is an act (OCR_VISION.md §6.2c). The host decides
  // whether this event appears on public discovery surfaces at all.
  //
  // OSE-1560 (PO, 2026-10-03): a new event is OFF the map unless the organizer
  // says otherwise. Nothing is listed publicly by omission: the default-on map
  // was the risk (a home event listed because nobody chose).
  //
  // Only an explicit true/1 turns it on. An absent or malformed value is "no
  // choice": the event is stored off and carries the `mapDefault` marker
  // (lib/map-default.ts), which is what lets a sponsor the organizer adds LATER
  // turn the map on. An explicit false/0 is a choice (no marker), so a later
  // sponsor can never override it. Existing rows keep whatever they have.
  const mapChoice = explicitMapChoice(body.is_published);
  const isPublished = mapChoice === true ? 1 : 0;
  if (mapChoice === null) {
    settingsJson = withMapDefaultMarker(settingsJson);
  }

  // Migration 0075 — record WHO made this row (the server-verified admin actor:
  // CF Access email, or key:admin / key:ocr-internal for automation). This is
  // what lets the admin list answer "only mine" later. Never client-supplied.
  const createdBy = extractAdminActor(request, env);

  const now = new Date().toISOString();

  for (let attempt = 0; ; attempt++) {
    try {
      await env.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, description, location, start_date, end_date, timezone, starts_at, cover_image_url, template_id,
                             what_short, who_host, why_purpose, how_details, where_address,
                             who_story, who_image_url, what_video_url, what_url,
                             what_url_enabled, what_url_type,
                             lat, lon, h3_res9, h3_res7, is_published, created_by,
                             event_type_id, settings_json, listed_from, data_class,
                             qr_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          brandId,
          title,
          slug,
          status,
          description,
          location,
          startDate,
          endDate,
          timezone,
          startsAt,
          coverImageUrl,
          templateId,
          whatShort,
          whoHost,
          whyPurpose,
          howDetails,
          whereAddress,
          whoStory,
          whoImageUrl,
          whatVideoUrl,
          whatUrl,
          whatUrlEnabled,
          whatUrlType,
          lat,
          lon,
          h3Tags?.h3_res9 ?? null,
          h3Tags?.h3_res7 ?? null,
          isPublished,
          createdBy,
          eventType.id,
          settingsJson,
          // Created live (automation): listed at once, but the listing start is
          // recorded so the corridor latch's settling rule still applies.
          status === 'active' ? now : null,
          dataClass,
          // OSE-1425: live means verified, in the same write.
          status === 'active' ? 1 : 0,
          now,
          now
        )
        .run();
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint')) {
        // Slugs are unique across the whole platform and write-once (Invariant
        // 18), so a second "Trivia Night" anywhere used to fail here. A derived
        // slug gets a short random suffix and the insert runs again.
        if (slugDerived && attempt < SLUG_ATTEMPTS - 1) {
          slug = `${slugBase.slice(0, 93)}-${crypto.randomUUID().slice(0, 6)}`;
          continue;
        }
        return errorResponse('SLUG_TAKEN', `Slug "${slug}" is already in use`, 409, rid);
      }
      console.error(
        JSON.stringify({
          type: 'DB_ERROR',
          handler: 'handleCreateEvent',
          error: errorLabel(err),
          timestamp: now,
        })
      );
      return errorResponse('DB_ERROR', 'Failed to create event', 503, rid);
    }
  }

  // OSE-1900: a create that names the sponsors switch is a write of it, so it
  // gets the same audit row as a later change. The row is in, so it is recorded
  // before the steps below, none of which can undo the create.
  if (useSponsorsAtCreate !== undefined) {
    await recordSponsorsSwitch(request, env, id, useSponsorsAtCreate, rid);
  }

  // OSE-240: generate a shortlink for every newly-created event. The
  // shortlinks table FK is TEXT REFERENCES events(id), matching the
  // events.id we just inserted. If shortlink creation fails (D1 down,
  // migration not applied), we surface the event_id + slug but no
  // shortcode — the event itself still exists.
  //
  // OSE-243a code review follow-up (2026-05-14): a NULL shortcode means
  // a critical Pulse 1 affordance failed (the whole point of OSE-240
  // is the shareable link). Returning silent null leaves the admin to
  // share an event with no working /s/:code. We add a `warnings` array
  // so the API contract is honest — the admin UI / Postman caller can
  // detect SHORTLINK_CREATE_FAILED and surface a retry banner. Warnings
  // are always present (empty array on success) so consumers can iterate
  // without null checks.
  let shortcode: string | null = null;
  const warnings: Array<{ code: string; message: string }> = [];
  try {
    const sl = await createShortlink(env, id);
    shortcode = sl.code;
  } catch (err) {
    console.warn(
      JSON.stringify({
        type: 'SHORTLINK_CREATE_FAILED',
        eventId: id,
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    warnings.push({
      code: 'SHORTLINK_CREATE_FAILED',
      message:
        'Shortlink generation failed; the event was created but no shareable code was assigned. Retry the create or generate a shortlink manually.',
    });
  }

  // OSE-1684: the event's one short code (/e/ share link, /p/, /tv/, /r/, /c/),
  // minted now so the event page's Share button hands out /e/<code> from the
  // start. A failure is a warning, not a failed create: admin mints it on
  // first ask.
  let eventCode: string | null = null;
  try {
    eventCode = await ensureEventCode(env.DB, id);
  } catch (err) {
    console.warn(
      JSON.stringify({
        type: 'EVENT_CODE_CREATE_FAILED',
        eventId: id,
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    warnings.push({
      code: 'EVENT_CODE_CREATE_FAILED',
      message: 'The short code was not made; the event page shares its full address until it is.',
    });
  }

  // Owner report 2026-10-11: the zip search lists an event only by its map
  // cell, and no create form sent coordinates. With none given, the place is
  // looked up once (lib/event-place.ts); a failed lookup never fails the create.
  let place: PlaceState = h3Tags ? 'on_map' : 'not_looked_up';
  if (!h3Tags) {
    try {
      const r = await lookUpEventPlace(env, whereAddress, location);
      await savePlaceLookup(env.DB, id, r, now);
      place = placeState(r);
    } catch (err) {
      console.warn(
        JSON.stringify({
          type: 'EVENT_PLACE_LOOKUP_FAILED',
          eventId: id,
          error: errorLabel(err),
          timestamp: new Date().toISOString(),
        })
      );
    }
  }

  // OSE-1615: both spine keys, from the row as it now stands (the place lookup
  // above may just have given it its cell).
  await refreshSpineKeys(env.DB, id);

  return Response.json(
    {
      ok: true,
      status: 201,
      id,
      slug,
      shortcode,
      event_code: eventCode,
      starts_at: startsAt,
      timezone,
      place,
      data_class: dataClass,
      // OSE-1425 — the lifecycle state the row was written in, so a caller sees
      // that a person's create is a draft whatever it asked for, and automation
      // sees that a live create is verified.
      event_status: status,
      qr_verified: status === 'active',
      warnings,
      // OSE-1560 — what the admin shows as the heads-up (the toast is OSE-1564).
      map: mapState(isPublished === 1, mapChoice === null),
    },
    {
      status: 201,
      headers: { ...corsHeaders(request), 'X-Request-Id': rid },
    }
  );
}

/**
 * PUT /api/v2/admin/events/:id
 *
 * Updates an existing event. Only provided fields are changed.
 */
export async function handleUpdateEvent(
  request: Request,
  env: EventsEnv,
  eventId: string
): Promise<Response> {
  const rid = requestId();

  if (!env.DB) {
    return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);
  }

  // Content-Type check
  if (!isValidContentType(request)) {
    return errorResponse('BAD_CONTENT_TYPE', 'Content-Type must be application/json', 400, rid);
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) {
      return errorResponse('PAYLOAD_TOO_LARGE', 'Body must be under 16KB', 400, rid);
    }
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400, rid);
  }

  const suppliedKey = suppliedSpineKeyField(body);
  if (suppliedKey) return spineKeyRefused(suppliedKey, rid);

  // Status validation (if provided)
  if ('status' in body && body.status !== null) {
    const s = typeof body.status === 'string' ? body.status : '';
    if (!(VALID_EVENT_STATES as readonly string[]).includes(s)) {
      return errorResponse(
        'INVALID_STATUS',
        `status must be one of: ${VALID_EVENT_STATES.join(', ')}`,
        400,
        rid
      );
    }
  }

  // Date validation (if provided)
  if ('start_date' in body && body.start_date !== null) {
    const sd = typeof body.start_date === 'string' ? body.start_date : '';
    if (!isValidIsoDate(sd)) {
      return errorResponse('INVALID_DATE', 'start_date must be YYYY-MM-DD format', 400, rid);
    }
  }
  if ('end_date' in body && body.end_date !== null) {
    const ed = typeof body.end_date === 'string' ? body.end_date : '';
    if (!isValidIsoDate(ed)) {
      return errorResponse('INVALID_DATE', 'end_date must be YYYY-MM-DD format', 400, rid);
    }
  }

  const allowedFields: Record<string, { max: number }> = {
    title: { max: 200 },
    description: { max: 2000 },
    location: { max: 500 },
    start_date: { max: 30 },
    end_date: { max: 30 },
    timezone: { max: 50 },
    // cover_image_url is checked below (OSE-1658), not cut to fit.
    status: { max: 20 },
    template_id: { max: 64 },
    // OSE-239a: 5W content fields (added by OSE-236 migration 0029). All
    // nullable; max-length-bounded to match handleCreateEvent semantics.
    what_short: { max: 300 },
    who_host: { max: 200 },
    why_purpose: { max: 2000 },
    how_details: { max: 2000 },
    where_address: { max: 500 },
    // OSE-664: rich host/artist story. Media URLs are handled separately below
    // (they need scheme validation, not a blind slice).
    who_story: { max: 4000 },
  };

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [field, { max }] of Object.entries(allowedFields)) {
    if (field in body) {
      const val = body[field];
      if (val === null) {
        sets.push(`${field} = ?`);
        values.push(null);
      } else if (typeof val === 'string') {
        sets.push(`${field} = ?`);
        values.push(val.slice(0, max));
      }
    }
  }

  // OSE-1658 — artwork: an uploaded file under /api/v2/uploads/; null or ''
  // clears it; anything else is refused and nothing is written.
  if ('cover_image_url' in body) {
    const cover = body.cover_image_url;
    if (cover === null || cover === '') {
      sets.push('cover_image_url = ?');
      values.push(null);
    } else if (isUploadedArtworkPath(cover)) {
      sets.push('cover_image_url = ?');
      values.push(cover);
    } else {
      return errorResponse(INVALID_COVER, INVALID_COVER_MESSAGE, 400, rid);
    }
  }

  // OSE-1245 — publication is reversible, and it must be.
  //
  // Handled here rather than in `allowedFields` for the same reason lat/lon
  // are: that map holds string fields with length caps, and this is a boolean.
  //
  // A host who published and then thought better of it has to be able to take
  // it back. That the take-back is imperfect — un-flipping does not un-send,
  // and anything already scraped or cached stays out there (§6.2c) — is an
  // argument for asking clearly BEFORE the first publish, not an argument for
  // making the reversal unavailable.
  //
  // Accepts boolean or 0/1 so a form post and a JSON client agree.
  // OSE-1344 — event_type_id is an id-shaped FK, not a free string: validated
  // against the registry (null clears; unknown → 400). Never touches
  // legal_clearance_tier (Invariant #4 — see resolveEventType).
  if ('event_type_id' in body) {
    const et = await resolveEventType(env.DB, body.event_type_id);
    if (!et.ok) {
      return errorResponse(
        'INVALID_EVENT_TYPE',
        'event_type_id is not an active event type',
        400,
        rid
      );
    }
    sets.push('event_type_id = ?');
    values.push(et.id);
  }

  // OSE-869 — per-event section switches. A partial patch: keys the body does
  // not name keep their stored value. Strict on write (400 INVALID_SETTINGS).
  let settingsPatchJson: string | null = null;
  // OSE-1900 — set when this PUT names the sponsors switch (true or false).
  let useSponsorsWrite: boolean | undefined;
  if ('settings' in body) {
    const v = validateSettingsPatch(body.settings);
    if (!v.ok) return errorResponse('INVALID_SETTINGS', v.error, 400, rid);
    settingsPatchJson = JSON.stringify(v.value);
    useSponsorsWrite = v.value.useSponsors;
  }

  // Set when this PUT turns listing on (see the grace window below).
  let listingOn = false;
  // OSE-1560 — any explicit map write is the organizer choosing: it drops the
  // `mapDefault` marker, so a sponsor added later never overrides it.
  let mapChosenNow: boolean | null = null;
  if ('is_published' in body) {
    const v = explicitMapChoice(body.is_published);
    if (v !== null) {
      sets.push('is_published = ?');
      values.push(v ? 1 : 0);
      listingOn = v;
      mapChosenNow = v;
    }
  }
  // ONE settings_json assignment (a column may be SET once): the merge patch,
  // then the marker removal when the map was just chosen. json_patch is RFC
  // 7396, so two concurrent toggles cannot lose each other's write the way a
  // read-modify-write would (CCR PR701 F6).
  {
    let expr: string | null = null;
    if (settingsPatchJson !== null) {
      expr = "json_patch(COALESCE(settings_json, '{}'), ?)";
      values.push(settingsPatchJson);
    }
    if (mapChosenNow !== null) expr = clearMapDefaultSql(expr ?? undefined);
    if (expr !== null) sets.push('settings_json = ' + expr);
  }

  // OSE-489: lat/lon are REAL columns — handle separately from string allowedFields.
  let geoUpdated = false;
  // OSE-1615: a latitude or longitude that is not on the globe is refused here,
  // before anything is written. It used to be stored and then fail when its
  // cell was computed, and that failure would now leave the event with no cell.
  const offTheGlobe = (v: unknown, limit: number): boolean =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > limit;
  if (offTheGlobe(body.lat, 90) || offTheGlobe(body.lon, 180)) {
    return errorResponse(
      'INVALID_COORDINATES',
      'lat must be between -90 and 90, and lon between -180 and 180',
      400,
      rid
    );
  }
  if ('lat' in body) {
    const v = body.lat;
    if (v === null || (typeof v === 'number' && Number.isFinite(v))) {
      sets.push('lat = ?');
      values.push(v === null ? null : (v as number));
      geoUpdated = true;
    }
  }
  if ('lon' in body) {
    const v = body.lon;
    if (v === null || (typeof v === 'number' && Number.isFinite(v))) {
      sets.push('lon = ?');
      values.push(v === null ? null : (v as number));
      geoUpdated = true;
    }
  }
  // OSE-1615: the old cell described the old coordinates, so it goes in this
  // same statement; the cell statement after the save writes the new one. If
  // that statement fails the row has no cell (and so no spine key), never the
  // old cell on the new coordinates.
  if (geoUpdated) sets.push('h3_res9 = NULL', 'h3_res7 = NULL');

  // Owner report 2026-10-11: a changed place (street address or place name)
  // with no coordinates in the same request is looked up again after the save
  // (lib/event-place.ts). The old point described the old place, so it goes
  // first, in this same UPDATE: a lookup that then fails leaves no point, never
  // a wrong one. Text that did not change does not cost a lookup.
  let placeChanged = false;
  let newPlace: { where_address: unknown; location: unknown } | null = null;
  if (('location' in body || 'where_address' in body) && !geoUpdated) {
    const stored = await env.DB.prepare('SELECT location, where_address FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ location: string | null; where_address: string | null }>();
    if (stored) {
      const pick = (field: 'location' | 'where_address'): unknown =>
        field in body
          ? typeof body[field] === 'string'
            ? (body[field] as string).slice(0, 500)
            : null
          : stored[field];
      newPlace = { where_address: pick('where_address'), location: pick('location') };
      placeChanged =
        eventPlaceText(newPlace.where_address, newPlace.location) !==
        eventPlaceText(stored.where_address, stored.location);
      if (placeChanged) {
        sets.push(
          'lat = NULL',
          'lon = NULL',
          'h3_res9 = NULL',
          'h3_res7 = NULL',
          'place_kind = NULL',
          'place_checked_at = NULL'
        );
      }
    }
  }

  // OSE-664: media reference URLs — validated http(s)-only (born-red XSS wall)
  // rather than blind-sliced, so a javascript:/data: payload is rejected here
  // and never reaches the column. null clears the field. These are proxied
  // server-side, so http(s) is fine (see what_url below for the outbound case).
  for (const field of ['who_image_url', 'what_video_url'] as const) {
    if (field in body) {
      const check = validateLogoUrl(body[field]);
      if (!check.valid) {
        return errorResponse(
          'INVALID_URL',
          `${field} must be a http(s) URL under 500 chars`,
          400,
          rid
        );
      }
      sets.push(`${field} = ?`);
      values.push(check.url);
    }
  }

  // what_url — the public OUTBOUND link, HTTPS-ONLY (the visitor's browser
  // follows it; plain http:// is a downgrade risk). Same null-clears semantics.
  if ('what_url' in body) {
    const check = validateHttpsUrl(body.what_url);
    if (!check.valid) {
      return errorResponse(
        'INVALID_URL',
        'what_url must be an https:// URL under 500 chars',
        400,
        rid
      );
    }
    sets.push('what_url = ?');
    values.push(check.url);
  }

  // R3 (OSE-1319) — typed external-link controls. Mirrors handleCreateEvent:
  // what_url_enabled is a boolean→0/1 gate; what_url_type is an allowlisted
  // enum (strict-in, 400 on an unknown value). Both use the "only when present
  // in the body" semantics so a partial update never clobbers them.
  if ('what_url_enabled' in body) {
    sets.push('what_url_enabled = ?');
    values.push(body.what_url_enabled === true || body.what_url_enabled === 1 ? 1 : 0);
  }
  if ('what_url_type' in body) {
    const raw = body.what_url_type;
    if (raw != null && raw !== '' && !isValidWhatUrlType(raw)) {
      return errorResponse(
        'INVALID_WHAT_URL_TYPE',
        `what_url_type must be one of: ${WHAT_URL_TYPES.join(', ')}`,
        400,
        rid
      );
    }
    sets.push('what_url_type = ?');
    values.push(raw != null && raw !== '' ? String(raw).slice(0, 32) : null);
  }

  // OSE-1313 — keep starts_at (the canonical UTC instant) in step with the
  // wall-clock inputs. A partial patch fills whatever the client didn't send
  // from the stored row; when only the date or zone moves, the stored wall time
  // (starts_at read back in the OLD zone) is carried over so the event keeps its
  // time-of-day. start_time: null clears it → date-only event (starts_at NULL).
  // starts_at is always server-computed; a client-supplied value is ignored.
  // Optimistic-concurrency guard for the starts_at recompute below: the UPDATE
  // only applies if the wall-clock fields it was computed from are unchanged,
  // so two concurrent partial edits cannot pair one request's start_date with a
  // starts_at derived from the other's (PR #657 review).
  let timeGuard: {
    start_date: string | null;
    timezone: string | null;
    starts_at: string | null;
  } | null = null;
  if ('start_time' in body || 'start_date' in body || 'timezone' in body) {
    // The zone cannot be cleared: starts_at is always computed in a concrete
    // zone, and a NULL column would make every surface render in UTC instead.
    if ('timezone' in body) {
      if (
        typeof body.timezone !== 'string' ||
        body.timezone.length > 50 ||
        !isValidIanaTimezone(body.timezone)
      ) {
        return errorResponse(
          'INVALID_TIMEZONE',
          'timezone must be a valid IANA zone (it cannot be cleared)',
          400,
          rid
        );
      }
    }
    if ('start_time' in body && body.start_time !== null && typeof body.start_time !== 'string') {
      return errorResponse('INVALID_TIME', 'start_time must be HH:MM (24h)', 400, rid);
    }
    const existing = await env.DB.prepare(
      'SELECT start_date, timezone, starts_at FROM events WHERE id = ?'
    )
      .bind(eventId)
      .first<{ start_date: string | null; timezone: string | null; starts_at: string | null }>();
    if (existing) {
      timeGuard = existing;
      const tz =
        typeof body.timezone === 'string'
          ? body.timezone.slice(0, 50)
          : (existing.timezone ?? 'America/Chicago');
      const date =
        'start_date' in body
          ? typeof body.start_date === 'string'
            ? body.start_date.slice(0, 10)
            : null
          : (existing.start_date?.slice(0, 10) ?? null);
      const time =
        'start_time' in body
          ? typeof body.start_time === 'string'
            ? body.start_time
            : null
          : zonedTimePart(existing.starts_at, existing.timezone) || null;

      let startsAt: string | null = null;
      if (time !== null) {
        if (date === null) {
          if (typeof body.start_time === 'string') {
            return errorResponse('INVALID_TIME', 'start_time requires start_date', 400, rid);
          }
          // Date cleared on a timed event → it is no longer anchored; drop the instant.
        } else {
          startsAt = zonedDateTimeToUtcIso(date, time, tz);
          if (startsAt === null) {
            return errorResponse(
              'INVALID_TIME',
              'start_time must be HH:MM (24h) and exist on that date in the timezone',
              400,
              rid
            );
          }
        }
      }
      sets.push('starts_at = ?');
      values.push(startsAt);
    }
  }

  if (sets.length === 0) {
    return errorResponse('NO_FIELDS', 'No valid fields to update', 400, rid);
  }

  // CCR-PR567 re-run item 2 — keep qr_verified in lockstep with the lifecycle.
  // verify-qr / unverify-qr couple qr_verified to status, but PUT status is a
  // second door into `active` (archived → active, the L1 "Go live again" edge)
  // and out of it (active → ready/archived). A bare status UPDATE left qr_verified
  // stale, so an event could be `active` with qr_verified=0, or `ready` with
  // qr_verified=1. Couple it here too — ONLY on an explicit lifecycle move (a
  // field-only PUT never touches it) — so the invariant `active ⟺ qr_verified=1`
  // holds no matter which door is used. (Invalid transitions still 409 below,
  // before the UPDATE runs, so this push is discarded on a rejected move.)
  if (typeof body.status === 'string') {
    sets.push('qr_verified = ?');
    values.push(body.status === 'active' ? 1 : 0);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(eventId);

  // OSE-1615: whether this PUT changes anything a spine key is computed from.
  // New coordinates count: they drop the cell above.
  const spineKeysStale = touchesSpineKeyInputs(sets);

  // Set only when this PUT moves the event into or out of active.
  let listedFrom: string | null | undefined;
  // The status this PUT read before deciding; the UPDATE only lands if the row
  // still has it, so a concurrent Undo can never be reversed (with no grace).
  let observedStatus: string | undefined;

  try {
    // Status changes go through the state machine — the same VALID_TRANSITIONS
    // verify-qr / unverify-qr already enforce. Before this, `PUT status` was a
    // second door that let any state jump to any other (draft → active with no
    // ready step, archived → active with no re-check), so the machine held only
    // on the paths that happened to use the dedicated endpoints. A same-state
    // write (draft → draft) is a no-op, not a violation. Returning 409 with
    // from/to matches qr-verify's envelope so the admin UI has one shape to read.
    //
    // A PUT that explicitly sends a NON-string status (e.g. { status: null }) must
    // not slip past the state machine — reject it, don't silently ignore it
    // (CCR-PR567 re-run item 9). An ABSENT status key is fine: a field-only update
    // never touches the lifecycle.
    if ('status' in body && typeof body.status !== 'string') {
      return errorResponse('INVALID_STATUS', 'status must be an event-state string', 400, rid);
    }
    if (typeof body.status === 'string') {
      const current = await env.DB.prepare(
        'SELECT status, starts_at, event_type_id FROM events WHERE id = ?'
      )
        .bind(eventId)
        .first<{ status: string; starts_at: string | null; event_type_id: string | null }>();
      if (!current) {
        return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404, rid);
      }
      observedStatus = current.status;
      const from = parseEventState(current.status);
      const to = body.status as EventState;
      if (from !== to && !isValidTransition(from, to)) {
        return Response.json(
          {
            ok: false,
            status: 409,
            code: 'INVALID_TRANSITION',
            from,
            to,
            allowed: getAllowedTransitions(from),
            error: `Cannot move an event from ${from} to ${to}`,
            requestId: rid,
          },
          { status: 409, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
        );
      }
      // OSE-1560 � leaving draft (or coming back from archived) needs a start
      // time and an event type. The same check runs in verify-qr. Read against
      // what THIS request sets, so one PUT may supply the values and move on.
      if (isPublishStep(from, to)) {
        const missing = coreValuesMissing(current, {
          ...('start_time' in body ? { start_time: body.start_time } : {}),
          ...('event_type_id' in body ? { event_type_id: body.event_type_id } : {}),
        });
        if (missing.length > 0) {
          logCoreValuesRefused('put_status', from, to, missing);
          return Response.json(coreValuesRefusal(missing, rid), {
            status: 409,
            headers: { ...corsHeaders(request), 'X-Request-Id': rid },
          });
        }
      }
      // Publish grace window (lib/publish-grace.ts). A move INTO active starts
      // it; a move out clears it. active → active (a no-op) leaves it alone, so
      // re-saving a settled event never takes it off the list. values ends with
      // the WHERE id here, so the new SET value goes just before it.
      if (from !== to && (to === 'active' || from === 'active')) {
        listedFrom = to === 'active' ? listedFromForPublish(env.PUBLISH_GRACE_MINUTES) : null;
        sets.push('listed_from = ?');
        values.splice(values.length - 1, 0, listedFrom);
      }
    }

    // Turning listing on for an event that is ALREADY live is a publication
    // too: start a fresh grace window, so it is not listed at once and the
    // corridor latch's 24-hour settling counts from now. Decided inside the
    // UPDATE from the row's own old values (SQLite evaluates SET expressions
    // against the pre-update row), so a concurrent change cannot race it.
    if (listingOn && listedFrom === undefined) {
      sets.push(
        "listed_from = CASE WHEN is_published = 0 AND status = 'active' THEN ? ELSE listed_from END"
      );
      values.splice(values.length - 1, 0, listedFromForPublish(env.PUBLISH_GRACE_MINUTES));
    }

    // OSE-1615: an edit to anything a spine key is computed from clears both
    // keys in this same statement; they are computed again once it has landed.
    if (spineKeysStale) sets.push(SPINE_KEYS_CLEAR_SQL);

    let where = ' WHERE id = ?';
    if (observedStatus !== undefined) {
      where += ' AND status = ?';
      values.push(observedStatus);
    }
    if (timeGuard) {
      // SQLite `IS` compares NULL as a value, so a date-only row guards too.
      where += ' AND start_date IS ? AND timezone IS ? AND starts_at IS ?';
      values.push(timeGuard.start_date, timeGuard.timezone, timeGuard.starts_at);
    }
    const result = await env.DB.prepare('UPDATE events SET ' + sets.join(', ') + where)
      .bind(...values)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      if (observedStatus !== undefined) {
        const now = await env.DB.prepare('SELECT status FROM events WHERE id = ?')
          .bind(eventId)
          .first<{ status: string }>();
        if (now && now.status !== observedStatus) {
          // Someone else moved it (Undo in another tab) between our read and write.
          return errorResponse(
            'STATUS_CONFLICT',
            'This event changed while saving — reload and try again',
            409,
            rid
          );
        }
      }
      if (timeGuard) {
        const still = await env.DB.prepare('SELECT id FROM events WHERE id = ?')
          .bind(eventId)
          .first<{ id: string }>();
        if (still) {
          // The row's date/zone/time moved between our read and this write.
          return errorResponse(
            'EVENT_TIME_CONFLICT',
            'The event time changed while this edit was being saved — reload and try again',
            409,
            rid
          );
        }
      }
      // The transition guard above reads the row first, so a no-op UPDATE here
      // is a genuine miss, not a refused transition.
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404, rid);
    }

    // OSE-1900: the UPDATE landed, so the switch has changed. Its audit row is
    // written here, before the steps below, so a later failure (the cell
    // recompute, the place lookup) cannot leave a changed switch with no row.
    // A refused write (400, 404, 409) returned above and wrote nothing.
    if (useSponsorsWrite !== undefined) {
      await recordSponsorsSwitch(request, env, eventId, useSponsorsWrite, rid);
    }

    // OSE-489: if lat or lon changed, re-fetch merged coords and recompute H3.
    // Two-step avoids a read-modify-write race on partial coord updates.
    if (geoUpdated) {
      const geo = await env.DB.prepare('SELECT lat, lon FROM events WHERE id = ?')
        .bind(eventId)
        .first<{ lat: number | null; lon: number | null }>();
      const tags = maybeTag(geo?.lat ?? null, geo?.lon ?? null);
      await env.DB.prepare(
        'UPDATE events SET h3_res9 = ?, h3_res7 = ?, venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?'
      )
        .bind(tags?.h3_res9 ?? null, tags?.h3_res7 ?? null, eventId)
        .run();
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleUpdateEvent',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to update event', 503, rid);
  }

  // The place changed: look it up now that the save has landed. A failure
  // here is not a failed save; the nightly job tries again.
  let place: PlaceState | undefined;
  if (placeChanged && newPlace) {
    place = 'not_looked_up';
    try {
      const r = await lookUpEventPlace(env, newPlace.where_address, newPlace.location);
      await savePlaceLookup(env.DB, eventId, r);
      place = placeState(r);
    } catch (err) {
      console.warn(
        JSON.stringify({
          type: 'EVENT_PLACE_LOOKUP_FAILED',
          eventId,
          error: errorLabel(err),
          timestamp: new Date().toISOString(),
        })
      );
    }
  }

  if (spineKeysStale) await refreshSpineKeys(env.DB, eventId);

  return Response.json(
    {
      ok: true,
      status: 200,
      id: eventId,
      ...(useSponsorsWrite !== undefined ? { sponsors: { on: useSponsorsWrite } } : {}),
      ...(place !== undefined ? { place } : {}),
      // A status write says the status it moved FROM (the one the guarded
      // UPDATE matched), so the admin's Undo returns there even when its own
      // panel was showing an older status.
      ...(observedStatus !== undefined ? { from: observedStatus } : {}),
      ...(listedFrom !== undefined ? { listedFrom } : {}),
      ...(mapChosenNow !== null ? { map: mapState(mapChosenNow, false) } : {}),
    },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

/**
 * DELETE /api/v2/admin/events/:id — hard-delete one event (admin, auth-gated).
 *
 * WHY THIS EXISTS (OSE-982): the router had no DELETE for events — only
 * `PUT status='archived'`. Two concrete gaps this closes:
 *   1. FE fat-finger. An admin creates an event by mistake and needs it GONE,
 *      not archived-and-lingering in the admin list.
 *   2. DB hygiene. The T4 cross-brand-isolation E2E seeds throwaway `isoltest-*`
 *      events every deploy; with no delete route its afterEach cleanup matched
 *      no route and was silently swallowed — a permanent no-op — so staging
 *      accumulated orphan rows forever. A real endpoint lets that cleanup work.
 *
 * WHY HARD, not soft: the sponsor soft-delete (`is_active=0`) exists because a
 * sponsor is a BORROWED, shared identity referenced by many events (rule 7) —
 * there, hiding beats deleting. An event is a singular ROOT entity owned by one
 * brand; a soft flag would leave the isoltest-* rows accumulating (just
 * invisible), which is exactly what "take care of the db rows" asks us NOT to
 * do. So we remove the row. `archived` (via PUT) stays the path for real,
 * intentionally-kept events.
 *
 * SAFETY GUARD: D1 DOES enforce the events FK children here, so two things are
 * true. (1) We refuse (409 EVENT_HAS_ACTIVITY) if the event has any recorded
 * scans or sponsor impressions — the "met reality" signals; a real event that
 * has been scanned/seen must be archived, never nuked. (2) Even a clean event
 * has children: OSE-240 auto-creates a `shortlinks` row for every event, and an
 * admin may have attached poster deployments or sponsor placements. A bare
 * `DELETE FROM events` would FK-fail on those, so we cascade the event's owned
 * (derived/config) rows children-first in one atomic batch, then the row. The
 * activity guard guarantees the value-bearing tables are already empty, so the
 * cascade only ever clears derived rows. Fat-finger events and isoltest-*
 * orphans have zero activity and delete cleanly.
 *
 * Not handled (rare, deliberately): an event acting as a `venue_id` for an
 * event_series / anon_id_returns row will FK-block the final DELETE (503) —
 * you should not silently destroy a venue other rows point at; archive it.
 *
 * Scope note: like the sibling PUT, this is id-only (no brand-scope clause in
 * the mutation). Object-level owner/brand scoping on admin mutate paths is the
 * separate workstream tracked in OSE-1080 — kept in lockstep with PUT here on
 * purpose rather than diverging one destructive route ahead of it.
 */
export async function handleDeleteEvent(
  request: Request,
  env: EventsEnv,
  eventId: string
): Promise<Response> {
  const rid = requestId();

  if (!env.DB) {
    return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);
  }

  try {
    // Existence check first, so a missing id is an honest 404 rather than a
    // silent 0-row DELETE that would report success and mask a bad id.
    const existing = await env.DB.prepare('SELECT id FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ id: string }>();
    if (!existing) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404, rid);
    }

    // Guard: never hard-delete an event that has already met reality. `scans`
    // was split (OSE-798) into a placement side and a session/return side;
    // `sponsor_displays` is the sponsor-visibility ledger. Any of them being
    // non-empty means real, value-bearing rows hang off this event — refuse and
    // let the operator archive (PUT status=archived) instead of destroying data.
    const dep = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM scan_node_returns     WHERE event_id = ?) +
         (SELECT COUNT(*) FROM scan_placement_events WHERE event_id = ?) +
         (SELECT COUNT(*) FROM sponsor_displays   WHERE event_id = ?) AS n`
    )
      .bind(eventId, eventId, eventId)
      .first<{ n: number }>();
    if ((dep?.n ?? 0) > 0) {
      return errorResponse(
        'EVENT_HAS_ACTIVITY',
        'Event has recorded scans or sponsor impressions; archive it (PUT status=archived) instead of deleting',
        409,
        rid
      );
    }

    // FK-safe cascade. D1 enforces the foreign keys on the child tables, so the
    // event row cannot be removed while any child references it. Delete the
    // event's owned rows children-first, in one atomic batch, then the row. The
    // guard above guarantees scan_*/sponsor_displays are empty, so in
    // practice this clears only derived/config rows (the OSE-240 shortlink, and
    // any poster deployments / sponsor placements an admin attached).
    // The current child tables carrying an event_id FK into events(id), ordered
    // children-first so each delete satisfies the FK on the next. (The scan_* and
    // sponsor_displays rows are already empty per the guard above; they stay
    // in the list so the cascade is FK-complete on its own terms and survives a
    // future guard change. scan_placement_events precedes poster_deployments
    // because it also FKs poster_deployments.)
    const delChild = (sql: string) => env.DB!.prepare(sql).bind(eventId);
    await env.DB.batch([
      delChild('DELETE FROM scan_placement_events WHERE event_id = ?'),
      delChild('DELETE FROM scan_node_returns     WHERE event_id = ?'),
      delChild('DELETE FROM scan_aggregates       WHERE event_id = ?'),
      delChild('DELETE FROM scan_cell_aggregates  WHERE event_id = ?'),
      delChild('DELETE FROM sponsor_displays   WHERE event_id = ?'),
      delChild('DELETE FROM sponsor_placement     WHERE event_id = ?'),
      delChild('DELETE FROM poster_deployments    WHERE event_id = ?'),
      delChild('DELETE FROM shortlinks            WHERE event_id = ?'),
      delChild('DELETE FROM event_codes           WHERE event_id = ?'),
      delChild('DELETE FROM share_opens_daily     WHERE event_id = ?'),
      env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId),
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleDeleteEvent',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to delete event', 503, rid);
  }

  return Response.json(
    { ok: true, status: 200, id: eventId, deleted: true },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

/**
 * GET /api/v2/admin/event-templates — list the seeded event templates (admin).
 *
 * OSE-868: migration 0015 seeds the event templates (incl. their `default_sections`
 * payload) but no route ever exposed them, so the launch wizard's template picker
 * had nothing to read and fell back to a hardcoded list. This is the read seam —
 * the picker populates from here (the FE↔DB join), and a selection sets
 * `events.template_id` through the existing create/update path. Slug is never
 * touched by template selection (Invariant #18 slug_permanence).
 *
 * Templates are BREADTH, not access (ADR-010): they carry cosmetic/structural
 * defaults and never gate features — the tier system does that independently — so
 * we return every seeded row, ordered by category then display_order so the picker
 * renders under category headings rather than one flat list. The three JSON columns
 * (default_sections / default_ctas / default_ui_presets) are parsed to objects so
 * the FE consumes structure, not strings; a single malformed row degrades to that
 * column's default instead of 500-ing the whole list.
 */
export async function handleAdminListEventTemplates(
  request: Request,
  env: EventsEnv
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);
  }

  const parseJson = <T>(raw: unknown, fallback: T): T => {
    if (typeof raw !== 'string') return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, description, category, icon, display_order, stage,
              default_sections, default_ctas, default_ui_presets, example_name,
              max_clearance_tier
         FROM event_templates
        ORDER BY category ASC, display_order ASC, id ASC`
    ).all<Record<string, unknown>>();

    const items = (results ?? []).map((row) => ({
      ...row,
      // default_sections is the payload the picker + gates depend on — always an
      // object in the response even if the row stored a malformed string.
      default_sections: parseJson(row.default_sections, {} as Record<string, unknown>),
      default_ctas: parseJson(row.default_ctas, [] as unknown[]),
      default_ui_presets: parseJson(row.default_ui_presets, {} as Record<string, unknown>),
    }));

    return Response.json(
      { ok: true, items },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminListEventTemplates',
        error: errorLabel(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to list event templates', 503, rid);
  }
}

/**
 * GET /api/v2/admin/event-types — OSE-1344: the Category → Type catalog that
 * feeds the Create Event picker ("Sports > Bocce"). Read-only, admin-gated,
 * no audit (same posture as event-templates). Grouping lives in
 * lib/event-type-catalog.ts; an unmapped type is grouped under "Other", never
 * dropped, and the response says how many such orphans exist so a seed
 * mistake is visible in the envelope.
 */
export async function handleAdminListEventTypes(
  request: Request,
  env: EventsEnv
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);
  }
  try {
    const catalog = await readEventTypeCatalog(env.DB);
    return Response.json(
      { ok: true, ...catalog },
      {
        headers: {
          ...corsHeaders(request),
          'X-Request-Id': rid,
          'Cache-Control': 'private, max-age=300',
        },
      }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminListEventTypes',
        error: errorLabel(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to list event types', 503, rid);
  }
}

/**
 * POST /api/v2/admin/events/backfill-h3-cells
 *
 * OSE-489 one-shot backfill: computes h3_res9/h3_res7 for existing events
 * that have lat/lon but no H3 cells. Safe to run multiple times — only
 * processes rows where h3_res9 IS NULL.
 */
export async function handleBackfillH3Cells(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();

  if (!env.DB) {
    return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);
  }

  const { results } = await env.DB.prepare(
    'SELECT id, lat, lon FROM events WHERE lat IS NOT NULL AND lon IS NOT NULL AND h3_res9 IS NULL'
  ).all<{ id: string; lat: number; lon: number }>();

  let updated = 0;
  const errors: string[] = [];

  for (const row of results ?? []) {
    try {
      const tags = maybeTag(row.lat, row.lon);
      if (tags) {
        await env.DB.prepare(
          'UPDATE events SET h3_res9 = ?, h3_res7 = ?, venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?'
        )
          .bind(tags.h3_res9, tags.h3_res7, row.id)
          .run();
        await refreshSpineKeys(env.DB, row.id);
        updated++;
      }
    } catch (err) {
      errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return Response.json(
    { ok: true, status: 200, updated, skipped: errors.length, errors },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}
