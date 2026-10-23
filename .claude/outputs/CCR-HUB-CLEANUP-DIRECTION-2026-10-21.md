# CCR: direction for the post-sync hub cleanup

Date: 2026-10-21. Requested by: owner ("run a CCR assessment with extended scrum team to determine the correct direction"). Classification: destructive local housekeeping, no code or governance file changed. Run at 3 loops (bug-fix level, raised for irreversible deletion). No governance-file human gate applies; the 95% gate does.

**Status (2026-10-22):** no worktree has been removed yet; all 63 are still in the relocated folder. A later pass classified them by PR state (see `CCR-WIP-WORKTREE-LAYOUT-2026-10-22.md` for the layout decision). The bundles and ref snapshots named below are local files on the owner's machine.

## Verdict

| Item                         | Value                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Recommended direction        | **Bundle first, then remove only the clean and idle worktrees, keep every branch. Defer pushing, branch deletion and archive deletion.** |
| System score (loop 3)        | **78%**                                                                                                                                  |
| Assessment confidence        | 85% (most findings proven by read-only git; contents of ignored files and the `.npmrc` value were not read)                              |
| Gate                         | **Below 95%: human gate open.** Four owner questions below.                                                                              |
| Security Critical unresolved | None confirmed. One unverified item (F2) needs the owner to look.                                                                        |

A CCR score is a signal, never permission.

## What was reviewed

In scope: the 63 worktrees relocated to `C:\Users\mzdan\dev\ourCommunityRituals.worktrees\_relocated-2026-10-21` (8.1 GB; C: has 613 GB free), the branches `backup/local-main-2026-10-21`, `feat/ocr-design-system-colors`, `docs/hub-governance-files`, the archive at `C:\Users\mzdan\dev\_hub-untracked-archive-2026-10-21`, and the 216 local branches that carry commits on no remote (ourSharedEvents 196, OCR-docs 13, ourWKRP 7).

