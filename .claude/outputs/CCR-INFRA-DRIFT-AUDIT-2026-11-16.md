---
ccr: 1
class: security-fix
requested_loops: 3
loops_run: 3
team: base
gate: stop
cumulative_score: 0
system_score: 0
unresolved: { regulatory: 0, security_critical: 1, critical: 0, high: 4, medium: 9, low: 9 }
subject_sha: '7089d79a334c9e02157a5ee59e9a9985b989ba79'
---

# CCR: infrastructure drift audit, the records against what is there (2026-11-16)

**What was asked (owner, 2026-11-16):** "Please conduct a full audit from where this capture was vs where the infra is now."

**How it was read.** "This capture" is taken to mean what the repository's own records say about the infrastructure: `AGENTS.md`, `CLAUDE.md`, `docs/brain/ROLE-STATE.md`, `docs/brain/CONSTRAINTS.md`, the runbooks, `docs/security/` and the ADRs. "Where the infra is now" is the workflows, the Wrangler config, the Worker's code, the CI runs on `main`, and what staging and production answer to a plain read today. If the owner meant another capture, the register still stands, and the scope line changes.

**How it ran:**

- Three loops, in order: Critical, Conservative, Recursive. Nothing in the subject was changed between them.
- The subject is `main` at `7089d79`. This is a report. No fix was written.
- Every role lens ran read-only and listed the commands it ran.
- **Departures from the protocol, recorded:**
  - **The owner named no loop count and no class.** The lead chose 3 loops and the class "security fix", because the heaviest findings are security controls. An audit is not a fix; the class sets the minimum loop count and nothing else here.
  - **The team is the base team, not the extended one.** Five of the nine roles ran. The owner did not ask for the extended team.
  - **Loops 2 and 3 each ran one lens.** The lead's own checks are reported inside each loop as the lead's, not as a lens.

## Verdict

|                           |                                                                                                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Answer**                | **The records and the infrastructure disagree in 23 places. One is a Security Critical: unreviewed code can reach a token that can deploy production.** Most of the rest are records that call a convention a control, or records that are out of date.                             |
| **Cumulative score**      | **0%.** Loop 1 alone scored 25%. Loop 2 raised one finding to Security Critical, which floors the score.                                                                                                                                                                            |
| **System score**          | **0%.** Nothing was fixed in this audit.                                                                                                                                                                                                                                            |
| **Security Critical**     | **One (B1).** Its repository half is read from source. Its settings half rests on the repository's own record of 2026-09-26 and could not be read live.                                                                                                                             |
| **Assessment confidence** | **70%.** The repository side is read from source and the live side from plain reads of both hosts and from CI runs. GitHub settings, Cloudflare settings, the token's real scope and the secrets could not be read. Down from 75 after loop 3 corrected the worksheet (see Loop 3). |
| **Gate**                  | **Stop, human gate.** The questions are at the end. A CCR score is a signal, never permission.                                                                                                                                                                                      |

## What was reviewed

**In scope**

- Records: `AGENTS.md`, `CLAUDE.md`, `docs/brain/ROLE-STATE.md`, `docs/brain/CONSTRAINTS.md`, `docs/runbooks/*`, `docs/security/*`, `docs/adr/ADR-028`, `.claude/skills/*.knowledge.md`, `.claude/hooks/*`.
- Configuration: `.github/workflows/*`, `.github/CODEOWNERS`, `tools/ci/main-branch-protection.json`, `workers/oursharedevents/wrangler.toml`, `scripts/ci/*`, `scripts/hardening/*`.
- Code where a record makes a claim about it: `workers/oursharedevents/src/router.ts`, `src/auth/admin.ts`, `src/handlers/events.ts`, `src/handlers/upload.ts`, `src/lib/*`.
- Live, read-only, 2026-11-16: plain GETs of `/`, `/events`, `/api/v2/events`, `/events/test-event-001` and the two calendar addresses on `stg.oursharedevents.com` and `oursharedevents.com`; the `main` run list and job lists of "OurSharedEvents CI/CD"; the run list of "Street-map archive load (stg)".

**Out of scope, and why**

