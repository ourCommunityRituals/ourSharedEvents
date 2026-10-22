# Playwright visual specs (archived 2026-10-22)

Moved here, not deleted, by owner decision. They ran in no workflow, and no Linux baselines were ever committed, so they were not coverage (AGENTS.md: a spec counts only if a workflow names it).

- `surfaces.visual.spec.ts`: full-page baselines for the public surfaces at four device profiles.
- `ui-preview.visual.spec.ts`: baselines for the `@ocr/ui` preview page.

`archive/` is excluded from eslint, vitest and the Playwright `testDir`, so nothing here runs.

## To bring them back

1. `git mv` both files back to `tests/playwright/`. Their relative imports (`./_helpers/...`) expect that folder.
2. Generate Linux baselines in CI, not on Windows. A local Windows run writes `*-win32.png`, which `.gitignore` ignores.
3. Name the spec in a workflow, so it counts as coverage.
4. Add `tests/playwright/surfaces.visual.spec.ts` back to `.ci-integrity-baseline.json` only if it still has a conditional skip.

The local `*-win32.png` folders under `tests/playwright/*-snapshots/` were left where they are (untracked, ignored).
