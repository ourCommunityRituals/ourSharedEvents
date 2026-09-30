// GET /api/v2/admin/events/:id/pre-event-activity  (admin-guarded in the router;
// brand-scoped by guardAdminObjectScope, which covers every /admin/events/:id/*)
//
// The organizer's pre-event window: the poster's short link + its QR (link
// first, code as its picture), and how the poster is doing — scans, taps,
// posters out, places covered, scans per day. Counts only (lib/pre-event-activity).
//
// READ-ONLY. It lists existing short links and never mints one; when none
// exists yet the card points at the poster page, which mints on open.

import { generateQrCode } from '../lib/qr';
import { decideEventLive } from '../lib/code-ledger';
import { listShortlinksForEvent } from '../lib/shortlinks';
import { readPreEventActivity, localDay } from '../lib/pre-event-activity';

export interface PreEventActivityEnv {
  DB: D1Database;
}

interface EventRow {
  id: string;
  status: string | null;
  is_published: number | null;
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
      'SELECT id, status, is_published, start_date, starts_at, timezone FROM events WHERE id = ? LIMIT 1'
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

  // The event's public short link, if one exists — the "link first" of the
  // card; its QR is the same link drawn as a picture.
  // OSE-1420: the link is emitted ONLY when the event is live (active +
  // listed) — the card already hid it client-side; now the server agrees.
  const eventLive = decideEventLive({
    id: row.id,
    status: row.status ?? 'draft',
    is_published: row.is_published ?? 0,
  });
  let link: { url: string; code: string; qr: string } | null = null;
  try {
    const slots = eventLive.live ? await listShortlinksForEvent(env, eventId) : [];
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
    event_live: eventLive.live,
    event_reasons: eventLive.reasons,
    activity,
    link,
    poster_url: `/poster?event=${encodeURIComponent(eventId)}`,
  });
}
