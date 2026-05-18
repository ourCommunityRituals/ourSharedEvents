/**
 * INVARIANT 10: Deprecation Lock
 *
 * Once a runtime is removed (Google Apps Script, Google Sheets, embedded HTML
 * etc.), CI forbids its re-introduction. Without an automated lock, a future
 * "small change" can silently bring back the deprecated dependency — usually
 * because someone copied a snippet from old docs or imported a package that
 * pulls it in transitively — and the entire migration we did to remove it
 * becomes useless overnight.
 *
 * Today's concrete instance: the no-GAS guard. OSE shipped on Cloudflare
 * Workers + D1 (worker-only backend). Google Apps Script is forbidden. The
 * guard at scripts/guard-no-gas.js scans the repo for any reintroduced GAS
 * patterns and fails CI on any hit. This invariant generalizes that pattern
 * — any future deprecation (e.g., embedded HTML when Phase 3 Firebase lands)
 * inherits the same mechanism.
 *
 * The mechanism this invariant protects:
 *   - scripts/guard-no-gas.js           — the scanner. Reads SKIP_PATTERNS to
 *     exclude legitimate documentation, scans real source, fails non-zero on
 *     any GAS pattern not in the allowlist.
 *   - scripts/guard-no-gas.test.js      — self-tests for the scanner. If
 *     someone "simplifies" the scanner and breaks its detection, these tests
 *     catch it before CI does.
 *   - scripts/guard-no-gas.allowlist.json — explicit allowlist of files where
 *     a GAS reference is intentional (clasp config, vendored adapter shims,
 *     etc.). Maintaining this by hand is the cost we accept for the certainty
 *     that no NEW reference can slip in.
 *   - docs/security/NO_GAS_GUARD.md     — runbook explaining what the guard
 *     does, how to add an allowlist entry, and how to extend the pattern to
 *     a future deprecation.
 *   - .github/workflows/oursharedevents-ci.yml — CI wiring. The guard MUST
 *     be invoked in the lint shard alongside check:banned-origins, otherwise
 *     it's a script that exists but never runs (cosmetic compliance).
 *
 * Brain Invariant #10 (deprecation_lock):
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *   - status: partial → live once this test + the CI wiring land
 *
 * What this invariant catches at the structural level:
 *   - Anyone deletes guard-no-gas.js, its tests, or its allowlist → CI fails
 *   - Anyone removes the runbook (NO_GAS_GUARD.md) → CI fails (operators
 *     lose the "how to extend this pattern to the NEXT deprecation" reference)
 *   - The npm script "guard:no-gas" disappears from package.json → CI fails
 *   - The CI workflow stops invoking the guard → CI fails (cosmetic gate)
 *
 * The honesty cost: this test will FAIL until the CI wiring step lands in
 * oursharedevents-ci.yml. That failure is the point — per the three-layer
 * honesty doctrine, tests/execution/verification must surface truth before
 * prod. A "test exists but the gate doesn't run" state is exactly the kind
 * of cosmetic compliance this invariant exists to prevent.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const GUARD_SCRIPT = join(REPO_ROOT, 'scripts', 'guard-no-gas.js');
const GUARD_TESTS = join(REPO_ROOT, 'scripts', 'guard-no-gas.test.js');
const GUARD_ALLOWLIST = join(REPO_ROOT, 'scripts', 'guard-no-gas.allowlist.json');
const GUARD_RUNBOOK = join(REPO_ROOT, 'docs', 'security', 'NO_GAS_GUARD.md');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const OSE_CI_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'oursharedevents-ci.yml');

test.describe('Invariant 10: Deprecation Lock — no-GAS guard as the canonical pattern', () => {
  test('OSE-INV10 | security | scanner | guard-no-gas.js exists', () => {
    expect(
      existsSync(GUARD_SCRIPT),
      'scripts/guard-no-gas.js must exist — it is the canonical deprecation-lock scanner'
    ).toBe(true);
  });

  test('OSE-INV10 | security | scanner | self-tests for the guard exist', () => {
    expect(
      existsSync(GUARD_TESTS),
      'scripts/guard-no-gas.test.js must exist — without it, a "simplification" of the scanner can silently break detection'
    ).toBe(true);
  });

  test('OSE-INV10 | security | scanner | allowlist file exists (explicit, hand-maintained)', () => {
    expect(
      existsSync(GUARD_ALLOWLIST),
      'scripts/guard-no-gas.allowlist.json must exist — the explicit allowlist is what lets the guard fail-closed without breaking legitimate clasp/vendor references'
    ).toBe(true);
  });

  test('OSE-INV10 | security | docs | NO_GAS_GUARD runbook exists', () => {
    expect(
      existsSync(GUARD_RUNBOOK),
      'docs/security/NO_GAS_GUARD.md must exist — the runbook is what teaches the NEXT deprecation how to inherit this pattern'
    ).toBe(true);
  });

  test('OSE-INV10 | security | package.json | guard:no-gas script is registered', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
    expect(
      pkg.scripts && pkg.scripts['guard:no-gas'],
      'package.json must define a "guard:no-gas" script — without it, the CI step has nothing to invoke'
    ).toBeTruthy();
    expect(
      pkg.scripts['guard:no-gas'],
      'guard:no-gas script must invoke the scanner via node'
    ).toMatch(/node\s+scripts[\/\\]guard-no-gas\.js/);
  });

  test('OSE-INV10 | security | CI | oursharedevents-ci.yml invokes the guard', () => {
    expect(existsSync(OSE_CI_WORKFLOW)).toBe(true);
    const wf = readFileSync(OSE_CI_WORKFLOW, 'utf8');
    // Cosmetic-gate trap: a guard that exists in scripts/ but is never invoked
    // by any workflow is worse than no guard at all, because it FEELS like
    // protection. This assertion enforces that the gate actually runs.
    // Acceptable forms: `npm run guard:no-gas` OR direct `node scripts/guard-no-gas.js`.
    const invokesViaNpm = /npm\s+run\s+guard:no-gas/.test(wf);
    const invokesDirectly = /node\s+scripts[\/\\]guard-no-gas\.js/.test(wf);
    expect(
      invokesViaNpm || invokesDirectly,
      'oursharedevents-ci.yml must invoke `npm run guard:no-gas` (or `node scripts/guard-no-gas.js` directly) — a guard that never runs in CI is theater'
    ).toBe(true);
  });
});
