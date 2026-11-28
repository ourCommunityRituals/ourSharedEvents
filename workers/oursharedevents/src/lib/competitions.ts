/**
 * Competitions: leagues, seasons and their matches (OSE-525, OSE-526, OSE-529;
 * phase 1 of the leagues design, OCR-docs PROPOSAL_leagues-tournaments-referees.md).
 * The pure half: no request, no DB, so tests/competitions-lib.spec.ts drives it
 * directly.
 *
 * What a competition is, said once: a brand's league, season, time-boxed ladder
 * or one-off tournament. It has stages (phase 1: one round robin), entries (a
 * team slot with the public label the team chose), fixtures (one match, on an
 * ordinary event night) and results (two scores).
 *
 * NEVER WHO. Nothing here holds a person. A label is a team's public name; one
 * shaped like an email address or a phone number is refused. Every shape that
 * crosses a route is an allowlist: the body keys (`*_WRITE_KEYS`, any other key
 * is a 400), the columns (`*_COLUMNS`, the schema gate fails on a new column
 * that is not listed) and the responses (built field by field, never a spread).
 *
 * SCORES ARE NOT COUNTS OF PEOPLE. The under-5 floor guards counts of people;
 * a score of 3 to 1 is a game, so it shows as it is (design section 5.1).
 * Standings are computed on every read, never stored (OSE-525).
 */

// ─── Fixed lists ──────────────────────────────────────────────────────────────

export const COMPETITION_FORMATS = ['league', 'seasonal', 'temporal', 'one_off'] as const;
export type CompetitionFormat = (typeof COMPETITION_FORMATS)[number];

export const COMPETITION_STATUSES = ['draft', 'active', 'finished'] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

