/**
 * OSE-1358 — server-side "Add to calendar" deep links.
 *
 * The .ics download (handlers/calendar.ts) covers Apple Calendar, the iOS native
 * picker, and Outlook desktop. Google Calendar (and Android) do not ingest a
 * downloaded .ics, so they need a render-template deep link. This builds that
 * link from the event record — plain and standard, no third-party calendar
 * service, same longevity rule as the short links (boring on purpose).
 *
 * Privacy: the link carries the event's own share URL in the description and
 * nothing else — no per-person token, no tracking params, no callback. Never
 * who, only how many.
 *
 * Dates: a timed event uses its canonical UTC instant (OSE-1313 `starts_at`); a
 * date-only event is all-day on its OWN calendar day, taken from the literal
 * "YYYY-MM-DD" string with no Date/timezone round-trip — so the OSE-1363
 * off-by-one (a date-only value read through a negative-offset zone) cannot
 * occur here.
 */

export interface CalendarLinkEvent {
  title: string | null;
  description?: string | null;
  location?: string | null;
  where_address?: string | null;
  start_date: string | null;
  end_date?: string | null;
  /** OSE-1313 canonical UTC start instant; preferred over start_date when set. */
  starts_at?: string | null;
  timezone?: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Compact UTC stamp "YYYYMMDDTHHMMSSZ" — the Google TEMPLATE `dates` format. */
function gcalUtc(d: Date): string {
  return (
    String(d.getUTCFullYear()) +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  );
}

/**
 * All-day range for a date-only event: { start:"YYYYMMDD", end:"YYYYMMDD" } where
 * end is the next day (Google treats the all-day end as exclusive). The start is
 * the literal day with its hyphens removed — never parsed through `Date` in a
 * local zone — and the next day is computed in UTC from the numeric parts.
 */
function gcalAllDay(dateStr: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, d);
  if (Number.isNaN(startMs)) return null;
  const next = new Date(startMs + 24 * 60 * 60 * 1000);
  return {
    start: `${y}${pad2(m)}${pad2(d)}`,
    end: `${next.getUTCFullYear()}${pad2(next.getUTCMonth() + 1)}${pad2(next.getUTCDate())}`,
  };
}

/**
 * Build a Google Calendar "render" deep link for the event, or null when the
 * event has no usable start date.
 */
export function buildGoogleCalendarUrl(event: CalendarLinkEvent, shareUrl: string): string | null {
  if (!event.start_date) return null;

  // Prefer the canonical UTC instant; otherwise treat a full-ISO start_date
  // (legacy timed rows) as the instant. A bare "YYYY-MM-DD" is all-day.
  const timedIso =
    event.starts_at && !Number.isNaN(new Date(event.starts_at).getTime())
      ? event.starts_at
      : /T/.test(event.start_date) && !Number.isNaN(new Date(event.start_date).getTime())
        ? event.start_date
        : null;

  let dates: string;
  if (timedIso) {
    const start = new Date(timedIso);
    // A one-hour default unless a full-instant end lands after the start; a
    // date-only end says nothing about the end TIME, so it keeps the default.
    let end = new Date(start.getTime() + 60 * 60 * 1000);
    if (event.end_date && /T/.test(event.end_date)) {
      const e = new Date(event.end_date);
      if (!Number.isNaN(e.getTime()) && e.getTime() > start.getTime()) end = e;
    }
    dates = `${gcalUtc(start)}/${gcalUtc(end)}`;
  } else {
    const range = gcalAllDay(event.start_date);
    if (!range) return null;
    dates = `${range.start}/${range.end}`;
  }

  const title = event.title || 'OurSharedEvents event';
  const location = [event.location, event.where_address].filter(Boolean).join(', ');
  const details = [event.description || '', shareUrl].filter(Boolean).join('\n\n');

  // Built by hand (not URLSearchParams) to keep the `dates` slash literal, which
  // Google expects between start and end. Every value is percent-encoded.
  const parts = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(title)}`,
    `dates=${dates}`,
    `details=${encodeURIComponent(details)}`,
  ];
  if (location) parts.push(`location=${encodeURIComponent(location)}`);
  return `https://calendar.google.com/calendar/render?${parts.join('&')}`;
}

// ─── Subscribing to a brand's calendar feed (OSE-2045) ────────────────────────
//
// Owner, 2026-11-14: a subscription offers the online calendars first, then the
// .ics address. These are the four links, in that order. Each is built here from
// this site's origin and the brand id alone, so nothing an organizer typed can
// reach a link, and none carries a tracking parameter.
//
// The two online calendars fetch the feed from their own servers. The feed is
// public and sets no cookie, so nothing about the visitor travels with it.

/** A brand id as the feed route accepts it (handlers/brand-calendar.ts). */
const FEED_BRAND_SHAPE = /^[a-z0-9_-]{1,64}$/;

export interface BrandSubscribeLinks {
  /** Google Calendar, "add by URL". Online. */
  google: string;
  /** Outlook.com, "add from web". Online. */
  outlook: string;
  /** webcal://, which Apple Calendar and desktop apps open as a subscription. */
  webcal: string;
  /** The feed's own https address, to copy into any other app. */
  ics: string;
}

/**
 * The subscribe links for a brand's feed, or null when the origin is not a web
 * origin or the brand id is not one the feed route would accept.
 */
export function buildBrandSubscribeLinks(
  origin: string,
  brand: string
): BrandSubscribeLinks | null {
  if (!FEED_BRAND_SHAPE.test(brand)) return null;
  let host: string;
  let scheme: string;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    host = parsed.host;
    scheme = parsed.protocol;
  } catch {
    return null;
  }
  const path = `/brands/${brand}/calendar.ics`;
  const ics = `${scheme}//${host}${path}`;
  const webcal = `webcal://${host}${path}`;
  const name = `OurSharedEvents: ${brand}`;
  return {
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook:
      'https://outlook.live.com/calendar/0/addfromweb' +
      `?url=${encodeURIComponent(ics)}&name=${encodeURIComponent(name)}`,
    webcal,
    ics,
  };
}
