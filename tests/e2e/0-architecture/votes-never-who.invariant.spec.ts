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
 *        - a write to vote_sets sets is_final, is_void, flood_seen and burst_seen (OSE-2234)
 *          only to the literal 1, by plain `column = 1`, never in a tuple or
 *          an expression, so a flood once seen is never cleared (no trigger:
 *          D1's remote runner cannot take one, migration 0025);
 *        - room_size (OSE-2234) is set only by a write whose WHERE says
 *          `room_size IS NULL`, so it is written once and never changed;
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
 *      in any quote style, appears once; the five vote labels (receipt,
 *      participant, team marker, and OSE-2133's voter key and pass seal) exist
 *      and are not the scan key's. lib/vote-pass.ts names no `*_CONTEXT`
 *      constant, so it cannot borrow another file's label (the S2 review's L7
 *      remainder).
 *   8. THE PUBLIC READ AND THE SWITCH (OSE-2135, S3c; decisions 5 and 7,
 *      AGENTS.md invariants 4 and 5):
 *        - the open-objects read (src/lib/vote-open-objects.ts) selects only
 *          o.id, o.kind, o.label and o.closes_at, binds the event, and carries
 *          every guard: event live, set open, not final, not void, object open,
 *          window ahead. The final guard is held here because 0111's CHECK
 *          (final means closed) hides its removal from any runtime test;
 *        - it names no table but votable_objects, vote_sets and events: never a
 *          tally, receipt or marker;
 *        - its answer object is built field by field: no spread in the read's
 *          files, and those files never name a cookie or ose_anon;
 *        - only handlers/vote-objects.ts imports the read, and only router.ts
 *          imports that handler; the route is under /api/v2/vote/, outside
 *          /api/v2/events*, is wrapped in publicReadLimited, and is routed only
 *          when votingEnabled(env);
 *        - no Worker file but lib/voting-switch.ts names VOTING_ENABLED in
 *          code, so "on" has one spelling (S3b and S4a call votingEnabled);
 *        - the display's files (the TV page, its web copy and display-config)
 *          carry no vote word, no vote path and no vote import.
 *   9. THE PASS STAYS OUT OF LOGS AND QUERIES (decision 6, OSE-2133). In
 *      handlers/qr-scan.ts and lib/vote-pass.ts, no console call names the
 *      redirect's Location, its target, the pass or the voter key; lib/vote-pass.ts
 *      logs nothing at all. The pass is put after `#t=` and never after `?t=` or
 *      `&t=`.
 *  10. NO NEW COOKIE READER (D3 reversed, 2026-11-18: "Once there is a seam,
 *      it's a way in"). Only the files on COOKIE_READERS read the `Cookie`
 *      header, call getOrCreateAnonId or name `ose_anon`: the reader itself,
 *      `/q` and the forms routes (AGENTS.md invariant 4). The vote route and the
 *      voter page can never be listed.
 *  11. THE ROOM'S OWN CODE AND THE LIVE EVENT (OSE-2140, OSE-2142; owner,
 *      2026-11-18). voteCodeMayMint (lib/vote-sets.ts) checks, in one
 *      statement, that the scanned placement is the event's vote code in use,
 *      the set is open and not final, and the event is live (EVENT_LIVE);
 *      issueVotePass asks it with the scanned placement and reads no set by
 *      itself. Every poster-bundle read of a placement token says
 *      `is_vote_code = 0`, so the public bundle never hands out the vote code's
 *      token. Only lib/vote-code.ts writes `is_vote_code`. Every Worker file
 *      that moves an event's status out of 'active' batches
 *      closeVoteSetUnlessPublished with the move (one transaction), or is
 *      exempt with its reason (STATUS_WRITER_EXEMPT). No D1 trigger: 0025.
 *  12. NO SIDE, NO DUPLICATE AND NO T OR V IN A LOG (OSE-2128 follow-up, H1,
 *      L7, L9). castVote (lib/vote-cast.ts) builds one batch for both sides:
 *      the side appears only where the input is read, where the team marker
 *      to bind is chosen, and in the counter's binds (one SQL text for both
 *      sides); the statement list has no spread, no ternary and is never
 *      changed after it is built, so OPERATION_COST's d1Queries, and the
 *      database's per-query analytics, cannot carry the side. CastOutcome has no `counted` or
 *      `duplicate`, and the vote handler names neither, so the route cannot
 *      tell them apart. On the vote and result path (the vote route and its
 *      lib, the set and result libs, the admin votables and open-objects
 *      handlers, the voter page and its render, and the cost emitter), no
 *      console call names T or V (secret_margin, secret_floor, margin, floor,
 *      their ranges or the draw). The workers pool holds the same through the
 *      Worker's fetch (tests/vote-route.spec.ts, "the logs cannot tell a side").
 *
 * What it cannot see: a value carried out by a variable (a listed lib file that
 * returns `row` to a handler). S3 and S5 add workers-pool tests that their
 * responses carry no guarded key.
 *
 * Pyramid coverage:
 *   L0 STRUCTURAL (this file), in the T0 invariants step.
 *   L1 workers pool: workers/oursharedevents/tests/vote-tables.spec.ts reads the
 *      built schema and writes rows; tests/vote-pass.spec.ts drives /q (OSE-2133).
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
 * @born-red OSE-2133 | method: injected-fault, each removed after: the voter
 *   key label set to SCAN_NODE_KEY_CONTEXT imported from lib/scan-node-key.ts
 *   (7 red: the import, and the label count), a `console.log` of the redirect
 *   target in qr-scan.ts (9 red), a `?t=` pass target (9 red), a console call in
 *   lib/vote-pass.ts (9 red), a getOrCreateAnonId(request) call planted in
 *   handlers/votables.ts (10 red), forms.ts taken off COOKIE_READERS (10 red) |
 *   date: 2026-11-18
 * @born-red OSE-2140 OSE-2142 | method: injected-fault, each removed after:
 *   `d.is_vote_code = 1` dropped from voteCodeMayMint (11 red), `${EVENT_LIVE}`
 *   dropped from it (11 red), issueVotePass back on readVoteSet (11 red), the
 *   bundle's `is_vote_code = 0` dropped (11 red), the close taken out of the
 *   qr-verify batch (11 red), an `is_vote_code` write planted in
 *   handlers/votables.ts (11 red) |
 *   date: 2026-11-18
 * @born-red OSE-2128 | method: injected-fault, each removed after: the team
 *   statement spread in only for an up vote (12 red), teamNight conditioned on
 *   `side === 'up'` (12 red), the team HMAC skipped for "not for me" (12 red),
 *   the two per-side counter texts put back (12 red), `'duplicate'` put back
 *   in CastOutcome (12 red),
 *   a `console.log` of `margin` in openVoteSet (12 red) | date: 2026-11-20
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
const VOTE_PASS_LIB = 'src/lib/vote-pass.ts';
const QR_SCAN = 'src/handlers/qr-scan.ts';
const VOTE_SETS_LIB = 'src/lib/vote-sets.ts';
const OPEN_OBJECTS_LIB = 'src/lib/vote-open-objects.ts';
const OPEN_OBJECTS_HANDLER = 'src/handlers/vote-objects.ts';
const SWITCH_LIB = 'src/lib/voting-switch.ts';
const RESULTS_LIB = 'src/lib/vote-results.ts';
const CAST_LIB = 'src/lib/vote-cast.ts';
const VOTE_HANDLER = 'src/handlers/vote.ts';
const PUBLIC_RESULT_LIB = 'src/lib/vote-public-result.ts';
const VOTE_PAGE_HANDLER = 'src/handlers/vote-page.ts';
const VOTE_PAGE_RENDER = 'src/lib/vote-page-render.ts';
const ACCESS_LIB = 'src/lib/vote-access-pass.ts';
const CROWD_LIB = 'src/lib/vote-crowd.ts';
const VOTE_FLOOD_LIB = 'src/lib/vote-flood.ts';

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
  [CAST_LIB]:
    'S4a (OSE-2128): one vote. One D1 batch inserts the receipt (open checks inside the insert), raises one side counter only when the receipt was new, and inserts the team and participant markers. It answers counted, duplicate or closed, never a number.',
  [RESULTS_LIB]:
    "S5 (OSE-2130): the night's result. Two UPDATEs, run in finalizeVoteSet's batch, that reads the tallies, the team and participant markers, T and V inside SQL and writes only the outcome and the winner's id.",
  [PUBLIC_RESULT_LIB]:
    "S4b (OSE-2129): the voter page's result. Reads outcome, the winner's id, the room check flag and the host's room size (OSE-2234) from a final, non-void vote_sets row, and labels from votable_objects. No write, no counter, no secret.",
  [ACCESS_LIB]:
    "ADR-040 decision 13: the Access Pass. Gives (one INSERT with the cap inside it, against vote_sets), lists, revokes and redeems rows of vote_access_passes, and deletes a final set's passes. It reads no counter and no secret.",
  [CROWD_LIB]:
    "ADR-040 decision 13: the Online Pick. Writes and reads only the vote_crowd_* tables, plus the room set's state and objects' windows; its result UPDATE reads crowd counters, markers, T and V inside SQL. Never a room counter or marker table.",
  [VOTE_FLOOD_LIB]:
    'OSE-2234: the host-only burst alarm. One UPDATE that sets burst_seen to the literal 1 on a set not final and not flagged, touching no other column. No read, no counter, no secret.',
};

