---
ccr: 1
class: architecture
requested_loops: 5
loops_run: 5
team: base
gate: stop
cumulative_score: 28
system_score: 73
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 1, medium: 1, low: 6 }
---

# CCR: OSE-2214 PR 3, retire the returns job and clear the stored phone ids (2026-11-24)

Each loop was a separate role agent, given the diff, the owner's rule ("count the traffic on the code, never the person", 2026-11-23) and the earlier loops' findings, and not the author's conclusions. Claude Code wrote the change and this worksheet.

## Verdict

| Item                  | Value                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Classification        | Architecture change (a phase of the nightly job and of the BigQuery export removed, and a data-clearing migration): 5 loops                |
| Cumulative score      | **28%**: 100 less every finding raised (72 points), before solutioning                                                                     |
| System score          | **73%**. Of the 27 points open, 10 wait on the owner (L4-02), 5 are a staging-layer check (L2-02) and 12 are Low, pre-existing or accepted |
| Assessment confidence | 80%. Source reads, local worker, architecture and root runs, born red on the new specs. Staging has not seen the change                    |
| Gate                  | **Stop. Human gate.** One owner question is open (L4-02); see the end                                                                      |

**Deviation, stated so it can be judged.** Fixes named in loops 1 to 4 were made before loop 5 ran; loop 5 checked them. The fixes for loop 5's findings were made after it.

## What was reviewed

**In scope.** The branch `claude/project-thread-j3beh9` from `main` at `723606a` (PR 2 merged), OSE-2214 PR 3 (Part of OSE-2214).

- `src/lib/shared-report.ts`: `materializeAnonIdReturns` removed; the scan roll-up writes `distinct_agent_hashes` 0 and clears any `scan_node_returns.anonymous_id` / `user_agent_hash` an older Worker writes.
- `src/handlers/shared-report-materialize.ts`: four phases, no returns phase.
- `src/lib/shared-report-export.ts`, `src/handlers/shared-report-export.ts`: the returns export (phase 1, `corridor_returns_export`) removed; two phases remain.
- `migrations/0119_clear_phone_ids.sql`: deletes every `anon_id_returns` row; nulls `scan_node_returns.anonymous_id`, `user_agent_hash` and `scan_aggregates.distinct_agent_hashes`. Schema guard 119. ROLLBACK_PLAN and PRODUCTION-MIGRATION-PLAN entries.
- Tests: rewritten materialize, export, trace, scan-node-key and return-count specs; six export guards ported to the remaining phases; three architecture ratchets lose stale exemptions; the plan test covers 0119.
- Docs: retirement notes in the pipeline, export, anonymous-id and privacy docs, the deployment runbook, CONSTRAINTS, CONFORMANCE, READ-API, ROLE-STATE; CI pepper comment.

**Out of scope.** PR 4 amends ADR-001, ADR-011, ADR-017, ADR-024, ADR-029, AGENTS invariant 4 and brain #1 and #7 (governance, owner review). Dropping the `anon_id_returns` table (a later migration) and the BigQuery table (owner).

## Loop 1

Team: role-data-scientist
Critical layer: True: nothing in `src/` reads the cleared columns to publish or export a figure; the report reads `poster_attribution`. Assumed: that the deploy window cannot bring ids back; it could, from an older Worker.
Findings: L1-01 to L1-03.
Score: 94%

## Loop 2

Team: role-qa-automation
Conservative layer: Assume the tests pass by accident. Deleted phase-1 tests were returns-only or ported; the manifest was stale; nothing on staging checks the ids are gone.
Findings: L2-01 to L2-05.
Score: 86%

## Loop 3

Team: dr-of-security
Adversarial layer: No Security Critical. The rollback text was too broad: a Worker from before PR 1 stores ids again. No foreign key or schema-drift hazard in 0119.
Findings: L3-01 to L3-04.
Score: 89%

## Loop 4

Team: role-product-owner
Compliance layer: Scope is clean (no governance file). OSE-2213 is moot; the BigQuery table still holds the old weekly return counts and nobody has decided its fate.
Findings: L4-01 to L4-05.
Score: 80%

## Loop 5

Team: role-qa-automation
Recursive layer: Checked every "fixed" claim with line evidence; repo-wide grep for removed symbols found only retirement comments; `tsc` clean.
Findings: L5-01 to L5-03.
Score: 91%

## Findings register

Weights: Security Critical 15 (no partial credit), Critical 15, High 10, Medium 5, Low 2.

