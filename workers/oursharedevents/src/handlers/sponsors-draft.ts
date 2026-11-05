/**
 * Sponsor onboarding draft-capture handler (OSE-732 / T6a).
 *
 * POST /api/v2/sponsors/draft
 *   Auth: signed invite token (Authorization: Bearer <invite>), NOT admin bearer.
 *   Writes ONLY to sponsor_business_draft — never to `sponsors`, and never
 *   imports the resolver/allocation modules (the draft stays resolver-invisible,
 *   #25). brand_id is taken from the SIGNED token claim, never the request body
 *   (#9). is_local is server-derived from geocoding, never a client toggle.
 *
 * Fail-safe posture:
 *   - Missing/invalid invite token → 401.
 *   - A draft_token belonging to another brand → 403 (cross-tenant write blocked).
 *   - Malformed / off-registry category_selections → 400 (fail closed, no write).
 *   - Geocode failure → persist with is_local_derived=0 + is_local_review_flag=1
 *     (manual review) rather than trusting any client-supplied locality.
 */

import { geocodeVenue } from '../lib/geo';
import { type MapsEnv } from '../lib/maps';
import { tagCoordinates } from '../lib/h3-tagging';
import { verifySponsorInviteToken, type SponsorInviteEnv } from '../lib/sponsor-invite';
import { parseJsonBody, errorResponse, jsonResponse } from '../lib/form-validation';
import { validateProxiedLogoUrl } from '../lib/sponsor-logo';
import {
  promoteSponsorDraft,
  type PromotionEnv,
  type PromotionResult,
} from '../lib/sponsor-promotion';
import { logAdminAction, type AuditLogEnv } from '../lib/audit-log';
import {
  extractAdminActor,
  isDevOpenAdmin,
  logNullAdminActorDenied,
  type AdminEnv,
} from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';

export type SponsorDraftEnv = { DB: D1Database } & SponsorInviteEnv & MapsEnv;

interface CategorySelection {
  category: string;
  mode: 'whole' | 'custom';
  excluded?: string[];
  consent_flags?: Record<string, unknown>;
}

function bearer(request: Request): string | null {
  const m = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Validate category_selections shape AND membership against category_registry.
 * Returns the normalized JSON string on success, or null on ANY problem
 * (fail closed — the caller returns 400 without writing).
 */
async function validateCategorySelections(db: D1Database, raw: unknown): Promise<string | null> {
  if (!Array.isArray(raw)) return null;
  const registry = await db.prepare('SELECT category FROM category_registry').all<{
    category: string;
  }>();
  const known = new Set((registry.results ?? []).map((r) => r.category));

  const normalized: CategorySelection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const sel = item as Record<string, unknown>;
    if (typeof sel.category !== 'string' || !known.has(sel.category)) return null;
    if (sel.mode !== 'whole' && sel.mode !== 'custom') return null;
    if (sel.excluded !== undefined) {
      if (!Array.isArray(sel.excluded) || sel.excluded.some((x) => typeof x !== 'string')) {
        return null;
      }
    }
    normalized.push({
      category: sel.category,
      mode: sel.mode,
      ...(sel.excluded !== undefined ? { excluded: sel.excluded as string[] } : {}),
      ...(sel.consent_flags !== undefined && typeof sel.consent_flags === 'object'
        ? { consent_flags: sel.consent_flags as Record<string, unknown> }
        : {}),
    });
  }
  return JSON.stringify(normalized);
}

