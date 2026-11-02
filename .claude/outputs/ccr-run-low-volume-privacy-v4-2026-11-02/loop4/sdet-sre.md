# Loop 4 (Compliance), sdet-sre lens: epic OSE-1766, subject v4 frozen (dd9b8522...)

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

I give no score and no gate decision, I fixed nothing, and I did not edit the subject. Basis key: proven (a command result this run), source-read, arithmetic, inferred. Every legal reading is inferred.

Paths are relative to `C:\Users\mzdan\dev\ourCommunityRituals\ourSharedEvents` unless noted. `ci.yml` means `.github/workflows/oursharedevents-ci.yml`.

## 0. Fresh read-only facts (the CI truth at 2026-11-02 18:48Z)

`gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push --limit 12`, newest first (proven):

| Run         | Commit         | Result      | Time (Z) | Duration      |
| ----------- | -------------- | ----------- | -------- | ------------- |
| 41503990040 | #1076 8439ae62 | in_progress | 18:48    | 1m13s at read |
| 41496750244 | #1075 08703cd7 | failure     | 18:02    | 24m35s        |
| 41478743227 | #1074 9134ab9f | failure     | 16:09:53 | 33m19s        |
| 41478643507 | #1073 77e5d912 | cancelled   | 16:09:18 | 36s           |
| 41474937633 | #1072 23ba4d6c | success     | 15:46    | 36m8s         |
| 41468952196 | #1071 6bdc2f90 | success     | 15:10:21 | 50m50s        |
| 41468896801 | #1070 0ebe2fdd | cancelled   | 15:10:02 | 21s           |
| 41468851354 | #1069 8e6d19dd | success     | 15:09:45 | 25m41s        |

- **Root of 41496750244:** `classify-ci-failure.mjs --run-id 41496750244` names the root `T4 Functional (surfaces ...) > T4f: SharedReport Depth Gate` (a test failed). `T4 Functional → Staging` is red only as a consequence.
- **Root of 41478743227:** the same script names `T2 Contract (pages) > Bruno contract section`. `gh run view --json jobs` shows T3 Smoke, `T3 E2E Smoke → Staging (Playwright)`, T4 Functional (all legs) and `T4 Functional → Staging` as skipped. That is the fail-fast chain working.
- **Second red window today.** It starts at 16:09Z. Three merged SHAs have no green chain of their own: 77e5d912 (cancelled), 9134ab9f (T2 red), 08703cd7 (T4f red). Elapsed to 18:48Z is 2 h 38 min (arithmetic). #1075 and #1076 merged onto an already red main.
- **First window (R3 fact g):** 50 h 19 min, 5 SHAs, first green e9211436 at 06:42Z. It is now confirmed as recurring, not a one-off.
- **Merge versus Done gates (source-read).** `tools/ci/main-branch-protection.json` lists 10 required contexts, all S0/T0/reconciler/inv22/mobile. None is T1 to T4, and its `_comment` says so deliberately. Merge is gated by T0; Done is gated post-merge only.
- **Comment drift.** The `ci.yml` comment above `functional-staging-sub` (~line 1893) says "The required check `T4 Functional → Staging` is the aggregator". It is not a required context.

## 1. Regulatory tier test

**Which reading of the tier.** The protocol text is narrower than the brief's paraphrase. `ccr-protocol.md:37` and `:386` define Regulatory Required as "Federal legal obligation (HIPAA, COPPA). No partial credit." The 25-point tier's worked sections (HIPAA hard ceiling, `:1271-1296`) are federal-regime extensions. The brief says "a legal duty the product has taken on in writing". Under the protocol's literal text, GDPR and ePrivacy are not federal, and ADR-018 (Accepted) declines HIPAA and COPPA, so nothing below is Regulatory. Under the brief's wider reading, the written takings-on are:

- `privacy.ts:2` and `:48-101` (BE-10, GDPR Art. 13 headings, Art. 6 legal bases);
- `data-subject.ts:2` and `:103` (Art. 17, CCPA);
- ADR-001:14, 112 and 159 ("GDPR ... satisfied or improved by").

The lead has to rule which reading governs. Verdicts under each:

