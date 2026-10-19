# CCR: token project direction (extended scrum team, 3 loops)

Date: 2026-10-19. Reviewer: Claude (Sonnet 5.5), with one independent Dr of Security read. Names, dates, run ids and line numbers only. No credential value was read or printed.

## Verdict

| Item                      | Result                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| System score              | **0%** (Security Critical floor). Raw deduction 118.6, so the arithmetic is below 0 even without the floor.               |
| Score by loop             | Loop 1: 56.3% (old token scored High) → Loop 2: 0% (reclassified Security Critical) → Loop 3: 0%                          |
| Assessment confidence     | **~70%.** Runtime proof for the outage. Source-read only for the rest. Nothing seen after 2026-10-19 03:42Z (see Limits). |
| Gate                      | **Stop. Human gate.** Below 95%, and a Security Critical is open.                                                         |
| Classification            | Security fix, credential rotation: 3–4 loops. Run: 3 (the owner's request, the minimum for this class).                   |
| A CCR score is a signal   | Not permission. Merging and deploying still need required checks and the PO.                                              |

The score is low because of what is still open, not because the work done is poor. The token overhaul removed `OCR_PROPAGATE_TOKEN` from all 9 repos and deleted the PAT. The CCR does not credit that; it counts unresolved findings.

## Scope

In: OSE-1695 and its dependents (OSE-1730 staging deploy auth, OSE-1731 gate, OSE-1467 exposure record, OSE-1699 HARD-5), the staging chain on `main` at `f33d1b24`, the Cloudflare deploy token path.
Out: Phase 4 rotations other than the Cloudflare token (planned in the direction, not scored), OW/hub Doppler and Anthropic keys, the production go-live decision (AGENTS.md: an agent never plans one).

## Team

PO, Lead BE Architect, Lead FE Integration, Sr Design FE, Sr Automation QA, Sr SDET/SRE, DevOps Mgr, Sr Data Scientist, Dr of Security. Lenses with no finding: **FE Integration** (no surface changes; the only user-facing effect is that the check-in fix in PR 998 cannot reach Done), **Design FE** (n/a). The Dr of Security lens was run by an independent read-only subagent on the repo, not by me. I did not pass it my conclusions.

## Evidence (the data)

| #   | Fact                                                                                                                                                                                                                      | Source                                                            | Proof level     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------- |
| E1  | `main` is at `f33d1b24` (merged 2026-10-15 11:49Z). Nothing merged since.                                                                                                                                                 | `git log HEAD..origin/main` empty                                 | Runtime         |
| E2  | Last green chain: scheduled 38845381216 (10-16 03:24Z). Failed since the token was overwritten at 14:52Z: dispatches 38919335060, 38922477230, 38939456530; scheduled 38998556890 (10-17), 39093502690 (10-18), 39194783868 (10-19). **6 red chain runs, about 78 h red.** | Actions run list                                                  | Runtime         |
| E3  | Scheduled run 39194783868: S0 and all T0 green. **T1 skipped** (schedule does not deploy). **T2 api and pages fail** at "Seed test-event-001": D1 `/import` → `Authentication error [code: 10000]`, then `/accounts` fails, then `/user/tokens/verify` → `Too many authentication failures [code: 10502]`. T3 and T4 skipped (fail-fast). | Job log 117878425404                                              | Runtime         |
| E4  | The CF Access preflight in the same job passed (`classification=ok`), and the canary's token job passed 10-19 18:09Z. So the **CF Access** credentials work. The failing credential is the **Cloudflare API token**.                                  | Job log; canary job 118223171277                                  | Runtime         |
| E5  | The token `ose-deploy-2026-10` is account-owned, expires 2027-01-14, no IP filter. Three attempts (store; roll and store; add Workers Editor) all failed identically.                                                       | OSE-1730 comment 10-16                                            | Linear (owner)  |
| E6  | The failing calls are account-scoped (`/accounts/<id>/d1/.../import`, `/accounts/<id>/workers/scripts/.../secrets`). The follow-up `/accounts` and `/user/tokens/verify` calls are user-level and fail after the first error.         | Log lines 253–309; ticket                                         | Runtime, inference on meaning |
| E7  | T2 ran **wrangler 4.151.1**. The worker lockfile pins **4.145.0**. Root `package.json` has no wrangler, so `npx wrangler` fetches the newest at run time.                                                                  | Log banner; `package-lock.json`; root `package.json`              | Runtime + source |
| E8  | Gate step `oursharedevents-ci.yml:1249` (staging) and `:2600` (production) use `npx wrangler secret list … \|\| true`. On any failure the message says the secret "is not set … run `scripts/set-secrets.sh`". The reviewer replayed it with a failing stub: that text printed. `set-secrets.sh:100-121` runs `wrangler secret put` for `FORMS_ENCRYPTION_KEY` and four peppers with no skip-if-present check. | YAML; local replay; script                                        | Replay + source |
| E9  | No script or workflow calls `tokens/verify`, memberships or whoami. Scope is a manual checklist (`docs/security/CF_API_TOKENS_POLICY.md:285`). `wrangler.toml:40` carries a hard-coded `account_id`.                         | Reviewer grep                                                     | Source          |
| E10 | T2 (`:1495-1575`) and T4 (`:1977-2067`) have no `environment:` and run on a same-repo `full-pipeline/*` PR head (`:1188`).                                                                                                | YAML                                                              | Source          |
| E11 | Six local scripts read the token from a local env var; none runs in CI. Revoking the old token breaks no CI job (the GitHub value was already replaced).                                                                    | Reviewer grep                                                     | Source          |
| E12 | OSE-1730 and OSE-1731 are Backlog, last touched 10-16. OSE-1695's last comment is 10-16 12:19Z. OSE-1467 was due 10-10. OSE-1251 (launch gate) is due 10-21. Open PRs: 998 (check-in double-take), 999 (conformance refresh).        | Linear; PR list                                                   | Runtime         |
| E13 | The archived "Token overhaul" session ended `need_input` ("awaiting your 'A' to verify token") with a **dirty worktree**. Its transcript is locked to trusted devices.                                                       | `get_session`                                                     | Runtime         |
| E14 | OSE-1730 says "the nightly never calls wrangler". E3 contradicts that: the nightly's T2 seeds do.                                                                                                                         | Ticket vs log                                                     | Runtime         |

## Loop 1: surface pass

**Critical (most dangerous assumption).** The ticket assumes the outage is one gate step (T1) and that 3 rotations of one token will converge. True: T1 failed on 10-16. Assumed: that only T1 is hit. E3 shows T2 hits it too, and T3 and T4 use the same seed path (not proven; they were skipped). The pattern "change the token, re-run, see" has been tried 3 times with no separating test.

**Conservative (worst case, does the floor hold?).** Worst case, the old token (production-capable per the 10-12 queue, listed as possibly exposed in OSE-1467) is still live. I scored it High on three grounds: no evidence of use, nothing but test data in production (owner, 10-14), one-step revoke. That reasoning was challenged in Loop 2.

**Role lenses.**
- PO: the cost of the outage is verification, not customers. Production holds no real end-user records, but the Done bar for every change (including PR 998) is unreachable.
- BE Architect: three-way split of causes (bad value, wrong account, wrong scope) is untested. E6 and E9 favour wrong account or bad value over missing permission, because Workers Editor was added with no change.
- DevOps: the old token's value is gone from GitHub, so keeping it "for rollback" has no value.
- Scrum Master: Linear shows the critical path as Backlog; 3 days of work are unrecorded (E12, E13).
- Data Scientist: 6 of the last 7 chain runs on `main` are red; the one green is the one before the overwrite. The push-only view shows green, because the last push run (10-15) is green.

**Findings (initial scoring).**
- F1 old Cloudflare token not shown revoked; exposure-window audit log not done (OSE-1467, 9 days overdue). Scored High 10.
- F2 staging Cloudflare auth outage, T1 gate and T2 seeds proven (2 surfaces, ×1.58): Critical 15 → 23.7.
- F3 record drift (Linear, unrecorded 10-17 to 10-19 work, dirty worktree in an archived session, stale queue doc): Medium 5.
- F1b overdue exposure record counted separately in this pass: Medium 5.

**Recursive.** Deduction 10 + 23.7 + 5 + 5 = 43.7 → **56.3%**. Confidence 62%.

## Loop 2: pressure pass

**Critical.** What did Loop 1 under-weigh? The failure message, the gate coverage and the token's reach.

**Conservative.** Assume an operator follows the gate's message while the token is rejected.

**Dr of Security (independent, then my reconciliation).**
- Old token: **Security Critical, not High.** Production is *held, not closed* (AGENTS.md: "do not call production dark"; I had said "closed", which was loose). AGENTS.md requires an exposed secret to be rotated, and overwriting the GitHub copy does not revoke it. The holder can deploy from a workstation, defeating "deploys only through CI". "No evidence of use" is unbacked until the audit log is read. **I accept this.** It is not a vulnerability proven exploited; it is an exposed, production-capable credential with no revocation evidence. It lifts when the Cloudflare page or audit log shows it revoked or unused since exposure.
- Gate misdiagnosis is **High** (I had Medium): replay-proven message, and `set-secrets.sh` overwrites the encryption key and peppers with no fallback to a previous key. Staging holds test data only, but the outage is exactly the condition that triggers the instruction. **Accepted.**
- No gate checks scope or account: **High**, new. It supports the wrong-account reading of E5/E6. Open: whether `CLOUDFLARE_ACCOUNT_ID` overrides `wrangler.toml:40` (unverified; either way a token from another account passes by accident or fails with the wrong message).
- Unpinned `npx wrangler` with the token in env (T2, T4): the reviewer rated **Critical**. E7 confirms it at runtime for T2. **I rate High**, not Critical, because exploitation needs a compromised registry release and the same token is already reachable from PR-head code (F7). Disagreement recorded; it moves the score by 5 points.
- Same-repo PR heads reach the token in T2 and T4 without an environment: **Medium**. Fork PRs get no secrets by default; the repo's environment rules were not readable (proxy 403).
- Runtime caveat from the reviewer: it saw only the last *push* run (green). That is the push-only blind spot in E2.

**Role lenses.** SDET/SRE: Cloudflare is throttling our failed auth (10502). Re-running credentialed jobs against a rejected token adds failures and can block the owner's own verify call. Hold re-runs until a local check passes. QA: the one test that separates the three causes costs one HTTPS call and no CI minutes.

**Findings added.**
- F1 reclassified Security Critical (counted 15; floors the score).
- F4 gate misdiagnosis plus key overwrite: High 10 × 1.25 = 12.5; correlated with F2 (it amplifies the outage), so the pair is (23.7 + 12.5) × 1.5 = 54.3.
- F5 no gate on token scope or account: High 10 × 1.25 = 12.5.
- F6 unpinned wrangler in T2 and T4 with the token: High 10 × 1.25 = 12.5.
- F7 PR-head reach to the token (T2, T4, no `environment:`): Medium 5 × 1.25 = 6.25.
- F8 Cloudflare auth-failure throttle (10502): Low 2 × 1.25 = 2.5.
- F1b folded into F1.

**Recursive.** Raw deduction 108.1 → score clamps to **0%**, and the Security Critical floor applies anyway. A large drop from Loop 1 is the protocol working. Confidence 68%.

## Loop 3: confirmation pass

**Critical.** What would make our own "done" evidence wrong?

**Conservative.** Assume the next green run proves less than we think.

- **F9 (Medium 5 × 1.5 = 7.5): the definition of done is partly mis-specified.** E14: the nightly does call wrangler, but only in T2 (D1 write). T1 is skipped on schedule, so a green nightly proves D1 write and nothing about deploy, secret list or migrations. The OSE-1730 definition ("green T1 to T4 for one commit") is right only if the run is a push or dispatch where T1 runs. The ticket's premise that the nightly "says nothing about this token" is wrong in the other direction (it fails when the token fails).
- **F10 (Low 2 × 1.5 = 3): chain health is invisible to a push-only view.** The reviewer read "green" from the last push run while 6 later runs were red. Nothing in the repo shows an alert for consecutive red scheduled chains (not verified either way).
- Re-check of the owner-decision list: OSE-1699 puts per-secret moves after launch and records "a `main` merge running T1 with that token is an accepted residual". That does not mention PR-head reach (F7), so F7 stays open until the owner accepts it in writing.
- Unverified and not scored: whether the stored secret changed after 10-19 03:42Z. No credentialed run has happened since, so token health after that moment is unknown. This is the largest gap in the evidence.

**Role lenses.** PO: the direction below is ordered by points recovered per owner minute. Scrum Master: one owner-terminal lane, two agent lanes, no shared files. SDET: every fix needs a born-red test (OSE-1731 spec already has one).

**Recursive.** Raw deduction **118.55**. Score **0%**. Confidence 70%.

## Findings register and arithmetic

| ID  | Finding                                                                                    | Weight | Modifiers                                   | Deduction | Proof            |
| --- | ------------------------------------------------------------------------------------------ | ------ | ------------------------------------------- | --------- | ---------------- |
| F1  | Old Cloudflare token not shown revoked; exposure audit log not reviewed (OSE-1467)         | Sec Critical (15) | Floors score at 0%                | 15        | Linear + source  |
| F2  | Staging Cloudflare auth outage (T1 gate, T2 seeds)                                         | Critical 15 | Breadth 2 surfaces ×1.58, loop 1        | 23.7      | Runtime          |
| F4  | Gate says "not set, run set-secrets.sh" on any auth failure; script overwrites keys        | High 10 | Loop 2 ×1.25; correlated with F2           | 12.5      | Replay + source  |
|     | Correlated pair F2 + F4                                                                    |        | (23.7 + 12.5) × 1.5                         | **54.3**  |                  |
| F5  | No gate checks token scope or owning account                                               | High 10 | Loop 2 ×1.25                                | 12.5      | Source           |
| F6  | Unpinned `npx wrangler` runs with the token in T2 and T4                                   | High 10 | Loop 2 ×1.25                                | 12.5      | Runtime + source |
| F7  | Same-repo PR heads reach the token in T2 and T4 (no `environment:`)                        | Medium 5 | Loop 2 ×1.25                               | 6.25      | Source           |
| F8  | Cloudflare auth-failure throttle (10502) fed by failing runs                               | Low 2  | Loop 2 ×1.25                                | 2.5       | Runtime          |
| F3  | Record drift: Linear, unrecorded 10-17 to 10-19 work, dirty archived worktree, stale queue | Medium 5 | Loop 1 ×1.0                                | 5         | Runtime          |
| F9  | Done definition mis-specified (T1 skipped on schedule; nightly T2 does call wrangler)      | Medium 5 | Loop 3 ×1.5                                | 7.5       | Runtime          |
| F10 | Red chain invisible in a push-only view                                                    | Low 2  | Loop 3 ×1.5                                 | 3         | Runtime          |

Total: 15 + 54.3 + 12.5 + 12.5 + 6.25 + 2.5 + 5 + 7.5 + 3 = **118.55**. The unmodified weights alone sum to 79 (21%), so the result does not depend on the multipliers.

Sensitivity: if F6 is Critical (reviewer) the raw deduction rises by 6.25. If F2 breadth is 1 (not 2) it falls by 13.05 (8.7 × the 1.5 pair multiplier). Neither changes the verdict.

## Direction (data-driven)

**Principle: one door at a time.** The chain is the proof instrument for every other rotation. Rotating `ADMIN_KEY`, `X_OCR_INTERNAL` or the Access token while the chain is red destroys the signal. Fix the instrument first, then rotate one credential at a time, create → store → green run read in the log → delete the old one (standing rule from the 10-12 queue).

Do **not** pivot to GitHub Apps or OIDC for Cloudflare now: OSE-1110 records the Cloudflare token as non-federatable, the GitHub PAT side is already gone, and OSE-1727/OSE-1699 are scheduled after launch.

### Owner lane (your terminal, no values in chat)

1. **Record two dates (2 min).** `gh secret list` dates for `CLOUDFLARE_API_TOKEN_OSE` and `CLOUDFLARE_ACCOUNT_ID`. Compare with 10-16T15:14:11Z. This shows whether anything changed in the unrecorded 10-17 to 10-19 window.
2. **Old token, F1 (10–20 min).** Read the Cloudflare audit log for the exposure window and the old token's last-used data, write the result including "nothing found" on OSE-1467, then revoke or delete it. E11: no CI job depends on it. Six local scripts will fail if a shell still exports the old value; that is the expected result.
3. **Separate the three causes with read-only calls, hidden prompt, status codes only (10 min).**
   - `GET /accounts/$ID/tokens/verify`
   - `GET /accounts` (an account-owned token lists exactly its own account)
   - `GET /accounts/$ID/workers/scripts/oursharedevents-stg/secrets` and a D1 read

   | Result                                              | Meaning                                  | Action                                                                                   |
   | --------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
   | verify not active                                   | Stored or rolled value is bad            | Roll once, verify before storing, then store with `gh secret set` from stdin             |
   | verify active, `/accounts` shows a different account than the ID CI uses | Wrong account | Fix `CLOUDFLARE_ACCOUNT_ID` (or recreate the token under the right account). No token change |
   | active, account matches, scoped call is 403         | Permission or resource scope             | Edit the policy (value unchanged)                                                        |
   | all pass                                            | GitHub value differs from the tested one | Re-store from the verified source via stdin; check the secret name and `updated_at`      |
   | user-owned token as last resort                     | Only if the account-owned path is proven unusable | Record the trade-off on OSE-1730                                                    |
4. **One proof run, only after step 3 passes locally.** Dispatch on `main` so T1 runs (a schedule run skips it: F9). Read the gate step and the T2 seed step in the log. Record the run id on OSE-1730. Do not re-run earlier: failed runs feed the throttle (F8).
5. **Then, one at a time:** delete the old Access token `ose-staging-t4-admin` (check Last Seen), `ci-deploy-token` and its policy, and finish the remaining Phase 4 rotations in blast-radius order.

### Agent lanes (no secrets, can start now, two PRs)

| Lane | Change                                                                                                                                                                                                                       | Recovers      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| A    | One `scripts/ci/check-worker-secrets.sh` used by both gate steps (OSE-1731): stops on non-zero wrangler, labels auth and network failures as such, exact-name match, no `\|\| true`. Add a `tokens/verify` and account-match check. Born-red tests with a fake wrangler. | F4 + F5 (25)  |
| B    | Run seeds with the locked wrangler (install worker deps in T2 and T4, or call the locked binary) and add a gate that no `npx wrangler` in a job lacking it.                                                                  | F6 (12.5)     |
| C    | Linear and record sync (after you say go): OSE-1730 to In Progress with the corrected facts (E3, E14), OSE-1731 to Todo, a dated OSE-1695 comment, and a refreshed checklist replacing the 10-12 queue.                       | F3, F9, F10 (15.5) |

Merge A and B while staging is red if checks pass: Done is deferred, and a later green SHA that contains them closes them (AGENTS.md). Do not start A or B ahead of owner step 3. They must not change the credential or confound the diagnosis.

### Path to 95% (projection, each step needs recorded evidence)

| After                                          | Raw deduction | Score                      |
| ---------------------------------------------- | ------------- | -------------------------- |
| Today                                          | 118.55        | 0%                         |
| Step 2: F1 closed (floor lifts)                | 103.55        | 0% (arithmetic)            |
| Step 3–4: F2 closed, green dispatch run        | 61.75         | 38.3%                      |
| Lane A merged (F4, F5)                         | 36.75         | 63.3%                      |
| Lane B merged (F6)                             | 24.25         | 75.8%                      |
| Lane C done (F3, F9, F10)                      | 8.75          | 91.3%                      |
| F8 clears when the chain is green              | 6.25          | 93.8%                      |
| F7 recorded as accepted by the owner (or mitigated) | 0        | ≥95%                       |

Points per owner minute, estimated: step 3–4 recovers 41.8 for about 40 min including the run; step 2 recovers the Security Critical floor and 15 points for about 20 min. Those two go first.

## What must be true before shipping

- Cloudflare shows the old token revoked or deleted, and the audit-log result is written on OSE-1467.
- A dispatch on `main` where T1 is **not** skipped is green for T1 to T4, run id on OSE-1730.
- Lane A merged, so a future auth failure reads as an auth failure.
- Lane B merged, so T2 and T4 run the locked wrangler.

## Verification after shipping

- Next nightly (03:24Z): T2 seeds green, which covers D1 write only.
- `gh run list` filtered by event shows green for push, dispatch **and** schedule on one SHA.
- `git grep OCR_PROPAGATE_TOKEN .github` still shows the ratchet baseline of 1 (notify-osm) or lower.

## Risks accepted (need your word)

- F7 (PR-head reach to the token) stays until OSE-1699 after launch.
- Staging test data in FORMS_DB is the only thing at risk from F4 today; production holds no real end-user records (owner, 2026-10-14).

## Limits of this review

- Not seen: the archived session's transcript and uncommitted files; Cloudflare token state, audit logs, GitHub secret and environment settings; any run after 2026-10-19 03:42Z. The reviewer's log and settings reads were refused by the proxy; mine were not, so E3 and E7 are runtime evidence.
- E6's reading of the 9109 and 10502 errors is inference, not documented fact.
- The dated launch lines in OSE-1251 (due 10-21; launch day 10-24 from the 09-18 reconcile) sit beside the owner's 10-12 hold. This review does not plan a go-live.

## Human-gate questions (loop 1, layer Conservative; gap first appeared in Loop 2)

1. **Is the old Cloudflare token already revoked, and what did the audit log show?** Closes F1 and lifts the floor.
2. **What do the three read-only calls return (status codes only), and what are the two `gh secret list` dates?** Selects the row in the decision table.
3. **Go for Lanes A and B as two draft PRs, and for Lane C (Linear writes)?**
4. **Do you accept F7 until OSE-1699, in writing on OSE-1695?**
5. **Before the container is reclaimed: can you check the archived session's dirty worktree on a trusted device?** Its uncommitted files are the only record of 10-17 to 10-19.
6. **Severity of F6:** High (mine) or Critical (the reviewer). It moves 5–6 points, not the verdict.
