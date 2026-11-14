/**
 * A series an organizer declares (OSE ADR-029): the pure half.
 *
 * What a series is, said once: a label over a brand's events across time. It
 * holds a name, a cadence, a weekday, an hour and a lifecycle state. It never
 * holds anything about a person, so every shape that crosses the route is an
 * allowlist: the request body (`SERIES_WRITE_KEYS`, anything else is refused),
 * the row (`SERIES_COLUMNS`, the schema's whole column list) and the response
 * (`projectSeries`, built field by field, never a spread of the row).
 *
 * No request, no DB: `tests/event-series.spec.ts` drives these directly.
 */

/**
 * The cadences a series can state. `event_series.cadence` (migration 0033; the
 * column is free TEXT, so the list lives here).
 *
 * The first three name one weekday and one hour. `daily-weekdays` (a room open
 * Monday to Thursday, say) names an hour and no single day. `as-announced`
 * promises nothing about when: it names neither (OSE-2017).
 */
export const SERIES_CADENCES = [
  'weekly',
  'biweekly',
  'monthly',
  'daily-weekdays',
  'as-announced',
] as const;
export type SeriesCadence = (typeof SERIES_CADENCES)[number];

/** Why an organizer turned a suggestion down. A fixed list, never free text. */
export const SERIES_REJECT_REASONS = ['not_recurring', 'wrong_time', 'duplicate', 'other'] as const;
export type SeriesRejectReason = (typeof SERIES_REJECT_REASONS)[number];

export const SERIES_NAME_MAX = 80;
/** The most events one request may attach. */
export const SERIES_ATTACH_MAX = 100;

/**
 * Every column `event_series` has (migration 0033). The schema gate in
 * tests/event-series.spec.ts fails when the table grows a column that is not
 * listed here, so a per-attendee column cannot arrive unreviewed.
 */
export const SERIES_COLUMNS = [
  'id',
  'venue_id',
  'series_name',
  'cadence',
  'day_of_week',
  'hour_of_day',
  'active_from',
  'active_until',
  'state',
  'detected_at',
  'confirmed_at',
  'rejected_reason',
  'created_at',
  'updated_at',
] as const;

/** The keys each write accepts. A key outside its list is a 400, never ignored. */
export const SERIES_WRITE_KEYS = {
  declare: ['name', 'cadence', 'day_of_week', 'hour_of_day', 'event_ids'],
  attach: ['series_id'],
  confirm: ['series_id', 'name', 'event_ids'],
  reject: ['series_id', 'reason'],
} as const;

export interface SeriesRow {
  id: string;
  venue_id: string;
  series_name: string;
  cadence: string | null;
  day_of_week: number | null;
  hour_of_day: number | null;
  state: string;
  detected_at: string | null;
  confirmed_at: string | null;
  rejected_reason: string | null;
}

/** What a route says about a series. Field by field: never a spread of the row. */
export interface SeriesView {
  id: string;
  name: string;
  cadence: string | null;
  day_of_week: number | null;
  hour_of_day: number | null;
  state: string;
  /** The event the series is anchored on. Its brand is the series' brand. */
  anchor_event_id: string;
  /** `declared` by an organizer, or `detected` by the nightly job. */
  origin: 'declared' | 'detected';
  confirmed_at: string | null;
  rejected_reason: string | null;
}

export function projectSeries(row: SeriesRow): SeriesView {
  return {
    id: row.id,
    name: row.series_name,
    cadence: row.cadence,
    day_of_week: row.day_of_week,
    hour_of_day: row.hour_of_day,
    state: row.state,
    anchor_event_id: row.venue_id,
    origin: row.detected_at ? 'detected' : 'declared',
    confirmed_at: row.confirmed_at,
    rejected_reason: row.rejected_reason,
  };
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

const bad = (code: string, error: string): { ok: false; code: string; error: string } => ({
  ok: false,
  code,
  error,
});

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function unknownKey(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(body).find((k) => !allowed.includes(k)) ?? null;
}

// A series name is a label for a programme ("Thursday Trivia"). It is not a
// place for a contact detail: an email-shaped or phone-shaped name is refused.
const EMAIL_SHAPED = /\S@\S/;
const PHONE_SHAPED = /(?:\d[\s().-]*){7,}/;
const JOB_LABEL = /auto-detected/i;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

function parseName(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') return bad('INVALID_NAME', 'name must be text');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return bad('INVALID_NAME', 'name is required');
  if (name.length > SERIES_NAME_MAX)
    return bad('INVALID_NAME', `name must be ${SERIES_NAME_MAX} characters or fewer`);
  if (CONTROL_CHAR.test(raw)) return bad('INVALID_NAME', 'name has a character that is not text');
  if (EMAIL_SHAPED.test(name) || PHONE_SHAPED.test(name))
    return bad('INVALID_NAME', 'name must not hold a contact detail');
  // "(auto-detected)" is the nightly job's own label. A confirmed series' name
  // is public, so it is always one a person gave (OSE-2041).
  if (JOB_LABEL.test(name))
    return bad('INVALID_NAME', 'Give the series a name of your own, without "auto-detected"');
  return { ok: true, value: name };
}

function parseIntIn(raw: unknown, min: number, max: number): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : null;
}

