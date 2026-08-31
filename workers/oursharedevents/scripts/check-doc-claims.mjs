#!/usr/bin/env node
/**
 * Doc-claims gate — the reconciliation ratchet, mechanized.
 *
 *   node scripts/check-doc-claims.mjs [--report] [docfile...]
 *
 * A design doc that cites a table, column, route, test ID, or constant is making a
 * checkable claim about the code. Left unchecked those claims rot silently, and the
 * doc keeps being read as truth long after it stopped being true. This repo has the
 * receipts: frontend-principles.md still proposes `how_much` as free-text after the
 * structured price model shipped; @ocr/ui's README describes a WKRP migration that
 * never happened; SYSTEM_MAP.md documents a different product entirely.
 *
 * So: extract every checkable claim from the doc and verify it against the tree.
 * The ratchet only turns one way — a claim that was true when written either stays
 * true or fails here.
 *
 * WHAT IS CHECKED (a claim must be unambiguous to be worth gating):
 *   `backticked_table`      → CREATE TABLE in migrations/
 *   `data-testid="x"`       → emitted in src/ or asserted in tests/
 *   `/api/v2/...` route     → a matching string literal in src/
 *   `CONST = value`         → that exact assignment in src/
 *   `file.ts` / `file.html` → the file exists
 *
 * NOT checked: prose, rationale, design intent, anything in a fenced code block, and
 * GAP/OPEN entries (which assert ABSENCE — see the note on those below).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const docs = args.filter((a) => !a.startsWith('--'));
if (docs.length === 0) {
  console.error('usage: check-doc-claims.mjs [--report] <doc.md...>');
  process.exit(2);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const corpus = (dir) =>
  existsSync(join(root, dir)) ? walk(join(root, dir)).map(read).join('\n') : '';

/**
 * Corpus roots. A doc at the repo root cites files at the repo root — the
 * 0-architecture invariant suite lives at <repo>/tests/e2e/0-architecture/, NOT
 * inside the worker. Scanning only the worker dir produced a false "cited but not
 * found" for pii-retention.invariant.spec.ts, which is exactly how a gate teaches
 * people to ignore it. Both roots are scanned.
 */
const repoRoot = (() => {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: root, encoding: 'utf8' }).trim();
  } catch { return root; }
})();

const ROOTS = [...new Set([root, repoRoot])];
const corpusAll = (dir) =>
  ROOTS.map((r) => (existsSync(join(r, dir)) ? walk(join(r, dir)).map(read).join('\n') : '')).join('\n');

const SRC = corpusAll('src');
const TESTS = corpusAll('tests');
const MIGRATIONS = corpusAll('migrations');
const ALL = SRC + TESTS + MIGRATIONS;

/** Does a file with this basename exist under any scanned root? */
const fileExists = (f) => {
  const bare = f.split('/').pop();
  for (const r of ROOTS) {
    if (existsSync(join(r, f))) return true;
    for (const dir of ['src', 'tests', 'migrations', 'scripts', 'docs']) {
      const base = join(r, dir);
      if (existsSync(base) && walk(base).some((pth) => pth.endsWith(bare))) return true;
    }
  }
  return false;
};

/** Strip fenced code blocks — illustrative, not claims. */
const stripFences = (md) => md.replace(/```[\s\S]*?```/g, '');

const CLAIMS = [
  {
    kind: 'table',
    // snake_case in backticks, at least one underscore, not a column-ish word
    find: (md) => [...md.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+){1,4})`/g)].map((m) => m[1]),
    verify: (name) => new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${name}\\b`).test(MIGRATIONS),
    // Only gate names that actually look like tables we reference as tables.
    only: (name, md) => new RegExp(`(?:INTO|FROM|table|rows? in|\`)\\s*\`?${name}\``, 'i').test(md)
      && new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?[a-z_]+`).test(MIGRATIONS),
    soft: true,
  },
  {
    kind: 'testid',
    find: (md) => [...md.matchAll(/`?data-testid="([^"]+)"`?|`(event-[a-z-]+|pre-sponsor-strip|live-sponsor-strip|post-sponsor-thanks)`/g)]
      .map((m) => m[1] || m[2]).filter(Boolean),
    verify: (id) => ALL.includes(id),
  },
  {
    kind: 'route',
    find: (md) => [...md.matchAll(/`((?:GET |POST |PUT |DELETE )?\/(?:api\/v2|q|s|events|forms)[a-zA-Z0-9/:<>_-]*)`/g)]
      .map((m) => m[1].replace(/^(GET|POST|PUT|DELETE) /, '')),
    verify: (r) => {
      const base = r.split(/[:<]/)[0].replace(/\/$/, '');
      return base.length > 2 && SRC.includes(`'${base}`) || SRC.includes(`"${base}`) || SRC.includes(base);
    },
  },
  {
    kind: 'constant',
    find: (md) => [...md.matchAll(/`([A-Z][A-Z0-9_]{3,})\s*=\s*([0-9]+)`/g)].map((m) => `${m[1]}|${m[2]}`),
    verify: (pair) => {
      const [name, val] = pair.split('|');
      return new RegExp(`${name}\\s*[=:]\\s*${val}\\b`).test(SRC);
    },
  },
  {
    kind: 'file',
    find: (md) => [...md.matchAll(/`((?:src\/|tests\/|migrations\/)?[a-zA-Z0-9._/-]+\.(?:ts|html|sql|json|mjs))`/g)].map((m) => m[1]),
    verify: fileExists,
  },
];

