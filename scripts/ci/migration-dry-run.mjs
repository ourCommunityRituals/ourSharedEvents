#!/usr/bin/env node
/**
 * Migration dry run: the read-only counts a migration's author wrote, taken on
 * the database BEFORE the migration is applied there (OSE-2016).
 *
 * Why it exists: migration 0108 shipped with a dry-run file and an instruction
 * to run it on staging first. Nobody could: no session holds the staging
 * database credential, and the owner's computer is not a place work may depend
 * on. So the dry run now happens in CI, in the step before the migrations are
 * applied, with the credential that step already holds.
 *
 * The convention:
 *   workers/oursharedevents/scripts/dry-run-NNNN-<words>.sql        for DB
 *   workers/oursharedevents/scripts/dry-run-forms-NNNN-<words>.sql  for FORMS_DB
 * belongs to migration NNNN of that database. A migration with no such file has
 * no dry run, and that is said in the output.
 *
 * Two ways to run it:
 *   --pending       ask the database which migrations are not applied yet, and
 *                   run the dry-run file of each one that has a file.
 *   --file <name>   run one dry-run file by name, whatever is applied.
 *
 * READ ONLY, and it checks that itself: every statement must be a SELECT (or a
 * WITH ... SELECT), and none may hold a word that writes or changes the schema.
 * A file that fails the check stops the run before any statement is sent.
 *
 * Each statement is sent with `wrangler d1 execute --command`, one at a time.
 * `--file` is not used: against a remote database it reports how many
 * statements ran and prints no rows.
 *
 * Fail closed: when a dry-run file exists for a pending migration and it cannot
 * be run, the exit code is 1, so the step that applies migrations does not run.
 *
 * WHAT IT MAY PRINT (OSE-2085, ADR-037). This repository is public, so the log
 * and the job summary are public. A dry run therefore prints counts, never rows:
 *
 *   strict output   on production (both databases) and on the forms database
 *                   everywhere. Every statement is `SELECT COUNT(...) [, COUNT(...)]
 *                   FROM ...` with no GROUP BY, so it returns one row of counts.
 *                   A count under the floor (5, the same floor as
 *                   lib/count-floor.ts) is printed in words, never as a digit
 *                   and never as 0. Any other cell stops the run unprinted.
 *   plain output    on the main database off production (staging test data,
 *                   the anonymous side). Numbers print as they are; a text cell
 *                   must be a short lower-case label such as a status word.
 *   schema facts    a statement that reads only the schema (pragma_table_info,
 *                   sqlite_master, d1_migrations) counts nothing people did. It
 *                   prints exactly, under either rule.
 *
 * The checks that can be made from the SQL alone are made on every file before
 * any statement is sent. This is a guard against an accident in a reviewed
 * file. It is not a defence against an author who means to leak: many narrow
 * counts can still be differenced, and review is what stops that.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORKER_DIR = join(ROOT, 'workers', 'oursharedevents');
export const DRY_RUN_DIR = join(WORKER_DIR, 'scripts');

/** binding → the file-name prefix of its dry-run files. */
export const PREFIX = { DB: 'dry-run-', FORMS_DB: 'dry-run-forms-' };

/** Words that write, or change the schema or the connection. Whole words only. */
export const WRITE_WORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'UPSERT',
  'DROP',
  'ALTER',
  'CREATE',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
  'PRAGMA',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
];

/** The SQL with `--` line comments and block comments taken out. */
export function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

/** The statements of a dry-run file, comments gone, in order. */
export function parseStatements(sql) {
  const body = stripComments(sql);
  // A `;` or a `--` inside a quoted string would be cut wrongly. A dry-run file
  // has no need for either, so it is refused, not parsed.
  for (const m of body.matchAll(/'(?:[^']|'')*'/g)) {
    if (m[0].includes(';')) throw new Error(`a quoted string holds a semicolon: ${m[0]}`);
  }
  return body
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** The reasons a statement is not read-only. Empty means it may be sent. */
export function readOnlyFaults(statement) {
  const faults = [];
  // Quoted strings are data, not SQL: a count of rows WHERE status = 'delete'
  // is still a read.
  const bare = statement.replace(/'(?:[^']|'')*'/g, "''");
  if (!/^(SELECT|WITH)\b/i.test(bare)) faults.push('does not start with SELECT or WITH');
  for (const word of WRITE_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(bare)) faults.push(`holds the word ${word}`);
  }
  return faults;
}

