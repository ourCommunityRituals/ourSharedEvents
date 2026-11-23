---
ccr: 1
class: architecture
requested_loops: 5
loops_run: 5
team: base
gate: stop
cumulative_score: 0
system_score: 21
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 3, medium: 5, low: 12 }
---

# CCR: OSE-2214, scans are counted on the code, never the phone (2026-11-23)

Each loop was a separate role agent, given the diff, the owner's rule ("count the traffic on the code, never the person", 2026-11-23) and the earlier loops' findings, and not the author's conclusions. Claude Code wrote the change and this worksheet.

## Verdict

| Item                  | Value                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Classification        | Architecture change (what a scan counts, ADR-024 option C for scans): 5 loops                                                                                                                          |
| Cumulative score      | **0%**. Before solutioning the open weights summed past 100                                                                                                                                            |
| System score          | **21%** for PR 1 alone, by the strict formula. 74 of the 79 points still open are later PRs of the same story (PR 2: 3 High, 2 Medium, 2 Low; PR 3: 1 Low; PR 4: 2 Medium, 1 Low) or already on `main` |
| Assessment confidence | 75%. Source reads, local worker, architecture and Bruno runs. Staging has not seen the change; the Playwright spec was not run here (no browser build)                                                 |
| Gate                  | **Stop. Human gate.** PR 1 is a step of OSE-2214, not the whole story; see the question at the end                                                                                                     |

**Owner answer recorded.** The floor-meaning question (L1-01) was put to the owner on 2026-11-23. Answered 2026-11-23: "Yes, a scan is a scan". A published 5 may be five scans from one phone.

**Deviation, stated so it can be judged.** The protocol changes nothing between loops. Loop 3 read an earlier draft; three of its findings were fixed before loops 4 and 5 ran. The fixes named in loops 4 and 5 were made after loop 5. Each finding names the loop that raised it.

## What was reviewed

**In scope.** The branch `claude/project-thread-j3beh9` from `main` at `d782e7e`, OSE-2214 PR 1 (Part of OSE-2214).

- `src/handlers/qr-scan.ts`. A poster code no longer reads or sets `ose_anon`, keeps no KV marker and reads no User-Agent. Every scan counts, up to 100 per poster per hour (OSE-1496). The room's vote code keeps the cookie, its one-hour keyed marker and its pass (ADR-040).
- `src/lib/scan-buffer.ts`. `scan_node_returns.anonymous_id` and `user_agent_hash` are always bound NULL, whatever a queued message carries. The consumer no longer releases a marker.
- `src/templates/shared-report.html`, `src/handlers/demo.ts`, `src/lib/demo-registry.ts`. The figure reads "Scans", not "Distinct scanners", and the demo no longer says "counted once each". The API key `distinct_scanners` is kept until PR 2.
- `src/lib/shared-report.ts`: comments only.
- Tests: 15 worker specs, the `credential-emission` exemption and the `anonymity-gate` allowance rewritten to the new rule; TL-078 in the threat ledger; a new Bruno case, S26 76; Bruno pages `GET -sharedReport` and Playwright `report-counts-journey` read "Scans".
- Docs: `docs/brain/ROLE-STATE.md`, `docs/brain/CONSTRAINTS.md`, `docs/features/VISION.md` (the sponsor sentence).

**Out of scope.** Later PRs of the same story: PR 2 retires `distinct_scanners`, `return_rate`, the returns export and the nightly returns job, and marks a capped hour; PR 3 clears stored ids; PR 4 amends ADR-001, ADR-024, AGENTS invariant 4 and brain #1 and #7 (governance, owner review). The forms side is a separate owner decision.

## Loop 1

Team: role-backend-architect
Critical layer: What is true versus assumed. True: the old scan path recognised a phone three ways (the cookie, the keyed id `snk1_` kept 365 days and the same at every event, the browser-name hash fallback). The change removes all three for a poster code. Assumed: that nothing else reads `scan_node_returns.anonymous_id` for a published figure; only the nightly returns job and erasure do. The floor now means 5 scans, not 5 phones.
Findings: L1-01 to L1-05.
Score: 81%