export async function handleCreateSponsorDraft(
  request: Request,
  env: SponsorDraftEnv
): Promise<Response> {
  // 1. Invite-token auth — brand scope comes from the SIGNED claim only.
  const claim = await verifySponsorInviteToken(env, bearer(request));
  if (!claim) {
    return errorResponse('UNAUTHORIZED', 'Valid sponsor invite token required', 401, request);
  }
  const brandId = claim.brand_id;

  // 2. Body.
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    if (parsed.reason === 'PAYLOAD_TOO_LARGE') {
      return errorResponse('PAYLOAD_TOO_LARGE', 'Request body exceeds limit', 413, request);
    }
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400, request);
  }
  const body = parsed.body;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return errorResponse('INVALID_NAME', 'name is required', 400, request);

  // 3. category_selections — fail closed on malformed / off-registry.
  const categoryJson = await validateCategorySelections(env.DB, body.category_selections ?? []);
  if (categoryJson === null) {
    return errorResponse(
      'INVALID_CATEGORY_SELECTIONS',
      'category_selections must be an array of {category (in registry), mode: whole|custom}',
      400,
      request
    );
  }

  // 4. Ownership check for an existing draft_token (cross-tenant write guard).
  const providedToken = typeof body.draft_token === 'string' ? body.draft_token : null;
  if (providedToken) {
    const existing = await env.DB.prepare(
      'SELECT brand_id, status FROM sponsor_business_draft WHERE draft_token = ?'
    )
      .bind(providedToken)
      .first<{ brand_id: string; status: string }>();
    if (existing) {
      if (existing.brand_id !== brandId) {
        return errorResponse('FORBIDDEN', 'Draft belongs to another brand', 403, request);
      }
      if (existing.status === 'promoted') {
        return errorResponse('CONFLICT', 'Draft already promoted', 409, request);
      }
    }
  }
  const draftToken = providedToken ?? crypto.randomUUID();

  // 5. Server-side geocode — is_local is NEVER read from the client body.
  const addressRaw = typeof body.address_raw === 'string' ? body.address_raw : null;
  let lat: number | null = null;
  let lon: number | null = null;
  let h3Res9: string | null = null;
  let h3Res7: string | null = null;
  // Draft locality is always flagged for review — the authoritative is_local
  // derivation happens at promotion (T8) against the event corridor. We never
  // trust a client toggle, so is_local_derived stays 0 here.
  const isLocalReviewFlag = 1;
  if (addressRaw) {
    const geo = await geocodeVenue(env, addressRaw);
    if (geo.ok) {
      lat = geo.result.lat;
      lon = geo.result.lng;
      try {
        const tags = tagCoordinates(lat, lon);
        h3Res9 = tags.h3_res9;
        h3Res7 = tags.h3_res7;
      } catch {
        // invalid coords — leave h3 null, still review-flagged
      }
    }
    // geocode failure → lat/lon/h3 stay null, is_local_review_flag=1 (fail-safe)
  }

  // 6. Optional scoping + covenant.
  const eventId = claim.event_id ?? (typeof body.event_id === 'string' ? body.event_id : null);
  const campaignId =
    claim.campaign_id ?? (typeof body.campaign_id === 'string' ? body.campaign_id : null);
  const websiteUrl = typeof body.website_url === 'string' ? body.website_url : null;
  // OSE-1433: the same rule as admin create/update — a logo the proxy will fetch
  // must be http(s) on a public host. Checked here AND at promotion (a draft
  // captured before this rule must not reach sponsor_asset).
  const logoCheck = validateProxiedLogoUrl(body.logo_url ?? null);
  if (!logoCheck.valid) {
    return errorResponse(
      'INVALID_LOGO_URL',
      'logo_url must be an http:// or https:// URL on a public web host (max 500 chars)',
      400,
      request
    );
  }
  const logoUrl = logoCheck.url;
  const businessType = typeof body.business_type === 'string' ? body.business_type : null;
  const covenantAt = body.covenant_acknowledged === true ? new Date().toISOString() : null;

  // 7. Upsert — INSERT ... ON CONFLICT(draft_token) DO UPDATE. brand_id is
  // server-set from the token claim; created_at is preserved on update.
  await env.DB.prepare(
    `INSERT INTO sponsor_business_draft (
       draft_token, brand_id, event_id, campaign_id, name, website_url, logo_url,
       address_raw, lat, lon, h3_res9, h3_res7, is_local_derived, is_local_review_flag,
       business_type, category_selections, covenant_acknowledged_at, status, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'draft', datetime('now'))
     ON CONFLICT(draft_token) DO UPDATE SET
       brand_id = excluded.brand_id,
       event_id = excluded.event_id,
       campaign_id = excluded.campaign_id,
       name = excluded.name,
       website_url = excluded.website_url,
       logo_url = excluded.logo_url,
       address_raw = excluded.address_raw,
       lat = excluded.lat,
       lon = excluded.lon,
       h3_res9 = excluded.h3_res9,
       h3_res7 = excluded.h3_res7,
       is_local_derived = 0,
       is_local_review_flag = excluded.is_local_review_flag,
       business_type = excluded.business_type,
       category_selections = excluded.category_selections,
       covenant_acknowledged_at = COALESCE(excluded.covenant_acknowledged_at, sponsor_business_draft.covenant_acknowledged_at),
       updated_at = datetime('now')`
  )
    .bind(
      draftToken,
      brandId,
      eventId,
      campaignId,
      name,
      websiteUrl,
      logoUrl,
      addressRaw,
      lat,
      lon,
      h3Res9,
      h3Res7,
      isLocalReviewFlag,
      businessType,
      categoryJson,
      covenantAt
    )
    .run();

  return jsonResponse(
    { ok: true, draft_token: draftToken, is_local_review_flag: isLocalReviewFlag },
    request
  );
}

