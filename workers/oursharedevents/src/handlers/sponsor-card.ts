/**
 * GET /sponsors/:id — the public sponsor card (migration 0082).
 *
 * Where a tap on a sponsor lands when it has no https website: its title,
 * location and contact, each optional and each entered by the sponsor to be
 * found. Only a sponsor that is actually on show is reachable — the same gate
 * the public surfaces use (active business, an active placement both sides
 * accepted). A pool sponsor that nobody has placed yet 404s, so the card cannot
 * be used to enumerate a brand's pool.
 */

import { html, renderErrorPage } from './pages';
import { isPublicReadLimited, type PublicReadLimitEnv } from '../lib/public-read-limit';
import { publicWebsiteUrl } from '../lib/sponsor-resolver';
import { renderSponsorCardPage } from '../lib/sponsor-card-render';

export interface SponsorCardEnv extends PublicReadLimitEnv {
  DB?: D1Database;
}

export async function handleSponsorCardPage(
  request: Request,
  env: SponsorCardEnv,
  sponsorId: string
): Promise<Response> {
  if (await isPublicReadLimited(request, env, 'sponsor-card')) {
    return renderErrorPage(429, 'Too many requests', 'Give it a minute and try again.');
  }
  const notFound = () =>
    renderErrorPage(404, 'Sponsor not found', 'This sponsor is not on show right now.');
  if (!env.DB || !/^[A-Za-z0-9_-]{1,128}$/.test(sponsorId)) return notFound();

  let row: {
    id: string;
    name: string;
    display_name: string | null;
    address_line: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    website_url: string | null;
    has_logo: number;
  } | null;
  try {
    row = await env.DB.prepare(
      `SELECT sb.id, sb.name, sb.display_name, sb.address_line, sb.contact_phone,
              sb.contact_email, sb.website_url,
              EXISTS (SELECT 1 FROM sponsor_asset la
                       WHERE la.sponsor_business_id = sb.id AND la.format = 'logo'
                         AND la.url IS NOT NULL) AS has_logo
         FROM sponsor_business sb
        WHERE sb.id = ? AND sb.is_active = 1
          AND EXISTS (
            SELECT 1 FROM sponsor_placement sp
             WHERE sp.sponsor_business_id = ?
               AND sp.sponsor_business_id = sb.id AND sp.is_active = 1
               AND COALESCE(sp.organizer_accepted, 1) = 1
               AND sp.sponsor_accepted = 1
          )
        LIMIT 1`
    )
      .bind(sponsorId, sponsorId)
      .first();
  } catch {
    return renderErrorPage(503, 'Something went wrong', 'Try again in a moment.');
  }
  if (!row) return notFound();

  return html(
    renderSponsorCardPage({
      ...row,
      website_url: publicWebsiteUrl(row.website_url),
      has_logo: Number(row.has_logo) === 1,
    })
  );
}