| Candidate                                                                                                          | Wider (brief) reading                                                                                                                                                  | Protocol-literal reading     | Evidence meets the bar?                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| R1-05, `privacy.ts:58` "no personal data is stored" beside keyed id, `forms.ts:443-448` `last_anonymous_id`        | REGULATORY (inferred): a published Art. 13 statement is false about stored data, and the product took Art. 13 on in writing                                            | NOT REGULATORY (not federal) | Source-read of string against code. It does not establish the legal duty. Stays inferred |
| R2-04, the self-contradicting notice (`privacy.ts:55/58/62/69/126`)                                                | Same root as R1-05. REGULATORY only if R1-05 is                                                                                                                        | NOT                          | Same                                                                                     |
| R1-06, the cookie-notice duty (one-year `ose_anon`, "nothing was collected", `admin-settings.ts:178` "no cookies") | REGULATORY candidate (inferred, ePrivacy 5(3) strictly-necessary exemption is unproven). Invariant 4 and ADR-024 name the cookie in writing. The public text denies it | NOT                          | Source-read only. The strictly-necessary question is a legal reading                     |
| R1-02, one-grain rule false before OSE-1784                                                                        | NOT REGULATORY. A product claim ("at least 5 ... never who"), not a stated legal duty                                                                                  | NOT                          | n/a                                                                                      |
| Erasure after a pepper rotation (`data-subject.ts:216-219`)                                                        | REGULATORY candidate (inferred, Art. 17). It is stored data breaking a written erasure duty                                                                            | NOT                          | See below                                                                                |

Erasure detail (source-read):

- `scanNodeKey(anonId, env.ANON_ID_HASH_PEPPER)` is computed with the current pepper only. `DELETE FROM scan_node_returns ... anonymous_id = ? OR anonymous_id = ?` binds the raw id and the current key.
- `RUNBOOK-DEPLOYMENT.md:438-453` documents the same hole for `anon_id_returns` ("Erasure ... can only re-derive the hash under the current pepper") and prescribes a manual purge after every rotation. It names no purge for `scan_node_returns` (grep: no match for that table in the runbook).
- `set-secrets.sh` has no rotation or purge warning (grep). The CI gate message routes the owner there (R3-03).
- The hole is therefore written down for one table and open for the WHO table. Retention by hour bounds the window, but the retention length was not read.

**New written-promise finding (see L4-SDET-1).** The notice itself says "we comply with COPPA". That is a published compliance claim for a regime the org declined. COPPA is federal, which matches the protocol's literal definition.

## 2. Invariant conformance (AGENTS 1 to 9; my lens only)

| #                                              | Verdict                                                                   | Rows and evidence                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 never who                                    | VIOLATES on main, and after the subject ships                             | R1-10: `scan-buffer.ts:96-100` claims "no shared durable correlation key", false in substance (register, merge-verified). R1-01: the KV expiry leg survives S2. Erasure leaves a gap (R3-01) and misses old-pepper WHO rows. The subject's S6 AC2 cannot be falsified (register section 4, row 16)                                          |
| 2 floor, no exceptions                         | VIOLATES on main, and after the subject ships                             | R1-16, R2-02, R1-02 (OSE-1784), R1-08. R1-04's label was fixed after the freeze by #1073 (recorded, not rated). RA-1 accepts only the exact-count wording (subject F-2). It does not cover R2-02 or the R1-16 organic route. Not for the subject to resolve                                                                                 |
| 3 place not person, "no CF-IP* header is read" | VIOLATES the literal text on main                                         | `public-read-limit.ts:86` reads `CF-Connecting-IP` as the rate-limit key (register, merge-verified; not re-read by me). Invariant 3 is about location, so the text is over-broad rather than the code wrong. The AGENTS text is the owner's, so this is a drafting gap and I rule it NOT ADDRESSED in intent. The subject does not touch it |
| 4 no cookies except `ose_anon`                 | CONFORMS in code (ADR-024), VIOLATES in the public text                   | Cookie exists as invariant 4 allows. The notice and `admin-settings.ts:178` deny it (R1-06). The subject's S15 does not name the cookie                                                                                                                                                                                                     |
| 5 display shows no counts                      | NOT ADDRESSED                                                             | No retained slice touches the display. S4 ACs name no display surface, and the subject lists 13 surfaces                                                                                                                                                                                                                                    |
| 7 security never tier-gated                    | NOT ADDRESSED by my lens (the report-token depth belongs to other lenses) |                                                                                                                                                                                                                                                                                                                                             |
| 8 design system                                | Not tested by me                                                          |                                                                                                                                                                                                                                                                                                                                             |
| 9 PII                                          | NOT ADDRESSED by my lens                                                  | S14 output can print keyed ids and ciphertext (R2-25)                                                                                                                                                                                                                                                                                       |

