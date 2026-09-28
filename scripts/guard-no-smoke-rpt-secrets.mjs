#!/usr/bin/env node
/**
 * guard-no-smoke-rpt-secrets.mjs — retirement guard for the static SharedReport
 * smoke tokens (Part of OSE-1389).
 *
 * The T4f "SharedReport Depth Gate" used to authenticate with four long-lived,
 * pre-minted tokens stored as GitHub secrets (SMOKE_RPT_ADMIN/LOCAL/MID/
 * OTHER_EVENT_TOKEN) and minted out-of-band by a retired offline signer — a
 * second, drift-prone copy of the worker's signing. Those desynced from
 * staging's live SHARED_REPORT_SIGNING_SECRET and 401'd the whole gate (the
 * OSE-349 token-shadow family). They are retired in favour of run-time minting
 * via the worker's own POST /api/v2/admin/events/:id/shared-report/mint-link
 * (scripts/mint-t4-report-tokens.mjs).
 *
 * This guard fails CI if either the static-secret reference comes back OR the
 * retired signer file is re-added. It checks the file's EXISTENCE (not a string
 * scan) so prose that documents the retirement does not trip it. It also does
 * NOT flag the bare env-var NAMES (SMOKE_RPT_ADMIN_TOKEN, …) — the run-time mint
 * step still exports those via $GITHUB_ENV, and the depth spec still reads them.
 *
 * Run (real guard):  node scripts/guard-no-smoke-rpt-secrets.mjs
 * Run (self-test):   node scripts/guard-no-smoke-rpt-secrets.mjs --self-test
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Directories a re-introduced static-secret reference could hide in.
const SCAN_DIRS = ['.github', 'scripts'];

// The retired offline signer. Its re-appearance (as a file) is the regression.
const RETIRED_FILES = ['scripts/mint-smoke-rpt-tokens.mjs'];

// `${{ secrets.SMOKE_RPT_… }}` — a pre-minted token injected from a GH secret.
// Anchored so the env-var NAME alone (legitimately still set by the mint step)
// does not trip the guard.
const SECRET_REF_RE = /secrets\.SMOKE_RPT_[A-Z_]+/;
const SECRET_REF_WHY =
  'Static SMOKE_RPT_* GitHub-secret reference — mint per-run via the worker mint-link endpoint instead (OSE-1389).';

const TEXT_EXT = new Set([
  '.yml',
  '.yaml',
  '.mjs',
  '.js',
  '.cjs',
  '.ts',
  '.sh',
  '.json',
  '.md',
  '.txt',
]);

const SELF = fileURLToPath(import.meta.url);

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (TEXT_EXT.has(path.extname(e.name))) acc.push(full);
  }
  return acc;
}

/**
 * @returns {{file:string,line:number,rule:string,why:string,text:string}[]}
 */
function scan(rootDir, dirs) {
  const hits = [];

  // 1. The retired signer file must not exist.
  for (const rf of RETIRED_FILES) {
    if (fs.existsSync(path.join(rootDir, rf))) {
      hits.push({
        file: rf,
        line: 0,
        rule: 'retired-signer-file',
        why: 'The retired offline signer file is back — use scripts/mint-t4-report-tokens.mjs (calls the deployed worker), not a local re-implementation of the signing.',
        text: '(file present)',
      });
    }
  }

  // 2. No static SMOKE_RPT_* GitHub-secret references.
  const files = [];
  for (const d of dirs) walk(path.join(rootDir, d), files);
  for (const file of files) {
    if (path.resolve(file) === SELF) continue; // never flag this guard's own regex
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (SECRET_REF_RE.test(text)) {
        hits.push({
          file: path.relative(rootDir, file),
          line: i + 1,
          rule: 'static-secret-ref',
          why: SECRET_REF_WHY,
          text: text.trim(),
        });
      }
    });
  }
  return hits;
}

function runReal() {
  const hits = scan(REPO_ROOT, SCAN_DIRS);
  if (hits.length === 0) {
    console.log('✓ guard-no-smoke-rpt-secrets: no static SMOKE_RPT_* secrets and no retired signer file.');
    return 0;
  }
  console.error('✗ guard-no-smoke-rpt-secrets: retired SharedReport-token artefacts found:');
  for (const h of hits) {
    const loc = h.line ? `${h.file}:${h.line}` : h.file;
    console.error(`  ${loc}  [${h.rule}]  ${h.text}`);
    console.error(`      → ${h.why}`);
  }
  return 1;
}

// ── Self-test ───────────────────────────────────────────────────────────────
function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (name, cond) => {
    if (cond) {
      pass++;
      console.log(`  ✅ ${name}`);
    } else {
      fail++;
      console.log(`  ❌ ${name}`);
    }
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-smoke-rpt-'));
  try {
    fs.mkdirSync(path.join(tmp, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });

    // Clean tree: bare env NAME only, no retired file → no hits.
    fs.writeFileSync(
      path.join(tmp, '.github', 'workflows', 'clean.yml'),
      'env:\n  SMOKE_RPT_ADMIN_TOKEN: ${{ env.SMOKE_RPT_ADMIN_TOKEN }}\n'
    );
    // Prose mentioning the retired script by name must NOT trip the guard.
    fs.writeFileSync(
      path.join(tmp, 'scripts', 'notes.md'),
      'We retired scripts/mint-smoke-rpt-tokens.mjs in favour of run-time minting.\n'
    );
    check('bare env NAME + prose mention are allowed', scan(tmp, ['.github', 'scripts']).length === 0);

    // Static secret reference → caught.
    fs.writeFileSync(
      path.join(tmp, '.github', 'workflows', 'dirty.yml'),
      'env:\n  SMOKE_RPT_ADMIN_TOKEN: ${{ secrets.SMOKE_RPT_ADMIN_TOKEN }}\n'
    );
    check('static SMOKE_RPT_* secret reference is caught', scan(tmp, ['.github', 'scripts']).some((h) => h.rule === 'static-secret-ref'));

    // Retired signer file re-added → caught.
    fs.writeFileSync(path.join(tmp, 'scripts', 'mint-smoke-rpt-tokens.mjs'), '// resurrected\n');
    check('re-added retired signer FILE is caught', scan(tmp, ['.github', 'scripts']).some((h) => h.rule === 'retired-signer-file'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nguard-no-smoke-rpt-secrets self-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? runSelfTest() : runReal());
