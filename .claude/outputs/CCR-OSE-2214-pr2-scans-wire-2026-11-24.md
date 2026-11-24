---
ccr: 1
class: architecture
requested_loops: 5
loops_run: 5
team: base
gate: stop
cumulative_score: 33
system_score: 72
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 1, medium: 2, low: 4 }
---

# CCR: OSE-2214 PR 2, the report publishes scans of the code (2026-11-24)

Each loop was a separate role agent, given the diff, the owner's rule ("count the traffic on the code, never the person", 2026-11-23) and the earlier loops' findings, and not the author's conclusions. Claude Code wrote the change and this worksheet.

## Verdict

| Item                  | Value                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification        | Architecture change (a breaking change to the SharedReport contract, 4.0.0): 5 loops                                                                          |
| Cumulative score      | **33%**: 100 less every finding raised (67 points), before solutioning                                                                                        |
| System score          | **72%**. Of the 28 points open, 15 are later steps of the same story (PR 3: L3-01; PR 4: L4-03), 10 wait on the owner (L4-01) and 3 are pre-existing or noted |
| Assessment confidence | 80%. Source reads, local worker, node, architecture and root runs, born red on the new specs. Staging has not seen the change                                 |
| Gate                  | **Stop. Human gate.** One owner question is open (L4-01); see the end                                                                                         |

**Deviation, stated so it can be judged.** Fixes named in loops 1 to 4 were made before loop 5 ran; loop 5 checked them. The fixes for loop 5's findings were made after it.

## What was reviewed

**In scope.** The branch `claude/project-thread-j3beh9` from `main` at `d266016` (PR 1 merged), OSE-2214 PR 2 (Part of OSE-2214).

- `src/lib/shared-report-builder.ts`: `distinct_scanners` becomes `scans`, `headcount_trend` becomes `scan_trend`; `return_rate` is removed; poster rows carry `hour_cap_reached`; the report and each trend instance carry `scans_at_least`.
- `src/lib/report-depth.ts`, `src/api-schema-snapshots/shared-report.snapshot.json` (4.0.0), `src/templates/shared-report.html` (" or more"), `src/handlers/demo.ts` (scans wording, no return-rate card).
- Tests: a new worker spec (`shared-report-scans-on-the-code`), a new floor spec (`shared-report-suppression-floor`, the generic guards moved out of the retired return-rate floor spec), JSDOM render tests, rewritten report specs, an architecture invariant, Bruno S14 82/86/88.
- Docs: SHARED-REPORT-READ-API, REPORT-DEPTH, QR-AND-SHORTLINKS, SCALING-WATCH-ITEMS, SPONSORSHIP-PAGE-SPEC, BEACHHEAD-ICP, PRICING-PLAN, DATA-PIPELINE, ROLE-STATE.

**Out of scope.** PR 3 retires the nightly returns job, the returns export and the stored ids. PR 4 amends ADR-001, ADR-011, ADR-017, ADR-024, ADR-029, AGENTS invariant 4 and brain #1 and #7 (governance, owner review).

## Loop 1