/** Stage kinds. Phase 1 builds round robin only; brackets come in phase 2. */
export const STAGE_KINDS = ['round_robin'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/**
 * How a result turns into standings points. The ONE place the list lives (the
 * column is free TEXT), so a sport's rule pack can join later without a table
 * rebuild. Draws are allowed only where the ruleset gives a draw its points.
 */
export interface Ruleset {
  win: number;
  draw: number | null;
  loss: number;
  /** The words a visitor reads under the table. */
  says: string;
}
export const RULESETS = {
  win_loss: {
    win: 1,
    draw: null,
    loss: 0,
    says: 'A win is 1 point. If teams tie on points: most wins, then the biggest score gap, then most points scored.',
  },
  two_one_zero: {
    win: 2,
    draw: 1,
    loss: 0,
    says: 'A win is 2 points. A tie game is 1. If teams tie on points: most wins, then the biggest score gap, then most points scored.',
  },
  three_one_zero: {
    win: 3,
    draw: 1,
    loss: 0,
    says: 'A win is 3 points. A tie game is 1. If teams tie on points: most wins, then the biggest score gap, then most points scored.',
  },
} as const satisfies Record<string, Ruleset>;
export type RulesetKey = keyof typeof RULESETS;
export const RULESET_KEYS = Object.keys(RULESETS) as RulesetKey[];

export function rulesetOf(key: string): Ruleset {
  return (RULESETS as Record<string, Ruleset>)[key] ?? RULESETS.win_loss;
}

export const FORMAT_LABELS: Readonly<Record<CompetitionFormat, string>> = {
  league: 'League',
  seasonal: 'Season',
  temporal: 'Limited run',
  one_off: 'Tournament',
};

export const NAME_MAX = 80;
export const LABEL_MAX = 40;
export const SLOT_MAX = 24;
export const SPORT_MAX = 40;
export const SCORE_MAX = 999;
/** A round robin of more teams than this is not phase 1's job. */
export const ENTRIES_MAX = 40;
export const SEED_LIMIT = 1000;

// ─── Columns (the schema gate reads these) ────────────────────────────────────

export const COMPETITION_COLUMNS = [
  'id',
  'brand_id',
  'created_by',
  'name',
  'sport',
  'format',
  'status',
  'starts_on',
  'ends_on',
  'ruleset',
  'source',
  'created_at',
  'updated_at',
] as const;
export const STAGE_COLUMNS = ['id', 'competition_id', 'kind', 'sort', 'created_at'] as const;
export const ENTRY_COLUMNS = [
  'id',
  'competition_id',
  'label',
  'seed',
  'is_active',
  'created_at',
  'updated_at',
] as const;
export const FIXTURE_COLUMNS = [
  'id',
  'competition_id',
  'stage_id',
  'event_id',
  'round',
  'slot_label',
  'slot_time',
  'entry_a',
  'entry_b',
  'status',
  'created_at',
  'updated_at',
] as const;
export const RESULT_COLUMNS = [
  'fixture_id',
  'score_a',
  'score_b',
  'state',
  'entered_by',
  'evidence_key',
  'updated_at',
] as const;

/** The keys each write accepts. A key outside its list is a 400, never ignored. */
export const WRITE_KEYS = {
  createCompetition: ['brand_id', 'name', 'sport', 'format', 'starts_on', 'ends_on', 'ruleset'],
  updateCompetition: ['name', 'sport', 'status', 'starts_on', 'ends_on', 'ruleset'],
  createEntry: ['label', 'seed'],
  updateEntry: ['label', 'seed', 'is_active'],
  schedule: ['event_ids', 'slots', 'start_time', 'slot_minutes'],
  createFixture: ['round', 'entry_a', 'entry_b', 'event_id', 'slot_label', 'slot_time'],
  updateFixture: ['round', 'entry_a', 'entry_b', 'event_id', 'slot_label', 'slot_time', 'status'],
  result: ['score_a', 'score_b'],
} as const;

// ─── Rows ─────────────────────────────────────────────────────────────────────

export interface CompetitionRow {
  id: string;
  brand_id: string;
  created_by: string | null;
  name: string;
  sport: string | null;
  format: CompetitionFormat;
  status: CompetitionStatus;
  starts_on: string | null;
  ends_on: string | null;
  ruleset: string;
  /** One source only: the host here ('native'), or a one-way sheet mirror (OSE-2240). */
  source: 'native' | 'mirrored';
  created_at: string;
  updated_at: string;
}

export interface EntryRow {
  id: string;
  competition_id: string;
  label: string;
  seed: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface FixtureRow {
  id: string;
  competition_id: string;
  stage_id: string;
  event_id: string | null;
  round: number;
  slot_label: string | null;
  slot_time: string | null;
  entry_a: string;
  entry_b: string;
  status: 'scheduled' | 'played' | 'postponed';
  created_at: string;
  updated_at: string;
}

export interface ResultRow {
  fixture_id: string;
  score_a: number;
  score_b: number;
  state: 'provisional' | 'confirmed' | 'disputed' | 'final';
  entered_by: 'host' | 'referee';
  evidence_key: string | null;
  updated_at: string;
}

// ─── Ids ──────────────────────────────────────────────────────────────────────

const hex32 = () => crypto.randomUUID().replace(/-/g, '');
export const newCompetitionId = () => `cmp_${hex32()}`;
export const newStageId = () => `stg_${hex32()}`;
/** The team-id shape of OSE ADR-040 (lib/votes.ts TEAM_ID). */
export const newEntryId = () => `grp_${hex32()}`;
export const newFixtureId = () => `fix_${hex32()}`;

/** A path or body id: letters, digits, `_` and `-`, as every OSE id is. */
export function parseId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : null;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

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

function unknownKey(b: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(b).find((k) => !allowed.includes(k)) ?? null;
}

// The same shapes a booth name and a series name refuse: a contact detail is a
// person's, and these are a team's or a competition's public words.
const EMAIL_SHAPED = /\S@\S/;
const PHONE_SHAPED = /(?:\d[\s().-]*){7,}/;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SPORT = /^[a-z0-9_]{1,40}$/;

/** Public words: trimmed, one space between words, no contact detail. */
export function parsePublicText(
  raw: unknown,
  field: string,
  max: number,
  code: string
): Parsed<string> {
  if (typeof raw !== 'string') return bad(code, `${field} must be text`);
  if (CONTROL_CHAR.test(raw)) return bad(code, `${field} has a character that is not text`);
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return bad(code, `${field} is required`);
  if (text.length > max) return bad(code, `${field} must be ${max} characters or fewer`);
  if (EMAIL_SHAPED.test(text) || PHONE_SHAPED.test(text))
    return bad(
      code,
      `${field} is shown to the public; it must not hold an email address or phone number`
    );
  return { ok: true, value: text };
}

function parseDay(raw: unknown, field: string): Parsed<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || !DAY.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`)))
    return bad('INVALID_DATE', `${field} must be a date like 2026-09-01`);
  return { ok: true, value: raw };
}

function parseSport(raw: unknown): Parsed<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || !SPORT.test(raw))
    return bad('INVALID_SPORT', 'sport is an event type key, like bocce_league');
  return { ok: true, value: raw };
}

/**
 * Leagues are for every sport, not only bocce (owner, 2026-11-28: "think soccer
 * too"). Where a tie game is a normal result, a new competition with no ruleset
 * named starts on 3 for a win, 1 for a tie; every other sport starts on win or
 * lose. The host can still pick any ruleset.
 */
const TIES_ARE_NORMAL = /^(soccer|futsal)(_|$)/;

export function defaultRulesetFor(sport: string | null): RulesetKey {
  return sport && TIES_ARE_NORMAL.test(sport) ? 'three_one_zero' : 'win_loss';
}

function parseRuleset(raw: unknown, sport: string | null = null): Parsed<RulesetKey> {
  if (raw === undefined || raw === null) return { ok: true, value: defaultRulesetFor(sport) };
  if (!RULESET_KEYS.includes(raw as RulesetKey))
    return bad('INVALID_RULESET', `ruleset must be one of: ${RULESET_KEYS.join(', ')}`);
  return { ok: true, value: raw as RulesetKey };
}

export interface CompetitionInput {
  brand_id: string | null;
  name: string;
  sport: string | null;
  format: CompetitionFormat;
  starts_on: string | null;
  ends_on: string | null;
  ruleset: RulesetKey;
}

const BRAND = /^[a-z0-9_-]{1,64}$/;

export function parseCompetitionCreate(body: unknown): Parsed<CompetitionInput> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, WRITE_KEYS.createCompetition);
  if (extra) return bad('UNKNOWN_FIELD', `A competition does not take the field: ${extra}`);
  let brand: string | null = null;
  if (b.brand_id !== undefined) {
    if (typeof b.brand_id !== 'string' || !BRAND.test(b.brand_id.trim()))
      return bad('INVALID_BRAND', 'brand_id must be lowercase letters, digits, - or _');
    brand = b.brand_id.trim();
  }
  const name = parsePublicText(b.name, 'name', NAME_MAX, 'INVALID_NAME');
  if (!name.ok) return name;
  const sport = parseSport(b.sport);
  if (!sport.ok) return sport;
  if (!COMPETITION_FORMATS.includes(b.format as CompetitionFormat))
    return bad('INVALID_FORMAT', `format must be one of: ${COMPETITION_FORMATS.join(', ')}`);
  const starts = parseDay(b.starts_on, 'starts_on');
  if (!starts.ok) return starts;
  const ends = parseDay(b.ends_on, 'ends_on');
  if (!ends.ok) return ends;
  if (starts.value && ends.value && ends.value < starts.value)
    return bad('INVALID_DATE', 'ends_on must not be before starts_on');
  const ruleset = parseRuleset(b.ruleset, sport.value);
  if (!ruleset.ok) return ruleset;
  return {
    ok: true,
    value: {
      brand_id: brand,
      name: name.value,
      sport: sport.value,
      format: b.format as CompetitionFormat,
      starts_on: starts.value,
      ends_on: ends.value,
      ruleset: ruleset.value,
    },
  };
}

export type CompetitionPatch = Partial<Omit<CompetitionInput, 'brand_id' | 'format'>> & {
  status?: CompetitionStatus;
};

export function parseCompetitionUpdate(body: unknown): Parsed<CompetitionPatch> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, WRITE_KEYS.updateCompetition);
  if (extra) return bad('UNKNOWN_FIELD', `A competition does not take the field: ${extra}`);
  const patch: CompetitionPatch = {};
  if ('name' in b) {
    const name = parsePublicText(b.name, 'name', NAME_MAX, 'INVALID_NAME');
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if ('sport' in b) {
    const sport = parseSport(b.sport);
    if (!sport.ok) return sport;
    patch.sport = sport.value;
  }
  if ('status' in b) {
    if (!COMPETITION_STATUSES.includes(b.status as CompetitionStatus))
      return bad('INVALID_STATUS', `status must be one of: ${COMPETITION_STATUSES.join(', ')}`);
    patch.status = b.status as CompetitionStatus;
  }
  if ('starts_on' in b) {
    const d = parseDay(b.starts_on, 'starts_on');
    if (!d.ok) return d;
    patch.starts_on = d.value;
  }
  if ('ends_on' in b) {
    const d = parseDay(b.ends_on, 'ends_on');
    if (!d.ok) return d;
    patch.ends_on = d.value;
  }
  if ('ruleset' in b) {
    const r = parseRuleset(b.ruleset);
    if (!r.ok) return r;
    patch.ruleset = r.value;
  }
  if (Object.keys(patch).length === 0) return bad('NO_FIELDS', 'Name at least one field to change');
  return { ok: true, value: patch };
}

function parseSeed(raw: unknown): Parsed<number> {
  if (raw === undefined || raw === null) return { ok: true, value: 0 };
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > SEED_LIMIT)
    return bad('INVALID_SEED', `seed must be a whole number from 0 to ${SEED_LIMIT}`);
  return { ok: true, value: raw };
}

export interface EntryInput {
  label: string;
  seed: number;
}

export function parseEntryCreate(body: unknown): Parsed<EntryInput> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, WRITE_KEYS.createEntry);
  if (extra) return bad('UNKNOWN_FIELD', `A team entry does not take the field: ${extra}`);
  const label = parsePublicText(b.label, 'label', LABEL_MAX, 'INVALID_LABEL');
  if (!label.ok) return label;
  const seed = parseSeed(b.seed);
  if (!seed.ok) return seed;
  return { ok: true, value: { label: label.value, seed: seed.value } };
}

export type EntryPatch = Partial<EntryInput> & { is_active?: boolean };

export function parseEntryUpdate(body: unknown): Parsed<EntryPatch> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, WRITE_KEYS.updateEntry);
  if (extra) return bad('UNKNOWN_FIELD', `A team entry does not take the field: ${extra}`);
  const patch: EntryPatch = {};
  if ('label' in b) {
    const label = parsePublicText(b.label, 'label', LABEL_MAX, 'INVALID_LABEL');
    if (!label.ok) return label;
    patch.label = label.value;
  }
  if ('seed' in b) {
    const seed = parseSeed(b.seed);
    if (!seed.ok) return seed;
    patch.seed = seed.value;
  }
  if ('is_active' in b) {
    if (typeof b.is_active !== 'boolean')
      return bad('INVALID_IS_ACTIVE', 'is_active must be true or false');
    patch.is_active = b.is_active;
  }
  if (Object.keys(patch).length === 0) return bad('NO_FIELDS', 'Name at least one field to change');
  return { ok: true, value: patch };
}

function parseSlot(raw: unknown): Parsed<string | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  return parsePublicText(raw, 'slot_label', SLOT_MAX, 'INVALID_SLOT');
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseTime(raw: unknown): Parsed<string | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || !HHMM.test(raw))
    return bad('INVALID_TIME', 'a time is HH:MM on a 24-hour clock, like 19:30');
  return { ok: true, value: raw };
}

export interface ScheduleInput {
  /** One event night per round, in order. A round past the list has no night yet. */
  event_ids: string[];
  /** Court or table labels, used in turn within a round. */
  slots: string[];
  /** When the first match of a night starts, HH:MM. */
  start_time: string | null;
  /** Minutes between time slots when every court is in use (30 is usual). */
  slot_minutes: number;
}

/**
 * Where and when the i-th match of a night is played: courts in turn, and once
 * every court is taken, the next time slot. No courts means one slot per match
 * time; no start time means no time.
 */
export function slotFor(
  i: number,
  input: Pick<ScheduleInput, 'slots' | 'start_time' | 'slot_minutes'>
): { slot_label: string | null; slot_time: string | null } {
  const courts = input.slots.length;
  const slot_label = courts ? input.slots[i % courts] : null;
  if (!input.start_time) return { slot_label, slot_time: null };
  const wave = courts ? Math.floor(i / courts) : i;
  const [h, m] = input.start_time.split(':').map(Number);
  const total = h * 60 + m + wave * input.slot_minutes;
  if (total >= 24 * 60) return { slot_label, slot_time: null };
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return { slot_label, slot_time: `${hh}:${mm}` };
}

export function parseSchedule(body: unknown): Parsed<ScheduleInput> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, WRITE_KEYS.schedule);
  if (extra) return bad('UNKNOWN_FIELD', `A schedule does not take the field: ${extra}`);
  const rawEvents = b.event_ids ?? [];
  if (!Array.isArray(rawEvents) || rawEvents.length > ENTRIES_MAX * 2)
    return bad(
      'INVALID_EVENTS',
      `event_ids must be a list of at most ${ENTRIES_MAX * 2} event ids`
    );
  const event_ids: string[] = [];
  for (const raw of rawEvents) {
    const id = parseId(raw);
    if (!id) return bad('INVALID_EVENTS', 'every event id must be letters, digits, - or _');
    event_ids.push(id);
  }
  const rawSlots = b.slots ?? [];
  if (!Array.isArray(rawSlots) || rawSlots.length > 20)
    return bad('INVALID_SLOT', 'slots must be a list of at most 20 court or table labels');
  const slots: string[] = [];
  for (const raw of rawSlots) {
    const s = parseSlot(raw);
    if (!s.ok) return s;
    if (s.value) slots.push(s.value);
  }
  const start = parseTime(b.start_time);
  if (!start.ok) return start;
  let slot_minutes = 30;
  if (b.slot_minutes !== undefined) {
    if (
      typeof b.slot_minutes !== 'number' ||
      !Number.isInteger(b.slot_minutes) ||
      b.slot_minutes < 5 ||
      b.slot_minutes > 240
    )
      return bad('INVALID_TIME', 'slot_minutes must be a whole number from 5 to 240');
    slot_minutes = b.slot_minutes;
  }
  return { ok: true, value: { event_ids, slots, start_time: start.value, slot_minutes } };
}

function parseRound(raw: unknown): Parsed<number> {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > ENTRIES_MAX * 2)
    return bad('INVALID_ROUND', `round must be a whole number from 1 to ${ENTRIES_MAX * 2}`);
  return { ok: true, value: raw };
}

export interface FixtureInput {
  round: number;
  entry_a: string;
  entry_b: string;
  event_id: string | null;
  slot_label: string | null;
  slot_time: string | null;
}

function parseEntryRef(raw: unknown, field: string): Parsed<string> {
  const id = parseId(raw);
  return id ? { ok: true, value: id } : bad('INVALID_ENTRY', `${field} must be a team entry id`);
}

function parseEventRef(raw: unknown): Parsed<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const id = parseId(raw);
  return id ? { ok: true, value: id } : bad('INVALID_EVENT', 'event_id must be an event id');
}

export function parseFixtureCreate(body: unknown): Parsed<FixtureInput> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, WRITE_KEYS.createFixture);
  if (extra) return bad('UNKNOWN_FIELD', `A match does not take the field: ${extra}`);
  const round = parseRound(b.round);
  if (!round.ok) return round;
  const a = parseEntryRef(b.entry_a, 'entry_a');
  if (!a.ok) return a;
  const bb = parseEntryRef(b.entry_b, 'entry_b');
  if (!bb.ok) return bb;
  if (a.value === bb.value) return bad('SAME_ENTRY', 'A team cannot play itself');
  const ev = parseEventRef(b.event_id);
  if (!ev.ok) return ev;
  const slot = parseSlot(b.slot_label);
  if (!slot.ok) return slot;
  const time = parseTime(b.slot_time);
  if (!time.ok) return time;
  return {
    ok: true,
    value: {
      round: round.value,
      entry_a: a.value,
      entry_b: bb.value,
      event_id: ev.value,
      slot_label: slot.value,
      slot_time: time.value,
    },
  };
}

export type FixturePatch = Partial<FixtureInput> & { status?: 'scheduled' | 'postponed' };

export function parseFixtureUpdate(body: unknown): Parsed<FixturePatch> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, WRITE_KEYS.updateFixture);
  if (extra) return bad('UNKNOWN_FIELD', `A match does not take the field: ${extra}`);
  const patch: FixturePatch = {};
  if ('round' in b) {
    const r = parseRound(b.round);
    if (!r.ok) return r;
    patch.round = r.value;
  }
  if ('entry_a' in b) {
    const a = parseEntryRef(b.entry_a, 'entry_a');
    if (!a.ok) return a;
    patch.entry_a = a.value;
  }
  if ('entry_b' in b) {
    const e = parseEntryRef(b.entry_b, 'entry_b');
    if (!e.ok) return e;
    patch.entry_b = e.value;
  }
  if ('event_id' in b) {
    const ev = parseEventRef(b.event_id);
    if (!ev.ok) return ev;
    patch.event_id = ev.value;
  }
  if ('slot_label' in b) {
    const s = parseSlot(b.slot_label);
    if (!s.ok) return s;
    patch.slot_label = s.value;
  }
  if ('slot_time' in b) {
    const t = parseTime(b.slot_time);
    if (!t.ok) return t;
    patch.slot_time = t.value;
  }
  if ('status' in b) {
    // `played` is set by a result, never by hand.
    if (b.status !== 'scheduled' && b.status !== 'postponed')
      return bad('INVALID_STATUS', 'status must be scheduled or postponed');
    patch.status = b.status;
  }
  if (Object.keys(patch).length === 0) return bad('NO_FIELDS', 'Name at least one field to change');
  return { ok: true, value: patch };
}

export function parseResult(
  body: unknown,
  ruleset: Ruleset
): Parsed<{ score_a: number; score_b: number }> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, WRITE_KEYS.result);
  if (extra) return bad('UNKNOWN_FIELD', `A score does not take the field: ${extra}`);
  const ok = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= SCORE_MAX;
  if (!ok(b.score_a) || !ok(b.score_b))
    return bad('INVALID_SCORE', `score_a and score_b are whole numbers from 0 to ${SCORE_MAX}`);
  if (b.score_a === b.score_b && ruleset.draw === null)
    return bad('DRAW_NOT_ALLOWED', 'This competition has no draws: one team must win');
  return { ok: true, value: { score_a: b.score_a as number, score_b: b.score_b as number } };
}

// ─── Round robin (OSE-526): the circle method, nothing clever ─────────────────

export interface Pairing {
  round: number;
  a: string;
  b: string;
}

/**
 * Every team plays every other team once. Teams are taken in the order given
 * (the caller sorts by seed). With an odd number one team sits out each round
 * (a bye), and no pairing is made for it. Rounds are numbered from 1.
 *
 * Circle method: fix the first team, rotate the rest one place each round.
 * Home and away alternate for the fixed team so it is not always first.
 */
export function roundRobin(ids: readonly string[]): Pairing[] {
  if (ids.length < 2) return [];
  const BYE = '\u0000bye';
  const ring: string[] = ids.length % 2 === 0 ? [...ids] : [...ids, BYE];
  const n = ring.length;
  const out: Pairing[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      let a = ring[i];
      let b = ring[n - 1 - i];
      if (i === 0 && r % 2 === 1) [a, b] = [b, a];
      if (a !== BYE && b !== BYE) out.push({ round: r + 1, a, b });
    }
    // Keep ring[0] fixed; move the last to position 1.
    ring.splice(1, 0, ring.pop() as string);
  }
  return out;
}

/** The team that sits out each round, when the count is odd. Display only. */
export function byesOf(ids: readonly string[], pairings: readonly Pairing[]): Map<number, string> {
  const out = new Map<number, string>();
  const rounds = new Set(pairings.map((p) => p.round));
  for (const round of rounds) {
    const playing = new Set(pairings.filter((p) => p.round === round).flatMap((p) => [p.a, p.b]));
    const off = ids.filter((id) => !playing.has(id));
    if (off.length === 1) out.set(round, off[0]);
  }
  return out;
}

// ─── Standings (OSE-525, OSE-529): computed, never stored ─────────────────────

export interface StandingsRow {
  entry_id: string;
  label: string;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  diff: number;
  points: number;
}

export interface StandingsFixture {
  entry_a: string;
  entry_b: string;
  status: string;
  score_a: number | null;
  score_b: number | null;
  state: string | null;
}

/** A result counts in the table once it is confirmed or final. */
export function counts(f: StandingsFixture): boolean {
  return (
    f.status === 'played' &&
    f.score_a !== null &&
    f.score_b !== null &&
    (f.state === 'confirmed' || f.state === 'final')
  );
}

/**
 * The table. Order: points, then wins, then score difference, then points
 * scored, then the label (so the order is stable). Teams level on all four
 * numbers share a rank. A withdrawn team keeps its played matches.
 */
export function computeStandings(
  entries: readonly { id: string; label: string; is_active: number }[],
  fixtures: readonly StandingsFixture[],
  ruleset: Ruleset
): StandingsRow[] {
  const rows = new Map<string, StandingsRow>();
  for (const e of entries) {
    rows.set(e.id, {
      entry_id: e.id,
      label: e.label,
      rank: 0,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      scored: 0,
      conceded: 0,
      diff: 0,
      points: 0,
    });
  }
  for (const f of fixtures) {
    if (!counts(f)) continue;
    const a = rows.get(f.entry_a);
    const b = rows.get(f.entry_b);
    if (!a || !b) continue;
    const sa = f.score_a as number;
    const sb = f.score_b as number;
    a.played++;
    b.played++;
    a.scored += sa;
    a.conceded += sb;
    b.scored += sb;
    b.conceded += sa;
    if (sa > sb) {
      a.won++;
      b.lost++;
      a.points += ruleset.win;
      b.points += ruleset.loss;
    } else if (sb > sa) {
      b.won++;
      a.lost++;
      b.points += ruleset.win;
      a.points += ruleset.loss;
    } else {
      a.drawn++;
      b.drawn++;
      a.points += ruleset.draw ?? 0;
      b.points += ruleset.draw ?? 0;
    }
  }
  const active = new Set(entries.filter((e) => e.is_active === 1).map((e) => e.id));
  const list = [...rows.values()]
    .filter((r) => active.has(r.entry_id) || r.played > 0)
    .map((r) => ({ ...r, diff: r.scored - r.conceded }));
  const key = (r: StandingsRow) => [r.points, r.won, r.diff, r.scored];
  list.sort((x, y) => {
    const kx = key(x);
    const ky = key(y);
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return ky[i] - kx[i];
    return x.label.localeCompare(y.label);
  });
  list.forEach((r, i) => {
    const prev = list[i - 1];
    r.rank = prev && key(prev).every((v, j) => v === key(r)[j]) ? prev.rank : i + 1;
  });
  return list;
}

// ─── Views (field by field, never a spread) ───────────────────────────────────

export function projectCompetition(row: CompetitionRow) {
  return {
    id: row.id,
    brand_id: row.brand_id,
    name: row.name,
    sport: row.sport,
    format: row.format,
    status: row.status,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    ruleset: row.ruleset,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function projectEntry(row: EntryRow) {
  return {
    id: row.id,
    label: row.label,
    seed: row.seed,
    is_active: row.is_active === 1,
  };
}

export function projectFixture(row: FixtureRow, result: ResultRow | null) {
  return {
    id: row.id,
    round: row.round,
    event_id: row.event_id,
    slot_label: row.slot_label,
    slot_time: row.slot_time,
    entry_a: row.entry_a,
    entry_b: row.entry_b,
    status: row.status,
    // The score and its state only. evidence_key (the scoreboard photo) is the
    // organizers' and referees' alone and never leaves through here (migration 0125).
    result: result
      ? {
          score_a: result.score_a,
          score_b: result.score_b,
          state: result.state,
          entered_by: result.entered_by,
        }
      : null,
  };
}
