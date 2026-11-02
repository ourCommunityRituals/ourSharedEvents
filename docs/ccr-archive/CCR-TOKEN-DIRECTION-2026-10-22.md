# CCR: token project, what is the right direction now (extended scrum team, 3 loops)

Date: 2026-10-22. Follows `CCR-TOKEN-PROJECT-DIRECTION-2026-10-19.md` (0%, Security Critical open). Names, dates, run ids and file:line only. No credential value was read or printed.

## Verdict

| Item                   | Result                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| System score           | **31.5%** (raw deduction 68.5). No Security Critical is open, so the floor does not apply. It was 0% on 2026-10-19.                      |
| Score by loop          | Loop 1: 83.0% → Loop 2: 48.3% → Loop 3: 31.5%                                                                                            |
| Assessment confidence  | **~75%.** Runtime proof for the chain, the lanes and the log reads. Source-read for the residual findings. Owner-attested for deletions. |
| Gate                   | **Stop, human gate** (below 95%). Three owner decisions below.                                                                           |
| Classification         | Security fix, credential rotation: 3–4 loops. Run: 3.                                                                                    |
| Signal, not permission | Merging and deploying still need required checks and the PO.                                                                             |

**The direction in one line:** the outage is over and the two code fixes shipped, so close the token project in three short batches (record, harden, calendar), take one deliberate decision on the remaining high-severity item, and then stop token work and go back to the launch gate. Do not pivot to GitHub Apps or OIDC for Cloudflare.

## What changed since 2026-10-19 (the data)

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                           | Source                          | Proof           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------- |
| N1  | **Cause found: the stored value, not the token.** Owner rolled the token, ran verify at a hidden prompt (`active`), ran the exact CI read (success), and stored the same variable by stdin with no newline (2026-10-20 14:07Z). The two earlier stores had gone through the interactive paste and both failed. My 10-19 account-mismatch reading was wrong; the 10-16 reading (b), "value altered", was right. | OSE-1730 comment 10-20 14:23Z   | Owner + runs    |
| N2  | **Staging chain green.** Dispatch run `39436555076` (T1–T4, S0, summary all success) and every push to `main` since: #1002 `39685740740`, #1003 `39685776220`, #1004 `39678828711`, #1005 `39688791617`, #1007 `39702685543`; nightly `39538506898` (10-21).                                                                                                                                                   | Actions                         | Runtime         |
| N3  | **One red:** #1006's push run `39702660720`. T2 api: 91 of 92 Bruno requests passed; one failed with `read ECONNRESET`, not an assertion. #1007 landed 15 s later and its chain is green on a SHA that contains #1006, so the Done bar is met for #1006 (AGENTS.md: a later green `main` SHA containing it).                                                                                                   | Job log 119580373778            | Runtime         |
| N4  | **Both lanes shipped:** #1002 (classifier; Part of OSE-1731) and #1003 (locked wrangler in T2/T4; Part of OSE-1695), each with its own green push run (N2).                                                                                                                                                                                                                                                    | `git log`, Actions              | Runtime         |
| N5  | **Old deploy token deleted** (it was a _user_ token, not in the Account API tokens list). The account list now shows exactly `ose-deploy-2026-10`, Active. Deleted by the owner; the user-token list is not readable from the pipeline.                                                                                                                                                                        | OSE-1730 comment 10-20 14:34Z   | Owner-attested  |
| N6  | **Access token rotation complete:** `ose-staging-t4-admin` deleted 10-20 (canary `classification=ok` before and after). Disabled `ci-deploy-token` and two unused policies left in place by the owner (no authentication possible).                                                                                                                                                                            | OSE-1467 comments 10-20/21      | Owner + runs    |
| N7  | **GitHub org audit log reviewed (agent, read-only), 2026-08-01 to 10-21, 135,693 events: nothing unexplained.** One human account; non-US events are runner egress; the retired all-repo token's last event was 10-15. Findings to act on: 80 `policy_override` in OCR-docs (segregation-of-duties), 9 auto-created unprotected environments, app permissions to confirm.                                      | OSE-1467 comment 10-21 02:16Z   | Runtime         |
| N8  | **The Cloudflare half of the exposure-window audit log is not reviewed.** OSE-1467 was due 10-10, so it is 12 days overdue.                                                                                                                                                                                                                                                                                    | OSE-1467                        | Linear          |
| N9  | **Incident 10-20:** the token was pasted at a normal PowerShell prompt, echoed, and reached a session transcript. It was rolled again; the exposed value is dead. The practice (verify, then store from the same variable by stdin, in one script) is written in Linear. **No such script is in the repo** (no `tokens/verify` call anywhere).                                                                 | OSE-1730 comment; reviewer grep | Linear + source |
| N10 | `cloudflare-workers-and-pages` GitHub app suspended 10-21 (it held write on every repo); uninstall planned after a week of green CI, about 10-28.                                                                                                                                                                                                                                                              | OSE-1693 comment 10-21          | Owner + API     |
| N11 | **Still in code on `main` (66a334b):** gate matches by substring (`oursharedevents-ci.yml:1253,1264,2639`); the token reaches T2 and T4 with no job `environment:`; `notify-osm-flag-change.yml:48` keeps `\|\| secrets.OCR_PROPAGATE_TOKEN` (the workflow last ran 2026-10-13, failed); no scheduled token verify; no scope or account check.                                                                 | Reviewer + my grep              | Source          |
| N12 | **Expiry cluster.** Six or seven credentials fall due in four days, 82–85 days from today. Nothing warns before expiry (OSE-1721, a 14-day warning, is Backlog). Dates in the calendar below.                                                                                                                                                                                                                  | Linear comments, 10-12 queue    | Linear          |

