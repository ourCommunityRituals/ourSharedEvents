# CCR — front-end work order (extended scrum team, 3 loops)

Date: 2026-10-06. Type: standard assessment of a plan (Tier 4; no governance file changed). Reviewed: the seven-step work order given in chat on 2026-10-06 for 31 front-end branches ("v1"). Corrections between loops were made to the plan only; no product code, ticket or branch was changed.

Roles: PO, Lead BE, Lead FE Integration, Sr Design FE, Sr Automation QA, SRE/SDET, DevOps, plus Dr of Security, Sr SDET/SRE, DevOps Mgr, Sr Data Scientist. One assessor applied all lenses.

**Verdict after Run 2 (same day, after PR #834 merged): not cleared. Run 2 scored 10, then 56, then 56.** `main` is green and the ticket bodies are read. Run 2 found a live defect on `main` (a live event that is off the map has a dead public page) and three more stories that are blocked. The current order is **v3**, at the end of this file; v2 is kept for the record. About half of the remaining deduction is PO decisions.

**Run 1 verdict: not cleared. Loop 1 = 0, Loop 2 = 37, Loop 3 = 37.** v1 had five High defects. The corrected order (v2, below) removes the ones a plan can remove; what is left waits on PO decisions, on PR #834 going green on `main`, and on ticket bodies not yet read.

## Loop 1 — surface pass on v1

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                  | Sev    | Evidence                                                                    | Role                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- | --------------------- |
| F1  | "`main` is red because of the sponsor journey" was one cause of three. T4 surfaces leg failed on `088dd144`, `5e4b99d6`, `d6e09df1` (poster print title, `poster-print.data.spec.ts:263`, among others). T0 failed on `c7e71361` (constant-time timing test) and on `8a492993` (cause not read). T4 platform leg (sponsor journey) fails from `d6e09df1` on.                                                                             | High   | `gh run view` jobs for 13 runs; failed-log lines                            | SRE/SDET              |
| F2  | Two stories were scheduled as buildable but are blocked by backend that is not on `main`: OSE-1525 is blocked by OSE-1552 (campaigns); OSE-1556 is blocked by OSE-1555 and OSE-1553. No campaign or brand-table commit exists; the last migration is 0094.                                                                                                                                                                               | High   | Linear `blockedBy`; `git log origin/main`; `ls migrations`                  | PO, Lead BE           |
| F3  | No security gate in the order. OSE-1477 says feature work waits behind its Urgent items. OSE-1561 (Urgent; two organizers in the platform brand can reach each other's events) is not built and has two open PO questions. v1 schedules stories that widen what admin and sponsors can read: OSE-1524 (sponsor live counts), OSE-1526 slice 2 (refused sign-ins and rate-limit trips per brand), OSE-1527 (editable defaults), OSE-1525. | High   | OSE-1477 and OSE-1561 bodies; no matching commits on `main`                 | Dr of Security        |
| F4  | No date line. The event day is 2026-10-24, 18 days out. v1 does not say what must be on production by then or when merging stops. Notes from 2026-09-14 say the Oct 24 scope needs no new code and the path is the production Access app (OSE-1353), then OSE-1415, then `PRODUCTION_LIVE`. Those notes were not re-checked.                                                                                                             | High   | CLAUDE.md §3 DevOps; memory `project_harbor_county_bocce` (21 days old)     | PO, DevOps Mgr        |
| F5  | v1 puts the toast ahead of the whole admin lane, but OSE-1620 lists eight assumptions marked "confirm or correct before building". The ticket also says hub PR #51 is unmerged; it merged 2026-10-04 15:37, so hub `main` (`9b7555e2`) carries the first version. Bumping the pin now would ship the look the PO replaced.                                                                                                               | High   | OSE-1620 body; `gh pr view 51`; hub compare `265a549...main`                | Lead FE, Sr Design FE |
| F6  | The lane model was wrong. Logs and Settings have their own templates (`admin-logs.html`, `admin-settings.html`), so they need not queue behind `admin.html`. The "public lane" is not free either: `handlers/pages.ts` (#808, #812), `display.html` (#812, #814), `lib/event-settings.ts` (#809, #814), `landing.html` (#806, #812).                                                                                                     | Medium | files per PR #806 to #815                                                   | Lead FE               |
| F7  | The reason given for "merge one at a time" was false. Push runs on `main` are not cancel-in-progress (`oursharedevents-ci.yml:147-155`). The cancelled runs were most likely pending runs replaced by a newer one (GitHub keeps one pending run per group; inferred, not read from the run pages). A later green SHA still counts for Done. The real gap: 20 commits were merged after `main` first went red.                            | Medium | workflow file; `git log 088dd144..origin/main`                              | SRE/SDET              |
| F8  | No test step. The red-test map covers ten stories (1518, 1519, 1520, 1522, 1528, 1531, 1557, 1558, 1560, 1566). It has nothing for 1516, 1521, 1524, 1525, 1526, 1527, 1556 or 1620. OSE-1568, OSE-1578 and the pyramid tickets OSE-1591 to 1601 were left out of v1.                                                                                                                                                                    | Medium | `docs/ops/TDD-RED-MAP.md`; `tests/tdd-red-fe-wave.spec.ts`                  | Sr Automation QA      |
| F9  | The tablet decision (OSE-1557) was parked under "waiting". The ticket says the event page should be built against the chosen layout, not retrofitted. Every surface story built before the decision is rework.                                                                                                                                                                                                                           | Medium | OSE-1557 body (decision unrecorded, Backlog)                                | Sr Design FE, PO      |
| F10 | "The mobile drains may only need closing" was a guess. OSE-293 still describes the May plan (run against staging, baseline file dated 2026-05-15, seven drains). The audit now runs on PR code with no continue-on-error, but "Mobile workability audit" is not in the required checks on `main`. OSE-296, 297, 299 were not read.                                                                                                       | Medium | OSE-293 body; `mobile-workability-audit.yml:111,167`; branch protection API | Sr Automation QA, SRE |
| F11 | The decision list was short. Re-checked and still open: tablet layout; "plant my flag" URL; what a draft may show; SharedReport sponsor line; "Count me in" before the event. Missing from v1: OSE-1561's two questions, OSE-1620's eight assumptions, and two "decisions taken, please confirm" in OSE-1518 (check-in first while live; no second partner block). OSE-1529 was not re-checked.                                          | Medium | Linear comments on 1518, 1519, 1522 (2026-10-04)                            | PO                    |
| F12 | Redesign stories: "reconcile before building" holds, but only one of eight was read. OSE-1335 asks for a clock and a donation total on the TV; #814 removed the clock, and an amount on screen needs a never-who review.                                                                                                                                                                                                                 | Medium | OSE-1335 body; #814                                                         | Sr Design FE          |
| F13 | 31 branches were cut before any story started. `main` has already moved (`be63c69e` to `7b1ba90a`). The repo has 93 worktrees and 52 `fe/*` branches. The shared main folder changed branch twice in this session (once by me, once by another session).                                                                                                                                                                                 | Low    | `git worktree list`; `git branch --list`                                    | DevOps Mgr            |
| F14 | OSE-1524's sponsor counts and scan-area map need the per-cell floor, and OSE-1525's roll-ups should read the dashboard registry (`lib/dashboard-contract.ts`). The live view's 30-second refresh has not been checked against the PO's "refresh by choice" rule.                                                                                                                                                                         | Low    | OSE-1524 body; CLAUDE.md §3 BE                                              | Sr Data Scientist     |
| F15 | One assessor; severity is judgment.                                                                                                                                                                                                                                                                                                                                                                                                      | Low    | protocol §7.4                                                               | all                   |

Base items: environment assumptions Partial (F4 notes unverified; production not re-read), full surface Partial (about 12 of 31 ticket bodies read), partial-fix risk Verified, chunk scope Verified, human gate Verified.

Layers. Critical: the most dangerous assumption was "every listed story is buildable now" (F2, F3, F5: false for at least six). Conservative: worst case is another wave merged onto a red `main` with decisions unrecorded, which is what happened on 2026-10-04. Recursive: first pass.

**Score: 100 − 50 (five High) − 35 (seven Medium) − 6 (three Low) − 15 (two base Partial) = −6, reported as 0.** Stop.

## Corrections applied between Loop 1 and Loop 2 (plan only)

- F1: step 1 now names all three causes and what is left (PR #834).
- F2: OSE-1525, OSE-1556 and the campaign part of OSE-1531 moved to "blocked on backend".
- F3, F4, F5, F9, F11: one decision step added at the front, with every open question listed.
- F6: lanes redrawn by file.
- F7: pacing rule replaced by "no merge onto a red `main` except the fix" and at most two open PRs.
- F8: red test first for each story; promotion of the red map added to close-out.
- F10, F12: mobile drains and redesign stories moved to "rewrite or cancel before any build".
- F13: branch is cut when the story starts, in its own worktree.

## Loop 2 — pressure pass on v2

| ID  | Finding                                                                                                                                                                                                                        | Sev    | Evidence                                                 | Role             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------- | ---------------- |
| F16 | The previous plan for this wave scored 28% on 2026-10-04 and was not cleared. Its close-out (re-run, second reviewer, a stated merge rule) is not on record, and nine PRs merged after it. v2 is built on that uncleared base. | Medium | `CCR-FE-WAVE-PROGRESS-APPROACH-2026-10-04.md`; `git log` | PO               |
| F17 | Leftover scope for the follow-up and "slice 2" branches comes from a hand-written progress file two days old. Only 1518, 1519 and 1522 were re-read from Linear.                                                               | Medium | `FE-WAVE-PROGRESS-2026-10-04.md`                         | Sr Automation QA |
| F18 | The stop-the-line rule depends on someone looking. The sponsor journey runs only in T4, after merge; PR-local T2/T3 (OSE-1569) would not have caught it. Nothing alerts when `main` goes red.                                  | Low    | CLAUDE.md §3 SRE; ci workflow                            | Sr SDET/SRE      |

Layers. Critical: is anything in v2 still assumed? Yes: the fix attributions in F1 (#817 for the poster leg, #832 for the timing test) are read from timing and titles, not from a green run of those tests. Conservative: if #834 does not turn `main` green, step 2 cannot start and v2 says so. Recursive: the score rose because the plan changed, not because checks were skipped.

Deductions on v2: F1 5 (waits on #834 and a green run), F3 5, F4 5, F5 5 (PO), F6 2.5, F8 2.5, F9 2.5, F10 2.5, F12 2.5, F14 1, F15 2, base environment 7.5, base surface 9.4 (actionable, not done, ×1.25), F16 6.25, F17 3.1, F18 1.25.
**Score: 100 − 63 = 37.** Stop.

## Loop 3 — confirmation pass

No new finding. PR #834 re-read: 28 checks passed, 4 pending, none failed, not merged. Nothing was downgraded without evidence. **Score: 37, held.** Three loops cannot lift it further; what remains is not mine to close.

## Work order v2

**Rules**

- No merge onto a red `main` except the fix for it.
- At most two PRs open at once, never two on the same hot file (`admin.html`, `handlers/pages.ts`, `display.html`, `lib/event-settings.ts`, `landing.html`).
- A branch is cut from fresh `origin/main` when its story starts, in its own worktree.
- Each story starts with a red test, and its line in `TDD-RED-MAP.md` is updated when it goes green.

**Order**

1. **Green `main`.** Merge PR #834 once its checks pass, then confirm T1 to T4 on the resulting SHA.
2. **PO decisions (one sitting).**
   - What must be on production by 2026-10-24, and the last day to merge before it.
   - Whether stories that widen admin or sponsor reads wait for OSE-1561.
   - Tablet layout a, b or c (OSE-1557).
   - Toast v2: the eight assumptions in OSE-1620.
   - OSE-1518: "plant my flag" URL; confirm check-in first while live; confirm no second partner block.
   - OSE-1519: what a draft may show.
   - OSE-1522: sponsor line on the SharedReport.
   - "Count me in" before the event.
3. **Close-outs, with evidence on each ticket.** OSE-1529, 1526, 1527, 1518, 1519, 1560, 1531 (green at `5febd047`); OSE-1548, 1566; then OSE-1516, 1520, 1522, 1521, 1528 once a green SHA contains them. Promote their red tests (OSE-1568).
4. **Defect first.** OSE-1521: the wizard's TV step drops the `donate` screen.
5. **Build.**
   - `admin.html`, in series: OSE-1528 follow-up, then OSE-1560 leftovers.
   - Own templates, in parallel with that: OSE-1526 Logs slice 2 and OSE-1527 Settings slice 2, each with a Dr of Security pass on what a brand admin may read.
   - `pages.ts` and `public.html`, in series: OSE-1518 and OSE-1519 leftovers, then OSE-1557, each after its decision.
   - `shared-report.html`: the parts of OSE-1531 slice 2 that do not need campaigns.
   - OSE-1524 Live view: after the security decision; counts floored per cell.
   - Toast v2: hub PR, then the pin bump, then adoption. It no longer holds up anything else.
6. **Blocked on backend not on `main`.** OSE-1525 (needs OSE-1552); OSE-1556 (needs OSE-1555 and OSE-1553); the campaign carry-over in OSE-1531.
7. **Rewrite or cancel before any build.** OSE-293, 296, 297, 299 (written for the May plan); OSE-1329 to 1336 (each overlaps shipped work; OSE-1335 contradicts #814).

## What would lift the score

| Closes                          | Action                                                                                                                                                | Owner                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| F1                              | #834 merged; T1 to T4 green on that SHA; read the T0 failure on `8a492993`                                                                            | engineering           |
| F3, F4, F5, F9, F11             | The decisions in step 2, recorded on the tickets                                                                                                      | PO                    |
| F8, F10, F12, F17, base surface | Read the remaining ticket bodies (1591 to 1601, 1578, 296, 297, 299, 1329 to 1334, 1336, and the leftovers of 1516, 1521, 1528) and correct the order | engineering           |
| F4, base environment            | Re-read production state (Access app, founder row, `PRODUCTION_LIVE`)                                                                                 | DevOps                |
| F15, F16                        | A second reviewer re-scores this worksheet                                                                                                            | PO or independent run |

## Limits

One assessor. Severity is judgment. The file lists in F6 predict future conflicts from past PRs. F7's account of the cancelled runs is inferred. The Oct 24 scope in F4 comes from notes three weeks old.

---

# Run 2 — after PR #834 merged

Reviewed: work order v2 against new evidence. Two independent readers went through 33 Linear tickets (the wave tickets, the redesign stories, the mobile tickets and the test tickets). Their reports are model output; the one load-bearing claim (N1) was checked by me on staging. Corrections were made to the plan only.

## Closed since Run 1

| ID                | Closed by                     | Evidence                                                                                                                                                                                                                                |
| ----------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1                | `main` is green               | Run `37425311985` on `f5c954d0`: T1 Deploy, T2 Bruno, T3 Playwright, all three T4 legs, T4 Staging and the reconciler `success`. The "T0 failure" on `8a492993` was a cancelled run (3 jobs cancelled, 12 skipped), not a failing test. |
| F2, F6, F7, F13   | plan                          | Carried into v3.                                                                                                                                                                                                                        |
| F8                | test tickets mapped           | One pyramid ticket per story (OSE-1591 to 1600), browser tests in OSE-1578, levels 1, 3, 6 in OSE-1601. No story names its test ticket in its own text.                                                                                 |
| F10               | mobile tickets read           | OSE-296, 297, 299: each surface is in the audit's list on `main` (`tests/playwright/mobile-workability.spec.ts`). OSE-293 is being done as PR #835.                                                                                     |
| F12               | redesign stories read         | OSE-1331 contradicts #806; OSE-1334 contradicts #811; OSE-1332 is nearly delivered; OSE-1329, 1330, 1333, 1336 are partly delivered and need a rewrite.                                                                                 |
| F17               | leftovers re-read from Linear | See v3.                                                                                                                                                                                                                                 |
| base: environment | production re-read            | `/health`: `env: production`, `version: "main"`, `_debug` still present, so production runs a build older than the health fix. `/admin` answers 401 with no Access redirect. `T1 Deploy → Production` was skipped on this run.          |

## Run 2, Loop 1 — new findings against v2

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Sev           | Evidence                                                                                                                                                                                                                                                                                           | Role                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| N1  | **A live event that is off the map has a dead public page.** Since #809 a new event is off the map unless the organizer chooses otherwise. The page handler returns the not-found page whenever `is_published !== 1`. So the poster codes and short link of such an event lead nowhere, while the admin copy says the links keep working. v2 had this third in the admin lane. It was readable in Run 1 (the 2026-10-04 progress file named it as #809's blocker) and I missed it. | Critical ×1.5 | Staging: `pcard-live-evt` (`active`, `is_published = 0`) returns 404 "We couldn't find that event"; `evt_smoke_post` (on the map) returns 200; `GET /api/v2/events/pcard-live-evt` returns 200. Code: `handlers/pages.ts:2008`. Tests pin the copy only (`create-flow-publication.spec.ts:66-72`). | Lead BE, PO, Sr Automation QA |
| N2  | OSE-1527 Settings slice 2 is blocked by OSE-1553 (brands table, not on `main`). OSE-1526 Logs slice 2 needs a durable record that does not exist (a migration and a backend design). v2 had both as buildable.                                                                                                                                                                                                                                                                     | High          | Linear `blockedBy`; reader report (no store found on `main`)                                                                                                                                                                                                                                       | Lead BE                       |
| N3  | OSE-1560 is blocked by OSE-1564 (toast) in Linear. v2 took the toast off the critical path, so OSE-1560 could never close.                                                                                                                                                                                                                                                                                                                                                         | High          | Linear relation                                                                                                                                                                                                                                                                                    | Lead FE                       |
| N4  | OSE-1548 was moved to Done citing a PR run. The rule asks for a `main` push run. #789 is inside green runs, so the state is right and the cited evidence is wrong.                                                                                                                                                                                                                                                                                                                 | Low           | reader report; not cross-checked                                                                                                                                                                                                                                                                   | PO                            |
| N5  | PR #835's staging baseline is 180 passed, 0 failed, **140 skipped**: admin, SharedReport and sponsor surfaces are not measured on staging. It supports closing the three public-surface tickets, not the epic. The baseline file itself was not read.                                                                                                                                                                                                                              | Medium        | #835 body                                                                                                                                                                                                                                                                                          | Sr SDET/SRE                   |
| N6  | The order has no home. Two PRs (#835, #836) were opened by other sessions while `main` was red and this plan was uncleared. The order lives in a chat and an untracked file that other sessions cannot see.                                                                                                                                                                                                                                                                        | Medium        | `gh pr list`; `git status`                                                                                                                                                                                                                                                                         | DevOps Mgr, PO                |
| N7  | The decision list grew again. New: OSE-1560 (all-day events; does removing the last sponsor turn the map off; the flip when there is no place), OSE-1566 (should the logo proxy answer with the default image, not 502), OSE-1521 (scoreboard; a fundraiser amount on a TV that shows no counts), OSE-1516 (confirm the eight-code layout), OSE-1520 (confirm the "Kind" group is gone and the five chips).                                                                        | Medium        | reader report from ticket comments                                                                                                                                                                                                                                                                 | PO, Dr of Security            |

**Score: v2's 63, less 27.5 closed, plus N1 22.5, N2 10, N3 10, N4 2, N5 5, N6 5 (N7 is counted under the decisions already deducted) = 90. Score 10.** Stop.

## Corrections applied (plan only) → v3

- N1: first in the order, with a red test before the fix.
- N2: OSE-1527 moved to blocked; OSE-1526 slice 2 waits for a backend design.
- N3: OSE-1560 split: the dead-page fix now, the toast part after the toast.
- N5: close OSE-296, 297, 299 only; keep the epic open.
- N7: decisions listed and grouped by what they block.

## Run 2, Loop 2 — pressure pass on v3

| ID  | Finding                                                                                                                                                                                                                                            | Sev                     | Evidence                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------- |
| N8  | A green chain did not catch N1 and will not. No test at any level asks for a live off-map event's page. So "green on `main`" cannot close OSE-1560. Corrected in v3: step 1 adds the test at the worker pool, in Bruno and in the browser journey. | Medium ×1.25, corrected | `git grep` over `workers/oursharedevents/tests` |

Still deducted on v3: F3 5, F4 5, F5 5, F9 2.5, N1's direction 2.5 (all PO); F16 6.25 (the 2026-10-04 review was never closed); base surface 7.5 (OSE-1518 and 1519 bodies, PR bodies, the #835 file and OSE-1386 not read; reader claims other than N1 not cross-checked); N5 2.5; N6 2.5; F15 2; F18 1.25; F14 1; N4 1.
**Score: 100 − 44 = 56.**

## Run 2, Loop 3 — confirmation

No new finding. N1 holds on a second read of the handler. **Score: 56, held.** Of the 44 points, 20 are PO decisions.

## Work order v3 (current)

**Rules** (unchanged): no merge onto a red `main` except its fix; at most two PRs open, never two on the same hot file; a branch is cut when its story starts, in its own worktree; red test first.

1. **Fix the dead page (OSE-1560).** Red test first: create an event with no map choice, take it live, request its page. Then the page of a live off-map event renders by its link and stays off the list, map and sitemap. That is what the shipped copy already promises; it still needs the PO's yes (decision 1). File: `handlers/pages.ts`.
2. **Finish what is open.** #836 (OSE-1521, the wizard dropping `donate`) and #835 (mobile baseline). One at a time; confirm the chain after each.
3. **PO decisions.**
   - Needed now:
     1. A live event that is off the map: reachable by its link (recommended), or hidden.
     2. What must be on production by 2026-10-24, and the last day to merge.
     3. Whether stories that widen admin or sponsor reads wait for OSE-1561.
     4. Tablet layout a, b or c (OSE-1557).
     5. Toast v2: the eight assumptions in OSE-1620.
   - Each blocks one story:
     - OSE-1518: "plant my flag" URL; check-in first while live; no second partner block; "Count me in" before the event.
     - OSE-1519: what a draft may show.
     - OSE-1522: sponsor line on the SharedReport.
     - OSE-1560: all-day events; removing the last sponsor; the flip with no place.
     - OSE-1566: default image or 502 from the logo proxy.
     - OSE-1521: scoreboard; a fundraiser amount on the TV.
     - OSE-1516: the eight-code layout. OSE-1520: the chip set.
4. **Close with evidence** (run `37425311985`, `f5c954d0`).
   - After one check each: OSE-1516 (printed sheet, WebKit), OSE-1529 (Access page text, `#create-event` fragment on staging), OSE-1566 (after its decision).
   - After #835 merges: OSE-296, 297, 299.
   - Cancel as superseded: OSE-1331 (by #806), OSE-1334 (by #811).
5. **Build, unblocked today.**
   - OSE-1520: the landing's empty-window message (`landing.html`).
   - OSE-1528 follow-up (`admin.html`, after #836).
   - OSE-1531: the parts that do not need campaigns (`shared-report.html`).
6. **Build, after its decision.**
   - OSE-1557 tablet (needs a breakpoint in `@ocr/ui`, so a hub change and a pin bump).
   - Toast v2 (hub PR, pin bump, adoption), then the toast part of OSE-1560.
   - OSE-1524 Live view, and OSE-1526 Logs slice 2 once its record store is designed; each with a security pass.
   - OSE-1518, 1519, 1522 leftovers.
7. **Blocked on backend not on `main`.** OSE-1527 (OSE-1553); OSE-1525 (OSE-1552); OSE-1556 (OSE-1555, OSE-1553); the campaign carry-over in OSE-1531 (OSE-1552).
8. **Rewrite before any work.** OSE-1329, 1330, 1333, 1336; OSE-1332 after a typed-link check; the guard text in OSE-1323 and OSE-1324; OSE-292; OSE-1578 and OSE-1591 (trim to what is not yet written).

## What would lift the score from 56

| Points   | Action                                                                               | Owner                 |
| -------- | ------------------------------------------------------------------------------------ | --------------------- |
| 20       | The five "needed now" decisions, recorded on the tickets                             | PO                    |
| 7.5      | Read the last unread bodies and cross-check the readers' "verified not built" claims | engineering           |
| 6.25 + 2 | Close the 2026-10-04 review; a second reviewer re-scores this file                   | PO or independent run |
| 2.5      | Put the order somewhere every session reads (a tracked file or a Linear document)    | PO                    |
| 2.5      | Read #835's baseline and name what the 140 skips cover                               | engineering           |

## Limits (Run 2)

One assessor scored. The two readers' reports were taken as evidence without re-reading each ticket; only N1 was verified independently, on one event on staging. Whether `PRODUCTION_LIVE` is set was not confirmed (the variable list returned nothing).
