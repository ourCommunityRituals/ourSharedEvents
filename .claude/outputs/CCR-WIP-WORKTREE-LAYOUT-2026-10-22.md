# CCR: where WIP git worktrees live across the hub and spokes

Date: 2026-10-22. Requested by: owner ("run a CCR assessment with 3 loops looking for the proper solution with the extended scrum team"). Classification: workstation convention plus small config changes in four repos, no governance file edited; run at 3 loops as requested. Reactive correction applied between loops.

## Verdict

| Item                         | Value                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recommended solution         | **One default: `<app>/.claude/worktrees/<short-name>` (option X), hardened with the fixes below, plus one exception: any worktree that will hold long-lived UNCOMMITTED work goes outside the repo (option Y). Plus a post-merge cleanup rule.** |
| System score (loop 3)        | **81%**                                                                                                                                                                                                                                          |
| Assessment confidence        | 85% (git hazards proven in a scratch repo, the gate failure proven by running it, the rest read from source; two items are inference only)                                                                                                       |
| Gate                         | **Below 95%: human gate open.** Five owner questions below.                                                                                                                                                                                      |
| Security Critical unresolved | None.                                                                                                                                                                                                                                            |

A CCR score is a signal, never permission.

## Options

| Option | Where                                                           | Result                                                                      |
| ------ | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| X      | `<repo>/.claude/worktrees/<name>`                               | **Default.** Tool-native, auto-cleaned, needs hardening                     |
| Y      | `C:\Users\mzdan\dev\ourCommunityRituals.worktrees\<app>\<name>` | **Exception** for long-lived uncommitted work                               |
| Z      | new visible `wip/` in each repo                                 | Rejected by DevOps and Product Owner: a new convention, still needs ignores |

## Team and reports (loop 1, all nine lenses)

PO, Backend Architect, Frontend Integration, Design FE, Automation QA, SDET/SRE, DevOps, Data Scientist, Dr of Security. Each ran read-only (the Backend Architect used a throwaway repo). Evidence below is tagged **proven** (a command and its output) or **source** (read from files).

## Loop 1: surface pass

**Critical.** The most dangerous assumption was that a folder layout is the problem. It is not (earlier finding: the median merged worktree sits 18 days past its last commit; nothing removes it). The second assumption, that option X is harmless because 54 already exist there, is false.

**Conservative.** Worst cases found:

- **Proven, High:** `node scripts/guard-no-gas.js` exits 1 today: 7,484 findings in 1,213 files, every path under `.claude/worktrees/`. It walks from the repo root and does not skip the folder. CI checks out clean, so this is local only, but it grows with every worktree.
- **Proven, High:** `git clean -ffdx` (double force) deletes nested worktree checkouts, leaves dangling registrations, and loses uncommitted files. Single-force `-fdx`, `stash -u`, `add -A`, `gc` and `prune` leave them alone. Option Y is immune.
- **Source, Medium:** OCR-docs `security_gate.py` and `pragma_audit.py` skip any path with a part named `worktrees`, and the path includes the root's own absolute parts, so a run from a worktree at X could scan zero files and pass. This is the green-while-skipping class. The runtime proof failed because the Python launcher on this machine is broken.
- **Source, Medium:** the hub's ESLint, `.gitignore` and `.vscode` settings have no exclusion for the folder; five spokes have no `.gitignore` at all.
- **Proven, Medium:** `LongPathsEnabled=0`. Longest path inside a worktree is 197 characters. Agent-named worktrees at X reach about 293, at Y about 285, main is 251. Both exceed 260.

**Recursive.** What does not decide it:

- `@ocr/ui` resolution: existing worktrees use junctions made by `npm run worktree:link-deps`, which point at an absolute path, so it works at any depth. A bare `npm ci` in a worktree fails at X and Y alike.
- Fixed ports 8787 and 8789 collide between simultaneous worktrees in either location.
- Hub design tooling: `tokens:check:raw` skips dot-directories; no effect.
- Data and published counts: none read from the file tree; no effect.
- Policy gate: not installed on this machine (proven: no hook folder, no reference in user settings), so it enforces nothing at X or Y.

Score after loop 1 (before any fix): **55%** (arithmetic in the register).

## Loop 2: pressure pass (reactive changes from loop 1)

Questions loop 1 raised, and what was found:

- **Can the tools be pointed elsewhere?** Official docs (fetched today): the CLI, the EnterWorktree tool and subagents default to `<repo>/.claude/worktrees/`. The desktop app also defaults to `<project>/.claude/worktrees/` and has a **Worktree location** setting in Settings > Claude Code; the CLI has no location setting except a `WorktreeCreate` hook. So X is what the tools produce regardless of what we choose, and the gate and git hazards exist today.
- **Does cleanup favor X?** Yes. Claude Code removes empty subagent worktrees and sweeps old ones older than `cleanupPeriodDays` when they hold no work. The sweep skips worktrees created outside Claude Code, so anything at Y needs our own cleanup.
- **How big is the clutter at X now?** 76 folders in `.claude/worktrees`, 54 registered, 37 named `agent-*`. 22 are unregistered: 21 empty and one copy (`ose-1194-self-hosted-retirement-d851d1`, about 1,372 files, no git link).
- **Reconciled conflicts:** Backend Architect and Dr of Security leaned to Y; Product Owner and DevOps leaned to X. Resolution: the exposures at X exist today whatever we choose (agents create worktrees there), so the fixes are no-regret; the one hazard a fix cannot remove is uncommitted work lost to a double-force clean, so that case gets Y.

Conservative: worst case for the recommended plan is a person running `git clean -ff` in a repo that has uncommitted work in a nested worktree. The policy gate that could block it is not installed here, so the guard is a written rule and the commit-WIP habit only.

