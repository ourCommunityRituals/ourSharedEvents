// ─── GET /api/v2/events/:id/display-config ─────────────────────────────────────
//
// What the TV (/display?event=<id>) should show and for how long, as the
// organiser saved it in /admin (settings.displayPanes / displayDwellSeconds,
// lib/event-settings.ts), plus the league's own links (settings.leagueLinks),
// each with a scan-to-open QR. PO (2026-10-01): leagues keep whatever tools
// they already use (Google Sheets, Excel, …) and OSE links out to them.
// Drawing those standings/schedules/brackets as tables is planned as its own
// product later, not part of OSE's display.
//
// ETag / 304 (ported from the GAS-era bundle endpoints, posterBundle.ts +
// the display's swr()): the TV re-checks this every minute. The body is
// hashed into a strong ETag; a TV that sends it back in If-None-Match gets a
// bodiless 304 while nothing changed, so a check is nearly free and the
// rotation is never re-rendered for nothing. When the organiser saves a new
// order or league links, the hash changes and the TV picks it
// up on its next check.
//
// Same visibility as the poster bundle: an event that is not live is 404/403.
// Public read: rate-limited at the route (publicReadLimited), like every other.
//
// GET /api/v2/admin/events/:id/display-config is the same body for the admin
// "TV display" card, which must work on a draft too: admin auth and the
// object-level brand guard (lib/admin-object-scope.ts) sit in front of it at
// the router, and it skips the live-only check.

import { corsHeaders } from '../lib/cors';
import { parseEventState, assertRenderable } from '../domain/event-state';
import {
  LEAGUE_LINK_KINDS,
  parseEventSettings,
  resolveDisplaySettings,
  type LeagueLinkKind,
} from '../lib/event-settings';
import { generateQrCode } from '../lib/qr';
import { getCode } from '../lib/uec';

export interface DisplayConfigEnv {
  DB: D1Database;
}

// UEC 02 LIVE (Coral: "live scoring, real-time brackets") is the code for a
// league's schedule, standings or bracket — the same code the poster's LEAGUE
// link prints as (lib/poster-codes.ts). Invariant #3: the colour is the
// instruction. PO-confirmed 2026-10-03 (was UTILITY).
const LEAGUE_HEX = getCode('LIVE')!.scan_hex;

const LEAGUE_LABELS: Record<LeagueLinkKind, string> = {
  schedule: 'Schedule',
  standings: 'Standings',
  bracket: 'Bracket',
};

export interface LeagueItem {
  kind: LeagueLinkKind;
  label: string;
  url: string;
  /** PNG data URI in the UEC LIVE colour, or null if the link is too long to encode. */
  qr: string | null;
}

function qrFor(url: string): string | null {
  try {
    return generateQrCode(url, { fgColor: LEAGUE_HEX, errorCorrection: 'L', scale: 6 });
  } catch {
    return null; // longer than QR version 7 holds: the link text still shows
  }
}

async function strongEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `"${hex.slice(0, 32)}"`;
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');
}

export async function handleDisplayConfig(
  request: Request,
  env: DisplayConfigEnv,
  eventId: string
): Promise<Response> {
  const headers = { ...corsHeaders(request) };
  const row = await env.DB.prepare('SELECT id, status, settings_json FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ id: string; status: string; settings_json: string | null }>();
  if (!row) {
    return Response.json(
      { ok: false, status: 404, error: 'Event not found' },
      { status: 404, headers }
    );
  }
  const { allowed, reason } = assertRenderable(parseEventState(row.status), 'display');
  if (!allowed) {
    return Response.json(
      { ok: false, status: 403, code: 'NOT_RENDERABLE', error: reason },
      { status: 403, headers }
    );
  }

  return withEtag(request, headers, row, { withQr: true });
}

/**
 * Everything the response depends on except the QR images. A QR is a pure
 * function of its link and the options in qrFor() (the UEC LIVE colour,
 * error correction, scale), so hashing this plus those inputs identifies the
 * full body exactly. QR_VERSION is bumped for an encoder change; the colour
 * is hashed directly, so a UEC palette change also changes the ETag. That lets a TV's
 * once-a-minute check get its 304 WITHOUT the PNGs being generated: they
 * are only drawn on a 200.
 */
const QR_VERSION = 'qr-utility-L-6';
function configShape(row: { id: string; settings_json: string | null }) {
  const display = resolveDisplaySettings(parseEventSettings(row.settings_json));
  const league = LEAGUE_LINK_KINDS.filter((kind) => display.leagueLinks[kind]).map((kind) => ({
    kind,
    label: LEAGUE_LABELS[kind],
    url: display.leagueLinks[kind] as string,
  }));
  return {
    ok: true as const,
    event_id: row.id,
    panes: display.panes,
    dwell_seconds: display.dwellSeconds,
    league,
  };
}

async function withEtag(
  request: Request,
  headers: Record<string, string>,
  row: { id: string; settings_json: string | null },
  { withQr }: { withQr: boolean }
): Promise<Response> {
  const shape = configShape(row);
  const etag = await strongEtag(`${QR_VERSION}|${LEAGUE_HEX}|${JSON.stringify(shape)}`);
  const cacheHeaders = {
    ...headers,
    ETag: etag,
    // Always revalidate: the 304 is the cheap path, never a stale body.
    'Cache-Control': 'no-cache',
  };
  if (etagMatches(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }
  // The admin card only edits the links, so its read carries no images.
  const body = withQr
    ? JSON.stringify({
        ...shape,
        league: shape.league.map((l): LeagueItem => ({ ...l, qr: qrFor(l.url) })),
      })
    : JSON.stringify(shape);
  return new Response(body, {
    headers: { ...cacheHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Admin read for the TV display card: any status (drafts are configured too). */
export async function handleAdminDisplayConfig(
  request: Request,
  env: DisplayConfigEnv,
  eventId: string
): Promise<Response> {
  const headers = { ...corsHeaders(request) };
  const row = await env.DB.prepare('SELECT id, settings_json FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ id: string; settings_json: string | null }>();
  if (!row) {
    return Response.json(
      { ok: false, status: 404, code: 'NOT_FOUND', error: 'Event not found' },
      { status: 404, headers }
    );
  }
  return withEtag(request, headers, row, { withQr: false });
}
