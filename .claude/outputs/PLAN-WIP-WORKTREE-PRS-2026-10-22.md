# PR plan: WIP worktree convention (approved 2026-10-22)

Source: [CCR-WIP-WORKTREE-LAYOUT-2026-10-22.md](CCR-WIP-WORKTREE-LAYOUT-2026-10-22.md) (score 81%, human gate answered on direction only).

**Approved by owner:** X (`<app>/.claude/worktrees/<short-name>`) is the default. Y (`C:\Users\mzdan\dev\ourCommunityRituals.worktrees\<app>\<short-name>`) is only for long-lived UNCOMMITTED work. **Hold anything touching the launch path until after Oct 24.**

**Launch path, for this plan:** anything that changes a gate, workflow or synced file that the OSE pipeline runs, or that changes the OSE repo itself. The hub repo and local housekeeping are outside it.

## Status (2026-10-22, end of day)

- **PR 1:** opened and merged as ourCommunityRituals PR 59.
- **PR 2:** opened and merged as ourSharedEvents PR 1014. It was narrowed: it skips only `.claude/worktrees`, not all of `.claude`, so `.claude/hooks` is still scanned.
- **PR 3 (OCR-docs gate walkers):** not opened. The Python launcher on the owner's machine is broken, so its tests would run only in CI.
- **PR 4 (CONSTRAINTS.md pointer) and PR 5 (janitor list):** not opened.
- **The Oct 24 hold no longer applies** (owner, 2026-10-22). Order by risk, not by date.
- Related work from the same review, tracked separately: ourSharedEvents PR 1015 removes four Apps Script scripts that nothing references.

## The PRs

| #   | Repo     | Change                                                             | Launch path?                                                                                                                                             | When                           |
| --- | -------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | hub      | Ignore the folder and write the convention down                    | No. OSE pins an exact hub commit (`.ocr-hub-ref`), so hub `main` moving does not reach OSE until a pin bump, and nothing here is in `packages/ui` output | **Now**                        |
| 2   | OSE      | `guard-no-gas.js` skips `.claude`                                  | **Yes** (gate run at `.github/workflows/oursharedevents-ci.yml:628`)                                                                                     | **After Oct 24**               |
| 3   | OCR-docs | Gates prune on paths relative to the root and refuse an empty scan | **Yes** (`shared/security_gate.py` and `pragma_audit.py` are synced into spokes as `tests/_shared/*`, and the composite actions run in spoke CI)         | **After Oct 24**               |
| 4   | OSE      | Pointer to the convention in `docs/brain/CONSTRAINTS.md`           | **Yes** (any OSE PR runs the OSE pipeline)                                                                                                               | **After Oct 24**               |
| 5   | hub      | Read-only weekly list of worktrees whose PR merged                 | No                                                                                                                                                       | Now, or with #1 (owner's call) |

Not a PR, not in this plan: a `git clean -ff` block in `.claude/hooks/policy-gate.mjs`. pr-risk marks `.claude/hooks/` as agent governance (5+ loop CCR with a human gate each loop), so it needs its own CCR. Until then the ban is a written rule in PR #1.

## PR 1: hub (now)

Branch: `docs/wip-worktree-convention`. One commit, one push.

1. `.gitignore`: add `.claude/worktrees/` under the local-tooling block.
2. `eslint.config.js` (ignores list, near line 25): add `'**/.claude/worktrees/**'`.
3. `packages/ui/scripts/check-spoke-styles.mjs:45`: add `'.claude'` to `SKIP_DIRS`.
4. `docs/decisions/` (new short note): the convention, in six lines.
   - Default `<app>/.claude/worktrees/<name>`, names 12 characters or fewer.
   - Exception: long-lived uncommitted work goes to `ourCommunityRituals.worktrees\<app>\<name>`.
   - Commit WIP to its branch daily.
   - **Never run `git clean -ff`** (double force deletes nested worktrees and their uncommitted files).
   - Remove a worktree after its PR merges.
   - Create worktrees with `git worktree add`, then `npm run worktree:link-deps` rather than a bare `npm ci`.
5. Do not edit the hub `CLAUDE.md` or the governance files.

Born-red: create a throwaway `.claude/worktrees/x/bad.ts` with a lint error and a raw hex; confirm `pnpm lint` and `pnpm tokens:check:raw` fail before the change (lint) and pass after; delete the fixture.
Verify: `pnpm lint`, `pnpm tokens:test`, `pnpm ui:test`, `git status` clean.
Body: `Part of the hub sync cleanup.` No closing words.

