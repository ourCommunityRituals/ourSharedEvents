/**
 * Feature Flag Admin Handlers
 *
 * Admin (auth required):
 *   GET  /api/v2/admin/flags              → list all flags (global + event)
 *   GET  /api/v2/admin/flags/tiers        → list tier presets
 *   GET  /api/v2/admin/flags/current-tier → detect current active tier
 *   GET  /api/v2/admin/flags/resolve      → resolved flags for an event (?eventId=)
 *   PUT  /api/v2/admin/flags/:key         → toggle a single flag
 *   POST /api/v2/admin/flags/apply-tier   → apply a tier preset (free/mid/enterprise)
 *   PUT  /api/v2/admin/events/:id/flags/:key → set event-level override
 *   DELETE /api/v2/admin/events/:id/flags/:key → remove event-level override
 *
 * BE: All flag mutations are upserts via ON CONFLICT. Safe to call repeatedly.
 * SDET: Every mutation logs a FLAG_EVENT for observability.
 */

import {
  type FeatureFlagEnv,
  type Tier,
  type FlagKey,
  FLAG_KEYS,
  TIER_PRESETS,
  listFlags,
  setFlag,
  applyTier,
  setEventFlag,
  removeEventFlag,
  resolveFlags,
  detectCurrentTier,
} from '../lib/feature-flags';
import { errorLabel } from '../lib/error-label';

// ─── Response Helpers ───────────────────────────────────────────────────────

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse(
    { ok: false, status, code, error: message, timestamp: new Date().toISOString() },
    status
  );
}

function logFlagEvent(action: string, meta: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      type: 'FLAG_EVENT',
      action,
      timestamp: new Date().toISOString(),
      ...meta,
    })
  );
}

const VALID_FLAG_KEYS = new Set<string>(Object.values(FLAG_KEYS));

function isValidFlagKey(key: string): key is FlagKey {
  return VALID_FLAG_KEYS.has(key);
}

const VALID_TIERS = new Set<string>(['free', 'mid', 'enterprise']);

function isValidTier(tier: string): tier is Tier {
  return VALID_TIERS.has(tier);
}

// ─── Handlers ───────────────────────────────────────────────────────────────

/** GET /api/v2/admin/flags — list all flags */
export async function handleListFlags(request: Request, env: FeatureFlagEnv): Promise<Response> {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') as 'global' | 'event' | null;
  const eventId = url.searchParams.get('eventId') ?? undefined;

  try {
    const flags = await listFlags(env.FORMS_DB, {
      scope: scope ?? undefined,
      eventId,
    });

    logFlagEvent('admin_list', { count: flags.length, scope, eventId });
    return jsonResponse({ ok: true, items: flags, count: flags.length });
  } catch (err) {
    logFlagEvent('admin_list_error', { error: errorLabel(err) });
    return errorResponse('DB_ERROR', 'Failed to list flags', 503);
  }
}

/** GET /api/v2/admin/flags/tiers — list available tier presets */
export function handleListTiers(): Response {
  const tiers = Object.entries(TIER_PRESETS).map(([key, preset]) => ({
    tier: key,
    name: preset.name,
    description: preset.description,
    flags: preset.flags,
  }));

  return jsonResponse({ ok: true, items: tiers, count: tiers.length });
}

/** GET /api/v2/admin/flags/current-tier — detect active tier */
export async function handleGetCurrentTier(env: FeatureFlagEnv): Promise<Response> {
  try {
    const tier = await detectCurrentTier(env.FORMS_DB);
    const preset = TIER_PRESETS[tier];

    logFlagEvent('detect_tier', { tier });
    return jsonResponse({ ok: true, tier, name: preset.name, description: preset.description });
  } catch (err) {
    logFlagEvent('detect_tier_error', { error: errorLabel(err) });
    return errorResponse('DB_ERROR', 'Failed to detect tier', 503);
  }
}

