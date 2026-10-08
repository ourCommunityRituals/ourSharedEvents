/**
 * Every name a template's inline script uses is declared somewhere that script
 * can see.
 *
 * Why: admin.html drew the Shared Report link with `esc(...)` and
 * `escAttr(...)` in a script where neither name existed. The only declarations
 * were locals inside other functions. Nothing failed until an organizer clicked
 * Generate Link, and the tests over that panel read the template as text, so a
 * ReferenceError passed them. It stayed that way from the day the panel was
 * written, through a change that set out to repair it.
 *
 * How: each `src/templates/*.html` file (the directory is read, not listed
 * here) has its inline scripts handed to the TypeScript checker as plain
 * browser scripts that share one global scope, the way a page loads them. Any
 * "cannot find name" is a failure, reported with its line in the template. So
 * is a top-level `let`/`const` that collides with another script's top-level
 * name, because in a browser that stops the second script from running at all.
 *
 * What this does not catch:
 *   - a name that resolves, but to the wrong thing. About a thousand browser
 *     globals (`name`, `status`, `event`, `close`, `escape`, ...) count as
 *     declared, so a forgotten local with one of those names passes here;
 *   - order: a name declared at the top level of any script on the page counts,
 *     even if that script runs later or failed;
 *   - calls through an object (`window.helper()`, `obj.missing()`);
 *   - script text built in TypeScript (handlers that write their own pages) and
 *     handler names inside markup strings;
 *   - whether the helper does its job. That is what the specs that run the
 *     page are for (admin-mint-report-link.spec.ts for this panel).
 *
 * Seen red on main at ba247322: admin.html, five uses (`esc` x3, `escAttr` x2)
 * in the mint block. The first describe block proves the check itself can fail.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { JSDOM } from 'jsdom';

const TEMPLATES_DIR = fileURLToPath(new URL('../src/templates/', import.meta.url));

// TS2304 / TS2552: cannot find name. TS18004: `{ name }` shorthand with no such
// name in scope. TS2451: a block-scoped name declared twice in one scope.
const UNRESOLVED = new Set([2304, 2552, 18004]);
const REDECLARED = new Set([2451]);

const OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  noResolve: true,
  skipLibCheck: true,
  types: [],
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
};

type Finding = { line: number; code: number; text: string };
type Checked = { scripts: number; findings: Finding[] };

const checked = new Map<string, Checked>();
/** One template, read from disk and checked once. */
function checkTemplate(name: string): Checked {
  if (!checked.has(name)) checked.set(name, check(readFileSync(TEMPLATES_DIR + name, 'utf8')));
  return checked.get(name)!;
}

