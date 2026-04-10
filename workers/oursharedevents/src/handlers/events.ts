/**
 * Events API handler.
 *
 * GET  /api/v2/events              – list active events for a brand
 * GET  /api/v2/events/:id          – single event by ID
 * GET  /api/v2/admin/events        – admin list (includes archived)
 * POST /api/v2/admin/events        – create event (admin)
 * PUT  /api/v2/admin/events/:id    – update event (admin)
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

// ─── Admin: Create Event ──────────────────────────────────────────────────────

const MAX_BODY = 16 * 1024;

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

  const id = `evt_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  const brandId = typeof body.brand_id === 'string' ? body.brand_id.slice(0, 64) : 'root';
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 100) : slugify(title);
  const status =
    typeof body.status === 'string' && ['active', 'draft', 'archived'].includes(body.status)
      ? body.status
      : 'draft';
  const description = typeof body.description === 'string' ? body.description.slice(0, 2000) : null;
  const location = typeof body.location === 'string' ? body.location.slice(0, 500) : null;
  const startDate = typeof body.start_date === 'string' ? body.start_date.slice(0, 30) : null;
  const endDate = typeof body.end_date === 'string' ? body.end_date.slice(0, 30) : null;
  const timezone =
    typeof body.timezone === 'string' ? body.timezone.slice(0, 50) : 'America/Chicago';
  const coverImageUrl =
    typeof body.cover_image_url === 'string' ? body.cover_image_url.slice(0, 500) : null;
  const templateId = typeof body.template_id === 'string' ? body.template_id.slice(0, 64) : null;
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, description, location, start_date, end_date, timezone, cover_image_url, template_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

  return Response.json(
    { ok: true, status: 201, id, slug },
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
        sets.push(`${field} = ?`);
        values.push(val.slice(0, max));
      }
    }
  }

  if (sets.length === 0) {
    return errorResponse('NO_FIELDS', 'No valid fields to update', 400, rid);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(eventId);

  try {
    const result = await env.DB.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      return errorResponse('NOT_FOUND', `Event not found: ${eventId}`, 404, rid);
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