/** GET /api/v2/admin/flags/resolve?eventId= — resolved flags for context */
export async function handleResolveFlags(request: Request, env: FeatureFlagEnv): Promise<Response> {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId') ?? undefined;

  try {
    const resolved = await resolveFlags(env.FORMS_DB, eventId);

    logFlagEvent('resolve', { eventId, flagCount: Object.keys(resolved).length });
    return jsonResponse({ ok: true, eventId: eventId ?? null, flags: resolved });
  } catch (err) {
    logFlagEvent('resolve_error', { error: errorLabel(err) });
    return errorResponse('DB_ERROR', 'Failed to resolve flags', 503);
  }
}

/** PUT /api/v2/admin/flags/:key — toggle a global flag */
export async function handleSetFlag(
  request: Request,
  env: FeatureFlagEnv,
  flagKey: string
): Promise<Response> {
  if (!isValidFlagKey(flagKey)) {
    return errorResponse('INVALID_FLAG_KEY', `Unknown flag key: ${flagKey}`, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  if (typeof body.enabled !== 'boolean') {
    return errorResponse('MISSING_FIELD', 'Missing required field: enabled (boolean)', 400);
  }

  try {
    await setFlag(env.FORMS_DB, flagKey, body.enabled, 'global');

    logFlagEvent('set_global', { flagKey, enabled: body.enabled });
    return jsonResponse({ ok: true, flagKey, enabled: body.enabled, scope: 'global' });
  } catch (err) {
    logFlagEvent('set_global_error', { flagKey, error: errorLabel(err) });
    return errorResponse('DB_ERROR', 'Failed to set flag', 503);
  }
}

/** POST /api/v2/admin/flags/apply-tier — apply a tier preset */
export async function handleApplyTier(request: Request, env: FeatureFlagEnv): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  const tier = body.tier as string;
  if (!tier || !isValidTier(tier)) {
    return errorResponse('INVALID_TIER', 'tier must be one of: free, mid, enterprise', 400);
  }

  try {
    const result = await applyTier(env.FORMS_DB, tier);

    logFlagEvent('apply_tier', { tier, applied: result.applied });
    return jsonResponse({
      ok: true,
      tier,
      name: TIER_PRESETS[tier].name,
      applied: result.applied,
      flags: TIER_PRESETS[tier].flags,
    });
  } catch (err) {
    logFlagEvent('apply_tier_error', { tier, error: errorLabel(err) });
    return errorResponse('DB_ERROR', 'Failed to apply tier', 503);
  }
}

/** PUT /api/v2/admin/events/:id/flags/:key — set event-level override */
export async function handleSetEventFlag(
  request: Request,
  env: FeatureFlagEnv,
  eventId: string,
  flagKey: string
): Promise<Response> {
  if (!isValidFlagKey(flagKey)) {
    return errorResponse('INVALID_FLAG_KEY', `Unknown flag key: ${flagKey}`, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400);
  }

  if (typeof body.enabled !== 'boolean') {
    return errorResponse('MISSING_FIELD', 'Missing required field: enabled (boolean)', 400);
  }

  try {
    await setEventFlag(env.FORMS_DB, eventId, flagKey, body.enabled);

    logFlagEvent('set_event', { eventId, flagKey, enabled: body.enabled });
    return jsonResponse({ ok: true, eventId, flagKey, enabled: body.enabled, scope: 'event' });
  } catch (err) {
    logFlagEvent('set_event_error', { eventId, flagKey, error: errorLabel(err) });
    return errorResponse('DB_ERROR', 'Failed to set event flag', 503);
  }
}

/** DELETE /api/v2/admin/events/:id/flags/:key — remove event override */
export async function handleRemoveEventFlag(
  env: FeatureFlagEnv,
  eventId: string,
  flagKey: string
): Promise<Response> {
  if (!isValidFlagKey(flagKey)) {
    return errorResponse('INVALID_FLAG_KEY', `Unknown flag key: ${flagKey}`, 400);
  }

  try {
    const removed = await removeEventFlag(env.FORMS_DB, eventId, flagKey);

    logFlagEvent('remove_event', { eventId, flagKey, removed });
    return jsonResponse({ ok: true, eventId, flagKey, removed });
  } catch (err) {
    logFlagEvent('remove_event_error', { eventId, flagKey, error: errorLabel(err) });
    return errorResponse('DB_ERROR', 'Failed to remove event flag', 503);
  }
}
