/**
 * INVARIANT: an anonymous vote is a counter on an object, never a row about a voter
 *
 * OSE ADR-040 (accepted by the owner, 2026-11-18), decisions 1, 4 and 7, and
 * AGENTS.md invariants 1 and 2. Story: OSE-2125 (S2 of OSE-1193).
 *
 * The vote tables are made by migration 0111. Their names are read from
 * workers/oursharedevents/src/lib/votes.ts (VOTE_TABLES), not restated here, so a
 * table added to that list joins every check below by being listed.
 *
 * What this L0 gate holds, from the migration files and the Worker source:
 *
 *   1. DB ONLY. Every vote table is created in migrations/ (DB, the anonymous
 *      side). No migrations-forms/ file names one, and no Worker file names both
 *      FORMS_DB and a vote table.
 *   2. NO VOTER. No column on a vote table, in any migration, is about a voter
 *      or a browser: voter, anon, session, snk, cookie, device, ip, user, k. The
 *      counter and marker tables hold no time at all, and a receipt holds no side.
 *   3. NOT IN AN EXPORT. No exporter (a file that sends rows to BigQuery, backs
 *      events up, or is an export or data-subject module) names a vote table.
 *   4. EVERY READER IS LISTED. A Worker file that names a vote table is on
 *      VOTE_TABLE_FILES with its reason. An entry that no longer matches fails.
 *   5. FINAL IS ONE-WAY (ADR-040 decision 4, Q10). No SQL in the Worker or a
 *      migration sets is_final to anything but the literal 1, and no code
 *      replaces or deletes a vote set, which would bring back a fresh one.
 *   6. T AND V STAY SECRET (decision 7). The secret margin and the secret floor
 *      (secret_margin, secret_floor) are named only by files on SECRET_READERS,
 *      never by a route handler, never on a line that logs or answers, and no
 *      code reads a vote set with `SELECT *` or `vote_sets.*`.
 *   7. SEPARATE KEYS (decision 1). Every HKDF label in the Worker is used once,
 *      and the three vote marker labels exist and differ from the scan key's.
 *
 * Pyramid coverage:
 *   L0 STRUCTURAL (this file), in the T0 invariants step.
 *   L1 workers pool: workers/oursharedevents/tests/vote-tables.spec.ts reads the
 *      built schema and writes rows (one set per event, T and V ranges, final
 *      nulls T and V, marker shape, WITHOUT ROWID, one team marker per voter).
 *   L2 staging: bruno/ose-api/2. Public Events API, "OSE-2125 | public event |
 *      the answer carries no vote field".
 *
 * Classification: STRUCTURAL (readFileSync only, no deployed worker).
 *
 * @born-red OSE-2125 | method: injected-fault, each removed after: a
 *   `voter_hash` column in 0111 (2 red), the migration moved to
 *   migrations-forms/ (1 red), `vote_tallies` read in handlers/bigquery.ts
 *   (3 and 4 red), `UPDATE vote_sets SET is_final = 0` in a lib file (5 red),
 *   a handler answering `secret_margin` (6 red) | date: 2026-11-18
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_DIR = join(REPO_ROOT, 'workers', 'oursharedevents');
const DB_MIGRATIONS = join(WORKER_DIR, 'migrations');
const FORMS_MIGRATIONS = join(WORKER_DIR, 'migrations-forms');
const SRC_DIR = join(WORKER_DIR, 'src');
const VOTES_LIB = 'src/lib/votes.ts';

/**
 * Every Worker file that names a vote table, and why. A route story (S3, S4a,
 * S5) adds its own file here, in the same change, with its reason.
 */
const VOTE_TABLE_FILES: Record<string, string> = {
  [VOTES_LIB]: 'The table list itself (VOTE_TABLES), read by the gates. It holds no SQL.',
};

/**
 * Files that may name the secret margin or the secret floor. Empty: nothing
 * draws or reads them yet. S3 (draw at the first open) and S5 (read at final)
 * add their own lib file here; a handler can never be listed.
 */
const SECRET_READERS: Record<string, string> = {};

const SECRET_COLUMNS = ['secret_margin', 'secret_floor'];
const MARKER_AND_COUNTER_TABLES = [
  'vote_tallies',
  'vote_receipts',
  'vote_participants',
  'vote_team_markers',
];

