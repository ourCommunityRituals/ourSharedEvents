# Draft stories (v4): what is left after the 2026-10-12 agent-workstation hardening

Status: **draft v4 for the PO, corrected after CCR loops 1, 2 and 3. Nothing here is in Linear.**
v1 to v3 were reviewed by independent Dr of Security, Data Scientist / QA, SDET-SRE and DevOps
passes; their findings are folded in and recorded in
`CCR-HARDENING-FOLLOWUP-STORIES-2026-10-12.md`. Evidence tags: **[P]** proven by reading source or a
live read-only GitHub GET, **[H]** proven by feeding the merged hook a probe, **[I]** inferred from
GitHub or Cloudflare behaviour and to be proven on a scratch repository before relying on it.

Format follows CLAUDE.md §6, trimmed: most of these are owner-terminal or GitHub-setting changes,
so the code test pyramid does not apply and each story names the evidence that replaces it. Step
numbers refer to `docs/security/AGENT-WORKSTATION-HARDENING.md`.

Parent suggestion: **OSE-1488**. Related, not duplicated: OSE-621, OSE-622, OSE-1479, OSE-1110,
OSE-1107, OSE-1216, ADR-020 ("Alternative B": drive the PR-reachable secret surface to zero).

**Done bar for every story:** evidence attached (output or a screenshot of the setting, secrets
redacted) **and** the named `verify-hardening` control reading PASS **from the identity the story
names**, **and** one independent record (org audit-log event, a CI artifact, a probe that fails
with GitHub's or Cloudflare's own response, not the hook's). "Owner ran X" is never the whole bar.
Output with the "NOT A REAL READING" banner does not count. Probes that test GitHub run **from the
owner's terminal with the agent credential outside the harness**: inside it the hook refuses first
and the probe proves the hook, not the control.

## Honest limits (state these wherever the plan is quoted)

1. The hook is a **speed bump with an audit trail**. It cannot read what a program does (`node
x.mjs`, `npx --yes <pkg>`, a path built at run time) [H]. The only real control against a
   hostile agent is **removing the credential** from its reach.
2. Required status checks **certify themselves**: their behaviour comes from PR content
   (package.json scripts, tests, workflow files). All ten pin `app_id` 15368 (github-actions) live
   [P], but `main-branch-protection.json` omits it, so the drift check cannot see that change. They
   gate regressions, not a hostile author. **Required review is the only merge control**, and it is
   not on. **`main` also has no push restriction and no PR requirement**: a SHA with green checks
   can be pushed to it directly, and the hook allows `git push origin HEAD:main` [H].
3. A Cloudflare token cannot isolate production from staging **inside one account** [I], and the
   Worker config has one `account_id` for both [P]. Environment gating, not token splitting, is the
   control; real isolation needs a second account (owner decision, HARD-5).
4. Until HARD-2 lands, any identity with Write can merge unreviewed code to `main`
   (`required_pull_request_reviews: null` [P]); `gh pr merge` without `--admin`/`--auto` passes
   the hook [H]. HARD-0 adds an interim block; it does not make the merge safe.

## What changed from v2 (read first)

| v2 claim or gap                                                 | Reality                                                                                                                                                                                                                                                                                                               | Now handled in                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `full-pipeline/*` secret exposure fixed late, in HARD-5         | `deploy-staging` runs for any PR whose head is `full-pipeline/*` and reads the production-capable Cloudflare token under `staging`, which has **0 protection rules and no branch policy** [P, live GET]. A Write identity needs no workflow edit.                                                                     | **HARD-3**, done **first**, before any Write identity exists |
| HARD-5 counts 12 PR-reachable jobs                              | `security-scan.yml` runs on **push to every branch**; `dependency-audit` runs the branch's `ci-stage-ocr-workspace.sh` with `OCR_PROPAGATE_TOKEN` [P]; `security-regression.yml` runs on push to `claude/**`. The scanner models only `pull_request` and `workflow_run`.                                              | **HARD-5a**                                                  |
| `OCR_PROPAGATE_TOKEN` is "a secret to move"                     | It is the **owner's identity** (20 PAT-opened PRs authored by the owner), org-visible to all repos, referenced in 24 jobs across 14 workflows [P]; its type is unread. If it is a classic `repo`/admin PAT it can rewrite branch protection and HARD-2 is moot.                                                       | **HARD-5a**, before HARD-2                                   |
| "Token split isolates staging from production"                  | One Cloudflare account [P]; Workers/D1 permission groups are account-wide [I]. The negative probe "staging token cannot read production D1" cannot pass.                                                                                                                                                              | **HARD-5** (property changed)                                |
| HARD-1: SSH key or HTTPS                                        | An SSH key has no Workflows limit [I]; an agent could push a workflow and read repo secrets on push.                                                                                                                                                                                                                  | **HARD-1**: HTTPS and token only, no SSH key for the agent   |
| HARD-1 before HARD-2 is safe                                    | In between, a non-admin Write identity can still merge unreviewed code [H].                                                                                                                                                                                                                                           | HARD-0 interim rule; HARD-2 pulled forward in the plan       |
| The verifier and scripts are trusted                            | They run from the working tree the agent can write to (`core.hooksPath=.husky/_`; file-tool writes to `.husky/**`, `scripts/hardening/**`, `node_modules/.bin/**`, `~/.config/husky/init.sh` pass the hook) [H, P]. Any owner `git commit`, `npm ci` or `apply-github --apply` in that tree runs agent code as admin. | **HARD-0** and the clean-clone rule                          |
| HARD-2: "PR-only bypass is not available in classic protection" | Classic `required_pull_request_reviews.bypass_pull_request_allowances` exists [I]; prove on a scratch private repo with `enforce_admins: true`.                                                                                                                                                                       | **HARD-2**                                                   |
| `BRANCH_PROTECTION_READ_TOKEN` "not reachable from PR jobs"     | `gate-execution-reconciler` (a required check) references it; any same-repo PR can edit a workflow [P].                                                                                                                                                                                                               | **HARD-2** (environment secret, main-only)                   |
| HARD-7 triggers                                                 | Floors on calls not blocks; workaround leaves no record; 0.5% unprovable at n=500; corpus is the tuning set; clock runs into the freeze.                                                                                                                                                                              | **HARD-7** rewritten                                         |
| Existing monitors work                                          | `STAGING_ADMIN_KEY`, `OSE_ADMIN_BEARER`, `BRANCH_PROTECTION_READ_TOKEN` exist in **neither** repo nor org secrets [P]: those jobs run with empty values.                                                                                                                                                              | **HARD-5** (table) and **HARD-8**                            |

---

## HARD-3: Environment and ref policies, **including `staging`**, first

**Status:** BACKLOG · **Prerequisite:** none · **Do before HARD-1 grants any Write identity**
**Owner:** PO (terminal); agent extends `apply-github.mjs` · **Closes:** CCR F9 (part)

**Acceptance criteria**

- [ ] `apply-github.mjs --apply` (owner's terminal) creates: the tag ruleset on `refs/tags/v*`
      (admin-role bypass only); `production` with the owner as reviewer and deploy refs `main` and
      `v*` tags; **and `staging` with a custom deployment policy of branch `main` plus tag `v*`**
      (this retires the opt-in `full-pipeline/*`-on-PR run; the owner accepts that, or keeps it
      behind a reviewer instead). **A no-reviewer smoke environment also has a branch policy.**
- [ ] Proof that a PR from a `full-pipeline/x` branch is **refused** by GitHub ("not allowed to
      deploy"), with that response as evidence **[I until proven]**.
- [ ] The probe tag name matches the ruleset but not the deploy trigger `v*.*.*`
      (`oursharedevents-ci.yml:125`); an agent-identity tag push is rejected (needs HARD-1).
- [ ] The first **real** tag release has never run (no `v` tag exists [P]); a **rejected dispatch**
      at the `production` approval prompt is walked through, `/health` stamp unchanged. The extra
      approval time is documented, not claimed as measured.
- [ ] **Push restriction on `main` to the owner** (classic `restrictions.users`, or a
      "restrict updates" ruleset with the owner as bypass). It adds no review friction and is the
      control that makes HARD-1 mean something **before** HARD-2: without it a Write identity can
      push a green SHA straight to `main` [H, P].
- [ ] **Owner-made workflow edits that make the policy not a red trap:** `if:` conditions on
      `deploy-staging` and `security-regression.yml` drop the `full-pipeline/*` and `claude/**`
      paths; the `full-pipeline` prefix is removed from `check-pr-secret-exposure.mjs`
      (`APPROVED_DEPLOY_PREFIX`), `assert-gate-execution.mjs` and their tests
      (`gate-execution.test.js`, scanner fixtures), or the gate reconciler will expect a deploy that
      can no longer run. The `assert-on-main` ancestry check is inlined in the workflow (today it
      runs from the commit being shipped, so an off-main tag commit can disable it).
- [ ] `apply-github.mjs` takes a **parameterised environment loop** (today it reads only
      `environments/production` and its fixtures key on exact arguments) and G4 reads `staging`
      too (today G4 inspects `production` only).
- [ ] **Applied and Verified are separate marks.** "Applied" is the owner's `--apply` plus the
      audit events; "Verified" needs HARD-0's verifier items and HARD-1's agent tag push, which
      come later. The story is not Done until both.
- [ ] `verify-hardening` G3 and G4 PASS (G3 FAILs on hidden bypass actors, HARD-0), read with a
      read-admin token; independent record: `repository_ruleset.create` and `environment.*` audit
      events.

**Rollback:** delete the ruleset by id; clear reviewers/policies, never delete an environment
(its secrets go with it).

---

## HARD-0: Hook, verifier and working-tree defects (code, one PR per class)

**Status:** BACKLOG · **Prerequisite:** none · **Owner:** agent builds; PO reviews. Each item
red-first, lock file updated, mutation-checked.

**Exploit items (before launch):**

- [ ] **`--dry-run` is a standalone argument**, not a substring of a value: `npx --yes wrangler
    deploy --env production --var X:--dry-run` refused **[H, allowed today]**; also
      `npx --yes`/`--package` prefixes before a watched program.
- [ ] **`mcp-cloudflare-write` matches write verbs on any server name** (UUID-named servers'
      `d1_database_delete`, `kv_namespace_delete` are allowed today [H]; latent for the UUID-named
      connector, which exposes only reads and the blocked `d1_database_query`. **The separate
      `mcp__cloudflare__*` server in this session does list write tools** (worker_deploy,
      secret_put, d1_delete_database, kv_put); the rule covers those by name [H].)
- [ ] **Interim merge rule:** `gh pr merge` (any flags) and the GraphQL `mergePullRequest` are
      refused for the agent until HARD-2 is verified, and `gh label create` / `pr edit
    --add-label` for `security:human-override` is refused.
- [ ] The matcher and W1 cover `Monitor`, `WebFetch` and `Glob`; W1's `coversMcp` checks `mcp__.*`
      **and** the shell tools, not the substring `mcp__`. `WebFetch` is refused for hosts outside
      an allowlist; `npx`/`npm install` of an unpinned package is refused.
- [ ] **Working-tree protection:** file-tool writes to `.husky/**`, `~/.config/husky/**`,
      `node_modules/.bin/**`, `scripts/hardening/**`, `.devcontainer/**`, `.vscode/**`, and the
      project's `.claude/skills/**`, `AGENTS.md`, `CLAUDE.md` are refused (today only `.git/hooks`
      and `.git/config` are, which is not where hooks run here [H]). `core.hooksPath` changes are
      refused.
- [ ] **Clean-clone rule is enforced, not advised:** `verify-hardening` and `apply-*` print their
      own blob SHA and compare it with `origin/main`'s (fetched, not the local ref); mismatch, or a
      dirty tree, reads **NOT A REAL READING**. Admin runs happen only in a clean clone at that
      hash, in the admin OS account (HARD-1).

**Verifier items:**

- [ ] **W8** parses the _active_ github.com account and FAILs on any other account in the
      keyring; **G6** probes capability (negative reads return GitHub's 403) instead of reading the
      role; **G5** is an **allowlist of expected repo-level secrets**, not a denylist (so it cannot
      rot), and excludes `CLOUDFLARE_ACCOUNT_ID`; **G3** FAILs when `bypass_actors` is hidden;
      **G2** also requires `dismiss_stale_reviews` and `require_last_push_approval`.
- [ ] **Identity is explicit:** `--plane=github` takes a short-lived read-admin token from an
      environment variable (owner terminal only); `--plane=workstation` runs as the agent.
      "Cannot verify" is reported separately from FAIL.
- [ ] **W6 is split** into liveness (a harness-originated record in the last 24 h; window fixed to
      7 days, it is 8 today) and efficacy (a block was ever recorded). Project and local settings
      files and `disableAllHooks` are read, or listed under "not measured".
- [ ] **No letter, no aggregate.** The report is one line per threat (**agent → production
      deploy, agent → secrets, agent → unreviewed merge, agent → exfiltration**), each
      OPEN / CLOSED / UNVERIFIED with control ids, identity used, and evidence kind (config / probe
      / independent record), plus the "not measured" list (hook efficacy, the 312/1,122 corpus
      misses, connectors, claude.ai side, interpreted-file behaviour).
- [ ] **Audit schema v2:** `call_id`; start and verdict records; `hook_sha`; `ms`; a `cause` enum
      for `analysis-failed`; allow **and** block for every tool with tool name and path class;
      `cmd_sha256` and `programs[]`; redaction **before** the 4,000-character cut; daily rotation.
      (The 3 s deadline makes verdicts time-dependent [P]; `ms` and `cause` make that visible.)

---

## HARD-1: A separate identity for agents, over **every** channel

**Status:** BACKLOG · **Prerequisite:** HARD-3 (the `staging` policy **and the push restriction on
`main`**), **HARD-5a's token split** (a Write identity can edit
`scripts/ci-stage-ocr-workspace.sh` and receive the owner's org-wide write PAT on any PR; no
Workflows scope is needed), HARD-0's named verifier items (W8/G6 capability probes) ·
**Owner:** PO (terminal) · **Closes:** CCR F9 (part)

**Acceptance criteria**

- [ ] **The agent runs as a standard user, not a local Administrator** (`net localgroup
    administrators` lists the owner's account today [P]; one UAC click by the same person
      elevates). The "separate OS account" is a boundary only if the agent session is the
      unprivileged one and the admin account is not signed in alongside it.

- [ ] The agent account is an **outside collaborator on this one repository** with **Write**
      (org `default_repository_permission` is `read` across 11 private repos, so org membership
      would grant read on all; seat and fine-grained-token approval requirements recorded).
- [ ] **HTTPS and a fine-grained token only; no SSH key is registered for the agent account.**
      Token scope: Contents, Pull requests, Issues read and write; Metadata read; **Actions
      read**. No Administration, Workflows, Environments or Secrets. Consequence recorded: the
      agent cannot edit workflow files; **every workflow change is owner-made**.
- [ ] The admin's SSH key is not in any agent-reachable ssh-agent, `credential.helper` holds no
      admin credential for github.com, and the agent's `core.sshCommand`/remote URL is HTTPS.
- [ ] **Probes from the owner's terminal, agent credential, outside the harness** (responses must
      be GitHub's): `GET actions/secrets`, `GET branches/main/protection`, `POST rulesets`, a push
      touching `.github/workflows/*`, and a tag push all fail with GitHub's rejection.
- [ ] Admin work happens in a **separate OS account and browser profile** that agent sessions
      and the Chrome extension cannot reach; the Cloudflare `wrangler login` (break-glass for
      ROLLBACK §4/§6) lives there. ROLLBACK's "laptop is logged in to Cloudflare" assumption is
      rewritten in the same change.
- [ ] `verify-hardening` W8 and G6 PASS **as the agent**; independent record: the audit events for
      the collaborator add and the token creation/approval (`personal_access_token.*`).

**Rollback:** `gh auth login` as admin; re-add the SSH key. Copilot and Codex are not covered by
the hook: HARD-9.

---

## HARD-5a: Branch-push and PR secret reachability; split `OCR_PROPAGATE_TOKEN`

**Status:** BACKLOG · **Prerequisite:** none (read-only investigation first) · **Owner:** PO,
agent prepares · **Parent fit:** ADR-020 Alt. B, OSE-1107

**Acceptance criteria**

- [ ] The owner reads (in a browser) the type and scopes of the PAT behind `OCR_PROPAGATE_TOKEN`
      and who owns it; the result is recorded. **If it is classic `repo`/admin, it is rotated to a
      fine-grained token before HARD-2** (otherwise HARD-2 can be undone with it).
- [ ] The token is split: a **read-only hub-clone token** (acceptable in PR jobs) for
      `ci-stage-ocr-workspace.sh`, and a **write PAT** used only by `conformance-report` and
      `notify-osm`, held as an environment secret on a `main`-only environment.
- [ ] **Secret-using jobs triggered by `push` are limited to `main`** (`security-scan.yml`
      `dependency-audit` today runs on every branch with the token [P]); `security-regression.yml`
      on `claude/**` is reviewed the same way. Edits are owner-made.
- [ ] **`security-regression.yml` (CF Access service token) runs only for `main`** in a
      `main`-only environment; its `claude/**` push trigger and the `full-pipeline/*` path are
      dropped. **`LINEAR_API_KEY`** (an org secret visible to all) is added to the list: it is
      reached by `premature-close-detector.yml` and `brain-contract-check`'s report-drift path.
- [ ] `check-pr-secret-exposure.mjs` models **push-to-any-branch** and `full-pipeline/*` as
      attacker-reachable and reads `environment:`; `--report` is clean for the secrets listed.
      There is **no "accepted in writing" alternative**: a reference that stays is a named
      exception in the allowlist file, reviewed like code.
- [ ] Independent record: the scanner's output attached to the PR, **plus one manual `gh api`
      read of repo and org secret names recorded in the PR** (the nightly in HARD-8 comes later and
      is not a prerequisite of this story, which removes the 5a ↔ 8 cycle).

---

## HARD-5: Deploy credentials into environments; honest Cloudflare isolation

**Status:** BACKLOG · **Prerequisite:** HARD-3, HARD-5a · **Owner:** PO moves; agent supplies the
generated per-job map · **Parent fit:** OSE-1110

**Acceptance criteria**

- [ ] **Decision recorded before 2026-10-20:** a second Cloudflare account for production
      (real isolation, one-time migration cost), or "one account; environment gating only; a
      staging deploy token is production-capable" written into the runbook. The criterion
      "staging token cannot read production D1" is **removed**.
- [ ] **Property:** no production-capable credential exists at repository level; it exists only as
      an environment secret released to `production`; a probe workflow on a PR branch receives an
      **empty value** for it (evidence: the run log).
- [ ] The secret × job table is **generated from the workflow YAML and checked in CI**. Its first
      version lists the jobs v1 missed (`security-monitoring.yml/health-check`,
      `mobile-workability-audit.yml/nightly-staging`) and flags names referenced but **absent from
      both repo and org lists** (`STAGING_ADMIN_KEY`, `OSE_ADMIN_BEARER`,
      `BRANCH_PROTECTION_READ_TOKEN`, others): each is created, or its job is removed.
- [ ] **T2 to T4 sub-jobs have no `environment:` and reference `CLOUDFLARE_API_TOKEN_OSE` 26
      times** (read from `oursharedevents-ci.yml`): moving the token into `staging` empties it for
      them. Each is given the environment, or the token it needs is a separate, narrower one; the
      jobs that break are listed per secret before any move.
- [ ] Order per secret, as its own owner-made PR: environment secret added → workflow PR green on
      `main` and the staging chain green for its merge SHA → repository secret deleted. A separate
      no-reviewer environment with a branch policy serves `smoke-production`.
- [ ] **Scheduling:** the secret moves are **after launch**; before it only the Cloudflare account
      decision and HARD-5a. Six owner-made PRs at about an hour each, a staging chain per merge
      (19 to 24 minutes on today's three pushes), and no tag deploy ever run do not fit beside the
      Harbor County deploy.
- [ ] `SMOKE_RPT_*` deleted as its own change after scripts and tests are grepped for references.
- [ ] G5 (allowlist form) PASSes from the read-admin token; independent record: a nightly
      `gh api …/actions/secrets` assertion (HARD-8).

**Risk:** highest of the set; the per-secret PRs run **outside 2026-10-20 → 2026-10-24**.

---

## HARD-2: Required review, code-owner review and last-push approval on `main`

**Status:** BACKLOG · **Prerequisite:** HARD-5a (PAT type and split) and the scratch-repo
rehearsal; **applied before the freeze with the owner as bypass actor** (apply 10-16/17), because
until it lands "agent → unreviewed merge" stays OPEN at launch; HARD-1's HTTPS identity lands
after it · **Owner:** PO applies, agent prepares · **Closes:** CCR F9 (part), F12

**Acceptance criteria**

- [ ] **Mechanism chosen and proven on a scratch private repository with the same JSON, not on
      live `main`** (applying review rules to `main` blocks ~20 merges per day): preferred, classic
      `bypass_pull_request_allowances` for the owner with `enforce_admins: true` **[I]**; else a
      ruleset with `bypass_mode: pull_request` (then `readLive()`, G2, G3 and the drift workflow
      learn rulesets); else a second code owner with write (a rubber stamp for the ~600 owner PRs
      in 60 days, sound only with the two settings below); else a timed break-glass.
- [ ] `main-branch-protection.json` sets one approving review, code-owner review,
      `dismiss_stale_reviews: true`, `require_last_push_approval: true`; `apply-branch-protection.mjs`
      and the contract test learn the bypass list. (Last-push approval only means something once
      pushes stop arriving over the owner's SSH key, HARD-1.)
- [ ] **PR classes rehearsed on the scratch repo**, from the 60-day record: owner interactive and
      `claude/*` (597), PAT-opened propagation/conformance (20), Copilot (2), Dependabot (0). Each
      reaches CLEAN; ROLLBACK §3 revert and §4 dispatch are rewritten against the result.
- [ ] **Evidence it blocks the threat:** an agent-authored PR is `REVIEW_REQUIRED`; `gh pr merge`
      from the agent fails with GitHub's response; an approve-then-push is dismissed.
- [ ] `BRANCH_PROTECTION_READ_TOKEN` is an **environment secret on a `main`-only environment**,
      the drift job declares `environment:`, and `gate-execution-reconciler` no longer references
      it; drift is green for three consecutive nights (red on 10-11 and 10-12 [P]).
- [ ] Applied **before** 2026-10-20 (rehearsal on the scratch repository 10-13/14, apply
      10-16/17) or after 2026-10-24, never inside the window; a security-fix exception to the
      freeze is written down. Then, and only then, the governance wording in the #958/#963 proposal
      is applied.
- [ ] **Admin runs are pinned to an owner-reviewed SHA recorded outside the repository** and
      hashed by the owner with `git hash-object` typed at the terminal: `apply-*` and
      `apply-workstation` copy code from the repo, and before this story `main` is writable
      unreviewed, so "this file is main" does not mean "this file was reviewed".

**Rollback:** field to `null`, re-apply from the JSON.

---

## HARD-4: Install the v2 hook and prove it

**Status:** BACKLOG · **Prerequisite:** HARD-0 (exploit items **and** schema v2: install only the
hook that logs v2) · **Owner:** PO (terminal) · **Closes:** CCR F13

**Acceptance criteria**

- [ ] Baseline `verify-hardening` output committed as an artifact with timestamp and commit hash,
      so a later run can be diffed against it.
- [ ] **Offline replay as a smoke test, not a rate, with a pass rule:** the owner supplies a
      **must-allow list** (the commands that make a normal day: git status/diff/commit, `npm
    test`, `gh pr create`, `wrangler dev`) and the replay passes only if every one is allowed;
      every other block is labelled by the owner. Bias noted: the window is the hardening sprint
      and includes denied/errored calls. Transcripts are redacted in a non-printing process.
- [ ] **Today, before any of this:** the `mcp__cloudflare__*` connector in this session lists
      **write tools** (worker_deploy, secret_put, d1_delete_database, kv_put, route_delete) [E:
      tool list]. The owner revokes or read-scopes that connector's token, and installs the
      **merged v1 hook** (10 minutes) — it has never written a record on this machine (no
      `~/.claude/audit`, no installed hook) — while the HARD-7 clock stays "v2 only".
- [ ] `apply-workstation.mjs` plan read; hash from `origin/main`; `--apply`; `.bak-<stamp>`.
- [ ] New session: `npx wrangler secret:bulk does-not-exist.json` refused with
      `[wrangler-secret]`; **one `mcp__cloudflare__kv_delete` against a nonexistent namespace**
      is refused with `[mcp-cloudflare-write]` (a no-op target if the hook is not live).
- [ ] W1 to W6 PASS (W6 liveness and efficacy separately); the clock for HARD-7 starts at the
      first v2 record.

**Rollback:** restore `settings.json.bak-<stamp>`; delete the installed hook.

---

## HARD-6: Scope outbound connectors; pin and read-only the Cloudflare MCP

**Status:** BACKLOG (decision first) · **Owner:** PO · **Closes:** CCR F10, B2

- [ ] The decision (block in the hook, or off by default and per task) is recorded with its
      reason. Launch raises untrusted input (public events, sponsor links), so "off by default" is
      the recommended default.
- [ ] If off by default: a **fresh-session tool-inventory diff** shows the connectors absent;
      one task run with one enabled proves the per-task path. Non-use is observable only after
      HARD-0 schema v2.
- [ ] Cloudflare MCP: package pinned; its token is read-only, **proven by a write attempt from
      the owner's terminal that Cloudflare itself rejects** (not by the hook's refusal).
- [ ] The Chrome profile attached to the extension has no admin sign-ins (it opens the GitHub
      settings page logged out).

---

## HARD-7: Measure the hook honestly

**Status:** BACKLOG · **Prerequisite:** HARD-0 schema v2, HARD-4 · **Owner:** agent

- [ ] **Floors are on blocks and distinct commands**, not calls: at least 30 blocks (a 10%
      false-positive bound by the rule of three) and join coverage of at least 99% between audit
      sessions and transcripts; count distinct `cmd_sha256` so retries do not inflate rates.
- [ ] **"Workaround" is defined by an owner-label sidecar** (true positive / false positive /
      "owner wanted it" / "ran it myself"), since the owner's terminal leaves no record; "active
      day" = a day with at least one shell call.
- [ ] Triggers written before data: any transcript-confirmed effective bypass **of the class the
      hook claims to cover** (documented text-matching limits excluded); `analysis-failed`
      reported with its upper bound at the observed n, not tested against 0.5%; owner workaround
      rate reported with its interval, not a hard threshold at n=3 days.
- [ ] Efficacy comes from **periodic red-team replays on a held-out split** with a
      pre-registered miss threshold; the tuning corpus is reported separately as regression only.
- [ ] Checkpoints at day 3 and day 7 reported **by regime** (development, freeze, launch);
      launch-regime friction is stated as unmeasured until it is. The reviewer's miss threshold is
      a **number written down first** (for example, no more than 5% of a held-out set of at least
      100 should-block lines), not "pre-registered" in prose.
- [ ] **Join coverage needs a field the v1 hook does not log** (`session` only): the hook input
      carries `transcript_path` and a tool-use id **[I, to confirm]**; schema v2 records them.
- [ ] What this cannot show, stated in the report: efficacy against an adaptive attacker (a
      held-out split from the same author is not independent), recall (only blocks are labelled),
      generalisation to anyone else, and launch-regime rates. Hook-only evidence caps a threat at
      "speed bump", never CLOSED.
- [ ] The log is used for **friction and allowlist sizing** only. Gitleaks runs over the whole
      log; it stays local.

---

## HARD-8: Drift canary for the new controls

**Status:** BACKLOG · **Prerequisite:** HARD-0, HARD-3 (a nightly can verify what HARD-5a and
HARD-5 changed; neither depends on it) · **Owner:** the **workflow is owner-made** (the agent token
has no Workflows scope), the agent drafts it; the PO supplies a read-only token as a `main`-only
environment secret (HARD-2, HARD-5a and HARD-8 together need three new `main`-only environments,
which `apply-github.mjs` must create)

- [ ] A nightly job runs the github plane and fails when the tag ruleset, any environment's
      reviewers or deployment policy (**including `staging`**), the repository and org secret
      names (including `OCR_PROPAGATE_TOKEN` visibility), or the collaborator set differ from an
      allowlist in the repo.
- [ ] Workstation: a SessionStart check runs W1 to W5 and warns; the audit log's heartbeat shows a
      record per active day.
- [ ] Born-red: each check is shown failing against a planted change on a scratch repository.

---

## HARD-9: Agents the hook does not cover; persistence; CI-side agent surface

**Status:** BACKLOG · **Owner:** PO, agent drafts

- [ ] Copilot and Codex (AGENTS.md names them): per agent, its identity, credential channel and
      whether it is prevented or accepted, with a **negative probe**, not an inventory.
- [ ] **Instruction persistence:** `.claude/skills/**`, `AGENTS.md`, `CLAUDE.md` changes arrive
      only through reviewed PRs (HARD-0 write protection plus HARD-2).
- [ ] **CI-side agents:** `@claude` is **inert today** (`CLAUDE_CODE_OAUTH_TOKEN` and
      `ANTHROPIC_API_KEY` are absent at repo and org level, recent `issue_comment` runs `skipped`
      [P]); before those secrets are added, the trigger is restricted to `OWNER` (`COLLABORATOR`
      includes outside collaborators, which the agent account will be).
      `security-human-gate.yml` becomes a required check, and its "human" test is not a name
      regex (an agent with Issues write can add `security:human-override`).
- [ ] The `copilot` environment (0 rules, no policy today) gets the same deployment policy as
      `staging`, or is deleted if unused.

---

## HARD-10: Sandboxed or default-deny shell for agent sessions (decision first)

**Status:** BACKLOG (decision) · **Owner:** PO

The hook cannot be made complete [H]; only credential removal and a sandbox are controls. If the
PO chooses this, it is the largest story: a container or WSL session with no credentials, the
repository mounted, egress limited to an allowlist, the hook as a second layer. HARD-7's
pre-registered triggers define when to revisit.

**Acceptance criteria (for the decision, not the build):**

- [ ] The PO records one of: (a) speed bump plus audit, with credential removal (HARD-1) as the
      control; (b) a sandbox with no credentials for agent sessions; (c) both, sandbox first.
- [ ] If (b) or (c): a spike of at most one day shows the repository's test and build commands
      run inside it, and a probe from inside it cannot reach `~/.ssh`, `~/.config/gh`, the
      credential manager or a Cloudflare session; the spike's result is committed.
- [ ] Push rulesets (path restrictions on `.github/workflows`, `.husky`, `CODEOWNERS`) are
      evaluated as a cheaper control than token scopes: the organisation is on the `enterprise`
      plan **[I, to confirm]**.

## Order and calendar (today 2026-10-12; freeze 10-20; launch 10-24)

There are **six working days to 10-19**, not eight, and no tag deploy has ever run (no `v` tag
exists [P]); the production path is untested before launch, so nothing below touches it except
policy that is rehearsed first. For the refusal proof use a **staging-only dispatch from a
non-`main` branch** (GitHub's own refusal), not a rehearsed production dispatch (a full chain run
and a risk of a mistaken approval).

**Today (10 minutes each, no dependencies):** revoke or read-scope the `mcp__cloudflare__*`
connector token (HARD-4); install the merged v1 hook (HARD-4); the owner reads the type and
scopes of the PAT behind `OCR_PROPAGATE_TOKEN` in the browser (HARD-5a).

**Before 10-19 (minimum for launch, in this order):**

1. **HARD-3** with the `staging` policy and the push restriction on `main`, plus the owner-made
   `if:` edits; rehearse the refusal on a non-`main` branch.
2. **HARD-5a** token split and the `push`-to-`main`-only edits (a PAT that is classic
   `repo`/admin is rotated first).
3. **HARD-2**: rehearse on a scratch private repository 10-13/14; **apply 10-16/17** with the
   owner as bypass actor.
4. **HARD-0 exploit items** (`--dry-run`, MCP verbs, working-tree protection, the clean-clone
   rule, matcher additions), reduced to what is exploitable.
5. **HARD-1** (HTTPS only, standard-user agent session); **HARD-6** connectors off by default.

**Expected per-threat status at launch if this lands** (stated so nobody reads it as more):

| Threat                    | Status                                                                                                                                                  | Why                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| agent → unreviewed merge  | **CLOSED** for non-bypass identities; the owner can still merge their own work                                                                          | HARD-2 and the push restriction       |
| agent → production deploy | **PARTLY**: environment gating holds for tag and dispatch; **a merge to `main` still runs T1 with a production-capable token (one Cloudflare account)** | HARD-5's account decision is not made |
| agent → secrets           | **OPEN** for secrets still at repository level until HARD-5's moves                                                                                     | moves are after launch                |
| agent → exfiltration      | **UNVERIFIED by construction**: no check exists                                                                                                         | HARD-0's report says so               |

**After 10-24:** the rest of HARD-5 (one secret per PR), HARD-0 schema v2 and HARD-4's v2
install, HARD-7 checkpoints, HARD-8, HARD-9, the HARD-10 decision.