## 3. ADR conformance

| ADR                                                             | Verdict                                     | Evidence                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 (:52-54 keyed id, hour buckets)                         | The subject cites it correctly. Drift stays | `forms.ts:316,510,594` ISO timestamps against ADR-001:54 "bucketed to the hour" (the subject's S7 gap). ADR-001:14/112/159 assert GDPR compliance the notice then contradicts. ADR-001:52 does not list the KV marker or dead letters (S2 plans an amendment)                         |
| ADR-018 (declined HIPAA/COPPA/SOPPA, Accepted 2026-09-10)       | VIOLATED by `privacy.ts`                    | The notice says "we comply with COPPA" and "verifiable parental consent" (~`:120-124`), and is stamped "Last updated: 2026-04-23 Phase 1 baseline" (`:126`), which predates the ADR. ADR-RECONCILIATION rule 4 (a stale artefact must not stay silently wrong) is breached. L4-SDET-1 |
| ADR-020 (Accepted; CODEOWNERS "protected only at merge time")   | The ADR is self-aware, and now stale        | It states the gap in writing (see section 5). It says `.github/` is protected at merge by CODEOWNERS. With `required_pull_request_reviews` null it is not enforced even then (R3-08). Reconciliation rule 4 (mark Drifted) not applied                                                |
| ADR-021 (Proposed, "production read-only for every test suite") | The subject CONFORMS                        | S14 and the staging steps are staging-only. Note that the ADR is only Proposed (needs founder sign-off, OSE-906). The subject cites it as binding                                                                                                                                     |
| ADR-010, ADR-012, ADR-014                                       | CONFORMS / NOT ADDRESSED                    | No row touches them in my lens                                                                                                                                                                                                                                                        |
| ADR-025, ADR-026 (planned)                                      | NOT ADDRESSED                               | They do not exist yet. The subject's S16 AC3 relies on CODEOWNERS (R2-15, R3-08)                                                                                                                                                                                                      |
| ADR-024 (cookie and invariant 4)                                | CONFORMS in code                            | The notice is the gap                                                                                                                                                                                                                                                                 |

## 4. Definition of Done and pull-request rules

| Rule (AGENTS "Definition of Done: two stages")                                      | Verdict                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merged: levels 1-5 ran on the PR; a named CI job goes red if it regresses           | VIOLATES for S5 (disclosed). S2/S3/S4/S6/S7/S15 CONFORM only through T0 mock tests                             | The subject's section G says S5 has "none (docs, no failing check)". The staging steps are post-merge only, because T1-T4 are not required checks (section 0)                                                                                                                                             |
| Done: all four jobs `success` for the merge SHA "or a later main SHA containing it" | VIOLATES in practice (R1-09, R3-06)                                                                            | Section 0: 77e5d912 and 0ebe2fdd were cancelled. Ancestry alone means #1070 reads Done through 6bdc2f90's green chain, which never ran #1070's own deploy. The rule has no "step present in the green run" clause. The register's R3-06 stands. Basis: arithmetic over `gh` output, source-read of AGENTS |
| Two stages and Linear In Progress at merge                                          | CONFORMS                                                                                                       | The subject's C.0 Done paragraph restates AGENTS correctly                                                                                                                                                                                                                                                |
| "A CI/CD testing ticket is attached"                                                | Not yet satisfied (unproven)                                                                                   | The subject stubs nine tickets and files none (B.4 acts only after the gate). R1-29 stands                                                                                                                                                                                                                |
| `Part of OSE-###`, close-guard                                                      | CONFORMS in the subject's text, with a hole                                                                    | The subject forbids `Closes` on every slice PR (stricter than AGENTS, which permits it on the finishing PR). R2-17: the guard's own test passes `Part of OSE-1` with `Closes OSE-2` (register, source-read; I did not re-read it)                                                                         |
| Born red ("a gate that cannot fail counts as absent")                               | VIOLATES, disclosed                                                                                            | Subject C.0 says staging steps cannot be born red against a branch. R1-07 and the 35 criteria in the register's section 4 show gates that stay green on their own fault. Mock-layer tests are born red locally                                                                                            |
| "Every case at two layers: mock and staging (Bruno / Playwright)"                   | VIOLATES the letter                                                                                            | The six new steps are bash scripts, neither Bruno nor Playwright. `ci.yml:2035-2048` (the OSE-616 trace step) is a bash precedent. For the production direct-write path no staging layer exists at all (production has no queue; env-parity lists it UNDECIDED)                                           |
| "Coverage is what CI runs"                                                          | S5 CONFORMS only as docs. The six steps are CI-named; the ratchet's orphan check covers only `tests/e2e` specs | `scripts/ci/ci-integrity-ratchets.mjs:9` defines orphans as `tests/e2e` specs no workflow names. A `scripts/ci` script no workflow calls is not counted (inferred from the header)                                                                                                                        |

**CI-integrity ratchets against the subject:**

- `.ci-integrity-baseline.json` counts 19 `continue-on-error` (8 in `ci.yml`). It counts the keyword only. A bash step with `|| true`, or one whose `if:` is mistyped, is invisible to it (`ci-integrity-ratchets.mjs:6-9`). R3-05 stands.
- The ratchet runs in the required `T0 Gate (lint)` shard on PRs (`ci.yml:737-760`). It does bind, but only on the keyword.
- Named-checks test, `tests/unit/t4-named-checks.test.js:31`, regex `/^T4[0-9a-z-]*:/i`: `T4 S2: ...` is not matched and `T4S2:` is. The gate-count versus post-line-count assertion (`:46-49`) would go red the moment someone adds a `post "T4 S2:` line for an unmatched step. The test would force a decision rather than pass silently, but it would not pin the step. Proven by the register's regex re-run, source-read by me.
- The aggregator `T4 Functional → Staging` (`ci.yml:2541`) reads the leg result. The named-check poster maps any non-success outcome other than failure to `neutral` (`ci.yml:2488-2495`), not red.

## 5. Human approval and production posture

**Repository controls and secrets.**

- **R1-23 (the deploy token).** Source-read, plus the repo's own written statements.
  - `AGENT-WORKSTATION-HARDENING.md:91`: "`CLOUDFLARE_API_TOKEN_OSE` serves staging and production with one value".
  - The production job (`ci.yml:2562-2820`) references the same secret (`ci.yml:2669-2787` among the 29 token references). Production Workers and D1 deploys require that token.
  - ADR-020:60-75: the repo-level secrets list includes `CLOUDFLARE_API_TOKEN_OSE`, the environments had no rules (verified 2026-09-26), and "a trusted-user auto-run PR can reference **any repo-level secret**". Claude PRs auto-run with no approval gate.
  - `PR_SECRET_EXPOSURE_GUARD.md:190`: `full-pipeline/*` is the "approved deploy path" and is excluded from the guard's model.
  - `check-pr-secret-exposure.mjs --report` (run): a plain PR reaches the secrets listed in my command log, not the Cloudflare token. The token is reachable via `full-pipeline/*` and via any PR that edits a workflow to reference it, which the guard itself cannot stop (PR-head content). Merge-verified by the register for environment lists (0 and 0).
  - **Verdict:** CONFORMS to AGENTS "Repository controls" in letter (the owner holds the fix). The subject's own S14 claim ("Limits what a compromised T4 step can do with the deploy token to reads", subject line 167) is false and VIOLATES AGENTS "Quality gates: Born red" in spirit. S14 asks the owner to add KV list to the same token, which widens it while `AGENT-WORKSTATION-HARDENING.md:91` says to split it first.
  - Production scope is written in the repo, which narrows loop 3's "scope unknown". What remains unread is the token's real Cloudflare policy since the 2026-10-20 re-set.
- **Branch protection.** `required_pull_request_reviews` is null. `AGENT-WORKSTATION-HARDENING.md:78-82` lists enabling it as an OWNER step (6), so it is a known open owner item. R3-08 stands. CONFORMS (owner-only), but ADR-020's "CODEOWNERS at merge" and S16 AC3 rest on it.
- **R3-07, forged check-run.** `ci.yml:1902-1904` gives the T4 legs `checks: write` and `post()` calls `gh api -X POST .../check-runs -f name=... -f head_sha=...` (`ci.yml:2490-2503`). The required contexts are T0/S0 names, produced by the same GitHub Actions app. The T4 step runs PR-head content on `full-pipeline/*` PRs. The register's "acceptance by GitHub" stays inferred. NOT ADDRESSED by an AGENTS rule. It is the ADR-020 class ("no in-workflow guard is tamper-proof"), named in writing but unmitigated.
- **R3-03, `set-secrets.sh`.** CONFORMS to AGENTS "Secrets" (owner terminal, no value in chat). The overwrite-all behaviour is not covered by a rule. The runbook's rotation purge (`RUNBOOK-DEPLOYMENT.md:438-447`) is not referenced from the script or from the gate message (grep of the script for purge/rotation: only a line about "rotate freely" for one pepper at `:33`).

**Production posture ("in sync, and closed").**

- **In sync.** Migration level main 77 versus 104 and forms 14 versus 18. `docs/runbooks/PRODUCTION-MIGRATION-PLAN.md:1` is titled "main 77 to 104, forms 14 to 18". `ls migrations` shows 0104 as the highest file and S3 adds 0105. The subject's S3 text says "Production stays at 104 until the owner asks" (subject S3 order-and-window paragraph). That premise is false against the plan file (R1-25 stands). AGENTS itself says the migration level "is not compared in CI. Until it is, in sync holds only on a day both were read". So the posture sentence is acknowledged-open, not violated by the subject. After S3 and S7 ship the gap grows by two.
- **env-parity (run, proven).** `node scripts/ci/env-parity.mjs` and `--strict`: UNLISTED 0, UNDECIDED 2 (`SCAN_QUEUE` producer and `ose-scans` consumer), INTENTIONAL 9. Output ends "PASS: no unlisted difference. STRICT: not aligned yet". It says migration level is "Not read here". The subject's claim that env-parity output is unchanged by every slice CONFORMS (no binding change). The staging-only queue means the queue path is the only one tested on staging (subject C.0 states this).
- **Cron in the production block.** `wrangler.toml:383-384` `[env.production.triggers] crons = ["0 3 * * *"]`. Named environments do not inherit triggers, so the block is required (`:102-103`). It conforms to "Closed" as AGENTS defines it (no `PRODUCTION_LIVE`, no clients, no announcing). AGENTS says "Held, not closed" explicitly, and a cron is not a client. So the cron runs nightly on whatever build production holds (a 2026-09-22 deploy, `ROLLBACK.md:154`) against a database at migration 77 (inferred from last read). Production cron liveness has no signal (R2-19). The subject's step 32 (an equal cron change in both blocks passes parity) is true (`env-parity.mjs` compares crons; the production block is what a cron-time change would edit).
- **Drill credential (R3-09).** `staging-rollback-drill.yml:17` says "the staging Cloudflare credential only". `:91`, `:130` use `secrets.CLOUDFLARE_API_TOKEN_OSE`, the one `AGENT-WORKSTATION-HARDENING.md:91` says serves production too. The job declares `environment: staging` (`:53`), which has no rules. `staging-rollback-drill.test.js` forbids the text `--env production` in the file, a text guard on a token that is not environment-scoped. `ROLLBACK.md:279` says "No workflow in this repository runs [wrangler rollback]". The drill runs it (`:152`, `:155`). Both statements are false (proven by reading both files).
- **Rollback runbook ticket gap (R3-04).** `ROLLBACK.md` §4 (`:144-148`) and §5 (`:174-180`) give `gh workflow run ... -f deploy_production=PRODUCTION` with no `-f ticket=`. `ci.yml:2593-2610` makes the production job's gate step `Gate: the change names its ticket (CCR B5)` NOT continue-on-error and run `require-ticket.mjs`, which exits 1 with no ticket. That job needs the whole staging chain (`ci.yml:2570-2580`), so the failure lands after about 35 minutes (the runbook's own estimate, `ROLLBACK.md:154`). `grep -n ticket ROLLBACK.md` shows only the §0 prose lines (11, 16, 17, 43, 47). AGENTS "Production: deploys only through CI ... every production change has a ticket" is CONFORMED by the code and VIOLATED by the runbook. The §6 break-glass path skips CI, so it is where an incident goes.
- **ROLLBACK §9** still reads "not read from the repo" for the `production` environment rule. The register proved it has required reviewers and a branch policy. Doc not updated (Low, folded into R3-04).

