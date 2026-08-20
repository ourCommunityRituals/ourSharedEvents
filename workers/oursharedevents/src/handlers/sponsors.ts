/**
 * Sponsors API handler.
 *
 * Admin CRUD (auth-gated):
 *   GET    /api/v2/admin/sponsors              – list all sponsors
 *   GET    /api/v2/admin/sponsors/:id          – get sponsor by ID
 *   POST   /api/v2/admin/sponsors              – create sponsor
 *   PUT    /api/v2/admin/sponsors/:id          – update sponsor
 *   DELETE /api/v2/admin/sponsors/:id          – soft delete (is_active=0)
 *   PUT    /api/v2/admin/sponsors/:id/event-types  – set event type associations
 *   GET    /api/v2/admin/sponsors/:id/event-types  – get event type associations
 *   PUT    /api/v2/admin/sponsors/:id/areas    – set service areas
 *   GET    /api/v2/admin/sponsors/:id/areas    – get service areas
 *
 * Public (no auth):
 *   GET    /api/v2/events/:id/sponsors         – resolved sponsors for event
 *   GET    /api/v2/events/:id/sponsor-bundle   – sponsor bundle with surface filtering
 *   POST   /api/v2/events/:id/sponsors/:sid/impression – log impression
 *   POST   /api/v2/events/:id/sponsors/:sid/click      – log click
 *
 * Public (no auth):
 *   GET    /api/v2/sponsors/:id/logo         – proxy + validate external logo (OSE-288)
 *
 * Data source: D1 database (DB binding)
 */

import { corsHeaders } from '../lib/cors';
import {
  filterSponsorsForSurface,
  buildSponsorBundle,
  type Surface,
} from '../lib/sponsor-resolver';
import { validateLogoUrl, fetchAndProxyLogo } from '../lib/sponsor-logo';
import { getDataProvider, type DataProviderEnv } from '../lib/data-provider.js';
import type { DataProviderCtx } from '@ocr/data-provider';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
// NOTE: maybeTag is imported here because sponsors.ts is an admin/creation-time
// handler — NOT a scan-path handler. The hot-path invariant (S-6.3.1c) permits
// this import. Do NOT add sponsors.ts to the SCAN_PATH list in h3-tagging.spec.ts.
import { maybeTag } from '../lib/h3-tagging';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SponsorsEnv extends DataProviderEnv, AdminBrandScopeEnv, AdminEnv {
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

function generateId(prefix = 'sp'): string {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────────

const MAX_BODY = 16 * 1024;
const VALID_TIERS = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'] as const;
const VALID_SURFACES: Surface[] = ['poster', 'display', 'public', 'sharedReport'];

// OSE-670 (#25): the uniform, non-purchasable placement value. Every sponsor is
// eligible for every surface — only rotation frequency (share) is purchasable.
// The resolver ignores placement_formats entirely (buildShareRotation); this is
// stored only so legacy readers see "eligible everywhere", never a named slot.
const UNIFORM_PLACEMENT_FORMATS =
  '{"posterTop":true,"tvTop":true,"tvSide":true,"mobileBanner":true}';

function isValidContentType(request: Request): boolean {
  const ct = request.headers.get('content-type') || '';
  return ct.includes('application/json');
}

async function parseBody(
  request: Request,
  rid: string
): Promise<Record<string, unknown> | Response> {
  if (!isValidContentType(request)) {
    return errorResponse('BAD_CONTENT_TYPE', 'Content-Type must be application/json', 400, rid);
  }
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) {
      return errorResponse('PAYLOAD_TOO_LARGE', 'Body must be under 16KB', 400, rid);
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400, rid);
  }
}

// ─── Admin: List Sponsors ───────────────────────────────────────────────────────

