import { getPublicShortlinkForEvent, type ShortlinksEnv } from '../lib/shortlinks';
import { phaseTimesFor, zonedDatePart } from '../lib/event-datetime';

export interface CalendarEnv extends ShortlinksEnv {
  DB?: D1Database;
}

interface CalendarEventRow {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  /** OSE-1313 — canonical UTC start instant; preferred over start_date when set. */
  starts_at: string | null;
  status: string | null;
  is_published: number | null;
}

function notFound(): Response {
  return Response.json(
    { ok: false, status: 404, code: 'NOT_FOUND', error: 'Event not found' },
    { status: 404 }
  );
}

// Any line break becomes "\n", a lone CR included: a raw CR would end the line.
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function safeTimezone(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_/+.-]+$/.test(trimmed) ? trimmed : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatUtcIcs(date: Date): string {
  return (
    String(date.getUTCFullYear()) +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    'T' +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z'
  );
}

function formatInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // hourCycle only — `hour12` overrides it and can yield h24 ("24" at midnight).
    hourCycle: 'h23',
  }).formatToParts(date);
  const byType = new Map<string, string>(parts.map((p) => [p.type, p.value]));
  const part = (type: string): string => byType.get(type) ?? '00';
  return (
    part('year') +
    part('month') +
    part('day') +
    'T' +
    (part('hour') === '24' ? '00' : part('hour')) +
    part('minute') +
    part('second')
  );
}

function icsDateProperty(name: 'DTSTART' | 'DTEND', date: Date, timezone: string | null): string {
  if (!timezone) return `${name}:${formatUtcIcs(date)}`;
  try {
    return `${name};TZID=${timezone}:${formatInTimezone(date, timezone)}`;
  } catch {
    return `${name}:${formatUtcIcs(date)}`;
  }
}

/** UTF-8 length of one code point. */
function utf8Octets(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/**
 * RFC 5545 §3.1: content lines are at most 75 octets, folded with CRLF + one
 * space, and a fold never splits a UTF-8 sequence. Counts octets, walks whole
 * code points (so an emoji is never cut into two U+FFFD), and leaves room for
 * the leading space on each continuation line.
 */
function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let current = '';
  let octets = 0;
  let limit = 75;
  for (const ch of line) {
    const size = utf8Octets(ch);
    if (octets + size > limit) {
      chunks.push(current);
      current = '';
      octets = 0;
      limit = 74;
    }
    current += ch;
    octets += size;
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}

function calendarFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'event'}.ics`;
}

export async function handleEventCalendar(
  request: Request,
  env: CalendarEnv,
  eventId: string
): Promise<Response> {
  if (!env.DB) {
    return Response.json(
      { ok: false, status: 503, code: 'DB_UNAVAILABLE', error: 'Event service unavailable' },
      { status: 503 }
    );
  }

  const row = await env.DB.prepare(
    `SELECT id, title, description, location, start_date, end_date, timezone, starts_at, status, is_published
       FROM events WHERE id = ? LIMIT 1`
  )
    .bind(eventId)
    .first<CalendarEventRow>();

  if (!row) return notFound();
  const status = (row.status || '').toLowerCase();
  // Same gate as the event page that links here (handlePublicEventPage): a live
  // event's file downloads by link while it is off the map (PO 2026-10-07).
  const offMap = row.is_published !== 1;
  if (status === 'draft' || status === 'ready' || (offMap && status !== 'active')) {
    return notFound();
  }

  if (!row.start_date) {
    return Response.json(
      {
        ok: false,
        status: 409,
        code: 'EVENT_TIME_MISSING',
        error: 'Event start time is required before a calendar file can be generated',
      },
      { status: 409 }
    );
  }

  // OSE-1313 — a timed event carries its canonical UTC instant in starts_at
  // (date+time in the event's zone, server-computed). Prefer it: the date-only
  // start_date parses as UTC midnight, which is not when the event starts.
  const start = new Date(row.starts_at || row.start_date);
  if (Number.isNaN(start.getTime())) {
    return Response.json(
      { ok: false, status: 409, code: 'EVENT_TIME_INVALID', error: 'Event start time is invalid' },
      { status: 409 }
    );
  }

  // OSE-1313 — for a timed event, a date-only end_date is a calendar day in the
  // EVENT zone (phaseTimesFor), not UTC midnight: read raw it lands the evening
  // before in the Americas and gives multi-day events a wrong DTEND. A same-day
  // date-only end says nothing about the end TIME, so it keeps the one-hour
  // default below rather than blocking out the rest of the day.
  const sameDayDateOnlyEnd =
    !!row.starts_at &&
    !!row.end_date &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.end_date.trim()) &&
    row.end_date.trim() === zonedDatePart(row.starts_at, row.timezone);
  const endIso = sameDayDateOnlyEnd
    ? null
    : row.starts_at
      ? phaseTimesFor(row).end_date
      : row.end_date;
  const parsedEnd = endIso ? new Date(endIso) : null;
  const end =
    parsedEnd && !Number.isNaN(parsedEnd.getTime()) && parsedEnd.getTime() > start.getTime()
      ? parsedEnd
      : new Date(start.getTime() + 60 * 60 * 1000);
  const timezone = safeTimezone(row.timezone);
  const url = new URL(request.url);
  const publicCode = await getPublicShortlinkForEvent(env, row.id);
  if (!publicCode) {
    return Response.json(
      {
        ok: false,
        status: 409,
        code: 'PUBLIC_SHORTLINK_MISSING',
        error: 'Event public shortlink is required before a calendar file can be generated',
      },
      { status: 409 }
    );
  }
  const shareUrl = `${url.origin}/s/${publicCode}`;
  const title = row.title || 'OurSharedEvents event';
  const description = [row.description || '', shareUrl].filter(Boolean).join('\n\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OurSharedEvents//Public Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:ose-${publicCode ?? 'event'}-${formatUtcIcs(start)}@oursharedevents.com`,
    `DTSTAMP:${formatUtcIcs(new Date())}`,
    icsDateProperty('DTSTART', start, timezone),
    icsDateProperty('DTEND', end, timezone),
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(row.location || '')}`,
    `URL:${shareUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return new Response(lines.map(foldIcsLine).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${calendarFileName(title)}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
