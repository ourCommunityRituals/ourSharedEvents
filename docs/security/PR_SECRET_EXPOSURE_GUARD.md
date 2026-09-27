# PR-Secret Exposure Guard (ADR-020)

**Guard:** `scripts/check-pr-secret-exposure.mjs`
**Invariant spec:** `tests/e2e/0-architecture/ci-approval-gate-safety.invariant.spec.ts`
**Allowlist:** `scripts/check-pr-secret-exposure.allowlist.json`
**Decision:** [ADR-020](../adr/ADR-020-copilot-ci-human-approval-gate.md)
**Operator runbook (approving Copilot PRs):** [copilot-pr-ci-approval-runbook](../../workers/oursharedevents/docs/ops/copilot-pr-ci-approval-runbook.md)

## What it enforces

The set of `secrets.*` reachable by a workflow job that can run on a **plain**
(non-`full-pipeline/*`, e.g. agent-authored `copilot/*`) pull request must stay
within a small, reviewed allowlist — and **no workflow may use
`pull_request_target`.**

Why this is the load-bearing control: on a same-repo `pull_request`, GitHub runs
the **PR-HEAD's** workflow content with secrets available, and `.github/` is
protected only at **merge** time (CODEOWNERS), not at **run** time. So an
auto-run agent PR that edited a workflow could exfiltrate any PR-reachable
secret. The human approval gate (ADR-020) is the tamper-proof control today; this
guard makes the _surface_ that gate protects a machine-checked contract. It is
also the property (ADR-020 **Alternative B**) that would make the gate safe to
ever remove: a provably minimal PR-reachable secret surface.

Deploy/infra creds — `CLOUDFLARE_*`, `ADMIN_KEY`, `CF_ACCESS_*`,
`X_OCR_INTERNAL`, `FORMS_*`, `SMOKE_RPT_*` — must **never** be PR-reachable and
must **never** be added to the allowlist. The invariant spec fails if any of them
appears as an allowlist key, so you cannot silence the guard by allowlisting a
crown-jewel secret — you gate the job instead.

## Why this matters MORE for the ungated author

Two agent authors already open PRs into this repo, gated oppositely:

- **GitHub Copilot** (`app/copilot-swe-agent`) → workflows are **held** for
  "Approve and run" (ADR-020). The human approval break is a tamper-proof
  backstop on this path.
- **Claude / Claude Code** → commits as the human (`@mzdano`), so its PRs
  **auto-run CI with no approval gate.**

On the Copilot path this guard is defense-in-depth behind the approval break. On
the **Claude / auto-run path it is the _only_ defense** — and, running from
PR-head content with no human in the loop, it is **best-effort, not
tamper-proof** (a PR that edits the workflow to neuter it runs before anyone sees
it). So the guard catches accidents and non-workflow-editing exposures on the
auto-run path, but the robust close is **ADR-020 Alternative B — drive the
PR-reachable secret surface to zero** (`--report` measures it). Treat every
secret this guard reports as reachable as a standing item to eliminate, not just
to keep allowlisted.

## How reachability is decided

A job is treated as **reachable on a plain PR unless proven gated** (fail-closed).
The scanner evaluates each job's `if:` with a small GitHub-Actions expression
evaluator under a plain-PR environment (`event_name='pull_request'`,
`head_ref='copilot/x'`) and walks the `needs:` graph — an upstream job that skips
on a plain PR resolves to `result='skipped'`. This is why the staging chain
(`deploy-staging` → `smoke`/`contract`/`functional`) is correctly seen as gated:
`deploy-staging` is `full-pipeline/*`-gated, and the rest flow through
`needs.deploy-staging.result == 'success'`. An `if:` the evaluator cannot parse
makes the job count as reachable (fail-closed).

## Running it

```bash
npm run guard:pr-secrets          # enforce — exit 1 on any violation (what CI runs)
node scripts/check-pr-secret-exposure.mjs --report      # print the PR-reachable secret surface
npm run test:guard-pr-secrets     # self-test the scanner (fixtures for each leak shape)
```

CI runs both `test:guard-pr-secrets` (self-test first) and `guard:pr-secrets` in
the T0 Gate **lint** shard on every PR/push.

## When it fails

A secret is PR-reachable but not allowlisted, or a `pull_request_target` appeared.
**Preferred fix: gate the job away from plain PRs**, not allowlist the secret.

1. `--report` shows which `file:job` exposes the secret.
2. Add an `if:` so the job runs only on non-PR events and/or `full-pipeline/*`
   PRs — mirror `deploy-staging` in `oursharedevents-ci.yml`, e.g.

   ```yaml
   if: >-
     github.event_name != 'pull_request' ||
     startsWith(github.head_ref, 'full-pipeline/')
   ```

   (This is exactly how the `security-regression` job's staging scan was fixed
   when this guard first shipped — it was hitting staging with `CF_ACCESS_*` on
   every plain PR.)

3. Re-run `--report` to confirm the secret dropped, then `npm run guard:pr-secrets`.

**Allowlisting** is only for secrets that are genuinely, intentionally
PR-reachable AND are not infra/deploy creds (the guard already refuses those).
Add the secret name to `scripts/check-pr-secret-exposure.allowlist.json` under
`approved` **with a reason**. The file is CODEOWNERS-locked (`@mzdano`), so the
addition is reviewed as a security decision.

## Born-red proof

Revert the `security-regression.yml` PR-gate (or add a Cloudflare token to the S0
job) → `npm run guard:pr-secrets` turns red. Delete/unwire the scanner → the
invariant spec turns red. A guard that cannot fail is not coverage.

## Extending to other repos

To carry this to another OCR site (OA client-fork / a new niche vertical), the
guard travels with the OA template and its invariant registers with the shared
OCR-docs brain — see ADR-020's cross-repo (constitution) layer. Do not fork the
scanner per repo; register the invariant once and let each repo inherit it.