export async function handleAdminListSponsors(
  request: Request,
  env: SponsorsEnv
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  }

  // OSE — Sponsor card event-scoping. On a shared/multi-tenant instance an
  // unscoped list lets an organizer see (and mis-edit/deactivate) another
  // organizer's sponsor. Scope is enforced HERE in the SQL WHERE clause with a
  // bound parameter — never client-side .filter() — so no query string can
  // widen it.
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const brandId = url.searchParams.get('brand_id');

  // OSE-674 (#9 tenant_isolation) — the cross-event manager view keys off a
  // client ?brand_id=, which is caller-CHOSEN scope, not authorized scope. The
  // SQL WHERE being server-side does NOT make the scope authorized. Derive the
  // caller's real brand membership from the SERVER-VERIFIED actor (OSE-666/B2)
  // and INTERSECT: a forged brand_id outside the caller's membership is 403, an
  // unscopable caller gets zero rows, and the server scope also caps the final
  // set so a forged ?eventId= from another tenant can never widen it. Mirrors
  // handleAdminListEvents — the canonical #9 enforcement point.
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') {
    return Response.json(
      { ok: true, status: 200, items: [], scopedTo: eventId ?? null },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  }
  if (scope.mode === 'scoped' && brandId && !scope.brandIds.includes(brandId)) {
    return errorResponse('BRAND_FORBIDDEN', `Not entitled to brand_id "${brandId}"`, 403, rid);
  }

  const cols = `id, event_id, name, logo_url, website_url, tier, placement_formats,
                click_token, display_token, is_active, created_at, updated_at`;
  const where: string[] = [];
  const binds: string[] = [];
  if (eventId) {
    where.push('event_id = ?');
    binds.push(eventId);
  }
  if (brandId) {
    where.push('event_id IN (SELECT id FROM events WHERE brand_id = ?)');
    binds.push(brandId);
  }
  // Server-derived scope cap (intersection): scoped callers only ever reach
  // sponsors whose event belongs to a brand they are a member of. 'all' (CI/
  // automation opt-in) applies no cap.
  if (scope.mode === 'scoped') {
    const ph = scope.brandIds.map(() => '?').join(', ');
    where.push(`event_id IN (SELECT id FROM events WHERE brand_id IN (${ph}))`);
    binds.push(...scope.brandIds);
  }
  const sql =
    `SELECT ${cols} FROM sponsors` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY updated_at DESC`;

  try {
    const result = await env.DB.prepare(sql)
      .bind(...binds)
      .all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [], scopedTo: eventId ?? null },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminListSponsors',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query sponsors', 503, rid);
  }
}

// ─── Per-ID brand-scope guard (OSE-710 / #9 tenant_isolation) ───────────────────
//
// The LIST endpoint (handleAdminListSponsors) enforces #9 in its SQL WHERE, but
// the per-ID GET/PUT/DELETE handlers historically took the :id straight to the
// query with NO scope predicate — so a brand-A operator who knew a brand-B
// sponsor id could read AND mutate it cross-tenant. This helper mirrors the list
// endpoint's server-derived-scope pattern for a single id: it returns a bound
// SQL fragment (+ params) that caps the row to sponsors whose event belongs to a
// brand the SERVER-VERIFIED actor is a member of.
//
//   - mode 'deny'  (anon / unmapped / unscopable): { reachable: false } → the
//                  caller reaches nothing; handlers return 404 (indistinguishable
//                  from "does not exist" — a forged id is never confirmed).
//   - mode 'all'   (CI/automation opt-in): no predicate — the id alone.
//   - mode 'scoped': `event_id IN (SELECT id FROM events WHERE brand_id IN (?..))`
//                  bound-parameterised, never a client-side filter.
type PerIdScope = { reachable: false } | { reachable: true; sql: string; params: string[] };

async function resolvePerIdSponsorScope(request: Request, env: SponsorsEnv): Promise<PerIdScope> {
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') return { reachable: false };
  if (scope.mode === 'all') return { reachable: true, sql: '', params: [] };
  // scoped
  const ph = scope.brandIds.map(() => '?').join(', ');
  return {
    reachable: true,
    sql: ` AND event_id IN (SELECT id FROM events WHERE brand_id IN (${ph}))`,
    params: scope.brandIds,
  };
}

/**
 * OSE-722 (#9): parent-reachability gate for sponsor SUB-resources (event-types,
 * areas). Those tables key off `sponsor_id` and carry no brand column, so we
 * first confirm the PARENT sponsor is inside the caller's authorized brand scope
 * (the same predicate as resolvePerIdSponsorScope). A forged / cross-tenant id is
 * unreachable → the caller gets the same 404 as a non-existent sponsor and never
 * reads or mutates another brand's sub-resources. Sibling fix to OSE-710, which
 * closed the identical hole on the sponsor GET/PUT/DELETE handlers.
 */
async function isSponsorReachable(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<boolean> {
  if (!env.DB) return false;
  const scope = await resolvePerIdSponsorScope(request, env);
  if (!scope.reachable) return false;
  const row = await env.DB.prepare(`SELECT id FROM sponsors WHERE id = ?${scope.sql}`)
    .bind(sponsorId, ...scope.params)
    .first();
  return !!row;
}

// ─── Admin: Get Sponsor ─────────────────────────────────────────────────────────

export async function handleAdminGetSponsor(
  request: Request,
  env: SponsorsEnv,
  id: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('NOT_FOUND', `Sponsor not found: ${id}`, 404, rid);

  // OSE-710 (#9): cap the lookup to the caller's authorized brand scope. A forged
  // id from another tenant collapses to the same NOT_FOUND as a non-existent id.
  const scope = await resolvePerIdSponsorScope(request, env);
  if (!scope.reachable) return errorResponse('NOT_FOUND', `Sponsor not found: ${id}`, 404, rid);

  try {
    const row = await env.DB.prepare(`SELECT * FROM sponsors WHERE id = ?${scope.sql}`)
      .bind(id, ...scope.params)
      .first();
    if (!row) return errorResponse('NOT_FOUND', `Sponsor not found: ${id}`, 404, rid);

    return Response.json(
      { ok: true, status: 200, item: row },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminGetSponsor',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query sponsor', 503, rid);
  }
}

// ─── Admin: Create Sponsor ──────────────────────────────────────────────────────

export async function handleAdminCreateSponsor(
  request: Request,
  env: SponsorsEnv
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  if (!name) return errorResponse('MISSING_FIELD', 'Missing required field: name', 400, rid);

  const eventId = typeof body.event_id === 'string' ? body.event_id.slice(0, 128) : '';
  if (!eventId) return errorResponse('MISSING_FIELD', 'Missing required field: event_id', 400, rid);

  const id = generateId('sp');
  const logoValidation = validateLogoUrl(body.logo_url ?? null);
  if (!logoValidation.valid) {
    return errorResponse(
      'INVALID_LOGO_URL',
      'logo_url must be a valid http:// or https:// URL (max 500 chars)',
      400,
      rid
    );
  }
  const logoUrl = logoValidation.url;
  const websiteUrl = typeof body.website_url === 'string' ? body.website_url.slice(0, 500) : null;
  const tier =
    typeof body.tier === 'string' && (VALID_TIERS as readonly string[]).includes(body.tier)
      ? body.tier
      : 'primary';
  // OSE-670 (#25): placement is UNIFORM and non-purchasable. The client CANNOT
  // choose a named slot — that was the covenant violation (buying a bigger/
  // better slot). Every sponsor is eligible for every surface; the resolver
  // ignores this column (buildShareRotation). Stored as the uniform marker for
  // legacy readers — body.placement_formats is intentionally ignored.
  const placementFormats = UNIFORM_PLACEMENT_FORMATS;
  const clickToken = typeof body.click_token === 'string' ? body.click_token.slice(0, 256) : null;
  const displayToken =
    typeof body.display_token === 'string' ? body.display_token.slice(0, 256) : null;
  const now = new Date().toISOString();

  // ── H3 geo-tagging (opt-in, admin creation path) ─────────────────────────
  const rawLat = body.lat;
  const rawLon = body.lon;
  const hasCoords =
    typeof rawLat === 'number' &&
    typeof rawLon === 'number' &&
    Number.isFinite(rawLat) &&
    Number.isFinite(rawLon);

  if (hasCoords && (rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180)) {
    return errorResponse(
      'INVALID_COORDINATES',
      'lat must be -90..90 and lon must be -180..180',
      400,
      rid
    );
  }

  const sponsorLat = hasCoords ? (rawLat as number) : null;
  const sponsorLon = hasCoords ? (rawLon as number) : null;
  const h3Tags = maybeTag(sponsorLat, sponsorLon);
  const sponsorH3Res9 = h3Tags?.h3_res9 ?? null;
  const sponsorH3Res7 = h3Tags?.h3_res7 ?? null;

  // ── is_local: GEO-DERIVED, non-purchasable (OSE-661 / #25) ────────────────
  // A sponsor is local iff its corridor cell (h3_res7) matches the event's.
  // Derived server-side from geo BEFORE the insert — never from the request
  // body, never admin-set. Requires both the sponsor and the event to carry an
  // h3_res7 (i.e. both geocoded); otherwise the sponsor is not local.
  let eventH3Res7: string | null = null;
  if (sponsorH3Res7 !== null) {
    try {
      const eventRow = await env.DB.prepare('SELECT h3_res7 FROM events WHERE id = ?')
        .bind(eventId)
        .first<{ h3_res7: string | null }>();
      eventH3Res7 = eventRow?.h3_res7 ?? null;
    } catch {
      // Non-fatal: if we cannot read the event cell, treat the sponsor as non-local.
    }
  }
  const isLocal =
    sponsorH3Res7 !== null && eventH3Res7 !== null && sponsorH3Res7 === eventH3Res7 ? 1 : 0;

  try {
    await env.DB.prepare(
      `INSERT INTO sponsors (id, event_id, name, logo_url, website_url, tier, placement_formats, click_token, display_token, is_active, is_local, lat, lon, h3_res9, h3_res7, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        eventId,
        name,
        logoUrl,
        websiteUrl,
        tier,
        placementFormats,
        clickToken,
        displayToken,
        isLocal,
        sponsorLat,
        sponsorLon,
        sponsorH3Res9,
        sponsorH3Res7,
        now,
        now
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ type: 'DB_ERROR', handler: 'handleAdminCreateSponsor', error: msg })
    );
    return errorResponse('DB_ERROR', 'Failed to create sponsor', 503, rid);
  }

  // is_local is now authoritative (geo-derived). is_local_suggested is retained
  // for back-compat and equals is_local.
  const responseBody: Record<string, unknown> = {
    ok: true,
    status: 201,
    id,
    is_local: isLocal === 1,
  };
  if (sponsorH3Res7 !== null && eventH3Res7 !== null) {
    responseBody.is_local_suggested = isLocal === 1;
  }

  return Response.json(responseBody, {
    status: 201,
    headers: { ...corsHeaders(request), 'X-Request-Id': rid },
  });
}

