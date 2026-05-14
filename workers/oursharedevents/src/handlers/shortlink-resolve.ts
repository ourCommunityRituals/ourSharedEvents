/**
 * GET /s/:code — public shortlink resolver. OSE-240 / BE-25.
 *
 * Looks up the code in the shortlinks table, increments the (anonymous)
 * click counter, and 302-redirects to the canonical event URL.
 *
 * Today's redirect target is `/api/v2/events/:id` (the existing JSON
 * endpoint). When OSE-243 lands a lifecycle-aware public page, the
 * router's `/events/:id` HTML route becomes the better target; the
 * change is a single string in this file.
 *
 * Anonymity-principle compliance (reinforced 2026-05-14):
 *   - No IP read. No anon_id read. No session cookie set/read.
 *     The `Referer` header is NOT logged.
 *   - The only datum collected is the click counter increment +
 *     last_clicked_at timestamp. That's group-level temporal data,
 *     never per-attendee.
 *   - 404 on bad/unknown code so probing reveals no information.
 *
 * Failure modes:
 *   - Malformed code (wrong length / non-base62 char) → 404
 *   - Unknown code → 404
 *   - DB missing → 503 (caller should know infra is degraded)
 *   - Counter increment fails → still 302 (the redirect is the user
 *     contract; the counter is a nice-to-have for ops)
 */

import {
  resolveCode,
  incrementClick,
  isValidCodeShape,
  type ShortlinksEnv,
} from '../lib/shortlinks';

export type ShortlinkResolveEnv = ShortlinksEnv;

export async function handleShortlinkResolve(
  request: Request,
  env: ShortlinkResolveEnv,
  code: string
): Promise<Response> {
  if (!env.DB) {
    return new Response(
      JSON.stringify({ ok: false, code: 'DB_NOT_CONFIGURED', error: 'Service unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!isValidCodeShape(code)) {
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Link not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const row = await resolveCode(env, code);
  if (!row) {
    // Same 404 shape for unknown vs malformed so probing reveals nothing.
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Link not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Anonymous click logging: counter + timestamp only. No IP, no anon_id.
  // Fire-and-forget semantics — the redirect must succeed even if this
  // increment fails. (incrementClick already swallows D1 errors with a
  // structured log; we still don't await the result before redirecting.)
  await incrementClick(env, code);

  // 302 to the canonical event endpoint. The Worker handles the HTML
  // route at /events/:id (or /api/v2/events/:id JSON depending on the
  // caller's Accept header — for ose.link/abc123 in a browser, the
  // browser follows the redirect and gets the lifecycle page).
  const url = new URL(request.url);
  const target = `${url.origin}/api/v2/events/${encodeURIComponent(row.event_id)}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      // Don't cache the redirect — admin may change behavior per event,
      // and short-lived caching here would obscure click signals.
      'Cache-Control': 'no-store',
    },
  });
}
