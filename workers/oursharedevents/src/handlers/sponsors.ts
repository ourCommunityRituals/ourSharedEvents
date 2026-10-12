/**
 * Sponsors API handler.
 *
 * Admin CRUD (auth-gated):
 *   GET    /api/v2/admin/sponsors              – list all sponsors
 *   GET    /api/v2/admin/sponsors/:id          – get sponsor by ID
 *   POST   /api/v2/admin/sponsors              – create sponsor
 *   PUT    /api/v2/admin/sponsors/:id          – update sponsor
 *   DELETE /api/v2/admin/sponsors/:id          – soft delete (is_active=0)
 *   PUT    /api/v2/admin/sponsors/:id/event-types  – set event type associations
 *   GET    /api/v2/admin/sponsors/:id/event-types  – get event type associations
 *   PUT    /api/v2/admin/sponsors/:id/areas    – set service areas
 *   GET    /api/v2/admin/sponsors/:id/areas    – get service areas
 *
 * Public (no auth):
 *   GET    /api/v2/events/:id/sponsors         – resolved sponsors for event
 *   GET    /api/v2/events/:id/sponsor-bundle   – sponsor bundle with surface filtering
 *   POST   /api/v2/events/:id/sponsors/:sid/impression – log impression
 *   POST   /api/v2/events/:id/sponsors/:sid/click      – log click
 *
 * Public (no auth):
 *   GET    /api/v2/sponsors/:id/logo         – proxy + validate external logo (OSE-288)
 *
 * Data source: D1 database (DB binding)
 */

import { corsHeaders } from '../lib/cors';
import { isJsonContentType } from '../lib/content-type';
import {
  filterSponsorsForSurface,
  buildSponsorBundle,
  type Surface,
  type SponsorRow,
} from '../lib/sponsor-resolver';
import {
  validateProxiedLogoUrl,
  validateHttpsUrl,
  fetchAndProxyLogo,
  LOGO_MAX_IN_FLIGHT,
} from '../lib/sponsor-logo';
import { CARD_FIELDS, checkCardField, type CardField } from '../lib/sponsor-card';
import { isPublicReadLimited, type PublicReadLimitEnv } from '../lib/public-read-limit';
import {
  getDataProvider,
  invalidateSponsorsCache,
  type DataProviderEnv,
} from '../lib/data-provider.js';
import type { DataProviderCtx } from '@ocr/data-provider';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
// NOTE: maybeTag is imported here because sponsors.ts is an admin/creation-time
// handler — NOT a scan-path handler. The hot-path invariant (S-6.3.1c) permits
// this import. Do NOT add sponsors.ts to the SCAN_PATH list in h3-tagging.spec.ts.
import { maybeTag } from '../lib/h3-tagging';
import { MAP_FLIP_NOTE, auditMapFlip, flipFired, mapFlipStatement } from '../lib/map-default';
import { classifyBeacon, type InvalidTrafficEnv } from '../lib/invalid-traffic';
import { mintBeaconToken, verifyBeaconToken, type BeaconTokenEnv } from '../lib/beacon-token';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SponsorsEnv
  extends DataProviderEnv, AdminBrandScopeEnv, AdminEnv, InvalidTrafficEnv, BeaconTokenEnv {
  WORKER_ENV?: string;
  DB?: D1Database;
  PUBLISH_GRACE_MINUTES?: string;
}

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function errorResponse(code: string, message: string, status: number, rid: string): Response {
  return Response.json(
    {
      ok: false,
      status,
      code,
      error: message,
      requestId: rid,
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

function generateId(prefix = 'sp'): string {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────────

const MAX_BODY = 16 * 1024;
const VALID_TIERS = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'] as const;
const VALID_SURFACES: Surface[] = ['poster', 'display', 'public', 'sharedReport'];

const BRAND_PATTERN = /^[a-z0-9_-]{1,64}$/;

/**
 * OSE-1316/1317: tier is REQUIRED on create. Absent/blank → MISSING_TIER; any
 * value outside VALID_TIERS → INVALID_TIER. (The six stored tiers map to the
 * three share-of-voice tiers — premium / mid / base — via sovTierOf.)
 */
function checkTier(raw: unknown, rid: string): string | Response {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return errorResponse(
      'MISSING_TIER',
      `Choose a tier before saving: one of ${VALID_TIERS.join(', ')}`,
      400,
      rid
    );
  }
  if (typeof raw !== 'string' || !(VALID_TIERS as readonly string[]).includes(raw)) {
    return errorResponse(
      'INVALID_TIER',
      `tier must be one of: ${VALID_TIERS.join(', ')}`,
      400,
      rid
    );
  }
  return raw;
}

/**
 * OSE-1317: website is optional; when present it must be an https:// URL (the
 * visitor's own browser follows it). Reuses validateHttpsUrl — the same rule as
 * events.what_url. Returns the stored value (null when absent) or a 400.
 */
function checkWebsite(raw: unknown, rid: string): string | null | Response {
  const v = typeof raw === 'string' ? raw.trim() : raw;
  const check = validateHttpsUrl(v ?? null);
  if (!check.valid) {
    return errorResponse(
      'INVALID_WEBSITE_URL',
      'Website must be a full https:// address (for example https://example.com), under 500 characters',
      400,
      rid
    );
  }
  return check.url;
}

/**
 * The brand a POOL sponsor (no event) belongs to. Derived from the server-
 * verified actor's scope (#9): a scoped operator gets their brand (or the
 * requested one if they are a member of it), an unscopable operator is refused,
 * and the automation 'all' scope may name any well-formed brand (default 'root',
 * the same default event create uses).
 */
async function resolvePoolBrand(
  request: Request,
  env: SponsorsEnv,
  rawBrand: unknown,
  rid: string
): Promise<string | Response> {
  const requested = typeof rawBrand === 'string' ? rawBrand.trim() : '';
  if (requested && !BRAND_PATTERN.test(requested)) {
    return errorResponse(
      'INVALID_BRAND',
      'brand_id must be lowercase alphanumeric, hyphens, or underscores (1-64 chars)',
      400,
      rid
    );
  }
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') {
    return errorResponse(
      'BRAND_FORBIDDEN',
      'Your admin account is not a member of any brand, so a sponsor cannot be created without an event',
      403,
      rid
    );
  }
  if (scope.mode === 'scoped') {
    if (requested && !scope.brandIds.includes(requested)) {
      return errorResponse('BRAND_FORBIDDEN', `Not entitled to brand_id "${requested}"`, 403, rid);
    }
    return requested || scope.brandIds[0];
  }
  return requested || 'root';
}

function isValidContentType(request: Request): boolean {
  return isJsonContentType(request.headers.get('content-type'));
}

async function parseBody(
  request: Request,
  rid: string
): Promise<Record<string, unknown> | Response> {
  if (!isValidContentType(request)) {
    return errorResponse('BAD_CONTENT_TYPE', 'Content-Type must be application/json', 400, rid);
  }
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) {
      return errorResponse('PAYLOAD_TOO_LARGE', 'Body must be under 16KB', 400, rid);
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400, rid);
  }
}

// ─── Admin: List Sponsors ───────────────────────────────────────────────────────

