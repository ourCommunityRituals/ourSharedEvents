/**
 * Embedded-code integrity — shared primitive (OSE-1003 generalization).
 *
 * ONE authoritative implementation, consumed by both integrity layers so the
 * logic is never duplicated (DRY):
 *
 *   Layer 1 — RENDERED parse (node vitest): render a surface, extract every
 *     inline <script> body, compile it with `new Function` (parse-only, never
 *     executed). Catches ANY JS syntax error in emitted output. Used by
 *     tests/unit/form-page-js-integrity.test.js and
 *     tests/unit/rendered-surface-integrity.test.js.
 *
 *   Layer 2 — SOURCE scan (node): read handler/template SOURCE text directly
 *     (no render, no import) and flag the specific OSE-1003 anti-pattern — a
 *     single-backslash escaped quote (\' or \") inside template-literal TEXT,
 *     which collapses to a bare quote at render and breaks a nested JS string.
 *     Reaches surfaces layer 1 can't cheaply render (pages.ts, templates/*.html,
 *     briefing.ts, events.ts). Used by scripts/lint-embedded-js.js (CLI) and
 *     tests/unit/embedded-js-source-lint.test.js (CI enforcement).
 *
 * KISS boundary: layer 2 detects the KNOWN dangerous pattern, not general JS
 * validity — that is layer 1's job via real parsing. Correct double-escaped
 * `\\'` is intentionally NOT flagged; only the single-backslash bug is.
 */

const fs = require('fs');
const path = require('path');

// ── Layer 1 helpers — rendered inline <script> parse ─────────────────────────

/** Extract the bodies of INLINE <script> tags (skips external src= scripts). */
function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs)) continue; // external — no inline body to parse
    if (body.trim().length === 0) continue;
    scripts.push({ attrs, body });
  }
  return scripts;
}

/**
 * Parse every inline <script> body in `html`. Returns an array of failures:
 * `[{ index, message }]` (empty when all parse). `new Function(body)` compiles
 * the body as a function body — parse only, never called — so undefined runtime
 * globals (document/window/fetch) are irrelevant; only syntax is checked.
 */
function findInlineScriptParseErrors(html) {
  const failures = [];
  extractInlineScripts(html).forEach(({ body }, index) => {
    try {
      new Function(body);
    } catch (err) {
      failures.push({ index, message: err && err.message ? err.message : String(err) });
    }
  });
  return failures;
}

// ── Layer 2 — source scan for the escaped-quote-in-template-literal bug ───────

/**
 * Scan JS/TS/HTML source text and flag single-backslash escaped quotes (\' or
 * \") that sit inside TEMPLATE-LITERAL TEXT. Inside a backtick template literal
 * `\'` collapses to a bare `'`, so when that text is a nested single-quoted JS
 * string the string closes early (the exact OSE-1003 break).
 *
 * A small context state-machine (no deps) distinguishes template TEXT from:
 *   - ordinary '..' / ".." strings (where \' / \" are legitimate),
 *   - ${ ... } template expressions (real JS — legitimate escapes),
 *   - // line and /* block comments.
 * Correct double-escaped `\\'` is NOT flagged (the second backslash escapes the
 * first, so the quote is not escaped in template text).
 *
 * @returns {Array<{line:number, col:number, quote:string, snippet:string}>}
 */
