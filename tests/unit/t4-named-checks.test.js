// ─────────────────────────────────────────────────────────────────────────────
// OSE-1171 — the T4 umbrella is split into per-gate NAMED CHECKS.
//
// Before: functional-staging surfaced as ONE check ("T4 Functional → Staging")
// bundling T4a–T4f. When a sub-gate failed, the check named the umbrella, not the
// gate — OSE-1170's #450 forced a log-dive three times to learn it was T4a, then
// T4b. This locks the fix: the job publishes a check-run per sub-gate so a red
// names its own gate.
//
// The split is PURELY ADDITIVE — pass/fail semantics are unchanged (the blocking
// gates still fail the job directly; T4e keeps its OSE-852 no-continue-on-error
// invariant, enforced in ci-gate0-discovery.test.js). This test guards the
// additive half: every T4 gate is published, wired to its real outcome, and the
// publisher runs even after a halt (`if: always()`).
// ─────────────────────────────────────────────────────────────────────────────
const { readFileSync } = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
// vitest globals: true (vitest.config.ts) — matches the sibling CI meta-tests.

const REPO = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'oursharedevents-ci.yml');

const wf = YAML.parse(readFileSync(WORKFLOW, 'utf8'));
const job = wf.jobs?.['functional-staging'];
const steps = job?.steps ?? [];

// A T4 sub-gate = a step whose name is "T4<x>: …" and which carries an `id`
// (the id is how its result reaches the publisher via steps.<id>.outcome).
const gateSteps = steps
  .filter((s) => typeof s.name === 'string' && /^T4[0-9a-z-]*:/i.test(s.name) && s.id)
  .map((s) => ({ id: s.id, token: s.name.match(/^(T4[0-9a-z-]*)/i)[1], name: s.name }));

const postStep = steps.find((s) => s.name === 'Post T4 named checks');
const postRun = postStep?.run ?? '';
const postLines = postRun.match(/^\s*post\s+"/gm) ?? [];

describe('OSE-1171 — T4 umbrella is split into named checks', () => {
  it('the functional-staging job exists and has T4 sub-gates (else this is vacuous)', () => {
    expect(job, 'functional-staging job must exist').toBeDefined();
    expect(gateSteps.length, 'expected the T4a–T4f sub-gates').toBeGreaterThanOrEqual(6);
  });

  it('publishes exactly one named check per T4 sub-gate — no missing, no orphan', () => {
    expect(postStep, 'a "Post T4 named checks" step must exist').toBeDefined();
    expect(
      postLines.length,
      `post-line count (${postLines.length}) must equal gate count (${gateSteps.length}) — a gate with no check, or a check with no gate, is drift`
    ).toBe(gateSteps.length);
  });

  it('every gate is published by NAME and wired to its REAL outcome (not hardcoded)', () => {
    const missing = [];
    for (const g of gateSteps) {
      // `post "<token>:` — the colon prevents T4c matching inside T4c-phase2.
      const named = new RegExp(`post\\s+"${g.token}:`).test(postRun);
      const wired = postRun.includes(`steps.${g.id}.outcome`);
      if (!named) missing.push(`${g.token}: no \`post "${g.token}: …"\` line`);
      if (!wired) missing.push(`${g.token}: not wired to steps.${g.id}.outcome`);
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('the publisher runs even after a blocking gate halts the job (if: always())', () => {
    // Load-bearing: without always(), a halted job skips the publisher and the
    // failing gate never names itself — defeating the whole ticket.
    expect(String(postStep?.if ?? '')).toMatch(/always\(\)/);
  });

  it('the split is additive — it does not weaken T4 blocking semantics', () => {
    // Fail-fast is preserved: the blocking gates T4a/T4b did NOT gain a
    // continue-on-error (that over-reach would swallow failures — the OSE-852 bug
    // class — and only the enforce-at-end pattern, which we deliberately avoided,
    // would restore the red). And no job-level swallow was introduced.
    const byToken = Object.fromEntries(
      steps.filter((s) => s.id).map((s) => [s.id, s['continue-on-error'] === true])
    );
    expect(byToken['arch-tests'], 'T4a must stay fail-fast (no continue-on-error)').toBe(false);
    expect(byToken['journey-tests'], 'T4b must stay fail-fast (no continue-on-error)').toBe(false);
    expect(job['continue-on-error'], 'no job-level continue-on-error').toBeUndefined();
  });
});
