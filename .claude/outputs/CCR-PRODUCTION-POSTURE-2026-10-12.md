# CCR: production posture and launch readiness (held, not live)

Date: 2026-10-12. Three loops, extended scrum team plus Sr Data Scientist and Dr of Security.
Protocol: `.claude/skills/ccr-protocol.md` (v3). Loops were run in order; findings from each loop
changed what the next one checked.

## Verdict

|                                  |                                                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System score**                 | **29%** (fails the 95% bar)                                                                                                                                                                                                  |
| **Assessment confidence**        | **70%**, falling across the loops (80, 72, 70) on one point: the live state of production was not read (see loop 3)                                                                                                          |
| **Security Critical unresolved** | none found. No floor-at-zero applies                                                                                                                                                                                         |
| **Gate result**                  | **Hold safely: yes, conditionally. Ready to activate: no**                                                                                                                                                                   |
| **Governance content**           | **not cleared.** `AGENTS.md` is a governance artifact and needs 5+ loops with a human gate every loop; this run is 3 and does not clear it. The "Production posture" text and the ticket-per-change rule stay with the owner |

**One-line answer.** The posture is a sound way to hold: the gates that exist are real and pass, and nothing
sensitive is in production to expose. It is not ready to activate: the rollback window promises something
the first deploy cannot deliver, the "distinct" count is mislabelled, and four of the activation gates are
unread or unrun.

## Reviewed

In scope: `AGENTS.md` "Production posture" and the ticket-per-change rule; `ROLLBACK.md` §0 and
`STAGING-DRILL.md`; `scripts/ci/env-parity.mjs` and its strict-when-live CI step; the Launch sequence
milestone Part 1; the M0 changes landed this session (`distinct_scanners`, `sponsor_displays`,
`return_count`, scan-split timestamps and dedup, the forms-database lexicon gate).

Out of scope: the front-end surfaces, the OW product, and the contents of every other PR.

How findings are marked: **[proven]** a command or run output cited; **[source]** read from code or docs,
not exercised; **[inferred]** reasoned, not measured.

## Team

PO; Lead BE Architect; Lead FE Integration; Sr Design FE; Sr Automation QA; Sr SDET/SRE; DevOps Mgr;
**Sr Data Scientist**; **Dr of Security** (always).

## Loop 1: surface pass

**Critical (most dangerous assumption).** That the controls written down are the controls that run.
Checked against the files.

- PO: the posture, the exit condition and the ticket rule are in `AGENTS.md`; the Launch milestone has an
  honest scoreboard. [source]
- Lead BE: `REQUIRED_DB_MIGRATION = 103`; the preflight passes 5 of 5; `env-parity` has 0 unlisted
  differences and 3 undecided. [proven: both run 2026-10-12]
- Sr SDET/SRE: the staging chain was green for every merge SHA this session (T1 to T4). [proven: runs
  38186573387, 38188953061, 38192777423, 38201251925, 38210939728, 38273346167]
