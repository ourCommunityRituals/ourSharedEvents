/**
 * TL-016 — Gitleaks CI integration gate
 *
 * Threat: "Secrets committed to tree: credential-shaped string committed
 * to any branch"
 *
 * Historical basis: ADMIN_KEY was accidentally committed during early dev.
 *
 * This test verifies that gitleaks is and remains wired into the CI
 * pipeline — preventing the ADMIN_KEY class of incident from slipping
 * through silently if the CI step is accidentally removed or disabled.
 *
 * Source gate: reads the CI workflow yaml from TEST_SOURCE_FILES_JSON and
 * asserts structural properties of the gitleaks step.
 *
 * @born-red TL-016 | method: design-time-negative-assertion | date: 2026-08-06
 *
 * Properties asserted:
 *   1. CI workflow contains the 'gitleaks' step name
 *   2. gitleaks is run with --exit-code 1 (blocking, not advisory)
 *   3. gitleaks uses --config .gitleaks.toml (custom allowlist applied)
 *   4. gitleaks scans PR commits only (--log-opts pattern, not --no-git)
 *   5. .gitleaks.toml has useDefault = true (all built-in rules active)
 *   6. .gitleaks.toml allowlists test fixtures (prevents false-positive noise)
 *   7. .gitleaks.toml allowlist covers vitest config (test key patterns)
 *   8. .gitleaks.toml allowlist covers spec files (test assertion literals)
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
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith(suffix)
  );
  return entry ? entry[1] : null;
}

describe('TL-016 | Gitleaks CI gate — prevent silent removal', () => {
  test('CI workflow contains the gitleaks step', () => {
    const ci = getSourceFile('.github/workflows/oursharedevents-ci.yml');
    expect(ci, 'oursharedevents-ci.yml not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(ci).toContain('gitleaks');
  });

  test('gitleaks step uses --exit-code 1 (blocking, not advisory)', () => {
    const ci = getSourceFile('.github/workflows/oursharedevents-ci.yml');
    expect(ci).not.toBeNull();
    expect(ci).toContain('--exit-code 1');
  });

  test('gitleaks step uses --config .gitleaks.toml (custom allowlist)', () => {
    const ci = getSourceFile('.github/workflows/oursharedevents-ci.yml');
    expect(ci).not.toBeNull();
    expect(ci).toContain('--config .gitleaks.toml');
  });

  test('gitleaks scans PR commits range (--log-opts), not full unscoped history', () => {
    const ci = getSourceFile('.github/workflows/oursharedevents-ci.yml');
    expect(ci).not.toBeNull();
    // Must scan PR commits only — not the full repo history (which floods with test fixtures)
    expect(ci).toContain('--log-opts=');
  });

  test('.gitleaks.toml has useDefault = true (all built-in rules active)', () => {
    const toml = getSourceFile('.gitleaks.toml');
    expect(toml, '.gitleaks.toml not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(toml).toContain('useDefault = true');
  });

  test('.gitleaks.toml allowlists test fixture paths (prevents false-positive noise)', () => {
    const toml = getSourceFile('.gitleaks.toml');
    expect(toml).not.toBeNull();
    // Must allowlist vitest config (contains test-only key bindings)
    expect(toml).toContain('vitest');
    // Must allowlist spec files — allowlist path covers workers/oursharedevents/tests/
    expect(toml).toContain('workers/oursharedevents/tests');
  });

  test('.gitleaks.toml allowlists CI seed value patterns (predictable test credentials)', () => {
    const toml = getSourceFile('.gitleaks.toml');
    expect(toml).not.toBeNull();
    // CI seed patterns are predictable by design — not real secrets
    expect(toml).toContain('test-admin-key-e2e');
    expect(toml).toContain('test-forms-encryption-secret');
  });

  test('.gitleaks.toml allowlists package-lock.json (checksums, not secrets)', () => {
    const toml = getSourceFile('.gitleaks.toml');
    expect(toml).not.toBeNull();
    expect(toml).toContain('package-lock');
  });
});
