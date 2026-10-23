# CCR: direction for the repo-sync items (Loop 1 of 5+)

Date: 2026-10-21. Team: extended scrum (PO, Scrum Master, Backend Architect, FE Integration with Design FE, QA Automation, SDET/SRE, DevOps, Data Scientist, Dr of Security). Compiled by the main session; each lens ran read-only.

## Verdict

| Item                  | Value                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification        | Governance and architecture direction: 5+ loops, human gate after every loop                                                                                                             |
| Loop reached          | 1 (surface pass)                                                                                                                                                                         |
| System score          | **32%** (100 - 68; arithmetic below). 0% if F2 has no exemption.                                                                                                                         |
| Assessment confidence | **70%**. The dashboard's own rule was not found by any lens, and live branch protection was not read.                                                                                    |
| Gate result           | **Human gate. Stopped.** F2 may be a Security Critical (floor 0%) if no ADR or ticket exempts the `ose_anon` cookie on public surfaces. No lens checked for an exemption, so it is open. |

A CCR score is a signal, never permission.

## Question under review

What is the correct direction for the items a dashboard row flagged for ourSharedEvents (OSE)?

- **Q1** `docs/OCR_VISION.md` (4th governance file): pointer (merged in #1006), full copy, or generated copy.
- **Q2** ADR numbering: OSE series overlaps the OCR-docs fleet series on 001, 002, 006, 009, 010, 011, 012 with different subjects; OSE gaps 003-005, 007, 008, 019.
- **Q3** Pin policy for `.ocr-hub-ref` (bumped to `f9605e3` in #1007).
- **Q4** Is "dashboard row shows nothing off" the right goal?

Terminology hazard: the PO calls `OCR-docs` the hub and `ourCommunityRituals` the spine (`docs/architecture/ECOSYSTEM-LAYERS.md`), but `.ocr-hub-ref` and this session's messages say "hub" for the spine. Read each "hub" by context.

Out of scope: the dashboard's source (not located), Linear state, production, any code change.

## Loop 1

### Critical (what is true versus assumed)

Verified by the main session this loop:

- The T2 failure on `828b2bc2` was `OSE-1242 - events map - refuses coordinate params with 400 (read ECONNRESET)`; it passed on the next run. Earlier text saying "not identified" is superseded.
- `AGENTS.md:5` and `SKILL.md:134,138` cite `OCR-docs/docs/VISION.md`; that file does not exist (`OCR_VISION.md` does).
- `qr-scan.ts:258-259` sets the anonymous cookie on the `/q` redirect for a new visitor. AGENTS.md Invariant 4 says no cookies on public surfaces.
- OSE defines its own `.btn-outline` in `shared-report.html:234,729` and `admin.html:1512`.
- Repo state: clean, `0 0` against origin.

Source-read by lenses, not re-verified: the nightly check never compares the vision hash; no drift or DB-parity check exists; the visual specs run in no workflow; bare ADR cites are ambiguous in about 6 files; "Validate against OCR-docs brain" may not be a required check.

Most dangerous assumption, stated by 6 of 9 lenses: that a quiet dashboard means the repos are in sync. Its checks (file presence, a hash that is never compared) cannot fail.

### Conservative (worst case)

- If the dashboard tests content, not presence, the pointer fails and a copy needs an owner ruling on copies versus pointers.
- If no exemption exists for `ose_anon` on `/q`, the public surface breaks an owner invariant and the committed `.telemetry` audit now records that as neutral fact (my commit in #1006).
- #1007 changed the global `/ui.css`: `.btn-outline` now sets a border on pages that already define their own. No workflow runs the visual specs, so CI could not catch a regression on `shared-report.html`.
- One socket reset fails a required Bruno gate that guards Invariant 3, with no retry.

### Recursive

First loop, no prior score to compare. Score below. Findings from this loop change what Loop 2 checks: the cookie exemption, the `.btn-outline` effect in a browser, the dashboard rule source, live branch protection.

## Consensus direction (9 lenses, no dissent on Q1 to Q4)

| Q   | Direction                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Keep the pointer. No copy, no generated copy. Add one test that the file exists and names `OCR-docs/docs/OCR_VISION.md`. Correct the dead `VISION.md` citations (governance route).                                                                                                                               |
| Q2  | Do not renumber or prefix filenames: the OCR-docs README says the overlap is intentional, the ADR-014 and ADR-020 gates and CODEOWNERS key on filenames, and about 100 cites would go stale. Qualify the ambiguous cites ("OSE ADR-012", "fleet ADR-012") and record the namespace split in `docs/adr/README.md`. |
| Q3  | Bump when `packages/ui` changes, or for a security or CI need. Record any other lag as a decision. No required freshness check. An optional non-blocking drift report is acceptable.                                                                                                                              |
| Q4  | No. The goal is "nothing unexplained". Fix dashboard rules that flag legitimate state (ADR overlap per repo, commits-behind counting docs-only commits). Fix repo content only for real drift.                                                                                                                    |

Note for the record: PO, Scrum Master, FE and DevOps read #1007 as not needed for any served OSE change, and FE found a possible visible effect. It is merged and the staging chain is green on `66a334b2`, so it stands unless the browser check in Loop 2 shows a regression.

## Findings register

| #   | Severity | Finding                                                                                                                                                                | Evidence                                                 | Status                                  |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| F1  | High     | Dashboard "4 of 4" and ADR rules not located; the nightly vision check tests presence only and never compares the hash                                                 | DevOps, Dr Sec: `nightly-sync-check.yml:75,113-120`      | Open                                    |
| F2  | High     | `ose_anon` cookie set on public `/q` and form routes vs Invariant 4; committed `.telemetry` files record it without flagging; no exemption checked                     | Main session: `qr-scan.ts:258-259`; Data Scientist       | Open, owner ruling                      |
| F3  | High     | No check compares the pin to spine main, or the migration level of the two databases; any "in sync" claim is unproven                                                  | SDET: `env-parity.mjs:255`, `hub-pin-ancestry.test.js`   | Open, known (AGENTS.md says so for DBs) |
| F4  | Medium   | T2 Contract (api) has no retry; one `ECONNRESET` failed a required gate that guards Invariant 3. Last 12 main pushes: 8 pass, 4 fail (3 were a missing staging secret) | Main session, QA, SDET: run 39702660720                  | Open                                    |
| F5  | Medium   | `AGENTS.md:5`, `SKILL.md:134,138` cite a nonexistent `OCR-docs/docs/VISION.md` (governance files)                                                                      | Main session: `ls`                                       | Open, needs 5-loop route                |
| F6  | Medium   | Bare "ADR-012", "ADR-009", "ADR-008" mean different ADRs in this repo                                                                                                  | Backend: `sponsor-allocation.ts:6`, `landing-area.ts:48` | Open                                    |
| F7  | Medium   | Visual specs run in no workflow and have no Linux baselines (dead coverage); the new global `.btn-outline` on pages with their own is unchecked                        | QA, FE                                                   | Open                                    |
| F8  | Medium   | Nothing fails if `docs/OCR_VISION.md` is missing or drifts                                                                                                             | QA: grep of tests, scripts, .github                      | Open                                    |
| F9  | Medium   | "Validate against OCR-docs brain" is not in `tools/ci/main-branch-protection.json`; live settings not read                                                             | Dr Sec                                                   | Open                                    |
| F10 | Low      | Stale self-hosted comments (`codeql.yml:3-6`, `docs-ci.yml:18`); no runner directory exists                                                                            | DevOps                                                   | Open                                    |
| F11 | Low      | `.telemetry` files: stale `scan_node_returns` properties, imprecise BigQuery wording                                                                                   | Data Scientist                                           | Open                                    |
| F12 | Low      | #1006 carries "human review before merge" but GitHub shows no review                                                                                                   | Scrum Master                                             | Open, owner merged                      |
| F13 | Low      | Three role knowledge files are stale (2026-03-27)                                                                                                                      | PO, FE, Scrum Master                                     | Open                                    |

Score: 3 High x 10 = 30, 6 Medium x 5 = 30, 4 Low x 2 = 8. Deductions 68. **System score 32%.** Loop-position and environment modifiers from the full protocol were not applied this loop. The score reflects open findings in a repo whose code and CI are otherwise green; most deductions are about checks that cannot fail, not about broken behavior.

## Before anything ships

1. Owner answers the gate questions below.
2. Non-governance docs PR: qualify ambiguous ADR cites (F6), namespace note in `docs/adr/README.md`, pointer-exists test (F8), banner on the `.telemetry` files that they record facts and do not approve them (F2, F11).
3. Governance PR through the 5-loop route: correct the `VISION.md` citations in `AGENTS.md` and `SKILL.md` (F5).
4. Check `.btn-outline` on `shared-report` in a browser against staging (F7).
5. Raise an OCR-docs ticket for the dashboard rules (F1) once located.

Risks accepted so far: #1007 stays merged; the pointer stays as is.

Agent hygiene note: the Dr of Security lens ran `npx jest` by mistake (wrong runner, swept `.claude/worktrees`, 114 suites failed). It may have written to the npm cache. No repo file changed (`git status` clean, `0 0`).

## Human-gate questions (Loop 1)

1. **F2:** Does an ADR, ticket or owner ruling permit the `ose_anon` cookie on the `/q` redirect and the form routes? If not, is this a Security Critical to fix before Oct 24, or a wording change to Invariant 4?
2. **F5:** May I fix the dead `VISION.md` citations in `AGENTS.md` and `SKILL.md` through the 5-loop governance route?
3. **F1:** Do you know where the dashboard's "4 of 4" and ADR-gap rules live, or should Loop 2 find them?
4. **F4:** Add a single retry on transport errors only (never assertion failures) to the Bruno step?
5. **F7:** Wire the visual specs to a Linux baseline job, or delete them?
6. **Q3:** Record "bump when `packages/ui` changes" as the pin policy decision?

---

# Loop 2 (2026-10-22): owner rulings applied

Team: main session only this loop (narrow follow-up; the full lens fan-out returns in Loop 3 for the governance wording). Loops 3 to 5+ follow, with a human gate after each.

## Owner rulings received at the Loop 1 gate

| Q   | Ruling                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The `ose_anon` cookie is allowed on `/q` and `/s` (the QR code and its shortlink) as the OSE anonymous token. OurWKRP's authenticated "plant your flag" profile has a separate token and cookie. In a hybrid, the codes and links still come from the OSE side. |
| 2   | Yes: fix the dead `VISION.md` citations through the 5-loop governance route.                                                                                                                                                                                    |
| 3   | Find the dashboard rules.                                                                                                                                                                                                                                       |
| 4   | Owner leans to one retry for environmental failures and asked for thoughts (below).                                                                                                                                                                             |
| 5   | Do not delete the visual specs; move them to a backed-up folder. Done in PR 1011.                                                                                                                                                                               |
| 6   | Not understood. Plain-language explanation sent in chat; no decision yet.                                                                                                                                                                                       |

## Critical (true versus assumed)

Verified this loop:

- `/q` sets `ose_anon` for a new visitor (`qr-scan.ts:258-261`). **`/s` does not, by design**: `shortlink-resolve.ts:29` says "No IP read. No anon_id read. No session cookie set/read." The ruling permits the cookie on `/s`; the code does not use that permission, and nothing needs to change. The `/s` route is a click counter that never learns who clicked.
- The forms handlers also set it (`forms.ts:325,468,518,573,603`). The ruling named `/q` and `/s` only. **Forms routes are unconfirmed.**
- `AGENTS.md` is 12,257 bytes against a 12 KB (12,288) budget (`scripts/ci/agent-instructions-budget.mjs:16`): **31 bytes of headroom**. Any wording change to Invariant 4 must be paid for by cuts elsewhere or an owner-approved budget change.
- The dashboard rules are not in any tracked file in OCR-docs or the spine (searched `dashboard/`, `docs/dashboard/`, `.github/`, `scripts/`, `docs/network-plate/`, the spine `SKILL.md`). The spine's `/sync` skill (`.claude/skills/sync/SKILL.md`) is an assess-first reconciliation loop and does not define "4 of 4" or the ADR-gap rule. The only scheduled task is `ose-morning-brief`, a read-only OSE brief, not the dashboard. **Where the rules live is still unknown.**
- The spine's own `SKILL.md:46` says product repos bump their pin "after the PR merges", which supports bumping when `packages/ui` changes.

## Conservative (worst case)

- If forms are not covered by the ruling, five public handlers set a cookie outside it. Needs a one-line owner answer, not a code change yet.
- Rewording Invariant 4 in `AGENTS.md` can fail the size test unless something else shrinks.
- The retry, done carelessly, hides real flakiness and re-runs seeded data twice.

## Retry design (thoughts for gate question 4)

Yes, one retry, if all four hold:

1. **Transport errors only.** Retry only when the junit shows zero failed assertions and every failed request is a transport error (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, socket hang up). An assertion failure never retries.
2. **Whole section, not one request.** Requests depend on variables captured earlier (`testEventId`, `testRegistrationId`), so a single request cannot rerun alone. Cost: the section's seeded rows (section 11 seeds and cleans up sponsors) run twice, so each section must be checked for idempotency on staging before the retry is enabled there.
3. **Loud, not silent.** A `::warning::` annotation and a retry count in the job summary on every retry, so a flaky route stays visible and is counted, not hidden.
4. **Born red.** Prove it by pointing one request at a connection that resets, watch it retry once then fail, and watch an assertion failure not retry. The step has `timeout-minutes: 5`, so the retry must fit inside it or raise it.

Recommendation: implement as its own CI PR after the owner's go-ahead. Not a governance file.

## Governance wording proposed for the gate (nothing edited yet)

| File                   | Change                                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md:5`          | `OCR-docs/docs/VISION.md` to `OCR-docs/docs/OCR_VISION.md` (+4 bytes)                                                                                                                                                                                                                                |
| `SKILL.md:134,138`     | Same correction                                                                                                                                                                                                                                                                                      |
| `AGENTS.md` Inv. 4     | "No cookies on public pages. The one exception is the anonymous `ose_anon` token on `/q` (and `/s`, where none is set today): PO ruling 2026-10-22. OurWKRP's authenticated profile token is separate. Geolocation picks what to show and is never stored." About +230 bytes; needs offsetting cuts. |
| `AGENTS.md:19` (rider) | The brand-scoping sentence is out of date (object-level scoping exists, per `docs/brain/CONSTRAINTS.md`); correcting it needs bytes too. Optional.                                                                                                                                                   |

## Findings after Loop 2

| Change      | Item                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Closed      | F2 (cookie): the ruling is the exemption. The possible Security Critical floor is removed.                               |
| New, Medium | F14: forms routes set `ose_anon` and are not named in the ruling                                                         |
| New, Medium | F15: Invariant 4 wording contradicts the ruling; 31 bytes of budget headroom                                             |
| In flight   | F7 dead coverage: PR 1011 archives the specs. The `.btn-outline` check in a browser is still open.                       |
| Unchanged   | F1 (dashboard rules not found), F3, F4 (awaiting go-ahead), F5 (authorized, wording at the gate), F6, F8, F9, F10 to F13 |

Score: 2 High x 10 = 20, 8 Medium x 5 = 40 (F4, F5, F6, F7, F8, F9, F14, F15), 4 Low x 2 = 8. Deductions 68. **System score 32%, flat against Loop 1**: one High closed, two Mediums opened. Assessment confidence 75% (up from 70%; the cookie scope is now verified, the dashboard rules still are not).

Trend: flat. Nothing new is broken; the score stays low because several checks cannot fail and the fixes are in open PRs or waiting on a gate.

## Human-gate questions (Loop 2)

1. **F14:** Does the ruling cover the forms routes (register, check-in, survey, email sign-up), which set `ose_anon` today?
2. **F1:** Where does the dashboard's row logic live (a script, a tool, a scheduled job in another account)? Without a pointer, Loop 3 cannot check what "4 of 4" tests.
3. **F15:** For the Invariant 4 wording, which bytes may go from `AGENTS.md`, or may the budget rise from 12 KB?
4. **F4:** Go ahead with the retry under the four conditions above?
5. **Q3 pin policy:** decision after reading the plain-language explanation.

## Gate answer received (2026-10-22)

**F14 closed.** The owner confirmed the `ose_anon` ruling also covers the forms routes (register, check-in, survey, email sign-up). No code change needed. Remaining open from Loop 2: F15 (Invariant 4 wording and the 31-byte budget), F1 (dashboard rule location), F4 (retry go-ahead), Q3 (pin policy). Score after closing F14: 7 Medium x 5 = 35, 2 High x 10 = 20, 4 Low x 2 = 8, deductions 63, **system score 37%**.

---

# Loop 3 (2026-10-22): the full sync chain, hop by hop

Owner frame, 2026-10-22: the full sync is one chain that must work on staging, and production follows once ADR, documentation, shared brain, OCR-docs, ourSharedEvents and ourWKRP all match:

ADR > documentation > shared brain > invariants > code > CI/CD > test pyramid > test results > report > loop > shared brain.

This is `OCR_STANDARD_reconciliationLoop.md` section 0 with ADR and documentation added at the front. The OCR-docs standard does not list those two rungs; adding them is a governance edit for the owner.

Team: all nine lenses, each assigned hops and asked for the one check that can fail on real drift. A check that cannot fail counts as absent. Read-only throughout. The live view is the "Full sync (CCR)" section of the OCR hub board.

## Verdict

| Item                  | Value                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System score          | **0%** (100 - 173, floored at 0). Loop 2 was 37%.                                                                                                                                                              |
| Assessment confidence | **80%**. Up from 75%: the dashboard is found, the failed requests and ADR-019 are verified. Still unread: the scheduled task behind the dashboard, staging and production migration levels (need credentials). |
| Gate result           | **Human gate. Stopped.** Ten owner decisions are listed on the board.                                                                                                                                          |
| Hops                  | 0 enforced, 6 partial, 5 with no check that can fail                                                                                                                                                           |

The drop from 37% to 0% is the protocol working: the scope widened from four questions to all eleven hops, and most new deductions are checks that are missing, not behavior that is broken. Loop-position and environment modifiers were not applied.

## The one check per hop

| #   | Hop                   | Today                                                                                   | The one check                                                                                                                                                                         | Fails with                                                                                                               | Born red                                                                              | Size  | Lives in       |
| --- | --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----- | -------------- |
| 1   | ADR                   | None                                                                                    | Test that every cited `ADR-NNN` resolves to a file in `docs/adr/`, or is written `fleet ADR-NNN` and matches the OCR-docs list; baseline of the ~40 known cites                       | `ADR-019 cited at sponsor-home.ts:26 has no docs/adr/ADR-019-*.md`                                                       | Fails on `main` today (ADR-019)                                                       | S     | OSE            |
| 2   | Documentation         | None (link check only warns, and its `[^http]` regex drops links starting h, t or p)    | Dead-citation script over governance, brain and skill docs; ROLE-STATE excluded                                                                                                       | `dead citation: AGENTS.md:5 -> OCR-docs/docs/VISION.md`                                                                  | Add a citation to a missing file in a scratch copy                                    | S     | OSE            |
| 3   | Shared brain          | Partial (brain check runs, is not required)                                             | Owner makes "Validate against OCR-docs brain" required; nightly diff of each spoke's `.ocr-standards` against the org source                                                          | `<repo> .ocr-standards/<path> differs from org`                                                                          | Break a `test_file` in a PR; change one byte in a fork spoke                          | S + M | OSE, OCR-docs  |
| 4   | Invariants            | Partial (6 of 9 AGENTS invariants gated; 4, 5, 6 thin)                                  | `agents_n -> brain_id or local gate` map and a T0 script                                                                                                                              | `AGENTS invariant 4 maps to no brain id or gate`                                                                         | Delete one mapping                                                                    | M     | OSE + OCR-docs |
| 5   | Code                  | None                                                                                    | Nightly level-parity (staging vs production vs `REQUIRED_*` for both D1 databases) plus a pin-drift line per spoke                                                                    | `LEVEL DRIFT DB: staging 104 vs production 103 (required 104)`; `ourWKRP pin b96b2c8 is 11 commits / 99 ui files behind` | Stub list with one migration removed                                                  | M + S | OSE, ourWKRP   |
| 6   | CI/CD                 | Partial (chain blocks merges; nothing ties Done to a SHA; docs-only merges have no run) | `staging-chain-for-sha.mjs`: claimed SHA is an ancestor of a run with T1 to T4 all success                                                                                            | `T3: skipped for <sha>`                                                                                                  | Fake run JSON: T3 skipped, T4 failed, non-descendant SHA                              | M     | OSE            |
| 7   | Test pyramid          | Partial (orphan count ratcheted at 97; invariant guards dark)                           | Flag orphan specs that claim an invariant, ceiling 0; and a staging computed-style spec for SharedReport buttons                                                                      | `orphanSpecs: <path> claims invariant N and no workflow runs it`                                                         | Copy a flagged spec into the fixture root; inject `.btn-outline{border:none}`         | S + M | OSE            |
| 8   | Test results          | Partial (one connection reset fails a required gate)                                    | `bru-retry.mjs`: retry once only if exit 1, zero `<failure>`, at least one `<error>`, every error a transport error; visible warning; first junit renamed so the report glob skips it | `::warning:: retry=1 ECONNRESET`                                                                                         | `<failure>` plus reset must not retry; reset retries once and passes; two resets fail | S     | OSE            |
| 9   | Report                | None                                                                                    | Ratchet that recomputes each reported number and fails on a stale one                                                                                                                 | `network-plate: orphanSpecs claims 105/262, repo says 97/255`                                                            | Edit the committed number                                                             | S-M   | OSE + spine    |
| 10  | Loop                  | None                                                                                    | PR check: a PR touching `workers/`, `scripts/`, `.github/` or `tests/` changes `docs/brain/ROLE-STATE.md` or carries `Role-state: n/a <reason>`                                       | `ROLE-STATE.md not updated for this PR`                                                                                  | Scratch PR touching `workers/` with neither                                           | M     | OSE            |
| 11  | Shared brain (return) | Partial ([brain-drift] tickets are auto-filed; the board shows the loop is live)        | A [brain-drift] ticket may close only with a brain commit SHA or a recorded decision                                                                                                  | `ticket closed with no brain change`                                                                                     | Close a test ticket with neither                                                      | M     | OCR-docs       |

## Critical (true versus assumed)

Verified by the main session this loop (commands or logs, not lens say-so):

- Two of the last three failing main runs failed at T2 on a connection reset, on different requests: `OSE-1242 events map` (run 39702660720) and `4. Forms POST Register` (run 39796433252, `ECONNRESET`, 91 of 92 passed). The rerun of the failed jobs passed T2. The board reports only 62% of main runs green (312 of 503 in 56 days).
- ADR-019 is cited 19 times under `workers/oursharedevents/src`; no file exists on `main`. Its commit `e3066b22` is only on the unmerged branch `ose-1301-sponsor-consent-trace`. The written reason for Invariant 6 is absent from `main`.
- ourWKRP's pin `b96b2c8` is 11 commits and 99 `packages/ui` and `packages/tokens` files behind spine `main` (fresh fetch). OSE's pin is one docs-only commit behind.
- The dashboard is the OCR hub board. Its repo rows come from a scheduled task on the owner's computer (about 4:37 AM Central). The OSE row on the board still said governance 3 of 4 and hub pin `37606bf`, dated 2026-10-21.

Source-read by lenses, not re-verified: the nightly check never compares the vision hash and copies without deleting; the brain check is not required (read from `gh api`, which a lens ran); invariants 4, 5, 6 lack whole-source gates; the SharedReport `.btn-outline` border changed from none to 1.5px; no per-SHA Done check; ourWKRP has no schema guard.

Corrections to earlier claims in this review:

- OCR-docs `CLAUDE.md` on `main` says 29 invariants, not ten (I read a stale local copy).
- "ourWKRP has no `docs/OCR_VISION.md`" came from a stale local checkout. On origin the `.ocr-standards` copy is byte-identical in both spokes.
- Section 11 of the Bruno suite is read-only (its seed runs outside `bru run`); my earlier worry about rerunning it was wrong.
- Hop 11 is partial, not none: the [brain-drift] ticket loop is live.
- QA cited `AGENTS.md:7` for the dead `VISION.md` reference; it is line 5.
- The PO suggested merging the ourWKRP pin bump. I did not, and will not without your say.

## Conservative (worst case)

- A passing retry hides a deterministic reset (OSE-1242 sends coordinate-shaped parameters a WAF could trip). Mitigation: two failures fail, and every retry leaves a visible warning and count.
- A "match" bar that means different things to the owner and to CI turns this into doc polishing during Harbor week.
- `AGENTS.md` has 31 bytes of headroom, so the Invariant 4 rewording cannot land without cuts. The "Production posture" bullets are owner decisions and are not candidates for cutting.
- Nothing reads production's migration level, and `schema-guard` fails open on a query error. A green staging chain does not prove production parity.

## Recursive

- Loop 2 to Loop 3: 37% to 0%. Thirteen findings opened, none closed, one downgraded (F1 High to Medium: the dashboard is found, its logic is unread).
- Fixes between loops are small and are themselves open subjects: #1011 archived two visual specs (merged), #1012 carried Loop 2 (merged). Nothing from Loop 3 has been built.
- Root causes, not 26 separate problems: (1) checks that report but cannot block; (2) nothing compares across repos or environments; (3) lists and citations with no map (ADR cites, invariant lists, `VISION.md` paths); (4) coverage that counts files, not runs; (5) flake and Done accounting.
- Loop 4 checks: staging versus production levels (needs credentials), `.btn-outline` on staging, the exact `AGENTS.md` and `SKILL.md` diff against the size budget, the scheduled task's logic.

## Findings register changes

| Change          | Items                                                                                                                                                                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New, High       | L3-1 ADR-019 dangling; L3-2 no map across invariant lists; L3-3 ourWKRP pin 11 behind; L3-4 ourWKRP no schema guard; L3-5 UI guards for invariants 1, 4, 5, 6, 8 never run; L3-7 no per-SHA Done check; L3-9 nothing compares OSE to ourWKRP; L3-11 stale numbers on the spine plate and OCR dashboard data; RET registrations 90 days vs target 30 |
| New, Medium     | L3-6 pin bump changed SharedReport button borders unnoticed; L3-8 ROLE-STATE stale since 2026-10-12; L3-10 lint scope gap (CI lints 4 folders); L3-12 conformance "Enforced" means annotated                                                                                                                                                        |
| Downgraded      | F1: High to Medium                                                                                                                                                                                                                                                                                                                                  |
| Open, unchanged | F3, F4, F5, F6, F7, F8, F9, F15, F10 to F13                                                                                                                                                                                                                                                                                                         |

Score: 11 High x 10 = 110, 11 Medium x 5 = 55, 4 Low x 2 = 8. Deductions 173. **0%**.

## Proposed order (all gated; nothing built yet)

1. No owner decision needed, small: dead-citation script (hop 2), orphan-invariant flag (hop 7), pointer test, ADR cite test with a baseline (hop 1).
2. After the retry go-ahead: `bru-retry.mjs` (hop 8).
3. After the owner decisions: invariants map (hop 4), `staging-chain-for-sha` (hop 6), cross-repo and `.ocr-standards` nightly checks (hops 3, 5), level-parity (needs read-only tokens).
4. Governance route (5+ loops, human gate each): the `VISION.md` citations and the Invariant 4 wording.
5. ourWKRP work in its own session, after it is in scope.
6. Defer until after Oct 24: orphan-spec wiring, retention constants, report-claims ratchet.

## Human-gate questions (Loop 3)

The ten decisions are on the board, in order. The ones that block the most:

1. **Match bar:** is the staging "match" same SHA and same migration level, or all documents agree?
2. **Invariant list:** which list is canonical (the brain yaml is recommended)?
3. **Brain check:** will you make "Validate against OCR-docs brain" a required check (repo control, yours)?
4. **Retry:** go ahead with the Bruno retry, as one retry for transport errors only?
5. **AGENTS.md:** which text may be cut, or may the 12 KB limit rise, for the Invariant 4 rewording?
6. **ADR-019:** may the ADR file on `ose-1301-sponsor-consent-trace` be landed on `main`, or does Invariant 6's rationale need rewriting?
7. **ourWKRP:** in scope for the first sync, and should it be its own session?
8. **Read-only Cloudflare tokens** for the staging-versus-production level check (you set secrets yourself).
9. **Pin policy** and **retention** (registrations 90 or 30; clock from sign-up or event).

## Gate answer received (2026-10-22): the match bar

**Question 1 answered.** The owner ruled that "match" means **all documents agree**, not just the same SHA and migration level, and repeated that the documents should be in agreement.

What this changes:

- The document-agreement checks are **required** for production to follow staging: hop 1 (ADR cites resolve), hop 2 (citations resolve), hop 3 (`.ocr-standards` and the brain check), hop 4 (invariant lists mapped), hop 9 (reported numbers regenerated from the repo), and the vision pointer test.
- The SHA and migration-level checks (hops 5, 6, 8) stay required too. The bar is the union, not a choice.
- Decision D4 on the board is reworded: the dashboard is located (the OCR hub board, fed by a morning scheduled task on the owner's computer); the task's own logic is still unread.

Nine decisions remain on the board. Score is unchanged at 0% until a finding closes.

---

# Loop 4 (2026-10-22): sync AGENTS.md with OurCommunityRituals and OCR-docs

Owner direction, 2026-10-22: `AGENTS.md` should be synced with OurCommunityRituals (the spine) and OCR-docs, so the documents agree.

`AGENTS.md` is a governance file: 5+ loops, human gate after every loop. This is the first loop on the wording. **Nothing is applied.** The proposal is the unified diff in `.claude/outputs/AGENTS-SYNC-PROPOSAL-2026-10-22.diff`.

Method: the main session compared `AGENTS.md` with fresh `origin/main` copies of OCR-docs (`CLAUDE.md`, `ocr-docs-brain/architectural-invariants.yaml`, the ADR README) and the spine (`CLAUDE.md`). No lens fan-out this loop. Loop 5 sends the proposal to the Dr of Security and the Backend Architect to confirm the invariant mapping.

## Where AGENTS.md disagrees with the other two

| #   | Where                    | AGENTS.md says                                                  | The other side says                                                                                                                    | Fix lives in                                                                                             |
| --- | ------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Line 5                   | Org vision is `OCR-docs/docs/VISION.md`                         | The file is `OCR_VISION.md`; OCR-docs `CLAUDE.md` says read `docs/OCR_VISION.md`                                                       | AGENTS.md                                                                                                |
| 2   | Invariant 4              | No cookies on public surfaces                                   | Brain #1 (live) enforces the `ose_anon` cookie contract; owner ruling 2026-10-22 allows it on `/q` and forms (`/s` sets none)          | AGENTS.md and `.github/copilot-instructions.md:8` (same old wording; Copilot would flag legitimate code) |
| 3   | Line 15                  | Brand scoping is list-level only (OSE-1080)                     | `guardAdminObjectScope` runs at `router.ts:807`; its spec exists; `docs/brain/CONSTRAINTS.md` already says so                          | AGENTS.md                                                                                                |
| 4   | Lines 22, 33, 104        | "hub" means the shared-packages repo                            | The owner's words: hub is OCR-docs, spine is OurCommunityRituals (`ECOSYSTEM-LAYERS.md`)                                               | AGENTS.md (file and secret names `.ocr-hub-ref`, `OCR_HUB_READ` keep theirs)                             |
| 5   | Sources of truth         | Silent on ADR numbering                                         | OCR-docs ADR README: single-repo ADRs live in the repo, fleet-wide in OCR-docs                                                         | AGENTS.md                                                                                                |
| 6   | Invariants               | Nine owner decisions, no link to the org list                   | OCR-docs `CLAUDE.md` (main): the list lives in the brain yaml, 29 invariants (17 live, 10 partial, 2 retired), deliberately not copied | AGENTS.md                                                                                                |
| 7   | Invariant 8              | Colours only from tokens; never change colours in `packages/ui` | Spine `CLAUDE.md`: same, plus read `HANDOFF.md` then `README.md`                                                                       | **Agrees**                                                                                               |
| 8   | Spine pin                | Bump the pin in a PR                                            | Spine `SKILL.md:46`: tell product repos to bump after the hub PR merges                                                                | Agrees; policy (D7) pending                                                                              |
| 9   | Brain #5 text            | OSE invariant 5: display shows no counts; invariant 2: floor    | Brain #5 says "same real-time counts at every tier"                                                                                    | OCR-docs (not edited here)                                                                               |
| 10  | OCR-docs ADRs            | n/a                                                             | Two files numbered ADR-011 inside OCR-docs (the board reports it)                                                                      | OCR-docs (not edited here)                                                                               |
| 11  | OCR-docs governance list | AGENTS.md is the operating contract                             | "Four governance files per repo" omits AGENTS.md                                                                                       | OCR-docs, owner decision                                                                                 |

## Proposed AGENTS.md edits (nine; none applied)

1. Line 5: `VISION.md` to `OCR_VISION.md`.
2. ADR bullet: add "Fleet-wide ADRs live in OCR-docs; numbers overlap by design, so cite `fleet ADR-NNN` or `OSE ADR-NNN`."
3. Brand scoping: replace with the object-level wording and the public-read carve-out.
4. "hub" to "spine" in the three places, naming OurCommunityRituals once.
5. Invariants intro: one line pointing at the brain yaml, with `[#n]` ids on each decision.
6. Invariant 4: "No cookies on public pages [#1]. One exception, owner ruling 2026-10-22: the anonymous `ose_anon` token on `/q` and the forms routes; `/s` sets none. Geolocation picks what to show and is never stored."
7. Invariant 8: `(hub)` to `[spine]`.
8. Where things live: design system "hub" to "spine".
9. `.github/copilot-instructions.md:8`: same cookie wording (a separate, smaller file).

Proposed mapping (to confirm in Loop 5 against each yaml entry's `enforces` text): 1 [#1 #7], 2 [#7], 3 [#2 #4], 4 [#1], 5 [OSE only: no brain entry], 6 [#5], 7 [#5 #9], 8 [spine], 9 [#1 #8].

## The size budget

`AGENTS.md` is 12,257 bytes (CRLF) against a 12,288 limit (31 spare). The edits add 433 bytes, 402 over the limit. Six cuts, each of text that already lives elsewhere, bring it to **12,189 bytes (99 spare)**:

| Cut                                                                      | Bytes | Where it still lives                                      |
| ------------------------------------------------------------------------ | ----: | --------------------------------------------------------- |
| Reconciliation-rule parenthetical and audit file pointer                 |   102 | `docs/audits/LINEAR_BACKLOG_RECONCILIATION_2026-09-22.md` |
| "Templates are Wrangler text modules served with CSP nonces"             |    72 | `docs/brain/CONSTRAINTS.md`                               |
| Worker-test `Sec-Fetch-Site` hint                                        |    86 | `workers/oursharedevents/CLAUDE.md`                       |
| `testids.js` / `assetState.js` detail (the "never delete it" line stays) |   111 | `docs/brain/CONSTRAINTS.md`                               |
| Parenthetical on the Known constraints pointer                           |    62 | the file itself                                           |
| "(the structural gates run locally...)" on the arch command              |    75 | `npm run test:arch` output                                |

The alternative is raising the limit in `scripts/ci/agent-instructions-budget.mjs:16`. The Production posture, Human approval and Definition of Done sections are untouched.

## Critical, Conservative, Recursive

- **Critical.** Verified: `AGENTS.md` bytes and line endings (CRLF), the three "hub" lines, the object-scope guard in code, brain #1's cookie contract (the `enforces` text and the `cookie_contract` field), the spine `CLAUDE.md` (three design-system bullets), and that no test depends on the changed wording. Not verified: the invariant mapping above (title and `enforces` match only).
- **Conservative.** The mapping could point a decision at the wrong brain id and give the owner a false sense of agreement; Loop 5 has the two lenses check each entry. Changing "hub" to "spine" could be misread as renaming `.ocr-hub-ref`; the diff keeps that name. Copilot instructions still carry the old cookie wording until item 9 lands.
- **Recursive.** Six new findings (below). The score stays at the floor: the previous deductions of 173 plus 21 give 194, so 0%. Loop 5 will check the mapping, the cut list and the diff against the budget test run on a real copy.

New findings: L4-1 `AGENTS.md` brand-scoping sentence stale (Medium); L4-2 `copilot-instructions.md` repeats the old cookie wording (Medium); L4-3 brain #5 text conflicts with the display and floor invariants (Medium, OCR-docs); L4-4 "hub" used for the spine (Low); L4-5 two ADR-011 files inside OCR-docs (Low, OCR-docs); L4-6 OCR-docs governance list omits `AGENTS.md` (Low).

## Human-gate questions (Loop 4)

1. Is this the direction (edits 1 to 9), so Loop 5 can send it to the Dr of Security and the Backend Architect?
2. Which cuts, or may the limit rise instead?
3. Is "spine" the word for OurCommunityRituals in `AGENTS.md`?
4. The OCR-docs-side items (9, 10, 11) are a different repository: should I prepare them as OCR-docs PRs in their own session, for your review?

---

# Loop 5 (2026-10-22): lens review of the AGENTS.md sync proposal

Owner at the Loop 4 gate: direction approved, the six cuts approved, "spine" approved as the word. This loop sent the proposal to all nine lenses, read-only. Nothing is applied to `AGENTS.md`. The revised proposal (v2) is `.claude/outputs/AGENTS-SYNC-PROPOSAL-2026-10-22-v2.diff`.

## Verdict

| Item                  | Value                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System score          | **0%** (deductions 249, floored)                                                                                                                                |
| Assessment confidence | **85%**. The mapping and cookie claims are now read against the yaml and source by two lenses; the budget script was run by the main session on a scratch copy. |
| Gate result           | **Human gate.** The wording is the owner's to confirm; the loop count is 2 of at least 4 on the wording (see below).                                            |

## What the lenses found, and what v2 does about it

| #   | Finding                                                                                                                                                                                                                                        | From                                | v2                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Invariant 2 tagged `[#7]` overstates the org backing: brain #7 covers SharedReport output, not "no exceptions", every tier, or the "Fewer than 5" wording                                                                                      | Data Scientist, Backend             | `[#7 OSE]`                                                                          |
| 2   | Invariants 3 and 6 ids are weak: `[#2 #4]` states neither res 7, res 9 nor "never request geo"; `[#5]` (tier equity) says nothing about consent; two-sided acceptance is in #2's enforcement text                                              | Backend, PO, Data Scientist         | `[#4 OSE]` and `[#2 OSE]`                                                           |
| 3   | Invariant 7 omits #8 (retention) and #24 (audit)                                                                                                                                                                                               | Backend                             | `[#5 #8 #9 #24]`                                                                    |
| 4   | Brain #5 says "same real-time counts at every tier"; the proposal's `[#5]` on invariant 7 still lets an agent inherit that sentence                                                                                                            | Data Scientist                      | Not fixable in `AGENTS.md`; OCR-docs fix (D11). Raised to High.                     |
| 5   | The brand-scoping sentence was too broad: the guard covers `/admin/events/:id/**` and poster-deployments by id; sponsor by-id routes scope inside their handlers. The cut also removed "do not assume object-level isolation in a new handler" | Backend, Dr of Security             | Accurate wording and the safeguard kept: "A new by-id handler must scope by brand." |
| 6   | "public pages" is narrower than "public surfaces", and the forms routes are JSON APIs                                                                                                                                                          | Dr of Security                      | Kept "public surfaces", exception named                                             |
| 7   | **No gate fails if a new public route sets a cookie**: `anonymity-gate.spec.ts` checks four listed files and never matches a raw `Set-Cookie`                                                                                                  | Dr of Security                      | New check proposed (below)                                                          |
| 8   | `[spine]` implies OSE matches the spine on tap targets; OSE says 44 px, the spine README says 48 px (`--tap-min`)                                                                                                                              | FE Integration                      | Text unchanged; **owner decision**                                                  |
| 9   | The `web/shared/` cut dropped the reason not to delete it                                                                                                                                                                                      | PO                                  | Short reason kept                                                                   |
| 10  | ADR sentence label: the OCR-docs README says "OCR-docs ADR-NNN", not "fleet ADR-NNN"                                                                                                                                                           | Backend                             | "OCR-docs ADR-NNN"                                                                  |
| 11  | "Hub" means the spine in `docs/brain/CONSTRAINTS.md:13,14`, `ROLE-STATE.md:39`, `.claude/agents/role-design-fe.md:12`; ourWKRP's `CLAUDE.md:71,73` also uses hub for the spine and has no `AGENTS.md`                                          | DevOps                              | Follow-up PRs, not this file                                                        |
| 12  | `VISION.md` is cited in seven places: `AGENTS.md:5`, `SKILL.md:134,138`, `devops.knowledge.md:207,240`, `product-director.knowledge.md:10`, `docs/brain/PRODUCT.md:103`                                                                        | Scrum Master (partly), main session | Follow-up PR                                                                        |
| 13  | Docs-only governance merge starts no push run, so the Done bar (T1 to T4 on the merge SHA) needs the next code push or a dispatch                                                                                                              | SDET/SRE                            | Process note                                                                        |
| 14  | The CRLF figure I gave (31 bytes spare) was wrong: CI counts LF, so `main` is 12,151 bytes and had 137 spare                                                                                                                                   | SDET/SRE                            | Corrected                                                                           |

Corrections to claims made earlier in this review: `CLAUDE.md:34` says "hub" in the OCR-docs sense, so it needs no change (the Scrum Master was wrong, DevOps right). I said the Loop 4 edits do not touch surfaces; they do (cookie exception, CSP-nonce clause, testids detail). The Scrum Master said `VISION.md` is not in `SKILL.md`; it is.

## The size: v2

v2 is **12,219 bytes (LF), 69 spare**. I ran `scripts/ci/agent-instructions-budget.mjs --root` against a scratch copy holding v2, the real `CLAUDE.md`, the worker `CLAUDE.md` and the Copilot file: `agent instructions ok`, exit 0. The cuts are the five approved ones (the `web/shared/` one now short, not total) plus the "(the structural gates...)" note kept, and three small additions to the cut list that need your yes:

| Added cut                                                       | Bytes | Where it still lives   |
| --------------------------------------------------------------- | ----: | ---------------------- |
| ", index `docs/adr/README.md`"                                  |    27 | the ADR folder itself  |
| "(`HANDOFF.md`, then `README.md`)" on the design-system pointer |    36 | the spine `CLAUDE.md`  |
| "(what each role last changed)" on the ROLE-STATE pointer       |    30 | the file's own heading |

The alternative to those three is raising the limit by 512 bytes.

## The new checks this loop adds to the plan

- **Sync check** (QA): `scripts/check-agents-sync.py`, size S to M, run in `brain-contract-check.yml` after its OCR-docs checkout. It fails when an `[#n]` is missing or retired in the brain yaml, an invariant has no id or tag, or an `OCR-docs/...` path cited in `AGENTS.md` or `CLAUDE.md` does not exist. Born red for free: today's `AGENTS.md:5` cites a missing file.
- **Cookie gate** (Dr of Security): a source-wide test that every `setAnonCookie` or `Set-Cookie` caller sits in an allowlist (`qr-scan.ts` and the forms handlers), so a new public route that sets a cookie fails. Size S.

## Loop count

The wording was first examined in Loop 4, so this is its second loop. The protocol needs 5+ loops with a gate after each and two consecutive stable loops at 95% or above (`ccr-protocol.md:312,314,670`). Remaining: Loop 6 (the mapping and cookie carve-out against v2 as edited), Loop 7 (the budget and a born-red test on the edited file), Loop 8 (a clean re-read of the applied diff and the stability check). I will not call the change ready before then.

## Proposed PR split, smallest first (nothing opened yet)

1. Brand-scoping sentence alone (owner-gated: `docs/brain/CONSTRAINTS.md` says the correction "waits for the owner").
2. The cookie ruling in `AGENTS.md` Invariant 4 and `.github/copilot-instructions.md:8` together, with the source-wide cookie gate.
3. The spine word, the `OCR_VISION.md` fix at `AGENTS.md:5`, the ADR wording, the `[#n]` ids and the cuts.
4. The other `VISION.md` and "hub" citations in ordinary docs (`SKILL.md`, the two knowledge files, `PRODUCT.md`, `CONSTRAINTS.md`, `ROLE-STATE.md`, `role-design-fe.md`).
5. ourWKRP and OCR-docs items in their own sessions.

## Human-gate questions (Loop 5)

1. Do you confirm the v2 wording, in particular the new brand-scoping sentence (your approval covered the edit; `CONSTRAINTS.md` says it waits for you) and the Invariant 4 sentence?
2. Do you add the three small cuts, or raise the limit by 512 bytes?
3. Tap targets: invariant 8 says 44 px, the spine says 48 px. Keep 44 and say so, or move OSE to 48?
4. Is the PR split right, and may I open the cookie gate and the sync check as their own small PRs?
5. Spokes: are only OSE and OW "spokes" (your page) or all product repos (OCR-docs standards)?