// ─── Admin: Update Sponsor ──────────────────────────────────────────────────────

export async function handleAdminUpdateSponsor(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // OSE-710 (#9): resolve the caller's authorized brand scope up front. A
  // cross-tenant (or anon/unmapped) caller must not be able to mutate a sponsor
  // they cannot see — the scope predicate is appended to the UPDATE's WHERE so a
  // forged id lands zero changes → the same NOT_FOUND as a non-existent id.
  const scope = await resolvePerIdSponsorScope(request, env);
  if (!scope.reachable)
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const allowedFields: Record<string, { max: number }> = {
    name: { max: 200 },
    logo_url: { max: 500 },
    website_url: { max: 500 },
    tier: { max: 20 },
    // OSE-670 (#25): placement_formats is uniform + non-purchasable — deliberately
    // NOT an updatable field, so no client can write a named slot on update.
    click_token: { max: 256 },
    display_token: { max: 256 },
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
        if (field === 'tier' && !(VALID_TIERS as readonly string[]).includes(val)) {
          return errorResponse(
            'INVALID_TIER',
            `tier must be one of: ${VALID_TIERS.join(', ')}`,
            400,
            rid
          );
        }
        if (field === 'logo_url') {
          const logoValidation = validateLogoUrl(val);
          if (!logoValidation.valid) {
            return errorResponse(
              'INVALID_LOGO_URL',
              'logo_url must be a valid http:// or https:// URL (max 500 chars)',
              400,
              rid
            );
          }
          sets.push('logo_url = ?');
          values.push(logoValidation.url);
          continue;
        }
        sets.push(`${field} = ?`);
        values.push(val.slice(0, max));
      }
    }
  }

  // ── H3 geo-tagging on update (re-tag when lat/lon provided) ──────────────
  const rawLat = body.lat;
  const rawLon = body.lon;
  const hasCoords =
    typeof rawLat === 'number' &&
    typeof rawLon === 'number' &&
    Number.isFinite(rawLat) &&
    Number.isFinite(rawLon);

  if (hasCoords && (rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180)) {
    return errorResponse(
      'INVALID_COORDINATES',
      'lat must be -90..90 and lon must be -180..180',
      400,
      rid
    );
  }

  let updateH3Res7: string | null = null;
  let updateEventId: string | null = null;

  if (hasCoords) {
    const updateLat = rawLat as number;
    const updateLon = rawLon as number;
    const h3Tags = maybeTag(updateLat, updateLon);
    sets.push('lat = ?', 'lon = ?', 'h3_res9 = ?', 'h3_res7 = ?');
    values.push(updateLat, updateLon, h3Tags?.h3_res9 ?? null, h3Tags?.h3_res7 ?? null);
    updateH3Res7 = h3Tags?.h3_res7 ?? null;

    // Look up event_id (for is_local re-derivation + the advisory response).
    try {
      const sp = await env.DB.prepare('SELECT event_id FROM sponsors WHERE id = ?')
        .bind(sponsorId)
        .first<{ event_id: string }>();
      updateEventId = sp?.event_id ?? null;
    } catch {
      // advisory — not fatal
    }

    // OSE-661/#25: is_local is GEO-DERIVED — re-derive it whenever coords change,
    // from the sponsor↔event corridor-cell (h3_res7) match. Server-side only.
    let eventH3Res7: string | null = null;
    if (updateEventId) {
      try {
        const ev = await env.DB.prepare('SELECT h3_res7 FROM events WHERE id = ?')
          .bind(updateEventId)
          .first<{ h3_res7: string | null }>();
        eventH3Res7 = ev?.h3_res7 ?? null;
      } catch {
        // non-fatal — treat as non-local if the event cell can't be read
      }
    }
    const isLocal =
      updateH3Res7 !== null && eventH3Res7 !== null && updateH3Res7 === eventH3Res7 ? 1 : 0;
    sets.push('is_local = ?');
    values.push(isLocal);
  }

  if (sets.length === 0) {
    return errorResponse('NO_FIELDS', 'No valid fields to update', 400, rid);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(sponsorId);
  // OSE-710 (#9): scope the write to the caller's brands. 'all' adds no predicate.
  values.push(...scope.params);

  try {
    const result = await env.DB.prepare(
      `UPDATE sponsors SET ${sets.join(', ')} WHERE id = ?${scope.sql}`
    )
      .bind(...values)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminUpdateSponsor',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to update sponsor', 503, rid);
  }

  // ── is_local_suggested (advisory, only when H3 was updated) ──────────────
  const updateResponseBody: Record<string, unknown> = { ok: true, status: 200, id: sponsorId };

  if (updateH3Res7 !== null && updateEventId !== null) {
    try {
      const eventRow = await env.DB.prepare('SELECT h3_res7 FROM events WHERE id = ?')
        .bind(updateEventId)
        .first<{ h3_res7: string | null }>();
      if (eventRow?.h3_res7) {
        updateResponseBody.is_local_suggested = updateH3Res7 === eventRow.h3_res7;
      }
    } catch {
      // advisory — not fatal
    }
  }

  return Response.json(updateResponseBody, {
    headers: { ...corsHeaders(request), 'X-Request-Id': rid },
  });
}

