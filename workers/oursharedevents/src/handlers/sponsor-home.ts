/**
 * Sponsor home — the sponsor corner of the triangle.
 *
 *   POST /api/v2/admin/sponsors/:id/home-link       (admin, brand-scoped, audited)
 *        → mints a 30-day sponsor-home token, returns the URL to hand over
 *   GET  /sponsor?t=<token>                           (public, token-gated, read-limited)
 *        → server-rendered page: every placement this sponsor holds, joined to
 *          its event, with state (live / coming up / done), the public event
 *          link when it is live, a sponsor-scoped SharedReport link once the
 *          event is active or over, and Accept / Decline for the placement
 *   POST /api/v2/sponsor/placements/:id/respond      (public, token in body, read-limited)
 *        → sets sponsor_placement.sponsor_accepted for a placement the token's
 *          sponsor owns; audited under actor `sponsor:<id>`
 *
 * WHY THIS EXISTS. The organizer already controls which sponsors appear
 * (admin sponsors card) and the report already gives each side its own view.
 * What was missing was the sponsor's SIDE OF THE TABLE: a screen to come back
 * to. `sponsor_placement.sponsor_accepted` (migration 0068) was designed for
 * exactly this and nothing could set it. Now the resolver's strict
 * `sponsor_accepted = 1` gate (ADR-019, "silence != consent": pending NULL and
 * declined 0 both stay off every public surface until the sponsor accepts here)
 * has a hand on the switch.
 *
 * SECURITY POSTURE.
 *   - No login. A signed, expiring, sponsor-scoped bearer (lib/sponsor-home-auth)
 *     minted by an authenticated organizer inside their brand scope (#9). The
 *     mint is rate-limited and audited like the report mint.
 *   - Every read on this page is bound to `sb.id = ? AND sb.brand_id = ?` from
 *     the SIGNED claim — never from the query string.
 *   - The respond endpoint re-verifies the token and proves the placement's
 *     sponsor_business_id equals the claim's sponsor_id before writing; a miss
 *     is 404, not 403 (no enumeration oracle).
 *   - The page never renders attendee data. Counts live in the SharedReport,
 *     behind its own token and k-anonymity floor.
 *   - `noindex` + `Cache-Control: no-store` + the same nonce CSP as every page.
 */

import { html, renderErrorPage } from './pages';
import { invalidateSponsorsCache } from '../lib/data-provider';
import { parseEventState } from '../domain/event-state';
import { renderSponsorHomePage, type PlacementRow } from '../lib/sponsor-home-render';
import { corsHeaders } from '../lib/cors';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import { isPublicReadLimited, type PublicReadLimitEnv } from '../lib/public-read-limit';
import { logAdminAction } from '../lib/audit-log';
import {
  mintSponsorHomeToken,
  verifySponsorHomeToken,
  SPONSOR_HOME_TTL_SECONDS,
  type SponsorHomeAuthEnv,
} from '../lib/sponsor-home-auth';
import { mintSignedLinkToken, type SharedReportAuthEnv } from '../lib/shared-report-auth';

export interface SponsorHomeEnv
  extends
    AdminEnv,
    AdminBrandScopeEnv,
    SponsorHomeAuthEnv,
    SharedReportAuthEnv,
    PublicReadLimitEnv {
  DB?: D1Database;
}

function rid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function jsonError(code: string, message: string, status: number, id: string): Response {
  return Response.json(
    { ok: false, status, code, error: message, requestId: id },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': id } }
  );
}

// ─── Admin: mint the sponsor's home link ─────────────────────────────────────

