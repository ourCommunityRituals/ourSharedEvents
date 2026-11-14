// ─── A brand's calendar feed ───────────────────────────────────────────────────
//
// GET /brands/:brand/calendar.ics (OSE-2013, owner 2026-11-12). A follower
// subscribes once and gets every public event of one brand.
//
// WHAT IT READS. The same rows as the brand API (`GET /api/v2/events?brand=`):
// `DataProvider.listEvents`, so published, active and past the publish grace.
// Each row then goes through the public projection (`toPublicEvent`), and an
// entry is written from the projected object only. A column the projection does
// not carry cannot reach the feed, because this file never holds the raw row.
//
// WHAT AN ENTRY CARRIES. Title, description, location, start, end, and a link to
// the event page. Never a meeting link (OSE stores none) and nothing about who
// takes part. The link is the page address, not a `/s/` short link: a short
// link counts a click, and a calendar app that opens links by itself would
// add clicks no person made.
//
// AN UNKNOWN BRAND IS A 404, and so is a badly formed one, with one response
// for both. There is no `brands` table yet (OSE-1553), so "known" here means
// the brand has at least one event the brand API would list. A brand with only
// drafts answers like a brand that does not exist, so the feed never confirms a
// brand that no public page shows (OSE-1555).
//
// No cookie is set, and nothing about the caller is read or stored.

import { getDataProvider, type DataProviderEnv } from '../lib/data-provider.js';
import type { DataProviderCtx } from '../lib/data-provider.js';
import { enrichWithPhase } from '../lib/event-enrich.js';
import { toPublicEvent } from '../lib/public-event-projection.js';
import { canonicalOrigin, eventPagePath } from '../lib/canonical';
import { buildIcsCalendar, escapeIcsText, icsEventTimes, type IcsEntry } from './calendar';

export type BrandCalendarEnv = DataProviderEnv;

/** A brand id as the admin create path accepts it (handlers/events.ts). */
const BRAND_SHAPE = /^[a-z0-9_-]{1,64}$/;

function notFound(): Response {
  return Response.json(
    { ok: false, status: 404, code: 'NOT_FOUND', error: 'Calendar not found' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } }
  );
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * `updated_at` as a date, for DTSTAMP. D1's `datetime('now')` writes UTC with a
 * space and no zone ("2026-11-13 20:00:00"); read it as UTC, not local time.
 */
function stampOf(updatedAt: unknown, fallback: Date): Date {
  const raw = text(updatedAt).trim();
  if (!raw) return fallback;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/**
 * One projected event as a calendar entry, or null when it has no usable start
 * (an entry needs one; the event still shows in the brand API).
 */
function toEntry(item: Record<string, unknown>, origin: string, now: Date): IcsEntry | null {
  const id = text(item.id);
  if (!id) return null;
  const times = icsEventTimes({
    start_date: textOrNull(item.start_date),
    end_date: textOrNull(item.end_date),
    timezone: textOrNull(item.timezone),
    starts_at: textOrNull(item.starts_at),
  });
  if (times === 'missing' || times === 'invalid') return null;
  const pageUrl = origin + eventPagePath(id, textOrNull(item.slug));
  return {
    // The event id, so the entry keeps its identity when its date or title
    // changes and a subscribed calendar updates it in place.
    uid: `ose-event-${id}@oursharedevents.com`,
    stamp: stampOf(item.updated_at, now),
    start: times.start,
    end: times.end,
    timezone: textOrNull(item.timezone),
    title: text(item.title) || 'OurSharedEvents event',
    description: [text(item.description), pageUrl].filter(Boolean).join('\n\n'),
    location: text(item.location),
    url: pageUrl,
  };
}

export async function handleBrandCalendar(
  request: Request,
  env: BrandCalendarEnv,
  brand: string,
  ctx?: DataProviderCtx
): Promise<Response> {
  if (!BRAND_SHAPE.test(brand)) return notFound();

  let items: Record<string, unknown>[];
  try {
    const result = await getDataProvider(env, ctx).listEvents(brand);
    items = result.data
      .map((e: unknown) => toPublicEvent(enrichWithPhase(e as Record<string, unknown>)))
      // The query already binds the brand. This second check is on the projected
      // object, so a row of another brand cannot be written even if the query
      // changes (and mock mode returns its fixture for any brand asked for).
      .filter((item) => item.brand_id === brand);
  } catch {
    return Response.json(
      { ok: false, status: 503, code: 'DB_ERROR', error: 'Calendar service unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (items.length === 0) return notFound();

  const origin = canonicalOrigin(request, env) ?? new URL(request.url).origin;
  const now = new Date();
  const entries = items
    .map((item) => toEntry(item, origin, now))
    .filter((entry): entry is IcsEntry => entry !== null);

  const calendarName = escapeIcsText(`OurSharedEvents: ${brand}`);
  const body = buildIcsCalendar(entries, [
    `NAME:${calendarName}`,
    `X-WR-CALNAME:${calendarName}`,
    // How often a subscribed calendar should ask again (RFC 7986 and the older
    // property most apps read). Matches the hour most apps use anyway.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${brand}-events.ics"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