- GitHub settings (branch protection as applied, rulesets, environment reviewers, where each secret is stored, repository variables): not readable from a session.
- Cloudflare settings (WAF rules, the token's scope, bucket contents, Access policies): not read. Nothing in Cloudflare was changed.
- The contents of the staging and production databases.
- A line-by-line audit of every count route, every Bruno request and every runbook sentence. Samples only, as marked.

## Loop 1

Team: role-devops, role-sdet-sre, dr-of-security, role-backend-architect
Critical layer: The most dangerous assumption was that a record saying "X is enforced" names a gate that exists, runs in a required check and can fail. Four lenses each took one lane and compared the record's sentence with the file. What is true: production cannot deploy on a plain push to `main`; the four Done-bar job names exist; the write guard and the brand-scope guard run centrally before admin dispatch; both databases' migrations are gap-free; the CI edge token is sent only to staging. What was only assumed is in the list below.

The lenses found (each is a row of the register):

- A1: one deploy token serves staging and production jobs, and the repository's record says secrets are repository-level and the environments have no reviewers (Dr of Security).
- A2: branch protection requires no review, so CODEOWNERS blocks nothing (Dr of Security).
- A3: the policy-gate hook is wired in no committed settings and is absent in a cloud session (Dr of Security).
- A4: several public reads have no limiter at the route (Backend Architect).
- A5: the router header is not the full route list (Backend Architect).
- A6: "each push cancels the running run" is not true on `main` (DevOps).
- A7: calendar addresses are challenged on staging and production (lead, live).
- A8: about 81 Bruno requests accept a 403 or skip their checks when the answer is not the Worker's (SDET/SRE).
- A9: `T4_MAX_SKIP_RATIO` is in no record (SDET/SRE).
- A10: 97 spec files under `tests/e2e` run in no workflow (SDET/SRE).
- A11: with `PRODUCTION_LIVE` unset, production has no scheduled security check, and the host answers (Dr of Security; lead, live).
- A12: the admin fallbacks are gated by flags, with no environment check in code (Dr of Security).
- A13: the CCR gate can only warn (Dr of Security, SDET/SRE).
- A14: `.claude/skills/devops.knowledge.md` describes an infrastructure that no longer exists (DevOps).
- A15: `AGENTS.md` names OSE-1656 as open; the code and ROLE-STATE say it is mostly closed (Backend Architect).
- A16: the local vetting seed has no retry (SDET/SRE; seen failing once on PR 1350).
- A17: the "migration level is not compared" sentence leaves out the gate that does exist (DevOps).
- A18: assorted stale records (all four).

**The lead's checks in the merge:**

- **A4 confirmed** for `/api/v2/events/:id`: `router.ts:2334-2337` calls `handleGetEvent` directly, and `handlers/events.ts` holds no limiter.
- **A7 read live.** On both hosts, `/brands/root/calendar.ics` and `/events/test-event-001/calendar.ics` answered 403 with `cf-mitigated: challenge`. So did `/events/test-event-001`. `/`, `/events` and `/api/v2/events` answered 200 on both. The records (CONSTRAINTS.md:17, ADR-028) already say the rule is not applied, so A7 is a gap the records know, not a drift.
- **A9 corrected.** The SDET/SRE lens could not tell whether the variable is set. A T4g log of 2026-11-16 prints `PW_MAX_SKIP_RATIO=0.2`, so it is set. What remains is that no record says so. Low.
- **A6 read live.** A `main` run that started at 17:02 UTC reached its staging deploy at 18:39, with seven runs queued behind it. PRs 1234 and 1252 (2026-11-14) made the queue first in, first out on purpose; the sentence in `AGENTS.md` was not changed with them.
- **A1 held at High in this loop**, because its settings half rests on a record dated 2026-09-26.

Score: 25%

## Loop 2

Team: dr-of-security
Conservative layer: Assume the worst of each top finding. Does the floor "an agent never deploys production; production deploys only through CI by tag or dispatch" still hold? The lens answered five worst-case questions from source. The floor does not hold in the repository: it holds only if GitHub settings that could not be read say so.

The lens found:

- **A1 becomes B1, Security Critical.** No workflow edit is needed. A same-repo branch named `full-pipeline/*` runs `deploy-staging` on the pull request's own code with `CLOUDFLARE_API_TOKEN_OSE` (`oursharedevents-ci.yml:1097-1102`, `:1154`). The guard treats that prefix as the approved path (`scripts/check-pr-secret-exposure.mjs`, `APPROVED_DEPLOY_PREFIX`). The policy document says the token can deploy Worker code to staging and production (`docs/security/CF_API_TOKENS_POLICY.md:62`). Staging and production are in one Cloudflare account (`wrangler.toml:40`).
- **A3 rises to High.** The hook is the barrier the hardening script itself names for tags, and it is not in a cloud session.
- **A12 falls to Low.** Both flags are declared only under `[env.staging.vars]`; Wrangler does not inherit `vars`; entry also needs a secret the production deploy refuses.
- **B2 (High):** the required checks are produced by workflows and scripts read from the pull request's head, with no required review. A writer can turn a required gate green by editing it.
- **B3 (High):** a pushed `v*.*.*` tag on a `main` commit starts `deploy-production` (`:2767-2769`). `scripts/hardening/apply-github.mjs:17-21` says the tag ruleset "stops nothing an admin token cannot undo" until agents run as a non-admin identity, and that the hook's tag rules are what stand in the way.
- **B4 (Low):** the Linear close-guard is not a required check.
- **B5 (Low):** `/api/v2/events/:id` answers 403 for an id that exists but is not public and 404 for one that does not, which tells a caller that a hidden event exists.
- **B6 (Low):** `/api/v2/uploads/*` reads the file without checking the event's status, so a draft event's upload is readable by anyone who has its address.

**The lead's checks in the merge:**

- **B1's repository half confirmed.** `CLOUDFLARE_API_TOKEN_OSE` appears in the staging job (`:1154` onward) and in the production job (`:2844` onward) under the one name. The workflow's own comment at `:1092-1093` says a full-pipeline pull request "DEPLOYS the PR branch to the shared staging worker ... (same-repo PR → secrets present)".
- **B1's settings half is not confirmed.** Whether the secret is now stored per environment, whether the `production` environment has a required reviewer, and what the token can really do were not read. If the owner has applied `production-gate` and split the token since 2026-09-26, B1 falls to the record being out of date.
- **B3 confirmed as far as the repository shows.** The job's `if:` is a tag push or a dispatch. Its first gate requires the commit to be on `main` (`scripts/ci/assert-on-main.sh`); its second requires a ticket id. Neither asks who pushed the tag. Whether a cloud session's Git access can push a tag was **not tested**: testing it would be an attempt to start a production deploy.
- **What an attacker needs.** Push access to the repository. No outsider and no fork has it. The people and agents who do are the owner and the sessions that work as the owner's account. So this is a control against a mistaken or misled agent, and against code that runs inside CI on a pushed branch (a dependency's install script on a `full-pipeline/*` branch runs beside that token).

