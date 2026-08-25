#!/usr/bin/env node
/**
 * Embedded-JS lint (CLI) — author-time / pre-commit entry point for the
 * OSE-1003 bug class. Flags single-backslash escaped quotes (\' or \") inside
 * template-literal TEXT, which collapse to a bare quote at render and break a
 * nested JS string (killing the whole inline <script>).
 *
 * Shares the ONE detector with tests/unit/embedded-js-source-lint.test.js (the
 * always-on CI gate) via tests/_shared/embedded-integrity.js — DRY: same rule,
 * two entry points. Run manually: `npm run lint:embedded-js`.
 *
 * Exit 0 = clean, 1 = violations found (suitable for a pre-commit hook / CI).
 */

const fs = require('fs');
const path = require('path');
const {
  findEscapedQuoteTemplateBugs,
  listEmbeddedJsSourceFiles,
} = require('../tests/_shared/embedded-integrity.js');

const repoRoot = path.resolve(__dirname, '..');
const files = listEmbeddedJsSourceFiles(repoRoot);

let count = 0;
for (const file of files) {
  const bugs = findEscapedQuoteTemplateBugs(fs.readFileSync(file, 'utf8'));
  for (const bug of bugs) {
    count++;
    const entity = bug.quote === "'" ? '&#39;' : '&#34;';
    console.error(
      `${path.relative(repoRoot, file)}:${bug.line}:${bug.col}  escaped ${bug.quote} in template literal → use ${entity} (or \\\\${bug.quote})  …${bug.snippet.slice(-40)}`
    );
  }
}

if (count > 0) {
  console.error(
    `\n✖ ${count} embedded-JS escaped-quote bug(s). Inside a backtick template literal a \\' / \\" collapses to a bare quote, so a nested single/double-quoted JS string closes early → SyntaxError kills the whole inline <script>. Fix with the HTML entity (&#39; / &#34;) or double-escape (\\\\').`
  );
  process.exit(1);
}
console.log(`✓ embedded-JS lint clean — ${files.length} files scanned, 0 violations`);
