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
 * Both delegate to buildSharedReport() — single source of truth.
 *
 * Cache headers (S5-Q4 ratified):
 *   - Single endpoint: `Cache-Control: private, max-age=3600` + `Vary: Authorization`
 *   - Batch endpoint:  `Cache-Control: no-store` (consumers manage their own cache)
 *
 * Gate 6 (tests/shared-report-pipeline-invariants.spec.ts) enforces that
 * the read API NEVER writes to SharedReport tables — read-only.
 */

import { buildSharedReport, type SharedReport } from '../lib/shared-report-builder';
import {
  extractBearerToken,
  verifyServiceToken,
  verifySignedLinkToken,
  type SharedReportAuthEnv,
} from '../lib/shared-report-auth';

export type SharedReportReadEnv = SharedReportAuthEnv & { DB: D1Database };

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
  eventId: string
): Promise<Response> {
  const token = extractBearerToken(request.headers.get('Authorization'));
  if (!token) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED', error: 'missing bearer token' }, 401, {
      'WWW-Authenticate': 'Bearer realm="OurSharedEvents SharedReport"',
    });
  }

  const claim = await verifySignedLinkToken(env, token);
  if (!claim) {
    return jsonResponse(
      { ok: false, code: 'UNAUTHORIZED', error: 'invalid or expired token' },
      401
    );
  }

  if (claim.eventId !== eventId) {
    // Token is valid but scoped to a different event. Refuse.
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
    // MATERIALIZATION_PENDING — let consumer know to retry after the
    // next cron tick. We use 409 Conflict here because the resource
    // exists but isn't ready for delivery.
    return jsonResponse(
      {
        ok: false,
        code: 'MATERIALIZATION_PENDING',
        error: 'event exists but has no materialized signal yet; retry after next cron tick',
      },
      409
    );
  }

  return jsonResponse({ ok: true, report: result.report }, 200, {
    'Cache-Control': 'private, max-age=3600',
    Vary: 'Authorization',
  });
}

// ─── Batch endpoint (WKRP consumer pattern) ────────────────────────────────

export async function handleBatchSharedReports(
  request: Request,
  env: SharedReportReadEnv
): Promise<Response> {
  const token = extractBearerToken(request.headers.get('Authorization'));
  if (!token || !verifyServiceToken(env, token)) {
    return jsonResponse({ ok: false, code: 'UNAUTHORIZED', error: 'invalid service token' }, 401, {
      'WWW-Authenticate': 'Bearer realm="OurSharedEvents SharedReport batch"',
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', error: 'body must be an object' }, 400);
  }
  const ids = (body as Record<string, unknown>).ids;
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

  return jsonResponse({ ok: true, reports, errors }, 200, {
    'Cache-Control': 'no-store',
  });
}
