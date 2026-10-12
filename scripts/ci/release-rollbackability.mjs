#!/usr/bin/env node
/**
 * Is this release roll-back-able? (CCR 2026-10-12, finding A1.)
 *
 * A rollback puts the previous Worker on the new database. If a migration in the
 * release removed or renamed something the old code reads, that Worker cannot
 * run, and "roll back" is not an option: the answer is to fix forward
 * (docs/runbooks/ROLLBACK.md section 0 and section 2).
 *
 * This reads the migration files a release is about to apply and lists the ones
 * that remove a table or a column or rename either. It is information for the
 * operator, not a gate: it always exits 0.
 *
 *   wrangler d1 migrations list DB --env production --remote \
 *     | node scripts/ci/release-rollbackability.mjs --dir workers/oursharedevents/migrations --label DB
 *
 * The migration names are taken from stdin (any text; every NNNN_name.sql in it
 * counts). Comments in the SQL are ignored.
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HAZARDS = [
  [/\bDROP\s+TABLE\b/i, 'removes a table'],
  [/\bDROP\s+COLUMN\b/i, 'removes a column'],
  [/\bALTER\s+TABLE\s+\S+\s+RENAME\s+COLUMN\b/i, 'renames a column'],
  [/\bALTER\s+TABLE\s+\S+\s+RENAME\s+TO\b/i, 'renames a table'],
];

/** SQL with `--` comments removed, so words in a comment are not read as statements. */
export function stripComments(sql) {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** What one migration's SQL does that an older Worker cannot survive. */
export function hazardsOf(sql) {
  const code = stripComments(sql);
  return HAZARDS.filter(([re]) => re.test(code)).map(([, what]) => what);
}

/** Migration file names (NNNN_name.sql) found in free text, in order, without repeats. */
export function namesIn(text) {
  return [...new Set(String(text).match(/\b\d{4}_[A-Za-z0-9_.-]+?\.sql\b/g) ?? [])].sort();
}

/**
 * @param {string[]} names migration files the release will apply
 * @param {(name: string) => string | null} read contents of one file, or null when absent
 */
export function assess(names, read) {
  const findings = [];
  const unreadable = [];
  for (const name of names) {
    const sql = read(name);
    if (sql === null) {
      unreadable.push(name);
      continue;
    }
    const what = hazardsOf(sql);
    if (what.length) findings.push({ name, what });
  }
  return {
    checked: names.length,
    findings,
    unreadable,
    rollbackable: findings.length === 0 && unreadable.length === 0,
  };
}

export function render(label, result) {
  const lines = [`### Rollback-ability: ${label}`, ''];
  if (result.checked === 0) {
    lines.push('No unapplied migrations: this release adds nothing the old code could not run on.');
    return lines.join('\n');
  }
  if (result.rollbackable) {
    lines.push(
      `${result.checked} migration(s) to apply, none removes or renames anything: a rollback is possible.`
    );
    return lines.join('\n');
  }
  lines.push(
    '**NOT ROLL-BACK-ABLE.** The previous Worker cannot run once these are applied. A no-go means fix forward.',
    ''
  );
  for (const f of result.findings) lines.push(`- \`${f.name}\`: ${f.what.join(', ')}`);
  for (const n of result.unreadable)
    lines.push(`- \`${n}\`: file not found, so it could not be read; treat as not roll-back-able`);
  return lines.join('\n');
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dir = arg('--dir');
  const label = arg('--label') ?? 'migrations';
  if (!dir) {
    console.error(
      'usage: release-rollbackability.mjs --dir <migrations dir> [--label <name>]  (names on stdin)'
    );
    return 2;
  }
  let stdin = '';
  try {
    stdin = readFileSync(0, 'utf8');
  } catch {
    stdin = '';
  }
  const names = namesIn(stdin);
  const result = assess(names, (n) => {
    const f = join(dir, n);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  });
  const out = render(label, result);
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out}\n\n`);
  if (!result.rollbackable && result.checked > 0)
    console.log('::warning::' + `${label}: this release is not roll-back-able`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = main(process.argv.slice(2));
