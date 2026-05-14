/**
 * Admin geocoding handler — OSE-238 / BE-24.
 *
 * POST /api/v2/admin/geocode
 *   Body: { address: string }
 *   Response (200): { ok: true, lat, lng, formatted_address, corridor_id: null }
 *   Response (4xx/5xx): { ok: false, code, error, status }
 *
 * Auth: enforced upstream by `requireAdmin` in the router.
 *
 * Scope per Co-Arch Option C (2026-05-14):
 *   - Returns the geocode result. Always.
 *   - Returns `corridor_id: null` on the round-trip. Corridor resolution is
 *     deferred to BE-24b (follow-on story for geometry-source decision).
 *     `events.corridor_id` is nullable (OSE-236) so callers can persist
 *     this null safely.
 *
 * Body parsing uses the OSE-204 canonical container (`parseJsonBody`) so
 * payload-size / malformed-body errors mirror the public form handlers.
 */

import { type AdminEnv } from '../auth/admin';
import { geocodeVenue, resolveCorridorId } from '../lib/geo';
import { type MapsEnv } from '../lib/maps';
import { parseJsonBody, errorResponse, jsonResponse } from '../lib/form-validation';

export type GeocodeAdminEnv = AdminEnv & MapsEnv;

export async function handleAdminGeocode(
  request: Request,
  env: GeocodeAdminEnv
): Promise<Response> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    if (parsed.reason === 'PAYLOAD_TOO_LARGE') {
      return errorResponse('PAYLOAD_TOO_LARGE', 'Request body exceeds 16 KB limit', 413, request);
    }
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON', 400, request);
  }

  const address = typeof parsed.body.address === 'string' ? parsed.body.address : '';
  const outcome = await geocodeVenue(env, address);
  if (!outcome.ok) {
    return errorResponse(outcome.code, outcome.error, outcome.status, request);
  }

  // Option C: corridor resolution is a stub returning null. Callers know to
  // treat null as "corridor unknown" and persist as such.
  const corridor_id = await resolveCorridorId(env, outcome.result.lat, outcome.result.lng);

  return jsonResponse(
    {
      ok: true,
      lat: outcome.result.lat,
      lng: outcome.result.lng,
      formatted_address: outcome.result.formatted_address,
      corridor_id,
    },
    request
  );
}
