#!/usr/bin/env node
// scripts/apply-branch-protection.mjs
//
// Codify main-branch protection as versioned config so it is reproducible and
// drift-detectable — not an un-versioned imperative API call that can be
// silently removed (the exact gap this repo hit: main shipped unprotected).
//
// Source of truth: tools/ci/main-branch-protection.json
//
// Usage:
//   node scripts/apply-branch-protection.mjs --check          # read live protection, diff vs JSON, exit 1 on drift (CI-safe, read-only, needs repo admin)
//   node scripts/apply-branch-protection.mjs --check-checks   # same for the REQUIRED CHECKS only, readable with the default GITHUB_TOKEN (no admin)
//   node scripts/apply-branch-protection.mjs --apply          # PUT the JSON to GitHub (requires admin on the repo)
//   node scripts/apply-branch-protection.mjs --self-test      # run the pure diff cases
//
// `--check` and `--apply` need the `gh` CLI authenticated with a token that has repo admin.
// `--check-checks` reads GET /branches/main (its `protection` summary), which any
// token with read access sees. It compares the required contexts and flags a
// phantom (app_id null), and it FAILS on an API error rather than skipping.
// Deterministic: no clock, no randomness. Drift check compares the fields we own.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = 'ourCommunityRituals/ourSharedEvents';
const BRANCH = 'main';
const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(HERE, '..', 'tools', 'ci', 'main-branch-protection.json');

function gh(args, input) {
  const res = spawnSync('gh', args, {
    input: input ?? undefined,
    encoding: 'utf8',
    shell: false,
  });
  if (res.error) {
    throw new Error(`gh not runnable: ${res.error.message}`);
  }
  return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function loadConfig() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  // Strip the human-facing comment key before sending to the API.
  const { _comment, ...body } = raw;
  return body;
}

// The subset of protection state we own and assert on. Everything else GitHub
// may add with defaults; we only fail on drift in these fields.
export function normalize(body) {
  const checks = (body.required_status_checks?.checks ?? []).map((c) => c.context).sort();
  return {
    strict: Boolean(body.required_status_checks?.strict),
    checks,
    enforce_admins: Boolean(
      typeof body.enforce_admins === 'object' ? body.enforce_admins?.enabled : body.enforce_admins
    ),
    allow_force_pushes: Boolean(
      typeof body.allow_force_pushes === 'object'
        ? body.allow_force_pushes?.enabled
        : body.allow_force_pushes
    ),
    allow_deletions: Boolean(
      typeof body.allow_deletions === 'object'
        ? body.allow_deletions?.enabled
        : body.allow_deletions
    ),
  };
}

function readLive() {
  const r = gh([
    'api',
    `repos/${REPO}/branches/${BRANCH}/protection`,
    '-H',
    'Accept: application/vnd.github+json',
  ]);
  if (r.code !== 0) {
    if (/Branch not protected/i.test(r.stderr)) {
      return { protected: false };
    }
    throw new Error(`failed to read protection: ${r.stderr.trim()}`);
  }
  return { protected: true, ...JSON.parse(r.stdout) };
}

export function diff(expected, actual) {
  const out = [];
  if (expected.strict !== actual.strict) out.push(`strict: want ${expected.strict}, got ${actual.strict}`);
  if (expected.enforce_admins !== actual.enforce_admins)
    out.push(`enforce_admins: want ${expected.enforce_admins}, got ${actual.enforce_admins}`);
  if (expected.allow_force_pushes !== actual.allow_force_pushes)
    out.push(`allow_force_pushes: want ${expected.allow_force_pushes}, got ${actual.allow_force_pushes}`);
  if (expected.allow_deletions !== actual.allow_deletions)
    out.push(`allow_deletions: want ${expected.allow_deletions}, got ${actual.allow_deletions}`);
  const ec = expected.checks.join('|');
  const ac = actual.checks.join('|');
  if (ec !== ac) out.push(`required checks:\n    want: [${expected.checks.join(', ')}]\n    got:  [${actual.checks.join(', ')}]`);
  return out;
}

/**
 * Required checks as GET /branches/{branch} reports them (its `protection` summary).
 * Returns null when the summary says the branch is unprotected.
 * @param {any} branch response body of GET /repos/{repo}/branches/{branch}
 */
export function checksFromBranchSummary(branch) {
  const prot = branch && branch.protection;
  if (!branch || branch.protected !== true || !prot || prot.enabled !== true) return null;
  const rsc = prot.required_status_checks;
  // Newer responses carry `checks` (context + app_id); older ones only `contexts`.
  if (Array.isArray(rsc?.checks)) {
    return rsc.checks.map((c) => ({ context: c.context, app_id: c.app_id ?? null }));
  }
  return (rsc?.contexts ?? []).map((context) => ({ context, app_id: null }));
}

/**
 * Drift of the required checks only. A required context with app_id null is a
 * phantom: nothing can emit it, so every PR waits on it forever (OSE-1260).
 * @param {string[]} expectedContexts contexts in tools/ci/main-branch-protection.json
 * @param {Array<{context:string, app_id:number|null}>|null} liveChecks null = unprotected
 */
