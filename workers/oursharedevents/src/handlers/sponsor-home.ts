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
 *   POST /api/v2/sponsor/requests                     (public, token in body, rate-limited)
 *        → the sponsor asks to back one of its brand's published, upcoming
 *          events; stored switched OFF until the organizer approves
 *          (lib/sponsor-discovery — ADR-019 two-sided consent)
 *   POST /api/v2/admin/sponsor-requests/:id/respond   (admin, brand-scoped, audited)
 *        → the organizer approves (switches the placement on) or declines
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
 *   - `Referrer-Policy: no-referrer` on every answer, and the page drops the
 *     token from the address bar once it has read it (kept in a script variable
 *     only: no cookie, no browser storage). A request with no token is told to
 *     open the link again; that is what a refresh asks for afterwards.
 */

import { html, renderErrorPage } from './pages';
import { invalidateSponsorsCache } from '../lib/data-provider';
import { parseEventState, canRender } from '../domain/event-state';
import { computeEventPhase } from '../domain/event-phase';
import {
  readPreEventActivity,
  floorPreEventActivity,
  type FlooredPreEventActivity,
} from '../lib/pre-event-activity';

/** Most pre-event placements whose reach one /sponsor view reads (4 small queries each). */
const PRE_EVENT_REACH_MAX = 20;
import { renderSponsorHomePage, type PlacementRow } from '../lib/sponsor-home-render';
import { sponsorTitle } from '../lib/sponsor-card';
import { corsHeaders } from '../lib/cors';
import { isJsonContentType } from '../lib/content-type';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import { isPublicReadLimited, type PublicReadLimitEnv } from '../lib/public-read-limit';
import { logAdminAction } from '../lib/audit-log';
import { MAP_FLIP_NOTE, auditMapFlip } from '../lib/map-default';
import {
  mintSponsorHomeToken,
  verifySponsorHomeToken,
  SPONSOR_HOME_TTL_SECONDS,
  type SponsorHomeAuthEnv,
} from '../lib/sponsor-home-auth';
import { mintSignedLinkToken, type SharedReportAuthEnv } from '../lib/shared-report-auth';
import {
  readDiscoverableEvents,
  readSponsorRequests,
  createSponsorRequest,
  answerSponsorRequest,
} from '../lib/sponsor-discovery';

