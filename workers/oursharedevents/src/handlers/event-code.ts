// ─── Event code routes (OSE-1684) ────────────────────────────────────────────
//
//   POST /api/v2/admin/events/:id/short-links → { ok, code, links }
//        The event's code and its five short addresses, minted on first ask.
//        Admin only; the router's object-scope guard keeps it inside the
//        caller's brands.
//   GET  /e/<code>  → the event page (its readable address)
//   GET  /p/<code>  → /events/<id>/poster
//   GET  /r/<code>  → the register form        GET /c/<code>  → the check-in form
//   GET  /tv/<code> → /events/<id>/tv
// Public, because a TV and a passer-by cannot sign in. A code that matches
// nothing is a 404 page that says to check the code.
//
// Counting (owner 2026-10-09: "anything that is being shared"; "never who,
// only when"): an open of /e/ /p/ /r/ /c/ adds one to share_opens_daily for
// that event × screen × phase × day (lib/share-count.ts). Only a real page load
// of a public event counts: a GET (not HEAD), not a link-preview robot, inside
// the route's per-caller limit. /tv/ is typed on the venue screen, not shared.
//
// Drafts (CCR 2026-10-09, C1): only a public event is sent to its readable
// address. Any other event is sent to /events/<id>, which answers the same 404
// as an unknown event, so a code never reveals a draft's name.
//
// Guessing (2026-10-10): a code is six characters from 31, so a caller could
// try codes until one answers. Wrong guesses are counted per caller
// (EVENT_CODE_GUESS_MAX a minute, lib/public-read-limit.ts). Past that every
// code answers 429 for the rest of the minute, right ones too, so a hit cannot
// be told from a miss. A right code never adds to the count.

import {
  type EventCodeScreen,
  ensureEventCode,
  eventCodeLinks,
  normalizeEventCode,
  resolveEventCode,
} from '../lib/event-code';
import { type ShareScreen, isLinkPreviewRequest, recordShareOpen } from '../lib/share-count';
import { eventPhaseOf } from '../lib/event-enrich';
import { eventFormPath, eventPagePath } from '../lib/canonical';
import { DEFAULT_LANG, type Lang } from '../lib/i18n/languages';
import { withLangPrefix } from '../lib/i18n/path-prefix';
import { renderErrorPage } from './pages';
import { corsHeaders } from '../lib/cors';
import { countGuess, isGuessLimited, type PublicReadLimitEnv } from '../lib/public-read-limit';

import { errorLabel } from '../lib/error-label';
export type EventCodeEnv = PublicReadLimitEnv & {
  DB?: D1Database;
};

/** Wrong codes a caller may try in a minute before every code is refused. */
export const EVENT_CODE_GUESS_MAX = 30;
const GUESS_SCOPE = 'event-code-guess';

const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** What an open of each short prefix counts as; the TV's is not counted. */
export const SHARE_SCREEN_OF: Record<EventCodeScreen, ShareScreen | null> = {
  share: 'event',
  poster: 'poster',
  register: 'register',
  checkin: 'checkin',
  tv: null,
};

interface CodeEventRow {
  id: string;
  slug: string | null;
  status: string | null;
  is_published: number | null;
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  timezone: string | null;
}

/**
 * Would the public event page show this event? The same rule as
 * handlePublicEventPage: live (on the map or off it, open by link), or
 * published and past live. Draft and ready are never public.
 */
export function isPublicEvent(row: {
  status: string | null;
  is_published: number | null;
}): boolean {
  const status = (row.status || '').toLowerCase();
  if (status === 'draft' || status === 'ready') return false;
  return status === 'active' || row.is_published === 1;
}

function notFoundPage(): Response {
  return renderErrorPage(
    404,
    "That code didn't match an event",
    'Check the six characters you were given and type them again.',
    '/events',
    'Browse upcoming events'
  );
}

