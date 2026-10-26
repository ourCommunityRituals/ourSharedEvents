# Agent workstation and GitHub hardening

Status: change set of 2026-10-12, from the 2026-10-11 lethal-trifecta review and its CCR (three
independent reviews: security, QA/SDET, DevOps). Steps marked **OWNER** change security settings,
so agents do not run them.

## Why

An agent session holds all three legs at once: private data (mail, Drive, Notion, D1, tokens),
untrusted input (mail, web, PR text, client-authored event fields) and a way out (curl, git push,
connectors). The only brake was the auto-mode classifier. This change adds fixed rules, a way to
measure the result, and the repository settings that make a stolen agent session less useful.

## What is in the change

| Piece                                           | What it does                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.claude/hooks/policy-gate.mjs`                 | A PreToolUse hook. Tokenises the command, unwraps `bash -c`, `env`, `cmd /c`, `eval` and the like, and reads the program and subcommand, so quotes, `.exe`, paths with spaces, `$(…)` and line continuations do not dodge it and commit messages are not blocked. 487 cases, locked by a ratchet file; rule list in the hook README. |
| `tests/integration/policy-gate-wired.test.js`   | Runs the hook suite in the `root-vitest` CI job (it was run by nothing before), and fails if a rule loses its cases.                                                                                                                                                                                                                 |
| `.github/CODEOWNERS`                            | Names `@bereasonable13`. The old handle did not exist, so GitHub ignored every line.                                                                                                                                                                                                                                                 |
| `.github/workflows/branch-protection-drift.yml` | New step: every CODEOWNERS owner must resolve, on the branch under review.                                                                                                                                                                                                                                                           |
| `scripts/apply-branch-protection.mjs`           | The drift check now compares required-review rules (it was blind to them).                                                                                                                                                                                                                                                           |
| `scripts/hardening/verify-hardening.mjs`        | Read-only check of both planes; PASS, FAIL or WARN per control and a grade. A check it cannot run is a FAIL.                                                                                                                                                                                                                         |
| `scripts/hardening/apply-workstation.mjs`       | **OWNER.** Installs the hook from `origin/main`, wires it for shell, file and MCP tools, tightens permissions, turns off two flags. Dry run by default.                                                                                                                                                                              |
| `scripts/hardening/apply-github.mjs`            | **OWNER.** Creates the tag ruleset, the production environment reviewer and deploy refs, and the `main-automation` environment (branch `main` only). Dry run by default.                                                                                                                                                             |

## Order of work

1. **OWNER** baseline: `node scripts/hardening/verify-hardening.mjs`. Keep the output.
2. Merge this PR, then `git fetch origin main`.
3. **OWNER** workstation: `node scripts/hardening/apply-workstation.mjs`, read the plan (it prints
   the hook's hash and whether it came from `origin/main`), then `--apply` in your own terminal and
   type `APPLY`. Start a new session. Prove the hook is live: ask Claude to run
   `npx wrangler secret:bulk does-not-exist.json`; it must be refused with `[wrangler-secret]`.
   W6 only passes after the hook has recorded a block.
4. **OWNER** GitHub: `node scripts/hardening/apply-github.mjs`, then `--apply`. It has three
   steps, each named for what it changes, and every line it prints starts with the step's
   `[name]`:
   - `release-tag-ruleset`: creates a tag ruleset `release-tags-locked` on `refs/tags/v*` (create,
     update, delete, force-push blocked) whose **only** bypass is the repository admin role, so you
     can still release by tag;
   - `production-gate`: adds the approval gate to the existing `production` environment: you as
     required reviewer, deploys allowed from `main` and `v*` tags only. It creates nothing and
     does not touch the `staging` environment;
   - `main-automation`: creates the `main-automation` environment (OSE-1695; the step is named
     after the environment it creates), usable from the `main` branch only (one branch policy; no
     tag, no wildcard; any other policy is removed) and with no reviewer, by design: the scheduled
     and push jobs that use it would stall waiting for one. Then add `OCR_AUTOMATION_WRITE`,
     `OCR_NOTIFY_OSM` and `BRANCH_PROTECTION_READ_TOKEN` there as environment secrets yourself. It
     must exist before any workflow names it: GitHub creates a missing environment on first use,
     unprotected.

   With no `--only`, all three steps run, as before. To run some of them, name them (comma
   separated, no spaces needed); the others send nothing and read nothing:

   ```sh
   node scripts/hardening/apply-github.mjs --only main-automation
   node scripts/hardening/apply-github.mjs --only release-tag-ruleset,production-gate
   node scripts/hardening/apply-github.mjs --only production-gate --apply
   ```

   The dry run lists each step as SELECTED or SKIPPED and prints the exact question `--apply`
   will ask (`Type APPLY to send <n> request(s) to … for: <names>`). An unknown or empty name, a
   second `--only`, an unknown flag (`--onyl` gets a "did you mean --only?" hint) or a step name
   given without `--only` stops the script before any request and prints the recognised flags and
   the valid names, so a typo never falls back to running all three steps.

5. **OWNER** separate the agent identity. Until then every GitHub control above is advisory: the
   agent is the admin account, so it can delete the ruleset or approve its own deployment, and a
   required review would deadlock every merge.
   - Create a second GitHub account for agents; add it to the repository with Write.
   - Give it a fine-grained token on this repository only: Contents, Pull requests, Issues
     read and write; Metadata read. No Administration, Workflows, Environments or Secrets.
   - `gh auth login` with that token on the workstation and `gh auth logout` the admin token. Do
     admin work in a browser profile the Claude Chrome extension is not attached to.
   - Check: G6 and W8 pass. Note the SSH key (`git` over SSH) is account-wide, not token-scoped;
     the tag ruleset is what stops a tag push over it.
6. **OWNER** then require reviews: set `required_pull_request_reviews` in
   `tools/ci/main-branch-protection.json` to one approving review with code-owner review, and run
   `node scripts/apply-branch-protection.mjs --apply`. The drift check now fails if live differs.
   With `enforce_admins` on and one code owner, an owner-authored PR cannot merge (no
   self-approval); agent-authored PRs are approved by you. Plan a second approver for your own PRs.
7. **OWNER** move deploy credentials out of repository secrets, **one name at a time, as its own
   change**. This breaks CI if done naively:
   - Only `deploy-staging` and `deploy-production` declare `environment:`. These jobs read the
     secrets without one: `contract-staging-sub`, `smoke-staging-sub`, `functional-staging-sub`
     (also `OCR_CI_EDGE_TOKEN`), `smoke-production`, the CF Access canary probe,
     `red-team-staging`, `security-closing` and `security-regression` (no longer runs on pushes to
     `claude/**`; a test now fails if any workflow lets a branch push reach a protected secret). Moving a secret
     empties it for them.
   - `CLOUDFLARE_API_TOKEN_OSE` serves staging and production with one value; create a distinct
     token per environment first.
   - `SMOKE_RPT_*` has no `secrets.` reference anywhere: delete those, do not move them.
   - Adding `environment: production` to `smoke-production` adds a second approval prompt; use a
     separate no-reviewer environment for the smoke job.
   - A main-only rule on `staging` breaks `full-pipeline/*` PR runs.
   - `node scripts/check-pr-secret-exposure.mjs --report` lists the secrets reachable from pull
     requests; it does not list which jobs lack an environment.
8. **OWNER** Cloudflare MCP: pin the package version and give it a read-only API token
   (D1, Workers and KV read). Writes stay in CI.
9. **OWNER** connectors: turn off Gmail, Drive, Notion, Shopify, LegalZoom, Pricewatcha and
   BigQuery for coding sessions by default and enable them per task. Use a Chrome profile with no
   admin sign-ins for the extension.

## What changes about releasing

- Tags still work for you: the admin role bypasses the ruleset. Agent identities (after step 5)
  cannot create them.
- Every production deploy, by tag or `workflow_dispatch` from `main`, now waits for the
  environment reviewer. `ROLLBACK.md` assumes no wait; time to restore grows by one approval.
- `RUNBOOK-DEPLOYMENT.md` still tells you to tag; that remains correct for you.

## Rollback of each owner step

| Step          | Undo                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 3             | restore `settings.json.bak-<stamp>` next to the settings file; delete `~/.claude/hooks/policy-gate.mjs`                                        |
| 4 tag ruleset | `gh api -X DELETE repos/ourCommunityRituals/ourSharedEvents/rulesets/<id>` (id from `GET …/rulesets`)                                          |
| 4 environment | `PUT …/environments/production` with `{"reviewers":[],"deployment_branch_policy":null}`; never delete the environment (its secrets go with it) |
| 4 automation  | `main-automation`: remove every workflow reference first, then delete it in settings (its secrets go with it)                                  |
| 5             | `gh auth login` as the admin again                                                                                                             |
| 6             | set `required_pull_request_reviews` back to `null` in the JSON and re-apply                                                                    |
| 7             | re-add the repository secret and revert the workflow change                                                                                    |

## What the grade means

`verify-hardening` grades each plane by failed controls: none is A, and none with no warnings is
A+; one or two is B; three or four C; five or six D; more is F. That rubric is ours, not an
industry standard. "Above A" means A+ on both planes **and** W6 passing, which only happens after
the hook has recorded a real block. W6 reads the hook's own audit log, which a process with file
access could write: it is evidence the hook ran, not proof.

## Limits

- The hook matches command text and fails open (also when the script is missing, which W1 checks).
  It stops mistakes and the cheap forms of an injected command. It does not stop a program that
  makes its own network or file calls, a command built from pieces at run time, or an agent that
  edits the repo's hook through Edit or Write (that goes through review and `pr-risk`).
- A pseudo-terminal can answer the `--apply` prompt. The hook blocks agents from running the apply
  scripts, and the GitHub-side controls (steps 4 to 6) are what hold if that is bypassed.
- MCP: only the Cloudflare write tools, session-control tools and `run_in_terminal` are gated.
  Gmail, Drive, Notion and similar tools are scoped per session (step 9), not by the hook, and the
  Cloudflare connector's `d1_database_query` can write.
- `OCR_GH_FIXTURE` makes the verifier read gh answers from a file for tests; its output says so.
- `Bash(npm:*)` stays allowed because daily work needs it; it can run package scripts, though
  `npm run deploy*` and `npm publish` are blocked by the hook.
- The hub's `.claude/settings.local.json` (about 220 rules) is not covered by W2; review it by hand.
- Governance files that say CODEOWNERS "locks" or "enforces" (`AGENTS.md`, the worker `CLAUDE.md`,
  `CONFORMANCE.md`, `threat-ledger.ts`) are true only after step 6. They are not edited here: they
  need your review loop by loop.
