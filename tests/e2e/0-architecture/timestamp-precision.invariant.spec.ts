/**
 * INVARIANT: No clock finer than the hour on a scan or identity row
 *
 * The scan split tables (migration 0062) took `created_at DEFAULT
 * (datetime('now'))`, and the scan writer also wrote datetime('now') itself. The
 * two rows of one scan then carried the same second, so a join on
 * (event_id, created_at) re-linked WHO to WHERE one scan at a time, for 52 days,
 * until migration 0100 and hourStamp (lib/scan-buffer.ts). Nothing would have
 * caught it. This L0 static gate does.
 *
 * What it reads: every migration in migrations/ and migrations-forms/, replayed
 * in order so a dropped or renamed table is judged by its live shape, plus every
 * SQL write in the Worker source.
 *
 * What it flags, per table.column of a scan or identity table:
 *   default      a column default that reads a clock finer than the hour:
 *                datetime('now') in either quote style, time('now'), unixepoch(),
 *                julianday(), CURRENT_TIMESTAMP, or strftime with a minute or
 *                second format
 *   sql-write    an INSERT/UPDATE that assigns such a clock in SQL
 *   coarse-clock a default or write through any other strftime, date('now') or
 *                CURRENT_DATE. No finer than the hour, so no join key today, but a
 *                format is one edit from second precision, so each must be listed.
 *                It is its own kind so that listing one never excuses a sql-write.
 *   js-clock     a timestamp column bound to `new Date()` / `Date.now()` in the Worker
 *   unresolved   a timestamp column bound to a value this gate cannot trace; it
 *                fails closed, so inline the value rather than listing the column
 *
 * Which tables, and how they were decided:
 *   Identity: every FORMS_DB table, read from migrations-forms/, so a new one
 *   joins the gate by existing.
 *   Scan: a DB table is a scan table when a row, a counter or a stamp in it is
 *   moved by an anonymous visitor's scan, click or display, or is rolled up from
 *   one. SCAN_TABLES is the result of tracing the writes on the /q, /s, share-open
 *   and sponsor display and click paths, then the scheduled rollups they feed.
 *   Not scan: tables only an admin or a job writes, however time-stamped
 *   (admin_audit_log, report_access_log, security_metrics, events, sponsors).
 *   The classification test keeps the list whole: a DB table with a scan-shaped
 *   name or column must be on SCAN_TABLES or on NOT_SCAN_TABLES.
 *
 * Pyramid coverage:
 *   L0 STATIC (this file) — schema defaults and write sites.
 *   L1 IN-PROCESS         — workers/oursharedevents/tests/scan-split-hour-precision.spec.ts
 *                           pins hourStamp and the 0100 clear-out.
 *
 * Pattern reference: scan-path-split.invariant.spec.ts (readFileSync L0 approach).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_DIR = join(REPO_ROOT, 'workers', 'oursharedevents');
const DB_MIGRATIONS = join(WORKER_DIR, 'migrations');
const FORMS_MIGRATIONS = join(WORKER_DIR, 'migrations-forms');
const SRC_DIR = join(WORKER_DIR, 'src');

const SCAN_TABLES = [
  'scan_placement_events', // WHERE, one row per scan on /q
  'scan_node_returns', // WHO, one row per browser-hour on /q
  'anon_id_returns', // keyed returning-browser rows, rolled up from scans
  'scan_aggregates', // event-hour rollup of the two above
  'scan_cell_aggregates', // event-hour-cell rollup of the two above
  'shortlinks', // clicks and last_clicked_at move on /s
  'shortlink_click_daily', // day counter moved on /s
  'share_opens_daily', // day counter moved by opening a shared link
  'sponsor_displays', // one row per sponsor display or click on a public surface
];

/** Scan-shaped by name or column, but no visitor's act moves a row here. */
const NOT_SCAN_TABLES: Record<string, string> = {};

const PENDING_D4 = 'pending owner ruling D4 (OSE-1766)';

type Kind = 'default' | 'sql-write' | 'coarse-clock' | 'js-clock' | 'unresolved';

interface AllowEntry {
  kinds: Kind[];
  reason: string;
  /** The default is dead only while every INSERT binds this column through hourStamp. */
  writerMustBindHourStamp?: boolean;
}

