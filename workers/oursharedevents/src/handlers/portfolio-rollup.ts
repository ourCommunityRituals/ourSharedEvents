/**
 * Portfolio rollup — brand-scoped aggregate counts (OSE-669, rank 4).
 *
 * GET /api/v2/admin/events/portfolio-rollup
 *
 * A brand owner running many events has no brand-wide number today (counts load
 * one selected event at a time). This returns SUM(registrations / check-ins /
 * active sponsors) across ONLY the caller's brand events, for the strip above
 * "All Events".
 *
 * Two invariants govern the math:
 *
 *   #9 tenant_isolation — the brand set is SERVER-DERIVED from the verified
 *   actor (OSE-666/B2), never a client ?brand_id=. A forged brand_id outside
 *   membership is 403; an unscopable caller gets a fully-suppressed strip. This
 *   is NOT a merged all-brands view.
 *
 *   #7 aggregate_only_reporting — K≥5 is applied PER CONTRIBUTING BUCKET BEFORE
 *   summation, not only to the final total. A single event with 1–4 registrants
 *   must not be masked inside a large portfolio sum, and must not be recoverable
 *   by differencing the rollup against the per-event counts the same operator can
 *   already see. So each event's own count only joins the sum when it is ≥ K;
 *   sub-K events are dropped first. The survivors' sum is then formatted through
 *   the shared OSE-665 renderer (applyCountFloor) — which, because each survivor
 *   is ≥ K, yields either an exact ≥K total or a suppressed "Fewer than 5" when
 *   no event cleared the floor.
 *
 * Active sponsors are NOT floored: sponsors are publicly-named businesses shown
 * on the event page, not privacy contributors — flooring a sponsor count would
 * hide legitimate portfolio information while protecting no one.
 */

import { corsHeaders } from '../lib/cors';
import { applyCountFloor, type FlooredCount } from '../lib/count-floor';
import { CORRIDOR_MAP_MIN_COUNT } from '../lib/shared-report';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import {
  resolveAdminBrandScopeAsync,
  type AdminBrandScope,
  type AdminBrandScopeEnv,
} from '../lib/admin-brand-scope';

export interface PortfolioRollupEnv extends AdminEnv, AdminBrandScopeEnv {
  DB?: D1Database;
  FORMS_DB?: D1Database;
}

function rid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

interface RollupBody {
  ok: true;
  status: 200;
  rollup: {
    events: number;
    registrations: FlooredCount;
    checkins: FlooredCount;
    activeSponsors: number;
  };
  scopedTo: string[] | null;
}

/** Sum only the per-event buckets that individually clear K (#7 pre-agg floor). */
function sumContributingBuckets(rows: Array<{ cnt: number }>): number {
  let sum = 0;
  for (const r of rows) {
    const n = Number.isFinite(r.cnt) ? Math.floor(r.cnt) : 0;
    if (n >= CORRIDOR_MAP_MIN_COUNT) sum += n;
  }
  return sum;
}

function jsonBody(body: RollupBody, request: Request, reqId: string): Response {
  return Response.json(body, {
    headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': reqId },
  });
}

/** A fully-suppressed strip — used for deny and for a caller with zero events. */
function emptyRollup(request: Request, reqId: string, scopedTo: string[] | null): Response {
  return jsonBody(
    {
      ok: true,
      status: 200,
      rollup: {
        events: 0,
        registrations: applyCountFloor(0),
        checkins: applyCountFloor(0),
        activeSponsors: 0,
      },
      scopedTo,
    },
    request,
    reqId
  );
}

/**
 * D1 refuses a statement with more than 100 bound parameters. Stay under it
 * with headroom; exported so the boundary is testable.
 */
export const IN_LIST_CHUNK = 90;

/**
 * Run a per-event `… WHERE event_id IN (<ph>) …` count across `eventIds` in
 * chunks of IN_LIST_CHUNK and concatenate the rows. Rows stay per event, so the
 * #7 per-bucket count floor applied by the caller is unchanged by chunking. Any
 * chunk failing returns null: the caller then reports 0, exactly as the
 * single-query version did on error (never a partial sum).
 */
export async function perEventCounts(
  db: D1Database,
  eventIds: string[],
  sql: (placeholders: string) => string
): Promise<Array<{ event_id: string; cnt: number }> | null> {
  const chunks: string[][] = [];
  for (let i = 0; i < eventIds.length; i += IN_LIST_CHUNK) {
    chunks.push(eventIds.slice(i, i + IN_LIST_CHUNK));
  }
  try {
    const results = await Promise.all(
      chunks.map((ids) =>
        db
          .prepare(sql(ids.map(() => '?').join(', ')))
          .bind(...ids)
          .all<{ event_id: string; cnt: number }>()
      )
    );
    return results.flatMap((r) => r.results ?? []);
  } catch {
    return null;
  }
}

