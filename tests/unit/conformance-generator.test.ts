/**
 * OSE-1031 — Unit tests for the conformance report generator's invariant-registry logic.
 *
 * WHY THIS EXISTS (the reactive-correction of a real incident):
 * The conformance report (`conformance.json`) is the machine-readable coverage sink the
 * brain reads. It silently froze at 24 invariants (missing #25 sponsor_share_covenant) and
 * stale for 24 days because (a) the weekly workflow ran on Node 20, which cannot execute the
 * generator's `--experimental-strip-types` flag, and (b) the brain YAML was never checked out,
 * so the generator silently fell back to its 24-entry inline registry. NOTHING tested that
 * this process executed correctly — so nothing went red.
 *
 * These tests give the 24→25 merge logic an object whose job IS to go red, in the BLOCKING
 * unit suite (repo-root `vitest.config.ts`, node env, run in CI via the tests shard's
 * `npx vitest run`) — so a regression fails on every PR, not on the next unwatched Sunday cron.
 *
 * They exercise the two pure functions the report's invariant count depends on:
 *   - parseInvariantsYaml : brain YAML text  → InvariantEntry[]
 *   - buildInvariantRegistry : inline base (24) enriched + extended by brain entries → Map
 */
import { describe, it, expect } from 'vitest';
import {
  INLINE_INVARIANTS,
  parseInvariantsYaml,
  buildInvariantRegistry,
} from '../../workers/oursharedevents/scripts/generate-conformance-report.ts';

// A minimal brain-YAML fixture in the real schema_version 1.2.0 shape the parser targets:
// an `invariants:` block of `- id:` entries with indented fields, terminated by a top-level key.
// Includes #1 (already in the inline base → exercises ENRICHMENT) and #25 (absent from the base
// → exercises the ADD path that lifts the count from 24 to 25).
const BRAIN_YAML_FIXTURE = `schema_version: "1.2.0"
total: 25
invariants:
  - id: 1
    name: anonymous_id
    label: "#1 — Anonymous ID"
    group: privacy_identity
    status: live
  - id: 25
    name: sponsor_share_covenant
    label: "#25 — Sponsor Share Covenant"
    group: commercial_governance
    status: live
enrichment_history: []
`;

describe('conformance generator — invariant registry', () => {
  it('inline base is the 24-entry bootstrap (the brain owns the 25th)', () => {
    // If this drifts, the "brain adds #25 on top of 24" arithmetic below is measuring the
    // wrong base. The inline registry is deliberately a bootstrap that stops at #24.
    expect(INLINE_INVARIANTS.length).toBe(24);
    expect(INLINE_INVARIANTS.some((i) => i.id === 25)).toBe(false);
  });

  it('parseInvariantsYaml reads the 1.2.0 shape and returns #1 and #25', () => {
    const entries = parseInvariantsYaml(BRAIN_YAML_FIXTURE);
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get(1)?.name).toBe('anonymous_id');
    expect(byId.get(25)?.name).toBe('sponsor_share_covenant');
    expect(byId.get(25)?.status).toBe('live');
  });

  it('buildInvariantRegistry adds brain-only #25 on top of the inline base → total 25', () => {
    const registry = buildInvariantRegistry(parseInvariantsYaml(BRAIN_YAML_FIXTURE));
    // 24 inline + #25 from the brain = 25. This is the exact arithmetic that was silently
    // producing 24 in CI because the brain YAML never reached the generator.
    expect(registry.size).toBe(25);
    expect(registry.get(25)?.name).toBe('sponsor_share_covenant');
    // Enrichment (not duplication): #1 existed inline and is enriched, not re-added.
    expect(registry.get(1)?.name).toBe('anonymous_id');
  });

  it('NEGATIVE CONTROL: no brain entries → registry stays at the 24-entry inline fallback', () => {
    // This is the exact failure mode the incident hit: with no brain, the report reports 24.
    // The workflow now fails loud when the brain checkout is missing (OSE-1031); this test
    // documents WHY 24 is the tell-tale of a silent fallback.
    const registry = buildInvariantRegistry([]);
    expect(registry.size).toBe(24);
    expect(registry.has(25)).toBe(false);
  });
});
