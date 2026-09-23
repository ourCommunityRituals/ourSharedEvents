/**
 * Sponsor-initiated per-event attachment request (pre-node-match slice).
 *
 *   POST /api/v2/sponsor/placements/request       (public, sponsor-home token in body)
 *   GET  /api/v2/admin/sponsors/requests/pending   (admin, brand-scoped)
 *   POST /api/v2/admin/sponsors/requests/:id/respond  (admin, brand-scoped, audited)
 *
 * WHY THIS EXISTS. Today a placement is either organizer-authored (Path 1,
 * Create Sponsor) or a self-onboarded promotion tied to the invite's own event
 * (also Path 1, source=corridor_covenant). Neither lets an ALREADY-onboarded
 * sponsor say "attach me to this OTHER event in the node" without an organizer
 * first minting them a fresh invite. This closes that gap for ONE event at a
 * time — the deliberately narrower, already-shippable sibling of the node+
 * event-type auto-match (Path 2 / OSE-1267), which stays dark behind
 * SPONSOR_GEO_MATCH_ENABLED post-Oct-24.
 *
 * CONSENT MODEL (ADR-019, asymmetric on purpose).
 *   - `sponsor_accepted = 1` immediately — the sponsor is the one asking, so
 *     their own consent is already given (same reasoning as the corridor_
 *     covenant self-onboard promotion).
 *   - `organizer_accepted = 0` EXPLICITLY (never NULL) at creation. Migration
 *     0068 made organizer_accepted NULL-permissive for organizer-authored rows
 *     (an organizer never needs to approve their own action) — but a request
 *     THIS sponsor initiated is exactly the case that permissive default was
 *     never meant to cover. Writing 0 (not NULL) means the existing resolver
 *     clause `COALESCE(sp.organizer_accepted, 1) = 1` already hides it with NO
 *     resolver change required. Accepting flips it to 1; declining retires the
 *     row via is_active = 0 (same soft-delete convention as admin sponsor
 *     delete) rather than inventing a new state column.
 *
 * COVENANT (#25). Tier is SERVER-FORCED to the covenant base tier — a sponsor
 * requesting an event can never choose or buy frequency/position through this
 * surface. locality_band is geo-derived exactly like every other placement
 * write, never client-set.
 */

import { corsHeaders } from '../lib/cors';
import { invalidateSponsorsCache } from '../lib/data-provider';
import { logAdminAction } from '../lib/audit-log';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import { verifySponsorHomeToken, type SponsorHomeAuthEnv } from '../lib/sponsor-home-auth';
import { COVENANT_BASE_TIER } from '../lib/sponsor-promotion';

export const SPONSOR_REQUESTED_SOURCE = 'sponsor_requested';

export interface SponsorEventRequestEnv extends SponsorHomeAuthEnv, AdminEnv, AdminBrandScopeEnv {
  DB?: D1Database;
}

