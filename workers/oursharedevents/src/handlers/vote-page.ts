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

import { renderErrorPage, formatEventWhen } from './pages';
import { HARDENING_HEADERS } from '../lib/security-headers';
import { canRender, parseEventState } from '../domain/event-state';
import { fetchFairSponsors, type FairRow } from './booth-page';
import { renderVotePage } from '../lib/vote-page-render';
import { readPublicVoteResult, type PublicVoteResult } from '../lib/vote-public-result';
import { votingEnabled, type VotingSwitchEnv } from '../lib/voting-switch';
import { readPublicCrowdResult, type PublicCrowdResult } from '../lib/vote-crowd';

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
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const nonce = btoa(binary);
  // Nonce every <script>, as the house html() helper does.
  const nonced = body.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`); // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
  return new Response(nonced, {
    status: 200,
    headers: {
      ...HARDENING_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    },
  });
}

export async function handleVotePage(
  _request: Request,
  env: VotePageEnv,
  eventId: string,
  channel: 'room' | 'crowd' = 'room'
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
  let crowdResult: PublicCrowdResult | null = null;
  if (on) {
    try {
      result = await readPublicVoteResult(db, event.id);
      // The Online Pick's result shows only beside the Room Pick's (decision 13).
      crowdResult = result ? await readPublicCrowdResult(db, event.id) : null;
    } catch {
      result = null;
      crowdResult = null;
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
      channel,
      crowdResult,
    })
  );
}
