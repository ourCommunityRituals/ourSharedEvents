/**
 * A booth is part of a fair (OSE-1998, OSE ADR-034 decisions 1 and 5): the pure half.
 *
 * What a booth is, said once: a stall inside one event. It holds the number the
 * organizer uses, the trading name the public sees, an optional category, an
 * optional spot on the hall plan, and whether it is in use. It never holds
 * anything about a person (ADR-034 decision 5), so every shape that crosses a
 * route is an allowlist:
 *   - the request body (`BOOTH_WRITE_KEYS`; any other key is refused, so an
 *     `email`, `phone` or `contact_name` field is a 400, never stored or ignored);
 *   - the row (`BOOTH_COLUMNS`, the schema's whole column list; the gate in
 *     tests/event-booths.spec.ts fails when the table grows a column that is
 *     not here);
 *   - the response (`projectBooth`, built field by field, never a spread).
 *
 * A booth's name is a trading name. One that looks like an email address or a
 * phone number is refused: that is a person's contact, not a stall's name.
 *
 * No request, no DB: tests/event-booths.spec.ts drives these directly too.
 */

/**
 * The categories a booth can carry. The ONE place the list lives: the column is
 * free TEXT with no CHECK (migration 0109), so the catalog work (OSE-2002) can
 * change this list without rebuilding the table.
 */
export const BOOTH_CATEGORIES = [
  'food',
  'craft',
  'art',
  'books',
  'clothing',
  'services',
  'community',
  'other',
] as const;
export type BoothCategory = (typeof BOOTH_CATEGORIES)[number];

export const BOOTH_NUMBER_MAX = 20;
export const BOOTH_NAME_MAX = 120;
/** The most booths one bulk request may create. */
export const BOOTH_BULK_MAX = 200;
/** `sort` is a small whole number; this keeps it one. */
export const BOOTH_SORT_LIMIT = 100_000;

/**
 * Every column `event_booths` has (migration 0109). A new column fails the
 * schema gate until it is listed here, so a person field cannot arrive unreviewed.
 */
export const BOOTH_COLUMNS = [
  'id',
  'event_id',
  'number',
  'name',
  'category',
  'hall_x',
  'hall_y',
  'is_active',
  'sort',
  'created_at',
  'updated_at',
] as const;

/** The keys each write accepts. A key outside its list is a 400, never ignored. */
export const BOOTH_WRITE_KEYS = {
  create: ['number', 'name', 'category', 'hall_x', 'hall_y', 'sort'],
  update: ['number', 'name', 'category', 'hall_x', 'hall_y', 'sort', 'is_active'],
  bulk: ['booths'],
} as const;

export interface BoothRow {
  id: string;
  event_id: string;
  number: string;
  name: string;
  category: string | null;
  hall_x: number | null;
  hall_y: number | null;
  is_active: number;
  sort: number;
  created_at: string;
  updated_at: string;
}

/** What a route says about a booth. Field by field: never a spread of the row. */
export interface BoothView {
  id: string;
  event_id: string;
  number: string;
  name: string;
  category: string | null;
  hall_x: number | null;
  hall_y: number | null;
  is_active: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
}

