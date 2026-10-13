/**
 * OSE-1615 — the two spine keys on `events`, version v1.
 *
 *   venue_canonical_id    one physical venue, however an organizer types it
 *   event_correlation_id  one event: this venue, this type, this night
 *
 * Both are about PLACES AND EVENTS, never people. They give every measure, which
 * already joins through `event_id`, a stable identity over time.
 *
 * THE RULE IS A SHARED CONTRACT (PO decisions of 2026-10-04,
 * `.telemetry/tracking-plan.md`, Decisions 1 and 2). OW computes the same ids
 * from the same inputs, so "normalise" and "hash" are exact, and the fixtures in
 * `tests/fixtures/spine-keys.v1.json` are the published test vectors. Change a
 * rule here and every id changes: that is a new version (`v2|...`), never an edit
 * to v1.
 *
 *   venue input   v1|<normalised name>|<res-7 cell, lower case>
 *   event input   v1|<venue_canonical_id>|<uec_code>|<night, YYYY-MM-DD>
 *   hash          first 32 lower-case hex characters of SHA-256 over UTF-8
 *
 * NO SECRET. OSE and OW must agree without sharing one, so the ids are plain
 * hashes of public facts (a venue's name, a corridor cell, an event type, a date).
 * They are not a privacy control and must not be treated as one.
 *
 * NO COORDINATES. The only geography that enters is the res-7 cell (the corridor,
 * the coarsest cell the platform names). Latitude, longitude and the res-9 cell
 * are not parameters of any function in this file.
 *
 * MISSING INPUTS MEAN NO KEY. A key is never computed from part of its inputs, so
 * an untyped event never joins an "unknown" bucket with other untyped events.
 *
 * Pure functions only. Reading and writing the columns is `spine-keys-store.ts`.
 */

import {
  isValidIanaTimezone,
  PLATFORM_HOME_TZ,
  zonedDatePart,
  zonedTimePart,
} from './event-datetime';

export const SPINE_KEY_VERSION = 'v1';

/** A start before this local time belongs to the previous day's night. */
const NIGHT_ROLLOVER = '04:00';

const APOSTROPHES = /['’‘ʼ`´]/g;
// A combining mark (\p{M}) is part of the letter it sits on: the vowel signs of
// Thai and Devanagari, the dot of a lower-cased "İ". Turning marks into spaces
// would merge different names.
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{M}\p{N}]+/gu;
// Characters that are not part of a letter and are not seen: variation
// selectors (the U+FE0F after an emoji), enclosing marks (the keycap U+20E3)
// and format characters (a soft hyphen, a zero-width space or joiner). Left in,
// "🏟️ Eagles Hall" would not be "Eagles Hall"; turned into spaces, a name pasted
// with a soft hyphen in it would be two words.
const NOT_PART_OF_A_LETTER = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}\p{Me}\p{Cf}]/gu;
// An instant: a date, a time, and a zone (Z or an offset). A string with no
// zone is read in the machine's own zone by `Date`, so it is not an instant.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
// A mark with no letter or digit before it (what is left of an emoji).
const ORPHAN_MARKS = /(^| )\p{M}+/gu;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The venue name as it enters the hash, in this order: an apostrophe is removed
 * ("Joe's" and "Joes" agree); Unicode NFKC; `toLowerCase()` (locale-independent);
 * the result is put in NFC (lower-casing can leave a letter and a mark that
 * have a single form); an apostrophe is removed again (NFKC can produce one,
 * from the full-width form); variation selectors, enclosing marks and format
 * characters are removed; `&` becomes "and"; every other character that is
 * not a letter, a combining mark or a digit becomes a space; a combining mark with no letter or digit before it is
 * removed; a leading "the " is dropped; runs of spaces collapse and the ends
 * are trimmed. "St." and "Street" do not agree, and neither do "Café" and
 * "Cafe"; both are accepted.
 *
 * Lower-casing is the Unicode lower-case mapping (`toLowerCase`, Python
 * `str.lower`), not case folding: "Straße" stays "straße".
 *
 * The first removal comes before NFKC because NFKC splits the acute accent used
 * as an apostrophe (U+00B4) into a space and a combining mark.
 */
export function normaliseVenueName(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  return name
    .replace(APOSTROPHES, '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFC')
    .replace(APOSTROPHES, '')
    .replace(NOT_PART_OF_A_LETTER, '')
    .replace(/&/g, ' and ')
    .replace(NOT_LETTER_OR_DIGIT, ' ')
    .replace(ORPHAN_MARKS, '$1')
    .replace(/ +/g, ' ')
    .trim()
    .replace(/^the /, '')
    .trim();
}

async function hash32(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex.slice(0, 32);
}

/** One id per venue name per res-7 cell; null when either is missing. */
export async function venueCanonicalId(
  location: string | null | undefined,
  h3Res7: string | null | undefined
): Promise<string | null> {
  const name = normaliseVenueName(location);
  const cell = typeof h3Res7 === 'string' ? h3Res7.trim().toLowerCase() : '';
  if (!name || !cell) return null;
  return hash32(`${SPINE_KEY_VERSION}|${name}|${cell}`);
}

function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The night an event belongs to: the local date of `starts_at` in the event's own
 * zone, minus one day when the local start is before 04:00. It reads the wall
 * clock (the local date and the local time), not the instant minus four hours:
 * the two differ by an hour on a daylight-saving day. A date-only event uses
 * `start_date`. Null when there is no usable start.
 */
export function eventNightBucket(event: {
  starts_at?: string | null;
  start_date?: string | null;
  timezone?: string | null;
}): string | null {
  if (typeof event.starts_at === 'string' && INSTANT.test(event.starts_at)) {
    const zone = isValidIanaTimezone(event.timezone)
      ? (event.timezone as string)
      : PLATFORM_HOME_TZ;
    const day = zonedDatePart(event.starts_at, zone);
    const time = zonedTimePart(event.starts_at, zone);
    if (DATE_ONLY.test(day) && time) return time < NIGHT_ROLLOVER ? previousDay(day) : day;
  }
  const dateOnly = typeof event.start_date === 'string' ? event.start_date.slice(0, 10) : '';
  if (!DATE_ONLY.test(dateOnly)) return null;
  // A real calendar date: "2026-02-30" parses, as March 2, and is refused.
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateOnly) return null;
  return dateOnly;
}

/**
 * One id per venue, event type and night; null when any of the three is missing.
 * `'unknown'` is the placeholder exports write for an untyped event: it is not a
 * type, and it never produces a key.
 */
export async function eventCorrelationId(
  venueId: string | null | undefined,
  uecCode: string | null | undefined,
  bucket: string | null | undefined
): Promise<string | null> {
  const code = typeof uecCode === 'string' ? uecCode.trim() : '';
  if (!venueId || !code || code.toLowerCase() === 'unknown' || !bucket) return null;
  return hash32(`${SPINE_KEY_VERSION}|${venueId}|${code}|${bucket}`);
}

/** What the keys are computed from. Nothing else on an event row is read. */
export interface SpineKeyInputs {
  location: string | null;
  h3_res7: string | null;
  uec_code: string | null;
  starts_at: string | null;
  start_date: string | null;
  timezone: string | null;
}

export interface SpineKeys {
  venue_canonical_id: string | null;
  event_correlation_id: string | null;
}

/** Both keys from one stored row. */
export async function computeSpineKeys(row: SpineKeyInputs): Promise<SpineKeys> {
  const venue = await venueCanonicalId(row.location, row.h3_res7);
  const event = await eventCorrelationId(venue, row.uec_code, eventNightBucket(row));
  return { venue_canonical_id: venue, event_correlation_id: event };
}
