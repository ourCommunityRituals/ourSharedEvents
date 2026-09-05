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

import { corsHeaders } from '../lib/cors';
import { assertRenderable, VALID_EVENT_STATES, parseEventState } from '../domain/event-state';
import { enrichWithPhase } from '../lib/event-enrich.js';
import { createShortlink } from '../lib/shortlinks';
import { maybeTag } from '../lib/h3-tagging';
import { getDataProvider, type DataProviderEnv } from '../lib/data-provider.js';
import type { DataProviderCtx } from '@ocr/data-provider';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import { validateLogoUrl } from '../lib/sponsor-logo';

// ─── Phase enrichment ──────────────────────────────────────────────────────────
//
// Moved to `lib/event-enrich.ts` by OSE-1243, when the server-rendered public
// page became a second consumer that reads the DataProvider directly. It stays
// one function so surfaces cannot re-derive phase or field names locally.

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EventsEnv extends DataProviderEnv, AdminEnv, AdminBrandScopeEnv {
  WORKER_ENV?: string;
  DB?: D1Database;
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
    { status }
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
    const items = result.data.map((e: unknown) => enrichWithPhase(e as Record<string, unknown>));
    return Response.json(
      { ok: true, status: 200, items },
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
        error: err instanceof Error ? err.message : String(err),
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
      { ok: true, status: 200, item: enrichWithPhase(row) },
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
        error: err instanceof Error ? err.message : String(err),
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
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') {
    return Response.json(
      { ok: true, items: [], pagination: { limit, hasMore: false, nextCursor: null } },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  }

  try {
    const EVENT_SELECT_COLS =
      'id, brand_id, title, slug, status, description, location,' +
      ' start_date, end_date, timezone, cover_image_url, created_at, updated_at,' +
      ' legal_clearance_tier,' +
      ' what_short, who_host, why_purpose, how_details, where_address,' +
      ' who_story, who_image_url, what_video_url,' +
      ' lat, lon, corridor_id, h3_res9, h3_res7';

    // WHERE is composed from server-derived scope + the opaque cursor only.
    const whereParts: string[] = [];
    const bindings: (string | number)[] = [];
    if (cursor) {
      whereParts.push('created_at < ?');
      bindings.push(cursor);
    }
    if (scope.mode === 'scoped') {
      const placeholders = scope.brandIds.map(() => '?').join(', ');
      whereParts.push(`brand_id IN (${placeholders})`);
      bindings.push(...scope.brandIds);
    }
    bindings.push(limit + 1);
    const whereClause = whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : '';
    const adminListSql =
      'SELECT ' +
      EVENT_SELECT_COLS +
      ' FROM events' +
      whereClause +
      ' ORDER BY created_at DESC LIMIT ?';

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
    const nextCursor =
      hasMore && page.length > 0 ? ((page[page.length - 1].created_at as string) ?? null) : null;

    return Response.json(
      {
        ok: true,
        items,
        pagination: { limit, hasMore, nextCursor },
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
        error: err instanceof Error ? err.message : String(err),
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
  return !isNaN(parsed.getTime());
}

function isValidContentType(request: Request): boolean {
  const ct = request.headers.get('content-type') || '';
  return ct.includes('application/json');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
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

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (!title) {
    return errorResponse('MISSING_FIELD', 'Missing required field: title', 400, rid);
  }

  // Brand validation
  const brandId = typeof body.brand_id === 'string' ? body.brand_id.slice(0, 64) : 'root';
  if (!isValidBrand(brandId)) {
    return errorResponse(
      'INVALID_BRAND',
      'brand_id must be lowercase alphanumeric, hyphens, or underscores (1-64 chars)',
      400,
      rid
    );
  }

  const id = `evt_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 100) : slugify(title);
  const status =
    typeof body.status === 'string' &&
    (VALID_EVENT_STATES as readonly string[]).includes(body.status)
      ? body.status
      : 'draft';
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
  const whoImageUrl = whoImage.url;
  const whatVideoUrl = whatVideo.url;

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
  const coverImageUrl =
    typeof body.cover_image_url === 'string' ? body.cover_image_url.slice(0, 500) : null;
  const templateId = typeof body.template_id === 'string' ? body.template_id.slice(0, 64) : null;

  // OSE-489: capture-time H3 tagging — computation happens here (admin create),
  // never in the scan/read hot path.
  const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
  const lon = typeof body.lon === 'number' && Number.isFinite(body.lon) ? body.lon : null;
  const h3Tags = maybeTag(lat, lon);

  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, description, location, start_date, end_date, timezone, cover_image_url, template_id,
                           what_short, who_host, why_purpose, how_details, where_address,
                           who_story, who_image_url, what_video_url,
                           lat, lon, h3_res9, h3_res7,
                           created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        lat,
        lon,
        h3Tags?.h3_res9 ?? null,
        h3Tags?.h3_res7 ?? null,
        now,
        now
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint')) {
      return errorResponse('SLUG_TAKEN', `Slug "${slug}" is already in use`, 409, rid);
    }
    console.error(
      JSON.stringify({ type: 'DB_ERROR', handler: 'handleCreateEvent', error: msg, timestamp: now })
    );
    return errorResponse('DB_ERROR', 'Failed to create event', 503, rid);
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
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        type: 'SHORTLINK_CREATE_FAILED',
        eventId: id,
        error: message,
        timestamp: new Date().toISOString(),
      })
    );
    warnings.push({
      code: 'SHORTLINK_CREATE_FAILED',
      message:
        'Shortlink generation failed; the event was created but no shareable code was assigned. Retry the create or generate a shortlink manually.',
    });
  }

  return Response.json(
    { ok: true, status: 201, id, slug, shortcode, warnings },
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
    cover_image_url: { max: 500 },
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

  // OSE-489: lat/lon are REAL columns — handle separately from string allowedFields.
  let geoUpdated = false;
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

  // OSE-664: media reference URLs — validated http(s)-only (born-red XSS wall)
  // rather than blind-sliced, so a javascript:/data: payload is rejected here
  // and never reaches the column. null clears the field.
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

  if (sets.length === 0) {
    return errorResponse('NO_FIELDS', 'No valid fields to update', 400, rid);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(eventId);

  try {
    const result = await env.DB.prepare('UPDATE events SET ' + sets.join(', ') + ' WHERE id = ?')
      .bind(...values)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404, rid);
    }

    // OSE-489: if lat or lon changed, re-fetch merged coords and recompute H3.
    // Two-step avoids a read-modify-write race on partial coord updates.
    if (geoUpdated) {
      const geo = await env.DB.prepare('SELECT lat, lon FROM events WHERE id = ?')
        .bind(eventId)
        .first<{ lat: number | null; lon: number | null }>();
      const tags = maybeTag(geo?.lat ?? null, geo?.lon ?? null);
      await env.DB.prepare('UPDATE events SET h3_res9 = ?, h3_res7 = ? WHERE id = ?')
        .bind(tags?.h3_res9 ?? null, tags?.h3_res7 ?? null, eventId)
        .run();
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleUpdateEvent',
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to update event', 503, rid);
  }

  return Response.json(
    { ok: true, status: 200, id: eventId },
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
    // `sponsor_impressions` is the sponsor-visibility ledger. Any of them being
    // non-empty means real, value-bearing rows hang off this event — refuse and
    // let the operator archive (PUT status=archived) instead of destroying data.
    const dep = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM scan_node_returns     WHERE event_id = ?) +
         (SELECT COUNT(*) FROM scan_placement_events WHERE event_id = ?) +
         (SELECT COUNT(*) FROM sponsor_impressions   WHERE event_id = ?) AS n`
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
    // guard above guarantees scan_*/sponsor_impressions are empty, so in
    // practice this clears only derived/config rows (the OSE-240 shortlink, and
    // any poster deployments / sponsor placements an admin attached).
    // The current child tables carrying an event_id FK into events(id), ordered
    // children-first so each delete satisfies the FK on the next. (The scan_* and
    // sponsor_impressions rows are already empty per the guard above; they stay
    // in the list so the cascade is FK-complete on its own terms and survives a
    // future guard change. scan_placement_events precedes poster_deployments
    // because it also FKs poster_deployments.)
    const delChild = (sql: string) => env.DB!.prepare(sql).bind(eventId);
    await env.DB.batch([
      delChild('DELETE FROM scan_placement_events WHERE event_id = ?'),
      delChild('DELETE FROM scan_node_returns     WHERE event_id = ?'),
      delChild('DELETE FROM scan_aggregates       WHERE event_id = ?'),
      delChild('DELETE FROM sponsor_impressions   WHERE event_id = ?'),
      delChild('DELETE FROM sponsor_placement     WHERE event_id = ?'),
      delChild('DELETE FROM poster_deployments    WHERE event_id = ?'),
      delChild('DELETE FROM shortlinks            WHERE event_id = ?'),
      env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId),
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleDeleteEvent',
        error: err instanceof Error ? err.message : String(err),
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
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to list event templates', 503, rid);
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
        await env.DB.prepare('UPDATE events SET h3_res9 = ?, h3_res7 = ? WHERE id = ?')
          .bind(tags.h3_res9, tags.h3_res7, row.id)
          .run();
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
