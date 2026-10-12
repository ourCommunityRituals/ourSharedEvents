# CCR: the hardening follow-up stories (HARD-0 to HARD-10) and the plan they imply (2026-10-12)

Protocol: `.claude/skills/ccr-protocol.md` v3.0, **extended scrum team**, 3 loops (the owner's
request). Subject: `HARDENING-STORIES-DRAFT-2026-10-12.md` (drafted v1; reviewed and corrected to
v4 across this CCR). Author of the draft and of this worksheet: the same agent session; every
review below was done by a separately briefed subagent that was given files, not conclusions.

## Verdict

|                           |                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gate result**           | **STOP: does not clear 95%. Human gate open.**                                                                                                                                                                                                                                                                             |
| **System score**          | **0% on each loop as scored** (Security Critical floor; arithmetic below the floor in every loop). **Corrected-state estimate 32.5%** for v4, not independently re-reviewed.                                                                                                                                               |
| **Assessment confidence** | about 60%. Every pass found things the author had missed; loop 3 found no new _class_ but did find that the launch set does not close the headline threats. Several load-bearing facts are still inferred ([I]) and need a scratch-repository proof.                                                                       |
| **Trend**                 | deductions 201 (L1) → 295 (L2) → 282 (L3). Not converging toward zero in raw count, because each loop widened what counted (CI trigger surface in L2, cross-story consistency in L3). The L3 Security Criticals were about the plan _claiming more than it delivers by launch_, which v4 now states in a per-threat table. |
| **Not in this score**     | whether any owner step has been taken; Cloudflare token behaviour and the PAT's type (unread); whether GitHub honours the proposed policies (rehearsal on a scratch repository).                                                                                                                                           |

A CCR score is a signal, never permission. Adopting any of these stories, and applying any setting,
still goes through the PO.

## Classification and scope

- **Class:** security work plan touching access control and the release path: the protocol sets
  3 to 4 loops for a security fix; the owner asked for 3, run here. Governance artifacts were
  **not** edited (protocol §4).
- **Environment modifier:** 1.0 (workstation and CI tooling; the thing protected is production and
  the 2026-10-24 launch).
- **In scope:** the seven-then-eleven stories, their acceptance criteria, their ordering, their
  evidence design, and the calendar to launch.
- **Out of scope:** applying any setting; the hook's rule list (reviewed in the earlier CCR); the
  claude.ai connector scopes beyond what a session lists; hub and other org repositories.

## Team and what each lens did

| Role                                         | Contribution                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dr of Security (independent pass, each loop) | Efficacy of every control; ran ~60 synthetic hook probes and ~45 read-only GitHub GETs; found the SSH/HTTPS identity channel, the push-to-any-branch secret path, the `full-pipeline` staging door, and the merge window. |
| Sr Data Scientist                            | Measurement validity of HARD-7 and of the verifier's letter grade; blocks (not calls) as the binding quantity; rule-of-three bounds; why the audit log cannot support efficacy claims; per-threat report format.          |
| Sr Automation QA                             | Classified every acceptance criterion as can-fail / owner-say-so / cannot-fail (60 criteria in v3: 42 / 12 / 6).                                                                                                          |
| Sr SDET/SRE                                  | Rollout risk per PR class; drift canary gap; which monitors silently run with empty secrets.                                                                                                                              |
| DevOps Mgr + Lead BE Architect               | GitHub semantics feasibility: classic bypass allowances vs rulesets, environment tag policies, token scopes; one Cloudflare account; the secret × job table from YAML.                                                    |
| PO                                           | The decisions in the human gate.                                                                                                                                                                                          |
| Lead FE Integration, Sr Design FE            | Not applicable: no UI, template or token change.                                                                                                                                                                          |

## Loops

### Loop 1 — surface pass (on v1)

- **Critical:** the stories assumed the agent identity could be separated by changing the `gh`
  token. **Conservative:** assume every other channel still authenticates as admin.
