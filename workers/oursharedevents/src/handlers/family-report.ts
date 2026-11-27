/**
 * The parent company's family report (Part of OSE-2241).
 *
 *   GET  /api/v2/admin/brands/:brand/family-report            the report (admin, brand in scope)
 *   POST /api/v2/admin/brands/:brand/family-report/mint-link  a signed link to share it (admin, audited)
 *   GET  /api/v2/family-report                                the report by signed link (Bearer token)
 *   GET  /family-report?token=…                               the page a corporate sponsor opens
 *
 * Owner, 2026-11-27: one report that sits over a parent company's ventures and
 * shows all the traffic, the events and the sponsor traffic, so the company
 * can tell a corporate sponsor "this is what our one company brings to the
 * table". What it holds and how it is floored: lib/family-report.ts.
 *
 * ISOLATION (#9). The admin routes read a brand only when it is in the
 * caller's scope (a member of the parent reaches the family through the brand
 * tree; a venture's member reaches only its venture, never the parent). A
 * brand out of scope is 404, the same as an unknown one. The platform and
 * public brands have no family report. The signed link names one brand and is
 * checked again at every read; it never widens to another brand.
 */
import { cellToBoundary, isValidCell } from 'h3-js';
import { esc } from '@ocr/ui';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import { corsHeaders } from '../lib/cors';
import type { FlooredCount } from '../lib/count-floor';
import { errorLabel } from '../lib/error-label';
import {
  buildFamilyReport,
  familyBrandAllowed,
  type FamilyDataClass,
  type FamilyReport,
} from '../lib/family-report';
import {
  FAMILY_LINK_DEFAULT_DAYS,
  FAMILY_LINK_MAX_DAYS,
  mintFamilyToken,
  verifyFamilyToken,
  type FamilyReportAuthEnv,
} from '../lib/family-report-auth';
import { HARDENING_HEADERS } from '../lib/security-headers';
import { fewerThan } from '../lib/withheld-words';
import { bocceBrandName } from './demo-bocce';
import { DEMO_BRANDS, type DemoBrand } from './demo';

export interface FamilyReportEnv extends AdminEnv, AdminBrandScopeEnv, FamilyReportAuthEnv {
  DB: D1Database;
}

function rid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function json(request: Request, reqId: string, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Request-Id': reqId,
    },
  });
}

function fail(request: Request, reqId: string, status: number, code: string, error: string) {
  return json(request, reqId, { ok: false, status, code, error, requestId: reqId }, status);
}

async function read(
  env: FamilyReportEnv,
  reqId: string,
  brand: string,
  dc: FamilyDataClass
): Promise<FamilyReport | null> {
  try {
    return await buildFamilyReport(env.DB, brand, dc);
  } catch (e) {
    console.error(
      JSON.stringify({ type: 'FAMILY_REPORT_DB_ERROR', requestId: reqId, error: errorLabel(e) })
    );
    return null;
  }
}

/** The brand, when the caller may read its family; otherwise null (answered 404). */
async function brandInScope(
  request: Request,
  env: FamilyReportEnv,
  brand: string
): Promise<boolean> {
  if (!familyBrandAllowed(brand)) return false;
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  return scope.mode === 'all' || (scope.mode === 'scoped' && scope.brandIds.includes(brand));
}

function dataClassOf(v: unknown): FamilyDataClass | null {
  if (v === undefined || v === null) return 'production';
  return v === 'production' || v === 'all' ? v : null;
}

// ─── GET /api/v2/admin/brands/:brand/family-report ───────────────────────────

export async function handleAdminFamilyReport(
  request: Request,
  env: FamilyReportEnv,
  brand: string
): Promise<Response> {
  const reqId = rid();
  const dc = dataClassOf(new URL(request.url).searchParams.get('data_class'));
  if (!dc) {
    return fail(request, reqId, 400, 'INVALID_FILTER', "data_class must be 'production' or 'all'");
  }
  if (!(await brandInScope(request, env, brand))) {
    return fail(request, reqId, 404, 'NOT_FOUND', 'Brand not found');
  }
  const report = await read(env, reqId, brand, dc);
  if (!report) return fail(request, reqId, 503, 'DB_UNAVAILABLE', 'The report could not be read');
  return json(request, reqId, { ok: true, ...report });
}

