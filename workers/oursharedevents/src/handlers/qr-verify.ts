/**
 * OSE-213 / BE-18 — QR verify/unverify admin handlers
 *
 * POST /api/v2/admin/events/:id/verify-qr
 *   Transitions event from 'ready' → 'active' and sets qr_verified = 1, but
 *   only when one of the event's codes works (lib/go-live-evidence.ts,
 *   OSE-1420): 409 NO_QR_EVIDENCE when none does, 503 EVIDENCE_UNAVAILABLE
 *   when the codes could not be read. The 200 carries the counts as a receipt.
 *
 * POST /api/v2/admin/events/:id/unverify-qr
 *   Transitions event from 'active' → 'ready' and sets qr_verified = 0.
 *
 * Both endpoints require admin auth (enforced by caller in router.ts).
 * State transition validity is guarded by isValidTransition from the domain model.
 *
 * Every answer carries the request id as the `X-Request-Id` header, and a
 * refusal carries it as `requestId` in the body too: with the body's `code`
 * it is what a failure toast shows (OSE-1564). The router passes the id its
 * audit row is written under, so the reference can be found later.
 */

import {
  coreValuesMissing,
  coreValuesRefusal,
  isPublishStep,
  logCoreValuesRefused,
} from '../lib/core-values';
import { isValidTransition } from '../domain/event-state';
import { evidenceUnavailable, goLiveRefusal, requireGoLiveEvidence } from '../lib/go-live-evidence';
import { listedFromForPublish } from '../lib/publish-grace';
import { closeVoteSetUnlessPublished } from '../lib/vote-sets';

export interface QrVerifyEnv {
  DB: D1Database;
  PUBLISH_GRACE_MINUTES?: string;
}

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function answer(body: Record<string, unknown>, status: number, rid: string): Response {
  return Response.json(body, { status, headers: { 'X-Request-Id': rid } });
}

function refusal(body: Record<string, unknown>, status: number, rid: string): Response {
  return answer({ ...body, requestId: rid }, status, rid);
}

/** The row moved between our read and our write (e.g. Undo in another tab). */
function statusConflict(rid: string): Response {
  return refusal(
    {
      ok: false,
      code: 'STATUS_CONFLICT',
      error: 'This event changed while saving. Reload and try again.',
    },
    409,
    rid
  );
}

interface EventRow {
  id: string;
  status: string;
}

export async function handleV2AdminVerifyQr(
  _request: Request,
  env: QrVerifyEnv,
  eventId: string,
  rid: string = requestId()
): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id, status, starts_at, event_type_id FROM events WHERE id = ?'
  )
    .bind(eventId)
    .first<EventRow & { starts_at: string | null; event_type_id: string | null }>();

  if (!row) {
    return refusal({ ok: false, code: 'EVENT_NOT_FOUND' }, 404, rid);
  }

  if (!isValidTransition(row.status as Parameters<typeof isValidTransition>[0], 'active')) {
    return refusal(
      { ok: false, code: 'INVALID_TRANSITION', from: row.status, to: 'active' },
      409,
      rid
    );
  }

  // OSE-1560 � same check as PUT status: a start time and an event type.
  if (isPublishStep(row.status, 'active')) {
    const missing = coreValuesMissing(row);
    if (missing.length > 0) {
      logCoreValuesRefused('verify_qr', row.status, 'active', missing);
      return answer(coreValuesRefusal(missing, rid), 409, rid);
    }
  }

  // OSE-1420: the move is legal; now read the codes. No working link and no
  // switched-on poster is a refusal, and a read that fails is not a refusal.
  const decision = await requireGoLiveEvidence(env.DB, eventId, 'verify_qr', row.status);
  if (decision.outcome === 'unavailable') return refusal(evidenceUnavailable(), 503, rid);
  if (decision.outcome === 'refused') {
    return refusal(goLiveRefusal(row.status, decision.evidence), 409, rid);
  }

  // Publish grace window (lib/publish-grace.ts): live by link now, listed later.
  const listedFrom = listedFromForPublish(env.PUBLISH_GRACE_MINUTES);
  const res = await env.DB.prepare(
    "UPDATE events SET status = 'active', qr_verified = 1, listed_from = ?, updated_at = datetime('now') WHERE id = ? AND status = ?"
  )
    .bind(listedFrom, eventId, row.status)
    .run();
  // Guarded on the status read above: if another tab moved it meanwhile, say so.
  if ((res.meta?.changes ?? 0) === 0) return statusConflict(rid);

  return answer(
    {
      ok: true,
      event: { id: eventId, status: 'active', qrVerified: true, listedFrom },
      evidence: decision.evidence,
    },
    200,
    rid
  );
}

export async function handleV2AdminUnverifyQr(
  _request: Request,
  env: QrVerifyEnv,
  eventId: string,
  rid: string = requestId()
): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, status FROM events WHERE id = ?')
    .bind(eventId)
    .first<EventRow>();

  if (!row) {
    return refusal({ ok: false, code: 'EVENT_NOT_FOUND' }, 404, rid);
  }

  if (!isValidTransition(row.status as Parameters<typeof isValidTransition>[0], 'ready')) {
    return refusal(
      { ok: false, code: 'INVALID_TRANSITION', from: row.status, to: 'ready' },
      409,
      rid
    );
  }

  // OSE-2142: leaving Published closes the event's open vote set in the same
  // batch (one transaction), so no reader sees a draft-side event voting.
  const [res] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE events SET status = 'ready', qr_verified = 0, listed_from = NULL, updated_at = datetime('now') WHERE id = ? AND status = ?"
    ).bind(eventId, row.status),
    closeVoteSetUnlessPublished(env.DB, eventId),
  ]);
  if ((res?.meta?.changes ?? 0) === 0) return statusConflict(rid);

  return answer({ ok: true, event: { id: eventId, status: 'ready', qrVerified: false } }, 200, rid);
}
