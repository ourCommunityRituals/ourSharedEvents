/**
 * Layer 2 — SOURCE lint (CI enforcement) for the OSE-1003 bug class.
 *
 * Reads worker handler/template SOURCE text directly (no render, no import) and
 * fails if any single-backslash escaped quote (\' or \") sits inside template-
 * literal TEXT — where it collapses to a bare quote at render and breaks a
 * nested JS string. Reaches every surface, including those Layer 1 can't render
 * under node (pages.ts, templates/*.html, briefing.ts, events.ts).
 *
 * Shares one detector with the scripts/lint-embedded-js.js CLI (DRY) — this
 * test is the always-on CI gate (runs under the root `npx vitest run`); the CLI
 * is the author-time / pre-commit entry point.
 */

const fs = require('fs');
const path = require('path');
const {
  findEscapedQuoteTemplateBugs,
  listEmbeddedJsSourceFiles,
} = require('../_shared/embedded-integrity.js');

const repoRoot = path.resolve(__dirname, '..', '..');

describe('embedded-JS source lint (OSE-1003 bug class)', () => {
  test('no escaped-quote-in-template-literal bugs across worker source', () => {
    const files = listEmbeddedJsSourceFiles(repoRoot);
    // Guard against a vacuous pass if the file walk ever resolves to nothing.
    expect(files.length).toBeGreaterThan(0);

    const violations = [];
    for (const file of files) {
      // Path comes from our own listEmbeddedJsSourceFiles() walk, not user input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const src = fs.readFileSync(file, 'utf8');
      for (const bug of findEscapedQuoteTemplateBugs(src)) {
        violations.push(
          `${path.relative(repoRoot, file)}:${bug.line}:${bug.col}  \\${bug.quote} in template text  …${bug.snippet.slice(-40)}`
        );
      }
    }

    expect(
      violations,
      `escaped-quote-in-template-literal bug(s) — use &#39;/&#34; or \\\\':\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
