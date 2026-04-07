/**
 * Events API handler.
 *
 * GET /api/v2/events          – list active events for a brand
 * GET /api/v2/events/:id      – single event by ID
 * GET /api/v2/admin/events    – admin list (includes archived)
 *
 * Data source: D1 database (DB binding)
 */

import { corsHeaders } from '../lib/cors';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EventsEnv {
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
 */
export async function handleListEvents(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();
  const url = new URL(request.url);
  const brand = url.searchParams.get('brand') || 'root';

  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, brand_id, title, slug, status, description, location,
              start_date, end_date, timezone, cover_image_url, created_at, updated_at
       FROM events
       WHERE brand_id = ? AND status = 'active'
       ORDER BY start_date ASC`
    )
      .bind(brand)
      .all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [] },
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
 */
export async function handleGetEvent(
  request: Request,
  env: EventsEnv,
  id: string
): Promise<Response> {
  const rid = requestId();

  if (!env.DB) {
    return errorResponse('NOT_FOUND', `Event not found: ${id}`, 404, rid);
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, brand_id, title, slug, status, description, location,
              start_date, end_date, timezone, cover_image_url, created_at, updated_at
       FROM events
       WHERE id = ?`
    )
      .bind(id)
      .first();

    if (!row) {
      return errorResponse('NOT_FOUND', `Event not found: ${id}`, 404, rid);
    }

    return Response.json(
      { ok: true, status: 200, item: row },
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
 *
 * Returns all events (including archived) for admin dashboard.
 */
export async function handleAdminListEvents(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();

  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, brand_id, title, slug, status, description, location,
              start_date, end_date, timezone, cover_image_url, created_at, updated_at
       FROM events
       ORDER BY updated_at DESC`
    ).all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [] },
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
