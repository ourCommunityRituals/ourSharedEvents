#!/usr/bin/env node
// Digest gap-to-ticket gate (OSE-1792). The agent and swarm security digest is
// append-only, so its open gaps drift away from Linear unless something forces the
// mapping to be updated. This checks the "Open gap to ticket" section:
//
//   1. it exists and has at least one row;
//   2. every row names an OSE id, or says "no ticket, decided:" with a reason;
//   3. "Mapped through scan: YYYY-MM-DD" is not older than the newest "## Scan" heading,
//      so appending a scan without revisiting the mapping fails.
//
//   node scripts/ci/check-digest-gap-tickets.mjs [--file <path>]
//
// Exit 0 with "digest gap tickets ok", or 1 with one line per problem.

/* eslint-disable security/detect-non-literal-fs-filename -- reads the digest named by --file, a local path */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT = join('.claude', 'research', 'agent-swarm-security-digest.md');

export function check(text) {
  const t = text.replace(/\r\n/g, '\n');
  const problems = [];

  const scans = [...t.matchAll(/^## Scan (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]).sort();
  const newest = scans[scans.length - 1];

  const start = t.search(/^## Open gap to ticket\s*$/m);
  if (start < 0) return ['the digest has no "## Open gap to ticket" section'];
  const section = t.slice(start).split(/\n## /)[0];

  const mapped = section.match(/^Mapped through scan: (\d{4}-\d{2}-\d{2})\s*$/m);
  if (!mapped) problems.push('the section has no "Mapped through scan: YYYY-MM-DD" line');
  else if (newest && mapped[1] < newest)
    problems.push(`mapped through ${mapped[1]} but the newest scan is ${newest}; update the mapping`);

  // A row may be indented, have one cell, or omit the leading or closing pipe; all are still
  // gap rows. An escaped pipe (\|) stays inside its cell. Any line in the section holding a pipe is read as a row, so a prose line with a
  // pipe fails closed instead of letting a row slip past.
  const rows = section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) =>
      l
        .replace(/^\|/, '')
        .replace(/(?<!\\)\|$/, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, '|').trim())
    )
    .filter((c) => !c.every((x) => /^:?-+:?$/.test(x)) && c[0] !== 'Open gap');
  if (!rows.length) problems.push('the section has no gap rows');
  for (const [gap, ticket = ''] of rows) {
    if (!/\bOSE-\d+\b/.test(ticket) && !/^no ticket, decided: \S/i.test(ticket))
      problems.push(`gap "${gap}" has neither an OSE id nor "no ticket, decided: <reason>"`);
  }
  return problems;
}

function main() {
  const i = process.argv.indexOf('--file');
  const file = i >= 0 ? process.argv[i + 1] : DEFAULT;
  const problems = check(readFileSync(file, 'utf8'));
  if (problems.length) {
    process.stderr.write(problems.map((p) => `digest-gap-tickets: ${p}`).join('\n') + '\n');
    process.exit(1);
  }
  process.stdout.write('digest gap tickets ok\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
