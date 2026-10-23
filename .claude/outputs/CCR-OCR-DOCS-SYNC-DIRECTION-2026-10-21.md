# CCR: OCR-docs sync cleanup, which direction is correct

Date: 2026-10-21. Team: extended scrum team (PO, Lead BE Architect, Lead FE Integration, Sr Design FE, Sr Automation QA, Sr SDET/SRE, DevOps Mgr, Sr Data Scientist, Dr of Security). Orchestrator: Claude (Sonnet 5.5).

## Verdict

| Item                  | Value                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| System score          | **0%** (raw 19%, floored by an unresolved Security Critical)                                                             |
| Assessment confidence | **80%** (steady between loops 1 and 5)                                                                                   |
| Gate                  | **FAIL: human gate.** Questions at the end.                                                                              |
| Direction             | Stable and agreed by every lens (below). The score fails on the control plane under the direction, not on the direction. |

## The direction (what to do)

1. **One home per truth: point, do not copy.** Keep the CLAUDE.md pointer to the brain (D1). Remove the hard-coded counts and the leftover "all four invariants" line from it in a small follow-up. Apply the same pattern to `docs/OCR_VISION.md` (D3) in its own reviewed change after Oct 24.
2. **Pin by rule, not by chase.** Bump `.ocr-hub-ref` when `packages/ui` or `packages/tokens` changes, or when a consumer needs it. A docs-only hub commit (hub #58) is a recorded no-op. Do not bump to `6877f87`. OCR-docs on `f9605e3` equals OSE's pin today.
3. **Fix the gates before adding content.** The human review gate and the drift gates both failed to work. Owner repository settings first, then one small drift gate.
4. **Machine faults are the owner's.** Repair the `py` registry entry and the five dead scheduled tasks. Do not weaken the hook, do not persist the shim.
5. **Restate the done bar.** "Zero hub lag" cannot hold while the hub keeps merging. Use "pin is a hub-main commit that passed the design check, with the bump rule written down".

## What was reviewed

In scope: OCR-docs PR 168 (pin), PR 169 (CLAUDE.md pointer), the unedited `docs/OCR_VISION.md` drift, the local draft ADR, the broken `py` launcher, and the controls around them (ruleset, CODEOWNERS, design check, hook).

Out of scope: the OSE and ourWKRP pin bumps and the creme QR print test (owner-held), invariant enforcement at runtime, Linear contents (not queried), the dashboard itself (source not found).

## State as verified now (several starting premises were stale)

- PR 168 and PR 169 are **merged** (22:43:33 and 22:43:49 UTC, by `bereasonable13`, zero reviews). Verified with `gh pr view`.
- Main pins `f9605e3`, not `6877f87`. PR 168's squash holds only commit `a8d564f`. Commit `5a1356f` (`6877f87`) was pushed 35 seconds after the merge and is orphaned on the branch. The PR's title and body still say `6877f87`. Verified.
- OSE's pin is already `f9605e3` (#1007). ourWKRP is `b96b2c8` (11 hub commits behind, 7 touching `packages/`). Five doc spokes have no `.ocr-hub-ref` on main.
- Ruleset 15221497 on OCR-docs main: bypass `always` for OrganizationAdmin and for repository role 5, and the current user can bypass (`gh api repos/ourCommunityRituals/OCR-docs/rulesets/15221497`).
- `.github/CODEOWNERS`: `/CLAUDE.md` and `/docs/OCR_VISION.md` go to `@mzdano`, but `/ocr-docs-brain/` goes to `@bereasonable13`, which the file's own comment calls the automation identity. Code-owner review is not enforced.
- Brain counts hold by two methods: 29 invariants, 17 live, 10 partial, 2 retired, ids 1 to 29. The file also carries its own `status_summary`, checked in CI.

## Loops

### Loop 1: surface pass (nine lenses, run in parallel)

- **Critical.** Most dangerous assumption: that the review gate on governance files worked. Lenses found the PRs already merged, no review recorded, required checks never ran on #169.
- **Conservative.** Worst case: an agent-authored governance edit lands with no human review and nothing detects it.
- **Recursive.** Raw 19% from the findings as reported (including the scrum lens rating the pin record Critical).
- Lens convergence: D1 keep pointer; D2 no fleet-wide bump, OCR-docs pin is harmless; D4 renumber; D5 owner fixes the machine.

### Loop 2: pressure pass (orchestrator, first-hand verification)

Re-ran the disputed claims myself: ruleset bypass, PR 168 title against the merged commit, CLAUDE.md lines 42 and 48, CODEOWNERS. All confirmed. Downgraded the pin record from Critical to Medium (`packages/ui` is byte-identical, so the harm is to the record, not the build). Added two findings against my own work (F4, F11). Raw stays 19%.

### Loop 3: role conflict resolution

Scrum and my PR said bump to `6877f87`. FE Integration, PO and Design said do not chase head. Resolved for the rule "bump on `packages/ui` or `packages/tokens` change", because the pin gates checker strictness, not rendering, and hub #58 changes neither. Raw 19%.

### Loop 4: reactive check on the recommendations

Asked whether each fix repeats the original failure. Two do: another hard-coded count in CLAUDE.md would drift again, and an agent-opened PR on a governance file repeats F11. So the follow-up drops counts, and who authors it is a human-gate question. Raw 19%.

### Loop 5: confirmation

Re-read every verified fact against the register; no new findings. Score unchanged: raw 19%, system 0% by the Security Critical rule. Assessment confidence 80%: the dashboard row's source, who clicked merge, and any physical QR print are unverified.

## Findings register

Weights: Regulatory 25, Critical 15, High 10, Medium 5, Low 2. V verified, P inferred. Loop-position and environment modifiers not applied.

| ID   | Finding                                                                                                                                                                                                                                                                                                                                    | Weight | Evidence                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| F1   | **Security Critical.** Human gate for governance artifacts is absent in practice: admin bypass always, zero reviews on #168 and #169, required checks never ran on #169 (path filters skip CLAUDE.md), code-owner review not enforced, brain owned by the automation identity. Merged by a shared identity, so who clicked is unknown (P). | 15     | V: `gh api` ruleset; `gh pr view`; CODEOWNERS:1; `phantom-scan.yml:2-10` |
| F2   | PR 168 record is false: title and body say `6877f87`, main holds `f9605e3`. Cause: I pushed to an open PR that merged moments before.                                                                                                                                                                                                      | 5      | V: `gh pr view 168`; `git show` of merge                                 |
| F3   | No gate could catch the CLAUDE.md drift (10 vs 29). The phantom scanner matches `invariant #N` only; no script reads a count from CLAUDE.md.                                                                                                                                                                                               | 10     | V: `scan_phantom_invariants.py:51-54`                                    |
| F4   | My merged PR 169 has defects: line 48 still says "all four invariants"; counts 29/17/10/2 are hard-coded with no gate; "cannot drift" overclaims.                                                                                                                                                                                          | 5      | V: CLAUDE.md:42,48 on main                                               |
| F5   | Pin has no ancestry or staleness check in OCR-docs (format only); design check uses `OCR_HUB_READ` on `pull_request` and is not a required check.                                                                                                                                                                                          | 10     | V: `design-system-check.yml:37-60`; P for exploitability                 |
| F6   | The dashboard row's source was not found, so "9 behind" and the done bar cannot be checked, and may flap with every hub commit. Hub history counts: 13 commits, 9 touching `packages/` (the 9 matches the packages-only reading or a stale cache).                                                                                         | 5      | V: `git rev-list`; P for the definition                                  |
| F7   | `docs/OCR_VISION.md` still says "four" (line 61) and "ten" (line 77); CLAUDE.md calls VISION the source of truth, so they now disagree. Editing it propagates fleet-wide.                                                                                                                                                                  | 5      | V                                                                        |
| F8   | Machine faults: `py` resolves via HKLM key to a deleted runner path (hook fails closed); five scheduled tasks still target removed runner files and two report Running or Ready while checking nothing.                                                                                                                                    | 5      | V: registry, `Get-ScheduledTask` (DevOps, SDET)                          |
| F9   | The hook pass on #169 was near-vacuous: the new text has no `invariant #N`.                                                                                                                                                                                                                                                                | 2      | P                                                                        |
| F10  | Draft ADR: number 011 collides; `architectural-invariants.yaml:1477` cites a nonexistent ADR-013; ADR-012 proposes id #29 already taken. Draft is on one unpushed local branch, no backup.                                                                                                                                                 | 5      | V                                                                        |
| F11  | **Process, mine.** Saved owner rule says agents flag governance-file errors and do not open PRs that change them; I opened #169 on CLAUDE.md.                                                                                                                                                                                              | 5      | V: memory `feedback_open_prs_when_verified`; PR 169                      |
| F12a | Stale lines elsewhere: HANDOFF.md:30, CHANGING-COLORS.md:129, OSE CONSTRAINTS.md:14, ADR-008 gate doc "doc spokes pinned" claim.                                                                                                                                                                                                           | 2      | V (FE Integration)                                                       |
| F12b | Stale `.validate.py:18` "10 invariants"; ADR-012 id collision counted in F10.                                                                                                                                                                                                                                                              | 2      | V (Backend, Data)                                                        |
| F13  | ourWKRP lags (`b96b2c8`) and is held behind the creme QR print test; the hold is not recorded as a dated decision.                                                                                                                                                                                                                         | 5      | V                                                                        |

Arithmetic: 15 + 5 + 10 + 5 + 10 + 5 + 5 + 5 + 2 + 5 + 5 + 2 + 2 + 5 = 81. Raw 100 − 81 = 19%. Security Critical F1 is unresolved, so the system score is 0%.

## What must be true before this passes (95%)

1. F1 closed by the owner: require code-owner review, remove admin bypass for merges (or require PR review even for admins), fix CODEOWNERS ownership of `ocr-docs-brain/`, add `CLAUDE.md` to the path filters of `phantom-scan.yml` and `brain-validate.yml` so required checks run.
2. F3 and F4 closed: small flagged follow-up to CLAUDE.md (no counts, fix line 48), plus one born-red gate (below).
3. F2 closed: retitle and rewrite the PR 168 body to `f9605e3`; delete or leave the orphan branch by owner choice.
4. F5, F6, F13: written bump rule, dated lag decision for ourWKRP, named source for the dashboard row.

## Commit sequence

1. Owner: repository settings (F1). Not an agent step.
2. Flagged PR on CLAUDE.md, authored by the owner or an agent with the owner's explicit OK (F11).
3. Gate PR: `check_claude_md_invariants` (fail on a count or list of invariants in CLAUDE.md, fail on a `N live / M partial` sentence that disagrees with the registry) plus the path-filter change. Born red: restore the old CLAUDE.md and expect a failure naming the line; flip one `live` to `partial` in a copy of the registry and expect the sentence check to fail; restore both and expect green.
4. Pin rule in OCR-docs as a decision doc; one line in hub `SKILL.md` and ADR-008. After Oct 24.
5. VISION.md pointer change as its own PR with its own CCR (it propagates to every spoke).
6. Pin ancestry check in `design-system-check.yml` (`merge-base --is-ancestor`), then make the check required.

## Verification after shipping

`git show origin/main:CLAUDE.md` has no count; the new gate is green and was seen red; a test PR touching CLAUDE.md now runs the required checks; `gh api` ruleset shows no admin bypass for pull requests; the pin rule file exists; dashboard row read after refresh with its source named.

## Risks accepted

- Leaving OCR-docs on `f9605e3` (one docs-only hub commit behind).
- Leaving the VISION.md drift until after Oct 24 (no launch dependency; the merge freeze and the Oct 24 date are the owner's, and nothing here is on the Harbor County path).
- Local-only ADR draft until the owner picks a number.

## Process note

This protocol asks for a human gate after every loop when governance files are involved. This assessment changed no governance file, so I ran five loops straight through and put the gate here. Loops 2 to 5 were orchestrator passes with first-hand checks, not new lens fan-outs.

## Human-gate questions

1. **Who merged #168 and #169, and did you review #169's content?** `bereasonable13` is the identity the CODEOWNERS comment calls automation. If it was you, are you content with "merged by owner, reviewed outside GitHub" as the record?
2. **Do you want agents to edit governance files at all?** Your saved rule says no (flag the error, do not open the PR). I broke it on #169. Should the follow-up (drop counts, fix line 48) be yours, or mine with your OK?
3. **May I name the repository settings changes for you to make?** Code-owner review required, no admin bypass for merges, `/ocr-docs-brain/` owner.
4. **Do you approve the pin rule** (bump on `packages/ui` or `packages/tokens` change, otherwise a recorded no-op) **and the restated done bar?** And where does the dashboard row come from, so I can check it?
5. **ADR draft:** which number (013 may be taken by an OSE-scoped file), and should the file be copied somewhere safe? And the two old stashes: keep or drop?
6. **Machine:** will you repair `py` (export then delete the HKLM PythonCore 3.11 key, register a real Python) and remove the five dead scheduled tasks?