const ALLOWLIST: Record<string, AllowEntry> = {
  // The scan split tables. SQLite cannot alter a default, so 0100 cleared the
  // stored rows and left the 0062 default in the live schema.
  'scan_placement_events.created_at': {
    kinds: ['default', 'coarse-clock'],
    writerMustBindHourStamp: true,
    reason:
      'The 0062 default is still live but never fires: every INSERT binds hourStamp, which the hourStamp test below enforces. The coarse write is the 0100 clear-out, an hour format.',
  },
  'scan_node_returns.created_at': {
    kinds: ['default', 'coarse-clock'],
    writerMustBindHourStamp: true,
    reason:
      'The 0062 default is still live but never fires: every INSERT binds hourStamp, which the hourStamp test below enforces. The coarse write is the 0100 clear-out, an hour format.',
  },

  // Rollups the scheduled materialize job writes. The clock is the job's, not the scan's.
  'anon_id_returns.first_seen_at': {
    kinds: ['js-clock'],
    reason:
      'Stamped with the materialize run time, never the scan time, and written by the scheduled job only (0031).',
  },
  'anon_id_returns.last_seen_at': {
    kinds: ['js-clock'],
    reason:
      'Stamped with the materialize run time, never the scan time, and written by the scheduled job only (0031).',
  },
  'anon_id_returns.computed_at': {
    kinds: ['default', 'js-clock'],
    reason:
      'When the scheduled job computed the row, which says nothing about when anyone scanned.',
  },
  'scan_aggregates.computed_at': {
    kinds: ['default', 'js-clock'],
    reason: 'When the scheduled job computed the rollup; the row holds event-hour counts only.',
  },
  'scan_cell_aggregates.computed_at': {
    kinds: ['default', 'js-clock'],
    reason:
      'When the scheduled job computed the rollup; the row holds event-hour-cell counts only.',
  },

  // Shortlink and sponsor signal. Both open items below are second-precision today
  // and carried here as known, so neither is a silent pass.
  'shortlinks.created_at': {
    kinds: ['default', 'sql-write'],
    reason:
      'When the link was minted. It is not a click stamp, and the row holds no visitor value.',
  },
  'shortlinks.last_clicked_at': {
    kinds: ['sql-write'],
    reason:
      "Open item. One value per code, overwritten by the next click, with no visitor value in the row. Still second-precision on the /s path, so on a quiet code it dates one click. Listed as today's state, not as a ruling.",
  },
  'shortlink_click_daily.day': {
    kinds: ['coarse-clock'],
    reason: "date('now') is the UTC day the click counts under: the grain this table exists at.",
  },
  'sponsor_displays.created_at': {
    kinds: ['default'],
    reason:
      "Open item, collides with OSE-1766 slice 6, which may want this stamp. The default fires on every display and click row, to the second (0102). The row holds no visitor value, and the scan tables it could line up with are hourly. Listed as today's state, not as a ruling.",
  },

  // Forms side: the owner rules on these under D4 (truncate, drop, or keep with a
  // written reason and retention). Today they are exact. Nothing here decides it.
  'form_registrations.created_at': {
    kinds: ['default'],
    reason: `${PENDING_D4}. Exact today, on a row the visitor chose to identify.`,
  },
  'form_registrations.consent_given_at': {
    kinds: ['js-clock'],
    reason: `${PENDING_D4}. Exact today, to the millisecond, as the record of consent.`,
  },
  'form_registrations.expires_at': {
    kinds: ['js-clock'],
    reason: `${PENDING_D4}. Now plus a fixed TTL, so it carries the same instant as created_at: a ruling that truncates only created_at leaves it here.`,
  },
  'form_surveys.created_at': {
    kinds: ['default'],
    reason: `${PENDING_D4}. Exact today, beside a per-event keyed id.`,
  },
  'form_surveys.consent_given_at': {
    kinds: ['js-clock'],
    reason: `${PENDING_D4}. Exact today, to the millisecond, as the record of consent.`,
  },
  'email_signups.created_at': {
    kinds: ['default'],
    reason: `${PENDING_D4}. Exact today, beside a per-event keyed id.`,
  },
  'email_signups.consent_given_at': {
    kinds: ['js-clock'],
    reason: `${PENDING_D4}. Exact today, to the millisecond, as the record of consent.`,
  },
  'email_signups.retention_expires_at': {
    kinds: ['js-clock'],
    reason: `${PENDING_D4}. Now plus a fixed retention, so it carries the same instant as created_at: a ruling that truncates only created_at leaves it here.`,
  },
  'subscribers.created_at': {
    kinds: ['default'],
    reason: `${PENDING_D4}. Exact today, on an identified row.`,
  },
  'checkin_counts.updated_at': {
    kinds: ['default', 'sql-write'],
    reason: `${PENDING_D4}. Not named in D4, but it sits beside last_anonymous_id, so it dates that id's latest check-in to the second.`,
  },

  // Forms-side operations: no person in the row.
  'pii_audit_log.executed_at': {
    kinds: ['default'],
    reason:
      'When a PII lifecycle job ran; the row holds a phase and record counts, never a person.',
  },
  'feature_flags.updated_at': {
    kinds: ['default', 'sql-write'],
    reason: 'When a flag or its seed row changed: operator configuration, never a person.',
  },
};

