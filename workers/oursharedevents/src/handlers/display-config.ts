// ─── GET /api/v2/events/:id/display-config ─────────────────────────────────────
//
// What the TV (/events/<id>/tv) should show and for how long, as the
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
// OSE-1521 adds two more QR screens: `event_page` (the featured screen's QR: the
// event's own public page, on the host the TV loaded from) and `donate` (the
// organiser's saved donation link, settings.donateLink). Both are drawn only on a
// 200, exactly like the league QRs, and both are covered by the ETag. No amount,
// goal or progress is carried: the display shows no counts.
//
// OSE-475: `phase` (pre_event / event / post_event) is the featured event's
// phase from the one resolver the public event page uses (eventPhaseOf), read
// at request time. It is inside the hashed body, so when the event starts or
// ends the ETag changes and the TV's next minute check gets a 200 with the new
// phase instead of a 304 that would hide the crossing. No count is carried.
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
import { internalTarget, posterCodeUec } from '../lib/poster-codes';
import { eventPhaseOf } from '../lib/event-enrich';
import type { EventPhase } from '../domain/event-phase';

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

// The donate and event-page QRs print in the UEC colour the poster uses for the
// same kind of link (donation → SHOP, event page → UTILITY), read from the
// registry per call so the colour is never a literal here (Invariant #3).
const DONATE_LABEL = 'Donate';

export interface QrLink {
  url: string;
  /** PNG data URI, or null if the link is too long to encode (the text still shows). */
  qr: string | null;
}

export interface LeagueItem {
  kind: LeagueLinkKind;
  label: string;
  url: string;
  /** PNG data URI in the UEC LIVE colour, or null if the link is too long to encode. */
  qr: string | null;
}

function qrFor(url: string, fgColor: string = LEAGUE_HEX): string | null {
  try {
    return generateQrCode(url, { fgColor, errorCorrection: 'L', scale: 6 });
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
  const row = await env.DB.prepare(
    `SELECT id, status, settings_json, start_date, end_date, starts_at, timezone
       FROM events WHERE id = ?`
  )
    .bind(eventId)
    .first<{
      id: string;
      status: string;
      settings_json: string | null;
      start_date: string | null;
      end_date: string | null;
      starts_at: string | null;
      timezone: string | null;
    }>();
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

  return withEtag(request, headers, row, { withQr: true, phase: eventPhaseOf(row) });
}

/** The colours the QR images are drawn in, read from the registry now. */
function qrColours() {
  return {
    league: LEAGUE_HEX,
    donate: posterCodeUec('donation').scan_hex,
    event: posterCodeUec('public').scan_hex,
  };
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
const QR_VERSION = 'qr-L-6';
function configShape(
  row: { id: string; settings_json: string | null },
  origin: string,
  phase?: EventPhase
) {
  const display = resolveDisplaySettings(parseEventSettings(row.settings_json));
  const league = LEAGUE_LINK_KINDS.filter((kind) => display.leagueLinks[kind]).map((kind) => ({
    kind,
    label: LEAGUE_LABELS[kind],
    url: display.leagueLinks[kind] as string,
  }));
  return {
    ok: true as const,
    event_id: row.id,
    // The TV only; the admin card's read has no phase (its ETag must not move
    // with the clock).
    ...(phase ? { phase } : {}),
    panes: display.panes,
    dwell_seconds: display.dwellSeconds,
    league,
    // The featured screen's QR: this event's public page on the host serving
    // the TV (so a staging TV never prints a production link).
    event_page: { url: internalTarget(origin, row.id, 'public') },
    donate: display.donateLink ? { label: DONATE_LABEL, url: display.donateLink } : null,
  };
}

async function withEtag(
  request: Request,
  headers: Record<string, string>,
  row: { id: string; settings_json: string | null },
  { withQr, phase }: { withQr: boolean; phase?: EventPhase }
): Promise<Response> {
  const shape = configShape(row, new URL(request.url).origin, phase);
  const colours = qrColours();
  const etag = await strongEtag(
    `${QR_VERSION}|${colours.league}|${colours.donate}|${colours.event}|${JSON.stringify(shape)}`
  );
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
        event_page: { ...shape.event_page, qr: qrFor(shape.event_page.url, colours.event) },
        donate: shape.donate
          ? { ...shape.donate, qr: qrFor(shape.donate.url, colours.donate) }
          : null,
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