Score after loop 2: **76%**.

## Loop 3: confirmation

Re-checked that the plan makes no destructive change by itself (it is a convention plus four small PRs, applied later) and that no loop-2 reconciliation contradicted a loop-1 proof. One attempted proof (the OCR-docs silent-pass) remains inference because the Python launcher is broken here. No new finding. Score **81%**; every remaining deduction is an owner action or an unproven inference, not a defect in the direction.

## Findings register

| ID  | Severity | Finding                                                                                       | Evidence                     | Loop-3 status                                                                                                                                    | Weight                            |
| --- | -------- | --------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| F1  | High     | `guard-no-gas.js` false-fails locally under X (7,484 findings)                                | proven (ran it)              | Fix specified: add `.claude` and `worktrees` to `IGNORED_DIRS`, born-red test first                                                              | 0 (resolved in plan, PR to write) |
| F2  | High     | `git clean -ffdx` destroys nested worktrees and uncommitted work                              | proven (scratch repo)        | Process mitigation only (commit WIP daily; Y for long-lived uncommitted work; written ban on `clean -ff`); the policy gate is not installed here | 5                                 |
| F3  | Medium   | OCR-docs gates can pass on zero files from a worktree at X                                    | source; runtime proof failed | Fix specified: prune on `relative_to(root).parts`, assert files scanned > 0; unproven                                                            | 5                                 |
| F4  | Medium   | Hub `.gitignore`, ESLint and `.vscode` lack the exclusion; five spokes have no `.gitignore`   | source                       | Fix specified (hub PR), five spokes when first used                                                                                              | 0                                 |
| F5  | Medium   | `LongPathsEnabled=0`; worktree paths reach 285 to 293 characters                              | proven (registry, find)      | Owner step: enable long paths, and keep names 12 characters or fewer                                                                             | 5                                 |
| F6  | Low      | Hardening check W9 only recognizes `.claude/worktrees` (not Y)                                | source                       | Widen when Y is used                                                                                                                             | 0                                 |
| F7  | Low      | Worktree `.ocr-hub-ref` is ignored, so pin-parity tests there are not hermetic                | proven                       | Accepted risk, pre-existing, location-independent                                                                                                | 2                                 |
| F8  | Low      | Fixed ports 8787 and 8789 collide across simultaneous worktrees                               | source                       | Accepted risk, location-independent                                                                                                              | 2                                 |
| F9  | Low      | 22 unregistered folders in `.claude/worktrees`                                                | proven                       | Cleanup rule covers it                                                                                                                           | 0                                 |
| F10 | Low      | Claude's sweep skips worktrees it did not create, so Y needs its own cleanup                  | docs                         | Janitor list covers it                                                                                                                           | 0                                 |
| F11 | Low      | `worktree-link-deps.mjs` uses junctions while the repo rule says never symlink `node_modules` | source                       | Reconcile wording; owner-run script                                                                                                              | 0                                 |
| F12 | Low      | `check-spoke-styles.mjs` in the hub does not skip `.claude`                                   | source                       | One-line change in the hub PR                                                                                                                    | 0                                 |

Arithmetic: loop 1 = 100 − (10+10+5+5+5+2+2+2+2+2) = **55**. Loop 2 = 100 − (10+5+5+2+2) = **76**. Loop 3 = 100 − (5+5+5+2+2) = **81**.

Note on a harness flag: the Dr of Security report matched an instruction-shaped pattern (it recommended installing the policy-gate hook and editing hardening settings). That is a finding for the owner, not an action taken; agents do not change their own settings.

## What must be true before shipping

1. Owner answers the questions below.
2. Each config change is a reviewed PR with its own test, run locally before pushing (batch fixes into one push per repo, because each push cancels the running OSE CI).
3. No governance file is touched: put the convention in `docs/brain/CONSTRAINTS.md` or a runbook, not AGENTS.md or CLAUDE.md (changes there need 5+ CCR loops with a human gate each).

## Commit sequence (after Oct 24 for anything touching the launch path)

1. OSE: `scripts/guard-no-gas.js` skips `.claude` and `worktrees`; add the born-red case first.
2. Hub: `.gitignore` gets `.claude/worktrees/`; ESLint ignores get `**/.claude/worktrees/**`; `check-spoke-styles.mjs` skips `.claude`.
3. OCR-docs: walkers prune on paths relative to the root and assert a non-empty scan.
4. Convention note in `docs/brain/CONSTRAINTS.md`, and a written ban on `git clean -ff`.
5. Weekly list of worktrees whose PR is merged (read-only, never deletes).
6. The five other spokes: a `.gitignore` entry when each first gets a worktree.

## Verification after shipping

- `node scripts/guard-no-gas.js` exits 0 with worktrees present.
- Hub `pnpm lint` passes with a worktree under `.claude/worktrees`.
- OCR-docs gates report a non-zero file count when run from a nested worktree.
- Born-red each change on an injected fault before trusting it.

## Risks accepted (pending owner)

- Ports collide between simultaneous worktrees (F8) and pin parity is non-hermetic in worktrees (F7).
- Until the policy gate is installed, the `git clean -ff` ban is a rule, not a block (F2).

## Human-gate questions

1. **Direction:** approve X as the default and Y only for long-lived uncommitted work?
2. **F5:** enable Windows long paths (a system setting, so your step) and adopt names of 12 characters or fewer?
3. **F2:** install the policy-gate hook on this machine (your open hardening step), or accept the written rule only?
4. **Timing:** open the four small PRs now or after Oct 24? The Product Owner lens says after, apart from the hub PR.
5. **Desktop app:** leave its **Worktree location** setting at the default (inside each repo)?