| #     | Finding                                                                              | Severity | From   | Evidence                                           | Status                                                                                 |
| ----- | ------------------------------------------------------------------------------------ | -------- | ------ | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| L1-01 | An older Worker can write ids after 0119 and nothing clears them                     | Low      | Loop 1 | `shared-report.ts` roll-up                         | fixed: roll-up self-clear; test seen red                                               |
| L1-02 | `room-burst.mjs` still counts `DISTINCT anonymous_id`                                | Low      | Loop 1 | `scripts/ci/room-burst.mjs:284`                    | open: accepted, it now reads 0, which is itself a check                                |
| L1-03 | Historic BigQuery return rows remain                                                 | Low      | Loop 1 | BigQuery                                           | withdrawn: raised as L4-02                                                             |
| L2-01 | Triage manifest stale                                                                | Medium   | Loop 2 | `triage-vitest-pool.mjs --check`                   | fixed: regenerated, `--check` passes                                                   |
| L2-02 | No staging-layer check that the ids are gone                                         | Medium   | Loop 2 | Bruno, Playwright                                  | open: the columns are not visible through the API; the plan's post-deploy query checks |
| L2-03 | Stale text (CI pepper comment, smoke fixture, dead result fields)                    | Low      | Loop 2 | `oursharedevents-ci.yml`, fixture, export type     | fixed                                                                                  |
| L2-04 | Export-grain floor lowered 8 to 6                                                    | Low      | Loop 2 | `export-grain.invariant.spec.ts`                   | closed: measured exactly 6, so no slack                                                |
| L2-05 | 0119 idempotence unproven                                                            | Low      | Loop 2 | `scan-node-key.spec.ts`                            | fixed: statements run twice                                                            |
| L3-01 | ROLLBACK_PLAN called any Worker revert safe                                          | Medium   | Loop 3 | `ROLLBACK_PLAN.md`                                 | fixed: no further back than `d266016`                                                  |
| L3-02 | Vote-code KV marker falls back to the cookie value without the pepper                | Low      | Loop 3 | `qr-scan.ts:211`                                   | open: on `main` before this change; comment corrected                                  |
| L3-03 | No gate stops a future exporter selecting a phone column                             | Low      | Loop 3 | architecture specs                                 | open: null binding and nightly self-clear hold today                                   |
| L3-04 | 0119 run time on large tables not measured                                           | Low      | Loop 3 | migration                                          | open: fails closed before deploy; production has no scans                              |
| L4-01 | OSE-2213 moot; CONSTRAINTS lists the export as live                                  | High     | Loop 4 | `CONSTRAINTS.md:16`                                | fixed: CONSTRAINTS updated; Linear comment on OSE-2213                                 |
| L4-02 | Nobody has decided the fate of BigQuery `corridor_returns_export`                    | High     | Loop 4 | `SHARED-REPORT-BIGQUERY-EXPORT.md`                 | open: owner decision (destructive data step)                                           |
| L4-03 | Docs still describe the return rate or the returns job as live                       | Medium   | Loop 4 | DATA-PIPELINE, READ-API                            | fixed (PRICING-PLAN:102 rides on the open Mid question from PR 2)                      |
| L4-04 | DoD evidence: testing ticket and role lines                                          | Medium   | Loop 4 | PR body, ROLE-STATE                                | fixed: PR names OSE-2220; ROLE-STATE line                                              |
| L4-05 | Deploy order for 0119 stated, not enforced                                           | Low      | Loop 4 | CI                                                 | open: accepted, CI applies migrations before deploy                                    |
| L5-01 | `scan-node-key.ts` header described the retired reader as live                       | Medium   | Loop 5 | `scan-node-key.ts:21-42`                           | fixed: past tense                                                                      |
| L5-02 | Test helper still maps the retired table                                             | Low      | Loop 5 | `tests/helpers/bigquery-pool-schema.ts:23`         | fixed: comment, intended while the table exists                                        |
| L5-03 | Live-tense `anon_id_returns` prose deeper in the pipeline doc, seed fixture comments | Low      | Loop 5 | DATA-PIPELINE, `bruno/fixtures/campaigns-seed.sql` | open: accepted, the doc carries a dated banner                                         |

## Solutioning

Fixed: L1-01, L2-01, L2-03, L2-05, L3-01, L4-01, L4-03, L4-04, L5-01, L5-02. Closed: L2-04. Withdrawn: L1-03.

Arithmetic: all findings raised, less the withdrawn one: High 2 × 10 + Medium 6 × 5 + Low 11 × 2 = 72, so the cumulative score is 100 − 72 = 28%. Open: High 1 × 10 + Medium 1 × 5 + Low 6 × 2 = 27, so 100 − 27 = 73%. The owner's answer closes L4-02 (10), leaving 17 points: one staging-layer gap and six Low items, pre-existing or accepted (83%).

## What must be true before shipping

1. The PR's checks are green on its head, including the browser job and this worksheet gate.
2. On staging after merge, T1 applies 0119 and T1 to T4 are green.
3. The owner decides `corridor_returns_export` (L4-02); until then it receives nothing.

## Verification

- **Born red.** On the old source: 16 of the rewritten tests fail (no returns phase, no returns table call, `distinct_agent_hashes` 0, the trace hops, no writer of `anon_id_returns`). The exporter invariant fails on the old exporter. The self-clear test fails with the clear removed. Two ported guards fail on planted faults (staging dataset ignored; a HIPAA row let through).
- **Local runs.** Affected worker specs pass (materialize 35, export 22, scan-node-key 19, trace 20, pipeline invariants 54). Architecture structural specs pass (export-grain, tenant-isolation, timestamp-precision: 53). Root `npm test`: 5,818 passed after the plan update. `tsc` clean; triage `--check` up to date. Full worker suite: see the PR body.
- **After merge.** T1 to T4 green on the merge commit; the plan's post-deploy query reads 0 for ids and return rows.

## Risks accepted

- `anon_id_returns` stays as an empty table until a later migration drops it; erasure and retention still delete from it.
- The vote code's one-hour KV marker can hold the cookie value when the pepper is missing (pre-existing, L3-02).

## Human gate

1. **The BigQuery table `corridor_returns_export` (loop 4, Compliance layer).** It holds the rounded weekly counts of phones seen at more than one event, sent before today. Nothing writes to it now. Drop it, or keep it as history?
   What would close it: the owner's answer on the decision card. Dropping it is an owner step in BigQuery; no agent does it.
