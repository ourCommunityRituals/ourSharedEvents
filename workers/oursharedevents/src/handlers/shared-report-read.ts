/**
 * OSE-272 Session 5 — SharedReport read API handlers
 *
 * Two endpoints:
 *   1. GET  /api/v2/events/:id/shared-report
 *      Signed-link auth. Returns the SharedReport object for ONE event.
 *
 *   2. POST /api/v2/events/shared-reports/batch  { ids: [...] }
 *      Service-token auth. Returns SharedReports for up to 50 events
 *      in a single response.
 *
 * Both delegate to a shared report builder — single source of truth.
 *
 * Cache headers (S5-Q4 ratified):
 *   - Single endpoint: `Cache-Control: private, max-age=3600` + `Vary: Authorization`
 *   - Batch endpoint:  `Cache-Control: no-store` (consumers manage their own cache)
 *
 * Gate 6 (tests/shared-report-pipeline-invariants.spec.ts) enforces that
 * the read API NEVER writes to SharedReport tables — read-only.
 */

import {
  extractBearerToken,
  mintSignedLinkToken,
  classifyServiceToken,
  verifySignedLinkToken,
  type SharedReportAuthEnv,
  type SignedLinkRole,
} from '../lib/shared-report-auth';
import { buildSharedReport, type SharedReport } from '../lib/shared-report-builder';
import { resolveMintTtlSeconds } from '../lib/mint-ttl';
import { applyCountFloor } from '../lib/count-floor';
import { resolveDepth, filterReportByDepth } from '../lib/report-depth';
import { logReportAccess } from '../lib/audit-log';
import { checkRateLimit, RATE_LIMIT_BATCH_MAX, RATE_LIMIT_WINDOW_MS } from '../lib/rate-limit';

export type SharedReportReadEnv = SharedReportAuthEnv & {
  DB: D1Database;
  RATE_LIMIT_KV?: KVNamespace;
};

const BATCH_MAX_IDS = 50; // S5-Q3 ratified

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

// ─── Single-event endpoint ─────────────────────────────────────────────────

