/**
 * GET /events/:id/booths/:number — the public page of one stall at a fair
 * (OSE-1998, OSE ADR-034 decisions 1 and 5).
 *
 * The public key is the stall's NUMBER within its event, the one printed on
 * the table card, read in any case ("a12" finds "A12"), never the internal id.
 *
 * The page opens only for a stall in use, of an event the public event read
 * answers (`active`, the same rule as GET /api/v2/events/:id, so the page and
 * the `booths` sibling never disagree). An unknown event, an event that is not
 * public, an unknown number and a stall out of use all answer the same 404,
 * byte for byte, so a probe learns nothing from which one it hit.
 *
 * Anonymity: no cookie is read or set, no address is stored, and the page
 * shows no count of any kind. The rate limit is applied at the route.
 */

import { html, renderErrorPage, formatEventWhen } from './pages';
import { canRender, parseEventState } from '../domain/event-state';
import { fetchPublicBoothByNumber, readPublicBoothsOf } from '../lib/public-booths';
import { BOOTH_NUMBER_MAX } from '../lib/event-booths';
import { renderBoothPage, type BoothPageSponsor } from '../lib/booth-page-render';
import { PLACEMENT_ON_SHOW_SQL } from '../lib/sponsor-card';
import { passportOnSql } from '../lib/event-settings';

export interface BoothPageEnv {
  DB?: D1Database;
}

/** The one message every closed stall address shows. */
export const BOOTH_NOT_OPEN_COPY =
  "This stall isn't open to the public. Its fair may not be published yet, or the stall may have closed. See what's coming up next.";

/**
 * The one 404 every closed stall address answers, the stall list's included
 * (GET /events/:id/booths): the same title, heading and copy, byte for byte.
 */
export function boothNotFound(): Response {
  return renderErrorPage(
    404,
    "We couldn't find that stall",
    BOOTH_NOT_OPEN_COPY,
    '/events',
    'Browse upcoming events'
  );
}

export function boothUnavailable(): Response {
  return renderErrorPage(
    503,
    "We're having trouble loading this stall",
    'Our event service is briefly unavailable. Try again in a minute, or browse what else is coming up.',
    '/events',
    'Browse upcoming events'
  );
}

const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

/** The number from the path, decoded and trimmed, or null when it cannot be one. */
export function parseBoothNumberSegment(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const number = decoded.trim();
  if (!number || number.length > BOOTH_NUMBER_MAX || CONTROL_CHAR.test(number)) return null;
  return number;
}

export interface FairRow {
  id: string;
  brand_id: string;
  title: string;
  slug: string | null;
  status: string | null;
  is_published: number | null;
  start_date: string | null;
  starts_at: string | null;
  timezone: string | null;
  /** 1 when the fair's stamp passport is on (lib/event-settings.ts passportOnSql). */
  passport?: number | null;
}

/**
 * The fair's sponsors on show, for the strip: the per-placement on-show rule
 * (both sides accepted, a live event in the sponsor's own brand, the event
 * opted in to sponsors). Fails to none: the stall still renders.
 */
export async function fetchFairSponsors(
  db: D1Database,
  eventId: string
): Promise<BoothPageSponsor[]> {
  try {
    const rs = await db
      .prepare(
        `SELECT sb.id AS id, sb.name AS name, sb.display_name AS display_name,
                sb.website_url AS website_url,
                COALESCE((SELECT a.url FROM sponsor_asset a
                           WHERE a.sponsor_business_id = sb.id AND a.format = 'logo_compact'),
                         (SELECT a.url FROM sponsor_asset a
                           WHERE a.sponsor_business_id = sb.id AND a.format = 'logo'),
                         '') <> '' AS has_logo
           FROM sponsor_placement sp
           JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
           JOIN events e ON e.id = sp.event_id
          WHERE sp.event_id = ? AND ${PLACEMENT_ON_SHOW_SQL}
          ORDER BY sb.id ASC`
      )
      .bind(eventId)
      .all<Omit<BoothPageSponsor, 'has_logo'> & { has_logo: number }>();
    return (rs.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      display_name: r.display_name,
      website_url: r.website_url,
      has_logo: Number(r.has_logo) === 1,
    }));
  } catch {
    return [];
  }
}

/**
 * The fair behind a public stall address, under the public event read's own
 * rule (only a live event is public), or the response to send instead: the
 * one 404 for an id that cannot be one, an unknown event or one that is not
 * public, and 503 when the database cannot answer. The stall page and the
 * stall list both open through here, so they never disagree.
 */
export async function readPublicFair(
  env: BoothPageEnv,
  eventId: string
): Promise<{ fair: FairRow; db: D1Database } | { response: Response }> {
  if (!env.DB) return { response: boothUnavailable() };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) return { response: boothNotFound() };
  let fair: FairRow | null;
  try {
    fair = await env.DB.prepare(
      `SELECT id, brand_id, title, slug, status, is_published, start_date, starts_at, timezone,
              ${passportOnSql()} AS passport
         FROM events WHERE id = ? LIMIT 1`
    )
      .bind(eventId)
      .first<FairRow>();
  } catch {
    return { response: boothUnavailable() };
  }
  // The public event read's own rule: only a live event is public.
  if (!fair || !canRender(parseEventState(fair.status ?? ''), 'public')) {
    return { response: boothNotFound() };
  }
  return { fair, db: env.DB };
}

/**
 * A rendered stall page as sent: private and short (a stall can close, or a
 * sponsor leave, at any time), and not indexed when the fair is off the map.
 */
export function fairPageResponse(body: string, noindex: boolean): Response {
  const res = html(body);
  res.headers.set('Cache-Control', 'private, max-age=60');
  if (noindex) res.headers.set('X-Robots-Tag', 'noindex');
  return res;
}

export async function handleBoothPage(
  _request: Request,
  env: BoothPageEnv,
  eventId: string,
  rawNumber: string
): Promise<Response> {
  if (!env.DB) return boothUnavailable();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) return boothNotFound();
  const number = parseBoothNumberSegment(rawNumber);
  if (number === null) return boothNotFound();

  const read = await readPublicFair(env, eventId);
  if ('response' in read) return read.response;
  const { fair, db } = read;

  let booth;
  try {
    booth = await fetchPublicBoothByNumber(db, fair.id, fair.brand_id, number);
  } catch {
    return boothUnavailable();
  }
  if (!booth) return boothNotFound();

  const sponsors = await fetchFairSponsors(db, fair.id);
  // Stamp passport (lib/passport.ts): the card needs every stop in use. A read
  // that fails leaves the stall page as it was, with no card.
  let passportStops: string[] | null = null;
  if (fair.passport === 1) {
    try {
      passportStops = (await readPublicBoothsOf(db, fair.id, fair.brand_id)).map((b) => b.number);
    } catch {
      passportStops = null;
    }
  }
  // Open by link but off the map, as the fair's own page is: not indexed.
  const noindex = fair.is_published !== 1;
  return fairPageResponse(
    renderBoothPage({
      event: { id: fair.id, title: fair.title, slug: fair.slug },
      when: formatEventWhen(fair),
      booth,
      sponsors,
      noindex,
      passportStops,
    }),
    noindex
  );
}