function rid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function jsonError(
  request: Request,
  code: string,
  message: string,
  status: number,
  id: string
): Response {
  return Response.json(
    { ok: false, status, code, error: message, requestId: id },
    {
      status,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': id },
    }
  );
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : String(Date.now())}`;
}

/**
 * Events in the sponsor's own brand that this sponsor does not already hold a
 * placement for (any status — the UNIQUE(sponsor_business_id, event_id)
 * constraint means there is at most one row per pair, so "no row yet" is the
 * only correct definition of "available"). Published, not yet over, nearest
 * first. Used to render the "request another event" list on /sponsor.
 */
export async function listAvailableEventsForSponsor(
  db: D1Database,
  sponsorId: string,
  brandId: string,
  limit = 50
): Promise<
  Array<{ id: string; title: string; start_date: string | null; location: string | null }>
> {
  const rows = await db
    .prepare(
      `SELECT e.id AS id, e.title AS title, e.start_date AS start_date, e.location AS location
         FROM events e
        WHERE e.brand_id = ?
          AND e.is_published = 1
          AND (e.end_date IS NULL OR e.end_date >= date('now'))
          AND NOT EXISTS (
            SELECT 1 FROM sponsor_placement sp
             WHERE sp.sponsor_business_id = ? AND sp.event_id = e.id
          )
        ORDER BY CASE WHEN e.start_date IS NULL THEN 1 ELSE 0 END, e.start_date ASC, e.created_at DESC
        LIMIT ?`
    )
    .bind(brandId, sponsorId, limit)
    .all<{ id: string; title: string; start_date: string | null; location: string | null }>();
  return rows.results ?? [];
}

// ─── Public: sponsor requests attachment to one event ────────────────────────

export async function handleSponsorPlacementRequest(
  request: Request,
  env: SponsorEventRequestEnv
): Promise<Response> {
  const id = rid();
  if (!env.DB) return jsonError(request, 'DB_NOT_CONFIGURED', 'Database not available', 503, id);
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return jsonError(request, 'BAD_CONTENT_TYPE', 'Content-Type must be application/json', 400, id);
  }
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2048)
      return jsonError(request, 'PAYLOAD_TOO_LARGE', 'Body too large', 400, id);
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return jsonError(request, 'INVALID_BODY', 'Request body must be valid JSON', 400, id);
  }

  const claim = await verifySponsorHomeToken(
    env,
    typeof body.token === 'string' ? body.token : null
  );
  if (!claim) return jsonError(request, 'UNAUTHORIZED', 'Sponsor link is not valid', 401, id);

  const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : '';
  if (!eventId) return jsonError(request, 'MISSING_FIELD', 'event_id is required', 400, id);

  // Tenant fence (#9): the event must belong to the claim's brand. Out-of-scope
  // and non-existent are indistinguishable (404, no enumeration oracle).
  const event = await env.DB.prepare(
    `SELECT brand_id, h3_res7 FROM events WHERE id = ? AND brand_id = ? AND is_published = 1`
  )
    .bind(eventId, claim.brand_id)
    .first<{ brand_id: string; h3_res7: string | null }>();
  if (!event) return jsonError(request, 'NOT_FOUND', `Event not found: ${eventId}`, 404, id);

  const sponsor = await env.DB.prepare(
    `SELECT id, h3_res7 FROM sponsor_business WHERE id = ? AND brand_id = ? AND is_active = 1`
  )
    .bind(claim.sponsor_id, claim.brand_id)
    .first<{ id: string; h3_res7: string | null }>();
  if (!sponsor) return jsonError(request, 'NOT_FOUND', 'Sponsor not found', 404, id);

  // locality_band: geo-derived, never client-set (#25) — identical rule to
  // every other placement write (sponsors.ts, sponsor-promotion.ts).
  const localityBand =
    sponsor.h3_res7 !== null && event.h3_res7 !== null && sponsor.h3_res7 === event.h3_res7 ? 1 : 0;

  const placementId = genId('spl');
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO sponsor_placement
         (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
          click_token, display_token, is_active, organizer_accepted, sponsor_accepted,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NULL, 1, 0, 1, ?, ?)`
    )
      .bind(
        placementId,
        sponsor.id,
        eventId,
        COVENANT_BASE_TIER, // server-forced — never client-set (#25)
        SPONSOR_REQUESTED_SOURCE,
        localityBand,
        now,
        now
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg)) {
      return jsonError(
        request,
        'ALREADY_REQUESTED',
        'A placement already exists for this event',
        409,
        id
      );
    }
    console.error(
      JSON.stringify({ type: 'DB_ERROR', handler: 'handleSponsorPlacementRequest', error: msg })
    );
    return jsonError(request, 'DB_ERROR', 'Failed to create request', 503, id);
  }

  await logAdminAction(env as { DB: D1Database }, {
    action: 'SPONSOR_PLACEMENT_REQUEST',
    actor: `sponsor:${claim.sponsor_id}`,
    resource_type: 'sponsor_placement',
    resource_id: placementId,
    request_id: id,
    outcome: 'success',
    details: { event_id: eventId },
  });

  return Response.json(
    { ok: true, status: 200, id: placementId },
    { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': id } }
  );
}

// ─── Admin: curate pending sponsor-initiated requests ────────────────────────

export interface PendingRequestRow {
  placement_id: string;
  sponsor_id: string;
  sponsor_name: string;
  event_id: string;
  event_title: string;
  start_date: string | null;
  created_at: string;
}