function findEscapedQuoteTemplateBugs(source) {
  const bugs = [];
  // Frame types: 'code' (top-level or ${} expr), 'sq', 'dq', 'tmpl'.
  // ${} expr frames carry isExpr + braceDepth so a matching } pops back to tmpl.
  const stack = [{ type: 'code', isExpr: false, braceDepth: 0 }];
  let line = 1;
  let col = 0;
  // Last significant (non-whitespace) char seen in a code frame — used only to
  // disambiguate a `/` as a regex literal vs division. A regex follows an
  // operator/opening; division follows a value.
  let lastSig = '';
  const REGEX_PRECEDERS = new Set([
    '',
    '(',
    ',',
    '=',
    ':',
    '[',
    '!',
    '&',
    '|',
    '?',
    '{',
    ';',
    '+',
    '-',
    '*',
    '%',
    '<',
    '>',
    '~',
    '^',
    'return',
  ]);
  const top = () => stack[stack.length - 1];

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '\n') {
      line++;
      col = 0;
      continue;
    }
    col++;
    const frame = top();

    if (frame.type === 'sq' || frame.type === 'dq') {
      if (c === '\\') {
        i++;
        col++;
        continue;
      } // escape — skip next
      if ((frame.type === 'sq' && c === "'") || (frame.type === 'dq' && c === '"')) {
        stack.pop();
        lastSig = c; // string closed → a following `/` is division, not regex
      }
      continue;
    }

    if (frame.type === 'tmpl') {
      if (c === '\\') {
        // Escape inside template TEXT. `\'` or `\"` here is the bug.
        if (next === "'" || next === '"') {
          const start = Math.max(0, i - 30);
          bugs.push({
            line,
            col,
            quote: next,
            snippet: source.slice(start, i + 2).replace(/\n/g, ' '),
          });
        }
        i++;
        col++;
        continue; // skip the escaped char
      }
      if (c === '`') {
        stack.pop();
        lastSig = '`'; // template closed → following `/` is division
        continue;
      } // close template
      if (c === '$' && next === '{') {
        stack.push({ type: 'code', isExpr: true, braceDepth: 0 });
        i++;
        col++;
        continue;
      }
      continue;
    }

    // frame.type === 'code'
    if (c === ' ' || c === '\t' || c === '\r') continue; // whitespace — keep lastSig
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      line++;
      col = 0;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') {
          line++;
          col = 0;
        }
        i++;
      }
      i++; // land on '/'
      continue;
    }
    // Regex literal — skip it whole so embedded quotes/backticks don't desync
    // the scanner (e.g. escAttr's /[<>&"']/g). `[...]` char classes contain a
    // literal `/` that must not end the regex.
    if (c === '/' && REGEX_PRECEDERS.has(lastSig)) {
      i++; // past opening /
      let inClass = false;
      while (i < source.length) {
        const rc = source[i];
        if (rc === '\\') {
          i += 2;
          continue;
        } // escape
        if (rc === '[') inClass = true;
        else if (rc === ']') inClass = false;
        else if (rc === '/' && !inClass) break;
        else if (rc === '\n') {
          line++;
          col = 0;
        }
        i++;
      }
      lastSig = '/';
      continue;
    }
    if (c === "'") {
      stack.push({ type: 'sq' });
      lastSig = "'";
      continue;
    }
    if (c === '"') {
      stack.push({ type: 'dq' });
      lastSig = '"';
      continue;
    }
    if (c === '`') {
      stack.push({ type: 'tmpl' });
      lastSig = '`';
      continue;
    }
    if (frame.isExpr) {
      if (c === '{') frame.braceDepth++;
      else if (c === '}') {
        if (frame.braceDepth === 0) {
          stack.pop(); // close ${} → back to tmpl
          continue;
        }
        frame.braceDepth--;
      }
    }
    lastSig = c;
  }
  return bugs;
}

// ── Shared file list — the worker source both layer-2 consumers scan ─────────

/** Recursively list files under `dir` matching one of `exts` (e.g. ['.ts']). */
function walk(dir, exts, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, exts, acc);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * The canonical set of worker source files that embed client JS in template
 * literals — handlers (.ts) + HTML templates (.html). `repoRoot` is the repo
 * root; both the CLI and the CI test resolve from the same base so coverage is
 * identical.
 */
function listEmbeddedJsSourceFiles(repoRoot) {
  const base = path.join(repoRoot, 'workers', 'oursharedevents', 'src');
  const handlers = walk(path.join(base, 'handlers'), ['.ts']);
  const templates = fs.existsSync(path.join(base, 'templates'))
    ? walk(path.join(base, 'templates'), ['.html'])
    : [];
  return [...handlers, ...templates].sort();
}

module.exports = {
  extractInlineScripts,
  findInlineScriptParseErrors,
  findEscapedQuoteTemplateBugs,
  listEmbeddedJsSourceFiles,
};