Team: role-data-scientist
Critical layer: What is true versus assumed. True: the figure was always a sum of poster-hour rows (PR #1528), so the rename changes the name, not the number. Assumed: that a capped hour is visible to the reader; it was not, on figures derived from the poster rows.
Findings: L1-01 to L1-05.
Score: 83%

## Loop 2

Team: role-qa-automation
Conservative layer: Assume the tests pass by accident. The "or more" marker was asserted as source text only; spec lists still named deleted files; the deleted specs may have held guards for other fields.
Findings: L2-01 to L2-05.
Score: 70%

## Loop 3

Team: dr-of-security
Adversarial layer: No Security Critical. The cap flag says only that one poster reached 100 scans in an hour, which the scan count already shows. The return figures are still computed nightly and exported until PR 3.
Findings: L3-01, L3-02.
Score: 61%

## Loop 4

Team: role-product-owner
Compliance layer: The pricing plan bills the Mid tier on `return_rate`, which no longer exists; sales docs and ADRs still promise it.
Findings: L4-01 to L4-05.
Score: 41%

## Loop 5

Team: role-qa-automation
Recursive layer: Checked every "fixed" claim against the source with line evidence; read both deleted specs; grepped the repo for live references. The deleted floor spec held four guards not about the return rate, now uncovered.
Findings: L5-01 to L5-04.
Score: 58%

## Findings register

Weights: Security Critical 15 (no partial credit), Critical 15, High 10, Medium 5, Low 2.

| #     | Finding                                                                                     | Severity | From   | Evidence                                                   | Status                                                                                    |
| ----- | ------------------------------------------------------------------------------------------- | -------- | ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| L1-01 | "Or more" shown on poster rows only, not on the scans card, corridor count or trend         | Medium   | Loop 1 | `shared-report.html`                                       | fixed: `scans_at_least`; `shared-report.html:1172,1198,1218,1225`                         |
| L1-02 | Headcount wording on the page and demo                                                      | Medium   | Loop 1 | `shared-report.html`, `demo.ts`                            | fixed: "Scan Trend", "scans"                                                              |
| L1-03 | Test titles say people; testid `signed-link-distinct-scanners`                              | Low      | Loop 1 | specs                                                      | fixed: titles; testid kept, generated test ids gate CI                                    |
| L1-04 | Feature docs describe `distinct_scanners` and `return_rate`                                 | Low      | Loop 1 | `docs/features/`                                           | fixed                                                                                     |
| L1-05 | No positive assertion on `scans`                                                            | Low      | Loop 1 | Bruno S14 82, snapshot                                     | closed: Bruno S14 82 asserts `scans`; the snapshot lists it                               |
| L2-01 | Node spec list and shard durations name deleted specs                                       | Low      | Loop 2 | `vitest.node-specs.mjs`                                    | fixed                                                                                     |
| L2-02 | Triage manifest does not route the new spec                                                 | Medium   | Loop 2 | `docs/testing/vitest-pool-triage.json`                     | withdrawn: regenerated, `--check` passes                                                  |
| L2-03 | "Or more" asserted as source text only                                                      | Medium   | Loop 2 | `sharedReport-signed-link-ui.spec.ts`                      | fixed: JSDOM render tests, `shared-report-locked-sections.spec.ts:539-570`, seen red      |
| L2-04 | The new invariant can be evaded by grep tricks                                              | Low      | Loop 2 | `aggregate-only.invariant.spec.ts`                         | open: accepted, the worker specs hold the behaviour                                       |
| L2-05 | Deleted specs may have held guards for other fields                                         | Low      | Loop 2 | deleted specs                                              | withdrawn: confirmed and raised as L5-01                                                  |
| L3-01 | The nightly returns job and the BigQuery returns export still run                           | Medium   | Loop 3 | `shared-report.ts`, `shared-report-export.ts`              | open: PR 3                                                                                |
| L3-02 | A withheld trend instance shows a bare dash                                                 | Low      | Loop 3 | `shared-report.html`                                       | open: on `main` before this change                                                        |
| L4-01 | PRICING-PLAN bills Mid on `return_rate`                                                     | High     | Loop 4 | `docs/positioning/PRICING-PLAN.md`                         | open: rewritten to the recommended option (live map + poster breakdown), owner to confirm |
| L4-02 | Sales docs promise the return rate                                                          | Medium   | Loop 4 | BEACHHEAD-ICP, SPONSORSHIP-PAGE-SPEC                       | fixed                                                                                     |
| L4-03 | ADR-011 and ADR-029 describe the return rate                                                | Medium   | Loop 4 | `docs/adr/`                                                | open: PR 4                                                                                |
| L4-04 | ROLE-STATE does not record PR 2                                                             | Low      | Loop 4 | `docs/brain/ROLE-STATE.md`                                 | fixed                                                                                     |
| L4-05 | No CI/CD testing ticket                                                                     | Low      | Loop 4 | Linear                                                     | fixed: OSE-2220                                                                           |
| L5-01 | Four floor guards (detail prints no count, one launch-day map line, sponsor rows) were lost | Medium   | Loop 5 | `git show HEAD:…-return-rate-floor.spec.ts:364-560`        | fixed: `shared-report-suppression-floor.spec.ts`, 6 tests; seen red on a planted count    |
| L5-02 | DATA-PIPELINE still documents `return_rate_pct`                                             | Low      | Loop 5 | `SHARED-REPORT-DATA-PIPELINE.md:218`                       | fixed: dated retirement note                                                              |
| L5-03 | Migration comments say `headcount_trend`                                                    | Low      | Loop 5 | `migrations/0033`, `0034`                                  | open: applied migrations are not edited                                                   |
| L5-04 | Some fixtures still feed `return_rate`                                                      | Low      | Loop 5 | `shared-report-attribute-escaping.spec.ts:282,403`, others | open: accepted, harmless; read-depth-wiring asserts its absence                           |

## Solutioning

Fixed: L1-01, L1-02, L1-03, L1-04, L2-01, L2-03, L4-02, L4-04, L4-05, L5-01, L5-02. Closed: L1-05. Withdrawn: L2-02, L2-05.

Arithmetic: all findings raised, less the withdrawn ones: High 1 × 10 + Medium 7 × 5 + Low 11 × 2 = 67, so the cumulative score is 100 − 67 = 33%. Open: High 1 × 10 + Medium 2 × 5 + Low 4 × 2 = 28, so 100 − 28 = 72%. The owner's answer closes L4-01 (10), PR 3 closes L3-01 (5) and PR 4 closes L4-03 (5), leaving 8 points pre-existing or accepted (92%).

## What must be true before shipping

1. The PR's checks are green on its head, including the browser job and this worksheet gate.
2. Readers of the SharedReport API know it is 4.0.0: `return_rate` and `distinct_scanners` are gone.
3. The owner confirms the Mid tier (L4-01).

## Verification

- **Born red.** The new worker spec fails on `main`'s builder (`distinct_scanners`, `return_rate` present, no `hour_cap_reached`). The JSDOM test fails with the marker blanked. The floor spec fails 2 of 6 with a count planted in a suppression detail. The new architecture invariant fails on `main`'s builder.
- **Local runs on the final tree.** Report specs (workers pool): 117 passed. Node report specs: 75 passed. Floor spec: 6 passed. Architecture (aggregate-only, tenant-isolation): 31 passed. Root `npm test`: 5,818 passed. `tsc` clean, prettier clean, triage `--check` up to date. Full worker suite: see the PR body.
- **After merge.** T1 to T4 green on the merge commit; Bruno S14 82/86/88 run on staging.

## Risks accepted

- The testid `signed-link-distinct-scanners` keeps its name: generated test ids gate CI.
- The return figures are still computed and exported until PR 3.

## Human gate

1. **The Mid tier (loop 4, Compliance layer).** PRICING-PLAN now sells Mid as the live map plus the poster breakdown by hour, billed from the first live map with published scans. Is that the tier?
   What would close it: the owner's answer on the decision card.
