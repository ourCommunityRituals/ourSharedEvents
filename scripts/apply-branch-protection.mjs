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
//   node scripts/apply-branch-protection.mjs --check   # read live protection, diff vs JSON, exit 1 on drift (CI-safe, read-only)
//   node scripts/apply-branch-protection.mjs --apply   # PUT the JSON to GitHub (requires admin on the repo)
//
// Requires the `gh` CLI authenticated with a token that has repo admin.
// Deterministic: no clock, no randomness. Drift check compares the fields we own.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
function normalize(body) {
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

function diff(expected, actual) {
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

function main() {
  const mode = process.argv[2];
  const body = loadConfig();
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
    process.stderr.write('usage: node scripts/apply-branch-protection.mjs --check | --apply\n');
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

main();