export async function handleAdminListSponsors(
  request: Request,
  env: SponsorsEnv
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  }

  // OSE — Sponsor card event-scoping. On a shared/multi-tenant instance an
  // unscoped list lets an organizer see (and mis-edit/deactivate) another
  // organizer's sponsor. Scope is enforced HERE in the SQL WHERE clause with a
  // bound parameter — never client-side .filter() — so no query string can
  // widen it.
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const brandId = url.searchParams.get('brand_id');

  // OSE-674 (#9 tenant_isolation) — the cross-event manager view keys off a
  // client ?brand_id=, which is caller-CHOSEN scope, not authorized scope. The
  // SQL WHERE being server-side does NOT make the scope authorized. Derive the
  // caller's real brand membership from the SERVER-VERIFIED actor (OSE-666/B2)
  // and INTERSECT: a forged brand_id outside the caller's membership is 403, an
  // unscopable caller gets zero rows, and the server scope also caps the final
  // set so a forged ?eventId= from another tenant can never widen it. Mirrors
  // handleAdminListEvents — the canonical #9 enforcement point.
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') {
    return Response.json(
      { ok: true, status: 200, items: [], scopedTo: eventId ?? null },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  }
  if (scope.mode === 'scoped' && brandId && !scope.brandIds.includes(brandId)) {
    return errorResponse('BRAND_FORBIDDEN', `Not entitled to brand_id "${brandId}"`, 403, rid);
  }

  // OSE-799 A2: a "sponsor" row is the split model reconstructed — identity from
  // sponsor_business, logo from sponsor_asset(format='logo'), per-event economics
  // from sponsor_placement. `id` is the durable sponsor_business id (the caller's
  // handle for GET/PUT/DELETE); one row per placement (per sponsor × event).
  // OSE-1316/1317: a sponsor can exist with NO placement (the brand pool), so the
  // list starts from sponsor_business and LEFT JOINs placements — a pool sponsor
  // is one row with event_id = null and its business tier. ?eventId= still keeps
  // only that event's placements.
  const cols = `sb.id AS id, sp.event_id AS event_id, sb.name AS name,
                sb.display_name AS display_name, sb.address_line AS address_line,
                sb.contact_phone AS contact_phone, sb.contact_email AS contact_email,
                la.url AS logo_url, lc.url AS sidebar_logo_url,
                sb.website_url AS website_url, COALESCE(sp.tier, sb.tier) AS tier,
                '[]' AS placement_formats, sp.click_token AS click_token,
                sp.display_token AS display_token, sb.is_active AS is_active,
                sp.organizer_accepted AS organizer_accepted,
                sp.sponsor_accepted AS sponsor_accepted,
                sp.id AS placement_id, sp.is_active AS placement_active,
                sp.source AS placement_source,
                COALESCE(sp.created_at, sb.created_at) AS created_at,
                COALESCE(sp.updated_at, sb.updated_at) AS updated_at`;
  const from = `sponsor_business sb
                LEFT JOIN sponsor_placement sp ON sp.sponsor_business_id = sb.id
                LEFT JOIN sponsor_asset la ON la.sponsor_business_id = sb.id AND la.format = 'logo'
                LEFT JOIN sponsor_asset lc ON lc.sponsor_business_id = sb.id AND lc.format = 'logo_compact'`;
  const where: string[] = [];
  const binds: string[] = [];
  if (eventId) {
    where.push('sp.event_id = ?');
    binds.push(eventId);
  }
  if (brandId) {
    // Direct brand scope — the business carries its own tenant column now.
    where.push('sb.brand_id = ?');
    binds.push(brandId);
  }
  // Server-derived scope cap (intersection): scoped callers only ever reach
  // sponsors whose business belongs to a brand they are a member of. 'all' (CI/
  // automation opt-in) applies no cap.
  if (scope.mode === 'scoped') {
    const clause = brandScopeClause(scope.brandIds, 'sb.brand_id');
    where.push(clause.sql.replace(/^ AND /, ''));
    binds.push(...clause.params);
  }
  const sql =
    `SELECT ${cols} FROM ${from}` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY COALESCE(sp.updated_at, sb.updated_at) DESC`;

  try {
    const result = await env.DB.prepare(sql)
      .bind(...binds)
      .all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [], scopedTo: eventId ?? null },
      { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminListSponsors',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query sponsors', 503, rid);
  }
}

// ─── Per-ID brand-scope guard (OSE-710 / #9 tenant_isolation) ───────────────────
//
// The LIST endpoint (handleAdminListSponsors) enforces #9 in its SQL WHERE, but
// the per-ID GET/PUT/DELETE handlers historically took the :id straight to the
// query with NO scope predicate — so a brand-A operator who knew a brand-B
// sponsor id could read AND mutate it cross-tenant. This helper mirrors the list
// endpoint's server-derived-scope pattern for a single id: it returns a bound
// SQL fragment (+ params) that caps the row to sponsors whose event belongs to a
// brand the SERVER-VERIFIED actor is a member of.
//
//   - mode 'deny'  (anon / unmapped / unscopable): { reachable: false } → the
//                  caller reaches nothing; handlers return 404 (indistinguishable
//                  from "does not exist" — a forged id is never confirmed).
//   - mode 'all'   (CI/automation opt-in): brandIds = null → no predicate.
//   - mode 'scoped': brandIds = the caller's authorized set → each site builds
//                  `AND <col> IN (?..)` against sponsor_business.brand_id.
//
// OSE-799 A2: the scope now keys directly on `sponsor_business.brand_id` (the
// durable identity carries its own tenant column) instead of the old
// `event_id IN (SELECT id FROM events WHERE brand_id …)` join through the retired
// `sponsors.event_id`. Simpler and stronger — brand membership is one hop, not a
// subquery through the event table. The helper returns the brand set; each call
// site builds the predicate with brandScopeClause() so it can target the right
// column/alias (`brand_id`, `sb.brand_id`, …).
type PerIdScope = { reachable: false } | { reachable: true; brandIds: string[] | null };

async function resolvePerIdSponsorScope(request: Request, env: SponsorsEnv): Promise<PerIdScope> {
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') return { reachable: false };
  if (scope.mode === 'all') return { reachable: true, brandIds: null };
  return { reachable: true, brandIds: scope.brandIds };
}

// Build a bound `AND <col> IN (?..)` fragment from a resolved brand set. `null`
// (mode 'all') yields no predicate. Never a client-side filter — the caps live in
// the SQL WHERE with bound params so no id/query string can widen scope.
function brandScopeClause(
  brandIds: string[] | null,
  col: string
): { sql: string; params: string[] } {
  if (!brandIds) return { sql: '', params: [] };
  const ph = brandIds.map(() => '?').join(', ');
  return { sql: ` AND ${col} IN (${ph})`, params: brandIds };
}

/**
 * OSE-722 (#9): parent-reachability gate for sponsor SUB-resources (event-types,
 * areas). Those tables key off `sponsor_id` and carry no brand column, so we
 * first confirm the PARENT sponsor is inside the caller's authorized brand scope
 * (the same predicate as resolvePerIdSponsorScope). A forged / cross-tenant id is
 * unreachable → the caller gets the same 404 as a non-existent sponsor and never
 * reads or mutates another brand's sub-resources. Sibling fix to OSE-710, which
 * closed the identical hole on the sponsor GET/PUT/DELETE handlers.
 */
async function isSponsorReachable(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<boolean> {
  if (!env.DB) return false;
  const scope = await resolvePerIdSponsorScope(request, env);
  if (!scope.reachable) return false;
  // OSE-799 A2: the sponsor id is the sponsor_business id; scope on its brand_id.
  const clause = brandScopeClause(scope.brandIds, 'brand_id');
  const row = await env.DB.prepare(`SELECT id FROM sponsor_business WHERE id = ?${clause.sql}`)
    .bind(sponsorId, ...clause.params)
    .first();
  return !!row;
}

// ─── Admin: Get Sponsor ─────────────────────────────────────────────────────────

export async function handleAdminGetSponsor(
  request: Request,
  env: SponsorsEnv,
  id: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('NOT_FOUND', `Sponsor not found: ${id}`, 404, rid);

  // OSE-710 (#9): cap the lookup to the caller's authorized brand scope. A forged
  // id from another tenant collapses to the same NOT_FOUND as a non-existent id.
  const scope = await resolvePerIdSponsorScope(request, env);
  if (!scope.reachable) return errorResponse('NOT_FOUND', `Sponsor not found: ${id}`, 404, rid);

  // OSE-799 A2: reconstruct the sponsor from the split model; scope on brand_id.
  const clause = brandScopeClause(scope.brandIds, 'sb.brand_id');
  try {
    const row = await env.DB.prepare(
      `SELECT sb.id AS id, sp.event_id AS event_id, sb.name AS name,
              sb.display_name AS display_name, sb.address_line AS address_line,
              sb.contact_phone AS contact_phone, sb.contact_email AS contact_email,
              la.url AS logo_url, lc.url AS sidebar_logo_url,
              sb.website_url AS website_url, COALESCE(sp.tier, sb.tier) AS tier,
              '[]' AS placement_formats, sp.click_token AS click_token,
              sp.display_token AS display_token, COALESCE(sp.is_active, sb.is_active) AS is_active,
              COALESCE(sp.locality_band, 0) AS is_local,
              sb.lat AS lat, sb.lon AS lon, sb.h3_res9 AS h3_res9, sb.h3_res7 AS h3_res7,
              sp.created_at AS created_at, sp.updated_at AS updated_at
         FROM sponsor_business sb
         LEFT JOIN sponsor_placement sp ON sp.sponsor_business_id = sb.id
         LEFT JOIN sponsor_asset la ON la.sponsor_business_id = sb.id AND la.format = 'logo'
         LEFT JOIN sponsor_asset lc ON lc.sponsor_business_id = sb.id AND lc.format = 'logo_compact'
        WHERE sb.id = ?${clause.sql}
        ORDER BY sp.created_at ASC
        LIMIT 1`
    )
      .bind(id, ...clause.params)
      .first();
    if (!row) return errorResponse('NOT_FOUND', `Sponsor not found: ${id}`, 404, rid);

    return Response.json(
      { ok: true, status: 200, item: row },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminGetSponsor',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query sponsor', 503, rid);
  }
}

// ─── Admin: Create Sponsor ──────────────────────────────────────────────────────

export async function handleAdminCreateSponsor(
  request: Request,
  env: SponsorsEnv
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  if (!name) return errorResponse('MISSING_FIELD', 'Missing required field: name', 400, rid);

  // OSE-1316/1317: tier is the ONE hard gate at creation. It used to default
  // silently to 'primary', so a sponsor could be created with no tier chosen.
  const tierCheck = checkTier(body.tier, rid);
  if (tierCheck instanceof Response) return tierCheck;
  const tier = tierCheck;

  // OSE-1316/1317: the event is OPTIONAL. A sponsor can sit in the brand's pool
  // with no event and be attached later; an event given here is a shortcut.
  const eventId =
    typeof body.event_id === 'string' && body.event_id.trim()
      ? body.event_id.trim().slice(0, 128)
      : null;

  const id = generateId('sp');
  // Two logos, both optional: the header logo (wide) stays format 'logo' so every
  // existing reader keeps working; the sidebar logo (square/compact) is its own
  // format 'logo_compact' (migration 0081). No logo → surfaces render the name.
  const logoValidation = validateProxiedLogoUrl(body.logo_url ?? null);
  if (!logoValidation.valid) {
    return errorResponse(
      'INVALID_LOGO_URL',
      'Header logo must be an http:// or https:// URL on a public web host (max 500 chars)',
      400,
      rid
    );
  }
  const logoUrl = logoValidation.url;
  const compactValidation = validateProxiedLogoUrl(body.sidebar_logo_url ?? null);
  if (!compactValidation.valid) {
    return errorResponse(
      'INVALID_SIDEBAR_LOGO_URL',
      'Sidebar logo must be an http:// or https:// URL on a public web host (max 500 chars)',
      400,
      rid
    );
  }
  const compactLogoUrl = compactValidation.url;
  // Website is an OUTBOUND link the visitor's own browser follows → https only,
  // the same rule as events.what_url. Empty/absent is fine (no link renders).
  const siteCheck = checkWebsite(body.website_url, rid);
  if (siteCheck instanceof Response) return siteCheck;
  const websiteUrl = siteCheck;
  // 0083: the public card — display name, location, phone, email. All optional;
  // a sponsor with only a business name is complete.
  const card: Record<CardField, string | null> = {
    display_name: null,
    address_line: null,
    contact_phone: null,
    contact_email: null,
  };
  for (const field of CARD_FIELDS) {
    const r = checkCardField(field, body[field]);
    if (!r.ok) return errorResponse(r.code, r.message, 400, rid);
    card[field] = r.value;
  }
  // OSE-670/OSE-799 (#25): placement is UNIFORM and non-purchasable. The client
  // CANNOT choose a named slot — that was the covenant violation. sponsor_placement
  // carries NO placement_formats column at all now (the split retired it); the
  // resolver treats every sponsor as eligible for every surface (buildShareRotation).
  // body.placement_formats is intentionally ignored.
  const clickToken = typeof body.click_token === 'string' ? body.click_token.slice(0, 256) : null;
  const displayToken =
    typeof body.display_token === 'string' ? body.display_token.slice(0, 256) : null;
  const now = new Date().toISOString();

  // ── H3 geo-tagging (opt-in, admin creation path) ─────────────────────────
  const rawLat = body.lat;
  const rawLon = body.lon;
  const hasCoords =
    typeof rawLat === 'number' &&
    typeof rawLon === 'number' &&
    Number.isFinite(rawLat) &&
    Number.isFinite(rawLon);

  if (hasCoords && (rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180)) {
    return errorResponse(
      'INVALID_COORDINATES',
      'lat must be -90..90 and lon must be -180..180',
      400,
      rid
    );
  }

  const sponsorLat = hasCoords ? (rawLat as number) : null;
  const sponsorLon = hasCoords ? (rawLon as number) : null;
  const h3Tags = maybeTag(sponsorLat, sponsorLon);
  const sponsorH3Res9 = h3Tags?.h3_res9 ?? null;
  const sponsorH3Res7 = h3Tags?.h3_res7 ?? null;

  // ── is_local: GEO-DERIVED, non-purchasable (OSE-661 / #25) ────────────────
  // A sponsor is local iff its corridor cell (h3_res7) matches the event's.
  // Derived server-side from geo BEFORE the insert — never from the request
  // body, never admin-set. Requires both the sponsor and the event to carry an
  // h3_res7 (i.e. both geocoded); otherwise the sponsor is not local.
  // Event context: brand_id (sponsor_business tenant scope, #9) + corridor cell
  // (locality_band derivation). Both read server-side, never from the body.
  let brandId: string | null = null;
  let eventH3Res7: string | null = null;
  if (eventId) {
    let eventBrandId: string | null = null;
    try {
      const eventRow = await env.DB.prepare('SELECT brand_id, h3_res7 FROM events WHERE id = ?')
        .bind(eventId)
        .first<{ brand_id: string | null; h3_res7: string | null }>();
      eventBrandId = eventRow?.brand_id ?? null;
      eventH3Res7 = eventRow?.h3_res7 ?? null;
    } catch {
      // Non-fatal for locality; brand_id is required below.
    }
    // AUD-3 S16 (#9): the event's brand must be inside the caller's scope, or a
    // brand-A admin could create a sponsor + placement inside brand B just by
    // naming a (public) brand-B event id. An out-of-scope event answers exactly
    // like a missing one, so the route is not an existence oracle. A null actor
    // is the DEV_OPEN_ADMIN local bypass (refused on staging/production).
    if (eventBrandId) {
      const actor = extractAdminActor(request, env);
      if (actor !== null) {
        const scope = await resolveAdminBrandScopeAsync(actor, env);
        const inScope =
          scope.mode === 'all' ||
          (scope.mode === 'scoped' && scope.brandIds.includes(eventBrandId));
        if (!inScope) eventBrandId = null;
      }
    }
    if (!eventBrandId) {
      return errorResponse('EVENT_NOT_FOUND', 'event_id does not resolve to a brand', 400, rid);
    }
    brandId = eventBrandId;
  } else {
    // No event: the sponsor joins a brand's pool directly. The brand comes from
    // the SERVER-VERIFIED actor's scope (#9), never widened by the body — a
    // requested brand_id must be inside that scope.
    const poolBrand = await resolvePoolBrand(request, env, body.brand_id, rid);
    if (poolBrand instanceof Response) return poolBrand;
    brandId = poolBrand;
  }
  const isLocal =
    eventId && sponsorH3Res7 !== null && eventH3Res7 !== null && sponsorH3Res7 === eventH3Res7
      ? 1
      : 0;

  // OSE-799 A2: write the split model in one atomic batch —
  //   identity → sponsor_business (+ tier, 0081), creative → sponsor_asset
  //   (logo + logo_compact), attachment → sponsor_placement ONLY when an event
  //   was given (locality_band replaces is_local; NO placement_formats).
  // `id` (sp_…) is the business identity id returned to the caller; the placement
  // gets its own id.
  const businessId = id;
  const placementId = eventId ? generateId('spl') : null;
  const stmts = [
    env.DB.prepare(
      `INSERT INTO sponsor_business
         (id, brand_id, name, website_url, tier, display_name, address_line,
          contact_phone, contact_email, lat, lon, h3_res9, h3_res7, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      businessId,
      brandId,
      name,
      websiteUrl,
      tier,
      card.display_name,
      card.address_line,
      card.contact_phone,
      card.contact_email,
      sponsorLat,
      sponsorLon,
      sponsorH3Res9,
      sponsorH3Res7,
      now,
      now
    ),
  ];
  if (eventId && placementId) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO sponsor_placement
           (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
            click_token, display_token, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'organizer', 1, ?, ?, ?, 1, ?, ?)`
      ).bind(placementId, businessId, eventId, tier, isLocal, clickToken, displayToken, now, now)
    );
  }
  if (logoUrl) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO sponsor_asset
           (id, sponsor_business_id, format, url, created_at, updated_at)
         VALUES (?, ?, 'logo', ?, ?, ?)`
      ).bind(generateId('sa'), businessId, logoUrl, now, now)
    );
  }
  if (compactLogoUrl) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO sponsor_asset
           (id, sponsor_business_id, format, url, created_at, updated_at)
         VALUES (?, ?, 'logo_compact', ?, ?, ?)`
      ).bind(generateId('sa'), businessId, compactLogoUrl, now, now)
    );
  }

  // OSE-1560: the organizer adding a sponsor turns the map on, if the organizer
  // has not chosen the map themselves (lib/map-default.ts). It rides in the same
  // batch, after the placement row it depends on, so the two land together.
  if (eventId && placementId) {
    stmts.push(
      mapFlipStatement(env.DB, {
        eventId,
        sponsorId: businessId,
        graceMinutes: env.PUBLISH_GRACE_MINUTES,
      })
    );
  }

  let batchResults: D1Result[];
  try {
    batchResults = await env.DB.batch(stmts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ type: 'DB_ERROR', handler: 'handleAdminCreateSponsor', error: msg })
    );
    return errorResponse('DB_ERROR', 'Failed to create sponsor', 503, rid);
  }
  const mapFlipped =
    Boolean(eventId && placementId) && flipFired(batchResults[batchResults.length - 1]);
  if (mapFlipped && eventId) {
    await auditMapFlip(env as { DB: D1Database }, {
      actor: extractAdminActor(request, env),
      requestId: rid,
      eventId,
      via: 'organizer_add',
      sponsorId: businessId,
    });
  }

  // OSE-1000: bust the cache-fronted public sponsors list so the just-created
  // sponsor is visible on the next read instead of racing the 30s TTL.
  if (eventId) await invalidateSponsorsCache(eventId);

  // is_local is now authoritative (geo-derived). is_local_suggested is retained
  // for back-compat and equals is_local.
  const responseBody: Record<string, unknown> = {
    ok: true,
    status: 201,
    id,
    // The placement id (distinct from the business `id`). Callers need it to drive
    // the sponsor-side accept: POST /api/v2/sponsor/placements/:placement_id/respond.
    // Under strict consent an organizer-created placement is PENDING until the
    // sponsor accepts, so a test/flow that expects the sponsor to RENDER must
    // accept it first — and needs this id to do so (CCR-PR567 re-run, Stage-2).
    // null when no event was attached (the sponsor is in the pool only).
    placement_id: placementId,
    event_id: eventId,
    // Echo what was stored so callers (and the OSE-INV5 seed) can confirm the
    // create landed with the intended tier + geo-derived locality.
    tier,
    is_local: isLocal === 1,
  };
  if (sponsorH3Res7 !== null && eventH3Res7 !== null) {
    responseBody.is_local_suggested = isLocal === 1;
  }
  // OSE-1560: the heads-up for the admin, only when the map was just turned on.
  if (mapFlipped) responseBody.map = MAP_FLIP_NOTE;

  return Response.json(responseBody, {
    status: 201,
    headers: { ...corsHeaders(request), 'X-Request-Id': rid },
  });
}

/**
 * OSE-1000: invalidate the cache-fronted public sponsor list for every event a
 * sponsor is placed on. Update/delete key off sponsorId (not eventId), and a
 * business may be placed on several events, so bust each one's cache — otherwise
 * the mutation is invisible on the public read until the 30s TTL. Best-effort.
 */
async function invalidateSponsorEventCaches(env: SponsorsEnv, sponsorId: string): Promise<void> {
  if (!env.DB) return;
  try {
    const rows = await env.DB.prepare(
      'SELECT DISTINCT event_id FROM sponsor_placement WHERE sponsor_business_id = ?'
    )
      .bind(sponsorId)
      .all<{ event_id: string }>();
    for (const row of rows.results ?? []) {
      await invalidateSponsorsCache(row.event_id);
    }
  } catch {
    // Non-fatal — a stale entry self-heals at TTL.
  }
}

// ─── Admin: Update Sponsor ──────────────────────────────────────────────────────

export async function handleAdminUpdateSponsor(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // OSE-799 A2 (#9): resolve the caller's brand scope, then verify the sponsor
  // business is inside it BEFORE any write. A forged/cross-tenant (or anon/
  // unmapped) id is unreachable → 404, indistinguishable from non-existent. The
  // fan-out updates below run only after this gate, keyed by the business id.
  const scope = await resolvePerIdSponsorScope(request, env);
  if (!scope.reachable)
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  const scopeClause = brandScopeClause(scope.brandIds, 'brand_id');
  const business = await env.DB.prepare(
    `SELECT id FROM sponsor_business WHERE id = ?${scopeClause.sql}`
  )
    .bind(sponsorId, ...scopeClause.params)
    .first<{ id: string }>();
  if (!business) return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  // Route each editable field to its table in the split model:
  //   identity  → sponsor_business  (name, website_url, geo)
  //   creative  → sponsor_asset     (logo_url, upsert format='logo')
  //   placement → sponsor_placement (tier, tokens, locality_band)
  // OSE-670 (#25): placement_formats stays non-updatable — no client writes a slot.
  const fieldSpecs: Record<string, { max: number; table: 'business' | 'placement'; col: string }> =
    {
      name: { max: 200, table: 'business', col: 'name' },
      click_token: { max: 256, table: 'placement', col: 'click_token' },
      display_token: { max: 256, table: 'placement', col: 'display_token' },
    };

  const businessSets: string[] = [];
  const businessVals: (string | number | null)[] = [];
  const placementSets: string[] = [];
  const placementVals: (string | number | null)[] = [];

  // OSE-1316/1317: tier stays required (it cannot be cleared) and lives on the
  // business (the pool) AND on every placement (per-event rotation weight).
  let tierForAttach: string | null = null;
  if ('tier' in body) {
    const tierCheck = checkTier(body.tier, rid);
    if (tierCheck instanceof Response) return tierCheck;
    tierForAttach = tierCheck;
    businessSets.push('tier = ?');
    businessVals.push(tierCheck);
    placementSets.push('tier = ?');
    placementVals.push(tierCheck);
  }
  // OSE-1317: website is https-only when present; '' / null clears it.
  if ('website_url' in body) {
    const siteCheck = checkWebsite(body.website_url, rid);
    if (siteCheck instanceof Response) return siteCheck;
    businessSets.push('website_url = ?');
    businessVals.push(siteCheck);
  }
  // 0083: public card fields; '' / null clears one.
  for (const field of CARD_FIELDS) {
    if (!(field in body)) continue;
    const r = checkCardField(field, body[field]);
    if (!r.ok) return errorResponse(r.code, r.message, 400, rid);
    businessSets.push(`${field} = ?`);
    businessVals.push(r.value);
  }

  for (const [field, spec] of Object.entries(fieldSpecs)) {
    if (!(field in body)) continue;
    const val = body[field];
    let stored: string | null;
    if (val === null) {
      stored = null;
    } else if (typeof val === 'string') {
      stored = val.slice(0, spec.max);
    } else {
      continue; // ignore non-string, non-null values
    }
    if (spec.table === 'business') {
      businessSets.push(`${spec.col} = ?`);
      businessVals.push(stored);
    } else {
      placementSets.push(`${spec.col} = ?`);
      placementVals.push(stored);
    }
  }

  // logo_url (header, format 'logo') and sidebar_logo_url (format
  // 'logo_compact', 0081) → sponsor_asset (upsert / clear); validated like create.
  const logoUpdates: { format: 'logo' | 'logo_compact'; url: string | null }[] = [];
  for (const [field, format, label] of [
    ['logo_url', 'logo', 'Header logo'],
    ['sidebar_logo_url', 'logo_compact', 'Sidebar logo'],
  ] as const) {
    if (!(field in body)) continue;
    const val = body[field];
    if (val === null || val === '') {
      logoUpdates.push({ format, url: null });
    } else if (typeof val === 'string') {
      const logoValidation = validateProxiedLogoUrl(val);
      if (!logoValidation.valid) {
        return errorResponse(
          format === 'logo' ? 'INVALID_LOGO_URL' : 'INVALID_SIDEBAR_LOGO_URL',
          `${label} must be an http:// or https:// URL on a public web host (max 500 chars)`,
          400,
          rid
        );
      }
      logoUpdates.push({ format, url: logoValidation.url ?? null });
    }
  }

  // OSE-1316/1317: attach a POOL sponsor to an event later. event_id on update
  // adds a placement (never moves or removes one). The event must belong to the
  // sponsor's own brand (#9) — a cross-brand attach is refused, not widened.
  let attach: { eventId: string; h3: string | null } | null = null;
  if (typeof body.event_id === 'string' && body.event_id.trim()) {
    const attachId = body.event_id.trim().slice(0, 128);
    const ev = await env.DB.prepare(
      `SELECT e.h3_res7 AS h3_res7 FROM events e
         JOIN sponsor_business sb ON sb.id = ? AND sb.brand_id = e.brand_id
        WHERE e.id = ?`
    )
      .bind(sponsorId, attachId)
      .first<{ h3_res7: string | null }>();
    if (!ev) {
      return errorResponse(
        'EVENT_NOT_FOUND',
        "event_id does not resolve to an event in this sponsor's brand",
        400,
        rid
      );
    }
    attach = { eventId: attachId, h3: ev.h3_res7 };
  }

  // ── H3 geo-tagging on update (re-tag when lat/lon provided) ──────────────
  const rawLat = body.lat;
  const rawLon = body.lon;
  const hasCoords =
    typeof rawLat === 'number' &&
    typeof rawLon === 'number' &&
    Number.isFinite(rawLat) &&
    Number.isFinite(rawLon);

  if (hasCoords && (rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180)) {
    return errorResponse(
      'INVALID_COORDINATES',
      'lat must be -90..90 and lon must be -180..180',
      400,
      rid
    );
  }

  let updateH3Res7: string | null = null;

  if (hasCoords) {
    const updateLat = rawLat as number;
    const updateLon = rawLon as number;
    const h3Tags = maybeTag(updateLat, updateLon);
    businessSets.push('lat = ?', 'lon = ?', 'h3_res9 = ?', 'h3_res7 = ?');
    businessVals.push(updateLat, updateLon, h3Tags?.h3_res9 ?? null, h3Tags?.h3_res7 ?? null);
    updateH3Res7 = h3Tags?.h3_res7 ?? null;
  }

  if (
    businessSets.length === 0 &&
    placementSets.length === 0 &&
    logoUpdates.length === 0 &&
    !attach
  ) {
    return errorResponse('NO_FIELDS', 'No valid fields to update', 400, rid);
  }

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];

  if (businessSets.length > 0) {
    businessSets.push('updated_at = ?');
    businessVals.push(now);
    stmts.push(
      env.DB.prepare(`UPDATE sponsor_business SET ${businessSets.join(', ')} WHERE id = ?`).bind(
        ...businessVals,
        sponsorId
      )
    );
  }

  // Placement update: scalar sets + per-event locality_band re-derivation. When
  // coords change, is_local is re-derived server-side per placement from the new
  // corridor cell vs each placement's event cell (#25 — never client-set). One
  // UPDATE covers every placement the business holds.
  const placementSetParts = [...placementSets];
  const placementBind = [...placementVals];
  if (hasCoords) {
    placementSetParts.push(
      `locality_band = CASE WHEN ? IS NOT NULL AND ? = (SELECT h3_res7 FROM events WHERE id = sponsor_placement.event_id) THEN 1 ELSE 0 END`
    );
    placementBind.push(updateH3Res7, updateH3Res7);
  }
  if (placementSetParts.length > 0) {
    placementSetParts.push('updated_at = ?');
    placementBind.push(now);
    stmts.push(
      env.DB.prepare(
        `UPDATE sponsor_placement SET ${placementSetParts.join(', ')} WHERE sponsor_business_id = ?`
      ).bind(...placementBind, sponsorId)
    );
  }

  for (const lu of logoUpdates) {
    if (lu.url === null) {
      stmts.push(
        env.DB.prepare(
          `DELETE FROM sponsor_asset WHERE sponsor_business_id = ? AND format = ?`
        ).bind(sponsorId, lu.format)
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO sponsor_asset (id, sponsor_business_id, format, url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(sponsor_business_id, format)
             DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`
        ).bind(generateId('sa'), sponsorId, lu.format, lu.url, now, now)
      );
    }
  }

  // Attach runs AFTER the business/placement updates in the same batch, so the
  // new placement takes the business tier as it stands after this request.
  // INSERT OR IGNORE: attaching an event the sponsor is already on is a no-op
  // (UNIQUE(sponsor_business_id, event_id)).
  if (attach) {
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO sponsor_placement
           (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
            is_active, created_at, updated_at)
         SELECT ?, sb.id, ?, COALESCE(?, sb.tier, 'primary'), 'organizer', 1,
                CASE WHEN sb.h3_res7 IS NOT NULL AND sb.h3_res7 = ? THEN 1 ELSE 0 END,
                1, ?, ?
           FROM sponsor_business sb WHERE sb.id = ?`
      ).bind(generateId('spl'), attach.eventId, tierForAttach, attach.h3, now, now, sponsorId)
    );
    // Sponsor discovery (lib/sponsor-discovery): if the sponsor ASKED to join
    // this event, that request already holds the UNIQUE(sponsor, event) slot
    // and the INSERT above is a no-op. The organizer adding them IS the
    // organizer's yes, and the sponsor's yes is already recorded
    // (sponsor_accepted = 1) — so switch the request on rather than silently
    // doing nothing. This also lets an organizer reverse an earlier decline.
    stmts.push(
      env.DB.prepare(
        `UPDATE sponsor_placement
            SET is_active = 1, organizer_accepted = 1, updated_at = ?
          WHERE sponsor_business_id = ? AND event_id = ?
            AND source = 'sponsor_request' AND is_active = 0`
      ).bind(now, sponsorId, attach.eventId)
    );
    // OSE-1560: the organizer adding a sponsor turns the default map on (see
    // lib/map-default.ts). Last in the batch, so it reads the placement above.
    stmts.push(
      mapFlipStatement(env.DB, {
        eventId: attach.eventId,
        sponsorId,
        graceMinutes: env.PUBLISH_GRACE_MINUTES,
      })
    );
  }

  let updateResults: D1Result[] = [];
  try {
    if (stmts.length > 0) updateResults = await env.DB.batch(stmts);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminUpdateSponsor',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to update sponsor', 503, rid);
  }

  // OSE-1000: bust the public sponsors cache so name/logo/tier edits are visible
  // on the next read instead of racing the 30s TTL.
  await invalidateSponsorEventCaches(env, sponsorId);

  // ── is_local_suggested (advisory, only when H3 was updated) ──────────────
  // Advisory only — reported against the business's first placement's event.
  const updateResponseBody: Record<string, unknown> = { ok: true, status: 200, id: sponsorId };
  if (attach && flipFired(updateResults[updateResults.length - 1])) {
    updateResponseBody.map = MAP_FLIP_NOTE;
    await auditMapFlip(env as { DB: D1Database }, {
      actor: extractAdminActor(request, env),
      requestId: rid,
      eventId: attach.eventId,
      via: 'organizer_add',
      sponsorId,
    });
  }

  if (updateH3Res7 !== null) {
    try {
      const eventRow = await env.DB.prepare(
        `SELECT e.h3_res7 AS h3_res7
           FROM sponsor_placement sp JOIN events e ON e.id = sp.event_id
          WHERE sp.sponsor_business_id = ?
          ORDER BY sp.created_at ASC LIMIT 1`
      )
        .bind(sponsorId)
        .first<{ h3_res7: string | null }>();
      if (eventRow?.h3_res7) {
        updateResponseBody.is_local_suggested = updateH3Res7 === eventRow.h3_res7;
      }
    } catch {
      // advisory — not fatal
    }
  }

  return Response.json(updateResponseBody, {
    headers: { ...corsHeaders(request), 'X-Request-Id': rid },
  });
}