- DevOps: the production deploy job has the ancestry guard (#896), the secrets presence gate, the canonical
  shape gate and the zero-unapplied-migrations gate. [source]
- Dr of Security: production has no `ADMIN_KEY`, `X_OCR_INTERNAL` or `ADMIN_TOKEN`; the deploy refuses if one
  is set. [source]

**Conservative (worst case).** A bad production deploy, or a go-live with an open difference.

- **A1 (High).** `ROLLBACK.md` §0 says inside the window a no-go "rolls back". §2 of the same file says a
  migration that **removed or renamed** something the old code reads makes going back impossible. The first
  production deploy carries exactly those: `0098` drops `subscribers`, `0102` rebuilds
  `sponsor_impressions` as `sponsor_displays`, `0103` renames `visit_count`. Rolling the Worker back one
  version puts the old code on a database where its table and column no longer exist. Section 0 does not
  say so. [source: migrations 0098, 0102, 0103; ROLLBACK.md §2]
- **A2 (High).** The staging drill has not been run. Every rollback and restore command is unexercised, and
  the runbooks say so. [source]
- **A3 (Medium).** Production's migration level is **assumed**: last read 77 on 2026-10-01 and not re-read.
  The plan says 26 files, 12 of them row-changing. [source]
- **A4 (Medium).** The parity gate reads configuration only. The databases' migration levels are not
  compared in CI. [source: `env-parity.mjs` header says so]
- **A5 (Medium).** `CF_ACCESS_AUD` is empty in both environments, so the audience pin is dark: any Access
  app in the team can sign a token that passes signature checks. The preflight reports this as a **note on
  a PASS**, so the check cannot fail on it. The email allowlist is the remaining guard. [proven:
  `admin.ts:176-185`; `wrangler.toml`; preflight output]

**Recursive.** Score 100 − (10 + 10 + 5 + 5 + 5) = **65**. Confidence 80%.

## Loop 2: pressure pass

Aimed at what loop 1 could not see: the numbers themselves, and the window's mechanics.

- **Sr Data Scientist.**
  - **B1 (High).** `distinct_scanners` is the **sum over hourly buckets of each bucket's distinct count**
    (`shared-report-builder.ts:321-323`, summing `scan_aggregates.distinct_agent_hashes`). A browser that
    scans in two hours is counted twice, so a multi-hour event overstates "distinct scanners". The label
    was chosen this session and claims a deduplication the number does not do. [source; arithmetic
    confirmed by the formula, not by data]
  - **B2 (Medium).** The per-bucket K=5 floor drops an hour with fewer than 5 browsers **before** the sum.
    At the scale of the first venues, most hours may be under 5, so a report could show nothing for a
    real 30-person event. This is the designed privacy floor, and it may be under-delivering utility.
    [inferred; not measured on real traffic]
  - **B3 (Low).** After migration 0101, `total_scans` (one row per browser-hour) and the sum of distinct
    counts are the same number for keyed scans. Two fields now carry one figure. [source]
  - **B4 (Low).** `return_count` counts nightly runs, not returns; the name follows the lexicon but the
    meaning does not. Disclosed in the migration and the PR. [source]
- **Dr of Security.** Does each gate actually fail?
  - The strict-when-live parity step does fail on today's 3 items. [proven: strict exit 1]
  - **B5 (Medium).** The ticket-per-change rule is text. The close-guard enforces that a PR _names_ a
    ticket, not that a production change has _evidence_ on it. As a gate it is partial. [source]
  - The privacy changes of this session each have a test that went red on the old behaviour (join,
    dedup, forms-database lexicon, payload keys). [proven: each PR body]
- **Sr Automation QA / SDET.**
  - **B6 (Medium).** The window's second end condition, "the first real visitor write", has no signal an
    operator can read. The 60-minute length is a proposal the owner has not set. [source]
- **DevOps.** The strict step turns red only after the owner sets the variable, so it is a tripwire, not a
  prevention. Disclosed in the PR. [source]
- **Lead FE / Sr Design FE.** No finding in scope; no surface changed beyond a label and a column name.

**Reactive correction.** A1 was the finding most worth fixing between loops. A one-paragraph caveat in
`ROLLBACK.md` §0 that points to §2 and lists the release's removing or renaming migrations is in the PR
that carries this worksheet. It is **unresolved until that PR merges**.

**Recursive.** Score 100 − (10 + 10 + 5 + 5 + 5 + 10 + 5 + 2 + 2 + 5 + 5) = **36**. The drop from 65 to 36
is the protocol working: loop 2 found the numbers and the window, which loop 1 had not looked at.
Confidence 72%.

## Loop 3: confirmation pass

Re-checked every loop 1 and 2 finding against the file, and looked for what was assumed.

- A1, A2, A4, A5, B1, B2, B5, B6 **re-confirmed** from the files and outputs cited. No finding withdrawn.
- **C1 (Medium, assumed).** The statement "production is held, not closed: the Worker answers on
  `oursharedevents.com`" rests on a reading from 2026-10-03 (CLAUDE.md) and on OSE-1353's description,
  which says the production host is **challenged by the staging Access app**. Those two do not obviously
  agree, and **I did not read production's current state** this session. The posture text states "held, not
  closed" as fact. It should be a dated reading until re-read. [source, assumed]
- **C2 (Low).** `AGENTS.md` is 12151 of 12288 bytes; the next addition needs a trim. [proven: budget script]
- A3 stands: unread, not wrong.
- The first deploy's migrations ran on staging through the same job and passed there. That lowers the
  chance of a syntax or ordering failure on production. It does not touch A1, which is about code
  compatibility after a rollback. [proven: staging chains above]

**Recursive.** Score 100 − (64 carried + C1 5 + C2 2) = **29**. Down from 36; the fall is the two new
items, not a re-weighting. Confidence 70%.

## Findings register and score

| #   | Finding                                                                                                      | Weight   | Basis    | State                          |
| --- | ------------------------------------------------------------------------------------------------------------ | -------- | -------- | ------------------------------ |
| A1  | Rollback window promises a rollback that the first deploy's renaming and dropping migrations make impossible | High 10  | source   | fix in PR, unmerged            |
| A2  | Staging drill not run; rollback and restore unexercised                                                      | High 10  | source   | open, owner                    |
| B1  | "Distinct scanners" sums hourly distinct counts; a repeat across hours counts twice                          | High 10  | source   | open, needs a name or a method |
| A3  | Production migration level assumed (77, read 2026-10-01)                                                     | Medium 5 | source   | open, owner reads              |
| A4  | Parity gate is config only                                                                                   | Medium 5 | source   | open, by design                |
| A5  | Access audience unpinned; preflight passes with it empty                                                     | Medium 5 | proven   | open, owner                    |
| B2  | Hourly K=5 floor may suppress most of a small event                                                          | Medium 5 | inferred | open, measure                  |
| B5  | Ticket rule is text; close-guard checks the name, not the evidence                                           | Medium 5 | source   | open                           |
| B6  | Window end "first visitor write" has no readable signal; 60 min unratified                                   | Medium 5 | source   | open, owner                    |
| C1  | "Held, not closed" rests on a 2026-10-03 reading and is unconfirmed now                                      | Medium 5 | source   | open, read production          |
| B3  | `total_scans` and the summed distinct count are now one number                                               | Low 2    | source   | open                           |
| B4  | `return_count` counts runs                                                                                   | Low 2    | source   | disclosed                      |
| C2  | `AGENTS.md` has 137 bytes of headroom                                                                        | Low 2    | proven   | open                           |

Arithmetic: 10 + 10 + 10 + 5 × 7 + 2 × 3 = 10 + 10 + 10 + 35 + 6 = **71** → **score 29**.

Loop scores were 65, then 36, then 29.

|                           |         |
| ------------------------- | ------- |
| **System score (final)**  | **29%** |
| **Assessment confidence** | **70%** |

## What must be true before activation

1. A1 fixed and merged; the owner confirms the rollback rule for a release that carries a removing or
   renaming migration is "fix forward".
2. B1 resolved: rename to what the number is (scanner-hours), or count distinct browsers across the event.
3. The staging drill run and recorded (A2).
4. Production read: migration level, secrets present, and whether the host is reachable (A3, C1). The
   preflight does the first two from saved readings.
5. The Access audience pinned and the preflight made to **fail** on an empty one in production (A5).
6. `env-parity --strict` clean: the queue and the audience ruled on.
7. The owner sets the window length (B6).

## Commit sequence

1. This worksheet and the A1 caveat in `ROLLBACK.md` §0 (docs; the PR that carries this file).
2. B1: a naming or method change, with a migration-free relabel as the cheap option; the owner chooses.
3. A5: make the production preflight fail on an empty `CF_ACCESS_AUD` once the audience is available.
4. The production update (owner), then the drill, then re-run this CCR at 5+ loops with the governance
   human gate.

## Verification after shipping

`env-parity --strict` exit 0; preflight full run passes with fresh readings; the drill table filled in;
the report on a multi-hour staging event shows a scanner count that does not exceed the browsers seen.

## Risks accepted

- Holding production with the host possibly reachable (C1), because no event, scan or registration exists
  there to expose. Accepted until production is read.
- `return_count` keeping a name that overstates its meaning (B4), disclosed.

## Human gate

1. **Rollback rule.** For a release that includes a migration that removes or renames something, is the
   answer "fix forward only, no rollback"? (A1)
2. **The count.** "Distinct scanners" or "scanner-hours" for what the report calls distinct (B1)?
3. **The window.** What length, and who confirms the first visitor write (B6)?
4. **Production reachability.** Please read it: is `oursharedevents.com` reachable from the outside right now,
   and through which Access app (C1)?
5. **Governance.** Does the owner want the 5+ loop pass on the `AGENTS.md` posture text before it is
   treated as settled?