export function projectBooth(row: BoothRow): BoothView {
  return {
    id: row.id,
    event_id: row.event_id,
    number: row.number,
    name: row.name,
    category: row.category,
    hall_x: row.hall_x,
    hall_y: row.hall_y,
    is_active: row.is_active === 1,
    sort: row.sort,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

// The same shapes the series name refuses (lib/event-series.ts): a contact
// detail is a person's, and a booth's name is the stall's.
const EMAIL_SHAPED = /\S@\S/;
const PHONE_SHAPED = /(?:\d[\s().-]*){7,}/;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

function parseNumber(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') return bad('INVALID_NUMBER', 'number must be text');
  if (CONTROL_CHAR.test(raw))
    return bad('INVALID_NUMBER', 'number has a character that is not text');
  const number = raw.trim();
  if (!number) return bad('INVALID_NUMBER', 'number is required');
  if (number.length > BOOTH_NUMBER_MAX)
    return bad('INVALID_NUMBER', `number must be ${BOOTH_NUMBER_MAX} characters or fewer`);
  return { ok: true, value: number };
}

function parseName(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') return bad('INVALID_NAME', 'name must be text');
  if (CONTROL_CHAR.test(raw)) return bad('INVALID_NAME', 'name has a character that is not text');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return bad('INVALID_NAME', 'name is required');
  if (name.length > BOOTH_NAME_MAX)
    return bad('INVALID_NAME', `name must be ${BOOTH_NAME_MAX} characters or fewer`);
  if (EMAIL_SHAPED.test(name) || PHONE_SHAPED.test(name))
    return bad(
      'INVALID_NAME',
      'name is the trading name the public sees; it must not hold an email address or phone number'
    );
  return { ok: true, value: name };
}

function parseCategory(raw: unknown): Parsed<BoothCategory | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!BOOTH_CATEGORIES.includes(raw as BoothCategory))
    return bad('INVALID_CATEGORY', `category must be one of: ${BOOTH_CATEGORIES.join(', ')}`);
  return { ok: true, value: raw as BoothCategory };
}

function parseFraction(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : undefined;
}

/**
 * A spot on the hall plan is two fractions of the plan, from 0 to 1, given
 * together or not at all. Never a latitude or longitude (ADR-034).
 */
function parseHall(
  b: Record<string, unknown>
): Parsed<{ hall_x: number | null; hall_y: number | null }> {
  const hasX = b.hall_x !== undefined && b.hall_x !== null;
  const hasY = b.hall_y !== undefined && b.hall_y !== null;
  if (!hasX && !hasY) return { ok: true, value: { hall_x: null, hall_y: null } };
  if (hasX !== hasY)
    return bad('INVALID_HALL_POSITION', 'hall_x and hall_y are given together, or neither');
  const x = parseFraction(b.hall_x);
  const y = parseFraction(b.hall_y);
  if (x === undefined || y === undefined)
    return bad('INVALID_HALL_POSITION', 'hall_x and hall_y are fractions of the plan, 0 to 1');
  return { ok: true, value: { hall_x: x, hall_y: y } };
}

function parseSort(raw: unknown): Parsed<number> {
  if (raw === undefined || raw === null) return { ok: true, value: 0 };
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < -BOOTH_SORT_LIMIT ||
    raw > BOOTH_SORT_LIMIT
  )
    return bad(
      'INVALID_SORT',
      `sort must be a whole number from -${BOOTH_SORT_LIMIT} to ${BOOTH_SORT_LIMIT}`
    );
  return { ok: true, value: raw };
}

export interface BoothInput {
  number: string;
  name: string;
  category: BoothCategory | null;
  hall_x: number | null;
  hall_y: number | null;
  sort: number;
}

export function parseBoothCreate(body: unknown): Parsed<BoothInput> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, BOOTH_WRITE_KEYS.create);
  if (extra) return bad('UNKNOWN_FIELD', `A booth does not take the field: ${extra}`);
  const number = parseNumber(b.number);
  if (!number.ok) return number;
  const name = parseName(b.name);
  if (!name.ok) return name;
  const category = parseCategory(b.category);
  if (!category.ok) return category;
  const hall = parseHall(b);
  if (!hall.ok) return hall;
  const sort = parseSort(b.sort);
  if (!sort.ok) return sort;
  return {
    ok: true,
    value: {
      number: number.value,
      name: name.value,
      category: category.value,
      hall_x: hall.value.hall_x,
      hall_y: hall.value.hall_y,
      sort: sort.value,
    },
  };
}

/** An update names only what changes. `hall_x`/`hall_y` change together. */
export type BoothPatch = Partial<BoothInput> & { is_active?: boolean };