- Findings: SSH key and credential manager keep admin (so the tag-ruleset claim in v1 was false);
  required review deadlocks the single owner (219/219 commits owner-authored, one code owner,
  `enforce_admins`); no `dismiss_stale_reviews` / `require_last_push_approval`; `check-pr-secret-
exposure --report` cannot show a secret moved (it never reads `environment:`); G5 omits five
  names; G2/G5 need admin while G6/W8 need non-admin; audit log has no duration, outcome or
  allow records for file/MCP tools; the nightly drift job cannot pass (`BRANCH_PROTECTION_READ_TOKEN`
  exists nowhere).
- **Score:** 0% (3 Security Critical; arithmetic 201 deductions). Confidence 65%.
- **Reactive correction:** v2 added HARD-0 (code defects), the SSH criterion, bypass plan,
  last-push approval, clean replay, schema v2, per-threat reporting.

### Loop 2 — pressure pass (on v2; three lenses)

- **Critical:** which paths let PR or branch code reach production-capable secrets _before any
  review_? **Conservative:** the agent has Write on day one.
- Findings: `staging` has 0 protection rules and `deploy-staging` runs for `full-pipeline/*` PRs
  with the Cloudflare token (proven); `security-scan.yml` runs on **every push** with
  `OCR_PROPAGATE_TOKEN` and the scanner does not model push; the owner's write PAT reaches PRs;
  one Cloudflare account means the token split cannot isolate production; an approve-then-push
  merge; the pre-HARD-2 window (`gh pr merge` allowed); `.husky`/`scripts/hardening` writable by
  file tools and the verifier runs from that tree; negative probes are confounded by the hook;
  HARD-7's triggers are mostly unsupported; calendar incoherent; classic
  `bypass_pull_request_allowances` exists (v2 said it did not).
- **Score:** 0% (2 Security Critical; 295 deductions at ×1.25). Confidence 55%.
- **Reactive correction:** v3 made HARD-3 first and added `staging`; added HARD-5a (push/PR secret
  reachability and the PAT split); HTTPS-only; scratch-repo rehearsal; an "environment secret
  released only to `production`" property instead of token isolation; honest-limits section;
  HARD-7 rewritten.

### Loop 3 — confirmation pass (on v3; two fresh reviewers)

- **Critical:** does the _launch_ set close the threats the plan names? **Conservative:** assume
  the owner executes exactly the minimum list and nothing else.
- Findings (new or still open): after the minimum list an agent with Write can still land code on
  `main` (no push restriction, no PR requirement; `git push origin HEAD:main` passes the hook) and
  the `main` push runs T1 with a production-capable token; the owner's write PAT reachable from
  any agent PR must precede HARD-1; the agent's OS account is a local Administrator; admin runs
  execute `main`'s code before `main` is reviewed (the SHA check proves "is main", not "was
  reviewed"); `security-regression`'s CF Access token is outside HARD-3; `LINEAR_API_KEY`
  unmentioned; the `staging` policy will leave the `full-pipeline` prefix as a permanently red
  trap in the scanner and reconciler; Done bars are circular (5a/5 take evidence from HARD-8,
  whose prerequisite is 5a); my "no `app_id` pinned" claim was false (all ten pin 15368).
- **Score:** 0% (2 Security Critical; 282 deductions at ×1.5). Confidence 70% (own passes
  70% and 80%).
