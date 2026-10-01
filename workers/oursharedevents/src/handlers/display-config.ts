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

// UEC 07 UTILITY (Charcoal, "General · Info") is the code for a schedule or
// other general link — Invariant #3: the colour is the instruction.
const UTILITY_HEX = getCode('UTILITY')!.scan_hex;

const LEAGUE_LABELS: Record<LeagueLinkKind, string> = {
  schedule: 'Schedule',
  standings: 'Standings',
  bracket: 'Bracket',
};

export interface LeagueItem {
  kind: LeagueLinkKind;
  label: string;
  url: string;
  /** PNG data URI in the UEC UTILITY colour, or null if the link is too long to encode. */
  qr: string | null;
}

function qrFor(url: string): string | null {
  try {
    return generateQrCode(url, { fgColor: UTILITY_HEX, errorCorrection: 'L', scale: 6 });
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

  const display = resolveDisplaySettings(parseEventSettings(row.settings_json));
  const league: LeagueItem[] = [];
  for (const kind of LEAGUE_LINK_KINDS) {
    const url = display.leagueLinks[kind];
    if (!url) continue;
    league.push({ kind, label: LEAGUE_LABELS[kind], url, qr: qrFor(url) });
  }

  const body = JSON.stringify({
    ok: true,
    event_id: row.id,
    panes: display.panes,
    dwell_seconds: display.dwellSeconds,
    league,
  });
  const etag = await strongEtag(body);
  const cacheHeaders = {
    ...headers,
    ETag: etag,
    // Always revalidate: the 304 is the cheap path, never a stale body.
    'Cache-Control': 'no-cache',
  };
  if (etagMatches(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }
  return new Response(body, {
    headers: { ...cacheHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
