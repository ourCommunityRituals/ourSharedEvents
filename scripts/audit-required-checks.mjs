/**
 * Required-checks phantom audit — OSE-1261.
 *
 * OSE-1260: a required status context with `app_id: null` — emitted by nothing
 * (self-hosted-retirement residue from OSE-1194) — silently blocked EVERY PR to
 * `main`, surfacing only when an owner manually eyeballed a stuck PR. The
 * gate-execution reconciler (OSE-1255) asserts every expected JOB ran; this
 * companion asserts every REQUIRED CONTEXT is one that something can actually
 * emit.
 *
 * A real GitHub-Actions gate carries a concrete `app_id` (15368 here); a phantom
 * required context has `app_id === null`. We flag those and print the exact
 * de-require remediation. De-requiring is an owner branch-protection decision —
 * this only REPORTS; it never mutates protection and never fabricates a green for
 * the phantom (that would be a vacuous gate, cf OSE-1056).
 *
 * `findPhantomContexts` is pure + import-safe (the CLI entrypoint is isMain-
 * guarded), so the born-red case runs both as `--self-test` and in the
 * tests/unit shard (tests/unit/ci/required-checks-audit.test.js).
 *
 * Usage (CI, in a job with `permissions: administration: read`):
 *   GH_TOKEN=... REPO=owner/name node scripts/audit-required-checks.mjs
 *   node scripts/audit-required-checks.mjs --self-test
 */

import { execFileSync } from 'node:child_process';

/**
 * Required contexts that nothing can emit — a real Actions/App check has a
 * concrete `app_id`; a phantom has `app_id === null`.
 * @param {Array<{context: string, app_id: number|null}>} checks
 * @returns {string[]} phantom context names
 */
export function findPhantomContexts(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.filter((c) => c && c.app_id === null).map((c) => c.context);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runSelfTest() {
  const cases = [
    ['all real (app_id set) → none', [
      { context: 'S0 Security', app_id: 15368 },
      { context: 'T0 Gate (tests)', app_id: 15368 },
    ], []],
    ['OSE-1260 payload: S2 phantom among reals → flagged', [
      { context: 'S0 Security', app_id: 15368 },
      { context: 'T0 Gate (lint)', app_id: 15368 },
      { context: 'S2 Post-Execution Security', app_id: null },
      { context: 'Gate-execution reconciler', app_id: 15368 },
    ], ['S2 Post-Execution Security']],
    ['empty → none', [], []],
    ['non-array → none', null, []],
  ];
  let failed = 0;
  for (const [name, checks, expected] of cases) {
    const got = findPhantomContexts(checks);
    const pass = JSON.stringify(got) === JSON.stringify(expected);
    if (!pass) failed++;
    console.log(
      `${pass ? 'PASS' : 'FAIL'} — ${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)})`
    );
  }
  if (failed > 0) fail(`\nself-test: ${failed} case(s) failed.`);
  console.log(`\nself-test: all ${cases.length} cases passed.`);
}

function main() {
  const repo = process.env.REPO || process.env.GITHUB_REPOSITORY;
  if (!repo) fail('required-checks-audit: REPO / GITHUB_REPOSITORY not set.');
  const endpoint = `repos/${repo}/branches/main/protection/required_status_checks`;

  let payload;
  try {
    const out = execFileSync('gh', ['api', endpoint], { encoding: 'utf8' });
    payload = JSON.parse(out);
  } catch (e) {
    // Graceful, never a false-red: a fork PR or a token without
    // `administration: read` returns 403/404. We cannot audit, so we warn and
    // pass — the audit only ever goes red on a REAL detected phantom, never on a
    // permission/API hiccup.
    const detail = (e && e.stderr ? e.stderr.toString() : e && e.message) || '';
    console.warn(
      'required-checks-audit: could not read branch protection (needs ' +
        '`permissions: administration: read`; forks / fork-PRs cannot). ' +
        'Skipping — not a failure.\n' +
        detail.trim()
    );
    process.exit(0);
  }

  const checks = payload.checks || [];
  const phantoms = findPhantomContexts(checks);
  console.log(`required-checks-audit: ${checks.length} required context(s) on main.`);
  if (phantoms.length === 0) {
    console.log(
      '✅ required-checks-audit: every required context maps to an emitting app (no phantoms).'
    );
    process.exit(0);
  }
  fail(
    `❌ required-checks-audit: ${phantoms.length} PHANTOM required context(s) — ` +
      'app_id:null, emitted by nothing, so every PR is BLOCKED waiting on a status ' +
      'that can never report (cf OSE-1260):\n' +
      phantoms.map((c) => `  - "${c}"`).join('\n') +
      '\n\nDe-require each (owner branch-protection decision — do NOT fabricate a green):\n' +
      phantoms
        .map(
          (c) =>
            `  gh api --method DELETE "repos/${repo}/branches/main/protection/required_status_checks/contexts" -f "contexts[]=${c}"`
        )
        .join('\n')
  );
}

// ── entrypoint ────────────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('audit-required-checks.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else main();
}