export function diffChecks(expectedContexts, liveChecks) {
  if (liveChecks === null) return ['main is NOT protected (no required checks at all)'];
  const out = [];
  const want = [...expectedContexts].sort();
  const got = liveChecks.map((c) => c.context).sort();
  const missing = want.filter((c) => !got.includes(c));
  const extra = got.filter((c) => !want.includes(c));
  if (missing.length) out.push(`required in the JSON but NOT required live: ${missing.join(', ')}`);
  if (extra.length) out.push(`required live but NOT in the JSON: ${extra.join(', ')}`);
  const phantoms = liveChecks.filter((c) => c.app_id === null).map((c) => c.context);
  if (phantoms.length) {
    out.push(`phantom live context(s), app_id null (nothing emits them): ${phantoms.join(', ')}`);
  }
  return out;
}

function runSelfTest() {
  const real = (context) => ({ context, app_id: 15368 });
  const summary = (checks) => ({
    protected: true,
    protection: { enabled: true, required_status_checks: { checks } },
  });
  const contextsOnly = {
    protected: true,
    protection: { enabled: true, required_status_checks: { contexts: ['A'] } },
  };
  const cases = [
    ['in sync -> no drift', diffChecks(['A', 'B'], [real('B'), real('A')]), 0],
    ['live lacks a required check -> drift', diffChecks(['A', 'B'], [real('A')]), 1],
    ['live has an extra required check -> drift', diffChecks(['A'], [real('A'), real('B')]), 1],
    [
      'phantom (app_id null) live -> drift',
      diffChecks(['A', 'S2'], [real('A'), { context: 'S2', app_id: null }]),
      1,
    ],
    ['unprotected -> drift', diffChecks(['A'], null), 1],
    ['summary: unprotected branch -> null', checksFromBranchSummary({ protected: false }) === null ? [] : ['x'], 0],
    [
      'summary: protection disabled -> null',
      checksFromBranchSummary({ protected: true, protection: { enabled: false } }) === null ? [] : ['x'],
      0,
    ],
    ['summary: checks keep their app_id', diffChecks(['A'], checksFromBranchSummary(summary([real('A')]))), 0],
    [
      'summary: contexts-only response -> every context counts as a phantom',
      diffChecks(['A'], checksFromBranchSummary(contextsOnly)),
      1,
    ],
  ];
  let failed = 0;
  for (const [name, drift, want] of cases) {
    const ok = drift.length === want;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} - ${name} (expected ${want} finding(s), got ${drift.length})`);
  }
  if (failed > 0) {
    process.stderr.write(`\nself-test: ${failed} case(s) failed.\n`);
    process.exit(1);
  }
  console.log(`\nself-test: all ${cases.length} cases passed.`);
}

function checkChecksOnly(body) {
  const r = gh(['api', `repos/${REPO}/branches/${BRANCH}`, '-H', 'Accept: application/vnd.github+json']);
  if (r.code !== 0) {
    // Never a silent skip: a check that cannot read is a check that does not run.
    process.stderr.write(`[branch-protection] cannot read the branch summary: ${r.stderr.trim()}\n`);
    process.exit(1);
  }
  const live = checksFromBranchSummary(JSON.parse(r.stdout));
  const expected = (body.required_status_checks?.checks ?? []).map((c) => c.context);
  const drift = diffChecks(expected, live);
  if (drift.length > 0) {
    process.stderr.write('[branch-protection] REQUIRED-CHECKS DRIFT vs tools/ci/main-branch-protection.json:\n');
    for (const d of drift) process.stderr.write(`  - ${d}\n`);
    process.stderr.write(
      'Re-apply with --apply (needs repo admin) or update the JSON if the change is intended.\n'
    );
    process.exit(1);
  }
  process.stdout.write(
    `[branch-protection] OK - the ${expected.length} required checks live match the JSON, none is a phantom.\n`
  );
  process.exit(0);
}

function main() {
  const mode = process.argv[2];
  if (mode === '--self-test') return runSelfTest();
  const body = loadConfig();
  if (mode === '--check-checks') return checkChecksOnly(body);
  const expected = normalize(body);

  if (mode === '--apply') {
    const r = gh(
      [
        'api',
        '-X',
        'PUT',
        `repos/${REPO}/branches/${BRANCH}/protection`,
        '-H',
        'Accept: application/vnd.github+json',
        '--input',
        '-',
      ],
      JSON.stringify(body)
    );
    if (r.code !== 0) {
      process.stderr.write(`[branch-protection] apply FAILED:\n${r.stderr}\n`);
      process.exit(1);
    }
    process.stdout.write('[branch-protection] applied. Verifying...\n');
  } else if (mode !== '--check') {
    process.stderr.write(
      'usage: node scripts/apply-branch-protection.mjs --check | --check-checks | --apply | --self-test\n'
    );
    process.exit(2);
  }

  const live = readLive();
  if (!live.protected) {
    process.stderr.write(
      '[branch-protection] DRIFT: main is NOT protected. Run with --apply (needs repo admin).\n'
    );
    process.exit(1);
  }
  const actual = normalize(live);
  const drift = diff(expected, actual);
  if (drift.length > 0) {
    process.stderr.write('[branch-protection] DRIFT detected vs tools/ci/main-branch-protection.json:\n');
    for (const d of drift) process.stderr.write(`  - ${d}\n`);
    process.stderr.write('Re-apply with --apply (needs repo admin) or update the JSON if the change is intended.\n');
    process.exit(1);
  }
  process.stdout.write('[branch-protection] OK — live protection matches source of truth.\n');
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
