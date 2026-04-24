/**
 * GET /api/v2/events/:id/poster-bundle
 *
 * Returns a pre-baked poster bundle for an event:
 *   - QR code data URIs (PNG) for all 4 form types
 *   - Form links for the same 4 destinations
 *   - Human-readable labels for each type
 *
 * Two consumption modes (same bundle, same data):
 *   Physical: organiser prints the QR codes on posters/tabletops.
 *             Attendees scan → land on the form page.
 *   Mobile:   same content delivered as tappable anchor links on
 *             digital ads. No QR scan needed — links are clickable.
 *
 * Phase 1: "short links" = full form URLs. No external URL-shortener.
 * The distinction is delivery medium (print vs. digital), not destination.
 *
 * DESIGN-9 (OSE-103)
 */

import { generateQrCode } from '../lib/qr';
import { assertRenderable, parseEventState } from '../domain/event-state';

export interface PosterBundleEnv {
  DB: D1Database;
}

const FORM_TYPES = ['register', 'checkin', 'survey', 'email-signup'] as const;
type FormType = (typeof FORM_TYPES)[number];

const FORM_LABELS: Record<FormType, string> = {
  register: 'Registration',
  checkin: 'Check-in',
  survey: 'Survey',
  'email-signup': 'Email Signup',
};

function formUrl(origin: string, eventId: string, type: FormType): string {
  return `${origin}/forms/${encodeURIComponent(eventId)}?type=${type}`;
}

export async function handleGetPosterBundle(
  request: Request,
  env: PosterBundleEnv,
  eventId: string
): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, title, status FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ id: string; title: string; status: string }>();

  if (!row) {
    return Response.json({ ok: false, status: 404, error: 'Event not found' }, { status: 404 });
  }

  const { allowed, reason } = assertRenderable(parseEventState(row.status), 'poster');
  if (!allowed) {
    return Response.json(
      { ok: false, status: 403, code: 'NOT_RENDERABLE', error: reason },
      { status: 403 }
    );
  }

  const origin = new URL(request.url).origin;

  const qr: Record<string, string> = {};
  const links: Record<string, string> = {};
  const labels: Record<string, string> = {};

  for (const type of FORM_TYPES) {
    const url = formUrl(origin, eventId, type);
    links[type] = url;
    qr[type] = generateQrCode(url, { errorCorrection: 'M' });
    labels[type] = FORM_LABELS[type];
  }

  return Response.json({
    ok: true,
    eventId: row.id,
    eventName: row.title,
    status: row.status,
    qr,
    links,
    labels,
  });
}
