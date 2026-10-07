/**
 * GET /s/:code — public shortlink resolver. OSE-240 / BE-25.
 *
 * Looks up the code in the shortlinks table, increments the (anonymous)
 * click counter, and 302-redirects to the canonical event URL.
 *
 * The redirect goes to the admin-set https:// destination when one is
 * stored, else to an internal page built from the stored event id: the
 * public event page `/events/:id` (OSE-243a) or the check-in form. The JSON
 * endpoint `/api/v2/events/:id` was the target before OSE-243a.
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
import { internalTarget } from '../lib/poster-codes';

export type ShortlinkResolveEnv = ShortlinksEnv;

export async function handleShortlinkResolve(
  request: Request,
  env: ShortlinkResolveEnv,
  code: string,
  countable: boolean = true
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
  // The redirect must succeed even if this increment fails: incrementClick
  // swallows D1 errors with a structured log. It IS awaited (one UPDATE …
  // RETURNING round trip), so the count is current when the 302 lands.
  // Past the caller's limit (OSE-1496) the link still works and the click is
  // not counted, so one client cannot run the count up. See publicCountLimited.
  if (countable) await incrementClick(env, code);

  // 302 to the public event HTML page. OSE-243a wired /events/:id to
  // handlePublicEventPage which renders the 5W content + venue map +
  // anonymity affordance (pre_event) or a minimal phase stub (event /
  // post_event). The pre-OSE-243a target was /api/v2/events/:id which
  // returned JSON — sending a recipient's browser to that was the gap
  // that this two-PR sequence closed.
  const url = new URL(request.url);
  // Rb: route to the admin-set external destination when present. The target
  // was validated https:// at creation; re-check the scheme here defensively so
  // a bad row can never turn the resolver into an open redirect. Anything that
  // fails the check falls back to the event's own public page.
  // OSE-1357 part 2: an internal kind (anonymous check-in) is built here from
  // the event id alone — the check-in form, carrying no identity.
  const target =
    row.target_url && row.target_url.startsWith('https://')
      ? row.target_url
      : internalTarget(url.origin, row.event_id, row.kind ?? 'public');

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