**Staging gate order (memory `project_staging_gate_order`, PO 2026-10-22).**

- **(a) Order.** T1 deploy, T2 Bruno, T3 Playwright smoke, T4 functional. `smoke-staging-sub` needs `contract-staging` (`ci.yml:~1708`) and T4 needs `smoke-staging` (`ci.yml:1870`). CONFORMS, proven by run 41478743227 (T2 red, T3 and T4 skipped).
- **(b), (c).** CONFORMS.
- **The subject's six steps.** All sit in the T4 surfaces or forms legs, the deepest and most expensive tier. They respect the order. They add 6 to 7 serial steps to a 30 minute leg (R1-33). The subject never adds a cheap earlier step (T2 or T3) for any slice. S2's only early evidence is T1's secret gate.
- **Departure the subject does not address.** The memo says that after launch the deep tier runs nightly and on call only. AGENTS and the subject's C.0 require T4 green for each merge SHA as Done. So after launch the slices' Done evidence is not on the merge path. Memory-sourced, not in a repo doc. See L4-SDET-2.

## 6. Brain and loop-back

- **`LOGGING_STANDARD.md:372`** "Worker console logs | Session only" against `wrangler.toml:94-96` `[observability] enabled = true` ("Workers Logs ... real-time + historical"). Doc contradicts config (source-read). Brief cites `:371`; the row is at `:372`.
- **Same table, `:373`:** "Audit logs | Permanent | Google Sheets (AUDIT_LOGS)". `ROLE-STATE.md:26` says Phase 2 D1 swap is complete with no Sheets dependency, so this row is stale. Widens R3-10 (same root, same file, not a new row).
- **S3 and `LOGGING_STANDARD.md`.** The subject's S3 gap text relies on `LOGGING_STANDARD.md` stating that no `/q` or `/s` line names a placement, code, visitor state or event (subject S3 item 6, "exists per DS, reviewer-read"). I did not confirm that sentence. The register says S3 AC6 is where the retention row is corrected. I read S3's traceability and platform-logs paragraphs but not AC6 itself. F-15 (Workers Logs schema) is deferred to an owner read.
- **Full sync chain (owner 2026-10-22).** The subject's section G marks eight of its hops "(no failing check)". Brain loop-back hops (ROLE-STATE, CONSTRAINTS, threat ledger) are human-only by its own statement. `LINEAR-MAP.md`: the register records 0 of the epic's ids and a last commit of 2026-09-21; I did not re-verify.
- **Broken-chain instances I confirmed:** ROLLBACK §8 versus the drill (`:279`); drill header versus its credential; ROLLBACK §4 and §5 versus the production ticket gate; ROLLBACK §9 versus the register's environment read; LOGGING_STANDARD `:372-373` versus config and ROLE-STATE; `privacy.ts:120-126` versus ADR-018; the `ci.yml` "required check" comment versus branch protection; ADR-020's CODEOWNERS sentence versus live protection. Also the reconciler comment (`ci.yml:~2958`) says "Advisory for now", but the check is a required context in the JSON.
- **Rollback section 8 versus the drill.** ROLLBACK.md line 7 says the steps are "Not yet practised"; `STAGING-DRILL.md` says "Not yet run". The drill workflow exists and can run. Whether it has ever run was not read.

