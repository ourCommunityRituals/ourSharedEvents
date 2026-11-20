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
 * Robots (owner 2026-10-10): chat and social apps fetch a link the moment it
 * is pasted, to draw its preview card. That fetch gets the redirect like
 * anyone else but is not counted as a tap; the rule is the one /e/ uses
 * (isLinkPreviewRequest, lib/share-count.ts), which reads the browser name,
 * answers yes or no and keeps nothing; this handler never reads it. Email scanners that look like browsers are
 * still counted: a robot list cannot tell them from a person.
 *
 * Wrong guesses (2026-10-10, TL-079): a code is six characters from 62, and
 * every printed poster carries some. Wrong codes are counted per caller
 * (SHORTLINK_GUESS_MAX a minute, countGuess in lib/public-read-limit.ts, the
 * same limiter as the event short codes but its own count). Past that every
 * code answers 429 for the rest of the minute, right ones too, so a hit cannot
 * be told from a miss. A right code never counts, so a crowd scanning one
 * printed code on one Wi-Fi is never refused. The caller key is a peppered
 * hash that lives 60 s in KV; this handler reads no address itself.
 *
 * Anonymity-principle compliance (reinforced 2026-05-14):
 *   - No IP read. No anon_id read. No session cookie set/read.
 *     The `Referer` header is NOT logged.
 *   - The only datum collected is the click counter increment +
 *     last_clicked_at timestamp. That's group-level temporal data,
 *     never per-attendee.
 *   - 404 on bad/unknown code so probing reveals no information.
 *
 * A dead link says something (OSE-2164): /s/ is what a printed QR encodes, so a
 * person holding a wrong or taken-down code is a reader, not an API client. A
 * request that accepts text/html (a browser) gets the branded page with one
 * button to the events list; anything else keeps the JSON. Both carry
 * `Vary: Accept`. The page, like the JSON, is the same for a malformed and an
 * unknown code (one function builds both), and the 429 is the same for a right
 * and a wrong code. Every one is `no-store`, none sets a cookie, and the page's
 * language is the browser's Accept-Language (a bare address has no prefix).
 *
 * Failure modes:
 *   - Malformed code (wrong length / non-base62 char) → 404, not counted
 *   - Unknown code → 404, counted as a wrong guess
 *   - Past the guess limit → 429 for every code, Retry-After 60
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
import { isLinkPreviewRequest } from '../lib/share-count';
import { countGuess, isGuessLimited, type PublicReadLimitEnv } from '../lib/public-read-limit';
import { renderErrorPage } from './pages';
import { fmt, msg } from '../lib/i18n/catalog';
import { resolveLanguage } from '../lib/i18n/resolve-language';
import { withLangPrefix } from '../lib/i18n/path-prefix';

/** Wrong /s/ codes one caller may try in a minute (same as the event short codes). */
export const SHORTLINK_GUESS_MAX = 30;
const GUESS_SCOPE = 'shortlink-guess';

type DeadEnd = {
  status: 404 | 429 | 503;
  /** The catalog key stem: err.<kind>.title and err.<kind>.body. */
  kind: 'link' | 'linkLimit' | 'linkDown';
  json: { ok: false; code: string; error: string };
};

const NOT_FOUND: DeadEnd = {
  status: 404,
  kind: 'link',
  json: { ok: false, code: 'NOT_FOUND', error: 'Link not found' },
};
const TOO_MANY: DeadEnd = {
  status: 429,
  kind: 'linkLimit',
  json: { ok: false, code: 'TOO_MANY_GUESSES', error: 'Too many links tried' },
};
const UNAVAILABLE: DeadEnd = {
  status: 503,
  kind: 'linkDown',
  json: { ok: false, code: 'DB_NOT_CONFIGURED', error: 'Service unavailable' },
};

/** A browser says it wants a page; a script or a curl says `*` or nothing. */
function wantsPage(request: Request): boolean {
  return /text\/html/i.test(request.headers.get('Accept') ?? '');
}

/**
 * The one place a dead /s/ link is answered. A browser gets the branded page,
 * anyone else the JSON; the choice depends on the request's Accept header and
 * on nothing about the code, so a malformed and an unknown code answer the same
 * page. Past the limit every well-formed code, right or wrong, answers the same
 * 429 (a malformed one still answers 404 before the limit is read: the code's
 * shape is public). No cookie is set.
 */
function deadEnd(request: Request, d: DeadEnd): Response {
  const extra: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Accept' };
  if (d.status === 429) extra['Retry-After'] = '60';
  if (!wantsPage(request)) {
    return new Response(JSON.stringify(d.json), {
      status: d.status,
      headers: { 'Content-Type': 'application/json', ...extra },
    });
  }
  const lang = resolveLanguage(request.headers.get('Accept-Language'));
  const page = renderErrorPage(
    d.status,
    msg(lang, `err.${d.kind}.title`),
    msg(lang, `err.${d.kind}.body`),
    withLangPrefix(lang, '/events'),
    msg(lang, 'err.link.cta'),
    { label: fmt(lang, 'err.status', { n: d.status }), lang }
  );
  const headers = new Headers(page.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  headers.set('Vary', 'Accept, Accept-Language');
  return new Response(page.body, { status: d.status, headers });
}

export type ShortlinkResolveEnv = ShortlinksEnv & PublicReadLimitEnv;

export async function handleShortlinkResolve(
  request: Request,
  env: ShortlinkResolveEnv,
  code: string,
  countable: boolean = true
): Promise<Response> {
  if (!env.DB) return deadEnd(request, UNAVAILABLE);

  if (!isValidCodeShape(code)) return deadEnd(request, NOT_FOUND);

  // Checked before the lookup, so past the limit a right code and a wrong one
  // look the same.
  if (await isGuessLimited(request, env, GUESS_SCOPE)) return deadEnd(request, TOO_MANY);

  const row = await resolveCode(env, code);
  if (!row) {
    if (await countGuess(request, env, GUESS_SCOPE, SHORTLINK_GUESS_MAX)) {
      return deadEnd(request, TOO_MANY);
    }
    // Same 404 for unknown vs malformed (one function builds both) so probing
    // reveals nothing.
    return deadEnd(request, NOT_FOUND);
  }

  // Anonymous click logging: counter + timestamp only. No IP, no anon_id.
  // The redirect must succeed even if this increment fails: incrementClick
  // swallows D1 errors with a structured log. It IS awaited (one UPDATE …
  // RETURNING round trip), so the count is current when the 302 lands.
  // Past the caller's limit (OSE-1496) the link still works and the click is
  // not counted, so one client cannot run the count up. See publicCountLimited.
  // A link-preview robot is sent on but not counted.
  if (countable && !isLinkPreviewRequest(request)) {
    await incrementClick(env, code);
  }

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
