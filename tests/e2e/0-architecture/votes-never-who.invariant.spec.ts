/**
 * INVARIANT: an anonymous vote is a counter on an object, never a row about a voter
 *
 * OSE ADR-040 (accepted by the owner, 2026-11-18), decisions 1, 4, 6 and 7, and
 * AGENTS.md invariants 1 and 2. Story: OSE-2125 (S2 of OSE-1193).
 *
 * The vote tables are made by migration 0111. Their names are read from
 * workers/oursharedevents/src/lib/votes.ts (VOTE_TABLES), not restated here, so a
 * table added to that list joins every check below by being listed.
 *
 * What this L0 gate holds, from the migration files, the Worker source, the
 * repo's scripts and its workflows:
 *
 *   1. DB ONLY. Every vote table is created in migrations/ (DB, the anonymous
 *      side). No migrations-forms/ file names one, and no Worker file names both
 *      FORMS_DB and a vote table.
 *   2. NO VOTER. No column on a vote table, in any migration, is about a voter
 *      or a browser: voter, anon, session, snk, cookie, device, ua, ip, user,
 *      token, key, hash, pass, k. The counter and marker tables hold no time,
 *      and a receipt holds no side.
 *   3. NOT IN AN EXPORT. No exporter (a file that sends rows to BigQuery, backs
 *      events up, or is an export or data-subject module) names a vote table.
 *   4. EVERY READER IS LISTED. A Worker file that names a vote table is on
 *      VOTE_TABLE_FILES with its reason. An entry that no longer matches fails.
 *   5. ONE-WAY FLAGS (decisions 4 and 6, Q10). In every SQL statement in the
 *      Worker, the migrations, scripts/ and .github/workflows/:
 *        - a write to vote_sets sets is_final and is_void only to the literal 1,
 *          by plain `column = 1`, never in a tuple or an expression;
 *        - pepper_epoch and played_by are set only by a write whose WHERE says
 *          the column IS NULL (stamped once, never restamped);
 *        - secret_margin and secret_floor are set to a value only by a write
 *          whose WHERE says `pepper_epoch IS NULL`: drawn once, at the first
 *          open, never at a reopen (OSE-2127); setting them to NULL is final's;
 *        - a write that sets a vote set's state to 'open' carries an
 *          `is_final = 0` guard, so a final set never reopens (OSE-2127);
 *        - nothing replaces, upserts, deletes or drops a vote set;
 *        - a write to votable_objects carries an `is_final = 0` guard, so no
 *          object is added to, or reopened in, a final set;
 *        - a write to vote_sets that names its columns through `${...}` fails
 *          closed, because this gate cannot read it.
 *      The database holds the rest: a final set is closed and holds no T or V
 *      (0111's CHECKs, tested in the workers pool).
 *   6. NO NUMBER BEFORE FINAL, NO SECRET EVER (decision 7). T and V
 *      (secret_margin, secret_floor) are named only by files on SECRET_READERS,
 *      never by a route handler. The live counters (counted_votes,
 *      duplicate_votes, refused_votes, up_count, down_count) are named only by
 *      files on COUNT_READERS. No line names a guarded column and logs or
 *      answers; no guarded column is an object key; no statement on a vote
 *      table reads `*` or `alias.*`.
 *   7. SEPARATE KEYS (decision 1). Every `ose:…:vN` HKDF label in the Worker,
 *      in any quote style, appears once; the three vote labels exist and are not
 *      the scan key's.
 *   8. THE PUBLIC READ AND THE SWITCH (OSE-2135, S3c; decisions 5 and 7,
 *      AGENTS.md invariants 4 and 5):
 *        - the open-objects read (src/lib/vote-open-objects.ts) selects only
 *          o.id, o.kind, o.label and o.closes_at, binds the event, and carries
 *          every guard: event live, set open, not final, not void, object open,
 *          window ahead. The final guard is held here because 0111's CHECK
 *          (final means closed) hides its removal from any runtime test;
 *        - its answer object is built field by field: no spread in the read's
 *          files;
 *        - only handlers/vote-objects.ts imports the read, and only router.ts
 *          imports that handler; the route is under /api/v2/vote/, outside
 *          /api/v2/events*, is wrapped in publicReadLimited, and is routed only
 *          when votingEnabled(env);
 *        - no Worker file but lib/voting-switch.ts names VOTING_ENABLED in
 *          code, so "on" has one spelling (S3b and S4a call votingEnabled);
 *        - the display's files (the TV page, its web copy and display-config)
 *          carry no vote word, no vote path and no vote import.
 *
 * What it cannot see: a value carried out by a variable (a listed lib file that
 * returns `row` to a handler). S3 and S5 add workers-pool tests that their
 * responses carry no guarded key.
 *
 * Pyramid coverage:
 *   L0 STRUCTURAL (this file), in the T0 invariants step.
 *   L1 workers pool: workers/oursharedevents/tests/vote-tables.spec.ts reads the
 *      built schema and writes rows.
 *   L2 staging: bruno/ose-api/2. Public Events API, "OSE-2125 | public event |
 *      the answer carries no vote field".
 *
 * Classification: STRUCTURAL (readFileSync only, no deployed worker).
 *
 * @born-red OSE-2125 | method: injected-fault, each removed after: a
 *   `voter_hash` column in 0111 (2 red), a `side` column (2 red), the migration
 *   moved to migrations-forms/ (1 red), `vote_tallies` read in
 *   handlers/bigquery.ts (3 and 4 red), `UPDATE vote_sets SET is_final = 0` in a
 *   lib file (5 red), the same in a script under scripts/ (5 red), an unguarded
 *   INSERT INTO votable_objects (5 red), a handler answering `secret_margin`
 *   (6 red), `up_count` in a lib file (6 red), the team label set to the scan
 *   key's (7 red) | date: 2026-11-18
 */

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_DIR = join(REPO_ROOT, 'workers', 'oursharedevents');
const DB_MIGRATIONS = join(WORKER_DIR, 'migrations');
const FORMS_MIGRATIONS = join(WORKER_DIR, 'migrations-forms');
const SRC_DIR = join(WORKER_DIR, 'src');
const VOTES_LIB = 'src/lib/votes.ts';
const VOTE_SETS_LIB = 'src/lib/vote-sets.ts';
const OPEN_OBJECTS_LIB = 'src/lib/vote-open-objects.ts';
const OPEN_OBJECTS_HANDLER = 'src/handlers/vote-objects.ts';
const SWITCH_LIB = 'src/lib/voting-switch.ts';

