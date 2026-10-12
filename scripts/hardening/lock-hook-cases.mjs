#!/usr/bin/env node
// Ratchet for the policy gate's test cases.
//
//   node scripts/hardening/lock-hook-cases.mjs --check   # fail if a rule has fewer must-block cases than locked
//   node scripts/hardening/lock-hook-cases.mjs --write   # record the current counts (run after ADDING cases)
//
// .claude/hooks/policy-gate.cases.lock.json holds, per rule, how many must-block cases the suite
// had. A pull request that weakens a rule and deletes its cases to keep the suite green has to
// lower a number in that file too, which is a visible line in the diff (the review sees it) and is
// what tests/integration/policy-gate-wired.test.js enforces. Counts only go down on purpose.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUITE = join(ROOT, '.claude', 'hooks', 'policy-gate.test.mjs');
const LOCK = join(ROOT, '.claude', 'hooks', 'policy-gate.cases.lock.json');

export function mustBlockCounts(src) {
  const start = src.indexOf('const MUST_BLOCK = [');
  const end = src.indexOf('const MUST_ALLOW = [');
  const section = src.slice(start, end);
  const counts = {};
  for (const m of section.matchAll(/^\s*\[\s*['"]([a-z0-9-]+)['"],/gm)) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function suiteTestCount() {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', SUITE], {
    encoding: 'utf8',
  });
  return Number((r.stdout.match(/ℹ tests (\d+)/) ?? [])[1] ?? NaN);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const mode = process.argv[2];
  const now = mustBlockCounts(readFileSync(SUITE, 'utf8'));
  if (mode === '--write') {
    const tests = suiteTestCount();
    writeFileSync(LOCK, JSON.stringify({ tests, mustBlock: now }, null, 2) + '\n');
    console.log(`locked ${Object.keys(now).length} rules, ${tests} tests`);
  } else if (mode === '--check') {
    const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
    const fewer = Object.entries(lock.mustBlock).filter(([rule, n]) => (now[rule] ?? 0) < n);
    for (const [rule, n] of fewer)
      console.error(`${rule}: ${now[rule] ?? 0} must-block case(s), locked ${n}`);
    process.exit(fewer.length ? 1 : 0);
  } else {
    console.error('usage: lock-hook-cases.mjs --check | --write');
    process.exit(2);
  }
}
