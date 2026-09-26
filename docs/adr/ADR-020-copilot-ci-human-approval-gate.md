# ADR-020: Keep the human approval gate on Copilot-authored CI workflows

**Status:** Accepted
**Date:** 2026-09-26
**Deciders:** mzdan (PO / security owner) + Co-Architect (Claude Code)

## Context

PR #651 (a launch-smoke coverage change authored by the GitHub Copilot coding agent,
`app/copilot-swe-agent`) showed no CI running, reported as "the CI/CD pipeline is not working… the
recent changes need to be correctly mapped and replaced so execution can be continuous." The
implied fix was a workflow job-graph remap.

Investigation showed the pipeline is **not** broken and nothing needs remapping:

- The **identical** pipeline runs green end-to-end on **human** PRs (reference: PR #647 — `S0
Security`, every `T0 Gate (*)` shard, the `T0 Tests (*)` subgates, `Gate-execution reconciler`,
  `Invariant #22`, downstream `T1–T4` correctly `skipping` on a PR). Every branch-protection
  required check reported and passed. The job graph and required-check mapping are intact.
- Every `pull_request`-triggered run on #651 shows `conclusion: action_required`,
  `triggering_actor: Copilot`, and **0 jobs executed**. GitHub holds **all** Actions on
  Copilot-authored PRs pending a human's **"Approve and run workflows"** click. The fork-approval
  REST endpoint returns `403` (same-repo Copilot PR → cleared only via the Copilot-specific UI
  control, or a repo setting that skips approval).

The forces in tension:

- **Velocity** — an approval click per Copilot push is friction; "continuous" CI would be
  zero-touch.
- **Security** — this repo's `pull_request`-triggered jobs consume real secrets even on a plain PR
  (e.g. `OCR_PROPAGATE_TOKEN` in S0/T0 and ~8 other PR-triggered workflows, `ANTHROPIC_API_KEY` in
  claude-review, `LINEAR_API_KEY` in brain-contract/premature-close — representative, not
  exhaustive). Because `pull_request` runs the **PR-head's**
  workflow content with secrets available for same-repo PRs, and `.github/` is protected only at
  **merge** time (CODEOWNERS `* @mzdano`) not at **run** time, an auto-run PR could edit a workflow
  to exfiltrate those tokens before any human sees it. No in-workflow guard is tamper-proof against
  this (the guard itself is PR-head content). The approval gate is currently the only robust
  control. This is squarely the agentic-swarm threat model the platform is built to resist
  (`feedback_agentic_swarm_threat_model`).

The PO's stated preference, made explicitly during this decision: _"The more we move forward with
this, the more I want the human breaks where I need to do the approval."_

## Decision

**Retain GitHub's manual approval gate for Actions workflows on Copilot-authored (`app/copilot-swe-agent`)
pull requests.** We do **not** enable the repo "skip approval for Copilot Actions workflows" setting.
CI on a Copilot PR is **continuous after a single human approval**, not zero-touch — that per-push
click is a deliberate human-in-the-loop review point on agent-authored code before it runs with repo
secrets. The operational procedure is documented in
[`workers/oursharedevents/docs/ops/copilot-pr-ci-approval-runbook.md`](../../workers/oursharedevents/docs/ops/copilot-pr-ci-approval-runbook.md).
No change is made to the pipeline definition.

## Alternatives Considered

### Alternative A: Enable "skip approval for Copilot Actions workflows"

Flip the repo setting so Copilot PR workflows auto-run (GitHub added this toggle 2026-03-13).

**Rejected because:** it auto-runs unreviewed, agent-authored code that (in this repo) has access to
`pull_request`-job secrets, and `.github/` is guarded only at merge time — so a Copilot PR that
edits a workflow could exfiltrate `OCR_PROPAGATE_TOKEN` / `ANTHROPIC_API_KEY` / `LINEAR_API_KEY`
before any human review. It removes the exact control our threat model relies on.

### Alternative B: Enable skip-approval **after** de-secreting every `pull_request` job

Make all PR-triggered jobs secret-free (move token-using steps to push/non-PR events or gate them
off for bot authors), then flip the setting for genuinely zero-touch, safe continuous CI.

**Rejected because (for now):** it is real work spread across several workflows
(`oursharedevents-ci.yml` S0, `claude-review.yml`, `brain-contract-check.yml`,
`premature-close-detector.yml`, `dast-zap-baseline.yml`) and, even done, it removes the human
eyeball on agent output that the PO wants. **Kept as the only sanctioned future path** to zero-touch
Copilot CI — see Revisit Criteria. Skip-approval must never precede de-secreting.

### Alternative C: Re-route authorship (human / Claude Code) to dodge the gate

Have a human or the Claude Code CLI (which commits as the operator) open the PRs so GitHub does not
gate them.

**Rejected because:** it removes the approval break by side-channel and conflates "who is recorded
as author" with "who reviewed the code." If we want a human break, we keep the gate; if we ever
want zero-touch, we earn it via Alternative B, not by laundering authorship. (Legitimately using
Claude Code as the author for work a human is driving is fine — but not _as a gate bypass_.)

### Alternative D: Remap the CI job graph (the original hypothesis)

Rewrite `needs:` / required-check mappings so "execution is continuous."

**Rejected because:** there is nothing to remap — the pipeline is proven healthy on human PR #647.
Editing a correct workflow to chase a non-existent mapping bug would risk breaking the real gate.

## Consequences

### Positive

- Repo secrets used by `pull_request` jobs are never exposed to unreviewed agent-authored workflow
  content — a human approves each Copilot run first.
- A human-in-the-loop review point on every agent push, matching the platform's agentic-swarm threat
  posture.
- The required-check mapping (`S0`, `T0 Gate (*)`, reconciler, Invariant #22) is untouched; the
  enforcement is additive (a guard step in the existing lint shard + one invariant spec).
- The decision is enforced, not vigilance-dependent: the PR-reachable secret surface is now a
  machine-checked contract (see Implementation Notes), so it cannot silently regress.

### Negative

- One **"Approve and run workflows"** click per Copilot push — CI is _continuous after approval_,
  not zero-touch. During high-volume agent work this is real friction.
- The behavior is non-obvious ("looks broken but is a gate") — mitigated by the runbook, which is the
  first thing to read when a Copilot PR shows no CI.

### Neutral

- The GitHub "skip approval" toggle remains available; leaving it **off** is now a recorded decision,
  not an oversight. Re-enabling it is a deliberate action gated by the Revisit Criteria below.

## Implementation Notes

- **Runbook (the operational how-to):**
  [`workers/oursharedevents/docs/ops/copilot-pr-ci-approval-runbook.md`](../../workers/oursharedevents/docs/ops/copilot-pr-ci-approval-runbook.md)
- **Setting deliberately left OFF:** Settings → _Code, planning, and automation_ → Copilot → Cloud
  agent → "skip approval for Actions workflows."
- **Enforcement (this decision is not just documented — it is machine-checked):**
  - Guard: `scripts/check-pr-secret-exposure.mjs` — asserts the PR-reachable secret surface stays
    within `scripts/check-pr-secret-exposure.allowlist.json` and that no workflow uses
    `pull_request_target`. Run in the T0 lint shard on every PR/push (with its self-test).
  - Invariant spec: `tests/e2e/0-architecture/ci-approval-gate-safety.invariant.spec.ts` (T0
    invariants shard) — a meta-gate that keeps the mechanism wired and forbids allowlisting
    infra/deploy creds.
  - Guard runbook: `docs/security/PR_SECRET_EXPOSURE_GUARD.md`.
  - First finding fixed on landing: `security-regression.yml` was hitting staging with
    `CF_ACCESS_*` on every plain PR; its job is now gated to non-PR events + `full-pipeline/*`
    (matching `deploy-staging`).
- **Merge-time protection:** `.github/CODEOWNERS` locks `/.github/workflows/`, the guard scanner,
  the allowlist, and this ADR to the security owner (`@mzdano`).
- **Constitution (pending, cross-repo):** the brain invariant (#26) + OA-template registration that
  makes this reusable across other OCR sites is a paired OCR-docs PR, not yet landed.

## References

- PR #651 (held Copilot PR that triggered this) and PR #647 (human PR proving the pipeline is
  healthy).
- Runbook: `workers/oursharedevents/docs/ops/copilot-pr-ci-approval-runbook.md`.
- Doctrine: `feedback_agentic_swarm_threat_model` (harden every build against coordinated
  agentic/agent-authored inputs; the prize is secret theft / aggregate poisoning / re-id).
- GitHub: "Optionally skip approval for Copilot coding agent Actions workflows" (Changelog,
  2026-03-13); "Configuring settings for GitHub Copilot cloud agent" (GitHub Docs).

## Revisit Criteria

Re-open this decision **only if both** hold:

1. Copilot PR volume makes the per-push approval click a genuine, measured bottleneck, **and**
2. Alternative B is complete — every `pull_request`-triggered job has been proven secret-free.

At that point, enabling skip-approval becomes safe and this ADR should be superseded. Until **both**
are true, the gate stays. (No revisit is triggered by friction alone.)