export async function handleGetSharedReport(
  request: Request,
  env: SharedReportReadEnv,
  eventId: string,
  ctx: ExecutionContext
): Promise<Response> {
  const token = extractBearerToken(request.headers.get('Authorization'));
  if (!token) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED', error: 'missing bearer token' }, 401, {
      'WWW-Authenticate': 'Bearer realm="OurSharedEvents SharedReport"',
    });
  }

  const claim = await verifySignedLinkToken(env, token);
  if (!claim) {
    ctx.waitUntil(logReportAccess(env, eventId, 'unknown', 'denied'));
    return jsonResponse(
      { ok: false, code: 'UNAUTHORIZED', error: 'invalid or expired token' },
      401
    );
  }

  if (claim.eventId !== eventId) {
    ctx.waitUntil(logReportAccess(env, eventId, claim.role, 'denied'));
    return jsonResponse(
      {
        ok: false,
        code: 'FORBIDDEN',
        error: 'token event_id claim does not match path :id',
      },
      403
    );
  }

  const result = await buildSharedReport(env.DB, eventId);
  if (!result.ok) {
    if (result.error === 'NOT_FOUND') {
      return jsonResponse({ ok: false, code: 'NOT_FOUND' }, 404);
    }
    return jsonResponse(
      {
        ok: false,
        code: 'MATERIALIZATION_PENDING',
        error: 'event exists but has no materialized signal yet; retry after next cron tick',
      },
      409
    );
  }

  // SR-25: report is a straight readout — no field-stripping by depth.
  // resolveDepth is still called to determine sponsor scope (TL-040 isolation).
  const resolved = resolveDepth(claim);
  let scopedImpressions = result.report.sponsor_impressions;
  if (resolved.sponsorScope) {
    // Scoped sponsor token: filter to own rows only
    scopedImpressions = scopedImpressions.filter((r) => r.sponsor_id === resolved.sponsorScope);
  } else if (resolved.sponsorScopeRequired) {
    // Sponsor role but no sponsor_id on token — block all rows (OSE-595)
    scopedImpressions = [];
  }

  // Q6: re-derive campaign_summary from scoped impressions when a sponsor scope
  // was applied. The builder derives campaign_summary pre-scope; for events where
  // multiple sponsors share a campaign_id the unscoped summary would leak peers'
  // impression counts into the scoped response.
  let scopedCampaignSummary = result.report.campaign_summary;
  if (resolved.sponsorScope || resolved.sponsorScopeRequired) {
    const campaignMap = new Map<
      string,
      {
        campaign_id: string;
        campaign_title: string;
        total_impressions: number;
        sponsor_count: number;
        impressions_by_surface: Record<string, number>;
      }
    >();
    for (const row of scopedImpressions) {
      if (!row.campaign_id) continue;
      // OSE-676: apply the per-(sponsor×surface)-bucket K-anon floor BEFORE
      // summation, mirroring the builder (shared-report-builder.ts) — a sub-K row
      // is DROPPED, never summed raw, so the scoped re-derivation cannot leak a
      // sub-K impression cohort that the unscoped builder floors.
      const floored = applyCountFloor(row.count);
      if (floored.count === null) continue;
      const contribution = floored.count;
      const ex = campaignMap.get(row.campaign_id);
      if (ex) {
        ex.total_impressions += contribution;
        ex.sponsor_count += 1;
        ex.impressions_by_surface[row.surface] =
          (ex.impressions_by_surface[row.surface] ?? 0) + contribution;
      } else {
        campaignMap.set(row.campaign_id, {
          campaign_id: row.campaign_id,
          campaign_title: row.campaign_title ?? 'unknown',
          total_impressions: contribution,
          sponsor_count: 1,
          impressions_by_surface: { [row.surface]: contribution },
        });
      }
    }
    scopedCampaignSummary =
      campaignMap.size > 0
        ? [...campaignMap.values()].sort((a, b) => b.total_impressions - a.total_impressions)
        : null;
  }

  const builtReport = {
    ...result.report,
    sponsor_impressions: scopedImpressions,
    campaign_summary: scopedCampaignSummary,
  };

  // OSE-816 — enforce report depth server-side, SPONSOR role ONLY. admin /
  // bar_owner / internal resolve to premium via resolveDepth (OSE-577), so the
  // filter is a no-op for them — skip it rather than run it pointlessly. This is
  // the ONE gate, at read: never in corridor-map (that module renders, and
  // rendering must not decide entitlement) and never in the client. Two gates
  // drift silently. The filter strips any section above the sponsor's entitled
  // depth and names the withheld-but-present sections in upgrade.locked_sections
  // — a wire contract, not a browser-hidden paywall (doctrine rule 12: a refusal
  // must be printed, not promised). sponsor_impressions scoping (TL-040) is
  // already applied above; the filter's own scoping pass is idempotent over it.
  // sponsor_class_breakdown is present at every depth (OSE-719) — class-level
  // aggregate, the tier-neutral competitive-intel delivery, never stripped.
  let report: Record<string, unknown> = builtReport;
  if (claim.role === 'sponsor') {
    const filtered = filterReportByDepth(builtReport, resolved);
    report = filtered.upgrade ? { ...filtered.report, upgrade: filtered.upgrade } : filtered.report;
  }

  // Q7: in-flight events cache at 5 min so impression counts update visibly between
  // sponsor visits mid-event. Closed events cache at 1 hour (numbers are stable).
  const endDate = result.report.event_end_date;
  const isInFlight = !endDate || new Date(endDate) > new Date();
  const cacheControl = isInFlight ? 'private, max-age=300' : 'private, max-age=3600';

  ctx.waitUntil(logReportAccess(env, eventId, claim.role, 'granted'));
  return jsonResponse({ ok: true, report }, 200, {
    'Cache-Control': cacheControl,
    Vary: 'Authorization',
  });
}

// ─── Batch endpoint (WKRP consumer pattern) ────────────────────────────────

