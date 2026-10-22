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
