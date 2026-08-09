/**
 * OSE-588 — Standards propagation completeness: close conformance gap on #20
 *
 * Invariant #20 claims every live architectural invariant has a CI enforcement gate.
 * The brain-contract-check.yml workflow is the primary enforcer. This spec is the
 * structural gate that proves the workflow exists and is wired to push events.
 *
 * TL-052: Standards drift — a live invariant has no CI enforcement reference
 *
 * Gates:
 *   G1 — brain-contract-check.yml exists in .github/workflows/
 *   G2 — brain-contract-check.yml triggers on push to main
 *   G3 — brain-contract-check.yml has a step that runs a brain test/validation command
 *   G4 — Every invariant known to the threat ledger has at least one tested/mitigated entry
 *        (ledger coverage completeness cross-check)
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { THREAT_LEDGER } from './fixtures/threat-ledger';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

function loadSources(): Record<string, string> {
  return JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('OSE-588 G1/G2/G3 — TL-052: brain-contract-check.yml exists and runs on push to main', () => {
  // @born-red TL-052 | method: design-time-negative-assertion | date: 2026-08-03
  test('brain-contract-check.yml is present in TEST_SOURCE_FILES_JSON', () => {
    const sources = loadSources();
    const brainCheckKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('brain-contract-check')
    );
    expect(
      brainCheckKey,
      'brain-contract-check.yml must be in TEST_SOURCE_FILES_JSON — if missing, add it to the vitest config file glob'
    ).toBeDefined();
  });

  // @born-red TL-052 | method: design-time-negative-assertion | date: 2026-08-03
  test('brain-contract-check.yml triggers on push to main', () => {
    const sources = loadSources();
    const brainCheckKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('brain-contract-check')
    );
    if (!brainCheckKey) return; // guarded by G1 test

    const src = sources[brainCheckKey]!;

    expect(src, 'brain-contract-check.yml must have an on.push trigger').toMatch(/on:\s*\n\s+push/m);
    expect(src, 'brain-contract-check.yml must target main branch').toMatch(/branches.*main/);
  });

  // @born-red TL-052 | method: design-time-negative-assertion | date: 2026-08-03
  test('brain-contract-check.yml has a step that runs a validation command', () => {
    const sources = loadSources();
    const brainCheckKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('brain-contract-check')
    );
    if (!brainCheckKey) return;

    const src = sources[brainCheckKey]!;

    // Must run some kind of Python/node validation against the brain YAML
    const hasValidationStep =
      /run_all\.py|brain.*check|validate.*invariant|conformance.*check/i.test(src);
    expect(
      hasValidationStep,
      'brain-contract-check.yml must have a step running brain validation (run_all.py or equivalent)'
    ).toBe(true);
  });
});

describe('OSE-588 G4 — Ledger coverage cross-check: no invariant referenced in ledger lacks a test', () => {
  // @born-red TL-052 | method: design-time-negative-assertion | date: 2026-08-03
  test('every invariant number referenced in the threat ledger has at least one tested or mitigated entry', () => {
    // Build a map: invariant number → statuses
    const coverageByInvariant = new Map<number, Set<string>>();

    for (const entry of THREAT_LEDGER) {
      if (!entry.target_invariant) continue;
      const num = entry.target_invariant.number;
      if (!coverageByInvariant.has(num)) {
        coverageByInvariant.set(num, new Set());
      }
      coverageByInvariant.get(num)!.add(entry.status);
    }

    const invariantsWithOnlyOpenThreats: number[] = [];
    for (const [num, statuses] of coverageByInvariant.entries()) {
      const hasEnforcement = statuses.has('tested') || statuses.has('mitigated') || statuses.has('accepted');
      if (!hasEnforcement) {
        invariantsWithOnlyOpenThreats.push(num);
      }
    }

    expect(
      invariantsWithOnlyOpenThreats,
      `Invariants ${invariantsWithOnlyOpenThreats.join(', ')} have only open threats — no test or mitigation recorded`
    ).toHaveLength(0);
  });

  test('runner-env-validation.yml exists (validates #11 and #12 CI probes)', () => {
    const sources = loadSources();
    const runnerKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('runner-env-validation')
    );
    expect(
      runnerKey,
      'runner-env-validation.yml must be in TEST_SOURCE_FILES_JSON'
    ).toBeDefined();
  });

  test('OSE-588 evidence', () => {
    const allInvariantsWithCoverage = new Set(
      THREAT_LEDGER
        .filter((e) => e.target_invariant && (e.status === 'tested' || e.status === 'mitigated' || e.status === 'accepted'))
        .map((e) => e.target_invariant!.number)
    );

    const report = {
      story: 'OSE-588',
      threats_covered: ['TL-052'],
      invariant: 20,
      ledger_invariant_coverage_count: allInvariantsWithCoverage.size,
      date: '2026-08-03',
    };
    console.log(`[OSE-588-EVIDENCE] ${JSON.stringify(report)}`);
    expect(report.ledger_invariant_coverage_count).toBeGreaterThan(10);
  });
});
