/**
 * Every Playwright config turns off git info capture (OSE-1470).
 *
 * On GitHub Actions, Playwright copies the commit message and, on PRs, the
 * source diff into report metadata (`metadata.gitCommit` / `metadata.gitDiff`).
 * Reports are uploaded as artifacts, and the artifact scanner failed T3 on main
 * because a commit message named the cookie it looks for. Derives the config
 * list from the repo root, so a new config is covered without editing this.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..', '..');
const CONFIGS = readdirSync(ROOT).filter((f) =>
  /^playwright(\..+)?\.config\.(ts|js|mjs|cjs)$/.test(f)
);
const OFF = /captureGitInfo:\s*\{\s*commit:\s*false,\s*diff:\s*false\s*\}/;

describe('Playwright configs capture no git info', () => {
  it('finds the configs (not vacuous)', () => {
    expect(CONFIGS.length).toBeGreaterThanOrEqual(5);
  });

  it.each(CONFIGS)('%s sets captureGitInfo { commit: false, diff: false }', (file) => {
    expect(readFileSync(join(ROOT, file), 'utf-8')).toMatch(OFF);
  });
});
