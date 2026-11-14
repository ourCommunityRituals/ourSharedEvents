#!/usr/bin/env node
// Check a cut street-map archive before it is loaded into R2
// (docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md). Reads the local file with the
// Worker's own reader and drawing; see scripts/street-map-archive/check.ts.
//
//   node scripts/check-street-map-archive.mjs <file.pmtiles> [--cells=<h3>,<h3>,…]
//
// `--cells` adds one more draw that must show roads, for example the areas the
// staging landing page draws today. Exit 0: the file passed and
// `<file>.check.json` holds the record. Exit 1: it did not; do not upload it.
// It reads the file only; it uploads nothing and needs no Cloudflare login.

/* global console, process */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const cells = args.find((a) => a.startsWith('--cells='))?.slice('--cells='.length) ?? '';

if (!file || !existsSync(file)) {
  console.error(
    file
      ? `No such file: ${file}`
      : 'Usage: node scripts/check-street-map-archive.mjs <file.pmtiles> [--cells=<h3>,<h3>,…]'
  );
  process.exit(1);
}
if (cells && !cells.split(',').every((c) => /^[0-9a-f]{15}$/.test(c))) {
  console.error('--cells takes H3 cell ids separated by commas');
  process.exit(1);
}

let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workerRoot, encoding: 'utf8' }).trim();
} catch {
  // Not a git checkout: the record says the reader's commit is unknown.
}

const vitest = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs'
);
const archive = resolve(file);
const recordPath = `${archive}.check.json`;
// A record from an earlier run must not stand in for this one.
rmSync(recordPath, { force: true });

console.log(`Checking ${archive} (hashing and walking a large file takes minutes) …`);
const run = spawnSync(
  process.execPath,
  [vitest, 'run', '--config', 'vitest.archive-check.config.mts'],
  {
    cwd: workerRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      STREET_MAP_ARCHIVE_FILE: archive,
      STREET_MAP_ARCHIVE_CELLS: cells,
      STREET_MAP_CHECK_COMMIT: commit,
    },
  }
);

if (!existsSync(recordPath)) {
  // The check did not get as far as its record: show why.
  console.error(`${run.stdout ?? ''}${run.stderr ?? ''}`);
  console.error(
    'NOT CHECKED: the check stopped before it wrote a record. Do not upload this file.'
  );
  process.exit(1);
}

const record = JSON.parse(readFileSync(recordPath, 'utf8'));
const passed = record.pass === true && run.status === 0;
const lines = [
  `file     ${record.file}`,
  `bytes    ${record.bytes}`,
  `sha256   ${record.sha256}`,
  `reader   ${record.readerCommit ?? 'unknown commit'}`,
  `header   ${JSON.stringify(record.header)}`,
  `layout   ${JSON.stringify(record.directories)}`,
  ...record.draws.map(
    (d) =>
      `draw     ${d.ok ? 'ok  ' : 'FAIL'} ${d.name}: ${d.got}` +
      `${d.zoom === null ? '' : ` z${d.zoom}`}, ${d.reads} reads, ${d.bytes} bytes, ${d.ms} ms`
  ),
  `record   ${recordPath}`,
  passed
    ? 'PASS'
    : `PROBLEMS\n  ${record.problems.join('\n  ') || 'the check failed without naming a problem'}\nDo not upload this file.`,
];
console.log(lines.join('\n'));
process.exit(passed ? 0 : 1);