// ─── POST /api/v2/admin/brands/:brand/family-report/mint-link ────────────────

export async function handleAdminMintFamilyLink(
  request: Request,
  env: FamilyReportEnv,
  brand: string
): Promise<Response> {
  const reqId = rid();
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(request, reqId, 400, 'BAD_REQUEST', 'The body must be a JSON object');
  }
  const dc = dataClassOf(body.data_class);
  if (!dc) {
    return fail(request, reqId, 400, 'BAD_REQUEST', "data_class must be 'production' or 'all'");
  }
  const days = body.ttl_days === undefined ? FAMILY_LINK_DEFAULT_DAYS : body.ttl_days;
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > FAMILY_LINK_MAX_DAYS
  ) {
    return fail(
      request,
      reqId,
      400,
      'BAD_REQUEST',
      `ttl_days must be a whole number from 1 to ${FAMILY_LINK_MAX_DAYS}`
    );
  }
  if (!(await brandInScope(request, env, brand))) {
    return fail(request, reqId, 404, 'NOT_FOUND', 'Brand not found');
  }
  const token = await mintFamilyToken(env, brand, dc, days * 86400);
  if (!token) {
    return fail(request, reqId, 503, 'CONFIGURATION_ERROR', 'Report links are not set up');
  }
  return json(request, reqId, {
    ok: true,
    brand,
    token,
    path: `/family-report?token=${encodeURIComponent(token)}`,
    expires_at: new Date(Date.now() + days * 86400 * 1000).toISOString(),
  });
}

// ─── GET /api/v2/family-report (Authorization: Bearer <token>) ───────────────

function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

/** The rate-limit bucket of a link read: the token, so one link holder cannot poll past it. */
export function familyReportBucketKey(request: Request): string | null {
  const t = bearer(request) ?? new URL(request.url).searchParams.get('token');
  return t ? `family-token:${t.slice(-32)}` : null;
}

export async function handlePublicFamilyReport(
  request: Request,
  env: FamilyReportEnv
): Promise<Response> {
  const reqId = rid();
  const claim = await verifyFamilyToken(env, bearer(request));
  if (!claim || !familyBrandAllowed(claim.brand)) {
    return fail(request, reqId, 401, 'UNAUTHORIZED', 'A valid report link is required');
  }
  const report = await read(env, reqId, claim.brand, claim.dc);
  if (!report) return fail(request, reqId, 503, 'DB_UNAVAILABLE', 'The report could not be read');
  return json(request, reqId, {
    ok: true,
    ...report,
    expires_at: new Date(claim.exp * 1000).toISOString(),
  });
}

// ─── GET /family-report?token=… (the page) ───────────────────────────────────

function nameOf(brand: string): string {
  return bocceBrandName(brand) ?? brand;
}

function countText(c: FlooredCount): string {
  return c.count === null ? fewerThan(c.floor) : c.count.toLocaleString('en-US');
}

/** Two floored counts added: each is already floored, so the sum is too. */
function plus(a: FlooredCount, b: FlooredCount): string {
  const n = (a.count ?? 0) + (b.count ?? 0);
  return n === 0 ? fewerThan(a.floor) : n.toLocaleString('en-US');
}

/**
 * The footprint: the map cells drawn as hexagons on a plain canvas (no map
 * tiles, no third party, no script). The cells are res 7 (about 5 km²), so a
 * hexagon is an area, never an address. A cell with more scans is drawn
 * stronger; the shade is a bucket of the floored count, never the count.
 */