## 7. The CCR protocol applied to this run

- **Severity tiers.** All register severities are inside the protocol's six tiers.
- **A Critical withheld?**
  - R1-23 is held at High with "Critical not ruled", pending token scope. The repo already states that the token serves both environments (`AGENT-WORKSTATION-HARDENING.md:91`) and the production job uses it. Reach from a PR step is merge-verified (repo-level only, environment lists empty). The residual unknown is the token's policy after the 2026-10-20 re-set. By the protocol, a "security finding with exploit potential" is Security Critical and gets no partial credit (`ccr-protocol.md:393`).
  - My recommendation for loop 5 is to rule it against the written evidence, not wait for a dashboard read. It is not merge-verified at runtime (basis: reach proven, scope source-read and doc-read).
  - OSE-1699 is a post-launch owner item. ADR-020 records the gap as the "outstanding security action". The owner's 2026-10-12 `staging-pr` reviewer decision is not in force (no such environment, proven). So parking this under OSE-1699 is parking an in-scope claim (S14's threat review) in an out-of-scope record. Only the placement fix belongs there.
- **R2-02 stays High** (loop 3's reasoning is sound; I did not test it).
- **RA-1's coverage (F-2).** Only the exact-count wording, by an outsider or brand admin who injects. R1-16's injector variant is inside it. R1-16's organic route and R1-02's decoy variant (another poster clears 5, so D minus S needs no injection) are not. Loop 3 said the same.
- **Ratchets and DoD gates are ratchets, not controls.** Owner memory (2026-10-12): gates may improve and never regress. The subject adds six unratcheted steps.

## 8. New findings

**L4-SDET-1. COPPA compliance claim in the public notice for a declined regime.**

- **Severity:** High (10) base. Regulatory candidate under the lead's ruling on the tier. COPPA is federal, which matches `ccr-protocol.md:37/386` literally. The legal reading is inferred.
- **Slice:** S15 (the notice) and main.
- **Claim:** `privacy.ts` ~`:120-124` says "For events open to children under 13, we comply with COPPA. A parent or guardian must submit any form ... We do not knowingly collect personal data from children under 13 without verifiable parental consent." The footer reads "Last updated: 2026-04-23 Phase 1 baseline" (`:126`).
- **Conflict:** ADR-018 (Accepted 2026-09-10) says HIPAA/COPPA/SOPPA events are refused, not routed. Org invariant #29 (`architectural-invariants.yaml:667-746`) and `ADR-001` (tier clamp) agree. A page that says it complies with a declined regime states a capability the product has said it does not have, or an event type it refuses.
- **Basis:** source-read. I read the page lines through the sed output (`:120-126`) and ADR-018's header and context. I did not read the whole page or the clamp code.
- **Root cause:** the notice was written at the Phase 1 baseline and never reconciled when ADR-018 landed (ADR-RECONCILIATION rule 4).
- **Why not already a row:** the register's notice rows (R1-05, R1-06, R2-04) cite `:55/58/62/69/126`. None names the COPPA paragraph, and S15's AC1 phrase list (8 phrases over 3 sources) does not cover it. The S15 words review, as scoped, would leave it.

**L4-SDET-2. The Done evidence tier is slated to leave the merge path.**

- **Severity:** Low (2).
- **Slice:** C.0 and all six steps.
- **Claim:** memory `project_staging_gate_order` (PO 2026-10-22): after launch the deep tier runs nightly and on call only. AGENTS Done and the subject's C.0 define Done as T1-T4 green for the merge SHA, and every slice's evidence step is in T4.
- **Evidence:** AGENTS "Definition of Done" (after first launch, production deploy and smoke join the bar; nothing says T4 leaves). `ci.yml:127-128` nightly runs "Gate + Smoke + Contract (no deploy)" (R2-27 already shows the schedule skips T4).
- **Basis:** source-read, with the owner statement from memory (not a repo document).
- **Root cause:** two owner statements about the same tier, not reconciled in the brain.
- **Why not already a row:** R2-27 is about the schedule skipping T4 today, not about the post-launch rule conflict.

**L4-SDET-3. A comment states a required check that is not required.**

- **Severity:** Low (2).
- **Claim:** the `ci.yml` comment above `functional-staging-sub` (~`:1893`) says `T4 Functional → Staging` is the required check. `tools/ci/main-branch-protection.json` excludes T1-T4 by design. A reader of the workflow believes merge is blocked by T4; it is not.
- **Basis:** source-read of both. The register's live read (10 contexts) agrees.
- **Why not already a row:** R1-09 and R3-05 are about the chain and named checks, not this statement.

## 9. Re-rates with reasons

- **R1-23:** High (kept) to a Security Critical candidate for loop 5. Reason: section 7. Condition to hold at High: a read of the token's Cloudflare policy showing no production scope. Basis: reach proven and merge-verified, scope source-read and doc-read, runtime scope still unread.
- **R3-04:** stays Medium. Strengthened: the gate fires after the whole chain (about 35 min by the runbook's estimate), and the §9 row is also stale.
- **R3-09:** stays Low. Strengthened by `AGENT-WORKSTATION-HARDENING.md:91` (the drill's token serves production).
- **R3-10:** stays Low. Widened by `LOGGING_STANDARD.md:373`.
- **R1-09:** stays High. Confirmed as recurring: a second red window started 16:09Z today and is 2 h 38 min old at 18:48Z.
- **R3-06:** stays Medium, but it is no longer only a risk. #1070's Done rests on #1071's green chain (arithmetic from the run list).
- **R3-08:** stays Medium. `AGENT-WORKSTATION-HARDENING.md:78-82` shows the owner already has this as step 6 of a written plan.
- **R1-02, R1-05, R1-06, R2-04, erasure after rotation:** keep their tiers as base severity. Regulatory is the lead's ruling (section 1). Neither ruling changes a count I have evidence for.

## 10. Not checked, and why

- **Token's real Cloudflare policy**, GitHub's precedence for a forged check-run (R3-07), Workers Logs retention, DLQ retention, production migration level, and `SELECT COUNT(*)` on production registrations. All need the owner's terminal or a test PR, which I may not run.
- **`public-read-limit.ts:86`** (invariant 3) and the data-subject erasure of `scan_node_returns` under an old pepper beyond `:205-235`. I took the first from the register and read only that slice of the second.
- **`check-pr-linear-close.mjs` and its test (R2-17)**, and the guard's behaviour on `Closes:` or URLs. I did not re-read them.
- **S3 AC6's exact text** and `LOGGING_STANDARD.md`'s `/q`-`/s` sentence. I read S3's traceability and platform-log paragraphs only. I did not read subject sections C.3 to C.11 in full, nor D.
- **`privacy.ts` as a whole, `/es/privacy`, and the invariant 8 targets.** Other lenses own them.
- **The tier ruling.** I could not decide which reading of Regulatory governs. That is the lead's.
- **ROLE-STATE and the threat ledger.** Searched only for production-level statements; the output was too large and I did not read it.
- **`.claude/sync/LINEAR-MAP.md`.** I ran a log and a count and the result was lost in an oversized output. The register's figures stand unchecked by me.
- **The `staging-rollback-drill.yml` run history.** I did not look at whether the drill has ever run.
- **No file was modified, no `git status` check was run afterwards.** The two `node scripts/ci` commands below are read-only by their headers, but I did not confirm that beyond the headers.

## 11. Commands run (all read-only; none was refused)

- **Read tool:** `BRIEF-loop4.md`; `.claude/skills/sdet-sre.knowledge.md`; `MERGED-loop3.md`; `subject-v4-frozen.md` (lines 1-170, 495-668; the full-file read was too large and was rejected once by the tool's size limit).
- **gh:** `gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push --limit 12`; `gh run view 41496750244 --json jobs --jq ...` and the same for `41478743227` (non-success jobs only).
- **node:** `node scripts/ci/classify-ci-failure.mjs --run-id 41496750244`, the same for `41478743227`; `node scripts/ci/env-parity.mjs`; `node scripts/ci/env-parity.mjs --strict`; `node scripts/check-pr-secret-exposure.mjs --report`.
- **git:** `git log --oneline -12 origin/main`; `git log -1 --format=%cd -- .claude/sync/LINEAR-MAP.md` (output lost).
- **Bash sed/grep/cat/ls/wc** over: the subject (headings, S3 grep); `docs/runbooks/ROLLBACK.md` (1-30, 81-190, 265-290, grep); `docs/security/LOGGING_STANDARD.md` (360-380, grep); `workers/oursharedevents/wrangler.toml` (85-100, 375-392, grep for observability and cron); `.github/workflows/staging-rollback-drill.yml` (1-40, 80-140, grep); `.github/workflows/oursharedevents-ci.yml` (100-150, 735-760, 1695-1712, 1865-1912, 2028-2052, 2440-2460, 2475-2584, 2585-2610, 2949-3011, greps for `continue-on-error`, `full-pipeline`, `CLOUDFLARE_API_TOKEN`, job names); `tests/unit/t4-named-checks.test.js` (20-60); `scripts/ci/ci-integrity-ratchets.mjs` (grep); `.ci-integrity-baseline.json` (head); `scripts/ci/require-ticket.mjs` (1-50); `tools/ci/main-branch-protection.json`; `docs/adr/` listing; `ADR-001` (48-56), `ADR-018` (1-30 and grep), `ADR-020` (1-80), `ADR-021` (1-60), `ADR-RECONCILIATION-PROCESS.md` (1-50); `docs/runbooks/STAGING-DRILL.md` (1-40), `PRODUCTION-MIGRATION-PLAN.md` (1-12), `RUNBOOK-DEPLOYMENT.md` (grep pepper, 436-460); `docs/security/AGENT-WORKSTATION-HARDENING.md` (70-100); `docs/security/PR_SECRET_EXPOSURE_GUARD.md` (grep); `workers/oursharedevents/src/handlers/data-subject.ts` (205-235), `privacy.ts` (45-70, 120-128, grep GDPR); `scripts/set-secrets.sh` (grep); `.claude/skills/ccr-protocol.md` (greps, 380-394, 1271-1296); memory `project_staging_gate_order.md` (cat); `docs/adr/` and `docs/security/` GDPR greps; `architectural-invariants.yaml` greps; `docs/brain/ROLE-STATE.md` and `CONSTRAINTS.md` greps (one output persisted to the tool-results folder, not read in full); `ls workers/oursharedevents/migrations` and `migrations-forms` with counts.
- **Refused:** none. One Read of `CCR-TOKEN-PROJECT-DIRECTION-2026-10-19.md` failed (file not found), so I could not confirm F7's wording at `:102`.
