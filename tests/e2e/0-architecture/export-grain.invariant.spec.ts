/**
 * INVARIANT 17 (export-grain leg): nothing finer than a corridor crosses D1 -> BigQuery
 *
 * Brain Invariant #17 (oer_emission_boundary). `oer-emission-boundary.invariant.spec.ts`
 * locks the wrangler.toml bindings; this gate locks the other half of the same
 * boundary: WHAT a row may carry once it is allowed to cross. Until this gate the
 * only enforcement of export grain was `lib/export-geography.ts` and workers-pool
 * tests. A test that passes a fixture row proves that row; it does not notice a new
 * column nobody wrote a fixture for. This gate reads the exporters and the table
 * schemas themselves.
 *
 * THE RULE (ADR-011 rule 4, OSE-616, OSE-1460). Every row sent to BigQuery is at
 * corridor grain (an H3 res-7 cell) or coarser. The finest named place is the
 * corridor. A venue, an address, a coordinate, a placement or a QR token never
 * leaves. The `venue_id` tag is NOT a venue: it is the event id (events_backup,
 * event_series_export) or the sentinel 'corridor-aggregate' (the two aggregates).
 *
 * GATE SHAPE: property-asserting (README "Gate shape"). Nothing here names an
 * exporter or a schema to check:
 *   - exporters   = every file under workers/oursharedevents/src, outside the
 *                   client (cloud/bigquery.ts), that calls bigQueryInsertRows,
 *                   bigQueryInsertRowsToDataset or backupEvents;
 *   - schemas     = every workers/oursharedevents/bigquery/*.schema.json;
 *   - SELECT lists = every SELECT list in a string or template literal of an
 *                   exporter (nested selects, `${CONST}` columns resolved).
 * A new exporter, a new table or a new query is covered the day it is written.
 *
 * WHAT IS FORBIDDEN (names are compared snake_cased and lower-cased, because
 * BigQuery column names are case-insensitive and a camelCase `venueName` is the
 * same leak as `venue_name`):
 *   (1) SUB-CORRIDOR GEOGRAPHY. The runtime guard's SUB_CORRIDOR_KEY
 *       (lib/export-geography.ts), read from source so this gate can never be
 *       weaker than it (a test below parses it and requires every alternative to be
 *       flagged here), plus: h3_index/h3_cell/cell_id, geohash, geom/geometry,
 *       coordinate(s), street(_address), address_line*, zip(_code), postal_code,
 *       poster_id, placement(_*). Any resolution of h3 as a COLUMN name is
 *       forbidden (h3_res7 included: an export row carries `corridor_id`, never the
 *       cell under its own name). One exception, SELECT lists only: `h3_res7` may
 *       be READ, because handlers/bigquery.ts derives corridor_id from it
 *       (canonicalCorridorId(r.h3_res7)). It can never be a schema column.
 *   (2) VENUE GRAIN. A name that identifies or describes a place or a night:
 *       venue_<anything but id> (venue_name, venue_address, venue_slug,
 *       venue_canonical_id ...), where_<anything>, location / location_* / *_location,
 *       place / place_*, google_place_id, event_correlation_id.
 *   (3) `SELECT *` from a table. A star is allowed only when it forwards an explicit
 *       sub-select (`SELECT * FROM ( SELECT a, b ... )`, the returns pager), whose
 *       own list is checked. A SELECT-list interpolation this gate cannot resolve to
 *       a same-file constant fails closed.
 *
 * THE ONLY EXCEPTION, KEY_ALLOWLIST. OSE-1617 (measurement spine, decision A1) will
 * add two identity keys, `venue_canonical_id` and `event_correlation_id`, to the
 * `events_backup` table, for listed events. KEY_ALLOWLIST is the one place that
 * says so. It is EMPTY today, so today either key anywhere fails. OSE-1617 adds the
 * two names to the `events_backup` entry and nothing else. Even then: either key in
 * any other table's schema, in any aggregate export, or in a SELECT list of a file
 * that also writes another table still fails; any other venue-grain name still
 * fails; and the allowlist itself is checked (only `events_backup`, only those two
 * names), so widening it to a third name or a second table is red.
 *
 * LIMITS (what this gate does not see, so a reviewer knows):
 *   - Values, not names. A column called `title` could be filled from a venue. The
 *     value of `venue_id` is checked (below); other columns rest on the
 *     workers-pool specs, which run every emitted row through the schema
 *     (tests/helpers/bigquery-pool-schema.ts: a key with no column is an error), so
 *     row keys are a subset of the schema columns checked here.
 *   - A row built from data read outside an exporter file. All four exporters read
 *     D1 in the same file today; a reader moved to a helper would be invisible.
 *   - The runtime guard itself (assertCorridorGrainRow) is not changed: it must keep
 *     accepting the two keys on events_backup rows, so it does not list venue names.
 *   - Lexing is a small scanner, not a TypeScript parser (like log-redaction): a
 *     quote inside a regex literal can confuse it. The negative controls below fail
 *     loudly if the scanner stops seeing what it should.
 *
 * Pattern reference: log-redaction.invariant.spec.ts (scanner), pii-retention
 * (derived subjects + negative controls), tenant-isolation (triaged exemptions).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_DIR = join(REPO_ROOT, 'workers', 'oursharedevents');
const SRC_DIR = join(WORKER_DIR, 'src');
const SCHEMA_DIR = join(WORKER_DIR, 'bigquery');
const CLIENT_REL = 'cloud/bigquery.ts';
const GEOGRAPHY_REL = 'lib/export-geography.ts';

// ── The forbidden set ───────────────────────────────────────────────────────

/** Geography finer than the res-7 corridor. A superset of the runtime guard (tested). */
const SUB_CORRIDOR_RE =
  /^(h3(_res\d+)?|h3_index|h3_cell|cell|cell_id|lat|lon|lng|latitude|longitude|geohash|geom|geometry|coordinates?|where_address|address|address_line\d*|street(_address)?|zip(_code)?|postal_code|poster_deployment_id|poster_id|placement(_.+)?|qr_token)$/;

