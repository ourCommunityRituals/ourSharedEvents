/**
 * Campaigns an organizer can use (showcase S14).
 *
 *   GET    /api/v2/admin/campaigns                               list the caller's brands' campaigns
 *   POST   /api/v2/admin/campaigns                               create one on a brand (title, status)
 *   PUT    /api/v2/admin/campaigns/:id/placements/:placementId   put a placement in the campaign
 *   DELETE /api/v2/admin/campaigns/:id/placements/:placementId   take it out
 *
 * Brand wall: the by-id routes sit behind guardAdminObjectScope (router), which
 * 404s a campaign outside the caller's brands before this code runs. Each
 * handler then scopes its own SQL by the same server-derived brand list, so the
 * wall does not rest on the guard alone. The rules themselves (same-brand
 * attach, consent before a campaign is public, a title is never a filter) are in
 * lib/campaigns.ts.
 *
 * The list takes no query parameter: it is not filtered, searched or sorted by
 * anything a caller sends.
 */

import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import {
  CAMPAIGN_CREATE_FIELDS,
  CAMPAIGN_LIST_MAX,
  attachPlacementToCampaign,
  checkCampaignStatus,
  checkCampaignTitle,
  detachPlacementFromCampaign,
  newCampaignId,
  type CampaignRow,
} from '../lib/campaigns';
import { isJsonContentType } from '../lib/content-type';
import { corsHeaders } from '../lib/cors';
import { errorLabel } from '../lib/error-label';

export interface CampaignsEnv extends AdminEnv, AdminBrandScopeEnv {
  DB?: D1Database;
}

const MAX_BODY = 4096;
const BRAND_PATTERN = /^[a-z0-9_-]{1,64}$/;

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function headers(request: Request, rid: string): Record<string, string> {
  return { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid };
}

function errorResponse(
  request: Request,
  code: string,
  message: string,
  status: number,
  rid: string
): Response {
  return Response.json(
    {
      ok: false,
      status,
      code,
      error: message,
      requestId: rid,
      timestamp: new Date().toISOString(),
    },
    { status, headers: headers(request, rid) }
  );
}

/** The same body guardAdminObjectScope answers with, so the two cannot be told apart. */
function campaignNotFound(request: Request, id: string, rid: string): Response {
  return errorResponse(request, 'NOT_FOUND', `Campaign not found: ${id}`, 404, rid);
}

function logDbError(handler: string, err: unknown): void {
  console.error(JSON.stringify({ type: 'DB_ERROR', handler, error: errorLabel(err) }));
}

// ─── List ───────────────────────────────────────────────────────────────────────

export async function handleAdminListCampaigns(
  request: Request,
  env: CampaignsEnv
): Promise<Response> {
  const rid = requestId();
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (!env.DB || scope.mode === 'deny') {
    return Response.json({ ok: true, status: 200, items: [] }, { headers: headers(request, rid) });
  }
  const where =
    scope.mode === 'scoped'
      ? `WHERE brand_id IN (${scope.brandIds.map(() => '?').join(', ')})`
      : '';
  const params = scope.mode === 'scoped' ? scope.brandIds : [];
  try {
    const res = await env.DB.prepare(
      `SELECT id, brand_id, title, status, created_at, updated_at
         FROM campaigns ${where}
        ORDER BY created_at DESC, id
        LIMIT ${CAMPAIGN_LIST_MAX}`
    )
      .bind(...params)
      .all<CampaignRow>();
    return Response.json(
      { ok: true, status: 200, items: res.results ?? [] },
      { headers: headers(request, rid) }
    );
  } catch (err) {
    logDbError('handleAdminListCampaigns', err);
    return errorResponse(request, 'DB_ERROR', 'Failed to list campaigns', 503, rid);
  }
}

// ─── Create ─────────────────────────────────────────────────────────────────────