/**
 * Files that may name the secret margin or the secret floor. S3 draws them at
 * the first open; S5 (read at final) adds its own lib file here. A handler can
 * never be listed.
 */
const SECRET_READERS: Record<string, string> = {
  [VOTE_SETS_LIB]:
    'S3 (OSE-2127) writes T and V once, at the first open, and nulls them at final. It never reads them back.',
  [RESULTS_LIB]:
    'S5 (OSE-2130) compares the lead with T and the voters with V inside its result UPDATE. Neither leaves the database.',
  [CROWD_LIB]:
    'ADR-040 decision 13: the Online Pick draws its own T and V once, when first turned on, compares them inside its result UPDATE, and nulls them at final. Neither leaves the database.',
};

/**
 * Files that may name the live counters. S5 (results at final) reads them in
 * SQL; S4a (the vote write) adds its own lib file here.
 */
const COUNT_READERS: Record<string, string> = {
  [CAST_LIB]:
    'S4a (OSE-2128) raises up_count or down_count by one inside the vote batch. It reads no counter back.',
  [RESULTS_LIB]:
    'S5 (OSE-2130) reads up_count inside the result UPDATE, to rank objects. No count leaves the database.',
  [CROWD_LIB]:
    "ADR-040 decision 13: raises the Online Pick's own up_count or down_count inside its vote batch, and ranks them inside its result UPDATE. No count leaves the database, and never a room counter.",
};

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
        if (
          /^\(/.test(part) &&
          /\b(?:is_final|is_void|flood_seen|burst_seen|pepper_epoch|played_by|room_size)\b/i.test(
            part
          )
        )
          out.push(`sets a one-way column in a tuple: ${part}`);
        if (/\bis_final\b/i.test(part) && !/^is_final\s*=\s*1$/i.test(part))
          out.push(`is_final is not set to the literal 1: ${part}`);
        if (/\bis_void\b/i.test(part) && !/^is_void\s*=\s*1$/i.test(part))
          out.push(`is_void is not set to the literal 1: ${part}`);
        if (/\bflood_seen\b/i.test(part) && !/^flood_seen\s*=\s*1$/i.test(part))
          out.push(`flood_seen is not set to the literal 1: ${part}`);
        if (/\bburst_seen\b/i.test(part) && !/^burst_seen\s*=\s*1$/i.test(part))
          out.push(`burst_seen is not set to the literal 1: ${part}`);
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
        // room_size (OSE-2234): written once, by the first open, so it needs a
        // "room_size IS NULL" guard; D1's remote runner cannot take a trigger
        // (migration 0025), so this gate is what holds it fixed.
        for (const col of ['pepper_epoch', 'played_by', 'room_size']) {
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

/**
 * The only Worker files that may read the anonymous cookie (OSE-2133; ADR-040
 * decisions 5 and 6; AGENTS.md invariant 4). Adding a file here is the owner's
 * decision: D3 was reversed so that no new route reads `ose_anon`.
 */
const COOKIE_READERS: Record<string, string> = {
  'src/lib/anonymous-id.ts': 'The one place the Cookie header is parsed (getOrCreateAnonId).',
  [QR_SCAN]: '/q: the scan, and the vote pass it mints (invariant 4).',
  'src/handlers/forms.ts': 'The forms routes (invariant 4, owner ruling 2026-10-22).',
};
/** A read of the anonymous cookie, in any form this Worker uses. */
const COOKIE_READ =
  /\.get\(\s*['"`]cookie['"`]\s*\)|['"`]cookie['"`]|\bgetOrCreateAnonId\s*\(|\bose_anon\b|\bdocument\.cookie\b/i;

/** The vote route's log words, for the negative control (OSE-2128). */
const VOTE_WORDS_CONTROL =
  /\b(?:body|object_id|objectId|side|eventId|event_id|pass|claims|k|receipt|participant|team|outcome)\b/;

/** Words a log line on the scan path must not name (OSE-2133). */
const PASS_WORDS =
  /\b(?:Location|location|redirectTarget|redirect|votePageTarget|pass|issueVotePass|mintVotePass|voterKey|k|anonId|url|href|headers)\b/;

/** A word for T or V (decision 7): the columns, their names in code, their ranges and the draw. */
const TV_WORDS =
  /\b(?:secret_margin|secret_floor|secretMargin|secretFloor|margin|floor|SECRET_MARGIN_RANGE|SECRET_FLOOR_RANGE|drawUniform)\b/;

/**
 * Why castVote's batch, or the work before it, could depend on the side
 * (OSE-2128, H1). The side may appear in castVote in three places only: the
 * destructuring of the input, the choice of the team marker to bind (made, or
 * null for "not for me"), and the counter's binds. Any other `side` (an alias,
 * `input.side`, a condition on a statement or on the HMAC) is a problem. The
 * statement list has no spread but `...open` and no ternary, and is never
 * changed after it is built (no push, splice or filter). Empty when the batch
 * and the work are one shape for both sides; it fails closed when castVote is
 * not found.
 */
function sideFreeBatchProblems(code: string): string[] {
  const out: string[] = [];
  const fn = code.indexOf('export async function castVote');
  if (fn < 0) return ['no castVote'];
  const next = code.indexOf('\nexport ', fn + 1);
  const body = code.slice(fn, next < 0 ? code.length : next);
  const stray = body
    .replace(/const\s*\{\s*eventId,\s*objectId,\s*side,\s*k,\s*epoch\s*\}\s*=\s*input;/, '')
    .replace(/const\s+team\s*=\s*side\s*===\s*'up'\s*\?\s*made\s*:\s*null;/, '')
    .replace(/\.bind\(\s*side\s*,\s*side\s*,\s*objectId\s*\)/, '')
    .replace(/side:\s*VoteSide/, '');
  if (/\bside\b/.test(stray)) out.push('castVote uses the side beyond its three places');
  const at = body.indexOf('const statements = [');
  if (at < 0) return [...out, 'no `const statements = [` in castVote'];
  const block = body.slice(at, body.indexOf('];', at));
  const rest = block.replace(/\?\?\s*null/g, '');
  if (/\.\.\.(?!open\b)/.test(rest)) out.push('a spread in the statement list');
  if (/\?/.test(rest.replace(/'[^']*'/g, ''))) out.push('a ternary in the statement list');
  if (/\bstatements\s*\.\s*(?!length\b)\w+/.test(body))
    out.push('the statement list is changed after it is built');
  return out;
}

/** Every `console.<level>(…)` call in a file, to its closing parenthesis. */
function consoleCalls(code: string): string[] {
  const out: string[] = [];
  const re = /\bconsole\s*\.\s*(?:log|info|warn|error|debug|trace)\s*\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') depth--;
    }
    out.push(code.slice(m.index, i));
  }
  return out;
}

/** A browser storage API or the cookie, as code names it (OSE-2129). */
const STORAGE_OR_COOKIE =
  /\b(localStorage|sessionStorage|indexedDB|caches\.open)\b|document\.cookie/;
/** A fetch whose address is built with the pass (OSE-2129). */
const PASS_IN_URL = /fetch\([^,]*\bpass\b/;

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
      'vote_access_passes',
      'vote_crowd_sets',
      'vote_crowd_tallies',
      'vote_crowd_receipts',
      'vote_crowd_participants',
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
      'ose:vote:access-lookup:v1',
      'ose:vote:access-voter-key:v1',
      'ose:vote:code-window:v1', // the rotating vote code's stamp (lib/vote-code-window.ts)
      'ose:vote:crowd-participant:v1',
      'ose:vote:crowd-pass-seal:v1',
      'ose:vote:crowd-receipt:v1',
      'ose:vote:crowd-voter-key:v1',
      'ose:vote:participant:v1',
      'ose:vote:pass-seal:v1',
      'ose:vote:receipt:v1',
      'ose:vote:team-marker:v1',
      'ose:vote:voter-key:v1',
    ]);
    expect(labels).toContain('ose:scan:node-key:v1');
  });

  // ADR-040 decision 13 (owner, 2026-11-26): the Online Pick never touches the
  // Room Pick. Two tables, not a channel column, and this rule on top:
  //   - only lib/vote-crowd.ts (and the table list in lib/votes.ts) names a
  //     crowd table, so no room path can read or write one;
  //   - lib/vote-crowd.ts names no room counter or marker table in any string,
  //     SQL or not, so an interpolated constant cannot smuggle one in;
  //   - the room's write and result files never import the crowd's module.
  test('decision 13 | channels never mix: no file names a crowd table and a room counter or marker table', () => {
    const CROWD = [
      'vote_crowd_sets',
      'vote_crowd_tallies',
      'vote_crowd_receipts',
      'vote_crowd_participants',
    ];
    const ROOM = ['vote_tallies', 'vote_receipts', 'vote_participants', 'vote_team_markers'];
    const literals = (code: string) =>
      code.match(/`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g) ?? [];
    const crowdNamers = SOURCES.filter(({ code }) =>
      literals(stripTs(code)).some((l) => nameRe(CROWD).test(l))
    ).map((s) => s.file);
    expect(
      crowdNamers.sort(),
      'Only the Online Pick module and the table list name a crowd table'
    ).toEqual([CROWD_LIB, VOTES_LIB].sort());
    const crowd = SOURCES.find((s) => s.file === CROWD_LIB)!.code;
    const leaks = literals(stripTs(crowd)).filter((l) => nameRe(ROOM).test(l));
    expect(leaks, 'lib/vote-crowd.ts names a room counter or marker table').toEqual([]);
    for (const file of [CAST_LIB, RESULTS_LIB, PUBLIC_RESULT_LIB, VOTE_SETS_LIB]) {
      const code = stripTs(SOURCES.find((s) => s.file === file)!.code);
      expect(
        literals(code).some((l) => nameRe(CROWD).test(l)),
        `${file} names a crowd table`
      ).toBe(false);
    }
    for (const file of [CAST_LIB, RESULTS_LIB, PUBLIC_RESULT_LIB]) {
      const code = SOURCES.find((s) => s.file === file)!.code;
      expect(/from\s+['"]\.\/vote-crowd['"]/.test(code), `${file} imports the Online Pick`).toBe(
        false
      );
    }
    // Negative controls: the detectors see a mixed statement and an interpolated room name.
    expect(
      nameRe(ROOM).test(
        'UPDATE vote_crowd_tallies SET up_count = (SELECT up_count FROM vote_tallies)'
      )
    ).toBe(true);
    expect(
      literals("const T = 'vote_tallies'; const q = `UPDATE ${T}`;").some((l) =>
        nameRe(ROOM).test(l)
      )
    ).toBe(true);
    expect(nameRe(CROWD).test('SELECT * FROM vote_crowd_tallies_x')).toBe(false);
  });

  test('OSE-2133 | keys | the vote pass declares its own two labels and borrows no *_CONTEXT', () => {
    const pass = SOURCES.find((s) => s.file === VOTE_PASS_LIB);
    expect(pass, `${VOTE_PASS_LIB} is read`).toBeTruthy();
    const code = pass?.code ?? '';
    expect(code).toMatch(/['"`]ose:vote:voter-key:v1['"`]/);
    expect(code).toMatch(/['"`]ose:vote:pass-seal:v1['"`]/);
    expect(
      code.match(/\b[A-Z0-9_]*_CONTEXT\b/g) ?? [],
      "lib/vote-pass.ts must not name another file's HKDF label constant"
    ).toEqual([]);
  });

  test('OSE-2133 | log | /q never logs Location, the pass or the voter key, and the pass rides only in the fragment', () => {
    const files = [QR_SCAN, VOTE_PASS_LIB].map((f) => {
      const src = SOURCES.find((s) => s.file === f);
      expect(src, `${f} is read`).toBeTruthy();
      return { file: f, code: src?.code ?? '' };
    });
    const leaks = files.flatMap(({ file, code }) =>
      consoleCalls(code)
        .filter((call) => file === VOTE_PASS_LIB || PASS_WORDS.test(call))
        .map((call) => `${file}: ${call.slice(0, 120)}`)
    );
    expect(
      consoleCalls(files[0].code).length,
      'the detector sees qr-scan.ts log lines'
    ).toBeGreaterThan(3);
    const planted = consoleCalls(
      "x; console.log(JSON.stringify({ type: 'SCAN_REDIRECT', to: redirectTarget })); y"
    );
    expect(planted.length === 1 && PASS_WORDS.test(planted[0]), 'negative control').toBe(true);
    expect(PASS_WORDS.test("console.warn(JSON.stringify({ type: 'VOTE_PASS_SKIPPED' }))")).toBe(
      false
    );
    expect(leaks, 'A log line names the redirect, the pass or the voter key').toEqual([]);
    const pass = files[1].code;
    expect(pass).toMatch(/\/vote#t=\$\{pass\}/);
    for (const { file, code } of files)
      expect(/[?&]t=/.test(code), `${file} puts a pass in a query string`).toBe(false);
  });

  test('OSE-2133 | cookie | only the listed files read the anonymous cookie', () => {
    const readers = SOURCES.filter(({ code }) => COOKIE_READ.test(code)).map((s) => s.file);
    expect(
      readers.filter((f) => !(f in COOKIE_READERS)),
      'A new file reads the Cookie header or ose_anon. No new reader (D3 reversed, 2026-11-18).'
    ).toEqual([]);
    expect(
      Object.keys(COOKIE_READERS).filter((f) => !readers.includes(f)),
      'A listed reader no longer reads the cookie: take it off COOKIE_READERS.'
    ).toEqual([]);
    for (const f of Object.keys(COOKIE_READERS))
      expect(/(?:^|\/)(?:votables|vote-pass|voting-switch|votes|vote-sets)\.ts$/.test(f), f).toBe(
        false
      );
    // Negative controls: the shapes it must see, and one it must not.
    for (const planted of [
      "request.headers.get('Cookie')",
      'req.headers.get("cookie")',
      'getOrCreateAnonId(request)',
      "const NAME = 'ose_anon';",
    ])
      expect(COOKIE_READ.test(planted), planted).toBe(true);
    expect(COOKIE_READ.test("headers.append('Set-Cookie', value)")).toBe(false);
  });

  // OSE-2128 (S4a): the vote route reads no browser state and logs nothing
  // about a vote. Rule 10 already refuses a cookie reader not on its list;
  // this names the route's own files, so the rule cannot be met by listing them.
  test('OSE-2128 | cookie | the vote route never reads the Cookie header or ose_anon, and is never listed', () => {
    for (const file of [VOTE_HANDLER, CAST_LIB]) {
      const src = SOURCES.find((s) => s.file === file);
      expect(src, `${file} is read`).toBeTruthy();
      expect(COOKIE_READ.test(src!.code), `${file} reads the anonymous cookie`).toBe(false);
      expect(file in COOKIE_READERS, `${file} can never be a cookie reader`).toBe(false);
      expect(/Set-Cookie/i.test(src!.code), `${file} sets a cookie`).toBe(false);
    }
  });

  test('OSE-2128 | log | no console call in the vote route names the object, side, event, pass, k or receipt', () => {
    const VOTE_WORDS =
      /\b(?:body|object_id|objectId|side|eventId|event_id|pass|claims|k|receipt|participant|team|outcome)\b/;
    for (const file of [VOTE_HANDLER, CAST_LIB]) {
      const src = SOURCES.find((s) => s.file === file);
      expect(src, `${file} is read`).toBeTruthy();
      const named = consoleCalls(src!.code).filter((call) => VOTE_WORDS.test(call));
      expect(named, `${file} logs a vote detail`).toEqual([]);
    }
    expect(VOTE_WORDS_CONTROL.test('console.error(JSON.stringify({ side: body.side }))')).toBe(
      true
    );
  });

  test('OSE-2128 | log | one batch for both sides, and the route cannot tell counted from duplicate', () => {
    const cast = SOURCES.find((s) => s.file === CAST_LIB)!.code;
    const handler = SOURCES.find((s) => s.file === VOTE_HANDLER)!.code;
    expect(sideFreeBatchProblems(cast), `${CAST_LIB}: the batch depends on the side`).toEqual([]);
    const outcome = /export\s+type\s+CastOutcome\s*=([^;]*);/.exec(cast);
    expect(outcome, 'CastOutcome is declared').toBeTruthy();
    expect(outcome![1], 'CastOutcome names counted or duplicate').not.toMatch(
      /['"](?:counted|duplicate)['"]/
    );
    expect(handler, `${VOTE_HANDLER} names counted or duplicate`).not.toMatch(
      /['"](?:counted|duplicate)['"]/
    );
    // Negative controls: today's shape passes; H1, and the review's bypasses
    // (a splice after the list, a filtered conditional, the HMAC skipped for
    // "not for me", an alias), are caught.
    const today = `export async function castVote(db, pepper, input) {
      const { eventId, objectId, side, k, epoch } = input;
      const teamNight = obj.played_by === 'team' && !!obj.group_id;
      const made = teamNight ? await voteTeamMarker(pepper, k, obj.group_id) : null;
      const team = side === 'up' ? made : null;
      const statements = [
        db.prepare(RECEIPT_INSERT).bind(receipt, ...open),
        db.prepare(COUNT).bind(side, side, objectId),
        db.prepare(TEAM_MARKER_INSERT).bind(obj.set_id, obj.group_id ?? null, team, team),
      ];
      const results = await db.batch(statements);
    }`;
    expect(sideFreeBatchProblems(today)).toEqual([]);
    const TEAM_LINE =
      'db.prepare(TEAM_MARKER_INSERT).bind(obj.set_id, obj.group_id ?? null, team, team),';
    for (const bad of [
      today.replace(TEAM_LINE, '...(teamNight ? [db.prepare(TEAM_MARKER_INSERT)] : []),'),
      today.replace("=== 'team' &&", "=== 'team' && side === 'up' &&"),
      today.replace(
        'const results',
        'if (team) statements.splice(2, 0, db.prepare(TEAM_MARKER_INSERT));\n const results'
      ),
      today.replace(TEAM_LINE, "input.side === 'up' && db.prepare(TEAM_MARKER_INSERT),"),
      today.replace('const made = teamNight ?', "const made = teamNight && side === 'up' ?"),
      today.replace(
        'db.prepare(COUNT).bind(side, side, objectId),',
        "db.prepare(side === 'up' ? COUNT_UP : COUNT_DOWN).bind(objectId),"
      ),
      today.replace('const team = side', 'const s = side;\n const team = s'),
    ])
      expect(sideFreeBatchProblems(bad), bad).not.toEqual([]);
  });

  test('OSE-2128 | log | no console call on the vote or result path names T or V', () => {
    const files = [
      VOTE_HANDLER,
      CAST_LIB,
      VOTE_SETS_LIB,
      RESULTS_LIB,
      OPEN_OBJECTS_HANDLER,
      'src/lib/vote-public-result.ts',
      'src/handlers/votables.ts',
      'src/handlers/vote-page.ts',
      'src/lib/vote-page-render.ts',
      'src/lib/cost-metric.ts',
    ];
    for (const file of files) {
      const src = SOURCES.find((s) => s.file === file);
      expect(src, `${file} is read`).toBeTruthy();
      const named = consoleCalls(src!.code).filter((call) => TV_WORDS.test(call));
      expect(named, `${file} logs T or V`).toEqual([]);
    }
    const costLib = SOURCES.find((s) => s.file === 'src/lib/cost-metric.ts')!.code;
    const emitter = costLib.slice(costLib.indexOf('export function emitOperationCost'));
    expect(emitter.length, 'the OPERATION_COST emitter is found').toBeGreaterThan(100);
    expect(TV_WORDS.test(emitter), 'the OPERATION_COST emitter names T or V').toBe(false);
    for (const planted of [
      "console.log(JSON.stringify({ type: 'VOTE_SET_OPEN', margin }))",
      'console.info(set.secret_floor)',
      'console.warn(`T=${secretMargin}`)',
    ])
      expect(
        consoleCalls(planted).some((c) => TV_WORDS.test(c)),
        planted
      ).toBe(true);
    expect(
      TV_WORDS.test("console.log(JSON.stringify({ type: 'VOTE_FINAL_JOB', finalized }))")
    ).toBe(false);
  });

  test('OSE-2128 | route | only the router imports the vote handler; it is routed for POST only, behind the switch', () => {
    const importers = SOURCES.filter(({ code }) =>
      /from\s+['"]\.\.?\/(?:handlers\/)?vote['"]/.test(code)
    ).map((s) => s.file);
    expect(importers).toEqual(['src/router.ts']);
    const router = SOURCES.find((s) => s.file === 'src/router.ts')!.code;
    const at = router.indexOf('handleVote(request, env');
    expect(at).toBeGreaterThan(0);
    const cond = router.slice(router.lastIndexOf('if (', at), at);
    expect(cond).toMatch(/method === 'POST'/);
    expect(cond).toMatch(/\bvotingEnabled\(env\)/);
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
      // OSE-2234: a flood once seen is never cleared.
      'UPDATE vote_sets SET flood_seen = 0 WHERE id = ?',
      'UPDATE vote_sets SET flood_seen = ? WHERE id = ?',
      "UPDATE vote_sets SET state = 'closed', flood_seen = 1 - flood_seen WHERE id = ?",
      "UPDATE vote_sets SET (flood_seen, state) = (0, 'closed') WHERE id = ?",
      'UPDATE vote_sets SET burst_seen = 0 WHERE id = ?',
      "UPDATE vote_sets SET (burst_seen, state) = (0, 'closed') WHERE id = ?",
      // OSE-2234: the room size is written once, by the first open.
      'UPDATE vote_sets SET room_size = ? WHERE id = ?',
      'UPDATE vote_sets SET room_size = 50000 WHERE event_id = ? AND is_final = 0',
      "UPDATE vote_sets SET (room_size, state) = (?, 'open') WHERE id = ? AND room_size IS NULL",
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
      'UPDATE vote_sets SET flood_seen = 1 WHERE event_id = ? AND flood_seen = 0 AND is_final = 0',
      'UPDATE vote_sets SET burst_seen = 1 WHERE event_id = ? AND burst_seen = 0 AND is_final = 0',
      "UPDATE vote_sets SET state = 'open', pepper_epoch = ?, room_size = ? WHERE id = ? AND is_final = 0 AND pepper_epoch IS NULL AND room_size IS NULL",
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

/**
 * The only tables the open-objects read may name: the objects, their set (for
 * its state, final and void flags) and the event (for its status). Never a
 * tally, a receipt or a marker: even "has anyone voted on this song" is a count
 * under the floor (security review M2, 2026-11-18).
 */
const OPEN_READ_TABLES = ['votable_objects', 'vote_sets', 'events'];

/** What is wrong with the open-objects read's SQL. Empty when it holds. */
function openReadProblems(sql: string): string[] {
  const out: string[] = [];
  const flat = normalize(sql);
  const select = /^SELECT\s+(.*?)\s+FROM\s+votable_objects\s+o\b/i.exec(flat);
  if (!select) return ['the read does not SELECT ... FROM votable_objects o'];
  const read = [...flat.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map((m) => m[1].toLowerCase());
  const stray = read.filter((t) => !OPEN_READ_TABLES.includes(t));
  if (stray.length)
    out.push(`it reads ${stray.join(', ')}; only ${OPEN_READ_TABLES.join(', ')} may be read`);
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

  test('OSE-2135 | cookie | the read and the switch never name a cookie or ose_anon', () => {
    const bad = [OPEN_OBJECTS_LIB, OPEN_OBJECTS_HANDLER, SWITCH_LIB].filter((file) =>
      /cookie|ose_anon/i.test(byFile.get(file)?.code ?? 'cookie (file missing)')
    );
    expect(
      bad,
      'ADR-040 decision 5: the vote path reads no cookie and sets none; /q stays the only reader (AGENTS.md invariant 4).'
    ).toEqual([]);
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
        good.replace(
          'LIMIT ?',
          'AND NOT EXISTS (SELECT 1 FROM vote_receipts r WHERE r.object_id = o.id) LIMIT ?'
        )
      )
    ).toEqual(['it reads vote_receipts; only votable_objects, vote_sets, events may be read']);
    expect(
      openReadProblems(
        good.replace(
          'JOIN vote_sets s',
          'JOIN vote_tallies t ON t.object_id = o.id JOIN vote_sets s'
        )
      )
    ).toContain('it reads vote_tallies; only votable_objects, vote_sets, events may be read');
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

// ── 11. The room's own vote code and the live event (OSE-2140, OSE-2142) ────

const POSTER_BUNDLE = 'src/handlers/poster-bundle.ts';
const VOTE_CODE_LIB = 'src/lib/vote-code.ts';

const fold = (s: string) => normalize(s).replace(/\s+/g, ' ');

/** The body of `export async function <name>` up to its closing brace at column 0. */
function fnBody(code: string, name: string): string | null {
  const m = code.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?\\n}\\n`));
  return m ? m[0] : null;
}

/** voteCodeMayMint: the vote code in use, the set open and not final, the event live, in one statement. */
function mintCheckProblems(code: string): string[] {
  const body = fnBody(code, 'voteCodeMayMint');
  if (!body) return ['voteCodeMayMint is not found'];
  const flat = fold(body);
  return [
    'd.is_vote_code = 1',
    'd.is_active = 1',
    "s.state = 'open'",
    's.is_final = 0',
    '${EVENT_LIVE}',
  ]
    .filter((g) => !flat.includes(g))
    .map((g) => `voteCodeMayMint lacks ${g}`);
}

/** issueVotePass asks voteCodeMayMint with the scanned placement, and reads no set by itself. */
function passProblems(code: string): string[] {
  const body = fnBody(code, 'issueVotePass');
  if (!body) return ['issueVotePass is not found'];
  const out: string[] = [];
  if (!/voteCodeMayMint\(\s*env\.DB\s*,\s*eventId\s*,\s*deploymentId\s*\)/.test(body))
    out.push('issueVotePass does not ask voteCodeMayMint for the scanned placement');
  if (/\breadVoteSet\b/.test(body)) out.push('issueVotePass reads the set without the vote code');
  return out;
}

/** Every poster-bundle read of a placement token refuses a vote code. */
function bundleProblems(code: string): string[] {
  const reads = sqlLiterals(code).filter(
    (s) => /\bFROM\s+poster_deployments\b/i.test(s) && /\bqr_token\b/.test(s)
  );
  if (!reads.length) return ['the bundle reads no placement token (the detector is blind)'];
  return reads
    .filter((s) => !/\bis_vote_code\s*=\s*0\b/.test(s))
    .map(() => 'a poster-bundle read of a token does not refuse a vote code (is_vote_code = 0)');
}

/**
 * The Worker files that move an event's status, each batching
 * closeVoteSetUnlessPublished with the move (OSE-2142): the admin edit (its SQL
 * is built, so it is listed by name) and the QR verify undo.
 */
const STATUS_WRITERS = ['src/handlers/events.ts', 'src/handlers/qr-verify.ts'];
/** Files that write events.status without the close, and why that is safe. */
const STATUS_WRITER_EXEMPT: Record<string, string> = {
  'src/lib/draft-expiry.ts':
    'Moves only a draft to archived. A draft holds no open set: open needs Published, and leaving Published closes it.',
};
/** An UPDATE of events that assigns its status (after SET or a comma) anything but 'active'. */
const SETS_STATUS = /\bUPDATE\s+events\s+SET\b(?:\s+|[^;]*?,\s*)status\s*=(?!\s*'active')/i;

/** Every string literal in a source text. */
const stringLiterals = (code: string): { text: string; index: number }[] =>
  [...code.matchAll(/`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g)].map(
    (m) => ({ text: m[0], index: m.index ?? 0 })
  );

/**
 * Every status writer batches the close; in a listed file every literal status
 * write sits in a `.batch([` with the close; any other file that writes a
 * status is exempt with a reason. Not seen: a status write built from a field
 * list (the event PUT's `${field} = ?`); tests/vote-code.spec.ts holds that path
 * at runtime.
 */
function statusWriterProblems(sources: { file: string; code: string }[]): string[] {
  const out: string[] = [];
  const byFile = new Map(sources.map((s) => [s.file, s.code]));
  for (const f of STATUS_WRITERS) {
    const src = byFile.get(f);
    if (!src) {
      out.push(`${f} is missing`);
      continue;
    }
    if (!/\.batch\(\s*\[[\s\S]{0,600}?\bcloseVoteSetUnlessPublished\(/.test(src))
      out.push(`${f} moves an event's status without batching closeVoteSetUnlessPublished`);
    for (const lit of stringLiterals(src)) {
      if (!SETS_STATUS.test(lit.text)) continue;
      const before = src.slice(Math.max(0, lit.index - 300), lit.index);
      const after = src.slice(lit.index, lit.index + 600);
      if (!/\.batch\(\s*\[[^\]]*$/.test(before) || !/\bcloseVoteSetUnlessPublished\(/.test(after))
        out.push(`${f} has a status write outside a batch with closeVoteSetUnlessPublished`);
    }
  }
  for (const { file, code } of sources) {
    if (STATUS_WRITERS.includes(file) || file in STATUS_WRITER_EXEMPT) continue;
    if (sqlLiterals(code).some((l) => SETS_STATUS.test(l)))
      out.push(`${file} writes events.status but is not a listed status writer`);
  }
  return out;
}

/**
 * Only lib/vote-code.ts writes is_vote_code, so a vote code is made in one
 * place. Every string literal is read, not only whole SQL: a built SET piece
 * (`sets.push('is_vote_code = ?')`) counts as a write; a read filter does not.
 */
function voteCodeWriters(sources: { file: string; code: string }[]): string[] {
  const writes = (l: string) =>
    (/\b(?:INSERT|UPDATE)\b/i.test(l) && /\bis_vote_code\b/.test(l)) ||
    /\bis_vote_code\s*=\s*(?:\?|\$\{)/.test(l);
  return sources
    .filter((s) => stringLiterals(s.code).some((l) => writes(l.text)))
    .map((s) => s.file)
    .filter((f) => f !== VOTE_CODE_LIB);
}

test.describe("Invariant: the room's own vote code and the live event (OSE-2140, OSE-2142)", () => {
  const byFile = new Map(SOURCES.map((s) => [s.file, s]));
  const code = (f: string) => {
    const s = byFile.get(f);
    expect(s, `${f} exists`).toBeTruthy();
    return s!.code;
  };

  test('OSE-2140 | mint | only the event vote code, with the set open and the event live, mints a pass', () => {
    expect(mintCheckProblems(code(VOTE_SETS_LIB))).toEqual([]);
    expect(passProblems(code(VOTE_PASS_LIB))).toEqual([]);
  });

  test('OSE-2140 | public | the poster bundle never resolves a vote code', () => {
    expect(bundleProblems(code(POSTER_BUNDLE))).toEqual([]);
  });

  test('OSE-2140 | one maker | only lib/vote-code.ts writes is_vote_code', () => {
    expect(voteCodeWriters(SOURCES)).toEqual([]);
  });

  test('OSE-2142 | status | every status writer closes an open set in the same batch as the move', () => {
    expect(statusWriterProblems(SOURCES)).toEqual([]);
    for (const [f, why] of Object.entries(STATUS_WRITER_EXEMPT)) {
      expect(byFile.has(f), `${f} exists`).toBe(true);
      expect(why.length, f).toBeGreaterThan(40);
    }
  });

  test('OSE-2140 OSE-2142 | gate | the rules can fail (negative controls)', () => {
    const mint = `export async function voteCodeMayMint(db) {
  return db.prepare(\`SELECT 1 FROM vote_sets s WHERE s.event_id = ? AND s.state = 'open' AND s.is_final = 0
    AND EXISTS (SELECT 1 FROM poster_deployments d WHERE d.id = ? AND d.event_id = ? AND d.is_vote_code = 1 AND d.is_active = 1)
    AND \${EVENT_LIVE}\`);
}
`;
    expect(mintCheckProblems(mint)).toEqual([]);
    expect(mintCheckProblems(mint.replace(' AND d.is_vote_code = 1', ''))).toEqual([
      'voteCodeMayMint lacks d.is_vote_code = 1',
    ]);
    expect(mintCheckProblems(mint.replace('AND ${EVENT_LIVE}', ''))).toEqual([
      'voteCodeMayMint lacks ${EVENT_LIVE}',
    ]);
    const pass = `export async function issueVotePass(env, cookie, eventId, deploymentId, nowMs) {
  if (!(await voteCodeMayMint(env.DB, eventId, deploymentId))) return null;
}
`;
    expect(passProblems(pass)).toEqual([]);
    expect(
      passProblems(
        pass.replace(
          'if (!(await voteCodeMayMint(env.DB, eventId, deploymentId))) return null;',
          'const set = await readVoteSet(env.DB, eventId);'
        )
      )
    ).toHaveLength(2);
    const bundle =
      'const r = `SELECT id, qr_token FROM poster_deployments WHERE id = ? AND is_vote_code = 0`;';
    expect(bundleProblems(bundle)).toEqual([]);
    expect(bundleProblems(bundle.replace(' AND is_vote_code = 0', ''))).toHaveLength(1);
    const writer = `const [res] = await env.DB.batch([
    env.DB.prepare("UPDATE events SET status = 'ready' WHERE id = ?").bind(id),
    closeVoteSetUnlessPublished(env.DB, id),
  ]);`;
    const ok = [
      { file: 'src/handlers/events.ts', code: writer },
      { file: 'src/handlers/qr-verify.ts', code: writer },
    ];
    expect(statusWriterProblems(ok)).toEqual([]);
    expect(
      statusWriterProblems([
        ok[0],
        {
          file: 'src/handlers/qr-verify.ts',
          code: writer.replace('closeVoteSetUnlessPublished(env.DB, id),', ''),
        },
      ])
    ).toEqual([
      "src/handlers/qr-verify.ts moves an event's status without batching closeVoteSetUnlessPublished",
      'src/handlers/qr-verify.ts has a status write outside a batch with closeVoteSetUnlessPublished',
    ]);
    expect(
      statusWriterProblems([
        ...ok,
        {
          file: 'src/lib/x.ts',
          code: "db.prepare(`UPDATE events SET status = 'archived' WHERE id = ?`)",
        },
      ])
    ).toEqual(['src/lib/x.ts writes events.status but is not a listed status writer']);
    expect(
      statusWriterProblems([
        ...ok,
        {
          file: 'src/lib/y.ts',
          code: "db.prepare(`UPDATE events SET status = 'active' WHERE id = ?`)",
        },
      ])
    ).toEqual([]);
    expect(
      voteCodeWriters([
        {
          file: 'src/handlers/x.ts',
          code: 'db.prepare(`UPDATE poster_deployments SET is_vote_code = 1`)',
        },
      ])
    ).toEqual(['src/handlers/x.ts']);
    // A built SET piece is a write too; a read filter is not.
    expect(
      voteCodeWriters([
        { file: 'src/handlers/poster-deployments.ts', code: "sets.push('is_vote_code = ?');" },
        {
          file: 'src/handlers/poster-bundle.ts',
          code: '`SELECT id FROM poster_deployments WHERE is_vote_code = 0`',
        },
      ])
    ).toEqual(['src/handlers/poster-deployments.ts']);
    // A second, unbatched status write in a listed file is caught.
    expect(
      statusWriterProblems([
        ok[0],
        {
          file: 'src/handlers/qr-verify.ts',
          code:
            writer +
            '\nawait env.DB.prepare("UPDATE events SET status = \'archived\' WHERE id = ?").run();',
        },
      ])
    ).toEqual([
      'src/handlers/qr-verify.ts has a status write outside a batch with closeVoteSetUnlessPublished',
    ]);
    // A read of status inside an UPDATE of another column is not a status write.
    expect(
      statusWriterProblems([
        ...ok,
        {
          file: 'src/lib/z.ts',
          code: "db.prepare(`UPDATE events SET listed_from = CASE WHEN status = 'ready' THEN 1 END WHERE id = ?`)",
        },
      ])
    ).toEqual([]);
  });
});

test.describe('Invariant: the voter page (OSE-2129)', () => {
  const byFile = new Map(SOURCES.map((s) => [s.file, s]));
  const code = (file: string) => byFile.get(file)?.code ?? '';

  test('OSE-2129 | result | the page reads a result only from a final, non-void set, and names no number', () => {
    const sqls = sqlLiterals(code(PUBLIC_RESULT_LIB));
    expect(sqls.length, `${PUBLIC_RESULT_LIB} holds its two reads`).toBe(2);
    const setRead = sqls.find((q) => /FROM vote_sets/.test(q)) ?? '';
    expect(setRead).toMatch(/s\.is_final = 1/);
    expect(setRead).toMatch(/s\.is_void = 0/);
    for (const q of sqls) {
      expect(READS_STAR.test(q), 'no SELECT *').toBe(false);
      expect(/\b(INSERT|UPDATE|DELETE)\b/i.test(q), 'the result read writes nothing').toBe(false);
      expect(/COUNT\s*\(|SUM\s*\(/i.test(q), 'the result read counts nothing').toBe(false);
    }
  });

  test('OSE-2129 | result | only the voter page imports the result read, and only the router imports the page', () => {
    const importers = (mod: string) =>
      SOURCES.filter(({ code }) =>
        new RegExp(`from\\s+['"][./]*[\\w/]*${mod}(?:\\.js)?['"]`).test(code)
      )
        .map((s) => s.file)
        .sort();
    expect(importers('lib/vote-public-result')).toEqual([VOTE_PAGE_HANDLER]);
    expect(importers('handlers/vote-page')).toEqual(['src/router.ts']);
  });

  test('OSE-2129 | page | the voter page keeps the pass in memory: no storage, no cookie, no pass in a URL', () => {
    for (const file of [VOTE_PAGE_HANDLER, VOTE_PAGE_RENDER]) {
      expect(STORAGE_OR_COOKIE.test(code(file)), `${file} names a storage API or a cookie`).toBe(
        false
      );
      expect(file in COOKIE_READERS, `${file} can never be a cookie reader`).toBe(false);
    }
    const page = code(VOTE_PAGE_RENDER);
    expect(page, 'the fragment leaves the address bar first').toMatch(/history\.replaceState\(/);
    expect(page, 'the pass is sent only in a POST body').toMatch(
      /body: JSON\.stringify\(\{ object_id: objectId, side: side, pass: pass \}\)/
    );
    expect(PASS_IN_URL.test(page), 'no fetch URL is built with the pass').toBe(false);
    expect(page.match(/credentials: 'omit'/g)?.length, 'both requests send no cookie').toBe(2);
  });

  test('OSE-2129 | gate | the page rules can fail (negative controls)', () => {
    expect(STORAGE_OR_COOKIE.test("localStorage.setItem('p', pass)")).toBe(true);
    expect(STORAGE_OR_COOKIE.test('sessionStorage.p = pass')).toBe(true);
    expect(STORAGE_OR_COOKIE.test("indexedDB.open('v')")).toBe(true);
    expect(STORAGE_OR_COOKIE.test("document.cookie = 'p=' + pass")).toBe(true);
    expect(STORAGE_OR_COOKIE.test("fetch('/api/v2/vote/' + id, { credentials: 'omit' })")).toBe(
      false
    );
    expect(PASS_IN_URL.test("fetch('/api/v2/vote/' + eventId + '?pass=' + pass)")).toBe(true);
    expect(PASS_IN_URL.test("fetch('/api/v2/vote/' + encodeURIComponent(eventId), {")).toBe(false);
  });
});