interface Finding {
  column: string; // table.column
  kind: Kind;
  site: string;
}

/** A clock finer than the hour. `strftime('%Y-%m-%d %H:00:00', ...)` coarsens, so it passes. */
function isFineClock(sql: string): boolean {
  if (/\b(?:datetime|time|unixepoch|julianday)\s*\(\s*(?:['"]now['"]|\))/i.test(sql)) return true;
  if (/\bCURRENT_(?:TIMESTAMP|TIME)\b/i.test(sql)) return true;
  for (const m of sql.matchAll(/\bstrftime\s*\(\s*'([^']*)'/gi)) {
    if (/%[MSfsJTRcX]/.test(m[1].replace(/%%/g, ''))) return true;
  }
  return false;
}

/** Any other clock: an hour or day strftime, date('now'), CURRENT_DATE. Listed, not forbidden. */
function isCoarseClock(sql: string): boolean {
  if (isFineClock(sql)) return false;
  return /\bstrftime\s*\(|\bdate\s*\(\s*(?:['"]now['"]|\))|\bCURRENT_DATE\b/i.test(sql);
}

const stripSqlComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

/** The text between the parenthesis at `open` and its match, comments removed. */
function readParens(text: string, open: number): { inner: string; end: number } {
  let depth = 0;
  let quote = '';
  let inner = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        inner += ch + text[++i];
        continue;
      }
      if (ch === quote) quote = '';
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
      continue;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(') {
      if (depth++ === 0) continue;
    } else if (ch === ')') {
      if (--depth === 0) return { inner, end: i };
    }
    inner += ch;
  }
  throw new Error(`unbalanced parenthesis at offset ${open}`);
}

/** Split on commas at depth 0, ending early at a depth-0 match of `stop`. */
function splitTop(text: string, stop?: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if ('([{'.includes(ch)) {
      depth++;
    } else if (')]}'.includes(ch)) {
      depth--;
    } else if (depth === 0 && ch === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    } else if (depth === 0 && stop && !/\w/.test(text[i - 1] ?? ' ')) {
      stop.lastIndex = i;
      if (stop.test(text)) break;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

interface Column {
  name: string;
  definition: string;
  file: string;
}

/** Replay the migrations of one database in order; returns live table -> columns. */
function replaySchema(dir: string): Map<string, Column[]> {
  const live = new Map<string, Column[]>();
  const ddl =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)|ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+RENAME\s+TO\s+["`]?(\w+)|ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+(?:COLUMN\s+)?([^;]+);/gi;
  for (const file of migrationFiles(dir)) {
    const sql = stripSqlComments(readFileSync(join(dir, file), 'utf8'));
    for (const m of sql.matchAll(ddl)) {
      if (m[1]) {
        const { inner } = readParens(sql, m.index + m[0].length - 1);
        if (live.has(m[1].toLowerCase())) continue; // CREATE TABLE IF NOT EXISTS
        const columns = splitTop(inner)
          .filter((d) => !/^(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(d))
          .map((d) => ({ name: d.match(/^["`]?(\w+)/)![1], definition: d, file }));
        live.set(m[1].toLowerCase(), columns);
      } else if (m[2]) {
        live.delete(m[2].toLowerCase());
      } else if (m[3]) {
        const columns = live.get(m[3].toLowerCase());
        live.delete(m[3].toLowerCase());
        if (columns) live.set(m[4].toLowerCase(), columns);
      } else if (m[5]) {
        const name = m[6].match(/^["`]?(\w+)/)![1];
        live.get(m[5].toLowerCase())?.push({ name, definition: m[6].trim(), file });
      }
    }
  }
  return live;
}

function migrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();
}

interface Assignment {
  column: string;
  value: string;
}

const STOP_FROM = /FROM\b/iy;
const STOP_SET = /(?:WHERE|RETURNING)\b/iy;

function assignmentsFromSet(text: string): Assignment[] {
  return splitTop(text, STOP_SET)
    .map((part) => part.match(/^["`]?(\w+)["`]?\s*=\s*([\s\S]*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ column: m[1], value: m[2] }));
}

/** Every column an INSERT or UPDATE statement assigns. `?` is numbered in text order. */
function parseWrite(
  raw: string
): { op: 'insert' | 'update'; table: string; assignments: Assignment[] } | null {
  let next = 0;
  const sql = raw.replace(/\?(\d*)/g, (_, n: string) => `?${n || ++next}`);
  const insert = sql.match(
    /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO)\s+["`]?(\w+)["`]?\s*/i
  );
  if (insert) {
    const assignments: Assignment[] = [];
    const open = insert[0].length;
    let rest = sql.slice(open);
    if (sql[open] === '(') {
      const { inner, end } = readParens(sql, open);
      const columns = splitTop(inner).map((c) => c.replace(/["`]/g, ''));
      rest = sql.slice(end + 1);
      const values = rest.match(/^\s*VALUES\s*(?=\()/i);
      const select = rest.match(/^\s*SELECT\b/i);
      let items: string[] = [];
      if (values) {
        const tuple = readParens(rest, values[0].length);
        items = splitTop(tuple.inner);
        rest = rest.slice(tuple.end + 1);
      } else if (select) {
        items = splitTop(rest.slice(select[0].length), STOP_FROM);
      }
      columns.forEach((column, i) => {
        if (items[i] !== undefined) assignments.push({ column, value: items[i] });
      });
    }
    const conflict = rest.match(/\bDO\s+UPDATE\s+SET\b/i);
    if (conflict) {
      assignments.push(...assignmentsFromSet(rest.slice(conflict.index! + conflict[0].length)));
    }
    return { op: 'insert', table: insert[1].toLowerCase(), assignments };
  }
  const update = sql.match(/^\s*UPDATE(?:\s+OR\s+\w+)?\s+["`]?(\w+)["`]?\s+SET\b/i);
  if (update) {
    return {
      op: 'update',
      table: update[1].toLowerCase(),
      assignments: assignmentsFromSet(sql.slice(update[0].length)),
    };
  }
  return null;
}

const TIMESTAMP_COLUMN = /(?:_at|_time|_timestamp|^timestamp)$/i;
const JS_CLOCK = /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/;
const JS_LITERAL = /^(?:null|undefined|true|false|\d+|'[^']*'|"[^"]*")$/;

/**
 * Does this bind argument read the wall clock? It follows the names in the
 * expression to their declarations in the file, so `new Date(nowMs)` is traced.
 * null: a bare value from outside the file, which this gate cannot trace.
 */
function bindReadsClock(arg: string, source: string, before: number, depth = 0): boolean | null {
  if (JS_CLOCK.test(arg)) return true;
  if (JS_LITERAL.test(arg)) return false;
  if (depth > 3) return null;
  let traced = false;
  for (const name of arg.match(/(?<![.\w'"])[A-Za-z_]\w*/g) ?? []) {
    const declaration = new RegExp(
      `\\b(?:const|let|var)\\s+${name}\\s*(?::[^=;]+)?=(?!=)\\s*([^;]+);`,
      'g'
    );
    const found = [...source.slice(0, before).matchAll(declaration)].pop();
    if (!found) continue;
    traced = true;
    if (bindReadsClock(found[1].trim(), source, before, depth + 1) === true) return true;
  }
  return traced || !/^\w+(?:\.\w+)*$/.test(arg) ? false : null;
}

function fineDefaultFindings(
  tables: Map<string, Column[]>,
  targets: Set<string>,
  label: string
): Finding[] {
  const findings: Finding[] = [];
  for (const [table, columns] of tables) {
    if (!targets.has(table)) continue;
    for (const { name, definition, file } of columns) {
      const hasDefault = /\bDEFAULT\b/i.test(definition);
      const site = `${label}/${file}`;
      if (hasDefault && isFineClock(definition)) {
        findings.push({ column: `${table}.${name}`, kind: 'default', site });
      } else if (hasDefault && isCoarseClock(definition)) {
        findings.push({ column: `${table}.${name}`, kind: 'coarse-clock', site });
      }
    }
  }
  return findings;
}

/** Writes inside a migration: seed rows, backfills, trigger bodies. */
function migrationWriteFindings(dir: string, targets: Set<string>, label: string): Finding[] {
  const findings: Finding[] = [];
  const start =
    /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?)\s+["`]?\w+/gi;
  for (const file of migrationFiles(dir)) {
    const sql = stripSqlComments(readFileSync(join(dir, file), 'utf8'));
    for (const m of sql.matchAll(start)) {
      const end = sql.indexOf(';', m.index);
      const statement = sql.slice(m.index, end === -1 ? undefined : end);
      const write = parseWrite(statement);
      if (!write || !targets.has(write.table)) continue;
      for (const { column, value } of write.assignments) {
        const key = `${write.table}.${column}`;
        const site = `${label}/${file}`;
        if (isFineClock(value)) findings.push({ column: key, kind: 'sql-write', site });
        if (isCoarseClock(value)) findings.push({ column: key, kind: 'coarse-clock', site });
      }
    }
  }
  return findings;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

/** `const LISTED_NOW_SQL = "strftime(...)"`, so an interpolated clock is still seen. */
function clockConstants(sources: string[]): Map<string, string> {
  const constants = new Map<string, string>();
  for (const source of sources) {
    for (const m of source.matchAll(/\bconst\s+(\w+)\s*=\s*(['"`])((?:(?!\2)[^\n])*)\2/g)) {
      if (isFineClock(m[3]) || isCoarseClock(m[3])) constants.set(m[1], m[3]);
    }
  }
  return constants;
}

/** The end of the string literal opened at `open`. Skips `${...}` in a template. */
function literalEnd(source: string, open: number): number {
  const delimiter = source[open];
  for (let i = open + 1; i < source.length; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === delimiter) return i;
    else if (delimiter === '`' && source[i] === '$' && source[i + 1] === '{') {
      let depth = 1;
      for (i += 2; depth > 0; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
      }
      i--;
    }
  }
  throw new Error(`unterminated string at offset ${open}`);
}

interface SourceWrite {
  op: 'insert' | 'update';
  table: string;
  assignments: Assignment[];
  args: string[] | null; // null: no .bind(...) directly follows the literal
  offset: number;
}

/** Every SQL write whose string literal opens with INSERT, REPLACE or UPDATE. */
function sourceWrites(source: string, constants: Map<string, string>): SourceWrite[] {
  const writes: SourceWrite[] = [];
  const start =
    /[`'"]\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?)\s/gi;
  for (const m of source.matchAll(start)) {
    const close = literalEnd(source, m.index);
    const literal = source
      .slice(m.index + 1, close)
      .replace(/\$\{(\w+)\}/g, (whole, name: string) => constants.get(name) ?? whole);
    const write = parseWrite(literal);
    if (!write) continue;
    const bind = source.slice(close + 1).match(/^\s*,?\s*\)\s*\.bind\(/);
    const args = bind ? splitTop(readParens(source, close + bind[0].length).inner) : null;
    writes.push({ ...write, args, offset: m.index });
  }
  return writes;
}

function sourceFindings(
  file: string,
  source: string,
  constants: Map<string, string>,
  targets: Set<string>
): Finding[] {
  const findings: Finding[] = [];
  for (const { table, assignments, args, offset } of sourceWrites(source, constants)) {
    if (!targets.has(table)) continue;
    const site = `${file}:${source.slice(0, offset).split('\n').length}`;
    for (const { column, value } of assignments) {
      const key = `${table}.${column}`;
      if (isFineClock(value)) findings.push({ column: key, kind: 'sql-write', site });
      if (isCoarseClock(value)) findings.push({ column: key, kind: 'coarse-clock', site });
      if (!TIMESTAMP_COLUMN.test(column)) continue;
      for (const param of value.matchAll(/\?(\d+)/g)) {
        const arg = args?.[Number(param[1]) - 1];
        const reads = !arg || arg.startsWith('...') ? null : bindReadsClock(arg, source, offset);
        if (reads === true) findings.push({ column: key, kind: 'js-clock', site });
        if (reads === null) findings.push({ column: key, kind: 'unresolved', site });
      }
    }
  }
  return findings;
}

interface Scan {
  dbTables: Map<string, Column[]>;
  formsTables: Map<string, Column[]>;
  findings: Finding[];
  writes: { file: string; write: SourceWrite }[];
}

function runScan(): Scan {
  const dbTables = replaySchema(DB_MIGRATIONS);
  const formsTables = replaySchema(FORMS_MIGRATIONS);
  const scanTargets = new Set(SCAN_TABLES);
  const formsTargets = new Set(formsTables.keys());
  const allTargets = new Set([...scanTargets, ...formsTargets]);

  const files = sourceFiles(SRC_DIR).map((path) => ({
    file: relative(WORKER_DIR, path).replace(/\\/g, '/'),
    source: readFileSync(path, 'utf8'),
  }));
  const constants = clockConstants(files.map((f) => f.source));

  const findings = [
    ...fineDefaultFindings(dbTables, scanTargets, 'migrations'),
    ...fineDefaultFindings(formsTables, formsTargets, 'migrations-forms'),
    ...migrationWriteFindings(DB_MIGRATIONS, scanTargets, 'migrations'),
    ...migrationWriteFindings(FORMS_MIGRATIONS, formsTargets, 'migrations-forms'),
    ...files.flatMap(({ file, source }) => sourceFindings(file, source, constants, allTargets)),
  ];
  const writes = files.flatMap(({ file, source }) =>
    sourceWrites(source, constants).map((write) => ({ file, write }))
  );
  return { dbTables, formsTables, findings, writes };
}

test.describe('Invariant: no clock finer than the hour on a scan or identity row (OSE-1778)', () => {
  const scan = runScan();

  test('OSE-1778 | privacy | schema | the gate reads a live schema and every listed scan table exists', () => {
    expect(scan.dbTables.size, 'expected live DB tables from migrations/').toBeGreaterThan(0);
    expect(scan.formsTables.size, 'expected live tables from migrations-forms/').toBeGreaterThan(0);
    expect(
      SCAN_TABLES.filter((t) => !scan.dbTables.has(t)),
      'SCAN_TABLES names a table that is not live in DB'
    ).toEqual([]);
  });

  test('OSE-1778 | privacy | schema | every scan-shaped DB table is classified', () => {
    const scanShaped = (table: string, columns: Column[]): boolean =>
      /^(?:scan|anon)|(?:click|open|display|return|visit|impression)/.test(table) ||
      columns.some((c) =>
        /^(?:anon|session|visitor)|user_agent|ip_hash|^scan_|_scans$|^clicks$|^opens$/.test(c.name)
      );
    const unclassified = [...scan.dbTables]
      .filter(([table, columns]) => scanShaped(table, columns))
      .map(([table]) => table)
      .filter((t) => !SCAN_TABLES.includes(t) && !(t in NOT_SCAN_TABLES));
    expect(
      unclassified,
      'A DB table looks like it holds scan or anonymous behaviour. Add it to SCAN_TABLES, or to NOT_SCAN_TABLES with the reason.'
    ).toEqual([]);
  });

  test('OSE-1778 | privacy | schema+source | no fine clock reaches a scan or identity column unlisted', () => {
    const unlisted = scan.findings
      .filter((f) => !ALLOWLIST[f.column]?.kinds.includes(f.kind))
      .map((f) => `${f.column} [${f.kind}] at ${f.site}`);
    expect(
      [...new Set(unlisted)].sort(),
      'A scan or identity column took a clock finer than the hour. Store the hour bucket (hourStamp), ' +
        'or add table.column to ALLOWLIST with the reason. Second-precision stamps on two rows of one act ' +
        'are a join key (see migration 0100).'
    ).toEqual([]);
  });

  test('OSE-1778 | privacy | allowlist | every entry still matches a finding, and only what it names', () => {
    const stale = Object.entries(ALLOWLIST).flatMap(([column, entry]) =>
      entry.kinds
        .filter((kind) => !scan.findings.some((f) => f.column === column && f.kind === kind))
        .map((kind) => `${column} [${kind}]`)
    );
    expect(stale, 'Stale ALLOWLIST kinds: remove them so the list only shrinks').toEqual([]);
  });

  test('OSE-1778 | privacy | allowlist | every entry carries a written reason', () => {
    const thin = Object.entries(ALLOWLIST)
      .filter(([, entry]) => entry.reason.trim().length < 40)
      .map(([column]) => column);
    expect(thin, 'An ALLOWLIST entry needs a reason someone can check').toEqual([]);
  });

  test('OSE-1778 | privacy | allowlist | the forms-side decision D4 is written down for each column', () => {
    const undecided = [...scan.formsTables].flatMap(([table, columns]) =>
      columns
        .filter((c) => /^(?:created_at|consent_given_at)$/.test(c.name))
        .map((c) => `${table}.${c.name}`)
        .filter((key) => !/\bD4\b/.test(ALLOWLIST[key]?.reason ?? ''))
    );
    expect(
      undecided,
      `Each forms-side created_at and consent_given_at needs an ALLOWLIST reason naming D4: "${PENDING_D4}" until the owner rules, then the ruling.`
    ).toEqual([]);
  });

  test('OSE-1778 | privacy | source | the split-table writers bind created_at through hourStamp', () => {
    const guarded = Object.entries(ALLOWLIST).filter(([, e]) => e.writerMustBindHourStamp);
    expect(guarded.length, 'expected the scan split tables to be guarded').toBeGreaterThan(0);
    for (const [key] of guarded) {
      const [table, column] = key.split('.');
      const writes = scan.writes.filter(
        ({ write }) =>
          write.table === table &&
          (write.op === 'insert' || write.assignments.some((a) => a.column === column))
      );
      expect(writes.length, `expected an INSERT into ${table} in src/`).toBeGreaterThan(0);
      for (const { file, write } of writes) {
        const assigned = write.assignments.find((a) => a.column === column);
        const param = assigned?.value.match(/^\?(\d+)$/);
        const arg = param ? write.args?.[Number(param[1]) - 1] : undefined;
        expect(
          arg ?? '',
          `${file}: a write to ${table} must bind ${column} through hourStamp. If it leaves the ` +
            `column out, the live second-precision default fires (0062, which 0100 could not alter).`
        ).toMatch(/^hourStamp\(/);
      }
    }
  });

  test('OSE-1778 | gate | the detector still sees the two shapes that shipped', () => {
    const targets = new Set(['scan_placement_events']);
    const ddl = `CREATE TABLE scan_placement_events (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`;
    const insert = `db.prepare(\`INSERT OR IGNORE INTO scan_placement_events
      (id, event_id, created_at) VALUES (?, ?, datetime('now'))\`).bind(a, b).run();`;
    const bound = `const nowMs = Date.now();
      const stamp = new Date(nowMs).toISOString();
      db.prepare('INSERT INTO scan_placement_events (id, created_at) VALUES (?, ?)').bind(a, stamp);`;
    const bucketed = `db.prepare('INSERT INTO scan_placement_events (id, created_at) VALUES (?, ?)')
      .bind(a, hourStamp(b));`;
    const interpolated = `db.prepare(\`UPDATE scan_placement_events SET created_at = \${NOW_SQL}\`).run();`;
    const hour = `UPDATE scan_placement_events SET created_at = strftime('%Y-%m-%d %H:00:00', created_at)`;

    expect(isFineClock(ddl)).toBe(true);
    expect(isFineClock('DEFAULT CURRENT_TIMESTAMP')).toBe(true);
    expect(isFineClock(hour)).toBe(false);
    expect(isFineClock('DEFAULT (datetime("now"))')).toBe(true);
    expect(isFineClock('unixepoch()')).toBe(true);
    expect(isCoarseClock(hour)).toBe(true);
    expect(isCoarseClock("date('now')")).toBe(true);
    expect(isCoarseClock(ddl)).toBe(false);
    expect(sourceFindings('x.ts', insert, new Map(), targets).map((f) => f.kind)).toEqual([
      'sql-write',
    ]);
    expect(sourceFindings('x.ts', bound, new Map(), targets).map((f) => f.kind)).toEqual([
      'js-clock',
    ]);
    expect(sourceFindings('x.ts', bucketed, new Map(), targets)).toEqual([]);
    const constants = new Map([['NOW_SQL', "datetime('now')"]]);
    expect(sourceFindings('x.ts', interpolated, constants, targets).map((f) => f.kind)).toEqual([
      'sql-write',
    ]);
  });
});
