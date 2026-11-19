/**
 * GET /events/:id/vote: the voter page (OSE-2129, S4b of OSE-1193; OSE ADR-040
 * decisions 5, 6 and 9). The room screen's vote code sends phones here through
 * `/q`, with the vote pass in the fragment.
 *
 * It opens for an event the public event read answers (`active`). An unknown
 * event, a malformed id and an event that is not live all answer one 404.
 * With VOTING_ENABLED off the page still opens and says voting is not open: the
 * script then calls nothing (lib/vote-page-render.ts).
 *
 * IT READS NO BROWSER STATE AND SETS NONE: no cookie is read or set, and the
 * page writes no storage. The answer is `no-store`, sends no referrer, cannot
 * be framed, and its CSP lets the script talk only to this site. The page shows
 * no count of any kind; once the set is final it shows the one result
 * (lib/vote-public-result.ts). The rate limit is applied at the route.
 */

import { html, renderErrorPage, formatEventWhen } from './pages';
import { canRender, parseEventState } from '../domain/event-state';
import { fetchFairSponsors, type FairRow } from './booth-page';
import { renderVotePage } from '../lib/vote-page-render';
import { readPublicVoteResult, type PublicVoteResult } from '../lib/vote-public-result';
import { votingEnabled, type VotingSwitchEnv } from '../lib/voting-switch';

export interface VotePageEnv extends VotingSwitchEnv {
  DB?: D1Database;
}

const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function votePageNotFound(): Response {
  return renderErrorPage(
    404,
    "We couldn't find that vote",
    "This vote isn't open to the public. The event may not be live yet. See what's coming up next.",
    '/events',
    'Browse upcoming events'
  );
}

function votePageUnavailable(): Response {
  return renderErrorPage(
    503,
    "We're having trouble loading this vote",
    'Our event service is briefly unavailable. Try again in a minute.',
    '/events',
    'Browse upcoming events'
  );
}

/**
 * The voter page's own headers, over the house page headers: never stored,
 * no referrer, never framed, and the script may reach only this site.
 */
export function votePageResponse(body: string): Response {
  const res = html(body);
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Robots-Tag', 'noindex');
  const csp = res.headers.get('Content-Security-Policy') ?? '';
  res.headers.set(
    'Content-Security-Policy',
    csp.replace(/frame-ancestors [^;]+/, "frame-ancestors 'none'")
  );
  return res;
}

export async function handleVotePage(
  _request: Request,
  env: VotePageEnv,
  eventId: string
): Promise<Response> {
  if (!env.DB) return votePageUnavailable();
  if (!EVENT_ID.test(eventId)) return votePageNotFound();
  const db = env.DB;
  let event: FairRow | null;
  try {
    event = await db
      .prepare(
        `SELECT id, brand_id, title, slug, status, is_published, start_date, starts_at, timezone
           FROM events WHERE id = ? LIMIT 1`
      )
      .bind(eventId)
      .first<FairRow>();
  } catch {
    return votePageUnavailable();
  }
  // The public event read's own rule: only a live event is public.
  if (!event || !canRender(parseEventState(event.status ?? ''), 'public')) {
    return votePageNotFound();
  }

  const on = votingEnabled(env);
  let result: PublicVoteResult | null = null;
  if (on) {
    try {
      result = await readPublicVoteResult(db, event.id);
    } catch {
      result = null;
    }
  }
  const sponsors = await fetchFairSponsors(db, event.id);
  return votePageResponse(
    renderVotePage({
      event: { id: event.id, title: event.title, slug: event.slug },
      when: formatEventWhen(event),
      sponsors,
      votingOn: on,
      result,
    })
  );
}