## Loop 2

Team: role-data-scientist
Conservative layer: Assume the worst reader and the worst day. Every published number still carries people-words in its field name and notes; a capped hour reads as exactly 100; baselines over 30 and 90 days mix the old per-phone rows with the new per-scan rows; one person can now reach the floor alone, though the cap holds.
Findings: L2-01 to L2-06.
Score: 63%

## Loop 3

Team: dr-of-security
Adversarial layer: Can it be broken, and can the tests fail? No poster path reads the cookie or the User-Agent or stores a per-phone value, including messages queued by an older Worker. The report still said "Distinct Scanners" over a scan count, and two test names no longer said what they tested. The vote code's pass, dedup and cookie are unchanged apart from its rows now storing NULL.
Findings: L3-01 to L3-09.
Score: 60%

## Loop 4

Team: role-product-owner
Compliance layer: Do the written rules agree? AGENTS invariant 1 is served better. Invariant 4 still holds (the vote code is on `/q`) but reads as if every scan sets a cookie. Sponsor-facing text (the demo sub-label, the feature vision) still promised "counted once". CONSTRAINTS, TL-078 and a ROLE-STATE note described the old path. ADR-001, ADR-024 and the brain describe a system that no longer exists for scans.
Findings: L4-01 to L4-10.
Score: 51%

## Loop 5

Team: role-qa-automation
Recursive layer: Was this assessment honest, and can each test fail? No staging test scans twice and sees two counted. Some label assertions were case-sensitive and passed on the old wording; one scan-buffer test pinned a marker nobody now writes. The vote path is covered on the mock layer only. `return_rate` now has no source at all, not a thin one.
Findings: L5-01 to L5-09.
Score: 64%

## Findings register

Weights: Security Critical 15 (no partial credit), Critical 15, High 10, Medium 5, Low 2.