export function footprintSvg(cells: FamilyReport['footprint']): string {
  const shapes = cells
    .filter((c) => isValidCell(c.cell))
    .map((c) => ({ c, ring: cellToBoundary(c.cell) as Array<[number, number]> }));
  if (shapes.length === 0) return '';
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const { ring } of shapes)
    for (const [lat, lng] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = Math.max((maxLng - minLng) * k, 1e-6);
  const h = Math.max(maxLat - minLat, 1e-6);
  const W = 320;
  const pad = 12;
  const scale = (W - pad * 2) / Math.max(w, h * 1.6);
  const H = Math.round(h * scale + pad * 2);
  const max = Math.max(1, ...shapes.map(({ c }) => c.poster_scans.count ?? 0));
  const polys = shapes
    .map(({ c, ring }) => {
      const pts = ring
        .map(
          ([lat, lng]) =>
            `${(pad + (lng - minLng) * k * scale).toFixed(1)},${(pad + (maxLat - lat) * scale).toFixed(1)}`
        )
        .join(' ');
      const n = c.poster_scans.count ?? 0;
      const shade = n === 0 ? 0.25 : n >= max * 0.66 ? 0.95 : n >= max * 0.33 ? 0.7 : 0.45;
      const label = `${c.events} event${c.events === 1 ? '' : 's'}, ${countText(c.poster_scans)} scans`;
      return `<polygon class="fp-cell" points="${pts}" fill-opacity="${shade}"><title>${esc(label)}</title></polygon>`;
    })
    .join('');
  const plotW = Math.round(w * scale + pad * 2);
  return `<svg class="fp-map" viewBox="0 0 ${Math.max(plotW, 120)} ${Math.max(H, 80)}" role="img" aria-labelledby="fp-h fp-d">${polys}</svg>`;
}