/** A place or a night, by name. `venue_id` alone is the event id / sentinel and is not here. */
const VENUE_GRAIN_RE =
  /^(venue_(?!id$).+|where_.+|location(_.+)?|.+_location|place(_.+)?|google_place_id|event_correlation_id)$/;

/** The two identity keys OSE-1617 will add. Only ever allowed through KEY_ALLOWLIST. */
const KEY_NAMES: ReadonlySet<string> = new Set(['venue_canonical_id', 'event_correlation_id']);

/**
 * THE ONLY SANCTIONED EXCEPTION. table -> key names allowed on that table.
 * EMPTY today. OSE-1617 adds, and only adds:
 *
 *   events_backup: ['venue_canonical_id', 'event_correlation_id'],
 *
 * Do not add another table (an aggregate export carrying either key is the leak this
 * gate exists for) or another name (`venue_name`, `address` ... are never allowed).
 * A change here needs the ADR-011 note and the boundary-doc amendment OSE-1617 lists
 * as pre-conditions.
 */
const KEY_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  events_backup: [],
};

/** SELECT lists only: the corridor node may be read (to derive corridor_id), never exported. */
const SELECT_SOURCE_ALLOWED: ReadonlySet<string> = new Set(['h3_res7']);

/**
 * What a `venue_id` property may be set to, per table. The column name is legacy:
 * it holds an event id (events.id; event_series.venue_id joins to events.id) or the
 * aggregate sentinel. A real venue never goes here (OSE-1460, ADR-011 "Neutral").
 */
const VENUE_ID_VALUES_BY_TABLE: Readonly<Record<string, readonly string[]>> = {
  events_backup: ['r.id'],
  event_series_export: ['r.venue_id'],
  corridor_returns_export: ["'corridor-aggregate'"],
  corridor_density_baseline_export: ["'corridor-aggregate'"],
};

/** `r.venue_id` is an event id only while the query joins the series' venue_id to events.id. */
const EVENT_SERIES_EVENT_JOIN = /JOIN\s+events\s+e\s+ON\s+e\.id\s*=\s*es\.venue_id/i;

/** snake_case, lower-case: `venueName`, `Venue-Name` and `VENUE_NAME` are one name. */
function normalizeName(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

type Where = 'schema' | 'select';

/** Why a column/selected name may not cross, or null when it may. */
function forbiddenReason(
  rawName: string,
  where: Where,
  tables: readonly string[],
  allowlist: Readonly<Record<string, readonly string[]>> = KEY_ALLOWLIST
): string | null {
  const name = normalizeName(rawName);
  if (KEY_NAMES.has(name)) {
    const allowed = tables.length > 0 && tables.every((t) => (allowlist[t] ?? []).includes(name));
    return allowed
      ? null
      : `identity key "${name}" is not allowlisted for [${tables.join(', ')}] (KEY_ALLOWLIST)`;
  }
  if (where === 'select' && SELECT_SOURCE_ALLOWED.has(name)) return null;
  if (SUB_CORRIDOR_RE.test(name)) return `"${name}" is sub-corridor geography`;
  if (VENUE_GRAIN_RE.test(name)) return `"${name}" is venue-grain`;
  return null;
}

// ── Source walking and a small scanner (same family as log-redaction) ───────

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function skipQuoted(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === q) return j + 1;
    else if (c === '\n') return j;
    else j++;
  }
  return j;
}

function skipTemplate(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === '`') return j + 1;
    else if (c === '$' && src[j + 1] === '{') j = skipBalanced(src, j + 1);
    else j++;
  }
  return j;
}

/** `src[i]` opens a bracket; the index just past its match (strings, templates, comments skipped). */
function skipBalanced(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    const n = src[j + 1];
    if (c === '/' && n === '/') {
      const nl = src.indexOf('\n', j);
      j = nl === -1 ? src.length : nl;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', j + 2);
      j = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      j = skipQuoted(src, j);
    } else if (c === '`') {
      j = skipTemplate(src, j);
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
      j++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      j++;
      if (depth === 0) return j;
    } else {
      j++;
    }
  }
  return j;
}

