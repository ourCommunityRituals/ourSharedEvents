/**
 * GET /sponsors/:id — the public sponsor card (migration 0083).
 *
 * Where a tap on a sponsor lands when it has no https website: its title,
 * location and contact, each optional and each entered by the sponsor to be
 * found. Only a sponsor that is actually on show is reachable: an active
 * business with an active placement, accepted by both sides, on an event whose
 * public page renders. A pool sponsor nobody has placed yet, or one placed only
 * on a draft, 404s — so the card cannot enumerate a brand's pool or publish a
 * sponsor's contact details before its event is public.
 */

import { html, renderErrorPage } from './pages';
import { isPublicReadLimited, type PublicReadLimitEnv } from '../lib/public-read-limit';
import { publicWebsiteUrl } from '../lib/sponsor-resolver';
import { renderSponsorCardPage } from '../lib/sponsor-card-render';
import { SPONSOR_ON_SHOW_SQL } from '../lib/sponsor-card';
import { msg } from '../lib/i18n/catalog';
import { DEFAULT_LANG, type Lang } from '../lib/i18n/languages';
import { withLangPrefix } from '../lib/i18n/path-prefix';

export interface SponsorCardEnv extends PublicReadLimitEnv {
  DB?: D1Database;
}

export async function handleSponsorCardPage(
  request: Request,
  env: SponsorCardEnv,
  sponsorId: string,
  lang: Lang = DEFAULT_LANG
): Promise<Response> {
  const error = (status: number, title: string, body: string) =>
    renderErrorPage(
      status,
      title,
      body,
      withLangPrefix(lang, '/events'),
      msg(lang, 'footer.browse'),
      { lang }
    );
  if (await isPublicReadLimited(request, env, 'sponsor-card')) {
    return error(429, msg(lang, 'sponsorCard.limitTitle'), msg(lang, 'sponsorCard.limitBody'));
  }
  const notFound = () =>
    error(404, msg(lang, 'sponsorCard.notFoundTitle'), msg(lang, 'sponsorCard.notFoundBody'));
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
        WHERE sb.id = ? AND ${SPONSOR_ON_SHOW_SQL}
        LIMIT 1`
    )
      .bind(sponsorId)
      .first();
  } catch {
    return error(503, msg(lang, 'sponsorCard.errorTitle'), msg(lang, 'sponsorCard.errorBody'));
  }
  if (!row) return notFound();

  return html(
    renderSponsorCardPage(
      {
        ...row,
        website_url: publicWebsiteUrl(row.website_url),
        has_logo: Number(row.has_logo) === 1,
      },
      lang
    )
  );
}
