/**
 * GET /api/v2/events/:id/poster-bundle
 *
 * Returns a pre-baked poster bundle for an event:
 *   - QR code data URIs (PNG) for all 4 form types
 *   - Form links for the same 4 destinations
 *   - Human-readable labels for each type
 *   - UEC ENTER colored SVG QR for the event public page (OSE-191)
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

import { generateQrCode, generateSvgQrCode } from '../lib/qr';
import { assertRenderable, parseEventState } from '../domain/event-state';
import { getCode } from '../lib/uec';

export interface PosterBundleEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
}

// UEC ENTER (01) scan_hex — WCAG AA on white (6.59:1). Sourced via getCode() per OSE-322.
const UEC_ENTER_HEX = getCode('ENTER')!.scan_hex;

// When config.mock-mode is enabled, the poster QR encodes the demo event public page.
// Kept in sync with MOCK_EVENT_ID in src/lib/mock-data.ts (MOCK-1a / OSE-147).
const MOCK_EVENT_ID_PATH = 'evt_00000000-0000-0000-0000-riph-bocce-001';

const FORM_TYPES = ['register', 'checkin', 'survey', 'email-signup'] as const;
type FormType = (typeof FORM_TYPES)[number];

const FORM_LABELS: Record<FormType, string> = {
  register: 'Registration',
  checkin: 'Check-in',
  survey: 'Survey',
  'email-signup': 'Email Signup',
};

function formUrl(origin: string, eventId: string, type: FormType, deploymentId?: string): string {
  const base = `${origin}/forms/${encodeURIComponent(eventId)}?type=${type}`;
  return deploymentId ? `${base}&deployment=${encodeURIComponent(deploymentId)}` : base;
}

// Scan URL for QR codes that record a physical scan before redirect.
// Used when a deployment ID + qr_token is known (deployment-specific bundle).
function scanUrl(origin: string, qrToken: string, type: FormType): string {
  return `${origin}/q/${encodeURIComponent(qrToken)}?type=${type}`;
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

  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;

  // OSE-627: if ?deployment=<id> is provided, generate deployment-specific QR
  // codes that route through /q/:qr_token (scan ingestion) before redirecting
  // to the form. This gives physical poster scans an anonymous scan record
  // before the attendee sees the form.
  const requestedDeploymentId = requestUrl.searchParams.get('deployment');
  let deployment: { id: string; qr_token: string } | null = null;
  if (requestedDeploymentId) {
    deployment = await env.DB.prepare(
      `SELECT id, qr_token FROM poster_deployments
       WHERE id = ? AND event_id = ? AND is_active = 1 LIMIT 1`
    )
      .bind(requestedDeploymentId, eventId)
      .first<{ id: string; qr_token: string }>();
  }

  const qr: Record<string, string> = {};
  const links: Record<string, string> = {};
  const labels: Record<string, string> = {};

  for (const type of FORM_TYPES) {
    let url: string;
    if (deployment) {
      // Deployment-specific: QR encodes the scan ingestion URL (/q/:qr_token).
      // The scan handler records the physical scan and redirects with ?deployment=.
      url = scanUrl(origin, deployment.qr_token, type);
    } else {
      // Generic event bundle: form URL with no deployment context (no scan recorded).
      url = formUrl(origin, eventId, type);
    }
    links[type] = url;
    qr[type] = generateQrCode(url, { errorCorrection: 'M' });
    labels[type] = FORM_LABELS[type];
  }

  // UEC ENTER QR — encodes the event public page using UEC color semantics (OSE-191).
  // When config.mock-mode is active, encodes the demo event URL instead of the live URL.
  const mockFlag = await env.FORMS_DB.prepare(
    "SELECT enabled FROM feature_flags WHERE scope = 'global' AND flag_key = 'config.mock-mode'"
  ).first<{ enabled: number }>();
  const isMockMode = mockFlag?.enabled === 1;
  const publicEventId = isMockMode ? MOCK_EVENT_ID_PATH : encodeURIComponent(row.id);
  const publicUrl = `${origin}/events/${publicEventId}`;
  const uecQr = generateSvgQrCode(publicUrl, { fgColor: UEC_ENTER_HEX, errorCorrection: 'M' });

  return Response.json({
    ok: true,
    // OSE-842: `status` is reserved for the numeric HTTP status on every path
    // (the 404/403 returns above already emit it as a number); the event-state
    // string lives under `eventStatus`. This ends the polymorphic-`status`
    // collision so #16 consumers can read one meaning per field.
    status: 200,
    eventId: row.id,
    eventName: row.title,
    eventStatus: row.status,
    deploymentId: deployment?.id ?? null,
    qr,
    links,
    labels,
    uecQr,
    uecEnterHex: UEC_ENTER_HEX,
  });
}