/** Remove `//` and block comments (outside strings) so prose cannot trip or hide a name. */
function stripComments(text: string): string {
  let out = '';
  let j = 0;
  while (j < text.length) {
    const c = text[j];
    const n = text[j + 1];
    if (c === '/' && n === '/') {
      const nl = text.indexOf('\n', j);
      j = nl === -1 ? text.length : nl;
    } else if (c === '/' && n === '*') {
      const end = text.indexOf('*/', j + 2);
      j = end === -1 ? text.length : end + 2;
    } else if (c === '"' || c === "'") {
      const e = skipQuoted(text, j);
      out += text.slice(j, e);
      j = e;
    } else if (c === '`') {
      const e = skipTemplate(text, j);
      out += text.slice(j, e);
      j = e;
    } else {
      out += c;
      j++;
    }
  }
  return out;
}

/** Split `text` at depth-0 commas (strings, templates and brackets are opaque). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let j = 0;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'") {
      const e = skipQuoted(text, j);
      cur += text.slice(j, e);
      j = e;
    } else if (c === '`') {
      const e = skipTemplate(text, j);
      cur += text.slice(j, e);
      j = e;
    } else if (c === '(' || c === '[' || c === '{') {
      const e = skipBalanced(text, j);
      cur += text.slice(j, e);
      j = e;
    } else if (c === ',') {
      parts.push(cur);
      cur = '';
      j++;
    } else {
      cur += c;
      j++;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

interface Literal {
  quote: string;
  /** Raw text between the delimiters. A template keeps its `${…}` placeholders. */
  text: string;
}

/** Every top-level string / template literal of comment-stripped source. */
function literalsOf(src: string): Literal[] {
  const out: Literal[] = [];
  let j = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") {
      const e = skipQuoted(src, j);
      out.push({ quote: c, text: src.slice(j + 1, e - 1) });
      j = e;
    } else if (c === '`') {
      const e = skipTemplate(src, j);
      out.push({ quote: c, text: src.slice(j + 1, e - 1) });
      j = e;
    } else j++;
  }
  return out;
}

/** Source with every literal body blanked, so a name in SQL text cannot read as code. */
function codeOnly(src: string): string {
  let out = '';
  let j = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") {
      j = skipQuoted(src, j);
      out += '""';
    } else if (c === '`') {
      j = skipTemplate(src, j);
      out += '""';
    } else {
      out += c;
      j++;
    }
  }
  return out;
}

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/**
 * Length-preserving: literal bodies and `interface X { … }` / `type X = { … }` bodies
 * become spaces, so an index found here is the same index in the original source.
 * `venue_id: string` in a type, or `es.venue_id` in SQL, is then not a value.
 */
function blankLiteralsAndTypes(src: string): string {
  let out = '';
  let j = 0;
  const typeRe = /\b(?:interface\s+\w+[^{;]*|type\s+\w+\s*=\s*)\{/g;
  let nextType = typeRe.exec(src);
  while (j < src.length) {
    while (nextType && nextType.index < j) nextType = typeRe.exec(src);
    if (nextType && nextType.index === j) {
      const e = skipBalanced(src, j + nextType[0].length - 1);
      out += blank(src.slice(j, e));
      j = e;
      nextType = typeRe.exec(src);
      continue;
    }
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') {
      const e = c === '`' ? skipTemplate(src, j) : skipQuoted(src, j);
      out += c + blank(src.slice(j + 1, Math.max(j + 1, e - 1))) + src.slice(e - 1, e);
      j = e;
    } else {
      out += c;
      j++;
    }
  }
  return out;
}

// ── Resolving a same-file constant (for `${CONST}` inside a SELECT list) ────

function constInitializer(src: string, name: string): string | null {
  const m = new RegExp(`\\bconst\\s+${name}\\b[^=;]*=`).exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  let j = start;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") j = skipQuoted(src, j);
    else if (c === '`') j = skipTemplate(src, j);
    else if (c === '(' || c === '[' || c === '{') j = skipBalanced(src, j);
    else if (c === ';') break;
    else j++;
  }
  return src.slice(start, j);
}

/**
 * The words a same-file constant contributes: the text of its string literals
 * (an array of column names, a SQL fragment) plus those of any other same-file
 * constant it refers to. null when `name` is not a const in this file.
 */
function resolveConstText(src: string, name: string, seen = new Set<string>()): string | null {
  if (seen.has(name)) return '';
  seen.add(name);
  const init = constInitializer(src, name);
  if (init === null) return null;
  let text = '';
  for (const lit of literalsOf(init)) {
    text +=
      ' ' +
      lit.text.replace(/\$\{\s*([A-Za-z_]\w*)\s*\}/g, (_m, id: string) => {
        const inner = resolveConstText(src, id, seen);
        return inner === null ? ' ' : ` ${inner} `;
      });
  }
  for (const w of codeOnly(init).match(/[A-Za-z_]\w*/g) ?? []) {
    if (w === name || seen.has(w)) continue;
    const inner = resolveConstText(src, w, seen);
    if (inner !== null) text += ' ' + inner;
  }
  return text;
}