export async function handleAdminCreateCampaign(
  request: Request,
  env: CampaignsEnv
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) {
    return errorResponse(request, 'DB_NOT_CONFIGURED', 'Database not available', 503, rid);
  }
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return errorResponse(
      request,
      'BAD_CONTENT_TYPE',
      'Content-Type must be application/json',
      400,
      rid
    );
  }
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) {
      return errorResponse(request, 'PAYLOAD_TOO_LARGE', 'Body too large', 400, rid);
    }
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return errorResponse(request, 'INVALID_BODY', 'Request body must be a JSON object', 400, rid);
  }

  // A campaign is a title and a status. Anything else is refused, so a caller
  // is never left believing a field was saved.
  const unknown = Object.keys(body).filter((k) => !CAMPAIGN_CREATE_FIELDS.includes(k));
  if (unknown.length > 0) {
    return errorResponse(
      request,
      'UNKNOWN_FIELD',
      `A campaign takes only: ${CAMPAIGN_CREATE_FIELDS.join(', ')}`,
      400,
      rid
    );
  }
  const title = checkCampaignTitle(body.title);
  if (!title.ok) return errorResponse(request, title.code, title.message, 400, rid);
  const status = checkCampaignStatus(body.status);
  if (!status.ok) return errorResponse(request, status.code, status.message, 400, rid);

  // The brand comes from the server-verified caller, never from the body alone:
  // a scoped caller may name only a brand they are a member of.
  if (body.brand_id !== undefined && typeof body.brand_id !== 'string') {
    return errorResponse(request, 'INVALID_BRAND', 'brand_id must be text', 400, rid);
  }
  const requested = typeof body.brand_id === 'string' ? body.brand_id.trim() : '';
  if (requested && !BRAND_PATTERN.test(requested)) {
    return errorResponse(
      request,
      'INVALID_BRAND',
      'brand_id must be lowercase alphanumeric, hyphens, or underscores (1-64 chars)',
      400,
      rid
    );
  }
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') {
    return errorResponse(
      request,
      'BRAND_FORBIDDEN',
      'Your admin account is not a member of any brand, so it cannot create a campaign',
      403,
      rid
    );
  }
  if (scope.mode === 'scoped' && requested && !scope.brandIds.includes(requested)) {
    return errorResponse(
      request,
      'BRAND_FORBIDDEN',
      `Not entitled to brand_id "${requested}"`,
      403,
      rid
    );
  }
  const brandId = requested || (scope.mode === 'scoped' ? scope.brandIds[0] : 'root');

  const now = new Date().toISOString();
  const item: CampaignRow = {
    id: newCampaignId(),
    brand_id: brandId,
    title: title.value,
    status: status.value,
    created_at: now,
    updated_at: now,
  };
  try {
    await env.DB.prepare(
      `INSERT INTO campaigns (id, brand_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(item.id, item.brand_id, item.title, item.status, item.created_at, item.updated_at)
      .run();
  } catch (err) {
    logDbError('handleAdminCreateCampaign', err);
    return errorResponse(request, 'DB_ERROR', 'Failed to create campaign', 503, rid);
  }
  return Response.json(
    { ok: true, status: 201, id: item.id, item },
    { status: 201, headers: headers(request, rid) }
  );
}

// ─── Attach / detach a placement ────────────────────────────────────────────────

export async function handleAdminSetPlacementCampaign(
  request: Request,
  env: CampaignsEnv,
  campaignId: string,
  placementId: string,
  attach: boolean
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return campaignNotFound(request, campaignId, rid);
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') return campaignNotFound(request, campaignId, rid);
  const brandIds = scope.mode === 'scoped' ? scope.brandIds : null;

  try {
    const result = attach
      ? await attachPlacementToCampaign(env.DB, campaignId, placementId, brandIds)
      : await detachPlacementFromCampaign(env.DB, campaignId, placementId, brandIds);
    if (!result.ok) {
      return result.code === 'CAMPAIGN_NOT_FOUND'
        ? campaignNotFound(request, campaignId, rid)
        : errorResponse(request, 'NOT_FOUND', `Placement not found: ${placementId}`, 404, rid);
    }
    return Response.json(
      {
        ok: true,
        status: 200,
        id: placementId,
        event_id: result.event_id,
        campaign_id: attach ? campaignId : null,
      },
      { headers: headers(request, rid) }
    );
  } catch (err) {
    logDbError('handleAdminSetPlacementCampaign', err);
    return errorResponse(request, 'DB_ERROR', 'Failed to update the placement', 503, rid);
  }
}