export async function handleAdminListPendingSponsorRequests(
  request: Request,
  env: SponsorEventRequestEnv
): Promise<Response> {
  const id = rid();
  if (!env.DB) return jsonError(request, 'DB_NOT_CONFIGURED', 'Database not available', 503, id);

  const actor = extractAdminActor(request, env);
  const scope = await resolveAdminBrandScopeAsync(actor, env);
  if (scope.mode === 'deny') return Response.json({ ok: true, status: 200, requests: [] });

  const scopeSql =
    scope.mode === 'scoped'
      ? ` AND e.brand_id IN (${scope.brandIds.map(() => '?').join(', ')})`
      : '';
  const binds: string[] = scope.mode === 'scoped' ? scope.brandIds : [];

  const rows = await env.DB.prepare(
    `SELECT sp.id AS placement_id, sb.id AS sponsor_id, sb.name AS sponsor_name,
            e.id AS event_id, e.title AS event_title, e.start_date AS start_date,
            sp.created_at AS created_at
       FROM sponsor_placement sp
       JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
       JOIN events e ON e.id = sp.event_id
      WHERE sp.source = ? AND sp.organizer_accepted = 0 AND sp.is_active = 1${scopeSql}
      ORDER BY sp.created_at ASC
      LIMIT 200`
  )
    .bind(SPONSOR_REQUESTED_SOURCE, ...binds)
    .all<PendingRequestRow>();

  return Response.json(
    { ok: true, status: 200, requests: rows.results ?? [] },
    { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': id } }
  );
}

export async function handleAdminRespondToSponsorRequest(
  request: Request,
  env: SponsorEventRequestEnv,
  placementId: string
): Promise<Response> {
  const id = rid();
  if (!env.DB) return jsonError(request, 'DB_NOT_CONFIGURED', 'Database not available', 503, id);

  const actor = extractAdminActor(request, env);
  const scope = await resolveAdminBrandScopeAsync(actor, env);
  if (scope.mode === 'deny')
    return jsonError(request, 'NOT_FOUND', `Request not found: ${placementId}`, 404, id);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError(request, 'INVALID_BODY', 'Request body must be valid JSON', 400, id);
  }
  if (typeof body.accepted !== 'boolean') {
    return jsonError(request, 'MISSING_FIELD', 'accepted must be true or false', 400, id);
  }

  const scopeSql =
    scope.mode === 'scoped'
      ? ` AND events.brand_id IN (${scope.brandIds.map(() => '?').join(', ')})`
      : '';
  const binds: string[] = scope.mode === 'scoped' ? scope.brandIds : [];

  // Ownership + brand scope proven in SQL before any write: the placement must
  // be a live, still-pending sponsor_requested row whose event is inside the
  // caller's brand scope. Out-of-scope and non-existent are indistinguishable
  // (404, no enumeration oracle) — the same posture as every other admin
  // sponsor route (resolveAdminBrandScopeAsync + a scoped existence check).
  const owned = await env.DB.prepare(
    `SELECT sponsor_placement.id AS id
       FROM sponsor_placement
       JOIN events ON events.id = sponsor_placement.event_id
      WHERE sponsor_placement.id = ? AND sponsor_placement.source = ?${scopeSql}`
  )
    .bind(placementId, SPONSOR_REQUESTED_SOURCE, ...binds)
    .first<{ id: string }>();
  if (!owned) return jsonError(request, 'NOT_FOUND', `Request not found: ${placementId}`, 404, id);

  // Accept flips organizer_accepted to 1 (resolver-visible); decline retires
  // the row via is_active = 0 (same soft-delete convention as admin sponsor
  // delete) — no new "declined" state column needed.
  const result = body.accepted
    ? await env.DB.prepare(
        `UPDATE sponsor_placement SET organizer_accepted = 1, updated_at = datetime('now')
          WHERE id = ? AND source = ? AND is_active = 1`
      )
        .bind(placementId, SPONSOR_REQUESTED_SOURCE)
        .run()
    : await env.DB.prepare(
        `UPDATE sponsor_placement SET is_active = 0, updated_at = datetime('now')
          WHERE id = ? AND source = ?`
      )
        .bind(placementId, SPONSOR_REQUESTED_SOURCE)
        .run();

  if ((result.meta?.changes ?? 0) === 0) {
    return jsonError(request, 'NOT_FOUND', `Request not found: ${placementId}`, 404, id);
  }

  const evt = await env.DB.prepare('SELECT event_id FROM sponsor_placement WHERE id = ?')
    .bind(placementId)
    .first<{ event_id: string }>();
  if (evt?.event_id) await invalidateSponsorsCache(evt.event_id);

  await logAdminAction(env as { DB: D1Database }, {
    action: 'SPONSOR_REQUEST_RESPOND',
    actor,
    resource_type: 'sponsor_placement',
    resource_id: placementId,
    request_id: id,
    outcome: 'success',
    details: { accepted: body.accepted },
  });

  return Response.json(
    { ok: true, status: 200, id: placementId, organizer_accepted: body.accepted ? 1 : 0 },
    { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': id } }
  );
}
