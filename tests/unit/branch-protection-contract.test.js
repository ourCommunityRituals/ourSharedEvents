// ─────────────────────────────────────────────────────────────────────────────
// OSE-1216 — the required-checks list must name checks that actually report.
//
// `tools/ci/main-branch-protection.json` required "S2 Post-Execution Security"
// for weeks after OSE-1056/1057 retired the only jobs that ever posted it. A
// required check nothing reports is not a gate: it either blocks every PR
// forever, or — the state we were actually in, since PRs kept merging — proves
// live protection never matched the file that calls itself the source of truth.
// Nothing was watching either way, because the list was hand-maintained prose.
//
// This test makes "always runs to completion on a pull_request" a DERIVED
// property of the workflow instead of a judgement call, and compares it against
// the JSON in BOTH directions:
//
//   phantom      → a required context with no job behind it            → red
//   unguarded    → a new always-run shard nobody added to the list     → red
//   deadlock     → an if:-gated job (deploy/smoke/contract/functional)
//                  required, which would block every PR on a skip      → red
//
// The rule: a job always runs on a PR when it has no `if:` AND none of its
// transitive `needs:` has one. (smoke-production has no `if:` of its own, but
// needs deploy-production, which is tag-gated — so it does not qualify.)
// ─────────────────────────────────────────────────────────────────────────────
const { readFileSync } = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const REPO = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'oursharedevents-ci.yml');
const PROTECTION = path.join(REPO, 'tools', 'ci', 'main-branch-protection.json');

const wf = YAML.parse(readFileSync(WORKFLOW, 'utf8'));
const protection = JSON.parse(readFileSync(PROTECTION, 'utf8'));

const jobs = wf.jobs ?? {};
const needsOf = (job) => {
  const n = job?.needs;
  if (!n) return [];
  return Array.isArray(n) ? n : [n];
};

/** A job is unconditional when it has no `if:` and neither does anything it needs. */
function alwaysRuns(jobId, seen = new Set()) {
  if (seen.has(jobId)) return true; // cycle guard; GitHub forbids cycles anyway
  seen.add(jobId);
  const job = jobs[jobId];
  if (!job) return false;
  if (job.if !== undefined) return false;
  return needsOf(job).every((dep) => alwaysRuns(dep, seen));
}

/** Check-run names a job produces, expanding a `matrix.shard` name template. */
function checkNames(jobId) {
  const job = jobs[jobId];
  const template = job?.name ?? jobId;
  const shards = job?.strategy?.matrix?.shard;
  if (!Array.isArray(shards)) return [template];
  return shards.map((s) => template.replace(/\$\{\{\s*matrix\.shard\s*\}\}/g, s));
}

// NB: `.filter(alwaysRuns)` would hand the array index in as `seen` — call it explicitly.
const alwaysRunChecks = Object.keys(jobs)
  .filter((id) => alwaysRuns(id))
  .flatMap(checkNames)
  .sort();
const requiredChecks = (protection.required_status_checks?.checks ?? [])
  .map((c) => c.context)
  .sort();
const everyCheckName = Object.keys(jobs).flatMap(checkNames);

describe('OSE-1216 — branch protection required checks match the workflow', () => {
  it('the derivation is non-vacuous (S0 + the T0 shards are found)', () => {
    expect(alwaysRunChecks).toContain('S0 Security');
    expect(alwaysRunChecks.filter((n) => n.startsWith('T0 Gate (')).length).toBeGreaterThanOrEqual(
      6
    );
  });

  it('every required check is produced by a job in the workflow (no phantoms)', () => {
    const phantoms = requiredChecks.filter((c) => !everyCheckName.includes(c));
    expect(
      phantoms,
      `required checks that no job posts — they gate nothing:\n  ${phantoms.join('\n  ')}`
    ).toEqual([]);
  });

  it('no required check belongs to a job that skips on a pull_request (no deadlock)', () => {
    const skippable = requiredChecks.filter((c) => !alwaysRunChecks.includes(c));
    expect(
      skippable,
      `required checks whose job if:-skips on PRs — requiring them deadlocks every PR:\n  ${skippable.join('\n  ')}`
    ).toEqual([]);
  });

  it('every unconditional check is required (a new shard cannot land unguarded)', () => {
    const unguarded = alwaysRunChecks.filter((c) => !requiredChecks.includes(c));
    expect(
      unguarded,
      `checks that always run on a PR but are not required — add them to tools/ci/main-branch-protection.json:\n  ${unguarded.join('\n  ')}`
    ).toEqual([]);
  });

  it('admin enforcement and the no-force-push posture are not silently relaxed', () => {
    expect(protection.enforce_admins).toBe(true);
    expect(protection.allow_force_pushes).toBe(false);
    expect(protection.allow_deletions).toBe(false);
  });
});