// ─── Admin: Delete Sponsor (soft) ───────────────────────────────────────────────

export async function handleAdminDeleteSponsor(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // OSE-799 A2 (#9): verify the business is inside the caller's brand scope, then
  // OSE-0068: soft-delete by DEACTIVATING the sponsor_business row itself — the
  // durable identity stays (rule 7: a sponsor is borrowed, not owned by one event;
  // other events may still reference the same business), but the one business-level
  // flag is what both resolver paths read at join time. A forged/cross-tenant (or
  // anon/unmapped) id is unreachable → NOT_FOUND, indistinguishable from non-existent.
  const scope = await resolvePerIdSponsorScope(request, env);
  if (!scope.reachable)
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  const scopeClause = brandScopeClause(scope.brandIds, 'brand_id');

  try {
    const business = await env.DB.prepare(
      `SELECT id FROM sponsor_business WHERE id = ?${scopeClause.sql}`
    )
      .bind(sponsorId, ...scopeClause.params)
      .first<{ id: string }>();
    if (!business) return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);

    // OSE-0068: soft-delete the BUSINESS, not its placements. The previous
    // cascade (`UPDATE sponsor_placement SET is_active = 0 WHERE
    // sponsor_business_id = ?`) left sponsor_business untouched, so Path 2
    // (template+geo) kept re-surfacing the deleted business on every matching
    // event — it joins sponsor_business and had no business-level flag to
    // check — and any new placement resurrected it on Path 1. One flag on one
    // row, read at join time by both resolver paths.
    // 0083 / Invariant #8: the public card's location and contact are
    // business details the sponsor chose to show — while it is on show. A
    // deactivated sponsor is not on show, so they are cleared here rather than
    // kept indefinitely (the title and legal name stay: they are identity).
    await env.DB.prepare(
      `UPDATE sponsor_business
          SET is_active = 0, address_line = NULL, contact_phone = NULL, contact_email = NULL,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(new Date().toISOString(), sponsorId)
      .run();

    // OSE-1000: bust the public sponsors cache so the removed sponsor disappears
    // from the read immediately instead of lingering until the 30s TTL.
    await invalidateSponsorEventCaches(env, sponsorId);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleAdminDeleteSponsor',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to delete sponsor', 503, rid);
  }

  return Response.json(
    { ok: true, status: 200, id: sponsorId },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── Admin: Event Type Associations ─────────────────────────────────────────────

/**
 * PUT /api/v2/admin/sponsors/:id/event-types
 * Body: { template_ids: ["bar_night", "trivia", ...] }
 * Replaces all associations (delete + insert).
 */
export async function handleSetSponsorEventTypes(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // OSE-722 (#9): a forged/cross-tenant sponsor id must not be mutable.
  if (!(await isSponsorReachable(request, env, sponsorId))) {
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  }

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  if (!Array.isArray(body.template_ids)) {
    return errorResponse('MISSING_FIELD', 'Missing required field: template_ids (array)', 400, rid);
  }

  const templateIds = body.template_ids.filter(
    (t: unknown): t is string => typeof t === 'string' && t.length > 0
  );

  try {
    // Replace = DELETE + INSERTs in ONE batch. D1 runs a batch as a single
    // transaction, so a failed insert rolls the delete back instead of leaving
    // the sponsor with no associations.
    const db = env.DB;
    await db.batch([
      db.prepare('DELETE FROM sponsor_event_types WHERE sponsor_id = ?').bind(sponsorId),
      ...templateIds.map((tid: string) =>
        db
          .prepare('INSERT INTO sponsor_event_types (id, sponsor_id, template_id) VALUES (?, ?, ?)')
          .bind(generateId('set'), sponsorId, tid)
      ),
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleSetSponsorEventTypes',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to set event types', 503, rid);
  }

  return Response.json(
    { ok: true, status: 200, sponsor_id: sponsorId, template_ids: templateIds },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

/**
 * GET /api/v2/admin/sponsors/:id/event-types
 */
export async function handleGetSponsorEventTypes(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  }

  // OSE-722 (#9): a forged/cross-tenant sponsor id must not be readable —
  // collapse to 404 (indistinguishable from a non-existent sponsor).
  if (!(await isSponsorReachable(request, env, sponsorId))) {
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  }

  try {
    const result = await env.DB.prepare(
      'SELECT * FROM sponsor_event_types WHERE sponsor_id = ? ORDER BY template_id'
    )
      .bind(sponsorId)
      .all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleGetSponsorEventTypes',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query event types', 503, rid);
  }
}

// ─── Admin: Service Areas ───────────────────────────────────────────────────────

/**
 * PUT /api/v2/admin/sponsors/:id/areas
 * Body: { areas: [{ zip_code?, lat?, lon?, radius_miles? }, ...] }
 * Replaces all areas (delete + insert).
 */
export async function handleSetSponsorAreas(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // OSE-722 (#9): a forged/cross-tenant sponsor id must not be mutable.
  if (!(await isSponsorReachable(request, env, sponsorId))) {
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  }

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  if (!Array.isArray(body.areas)) {
    return errorResponse('MISSING_FIELD', 'Missing required field: areas (array)', 400, rid);
  }

  const areas = body.areas as Array<Record<string, unknown>>;

  try {
    // Replace atomically: see handleSetSponsorEventTypes.
    const db = env.DB;
    await db.batch([
      db.prepare('DELETE FROM sponsor_areas WHERE sponsor_id = ?').bind(sponsorId),
      ...areas.map((area) => {
        const id = generateId('sa');
        const zipCode = typeof area.zip_code === 'string' ? area.zip_code.slice(0, 10) : null;
        const lat = typeof area.lat === 'number' ? area.lat : null;
        const lon = typeof area.lon === 'number' ? area.lon : null;
        const radiusMiles = typeof area.radius_miles === 'number' ? area.radius_miles : 10;
        return db
          .prepare(
            'INSERT INTO sponsor_areas (id, sponsor_id, zip_code, lat, lon, radius_miles) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .bind(id, sponsorId, zipCode, lat, lon, radiusMiles);
      }),
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleSetSponsorAreas',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to set areas', 503, rid);
  }

  return Response.json(
    { ok: true, status: 200, sponsor_id: sponsorId, count: areas.length },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

/**
 * GET /api/v2/admin/sponsors/:id/areas
 */
export async function handleGetSponsorAreas(
  request: Request,
  env: SponsorsEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return Response.json(
      { ok: true, status: 200, items: [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  }

  // OSE-722 (#9): a forged/cross-tenant sponsor id must not be readable —
  // collapse to 404 (indistinguishable from a non-existent sponsor).
  if (!(await isSponsorReachable(request, env, sponsorId))) {
    return errorResponse('NOT_FOUND', `Sponsor not found: ${sponsorId}`, 404, rid);
  }

  try {
    const result = await env.DB.prepare(
      'SELECT * FROM sponsor_areas WHERE sponsor_id = ? ORDER BY created_at'
    )
      .bind(sponsorId)
      .all();

    return Response.json(
      { ok: true, status: 200, items: result.results ?? [] },
      { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleGetSponsorAreas',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to query areas', 503, rid);
  }
}

// ─── Public: Resolved Sponsors for Event ────────────────────────────────────────

/**
 * GET /api/v2/events/:id/sponsors
 *
 * Uses DataProvider for live → CF cache → mock fallback chain.
 */
export async function handleGetSponsorsForEvent(
  request: Request,
  env: SponsorsEnv,
  eventId: string,
  ctx?: DataProviderCtx
): Promise<Response> {
  const rid = requestId();

  try {
    const dp = getDataProvider(env, ctx);
    const result = await dp.getSponsors(eventId, { bypassCache: true });

    return Response.json(
      { ok: true, status: 200, items: result.data },
      {
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'no-store',
          'X-Data-Source': result.source,
          'X-Request-Id': rid,
        },
      }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleGetSponsorsForEvent',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to resolve sponsors', 503, rid);
  }
}

// ─── Public: Sponsor Bundle ─────────────────────────────────────────────────────

/**
 * GET /api/v2/events/:id/sponsor-bundle?surface=poster|display|public
 *
 * Uses DataProvider for live → CF cache → mock fallback chain.
 */
export async function handleGetSponsorBundle(
  request: Request,
  env: SponsorsEnv,
  eventId: string,
  ctx?: DataProviderCtx
): Promise<Response> {
  const rid = requestId();

  try {
    const dp = getDataProvider(env, ctx);
    const result = await dp.getSponsors(eventId, { bypassCache: true });
    const url = new URL(request.url);
    const surface = url.searchParams.get('surface') as Surface | null;

    // OSE-1138: eventId is the shuffle seed — the display order is randomized but
    // deterministic per event (COST-101), so every kiosk/surface for one event
    // agrees on the order while carrying no positional meaning (#25).
    let bundle;
    if (surface && VALID_SURFACES.includes(surface)) {
      const filtered = filterSponsorsForSurface(result.data, surface);
      bundle = buildSponsorBundle(filtered, eventId);
    } else {
      bundle = buildSponsorBundle(result.data, eventId);
    }

    // OSE-1310: mint one beacon token per unique sponsor in this bundle and
    // attach it to every reference to that sponsor across sponsors /
    // surface_sponsors (they share object identity — buildSponsorBundle never
    // clones a row — so one mint covers every slot a sponsor appears in). The
    // impression/click handlers require this token; see beacon-token.ts for
    // why an unset signing secret degrades to "no token" rather than throwing.
    const tokenBySponsor = new Map<string, string | null>();
    await Promise.all(
      bundle.sponsors.map(async (s) => {
        if (tokenBySponsor.has(s.id)) return;
        tokenBySponsor.set(s.id, await mintBeaconToken(env, eventId, s.id));
      })
    );
    for (const s of bundle.sponsors) {
      const token = tokenBySponsor.get(s.id);
      if (token) (s as SponsorRow & { beacon_token?: string }).beacon_token = token;
    }

    return Response.json(
      { ok: true, status: 200, bundle },
      {
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'no-store',
          'X-Data-Source': result.source,
          'X-Request-Id': rid,
        },
      }
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleGetSponsorBundle',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to build sponsor bundle', 503, rid);
  }
}

// ─── Public: Impression / Click Logging ─────────────────────────────────────────

/**
 * D3 (CCR 2026-09-14): an impression/click may be logged ONLY for a sponsor that
 * is actually placed on this event, brand-matched, and renderable. Returns the
 * event's h3_res7 when the (event, sponsor) pair is a resolved active placement,
 * or `{ ok:false }` when it is not — the caller then rejects with 404 and writes
 * nothing, so a fabricated (event, sponsor) pair can't pollute the proof layer
 * (sponsor_displays feeds the SharedReport). res7 (~5km²) only; res9 stays out
 * (a digital click is not a physical poster location). Shared by both handlers so
 * the placement gate can't drift between impression and click.
 */
async function resolvePlacementGeo(
  db: D1Database,
  eventId: string,
  sponsorId: string
): Promise<{ ok: boolean; h3Res7: string | null }> {
  const row = await db
    .prepare(
      `SELECT e.h3_res7 AS h3_res7
       FROM events e
       JOIN sponsor_placement sp ON sp.event_id = e.id
       JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
       WHERE e.id = ?1 AND sb.id = ?2
         AND sp.is_active = 1 AND sb.is_active = 1
         AND sb.brand_id = e.brand_id
         AND COALESCE(sp.organizer_accepted, CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
         AND sp.sponsor_accepted = 1
       LIMIT 1`
    )
    .bind(eventId, sponsorId)
    .first<{ h3_res7: string | null }>();
  return row ? { ok: true, h3Res7: row.h3_res7 ?? null } : { ok: false, h3Res7: null };
}

/**
 * Response for a beacon that was accepted but deliberately NOT written.
 *
 * OSE-1310. Two things are being balanced. A caller that is being filtered must
 * not be handed a diagnostic — `reason` stays server-side, because telling a
 * flooder which of the three rules tripped is telling them how to tune around
 * it. But the surfaces firing these beacons are fire-and-forget `fetch().catch()`
 * calls on a public page, and answering an honest client with 4xx would put
 * console errors on a page that did nothing wrong.
 *
 * 202 Accepted with `counted: false` is the honest shape: the request was
 * well-formed and understood, and it did not become a row. The field is there so
 * this is testable and so a future first-party surface can self-diagnose, but it
 * carries no reason and so is not a probing oracle.
 */
function beaconNotCounted(request: Request, rid: string): Response {
  return Response.json(
    { ok: true, status: 202, counted: false },
    { status: 202, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

/**
 * POST /api/v2/events/:id/sponsors/:sid/impression
 */
export async function handleLogImpression(
  request: Request,
  env: SponsorsEnv,
  eventId: string,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const surface = typeof body.surface === 'string' ? body.surface.slice(0, 50) : 'unknown';
  const placement = typeof body.placement === 'string' ? body.placement.slice(0, 50) : 'unknown';

  // D3: only log for a sponsor actually placed + brand-matched on this event.
  // Runs BEFORE the IVT filter on purpose: a fabricated (event, sponsor) pair is
  // a malformed request, not filtered traffic, and must keep answering 404 so it
  // is never confused with a real placement whose beacon was merely not counted.
  const resolved = await resolvePlacementGeo(env.DB, eventId, sponsorId);
  if (!resolved.ok) {
    return errorResponse(
      'NOT_FOUND',
      'No active placement for this sponsor on this event',
      404,
      rid
    );
  }
  const h3Res7 = resolved.h3Res7;

  // OSE-1310: the pair is real and placed — but did this caller actually
  // render it? A token minted into THIS bundle response, for THIS exact
  // (event, sponsor), is required before anything else runs. Cheap
  // (HMAC verify, no KV) and fails closed, so it's checked ahead of the IVT
  // heuristics below.
  const beaconAuth = await verifyBeaconToken(
    env,
    typeof body.beacon_token === 'string' ? body.beacon_token : null,
    eventId,
    sponsorId
  );
  if (!beaconAuth) return beaconNotCounted(request, rid);

  // The pair is real and the render is authenticated; is the SEEING real?
  // Bots, replays of an already-counted beacon, and flood cadence are refused
  // before the insert.
  const verdict = await classifyBeacon(request, env, {
    eventId,
    sponsorId,
    surface,
    placement,
    kind: 'impression',
  });
  if (!verdict.counted) return beaconNotCounted(request, rid);

  try {
    const id = generateId('si');
    await env.DB.prepare(
      `INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type, h3_res7)
       VALUES (?, ?, ?, ?, ?, 'display', ?)`
    )
      .bind(id, sponsorId, eventId, surface, placement, h3Res7)
      .run();
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleLogImpression',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to log impression', 503, rid);
  }

  return Response.json(
    { ok: true, status: 201 },
    { status: 201, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── Logo proxy (OSE-288 / OSE-R-011 / OSE-R-015) ──────────────────────────────
//
// GET /api/v2/sponsors/:id/logo
//
// Fetches the sponsor's external logo_url, validates its content-type, and
// re-serves it from the worker with security headers set. The external URL
// never appears as an <img src> in rendered HTML — surfaces use this internal
// path exclusively.
//
// This is the R2-free implementation. When R2 is provisioned, the handler can
// be upgraded to store-on-first-fetch and read from R2 on subsequent requests
// without any contract change on the call sites.

export async function handleSponsorLogo(
  request: Request,
  env: SponsorsEnv & PublicReadLimitEnv,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();

  if (!env.DB) {
    return new Response(null, { status: 404, headers: { 'X-Request-Id': rid } });
  }

  // OSE-1317: ?slot=sidebar serves the compact (side-rail) logo, falling back to
  // the header logo — the same preference the display side rail applies. Any
  // other value (or none) is the header logo, so the OSE-288 contract holds.
  const sidebar = new URL(request.url).searchParams.get('slot') === 'sidebar';

  let row: Record<string, unknown> | null;
  try {
    // OSE-799 A2: the logo lives in sponsor_asset on the durable business;
    // serve it only for a sponsor that is on show (see the gate below).
    row = await env.DB.prepare(
      `SELECT ${sidebar ? 'COALESCE(lc.url, la.url)' : 'la.url'} AS logo_url
         FROM sponsor_business sb
         LEFT JOIN sponsor_asset la ON la.sponsor_business_id = sb.id AND la.format = 'logo'
         LEFT JOIN sponsor_asset lc ON lc.sponsor_business_id = sb.id AND lc.format = 'logo_compact'
        WHERE sb.id = ? AND sb.is_active = 1
          AND EXISTS (
            SELECT 1 FROM sponsor_placement sp
             WHERE sp.sponsor_business_id = ?
               AND sp.sponsor_business_id = sb.id
               AND sp.is_active = 1
               -- CCR PR #699: the same consent gate as the card, the bundle and
               -- the public page — a logo is not served for a sponsor that has
               -- not accepted, or that the organizer has not accepted. OSE-1433:
               -- source-aware like the card and resolver (ADR-019 amendment), so
               -- an unanswered sponsor_request is not served.
               AND COALESCE(sp.organizer_accepted, CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
               AND sp.sponsor_accepted = 1
          )`
    )
      .bind(sponsorId, sponsorId)
      .first<Record<string, unknown>>();
  } catch {
    return new Response(null, { status: 503, headers: { 'X-Request-Id': rid } });
  }

  // No logo is not an error the page shows: surfaces render the OSE default
  // (lib/sponsor-card.ts) and never request this path for a logo-less sponsor.
  if (!row || !row.logo_url) {
    return new Response(null, { status: 404, headers: { 'X-Request-Id': rid } });
  }

  const logoUrl = row.logo_url as string;
  const validation = validateProxiedLogoUrl(logoUrl);
  if (!validation.valid || !validation.url) {
    return new Response(null, { status: 422, headers: { 'X-Request-Id': rid } });
  }

  // Edge cache, keyed by the UPSTREAM url — every public surface now loads logos
  // through here, so a page view must not mean a fetch to the sponsor's host.
  // Keying by the stored URL means an admin changing the logo is a cache miss,
  // not a day of the old image. A success is cached for a day; a failure for
  // SPONSOR_LOGO_NEGATIVE_TTL_S (OSE-1433), so a dead host is asked at most
  // once a minute per colo instead of once per page view.
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const keyUrl = encodeURIComponent(validation.url);
  const cacheKey = new Request(`https://sponsor-logo-cache.invalid/?u=${keyUrl}`);
  const failKey = new Request(`https://sponsor-logo-cache.invalid/?failed=1&u=${keyUrl}`);
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) {
      logLogoOutcome('hit', sidebar);
      const res = new Response(hit.body, hit);
      res.headers.set('X-Request-Id', rid);
      return res;
    }
    if (await cache.match(failKey).catch(() => undefined)) {
      logLogoOutcome('failed_cached', sidebar);
      return logoUpstreamError(rid);
    }
  }

  // Only a cache MISS reaches the sponsor's host, and misses are rate-limited
  // per caller (OSE-1247 posture) — this route is public and each miss is an
  // outbound fetch. Generous: one page shows several logos.
  //
  // OSE-1433 decision: the limiter stays FAIL-OPEN when KV is missing or errors,
  // like every public read. What bounds outbound fetches without it:
  //   - the URL is admin-set: a caller cannot choose what we fetch;
  //   - one request makes at most 1 + LOGO_MAX_REDIRECTS (= 4) SEQUENTIAL
  //     upstream fetches, all inside one LOGO_FETCH_TIMEOUT_MS budget;
  //   - the caches dedupe REPEAT views (a day while healthy, a minute while
  //     failing). They do not coalesce CONCURRENT cold misses — Workers cannot
  //     share one in-flight fetch across requests without a Durable Object;
  //   - so the shared fetcher caps logo fetches in flight per isolate at
  //     LOGO_MAX_IN_FLIGHT (lib/sponsor-logo.ts), across every route that
  //     proxies a logo. A miss over the cap gets a 503 here (the page shows the
  //     OSE default image) and a monogram on the asset route.
  // Failing closed would blank every logo on the platform during a KV outage.
  if (await isPublicReadLimited(request, env, 'sponsor-logo', SPONSOR_LOGO_READ_MAX)) {
    logLogoOutcome('limited', sidebar);
    return new Response(null, {
      status: 429,
      headers: { 'X-Request-Id': rid, 'Retry-After': '60', 'Cache-Control': 'no-store' },
    });
  }

  const result = await fetchAndProxyLogo(validation.url);
  if (result.error === 'BUSY') {
    // Over the per-isolate cap: nothing was fetched, so nothing is remembered.
    logLogoOutcome('busy', sidebar);
    return new Response(null, {
      status: 503,
      headers: { 'X-Request-Id': rid, 'Retry-After': '5', 'Cache-Control': 'no-store' },
    });
  }
  if (!result.ok || !result.response) {
    logLogoOutcome('upstream_error', sidebar);
    if (cache) {
      // An empty 200: the Cache API stores it (it will not store every status).
      const marker = new Response('', {
        status: 200,
        headers: { 'Cache-Control': `public, max-age=${SPONSOR_LOGO_NEGATIVE_TTL_S}` },
      });
      await cache.put(failKey, marker).catch(() => undefined);
    }
    return logoUpstreamError(rid);
  }

  logLogoOutcome('miss', sidebar);
  if (cache) await cache.put(cacheKey, result.response.clone()).catch(() => undefined);
  result.response.headers.set('X-Request-Id', rid);
  return result.response;
}

