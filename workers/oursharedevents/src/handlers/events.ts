/**
 * Events API handler.
 *
 * GET /api/v2/events          – list active events for a brand
 * GET /api/v2/events/:id      – single event by ID
 *
 * Data source: D1 (Phase 2)
 * TODO: Wire to D1 queries once database is provisioned.
 */

import { corsHeaders } from '../lib/cors';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EventsEnv {
  WORKER_ENV?: string;
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
 * GET /api/v2/events?brand=root&full=true
 */
export async function handleListEvents(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();

  // TODO: Replace with D1 query
  return Response.json(
    { ok: true, status: 200, items: [] },
    {
      headers: {
        ...corsHeaders(request),
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
        'X-Request-Id': rid,
      },
    }
  );
}

/**
 * GET /api/v2/events/:id
 */
export async function handleGetEvent(
  request: Request,
  env: EventsEnv,
  id: string
): Promise<Response> {
  const rid = requestId();

  // TODO: Replace with D1 query
  return errorResponse('NOT_FOUND', `Event not found: ${id}`, 404, rid);
}

/**
 * GET /api/v2/admin/events  (includes archived)
 */
export async function handleAdminListEvents(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();

  // TODO: Replace with D1 query
  return Response.json(
    { ok: true, status: 200, items: [] },
    {
      headers: { ...corsHeaders(request), 'X-Request-Id': rid, 'Cache-Control': 'no-store' },
    }
  );
}