### Credential calendar (computed from the dates in Linear; days from 2026-10-22)

| Date       | Days | Credential                                                                                                              | Basis                               |
| ---------- | ---- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 2026-11-10 | 19   | `LINEAR_API_KEY` (org) rotation date                                                                                    | 90 d from 08-12 (policy, no expiry) |
| 2026-11-29 | 38   | `ADMIN_KEY`, `X_OCR_INTERNAL` 90-day policy date (last dated 08-31; not yet rotated as of 10-15)                        | policy; rotation status unverified  |
| 2026-12-31 | 70   | `OCR_CI_EDGE_TOKEN`                                                                                                     | 90 d from 10-02                     |
| 2027-01-12 | 82   | `OCR_AUTOMATION_WRITE`, `OCR_NOTIFY_OSM`, `BRANCH_PROTECTION_READ_TOKEN` (stated); `OCR_HUB_READ` (computed from 10-14) | token expiry                        |
| 2027-01-13 | 83   | `OCR_SPOKES_READ`, `OCR_PROPAGATE_WRITE` (computed from 10-15; verify)                                                  | token expiry                        |
| 2027-01-15 | 85   | `ose-deploy-2026-10` (Cloudflare deploy token; renewal date on the board)                                               | token expiry                        |
| 2027-04-16 | 176  | `ose-staging-ci-2026-10` (Cloudflare Access service token)                                                              | token expiry                        |

## Loop 1: surface pass

**Critical (most dangerous assumption).** That "the chain is green, so the token project is done." Green proves the credential works. It does not prove the record is closed (N8, N9), that the controls would catch the next failure (N11), or that the next rotation day will go better than the last (N12).

**Conservative (worst case).** Assume the next rotation is the 2027-01-12 cluster, done at speed, by one person, at a prompt. N9 happened once under no time pressure. The old-token Security Critical is closed on owner attestation (N5), and the audit-log record is open on the Cloudflare side (N8).

**Role lenses.**

