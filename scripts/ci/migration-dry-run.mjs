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

/** Rows as a small markdown table. */
export function toMarkdown(rows) {
  if (!rows || rows.length === 0) return '_no rows_';
  const cols = Object.keys(rows[0]);
  const cell = (v) => String(v ?? 'NULL').replace(/\|/g, '\\|');
  return [
    `| ${cols.join(' | ')} |`,
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
  const statements = readOnlyStatements(readFileSync(join(DRY_RUN_DIR, name), 'utf8'), name);
  say(
    `\n#### \`${name}\` on ${binding} (${opts.env ?? 'default'}, ${opts.local ? 'local' : 'remote'})\n`
  );
  statements.forEach((statement, i) => {
    const rows = runStatement(binding, statement, opts);
    say(`**${i + 1}.** \`${statement}\`\n\n${toMarkdown(rows)}\n`);
  });
}

function parseArgs(argv) {
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
  // A remote run names its environment, and this script has no production mode:
  // production's dry run is a decision for the production migration plan.
  if (!opts.local && opts.env !== 'staging') {
    throw new Error(
      'a remote run needs --env staging (this script does not run against production)'
    );
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
