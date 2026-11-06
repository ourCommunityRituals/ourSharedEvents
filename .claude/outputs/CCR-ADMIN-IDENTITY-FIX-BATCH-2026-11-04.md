---
ccr: 1
class: security-fix
requested_loops: 5
loops_run: 5
team: base
gate: stop
cumulative_score: 0
system_score: 0
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 9, medium: 8, low: 19 }
pr: 1092
subject_commit: 5f9fb51c (full SHA in git, PR #1092 head)
---

# CCR re-run: the admin identity fix batch (PR #1092, OSE-1801), 2026-11-04

**Owner's request:** "Re-run the CCR" (on the fix batch from the first CCR of #1090).

**How it ran:**

- Five loops, in the owner's run model: Critical, Conservative, Adversarial, Compliance, Recursive.
- The subject was frozen and nothing was fixed between loops.
- There is one cumulative score.

## Verdict

|                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System score**          | **0%**. Weighted deductions total 196.0, so the raw score is about −96.                                                                                                                                                                                                                                                                                                                                                                            |
| **Security Critical**     | None found. Loop 3 showed that no cross-brand read, write or auth bypass is reachable without a code change or a misconfiguration. That was proved against the code and on the mock layer (the real `route()`, a stub D1, an I/O-only clock). It was not proved against the live Cloudflare configuration: the deployed WORKER_ENV values and preview URLs are unverified.                                                                         |
| **Assessment confidence** | **85%**. By loop it went 88%, 90%, 92%, 88%. It fell in loop 4, which found four security records overclaiming and a merge with open Highs, and it fell again on the loop 5 audit. The unproven items are the Cloudflare account state, the production clock behaviour (inferred; see L3-R4), and the absence of any staging run of this code. Loop 2 also rated L2-S1 High, and loop 3 then refuted that rating.                                  |
| **Gate**                  | **FAIL, human gate.**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Subject**               | PR #1092 code at `5f9fb51c` on base `b0e4de4a`, with `git diff` sha256 `a2455388d3e2e67c`. It was re-checked unchanged before every loop. The PR head at merge was `8f97f843`, which adds only two CI-only commits: a generated README gate-index row, and the untracking of an older worksheet. The owner merged #1092 at 2026-11-04T23:15Z as `1f640291`, while loop 2 was running. The review continued on the merged code as a post-merge CCR. |

**Headline:**

- **The fix behaves as written on the paths tested.** The repeat route keeps the actor, and plain-address emails, the not-before rule and the bypass allowlist all hold there. Each hand-picked mutation of a fixed line (17 of them) went red under its own test. There are edge cases in R1-09, R1-10 and L3-F6.
- **CI Stryker still shows 4 surviving mutants in `admin.ts`** (S-2).
- **The proof is where it falls short:**
  - Its records claim more than the code and the configuration deliver (C4-01).
  - JWT trust still uses the exact-name denylist that the bypass replaced (R1-02).
  - Two of its gates are weaker than they say (R1-01, R1-03), and nothing gates the router order that the null-actor rule depends on (L2-S1).
  - Its mutation figure was wrong (S-2).
  - Staging never exercised it (R1-04).
  - Done waits on the staging chain. #1095, which fixes T4, has merged.

## What was reviewed

**In scope:**

- `auth/admin.ts`: `inheritAdminActor`, `isPlainAdminEmail`, `notYetValid`, `jwtIdentityTrustable`, the `isDevOpenAdmin` allowlist and `logNullAdminActorDenied`.
- The router pre-flight audience pin.
- `event-repeat.ts`, and the four deny sites with `draftScopeVerdict`.
- Tests:
  - `admin-actor-expiry-race.spec.ts`
  - `admin-actor-memo.spec.ts`
  - `ci-service-actor-router.spec.ts`
  - `auth-jwks-verify.spec.ts`
  - `born-red-harness.spec.ts`
  - `admin-null-actor.invariant.spec.ts`
  - `tenant-isolation.invariant.spec.ts`
- Bruno folder 6, seq 17/18.
- Threat ledger entries TL-084 to TL-089, `SECURITY_BASELINE.md`, and `AUTH_TOPOLOGY_STAGING.md`.

**Context:**

- **T4 platform red:** T4's platform job has been red on every `main` SHA since #1085. The SharedReport admin probe followed the Access 302. #1095 fixes it and has merged as `974beb59`. This PR did not cause it, but it blocks this story's Done, so it is scored as a process item (L2-S3).
- **Production is behind:** production last deployed on 2026-09-21.

## Loop 1

Team: dr-of-security, role-qa-automation
Critical layer: What is true versus assumed? The lenses checked each of the PR's nine claims against the code and ran 17 hand-picked born-red mutations, all of which went red. Five gaps came out of it:

- **Tenant keys too broad:** the statement-text keys exempt every read in a file whose line text matches (P: a planted read passes HEAD and fails `main`'s gate).
- **JWT trust denylist:** "deployed" is still an exact-name denylist for JWT trust (P probe).
- **Null-actor gate:** it is textual.
- **Audience pin:** inert on staging.
- **Proximity gate:** has holes.

Copilot threads 4474171136, 4474171218, 4474171266 and 4474294798 reported the same issues independently.
Score: 49%

## Loop 2

Team: dr-of-security, role-sdet-sre
Conservative layer: Assume the worst. Three findings came out of it:

- **L2-S1:** the not-before rule appeared to let `requireAdmin` allow a request whose actor was null (P, but at the auth-module level only; rated High).
- **Staging never exercised the change:** T4b to T4i were skipped, all seven CI-brand Bruno requests skipped, and no testable environment pins the audience. This raised R1-04 to High.
- **The mutation evidence was false:** CI scored `admin.ts` at 99.01% with 4 survivors, against the 99.75% claimed. An in-source comment calls a surviving mutant killed.

This loop also found that JWT refusals are silent, and that TL-088's named vector (a deploy without `--env`) stays open.
Score: 0%

## Loop 3

Team: dr-of-security
Adversarial layer: Break the floor. **L2-S1 was refuted at the router level, on the mock layer:**

- **Method:** the red team drove the real `route()` bundle with a two-brand stub D1, RSA-signed tokens and a clock that moves only on I/O.
- **Result:** a token with `iat` or `nbf` 61 s ahead got 401 INVALID_JWT at the pre-flight, and nothing was written.
- **The catch:** that protection is statement order only. Moving the rate-limit block above the pre-flight gives a cross-brand PUT 200 with a null audit actor, and both gates stay green.

An independent red team, given no earlier findings, reached the same conclusions and re-found loop 1's weakest points at runtime. It added two findings: a non-numeric `nbf` is ignored, and the memo is keyed by env identity. All the other attacks failed with evidence.
Score: 0%

## Loop 4

Team: role-scrum-master, dr-of-security
Compliance layer: Do the records, the Definition of Done and the process match what the code and CI establish?

- **False closures:**
  - TL-086 says "or local dev" but means any non-canonical name.
  - TL-087 claims the audience pin, but staging is unpinned. The ledger contradicts itself against TL-085.
  - TL-088 lists a no-`--env` deploy as mitigated, but it stays open.
  - TL-084 and the baseline call the null-actor property "gated", but the gate does not encode router order.
- **Rendering and staleness:**
  - CONFORMANCE will show #9 freshly green with the open count unchanged.
  - The baseline §5.2 still lists retired guards.
  - The records are written in the present tense while production runs the September build.
- **Process:**
  - The post-merge records (ROLE-STATE, Linear evidence) are missing.
  - The promised worksheet was not in the tree.
  - The PR merged mid-CCR with open Highs. No rule blocked it: the CCR gate is warn-only and covers governed files only. No owner decision is recorded.
  - Staging is exempt by the author's own reasoning only.

The C4-xx rows come from the Dr of Security's loop 4 report, and the SM-xx rows from the Scrum Master's.
Score: 0%

## Loop 5

Team: role-qa-automation
Recursive layer: Was the assessment honest? The audit found it **honest with corrections**, and every correction is applied in this version:

- **Folded:** one root cause was counted three times (L2-S1, L3-R2 and C4-04), and the staging layer four times (R1-04, C4-08, C4-10 and SM-06).
- **Re-graded with the change recorded:** L2-S5 and L2-S3 had been changed silently. L2-S5 was also priced at the wrong multiplier.
- **Split out:** the record overclaims are now their own row (C4-01).
- **Listed:** the "Dropped: none" claim is replaced by a folded list.
- **Reworded:** the verdict sentences that overstated the proof.
- **Confidence:** lowered from 92% to 85%.
  Score: 0%

## Findings register

**Weights:** Critical 15, High 10, Medium 5, Low 2.

**Modifiers:**

- **H1 loop position:** ×1.0 in loop 1, ×1.25 in loop 2, ×1.5 in loop 3 and later. It is applied at the loop where the finding, or the evidence that set its grade, first appeared.
- **H2 correlation:** ×1.5.
- **H5 environment:** ×0.75 for process and records.

**Column key:** P means proven (command plus output, or a CI run), I means inferred (file:line).

| id    | Severity | Loop | P/I | Status | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                                            | Deduction               |
| ----- | -------- | ---- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------- |
| R1-01 | High     | 1    | P   | open   | Tenant-isolation exemptions are keyed by statement text, which is broader than `main`'s line keys. A generic key exempts every same-text read in the file, and the duplicate `corridor-latch` key collapses.                                                                                                                                                                                                                                | Planted read passes HEAD and fails `main` (loops 1 and 3); TS1117   | 10.00                   |
| R1-02 | High     | 1    | P   | open   | JWT trust "deployed" is an exact-name denylist. An unsigned JWT names the actor and passes `requireAdmin` for WORKER_ENV preview, Production, "staging ", prod, "" or unset with no team domain. The false record is C4-01.                                                                                                                                                                                                                 | Probes from three lenses; `admin.ts:284-296`                        | 10.00                   |
| R1-03 | Medium   | 1    | P   | open   | The null-actor invariant matches text. `== null`, `??`, a comment, or a conditional deny all pass it, and the cede and route-entry classes check nothing.                                                                                                                                                                                                                                                                                   | Plants E1/E2 and A5/A6                                              | 5.00                    |
| R1-04 | High     | 1/2  | P   | open   | The staging layer never ran. Staging `CF_ACCESS_AUD` is empty, so the audience pin is inert on every testable environment, the service actor is inert, and Bruno seq 17/18 skip themselves while printing a pass. The H2 correlation with R1-13 is applied once. Found in loop 1 as Medium; S-1's evidence in loop 2 set it to High, so it is priced at ×1.25. C4-08 and C4-10 are folded in.                                               | `wrangler.toml:266,279`; probe (other-app token passes); T2 log     | (12.5+2)×1.5 = 21.75    |
| R1-05 | Medium   | 1    | P   | open   | The requireAdmin-proximity gate has a 2-line grouping hole, skips `startsWith` lines and misses `/…/i` literals.                                                                                                                                                                                                                                                                                                                            | Planted routes pass                                                 | 5.00                    |
| R1-06 | Low      | 1    | P   | open   | The deny-site log calls are untested.                                                                                                                                                                                                                                                                                                                                                                                                       | Removing them leaves 29/29 green                                    | 2.00                    |
| R1-07 | Low      | 1    | P   | open   | Duplicate object key in the tenant spec, and no CI typecheck or lint covers `tests/e2e`.                                                                                                                                                                                                                                                                                                                                                    | TS1117                                                              | 2.00                    |
| R1-08 | Low      | 1    | I   | open   | If a whole-host Access app is added (OSE-1353), the pre-flight audience pin will 401 that app's tokens on public routes.                                                                                                                                                                                                                                                                                                                    | `router.ts:791-813`                                                 | 2.00                    |
| R1-09 | Low      | 1    | P   | open   | A signed token with email `""` or `null` is now refused outright, with no fall-through to key auth.                                                                                                                                                                                                                                                                                                                                         | Probe                                                               | 2.00                    |
| R1-10 | Low      | 1    | P   | open   | The plain-email rule refuses some valid RFC and EAI addresses, which means a 401 lockout for those users.                                                                                                                                                                                                                                                                                                                                   | Probe                                                               | 2.00                    |
| R1-11 | Low      | 1    | I   | open   | The harness checks the test name by substring, and the method check runs only on annotated lines.                                                                                                                                                                                                                                                                                                                                           | `born-red-harness.spec.ts`                                          | 2.00                    |
| R1-12 | Low      | 1    | P   | open   | "A null first answer is kept" is a vacuous test.                                                                                                                                                                                                                                                                                                                                                                                            | Copilot 4474171266; QA                                              | 2.00                    |
| R1-13 | Low      | 1    | P   | open   | Bruno seq 17/18 skip themselves and print a pass. Seq 17 cannot tell "wrong brand" from "unresolved actor", and seq 18 leaves a draft behind per run.                                                                                                                                                                                                                                                                                       | T2 log; Bruno files                                                 | (correlated into R1-04) |
| L2-S1 | High     | 2    | P   | open   | "A null actor allows nothing" holds only because of router order: the pre-flight runs before any I/O after the entry read. Moving the rate-limit block (as its own comment invites) reopens a cross-brand write, and no test or gate defends the order. TL-084, the baseline and comments state it as gated. L3-R2 (a by-id route moved above the object guard keeps both gates green) and C4-04 (records claim it is gated) are folded in. | Loop 3 plants A and B; `admin-null-actor.invariant.spec.ts:216-218` | 12.50                   |
| S-2   | High     | 2    | P   | open   | The mutation evidence was false: CI 99.01% with 4 survivors against the 99.75% claimed. The `admin.ts:564` comment calls a surviving mutant killed. The gate is global at 95, not required, and does not run on `main` pushes.                                                                                                                                                                                                              | Runs 41927218196, 41925106787                                       | 12.50                   |
| S-3   | Medium   | 2    | P   | open   | JWT refusals are silent. The pre-flight 401 says "signature" for audience, email and nbf failures, and returns JSON even to a browser GET /admin. The deny log has no `request_id`, and no runbook or alert exists.                                                                                                                                                                                                                         | `router.ts:803-810`; `admin.ts`                                     | 6.25                    |
| S-4   | Low      | 2    | P   | open   | The repeat test's clock jump is keyed on a SQL prefix, which is brittle.                                                                                                                                                                                                                                                                                                                                                                    | Spec                                                                | 2.50                    |
| S-6   | Low      | 2    | P   | open   | CI for the subject SHA was cancelled (only the CI-only head ran fully). The orphan check has no CI born-red, and its failure shares the violation test's name.                                                                                                                                                                                                                                                                              | Runs                                                                | 2.50                    |
| L2-S2 | Medium   | 2    | P   | open   | TL-088's named vector (a deploy without `--env` gets `development`) stays open, and `DEV_OPEN_ADMIN` is on no forbidden list.                                                                                                                                                                                                                                                                                                               | Probe; `wrangler.toml:109`                                          | 6.25                    |
| L2-S3 | Medium   | 2    | P   | open   | Done is blocked: the T4 platform job was red for the merge SHA. The fix (#1095) has merged; this closes on a green T1–T4 run.                                                                                                                                                                                                                                                                                                               | Run 41932243203                                                     | 4.69                    |
| L2-S5 | Medium   | 2    | I   | open   | The records are in the present tense, while production runs the 2026-09-21 build. Rated Low in loop 2, then raised to Medium on the Dr of Security's loop 4 C-7.                                                                                                                                                                                                                                                                            | Deploy history                                                      | 4.69                    |
| L2-RB | Low      | 2    | I   | open   | Rolling staging back below #1090 would reopen TL-084 while the ledger says tested.                                                                                                                                                                                                                                                                                                                                                          | Loop 2 note                                                         | 1.88                    |
| L3-R4 | Low      | 3    | P   | open   | The local workerd clock moves during CPU, while production freezes it. Timing proofs in the pool use a different clock.                                                                                                                                                                                                                                                                                                                     | `workerd-clock.mjs`                                                 | 3.00                    |
| L3-F6 | Low      | 3    | P   | open   | `notYetValid` ignores a non-numeric `nbf` or `iat`.                                                                                                                                                                                                                                                                                                                                                                                         | Probe                                                               | 3.00                    |
| L3-F7 | Low      | 3    | P   | open   | The actor memo is keyed by env object identity. A different env object reads the request's own headers. No such path exists today.                                                                                                                                                                                                                                                                                                          | Probe P6                                                            | 3.00                    |
| C4-01 | High     | 4    | P   | open   | False documented closure: TL-086 ("or local dev"), TL-087 (audience pinned), TL-088 (no-`--env` vector mitigated) and the matching baseline sentences claim controls that the code and configuration do not deliver. TL-085 and TL-087 contradict each other.                                                                                                                                                                               | Loop 4 probes; `threat-ledger.ts`; `SECURITY_BASELINE.md:207-212`   | 11.25                   |
| C4-05 | Medium   | 4    | I   | open   | The regenerated CONFORMANCE will show #9 freshly attacked and green with the open count unchanged. The repo-root gate's annotation is not scanned.                                                                                                                                                                                                                                                                                          | Generator source                                                    | 5.63                    |
| C4-06 | Medium   | 4    | P   | open   | Baseline §5.2 still lists retired guards (OAuth, `guardV2AdminRoute`) directly above the new rules.                                                                                                                                                                                                                                                                                                                                         | grep                                                                | 5.63                    |
| C4-11 | Low      | 4    | I   | open   | Stale or overclaiming comments: `admin.ts:36-43,326-333,487-492,564`, `admin-object-scope.ts:188-196`, `router.ts:783-787,815-818`, and the tenant spec at 546.                                                                                                                                                                                                                                                                             | Source                                                              | 2.25                    |
| C4-12 | Low      | 4    | P   | open   | The OCR-docs invariant #9 record omits the new gates.                                                                                                                                                                                                                                                                                                                                                                                       | `architectural-invariants.yaml:1596-1690`                           | 2.25                    |
| SM-02 | High     | 4    | P   | open   | The post-merge records are missing: no ROLE-STATE entry since 2026-11-02, and no OSE-1801/1802 evidence in the repo.                                                                                                                                                                                                                                                                                                                        | `git grep`                                                          | 11.25                   |
| SM-03 | High     | 4    | P   | open   | The worksheet the PR body promised was not in the tree. This worksheet closes it once committed.                                                                                                                                                                                                                                                                                                                                            | `gh pr view --json files`                                           | 11.25                   |
| SM-04 | High     | 4    | P   | open   | Merged mid-CCR with open Highs and no recorded owner decision. The CCR gate is warn-only and covers governed files only, and conversation resolution is not required. The Security Human Gate review-event run 41928087639 shows failure.                                                                                                                                                                                                   | Branch protection; `ccr-gate.yml`                                   | 11.25                   |
| SM-06 | Low      | 4    | I   | open   | No owner ruling is recorded for the staging-layer exemption. The exemption itself is R1-04.                                                                                                                                                                                                                                                                                                                                                 | AGENTS.md two-layer rule                                            | 2.25                    |
| SM-07 | Low      | 4    | P   | open   | Subject drift: the review covered `5f9fb51c`, but the PR merged from head `8f97f843` (CI-only commits).                                                                                                                                                                                                                                                                                                                                     | `git diff`                                                          | 2.25                    |
| SM-08 | Low      | 4    | P   | open   | Three pushes on the PR, two of them fixing what local checks would have caught (the registry script cannot run locally: no Python).                                                                                                                                                                                                                                                                                                         | Commits                                                             | 2.25                    |

**Totals:** 196.0 points across 9 High, 8 Medium and 19 Low. The cumulative score is 0%.

**Re-graded:**

- **L2-S1:** High (auth-module probe) → refuted at the router in loop 3 → back to High as a folded row, because the order is undefended and the records claim it is gated.
- **R1-04:** Medium → High, on S-1's evidence in loop 2.
- **L2-S5:** Low → Medium, on loop 4's C-7.
- **L2-S3:** stays Medium, as a process item, now that the fix has merged.

**Folded:** each of these merged into the row named:

- L3-R2 and C4-04 → L2-S1
- C4-08 and C4-10 → R1-04
- Q5 and Q6 → R1-13
- L2-S4 → S-3
- Loop 4's Security Human Gate failure → SM-04
- Scrum C-1 → L2-S3
- C-5 and C-9 → S-2
- C-1, C-2 and C-3 records parts → C4-01

S-5 and Q7 were informational and are not scored.

## Solutioning

Each step goes in a follow-up PR from `main`, and each is born red.

1. **Trust and bypass:**
   - Make JWT trust use the same local allowlist as `isDevOpenAdmin`: WORKER_ENV unset, `development` or `test`, and anything else needs the team domain (R1-02).
   - Decide whether a deploy without `--env` (`development`) may ever carry `DEV_OPEN_ADMIN`, and add `DEV_OPEN_ADMIN` to the deploy-time forbidden lists (L2-S2).
2. **Null-actor ordering:**
   - If the route-entry actor is null, `requireAdmin` must not allow through Method 1, which makes the order irrelevant.
   - Add a router-ordering structural gate, watched red by moving the rate-limit block, listed in T0, and referenced in TL-084.
   - Fix the rate-limit comment (L2-S1).
3. **Tenant keys:** key each exemption by enclosing function plus text, with an expected count. Fail on duplicate keys, and give the orphan check its own test name (R1-01, R1-07, S-6).
4. **Null-actor gate:** strip comments before matching, and match `== null`, `??` and `if (actor)`. Require the `isDevOpenAdmin` test to be in the same condition (R1-03).
5. **Proximity gate:** cover `startsWith` lines and flagged literals, and remove the 2-line grouping (R1-05).
6. **Mutation:**
   - Kill or justify the 4 survivors, and correct the `admin.ts:564` comment.
   - Add a per-file floor for `admin.ts`.
   - Run mutation on push to `main` (OSE-1067).
   - Whether mutation becomes a required check is a repository control, so it's the owner's call (S-2).
7. **Observability:**
   - Log one `ADMIN_JWT_REFUSED {reason, request_id}` line per refusal path.
   - Add `request_id` to the deny log.
   - Give the pre-flight a reason code and the correct message, with HTML for browsers.
   - Add a runbook line (S-3, R1-06).
8. **Records:**
   - Re-scope TL-086, TL-087 and TL-088 to what holds and where.
   - Add OPEN entries for the four residuals: non-canonical WORKER_ENV trust, the staging audience, the no-env bypass, and router order.
   - Scope everything to "main/staging; production pending".
   - Rewrite baseline §5.2.
   - Mark AUTH_TOPOLOGY "inert today".
   - Fix the stale comments.
   - Update OCR-docs #9 (C4-01, C4-05, C4-06, L2-S5, C4-11, C4-12, L2-RB).
9. **Edge cases:** reject a non-numeric `nbf` or `iat` (L3-F6). Key the memo by Request only (L3-F7). Decide on email `""` and EAI addresses (R1-09, R1-10). Fix the vacuous memo-null test and the brittle repeat key (R1-12, S-4).
10. **Staging layer:** pin the staging audience (OSE-1377) and configure the service actor, so that seq 17/18 actually run. Until then, label the cases "not run" (R1-04, SM-06).
11. **Process:**
    - ROLE-STATE and Linear evidence (SM-02).
    - Commit this worksheet (SM-03).
    - Once T1–T4 are green on a `main` SHA containing `1f640291`, move OSE-1801 to Done (L2-S3).
    - The owner records the decision to merge below the gate (SM-04).

## What must be true before shipping

#1092 is already merged, so this lists what must be true before OSE-1801 is Done and before production carries this code:

- **Security:** solutioning steps 1, 2 and 8 have landed. They cover the trust and bypass denylists, null-actor ordering, and honest records.
- **Staging chain:** T1–T4 green on a `main` SHA containing `1f640291`. #1095 has merged; this is pending its run.
- **Mutation:** the evidence is corrected.

## Verification

- The follow-up PR's born-red evidence is recorded per step.
- T1–T4 are green on `main` after #1095 (run 41961039170 or later), and the run id goes on OSE-1801.
- A fresh CCR runs on the follow-up PR, because fix rounds breed findings.

## Risks accepted (proposed; the owner confirms)

- **The actor is pinned for the whole request.** A revocation after the request starts takes effect on the next request. Brand membership is re-read from D1.
- **The expiry race is proven at the mock layer only.** Staging cannot make a token expire mid-request on demand.

## Human gate

- Do you accept that #1092 merged below the 95% gate, with the Highs in this register fixed in a follow-up PR?
- Should a deploy without `--env` (`WORKER_ENV=development`) ever be able to open `DEV_OPEN_ADMIN`, or should the bypass require WORKER_ENV unset or `test`?
- Do you want `mutation` made a required check, and `CCR_GATE_MODE=block`? Both are repository controls.
- Can the staging Access audience be pinned now (OSE-1377), so the staging layer can run?

### Owner rulings (2026-11-06, on PR #1107)

- **Staging audience and service actor:** yes, pin them. The owner reads the staging Access app's AUD tag and creates the CI service token; the tag and the token's Client ID go into `[env.staging.vars]` in a PR; the token's secrets go into GitHub as `CF_ACCESS_CI_BRAND_CLIENT_ID` / `_SECRET` (owner only).
- **`DEV_OPEN_ADMIN` on a deploy without `--env`:** no. The bypass must need an explicit environment value that only local development sets, so a no-`--env` deploy (`WORKER_ENV=development`) can never open it. Separate work (TL-092).
- **Mutation testing:** make it a required check, and widen it: sunny and rainy paths, blue- and red-team security testing along whole target chains, split into separately organised runs. SharedReport gets the most weight, because after the privacy infrastructure it is the product's income driver at Anchor (mid), Enterprise and a possible Boutique level. Making a check required is a repository control the owner sets; the program is separate work.
- **#1092 merged below the gate:** accepted (owner, 2026-11-06), with the Highs in this register addressed in the follow-up PR #1107 (merged 2026-11-05) and the rest tracked as TL-091..TL-093.

## Fix batch status (2026-11-05, branch `claude/admin-identity-ccr2-fixes`)

This is the subject of the next CCR, not a score: fix rounds breed findings, so a fresh CCR runs on this PR.

| Step                   | Status                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1. Trust and bypass    | JWT trust uses the local allowlist (R1-02). The no-`--env` deploy question is open: a deploy without `--env` carries `WORKER_ENV=development` (`wrangler.toml [vars]`), and no deploy step checks `DEV_OPEN_ADMIN` (L2-S2 → TL-092, owner decision).                                                                                              | `admin-actor-memo.spec.ts` "only a local WORKER_ENV trusts an unverified Access JWT" |
| 2. Null-actor ordering | `requireAdmin` allows only the pinned actor; `admin-guard-order.invariant.spec.ts` added, listed in T0 and the gate index; rate-limit comment fixed (TL-090).                                                                                                                                                                                     | Pinned check removed: 3 tests allowed. Gate: 3 planted router faults red.            |
| 3. Tenant keys         | Exemptions keyed `<file> > <declaration>: <line>`; duplicate and orphan keys have their own tests.                                                                                                                                                                                                                                                | 6 plants red                                                                         |
| 4. Null-actor gate     | Comments stripped; every null test form matched; `isDevOpenAdmin` required in the same statement. Found and fixed event create's `{mode:'all'}` ternary.                                                                                                                                                                                          | 4 plants red                                                                         |
| 5. Proximity gate      | `startsWith` and flagged-regex routes covered; grouping only after a continuation.                                                                                                                                                                                                                                                                | Included in the 6 tenant plants                                                      |
| 6. Mutation            | `admin.ts` 100% (436 killed, 2 timeout, 0 survived) on the full config; per-file floor script with 8 tests; push-to-`main` trigger; new specs in the path filter. The floor found `count-floor.ts` at 89.78% (14 survivors from #1065/#1070), set as a ratchet; raising it to 95 is a follow-up. Making mutation required stays the owner's call. | Local Stryker run 2026-11-05; floor tests red on 2 faults                            |
| 7. Observability       | One `ADMIN_JWT_REFUSED {reason, where, worker_env, request_id}` per refusal path; reason is a required field; runbook entry added. JWKS outage still reads `malformed` (TL-093).                                                                                                                                                                  | `auth-jwks-verify`, `ci-service-actor-router` specs                                  |
| 8. Records             | TL-084..089 scoped "main and staging; production pending"; TL-087/088 narrowed; TL-090 (tested), TL-091..093 (open) added; baseline §5.2 rewritten; AUTH_TOPOLOGY marked inert today; ROLE-STATE entry. OCR-docs #9 not updated here (other repo).                                                                                                | `threat-ledger.ts`, `SECURITY_BASELINE.md`                                           |
| 9. Edge cases          | Empty or null email on a service token is no email (tested). Non-numeric `nbf`/`iat`, memo keying and EAI addresses not changed in this batch.                                                                                                                                                                                                    | `ci-service-actor.spec.ts`                                                           |
| 10. Staging layer      | Bruno CI-brand requests log `NOT RUN` instead of a passing skip test. Pinning the audience is the owner's (OSE-1377, TL-091).                                                                                                                                                                                                                     | 7 request files                                                                      |
| 11. Process            | This worksheet committed; Linear evidence after merge.                                                                                                                                                                                                                                                                                            | —                                                                                    |
