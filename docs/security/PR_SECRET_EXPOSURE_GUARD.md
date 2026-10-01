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
auto-run path, but Alt-B is **necessary, not sufficient**: a trusted-user
auto-run PR can reference **any repo-level secret**, not just the wired ones, so
zeroing the current surface does not by itself stop a workflow-editing PR. Treat
every reported secret as a standing item to eliminate — but the tamper-proof
close is the Environment control below.

## Closing the ungated path — Environment protection (the tamper-proof control)

**Chosen direction (2026-09-26, ADR-020):** store sensitive secrets as
**Environment secrets** under `staging`/`production` environments protected with
**required reviewers**, so accessing them needs approval even for a trusted-user
auto-run PR. This is the only control that stops a PR from referencing a secret
it doesn't currently use.

**Verified gap (2026-09-26 — this is INFRA/settings work, run in a separate
terminal; never paste secret values into chat):**

- All sensitive secrets are **repo-level** today (exposed to every same-repo PR
  workflow): `ADMIN_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN_OSE`, `SMOKE_RPT_ADMIN_TOKEN`,
  `SMOKE_RPT_LOCAL_TOKEN`, `SMOKE_RPT_MID_TOKEN`, `SMOKE_RPT_OTHER_EVENT_TOKEN`,
  `X_OCR_INTERNAL`.
- The `staging`, `production`, and `copilot` environments have **zero protection
  rules / zero required reviewers** — so `environment: staging` on deploy jobs
  currently protects nothing.

**Remediation (per environment; requires admin):**

1. Add required-reviewer protection to the environment (UI: Settings →
   Environments → `staging` → Required reviewers; or API):

   ```bash
   gh api -X PUT repos/ourCommunityRituals/ourSharedEvents/environments/staging \
     -f 'reviewers[][type=User]' -F 'reviewers[][id]=<REVIEWER_USER_ID>'
   ```

2. Re-add each sensitive secret as an **Environment** secret (this removes it from
   the global repo scope):

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN_OSE --env staging   # prompts for the value
   # …repeat for each sensitive secret, per environment…
   gh secret delete CLOUDFLARE_API_TOKEN_OSE               # remove the repo-level copy
   ```

3. Confirm the deploy/staging jobs already declare `environment: staging` (they
   do) so they can still read the now-scoped secrets.
4. Verify: `gh api …/environments` shows `required_reviewers`, and
   `gh api …/actions/secrets` no longer lists the sensitive names.

Keep the `check-pr-secret-exposure` guard + Alt-B as defense-in-depth on top —
they still catch accidental exposure and the currently-wired surface on both
paths.

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

## Rules P and W (ADR-012 Phase 0.1 and 0.2, added 2026-10-01)

The guard also enforces two credential-isolation rules from OCR-docs ADR-012
(`docs/standards/OCR_STANDARD_secretsAndTokens.md` §4.2). They apply to every
workflow, not only PR-triggered ones.

**Rule P: no persisted token checkouts.**

- What it requires: an `actions/checkout` step that receives a `token:` must set `persist-credentials: false`.
- Why: without it, the token stays readable by every later step in the job, from `.git/config` or, with checkout v6+, from a credentials file under `$RUNNER_TEMP`. Those later steps include PR test code and dependencies installed from the PR's lockfile.
- The one legitimate exception is a job that must `git push` with that token, an org-automation (Z4) job. None exists in this repo.

**Rule W: no secrets in a `workflow_run` started by a pull request.**

- What it requires: a job in a `workflow_run` workflow may hold no secret (other than `GITHUB_TOKEN`) if a source run whose event was `pull_request` can trigger it.
- Why: `workflow_run` runs with the default branch as its ref, so environment branch rules do not stop it. A `head_repository` check stops forks, but not same-repo agent branches.
- How it is checked: the PR author chooses the branch name, so the guard does not rely on a sample list. Every string literal in the workflow's `if:` conditions is tried as the source branch, along with sample names (`full-pipeline/x`, `copilot/x`, `claude/x`, `dependabot/npm/x`, `feature/x`, `main`). Each is tried from this repo and from a fork. The job fails if any of them reaches a secret.
- **Structural backstop:** a secret-holding `workflow_run` job must also name `github.event.workflow_run.event == 'push'` (or `'schedule'`) in its `if:` and never `'pull_request'`, so a gap in the model cannot pass it.
- **Inherited secrets count:** for both rules, workflow-level `env:` secrets count for every job. `secrets: inherit`, `toJSON(secrets)` and computed `secrets[...]` indexes fail closed as "all secrets". Checkout matching is case-insensitive.
- Unmodeled refs fail closed.
- The fix is to require `github.event.workflow_run.event == 'push'` on `main` (plus the same-repo check), or to read the PR's files as data without running them.

**Evidence (2026-10-01):** against `main` at `565fb78`, the extended guard failed on:

- the three persisted brain checkouts (`brain-contract-check`, `inv22-cross-repo-gate`, `oursharedevents-ci.yml` `gate-tests-sub`);
- `red-team-adversarial` / `security-finale` holding `ADMIN_KEY`, `CF_ACCESS_*` and `OCR_PROPAGATE_TOKEN` for `full-pipeline/*` PR source runs.

**Mutation checks:** each of these turns the guard or its self-test red:

- reverting any fix;
- restoring the original red-team `if:`;
- allowing PR sources together with attacker-chosen branch prefixes;
- disabling either rule;
- dropping the fork-from-`main` case;
- dropping the literal-derived branch candidates, the workflow-level `env:` scan, the `secrets: inherit` or `toJSON(secrets)` sentinel, the structural backstop, or case-insensitive matching;
- dropping whitespace tolerance in the named `secrets [ 'X' ]` or computed `secrets [ x ]` index, or case-insensitive matching of the `secrets` context name (Copilot review on #743; each of the three was mutation-checked);
- modelling a PR-sourced run as always `conclusion == 'success'` (Rule W now tries every conclusion GitHub reports plus any literal in the `if:`).

- **(CCR Loop 3 red-team, 2026-10-01)** case-folded string comparison and `startsWith`/`endsWith`/`contains`; status functions answered per upstream outcome (`success`/`failure`/`cancelled`, because the PR author decides whether tests fail) and `needs.<job>.result` following it; head **and** base branch candidates taken from every literal in the workflow's `if:`s on the `pull_request` path too; `pull_request_review` and `pull_request_review_comment` treated as PR triggers; and secrets in a local reusable workflow a PR job calls. Each has a fixture that goes red when its fix is reverted.

**Scope boundary, stated:** the `pull_request` model excludes exactly one head-branch prefix, `full-pipeline/` (`APPROVED_DEPLOY_PREFIX`), because that is ADR-020's approved deploy path. ADR-012 decision 6 would retire it. **Not modelled yet**, tracked in the ADR-012 gate register: unfiltered `push` triggers, `issue_comment` jobs that check out PR code, `merge_group`, and default-`GITHUB_TOKEN` checkouts in jobs with write scopes.

The self-test has 40 fixtures.

## Born-red proof

Revert the `security-regression.yml` PR-gate (or add a Cloudflare token to the S0
job) → `npm run guard:pr-secrets` turns red. Delete/unwire the scanner → the
invariant spec turns red. A guard that cannot fail is not coverage.

## Extending to other repos

To carry this to another OCR site (OA client-fork / a new niche vertical), the
guard travels with the OA template and its invariant registers with the shared
OCR-docs brain — see ADR-020's cross-repo (constitution) layer. Do not fork the
scanner per repo; register the invariant once and let each repo inherit it.