function rows(
  head: [string, string, string],
  body: Array<[string, string, string]>,
  id: string
): string {
  if (body.length === 0) return '<p class="fr-note">Nothing yet.</p>';
  return `<table class="ladder" id="${id}">
    <thead><tr>${head.map((x) => `<th scope="col">${esc(x)}</th>`).join('')}</tr></thead>
    <tbody>${body
      .map(
        ([a, b, c]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td><td>${esc(c)}</td></tr>`
      )
      .join('')}</tbody></table>`;
}

const PAGE_STYLE = `<style>
.fr-wrap{max-width:960px;margin:0 auto;padding:1rem;overflow-wrap:anywhere}
.fr-hero h1{margin:.5rem 0 .25rem}
.fr-note{color:var(--text-muted);font-size:.85rem}
.fr-tiles{display:grid;gap:.75rem;grid-template-columns:repeat(2,minmax(0,1fr))}
@media(min-width:720px){.fr-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.fr-tile{border:1px solid var(--border);border-radius:.75rem;padding:.85rem;background:var(--surface)}
.fr-num{font-size:1.6rem;font-weight:800}
.fr-sec{margin:1.75rem 0}
.fr-sec>h2{border-bottom:1px solid var(--border);padding-bottom:.4rem}
.fp-map{width:100%;max-width:520px;max-height:340px;height:auto;display:block;background:var(--surface);border-radius:.75rem}
.fp-cell{fill:var(--accent);stroke:var(--bg);stroke-width:1}
.ladder{width:100%;border-collapse:collapse}
.ladder th,.ladder td{text-align:left;padding:.6rem .5rem;border-bottom:1px solid var(--border);font-size:.9rem}
.ladder thead th{color:var(--text-muted);font-size:.75rem;text-transform:uppercase;white-space:nowrap}
</style>`;

function page(body: string, status: number, brand?: string): Response {
  const brandAttr =
    brand && (DEMO_BRANDS as readonly string[]).includes(brand)
      ? ` data-brand="${brand as DemoBrand}"`
      : '';
  const doc = `<!DOCTYPE html>
<html lang="en"${brandAttr}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Family report — ourSharedEvents</title>
<link rel="stylesheet" href="/ui.css">
${PAGE_STYLE}
</head>
<body>
<main id="main-content" class="fr-wrap">${body}</main>
</body>
</html>`;
  return new Response(doc, {
    status,
    headers: {
      ...HARDENING_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

export function renderFamilyReportPage(r: FamilyReport, expiresAt: string): string {
  const t = r.totals;
  const parent = nameOf(r.family.parent);
  const ventures = r.by_venture.map((l) => [
    `${nameOf(l.brand)}${l.role === 'parent' ? ' (own events)' : ''}`,
    `${l.events}`,
    plus(l.poster_scans, l.link_taps),
  ]) as Array<[string, string, string]>;
  const sponsorRows = r.by_venture
    .filter((l) => l.sponsors_on_show > 0 || l.sponsor_displays.count || l.sponsor_taps.count)
    .map((l) => [
      nameOf(l.brand),
      countText(l.sponsor_displays),
      countText(l.sponsor_taps),
    ]) as Array<[string, string, string]>;
  const map = footprintSvg(r.footprint);
  return `
  <section class="fr-hero" aria-labelledby="fr-h">
    <h1 id="fr-h">${esc(parent)}</h1>
    <p class="fr-note">One report over ${t.ventures} brand${t.ventures === 1 ? '' : 's'}: the company and every venture below it.
    Traffic on every code, never people.</p>
    <div class="fr-tiles">
      <div class="fr-tile"><div class="fr-num">${esc(plus(t.poster_scans, t.link_taps))}</div><div class="fr-note">Scans and taps, every venture</div></div>
      <div class="fr-tile"><div class="fr-num">${t.events}</div><div class="fr-note">Events</div></div>
      <div class="fr-tile"><div class="fr-num">${esc(plus(t.sponsor_displays, t.sponsor_taps))}</div><div class="fr-note">Sponsor displays and taps</div></div>
      <div class="fr-tile"><div class="fr-num">${t.map_cells}</div><div class="fr-note">Areas on the map</div></div>
    </div>
  </section>
  <section class="fr-sec" aria-labelledby="fp-h">
    <h2 id="fp-h">Footprint</h2>
    <p class="fr-note" id="fp-d">${t.map_cells} area${t.map_cells === 1 ? '' : 's'} and ${t.venues} venue${t.venues === 1 ? '' : 's'}. Each hexagon is a neighbourhood-sized area (about 5 km²), never an address; a darker one carries more scans.</p>
    ${map}
  </section>
  <section class="fr-sec" aria-labelledby="v-h">
    <h2 id="v-h">By venture</h2>
    ${rows(['Venture', 'Events', 'Scans and taps'], ventures, 'by-venture')}
    <p class="fr-note">Each venture is counted on its own before it is added: a count under 5 is withheld and reads "${esc(fewerThan())}", and from 5 up each figure is rounded down to a multiple of 5.</p>
  </section>
  <section class="fr-sec" aria-labelledby="s-h">
    <h2 id="s-h">Sponsor reach</h2>
    <p class="fr-note">${t.businesses_on_show} sponsor${t.businesses_on_show === 1 ? '' : 's'} on show across the family. A sponsor appears only where the sponsor and the organizer both said yes.</p>
    ${r.sponsors.length ? `<p>${r.sponsors.map((s) => esc(s)).join(' · ')}</p>` : ''}
    ${rows(['Venture', 'Logo displays', 'Sponsor taps'], sponsorRows, 'by-sponsor-venture')}
  </section>
  <section class="fr-sec" aria-labelledby="ve-h">
    <h2 id="ve-h">By venue</h2>
    ${rows(
      ['Venue', 'Events', 'Scans'],
      r.by_venue.map((v) => [v.name, `${v.events}`, countText(v.poster_scans)]),
      'by-venue'
    )}
  </section>
  <section class="fr-sec" aria-labelledby="n-h">
    <h2 id="n-h">By night</h2>
    ${rows(
      ['Night', 'Events', 'Scans'],
      r.by_night.map((n) => [n.night, `${n.events}`, countText(n.poster_scans)]),
      'by-night'
    )}
  </section>
  <p class="fr-note">${r.scope.data_class === 'all' ? 'Includes practice data. ' : ''}Read ${esc(r.generated_at.slice(0, 10))}. This link works until ${esc(expiresAt.slice(0, 10))}.</p>`;
}

export async function handleFamilyReportPage(
  request: Request,
  env: FamilyReportEnv
): Promise<Response> {
  const reqId = rid();
  const claim = await verifyFamilyToken(env, new URL(request.url).searchParams.get('token'));
  if (!claim || !familyBrandAllowed(claim.brand)) {
    return page(
      `<section class="fr-hero"><h1>This report link is not valid</h1>
      <p class="fr-note">It may have expired. Ask the company that shared it for a new link.</p></section>`,
      401
    );
  }
  const report = await read(env, reqId, claim.brand, claim.dc);
  if (!report) {
    return page(
      `<section class="fr-hero"><h1>The report could not be read</h1><p class="fr-note">Please try again in a minute.</p></section>`,
      503
    );
  }
  return page(
    renderFamilyReportPage(report, new Date(claim.exp * 1000).toISOString()),
    200,
    claim.brand
  );
}
