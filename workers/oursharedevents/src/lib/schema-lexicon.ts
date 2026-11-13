/**
 * OSE-801 (A4, milestone M0) — the honesty lexicon must hold at the persistence
 * layer, not only at the surface.
 *
 * Invariant #25 / the honesty doctrine ban a catalogue of audience-inflation and
 * re-identification words on every rendered surface. But a lint that guards the
 * surface while the STORAGE layer speaks the banned vocabulary is aspirational —
 * every ORM type, export header, log line and error message inherits a banned
 * column name and routes around the surface lint by accident. This module makes
 * the schema itself conform: it flags any table / column / index / view / trigger
 * IDENTIFIER whose snake/camel tokens include a banned term.
 *
 * It matches IDENTIFIERS (names), never raw SQL — so the `UNIQUE` constraint
 * keyword is never a false positive; only a column literally named `unique_*` is.
 *
 * Consumed by tests/schema-lexicon.spec.ts, which reads the REAL built schema
 * (sqlite_master + PRAGMA table_info) and asserts zero violations. Adding a
 * banned-word column in any future migration turns that test red.
 */

/**
 * The banned catalogue, as tokens (lowercase). Singular + plural of each concept
 * because the storage layer inherits either form. Sourced from the honesty
 * lexicon: audience-inflation (attendance, impressions, visits, reach, turnout,
 * eyeballs, views, people) + the re-identification hint (unique — as in
 * "unique visitors/agents", the count that invites de-anonymisation).
 */
export const BANNED_SCHEMA_TERMS: ReadonlySet<string> = new Set([
  'attendance',
  'impression',
  'impressions',
  'visit',
  'visits',
  'reach',
  'unique',
  'turnout',
  'eyeball',
  'eyeballs',
  'people',
  'view',
  'views',
]);

/**
 * Identifiers explicitly accepted despite carrying a banned token — tracked debt,
 * NOT silent omission. Each entry must name the ticket that removes it. The gate
 * stays green while the reconciliation is sequenced, and the debt is visible in
 * source instead of hidden by a weakened word list.
 */
export const EXEMPT_IDENTIFIERS: ReadonlyMap<string, string> = new Map([
  // OSE-931 (2026-10-12): `sponsor_impressions` and its 3 indexes became
  // `sponsor_displays` (migration 0102), so their exemptions are gone.
  // OSE-932 (2026-10-12): `anon_id_returns.visit_count` and its index became
  // `return_count` / `idx_anon_id_returns_venue_return` (migration 0103), so
  // their exemptions are gone. The map is empty.
]);

/**
 * Whole identifiers that hold a banned token and are NOT the banned idea
 * (docs/adr/ADR-028). This is not debt and has no ticket to remove it: each
 * entry is a decision recorded in that ADR, and says why the name is not an
 * audience count.
 *
 * The match is the exact identifier. `attendance_mode` passes; `attendance`,
 * `attendance_count` and `attendance_mode_total` still fail.
 *
 * A name may be here only if it is a column held to a fixed list of words by a
 * CHECK, and is listed in ADR-028. The structural invariant
 * tests/e2e/0-architecture/lexicon-allowance.invariant.spec.ts holds both, so
 * this list cannot grow by a one-line edit.
 */
export const ALLOWED_IDENTIFIERS: ReadonlyMap<string, string> = new Map([
  [
    'attendance_mode',
    // Owner decision 2026-11-12 (OSE-2012). "Attendance mode" is schema.org's
    // name for how an event is held: in person, online, or both. The column
    // holds one of three words (a CHECK in migration 0108), never a number, so
    // it can say nothing about how many people came.
    'OSE-2012: how an event is held (in_person, online, both); a word, never a count',
  ],
]);

export interface SchemaIdentifier {
  /** 'table' | 'column' | 'index' | 'view' | 'trigger' */
  kind: string;
  /** The identifier name as it appears in the schema. */
  name: string;
  /** For columns: the owning table (for a legible violation message). */
  table?: string;
}

export interface LexiconViolation {
  kind: string;
  name: string;
  table?: string;
  term: string;
}

/**
 * Payload keys explicitly accepted despite a banned token (OSE-818). Same rule as
 * EXEMPT_IDENTIFIERS: each names the ticket that removes it.
 */
export const EXEMPT_PAYLOAD_KEYS: ReadonlyMap<string, string> = new Map([
  // Empty since OSE-931 (2026-10-12): the impressions family on the report
  // became sponsor_displays / total_displays / displays_by_surface.
]);

/** A banned token in a key of a JSON payload, with the dotted path to it. */
export interface PayloadKeyViolation {
  path: string;
  key: string;
  term: string;
}

/**
 * Walk every object key of a payload (arrays included) and return each key that
 * carries a banned token and is not exempt. Values are not read: a record keyed
 * by data (a destination kind, a cell id) is still a key and is checked.
 */
export function findBannedPayloadKeys(
  payload: unknown,
  banned: ReadonlySet<string> = BANNED_SCHEMA_TERMS,
  exempt: ReadonlyMap<string, string> = EXEMPT_PAYLOAD_KEYS
): PayloadKeyViolation[] {
  const out: PayloadKeyViolation[] = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (v === null || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) {
      const here = path ? `${path}.${key}` : key;
      if (!exempt.has(key)) {
        const term = tokenizeIdentifier(key).find((t) => banned.has(t));
        if (term) out.push({ path: here, key, term });
      }
      walk(child, here);
    }
  };
  walk(payload, '');
  return out;
}

/** Split an identifier into lowercase alphanumeric tokens (snake_case + camelCase). */
export function tokenizeIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // camelCase → camel_Case
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/**
 * Return every identifier that carries a banned token and is not exempt.
 * Pure — no I/O — so it is unit-testable with a planted violation.
 */
export function findBannedSchemaIdentifiers(
  identifiers: readonly SchemaIdentifier[],
  banned: ReadonlySet<string> = BANNED_SCHEMA_TERMS,
  exempt: ReadonlyMap<string, string> = EXEMPT_IDENTIFIERS,
  allowed: ReadonlyMap<string, string> = ALLOWED_IDENTIFIERS
): LexiconViolation[] {
  const violations: LexiconViolation[] = [];
  for (const id of identifiers) {
    if (exempt.has(id.name) || allowed.has(id.name)) continue;
    for (const token of tokenizeIdentifier(id.name)) {
      if (banned.has(token)) {
        violations.push({ kind: id.kind, name: id.name, table: id.table, term: token });
        break; // one violation per identifier is enough to fail
      }
    }
  }
  return violations;
}
