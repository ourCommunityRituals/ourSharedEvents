/**
 * How people take part in an event: in person, online, or both (OSE-2012,
 * owner decision 2026-11-12, showcase plan S13).
 *
 * `events.attendance_mode` (migration 0108). The create API requires it; every
 * row from before the migration is 'in_person'.
 *
 *   in_person  needs a place. It gets its H3 cell and shows on the map.
 *   online     takes no place: no place text, no coordinates, no cell. An
 *              online event has no place at all, never the visitor's ("place,
 *              not person"). It is LINK ONLY for now: off the map, and left out
 *              of /events, the landing page and the sitemap. Its event page,
 *              its /q and /s codes and the brand API (`GET /api/v2/events?brand=`)
 *              all still answer.
 *   both       a place and an online side. It is on the map by its place.
 *
 * No meeting link is stored or published. A visitor reaches one through the
 * event's own /s code (REGISTER, TICKETS, SIGN UP), which points at the
 * organizer's page. So the public projection gained this one field and nothing
 * else (lib/public-event-projection.ts).
 *
 * `place_kind` (migration 0106) is a different thing: it says how the zoomed
 * map marks a place. The mode does not read or write it, except that an event
 * turned online loses its place, and its kind with it.
 *
 * The values follow schema.org's attendance modes (offline, online, mixed).
 */

import { msg } from './i18n/catalog';
import { DEFAULT_LANG, type Lang } from './i18n/languages';

export const ATTENDANCE_MODES = ['in_person', 'online', 'both'] as const;

export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

/** What a row from before migration 0108 reads as, and the column's default. */
export const DEFAULT_ATTENDANCE_MODE: AttendanceMode = 'in_person';

export function isAttendanceMode(v: unknown): v is AttendanceMode {
  return typeof v === 'string' && (ATTENDANCE_MODES as readonly string[]).includes(v);
}

/**
 * The mode of a stored row. Anything that is not a mode (a row read by a query
 * that does not select the column, a mock fixture) reads as in person, which is
 * what every event was before the field existed.
 */
export function attendanceModeOf(v: unknown): AttendanceMode {
  return isAttendanceMode(v) ? v : DEFAULT_ATTENDANCE_MODE;
}

/** in_person and both need a place; online takes none. */
export function modeNeedsPlace(mode: AttendanceMode): boolean {
  return mode !== 'online';
}

/** "In person", "Online" or "Online and in person", in the page's language. */
export function attendanceModeLabel(v: unknown, lang: Lang = DEFAULT_LANG): string {
  return msg(lang, `mode.${attendanceModeOf(v)}`);
}

/**
 * Link only: an online event is reached by its link, not found by browsing.
 * The rule every discovery surface shares, so they cannot disagree.
 */
export function isLinkOnly(row: { attendance_mode?: unknown }): boolean {
  return attendanceModeOf(row.attendance_mode) === 'online';
}

/** Drop the link-only events from a list read for a discovery surface. */
export function withoutLinkOnly<T extends { attendance_mode?: unknown }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !isLinkOnly(r));
}

/**
 * The same rule as a SQL predicate, for a discovery query that reads ids only
 * (the sitemap). `alias` is the table alias in the query ('' for none).
 */
export function notLinkOnlySql(alias = ''): string {
  const a = alias ? `${alias}.` : '';
  return `${a}attendance_mode != 'online'`;
}

/** What the place rule found wrong with a create or an update, if anything. */
export type PlaceRuleFault = 'LOCATION_REQUIRED' | 'LOCATION_NOT_ALLOWED';

/**
 * The place rule, on the state a write would leave: `hasPlace` is whether the
 * event would have a place name, a street address, or coordinates.
 */
export function placeRuleFault(mode: AttendanceMode, hasPlace: boolean): PlaceRuleFault | null {
  if (modeNeedsPlace(mode)) return hasPlace ? null : 'LOCATION_REQUIRED';
  return hasPlace ? 'LOCATION_NOT_ALLOWED' : null;
}

export const PLACE_RULE_MESSAGES: Record<PlaceRuleFault, string> = {
  LOCATION_REQUIRED:
    'An in-person event needs a place: send location or where_address. An event with no place is attendance_mode "online".',
  LOCATION_NOT_ALLOWED:
    'An online event takes no place: clear location, where_address, lat and lon, or use attendance_mode "both".',
};

export const INVALID_ATTENDANCE_MODE_MESSAGE = `attendance_mode must be one of: ${ATTENDANCE_MODES.join(', ')}`;