export async function handleAdminMintSponsorHomeLink(
  request: Request,
  env: SponsorHomeEnv,
  sponsorId: string
): Promise<Response> {
  const id = rid();
  if (!env.DB) return jsonError('DB_NOT_CONFIGURED', 'Database not available', 503, id);

  // OSE-710 / #9: the sponsor must be inside the caller's server-derived brand
  // scope. Out-of-scope and non-existent are indistinguishable (404).
  const actor = extractAdminActor(request, env);
  const scope = await resolveAdminBrandScopeAsync(actor, env);
  if (scope.mode === 'deny')
    return jsonError('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, id);

  const scopeSql =
    scope.mode === 'scoped' ? ` AND brand_id IN (${scope.brandIds.map(() => '?').join(', ')})` : '';
  const binds: string[] = [sponsorId, ...(scope.mode === 'scoped' ? scope.brandIds : [])];
  const row = await env.DB.prepare(
    `SELECT id, brand_id, name FROM sponsor_business WHERE id = ?${scopeSql} LIMIT 1`
  )
    .bind(...binds)
    .first<{ id: string; brand_id: string; name: string }>();
  if (!row) return jsonError('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, id);

  const minted = await mintSponsorHomeToken(env, row.id, row.brand_id, SPONSOR_HOME_TTL_SECONDS);
  if (!minted) {
    return jsonError(
      'SIGNING_NOT_CONFIGURED',
      'Sponsor links are not enabled on this deployment',
      503,
      id
    );
  }
  const origin = new URL(request.url).origin;
  const url = `${origin}/sponsor?t=${minted.token}`;

  await logAdminAction(env as { DB: D1Database }, {
    action: 'MINT_SPONSOR_HOME_LINK',
    actor,
    resource_type: 'sponsor',
    resource_id: row.id,
    request_id: id,
    outcome: 'success',
    details: { exp: minted.exp },
  });

  return Response.json(
    { ok: true, status: 200, url, expiresAt: new Date(minted.exp * 1000).toISOString() },
    { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': id } }
  );
}

// ─── Public: the sponsor's page ──────────────────────────────────────────────

// PlacementRow + humanDate + the page markup now live in lib/sponsor-home-render
// (CCR-PR567 re-run items 6/8 — a pure, a11y- + XSS-testable render).

function invalidLinkPage(): Response {
  return renderErrorPage(
    401,
    'This sponsor link isn’t valid',
    'It may have expired, or it was copied incompletely. Ask the event organizer for a fresh link.',
    '/events',
    'See what’s happening'
  );
}

export async function handleSponsorHomePage(
  request: Request,
  env: SponsorHomeEnv
): Promise<Response> {
  if (await isPublicReadLimited(request, env, 'sponsor-home')) {
    return renderErrorPage(429, 'Too many requests', 'Give it a minute and try again.');
  }
  const url = new URL(request.url);
  const claim = await verifySponsorHomeToken(env, url.searchParams.get('t'));
  if (!claim || !env.DB) return invalidLinkPage();

  const sponsor = await env.DB.prepare(
    'SELECT id, name, is_active FROM sponsor_business WHERE id = ? AND brand_id = ? LIMIT 1'
  )
    .bind(claim.sponsor_id, claim.brand_id)
    .first<{ id: string; name: string; is_active: number }>();
  if (!sponsor || Number(sponsor.is_active) === 0) return invalidLinkPage();

  const rows = await env.DB.prepare(
    `SELECT sp.id AS placement_id, sp.event_id, sp.tier, COALESCE(sp.locality_band, 0) AS locality_band,
            sp.organizer_accepted, sp.sponsor_accepted, sp.is_active AS placement_active,
            e.title, e.status, e.start_date, e.end_date, e.location, e.is_published
       FROM sponsor_placement sp
       JOIN events e ON e.id = sp.event_id
      WHERE sp.sponsor_business_id = ? AND e.brand_id = ? AND sp.is_active = 1
      ORDER BY CASE WHEN e.start_date IS NULL THEN 1 ELSE 0 END, e.start_date ASC, e.created_at DESC
      LIMIT 200`
  )
    .bind(sponsor.id, claim.brand_id)
    .all<PlacementRow>();
  const placements = rows.results ?? [];

  // Pre-mint the sponsor-scoped SharedReport links (async, env-bound) into a
  // lookup so the page render stays PURE — a11y- + XSS-testable with no env/DB
  // (CCR-PR567 re-run items 6/8). Only active/archived placements have a report;
  // a failed mint simply yields no link, exactly as the inline render did.
  const reportLinks = new Map<string, string>();
  for (const p of placements) {
    const state = parseEventState(p.status);
    if (state === 'active' || state === 'archived') {
      const rt = await mintSignedLinkToken(env, p.event_id, 'sponsor', 7 * 24 * 60 * 60, {
        sponsor_id: sponsor.id,
      });
      if (rt) {
        reportLinks.set(
          p.event_id,
          `/sharedReport?eventId=${encodeURIComponent(p.event_id)}&token=${encodeURIComponent(rt)}`
        );
      }
    }
  }

  const page = renderSponsorHomePage({
    sponsor: { id: sponsor.id, name: sponsor.name },
    placements,
    expiresIso: new Date(claim.exp * 1000).toISOString(),
    reportLinkFor: (eventId) => reportLinks.get(eventId) ?? null,
  });

  const res = html(page);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

// ─── Public: accept / decline a placement ────────────────────────────────────

export async function handleSponsorPlacementRespond(
  request: Request,
  env: SponsorHomeEnv,
  placementId: string
): Promise<Response> {
  // Rate limiting for this route lives at the router (publicReadLimited(
  // 'sponsor-respond', …, 60)) — CCR-PR567 re-run item 9 — so it is visible in
  // the route table alongside the other public writes, not buried here.
  const id = rid();
  if (!env.DB) return jsonError('DB_NOT_CONFIGURED', 'Database not available', 503, id);
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return jsonError('BAD_CONTENT_TYPE', 'Content-Type must be application/json', 400, id);
  }
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 4096) return jsonError('PAYLOAD_TOO_LARGE', 'Body too large', 400, id);
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400, id);
  }
  const claim = await verifySponsorHomeToken(
    env,
    typeof body.token === 'string' ? body.token : null
  );
  if (!claim) return jsonError('UNAUTHORIZED', 'Sponsor link is not valid', 401, id);
  if (typeof body.accepted !== 'boolean') {
    return jsonError('MISSING_FIELD', 'accepted must be true or false', 400, id);
  }

  // Ownership proof in SQL: the placement must belong to the token's sponsor
  // AND that sponsor to the token's brand. Anything else is 404.
  const result = await env.DB.prepare(
    `UPDATE sponsor_placement
        SET sponsor_accepted = ?, updated_at = datetime('now')
      WHERE id = ? AND is_active = 1
        AND sponsor_business_id = (
          SELECT id FROM sponsor_business WHERE id = ? AND brand_id = ? AND is_active = 1
        )`
  )
    .bind(body.accepted ? 1 : 0, placementId, claim.sponsor_id, claim.brand_id)
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    return jsonError('NOT_FOUND', `Placement not found: ${placementId}`, 404, id);
  }

  // Bust the cache-fronted public sponsor list for this event so an accept/decline
  // reflects immediately on the cache-fronted poster / display / JSON surfaces,
  // matching the direct-DB public event page. Without this, a declined sponsor
  // keeps rendering for up to the 30s TTL — a cross-surface consent split
  // (ADR-019 / CCR re-run #3). The UPDATE keys on placement/sponsor/brand, so the
  // event_id is fetched here for the cache key.
  const evt = await env.DB.prepare('SELECT event_id FROM sponsor_placement WHERE id = ?')
    .bind(placementId)
    .first<{ event_id: string }>();
  if (evt?.event_id) await invalidateSponsorsCache(evt.event_id);

  await logAdminAction(env as { DB: D1Database }, {
    action: 'SPONSOR_PLACEMENT_RESPOND',
    actor: `sponsor:${claim.sponsor_id}`,
    resource_type: 'sponsor_placement',
    resource_id: placementId,
    request_id: id,
    outcome: 'success',
    details: { accepted: body.accepted },
  });

  return Response.json(
    { ok: true, status: 200, id: placementId, sponsor_accepted: body.accepted ? 1 : 0 },
    { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': id } }
  );
}