Out of scope: the hub dashboard row (already met: hub clean, level with origin/main, 4 of 4 governance files after PR #58), the 4 `.claude/worktrees` agent trees, any CI change.

Correction to the briefs: the count is **63** worktrees, not 58 (confirmed by Product Owner, Dr of Security and SDET/SRE).

## Options considered

| Option                                                                     | Result                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A. `git worktree remove` (no force) on clean idle worktrees, keep branches | **Recommended**, after the bundle                                          |
| B. Keep everything                                                         | Safe, but leaves "clean up can begin" unanswered                           |
| C. Push the unpushed branches, then remove                                 | **Deferred.** Push protection is off on 3 repos; about 216 CI runs         |
| D. Delete branches                                                         | **Rejected for now.** Only path that loses data                            |
| E. Delete the archive                                                      | **Deferred.** Safe but no benefit; keep until the backup branch is deleted |

## Loop 1: surface pass (team: PO, Backend Architect, DevOps, SDET/SRE, Automation QA, Dr of Security)

Frontend Integration, Design FE and Data Scientist lenses: no finding. Nothing here touches a surface, a token, or a published count.

**Critical.** The most dangerous assumption was that removing worktrees risks work. It does not: a worktree is a checkout, commits live in the shared `.git`. Proven by Backend Architect and SDET/SRE. The real exposure is that 430 commits across 196 ourSharedEvents branches exist only on this disk (0 stashes).

**Conservative.** Worst case if the disk dies tomorrow: A, B and "C skipped" all lose those commits equally. Removing a worktree adds no loss. Only D (and the unreviewed `git gc --prune=now`) can destroy commits.

**Recursive.** Role findings merged:

- Dr of Security: all 4 repos private; push protection disabled on ourSharedEvents, OCR-docs and ourWKRP; no secret-shaped file names in the 216 branches or the archive; a commented `_authToken` line in `_ose1030-wt/.npmrc`.
- DevOps: pushing starts about 90 `security-regression` runs (`claude/**` trigger) plus ourWKRP runs; no script or process references the moved paths; bundle first.
- Backend Architect: refs survive removal; no relocated tree is locked or mid-merge; the backup branch and both orphan copies are recoverable from OCR-docs and PR #52; ignored files are lost on removal.
- SDET/SRE: five dirty worktrees hold the only copy of their uncommitted files; `_hubread-wt` (24 files) is not proven superseded.
- Automation QA: sampled FE-wave branches were squash-merged and lack no tests that main has; `git cherry` and branch counts give false results after a squash, so a "nothing lost" check built on them can pass when something was lost; `feat/scan-read-cache` is real unmerged work but is on origin.
- Product Owner: the stated goal is already met; D, C and E are unrequested extras; A is in scope.

Conflict reconciled: SDET/SRE recommended pushing first; DevOps and Dr of Security showed pushing is not free (CI load, no push protection). A local bundle gives the same recovery value without either cost. Direction: bundle, not push.

Score after loop 1 (before mitigation): 100 − (F1 10 + F2 5 + F3 10 + F4 5 + F5 2 + F6 5 + F7 2 + F10 2) = **59%**. Below the gate, as it should be at this stage.

## Loop 2: pressure pass

Reactive changes from loop 1:

- Created and verified a bundle per repo (`git bundle verify` ok): hub 3.3 MB, OCR-docs 1.7 MB, ourSharedEvents 19.1 MB, ourWKRP 1.2 MB, in `C:\Users\mzdan\dev\_repo-bundles-2026-10-21`. Saved ref snapshots (192, 193, 1104, 111 refs), the unpushed-commit lists (6, 16, 430, 13 commits) and empty stash lists beside them. No repo state was changed.
- Fixed the eligible set: 63 minus 5 dirty minus 3 active in the last day = **55 worktrees** (`eligible-worktrees.txt`). The 4 `.claude/worktrees` agent trees (two with merge in progress) stay out entirely.
- Replaced the weak check. Removal does not change refs, so the proof is: every SHA in `*.unpushed-before.txt` still passes `git cat-file --batch-check`. This can fail (a deleted branch plus `gc` would make SHAs go missing). The script does this; not yet seen failing (F6 residual).
- `.npmrc` shape check, without printing the value: `_ose1030-wt/.npmrc` has one commented line whose value is 26 characters, not an environment placeholder and not an `npm_` token shape. Inconclusive. One uncommented line is an environment placeholder (fine).

Conservative: worst case for A on the 55 is loss of ignored local state. Dr of Security found `.wrangler` D1 SQLite files (up to about 0.9 MB) in 17 worktrees; all other ignored items are build output (`node_modules`, `dist`, `__pycache__`, `.husky/_`, reports). All regenerable; recreating a worktree is `git worktree add` plus `npm ci` (about 20 s).

Score after loop 2: 100 − (F1 10 + F2 5 + F4 5 + F5 2) = **78%**. F3 no longer counts against the plan because the plan does not push. F6, F7, F10 resolved.

## Loop 3: confirmation

Re-checked that nothing the loop 2 steps did changed any ref (the bundle and snapshot steps are read-only). Confirmed the recommended plan changes no branch, no tag, no remote and no dirty tree. No new finding. Score unchanged at **78%**; the remaining deductions are all owner actions, not defects in the plan.

## Findings register

| ID  | Severity | Finding                                                                                                                                                                                   | Status                                                            | Weight |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| F1  | High     | 430 commits (196 branches) in ourSharedEvents, plus 16 and 13 in OCR-docs and ourWKRP, exist only on this disk. The bundles are on the same disk, so they do not cover disk loss.         | Open: needs an off-disk copy                                      | 10     |
| F2  | Medium   | `_ose1030-wt/.npmrc` carries a commented `_authToken` line with a 26-character literal value, in a commit already on a remote. Contents not read. Could be a placeholder or a real token. | Open: owner looks, rotates if real                                | 5      |
| F3  | High     | Push protection is disabled on ourSharedEvents, OCR-docs, ourWKRP. Only the hub has it. Blocks option C.                                                                                  | Open but not scored: the plan does not push                       | 0      |
| F4  | Medium   | Removal deletes ignored `.wrangler` D1 state in 17 worktrees (regenerable).                                                                                                               | Open: owner accepts or excludes those 17                          | 5      |
| F5  | Low      | `_hubread-wt` (24 changed files) not proven superseded by merged PRs #994/#995.                                                                                                           | Kept in place; open                                               | 2      |
| F6  | Medium   | "Nothing was lost" checks built on `git cherry` or branch counts fail the wrong way after squash merges.                                                                                  | Resolved for A by the SHA-existence check; born-red not yet shown | 0      |
| F7  | Low      | Briefs said 58 worktrees; actual 63.                                                                                                                                                      | Resolved                                                          | 0      |
| F8  | Low      | A classifier denial gates removal, not pushing.                                                                                                                                           | Informational                                                     | 0      |
| F9  | Low      | `feat/scan-read-cache` has unmerged specs.                                                                                                                                                | Resolved: copy exists on `origin/feat/scan-read-cache`            | 0      |
| F10 | Low      | Two orphan copies (`_cadence-wt`, `_ocr145-wt`) and the backup branch hold nothing unrecoverable. 162/162 and 170/173 tracked files hash into OCR-docs history; 3 missing are `.pyc`.     | Resolved                                                          | 0      |

Arithmetic: 100 − 10 − 5 − 5 − 2 = **78**.

## What must be true before shipping (running the removal)

1. The four bundles verify (done).
2. No process references the worktrees folder (the script checks).
3. The 5 dirty and 3 active worktrees and the 4 `.claude/worktrees` trees are not touched (they are not in the eligible list).
4. No `--force`, no `git gc --prune=now`, no branch deletion.
5. Owner answers the human-gate questions below.

## Sequence

1. Done: bundles and snapshots.
2. Owner copies `C:\Users\mzdan\dev\_repo-bundles-2026-10-21` to a second location off this disk (clears F1).
3. Owner looks at the `.npmrc` line (F2).
4. Dry run: `hub-cleanup-remove-clean-worktrees.ps1`, a local one-off script that is not committed to the repo (it names paths on the owner's machine).
5. Apply: same command with `-Apply`. It prints the count of missing commits per repo; it must read 0 for all four.
6. Later, separately, after Oct 24: decide C, D, E.

## Verification after shipping

- `unpushed commits missing after removal = 0` for all four repos.
- `git worktree list` in each repo shows no entry under the removed names; the 8 kept ones still resolve.
- `git -C C:\Users\mzdan\dev\ourCommunityRituals status --short` is still empty and level with origin/main.
- Born-red: before trusting the check, feed the `cat-file --batch-check` pipeline one fake SHA (for example `0123456789abcdef0123456789abcdef01234567`) and confirm it prints `missing`. Not yet run.

## Risks accepted (pending owner)

- Loss of 17 trees' local `.wrangler` D1 files (F4).
- The 216 local-only branches stay local-only until the owner chooses to push (F1, F3).

## Human-gate questions

1. **F1:** Copy `_repo-bundles-2026-10-21` to a second disk or cloud location, or accept that disk loss would lose 430 commits? Information that would close it: the location.
2. **F2:** Does `_ose1030-wt/.npmrc` line with `_authToken` hold a real token? Open the file in your own terminal (do not paste it here). If real, rotate it. Gap appeared in loop 1, Dr of Security layer.
3. **F4:** Accept loss of local `.wrangler` D1 state in 17 worktrees, or exclude them from the removal list?
4. **Scope:** Run the dry run and the `-Apply` yourself (the classifier refuses removal when I run it), or add a permission rule for that script?
