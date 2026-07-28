/**
 * INVARIANT 11: Self-Hosted Runner Bash Resolution
 *
 * On Windows self-hosted runners, `bash` MUST resolve to Git Bash, never WSL
 * bash. WSL bash treats `\` in Windows paths as an escape character, so the
 * script-file paths the runner generates (full of backslashes) get corrupted
 * the moment they're passed to any `shell: bash` step. The result is a 4-second
 * failure with a mangled path like
 *   "/bin/bash: C:UsersmzdandevourCommunityRitualsactions-runner-2_work_temp...sh:
 *    No such file or directory"
 * and zero downstream test signal — the runner looks "broken" without telling
 * you why.
 *
 * The mechanism that prevents this failure mode:
 *   - tools/runner/provision-runner.ps1  — writes the runner's `.env` file to
 *     pin PATH so Git Bash wins the lookup race
 *   - tools/runner/verify-runner-env.ps1 — fast preflight that checks the
 *     active PATH (or a runner's .env) resolves `bash` to Git Bash, with
 *     actionable banners on failure
 *   - .github/workflows/runner-env-validation.yml — CI workflow that runs
 *     verify-runner-env.ps1 on every PR + push-to-main on self-hosted, so a
 *     newly-provisioned runner can't accept production workflows until it
 *     passes the env check
 *   - tools/runner/README.md — runbook documenting the 7-step "add a new
 *     runner" procedure so a fresh runner is always provisioned the same way
 *
 * Brain Invariant #11 (self_hosted_runner_bash_resolution):
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * What this invariant catches at the structural level:
 *   - Anyone deletes provision-runner.ps1 or verify-runner-env.ps1 → CI fails
 *   - Anyone removes the runner-env-validation workflow → CI fails
 *   - Anyone neuters the verifier so it no longer detects WSL bash → CI fails
 *   - Anyone changes the workflow to run on `ubuntu-latest` (defeating the
 *     whole point — the issue is Windows-specific) → CI fails
 *   - The runbook README disappears → CI fails (new runners get added without
 *     consistent procedure → silent breakage when next PR hits the runner)
 *
 * Pattern reference: tier-equity.invariant.spec.ts — structural assertions
 * read source files from disk (Playwright runs with Node fs access).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const RUNNER_TOOLS_DIR = join(REPO_ROOT, 'tools', 'runner');
const PROVISION_SCRIPT = join(RUNNER_TOOLS_DIR, 'provision-runner.ps1');
const VERIFY_SCRIPT = join(RUNNER_TOOLS_DIR, 'verify-runner-env.ps1');
const SETUP_SCRIPT = join(RUNNER_TOOLS_DIR, 'setup-runner.ps1');
const RUNNER_README = join(RUNNER_TOOLS_DIR, 'README.md');
const VALIDATION_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'runner-env-validation.yml');

test.describe('Invariant 11: Self-Hosted Runner Bash Resolution — env contract', () => {
  test('OSE-INV11 | infra | scripts | provision-runner.ps1 exists in tools/runner/', () => {
    expect(
      existsSync(PROVISION_SCRIPT),
      "tools/runner/provision-runner.ps1 must exist — it writes each runner's .env so bash resolves to Git Bash before WSL"
    ).toBe(true);
  });

  test('OSE-INV11 | infra | scripts | verify-runner-env.ps1 exists in tools/runner/', () => {
    expect(
      existsSync(VERIFY_SCRIPT),
      'tools/runner/verify-runner-env.ps1 must exist — it is the runtime preflight invoked by the CI workflow'
    ).toBe(true);
  });

  test('OSE-INV11 | infra | scripts | verify-runner-env.ps1 detects WSL bash and fails non-zero', () => {
    const verifier = readFileSync(VERIFY_SCRIPT, 'utf8');
    // The detection MUST look at the resolved bash path for the WindowsApps
    // shim location (where both WSL bash.exe and the Store shim live). If
    // someone "simplifies" the script and drops the WindowsApps check, the
    // entire invariant is defeated — the verifier would always pass.
    expect(
      verifier,
      'verify-runner-env.ps1 must detect WSL bash via the WindowsApps path marker'
    ).toMatch(/WindowsApps/);
    // The verifier MUST exit non-zero when WSL bash wins, otherwise the CI
    // gate becomes purely cosmetic.
    expect(
      verifier,
      'verify-runner-env.ps1 must exit non-zero (exit 1) when WSL bash is resolved'
    ).toMatch(/exit\s+1/);
  });

  test('OSE-INV11 | infra | docs | runbook README documents the provisioning contract', () => {
    expect(
      existsSync(RUNNER_README),
      'tools/runner/README.md must exist — without it, new runners get added inconsistently and silently break'
    ).toBe(true);
    const readme = readFileSync(RUNNER_README, 'utf8');
    // Two load-bearing references the runbook MUST keep visible.
    expect(readme, 'runbook must cite brain invariant id 11').toMatch(/invariant\s+id\s+11/i);
    expect(readme, 'runbook must reference provision-runner.ps1 (the canonical fix step)').toMatch(
      /provision-runner\.ps1/
    );
  });

  test('OSE-INV11 | infra | CI | runner-env-validation workflow exists', () => {
    expect(
      existsSync(VALIDATION_WORKFLOW),
      '.github/workflows/runner-env-validation.yml must exist — it is what blocks a misconfigured runner from accepting production workflows'
    ).toBe(true);
  });

  test('OSE-INV11 | infra | CI | validation workflow runs on every PR + push-to-main on self-hosted', () => {
    const wf = readFileSync(VALIDATION_WORKFLOW, 'utf8');
    // pull_request trigger is non-negotiable — the workflow exists to catch
    // the misconfig BEFORE merge, not after.
    expect(wf, 'validation workflow must trigger on pull_request').toMatch(/^\s*pull_request\s*:/m);
    // push to main keeps the gate honest for hotfixes that bypass PR review.
    expect(
      wf,
      'validation workflow must trigger on push to main (catches hotfix bypasses)'
    ).toMatch(/branches:\s*\[\s*main\s*\]/);
    // Must run on the same self-hosted pool whose env we're validating —
    // running this on ubuntu-latest would defeat the entire invariant.
    expect(wf, 'validation workflow must run on self-hosted (the env being validated)').toMatch(
      /runs-on:\s*self-hosted/
    );
    // The workflow MUST actually invoke the verifier — a workflow that
    // exists but doesn't call the script is theater.
    expect(
      wf,
      'validation workflow must invoke verify-runner-env.ps1 (otherwise it is cosmetic)'
    ).toMatch(/verify-runner-env\.ps1/);
  });

  test('OSE-INV11 | infra | CI | validation workflow includes the bash-path smoke step', () => {
    const wf = readFileSync(VALIDATION_WORKFLOW, 'utf8');
    // After the verifier, the workflow runs a deliberate `shell: bash` step
    // that touches RUNNER_TEMP. Reaching that step is itself proof that the
    // runner can execute bash-shelled steps without path corruption. Removing
    // this step would let a misconfig pass the cosmetic verifier and still
    // ship.
    expect(
      wf,
      'validation workflow must include the deliberate shell: bash smoke step (RUNNER_TEMP probe)'
    ).toMatch(/shell:\s*bash[\s\S]*RUNNER_TEMP/);
  });

  test('OSE-INV11 | infra | scripts | setup-runner.ps1 exists — one-shot post-config.cmd provisioning', () => {
    // setup-runner.ps1 is the partial→live gate for invariant #11: it chains
    // provision-runner.ps1 + install-janitor-tasks.ps1 + verify-runner-env.ps1
    // so all three steps run automatically after config.cmd registration.
    // Without this script, an operator must remember to run provision-runner.ps1
    // manually — the gap that kept #11 partial.
    expect(
      existsSync(SETUP_SCRIPT),
      'tools/runner/setup-runner.ps1 must exist — it is the one-shot script that satisfies ' +
        'the invariant #11 partial→live criterion (provisioner auto-invoked after config.cmd)'
    ).toBe(true);

    const src = readFileSync(SETUP_SCRIPT, 'utf8');
    expect(src, 'setup-runner.ps1 must invoke provision-runner.ps1').toMatch(
      /provision-runner\.ps1/
    );
  });
});