/**
 * Every Worker file that names a vote table, and why. A route story (S3, S4a,
 * S5) adds its own file here, in the same change, with its reason.
 */
const VOTE_TABLE_FILES: Record<string, string> = {
  [VOTES_LIB]: 'The table list itself (VOTE_TABLES), read by the gates. It holds no SQL.',
  [VOTE_SETS_LIB]:
    'S3 (OSE-2127): every write to vote_sets and votable_objects: create, open, reopen, close, the final lock and the nightly final job; it makes the tally row with its object and deletes markers at final.',
  [OPEN_OBJECTS_LIB]:
    'S3c (OSE-2135): the public open-objects read. One SELECT of id, kind, label and closes_at from votable_objects, joined to vote_sets for its state, final and void flags only. No write, no counter, no secret (rule 8).',
};

/**
 * Files that may name the secret margin or the secret floor. S3 draws them at
 * the first open; S5 (read at final) adds its own lib file here. A handler can
 * never be listed.
 */
const SECRET_READERS: Record<string, string> = {
  [VOTE_SETS_LIB]:
    'S3 (OSE-2127) writes T and V once, at the first open, and nulls them at final. It never reads them back.',
};

/**
 * Files that may name the live counters. Empty: nothing counts yet. S4a (the
 * vote write) and S5 (results at final) add their own lib file here.
 */
const COUNT_READERS: Record<string, string> = {};

const SECRET_COLUMNS = ['secret_margin', 'secret_floor'];
const COUNT_COLUMNS = [
  'counted_votes',
  'duplicate_votes',
  'refused_votes',
  'up_count',
  'down_count',
];
/** An INSERT that writes a receipt or a marker: the vote route's write (S4a). */
const MARKER_WRITE =
  /\b(?:INSERT|REPLACE)\b[^;]*\bINTO\s+(?:vote_receipts|vote_participants|vote_team_markers)\b/i;

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
  'ua',
  'ip',
  'fingerprint',
  'user',
  'person',
  'token',
  'key',
  'hash',
  'pass',
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

function walk(dir: string, keep: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.wrangler') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, keep));
    else if (keep.test(entry)) out.push(full);
  }
  return out;
}

