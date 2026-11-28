/**
 * GET /events/:id/booths — the public list of a fair's stalls (OSE-1998, OSE
 * ADR-034 decisions 1 and 5): every stall in use, grouped by category, each a
 * link to its own page (GET /events/:id/booths/:number).
 *
 * It opens under the stall page's own rule, through the same read
 * (`readPublicFair` in booth-page.ts): an event the public event read answers
 * (`active`). An unknown event, an event that is not public, and a public event
 * with no stall in use all answer the stall page's one 404, so a probe learns
 * nothing from which one it hit, nor whether a fair has stalls at all.
 *
 * Anonymity: no cookie is read or set, no address is stored, and the page
 * shows no count of any kind. The rate limit is applied at the route.
 */

import { formatEventWhen } from './pages';
import {
  boothNotFound,
  boothUnavailable,
  fairPageResponse,
  fetchFairSponsors,
  readPublicFair,
  type BoothPageEnv,
} from './booth-page';
import { readPublicBoothsOf, type PublicBooth } from '../lib/public-booths';
import { renderBoothListPage } from '../lib/booth-list-render';

export async function handleBoothListPage(
  _request: Request,
  env: BoothPageEnv,
  eventId: string
): Promise<Response> {
  const read = await readPublicFair(env, eventId);
  if ('response' in read) return read.response;
  const { fair, db } = read;

  let booths: PublicBooth[];
  try {
    booths = await readPublicBoothsOf(db, fair.id, fair.brand_id);
  } catch {
    return boothUnavailable();
  }
  // A fair with no stall in use has no list: the same 404 as an unknown fair.
  if (booths.length === 0) return boothNotFound();

  const sponsors = await fetchFairSponsors(db, fair.id);
  // Open by link but off the map, as the fair's own page is: not indexed.
  const noindex = fair.is_published !== 1;
  return fairPageResponse(
    renderBoothListPage({
      event: { id: fair.id, title: fair.title, slug: fair.slug },
      when: formatEventWhen(fair),
      booths,
      sponsors,
      noindex,
      passport: fair.passport === 1,
    }),
    noindex
  );
}
