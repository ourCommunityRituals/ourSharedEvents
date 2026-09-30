/**
 * OSE-213 / BE-18 — QR verify/unverify admin handlers
 *
 * POST /api/v2/admin/events/:id/verify-qr
 *   Transitions event from 'ready' → 'active' and sets qr_verified = 1 —
 *   ONLY when the event has a QR that resolves to it (OSE-1420: a shortlink
 *   or an active poster deployment; see lib/go-live-evidence.ts). This is one
 *   of TWO doors into `active`; PUT status is the other, and both ask for the
 *   same evidence. The success body carries the evidence as a receipt.
 *
 * POST /api/v2/admin/events/:id/unverify-qr
 *   Transitions event from 'active' → 'ready' and sets qr_verified = 0.
 *
 * Both endpoints require admin auth (enforced by caller in router.ts).
 * State transition validity is guarded by isValidTransition from the domain model.
 */

import { isValidTransition } from '../domain/event-state';
import { collectGoLiveEvidence, goLiveDenial, hasGoLiveEvidence } from '../lib/go-live-evidence';

export interface QrVerifyEnv {
  DB: D1Database;
}

interface EventRow {
  id: string;
  status: string;
}

export async function handleV2AdminVerifyQr(
  _request: Request,
  env: QrVerifyEnv,
  eventId: string
): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, status FROM events WHERE id = ?')
    .bind(eventId)
    .first<EventRow>();

  if (!row) {
    return Response.json({ ok: false, code: 'EVENT_NOT_FOUND' }, { status: 404 });
  }

  if (!isValidTransition(row.status as Parameters<typeof isValidTransition>[0], 'active')) {
    return Response.json(
      { ok: false, code: 'INVALID_TRANSITION', from: row.status, to: 'active' },
      { status: 409 }
    );
  }

  // OSE-1420: "QR verified" means a QR resolves to this event. Refuse with
  // the evidence counts so the organiser sees what is missing, not just that
  // something is.
  const evidence = await collectGoLiveEvidence(env.DB, eventId);
  if (!hasGoLiveEvidence(evidence)) {
    return Response.json(goLiveDenial(row.status, evidence), { status: 409 });
  }

  await env.DB.prepare(
    "UPDATE events SET status = 'active', qr_verified = 1, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(eventId)
    .run();

  return Response.json(
    { ok: true, event: { id: eventId, status: 'active', qrVerified: true }, evidence },
    { status: 200 }
  );
}

export async function handleV2AdminUnverifyQr(
  _request: Request,
  env: QrVerifyEnv,
  eventId: string
): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, status FROM events WHERE id = ?')
    .bind(eventId)
    .first<EventRow>();

  if (!row) {
    return Response.json({ ok: false, code: 'EVENT_NOT_FOUND' }, { status: 404 });
  }

  if (!isValidTransition(row.status as Parameters<typeof isValidTransition>[0], 'ready')) {
    return Response.json(
      { ok: false, code: 'INVALID_TRANSITION', from: row.status, to: 'ready' },
      { status: 409 }
    );
  }

  await env.DB.prepare(
    "UPDATE events SET status = 'ready', qr_verified = 0, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(eventId)
    .run();

  return Response.json(
    { ok: true, event: { id: eventId, status: 'ready', qrVerified: false } },
    { status: 200 }
  );
}