const relTo = (base: string, path: string) => relative(base, path).replace(/\\/g, '/');

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

/** String and template literals in source that read like SQL. */
function sqlLiterals(code: string): string[] {
  const literals = code.match(/`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g);
  return (literals ?? [])
    .map((l) => l.slice(1, -1))
    .filter((l) => /\b(?:UPDATE|INSERT|REPLACE|DELETE|DROP|SELECT|RETURNING)\b/i.test(l));
}

/**
 * One SQL text with identifier quotes and a `main.` schema removed, spaces
 * folded. A shell or YAML line is not SQL, so its `--flag` is not a comment.
 */
const normalize = (sql: string, sqlComments = true) =>
  (sqlComments ? stripSql(sql) : sql)
    .replace(/["`[\]]/g, '')
    .replace(/\b(?:main|temp)\./gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Why a statement could reopen, revive or restamp a vote set. Empty when it cannot. */
function flagProblems(raw: string, sqlComments = true): string[] {
  const out: string[] = [];
  for (const sql of normalize(raw, sqlComments)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (
      /\b(?:REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO|UPDATE\s+OR\s+REPLACE|DELETE\s+FROM|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+vote_sets\b/i.test(
        sql
      )
    )
      out.push('replaces, deletes or drops a vote set');
    if (/\bINSERT\b[^;]*\bINTO\s+vote_sets\b[^;]*\bON\s+CONFLICT\b/i.test(sql))
      out.push('upserts a vote set');
    const upd = sql.match(
      /\bUPDATE(?:\s+OR\s+\w+)?\s+vote_sets\b(?:\s+AS\s+\w+|\s+\w+)?\s+SET\s+(.*)$/i
    );
    if (upd) {
      const [setPart, where = ''] = upd[1].split(/\bWHERE\b/i);
      if (/\$\{/.test(setPart)) out.push('sets vote_sets columns this gate cannot read (${...})');
      for (const part of splitTop(setPart.replace(/\bRETURNING\b.*$/i, ''))) {
        if (/^\(/.test(part) && /\b(?:is_final|is_void|pepper_epoch|played_by)\b/i.test(part))
          out.push(`sets a one-way column in a tuple: ${part}`);
        if (/\bis_final\b/i.test(part) && !/^is_final\s*=\s*1$/i.test(part))
          out.push(`is_final is not set to the literal 1: ${part}`);
        if (/\bis_void\b/i.test(part) && !/^is_void\s*=\s*1$/i.test(part))
          out.push(`is_void is not set to the literal 1: ${part}`);
        // Any state but the literal 'closed' (a bound `state = ?` included) may
        // open the set, so it needs the final guard (security review L6).
        if (
          /^state\s*=/i.test(part) &&
          !/^state\s*=\s*'closed'$/i.test(part) &&
          !/\bis_final\s*=\s*0\b/i.test(where)
        )
          out.push(`sets a vote set's state without an "is_final = 0" guard: ${part}`);
        for (const col of ['secret_margin', 'secret_floor']) {
          if (
            new RegExp(`^${col}\\s*=`, 'i').test(part) &&
            !new RegExp(`^${col}\\s*=\\s*NULL$`, 'i').test(part) &&
            !/\bpepper_epoch\s+IS\s+NULL\b/i.test(where)
          )
            out.push(`${col} is drawn without a "pepper_epoch IS NULL" guard: ${part}`);
        }
        for (const col of ['pepper_epoch', 'played_by']) {
          if (
            new RegExp(`^${col}\\s*=`, 'i').test(part) &&
            !new RegExp(`\\b${col}\\s+IS\\s+NULL\\b`, 'i').test(where)
          )
            out.push(`${col} is set without a "${col} IS NULL" guard`);
        }
      }
    }
    const obj =
      /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE(?:\s+OR\s+\w+)?|REPLACE\s+INTO)\s+votable_objects\b/i.test(
        sql
      );
    if (obj && !/\bis_final\s*=\s*0\b/i.test(sql))
      out.push('writes votable_objects without an "is_final = 0" guard on its set');
  }
  return out;
}

/** A line that logs or answers. */
const LOGS_OR_ANSWERS = /\bconsole\.|\blog\w*\(|\bjson\(|new\s+Response\(|Response\.json\(/;

/** A statement on a vote table that reads every column. */
const READS_STAR =
  /\bSELECT\s+(?:DISTINCT\s+)?(?:\w+\.)?\*|\bRETURNING\s+(?:\w+\.)?\*|,\s*\w+\.\*/i;

const SOURCES = walk(SRC_DIR, /\.(ts|js|mjs|html)$/).map((path) => {
  const raw = readFileSync(path, 'utf8');
  return { file: relTo(WORKER_DIR, path), raw, code: stripTs(raw) };
});

/** Scripts and workflows: SQL they would send to a database, line by line. */
const OPS_FILES = [
  ...walk(join(REPO_ROOT, 'scripts'), /\.(mjs|js|cjs|ts|sh|sql)$/),
  ...walk(join(WORKER_DIR, 'scripts'), /\.(mjs|js|cjs|ts|sh|sql)$/),
  ...walk(join(REPO_ROOT, '.github', 'workflows'), /\.ya?ml$/),
].map((path) => ({ file: relTo(REPO_ROOT, path), text: readFileSync(path, 'utf8') }));

test.describe('Invariant: votes never who (OSE ADR-040, OSE-2125)', () => {
  const tables = voteTables();
  const dbSql = migrations(DB_MIGRATIONS);
  const formsSql = migrations(FORMS_MIGRATIONS);
  const dbCols = ddlColumns(dbSql);

  test('OSE-2125 | gate | it reads the six vote tables, the sources and the ops files', () => {
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
    expect(OPS_FILES.filter((f) => f.file.startsWith('.github/workflows/')).length).toBeGreaterThan(
      5
    );
    expect(OPS_FILES.filter((f) => f.file.startsWith('scripts/')).length).toBeGreaterThan(20);
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
      for (const sql of sqlLiterals(code))
        for (const p of flagProblems(sql)) bad.push(`${file}: ${p}`);
    }
    for (const { file, sql } of dbSql) {
      for (const p of flagProblems(sql)) bad.push(`migrations/${file}: ${p}`);
    }
    for (const { file, text } of OPS_FILES) {
      if (!/\bvote_sets\b|\bvotable_objects\b/.test(text)) continue;
      for (const line of text.split('\n'))
        for (const p of flagProblems(line, false)) bad.push(`${file}: ${p}`);
    }
    expect(
      bad,
      'is_final and is_void only ever become 1; the epoch and play mode are stamped once; ' +
        'no object joins a final set (ADR-040 decisions 4 and 6, Q10).'
    ).toEqual([]);
  });

  // OSE-2127 (security review M1). ADR-040 decision 1: every set reaches final,
  // so nothing is kept without a bound. In S3, final skips a set that opened
  // (src/lib/vote-sets.ts FINALIZABLE: results arrive with S5), which is safe
  // only while nothing writes a receipt or a marker. The day a Worker file
  // writes one (the vote route, S4a), the nightly job must already make every
  // set final, with its result computed in the same step (S5).
  test('OSE-2127 | final | no receipt or marker is written while final skips a set that opened', () => {
    const writers = SOURCES.filter(({ code }) =>
      sqlLiterals(code).some((sql) => MARKER_WRITE.test(normalize(sql)))
    ).map((s) => s.file);
    const lib = SOURCES.find((s) => s.file === VOTE_SETS_LIB);
    expect(lib, `${VOTE_SETS_LIB} is read`).toBeTruthy();
    const job = lib!.code.match(/\bjob:\s*\([^)]*\)\s*=>\s*`([^`]*)`/)?.[1] ?? '';
    expect(job, 'FINALIZABLE.job is found').not.toBe('');
    const skipsOpened = /pepper_epoch\s+IS\s+NULL/i.test(job);
    expect(
      skipsOpened ? writers : [],
      'A receipt or marker writer exists, but the nightly job still makes final only the sets ' +
        'that never opened (or are void). Widen FINALIZABLE.job to every set and compute the ' +
        'result in the same batch (S5) before, or with, the vote route.'
    ).toEqual([]);
  });

  test('OSE-2125 | secret | no route returns T or V, and no number before final', () => {
    const naming = (cols: string[]) =>
      SOURCES.filter(({ code }) => nameRe(cols).test(code)).map((s) => s.file);
    expect(
      naming(SECRET_COLUMNS).filter((f) => !(f in SECRET_READERS)),
      'Only a file on SECRET_READERS may name secret_margin or secret_floor.'
    ).toEqual([]);
    expect(
      Object.keys(SECRET_READERS).filter(
        (f) => /(?:^|\/)handlers\//.test(f) || f.endsWith('router.ts')
      ),
      'A route handler can never read T or V.'
    ).toEqual([]);
    expect(
      naming(COUNT_COLUMNS).filter((f) => !(f in COUNT_READERS)),
      'Only a file on COUNT_READERS may name a live vote counter (decision 7: none is shown before final).'
    ).toEqual([]);
    const guarded = nameRe([...SECRET_COLUMNS, ...COUNT_COLUMNS]);
    const logged = SOURCES.flatMap(({ file, code }) =>
      code
        .split('\n')
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => guarded.test(line) && LOGS_OR_ANSWERS.test(line))
        .map(({ at }) => at)
    );
    expect(logged, 'A line names a guarded column and logs or answers.').toEqual([]);
    const keyed = SOURCES.filter(({ code }) =>
      new RegExp(`\\b(?:${[...SECRET_COLUMNS, ...COUNT_COLUMNS].join('|')})\\s*:`).test(code)
    ).map((s) => s.file);
    expect(keyed, 'A guarded column is never an object key.').toEqual([]);
    const starred = SOURCES.filter(({ code }) =>
      sqlLiterals(code).some((sql) => nameRe(tables).test(sql) && READS_STAR.test(sql))
    ).map((s) => s.file);
    expect(starred, 'Read a vote table by named columns, never with a star.').toEqual([]);
  });

  test('OSE-2125 | keys | every HKDF label is used once, and the vote labels are not the scan key', () => {
    const labels = SOURCES.flatMap(({ code }) =>
      [...code.matchAll(/['"`](ose:[a-z0-9:-]+:v\d+)['"`]/g)].map((m) => m[1])
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
    expect(words('pass_token').some((w) => VOTER_WORDS.has(w))).toBe(true);
    expect(words('pepper_epoch').some((w) => VOTER_WORDS.has(w))).toBe(false);

    // Every reopen the security review found (2026-11-18) is caught.
    const reopen = [
      'UPDATE vote_sets SET is_final = 0, x = 1 WHERE id = ?',
      'UPDATE vote_sets SET is_final = ? WHERE id = ?',
      'UPDATE vote_sets SET is_final = 1 - is_final WHERE id = ?',
      'UPDATE vote_sets SET is_final = 1 AND 0 WHERE id = ?',
      'UPDATE vote_sets SET "is_final" = 0 WHERE id = ?',
      'UPDATE vote_sets SET (is_final, final_at) = (0, NULL) WHERE id = ?',
      'UPDATE OR REPLACE vote_sets SET state = ? WHERE id = ?',
      'DELETE FROM main.vote_sets WHERE id = ?',
      'DROP TABLE IF EXISTS vote_sets',
      'INSERT OR REPLACE INTO vote_sets (id) VALUES (?)',
      'INSERT INTO vote_sets (id, event_id) VALUES (?, ?) ON CONFLICT (event_id) DO UPDATE SET is_final = 0',
      'UPDATE vote_sets SET is_void = 0, void_reason = NULL WHERE id = ?',
      'UPDATE vote_sets SET pepper_epoch = ? WHERE id = ?',
      'UPDATE vote_sets SET played_by = ? WHERE id = ?',
      'UPDATE vote_sets SET ${col} = ? WHERE id = ?',
      "INSERT INTO votable_objects (id, event_id, set_id, kind, label) VALUES (?, ?, ?, 'song', ?)",
      "UPDATE votable_objects SET state = 'open' WHERE id = ?",
      // OSE-2127: a reopen that redraws T or V, and an open with no final guard.
      "UPDATE vote_sets SET state = 'open', secret_margin = ?, secret_floor = ? WHERE id = ? AND is_final = 0",
      'UPDATE vote_sets SET secret_floor = 12 WHERE id = ?',
      "UPDATE vote_sets SET state = 'open' WHERE event_id = ? AND state = 'closed'",
      'UPDATE vote_sets SET state = ? WHERE id = ?',
    ];
    expect(reopen.filter((sql) => flagProblems(sql).length === 0)).toEqual([]);
    // A shell line: its --command flag is not a SQL comment.
    expect(
      flagProblems(
        `npx wrangler d1 execute DB --remote --command "UPDATE vote_sets SET is_final = 0 WHERE id = 'x'"`,
        false
      )
    ).not.toEqual([]);
    const fine = [
      "UPDATE vote_sets SET is_final = 1, final_at = ?, state = 'closed', secret_margin = NULL, secret_floor = NULL WHERE id = ?",
      "UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch' WHERE id = ?",
      'UPDATE vote_sets SET pepper_epoch = ? WHERE id = ? AND pepper_epoch IS NULL',
      "UPDATE vote_sets SET state = 'open', pepper_epoch = ?, secret_margin = ?, secret_floor = ? WHERE id = ? AND is_final = 0 AND pepper_epoch IS NULL",
      "UPDATE vote_sets SET state = 'open' WHERE event_id = ? AND state = 'closed' AND is_final = 0",
      "UPDATE vote_sets SET state = 'closed' WHERE event_id = ? AND state = 'open'",
      "UPDATE votable_objects SET state = 'open' WHERE id = ? AND set_id IN (SELECT id FROM vote_sets WHERE is_final = 0)",
      'INSERT INTO vote_sets (id, event_id) VALUES (?, ?)',
      'SELECT is_final FROM vote_sets WHERE id = ?',
    ];
    expect(fine.filter((sql) => flagProblems(sql).length > 0)).toEqual([]);

    expect(
      MARKER_WRITE.test('INSERT OR IGNORE INTO vote_receipts (object_id, receipt) VALUES (?, ?)')
    ).toBe(true);
    expect(
      MARKER_WRITE.test('INSERT INTO vote_team_markers (set_id, team_id, marker) SELECT ?, ?, ?')
    ).toBe(true);
    expect(MARKER_WRITE.test('DELETE FROM vote_receipts WHERE object_id = ?')).toBe(false);
    expect(isExporter('src/handlers/bigquery.ts', '')).toBe(true);
    expect(isExporter('src/lib/x.ts', 'await bigQueryInsertRows(env, rows)')).toBe(true);
    expect(isExporter('src/lib/votes.ts', '')).toBe(false);
    expect(LOGS_OR_ANSWERS.test('return json({ margin: row.secret_margin })')).toBe(true);
    expect(LOGS_OR_ANSWERS.test("console.log('T', secret_margin)")).toBe(true);
    for (const sql of [
      'SELECT * FROM vote_sets',
      'SELECT s.* FROM vote_sets s',
      'SELECT e.id, s.* FROM events e JOIN vote_sets s ON s.event_id = e.id',
      'UPDATE vote_tallies SET up_count = up_count + 1 RETURNING *',
    ])
      expect(READS_STAR.test(sql), sql).toBe(true);
    expect(READS_STAR.test('SELECT id, state FROM vote_sets')).toBe(false);
    expect(sqlLiterals("db.prepare('UPDATE vote_sets SET is_final = 1 WHERE id = ?')")).toEqual([
      'UPDATE vote_sets SET is_final = 1 WHERE id = ?',
    ]);
  });
});

/** The words a vote would arrive under on the display (decision 7). */
const DISPLAY_VOTE_WORDS = /vot(?:e|ing|able)|tall(?:y|ies)|ballot|receipt|participant|winner/i;

/** The display's own files: the TV page, its web copy and its config read. */
const DISPLAY_FILES = [
  'workers/oursharedevents/src/templates/display.html',
  'workers/oursharedevents/src/handlers/display-config.ts',
  'web/display/index.html',
];

/** What is wrong with the open-objects read's SQL. Empty when it holds. */
function openReadProblems(sql: string): string[] {
  const out: string[] = [];
  const flat = normalize(sql);
  const select = /^SELECT\s+(.*?)\s+FROM\s+votable_objects\s+o\b/i.exec(flat);
  if (!select) return ['the read does not SELECT ... FROM votable_objects o'];
  const cols = select[1].split(',').map((c) => c.trim());
  if (cols.join(', ') !== 'o.id, o.kind, o.label, o.closes_at')
    out.push(`it selects ${cols.join(', ')}; only o.id, o.kind, o.label, o.closes_at may be read`);
  const guards: [RegExp, string][] = [
    [/\bo\.event_id\s*=\s*\?/i, 'o.event_id = ?'],
    [/\be\.id\s*=\s*\?/i, 'e.id = ?'],
    [/\be\.status\s*=\s*'active'/i, "e.status = 'active'"],
    [/\bs\.state\s*=\s*'open'/i, "s.state = 'open'"],
    [/\bs\.is_final\s*=\s*0\b/i, 's.is_final = 0'],
    [/\bs\.is_void\s*=\s*0\b/i, 's.is_void = 0'],
    [/\bo\.state\s*=\s*'open'/i, "o.state = 'open'"],
    [/\bo\.closes_at\s*>\s*\?/i, 'o.closes_at > ?'],
  ];
  const where = flat.slice(flat.search(/\bWHERE\b/i));
  for (const [re, name] of guards) if (!re.test(where)) out.push(`the WHERE lacks ${name}`);
  return out;
}

/** The router block that serves the read, from its match to its return. */
function routerVoteBlock(code: string): string {
  const from = code.indexOf('const voteObjectsMatch');
  if (from < 0) return '';
  const to = code.indexOf(')(request, env);', from);
  return to < 0 ? '' : code.slice(from, to + 16);
}

/** What is wrong with the router block. Empty when it holds. */
function routerProblems(block: string): string[] {
  if (!block) return ['router.ts has no voteObjectsMatch block'];
  const out: string[] = [];
  const path = /pathname\.match\(\/\^((?:\\\/|[^/])+?)\(/.exec(block)?.[1] ?? '';
  if (!path.startsWith('\\/api\\/v2\\/vote\\/'))
    out.push(`the read's path ${path || '(unreadable)'} is not under /api/v2/vote/`);
  const cond = /if\s*\(([^)]*\([^)]*\)[^)]*|[^)]*)\)\s*\{/.exec(block)?.[1] ?? '';
  if (!/\bvotingEnabled\(env\)/.test(cond))
    out.push('the read is routed without votingEnabled(env) in its condition');
  if (!/return\s+publicReadLimited\(\s*'vote-objects'/.test(block))
    out.push("the read is not returned through publicReadLimited('vote-objects', ...)");
  return out;
}

test.describe('Invariant: the public vote read and the switch (OSE-2135)', () => {
  const byFile = new Map(SOURCES.map((s) => [s.file, s]));

  test('OSE-2135 | read | it selects only id, kind, label and closes_at, with every guard', () => {
    const src = byFile.get(OPEN_OBJECTS_LIB);
    expect(src, `${OPEN_OBJECTS_LIB} exists`).toBeTruthy();
    const sqls = sqlLiterals(src!.code);
    expect(sqls.length, 'the read holds exactly one SQL statement').toBe(1);
    expect(openReadProblems(sqls[0])).toEqual([]);
    expect(READS_STAR.test(sqls[0])).toBe(false);
  });

  test('OSE-2135 | read | its answer is built field by field, never spread from a row', () => {
    for (const file of [OPEN_OBJECTS_LIB, OPEN_OBJECTS_HANDLER]) {
      const src = byFile.get(file);
      expect(src, `${file} exists`).toBeTruthy();
      expect(/\.\.\.\s*[A-Za-z_$]/.test(src!.code), `${file} spreads a value`).toBe(false);
      expect(/Object\.assign\(/.test(src!.code), `${file} copies with Object.assign`).toBe(false);
    }
    expect(byFile.get(OPEN_OBJECTS_LIB)!.code).toMatch(
      /return \{ id: String\(row\.id\), kind: row\.kind as VotableKind, label: String\(row\.label\) \};/
    );
  });

  test('OSE-2135 | read | only its handler imports it, and only the router imports the handler', () => {
    const importers = (mod: string) =>
      SOURCES.filter(({ code }) =>
        new RegExp(`from\\s+['"][./]*[\\w/]*${mod}(?:\\.js)?['"]`).test(code)
      )
        .map((s) => s.file)
        .sort();
    expect(importers('lib/vote-open-objects')).toEqual([OPEN_OBJECTS_HANDLER]);
    expect(importers('handlers/vote-objects')).toEqual(['src/router.ts']);
  });

  test('OSE-2135 | route | under /api/v2/vote/, limited, and routed only when the switch is on', () => {
    const router = byFile.get('src/router.ts')!.code;
    expect(routerProblems(routerVoteBlock(router))).toEqual([]);
    const calls = router.match(/\bhandleVoteObjects\(/g) ?? [];
    expect(calls.length, 'handleVoteObjects is called from one place in the router').toBe(1);
  });

  test('OSE-2135 | switch | only lib/voting-switch.ts names VOTING_ENABLED in code', () => {
    const naming = SOURCES.filter(({ code }) => /\bVOTING_ENABLED\b/.test(code)).map((s) => s.file);
    expect(
      naming,
      'Read the switch with votingEnabled(env) from src/lib/voting-switch.ts, so "on" has one spelling.'
    ).toEqual([SWITCH_LIB]);
  });

  test('OSE-2135 | display | the TV page, its web copy and display-config carry nothing of the vote', () => {
    const bad: string[] = [];
    for (const rel of DISPLAY_FILES) {
      const path = join(REPO_ROOT, rel);
      expect(existsSync(path), `${rel} exists`).toBe(true);
      const code = stripTs(readFileSync(path, 'utf8'));
      if (DISPLAY_VOTE_WORDS.test(code)) bad.push(`${rel}: a vote word`);
      if (/\/api\/v2\/vote\b/.test(code)) bad.push(`${rel}: the vote path`);
      if (/vote-open-objects|vote-objects|vote-sets|lib\/votes\b|voting-switch/.test(code))
        bad.push(`${rel}: a vote import`);
    }
    expect(bad, 'The display shows no vote content (AGENTS.md invariant 5).').toEqual([]);
  });

  test('OSE-2135 | gate | the rules can fail (negative controls)', () => {
    const good = `SELECT o.id, o.kind, o.label, o.closes_at FROM votable_objects o
      JOIN vote_sets s ON s.id = o.set_id AND s.event_id = o.event_id
      WHERE o.event_id = ? AND EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND e.status = 'active')
        AND s.state = 'open' AND s.is_final = 0 AND s.is_void = 0
        AND o.state = 'open' AND o.closes_at IS NOT NULL AND o.closes_at > ? LIMIT ?`;
    expect(openReadProblems(good)).toEqual([]);
    expect(
      openReadProblems(
        good.replace('o.label, o.closes_at', 'o.label, o.closes_at, s.counted_votes')
      ).join()
    ).toMatch(/only o\.id/);
    expect(openReadProblems(good.replace('o.label,', 'o.label, o.group_id,')).join()).toMatch(
      /only o\.id/
    );
    for (const [guard, name] of [
      [' AND s.is_final = 0', 's.is_final = 0'],
      [' AND s.is_void = 0', 's.is_void = 0'],
      ["s.state = 'open' AND ", "s.state = 'open'"],
      [" AND e.status = 'active'", "e.status = 'active'"],
      ["AND o.state = 'open' ", "o.state = 'open'"],
    ])
      expect(openReadProblems(good.replace(guard, '')), name).toContain(`the WHERE lacks ${name}`);

    const block = `const voteObjectsMatch = pathname.match(/^\\/api\\/v2\\/vote\\/([^/]+)\\/objects$/);
  if (voteObjectsMatch && method === 'GET' && votingEnabled(env)) {
    const id = voteObjectsMatch[1];
    return publicReadLimited(
      'vote-objects',
      (req, e: typeof env) => handleVoteObjects(req, e, id),
      PUBLIC_PAGE_MAX
    )(request, env);`;
    expect(routerProblems(routerVoteBlock(block))).toEqual([]);
    expect(routerProblems(routerVoteBlock(block.replace(' && votingEnabled(env)', '')))).toEqual([
      'the read is routed without votingEnabled(env) in its condition',
    ]);
    expect(
      routerProblems(
        routerVoteBlock(
          block.replace('vote\\/([^', 'events\\/([^').replace('\\/vote\\/', '\\/events\\/')
        )
      )
    ).toHaveLength(1);
    expect(
      routerProblems(
        routerVoteBlock(
          block.replace(
            `return publicReadLimited(
      'vote-objects',
      (req, e: typeof env) => handleVoteObjects(req, e, id),
      PUBLIC_PAGE_MAX
    )(request, env);`,
            'return handleVoteObjects(request, env, id); foo)(request, env);'
          )
        )
      )
    ).toEqual(["the read is not returned through publicReadLimited('vote-objects', ...)"]);
    expect(DISPLAY_VOTE_WORDS.test('const panes = ["event", "voting"]')).toBe(true);
    expect(DISPLAY_VOTE_WORDS.test('const panes = ["event", "league"]')).toBe(false);
  });
});
