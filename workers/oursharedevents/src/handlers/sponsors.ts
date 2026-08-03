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
  resolveSponsorsForEvent,
  filterSponsorsForSurface,
  buildSponsorBundle,
  type Surface,
} from '../lib/sponsor-resolver';
import { validateLogoUrl, fetchAndProxyLogo } from '../lib/sponsor-logo';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SponsorsEnv {
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

  try {
    const result = await env.DB.prepare(
      `SELECT id, event_id, name, logo_url, website_url, tier, placement_formats,
              click_token, impression_token, is_active, created_at, updated_at
       FROM sponsors
       ORDER BY updated_at DESC`
    ).all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [] },
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

// ─── Admin: Get Sponsor ─────────────────────────────────────────────────────────

export async function handleAdminGetSponsor(
  request: Request,
  env: SponsorsEnv,
  id: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('NOT_FOUND', `Sponsor not found: ${id}`, 404, rid);

  try {
    const row = await env.DB.prepare('SELECT * FROM sponsors WHERE id = ?').bind(id).first();
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
  const placementFormats =
    typeof body.placement_formats === 'string'
      ? body.placement_formats.slice(0, 1000)
      : typeof body.placement_formats === 'object'
        ? JSON.stringify(body.placement_formats)
        : '{}';
  const clickToken = typeof body.click_token === 'string' ? body.click_token.slice(0, 256) : null;
  const impressionToken =
    typeof body.impression_token === 'string' ? body.impression_token.slice(0, 256) : null;
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO sponsors (id, event_id, name, logo_url, website_url, tier, placement_formats, click_token, impression_token, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
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
        impressionToken,
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

  return Response.json(
    { ok: true, status: 201, id },
    { status: 201, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── Admin: Update Sponsor ──────────────────────────────────────────────────────

export async function handleAdminUpdateSponsor(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const allowedFields: Record<string, { max: number }> = {
    name: { max: 200 },
    logo_url: { max: 500 },
    website_url: { max: 500 },
    tier: { max: 20 },
    placement_formats: { max: 1000 },
    click_token: { max: 256 },
    impression_token: { max: 256 },
  };

  const sets: string[] = [];
  const values: (string | null)[] = [];

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
      } else if (field === 'placement_formats' && typeof val === 'object') {
        sets.push(`${field} = ?`);
        values.push(JSON.stringify(val).slice(0, max));
      }
    }
  }

  if (sets.length === 0) {
    return errorResponse('NO_FIELDS', 'No valid fields to update', 400, rid);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(sponsorId);

  try {
    const result = await env.DB.prepare(`UPDATE sponsors SET ${sets.join(', ')} WHERE id = ?`)
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

  return Response.json(
    { ok: true, status: 200, id: sponsorId },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── Admin: Delete Sponsor (soft) ───────────────────────────────────────────────

export async function handleAdminDeleteSponsor(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  try {
    const result = await env.DB.prepare(
      'UPDATE sponsors SET is_active = 0, updated_at = ? WHERE id = ?'
    )
      .bind(new Date().toISOString(), sponsorId)
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
 */
export async function handleGetSponsorsForEvent(
  request: Request,
  env: SponsorsEnv,
  eventId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  }

  try {
    const sponsors = await resolveSponsorsForEvent(env.DB, eventId);

    return Response.json(
      { ok: true, status: 200, items: sponsors },
      {
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
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
 */
export async function handleGetSponsorBundle(
  request: Request,
  env: SponsorsEnv,
  eventId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return Response.json(
      {
        ok: true,
        status: 200,
        bundle: {
          sponsors: [],
          surface_sponsors: { posterTop: [], tvTop: [], tvSide: [], mobileBanner: [] },
          rotation_config: { sponsorSlots: 0, rotationMs: 5000 },
        },
      },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  }

  try {
    const sponsors = await resolveSponsorsForEvent(env.DB, eventId);
    const url = new URL(request.url);
    const surface = url.searchParams.get('surface') as Surface | null;

    let result;
    if (surface && VALID_SURFACES.includes(surface)) {
      const filtered = filterSponsorsForSurface(sponsors, surface);
      result = buildSponsorBundle(filtered);
    } else {
      result = buildSponsorBundle(sponsors);
    }

    return Response.json(
      { ok: true, status: 200, bundle: result },
      {
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
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

  try {
    const id = generateId('si');
    await env.DB.prepare(
      `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type)
       VALUES (?, ?, ?, ?, ?, 'impression')`
    )
      .bind(id, sponsorId, eventId, surface, placement)
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

  try {
    const id = generateId('sc');
    await env.DB.prepare(
      `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type)
       VALUES (?, ?, ?, ?, ?, 'click')`
    )
      .bind(id, sponsorId, eventId, surface, placement)
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
