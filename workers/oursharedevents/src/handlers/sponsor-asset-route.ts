/**
 * Sponsor asset serve route (OSE-735 / T7b) — extends the OSE-288 logo pipeline.
 *
 * GET /api/v2/sponsors/:id/asset/:format
 *   ALWAYS returns 200 image bytes for an existing sponsor, for every one of the
 *   four formats. The decision comes from the pure resolveAssetSource() core
 *   (T7a); this route wires the three sinks:
 *     r2       → read the R2 object (production/derived render)
 *     proxy    → fetchAndProxyLogo() (the existing OSE-288 proxy)
 *     monogram → a generated UEC monogram (terminal fallback, always available)
 *
 * The always-200 guarantee (headline #25: a sponsor missing 3 of 4 formats is
 * never dropped from a surface) holds even when UPLOADS_BUCKET is unbound and
 * even when the proxied logo fetch fails — both fall through to the monogram.
 *
 * The legacy GET /:id/logo route stays as a back-compat alias with its
 * unchanged OSE-288 contract (handled separately in the router).
 *
 * Monogram color: derived deterministically from the sponsor id (HSL from a
 * seed hash) — NO hardcoded brand hex (#3). Reading the brain UEC palette to
 * brand the monogram is a documented follow-up; the always-200 invariant does
 * not depend on it (T7a proves totality independent of any palette source).
 */

import {
  resolveAssetSource,
  isAssetFormat,
  type AssetFormat,
  type AssetResolvable,
} from '../lib/sponsor-asset';
import { fetchAndProxyLogo } from '../lib/sponsor-logo';

export interface SponsorAssetRouteEnv {
  DB: D1Database;
  UPLOADS_BUCKET?: R2Bucket;
}

interface SponsorAssetRow extends AssetResolvable {
  name?: string | null;
}

function jsonErr(code: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function seedHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a deterministic UEC monogram as an SVG. Pure. The background hue is
 * derived from the sponsor id hash (no brand hex literal); the glyph is the
 * first letter of the sponsor's name (or id). Always renders — the terminal
 * always-200 sink.
 */
export function generateMonogramSvg(seed: string, label: string): string {
  const hue = seedHash(seed) % 360;
  const letter = (label || seed || '?').trim().charAt(0).toUpperCase() || '?';
  const aria = escapeXml(label || seed);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" ` +
    `role="img" aria-label="${aria}">` +
    `<rect width="400" height="400" fill="hsl(${hue} 45% 45%)"/>` +
    `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" ` +
    `font-family="system-ui, -apple-system, sans-serif" font-size="220" ` +
    `fill="hsl(${hue} 30% 96%)">${escapeXml(letter)}</text></svg>`
  );
}

function monogramResponse(seed: string, label: string): Response {
  return new Response(generateMonogramSvg(seed, label), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handleSponsorAsset(
  _request: Request,
  env: SponsorAssetRouteEnv,
  sponsorId: string,
  format: string
): Promise<Response> {
  if (!isAssetFormat(format)) return jsonErr('BAD_FORMAT', 400);
  const fmt: AssetFormat = format;

  // OSE-799 A2: creative now lives one-row-per-format in sponsor_asset. Pivot the
  // rows back into the flat {logo,poster,banner,vertical,square}_url shape the pure
  // resolveAssetSource() core reads — identity (id, name) from sponsor_business.
  const sponsor = await env.DB.prepare(
    `SELECT sb.id AS id, sb.name AS name,
            MAX(CASE WHEN la.format = 'logo' THEN la.url END)     AS logo_url,
            MAX(CASE WHEN la.format = 'poster' THEN la.url END)   AS poster_url,
            MAX(CASE WHEN la.format = 'banner' THEN la.url END)   AS banner_url,
            MAX(CASE WHEN la.format = 'vertical' THEN la.url END) AS vertical_url,
            MAX(CASE WHEN la.format = 'square' THEN la.url END)   AS square_url
       FROM sponsor_business sb
       LEFT JOIN sponsor_asset la ON la.sponsor_business_id = sb.id
      WHERE sb.id = ?
        -- OSE-1301: this public unauthenticated route serves creative or a
        -- name-bearing monogram fallback, so it is a consent-traced render
        -- surface just like the event page, resolver Path 1, and reports.
        AND EXISTS (
          SELECT 1 FROM sponsor_placement sp
           WHERE sp.sponsor_business_id = sb.id
             AND sp.is_active = 1
             AND COALESCE(sp.organizer_accepted, 1) = 1
             AND sp.sponsor_accepted = 1
        )
      GROUP BY sb.id, sb.name`
  )
    .bind(sponsorId)
    .first<SponsorAssetRow>();
  if (!sponsor) return jsonErr('NOT_FOUND', 404);

  const src = resolveAssetSource(sponsor, fmt);

  // r2 → serve the object; if the bucket is unbound or the object is missing,
  // fall through (never fail the request — the sponsor must not drop off a surface).
  if (src.kind === 'r2' && env.UPLOADS_BUCKET) {
    const obj = await env.UPLOADS_BUCKET.get(src.key);
    if (obj) {
      return new Response(obj.body, {
        status: 200,
        headers: {
          'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
  }

  // proxy → the existing OSE-288 logo proxy. On any failure, fall through.
  if (sponsor.logo_url) {
    const proxied = await fetchAndProxyLogo(sponsor.logo_url);
    if (proxied.ok && proxied.response) return proxied.response;
  }

  // terminal → generated monogram. Always 200.
  return monogramResponse(sponsor.id, sponsor.name ?? sponsor.id);
}