export async function handleBatchSharedReports(
  request: Request,
  env: SharedReportReadEnv,
  ctx: ExecutionContext
): Promise<Response> {
  // OSE-593: Rate limit batch endpoint by service token (IP as proxy for token identity)
  if (env.RATE_LIMIT_KV) {
    const batchIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const batchKey = `batch-sr:${batchIp}`;
    if (
      await checkRateLimit(batchKey, env.RATE_LIMIT_KV, RATE_LIMIT_BATCH_MAX, RATE_LIMIT_WINDOW_MS)
    ) {
      return jsonResponse(
        { ok: false, code: 'RATE_LIMITED', error: 'too many batch requests' },
        429,
        {
          'Retry-After': '60',
        }
      );
    }
  }

  // OSE-577 / ADR-017: access is decided by token CLASS (who holds it), not by
  // "this is the batch endpoint" (SR-25's defect, which handed EVERY service
  // token — including the cross-product one — the full report).
  const token = extractBearerToken(request.headers.get('Authorization'));
  const tokenClass = classifyServiceToken(env, token);
  if (tokenClass === null) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED', error: 'invalid service token' }, 401, {
      'WWW-Authenticate': 'Bearer realm="OurSharedEvents SharedReport batch"',
    });
  }
  if (tokenClass === 'cross_product') {
    // The cross-product (WKRP, named-identity) consumer FAILS CLOSED. Full-depth
    // corridor/venue/time aggregates joined against a name-bearing roster is an
    // unevaluated join risk, and the controls that would catch it (OCR-61/OCR-62
    // identity invariant + spec, OW-112 boundary firewall) are not in place.
    // This is where the choice network is enforced: consent is not auto-extended
    // across the identity boundary. Grant is unblocked only when those ship.
    ctx.waitUntil(logReportAccess(env, 'batch', 'service', 'denied'));
    return jsonResponse(
      {
        ok: false,
        code: 'CROSS_PRODUCT_ACCESS_PENDING',
        error:
          'cross-product SharedReport access is not enabled; named-identity join-risk controls (OCR-61/OCR-62, OW-112) must ship first',
      },
      403,
      { 'WWW-Authenticate': 'Bearer realm="OurSharedEvents SharedReport batch"' }
    );
  }
  // tokenClass === 'internal' — the in-fleet, anonymity-respecting consumer.
  // Depth resolves by role, not endpoint: resolveDepth({ role: 'internal' }) →
  // 'premium' (full payload). A future depth filter (OSE-816) keys off that
  // role, so the full-payload decision below is role-driven, not endpoint-driven.

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'body must be an object' }, 400);
  }

  const bodyObj = body as Record<string, unknown>;
  const ids = bodyObj.ids;
  if (!Array.isArray(ids)) {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: '`ids` must be an array' }, 400);
  }
  if (ids.length === 0) {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: '`ids` must not be empty' }, 400);
  }
  if (ids.length > BATCH_MAX_IDS) {
    return jsonResponse(
      {
        ok: false,
        code: 'BAD_REQUEST',
        error: `\`ids\` exceeds maximum of ${BATCH_MAX_IDS} per request`,
      },
      400
    );
  }
  if (!ids.every((x) => typeof x === 'string' && x.length > 0)) {
    return jsonResponse(
      { ok: false, code: 'BAD_REQUEST', error: '`ids` must contain non-empty strings only' },
      400
    );
  }

  // The internal service class receives the full report (SR-25: no field
  // stripping on this path; OSE-577: granted by role, not endpoint).
  // sponsor_class_breakdown delivers competitive intelligence at the class level
  // without individual cross-sponsor attribution.

  // Deduplicate (consumer might pass the same id twice).
  const uniqueIds = Array.from(new Set(ids as string[]));

  // Parallel fan-out, bounded by S5-Q3 cap of 50.
  const settled = await Promise.all(
    uniqueIds.map(async (id) => {
      const r = await buildSharedReport(env.DB, id);
      return { id, result: r };
    })
  );

  const reports: Record<string, SharedReport> = {};
  const errors: Record<string, { code: string; message: string }> = {};
  for (const { id, result } of settled) {
    if (result.ok) {
      // Internal class → full report. Competitive intelligence is in
      // sponsor_class_breakdown (aggregate class labels), not field-stripping.
      reports[id] = result.report;
    } else if (result.error === 'NOT_FOUND') {
      errors[id] = { code: 'NOT_FOUND', message: 'event does not exist' };
    } else {
      errors[id] = {
        code: 'MATERIALIZATION_PENDING',
        message: 'event exists but has no materialized signal yet',
      };
    }
  }

  // Log aggregate access for each successfully-served event (service role)
  const servedIds = Object.keys(reports);
  if (servedIds.length > 0) {
    ctx.waitUntil(
      Promise.all(servedIds.map((id) => logReportAccess(env, id, 'service', 'granted')))
    );
  }

  return jsonResponse({ ok: true, reports, errors }, 200, {
    'Cache-Control': 'no-store',
  });
}

// ─── Admin mint endpoint (S-3.5.1) ────────────────────────────────────────────

const VALID_MINT_ROLES: readonly SignedLinkRole[] = ['bar_owner', 'sponsor', 'admin'];

/**
 * POST /api/v2/admin/events/:id/shared-report/mint-link
 * Admin-auth-gated. Mints a signed-link token for any event × role × depth.
 *
 * Depth options: 'local' | 'premium'. 'mid' is dormant — rejected with 400.
 * Bar owner and admin tokens always get premium depth (per resolveDepth); the
 * depth field is only meaningful on sponsor tokens and is optional for them.
 */