// ── SELECT lists ────────────────────────────────────────────────────────────

interface SelectList {
  /** Text between SELECT and its FROM, sub-selects masked, `${…}` kept. */
  list: string;
  /** True when the FROM source is a parenthesised sub-select. */
  fromSubquery: boolean;
}

function maskSubselects(list: string): string {
  let out = '';
  let j = 0;
  while (j < list.length) {
    const c = list[j];
    if (c === '(') {
      const e = skipBalanced(list, j);
      const inner = list.slice(j, e);
      out += /\bSELECT\b/i.test(inner) ? ' ' : inner;
      j = e;
    } else {
      out += c;
      j++;
    }
  }
  return out;
}

/** Every SELECT list in a SQL text. Each nested SELECT is its own entry. */
function selectLists(sqlRaw: string): SelectList[] {
  const sql = sqlRaw.replace(/--[^\n]*/g, '');
  const out: SelectList[] = [];
  const re = /\bSELECT\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    let j = m.index + m[0].length;
    let depth = 0;
    let list = '';
    let fromSubquery = false;
    while (j < sql.length) {
      const c = sql[j];
      if (c === "'") {
        const e = skipQuoted(sql, j);
        list += "''";
        j = e;
        continue;
      }
      if (c === '$' && sql[j + 1] === '{') {
        const e = skipBalanced(sql, j + 1);
        list += sql.slice(j, e);
        j = e;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      } else if (
        depth === 0 &&
        /^FROM\b/i.test(sql.slice(j, j + 5)) &&
        !/\w/.test(sql[j - 1] ?? ' ')
      ) {
        fromSubquery = sql
          .slice(j + 4)
          .trimStart()
          .startsWith('(');
        break;
      }
      list += c;
      j++;
    }
    out.push({ list: maskSubselects(list), fromSubquery });
  }
  return out;
}

interface ListFindings {
  words: string[];
  stars: string[];
  unresolved: string[];
}

/** The names a SELECT list selects, aliases included; stars and unresolvable `${…}` reported. */
function inspectList(list: string, src: string): ListFindings {
  const unresolved: string[] = [];
  const stars: string[] = [];
  const resolved = list.replace(/\$\{([^}]*)\}/g, (_m, expr: string) => {
    const id = expr.trim();
    const text = /^[A-Za-z_]\w*$/.test(id) ? resolveConstText(src, id) : null;
    if (text === null) {
      unresolved.push(id);
      return ' ';
    }
    return ` ${text} `;
  });
  for (const item of splitTopLevel(resolved)) {
    if (/^\s*(?:\w+\.)?\*\s*$/.test(item)) stars.push(item.trim());
  }
  const words = (resolved.replace(/'[^']*'/g, ' ').match(/[A-Za-z_]\w*/g) ?? []).map((w) => w);
  return { words, stars, unresolved };
}

// ── Derivation: exporters, written tables, schemas ──────────────────────────

const WRITER_CALL = /\b(bigQueryInsertRowsToDataset|bigQueryInsertRows|backupEvents)\s*\(/g;

/** `BACKUP_TABLES = { events: 'events_backup' }` in the client, read from source. */
function backupTables(): Record<string, string> {
  const client = stripComments(readFileSync(join(SRC_DIR, CLIENT_REL), 'utf8'));
  const body = /BACKUP_TABLES\s*=\s*\{([^}]*)\}/.exec(client)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+)\s*:\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

function resolveTable(expr: string, src: string, tables: Record<string, string>): string | null {
  const e = expr.trim();
  const lit = /^'([^']+)'$|^"([^"]+)"$/.exec(e);
  if (lit) return lit[1] ?? lit[2];
  const prop = /^BACKUP_TABLES\.(\w+)$/.exec(e);
  if (prop) return tables[prop[1]] ?? null;
  if (/^[A-Za-z_]\w*$/.test(e)) {
    const init = constInitializer(src, e);
    const l = init === null ? null : /^\s*'([^']+)'\s*$/.exec(init);
    return l ? l[1] : null;
  }
  return null;
}

interface Exporter {
  /** Path relative to src/, forward slashes. */
  file: string;
  /** Comment-stripped source. */
  src: string;
  /** Tables this file writes (resolved from its insert calls). */
  tables: string[];
  /** Insert-call table arguments this scan could not resolve (a failure, not a skip). */
  unresolvedTables: string[];
}

function deriveExporters(): Exporter[] {
  const tableMap = backupTables();
  const out: Exporter[] = [];
  for (const abs of walkTs(SRC_DIR)) {
    const file = relative(SRC_DIR, abs).split('\\').join('/');
    if (file === CLIENT_REL) continue;
    const src = stripComments(readFileSync(abs, 'utf8'));
    const tables = new Set<string>();
    const unresolvedTables: string[] = [];
    let any = false;
    const re = new RegExp(WRITER_CALL.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
      any = true;
      const open = m.index + m[0].length - 1;
      const args = splitTopLevel(src.slice(open + 1, skipBalanced(src, open) - 1));
      if (m[1] === 'backupEvents') {
        tables.add(tableMap.events ?? 'events_backup');
        continue;
      }
      const tableArg = args[m[1] === 'bigQueryInsertRowsToDataset' ? 2 : 1] ?? '';
      const t = resolveTable(tableArg, src, tableMap);
      if (t === null) unresolvedTables.push(tableArg.trim());
      else tables.add(t);
    }
    if (any) out.push({ file, src, tables: [...tables].sort(), unresolvedTables });
  }
  return out;
}

