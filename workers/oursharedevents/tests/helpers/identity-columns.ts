/**
 * Which schema columns look like they identify a person, by name pattern.
 *
 * Read by the derived PII column gate (tests/pii-invariant.spec.ts, OSE-1660)
 * and the two-database wall (tests/architecture.spec.ts, OSE-1661). Both read
 * the real schema after every migration (sqlite_master + PRAGMA table_info) and
 * classify each column with the patterns here, so a new column is checked
 * without anyone adding its name to a list.
 *
 * A column is classified by its name's tokens (snake_case and camelCase split,
 * lower-cased), the way lib/schema-lexicon.ts tokenises: "attendee_email_hash"
 * is [attendee, email, hash]. Token matching, not substring matching, so
 * "display_name" is not a person's name and "shipping" is not "ip".
 *
 * Not classified, on purpose: street addresses and lat/lon. In this schema they
 * are venue, poster and sponsor locations, never a person's (Invariant #4).
 *
 * Every exemption names the reason it is allowed and where that was decided.
 * The gates fail when an exemption no longer matches a column, so the list
 * cannot outlive what it excuses.
 */

export type IdentityClass = 'email' | 'phone' | 'person-name' | 'network' | 'browser';

export interface SchemaColumn {
  binding: 'DB' | 'FORMS_DB';
  table: string;
  column: string;
}

/** Split snake_case / camelCase / digits into lower-case tokens. */
export function columnTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const PERSON_NAME_QUALIFIERS = new Set([
  'attendee',
  'person',
  'user',
  'customer',
  'guest',
  'contact',
  'first',
  'last',
  'full',
  'given',
  'family',
  'legal',
  'member',
]);

/** Exact names the first version of this gate (ten raw network identifiers) named. */
const NETWORK_NAMES = new Set([
  'ip_address',
  'ip_addr',
  'client_ip',
  'remote_ip',
  'remote_addr',
  'x_forwarded_for',
  'cf_connecting_ip',
  'user_ip',
  'src_ip',
  'source_ip',
]);

/** The identity classes a column name falls into (empty for most columns). */
export function classifyColumn(name: string): IdentityClass[] {
  const t = new Set(columnTokens(name));
  const out: IdentityClass[] = [];
  if (t.has('email') || t.has('mail')) out.push('email');
  if (t.has('phone') || t.has('mobile') || t.has('msisdn')) out.push('phone');
  if (t.has('name') && [...t].some((x) => PERSON_NAME_QUALIFIERS.has(x))) out.push('person-name');
  if (t.has('ip') || t.has('ipv4') || t.has('ipv6') || NETWORK_NAMES.has(name.toLowerCase())) {
    out.push('network');
  }
  if (
    ((t.has('anonymous') || t.has('anon')) && t.has('id')) ||
    (t.has('user') && t.has('agent')) ||
    t.has('ua') ||
    t.has('cookie') ||
    t.has('fingerprint') ||
    t.has('device')
  ) {
    out.push('browser');
  }
  return out;
}

/** A column stored as a one-way hash or as ciphertext, judged by its name. */
export function isProtectedForm(name: string): boolean {
  const t = new Set(columnTokens(name));
  return t.has('hash') || t.has('hashes') || t.has('encrypted');
}

export interface Exemption {
  /** Why this column may hold what it holds. */
  why: string;
  /** Where that was decided, or the ticket that removes the exemption. */
  ref: string;
}

/**
 * Reviewed exceptions, keyed `BINDING.table.column`. Adding one is a reviewed
 * decision: say why, and where it was decided. Do not add one to make a gate
 * pass on a column that should have been hashed, encrypted or moved.
 */