const VOTER_WORDS = new Set([
  'voter',
  'voters',
  'anon',
  'anonymous',
  'session',
  'snk',
  'cookie',
  'browser',
  'device',
  'agent',
  'ip',
  'fingerprint',
  'user',
  'person',
  'k',
]);
const TIME_WORDS = new Set(['at', 'time', 'date', 'day', 'hour', 'stamp', 'ts', 'clock', 'when']);
const SIDE_WORDS = new Set(['side', 'up', 'down', 'direction', 'choice', 'value']);

const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|js|mjs|html)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (path: string) => relative(WORKER_DIR, path).replace(/\\/g, '/');

function migrations(dir: string): { file: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), 'utf8') }));
}

/** Drop `-- ...` SQL comments. */
const stripSql = (sql: string) => sql.replace(/--[^\n]*/g, '');

/** Drop `//` and block comments from TypeScript, keeping strings intact enough for a name search. */
const stripTs = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** The text inside the parenthesis that opens at `open`. */
function parenBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`unbalanced parenthesis at ${open}`);
}

/** Split on commas at depth 0. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

interface DdlColumn {
  table: string;
  column: string;
  file: string;
}

/** Every column any migration gives a table: CREATE TABLE and ALTER TABLE ... ADD COLUMN. */
function ddlColumns(sqlFiles: { file: string; sql: string }[]): DdlColumn[] {
  const out: DdlColumn[] = [];
  for (const { file, sql } of sqlFiles) {
    const text = stripSql(sql);
    for (const m of text.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(/gi
    )) {
      const body = parenBody(text, m.index + m[0].length - 1);
      for (const part of splitTop(body)) {
        const first = part.split(/\s+/)[0].replace(/["`]/g, '');
        if (/^(?:CHECK|PRIMARY|UNIQUE|FOREIGN|CONSTRAINT)$/i.test(first)) continue;
        out.push({ table: m[1], column: first, file });
      }
    }
    for (const m of text.matchAll(
      /ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+(?:COLUMN\s+)?["`]?(\w+)/gi
    )) {
      out.push({ table: m[1], column: m[2], file });
    }
  }
  return out;
}

/** The vote table names, read from VOTE_TABLES in the Worker's own module. */
function voteTables(): string[] {
  const src = readFileSync(join(WORKER_DIR, VOTES_LIB), 'utf8');
  const m = src.match(/export const VOTE_TABLES = \[([\s\S]*?)\] as const/);
  if (!m) throw new Error(`VOTE_TABLES not found in ${VOTES_LIB}`);
  return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
}

const nameRe = (names: string[]) => new RegExp(`\\b(?:${names.join('|')})\\b`);

/** Files that send rows out: BigQuery, a backup, an export or a data-subject answer. */
function isExporter(file: string, src: string): boolean {
  if (file === 'src/cloud/bigquery.ts') return true;
  if (/\b(?:bigQueryInsertRows|bigQueryInsertRowsToDataset|backupEvents)\s*\(/.test(src))
    return true;
  return /export|backup|data-subject|bigquery/i.test(file);
}

/** Every value SQL assigns to is_final, with where it is. */
function finalAssignments(src: string): string[] {
  return [...src.matchAll(/\bis_final\s*=\s*([^\s,;)`'"]+)/gi)].map((m) => m[1]);
}

/** SQL that would bring back a fresh vote set: a replace or a delete. */
const REPLACES_SET =
  /\b(?:REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO|DELETE\s+FROM)\s+["`]?vote_sets\b/i;

/** A line that logs or answers. */
const LOGS_OR_ANSWERS = /\bconsole\.|\blog\w*\(|\bjson\(|new\s+Response\(|Response\.json\(/;

const SOURCES = walk(SRC_DIR).map((path) => {
  const raw = readFileSync(path, 'utf8');
  return { file: rel(path), raw, code: stripTs(raw) };
});

test.describe('Invariant: votes never who (OSE ADR-040, OSE-2125)', () => {
  const tables = voteTables();
  const dbSql = migrations(DB_MIGRATIONS);
  const formsSql = migrations(FORMS_MIGRATIONS);
  const dbCols = ddlColumns(dbSql);

  test('OSE-2125 | gate | it reads the six vote tables and the live sources', () => {
    expect(tables).toEqual([
      'vote_sets',
      'votable_objects',
      'vote_tallies',
      'vote_receipts',
      'vote_participants',
      'vote_team_markers',
    ]);
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(dbSql.length).toBeGreaterThan(100);
  });

  test('OSE-2125 | db-only | every vote table is made in migrations/ and none in migrations-forms/', () => {
    const made = new Set(dbCols.map((c) => c.table));
    expect(
      tables.filter((t) => !made.has(t)),
      'a vote table no DB migration makes'
    ).toEqual([]);
    const inForms = formsSql
      .filter(({ sql }) =>
        nameRe([...tables, 'vote\\w*', 'votable\\w*', 'tally\\w*', 'ballot\\w*']).test(
          stripSql(sql)
        )
      )
      .map((m) => m.file);
    expect(inForms, 'a FORMS_DB migration names a vote table').toEqual([]);
    const crossing = SOURCES.filter(
      ({ code }) => /\bFORMS_DB\b/.test(code) && nameRe(tables).test(code)
    ).map((s) => s.file);
    expect(crossing, 'a Worker file names FORMS_DB and a vote table').toEqual([]);
  });

  test('OSE-2125 | never-who | no voter, anon, session, snk or cookie column on a vote table', () => {
    const found = dbCols
      .filter((c) => tables.includes(c.table))
      .filter((c) => words(c.column).some((w) => VOTER_WORDS.has(w)))
      .map((c) => `${c.table}.${c.column} (${c.file})`);
    expect(found, 'A vote table holds counters and keyed markers, never a voter.').toEqual([]);
  });

  test('OSE-2125 | never-who | the counter and marker tables hold no time, and a receipt no side', () => {
    const cols = dbCols.filter((c) => MARKER_AND_COUNTER_TABLES.includes(c.table));
    expect(
      cols
        .filter((c) => words(c.column).some((w) => TIME_WORDS.has(w)))
        .map((c) => `${c.table}.${c.column}`),
      'a time column on a counter or marker table'
    ).toEqual([]);
    expect(
      cols
        .filter((c) => c.table !== 'vote_tallies')
        .filter((c) => words(c.column).some((w) => SIDE_WORDS.has(w)))
        .map((c) => `${c.table}.${c.column}`),
      'a side on a receipt or marker'
    ).toEqual([]);
  });

  test('OSE-2125 | export | no exporter names a vote table', () => {
    const exporters = SOURCES.filter(({ file, code }) => isExporter(file, code));
    expect(exporters.length, 'expected to find the exporters').toBeGreaterThanOrEqual(3);
    const leaking = exporters.filter(({ code }) => nameRe(tables).test(code)).map((s) => s.file);
    expect(leaking, 'Vote tables never leave OSE: not to BigQuery, a backup or an export.').toEqual(
      []
    );
  });

  test('OSE-2125 | readers | every Worker file that names a vote table is listed', () => {
    const naming = SOURCES.filter(({ code }) => nameRe(tables).test(code)).map((s) => s.file);
    expect(
      naming.filter((f) => !(f in VOTE_TABLE_FILES)),
      'Add the file to VOTE_TABLE_FILES with the reason it reads or writes a vote table.'
    ).toEqual([]);
    expect(
      Object.keys(VOTE_TABLE_FILES).filter((f) => !naming.includes(f)),
      'Stale VOTE_TABLE_FILES entries: remove them so the list only says what is true.'
    ).toEqual([]);
    expect(
      Object.entries(VOTE_TABLE_FILES).filter(([, why]) => why.trim().length < 30),
      'Each entry needs a reason someone can check'
    ).toEqual([]);
  });

  test('OSE-2125 | final | a final set cannot be un-finalized by any SQL path in the code', () => {
    const bad: string[] = [];
    for (const { file, code } of SOURCES) {
      for (const v of finalAssignments(code)) if (v !== '1') bad.push(`${file}: is_final = ${v}`);
      if (REPLACES_SET.test(code)) bad.push(`${file}: replaces or deletes a vote set`);
    }
    for (const { file, sql } of dbSql) {
      // Writes only: 0111's CHECKs say `is_final = 0` and declare, not assign.
      const writes = stripSql(sql)
        .split(';')
        .filter((s) => /^\s*(?:UPDATE|INSERT|REPLACE)\b/i.test(s));
      for (const s of writes) {
        for (const v of finalAssignments(s))
          if (v !== '1') bad.push(`migrations/${file}: is_final = ${v}`);
      }
      if (REPLACES_SET.test(stripSql(sql)))
        bad.push(`migrations/${file}: replaces or deletes a vote set`);
    }
    expect(
      bad,
      'is_final only ever becomes 1, as the literal 1. A final set never reopens (ADR-040 decision 4, Q10).'
    ).toEqual([]);
  });

  test('OSE-2125 | secret | no route returns T or V, and no log line carries them', () => {
    const naming = SOURCES.filter(({ code }) => nameRe(SECRET_COLUMNS).test(code)).map(
      (s) => s.file
    );
    expect(
      naming.filter((f) => !(f in SECRET_READERS)),
      'Only a file on SECRET_READERS may name secret_margin or secret_floor.'
    ).toEqual([]);
    expect(
      Object.keys(SECRET_READERS).filter(
        (f) => /(?:^|\/)handlers\//.test(f) || f.endsWith('router.ts')
      ),
      'A route handler can never read T or V.'
    ).toEqual([]);
    const logged = SOURCES.flatMap(({ file, code }) =>
      code
        .split('\n')
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => nameRe(SECRET_COLUMNS).test(line) && LOGS_OR_ANSWERS.test(line))
        .map(({ at }) => at)
    );
    expect(logged, 'A line names T or V and logs or answers.').toEqual([]);
    const starred = SOURCES.filter(({ code }) =>
      /SELECT\s+\*\s+FROM\s+["`]?vote_sets\b|\bvote_sets\.\*/i.test(code)
    ).map((s) => s.file);
    expect(starred, 'Read a vote set by named columns, never with a star.').toEqual([]);
  });

  test('OSE-2125 | keys | every HKDF label is used once, and the vote labels are not the scan key', () => {
    const labels = SOURCES.flatMap(({ code }) =>
      [...code.matchAll(/=\s*'(ose:[a-z0-9:-]+:v\d+)'/g)].map((m) => m[1])
    );
    expect(labels.length - new Set(labels).size, `a label is reused: ${labels.join(', ')}`).toBe(0);
    const vote = labels.filter((l) => l.startsWith('ose:vote:'));
    expect(vote.sort()).toEqual([
      'ose:vote:participant:v1',
      'ose:vote:receipt:v1',
      'ose:vote:team-marker:v1',
    ]);
    expect(labels).toContain('ose:scan:node-key:v1');
  });

  test('OSE-2125 | gate | the detectors see what they are for (negative controls)', () => {
    const planted = ddlColumns([
      {
        file: 'x.sql',
        sql: `CREATE TABLE IF NOT EXISTS vote_receipts (
          object_id TEXT NOT NULL, -- a comment, with a comma
          receipt TEXT NOT NULL CHECK (length(receipt) = 64),
          voter_hash TEXT,
          PRIMARY KEY (object_id, receipt)
        ) WITHOUT ROWID;
        ALTER TABLE vote_receipts ADD COLUMN side TEXT;`,
      },
    ]).map((c) => c.column);
    expect(planted).toEqual(['object_id', 'receipt', 'voter_hash', 'side']);
    expect(words('voter_hash').some((w) => VOTER_WORDS.has(w))).toBe(true);
    expect(words('pepper_epoch').some((w) => VOTER_WORDS.has(w))).toBe(false);
    expect(finalAssignments('UPDATE vote_sets SET is_final = 0, x = 1')).toEqual(['0']);
    expect(finalAssignments('UPDATE vote_sets SET is_final = ? WHERE id = ?')).toEqual(['?']);
    expect(finalAssignments('UPDATE vote_sets SET is_final = 1, final_at = ?')).toEqual(['1']);
    expect(REPLACES_SET.test('INSERT OR REPLACE INTO vote_sets (id) VALUES (?)')).toBe(true);
    expect(REPLACES_SET.test('DELETE FROM vote_sets WHERE id = ?')).toBe(true);
    expect(REPLACES_SET.test('INSERT INTO vote_sets (id, event_id) VALUES (?, ?)')).toBe(false);
    expect(isExporter('src/handlers/bigquery.ts', '')).toBe(true);
    expect(isExporter('src/lib/x.ts', 'await bigQueryInsertRows(env, rows)')).toBe(true);
    expect(isExporter('src/lib/votes.ts', '')).toBe(false);
    expect(LOGS_OR_ANSWERS.test('return json({ margin: row.secret_margin })')).toBe(true);
    expect(LOGS_OR_ANSWERS.test("console.log('T', secret_margin)")).toBe(true);
  });
});