interface SchemaFile {
  table: string;
  columns: string[];
}

function deriveSchemas(): SchemaFile[] {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
    .map((f) => {
      const fields = JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8')) as Array<{
        name: string;
      }>;
      return { table: basename(f, '.schema.json'), columns: fields.map((c) => c.name) };
    });
}

const EXPORTERS = deriveExporters();
const SCHEMAS = deriveSchemas();

/**
 * Every `venue_id` PROPERTY VALUE assigned in code (object literals, quoted key and
 * shorthand included). Keys are located on the blanked source; values are read from
 * the original, so 'corridor-aggregate' stays visible. `<shorthand>` means the value
 * is a variable of the same name, which this gate cannot vouch for.
 */
function venueIdAssignments(src: string): string[] {
  const blanked = blankLiteralsAndTypes(src);
  const hits: Array<{ index: number; valueFrom: number; shorthand: boolean }> = [];
  for (const m of blanked.matchAll(/(?<![\w.])venue_id\s*(:|(?=[,}]))/g)) {
    hits.push({ index: m.index!, valueFrom: m.index! + m[0].length, shorthand: m[1] === '' });
  }
  for (const m of src.matchAll(/(['"])venue_id\1\s*:/g)) {
    hits.push({ index: m.index!, valueFrom: m.index! + m[0].length, shorthand: false });
  }
  return hits
    .sort((x, y) => x.index - y.index)
    .map((h) => {
      if (h.shorthand) return '<shorthand>';
      let j = h.valueFrom;
      while (j < src.length) {
        const c = src[j];
        if (c === '"' || c === "'") j = skipQuoted(src, j);
        else if (c === '`') j = skipTemplate(src, j);
        else if (c === '(' || c === '[' || c === '{') j = skipBalanced(src, j);
        else if (c === ',' || c === '}' || c === ';' || c === ')') break;
        else j++;
      }
      return src.slice(h.valueFrom, j).trim();
    });
}

/** Alternatives of the runtime SUB_CORRIDOR_KEY, optional groups expanded (h3(_res\d+)? -> h3, h3_res9). */
function runtimeGuardNames(): string[] {
  const geo = stripComments(readFileSync(join(SRC_DIR, GEOGRAPHY_REL), 'utf8'));
  const m = /const SUB_CORRIDOR_KEY\s*=\s*\/\^\((.+?)\)\$\/i\s*;/s.exec(geo);
  if (!m) return [];
  const alts: string[] = [];
  let cur = '';
  let depth = 0;
  for (const c of m[1]) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === '|' && depth === 0) {
      alts.push(cur);
      cur = '';
    } else cur += c;
  }
  alts.push(cur);
  const names: string[] = [];
  for (const alt of alts) {
    const opt = /^(.*)\(([^()]*)\)\?(.*)$/.exec(alt);
    if (opt) names.push(opt[1] + opt[3], opt[1] + opt[2].replace('\\d+', '9') + opt[3]);
    else names.push(alt);
  }
  return names;
}

// ── Gate 1: the rule's own machinery has teeth (negative controls) ──────────