| #     | Finding                                                                                    | Severity | From                      | Evidence                                                     | Status                                                            |
| ----- | ------------------------------------------------------------------------------------------ | -------- | ------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| L1-01 | The under-5 floor now means 5 scans; one phone scanning 5 times publishes a 5              | High     | Loop 1                    | `qr-scan.ts`; `readPosterAttribution` floors per poster-hour | closed: owner answered 2026-11-23, "Yes, a scan is a scan"        |
| L1-02 | Demo sub-label "anonymous, counted once each"                                              | Medium   | Loop 1                    | `demo.ts:428`                                                | fixed: "every scan of your codes"; `demo-site.spec.ts` asserts it |
| L1-03 | `return_rate` and the returns export lose their source and read as withheld, not retired   | Medium   | Loop 1                    | `shared-report.ts:273`, `shared-report-builder.ts:651`       | open: PR 2 retires them                                           |
| L1-04 | `scan_aggregates.distinct_agent_hashes` is 0 for new scans                                 | Low      | Loop 1                    | `scan-node-returns-one-per-browser-hour.spec.ts`             | open: PR 2                                                        |
| L1-05 | A cap place is taken even when the write then fails                                        | Low      | Loop 1                    | `qr-scan.ts`, `poster-hour-cap.ts`                           | open: accepted, errs low                                          |
| L2-01 | `distinct_scanners`, its suppression note and builder comments still say people            | High     | Loop 2                    | `shared-report-builder.ts`                                   | open: PR 2                                                        |
| L2-02 | A capped hour reads as exactly 100, with no "or more" marker on the report or exports      | High     | Loop 2                    | `shared-report.html`, exports                                | open: PR 2                                                        |
| L2-03 | 30 and 90 day baselines mix per-phone and per-scan rows across the deploy                  | Medium   | Loop 2                    | `shared-report-builder.ts` baselines                         | open: PR 2 dates the change                                       |
| L2-04 | The `return_rate` note is untrue after the deploy                                          | Medium   | Loop 2                    | `shared-report-builder.ts`                                   | withdrawn: folded into L1-03                                      |
| L2-05 | Inflating a count is cheaper: one phone can reach the floor                                | Medium   | Loop 2                    | `poster-hour-cap.ts:49-63`                                   | closed: owner's ruling, the cap of 100 per poster per hour holds  |
| L2-06 | A sub-floor probe by differencing hours                                                    | Low      | Loop 2, already on `main` | `count-floor.ts`                                             | open: its own story                                               |
| L3-01 | The report said "Distinct Scanners" over a scan count                                      | High     | Loop 3                    | `shared-report.html:1192,1211,1364`, `demo.ts`               | fixed: reads "Scans"                                              |
| L3-02 | Floor meaning                                                                              | High     | Loop 3                    | as L1-01                                                     | withdrawn: same as L1-01                                          |
| L3-03 | `return_rate` degrades                                                                     | Medium   | Loop 3                    | as L1-03                                                     | withdrawn: same as L1-03                                          |
| L3-04 | Cheaper inflation                                                                          | Medium   | Loop 3                    | as L2-05                                                     | withdrawn: same as L2-05                                          |
| L3-05 | A `qr-scan.spec.ts` comment still described releasing a marker                             | Low      | Loop 3                    | `qr-scan.spec.ts`                                            | fixed                                                             |
| L3-06 | The Bruno case name said "counts the scan" but checks redirect and cookie                  | Low      | Loop 3                    | S26 76                                                       | fixed: renamed                                                    |
| L3-07 | Vote-code rows now store NULL and the consumer releases no marker on dead-letter           | Low      | Loop 3                    | `scan-buffer.ts`                                             | open: accepted, the marker expires with its hour                  |
| L3-08 | `cookie-setters` counts per file, so it cannot tell a poster code from the vote code       | Low      | Loop 3, already on `main` | `cookie-setters.invariant.spec.ts:49`                        | open: the worker specs hold it                                    |
| L3-09 | The per-caller limit reads `CF-Connecting-IP`, against invariant 3                         | Low      | Loop 3, already on `main` | `public-read-limit.ts:85-88`                                 | open: its own story                                               |
| L4-01 | CONSTRAINTS said a poster scan sets `ose_anon`                                             | High     | Loop 4                    | `CONSTRAINTS.md:33`                                          | fixed                                                             |
| L4-02 | Demo "counted once each"                                                                   | High     | Loop 4                    | as L1-02                                                     | withdrawn: same as L1-02                                          |
| L4-03 | Feature vision told sponsors repeat scans count once an hour                               | High     | Loop 4                    | `docs/features/VISION.md:36`                                 | fixed                                                             |
| L4-04 | REPORT-DEPTH still records "distinct scanners" as the lexicon                              | Low      | Loop 4                    | `REPORT-DEPTH.md:258,266`                                    | open: PR 2, with the field                                        |
| L4-05 | AGENTS invariant 4 reads as if every `/q` scan sets a cookie                               | Medium   | Loop 4                    | `AGENTS.md`                                                  | open: PR 4, 5-loop CCR and owner review                           |
| L4-06 | ADR-001, ADR-024, brain #1 and #7, PRIVACY, ANONYMOUS-ID and QR docs describe the old path | Medium   | Loop 4                    | `docs/adr/`, OCR-docs brain                                  | open: PR 4                                                        |
| L4-07 | TL-078 described a hash fallback that no longer exists                                     | Medium   | Loop 4                    | `threat-ledger.ts:1652`                                      | fixed: text and test_ref                                          |
| L4-08 | PRIVACY retention text still names the 365-day id                                          | Low      | Loop 4                    | `docs/PRIVACY*`                                              | open: PR 3 and 4                                                  |
| L4-09 | The label says Scans while the field says scanners                                         | Low      | Loop 4                    | as L2-01                                                     | withdrawn: same as L2-01                                          |
| L4-10 | A ROLE-STATE note said "no change at `/q` now"                                             | Low      | Loop 4                    | `ROLE-STATE.md:235`                                          | fixed: dated note added                                           |
| L5-01 | No staging test scans twice and sees two counted                                           | High     | Loop 5                    | `bruno/ose-api/26.*`                                         | open: PR 2 adds it with the scan figure                           |
| L5-02 | Label assertions were case-sensitive and passed on the old wording                         | Medium   | Loop 5                    | mobile-workability, demo-site, Playwright                    | fixed: case-insensitive                                           |
| L5-03 | A scan-buffer test pinned a marker nobody writes                                           | Medium   | Loop 5                    | `scan-buffer.spec.ts`                                        | fixed: asserts the consumer touches no KV                         |
| L5-04 | The vote path has mock-layer coverage only                                                 | Medium   | Loop 5                    | `vote-pass.spec.ts`                                          | open: VOTING_ENABLED is off everywhere                            |
| L5-05 | Stale names ("101 different visitors", "one row per browser")                              | Low      | Loop 5                    | two specs                                                    | fixed: renamed                                                    |
| L5-06 | A fragile shared flow in the trace spec                                                    | Low      | Loop 5                    | `scan-to-export-trace.spec.ts`                               | open                                                              |
| L5-07 | Ids stored before this change stay (365-day retention)                                     | Low      | Loop 5                    | `scan-returns-retention.ts`                                  | open: PR 3                                                        |
| L5-08 | Playwright `report-counts-journey` was edited and not run here                             | Low      | Loop 5                    | local log                                                    | open: closes when the PR's browser job is green                   |
| L5-09 | Staging has not seen the change                                                            | Low      | Loop 5                    | local vetting                                                | open: closes with T2 on the merge commit                          |