- PO: the blocker is gone; what remains is closure and one decision. Cost of stopping now is low, cost of ignoring N12 is a multi-credential outage in January.
- Scrum Master: Linear is behind `main`. #1002 and #1003 have green runs (N2) but no Done-stage comments; OSE-1730 is In Review; OSE-1731 stays In Progress for a real reason (exact-name matching is not done).
- BE Architect: the deploy credential is one repo-level secret read by staging, production and the PR-reachable jobs.
- DevOps: no scheduled verify; the nightly caught the outage on 10-17 but nobody was told.
- Data Scientist: of the 9 runs on `main` since the 10-20 fix, 8 are green; the one red is a single connection reset (N3). Before the fix, ten in a row were red (3 dispatches, 3 nightlies, 4 pushes, 2026-10-16 to 10-20).
- FE Integration, Design FE: no finding. The check-in fix (#998) is on `main` and its chain is now green.

**Findings.** A: exposure record open, 12 days overdue (Medium 5). B: Linear behind `main` (Low 2). C: expiry cluster with no alarm (Medium 5). D: substring gate (Medium 5).

**Recursive.** Deduction 5 + 2 + 5 + 5 = 17 → **83.0%**. Confidence 65%.

## Loop 2: pressure pass

Dr of Security: independent read-only review of `main`, run separately; it was given claims to test, not my conclusions. Its report is summarised here; it listed every command, all read-only. Its `gh api` reads of environment and secret settings were refused (403), so those are UNVERIFIED.

**Critical.** What did Loop 1 under-rate?

- **Reach of the deploy token (reviewer: raise to High).** T2 (`oursharedevents-ci.yml:1513–1589`) and T4 (`:2011–2099`, `:2229`) get the token with no job `environment:`. They run PR-head code on `full-pipeline/*` PRs (`:1188`) and on `workflow_dispatch` from any ref (`deploy_staging`, `deploy_production`, `run_functional`; T1 and T2 run on branch code before the on-main gate at `:2563`). `staging-rollback-drill.yml` is dispatch-only and checks out the dispatched ref. The guard `check-pr-secret-exposure.mjs:360` exempts `full-pipeline/` by design. And the environments held no secrets as of 10-16 (OSE-1730 text), so the `environment:` keys on T1 and production protect nothing today.
- **Adding `environment:` to T2/T4 alone would fix nothing:** a same-repo writer can edit the workflow in their own branch. The robust fix is to hold the token only as an environment secret with a `main`-only (and tags for production) deployment branch policy. That is OSE-1699 (HARD-5), scheduled after launch by the owner on 10-12, which accepted the residual for `main` merges only. PR-head and dispatch-from-branch reach were not part of that decision.

**Conservative.** Assume the only writers are one human plus bots (the org has one member, N7), and that Copilot is limited to `copilot/*` (ADR-020, unverified here). Then the live risk is low _today_, but the control is absent, and its impact, shipping to production outside CI, is the one AGENTS.md "Human approval" forbids. That is why the reviewer rates it High and not Medium. I accept High.

**Other findings.**

- Gate is substring-matched: proven locally that a list holding only `FORMS_HASH_PEPPER_OLD` passes for `FORMS_HASH_PEPPER` (Medium 5, already counted as D).
- No gate checks token scope or owning account (Medium 5). `wrangler.toml:40` only has to exist (`infra-consistency.test.js:471`).
- No scheduled alarm: the nightly failed on 10-17 through 10-20 at `Seed test-event-001`, nobody was told, and only the T1 gate uses the classifier (Medium 5). A single scheduled job calling `GET /accounts/$ID/tokens/verify` plus a read-only wrangler call, opening an issue on failure, would have named the cause on 10-17.
- `notify-osm-flag-change.yml:48` fallback: dead code while the name stays deleted, a trap if anyone recreates it (for example at org level for OCR-docs). No empty-token guard. Remove now and set the ratchet `fallbackUses` to 0 (Low 2). Waiting for a live run gains nothing, since the fallback cannot resolve.
- Token-shaped strings: none found in tracked files or history within regex reach. Low-value hits: 8-character Cloudflare token _IDs_ (identifiers from dashboard URLs, not values) in `TOKEN-PICKUP-2026-10-19.md` and one older worksheet. Trim them. Not scored.

**Role lenses.** SDET/SRE: three missing controls are all cheap and testable (exact-name, scheduled verify, empty-token guard). QA: each is born-red by a fake wrangler or a fixture list, as in #1002.

**Findings added.** E: reach to the deploy token from PR heads and dispatch (High 10, 2 surfaces proven × 1.58, Loop 2 × 1.25 = 19.75). F: no scheduled verify or alarm (Medium 5 × 1.25 = 6.25). G: no scope or account check (Medium 5 × 1.25 = 6.25). H: notify-osm fallback trap (Low 2 × 1.25 = 2.5).

**Recursive.** Deduction 17 + 19.75 + 6.25 + 6.25 + 2.5 = 51.75 → **48.3%**. Confidence 72%.

## Loop 3: confirmation pass

**Critical.** What would make us repeat 10-16 → 10-20?

- **I: the rotation practice is not in the repo (N9).** The safe way (verify the value, then store the same variable by stdin, in one script, nothing echoed) exists only as a note in Linear and in the owner's local script. The first attempt leaked a token to a transcript. In 82 days about seven credentials are due within four days. Medium 5 × 1.5 = 7.5. **Correlated with C** (the cluster has no alarm and the procedure is not codified), so the pair is (5 + 7.5) × 1.5 = 18.75.
- **J: one connection reset reds the whole chain (N3).** A single `ECONNRESET` in one of 92 Bruno requests failed T2 and fail-fast skipped T3 and T4 for that SHA. Cause not established (a candidate is two chains hitting shared staging 15 s apart). Low 2 × 1.5 = 3.

**Conservative.** Does the Done bar hold? Yes for #1002 and #1003 (their own green runs) and for #1006 (a later green SHA). The Done _record_ is missing in Linear (B).

**Role lenses.** PO: the ordering below puts the owner's 20 minutes first. Scrum Master: three batches, no shared files. Dr of Security: the closed items are closed on owner attestation, which the pipeline cannot read; that is acceptable only because the new controls (verify alarm) would show a dead or wrong token within an hour.

**Recursive.** Deduction 68.5 → **31.5%**. Confidence 75%.

## Findings register and arithmetic

| ID  | Finding                                                                                  | Weight   | Modifiers                        | Deduction | Proof            |
| --- | ---------------------------------------------------------------------------------------- | -------- | -------------------------------- | --------- | ---------------- |
| A   | Cloudflare audit-log half of the exposure record open; remaining rotations; 12 d overdue | Medium 5 | Loop 1 × 1.0                     | 5         | Linear           |
| B   | Linear behind `main` (no Done evidence for #1002/#1003; OSE-1730 In Review)              | Low 2    | Loop 1 × 1.0                     | 2         | Runtime          |
| D   | Secrets gate matches by substring                                                        | Medium 5 | Loop 1 × 1.0                     | 5         | Source + replay  |
| E   | Deploy-capable token reachable from PR heads and dispatch-from-any-ref (T2, T4; no env)  | High 10  | 2 surfaces × 1.58; Loop 2 × 1.25 | 19.75     | Source           |
| F   | No scheduled token verify or alarm                                                       | Medium 5 | Loop 2 × 1.25                    | 6.25      | Runtime + source |
| G   | No scope or owning-account check                                                         | Medium 5 | Loop 2 × 1.25                    | 6.25      | Source           |
| H   | `notify-osm` fallback to a deleted-name PAT; no empty-token guard                        | Low 2    | Loop 2 × 1.25                    | 2.5       | Source           |
| J   | One transient reset reds the chain                                                       | Low 2    | Loop 3 × 1.5                     | 3         | Runtime          |
| C+I | Expiry cluster with no alarm (C, 5) + rotation practice not in the repo (I, 5 × 1.5)     |          | Correlated: (5 + 7.5) × 1.5      | **18.75** | Linear + source  |

Total: 5 + 2 + 5 + 19.75 + 6.25 + 6.25 + 2.5 + 3 + 18.75 = **68.5**. Unmodified weights sum to 52 (48%); the verdict does not depend on the multipliers.

Why Security Critical no longer applies: the 10-19 floor was the old token being live. It is deleted (N5, owner-attested), and the account list shows one token. The remaining uncertainty is _use during the exposure window_, which is the audit-log record (A), scored Medium because a deleted credential cannot be used further.

## Direction

**Principle: close, harden, calendar, decide, stop.** The blocker is resolved. What is left is bounded, and each piece has a clear owner and an end.

### Batch 1: record (agent, ~1 hour; needs your go for the Linear writes)

- OSE-1731: comment the Done-stage evidence for #1002 (run `39685740740`); keep In Progress, and say exactly what remains (exact-name matching).
- OSE-1695: comment the same for #1003 (run `39685776220`) and the 10-22 state.
- OSE-1730: if you remove Workers Editor from the token's policy 1 and one dispatch run stays green, move it to Done. Leaving it on is harmless; decide and record.
- Record the Bruno reset (N3) as a Low note on the chain ticket.

### Batch 2: harden (agent, 2 small PRs, code only, born-red tests, each `Part of OSE-###`)

- PR 2a (D + H): exact-name matching in both gates (`grep -qxF` on parsed names, or a parsed-JSON check), a test with `FORMS_HASH_PEPPER_OLD`, remove the `notify-osm` fallback, add an empty-`GH_TOKEN` error, lower `fallbackUses` to 0.
- PR 2b (F + G): one scheduled job (hourly, and once on dispatch after any secret store) that calls `GET /accounts/$ID/tokens/verify`, compares the account with `wrangler.toml`, runs one read-only wrangler call, and opens or updates an issue on failure. Classify the seed path the same way as the T1 gate.
- Checked-in rotation script (I): `verify, then store from the same variable by stdin, nothing echoed`, bash and PowerShell, so the practice survives. **I need your local script** as the starting point; send its text with the token variable removed.

### Batch 3: calendar (needs your go)

- Calendar reminders 14 days before each date in the table above (the first is 2026-10-27 for the 11-10 key). I can create them with the Google Calendar connector, or you can; say which.
- Pick the dates to _stagger_: renew the 01-12/13/15 cluster in a planned window in December, one credential per day, each with its own green run. Ask OSE-1721 (14-day warning in CI) to be pulled forward.

### Owner lane (your terminal and dashboards)

1. Cloudflare audit log, 2026-08-01 to now, excluding views: Worker, D1, R2, KV, secret, token and Access changes. Report anything unfamiliar by action, actor and time; "nothing found" counts. That closes A.
2. Remove Workers Editor from policy 1 (optional), then one dispatch run.
3. Rotate `ADMIN_KEY` and `X_OCR_INTERNAL` per environment (separate staging and production values), one at a time, each with a green run before the next. The 11-29 date is the latest sensible.
4. The OCR-docs `policy_override` count and the nine unprotected environments (N7) are SOC 2 items; schedule, don't rush.

### The one deliberate decision: E

The robust fix is OSE-1699: token only as an environment secret with a `main`-only deployment branch policy (tags for production), plus a `staging-pr` environment so PR validation needs no token. It is the riskiest item (per-secret PRs, each with a green chain) and the owner scheduled it after launch.

- **Recommendation:** accept E in writing _with an end date_, and schedule OSE-1699 for the same December window as the renewals, so the token is moved once, not rotated twice. Compensating step now, cheap and real for dispatch only: run `scripts/ci/assert-on-main.sh` at the start of the token-using dispatch paths (it does not stop a workflow edit, so it narrows but does not close E).
- If you would rather close E sooner: do OSE-1699 for this one secret first, as its own PR, after one clean week of green chains (about 10-29).

### What not to do

- No GitHub App or OIDC migration for Cloudflare now: OSE-1110 records the token as non-federatable, and the GitHub PAT side is already gone.
- No re-rotation of the deploy token. It works and is the only active one.
- Do not run `set-secrets.sh` on any auth-failure message. #1002 now says so in the log.
- Do not uninstall the Cloudflare GitHub app before about 10-28.

### Path to 95% (projection; each step needs recorded evidence)

| After                                           | Raw deduction   | Score |
| ----------------------------------------------- | --------------- | ----- |
| Today                                           | 68.5            | 31.5% |
| Batch 1 (B) + owner audit log (A)               | 61.5            | 38.5% |
| PR 2a (D, H)                                    | 54.0            | 46.0% |
| PR 2b (F, G) + J noted as accepted              | 41.5 − 3 = 38.5 | 61.5% |
| Rotation script + calendar + alarm (C + I pair) | 19.75           | 80.3% |
| E accepted in writing with an end date          | 0               | ≥95%  |
| E closed by OSE-1699 instead                    | 0               | ≥95%  |

(Arithmetic: 68.5 − 5 − 2 = 61.5; − 5 − 2.5 = 54.0; − 6.25 − 6.25 − 3 = 38.5; − 18.75 = 19.75; E removed = 0.)

## What must be true before closing the token project

- Cloudflare audit log reviewed and written on OSE-1467, including "nothing found".
- The scheduled verify job exists and has run green at least once.
- Exact-name gate and the `notify-osm` cleanup merged with their chains green.
- The rotation script is in the repo; calendar reminders exist for every date in the table.
- E is either closed (OSE-1699) or accepted in writing with an end date.

## Risks accepted (need your word)

- E until its end date. J until a retry or isolation is designed. N5 and N6 deletions on owner attestation.

## Limits of this review

- Not seen: Cloudflare token policies and audit log, GitHub environment and secret settings (the reviewer's reads were refused), the owner's local rotation script, any run after the last one read at about 01:35Z on 10-22.
- The "environments hold no secrets" statement is from OSE-1730's text of 10-16, not re-read today.
- Credential dates marked "computed" are 90 days from creation dates in Linear; verify them against the token pages.
- This review does not plan a go-live. Launch posture is the owner's (AGENTS.md).

## Human-gate questions (loop 3, layer Conservative; gap first appeared in loop 2)

1. **E:** accept it in writing with an end date, or close it sooner with OSE-1699 for this one secret? If accept, which date?
2. **Go for Batches 1–3?** Linear writes, two code PRs, calendar reminders (Google Calendar connector or yours).
3. **Send me your local verify-and-store script** (token variable removed) so I can make it the checked-in version.
4. Cloudflare audit log: when can you do it (A, 12 days overdue)? And Workers Editor: remove or leave?