function parseId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : null;
}

function parseEventIds(raw: unknown): Parsed<string[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return bad('INVALID_EVENT_IDS', 'event_ids must be a list');
  if (raw.length > SERIES_ATTACH_MAX)
    return bad('INVALID_EVENT_IDS', `event_ids holds at most ${SERIES_ATTACH_MAX} events`);
  const ids: string[] = [];
  for (const item of raw) {
    const id = parseId(item);
    if (!id) return bad('INVALID_EVENT_IDS', 'event_ids must hold event ids');
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, value: ids };
}

export interface DeclareInput {
  name: string;
  cadence: SeriesCadence;
  /** null for `daily-weekdays` and `as-announced`: they name no single day. */
  day_of_week: number | null;
  /** null for `as-announced`: it promises no time. */
  hour_of_day: number | null;
  event_ids: string[];
}

/** Which of day and hour each cadence states. A field it does not state must be absent. */
const CADENCE_STATES: Record<SeriesCadence, { day: boolean; hour: boolean }> = {
  weekly: { day: true, hour: true },
  biweekly: { day: true, hour: true },
  monthly: { day: true, hour: true },
  'daily-weekdays': { day: false, hour: true },
  'as-announced': { day: false, hour: false },
};

export function parseDeclare(body: unknown): Parsed<DeclareInput> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, SERIES_WRITE_KEYS.declare);
  if (extra) return bad('UNKNOWN_FIELD', `A series does not take the field: ${extra}`);
  const name = parseName(b.name);
  if (!name.ok) return name;
  if (!SERIES_CADENCES.includes(b.cadence as SeriesCadence))
    return bad('INVALID_CADENCE', `cadence must be one of: ${SERIES_CADENCES.join(', ')}`);
  const cadence = b.cadence as SeriesCadence;
  const states = CADENCE_STATES[cadence];
  let day: number | null = null;
  if (states.day) {
    day = parseIntIn(b.day_of_week, 0, 6);
    if (day === null) return bad('INVALID_DAY', 'day_of_week must be 0 (Sunday) to 6 (Saturday)');
  } else if (b.day_of_week !== undefined && b.day_of_week !== null) {
    return bad('INVALID_DAY', `A ${cadence} series names no single day; leave day_of_week out`);
  }
  let hour: number | null = null;
  if (states.hour) {
    hour = parseIntIn(b.hour_of_day, 0, 23);
    if (hour === null) return bad('INVALID_HOUR', 'hour_of_day must be 0 to 23');
  } else if (b.hour_of_day !== undefined && b.hour_of_day !== null) {
    return bad('INVALID_HOUR', `A ${cadence} series promises no time; leave hour_of_day out`);
  }
  const ids = parseEventIds(b.event_ids);
  if (!ids.ok) return ids;
  return {
    ok: true,
    value: {
      name: name.value,
      cadence,
      day_of_week: day,
      hour_of_day: hour,
      event_ids: ids.value,
    },
  };
}

export function parseAttach(body: unknown): Parsed<{ series_id: string }> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, SERIES_WRITE_KEYS.attach);
  if (extra) return bad('UNKNOWN_FIELD', `A series does not take the field: ${extra}`);
  const id = parseId(b.series_id);
  if (!id) return bad('INVALID_SERIES_ID', 'series_id is required');
  return { ok: true, value: { series_id: id } };
}

export interface ConfirmInput {
  series_id: string;
  name: string;
  event_ids: string[];
}

export function parseConfirm(body: unknown): Parsed<ConfirmInput> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, SERIES_WRITE_KEYS.confirm);
  if (extra) return bad('UNKNOWN_FIELD', `A series does not take the field: ${extra}`);
  const id = parseId(b.series_id);
  if (!id) return bad('INVALID_SERIES_ID', 'series_id is required');
  // Required: confirming makes the name public, and the suggestion's own name
  // is the job's label (OSE-2041).
  const name = parseName(b.name);
  if (!name.ok) return name;
  const ids = parseEventIds(b.event_ids);
  if (!ids.ok) return ids;
  return { ok: true, value: { series_id: id, name: name.value, event_ids: ids.value } };
}

export function parseReject(
  body: unknown
): Parsed<{ series_id: string; reason: SeriesRejectReason | null }> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, SERIES_WRITE_KEYS.reject);
  if (extra) return bad('UNKNOWN_FIELD', `A series does not take the field: ${extra}`);
  const id = parseId(b.series_id);
  if (!id) return bad('INVALID_SERIES_ID', 'series_id is required');
  if (b.reason !== undefined && !SERIES_REJECT_REASONS.includes(b.reason as SeriesRejectReason))
    return bad('INVALID_REASON', `reason must be one of: ${SERIES_REJECT_REASONS.join(', ')}`);
  return {
    ok: true,
    value: { series_id: id, reason: (b.reason as SeriesRejectReason | undefined) ?? null },
  };
}