Score: 0%

## Loop 3

Team: role-qa-automation
Recursive layer: PENDING

Score: 0%

## Findings register

**Weights:** Security Critical: no partial credit (the score is 0 while one is open). High 10, Medium 5, Low 2.

**Modifiers:**

- Environment: ×1.0 for a finding on a control that reaches production (A1, A2, A3, A4, A7, A11, A12, B1, B2, B3, B5, B6). ×0.75 for a finding in CI, staging or the records only.
- Loop position: ×1.0 in loop 1, ×1.25 in loop 2, ×1.5 in loop 3.
- No correlation multiplier was applied. B1, B2, B3 and A3 are one family (a convention standing where a control is recorded). With one Security Critical open the arithmetic below the floor changes nothing.

| #   | Finding                                                                                                                                                           | Severity          | Found  | Evidence                                                                                                              | Status                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| A1  | One deploy token for staging and production; secrets recorded as repository-level                                                                                 | High              | Loop 1 | `oursharedevents-ci.yml:1154`, `:2844`; `PR_SECRET_EXPOSURE_GUARD.md:60-70`                                           | withdrawn (raised and restated as B1) |
| B1  | Code on an unmerged `full-pipeline/*` branch runs with a token recorded as able to deploy production. `AGENTS.md` says production deploys only by tag or dispatch | Security Critical | Loop 2 | `oursharedevents-ci.yml:1097-1102`, `:1154`; `CF_API_TOKENS_POLICY.md:62`; `wrangler.toml:40`. Settings half inferred | open                                  |
| A2  | No review is required on `main`, so "CODEOWNERS-locked" locks nothing                                                                                             | High              | Loop 1 | `tools/ci/main-branch-protection.json` (`required_pull_request_reviews: null`); `.github/CODEOWNERS:12,24`            | open                                  |
| A3  | The policy-gate hook is not in cloud sessions, where the work now runs                                                                                            | High              | Loop 1 | No committed `.claude/settings*.json`; no `~/.claude/settings.json` in the session container                          | open (raised from Medium in loop 2)   |
| B2  | Required checks are produced by files the pull request can edit, with no required review                                                                          | High              | Loop 2 | `tools/ci/main-branch-protection.json`; `oursharedevents-ci.yml:536-539`                                              | open                                  |
| B3  | A pushed `v*.*.*` tag on a `main` commit starts the production deploy; nothing in the repository asks who pushed it                                               | High              | Loop 2 | `oursharedevents-ci.yml:2767-2769`; `scripts/hardening/apply-github.mjs:17-21`. Push not tested                       | open                                  |
| A4  | Public reads with no limiter at the route, `/api/v2/events/:id` among them                                                                                        | Medium            | Loop 1 | `router.ts:2334-2337`, `:2342`, `:2348`, `:2365`, `:2439`, `:2452`, `:922`, `:879`                                    | open                                  |
| A5  | The router header is not the canonical route list: 20 or more dispatched routes are missing from it                                                               | Medium            | Loop 1 | `router.ts:4-196` against `:817`, `:879`, `:1096`, `:1869`, `:2471` and others (sampled)                              | open                                  |
| A6  | "Each push cancels the running OSE CI run" is false on `main`, which queues whole runs first in, first out                                                        | Medium            | Loop 1 | `oursharedevents-ci.yml:151-185`; `main` run list 2026-11-16                                                          | open                                  |
| A7  | A calendar app cannot read either calendar address on staging or production; the event page offers them                                                           | Medium            | Loop 1 | Live reads 2026-11-16: 403, `cf-mitigated: challenge`. Known to the records                                           | open                                  |
| A8  | About 81 Bruno requests accept a 403 or skip their checks on a non-JSON answer, "1. Health" among them                                                            | Medium            | Loop 1 | `bruno/ose-pages`, `bruno/ose-api` (count by pattern, ±5)                                                             | open                                  |
| A10 | 97 spec files under `tests/e2e` run in no workflow; the gate stops the number growing and no more                                                                 | Medium            | Loop 1 | `scripts/ci/ci-integrity-ratchets.mjs:114-143`; its own run prints `orphanSpecs=97`                                   | open                                  |
| A11 | Production has no scheduled security check while `PRODUCTION_LIVE` is unset, and the host answers publicly                                                        | Medium            | Loop 1 | `pulse.yml:38`, `security-monitoring.yml:65`, `security-regression.yml:139-147`; live 200 on `/`                      | open                                  |
| A14 | `.claude/skills/devops.knowledge.md` says nothing is provisioned, lists workflows that are gone, and shows a secret recipe that echoes values                     | Medium            | Loop 1 | File header "Last Reconciled 2026-03-27"                                                                              | open                                  |
| A15 | `AGENTS.md` invariant 2 names OSE-1656 as an open gap; code and ROLE-STATE say it is mostly closed                                                                | Medium            | Loop 1 | `ROLE-STATE.md:32-33`; `handlers/forms.ts:663`, `:717`                                                                | open                                  |
| A9  | `T4_MAX_SKIP_RATIO` is in no record (it is set to 0.2)                                                                                                            | Low               | Loop 1 | `oursharedevents-ci.yml:2237` and six more; T4g log 2026-11-16                                                        | open                                  |
| A12 | Admin fallbacks are gated by flags with no environment check in code                                                                                              | Low               | Loop 1 | `src/auth/admin.ts:518-528`, `:672-684`; `wrangler.toml:322,324`                                                      | open (lowered from Medium in loop 2)  |
| A13 | The CCR gate is warn-only (the records say so)                                                                                                                    | Low               | Loop 1 | `ccr-gate.yml:15-17,79`                                                                                               | open                                  |
| A16 | The local vetting seed has no retry while the local Worker holds the database                                                                                     | Low               | Loop 1 | `scripts/ci/run-local-vetting.sh:73-77`; run 43914111866                                                              | open                                  |
| A17 | "Migration level is not compared in CI" leaves out the per-environment zero-unapplied gate                                                                        | Low               | Loop 1 | `oursharedevents-ci.yml:1254-1285`, `:2876-2960`                                                                      | open                                  |
| A18 | Stale records: runbooks naming absent files; SECURITY_BASELINE-ROOT "no rate limiting in code"; ROLE-STATE skip-rule paths without `/brands/`; and others         | Low               | Loop 1 | `RUNBOOK-ROOT.md`, `RUNBOOK-CI-DEBUG.md`, `SECURITY_BASELINE-ROOT.md` R-003, `ROLE-STATE.md:185-186`                  | open                                  |
| B4  | The Linear close-guard is not a required check                                                                                                                    | Low               | Loop 2 | `pr-linear-close-guard.yml`; `tools/ci/main-branch-protection.json`                                                   | open                                  |
| B5  | `/api/v2/events/:id` tells a caller whether a hidden event id exists (403 against 404)                                                                            | Low               | Loop 2 | `handlers/events.ts:277-283`. Inferred, not run                                                                       | open                                  |
| B6  | A draft event's upload is readable by its address, with no status check                                                                                           | Low               | Loop 2 | `handlers/upload.ts:218-239`                                                                                          | open                                  |