let failures = 0;
let checked = 0;

for (const doc of docs) {
  const raw = read(doc);
  if (!raw) { console.error(`✗ cannot read ${doc}`); failures++; continue; }
  const md = stripFences(raw);
  console.log(`\n${doc}`);

  for (const claim of CLAIMS) {
    const seen = new Set();
    for (const item of claim.find(md)) {
      if (seen.has(item)) continue;
      seen.add(item);
      if (claim.only && !claim.only(item, md)) continue;
      checked++;
      if (!claim.verify(item)) {
        if (claim.soft) { checked--; continue; }
        console.error(`  ✗ ${claim.kind}: ${item.replace('|', ' = ')} — cited but not found in code`);
        failures++;
      }
    }
  }
}

console.log(`\n${checked} claim(s) checked, ${failures} stale.`);
if (failures === 0) console.log('✓ every checkable claim still holds');
// ── Pass 2: stale-ABSENCE suspicion ──────────────────────────────────────────
//
// The existence checks above catch a doc that names something gone. They sail past
// the more dangerous case: a doc that says something is MISSING after it shipped.
// frontend-principles.md is the live example — "HOW MUCH is the one missing field,
// propose free-text" survived the structured price_cents/price_model/price_note
// landing, because no symbol disappeared. A closed gap leaves the doc telling you
// to build what already exists.
//
// That cannot be proven by grep — the capability shipped under different names. What
// CAN be mechanized is suspicion: an absence claim that names a code file, where that
// file has changed since the doc last did, is a paragraph to re-read. This prints a
// worklist, never a failure — a false "go re-read that" costs a minute; a missed one
// costs a rebuild of something that exists.

const gitEpoch = (f) => {
  try {
    return parseInt(execSync(`git log -1 --format=%ct -- "${f}"`, { cwd: root, encoding: 'utf8' }).trim(), 10) || 0;
  } catch { return 0; }
};

const ABSENCE = /\b(GAP|OPEN|missing|not (?:yet )?(?:built|implemented|measurable|exist)|no longer|proposed|planned|deferred|does not exist|absent|structurally absent)\b/i;

let suspicions = 0;
for (const doc of docs) {
  const docTime = gitEpoch(doc);
  if (!docTime) continue;

  // Has the code moved under this doc at all? Coarse on purpose — see below.
  const movedDirs = ['src', 'migrations'].filter((d) => {
    const base = join(root, d);
    if (!existsSync(base)) return false;
    try {
      const t = parseInt(
        execSync(`git log -1 --format=%ct -- "${d}"`, { cwd: root, encoding: 'utf8' }).trim(), 10) || 0;
      return t > docTime;
    } catch { return false; }
  });
  if (movedDirs.length === 0) continue;

  const claims = stripFences(read(doc))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && ABSENCE.test(l) && !l.startsWith('//'));
  if (claims.length === 0) continue;

  console.log(`\n${doc}`);
  console.log(`  ${movedDirs.join(' + ')} changed after this doc — re-read its ${claims.length} absence claim(s):`);
  for (const c of claims.slice(0, 25)) {
    console.log(`    ? ${c.replace(/\s+/g, ' ').slice(0, 130)}`);
    suspicions++;
  }
  if (claims.length > 25) console.log(`    … and ${claims.length - 25} more`);
}

if (suspicions === 0) {
  console.log('\n✓ no absence claims need re-reading');
} else {
  console.log(`\n${suspicions} absence claim(s) to re-read by hand. A worklist, not a failure.`);
  console.log(
    'Deliberately coarse. The case that motivated this — frontend-principles.md calling\n' +
    'HOW MUCH "the one missing field" after price_cents/price_model/price_note shipped —\n' +
    'is invisible to any grep: the capability landed under different names, so no symbol\n' +
    'went missing and no cited file moved. Semantics catch that; string matching cannot.\n' +
    'So this asks a human to look rather than pretending to decide. A false "go re-read"\n' +
    'costs a minute. A missed one costs rebuilding something that already exists.'
  );
}

process.exit(failures > 0 && !reportOnly ? 1 : 0);