export async function handleAdminMintSharedReportLink(
  request: Request,
  env: SharedReportReadEnv,
  eventId: string
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'body must be an object' }, 400);
  }
  const b = body as Record<string, unknown>;

  // Validate role
  const role = b.role;
  if (!VALID_MINT_ROLES.includes(role as SignedLinkRole)) {
    return jsonResponse(
      { ok: false, code: 'BAD_REQUEST', error: 'role must be bar_owner, sponsor, or admin' },
      400
    );
  }

  // Validate depth.
  // Sponsor tokens: local | mid | premium all valid. mid is the correct operating
  // depth for sponsors — it exposes campaign_summary and poster_attribution.
  // Non-sponsor tokens (bar_owner, admin): mid is dormant — they always resolve
  // to premium via resolveDepth regardless of depth claim.
  const depth = b.depth;
  if (depth !== undefined) {
    const isSponsorRole = role === 'sponsor';
    const validDepths = isSponsorRole ? ['local', 'mid', 'premium'] : ['local', 'premium'];
    if (!validDepths.includes(depth as string)) {
      return jsonResponse(
        {
          ok: false,
          code: 'BAD_REQUEST',
          error: isSponsorRole
            ? 'depth must be "local", "mid", or "premium"'
            : 'depth must be "local" or "premium" (mid is dormant for non-sponsor roles)',
        },
        400
      );
    }
  }
  // Q2: sponsor tokens with no explicit depth default to mid — ensures campaign_summary
  // and poster_attribution are available. Depth-absent sponsor tokens (State C) are a
  // configuration error; defaulting here prevents them from being minted.
  const effectiveDepth = role === 'sponsor' && depth === undefined ? 'mid' : depth;

  // OSE-595: sponsor role requires sponsor_id — a token without one would let
  // the bearer see all competitors' impression data (the single-endpoint scope
  // check blocks this at read time, but blocking at mint is defence-in-depth
  // and prevents the token from being issued at all).
  const sponsorId = b.sponsor_id;
  if (role === 'sponsor' && (typeof sponsorId !== 'string' || sponsorId.length === 0)) {
    return jsonResponse(
      { ok: false, code: 'BAD_REQUEST', error: 'sponsor_id is required for role "sponsor"' },
      400
    );
  }
  if (sponsorId !== undefined && (typeof sponsorId !== 'string' || sponsorId.length === 0)) {
    return jsonResponse(
      { ok: false, code: 'BAD_REQUEST', error: 'sponsor_id must be a non-empty string' },
      400
    );
  }

  // OSE-577: verify sponsor_id exists for this event before embedding in token.
  // Prevents minting tokens scoped to a sponsor that doesn't belong to the event.
  if (role === 'sponsor' && typeof sponsorId === 'string') {
    // OSE-799 A2: "belongs to this event" = the sponsor_business has a placement
    // on it. sponsorId is the durable business id embedded in the token.
    const sponsorRow = await env.DB.prepare(
      // A sponsor's own request the organizer has not approved (sponsor
      // discovery, source='sponsor_request', is_active=0) is not membership.
      `SELECT id FROM sponsor_placement WHERE sponsor_business_id = ? AND event_id = ?
          AND NOT (source = 'sponsor_request' AND is_active = 0) LIMIT 1`
    )
      .bind(sponsorId, eventId)
      .first();
    if (!sponsorRow) {
      return jsonResponse(
        { ok: false, code: 'BAD_REQUEST', error: 'sponsor_id does not belong to this event' },
        400
      );
    }
  }

  // Validate TTL: ttl_minutes (5–1440) mints run-scoped tokens; else ttl_days
  // (1–365, default 7). Both is ambiguous → 400. Logic is pure (lib/mint-ttl).
  const ttl = resolveMintTtlSeconds(b);
  if ('error' in ttl) {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: ttl.error }, 400);
  }

  const token = await mintSignedLinkToken(env, eventId, role as SignedLinkRole, ttl.ttlSeconds, {
    ...(effectiveDepth !== undefined ? { depth: effectiveDepth as string } : {}),
    ...(typeof sponsorId === 'string' ? { sponsor_id: sponsorId } : {}),
  });

  if (!token) {
    return jsonResponse(
      {
        ok: false,
        code: 'CONFIGURATION_ERROR',
        error: 'SHARED_REPORT_SIGNING_SECRET is not configured',
      },
      503
    );
  }

  const expiresAt = new Date(Date.now() + ttl.ttlSeconds * 1000).toISOString();
  return jsonResponse({ ok: true, token, expires_at: expiresAt }, 200, {
    'Cache-Control': 'no-store',
  });
}
