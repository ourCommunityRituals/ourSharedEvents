#!/usr/bin/env node
/**
 * Seed a staging D1 database from SQL files.
 *
 *   node ../../scripts/ci/d1-seed-staging.mjs DB fixture-a.sql [fixture-b.sql ...]
 *
 * Run from the Worker folder. Each file is one `wrangler d1 execute <DB> --env
 * staging --remote --command <the file's SQL>`, in order; the first file that
 * cannot be applied stops the step.
 *
 * Why `--command` and never `--file` (OSE-2090): against a remote database,
 * `--file` is a D1 IMPORT, and wrangler says so as it runs: "during which your
 * D1 database will be unavailable to serve queries" (wrangler 4.158.0,
 * executeRemotely). The T2 legs run side by side, so one leg's import landed in
 * the other leg's reads: run 43802459749, the pages leg's "Unpublish landing
 * zip own-area fixture" ran 04:45:16.6 to 04:45:17.7 UTC and the api leg's
 * public sponsors read got a 503 at 04:45:17.5. `--command` goes to D1's
 * ordinary query endpoint: a write like any other, with no import lock.
 *
 * Comments are taken out first (outside quotes only). Refused before anything
 * is sent: a file over MAX_SQL_BYTES (D1 caps one SQL text at 100 KB), and a
 * file with any statement but INSERT, UPDATE, DELETE or REPLACE, or with
 * RETURNING. `--command` prints the rows a statement returns, and this log is
 * public; `--file` printed only counts.
 *
 * Retries: "Currently processing a long-running import" (another import, such
 * as the stock load, run 38162352541) waits 10, 20, 30, 40 and 50 s (150 s in
 * all); any other error is retried once after 5 s. A fixture is an upsert keyed
 * on its ids, so sending it again is safe. Never continue-on-error: a fixture
 * that does not land fails its step by name.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** D1 refuses one SQL text over 100 KB; stay under it with room to spare. */
export const MAX_SQL_BYTES = 90_000;

/** The statements a fixture may hold. None returns rows. */
export const WRITE_HEADS = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'];

/**
 * The SQL with `--` and `/* *\/` comments taken out, never inside a quoted
 * string or identifier ('…', "…", `…`, […]). Quoted text is kept byte for
 * byte, line breaks and spaces included; only the two ends are trimmed.
 * With `blankQuotes`, each quoted span is written as '' instead: the shape of
 * the SQL with no quoted text in it, for the checks in sqlForFile.
 * @param {string} sql
 * @param {{ blankQuotes?: boolean }} [opts]
 * @returns {string}
 */
export function stripSqlComments(sql, { blankQuotes = false } = {}) {
  let out = '';
  let i = 0;
  const closers = { "'": "'", '"': '"', '`': '`', '[': ']' };
  while (i < sql.length) {
    const c = sql[i];
    if (closers[c]) {
      const close = closers[c];
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error('an unclosed quote');
        if (sql[j] === close) {
          // '' inside '…' (and "" inside "…") is an escaped quote, not the end.
          if (close !== ']' && sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += blankQuotes ? "''" : sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error('an unclosed /* comment');
      out += ' ';
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.trim();
}

/**
 * The wrangler arguments for one file: always `--command`, never `--file`.
 * @param {string} db
 * @param {string} sql the file's SQL, comments already out
 */
export function wranglerArgs(db, sql) {
  return ['wrangler', 'd1', 'execute', db, '--env', 'staging', '--remote', '--command', sql];
}

/**
 * The SQL to send for a file, or an error that names why it cannot be sent.
 * @param {string} text the file's contents
 * @returns {{ ok: true, sql: string } | { ok: false, reason: string }}
 */
export function sqlForFile(text) {
  let sql;
  try {
    sql = stripSqlComments(text);
  } catch (e) {
    return { ok: false, reason: `cannot be read as SQL: ${e.message}` };
  }
  if (sql.trim() === '') return { ok: false, reason: 'holds no SQL' };
  // `--command` prints what each statement returns, and the CI log is public.
  // A fixture only writes, so it returns no rows: refuse anything else.
  const shape = stripSqlComments(text, { blankQuotes: true });
  for (const statement of shape.split(';')) {
    const head = statement.trim().split(/\s+/)[0]?.toUpperCase();
    if (head && !WRITE_HEADS.includes(head)) {
      return {
        ok: false,
        reason: `has a ${head} statement; a fixture may only write (${WRITE_HEADS.join(', ')})`,
      };
    }
  }
  if (/\bRETURNING\b/i.test(shape)) {
    return { ok: false, reason: 'has a RETURNING clause, which would print rows to the log' };
  }
  const bytes = Buffer.byteLength(sql, 'utf8');
  if (bytes > MAX_SQL_BYTES) {
    return { ok: false, reason: `is ${bytes} bytes of SQL, over ${MAX_SQL_BYTES}; split it` };
  }
  return { ok: true, sql };
}

export const BUSY = /currently processing a long-running import/i;
export const BUSY_WAITS_S = [10, 20, 30, 40, 50];
export const OTHER_WAITS_S = [5];

/**
 * Apply one file, retrying as above.
 * @param {{ db: string, file: string, run: (db: string, file: string) => { ok: boolean, output: string },
 *           sleep: (s: number) => Promise<void>, log: (line: string) => void }} o
 * @returns {Promise<boolean>}
 */
export async function applyWithRetry({ db, file, run, sleep, log }) {
  let busy = 0;
  let other = 0;
  for (;;) {
    const { ok, output } = run(db, file);
    if (ok) return true;
    const isBusy = BUSY.test(output);
    const waits = isBusy ? BUSY_WAITS_S : OTHER_WAITS_S;
    const n = isBusy ? busy++ : other++;
    if (n >= waits.length) {
      log(
        `::error::${db} ${file}: not applied after ${n + 1} tries${isBusy ? ' (another import kept the database busy)' : ''}`
      );
      return false;
    }
    log(
      `::warning::${db} ${file}: ${isBusy ? 'another import is running' : 'failed'}; retrying in ${waits[n]} s`
    );
    await sleep(waits[n]);
  }
}

/** One `wrangler d1 execute --command` for a file's SQL. No shell: the SQL is one argument. */
function commandRunner(sql) {
  return (db) => {
    const r = spawnSync('npx', wranglerArgs(db, sql), { encoding: 'utf8' });
    process.stdout.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    return { ok: r.status === 0, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
  };
}

/**
 * @param {string[]} argv `<DB> <file.sql> [file.sql ...]`
 * @param {{ run?: (sql: string) => (db: string) => { ok: boolean, output: string }, log?: (line: string) => void }} [deps]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, { run = commandRunner, log = (line) => console.log(line) } = {}) {
  const [db, ...files] = argv;
  if (!db || files.length === 0) {
    console.error('usage: d1-seed-staging.mjs <DB|FORMS_DB> <file.sql> [file.sql ...]');
    return 2;
  }
  for (const file of files) {
    const read = sqlForFile(readFileSync(file, 'utf8'));
    if (!read.ok) {
      log(`::error::${db} ${file}: not applied: the file ${read.reason}`);
      return 1;
    }
    const ok = await applyWithRetry({
      db,
      file,
      run: run(read.sql),
      sleep: (s) => new Promise((res) => setTimeout(res, s * 1000)),
      log,
    });
    if (!ok) return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
