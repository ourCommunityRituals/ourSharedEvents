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
  // The `sponsor_impressions` render-event log + its 3 indexes carry
  // "impressions". The full impressions→display rename also changes the
  // SharedReport `sponsor_impressions` field + snapshot (a cross-surface
  // contract), so it is its own focused reconciliation. Tracked by OSE-931
  // (rename sponsor_impressions → sponsor_displays end to end).
  ['sponsor_impressions', 'OSE-931'],
  ['idx_sponsor_impressions_sponsor', 'OSE-931'],
  ['idx_sponsor_impressions_event', 'OSE-931'],
  ['idx_sponsor_impressions_h3_res7', 'OSE-931'],
  // `anon_id_returns.visit_count` + its index carry "visit" and reach the
  // SharedReport export (shared-report-export.ts) — renaming the export field
  // changes the BigQuery-bound contract, so it is a deliberate, separate
  // reconciliation. Tracked by OSE-932 (rename visit_count → return_count).
  ['visit_count', 'OSE-932'],
  ['idx_anon_id_returns_venue_visit', 'OSE-932'],
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
  exempt: ReadonlyMap<string, string> = EXEMPT_IDENTIFIERS
): LexiconViolation[] {
  const violations: LexiconViolation[] = [];
  for (const id of identifiers) {
    if (exempt.has(id.name)) continue;
    for (const token of tokenizeIdentifier(id.name)) {
      if (banned.has(token)) {
        violations.push({ kind: id.kind, name: id.name, table: id.table, term: token });
        break; // one violation per identifier is enough to fail
      }
    }
  }
  return violations;
}