/**
 * POST /api/v2/admin/sponsors/promote  (admin-gated in the router, OSE-736 / T8).
 * Body: { draft_token }. Promotes a covenant-acknowledged, brand-matched draft to
 * a live sponsor — the single crossing of the #25 resolver-invisibility wall.
 * All the security invariants (tier force, double-promote guard, brand match,
 * JSON-subset) live in promoteSponsorDraft; this is a thin HTTP wrapper.
 */
export async function handlePromoteSponsorDraft(
  request: Request,
  env: PromotionEnv & AdminEnv & AuditLogEnv,
  ctx: ExecutionContext,
  reqId: string
): Promise<Response> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400, request);
  }
  const draftToken = typeof parsed.body.draft_token === 'string' ? parsed.body.draft_token : '';
  if (!draftToken) return errorResponse('MISSING_FIELD', 'draft_token is required', 400, request);

  // Optional comp/prepaid path: a SIGNED sponsor-invite token. The lib verifies it
  // and requires its claim.brand_id to match the draft's brand (#9); we never read
  // a brand from the request body here.
  const compInviteToken =
    typeof parsed.body.comp_invite_token === 'string' ? parsed.body.comp_invite_token : undefined;

  // AUD-3 S17 (#9): the caller must belong to the draft's brand. The lib only
  // proves the draft and its event share a brand; without this check any admin
  // holding another tenant's draft token could promote it. An out-of-scope draft
  // takes the lib's own not-found result, so the response and the audit row are
  // identical to a missing draft (no existence oracle).
  const scopeVerdict = await draftScopeVerdict(request, env, draftToken);
  if (scopeVerdict === 'no-actor') logNullAdminActorDenied('sponsor-draft-promote', env, reqId);
  const result: PromotionResult =
    scopeVerdict !== 'in-scope'
      ? { ok: false, code: 'DRAFT_NOT_FOUND', status: 404 }
      : await promoteSponsorDraft(env, draftToken, { compInviteToken });

  // Eligibility-decision audit (#24 auditability). PII-FREE: brand_id is a tenant
  // id, and the details carry only the decision + granting source — no email, ip,
  // name, or anon_id. Fire-and-forget via waitUntil so it never blocks the wall
  // crossing or the 402.
  ctx.waitUntil(
    logAdminAction(env, {
      action: 'SPONSOR_ELIGIBILITY_DECISION',
      actor: extractAdminActor(request, env),
      resource_type: 'sponsor_draft',
      resource_id: result.brand_id,
      brand_id: result.brand_id ?? null,
      request_id: reqId,
      outcome: result.ok ? 'success' : 'denied',
      details: result.ok
        ? { decision: 'granted', source: result.eligibility_source }
        : { decision: result.code === 'PAYMENT_REQUIRED' ? 'payment_required' : result.code },
    })
  );

  if (!result.ok) return errorResponse(result.code, result.code, result.status, request);
  return jsonResponse(
    { ok: true, sponsor_id: result.sponsor_id, template_ids: result.template_ids },
    request
  );
}

/**
 * Whether the caller may promote this draft: 'outside' when the draft belongs to
 * a brand outside the caller's scope, 'in-scope' otherwise (a missing draft too:
 * the lib reports it as not found). A null actor is 'in-scope' only when the
 * DEV_OPEN_ADMIN local-dev bypass is really on, and 'no-actor' anywhere else
 * (OSE-1801); the caller logs that case. It logs nothing itself, so the draft
 * token it is given never reaches a log call.
 */
async function draftScopeVerdict(
  request: Request,
  env: PromotionEnv & AdminEnv & AdminBrandScopeEnv,
  draftToken: string
): Promise<'in-scope' | 'outside' | 'no-actor'> {
  const actor = extractAdminActor(request, env);
  if (actor === null) return isDevOpenAdmin(env) ? 'in-scope' : 'no-actor';
  const scope = await resolveAdminBrandScopeAsync(actor, env);
  if (scope.mode === 'all') return 'in-scope';
  const row = await env.DB.prepare(
    'SELECT brand_id FROM sponsor_business_draft WHERE draft_token = ?'
  )
    .bind(draftToken)
    .first<{ brand_id: string }>();
  if (!row) return 'in-scope'; // a missing draft: the lib reports it as not found
  return scope.mode === 'deny' || !scope.brandIds.includes(row.brand_id) ? 'outside' : 'in-scope';
}
