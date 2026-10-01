/**
 * INVARIANT: CI Approval-Gate Safety (ADR-020)
 *
 * The human approval gate on Copilot-authored (agent-authored) PRs is kept ON
 * deliberately (ADR-020). Its content confidence must not depend on human
 * vigilance: the set of `secrets.*` reachable by a job that can run on a plain
 * (non-`full-pipeline/*`) pull request must stay within a small, reviewed
 * allowlist, and no workflow may use `pull_request_target`. This makes the
 * approval gate's safety a machine-checked contract — and is the same property
 * (ADR-020 Alternative B) that would make the gate safe to ever remove.
 *
 * This is a META-GATE (deprecation-lock is the pattern): it asserts the
 * enforcement MECHANISM exists and is wired, and lets the scanner do the
 * scanning. The mechanism it protects:
 *   - scripts/check-pr-secret-exposure.mjs            — the scanner (parses every
 *     workflow, computes plain-PR reachability via a GitHub-Actions expression
 *     evaluator + needs-graph, fails on any non-allowlisted PR-reachable secret
 *     or any pull_request_target).
 *   - scripts/check-pr-secret-exposure.allowlist.json — the reviewed, explicit
 *     allowlist of accepted PR-reachable secrets. Infra/deploy creds must never
 *     appear here.
 *   - docs/security/PR_SECRET_EXPOSURE_GUARD.md        — the runbook.
 *   - docs/adr/ADR-020-copilot-ci-human-approval-gate.md — the decision.
 *   - .github/workflows/oursharedevents-ci.yml         — CI wiring: runs the
 *     guard AND its self-tests in the lint shard on every PR.
 *
 * Two property teeth beyond the meta-gate:
 *   - No workflow uses `pull_request_target` (the classic secret-leak trigger).
 *   - Deploy/infra creds (CLOUDFLARE_*, ADMIN_KEY, CF_ACCESS_*, X_OCR_INTERNAL,
 *     FORMS_*, SMOKE_RPT_*) are never keys in the allowlist — you cannot silence
 *     the guard by allowlisting a crown-jewel secret.
 *
 * Born-red honesty: revert the security-regression.yml PR-gate, or add a
 * Cloudflare token to S0, and the guard's own step (not this spec) turns red.
 * This spec turns red if the mechanism is deleted or unwired.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SCANNER = join(REPO_ROOT, 'scripts', 'check-pr-secret-exposure.mjs');
const ALLOWLIST = join(REPO_ROOT, 'scripts', 'check-pr-secret-exposure.allowlist.json');
const RUNBOOK = join(REPO_ROOT, 'docs', 'security', 'PR_SECRET_EXPOSURE_GUARD.md');
const ADR = join(REPO_ROOT, 'docs', 'adr', 'ADR-020-copilot-ci-human-approval-gate.md');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const OSE_CI_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'oursharedevents-ci.yml');
const CODEOWNERS = join(REPO_ROOT, '.github', 'CODEOWNERS');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');

const FORBIDDEN_ALLOWLIST_KEYS = [
  'CLOUDFLARE_API_TOKEN_OSE',
  'CLOUDFLARE_ACCOUNT_ID',
  'ADMIN_KEY',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'X_OCR_INTERNAL',
];
const FORBIDDEN_ALLOWLIST_PREFIXES = ['FORMS_', 'SMOKE_RPT_'];

test.describe('Invariant: CI Approval-Gate Safety (ADR-020)', () => {
  test('OSE-INV-CIGATE | security | scanner | check-pr-secret-exposure.mjs exists', () => {
    expect(
      existsSync(SCANNER),
      'scripts/check-pr-secret-exposure.mjs must exist — it is the PR-secret-exposure scanner'
    ).toBe(true);
  });

  test('OSE-INV-CIGATE | security | scanner | allowlist exists and holds no infra/deploy creds', () => {
    expect(existsSync(ALLOWLIST), 'the reviewed allowlist must exist (fail-closed)').toBe(true);
    const parsed = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    // Secret names are case-insensitive in GitHub, so compare uppercase: a
    // lowercase entry must not slip past the forbidden-key checks.
    const keys = Object.keys((parsed && parsed.approved) || {}).map((k) => k.toUpperCase());
    for (const forbidden of FORBIDDEN_ALLOWLIST_KEYS) {
      expect(
        keys.includes(forbidden),
        `${forbidden} must NEVER be allowlisted as PR-reachable — gate it away from plain PRs instead of silencing the guard`
      ).toBe(false);
    }
    for (const key of keys) {
      for (const prefix of FORBIDDEN_ALLOWLIST_PREFIXES) {
        expect(
          key.startsWith(prefix),
          `${key} matches forbidden prefix ${prefix} — infra/deploy creds may not be allowlisted`
        ).toBe(false);
      }
    }
  });

  test('OSE-INV-CIGATE | security | docs | runbook + ADR-020 exist', () => {
    expect(existsSync(RUNBOOK), 'docs/security/PR_SECRET_EXPOSURE_GUARD.md must exist').toBe(true);
    expect(existsSync(ADR), 'docs/adr/ADR-020-copilot-ci-human-approval-gate.md must exist').toBe(
      true
    );
  });

  test('OSE-INV-CIGATE | security | package.json | guard + self-test scripts registered', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
    expect(
      pkg.scripts && pkg.scripts['guard:pr-secrets'],
      'guard:pr-secrets script must exist'
    ).toBeTruthy();
    expect(pkg.scripts['guard:pr-secrets']).toMatch(/check-pr-secret-exposure\.mjs/);
    expect(
      pkg.scripts && pkg.scripts['test:guard-pr-secrets'],
      'test:guard-pr-secrets (self-test) script must exist'
    ).toBeTruthy();
    expect(pkg.scripts['test:guard-pr-secrets']).toMatch(/--self-test/);
  });

  test('OSE-INV-CIGATE | security | CI | oursharedevents-ci.yml runs the guard AND its self-tests', () => {
    const wf = readFileSync(OSE_CI_WORKFLOW, 'utf8');
    expect(
      /npm\s+run\s+guard:pr-secrets/.test(wf),
      'oursharedevents-ci.yml must invoke `npm run guard:pr-secrets` — a guard that never runs is theater'
    ).toBe(true);
    expect(
      /npm\s+run\s+test:guard-pr-secrets/.test(wf),
      'oursharedevents-ci.yml must invoke `npm run test:guard-pr-secrets` — the self-test guards the scanner'
    ).toBe(true);
  });

  test('OSE-INV-CIGATE | security | trigger | no workflow uses pull_request_target', () => {
    const files = readdirSync(WORKFLOWS_DIR).filter(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml')
    );
    const offenders = files.filter((f) =>
      /pull_request_target\s*:/.test(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'))
    );
    expect(
      offenders,
      `pull_request_target runs base-branch code with secrets on a PR — forbidden. Offenders: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  test('OSE-INV-CIGATE | security | CODEOWNERS | workflows + guard artifacts are review-locked', () => {
    const owners = readFileSync(CODEOWNERS, 'utf8');
    expect(
      /\.github\/workflows\//.test(owners),
      'CODEOWNERS must lock /.github/workflows/ so workflow edits get explicit review'
    ).toBe(true);
    expect(
      /check-pr-secret-exposure/.test(owners),
      'CODEOWNERS must lock the scanner + allowlist so the guard cannot be quietly weakened'
    ).toBe(true);
  });
});