export function parseBoothUpdate(body: unknown): Parsed<BoothPatch> {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, BOOTH_WRITE_KEYS.update);
  if (extra) return bad('UNKNOWN_FIELD', `A booth does not take the field: ${extra}`);
  const patch: BoothPatch = {};
  if ('number' in b) {
    const number = parseNumber(b.number);
    if (!number.ok) return number;
    patch.number = number.value;
  }
  if ('name' in b) {
    const name = parseName(b.name);
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if ('category' in b) {
    const category = parseCategory(b.category);
    if (!category.ok) return category;
    patch.category = category.value;
  }
  if ('hall_x' in b || 'hall_y' in b) {
    if (!('hall_x' in b && 'hall_y' in b))
      return bad('INVALID_HALL_POSITION', 'hall_x and hall_y are given together, or neither');
    const hall = parseHall(b);
    if (!hall.ok) return hall;
    patch.hall_x = hall.value.hall_x;
    patch.hall_y = hall.value.hall_y;
  }
  if ('sort' in b) {
    const sort = parseSort(b.sort);
    if (!sort.ok) return sort;
    patch.sort = sort.value;
  }
  if ('is_active' in b) {
    if (typeof b.is_active !== 'boolean')
      return bad('INVALID_IS_ACTIVE', 'is_active must be true or false');
    patch.is_active = b.is_active;
  }
  if (Object.keys(patch).length === 0) return bad('NO_FIELDS', 'Name at least one field to change');
  return { ok: true, value: patch };
}

/** One refused row of a bulk request: where it is in the list, and why. */
export interface BulkRowFailure {
  index: number;
  number: string | null;
  code: string;
  error: string;
}

export type ParsedBulk =
  | { ok: true; value: BoothInput[] }
  | { ok: false; code: string; error: string; failed?: BulkRowFailure[] };

/**
 * A bulk request is all or nothing. Every row is checked, and every refused row
 * is reported with its index and reason, so an organizer can fix a pasted list
 * in one pass. Two rows with one number (in any case) are both refused.
 */
export function parseBoothBulk(body: unknown): ParsedBulk {
  const b = asRecord(body);
  if (!b) return bad('INVALID_BODY', 'Send a JSON object');
  const extra = unknownKey(b, BOOTH_WRITE_KEYS.bulk);
  if (extra) return bad('UNKNOWN_FIELD', `A bulk request does not take the field: ${extra}`);
  if (!Array.isArray(b.booths)) return bad('INVALID_BOOTHS', 'booths must be a list');
  if (b.booths.length === 0) return bad('INVALID_BOOTHS', 'booths must hold at least one booth');
  if (b.booths.length > BOOTH_BULK_MAX)
    return bad('TOO_MANY_BOOTHS', `booths holds at most ${BOOTH_BULK_MAX} booths per request`);

  const value: BoothInput[] = [];
  const failed: BulkRowFailure[] = [];
  b.booths.forEach((row, index) => {
    const parsed = parseBoothCreate(row);
    if (parsed.ok) value.push(parsed.value);
    else {
      const raw = asRecord(row)?.number;
      failed.push({
        index,
        number: typeof raw === 'string' ? raw.trim() : null,
        code: parsed.code,
        error: parsed.error,
      });
    }
  });

  // Numbers repeated inside the list. Index into `b.booths`, not `value`.
  const seen = new Map<string, number[]>();
  b.booths.forEach((row, index) => {
    const raw = asRecord(row)?.number;
    if (typeof raw !== 'string' || !raw.trim()) return;
    const key = raw.trim().toLowerCase();
    seen.set(key, [...(seen.get(key) ?? []), index]);
  });
  for (const [, indexes] of seen) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      if (failed.some((f) => f.index === index)) continue;
      failed.push({
        index,
        number: String(asRecord(b.booths[index])?.number).trim(),
        code: 'DUPLICATE_NUMBER',
        error: 'Another booth in this list has the same number',
      });
    }
  }

  if (failed.length > 0) {
    failed.sort((x, y) => x.index - y.index);
    return {
      ok: false,
      code: 'BOOTHS_REFUSED',
      error: `${failed.length} of ${b.booths.length} booths were refused; nothing was saved`,
      failed,
    };
  }
  return { ok: true, value };
}

/** A path or body id: letters, digits, `_` and `-`, as every OSE id is. */
export function parseBoothId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : null;
}
