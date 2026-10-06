# main branch protection — source of truth

`main` protection is codified in [`main-branch-protection.json`](./main-branch-protection.json) and
applied/verified with [`scripts/apply-branch-protection.mjs`](../../scripts/apply-branch-protection.mjs).

**Why this file exists:** protection was originally applied as an ad-hoc API call — un-versioned,
un-reproducible, and silently removable. `main` had in fact shipped with _no_ protection at all.
Codifying it makes the gate reproducible and drift-detectable.

## The rule

Required status checks = the CI jobs that **always run to completion on a `pull_request`**:

| Required check                                                           | Why                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `S0 Security`                                                            | Static security analysis and supply-chain inventory                                                   |
| `T0 Gate (lint)` / `(typecheck)` / `(tests)` / `(a11y)` / `(invariants)` | Quality + the **invariant constitution** shard                                                        |
| `T0 Gate (component)`                                                    | Real Playwright viewport and layout specs against a local worker (OSE-1216: it was never required)    |
| `Mobile workability — PR code (375×812, blocking)`                       | The phone audit of the PR's own code on a local worker. A phone is the first screen (PO 2026-10-06)   |
| `Gate-execution reconciler`                                              | Fails when a gate expected for the trigger silently did not run (`scripts/assert-gate-execution.mjs`) |
| `Invariant #22 cross-repo isolation gate`                                | The cross-repo import guard, in its own job (`.github/workflows/inv22-cross-repo-gate.yml`)           |

`S2 Post-Execution Security` is **not** required and must not come back: it is a step at the tail of the
T4 functional job, so no check with that name ever reports on a pull request (OSE-1216, OSE-1260).
The integrity check still runs after merge; it is not a pre-merge gate.

A pull request that never started the pipeline cannot merge: the required checks above show as
"Expected — Waiting for status to be reported" until they report (see
`.github/workflows/WORKFLOW-VERIFICATION.md`).

`enforce_admins: true` — the gate binds admin/agent merges too (makes "green ships" enforced, not convention).
`strict: false` — do **not** force branches up-to-date before merge (the single-runner pool can't afford serial re-runs of every open PR).

**Deliberately NOT required:**

- `Claude PR Review` and `Validate against OCR-docs brain` — known false-reds; excluding them means they neither block nor need per-PR manual override.
- `T1 Deploy`, `T2 Smoke`, `T3 Contract`, `T4 Functional` — these `if:`-skip on PRs; requiring a job that skips would deadlock every PR.

## Commands

```bash
node scripts/apply-branch-protection.mjs --check          # read-only full drift check (needs repo admin); exit 1 on drift
node scripts/apply-branch-protection.mjs --check-checks   # read-only, required checks only, works with the default GITHUB_TOKEN
node scripts/apply-branch-protection.mjs --apply          # PUT the config (requires repo admin)
node scripts/apply-branch-protection.mjs --self-test      # the pure diff cases
```

## How the file stays true

Three layers, none of which can pass by skipping:

1. **File ↔ workflows**, no token: `tests/unit/ci/branch-protection-contract.test.js` (T0 `tests` shard) derives
   from the workflows which checks always report on a pull request. It fails on a required context nothing can
   emit (PHANTOM), one only a conditional job emits (DEADLOCK), or an always-on pipeline check that is neither
   required nor on its reviewed `ALLOWED_UNREQUIRED` list (UNGUARDED).
2. **File ↔ live required checks**, default token: the `required-checks` job in
   `.github/workflows/branch-protection-drift.yml` runs `--check-checks` on every run of that workflow
   (nightly, dispatch, and any change to the JSON, this script or the workflow). An API error fails it.
3. **File ↔ live settings** (`enforce_admins`, `strict`, force-push, deletions): the `full-settings` job runs
   `--check` nightly and on dispatch. It needs the secret `BRANCH_PROTECTION_READ_TOKEN`, a fine-grained token for
   this repository with **Administration: read**. Without it the job fails and says why.

To change protection: edit the JSON in a PR, then a repo admin runs `--apply`. Apply **before** merging a PR that adds a
required check, so the check is required the moment it exists; the drift job on that PR stays red until you do.

## ⚠ Emergency escape hatch (CI outage only)

`enforce_admins: true` means: if the required checks never report (a GitHub Actions or GitHub-hosted
runner outage), **no PR can merge — even by an admin**. The self-hosted runner pool, its readiness
probe and watchdog (`tools/runner/`, INVARIANT #12) were retired in OSE-1194 (2026-09-02); CI runs on
GitHub-hosted `ubuntu-latest`, so there is no runner to bounce — **prefer waiting out the upstream
incident** (https://www.githubstatus.com) over lifting protection.

If you are genuinely stuck and must merge during an outage you cannot fix quickly:

```bash
gh api -X DELETE repos/ourCommunityRituals/ourSharedEvents/branches/main/protection   # lift
# ... merge the unblocking PR ...
node scripts/apply-branch-protection.mjs --apply                                       # RE-APPLY immediately
```

Re-apply protection the moment the emergency is over. Leaving `main` unprotected is the exact
failure this file exists to prevent.