- **Reactive correction:** v4 (this document's subject): push restriction on `main` added to
  HARD-3; token split and standard-user agent made prerequisites of HARD-1; HARD-2 pulled before
  the freeze with the owner as bypass actor; admin runs pinned to an owner-typed hash; `if:` edits
  and scanner/reconciler cleanup listed; Applied vs Verified split; HARD-5 secret moves after
  launch; per-threat expected status at launch; HARD-10 given acceptance criteria.

## Evidence

| Claim                                                                                                                                                                           | Tag | Evidence                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------- |
| `staging`, `production`, `copilot` environments have 0 protection rules and no branch policy                                                                                    | [P] | live `GET …/environments/<name>` 2026-10-12                                         |
| Required checks: 10, all pin `app_id` 15368; no reviews; no push restriction; `enforce_admins` true                                                                             | [P] | live `GET …/branches/main/protection`                                               |
| `security-scan.yml` runs on push to every branch; `dependency-audit` passes `OCR_PROPAGATE_TOKEN` to `scripts/ci-stage-ocr-workspace.sh`                                        | [P] | `security-scan.yml:35-40,249-273`                                                   |
| `deploy-staging` runs for `full-pipeline/*` PR heads with the Cloudflare token                                                                                                  | [P] | `oursharedevents-ci.yml:1167-1184`                                                  |
| One Cloudflare `account_id` for both environments                                                                                                                               | [P] | `workers/oursharedevents/wrangler.toml:40`                                          |
| `OCR_PROPAGATE_TOKEN` is an org secret visible to all repositories                                                                                                              | [P] | live `GET orgs/…/actions/secrets`                                                   |
| `--dry-run` inside a value, `git push origin HEAD:main`, `gh pr merge`, writes to `.husky/**` and `scripts/hardening/**` pass the hook                                          | [H] | synthetic probes against the merged hook, rc=0                                      |
| `mcp__cloudflare__*` write tools are listed in the session; the hook blocks them by name                                                                                        | [H] | probe: `d1_delete_database`, `worker_deploy`, `secret_put` → `mcp-cloudflare-write` |
| UUID-named connector's write verbs are not matched                                                                                                                              | [H] | probe; latent (that connector lists reads plus the blocked `d1_database_query`)     |
| `STAGING_ADMIN_KEY`, `OSE_ADMIN_BEARER`, `BRANCH_PROTECTION_READ_TOKEN` exist in neither repo nor org secrets                                                                   | [P] | `gh secret list` (names only), repo and org                                         |
| Staging policy will be accepted by GitHub for `type: tag`; classic `bypass_pull_request_allowances` works with `enforce_admins: true`; Workers/D1 token scopes are account-wide | [I] | to be proven on a scratch private repository / by Cloudflare's token model          |

## Findings register and arithmetic

`Score = 100 − Σ(base × state × loop position)`; Verified 0, Partial ×0.5, Unverified ×1.
Security Critical has no partial credit: any open one floors the score at 0. Weights: Security
Critical/Critical 15, High 10, Medium 5, Low 2.

### As scored per loop

| Loop      | SC  | Crit | High | Med | Low | Deductions | Result |
| --------- | --- | ---- | ---- | --- | --- | ---------- | ------ |
| 1 (×1.0)  | 3   | 1    | 9    | 9   | 3   | 201        | 0%     |
| 2 (×1.25) | 2   | 4    | 10   | 8   | 3   | 295        | 0%     |
| 3 (×1.5)  | 2   | 4    | 6    | 6   | 4   | 282        | 0%     |

### Corrected-state estimate (v4; amendments not independently re-reviewed)

| ID  | Residual                                                                                                                                                            | Sev    | State              | Deduction            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------ | -------------------- |
| R1  | Agent → production: a `main` merge runs T1 with a production-capable token while there is one Cloudflare account; closes only by an owner decision (second account) | High   | Open               | 10 × 1.0 × 1.5 = 15  |
| R2  | The hook cannot read what a program does; accepted as a speed bump, only credential removal controls                                                                | High   | Partial (accepted) | 10 × 0.5 × 1.5 = 7.5 |
| R3  | `OCR_PROPAGATE_TOKEN` type and scopes unread; if classic `repo`/admin it undoes HARD-2                                                                              | High   | Unverified         | 10 × 1.0 × 1.5 = 15  |
| R4  | `staging` tag/branch policy semantics for `pull_request` events unproven                                                                                            | Medium | Partial            | 5 × 0.5 × 1.5 = 3.75 |
| R5  | `bypass_pull_request_allowances` with `enforce_admins` unproven                                                                                                     | Medium | Partial            | 5 × 0.5 × 1.5 = 3.75 |
| R6  | 12 owner-say-so and 6 unfailable criteria in v3; v4 fixes some, not re-counted                                                                                      | Medium | Partial            | 5 × 0.5 × 1.5 = 3.75 |
| R7  | Calendar: six working days; no tag deploy ever run; HARD-5 moves after launch                                                                                       | Medium | Open               | 5 × 1.0 × 1.5 = 7.5  |
| R8  | HARD-7 cannot show efficacy, recall or launch-regime rates (stated, accepted)                                                                                       | Medium | Partial (accepted) | 5 × 0.5 × 1.5 = 3.75 |
| R9  | The twelve v4 amendments were not independently confirmed                                                                                                           | High   | Partial            | 10 × 0.5 × 1.5 = 7.5 |
|     |                                                                                                                                                                     |        | **Total**          | **67.5**             |

**Corrected-state estimate = 100 − 67.5 = 32.5%.** If a fourth independent pass finds an unresolved
Security Critical in v4, the score is 0%.

## What must be true before this plan is adopted or acted on

1. Decision R1 (Cloudflare account) made **before 2026-10-20**, because it decides whether
   "agent → production deploy" can ever read CLOSED.
2. The owner has read the type and scopes of the PAT behind `OCR_PROPAGATE_TOKEN` (browser).
3. HARD-3's policies and HARD-2's bypass are proven on a **scratch private repository** with the
   same JSON before they touch live `main`.
4. One independent confirmation pass over v4 (the protocol's "recursive" step is not finished
   until the amendments are re-read by someone who did not write them).
5. No governance file is edited until the human gate.

**Commit sequence for the plan itself:** this worksheet and the draft in one docs-only PR →
the owner chooses which stories enter Linear and under which parent (suggested OSE-1488) → HARD-0
code PRs (one class each, red-first, lock updated) → owner-terminal steps in the calendar order.

**Verification after:** per story, the named `verify-hardening` control **from the named
identity**, one independent record (audit-log event, CI artifact, or a probe that fails with
GitHub's or Cloudflare's own response), and from HARD-0 the per-threat report with its
"not measured" list. After 14 days, HARD-7's checkpoint report, by regime.

## Risks accepted pending the gate

- The hook stays a speed bump; interpreted programs, package fetch-and-run and a command built at
  run time are not read.
- Required status checks certify themselves; review is the only merge control and is applied
  late (before the freeze if the owner agrees, otherwise after launch).
- Until HARD-5's moves, repository-level secrets stay reachable by branch pushes and PRs wherever
  HARD-5a has not closed the path.
- Exfiltration has no check; it reads UNVERIFIED by construction.

## Human-gate questions

1. **Cloudflare isolation (decides R1).** Move production to a second Cloudflare account before
   launch, or record "one account; environment gating only" and accept that a `main` merge runs
   with a production-capable token? Information that closes it: what a staging-only token can do on
   this account (a read of the token's scopes in the Cloudflare dashboard).
2. **`full-pipeline/*` on PRs.** Is the opt-in full-pipeline-on-PR path used? Retire it, or keep it
   behind a required reviewer on `staging`.
3. **Apply required review before the freeze?** Rehearse 10-13/14, apply 10-16/17 with the owner as
   bypass actor (about 20 approvals a day if the bypass is not used); or after launch, with
   "agent → unreviewed merge" OPEN at launch.
4. **The PAT.** What is `OCR_PROPAGATE_TOKEN` (classic or fine-grained, scopes, owner)? Will you
   rotate it to a fine-grained, single-repo token and split read from write?
5. **Agent account.** Standard user on this machine (or WSL / container), and an outside
   collaborator account with an HTTPS-only fine-grained token: yes or no? Seat cost on the
   enterprise plan is unconfirmed.
6. **Hook strategy (HARD-10).** (a) speed bump plus audit with credential removal as the control;
   (b) sandboxed shell with no credentials; (c) both, sandbox first.
7. **Which stories enter Linear**, under which parent, and what to do with the post-launch ones.

## Limits of this worksheet

- Loop 3 reviewed v3; v4's amendments are mine and unreviewed by an independent pass (R9).
- Three of the load-bearing facts are inferences about GitHub and Cloudflare behaviour [I].
- The reviewers' reports were relayed as model output; where a finding drove a change, the
  specific fact was re-checked by me (environments, protection, push triggers, hook probes), and
  one reviewer claim was **narrowed** after a probe (the UUID-connector "Critical" is latent).
- Probes ran with the audit directory redirected; none wrote to the real `~/.claude/audit`.
- This session's own tool list showed connectors with write tools (Cloudflare, Gmail, Drive,
  Notion, Shopify, LegalZoom). No such call was made by this assessment.