test.describe('Invariant 17 (export grain): the rule can see what it is meant to see', () => {
  test('OSE-INV17 | export-grain | derivation | exporters, schemas and SELECT lists are found', () => {
    const files = EXPORTERS.map((e) => e.file);
    expect(files, 'the backup handler must be derived as an exporter').toContain(
      'handlers/bigquery.ts'
    );
    expect(files, 'the SharedReport exporter must be derived as an exporter').toContain(
      'lib/shared-report-export.ts'
    );
    expect(
      SCHEMAS.map((s) => s.table),
      'every table the Worker writes has a schema file; the four known ones must be derived'
    ).toEqual(
      expect.arrayContaining([
        'events_backup',
        'corridor_returns_export',
        'corridor_density_baseline_export',
        'event_series_export',
      ])
    );
    const allLists = EXPORTERS.flatMap((e) =>
      literalsOf(e.src).flatMap((l) => selectLists(l.text))
    );
    expect(
      allLists.length,
      'expected the backup handler (2) and the SharedReport exporter (7+) SELECT lists'
    ).toBeGreaterThanOrEqual(8);
    const words = new Set(allLists.flatMap((l) => inspectList(l.list, '').words));
    for (const w of ['corridor_id', 'uec_code', 'legal_clearance_tier', 'anon_id_hash']) {
      expect(words.has(w), `the SELECT scanner must see "${w}"`).toBe(true);
    }
    const backup = EXPORTERS.find((e) => e.file === 'handlers/bigquery.ts')!;
    const backupWords = literalsOf(backup.src)
      .flatMap((l) => selectLists(l.text))
      .flatMap((l) => inspectList(l.list, backup.src).words);
    for (const w of ['brand_id', 'h3_res7', 'legal_clearance_tier']) {
      expect(
        backupWords,
        `the backup SELECT list is a \${CONST} interpolation; resolving it must reach "${w}"`
      ).toContain(w);
    }
  });

  test('OSE-INV17 | export-grain | derivation | every insert call resolves to a table with a schema', () => {
    const schemaTables = new Set(SCHEMAS.map((s) => s.table));
    for (const e of EXPORTERS) {
      expect(
        e.unresolvedTables,
        `${e.file}: cannot tell which BigQuery table this insert writes (${e.unresolvedTables.join(' | ')}). ` +
          'Pass a string literal or a same-file const, so the grain of that table can be audited.'
      ).toEqual([]);
      expect(e.tables.length, `${e.file}: exporter with no resolved table`).toBeGreaterThan(0);
      for (const t of e.tables) {
        expect(
          schemaTables.has(t),
          `${e.file} writes "${t}" but workers/oursharedevents/bigquery/${t}.schema.json does not exist. ` +
            'A table with no schema file cannot be audited for grain.'
        ).toBe(true);
      }
    }
  });

  test('OSE-INV17 | export-grain | derivation | no other path reaches the BigQuery insert API', () => {
    const offenders: string[] = [];
    for (const abs of walkTs(SRC_DIR)) {
      const file = relative(SRC_DIR, abs).split('\\').join('/');
      if (file === CLIENT_REL || file === 'cloud/config.ts') continue;
      const src = stripComments(readFileSync(abs, 'utf8'));
      if (/\bbigqueryInsert\b|bigquery\.googleapis\.com/.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      'only cloud/bigquery.ts may talk to the insertAll API; another file would write rows this gate never audits'
    ).toEqual([]);
  });

  test('OSE-INV17 | export-grain | runtime guard | this gate flags every name the runtime guard flags', () => {
    const names = runtimeGuardNames();
    expect(
      names.length,
      'could not read SUB_CORRIDOR_KEY from lib/export-geography.ts (renamed or reshaped?): fix the parser'
    ).toBeGreaterThanOrEqual(12);
    for (const n of names) {
      expect(
        forbiddenReason(n, 'schema', ['corridor_returns_export']),
        `runtime guard rejects "${n}" but this gate does not: the gate must never be weaker than the guard`
      ).not.toBeNull();
    }
    const geo = stripComments(readFileSync(join(SRC_DIR, GEOGRAPHY_REL), 'utf8'));
    expect(geo, 'the finest resolution allowed out of the boundary is the res-7 corridor').toMatch(
      /CORRIDOR_H3_RESOLUTION\s*=\s*7\b/
    );
  });

  test('OSE-INV17 | export-grain | allowlist | only the two OSE-1617 keys, only on events_backup', () => {
    for (const [table, names] of Object.entries(KEY_ALLOWLIST)) {
      expect(
        table,
        `KEY_ALLOWLIST names table "${table}": only events_backup may carry the identity keys; an aggregate export carrying either key is the leak this gate exists for`
      ).toBe('events_backup');
      for (const n of names) {
        expect(
          KEY_NAMES.has(n),
          `KEY_ALLOWLIST.${table} lists "${n}": only venue_canonical_id and event_correlation_id may be allowlisted; every other venue-grain name is never allowed`
        ).toBe(true);
      }
    }
  });
});

// ── Gate 1b: the rule, on synthetic input (mutation proof of the mechanism) ──

test.describe('Invariant 17 (export grain): rule mechanics', () => {
  const BOTH = { events_backup: ['venue_canonical_id', 'event_correlation_id'] } as const;
  // These mechanics tests never read the live KEY_ALLOWLIST: when OSE-1617 fills it,
  // they must stay true. The live allowlist is exercised by the schema and SELECT gates.
  const withoutAllowlist = (n: string, where: Where, tables: readonly string[]) =>
    forbiddenReason(n, where, tables, {});

  test('OSE-INV17 | export-grain | rule | names that must be flagged, in any spelling', () => {
    for (const n of [
      'lat',
      'Lon',
      'where_address',
      'h3_res9',
      'h3_res7',
      'H3_RES8',
      'placementId',
      'poster_deployment_id',
      'qr_token',
      'venue_name',
      'venueName',
      'venue_address',
      'venue_canonical_id',
      'event_correlation_id',
      'eventCorrelationId',
      'location',
      'venue_location',
      'location_name',
      'place_name',
      'google_place_id',
      'zip_code',
      'street_address',
    ]) {
      expect(
        withoutAllowlist(n, 'schema', ['events_backup']),
        `"${n}" must be flagged`
      ).not.toBeNull();
    }
  });

  test('OSE-INV17 | export-grain | rule | names that must pass', () => {
    for (const n of [
      'corridor_id',
      'venue_id',
      'id',
      'title',
      'slug',
      'brand_id',
      'uec_code',
      'event_type',
      'people_count',
      'window_30d_count',
      'timezone',
      'regulatory_pool',
      'legal_clearance_tier',
      'exported_at',
    ]) {
      expect(withoutAllowlist(n, 'schema', ['events_backup']), `"${n}" must pass`).toBeNull();
    }
  });

  test('OSE-INV17 | export-grain | rule | h3_res7 may be READ in a SELECT list, never exported', () => {
    expect(withoutAllowlist('h3_res7', 'select', ['events_backup'])).toBeNull();
    expect(withoutAllowlist('h3_res7', 'schema', ['events_backup'])).not.toBeNull();
    expect(withoutAllowlist('h3_res9', 'select', ['events_backup'])).not.toBeNull();
    expect(withoutAllowlist('lat', 'select', ['events_backup'])).not.toBeNull();
  });

  test('OSE-INV17 | export-grain | allowlist | with no allowlist entry, either key fails everywhere', () => {
    for (const k of KEY_NAMES) {
      expect(withoutAllowlist(k, 'schema', ['events_backup'])).not.toBeNull();
      expect(withoutAllowlist(k, 'select', ['events_backup'])).not.toBeNull();
    }
  });

  test('OSE-INV17 | export-grain | allowlist | once OSE-1617 allowlists the keys, only events_backup passes', () => {
    for (const k of KEY_NAMES) {
      expect(
        forbiddenReason(k, 'schema', ['events_backup'], BOTH),
        `${k} on events_backup`
      ).toBeNull();
      for (const aggregate of [
        'corridor_returns_export',
        'corridor_density_baseline_export',
        'event_series_export',
      ]) {
        expect(
          forbiddenReason(k, 'schema', [aggregate], BOTH),
          `${k} on ${aggregate} must still fail`
        ).not.toBeNull();
      }
      expect(
        forbiddenReason(k, 'select', ['events_backup', 'event_series_export'], BOTH),
        `${k} in a file that also writes another table must still fail`
      ).not.toBeNull();
    }
    for (const other of ['venue_name', 'address', 'lat', 'location', 'h3_res9']) {
      expect(
        forbiddenReason(other, 'schema', ['events_backup'], BOTH),
        `${other} must fail even on events_backup with the keys allowlisted`
      ).not.toBeNull();
    }
  });

  test('OSE-INV17 | export-grain | select | lists are cut at their own FROM, nested selects separately', () => {
    const lists = selectLists(
      `SELECT a, COALESCE(x, y) AS z, (SELECT q FROM t2) AS sub FROM t1 WHERE k = 'FROM'
       -- SELECT commented, FROM nothing
       UNION SELECT * FROM (SELECT c, d FROM t3)`
    );
    const words = lists.map((l) => inspectList(l.list, '').words.filter((w) => w !== 'AS'));
    expect(words[0]).toEqual(['a', 'COALESCE', 'x', 'y', 'z', 'sub']);
    expect(words.some((w) => w.join() === 'q')).toBe(true);
    expect(words.some((w) => w.join() === 'c,d')).toBe(true);
    const star = lists.find((l) => inspectList(l.list, '').stars.length > 0)!;
    expect(star.fromSubquery, 'a star forwarding a sub-select is allowed').toBe(true);
    const bare = selectLists('SELECT * FROM events');
    expect(inspectList(bare[0].list, '').stars).toEqual(['*']);
    expect(bare[0].fromSubquery).toBe(false);
    expect(inspectList(selectLists('SELECT COUNT(*) AS n FROM t')[0].list, '').stars).toEqual([]);
  });

  test('OSE-INV17 | export-grain | select | a ${CONST} column list is resolved; an unknown one fails closed', () => {
    const src =
      "const COLS = ['id', 'venue_name'] as const;\nconst LIST = COLS.map((c) => `e.${c}`).join(', ');";
    const lists = selectLists('SELECT ${LIST}, etr.uec_code FROM events e');
    const f = inspectList(lists[0].list, src);
    expect(f.unresolved).toEqual([]);
    expect(f.words).toEqual(expect.arrayContaining(['id', 'venue_name', 'uec_code']));
    const g = inspectList(selectLists('SELECT ${someFn(1)} FROM t')[0].list, src);
    expect(g.unresolved.length).toBe(1);
    const h = inspectList(selectLists('SELECT ${IMPORTED} FROM t')[0].list, src);
    expect(h.unresolved).toEqual(['IMPORTED']);
  });

  test('OSE-INV17 | export-grain | venue_id | values are read from code, not SQL or types', () => {
    const src = [
      'interface Row { venue_id: string; }',
      'const sql = `SELECT es.venue_id, x FROM t JOIN events e ON e.id = es.venue_id`;',
      "const a = { venue_id: 'corridor-aggregate', b: 1 };",
      'const c = { venue_id: r.id };',
      'const d = { ...x, venue_id };',
      "const e = { 'venue_id': r.venue_name };",
    ].join('\n');
    expect(venueIdAssignments(src)).toEqual([
      "'corridor-aggregate'",
      'r.id',
      '<shorthand>',
      'r.venue_name',
    ]);
  });
});

// ── Gate 2: every schema column ─────────────────────────────────────────────

test.describe('Invariant 17 (export grain): BigQuery table schemas', () => {
  for (const schema of SCHEMAS) {
    test(`OSE-INV17 | export-grain | schema | ${schema.table}: no venue-grain or sub-corridor column`, () => {
      expect(schema.columns.length, `${schema.table} schema has no columns`).toBeGreaterThan(0);
      const violations = schema.columns
        .map((c) => ({ c, why: forbiddenReason(c, 'schema', [schema.table]) }))
        .filter((v) => v.why !== null)
        .map((v) => `bigquery/${schema.table}.schema.json column "${v.c}": ${v.why}`);
      expect(
        violations,
        'A column finer than a corridor would let a place, a night or a coordinate cross D1 -> BigQuery ' +
          '(ADR-011 rule 4). Keep the table at corridor grain. The only sanctioned exception is ' +
          'KEY_ALLOWLIST in this spec (the two OSE-1617 keys, on events_backup).'
      ).toEqual([]);
    });
  }

  test('OSE-INV17 | export-grain | schema | corridor_id is a column of every table (the grain the rest hangs on)', () => {
    for (const schema of SCHEMAS) {
      expect(schema.columns, `${schema.table} must carry corridor_id`).toContain('corridor_id');
    }
  });
});

// ── Gate 3: every exporter's SELECT lists and venue_id tag ──────────────────

test.describe('Invariant 17 (export grain): exporters', () => {
  for (const ex of EXPORTERS) {
    test(`OSE-INV17 | export-grain | select | ${ex.file}: no venue-grain or sub-corridor column is selected`, () => {
      const violations: string[] = [];
      for (const lit of literalsOf(ex.src)) {
        for (const sl of selectLists(lit.text)) {
          const f = inspectList(sl.list, ex.src);
          for (const id of f.unresolved) {
            violations.push(
              `SELECT list interpolates \${${id}}, which is not a same-file const this gate can read; ` +
                'define the column list as a const in this file'
            );
          }
          for (const s of f.stars) {
            if (!sl.fromSubquery) {
              violations.push(
                `"${s}" selects every column of a table; list the columns (or forward an explicit sub-select)`
              );
            }
          }
          for (const w of f.words) {
            const why = forbiddenReason(w, 'select', ex.tables);
            if (why) violations.push(`${why}`);
          }
        }
      }
      expect(
        [...new Set(violations)],
        `${ex.file} (writes ${ex.tables.join(', ')}) reads a column an export row must never carry. ` +
          'Select only corridor-grain fields (derive corridor_id from h3_res7). The only sanctioned exception ' +
          'is KEY_ALLOWLIST in this spec.'
      ).toEqual([]);
    });

    test(`OSE-INV17 | export-grain | row guard | ${ex.file}: calls assertCorridorGrainRow`, () => {
      expect(
        /\bassertCorridorGrainRow\s*\(/.test(ex.src),
        `${ex.file} streams rows to BigQuery without the corridor-grain row guard (lib/export-geography.ts)`
      ).toBe(true);
    });

    test(`OSE-INV17 | export-grain | venue_id | ${ex.file}: tag is the event id or 'corridor-aggregate'`, () => {
      const allowed = new Set(ex.tables.flatMap((t) => VENUE_ID_VALUES_BY_TABLE[t] ?? []));
      const bad = venueIdAssignments(ex.src).filter((v) => !allowed.has(v));
      expect(
        bad,
        `${ex.file} sets venue_id to something other than the event id or 'corridor-aggregate' for [${ex.tables.join(', ')}] ` +
          `(allowed: ${[...allowed].join(', ') || 'none'}). venue_id must never carry a real venue (OSE-1460, ADR-011).`
      ).toEqual([]);
      if (allowed.has('r.venue_id')) {
        expect(
          EVENT_SERIES_EVENT_JOIN.test(ex.src),
          `${ex.file}: r.venue_id is an event id only while the query joins es.venue_id to events.id`
        ).toBe(true);
      }
    });
  }

  test('OSE-INV17 | export-grain | venue_id | the tag is seen (negative control)', () => {
    const seen = new Set(EXPORTERS.flatMap((e) => venueIdAssignments(e.src)));
    for (const v of ["'corridor-aggregate'", 'r.id', 'r.venue_id']) {
      expect(seen.has(v), `expected to see venue_id: ${v} in an exporter`).toBe(true);
    }
  });

  test('OSE-INV17 | export-grain | derivation | the gate file is registered where it runs', () => {
    expect(existsSync(join(REPO_ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'))).toBe(
      true
    );
    const wf = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'oursharedevents-ci.yml'),
      'utf8'
    );
    expect(
      wf.includes('tests/e2e/0-architecture/export-grain.invariant.spec.ts'),
      'export-grain.invariant.spec.ts must be in the T0 "Architecture: structural invariants" step'
    ).toBe(true);
  });
});