**Score arithmetic:**

- **Loop 1** (A1 at High, A3 and A12 at Medium, as found): High A1 10, A2 10. Medium at ×1.0: A3, A4, A7, A11, A12 = 25. Medium at ×0.75: A5, A6, A8, A10, A14, A15 = 22.5. Low at ×0.75: A9, A13, A16, A17, A18 = 7.5. Total 75. So 100 − 75 = **25**.
- **Loop 2:** one Security Critical open, so **0**.
- **Loop 3:** PENDING
- **Cumulative:** the worst loop, **0**.
- **System:** nothing was fixed, so **0**.

## Solutioning

Nothing here is done. Each line is what would close a row, and whose it is.

**The owner's, in GitHub and Cloudflare (an agent does not change these):**

1. **B1.** Read the settings first (human gate, question 1). If they are as the 2026-09-26 record says: a token for production only, stored as a secret of the `production` environment; a required reviewer on that environment; and a staging token that cannot write the production Worker. In one Cloudflare account a Workers Scripts token covers every Worker, so the last part needs either a second account or a decision to accept it.
2. **B3.** Apply the `release-tag-ruleset` and `production-gate` steps of `scripts/hardening/apply-github.mjs`, and move agents to a non-admin identity (its own "verify G6").
3. **A2, B2.** Decide whether `main` requires a review. Without one, CODEOWNERS and every "protected at merge time" sentence should be reworded to say so.
4. **A7.** Apply the calendar edge rule of ADR-028 (the workflow of PR 1292 does it with a typed confirm), staging first, then decide production.
5. **A11.** Decide whether production gets its scheduled security check before `PRODUCTION_LIVE`, since the host already answers.