/**
 * One structured line per proxied logo outcome, for hit ratio / dead-host /
 * limiter visibility. Aggregate-only by construction: the outcome and the slot,
 * never the sponsor id, the URL, or anything about the caller (never-who).
 */
function logLogoOutcome(
  outcome: 'hit' | 'miss' | 'limited' | 'upstream_error' | 'failed_cached' | 'busy',
  sidebar: boolean
): void {
  console.log(
    JSON.stringify({ type: 'SPONSOR_LOGO', outcome, slot: sidebar ? 'sidebar' : 'header' })
  );
}

/** Logo-proxy cache misses per caller per minute (a page shows several logos). */
export const SPONSOR_LOGO_READ_MAX = 300;

/** How long a failed upstream fetch is remembered before it is tried again (OSE-1433). */
export const SPONSOR_LOGO_NEGATIVE_TTL_S = 60;

/** The per-isolate in-flight cap, enforced in the shared fetcher (OSE-1433). */
export const SPONSOR_LOGO_MAX_IN_FLIGHT = LOGO_MAX_IN_FLIGHT;

/** The 502 a surface sees for a logo that failed; its <img> swaps to the OSE default. */
function logoUpstreamError(rid: string): Response {
  return new Response(null, {
    status: 502,
    headers: { 'X-Request-Id': rid, 'Cache-Control': 'no-store' },
  });
}

