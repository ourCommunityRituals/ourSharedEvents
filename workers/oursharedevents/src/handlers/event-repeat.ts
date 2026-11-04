/**
 * POST /api/v2/admin/events/:id/repeat — "Repeat this event" (OSE-1531).
 *
 * Makes a DRAFT copy of a finished event: same name, place, kind, text, start
 * time and zone, settings; the date moves to the same weekday ahead. The copy
 * goes through handleCreateEvent, the one create path, so brand scope (403
 * BRAND_FORBIDDEN, never a copy into a brand the caller is not in), validation,
 * the slug rule, the shortlink and `created_by` are never re-implemented here.
 *
 * The router has already proved the SOURCE is inside the caller's brand scope
 * (guardAdminObjectScope: the path is under /api/v2/admin/events/:id), and the
 * create path re-checks the TARGET brand, so a scope miss is a 404 on one side
 * and a 403 on the other: two doors, not one.
 *
 * Reads exactly one table (`events`, one row by id) and writes through create.
 * It never touches FORMS_DB, scans, shortlinks, poster tables or sponsor tables,
 * so nothing about who took part can reach the copy (never-who). Gate:
 * tests/event-repeat.spec.ts.
 */

import { corsHeaders } from '../lib/cors';
import { REPEAT_SOURCE_COLUMNS, buildRepeatBody, type RepeatSource } from '../lib/event-repeat';
import { handleCreateEvent, type EventsEnv } from './events';
import { inheritAdminActor } from '../auth/admin';

import { errorLabel } from '../lib/error-label';
const SLUG_ATTEMPTS = 3;

function fail(code: string, message: string, status: number, rid: string): Response {
  return Response.json(
    {
      ok: false,
      status,
      code,
      error: message,
      requestId: rid,
      timestamp: new Date().toISOString(),
    },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
  );
}

export async function handleAdminRepeatEvent(
  request: Request,
  env: EventsEnv,
  sourceId: string
): Promise<Response> {
  const rid = crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
  if (!env.DB) return fail('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  let source: RepeatSource | null;
  try {
    source = await env.DB.prepare(
      `SELECT ${REPEAT_SOURCE_COLUMNS.join(', ')} FROM events WHERE id = ?`
    )
      .bind(sourceId)
      .first<RepeatSource>();
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminRepeatEvent',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return fail('DB_ERROR', 'Failed to read the event', 503, rid);
  }
  if (!source) return fail('NOT_FOUND', `Event not found: ${sourceId}`, 404, rid);

  const today = new Date().toISOString().slice(0, 10);
  let created: Response | null = null;
  let body: Record<string, unknown> = {};
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    body = buildRepeatBody(source, today, crypto.randomUUID().slice(0, 6));
    // Same caller identity (CF Access JWT / key header) and URL; only the body is new.
    const headers = new Headers(request.headers);
    headers.set('Content-Type', 'application/json');
    const createRequest = new Request(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    // OSE-1801: the copy acts as the caller's resolved actor. A new Request would
    // otherwise decode the token again after the source read, and an expiry in
    // between would refuse a repeat inside the caller's own brand.
    inheritAdminActor(request, createRequest, env);
    created = await handleCreateEvent(createRequest, env);
    if (created.status !== 409) break; // 409 = the slug suffix collided: try another
  }
  if (!created || created.status >= 400)
    return created ?? fail('DB_ERROR', 'Copy failed', 503, rid);

  const made = (await created.json()) as {
    id: string;
    slug: string;
    shortcode: string | null;
    timezone: string;
    warnings: unknown[];
  };
  return Response.json(
    {
      ok: true,
      status: 201,
      id: made.id,
      source_id: sourceId,
      title: body.title,
      slug: made.slug,
      shortcode: made.shortcode,
      // The draft's date and start time, so the page can say what it made.
      start_date: body.start_date ?? null,
      start_time: body.start_time ?? null,
      timezone: made.timezone,
      state: 'draft',
      warnings: made.warnings,
    },
    {
      status: 201,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid },
    }
  );
}
