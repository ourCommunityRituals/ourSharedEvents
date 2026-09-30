// GET /api/v2/admin/events/:id/pre-event-activity  (admin-guarded in the router;
// brand-scoped by guardAdminObjectScope, which covers every /admin/events/:id/*)
//
// The organizer's pre-event window: the poster's short link + its QR (link
// first, code as its picture), and how the poster is doing — scans, taps,
// posters out, places covered, scans per day. Counts only (lib/pre-event-activity).
// Poster tiers (OSE-1357): + `reach` — scans per placement (venue areas vs
// community places, most-scanned first) and taps per code (lib/poster-reach).
// Organizer-only: physical scans exact, digital taps floored (K=5) at every
// grain shown, the tap total included; the sponsor surface never reads it.
//
// READ-ONLY. It lists existing short links and never mints one; when none
// exists yet the card points at the poster page, which mints on open.

import { generateQrCode } from '../lib/qr';
import { listShortlinksForEvent } from '../lib/shortlinks';
import {
  readPreEventActivity,
  organizerPreEventActivity,
  localDay,
} from '../lib/pre-event-activity';
import { readPosterReach } from '../lib/poster-reach';

export interface PreEventActivityEnv {
  DB: D1Database;
}

interface EventRow {
  id: string;
  status: string | null;
  start_date: string | null;
  starts_at: string | null;
  timezone: string | null;
}

/** Whole days from today (event zone) to the event's local start day; null if undated. */
export function daysToGo(row: EventRow, now: Date): number | null {
  const startDay = row.starts_at
    ? localDay(new Date(row.starts_at), row.timezone)
    : row.start_date
      ? row.start_date.slice(0, 10)
      : null;
  if (!startDay || !/^\d{4}-\d{2}-\d{2}$/.test(startDay)) return null;
  const today = localDay(now, row.timezone);
  const ms = Date.parse(`${startDay}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`);
  return Math.round(ms / (24 * 3600 * 1000));
}

export async function handleAdminPreEventActivity(
  request: Request,
  env: PreEventActivityEnv,
  eventId: string
): Promise<Response> {
  let row: EventRow | null = null;
  try {
    row = await env.DB.prepare(
      'SELECT id, status, start_date, starts_at, timezone FROM events WHERE id = ? LIMIT 1'
    )
      .bind(eventId)
      .first<EventRow>();
  } catch {
    row = null;
  }
  if (!row) {
    return Response.json(
      { ok: false, code: 'NOT_FOUND', error: 'Event not found' },
      { status: 404 }
    );
  }

  const now = new Date();
  const activity = await readPreEventActivity(env.DB, eventId, row.timezone, now);
  const reach = await readPosterReach(env.DB, eventId);

  // The event's public short link, if one exists — the "link first" of the
  // card; its QR is the same link drawn as a picture.
  let link: { url: string; code: string; qr: string } | null = null;
  try {
    const slots = await listShortlinksForEvent(env, eventId);
    const pub = slots.find((s) => s.kind === 'public') ?? slots[0];
    if (pub) {
      const url = `${new URL(request.url).origin}/s/${pub.code}`;
      let qr = '';
      try {
        qr = generateQrCode(url, { errorCorrection: 'M', scale: 4 });
      } catch {
        qr = '';
      }
      link = { url, code: pub.code, qr };
    }
  } catch {
    link = null;
  }

  return Response.json({
    ok: true,
    event: { id: row.id, status: row.status ?? 'draft', days_to_go: daysToGo(row, now) },
    activity: organizerPreEventActivity(activity),
    reach,
    link,
    poster_url: `/poster?event=${encodeURIComponent(eventId)}`,
  });
}