function tooManyGuessesPage(): Response {
  const page = renderErrorPage(
    429,
    'Too many codes tried',
    'Wait a minute, then type the code again.',
    '/events',
    'Browse upcoming events'
  );
  const headers = new Headers(page.headers);
  headers.set('Retry-After', '60');
  headers.set('Cache-Control', 'no-store');
  return new Response(page.body, { status: 429, headers });
}

function unavailablePage(): Response {
  return renderErrorPage(
    503,
    "We're having trouble opening this event",
    'Try again in a minute.',
    '/events',
    'Browse upcoming events'
  );
}

function targetFor(
  screen: EventCodeScreen,
  row: CodeEventRow,
  isPublic: boolean,
  lang: Lang
): string {
  const id = encodeURIComponent(row.id);
  switch (screen) {
    case 'share':
      // A draft gets the plain address (and its 404), never its name. OSE-1761:
      // /es/e/<code> lands on the Spanish page; only the event page has one.
      return withLangPrefix(lang, isPublic ? eventPagePath(id, row.slug) : `/events/${id}`);
    case 'poster':
      return `/events/${id}/poster`;
    case 'tv':
      return `/events/${id}/tv`;
    case 'register':
      return eventFormPath(row.id, 'register');
    case 'checkin':
      return eventFormPath(row.id, 'checkin');
  }
}

/**
 * Resolve /<prefix>/<code>. `countable` comes from the route's per-caller
 * limit; past it the link still works and the open is not counted.
 */
export async function handleEventCodeResolve(
  request: Request,
  env: EventCodeEnv,
  screen: EventCodeScreen,
  raw: string,
  countable = false,
  /** OSE-1761: the language prefix the short link was opened under (`/es/e/<code>`). */
  lang: Lang = DEFAULT_LANG
): Promise<Response> {
  const code = normalizeEventCode(raw);
  if (!code) return notFoundPage();
  if (!env.DB) return unavailablePage();
  // Checked before the lookup, so past the limit a right code and a wrong one
  // look the same.
  if (await isGuessLimited(request, env, GUESS_SCOPE)) return tooManyGuessesPage();
  let row: CodeEventRow | null = null;
  try {
    const eventId = await resolveEventCode(env.DB, code);
    if (eventId) {
      row = await env.DB.prepare(
        `SELECT id, slug, status, is_published, start_date, end_date, starts_at, timezone
           FROM events WHERE id = ?`
      )
        .bind(eventId)
        .first<CodeEventRow>();
    }
  } catch {
    return unavailablePage();
  }
  if (!row) {
    if (await countGuess(request, env, GUESS_SCOPE, EVENT_CODE_GUESS_MAX)) {
      return tooManyGuessesPage();
    }
    return notFoundPage();
  }

  const isPublic = isPublicEvent(row);
  const shareScreen = SHARE_SCREEN_OF[screen];
  if (
    shareScreen &&
    countable &&
    isPublic &&
    request.method === 'GET' &&
    !isLinkPreviewRequest(request)
  ) {
    // A failed count never blocks the link.
    try {
      await recordShareOpen(env.DB, {
        eventId: row.id,
        screen: shareScreen,
        phase: eventPhaseOf(row),
        day: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      console.warn(
        JSON.stringify({
          type: 'SHARE_OPEN_COUNT_ERROR',
          error: errorLabel(err),
          timestamp: new Date().toISOString(),
        })
      );
    }
  }

  return new Response(null, {
    status: 302,
    headers: { Location: targetFor(screen, row, isPublic, lang), 'Cache-Control': 'no-store' },
  });
}

export async function handleAdminEventCode(
  request: Request,
  env: EventCodeEnv,
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
    const code = await ensureEventCode(env.DB, row.id);
    return Response.json({ ok: true, code, links: eventCodeLinks(code) }, { status: 200, headers });
  } catch {
    return fail(503, 'DB_UNAVAILABLE', 'Could not read or make the event code');
  }
}
