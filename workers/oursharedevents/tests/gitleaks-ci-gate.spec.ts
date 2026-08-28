/**
 * TL-016 — Committed-secret CI gate (prevent silent removal)
 *
 * Threat: "Secrets committed to tree: credential-shaped string committed
 * to any branch" (historical basis: ADMIN_KEY committed during early dev).
 *
 * This test locks the committed-secret scanner into the CI pipeline so the
 * ADMIN_KEY class of incident cannot slip through if the gate is silently
 * removed or downgraded to advisory.
 *
 * MECHANISM CHANGE (OSE-911): the gate was gitleaks, whose go-re2/wazero WASM
 * JIT panicked nondeterministically on the self-hosted Windows runners. It is
 * now `detect-secrets` (pure Python, no WASM JIT — stable there), promoted to an
 * ENFORCING baseline gate via `scripts/check-secrets-baseline.py` +
 * `.secrets.baseline`. The threat and this test's intent are unchanged; only the
 * tool moved. (Filename kept to avoid threat-ledger / registry churn.)
 *
 * Source gate: reads the CI workflow yaml, the gate script, and the committed
 * baseline from TEST_SOURCE_FILES_JSON and asserts structural properties.
 *
 * @born-red TL-016 | method: design-time-negative-assertion | date: 2026-08-06
 *
 * Properties asserted:
 *   1. CI workflow invokes the gate script (scripts/check-secrets-baseline.py)
 *   2. pre-exec coverage in S0 + a non-vacuous post-exec tamper tripwire in the
 *      execution-job tail (OSE-1056/1057). The old S2 detect-secrets re-scan was
 *      VACUOUS — its job re-ran `actions/checkout` (git checkout --force), resetting
 *      the tree to the committed SHA and ERASING any execution-phase injection
 *      before it scanned; post-exec coverage is now scripts/check-post-execution-
 *      integrity.sh, run against the PRESERVED workspace (no re-checkout).
 *   3. detect-secrets is version-pinned (baseline can't be silently reclassified)
 *   4. the committed .secrets.baseline exists and is valid (accepted-detection set)
 *   5. the gate script is ENFORCING — fails (exit non-zero) on a NEW secret
 *   6. the gate keys on hashed_secret vs the baseline (blocking, not advisory)
 *   7. the script allowlists test fixtures (spec files + vitest config + lockfile)
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function getSourceFile(suffix: string): string | null {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) => p.replace(/\\/g, '/').endsWith(suffix));
  return entry ? entry[1] : null;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('TL-016 | Committed-secret CI gate — prevent silent removal', () => {
  test('CI workflow invokes the committed-secret gate script', () => {
    const ci = getSourceFile('.github/workflows/oursharedevents-ci.yml');
    expect(ci, 'oursharedevents-ci.yml not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(ci).toContain('scripts/check-secrets-baseline.py');
  });

  test('pre-exec secret gate in S0 + non-vacuous post-exec integrity tripwire (OSE-1056/1057)', () => {
    const ci = getSourceFile('.github/workflows/oursharedevents-ci.yml') ?? '';
    // Pre-execution: the committed-secret gate scans the tree BEFORE any untrusted
    // code runs (S0). This catches the ADMIN_KEY-class threat at its source.
    expect(
      countOccurrences(ci, 'scripts/check-secrets-baseline.py'),
      'the committed-secret gate must run pre-execution in S0'
    ).toBeGreaterThanOrEqual(1);
    // Post-execution: the OLD S2 detect-secrets re-scan was a vacuous seam — its
    // job re-ran `actions/checkout` (git checkout --force), which reset the tree to
    // the committed SHA and ERASED any execution-phase injection before the scan.
    // OSE-1056/1057 replaced it with an integrity tripwire at the TAIL of the
    // execution job, run against the PRESERVED workspace (no re-checkout): it fails
    // on ANY tracked-file mutation, src/migrations injection, or lockfile tamper
    // during execution — which SUBSUMES a secret written into the tree, and does so
    // non-vacuously. Non-vacuousness is regression-locked by
    // tests/unit/security/post-execution-integrity.test.js.
    expect(
      countOccurrences(ci, 'scripts/check-post-execution-integrity.sh'),
      'post-execution tamper coverage must be wired as an integrity tripwire in the execution-job tail'
    ).toBeGreaterThanOrEqual(1);
  });

  test('detect-secrets is version-pinned (baseline cannot be silently reclassified)', () => {
    const ci = getSourceFile('.github/workflows/oursharedevents-ci.yml') ?? '';
    // A pinned version keeps a scanner upgrade from reclassifying the baseline.
    expect(ci).toMatch(/detect-secrets==\d+\.\d+\.\d+/);
  });

  test('the committed .secrets.baseline exists and is a valid baseline', () => {
    const baseline = getSourceFile('.secrets.baseline');
    expect(baseline, '.secrets.baseline not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    const parsed = JSON.parse(baseline as string);
    // The baseline is the committed set of accepted detections; the gate fails
    // only on secrets NOT in here.
    expect(parsed).toHaveProperty('results');
  });

  test('the gate script is ENFORCING — fails on a NEW secret (blocking, not advisory)', () => {
    const script = getSourceFile('scripts/check-secrets-baseline.py');
    expect(script, 'scripts/check-secrets-baseline.py not found').not.toBeNull();
    // Non-zero exit on a new secret is what makes this a gate rather than a warning.
    expect(script).toContain('return 1');
    expect(script).toContain('::error::');
  });

  test('the gate keys on hashed_secret vs the baseline (immune to line churn)', () => {
    const script = getSourceFile('scripts/check-secrets-baseline.py') ?? '';
    // A NEW secret = a (file, hashed_secret) pair not in the baseline.
    expect(script).toContain('hashed_secret');
    expect(script).toMatch(/pairs\([^)]*current[^)]*\)\s*-\s*pairs\([^)]*base/);
  });

  test('the gate allowlists test fixtures (spec files, vitest config, lockfile)', () => {
    const script = getSourceFile('scripts/check-secrets-baseline.py') ?? '';
    // Predictable test credentials must not create false-positive noise —
    // the EXCLUDES cover spec files, vitest config, and the lockfile.
    expect(script).toContain('spec');
    expect(script).toContain('vitest');
    expect(script).toContain('package-lock');
  });
});