/** Throws unless every statement of the file is read-only. Returns them. */
export function readOnlyStatements(sql, name = 'the file') {
  const statements = parseStatements(sql);
  if (statements.length === 0) throw new Error(`${name} holds no statement`);
  const bad = statements
    .map((s, i) => ({ n: i + 1, s, faults: readOnlyFaults(s) }))
    .filter((x) => x.faults.length > 0);
  if (bad.length > 0) {
    const lines = bad.map((x) => `  statement ${x.n} ${x.faults.join(', ')}: ${x.s.slice(0, 80)}`);
    throw new Error(`${name} is not read-only, nothing was sent:\n${lines.join('\n')}`);
  }
  return statements;
}

/**
 * The migration numbers `wrangler d1 migrations list` names as not applied.
 * Returns [] when it says there is nothing to apply, and null when the output
 * says neither (an auth or network failure): the caller must not read that as
 * "nothing pending".
 */
export function pendingNumbers(listOutput) {
  const numbers = [...listOutput.matchAll(/\b(\d{4})_[A-Za-z0-9_-]+\.sql\b/g)].map((m) => m[1]);
  if (numbers.length > 0) return [...new Set(numbers)].sort();
  if (/No migrations to apply/i.test(listOutput)) return [];
  return null;
}

/** The dry-run file names in `dir` for one binding, keyed by migration number. */
export function dryRunFiles(binding, dir = DRY_RUN_DIR) {
  const prefix = PREFIX[binding];
  if (!prefix) throw new Error(`unknown binding ${binding}`);
  const out = {};
  for (const name of readdirSync(dir)) {
    // dry-run-forms-0001-x.sql starts with the DB prefix too, so the number
    // must follow the prefix directly.
    const m = name.match(/^(dry-run-(?:forms-)?)(\d{4})-[a-z0-9-]+\.sql$/);
    if (m && m[1] === prefix) (out[m[2]] ??= []).push(name);
  }
  return out;
}

/** A dry-run file name a person typed: a plain name of the right shape, no path. */
export function isDryRunFileName(name) {
  return /^dry-run-(?:forms-)?\d{4}-[a-z0-9-]+\.sql$/.test(name);
}

export function bindingOfFile(name) {
  return name.startsWith(PREFIX.FORMS_DB) ? 'FORMS_DB' : 'DB';
}

/** The under-5 floor. The same number as CORRIDOR_MAP_MIN_COUNT in the worker. */
export const COUNT_FLOOR = 5;
export const WITHHELD = 'Fewer than 5';

/** Tables and table functions that hold the schema, not what people did. */
export const SCHEMA_SOURCES = [
  'pragma_table_info',
  'pragma_table_xinfo',
  'pragma_index_list',
  'pragma_index_info',
  'sqlite_master',
  'sqlite_schema',
  'd1_migrations',
];

/** A text cell that may be printed: a short lower-case word, like a status. */
const LABEL = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Which output rule applies. Strict on production and on the forms database;
 * plain on the main database anywhere else.
 */
export function outputRule(binding, env) {
  return env === 'production' || binding === 'FORMS_DB' ? 'strict' : 'plain';
}

const withoutStrings = (statement) => statement.replace(/'(?:[^']|'')*'/g, "''");

/** True when every table the statement reads is a schema source. */
export function isSchemaOnly(statement) {
  const bare = withoutStrings(statement);
  const sources = [...bare.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) =>
    m[1].toLowerCase()
  );
  if (sources.length === 0 || !sources.every((name) => SCHEMA_SOURCES.includes(name))) return false;
  // `FROM sqlite_master, registrations` joins with a comma, which the list
  // above does not see. With the bracketed parts taken out, a comma after the
  // first FROM is such a join, so the statement is not schema-only.
  let flat = bare.slice(bare.search(/\bFROM\b/i));
  for (let before = ''; before !== flat;) {
    before = flat;
    flat = flat.replace(/\([^()]*\)/g, '');
  }
  return !flat.includes(',');
}