/** Problems in one page's inline scripts. `line` is the line in the HTML. */
function check(html: string): Checked {
  const dom = new JSDOM(html, { includeNodeLocations: true });
  const files = new Map<string, { text: string; firstLine: number }>();
  for (const el of dom.window.document.querySelectorAll('script')) {
    const type = (el.getAttribute('type') || '').trim().toLowerCase();
    // Classic inline scripts only: a `src` script has no text here, and a typed
    // block (JSON, a module) does not share the page's global scope.
    if (el.hasAttribute('src') || (type !== '' && type !== 'text/javascript')) continue;
    const firstLine = dom.nodeLocation(el)?.startTag?.endLine ?? 1;
    files.set(`/inline/script-${files.size}.js`, { text: el.textContent || '', firstLine });
  }

  const host = ts.createCompilerHost(OPTIONS);
  const real = {
    fileExists: host.fileExists.bind(host),
    readFile: host.readFile.bind(host),
    getSourceFile: host.getSourceFile.bind(host),
  };
  host.fileExists = (name) => files.has(name) || real.fileExists(name);
  host.readFile = (name) => files.get(name)?.text ?? real.readFile(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    files.has(name)
      ? ts.createSourceFile(name, files.get(name)!.text, languageVersion, true, ts.ScriptKind.JS)
      : real.getSourceFile(name, languageVersion, onError, shouldCreate);

  const program = ts.createProgram([...files.keys()], OPTIONS, host);
  const findings: Finding[] = [];
  for (const [name, file] of files) {
    const source = program.getSourceFile(name)!;
    const diagnostics = [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ];
    for (const d of diagnostics) {
      // A script that does not parse cannot be checked at all, so it is a finding.
      const syntax = d.code < 2000;
      if (!syntax && !UNRESOLVED.has(d.code) && !REDECLARED.has(d.code)) continue;
      const at = source.getLineAndCharacterOfPosition(d.start ?? 0);
      findings.push({
        line: file.firstLine + at.line,
        code: d.code,
        text: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      });
    }
  }
  return { scripts: files.size, findings };
}

const page = (...scripts: string[]) =>
  ['<!doctype html>', '<body>', ...scripts.map((s) => `<script>\n${s}\n</script>`)].join('\n');

describe('the check can fail', () => {
  test('a helper that is local to another function is not visible: reported, with its line', () => {
    const { findings } = check(
      page(
        'function section() {\n  var esc = function (v) { return String(v); };\n  return esc(1);\n}',
        'window.mint = function (t) {\n  document.title = esc(t);\n};'
      )
    );
    expect(findings).toEqual([{ line: 11, code: 2304, text: "Cannot find name 'esc'." }]);
  });

  test('the same helper declared at the top level of a script is visible to every script', () => {
    const { scripts, findings } = check(
      page(
        'var esc = function (v) { return String(v); };\nfunction section() { return esc(1); }',
        'window.mint = function (t) {\n  document.title = esc(t);\n};'
      )
    );
    expect(scripts).toBe(2);
    expect(findings).toEqual([]);
  });

  test('a helper declared inside an IIFE stays inside it', () => {
    const { findings } = check(
      page(
        '(function () {\n  const escAttr = (s) => String(s);\n  escAttr(1);\n})();',
        'document.title = escAttr(document.title);'
      )
    );
    expect(findings.map((f) => f.text)).toEqual(["Cannot find name 'escAttr'."]);
  });

  test('a name used only as { shorthand } is still a use', () => {
    const { findings } = check(page('window.send = function () { return { role, days: 7 }; };'));
    expect(findings.map((f) => f.code)).toEqual([18004]);
  });

  test('two scripts declaring the same top-level const: the second would not run', () => {
    const { findings } = check(page('var esc = String;', 'const esc = String;'));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.code).toBe(2451);
  });

  test('a script that does not parse is reported, not skipped', () => {
    const { findings } = check(page('window.broken = function ( {'));
    expect(findings.length).toBeGreaterThan(0);
  });

  test('typed blocks and src scripts are left alone; names on window and the DOM resolve', () => {
    const { scripts, findings } = check(
      [
        '<!doctype html><body>',
        '<script type="application/ld+json">{ "not": "script" }</script>',
        '<script src="/assets/x.js"></script>',
        '<script>',
        'window.go = async function () {',
        '  const r = await fetch(location.origin + "/x");',
        '  document.title = encodeURIComponent(String(r.status));',
        '  setTimeout(function () { navigator.clipboard.writeText("x"); }, 1);',
        '};',
        '</script>',
      ].join('\n')
    );
    expect(scripts).toBe(1);
    expect(findings).toEqual([]);
  });
});

describe('every name a template script uses is in scope', () => {
  const templates = readdirSync(TEMPLATES_DIR)
    .filter((name) => name.endsWith('.html'))
    .sort();

  test('the templates directory was found, and it holds the pages that carry scripts', () => {
    expect(templates.length).toBeGreaterThanOrEqual(11);
    expect(templates).toContain('admin.html');
    const withScripts = templates.filter((name) => checkTemplate(name).scripts > 0);
    // admin, admin-logs, admin-settings, display, poster, public, shared-report,
    // sponsor-card, sponsor-home. If this drops, scripts stopped being seen.
    expect(withScripts.length).toBeGreaterThanOrEqual(9);
  });

  test.each(templates)('%s', (name) => {
    const { findings } = checkTemplate(name);
    expect(findings.map((f) => `${name}:${f.line}  ${f.text}`)).toEqual([]);
  });
});