export interface SponsorHomeEnv
  extends
    AdminEnv,
    AdminBrandScopeEnv,
    SponsorHomeAuthEnv,
    SharedReportAuthEnv,
    PublicReadLimitEnv {
  DB?: D1Database;
  PUBLISH_GRACE_MINUTES?: string;
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

/**
 * `/sponsor` is opened by a signed link, so its address is never sent on in a
 * Referer header. On every answer, the refusals included: a 429 is served while
 * a working token is still in the address.
 */
function noReferrer(res: Response): Response {
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

function invalidLinkPage(): Response {
  return noReferrer(
    renderErrorPage(
      401,
      'This sponsor link isn’t valid',
      'Ask the organizer for a fresh link.',
      '/events',
      'See what’s happening'
    )
  );
}

/**
 * No token in the address at all. The page drops the token from the address
 * bar once it has read it (templates/sponsor-home.html), so this is what a
 * refresh or the Back button asks for. The link itself still works, so the
 * page says to open it again rather than to ask for a new one.
 */
function reopenLinkPage(): Response {
  return noReferrer(
    renderErrorPage(
      401,
      'Open your sponsor link again',
      'Open it from your message or email. It still works.',
      '/events',
      'See what’s happening'
    )
  );
}

export async function handleSponsorHomePage(
  request: Request,
  env: SponsorHomeEnv
): Promise<Response> {
  if (await isPublicReadLimited(request, env, 'sponsor-home')) {
    return noReferrer(renderErrorPage(429, 'Too many requests', 'Give it a minute and try again.'));
  }
  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token) return reopenLinkPage();
  const claim = await verifySponsorHomeToken(env, token);
  if (!claim || !env.DB) return invalidLinkPage();

  const sponsor = await env.DB.prepare(
    'SELECT id, name, display_name, is_active, h3_res7 FROM sponsor_business WHERE id = ? AND brand_id = ? LIMIT 1'
  )
    .bind(claim.sponsor_id, claim.brand_id)
    .first<{
      id: string;
      name: string;
      display_name: string | null;
      is_active: number;
      h3_res7: string | null;
    }>();
  if (!sponsor || Number(sponsor.is_active) === 0) return invalidLinkPage();

  const rows = await env.DB.prepare(
    `SELECT sp.id AS placement_id, sp.event_id, sp.tier, COALESCE(sp.locality_band, 0) AS locality_band,
            sp.organizer_accepted, sp.sponsor_accepted, sp.is_active AS placement_active,
            e.title, e.status, e.start_date, e.end_date, e.location, e.is_published, e.timezone
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

  // Pre-event reach — only for placements the sponsor ACCEPTED, on listed
  // events that haven't started. FLOORED here (K=5, per total and per day), so
  // the render never holds a raw scan/tap count: an outside party never sees a
  // sub-5 number. Capped so a long placement list can't fan out into hundreds
  // of reads on one page view.
  const reach = new Map<string, FlooredPreEventActivity>();
  const now = new Date();
  let reads = 0;
  for (const p of placements) {
    if (reads >= PRE_EVENT_REACH_MAX) break;
    if (p.sponsor_accepted !== 1) continue;
    const state = parseEventState(p.status);
    if (!canRender(state, 'public')) continue;
    if (
      computeEventPhase({ status: p.status, start_date: p.start_date, end_date: p.end_date }) !==
      'pre_event'
    )
      continue;
    reads += 1;
    const raw = await readPreEventActivity(env.DB, p.event_id, p.timezone ?? null, now);
    reach.set(p.event_id, floorPreEventActivity(raw));
  }

  // Sponsor discovery (lib/sponsor-discovery): the brand's published, upcoming
  // events this sponsor is not on yet, and the requests it has already sent.
  // Both keyed to the SIGNED claim's brand, like every other read on this page.
  const scoped = { id: sponsor.id, brand_id: claim.brand_id, h3_res7: sponsor.h3_res7 };
  const [discoverable, requests] = await Promise.all([
    readDiscoverableEvents(env.DB, scoped),
    readSponsorRequests(env.DB, scoped),
  ]);

  const page = renderSponsorHomePage({
    // OSE-1431: the sponsor sees the same title the public sees.
    sponsor: { id: sponsor.id, name: sponsorTitle(sponsor) },
    placements,
    discoverable,
    requests,
    expiresIso: new Date(claim.exp * 1000).toISOString(),
    reportLinkFor: (eventId) => reportLinks.get(eventId) ?? null,
    preEventReachFor: (eventId) => reach.get(eventId) ?? null,
  });

  const res = html(page);
  res.headers.set('Cache-Control', 'no-store');
  return noReferrer(res);
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
  if (!isJsonContentType(request.headers.get('content-type'))) {
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

// ─── Public: a sponsor asks to back an event ─────────────────────────────────

export async function handleSponsorRequestCreate(
  request: Request,
  env: SponsorHomeEnv
): Promise<Response> {
  // Rate limit lives at the router (publicReadLimited('sponsor-request', …)).
  const id = rid();
  if (!env.DB) return jsonError('DB_NOT_CONFIGURED', 'Database not available', 503, id);
  if (!isJsonContentType(request.headers.get('content-type'))) {
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
  const eventId = typeof body.event_id === 'string' ? body.event_id.trim().slice(0, 128) : '';
  if (!eventId) return jsonError('MISSING_FIELD', 'event_id is required', 400, id);

  const sponsor = await env.DB.prepare(
    `SELECT id, brand_id, tier, lat, lon, is_active FROM sponsor_business
      WHERE id = ? AND brand_id = ? LIMIT 1`
  )
    .bind(claim.sponsor_id, claim.brand_id)
    .first<{
      id: string;
      brand_id: string;
      tier: string | null;
      lat: number | null;
      lon: number | null;
      is_active: number;
    }>();
  if (!sponsor || Number(sponsor.is_active) === 0) {
    return jsonError('UNAUTHORIZED', 'Sponsor link is not valid', 401, id);
  }

  const outcome = await createSponsorRequest(env.DB, sponsor, eventId, `spl_${rid()}`);
  if (!outcome.ok) {
    const map = {
      // Out of brand, unpublished, over, or missing all read the same (no oracle).
      NOT_DISCOVERABLE: [404, 'That event is not open for sponsor requests.'],
      ALREADY_LINKED: [409, 'You are already linked to this event.'],
      TOO_MANY_OPEN: [
        409,
        'You have several requests waiting. Once an organizer answers one, you can ask again.',
      ],
    } as const;
    const [status, message] = map[outcome.code];
    return jsonError(outcome.code, message, status, id);
  }

  await logAdminAction(env as { DB: D1Database }, {
    action: 'SPONSOR_REQUEST_PLACEMENT',
    actor: `sponsor:${claim.sponsor_id}`,
    resource_type: 'sponsor_placement',
    resource_id: outcome.placement_id,
    request_id: id,
    outcome: 'success',
    details: { event_id: outcome.event_id },
  });

  return Response.json(
    { ok: true, status: 201, id: outcome.placement_id, event_id: outcome.event_id },
    {
      status: 201,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': id },
    }
  );
}

// ─── Admin: the organizer answers a sponsor's request ────────────────────────

export async function handleAdminAnswerSponsorRequest(
  request: Request,
  env: SponsorHomeEnv,
  placementId: string
): Promise<Response> {
  const id = rid();
  if (!env.DB) return jsonError('DB_NOT_CONFIGURED', 'Database not available', 503, id);
  // JSON-only, like every other admin write (sponsors.ts parseBody). A
  // cross-site <form enctype="text/plain"> can shape a JSON-looking body but
  // cannot set this Content-Type without a CORS preflight — without the check,
  // a sponsor could lure an organizer into approving the sponsor's own request
  // (CCR PR #700, L1 #1). Body capped like the sponsor-side writes.
  if (!isJsonContentType(request.headers.get('content-type'))) {
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
  if (typeof body.approve !== 'boolean') {
    return jsonError('MISSING_FIELD', 'approve must be true or false', 400, id);
  }
  const actor = extractAdminActor(request, env);
  const scope = await resolveAdminBrandScopeAsync(actor, env);
  if (scope.mode === 'deny') {
    return jsonError('NOT_FOUND', `Request not found: ${placementId}`, 404, id);
  }
  const answer = await answerSponsorRequest(
    env.DB,
    placementId,
    body.approve,
    scope.mode === 'scoped' ? scope.brandIds : null,
    env.PUBLISH_GRACE_MINUTES
  );
  if (!answer.ok) {
    return answer.code === 'NOT_FOUND'
      ? jsonError('NOT_FOUND', `Request not found: ${placementId}`, 404, id)
      : jsonError('ALREADY_ANSWERED', 'This request has already been answered', 409, id);
  }
  // Bust the cache-fronted public sponsor list either way, so poster / display /
  // JSON agree with the event page immediately (a decline also changes what the
  // dark geo path would consider — see ADR-019 amendment).
  await invalidateSponsorsCache(answer.event_id);

  await logAdminAction(env as { DB: D1Database }, {
    action: 'ANSWER_SPONSOR_REQUEST',
    actor,
    resource_type: 'sponsor_placement',
    resource_id: placementId,
    request_id: id,
    outcome: 'success',
    details: { approved: answer.approved, event_id: answer.event_id },
  });
  // OSE-1560: approving can turn the event's default map on; say so, and audit it.
  if (answer.map_flipped) {
    await auditMapFlip(env as { DB: D1Database }, {
      actor,
      requestId: id,
      eventId: answer.event_id,
      via: 'request_approved',
      sponsorId: answer.sponsor_id,
    });
  }

  return Response.json(
    {
      ok: true,
      status: 200,
      id: placementId,
      approved: answer.approved,
      ...(answer.map_flipped ? { map: MAP_FLIP_NOTE } : {}),
    },
    { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': id } }
  );
}