/** The items of the outermost select list, split at top-level commas. */
function selectItems(bare) {
  let depth = 0;
  let end = -1;
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && /^FROM\b/i.test(bare.slice(i)) && /\s/.test(bare[i - 1] ?? ' ')) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const list = bare.slice(bare.search(/\S/) + 'SELECT'.length, end);
  const items = [];
  let start = 0;
  depth = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      items.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  items.push(list.slice(start).trim());
  return items;
}

/**
 * The reasons a statement cannot run under the strict rule. Read from the SQL
 * alone, so it is known before anything is sent. A schema-only statement has
 * none.
 */
export function strictFaults(statement) {
  if (isSchemaOnly(statement)) return [];
  const bare = withoutStrings(statement);
  const faults = [];
  if (!/^SELECT\b/i.test(bare)) faults.push('does not start with SELECT');
  if (/\bGROUP\s+BY\b/i.test(bare)) faults.push('has a GROUP BY (one row of counts only)');
  if (/\b(UNION|INTERSECT|EXCEPT)\b/i.test(bare)) faults.push('joins two selects');
  const items = /^SELECT\b/i.test(bare) ? selectItems(bare) : null;
  if (!items) {
    faults.push('has no FROM the select list can be read up to');
  } else {
    for (const item of items) {
      // COUNT( ... ) and an optional alias, and nothing else: no arithmetic
      // that could carry a value out, and no other aggregate (MIN and MAX
      // return a row's own value).
      const m = item.match(/^COUNT\s*\(/i);
      let ok = false;
      if (m) {
        let depth = 0;
        let close = -1;
        for (let i = m[0].length - 1; i < item.length; i++) {
          if (item[i] === '(') depth++;
          else if (item[i] === ')' && --depth === 0) {
            close = i;
            break;
          }
        }
        ok =
          close !== -1 && /^(\s+AS)?(\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/i.test(item.slice(close + 1));
      }
      if (!ok) faults.push(`selects something that is not a COUNT: ${item.slice(0, 60)}`);
    }
  }
  return faults;
}

/** Throws unless every statement may run under the rule. */
export function assertRule(statements, rule, name = 'the file') {
  if (rule !== 'strict') return;
  const bad = statements
    .map((s, i) => ({ n: i + 1, s, faults: strictFaults(s) }))
    .filter((x) => x.faults.length > 0);
  if (bad.length > 0) {
    const lines = bad.map((x) => `  statement ${x.n} ${x.faults.join(', ')}: ${x.s.slice(0, 80)}`);
    throw new Error(
      `${name} may print more than counts, nothing was sent (strict output: production, and the forms database):\n${lines.join('\n')}`
    );
  }
}

/**
 * The rows as they may be printed, or a throw. The offending value is never in
 * the message: only its column and what kind of thing it was.
 */
export function printableRows(rows, rule, statement) {
  const schema = isSchemaOnly(statement);
  if (rule === 'strict' && !schema && rows.length !== 1) {
    throw new Error(`a strict statement returned ${rows.length} rows, not one row of counts`);
  }
  return rows.map((row) => {
    const out = {};
    for (const [col, v] of Object.entries(row)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (rule === 'strict' && !schema) {
          if (!Number.isInteger(v) || v < 0)
            throw new Error(`column ${col} is a number that is not a count`);
          out[col] = v < COUNT_FLOOR ? WITHHELD : v;
        } else {
          out[col] = v;
        }
      } else if (v === null || v === undefined) {
        if (rule === 'strict' && !schema) throw new Error(`column ${col} is empty, not a count`);
        out[col] = 'NULL';
      } else if (typeof v === 'string' && LABEL.test(v) && (rule === 'plain' || schema)) {
        out[col] = v;
      } else {
        throw new Error(
          `column ${col} holds ${typeof v === 'string' ? 'text that is not a short label' : `a ${typeof v}`}; a dry run prints counts, and the value is not shown`
        );
      }
    }
    return out;
  });
}

/** Rows as a small markdown table. */
export function toMarkdown(rows) {
  if (!rows || rows.length === 0) return '_no rows_';
  const cols = Object.keys(rows[0]);
  // A value is data from the database: a backslash, a pipe or a line break in
  // it must not end the cell or the row. The backslash goes first, so the
  // escapes added after it are not escaped again.
  const cell = (v) =>
    String(v ?? 'NULL')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ');
  return [
    `| ${cols.map(cell).join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(' | ')} |`),
  ].join('\n');
}

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function targetArgs(opts) {
  return [...(opts.env ? ['--env', opts.env] : []), opts.local ? '--local' : '--remote'];
}

