/**
 * Poster Deployments admin API.
 *
 * Admin CRUD (auth-gated):
 *   POST   /api/v2/admin/events/:id/poster-deployments   – create deployment (with H3 tagging;
 *          optional `address`, OSE-1357 — the card geocodes it and sends the coordinates)
 *   GET    /api/v2/admin/events/:id/poster-deployments   – list for event (+ per-row
 *          target_url/target_label and the event's own `event_address`, OSE-1357)
 *   GET    /api/v2/admin/poster-deployments/:id          – get single
 *   PUT    /api/v2/admin/poster-deployments/:id          – update (re-tags H3 when lat/lon provided)
 *   DELETE /api/v2/admin/poster-deployments/:id          – soft-delete (is_active=0)
 *   POST   /api/v2/admin/poster-deployments/backfill-h3  – H3 backfill for rows with lat/lon but no H3
 *
 * H3 tagging policy (migration 0047):
 *   Physical poster scans carry res9 (Node, ~174m²) precision because the person is
 *   physically present at the poster — the poster's location is what is recorded.
 *   This is NOT surveillance of the person. Contrast with digital clicks which must be
 *   capped at res7 (Corridor, ~5km²) to preserve anonymity for home-based clickers.
 *
 * NOTE: maybeTag import is permitted here — this is an admin/creation-time handler,
 * NOT a scan-path handler. Do NOT add this file to the SCAN_PATH list in h3-tagging.spec.ts.
 */

import { corsHeaders } from '../lib/cors';
import { maybeTag } from '../lib/h3-tagging';
import { generateQrCode } from '../lib/qr';
import { listShortlinksForEvent } from '../lib/shortlinks';
import { posterSlotLabel } from './poster-bundle';
import { qrScanTarget } from './qr-scan';

/** Longest address kept (OSE-1357). A geocoder's formatted_address is well under. */
const ADDRESS_MAX = 300;

/** The address of the place a poster hangs — a trimmed string, or null. */
function addressFrom(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().slice(0, ADDRESS_MAX);
  return v || null;
}

/**
 * Physical scan URL a poster QR encodes: `{origin}/q/{qr_token}`.
 * Hitting it records an anonymous `scans` row (handlers/qr-scan.ts) and
 * redirects the attendee to the register form. This is the artifact the
 * admin QR card renders so an organizer can actually put a poster up
 * (OSE-895). No `?type` → qr-scan defaults to register.
 */
function scanUrlFor(origin: string, qrToken: string): string {
  return `${origin}/q/${encodeURIComponent(qrToken)}`;
}

export interface PosterDeploymentsEnv {
  DB?: D1Database;
}

function generateId(prefix: string): string {
  const uuid = crypto.randomUUID();
  const stripped = uuid.replace(/-/g, '').slice(0, 16);
  return `${prefix}_${stripped}`;
}

function requestId(): string {
  return crypto.randomUUID();
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

async function parseBody(
  request: Request,
  rid: string
): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_JSON', 'Request body must be valid JSON', 400, rid);
  }
}