/**
 * POST /api/v2/events/:id/sponsors/:sid/click
 */
export async function handleLogClick(
  request: Request,
  env: SponsorsEnv,
  eventId: string,
  sponsorId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const surface = typeof body.surface === 'string' ? body.surface.slice(0, 50) : 'unknown';
  const placement = typeof body.placement === 'string' ? body.placement.slice(0, 50) : 'unknown';

  // D3: only log for a sponsor actually placed + brand-matched on this event.
  // Ordered before the IVT filter for the same reason as the impression path.
  const resolved = await resolvePlacementGeo(env.DB, eventId, sponsorId);
  if (!resolved.ok) {
    return errorResponse(
      'NOT_FOUND',
      'No active placement for this sponsor on this event',
      404,
      rid
    );
  }
  const h3Res7 = resolved.h3Res7;

  // OSE-1310: same beacon-token authentication as the impression path, ahead of
  // the IVT filter for the same reason (cheap, fails closed).
  const beaconAuth = await verifyBeaconToken(
    env,
    typeof body.beacon_token === 'string' ? body.beacon_token : null,
    eventId,
    sponsorId
  );
  if (!beaconAuth) return beaconNotCounted(request, rid);

  // OSE-1310: same filter as the impression path. `kind` differs, so a genuine
  // click immediately after an impression on the same card is never swallowed
  // as a duplicate of it.
  const verdict = await classifyBeacon(request, env, {
    eventId,
    sponsorId,
    surface,
    placement,
    kind: 'click',
  });
  if (!verdict.counted) return beaconNotCounted(request, rid);

  try {
    const id = generateId('sc');
    await env.DB.prepare(
      `INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type, h3_res7)
       VALUES (?, ?, ?, ?, ?, 'click', ?)`
    )
      .bind(id, sponsorId, eventId, surface, placement, h3Res7)
      .run();
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleLogClick',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse('DB_ERROR', 'Failed to log click', 503, rid);
  }

  return Response.json(
    { ok: true, status: 201 },
    { status: 201, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}
