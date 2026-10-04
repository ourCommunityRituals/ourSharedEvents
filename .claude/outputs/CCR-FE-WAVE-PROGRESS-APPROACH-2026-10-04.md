# CCR — front-end wave progress and approach (extended scrum team, 3 loops)

Date: 2026-10-04 (replaces the earlier 2-pass draft). Type: Standard assessment, assessment only: **no fixes were applied between loops** (PO instruction: fixes come after). Reviewed: the progress snapshot (PR #799), the OSE-1558 work (`fe/body-200-percent`, commit `357d3145`, local only) and the plan to run Wave 1 follow-ups (OSE-1557, 1558, 1518, 1519) plus the nine in-progress tickets (1518, 1519, 1520, 1522, 1548, 1566, 1556, 1560, 1564, 1568) in one session.

Roles: PO, Lead BE, Lead FE Integration, Sr Design FE, Sr Automation QA, SRE/SDET, DevOps, plus Dr of Security, Sr SDET/SRE, DevOps Mgr, Sr Data Scientist.

## Loop 1 — surface pass

| ID  | Finding                                                                                                                                                                                                                                           | Sev    | Evidence                                                                                                | Role                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| F1  | The local `../packages/ui` is not the pinned `@ocr/ui` (`.ocr-hub-ref` = `265a549`). Local results there are not CI's verdict.                                                                                                                    | High   | `git diff 265a549 -- packages/ui/src`: 3 files; run 1 vs run 2 of the 200% test gave different failures | DevOps Mgr, Sr Design FE          |
| F2  | OSE-1558 cannot merge: compacted CSS makes the design ratchet report shrunk debt (`public.html` 6817→6570, `sponsor-home.html` 3270→2555); lint fails until `.ocr-design-check.json` is lowered. The edit was denied by the auto-mode classifier. | High   | design-check output; denial                                                                             | Sr Design FE, DevOps              |
| F3  | OSE-1557 (tablet) has no PO decision recorded; its own DoD needs one.                                                                                                                                                                             | High   | OSE-1557 description                                                                                    | PO                                |
| F4  | Merge pacing: runs on `main` are cancelled by the next merge, so Done evidence can be lost.                                                                                                                                                       | Medium | runs for `bb412b4`, `c9fcf5e` cancelled                                                                 | SRE/SDET                          |
| F5  | Conflict hot spots recur: `CLAUDE.md` §3, line-keyed INV9 exemptions (re-keyed by hand in #774), `a11y-profile.spec.ts`, `public.html`, `sponsor-home.html`.                                                                                      | Medium | #774 follow-up commit                                                                                   | Lead FE, Sr Automation QA         |
| F6  | 1558 was verified on Chromium `a11y-profile` (33/33) and 3 worker specs only. No WebKit, tablet, full worker pool, or pyramid levels 1/3/6.                                                                                                       | Medium | commands run                                                                                            | Sr Automation QA                  |
| F7  | The snapshot is hand-written, so it goes stale; #799 sits on a branch whose work merged as #798.                                                                                                                                                  | Low    | PR #799                                                                                                 | PO                                |
| F8  | OSE-1548 / OSE-1566 merged but still In Progress; acceptance criteria unchecked.                                                                                                                                                                  | Low    | Linear                                                                                                  | PO                                |
| F9  | Security / data: 1558 is CSS only; no API change, no new script or style source; no measurement impact.                                                                                                                                           | none   | diff                                                                                                    | Dr of Security, Sr Data Scientist |

Layers: Critical (most dangerous assumption: "local green = CI green" → F1, unverified); Conservative (worst case if wrong: a PR passes locally, fails the ratchet and wastes a staging cycle → F2); Recursive (first-pass confidence not yet testable).
**Score: 100 − 10 − 10 − 10 − 5 − 5 − 5 − 2 − 2 = 51.** Below 95; the protocol says stop and surface. (No fixes applied, per instruction; Loop 2 continues on the same evidence base.)

## Loop 2 — pressure pass (what Loop 1 missed)

| ID           | Finding                                                                                                                                                                                                                                                                                                                               | Sev              | Evidence                                         | Role                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------ | -------------------- |
| F4 (revised) | **Correction to my own earlier claim.** The staging chain _is_ green for `d52e475`, which contains #774 to #797: T1 Deploy, T2 Bruno, T3 Playwright, all four T4 jobs `success`. So the merged wave items are Done-eligible now under the OSE-1443 rule, and #799's "nothing can be closed" text is wrong. Merge pacing drops to Low. | Low (was Medium) | `gh run view 37195677105` jobs                   | SRE/SDET             |
| F10          | The false statement is in a shipped artifact (#799 snapshot, "Staging chain" paragraph and the 🟡 markers) and in my earlier reply. Anyone reading it would leave 10 slices open that can close.                                                                                                                                      | Medium           | `.claude/outputs/FE-WAVE-PROGRESS-2026-10-04.md` | PO                   |
| F11          | The full worker-pool run for 1558 was started but its result was not read. Repo notes say tests pin CSS formatting (`.prettierignore`), and I collapsed 33 CSS rules by script. Unverified, not known-good.                                                                                                                           | Medium           | task `b76py4blm`, output unread                  | Sr Automation QA     |
| F12          | OSE-1566's DoD has a third item (explain/fix the second-visit failure of the real logo) that #790's title does not mention; OSE-1548's DoD needs measured contrast and the 400-char budget. Neither can be closed on the merge alone.                                                                                                 | Medium           | OSE-1566 / OSE-1548 descriptions                 | PO, Lead BE          |
| F13          | Scope is estimated from 4 of 13 ticket bodies (1558, 1557, 1518, 1519 read in full). 1520, 1522, 1556, 1560, 1564, 1568 remaining scope is unknown; 1556 and 1564 carry pyramid tickets (1599, 1600) as DoD.                                                                                                                          | Medium           | Linear reads                                     | PO, Sr Automation QA |

Layers: Critical (F4 revision shows an assumption I had stated as fact was false); Conservative (F11/F12: closing stories on merge alone would produce false Done); Recursive (confidence fell because more was checked, not because the work got worse; that is the loop doing its job).
**Score: 51 + 3 (F4 5→2) − 5 (F10) − 5 (F11) − 5 (F12) − 5 (F13) = 34.** Dropped from Loop 1: the protocol reads this as "stop"; here the drop is new findings, not regression.

## Loop 3 — confirmation pass

| ID  | Finding                                                                                                                                                                                                                                  | Sev | Evidence     | Role                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------ | -------------------------- |
| F14 | Agent-side gate edits are not reliable: the classifier denied the ratchet edit and a following read-only command. The same may happen on INV9 exemption re-keys or the testids registry. The plan must not assume I can edit gate files. | Low | denial       | DevOps Mgr, Dr of Security |
| F15 | Merging to `main` is a shared, outward-facing action. "Merge without conflicts" can be proven before merge (`git merge-tree`), but the merge itself needs the user's go-ahead per PR or a stated batch rule.                             | Low | system rules | PO                         |
| F16 | Single assessor applying role lenses; severity calls are judgment. Near-threshold scores need a second reviewer.                                                                                                                         | Low | protocol §7  | all                        |

Layers: Critical (is any load-bearing claim still unverified? F2 root cause is verified; F11 is not); Conservative (worst case: one of F2/F3 stays open and the whole chain waits); Recursive (no finding was downgraded without evidence except F4, which has it).
**Score: 34 − 2 − 2 − 2 = 28.** Verdict: **not ready; 28%.** The work already merged is sound; the approach and the record around it are what fail the gate.

## Solution plan to exceed 95%

Residual risk that cannot be removed by action: F16 (2) and, until a second reviewer signs, nothing else. A target score therefore needs every other finding closed **with evidence** (a closed item is only a deduction removed if its evidence is cited in the re-scored worksheet). Projected final: 100 − 2 (F16) − 2 (F14 until a gate edit is actually made by a human) = **96**.

### Phase 0 — user decisions (blocks everything else; ~5 minutes)

| Closes | Action                                                                                                             | Evidence required                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| F2     | Lower `public.html` → 6570 and `sponsor-home.html` → 2555 in `.ocr-design-check.json` (or authorize me to)         | design-check prints OK on the LF copy and in CI lint |
| F3     | Decide OSE-1557: (a) widen the column to a tablet measure (recommended), (b) two columns, (c) forms and admin only | decision recorded in the Linear ticket               |
| F15    | Say how merges are authorized: per PR, or "merge when S0, T0, reconciler and Invariant #22 are green"              | stated rule                                          |

### Phase 1 — verification, no new product code

| Closes  | Action                                                                                                                                                                                                                  | Evidence required                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| F4, F10 | Move the merged wave items to Done (all in `d52e475`): OSE-1431, 1514, 1515, tablet audit, 1513 (already), 1559 (already); then regenerate the snapshot from `gh` + Linear instead of hand-writing it, and correct #799 | `gh run view` jobs listing in the PR body; snapshot script output |
| F11     | Re-run the full worker pool for 1558 and read the result                                                                                                                                                                | pass count in the PR body                                         |
| F6      | Run `mobile-webkit` and `tablet-chromium` for 1558, plus the full `mobile-workability` spec                                                                                                                             | log lines                                                         |
| F8, F12 | Check OSE-1548 and OSE-1566 DoD line by line; close those that are met; for 1566 explain or fix the second-visit logo failure under its own test                                                                        | per-line evidence comment on each ticket                          |
| F13     | Read the six unread tickets; write scope and a pyramid-matrix per ticket into the plan (one line per level 1–7, N/A with a reason)                                                                                      | updated plan table                                                |
| F1      | Document the pinned-UI setup (`ocr-pin`) in the local runbook (`docs/runbooks/`), and add a check at test start that warns when `../packages/ui` differs from `.ocr-hub-ref`                                            | runbook diff; warning visible                                     |

### Phase 2 — build, in this order, one branch per story from a fresh `origin/main`

1. **OSE-1558 + OSE-1520 + OSE-1522 on one branch** (same files: events card, sponsor home). Done when: 200% test whole-page and red-first, one event card markup, sponsor by title, pyramid matrix filled.
2. **OSE-1519** (non-public scan page; decide what a draft may reveal: recommend nothing, a generic "not open yet" without the name).
3. **OSE-1518** remaining parts (5Ws, three choices, register first, next at this venue).
4. **OSE-1560**, **OSE-1556**, **OSE-1564** (each with its pyramid ticket, 1599/1600).
5. **OSE-1557** after the Phase 0 decision, built against the chosen layout.
6. **OSE-1568** last; it maps the others, so it must read the final state.

**No-conflict protocol per branch (closes F5):** `git fetch origin && git rebase origin/main` before the first commit and again before the push; `git merge-tree --write-tree origin/main HEAD` must exit 0 before the PR is opened; INV9/testids registries regenerated after the rebase, not before; no branch touches `CLAUDE.md`; merge in batches of 2 to 3 so a `main` staging run can finish (F4).

### Phase 3 — close-out

| Closes | Action                                                                                         | Evidence                       |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| F4     | For each merged batch, confirm T1–T4 green on a `main` SHA that contains it, then move to Done | `gh run view <id> --json jobs` |
| F5     | One `CLAUDE.md` §3 update at the end, as a governance doc (5+ loop CCR)                        | PR                             |
| F16    | Second reviewer (human or independent agent run) re-scores this worksheet after Phase 3        | signed worksheet               |
| all    | Re-run this CCR: three loops, same roles; ship only at ≥ 95% held across two consecutive loops | new worksheet                  |

### What would still stop the plan

- Phase 0 left open (F2, F3, F15): the chain waits on you, not on engineering.
- A classifier denial on a gate file (F14): that edit then goes to you, with the exact diff.
- A staging run cancelled by a merge: re-merge pacing, no skipped evidence.

## Limits

Single assessor; severity is judgment; Loop 3's list is bounded by what I read, not by what exists (F13 is the clearest example). The 95% target is only meaningful if each closed finding carries the evidence named above.