## PR 5: hub (optional now)

`scripts/worktree-janitor.mjs`, read-only. For every registered worktree in the hub and the three spokes, print: repo, path, branch, dirty count, PR state (`gh pr list --head <branch> --state all`), tip equals PR head or not, days since last commit. It never removes anything. Reuse the classification from this session (merged and clean, merged but dirty, no PR and in main, no PR with unique commits, unsaved changes). Output: a table the owner reads weekly.
Born-red: run against a worktree with a planted unmerged commit and confirm it is listed as WIP, not merged.

## PR 2: OSE (after Oct 24)

Branch: `ci/guard-no-gas-skips-claude`.

- `scripts/guard-no-gas.js` (IGNORED_DIRS, lines 25-48): add `'.claude'`.
- `scripts/guard-no-gas.test.js`: **write the test first** with a planted banned pattern under `.claude/worktrees/x/`; watch it go red (the gate currently reports it), then add the skip and watch it go green.
- No allowlist or baseline change: the main-tree count is already 0.
  Verify: `node scripts/guard-no-gas.js` exits 0 with worktrees present (today: 7,484 findings in 1,213 files); `npm test`; `npm run lint:ci`.
  CI note: one push, because each push cancels the running OSE CI run. Linear: one ticket under the hardening epic (OSE-1488), `Part of OSE-###`, no closing words.

## PR 3: OCR-docs (after Oct 24)

Branch: `fix/gates-prune-relative-parts`.

- `shared/security_gate.py:100-104` and `shared/pragma_audit.py:49-53`: replace `part in exclude_dirs for part in path.parts` with `part in exclude_dirs for part in path.relative_to(root).parts`. Today the absolute parts include the root's own folders, so a root inside `.claude/worktrees/<n>` excludes every file.
- Add an assertion in both: a scan that finds zero eligible files fails with a clear message (green-while-skipping guard).
- Walkers with no `.claude` pruning (`check_cross_repo_imports.py`, `scan_phantom_invariants.py`, `identity_contract_check.py`): add `.claude` to the exclusion sets.
- Tests: for each changed gate, a fixture rooted inside a directory named `worktrees` must still scan its files (red before the change), and an empty fixture must fail (red before the change).
- Propagation: `shared/*` is synced to spokes (`sync_to_repos.py`), so the OSE copy at `tests/_shared/` updates through the normal sync, not by hand. Do that after Oct 24 as a separate step.
- Runtime proof: the Python launcher on this machine is broken, so run the tests in CI or after fixing the local Python.

## PR 4: OSE (after Oct 24)

`docs/brain/CONSTRAINTS.md`: three lines pointing to the hub note (default location, the Y exception, never `git clean -ff`). Do not touch AGENTS.md or CLAUDE.md (5+ loop CCR with a human gate each loop).

## Order and batching

1. Now: PR 1 (and PR 5 if wanted).
2. Oct 25 or later: PR 2, then PR 3, then the sync of PR 3 into the spokes, then PR 4.
3. One push per repo per round.
4. The five other spokes (ourAirwaves, ourSharedGames, ourSharedMagnets, ourSharedPulse, ourSharedRecords): add a `.gitignore` with `.claude/worktrees/` when each first gets a worktree.

## Owner steps (not PRs, not for an agent)

1. Enable Windows long paths (`LongPathsEnabled=1`, a system setting).
2. Install the policy-gate hook (your open hardening step) if you want more than a written rule.
3. Check Settings > Claude Code > **Worktree location** in the desktop app is left at its default.
4. Look at the commented `_authToken` line in `_ose1030-wt/.npmrc` (open item from the cleanup CCR) and rotate if it is real.

## Local housekeeping (no PR, outside the launch path)

- Remove the merged and clean worktrees in `_relocated-2026-10-21` with the dry-run script, after updating its list to the 51 merged plus the two already-in-main ones.
- Do not move the 9 non-merged worktrees before Oct 24 (Product Owner lens). Revisit after.
- Clear the 22 unregistered folders in `OSE/.claude/worktrees` (21 empty, one 1,372-file copy with no git link) after checking the copy.

## Risks and rollback

- Every PR is revert-safe. No data is deleted by any of them.
- Accepted: fixed ports collide between simultaneous worktrees; pin parity is not hermetic in a worktree.
- The `git clean -ff` ban is a rule, not a block, until the hook is installed and a hook change goes through its own CCR.