export async function handlePortfolioRollup(
  request: Request,
  env: PortfolioRollupEnv
): Promise<Response> {
  const reqId = rid();

  const scope: AdminBrandScope = await resolveAdminBrandScopeAsync(
    extractAdminActor(request, env),
    env
  );
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand_id');

  // #9: an unscopable caller never receives a cross-tenant sum.
  if (scope.mode === 'deny' || !env.DB) {
    return emptyRollup(request, reqId, null);
  }
  // #9: a forged brand_id the caller is not a member of cannot widen scope.
  if (scope.mode === 'scoped' && brandId && !scope.brandIds.includes(brandId)) {
    return Response.json(
      {
        ok: false,
        status: 403,
        code: 'BRAND_FORBIDDEN',
        error: `Not entitled to brand_id "${brandId}"`,
        requestId: reqId,
      },
      { status: 403, headers: { ...corsHeaders(request), 'X-Request-Id': reqId } }
    );
  }

  // Resolve the server-derived brand set to aggregate over.
  const brandFilter: string[] = [];
  const brandBinds: string[] = [];
  if (scope.mode === 'scoped') {
    const brands = brandId ? [brandId] : scope.brandIds;
    brandFilter.push(`brand_id IN (${brands.map(() => '?').join(', ')})`);
    brandBinds.push(...brands);
  } else if (scope.mode === 'all' && brandId) {
    // Automation/CI may narrow to one brand explicitly; absent that it sees all.
    brandFilter.push('brand_id = ?');
    brandBinds.push(brandId);
  }
  const scopedTo = scope.mode === 'scoped' ? (brandId ? [brandId] : scope.brandIds) : null;

  // The caller's brand events — the buckets the portfolio sums over.
  let eventIds: string[];
  try {
    const where = brandFilter.length ? ` WHERE ${brandFilter.join(' AND ')}` : '';
    const rs = await env.DB.prepare(`SELECT id FROM events${where}`)
      .bind(...brandBinds)
      .all<{ id: string }>();
    eventIds = (rs.results ?? []).map((r) => r.id);
  } catch {
    return emptyRollup(request, reqId, scopedTo);
  }
  if (eventIds.length === 0) {
    return emptyRollup(request, reqId, scopedTo);
  }

  // Active sponsors — exact (public businesses, not privacy contributors), so
  // the per-event rows are summed without a floor. Keyed by the brand-scoped
  // held event ids and chunked: D1 caps a statement at 100 bound parameters,
  // and past that the single query threw and the catch reported 0.
  const sponsorsQ = perEventCounts(
    env.DB,
    eventIds,
    (ph) => `SELECT event_id, COUNT(*) AS cnt FROM sponsor_placement
     WHERE is_active = 1 AND event_id IN (${ph}) GROUP BY event_id`
  ).then((rows) => (rows ?? []).reduce((n, r) => n + r.cnt, 0));

  // Registrations + check-ins live in FORMS_DB: per-event counts, chunked the
  // same way → #7 per-bucket floor → sum of survivors → shared OSE-665 shape.
  const formsDb = env.FORMS_DB;
  const registrationsQ = formsDb
    ? perEventCounts(
        formsDb,
        eventIds,
        (ph) => `SELECT event_id, COUNT(*) AS cnt FROM form_registrations
         WHERE event_id IN (${ph}) AND status = 'confirmed'
           AND (expires_at IS NULL OR expires_at > datetime('now'))
         GROUP BY event_id`
      )
    : Promise.resolve(null);
  const checkinsQ = formsDb
    ? perEventCounts(
        formsDb,
        eventIds,
        (ph) => `SELECT event_id, total_count AS cnt FROM checkin_counts WHERE event_id IN (${ph})`
      )
    : Promise.resolve(null);

  // The three counts are independent — one round-trip window, not three.
  const [activeSponsors, regRows, chkRows] = await Promise.all([
    sponsorsQ,
    registrationsQ,
    checkinsQ,
  ]);
  const registrations = applyCountFloor(regRows ? sumContributingBuckets(regRows) : 0);
  const checkins = applyCountFloor(chkRows ? sumContributingBuckets(chkRows) : 0);

  return jsonBody(
    {
      ok: true,
      status: 200,
      rollup: { events: eventIds.length, registrations, checkins, activeSponsors },
      scopedTo,
    },
    request,
    reqId
  );
}
