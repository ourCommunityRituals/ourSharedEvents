# Agent workstation and GitHub hardening

Status: change set of 2026-10-12, from the 2026-10-11 lethal-trifecta review. Owner steps are
marked **OWNER**: they change security settings, so agents do not run them.

## Why

An agent session holds all three legs at once: private data (mail, Drive, Notion, D1, tokens),
untrusted input (mail, web, PR text, client-authored event fields) and a way out (curl, git push,
connectors). The only brake was the auto-mode classifier. This change adds fixed rules, a way to
measure the result, and the repository settings that make a stolen agent session less useful.

## What is in the change

| Piece                                     | What it does                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.claude/hooks/policy-gate.mjs`           | New rules: `git-tag-push`, `gh-release-create`, `prod-dispatch`, `gh-auth-token`, `credential-store`, `git-remote-redirect`, `net-upload`, `bypass-permissions`, `self-config`. 120 tests, nine planted faults each turn a test red. |
| `.github/CODEOWNERS`                      | Names `@bereasonable13`. The old handle did not exist, so GitHub ignored every line.                                                                                                                                                 |
| `scripts/hardening/verify-hardening.mjs`  | Read-only check of both planes; prints PASS, FAIL or WARN per control and a grade. A check it cannot run is a FAIL.                                                                                                                  |
| `scripts/hardening/apply-workstation.mjs` | **OWNER.** Installs and wires the hook, tightens permissions, turns off two flags. Dry run by default; `--apply` needs a terminal and typing `APPLY`.                                                                                |
| `scripts/hardening/apply-github.mjs`      | **OWNER.** Creates the tag ruleset and the production environment reviewer. Same guard.                                                                                                                                              |

## Order of work

1. **OWNER** baseline: `node scripts/hardening/verify-hardening.mjs`. Keep the output.
2. **OWNER** workstation: `node scripts/hardening/apply-workstation.mjs`, read the plan, then
   `--apply`. Start a new session. Prove the hook is live: ask Claude to run
   `npx wrangler secret:bulk does-not-exist.json`; it must be refused with `[wrangler-secret]`.
3. **OWNER** GitHub: `node scripts/hardening/apply-github.mjs`, then `--apply`.
   Consequence: nobody can create a `v*` tag until the ruleset is switched off. Production deploys
   use `workflow_dispatch` with the typed `PRODUCTION` confirmation; the environment reviewer then
   approves in the Actions UI.
4. **OWNER** separate the agent identity. Today the agent is the admin account, so a required
   review would deadlock every merge and an environment reviewer could approve their own deploy.
   - Create a second GitHub account for agents; add it to the repository with Write.
   - Give it a fine-grained token on this repository only: Contents, Pull requests, Issues
     read and write; Metadata read. No Administration, Workflows, Environments or Secrets.
   - `gh auth login` with that token on the workstation and `gh auth logout` the admin token.
     Do admin work in a browser profile the Claude Chrome extension is not attached to.
5. **OWNER** then require reviews: set `required_pull_request_reviews` in
   `tools/ci/main-branch-protection.json` to one approving review, code-owner review, dismiss stale
   reviews and last-push approval, and run `node scripts/apply-branch-protection.mjs --apply`.
   The drift workflow watches that file.
6. **OWNER** move deploy credentials from repository secrets to the `staging` and `production`
   environments, one name at a time, in your own terminal. Check first that every job reading the
   secret declares `environment:` (`node scripts/check-pr-secret-exposure.mjs --report`).
7. **OWNER** Cloudflare MCP: pin the package version and give it a read-only API token
   (D1, Workers and KV read). Writes stay in CI.
8. **OWNER** connectors: turn off Gmail, Drive, Notion, Shopify, LegalZoom, Pricewatcha and
   BigQuery for coding sessions by default, and enable them per task. Use a Chrome profile with no
   admin sign-ins for the extension.

## What the grade means

`verify-hardening` grades each plane by failed controls: none is A, and none with no warnings is
A+; one or two is B; three or four C; five or six D; more is F. That rubric is ours, not an
industry standard. "Above A" means A+ on both planes **and** W6 passing, which only happens after
the hook has logged real calls.

## Limits

- The hook matches command text and fails open. It stops mistakes and unplanned actions, not an
  agent that hides what it runs.
- `Bash(npm:*)` stays allowed because daily work needs it; it can run package scripts.
- Connector scopes in claude.ai, and which sites the Chrome profile is signed in to, are outside
  what a script can read.
- The hub's `.claude/settings.local.json` (about 220 rules) is not covered by W2; review it by hand.