// ─── Admin: Delete Sponsor (soft) ───────────────────────────────────────────────

export async function handleAdminDeleteSponsor(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // OSE-710 (#9): scope the soft-delete to the caller's authorized brands. A
  // forged/cross-tenant (or anon/unmapped) id lands zero changes → NOT_FOUND,
  // indistinguishable from a non-existent id. Mirrors the list endpoint.
  const scope = await resolvePerIdSponsorScope(request, env);
  if (!scope.reachable)
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);

  try {
    const result = await env.DB.prepare(
      `UPDATE sponsors SET is_active = 0, updated_at = ? WHERE id = ?${scope.sql}`
    )
      .bind(new Date().toISOString(), sponsorId, ...scope.params)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminDeleteSponsor',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to delete sponsor', 503, rid);
  }

  return Response.json(
    { ok: true, status: 200, id: sponsorId },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── Admin: Event Type Associations ─────────────────────────────────────────────

/**
 * PUT /api/v2/admin/sponsors/:id/event-types
 * Body: { template_ids: ["bar_night", "trivia", ...] }
 * Replaces all associations (delete + insert).
 */
export async function handleSetSponsorEventTypes(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // OSE-722 (#9): a forged/cross-tenant sponsor id must not be mutable.
  if (!(await isSponsorReachable(request, env, sponsorId))) {
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  }

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  if (!Array.isArray(body.template_ids)) {
    return errorResponse('MISSING_FIELD', 'Missing required field: template_ids (array)', 400, rid);
  }

  const templateIds = body.template_ids.filter(
    (t: unknown): t is string => typeof t === 'string' && t.length > 0
  );

  try {
    // Delete existing associations
    await env.DB.prepare('DELETE FROM sponsor_event_types WHERE sponsor_id = ?')
      .bind(sponsorId)
      .run();

    // Insert new ones
    if (templateIds.length > 0) {
      const statements = templateIds.map((tid: string) => {
        const id = generateId('set');
        return env
          .DB!.prepare(
            'INSERT INTO sponsor_event_types (id, sponsor_id, template_id) VALUES (?, ?, ?)'
          )
          .bind(id, sponsorId, tid);
      });
      await env.DB.batch(statements);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleSetSponsorEventTypes',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to set event types', 503, rid);
  }

  return Response.json(
    { ok: true, status: 200, sponsor_id: sponsorId, template_ids: templateIds },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

/**
 * GET /api/v2/admin/sponsors/:id/event-types
 */
export async function handleGetSponsorEventTypes(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  }

  // OSE-722 (#9): a forged/cross-tenant sponsor id must not be readable —
  // collapse to 404 (indistinguishable from a non-existent sponsor).
  if (!(await isSponsorReachable(request, env, sponsorId))) {
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  }

  try {
    const result = await env.DB.prepare(
      'SELECT * FROM sponsor_event_types WHERE sponsor_id = ? ORDER BY template_id'
    )
      .bind(sponsorId)
      .all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleGetSponsorEventTypes',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query event types', 503, rid);
  }
}

// ─── Admin: Service Areas ───────────────────────────────────────────────────────

/**
 * PUT /api/v2/admin/sponsors/:id/areas
 * Body: { areas: [{ zip_code?, lat?, lon?, radius_miles? }, ...] }
 * Replaces all areas (delete + insert).
 */
export async function handleSetSponsorAreas(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // OSE-722 (#9): a forged/cross-tenant sponsor id must not be mutable.
  if (!(await isSponsorReachable(request, env, sponsorId))) {
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  }

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  if (!Array.isArray(body.areas)) {
    return errorResponse('MISSING_FIELD', 'Missing required field: areas (array)', 400, rid);
  }

  const areas = body.areas as Array<Record<string, unknown>>;

  try {
    await env.DB.prepare('DELETE FROM sponsor_areas WHERE sponsor_id = ?').bind(sponsorId).run();

    if (areas.length > 0) {
      const statements = areas.map((area) => {
        const id = generateId('sa');
        const zipCode = typeof area.zip_code === 'string' ? area.zip_code.slice(0, 10) : null;
        const lat = typeof area.lat === 'number' ? area.lat : null;
        const lon = typeof area.lon === 'number' ? area.lon : null;
        const radiusMiles = typeof area.radius_miles === 'number' ? area.radius_miles : 10;
        return env
          .DB!.prepare(
            'INSERT INTO sponsor_areas (id, sponsor_id, zip_code, lat, lon, radius_miles) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .bind(id, sponsorId, zipCode, lat, lon, radiusMiles);
      });
      await env.DB.batch(statements);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleSetSponsorAreas',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to set areas', 503, rid);
  }

  return Response.json(
    { ok: true, status: 200, sponsor_id: sponsorId, count: areas.length },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

/**
 * GET /api/v2/admin/sponsors/:id/areas
 */
export async function handleGetSponsorAreas(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  }

  // OSE-722 (#9): a forged/cross-tenant sponsor id must not be readable —
  // collapse to 404 (indistinguishable from a non-existent sponsor).
  if (!(await isSponsorReachable(request, env, sponsorId))) {
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  }

  try {
    const result = await env.DB.prepare(
      'SELECT * FROM sponsor_areas WHERE sponsor_id = ? ORDER BY created_at'
    )
      .bind(sponsorId)
      .all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleGetSponsorAreas',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query areas', 503, rid);
  }
}

// ─── Public: Resolved Sponsors for Event ────────────────────────────────────────

/**
 * GET /api/v2/events/:id/sponsors
 *
 * Uses DataProvider for live → CF cache → mock fallback chain.
 */
export async function handleGetSponsorsForEvent(
  request: Request,
  env: SponsorsEnv,
  eventId: string,
  ctx?: DataProviderCtx
): Promise<Response> {
  const rid = requestId();

  try {
    const dp = getDataProvider(env, ctx);
    const result = await dp.getSponsors(eventId);

    return Response.json(
      { ok: true, status: 200, items: result.data },
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
        handler: 'handleGetSponsorsForEvent',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to resolve sponsors', 503, rid);
  }
}

// ─── Public: Sponsor Bundle ─────────────────────────────────────────────────────

/**
 * GET /api/v2/events/:id/sponsor-bundle?surface=poster|display|public
 *
 * Uses DataProvider for live → CF cache → mock fallback chain.
 */
export async function handleGetSponsorBundle(
  request: Request,
  env: SponsorsEnv,
  eventId: string,
  ctx?: DataProviderCtx
): Promise<Response> {
  const rid = requestId();

  try {
    const dp = getDataProvider(env, ctx);
    const result = await dp.getSponsors(eventId);
    const url = new URL(request.url);
    const surface = url.searchParams.get('surface') as Surface | null;

    let bundle;
    if (surface && VALID_SURFACES.includes(surface)) {
      const filtered = filterSponsorsForSurface(result.data, surface);
      bundle = buildSponsorBundle(filtered);
    } else {
      bundle = buildSponsorBundle(result.data);
    }

    return Response.json(
      { ok: true, status: 200, bundle },
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
        handler: 'handleGetSponsorBundle',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to build sponsor bundle', 503, rid);
  }
}

// ─── Public: Impression / Click Logging ─────────────────────────────────────────

/**
 * POST /api/v2/events/:id/sponsors/:sid/impression
 */
export async function handleLogImpression(
  request: Request,
  env: SponsorsEnv,
  eventId: string,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const surface = typeof body.surface === 'string' ? body.surface.slice(0, 50) : 'unknown';
  const placement = typeof body.placement === 'string' ? body.placement.slice(0, 50) : 'unknown';

  // OSE-635: read h3_res7 from event at write-time. res7 (~5km²) only —
  // res9 is deliberately omitted here (digital click ≠ physical poster location).
  const eventGeo = await env.DB.prepare(`SELECT h3_res7 FROM events WHERE id = ? LIMIT 1`)
    .bind(eventId)
    .first<{ h3_res7: string | null }>();
  const h3Res7 = eventGeo?.h3_res7 ?? null;

  try {
    const id = generateId('si');
    await env.DB.prepare(
      `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type, h3_res7)
       VALUES (?, ?, ?, ?, ?, 'impression', ?)`
    )
      .bind(id, sponsorId, eventId, surface, placement, h3Res7)
      .run();
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleLogImpression',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to log impression', 503, rid);
  }

  return Response.json(
    { ok: true, status: 201 },
    { status: 201, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── Logo proxy (OSE-288 / OSE-R-011 / OSE-R-015) ──────────────────────────────
//
// GET /api/v2/sponsors/:id/logo
//
// Fetches the sponsor's external logo_url, validates its content-type, and
// re-serves it from the worker with security headers set. The external URL
// never appears as an <img src> in rendered HTML — surfaces use this internal
// path exclusively.
//
// This is the R2-free implementation. When R2 is provisioned, the handler can
// be upgraded to store-on-first-fetch and read from R2 on subsequent requests
// without any contract change on the call sites.

export async function handleSponsorLogo(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();

  if (!env.DB) {
    return new Response(null, { status: 404, headers: { 'X-Request-Id': rid } });
  }

  let row: Record<string, unknown> | null;
  try {
    row = await env.DB.prepare('SELECT logo_url FROM sponsors WHERE id = ? AND is_active = 1')
      .bind(sponsorId)
      .first<Record<string, unknown>>();
  } catch {
    return new Response(null, { status: 503, headers: { 'X-Request-Id': rid } });
  }

  if (!row || !row.logo_url) {
    return new Response(null, { status: 404, headers: { 'X-Request-Id': rid } });
  }

  const logoUrl = row.logo_url as string;
  const validation = validateLogoUrl(logoUrl);
  if (!validation.valid || !validation.url) {
    return new Response(null, { status: 422, headers: { 'X-Request-Id': rid } });
  }

  const result = await fetchAndProxyLogo(validation.url);
  if (!result.ok || !result.response) {
    return new Response(null, {
      status: 502,
      headers: { 'X-Request-Id': rid, 'Cache-Control': 'no-store' },
    });
  }

  result.response.headers.set('X-Request-Id', rid);
  return result.response;
}

/**
 * POST /api/v2/events/:id/sponsors/:sid/click
 */
export async function handleLogClick(
  request: Request,
  env: SponsorsEnv,
  eventId: string,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const surface = typeof body.surface === 'string' ? body.surface.slice(0, 50) : 'unknown';
  const placement = typeof body.placement === 'string' ? body.placement.slice(0, 50) : 'unknown';

  // OSE-635: read h3_res7 from event at write-time. res7 (~5km²) only —
  // res9 is deliberately omitted here (digital click ≠ physical poster location).
  const eventGeo = await env.DB.prepare(`SELECT h3_res7 FROM events WHERE id = ? LIMIT 1`)
    .bind(eventId)
    .first<{ h3_res7: string | null }>();
  const h3Res7 = eventGeo?.h3_res7 ?? null;

  try {
    const id = generateId('sc');
    await env.DB.prepare(
      `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type, h3_res7)
       VALUES (?, ?, ?, ?, ?, 'click', ?)`
    )
      .bind(id, sponsorId, eventId, surface, placement, h3Res7)
      .run();
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleLogClick',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to log click', 503, rid);
  }

  return Response.json(
    { ok: true, status: 201 },
    { status: 201, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}