**Stories an agent can take (each needs a ticket):**

6. **A4, B5, B6.** Put the public event read, the sponsor reads and the upload read behind `publicReadLimited`; give a hidden event the same answer as a missing one; decide whether a draft's uploads are readable.
7. **A6.** Let a newer queued `main` run replace older queued ones, or record the hours of lag as accepted.
8. **A8.** Take the Bruno requests off "403 is a pass", folder by folder, as PRs 1255, 1320 and 1350 did for Playwright.
9. **A10.** Delete or wire the 97 orphan specs, and lower the ratchet's baseline as they go.
10. **A16.** A short retry on a locked database in `scripts/ci/run-local-vetting.sh`.

**Records (governance files need their own 5-loop CCR with a human gate each loop):**

11. **A3, A6, A15, A17 in `AGENTS.md` and `CLAUDE.md`:** say that the hook is not in cloud sessions; that only a plain pull request push cancels a run; that OSE-1656 is closed as far as PR 1330 took it; and what the migration gate does.
12. **A5, A9, A14, A18:** regenerate the router header or stop calling it canonical; record `T4_MAX_SKIP_RATIO`; rewrite or delete `devops.knowledge.md`; correct the stale lines.

## What must be true before shipping

This audit ships nothing. Before production is made live, B1, B3, A2 and A11 are settled by the owner, and `AGENTS.md`'s "Human approval" section describes controls that exist where the work runs.

## Verification after shipping

- B1, B3: a read of the `production` environment's protection rules and of where `CLOUDFLARE_API_TOKEN_OSE` is stored, recorded with its date in `docs/security/PR_SECRET_EXPOSURE_GUARD.md`.
- A7: the stg watch `edge` job green on both calendar addresses, then a plain read answering 200 with `text/calendar`.
- A4: a workers-pool test that the listed routes refuse past their limit, born red.
- A6: the time from a merge to its T4 result on `main`, read from the run list.

## Risks accepted

None were accepted by the owner in this run. Until the human gate is answered, the open rows are open, not accepted.

## Human gate

Found in loop 2, Conservative layer, unless marked.

1. **Where is `CLOUDFLARE_API_TOKEN_OSE` stored today, and does the `production` environment have a required reviewer?** This decides whether B1 is a Security Critical or a record that is out of date. What closes it: the owner reads the repository's Actions secrets and the two environments' settings, and says what they show.
2. **Can a cloud session push a `v*.*.*` tag?** This was not tested, because the test is itself the forbidden act. What closes it: the owner checks the session's Git access rules, or applies the tag ruleset.
3. **Is "no required review on `main`" a decision?** If yes, A2 and B2 become wording changes. If no, they are settings changes.
4. **Was "this capture" the repository's records?** (Loop 1, scope.) If the owner meant another snapshot, name it and the comparison is rerun against it.
5. **Calendar feeds on production:** apply the ADR-028 rule there, or leave the feeds challenged until production is live?
