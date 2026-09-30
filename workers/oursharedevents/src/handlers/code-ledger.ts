/**
 * OSE-1420 — GET /api/v2/admin/events/:id/code-ledger
 *
 * The admin's truth surface for an event's codes: each short link and poster
 * deployment with `live`, `valid`, and the reasons; `url`/`qr` present ONLY
 * when live. Plus a log of event-level and gap-level messages ("Draft —
 * switches on when you publish", "Event page link — not created", …).
 *
 * Read-only. Admin-gated in router.ts (object scope applies: the path is an
 * `/admin/events/:id/*` sub-resource). Never mints a code.
 */

import { buildCodeLedger, type CodeLedgerEnv } from '../lib/code-ledger';

export async function handleAdminCodeLedger(
  request: Request,
  env: CodeLedgerEnv,
  eventId: string
): Promise<Response> {
  const origin = new URL(request.url).origin;
  let ledger;
  try {
    ledger = await buildCodeLedger(env, eventId, origin);
  } catch {
    return Response.json(
      { ok: false, code: 'LEDGER_UNAVAILABLE', error: 'Could not read the event codes' },
      { status: 503 }
    );
  }
  if (!ledger) {
    return Response.json(
      { ok: false, code: 'NOT_FOUND', error: 'Event not found' },
      { status: 404 }
    );
  }
  return Response.json({ ok: true, ...ledger }, { headers: { 'Cache-Control': 'no-store' } });
}