export const IDENTITY_EXEMPTIONS: ReadonlyMap<string, Exemption> = new Map([
  [
    'DB.admin_brand_memberships.email',
    {
      why: "An operator's own sign-in email, the key of their brand role. Not an attendee.",
      ref: 'OSE-1415 (founder membership row); reviewed under OSE-1661',
    },
  ],
  [
    'DB.sponsor_business.contact_email',
    {
      why: "A business's public contact, optional and public by the sponsor's choice.",
      ref: 'migration 0083 (sponsor public card, 2026-09-30); reviewed under OSE-1661',
    },
  ],
  [
    'DB.sponsor_business.contact_phone',
    {
      why: "A business's public phone, optional and public by the sponsor's choice.",
      ref: 'migration 0083 (sponsor public card, 2026-09-30); reviewed under OSE-1661',
    },
  ],
  [
    'DB.admin_audit_log.ip',
    {
      why: "The operator's raw request IP in the admin audit trail; masked on brand-scoped reads.",
      ref: 'OSE-1686 (decide hash, truncate or bounded retention)',
    },
  ],
  [
    'DB.scan_node_returns.anonymous_id',
    {
      why: 'Holds the keyed scan id (snk1_ + HMAC), never the ose_anon cookie value.',
      ref: 'OSE-1659 (migration 0095, lib/scan-node-key.ts)',
    },
  ],
  [
    'FORMS_DB.form_registrations.anonymous_id',
    {
      why: 'Holds the per-event keyed id (evk1_ + HMAC), never the ose_anon cookie value.',
      ref: 'PR #860 (forms migration 0016, lib/event-anon-key.ts)',
    },
  ],
  [
    'FORMS_DB.form_surveys.anonymous_id',
    {
      why: 'Holds the per-event keyed id (evk1_ + HMAC), never the ose_anon cookie value.',
      ref: 'PR #860 (forms migration 0016, lib/event-anon-key.ts)',
    },
  ],
  [
    'FORMS_DB.email_signups.anonymous_id',
    {
      why: 'Holds the per-event keyed id (evk1_ + HMAC), never the ose_anon cookie value.',
      ref: 'PR #860 (forms migration 0016, lib/event-anon-key.ts)',
    },
  ],
  [
    'FORMS_DB.checkin_counts.last_anonymous_id',
    {
      why: 'Holds the per-event keyed id (evk1_ + HMAC), never the ose_anon cookie value.',
      ref: 'PR #860 (forms migration 0016, lib/event-anon-key.ts)',
    },
  ],
  [
    'FORMS_DB.form_registrations.attendee_name',
    {
      why: 'Legacy cleartext column: new writes bind NULL (forms migration 0014); old rows age out.',
      ref: 'OSE-1685 (drop the column)',
    },
  ],
]);

export const exemptionKey = (c: SchemaColumn): string => `${c.binding}.${c.table}.${c.column}`;

/**
 * The PII column rule (OSE-1660), in both databases: a column that identifies a
 * person is stored hashed or encrypted, or it is a reviewed exemption.
 */
export function piiColumnViolations(columns: readonly SchemaColumn[]): string[] {
  const out: string[] = [];
  for (const c of columns) {
    const classes = classifyColumn(c.column);
    if (classes.length === 0) continue;
    if (isProtectedForm(c.column)) continue;
    if (IDENTITY_EXEMPTIONS.has(exemptionKey(c))) continue;
    out.push(`${exemptionKey(c)} (${classes.join(', ')})`);
  }
  return out;
}

/** What may never sit in the anonymous DB, hashed or not: who a person is. */
const WALL_CLASSES: ReadonlySet<IdentityClass> = new Set(['email', 'phone', 'person-name']);

/**
 * The two-database wall (OSE-1661): no column in the anonymous DB says who a
 * person is (an email, a phone number or a person's name), in any form, unless
 * it is a reviewed exemption. Hashing does not lift this: a peppered email
 * hash is still a stable key to one named person.
 */
export function dbWallViolations(columns: readonly SchemaColumn[]): string[] {
  const out: string[] = [];
  for (const c of columns) {
    if (c.binding !== 'DB') continue;
    const classes = classifyColumn(c.column).filter((k) => WALL_CLASSES.has(k));
    if (classes.length === 0) continue;
    if (IDENTITY_EXEMPTIONS.has(exemptionKey(c))) continue;
    out.push(`${exemptionKey(c)} (${classes.join(', ')})`);
  }
  return out;
}

/** Exemptions that no longer name a column in the schema. */
export function staleExemptions(columns: readonly SchemaColumn[]): string[] {
  const present = new Set(columns.map(exemptionKey));
  return [...IDENTITY_EXEMPTIONS.keys()].filter((k) => !present.has(k));
}

/** Every column of every user table in one binding, read from the live schema. */
export async function readSchemaColumns(
  db: D1Database,
  binding: SchemaColumn['binding']
): Promise<SchemaColumn[]> {
  const tables = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
         AND name NOT LIKE 'd1_%'
       ORDER BY name`
    )
    .all<{ name: string }>();
  const out: SchemaColumn[] = [];
  for (const { name: table } of tables.results ?? []) {
    const cols = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    for (const { name: column } of cols.results ?? []) out.push({ binding, table, column });
  }
  return out;
}
