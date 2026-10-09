// ─── TV code routes (OSE-1684) ───────────────────────────────────────────────
//
//   POST /api/v2/admin/events/:id/tv-code  → { ok, code, path, tv_path }
//        The event's code, minted on first ask. Admin only; the router's
//        object-scope guard keeps it inside the caller's brands.
//   GET  /tv/<code>                        → 302 /events/<id>/tv
//        Public: the TV cannot sign in. Rate-limited at the route. A code that
//        matches nothing is a 404 page that says to check the code.

import { ensureTvCode, normalizeTvCode, resolveTvCode } from '../lib/tv-code';
import { renderErrorPage } from './pages';
import { corsHeaders } from '../lib/cors';

export interface TvCodeEnv {
  DB?: D1Database;
}

const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

function notFoundPage(): Response {
  return renderErrorPage(
    404,
    "That TV code didn't match an event",
    "Check the six characters on the organizer's screen and type them again.",
    '/events',
    'Browse upcoming events'
  );
}

export async function handleTvCodeResolve(
  _request: Request,
  env: TvCodeEnv,
  raw: string
): Promise<Response> {
  const code = normalizeTvCode(raw);
  if (!code) return notFoundPage();
  if (!env.DB) {
    return renderErrorPage(
      503,
      "We're having trouble opening this TV",
      'Try again in a minute.',
      '/events',
      'Browse upcoming events'
    );
  }
  let eventId: string | null;
  try {
    eventId = await resolveTvCode(env.DB, code);
  } catch {
    return renderErrorPage(
      503,
      "We're having trouble opening this TV",
      'Try again in a minute.',
      '/events',
      'Browse upcoming events'
    );
  }
  if (!eventId) return notFoundPage();
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/events/${encodeURIComponent(eventId)}/tv`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleAdminTvCode(
  request: Request,
  env: TvCodeEnv,
  eventId: string
): Promise<Response> {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store' };
  const fail = (status: number, code: string, error: string) =>
    Response.json({ ok: false, status, code, error }, { status, headers });
  if (!env.DB) return fail(503, 'DB_NOT_CONFIGURED', 'Database not available');
  if (!EVENT_ID.test(eventId)) return fail(404, 'NOT_FOUND', 'Event not found');
  try {
    const row = await env.DB.prepare('SELECT id FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ id: string }>();
    if (!row) return fail(404, 'NOT_FOUND', 'Event not found');
    const code = await ensureTvCode(env.DB, row.id);
    return Response.json(
      {
        ok: true,
        code,
        path: `/tv/${code}`,
        tv_path: `/events/${encodeURIComponent(row.id)}/tv`,
      },
      { status: 200, headers }
    );
  } catch {
    return fail(503, 'DB_UNAVAILABLE', 'Could not read or make the TV code');
  }
}