function runStatement(binding, statement, opts) {
  const out = wrangler([
    'd1',
    'execute',
    binding,
    ...targetArgs(opts),
    '--json',
    '--command',
    statement,
  ]);
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  return parsed[0]?.results ?? [];
}

function say(text) {
  process.stdout.write(`${text}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function runFile(name, opts) {
  const binding = bindingOfFile(name);
  const rule = outputRule(binding, opts.env);
  const statements = readOnlyStatements(readFileSync(join(DRY_RUN_DIR, name), 'utf8'), name);
  assertRule(statements, rule, name);
  say(
    `\n#### \`${name}\` on ${binding} (${opts.env ?? 'default'}, ${opts.local ? 'local' : 'remote'}, ${rule} output)\n`
  );
  statements.forEach((statement, i) => {
    let rows;
    try {
      rows = printableRows(runStatement(binding, statement, opts), rule, statement);
    } catch (e) {
      // Only the rule's own words: a wrangler failure can quote the database.
      const why = e.status === undefined ? e.message : 'the statement could not be run';
      throw new Error(`${name}, statement ${i + 1}: ${why}`);
    }
    say(`**${i + 1}.** \`${statement}\`\n\n${toMarkdown(rows)}\n`);
  });
}

export function parseArgs(argv) {
  const opts = { pending: false, file: null, env: null, local: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pending') opts.pending = true;
    else if (a === '--file') opts.file = argv[++i];
    else if (a === '--env') opts.env = argv[++i];
    else if (a === '--local') opts.local = true;
    else if (a === '--remote') opts.local = false;
    else throw new Error(`unknown argument ${a}`);
  }
  if (opts.pending === Boolean(opts.file))
    throw new Error('give exactly one of --pending or --file <name>');
  // A remote run names its environment. Staging takes either mode. Production
  // takes --pending only: its dry run happens inside the production deploy,
  // ahead of the apply, and there is no way to ask production for a file's
  // counts on demand (OSE-2085).
  const remoteOk =
    opts.env === 'staging' || (opts.env === 'production' && opts.pending && !opts.file);
  if (!opts.local && !remoteOk) {
    throw new Error(
      'a remote run needs --env staging, or --env production with --pending (no on-demand production run)'
    );
  }
  if (opts.local && opts.env === 'production') {
    throw new Error('a local run cannot name production');
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  say('### Migration dry run (read only)');

  if (opts.file) {
    if (!isDryRunFileName(opts.file) || !existsSync(join(DRY_RUN_DIR, opts.file))) {
      throw new Error(`no dry-run file named ${opts.file} in workers/oursharedevents/scripts`);
    }
    runFile(opts.file, opts);
    return;
  }

  for (const binding of Object.keys(PREFIX)) {
    let listOutput;
    try {
      listOutput = wrangler(['d1', 'migrations', 'list', binding, ...targetArgs(opts)]);
    } catch (e) {
      listOutput = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    const pending = pendingNumbers(listOutput);
    if (pending === null) {
      throw new Error(
        `could not read the pending migrations of ${binding}:\n${listOutput.slice(-1500)}`
      );
    }
    if (pending.length === 0) {
      say(`\n${binding}: no migration is pending, so there is nothing to dry-run.`);
      continue;
    }
    const files = dryRunFiles(binding);
    // Every pending file is checked against its output rule first, so a file
    // that may not run stops the job before any statement of any file is sent.
    for (const number of pending) {
      for (const name of files[number] ?? []) {
        const sql = readFileSync(join(DRY_RUN_DIR, name), 'utf8');
        assertRule(readOnlyStatements(sql, name), outputRule(binding, opts.env), name);
      }
    }
    for (const number of pending) {
      const names = files[number] ?? [];
      if (names.length === 0)
        say(`\n${binding}: migration ${number} is pending and has no dry-run file.`);
      for (const name of names) runFile(name, opts);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`::error::migration dry run: ${e.message}\n`);
    process.exit(1);
  }
}
