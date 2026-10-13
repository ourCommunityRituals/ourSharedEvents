/**
 * "Repeat this event" — what the copy is made of (OSE-1531).
 *
 * The copy is built as an ordinary create body and goes through the one create
 * path, so brand scope, validation, the draft state, the slug rule and the
 * shortlink are never re-implemented here. This module only decides WHICH fields
 * of the finished event travel and WHEN the copy is.
 *
 * Never-who: the copy carries what the ORGANIZER wrote (name, place, text, kind,
 * time, settings). It never carries anything that describes who took part or
 * who agreed to what: registrations, check-ins, scans, poster codes, shortlinks,
 * sponsor placements (a placement is the sponsor's own consent, ADR-019) or the
 * live state. The list below is an allowlist; a column added to `events` later is
 * left behind until someone decides it should travel.
 */

import { parseEventSettings } from './event-settings';
import { zonedTimePart } from './event-datetime';
import { isUploadedArtworkPath } from './event-thumb';

/** The columns of the source event the handler reads. Nothing else is selected. */
export const REPEAT_SOURCE_COLUMNS = [
  'id',
  'brand_id',
  'title',
  'slug',
  'description',
  'location',
  'where_address',
  'start_date',
  'end_date',
  'timezone',
  'starts_at',
  'cover_image_url',
  'template_id',
  'what_short',
  'who_host',
  'why_purpose',
  'how_details',
  'who_story',
  'who_image_url',
  'what_video_url',
  'what_url',
  'what_url_enabled',
  'what_url_type',
  'lat',
  'lon',
  'event_type_id',
  'settings_json',
] as const;

export type RepeatSource = Record<(typeof REPEAT_SOURCE_COLUMNS)[number], unknown>;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(date: unknown): Date | null {
  if (typeof date !== 'string' || !ISO_DATE.test(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  // JS normalises 2026-02-31 to March 3; the calendar date must round-trip.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date ? d : null;
}

/**
 * The copy's date: the source's weekday, a whole number of weeks later, and
 * strictly after `today` (UTC date). A source still ahead moves a week on; an
 * old one lands on the next such weekday, so the copy is never born in the past.
 * An unreadable source date gives null: no date is better than a guessed one.
 */
export function nextRepeatDate(sourceDate: unknown, today: string): string | null {
  const d = parseDate(sourceDate);
  if (!d) return null;
  do d.setUTCDate(d.getUTCDate() + 7);
  while (d.toISOString().slice(0, 10) <= today);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * The create body for the copy. Absent fields stay absent (the create path treats
 * them as "not given"). `is_published: false` is explicit: the copy stays off the
 * map and the list until its organizer chooses, whatever the source was.
 */
export function buildRepeatBody(
  src: RepeatSource,
  today: string,
  slugSuffix: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    brand_id: src.brand_id,
    title: src.title,
    // Slugs are unique; a suffix keeps two repeats of one event apart.
    slug: `${String(src.slug || 'event').slice(0, 90)}-${slugSuffix}`,
    status: 'draft',
    is_published: false,
  };

  for (const k of [
    'description',
    'location',
    'where_address',
    'cover_image_url',
    'template_id',
    'what_short',
    'who_host',
    'why_purpose',
    'how_details',
    'who_story',
    'who_image_url',
    'what_video_url',
    'what_url',
    'what_url_type',
    'event_type_id',
    'timezone',
  ] as const) {
    const v = str(src[k]);
    // OSE-1658: artwork saved before the upload-only rule may be an outside
    // address. No page ever drew one, and create now refuses it, so the copy
    // goes without rather than the repeat failing.
    if (k === 'cover_image_url' && !isUploadedArtworkPath(v)) continue;
    if (v !== undefined) body[k] = v;
  }
  if (src.what_url_enabled === 1 || src.what_url_enabled === true) body.what_url_enabled = true;
  const lat = num(src.lat);
  const lon = num(src.lon);
  if (lat !== undefined && lon !== undefined) {
    body.lat = lat;
    body.lon = lon;
  }

  const start = parseDate(src.start_date);
  const newStart = nextRepeatDate(src.start_date, today);
  if (start && newStart) {
    body.start_date = newStart;
    const end = parseDate(src.end_date);
    // A multi-day event keeps its length.
    if (end && end >= start) body.end_date = addDays(newStart, daysBetween(start, end));
    // Wall-clock time in the event's own zone (DST-safe: the create path turns
    // it back into a UTC instant for the new date). No zone, no guessed time.
    const zone = str(src.timezone);
    const time = zone && str(src.starts_at) ? zonedTimePart(str(src.starts_at), zone) : '';
    if (time) body.start_time = time;
  }

  const settings = parseEventSettings(src.settings_json);
  // `mapDefault` is the server's own "the organizer did not choose the map" marker. A client
  // may not write it, and the copy's map choice is the explicit `is_published: false` above.
  delete settings.mapDefault;
  if (Object.keys(settings).length > 0) body.settings = settings;

  return body;
}
