#!/usr/bin/env node
// Phone audit scope.
//
// "Mobile workability — PR code" is a required check, so its job starts on every
// pull request (a required check that can skip blocks every PR that skips it).
// This decides whether the PR changes anything the audit measures. When it does
// not, the job says so and passes without booting a worker.
//
// Unknown is treated as "run": an empty list means the changed files could not
// be read, and a required check that passes without looking is the failure this
// file exists to avoid.
//
//   gh pr diff <number> --name-only | node scripts/ci/phone-audit-scope.mjs
//   -> prints `run=true` or `run=false` (GITHUB_OUTPUT format)

import { fileURLToPath } from 'node:url';

/** Anything under these, or exactly these, is something the audit boots, loads or runs. */
const MEASURED = [
  // The Worker the audit starts: pages, handlers, libs, schema, config, deps.
  'workers/oursharedevents/src/',
  'workers/oursharedevents/migrations/',
  'workers/oursharedevents/migrations-forms/',
  'workers/oursharedevents/wrangler.toml',
  'workers/oursharedevents/package.json',
  'workers/oursharedevents/package-lock.json',
  // The audit: specs, helpers, global setup, configs.
  'tests/playwright/',
  'playwright.mobile.config.ts',
  'playwright.config.ts',
  // The shared stylesheet and tokens reach this repo only as a pin bump.
  '.ocr-hub-ref',
  'scripts/ci-stage-ocr-workspace.sh',
  // Root deps (Playwright itself) and the job's own wiring.
  'package.json',
  'package-lock.json',
  '.github/workflows/mobile-workability-audit.yml',
  'scripts/ci/phone-audit-scope.mjs',
];

/** @param {string[]} files changed paths, repo-relative */
export function auditIsInScope(files) {
  const paths = files.map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean);
  if (!paths.length) return true;
  return paths.some((p) => MEASURED.some((m) => (m.endsWith('/') ? p.startsWith(m) : p === m)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    process.stdout.write(`run=${auditIsInScope(input.split('\n'))}\n`);
  });
}
