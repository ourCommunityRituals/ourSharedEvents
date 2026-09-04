// ─────────────────────────────────────────────────────────────────────────────
// OSE-1219 — markdown is hand-maintained here; prettier must not own it.
//
// THE INCIDENT (2026-09-03 reconciliation). Editing four governance files and
// then running `prettier --write` on them reflowed 230+ lines the edit never
// touched — 294 in STORIES.md against ~10 real edits — because prettier
// re-aligns every table in a file it formats. The actual change was buried, and
// a whole-file reformat also collides with the byte-parity the propagated
// .ocr-standards/ copies depend on (the same failure mode already recorded for
// that directory in .prettierignore).
//
// IT WAS NOT A ONE-OFF, IT WAS A LOADED TRAP. Measured the same day: 187 of 421
// tracked .md files are not prettier-clean (44%), because nothing has ever
// enforced markdown formatting — docs-ci runs markdownlint with `|| true`, and
// the lint shard is eslint over config/ scripts/ tests/. Meanwhile
// .husky/pre-commit ran lint-staged, whose glob included `md` with
// `prettier --write`. So the next contributor to stage ANY of those 187 files
// would have auto-committed a reformat they never asked for and probably would
// not have noticed in review.
//
// TWO VECTORS, TWO FIXES — this test locks both, because closing one leaves the
// other open:
//   • `.prettierignore` (`*.md`) stops a DELIBERATE `prettier --write <file>`.
//     Verified: prettier honours .prettierignore even for explicitly-passed
//     paths, which is exactly the incident above.
//   • lint-staged's glob no longer lists `md`, so the pre-commit hook cannot
//     reformat markdown behind anyone's back.
//
// If markdown formatting is ever actually wanted, it is a deliberate repo-wide
// commit plus a real CI check — not a silent side effect of editing one file.
// ─────────────────────────────────────────────────────────────────────────────
const { readFileSync } = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const prettierIgnore = readFileSync(path.join(REPO, '.prettierignore'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));

const ignoreLines = prettierIgnore
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const lintStaged = pkg['lint-staged'] ?? {};

describe('OSE-1219 — prettier does not silently reformat markdown', () => {
  it('.prettierignore excludes markdown repo-wide', () => {
    expect(
      ignoreLines,
      '.prettierignore must contain `*.md` — without it, `prettier --write <a-doc.md>` reflows every table in the file'
    ).toContain('*.md');
  });

  it('the lint-staged pre-commit hook does not run prettier over markdown', () => {
    const mdGlobs = Object.entries(lintStaged).filter(([glob, actions]) => {
      // A glob covers markdown if it names md inside a brace list or as *.md.
      const coversMd = /\.md\b/.test(glob) || /\{[^}]*\bmd\b[^}]*\}/.test(glob);
      const writesPrettier = []
        .concat(actions)
        .some((a) => typeof a === 'string' && a.includes('prettier') && a.includes('--write'));
      return coversMd && writesPrettier;
    });

    expect(
      mdGlobs.map(([g]) => g),
      'lint-staged must not `prettier --write` markdown: 44% of tracked .md files are not prettier-clean, so staging any of them would auto-commit a whole-file reflow (OSE-1219)'
    ).toEqual([]);
  });

  it('the globs that remain still cover the file types prettier does own', () => {
    // Guards against "fixing" the test above by deleting the hook wholesale.
    const globs = Object.keys(lintStaged).join(' ');
    expect(globs, 'js/ts formatting on commit must stay').toMatch(/js/);
    expect(globs, 'json/css formatting on commit must stay').toMatch(/json/);
  });
});