function validateCoords(
  rawLat: unknown,
  rawLon: unknown,
  rid: string
): { ok: true; lat: number | null; lon: number | null } | { ok: false; response: Response } {
  const hasLat = typeof rawLat === 'number' && Number.isFinite(rawLat);
  const hasLon = typeof rawLon === 'number' && Number.isFinite(rawLon);

  if (!hasLat && !hasLon) return { ok: true, lat: null, lon: null };

  // Partial coords: one present, one absent
  if (hasLat !== hasLon) {
    return {
      ok: false,
      response: errorResponse(
        'INVALID_COORDINATES',
        'Both latitude and longitude must be provided together',
        400,
        rid
      ),
    };
  }

  const lat = rawLat as number;
  const lon = rawLon as number;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return {
      ok: false,
      response: errorResponse(
        'INVALID_COORDINATES',
        'latitude must be -90..90 and longitude must be -180..180',
        400,
        rid
      ),
    };
  }

  return { ok: true, lat, lon };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function handleAdminCreatePosterDeployment(
  request: Request,
  env: PosterDeploymentsEnv,
  eventId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const placementLabel =
    typeof body.placement_label === 'string' ? body.placement_label.trim().slice(0, 200) : '';
  if (!placementLabel) {
    return errorResponse('MISSING_FIELD', 'Missing required field: placement_label', 400, rid);
  }

  const locationDesc =
    typeof body.location_desc === 'string' ? body.location_desc.trim().slice(0, 500) : null;
  // OSE-1357: the admin card geocodes this address in the browser and sends the
  // coordinates it got back; when geocoding is unavailable it sends the address
  // alone. Either way the address is kept so the card can show where it hangs.
  const address = addressFrom(body.address);

  const coordsResult = validateCoords(body.latitude, body.longitude, rid);
  if (!coordsResult.ok) return coordsResult.response;
  const { lat, lon } = coordsResult;

  const h3Tags = maybeTag(lat, lon);
  const h3Res9 = h3Tags?.h3_res9 ?? null;
  const h3Res7 = h3Tags?.h3_res7 ?? null;

  const id = generateId('pd');
  const qrToken = generateId('qrt');
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO poster_deployments
         (id, event_id, qr_token, placement_label, location_desc, address, latitude, longitude, h3_res9, h3_res7, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(
        id,
        eventId,
        qrToken,
        placementLabel,
        locationDesc,
        address,
        lat,
        lon,
        h3Res9,
        h3Res7,
        now,
        now
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ type: 'DB_ERROR', handler: 'handleAdminCreatePosterDeployment', error: msg })
    );
    return errorResponse('DB_ERROR', 'Failed to create poster deployment', 503, rid);
  }

  return Response.json(
    { ok: true, status: 201, id, qr_token: qrToken, h3_res9: h3Res9, h3_res7: h3Res7 },
    { status: 201, headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function handleAdminListPosterDeployments(
  request: Request,
  env: PosterDeploymentsEnv,
  eventId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const rows = await env.DB.prepare(
    `SELECT id, event_id, qr_token, placement_label, location_desc, address,
            latitude, longitude, h3_res9, h3_res7, is_active, created_at, updated_at
       FROM poster_deployments
      WHERE event_id = ?
      ORDER BY created_at DESC`
  )
    .bind(eventId)
    .all<{
      id: string;
      event_id: string;
      qr_token: string;
      placement_label: string | null;
      location_desc: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      h3_res9: string | null;
      h3_res7: string | null;
      is_active: number;
      created_at: string;
      updated_at: string;
    }>();

  // Enrich each row with the physical scan URL and an in-bundle QR data-URI
  // (OSE-895). QR generation stays deterministic/LLM-free — same native
  // generateQrCode the poster bundle uses; no external QR API. A generation
  // failure (e.g. token too long) degrades to empty string rather than 500-ing
  // the whole list — the admin card falls back to showing the token text.
  const origin = new URL(request.url).origin;
  const slotRows = await listShortlinksForEvent(env, eventId);
  const slots = slotRows.map((slot) => {
    const url = `${origin}/s/${slot.code}`;
    return {
      kind: slot.kind,
      label: posterSlotLabel(slot.kind),
      code: slot.code,
      url,
      qr: generateQrCode(url, { errorCorrection: 'M', scale: 4 }),
    };
  });
  const items = (rows.results ?? []).map((row) => {
    const scan_url = scanUrlFor(origin, row.qr_token);
    let qr_data_uri = '';
    try {
      qr_data_uri = generateQrCode(scan_url, { errorCorrection: 'M', scale: 4 });
    } catch {
      qr_data_uri = '';
    }
    // OSE-1357: which target this poster's code points at, from the same
    // function /q/ redirects with — the card shows it, never re-derives it.
    const target_url = qrScanTarget(origin, eventId, row.id);
    return { ...row, scan_url, qr_data_uri, target_url, target_label: 'Event page', slots };
  });

  // OSE-1357: the event's own venue/address seeds the card's address
  // placeholder (a poster usually hangs at or near the venue).
  const eventRow = await env.DB.prepare('SELECT where_address, location FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ where_address: string | null; location: string | null }>();
  const event_address = eventRow?.where_address || eventRow?.location || null;

  return Response.json(
    { ok: true, items, event_address },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function handleAdminGetPosterDeployment(
  request: Request,
  env: PosterDeploymentsEnv,
  deploymentId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const row = await env.DB.prepare(
    `SELECT id, event_id, qr_token, placement_label, location_desc, address,
            latitude, longitude, h3_res9, h3_res7, is_active, created_at, updated_at
       FROM poster_deployments WHERE id = ?`
  )
    .bind(deploymentId)
    .first();

  if (!row)
    return errorResponse('NOT_FOUND', `Poster deployment not found: ${deploymentId}`, 404, rid);

  return Response.json(
    { ok: true, item: row },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function handleAdminUpdatePosterDeployment(
  request: Request,
  env: PosterDeploymentsEnv,
  deploymentId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const bodyOrErr = await parseBody(request, rid);
  if (bodyOrErr instanceof Response) return bodyOrErr;
  const body = bodyOrErr;

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if ('placement_label' in body) {
    const val =
      typeof body.placement_label === 'string' ? body.placement_label.trim().slice(0, 200) : null;
    sets.push('placement_label = ?');
    values.push(val);
  }
  if ('location_desc' in body) {
    const val =
      typeof body.location_desc === 'string' ? body.location_desc.trim().slice(0, 500) : null;
    sets.push('location_desc = ?');
    values.push(val);
  }
  if ('address' in body) {
    sets.push('address = ?');
    values.push(addressFrom(body.address));
  }
  if ('is_active' in body) {
    sets.push('is_active = ?');
    values.push(body.is_active ? 1 : 0);
  }

  // H3 re-tagging when coordinates are updated
  let updatedH3Res9: string | null = null;
  let updatedH3Res7: string | null = null;

  if ('latitude' in body || 'longitude' in body) {
    const coordsResult = validateCoords(body.latitude, body.longitude, rid);
    if (!coordsResult.ok) return coordsResult.response;
    const { lat, lon } = coordsResult;

    const h3Tags = maybeTag(lat, lon);
    updatedH3Res9 = h3Tags?.h3_res9 ?? null;
    updatedH3Res7 = h3Tags?.h3_res7 ?? null;

    sets.push('latitude = ?', 'longitude = ?', 'h3_res9 = ?', 'h3_res7 = ?');
    values.push(lat, lon, updatedH3Res9, updatedH3Res7);
  }

  if (sets.length === 0) {
    return errorResponse('NO_FIELDS', 'No valid fields to update', 400, rid);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(deploymentId);

  try {
    const result = await env.DB.prepare(
      `UPDATE poster_deployments SET ${sets.join(', ')} WHERE id = ?`
    )
      .bind(...values)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      return errorResponse('NOT_FOUND', `Poster deployment not found: ${deploymentId}`, 404, rid);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ type: 'DB_ERROR', handler: 'handleAdminUpdatePosterDeployment', error: msg })
    );
    return errorResponse('DB_ERROR', 'Failed to update poster deployment', 503, rid);
  }

  const responseBody: Record<string, unknown> = { ok: true, status: 200, id: deploymentId };
  if (updatedH3Res9 !== null) responseBody.h3_res9 = updatedH3Res9;
  if (updatedH3Res7 !== null) responseBody.h3_res7 = updatedH3Res7;

  return Response.json(responseBody, { headers: { ...corsHeaders(request), 'X-Request-Id': rid } });
}

// ─── Soft-delete ──────────────────────────────────────────────────────────────

export async function handleAdminDeletePosterDeployment(
  request: Request,
  env: PosterDeploymentsEnv,
  deploymentId: string
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    'UPDATE poster_deployments SET is_active = 0, updated_at = ? WHERE id = ?'
  )
    .bind(now, deploymentId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    return errorResponse('NOT_FOUND', `Poster deployment not found: ${deploymentId}`, 404, rid);
  }

  return Response.json(
    { ok: true, id: deploymentId, is_active: false },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}

// ─── H3 Backfill ──────────────────────────────────────────────────────────────

export async function handleBackfillPosterH3(
  request: Request,
  env: PosterDeploymentsEnv
): Promise<Response> {
  const rid = requestId();
  if (!env.DB) return errorResponse('DB_NOT_CONFIGURED', 'Database not available', 503, rid);

  // Only rows with lat/lon that have not yet been H3-tagged
  const rows = await env.DB.prepare(
    `SELECT id, latitude, longitude
       FROM poster_deployments
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND h3_res9 IS NULL`
  ).all<{ id: string; latitude: number; longitude: number }>();

  const candidates = rows.results ?? [];
  let tagged = 0;
  let skipped = 0;

  for (const row of candidates) {
    const h3Tags = maybeTag(row.latitude, row.longitude);
    if (!h3Tags) {
      skipped++;
      continue;
    }
    await env.DB.prepare('UPDATE poster_deployments SET h3_res9 = ?, h3_res7 = ? WHERE id = ?')
      .bind(h3Tags.h3_res9, h3Tags.h3_res7, row.id)
      .run();
    tagged++;
  }

  console.log(
    JSON.stringify({
      type: 'POSTER_H3_BACKFILL',
      candidates: candidates.length,
      tagged,
      skipped,
    })
  );

  return Response.json(
    { ok: true, candidates: candidates.length, tagged, skipped },
    { headers: { ...corsHeaders(request), 'X-Request-Id': rid } }
  );
}