## Solutioning

Fixed: L1-02, L3-01, L3-05, L3-06, L4-01, L4-03, L4-07, L4-10, L5-02, L5-03, L5-05. Closed by the owner's answers: L1-01, L2-05. Withdrawn as duplicates: L2-04, L3-02, L3-03, L3-04, L4-02, L4-09.

Arithmetic: open High 3 × 10 + Medium 5 × 5 + Low 12 × 2 = 79, so 100 − 79 = 21%. PR 2 closes L1-03, L1-04, L2-01, L2-02, L2-03, L4-04, L5-01 (49 points); PR 3 closes L5-07 and part of L4-08; PR 4 closes L4-05, L4-06, L4-08 (12 points). L5-08 and L5-09 close on green checks and staging (4 points). What then remains is pre-existing or accepted: L1-05, L2-06, L3-07, L3-08, L3-09, L5-04, L5-06 (5 × 2 + 5 + 2 = 17 → 83%), each with its own story or reason.

## What must be true before shipping

1. The PR's checks are green on its head, including the browser job and the worksheet gate.
2. PR 2 follows soon, so `return_rate` does not sit withheld and a capped hour gets its marker.
3. The owner reviews PR 4 (governance).

## Verification

- **Born red.** On `main`'s `qr-scan.ts` and `scan-buffer.ts`, 17 of the new or rewritten worker tests fail: no `Set-Cookie`, 3 rows for 3 scans, KV untouched, NULL ids and hashes, and the routed path. On this branch they pass. Moving the `credential-emission` exemption to a name the detector does not see fails the gate ("stale exemption"), so it can fail.
- **Worker specs touching the scan path.** 67 files ran locally: all pass after the rewrite. The full worker suite and the root `tests/integration` (1,664 passed, 4 skipped) were also run.
- **Architecture specs** (`tests/e2e/0-architecture`): 431 passed. The only failures were 32 tests that need a browser build that is not in this container.
- **Local vetting.** Bruno T2 api: 2,570 checks passed, including S26 76. T2 pages: 671 passed.
- **After merge.** T1 to T4 green on the merge commit. T2 runs S26 76 on staging.

## Risks accepted

- The vote code keeps the cookie (ADR-040). It is a separate owner decision.
- `distinct_scanners` keeps its API name until PR 2, for old readers.

## Human gate

1. **Merge PR 1 as a step (loop 2 and 5, Conservative and Recursive layers).** Until PR 2 lands, `return_rate` reads as withheld and a capped hour reads as exactly 100. Is that acceptable for the days between PR 1 and PR 2, or should PR 1 wait and ship with PR 2?
   What would close it: the owner's merge of PR 1, or a request to combine.
