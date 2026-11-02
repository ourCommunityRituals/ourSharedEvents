# Loop 5 (Recursive): dr-of-security. Epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim. This lens ran on Opus.

- **Subject:** `sha256sum subject-v4-frozen.md` gives `dd9b8522…b7f4`, which matches.
- **Code:** read in `ose-clock-gate` at e7c8297b. `git diff --stat 39a63d67 HEAD -- workers/oursharedevents/src` is empty. `origin/main` is 8439ae62 (drift is an environment fact).
- **Paths:** under `workers/oursharedevents/` unless they start with `.github/`, `docs/` or `scripts/`. `ci.yml` is `.github/workflows/oursharedevents-ci.yml`.
- No score, no gate decision, no edits.
- My rules forbid file writes, so this report comes back through the hand-off for the lead to save.
- Basis key: proven, arithmetic, source-read, inferred. Legal readings are inferred.

## 1. High stability table

| Row                      | Claim re-checked at                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                    | Basis                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-01                    | `qr-scan.ts:177-186`: marker `scanDedupKey(scanKey ?? anonId, …)` with `expirationTtl: 3600`. `scan-buffer.ts:72-74`: key shape. Subject `:260`: "cannot read the triple without `RATE_LIMIT_KEY_PEPPER`". `CF_API_TOKENS_POLICY.md:50-52, :62-64`: Workers Scripts Edit and KV Edit at **Account** scope, "Deploy … staging and production".                                                                                                                        | **STABLE, High.** S2 cures the name-pair and raw-cookie legs. The expiry-second leg and the custody leg survive. Two small corrections are in section 2: the `/q` bucket store lives 60 s, and the loop-3 "outsider" label is wrong.                                                                                                                                                                                       | source-read. KV expiry: proven at type and emulator level, REST output inferred. Custody (a deployer's code reads its own bindings): inferred. |
| R1-07                    | Subject C.8 staging steps 3-4 (`:254-255`): the control is a D1 count; the assertion is absence in K1−K0.                                                                                                                                                                                                                                                                                                                                                            | **STABLE, High.** A dropped `put` on AC1's path _is_ caught by the mock spy. So the High rests on the staging layer missing config faults (unbound KV, a short or missing pepper on staging), which the mock cannot see. That is the AGENTS two-layer rule.                                                                                                                                                                | source-read; grep proven (loop 3)                                                                                                              |
| R1-08                    | Subject AC3 (`:246`). `rate-limit.ts:77, :121-133`: today a short pepper falls back to SHA-256, and the marker uses no rate pepper (`qr-scan.ts:179`), so dedup is unaffected on main. Gates check names only (`ci.yml:1255`, `:2664`). `ci.yml:1265` itself says "wrangler cannot read values".                                                                                                                                                                     | **STABLE, High, created by S2. The closed-when is REVISED.** The loop-1 closed-when ("the deploy gate rejects a short pepper") cannot be built: `secret list` returns names only. Closure must happen at runtime: refuse to count, or a post-deploy health bit for pepper length. "Missing" is refused at deploy by name, so only a post-deploy `secret delete` reaches it. The live path is a _short_ value put directly. | source-read                                                                                                                                    |
| R1-10                    | `scan-buffer.ts:101-137`: one batch, placement row then WHO row. `0101…sql:31`: UNIQUE (event, anon, bucket), so one WHO row per browser per event-hour. Subject C.6 `:221-224`.                                                                                                                                                                                                                                                                                     | **STABLE, High.** The join is exact in event-hours where no browser scanned two posters and nothing was erased. D1 rowid assignment follows SQLite semantics (inferred).                                                                                                                                                                                                                                                   | proven on a model (L1/L3); source-read                                                                                                         |
| R1-23                    | Read today, names and dates only: `CLOUDFLARE_API_TOKEN_OSE` is a repository secret, updated 2026-10-20T14:07:30Z. Env secret lists: production 0, staging 0. Last `T1 Deploy → Production` success: 2026-09-22T02:51:32Z (run 35679613677). No dispatch since 2026-10-20T16:38Z; both post-reset dispatches skipped production. No `v*` tag run in the last 300 push runs (back to 2026-09-30). Subject `:167`: "limits … to reads", and the owner is to add scope. | **STABLE, High. Conditional unchanged. The closure is REVISED** (section 3).                                                                                                                                                                                                                                                                                                                                               | reach proven; scope documentary; trigger (b) proven unmet                                                                                      |
| R2-01                    | `ci.yml:157-158`: group = event + PR number or ref, so PR, push and dispatch runs do not exclude each other. `:1186-1191`: `full-pipeline/*` PRs deploy. `:1192`: `environment: staging` (no rules). `:1996-2001`: freshness is checked once.                                                                                                                                                                                                                        | **STABLE, High.** The harm (false Done evidence) has never been exercised, and exposure is low (0 `full-pipeline` runs in 40, loop 3). It holds because R1-09's cure creates the race.                                                                                                                                                                                                                                     | config source-read; collision inferred                                                                                                         |
| R3-03                    | `set-secrets.sh:71-83`: `ADMIN_KEY` first on staging, `ANON_ID_HASH_PEPPER` last. `:96-121`: each value is put inside the loop, no skip.                                                                                                                                                                                                                                                                                                                             | **STABLE High; claim REVISED.** It "re-puts every value and rotates any value the owner cannot paste back". F-10's target is last in the array, so every other value is re-put first, and aborting part-way does not help.                                                                                                                                                                                                 | mechanism source-read; rotation effect inferred (depends on what the owner kept)                                                               |
| R4-01 (security reading) | `privacy.ts:111-123`. ADR-018 `:53-55`. `0057…sql:19-20`: `school_event` and `club_activity` are unselectable, "Phase 5 (COPPA)". `0057:69-71` maps `school_fundraiser` to tier-1 `FND-%` types. `0015…sql:222-229`: "band boosters, sports events", audience "Families & Supporters". `template-clearance.ts:94`. No age mechanism in `src` (grep).                                                                                                                 | **STABLE, High.** The security reading: the addendum promises a parental-consent gate that does not exist, so a parent who relies on it gets no control. BA's Medium premise (tier 4/5 events cannot exist) is true but beside the point. The sentence triggers on "events open to children under 13", and a tier-1 school fundraiser is such an event.                                                                    | source-read; legal inferred                                                                                                                    |
| R1-16 (touched in L3)    | `shared-report.ts:726-728`: `nowMs` is taken at run start. `:764-811`: the per-bucket loop runs first. `:812` passes `nowIso`, bound as `computed_at` at `:898`.                                                                                                                                                                                                                                                                                                     | **Claim STABLE, High. Its lowering condition is WRONG** (section 3).                                                                                                                                                                                                                                                                                                                                                       | source-read                                                                                                                                    |
| R2-02 (touched in L3)    | `shared-report-builder.ts:836-842`: cells are summed over all hours (`GROUP BY h3_res9`). `:875-879`: the suppressed branch.                                                                                                                                                                                                                                                                                                                                         | **STABLE, High.** It is one bit per event. This builder has no per-hour route.                                                                                                                                                                                                                                                                                                                                             | source-read                                                                                                                                    |

## 2. My own errors across four loops

| Loop | Claim                                                                                                  | What was wrong                                                                                                          | Correct statement                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | SEC-2: "loop 4: maybe Regulatory, false Art. 13 notice"                                                | The protocol's Regulatory tier is a federal obligation only (`ccr-protocol.md:37`).                                     | NOT Regulatory under the protocol text. GDPR applies only under the wider reading, which is an owner question. |
| 1    | SEC-1: the `/q` caller bucket's `resetAt` in ms is "a second clock"                                    | I gave no lifetime. The bucket's TTL is one window, 60 s (`rate-limit.ts:204-206`).                                     | It is a 60-second store, negligible beside the hour-long marker. It adds no weight to R1-01.                   |
| 1    | SEC-6: R1-23 Medium, "no product effect"                                                               | Under-rated.                                                                                                            | Raised in L2; High is correct.                                                                                 |
| 2    | R1-23 root: "T4 declares no `environment:`"; an env secret "could override"                            | The token is repository-level and the env lists are empty (proven L3, re-proven today). `environment:` changes nothing. | Root: a repository-level token reachable from PR heads.                                                        |
| 2    | R1-08: "one honest visitor … with no attacker at all"                                                  | Too strong. It needs one person to scan 5 times on purpose.                                                             | No skill, forged cookie or injection is needed. The only fault is the operator's misconfiguration.             |
| 2    | R1-10: rank pairing "approximately on the direct path"                                                 | Order-blind wording.                                                                                                    | Exact where the per-(event, hour) counts match (L3).                                                           |
| 2    | "KV down: the unwrapped `get` throws, 500, scan lost: fails closed"                                    | Never checked whether a caller catches it.                                                                              | Withdrawn as stated. Not verified.                                                                             |
| 3    | Card 1a: "outsider with a D1 and KV export … Cost: one export, no secret"                              | A KV listing with expiry needs Cloudflare API access.                                                                   | Actor: a token or account holder. The export itself needs the credential.                                      |
| 3    | L3-SEC-1: "can also get the Worker's secrets", stated as fact                                          | Platform behaviour.                                                                                                     | Inferred: a deployer can ship code that reads its own bindings.                                                |
| 3    | C1: "2.0 if the scorer accepts the documents"                                                          | The documents show the _designed_ scope, not the live scope.                                                            | 1.5 now; 2.0 on an R1-23 trigger (section 6).                                                                  |
| 3    | R1-16: "High stands only if the snapshot delay is minutes (open fact 6)", tied to a `computed_at` read | `computed_at` cannot measure that delay.                                                                                | See section 3, R1-16.                                                                                          |
| 4    | R3-01 condition: "production FORMS_DB has 0016 applied"                                                | The plan puts production forms at 14, "may be 15" (`PRODUCTION-MIGRATION-PLAN.md:15-17`).                               | See the full correct statement after this table.                                                               |
| 4    | R1-23: "only OSE-1699's token move" closes it                                                          | Conflated the subject's defect with F7's reach.                                                                         | The subject's part closes inside the epic (section 3).                                                         |
| 4    | R3-03: "replace with the `FORMS_HASH_PEPPER` erasure leg", stated as certain                           | The effect needs a value the owner did not keep.                                                                        | Inferred: it holds for every value the owner cannot paste back.                                                |
| 4    | 7(a): a PR-head actor can "forge the Done evidence"                                                    | Deploying to staging is proven by scope. Forging Done is not.                                                           | Forging Done is inferred: it needs R2-01's timing, or GitHub accepting a forged check (R3-07).                 |

**Correct statement for R3-01:**

- Production forms is at 14, so 0016 is not applied there.
- Production has no events and its forms tables are empty (plan `:19-20`, 2026-10-07, not re-verified).
- The production Worker is the 2026-09-22 build (proven today), which predates keyed ids.
- So R3-01 is unreachable on production because there are no rows, not because of 0016.
- At the next production deploy, T1 applies forms 0015 to 0018 before the new Worker goes live. The guarantee then holds, except for a form written by the old Worker in the gap (0016 header).
- A registration needs an event. So the "registration before the next deploy" route in loop-4 2.5 first needs an admin to create a production event (inferred, low). Low stands.

## 3. Conditional rulings

**R1-23.**

- Triggers (a) to (c) are stated correctly _for the reach_.
- But the register keeps R1-23 in scope "for the subject's own claims" (L3 2.2, L4 4.2), while F7 (the reach) is recorded out of scope and not accepted in writing. The scorer must say which one a trigger rates.
- **My recommendation:**
  - Keep R1-23 as the subject's row: S14's false review (`:167`), S14's instruction to widen the PR-reachable token, and five slices adding steps that hold it.
  - If a trigger fires, that row is Security Critical, because the subject's claim then hides a production-write path.
  - It closes **inside the epic**: correct the sentence, and meet S2's KV-list need with a separate staging-only read token held as a `staging` environment secret. It does not wait for OSE-1699.
- **Add trigger (d), created by the subject:**
  - S14 tells the owner to add KV scope, and `CF_API_TOKENS_POLICY.md:52` designs KV Edit at Account scope.
  - Followed as written, that gives PR-head steps a production `RATE_LIMIT_KV` listing. With R1-01's expiry leg, that yields who, where and the second on production.
  - Whether a namespace-scoped KV permission exists is a platform fact (inferred: the policy shows none).
- **Settled now:** (b) is unmet (no production deploy since 2026-09-22; env lists 0 and 0, proven).
- **Only the owner can settle:** (a) the dashboard read; (c) a token test.
- The Tier-1 base item stays unresolved (cap 70).

**R1-16: the condition is wrong, and it is the wrong condition.**

- `computed_at` is the run-start timestamp, taken before the per-bucket loop (`shared-report.ts:726-728` → `:812` → `:898`).
- "Seven nights within seconds of 03:00" therefore measures only cron start jitter, and it would pass however long the loop takes. It cannot fail on the delay that matters, so applying it would lower a High on a vacuous test.
- **Right condition:** the `scan_aggregation` phase `duration_ms` in the `SHARED_REPORT_MATERIALIZE_COMPLETE` log line (`handlers/shared-report-materialize.ts:107-121`), over 7 nights in staging Workers Logs (owner item 4).
  - Alternative: compare the stored 03-hour cells with a recount of `scan_placement_events` for that hour.
  - Lower to Medium only if that phase takes seconds.
- The owner's read-only item 3 (L4 section 6) should be replaced.

**R2-02.**

- Stated correctly.
- From the repo: the per-hour route is absent from this builder.
- Other surfaces (dashboards, admin) were not re-checked for a per-hour 0-row.
- "Door equals person" is the owner's to settle.

**R4-01 / COPPA extension.**

- The cited text is the right one (`ccr-protocol.md:1432`). The protocol adds at `:1440`: "If your platform collects data and children could reasonably use it, COPPA applies unless verified mechanisms exist."
- New repo evidence moves this off "a deployment fact":
  - The prevention is at catalog level (`0057:19-20`), not a verified mechanism at the point of collection.
  - `school_fundraiser` is selectable at tier 1 (`0057:69-71`; `0015:222-229`). No stage filter turned up in `admin.html`, but the picker was not run.
  - Forms take a name and an email with no age mechanism.
- On the protocol's own reading, the trigger looks met (inferred; this is the protocol's reading, not the statute's).
- **Consequence:** three COPPA base items open as Regulatory Required. That means cap 60, class `compliance`, and a human gate after every loop, and this run had none.
- Owner-only.
- Also: `briefing.ts:124` (the auth-gated CEO briefing) plans "Phase 5 — Youth Events (Year 2)", against ADR-018's refusal. Same class as R4-01; internal; not rated.

## 4. Subject-created versus found-on-main (my lens)

| Row   | On main at 39a63d67                                            | After the subject ships                                                                                | Exact split                                                                                            |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| R1-01 | Exposure: KV name pair, expiry second, forms timing join, logs | S2 cures the name and raw-cookie legs. It adds a false custody claim (`:260`). The expiry leg is left. | Both. The bucket "found on main, left" is right, but S is mixed: partly cured, plus a new false claim. |
| R1-07 | none                                                           | The staging step cannot fail                                                                           | S only                                                                                                 |
| R1-08 | none: dedup works with a short rate pepper                     | AC3 creates the fail-open                                                                              | S only                                                                                                 |
| R1-10 | Exposure                                                       | S6 adds a criterion that cannot fail and an "open outcome" claim                                       | Both (exposure M; plan defect S)                                                                       |
| R1-23 | Repository-level reach (F7)                                    | False review; KV widening; more steps hold the token                                                   | Both. The subject **worsens** it.                                                                      |
| R2-01 | Concurrency config                                             | More steps; S2's K1−K0 over a global prefix                                                            | Both. Worsened.                                                                                        |
| R3-03 | The script                                                     | F-10 and E6 are routed through it                                                                      | Both. Left and relied on.                                                                              |
| R4-01 | The addenda                                                    | S15 edits the page and leaves them, so S15's "say only what holds" is false                            | M, with an S claim defect                                                                              |

## 5. The post-freeze fix (R1-04, OSE-1787)

**Options:**

- (a) Score R1-04's in-scope half at the baseline and record #1073 as an environment fact.
- (b) Credit #1073 and close the row.
- (c) Score at the baseline and split the closure note.

**Recommendation: (c).**

- The subject and the baseline are frozen. Crediting a change the subject did not make breaks the run model, and the same rule must then apply to #1069 (R1-19).
- The subject's own defect survives #1073: S15 AC1 still does not read `pages.ts`, so the criterion could not have failed on the label. That half stays a live criterion defect.
- The worksheet should record "label gone on main, 77e5d912; the residual is S15's file scope".
- OSE-1787 stays out of scope only if the owner confirms RC-01. Otherwise loop 5 scores it.

## 6. Systemic promotion and cluster multipliers

**The pattern.**

- One systemic root for the subject-authored members: C.0's born-red convention asks for _an_ injected fault that the test catches, not the fault the criterion claims to guard against.
- Examples in my lens: S2's staging control (R1-07); S6 AC2 (R1-10); S14 AC1 to AC3, which test the wrapper and not the boundary (R1-23).

**What would collapse.**

- Rows whose only defect is the criterion would collapse into it: R1-14, R1-15, R1-27, R1-39, R1-40, R1-46, R2-11 to R2-14, R2-22, R2-25, R3-05, R3-11, R4-06, R4-07, R4-12.
- Rows with their own exposure keep their rows, and their criterion facet points to the root: R1-01, R1-06, R1-08, R1-10, R1-16, R1-23, R2-05, R2-18.

**Related, not members** (rooted in main config or AGENTS text): R1-41, R2-15, R2-17, R3-06, R3-08.

**R1-07.** Keep it in C3 and out of the collapse. Its harm is specific (it removes the only detector for R1-08 and R2-03). Counting it in both would double-count.

**Scoring note.** H4 plus H3 on one systemic row (High × log₂(N+1)) does not shrink the deduction, as long as breadth N is the member count. Collapsing without breadth would shrink it, which would be perverse.

**Multipliers:**

- **C1:** hold 1.5. Raise to 2.0 on R1-23 triggers (a), (b) or (c), or on (d) if the scorer accepts that S14's KV widening at Account scope reaches production.
- **C3:** hold 2.0 (R1-07, R1-08, R2-03), on the condition that R1-07 is not collapsed. If it is collapsed, C3 drops to 1.5.
- **C6:** hold 2.0. R2-01's config is re-confirmed.
- **C2 and C5:** hold as recorded. R4-01 is related to C5, not a member. Little of my lens's evidence bears on them.

## 7. Per-loop score derivation

- Deriving each loop's score from **only the rows discovered in that loop** is not faithful.
  - Nothing was fixed between loops, so loop 2's score would wrongly imply loop-1 rows had closed.
- Faithful method: **Score_N = 100 − Σ(rows open at the end of loop N, at the tier the register held then), with H1 by discovery loop applied once.**
  - Score_5 then equals the cumulative score. The checker's rules (cumulative no better than the worst loop; system no lower than cumulative) hold by construction.
- Why §3.3's re-weight should not apply: its premise ("choosing not to fix") is false under the owner's no-fix model.
- **A gap no loop named:** H1 defines constants for loops 1 to 3 only (`ccr-protocol.md:461-465`; also `:1762`, `:1769`).
  - R4 and any R5 rows have no constant.
  - The scorer must state one. I recommend capping at 1.5, since extrapolating would be a protocol change.
- Apply the token-scope Tier-1 cap from loop 2, the loop where the inferred scope first carried weight.

## 8. Convergence

- My lens's new roots per loop:
  - L1: 10 ids;
  - L2: 1 (R2-03);
  - L3: 3, two of which merged into existing rows;
  - L4: 3 (R4-02 to R4-04);
  - L5: none.
- No High in my lens changed tier in loops 3 to 5.
- What moved in loop 5 is the **conditions and closures**, not the tiers:
  - R1-16's lowering test is vacuous;
  - R1-23's closure splits from F7 and gains trigger (d);
  - R1-08's closed-when cannot be built;
  - the COPPA trigger now rests on repo evidence.
- The register is stable enough to score, provided the scorer adopts the corrected R1-16 condition and rules on R1-23's in-scope boundary and on COPPA (owner).

## 9. New findings

**No new subject root cause.** The `computed_at` mislabel (a stored cell stamped earlier than the data in it) is a facet of R1-16.

**Proposed run-conduct row RC-04, Medium:**

- The loop-3 and loop-4 conditional for R1-16 (and owner item 3) reads a run-start timestamp. That test cannot fail, so it would lower a High on no evidence.
- Evidence: `shared-report.ts:726-728, 812, 898`; `shared-report-materialize.ts:107-121`.
- Basis: source-read.
- Closed when the condition and owner item are replaced as in section 3.

## 10. Not checked

- Live Cloudflare token scope; Workers Logs; KV REST listing output; production migration levels and row counts. These are owner-only or credential reads.
- Whether the template picker hides `stage: 'v2'` at runtime. I did not run it.
- Per-hour 0-rows on dashboards or admin surfaces (R2-02's second trigger beyond the builder).
- Other lenses' Highs (R1-02 to R1-06, R1-09).
- Statute text. Every legal reading here is inferred.
- No tests run.

## 11. Commands run (all read-only; none refused)

- **Read:** `BRIEF-loop5.md`; `MERGED-loop4.md` (whole); `MERGED-loop3.md`; my L1 to L4 reports; subject lines 29-36 and 113-264.
- **Bash, local:**
  - `ls`, `wc`, `sha256sum` over the scratchpad;
  - `grep` of my rows in the L1 and L2 merges; `grep` of the loop files for `computed_at` and for any note of H1 constants.
- **Bash, git in `ose-clock-gate`:** `git rev-parse HEAD`, `git diff --stat 39a63d67 HEAD -- …/src`, `git log -1 origin/main`, `git status --short`.
- **Bash, `sed -n` / `grep` / `awk` over:**
  - code: `qr-scan.ts`, `scan-buffer.ts`, `rate-limit.ts`, `scan-node-key.ts`, `shared-report.ts`, `shared-report-materialize.ts`, `shared-report-builder.ts`, `erasure-anon-lookup.ts`, `privacy.ts`, `briefing.ts`, `event-type-catalog.ts`, `template-clearance.ts`, `events.ts`, `index.ts`, `router.ts`, `admin.html`;
  - migrations: forms 0016; main 0015, 0024, 0057, 0101;
  - CI and scripts: `ci.yml` (triggers, concurrency, secret gates, token lines, `environment:` lines, freshness), `set-secrets.sh`, `staging-rollback-drill.yml`;
  - docs: `PRODUCTION-MIGRATION-PLAN.md`, ADR-018, `CF_API_TOKENS_POLICY.md`, `AGENT-WORKSTATION-HARDENING.md:91`, `ccr-protocol.md` (2.5, 2.6, 3.3, 10.2, `:1750-1775`).
- **gh, read-only:**
  - `gh run list --event workflow_dispatch --limit 15`;
  - `gh run list --event push --limit 300` (tag filter in `node -e`);
  - `gh run view --json jobs` for runs 39459166333, 39436555076, 38600128681, 37168132954, 35679613677;
  - `gh secret list` (names and dates, filtered to `CLOUDFLARE`);
  - `gh secret list --env production | wc -l` and `--env staging | wc -l` (counts only).
- **Not done:** no file writes, tests, branches, commits, stashes, deploys or credential reads.
