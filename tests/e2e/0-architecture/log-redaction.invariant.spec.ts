/**
 * INVARIANT: Log lines carry no identifiers or credentials (log redaction).
 *
 * Cloudflare Workers Logs are ON for the OSE worker (`wrangler.toml`
 * `[observability]`), so every console line the Worker writes is retained by a
 * third-party log store. A security review found three leaks into it:
 *   - the `UNHANDLED_ERROR` catch logged `request.url` — the FULL url, whose
 *     query string carries live credentials (`/sponsor?t=…`,
 *     `/sharedReport?…&token=…`);
 *   - every form submit logged the raw `ose_anon` cookie value (`anonId`)
 *     through `logFormEvent`;
 *   - data-subject erasure logged (and returned, and audited) `emailHash`, a
 *     stable pseudonym of the erased person's email.
 *
 * This gate keeps them out. It is STRUCTURAL (reads source via node:fs, no
 * deployed worker) and PROPERTY-ASSERTING (see README "Gate shape"): it derives
 * its subjects instead of naming them —
 *   1. every `.ts` file under workers/oursharedevents/src (walked, not listed);
 *   2. every `console.log|warn|error|info(` call in those files;
 *   3. every LOG WRAPPER — a declared function whose body passes one of its own
 *      parameters into a console call (e.g. `logFormEvent(…, meta)` spreading
 *      `...meta`). A wrapper's call sites are sinks too: `logFormEvent(…, {
 *      anonId })` reaches the log exactly as if it were written inline.
 * For each sink it takes the argument text up to the balanced closing paren
 * (skipping strings, template literals and comments while counting) and fails
 * on any forbidden key.
 *
 * The request URL is refused in three forms, because a signed link is a
 * credential wherever its query string goes:
 *   - `request.url` in the call (only `new URL(request.url).pathname` is allowed);
 *   - the query half of a parsed URL on any receiver: `.search`,
 *     `.searchParams`, `.href`;
 *   - a parsed request URL written whole. The names are derived too: every
 *     `const NAME = new URL(request.url)`, with the block it lives in, makes
 *     `{ NAME }`, `${NAME}` and `String(NAME)` a violation in that block.
 * The runtime side of this is workers/oursharedevents/tests/unhandled-error-log.spec.ts,
 * which reads the lines a real failing request writes.
 *
 * Exemptions: none. If a true false positive appears, add an entry to
 * EXEMPTIONS below with `file`, the exact `pattern` label, and a `reason`.
 *
 * Runs in the T0 Gate `invariants` shard — listed in the
 * "Architecture: structural invariants" step of
 * .github/workflows/oursharedevents-ci.yml (enforced by
 * tests/integration/infra-consistency.test.js).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');

// Every console method that reaches Workers Logs (Copilot review on #747: debug + trace).
const CONSOLE_LEVELS = ['log', 'warn', 'error', 'info', 'debug', 'trace'];

/** Forbidden content in a log sink's argument text. */
const FORBIDDEN: Array<{
  label: string;
  re: RegExp;
  safe?: RegExp;
  /** Only sinks in files matching this (path relative to src/) are checked. */
  files?: RegExp;
  why: string;
}> = [
  { label: 'anonId', re: /\banonId\b/, why: 'raw ose_anon cookie value (Invariant #1)' },
  { label: 'anonymous_id', re: /\banonymous_id\b/, why: 'raw anonymous id column' },
  { label: 'emailHash', re: /\bemailHash\b/, why: 'stable pseudonym of an email' },
  { label: 'email_hash', re: /\bemail_hash\b/, why: 'stable pseudonym of an email' },
  {
    // `new URL(request.url).pathname` is the sanctioned form (no query string):
    // `safe` removes exactly that form before matching, so `.search`, `.href`
    // or a bare `request.url` still fail.
    label: 'request.url',
    re: /\brequest\.url\b/,
    safe: /new\s+URL\(\s*request\.url\s*\)\.pathname\b/g,
    why: 'full URL — query strings carry live credentials (?t=, &token=); log new URL(request.url).pathname',
  },
  {
    // The same leak one step removed: `const url = new URL(request.url)` and
    // then `url.search`, `url.searchParams.get('t')` or `url.href` in the log.
    // Matched on any receiver, because a parsed URL goes by many names (`url`,
    // `here`, `requestUrl`); `.pathname` and `.origin` carry no query string.
    label: 'URL query',
    re: /\.(?:search|searchParams|href)\b/,
    why: 'the query-string half of a parsed URL (.search, .searchParams, .href); log the route pattern or .pathname',
  },
  {
    label: 'token:',
    re: /(?:^|[\s{,(])['"`]?token['"`]?\s*:/,
    why: 'a credential as an object key',
  },
  {
    // Copilot review on #747: credentials are not only keyed `token`. Any
    // identifier that ends in Token / _token / Secret / _secret names one
    // (draftToken, draft_token, sessionSecret), as a key, a shorthand property
    // or a value. `tokenType` does not end in Token and stays allowed.
    label: 'credential name',
    re: /\b[A-Za-z_$][\w$]*(?:Token|_token|Secret|_secret)\b/,
    // Quoted text is prose or a fixed value ('no_secret'), not a credential;
    // template literals are kept because `${draftToken}` interpolates one.
    // A quoted object KEY (`{ "draftToken": v }`) is kept too: it follows `{`
    // or `,` and precedes `:`. Anything else quoted is stripped.
    safe: /(?<![{,]\s*)(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")(?!\s*:)/g,
    why: 'a credential under another name (draftToken, draft_token, …)',
  },
  {
    label: 'token shorthand',
    re: /[{,]\s*token\s*[,}]/,
    why: 'a credential as a shorthand property ({ token })',
  },
  { label: 'cookie', re: /cookie/i, why: 'cookie values identify a browser' },
  {
    // Copilot review on #747: a form row's id is the key to an encrypted
    // attendee name, an unscrubbed survey answer or an encrypted email. Form
    // logs carry the event, the outcome and counts, never which row.
    label: 'form record id',
    re: /(?:^|[{,(]\s*)['"]?(?:row_id|id)['"]?\s*[:,}]/,
    files: /^handlers\/forms\.ts$/,
    why: 'a form row id points at one attendee record; log counts instead',
  },
];

/**
 * Triaged exemptions — one entry per true false positive, each with a reason.
 * Keep this empty unless a real false positive appears.
 */
const EXEMPTIONS: Array<{ file: string; pattern: string; reason: string }> = [];

// ── Source walking ──────────────────────────────────────────────────────────

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// ── A small scanner: skip strings / templates / comments, balance brackets ──

/** Index just past the string literal that starts at `i` (quote at src[i]). */
function skipQuoted(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === q) return j + 1;
    else if (c === '\n')
      return j; // unterminated — stop at line end
    else j++;
  }
  return j;
}

/** Index just past the template literal that starts at `i` (backtick). */
function skipTemplate(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === '`') return j + 1;
    else if (c === '$' && src[j + 1] === '{') j = skipBalanced(src, j + 1);
    else j++;
  }
  return j;
}

/**
 * `src[i]` is an opening bracket. Return the index just past its matching
 * closing bracket, skipping strings, template literals and comments.
 */
function skipBalanced(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    const n = src[j + 1];
    if (c === '/' && n === '/') {
      const nl = src.indexOf('\n', j);
      j = nl === -1 ? src.length : nl;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', j + 2);
      j = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      j = skipQuoted(src, j);
    } else if (c === '`') {
      j = skipTemplate(src, j);
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
      j++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      j++;
      if (depth === 0) return j;
    } else {
      j++;
    }
  }
  return j;
}

/** Remove `//` and block comments (outside strings) so prose cannot trip a key. */
function stripComments(text: string): string {
  let out = '';
  let j = 0;
  while (j < text.length) {
    const c = text[j];
    const n = text[j + 1];
    if (c === '/' && n === '/') {
      const nl = text.indexOf('\n', j);
      j = nl === -1 ? text.length : nl;
    } else if (c === '/' && n === '*') {
      const end = text.indexOf('*/', j + 2);
      j = end === -1 ? text.length : end + 2;
    } else if (c === '"' || c === "'") {
      const e = skipQuoted(text, j);
      out += text.slice(j, e);
      j = e;
    } else if (c === '`') {
      const e = skipTemplate(text, j);
      out += text.slice(j, e);
      j = e;
    } else {
      out += c;
      j++;
    }
  }
  return out;
}

interface Sink {
  file: string; // relative to SRC_DIR, forward slashes
  line: number;
  index: number; // offset of the call in the text it was found in
  callee: string;
  args: string; // argument text, parens included, comments stripped
}

function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length;
}

/** Every call to `calleeRe` in `src`, with its balanced argument text. */
function findCalls(src: string, file: string, calleeRe: RegExp): Sink[] {
  const sinks: Sink[] = [];
  const re = new RegExp(calleeRe.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1; // the '('
    if (src[open] !== '(') continue;
    // Skip declarations (`function logX(`) — they are not calls.
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    if (/function\s+$/.test(before)) continue;
    const close = skipBalanced(src, open);
    sinks.push({
      file,
      line: lineOf(src, m.index),
      index: m.index,
      callee: m[0].slice(0, -1).trim(),
      args: stripComments(src.slice(open, close)),
    });
  }
  return sinks;
}

const CONSOLE_CALL = new RegExp(`\\bconsole\\.(?:${CONSOLE_LEVELS.join('|')})\\s*\\(`);

/**
 * Derive log wrappers: any function that forwards one of its own parameters
 * into a console call makes its call sites log sinks. Three declaration forms:
 *   function NAME(params) { … }
 *   const NAME = (params) => { … }   (or `=> expression`, `async (…) =>`)
 *   NAME(params) { … }               (class or object method)
 */
const NOT_A_METHOD = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'with',
]);

interface FnCandidate {
  name: string;
  paramText: string;
  body: string;
}

function paramsOf(paramText: string): string[] {
  return splitTopLevel(paramText)
    .map((p) => p.trim().replace(/^\.\.\./, ''))
    .map((p) => (p.match(/^([A-Za-z_$][\w$]*)/) || [])[1])
    .filter((p): p is string => !!p);
}

function candidates(src: string): FnCandidate[] {
  const out: FnCandidate[] = [];
  const blockBody = (from: number): string | null => {
    const bodyOpen = src.indexOf('{', from);
    if (bodyOpen === -1) return null;
    // Return-type annotations may contain braces (`: { ok: boolean }`); accept
    // that imprecision — the body we take still contains the real body.
    return src.slice(bodyOpen, skipBalanced(src, bodyOpen));
  };
  // function NAME(…) { … }
  const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g;
  // const NAME = (…) => …   (optionally typed, optionally async)
  const arrowRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:async\s*)?\(/g;
  // const NAME = meta => …   (one unparenthesized parameter)
  const bareArrowRe =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*/g;
  // NAME(…) { …   at the start of a line (class / object method)
  const methodRe =
    /^[ \t]*(?:(?:public|private|protected|static|async)\s+)*([A-Za-z_$][\w$]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = skipBalanced(src, open);
    const body = blockBody(close);
    if (body) out.push({ name: m[1], paramText: src.slice(open + 1, close - 1), body });
  }
  const arrowBody = (at: number): string =>
    src[at] === '{'
      ? src.slice(at, skipBalanced(src, at))
      : // expression body: up to the end of the statement
        src.slice(at, (/;|\n\s*\n/.exec(src.slice(at))?.index ?? 400) + at);
  while ((m = arrowRe.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = skipBalanced(src, open);
    const arrow = /^\s*(?::[^=]*)?=>\s*/.exec(src.slice(close));
    if (!arrow) continue;
    const body = arrowBody(close + arrow[0].length);
    out.push({ name: m[1], paramText: src.slice(open + 1, close - 1), body });
  }
  while ((m = bareArrowRe.exec(src)) !== null) {
    if (m[2] === 'async') continue; // `async (…) =>` is the parenthesized form
    out.push({ name: m[1], paramText: m[2], body: arrowBody(m.index + m[0].length) });
  }
  while ((m = methodRe.exec(src)) !== null) {
    if (NOT_A_METHOD.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const close = skipBalanced(src, open);
    // A method declaration is followed by `{` (after an optional return type);
    // a call is followed by `;`, `)`, `.` or a newline.
    if (!/^\s*(?::[^;{]+)?\{/.test(src.slice(close))) continue;
    const body = blockBody(close);
    if (body) out.push({ name: m[1], paramText: src.slice(open + 1, close - 1), body });
  }
  return out;
}

function findWrappers(src: string, file: string, known: Iterable<string> = []): string[] {
  // A call to an already-known wrapper is a log sink too, so a wrapper of a
  // wrapper is derived when this is iterated to a fixed point (deriveSinks).
  const knownList = [...known];
  const sinkRe = knownList.length
    ? new RegExp(`${CONSOLE_CALL.source}|\\b(?:${knownList.join('|')})\\s*\\(`)
    : CONSOLE_CALL;
  const names = new Set<string>();
  for (const c of candidates(src)) {
    const params = paramsOf(stripComments(c.paramText));
    if (params.length === 0) continue;
    const consoleCalls = findCalls(c.body, file, sinkRe).filter((call) => call.callee !== c.name);
    // Any reference to a parameter inside the console arguments forwards it:
    // spread (`...meta`), direct (`JSON.stringify(meta)`) or a member of it
    // (`meta.x`). A property key that merely shares the name (`obj.meta`) does not.
    const forwards = consoleCalls.some((call) =>
      params.some((p) => new RegExp(`\\.\\.\\.\\s*${p}\\b|(?<![\\w$.])${p}\\b`).test(call.args))
    );
    if (forwards) names.add(c.name);
  }
  return [...names];
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// ── Collection ──────────────────────────────────────────────────────────────

const FILES = walkTs(SRC_DIR);
const SOURCES = FILES.map((abs) => ({
  file: relative(SRC_DIR, abs).split('\\').join('/'),
  src: readFileSync(abs, 'utf8'),
}));

// Wrappers are derived per file; scan each wrapper's call sites in the file
// that declares it. An exported wrapper (function or const arrow) is matched
// by name in every file, so its importers' calls are sinks too.
function deriveSinks(sources: Array<{ file: string; src: string }>) {
  const wrappersByFile = new Map<string, string[]>();
  const exported = new Set<string>();
  // Iterate to a fixed point: a function that forwards a parameter to a known
  // wrapper is a wrapper too (Copilot review on #747: chained wrappers).
  for (let changed = true; changed;) {
    changed = false;
    for (const { file, src } of sources) {
      const known = new Set([...(wrappersByFile.get(file) ?? []), ...exported]);
      const found = findWrappers(src, file, known);
      if (found.some((w) => !(wrappersByFile.get(file) ?? []).includes(w))) {
        wrappersByFile.set(file, [...new Set([...(wrappersByFile.get(file) ?? []), ...found])]);
        changed = true;
      }
      for (const w of wrappersByFile.get(file) ?? []) {
        const decl = `export\\s+(?:(?:async\\s+)?function|const|let|var)\\s+${w}\\b`;
        if (!exported.has(w) && new RegExp(decl).test(src)) {
          exported.add(w);
          changed = true;
        }
      }
    }
  }
  const sinks: Sink[] = [];
  for (const { file, src } of sources) {
    sinks.push(...findCalls(src, file, CONSOLE_CALL));
    const names = new Set([...(wrappersByFile.get(file) ?? []), ...exported]);
    for (const w of names) sinks.push(...findCalls(src, file, new RegExp(`\\b${w}\\s*\\(`)));
  }
  return { wrappersByFile, sinks };
}

const { wrappersByFile: WRAPPERS_BY_FILE, sinks: SINKS } = deriveSinks(SOURCES);

/** Does `text` contain forbidden pattern `f` (after removing its sanctioned forms)? */
function hits(f: (typeof FORBIDDEN)[number], text: string): boolean {
  return f.re.test(f.safe ? text.replace(f.safe, '') : text);
}

/**
 * A parsed request URL, logged whole. Derived, not listed: every name bound to
 * `new URL(request.url)` (`const url = …`, `const here = …`), with the block it
 * lives in. In a log sink inside that block the name may only be read through a
 * part that has no query string; `{ url }`, `${url}`, `String(url)` and
 * `url.toString()` all write the full URL. An object KEY that shares the name
 * (`{ url: issue.url }`) is not a read, and another function's own `url` (a
 * validated logo address, say) is outside the block.
 */
const WHOLE_URL_LABEL = 'whole request URL';
const QUERYLESS_URL_PARTS = ['pathname', 'origin', 'host', 'hostname', 'protocol', 'port'];

interface UrlScope {
  name: string;
  start: number; // the declaration
  end: number; // end of the block that encloses it
}

/**
 * Every `{…}` block as [open, close), strings, templates and comments skipped.
 * `balanced` is false when the braces do not pair up (the scanner was thrown by
 * something it cannot read, a regex literal with a brace in it for one).
 */
function braceBlocks(src: string): { blocks: Array<[number, number]>; balanced: boolean } {
  const blocks: Array<[number, number]> = [];
  const stack: number[] = [];
  let balanced = true;
  let j = 0;
  while (j < src.length) {
    const c = src[j];
    const n = src[j + 1];
    if (c === '/' && n === '/') {
      const nl = src.indexOf('\n', j);
      j = nl === -1 ? src.length : nl;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', j + 2);
      j = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      j = skipQuoted(src, j);
    } else if (c === '`') {
      j = skipTemplate(src, j);
    } else {
      if (c === '{') stack.push(j);
      else if (c === '}') {
        const open = stack.pop();
        if (open === undefined) balanced = false;
        else blocks.push([open, j + 1]);
      }
      j++;
    }
  }
  return { blocks, balanced: balanced && stack.length === 0 };
}

function requestUrlScopes(src: string): UrlScope[] {
  const re =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*URL\s*)?=\s*new\s+URL\(\s*request\.url\s*\)(?!\s*\.)/g;
  const { blocks, balanced } = braceBlocks(src);
  const scopes: UrlScope[] = [];
  for (const m of src.matchAll(re)) {
    const at = m.index ?? 0;
    // Innermost block around the declaration. When the braces do not pair up,
    // or the declaration is at the top level, the whole file is the scope: the
    // rule then flags more, never less.
    const around = balanced
      ? blocks.filter(([open, close]) => open < at && at < close).sort((a, b) => b[0] - a[0])[0]
      : undefined;
    scopes.push({ name: m[1], start: around ? at : 0, end: around ? around[1] : src.length });
  }
  return scopes;
}

function readsWholeUrl(name: string, args: string): boolean {
  const id = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Quoted text is prose; a template literal is kept (`${url}` interpolates).
  const text = args.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
  return new RegExp(
    `(?<![\\w$.])${id}(?![\\w$])(?!\\s*:)(?!\\s*\\.\\s*(?:${QUERYLESS_URL_PARTS.join('|')})\\b)`
  ).test(text);
}

function deriveUrlScopes(sources: Array<{ file: string; src: string }>): Map<string, UrlScope[]> {
  return new Map(sources.map(({ file, src }) => [file, requestUrlScopes(src)]));
}

/** The names bound to the request URL whose block contains the sink `s`. */
function urlNamesAt(s: Sink, scopes: Map<string, UrlScope[]>): string[] {
  return [
    ...new Set(
      (scopes.get(s.file) ?? [])
        .filter((sc) => sc.start <= s.index && s.index < sc.end)
        .map((sc) => sc.name)
    ),
  ];
}

function violationsIn(sinks: Sink[], urlScopes: Map<string, UrlScope[]> = new Map()): string[] {
  const out: string[] = [];
  for (const s of sinks) {
    for (const f of FORBIDDEN) {
      if (f.files && !f.files.test(s.file)) continue;
      if (!hits(f, s.args)) continue;
      if (EXEMPTIONS.some((e) => e.file === s.file && e.pattern === f.label)) continue;
      out.push(`src/${s.file}:${s.line} ${s.callee}(…) contains "${f.label}" — ${f.why}`);
    }
    for (const name of urlNamesAt(s, urlScopes)) {
      if (!readsWholeUrl(name, s.args)) continue;
      if (EXEMPTIONS.some((e) => e.file === s.file && e.pattern === WHOLE_URL_LABEL)) continue;
      out.push(
        `src/${s.file}:${s.line} ${s.callee}(…) contains "${WHOLE_URL_LABEL}" — ` +
          `\`${name}\` is new URL(request.url); log ${name}.pathname or the route pattern`
      );
    }
  }
  return out;
}

const URL_SCOPES = deriveUrlScopes(SOURCES);

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Invariant: log redaction — no identifiers or credentials in log lines', () => {
  test('log-redaction | negative control | the walk sees the worker source', () => {
    expect(FILES.length, 'walkTs must find the worker .ts sources').toBeGreaterThan(50);
    const files = new Set(SOURCES.map((s) => s.file));
    for (const f of ['index.ts', 'handlers/forms.ts', 'handlers/data-subject.ts']) {
      expect(files.has(f), `walk must include src/${f}`).toBe(true);
    }
  });

  test('log-redaction | negative control | console sinks are found and parsed whole', () => {
    const consoleSinks = SINKS.filter((s) => s.callee.startsWith('console.'));
    expect(consoleSinks.length, 'the scanner must find the console calls').toBeGreaterThan(50);
    // The UNHANDLED_ERROR line is a multi-line JSON.stringify — its argument
    // text must reach the closing paren, not stop at the first `)`.
    const unhandled = consoleSinks.find(
      (s) => s.file === 'index.ts' && s.args.includes('UNHANDLED_ERROR')
    );
    expect(unhandled, 'index.ts UNHANDLED_ERROR console call must be a sink').toBeTruthy();
    expect(unhandled!.args).toContain('timestamp');
  });

  test('log-redaction | negative control | log wrappers are derived', () => {
    expect(
      WRAPPERS_BY_FILE.get('handlers/forms.ts'),
      'logFormEvent spreads its meta into console.log — it must be derived as a wrapper'
    ).toContain('logFormEvent');
    const formSinks = SINKS.filter(
      (s) => s.file === 'handlers/forms.ts' && s.callee === 'logFormEvent'
    );
    expect(formSinks.length, 'logFormEvent call sites must be scanned').toBeGreaterThan(5);
  });

  test('log-redaction | negative control | direct and spread forwarding both make a wrapper', () => {
    const spread =
      'function logA(meta: object) { console.log(JSON.stringify({ t: 1, ...meta })); }';
    const direct = 'function logB(meta: object) { console.log(JSON.stringify(meta)); }';
    const member = 'function logC(e: { id: string }) { console.warn(e.id); }';
    const none = 'function notLog(meta: object) { console.log("fixed"); return meta; }';
    const keyOnly =
      'function alsoNot(meta: object) { console.log({ x: other.meta }); return meta; }';
    expect(findWrappers(spread, 'fixture.ts')).toEqual(['logA']);
    expect(findWrappers(direct, 'fixture.ts')).toEqual(['logB']);
    expect(findWrappers(member, 'fixture.ts')).toEqual(['logC']);
    expect(findWrappers(none, 'fixture.ts')).toEqual([]);
    expect(findWrappers(keyOnly, 'fixture.ts')).toEqual([]);
    // Copilot review on #747: arrow functions and methods are wrappers too.
    const arrowBlock = 'const logD = (meta: object) => { console.log(JSON.stringify(meta)); };';
    const arrowExpr = 'const logE = async (m) => console.info(m);';
    const method = 'class X {\n  logF(meta: object): void {\n    console.error(meta);\n  }\n}';
    const callNotDecl = 'logG(meta);\nconsole.log("x");';
    expect(findWrappers(arrowBlock, 'fixture.ts')).toEqual(['logD']);
    expect(findWrappers(arrowExpr, 'fixture.ts')).toEqual(['logE']);
    expect(findWrappers(method, 'fixture.ts')).toEqual(['logF']);
    expect(findWrappers(callNotDecl, 'fixture.ts')).toEqual([]);
    // Copilot review on #747: a single parameter needs no parentheses.
    const bare = 'const logH = meta => console.log(meta);';
    const bareAsync = 'const logI = async m => { console.warn(JSON.stringify(m)); };';
    const bareNoLog = 'const double = n => n * 2;';
    expect(findWrappers(bare, 'fixture.ts')).toEqual(['logH']);
    expect(findWrappers(bareAsync, 'fixture.ts')).toEqual(['logI']);
    expect(findWrappers(bareNoLog, 'fixture.ts')).toEqual([]);
  });

  test('log-redaction | negative control | a wrapper of a wrapper is derived (fixed point)', () => {
    const { wrappersByFile, sinks } = deriveSinks([
      {
        file: 'lib/log.ts',
        src: [
          'function logA(meta) { console.log(meta); }',
          'function logB(meta) { logA(meta); }',
          'const logC = (m) => logB({ ...m });',
          'logC({ anonId });',
        ].join('\n'),
      },
    ]);
    expect(new Set(wrappersByFile.get('lib/log.ts'))).toEqual(new Set(['logA', 'logB', 'logC']));
    expect(violationsIn(sinks).some((v) => v.includes('logC(…)'))).toBe(true);
  });

  test('log-redaction | negative control | form record ids are refused in form logs only', () => {
    const rid = FORBIDDEN.find((f) => f.label === 'form record id')!;
    for (const leak of [
      '({ row_id: rest.id, decrypt_error: true })',
      '({ isNew, id })',
      "({ 'id': x })",
    ]) {
      expect(hits(rid, leak), `form record id must fire on ${leak}`).toBe(true);
    }
    for (const ok of [
      "('register', String(rest.event_id ?? eventId), 'error', { decrypt_error: true })",
      '({ count, isNew })',
    ]) {
      expect(hits(rid, ok), `form record id must not fire on ${ok}`).toBe(false);
    }
    const src =
      "logFormEvent('register', eventId, 'submit', { id, isNew });\nfunction logFormEvent(a, b, c, meta) { console.log(meta); }";
    expect(
      violationsIn(deriveSinks([{ file: 'handlers/forms.ts', src }]).sinks).length
    ).toBeGreaterThan(0);
    expect(violationsIn(deriveSinks([{ file: 'handlers/events.ts', src }]).sinks)).toEqual([]);
  });

  test('log-redaction | negative control | console.debug and console.trace are sinks', () => {
    for (const lvl of ['debug', 'trace']) {
      const { sinks } = deriveSinks([{ file: 'x.ts', src: `console.${lvl}({ draftToken });` }]);
      expect(violationsIn(sinks).length, `console.${lvl} must be a sink`).toBeGreaterThan(0);
    }
  });

  test('log-redaction | negative control | an exported wrapper makes importer calls sinks', () => {
    // Copilot review on #747: `export const` arrows propagate like `export function`.
    for (const decl of [
      'export const logX = (meta) => console.log(meta);',
      'export function logX(meta) { console.log(meta); }',
    ]) {
      const { sinks } = deriveSinks([
        { file: 'lib/log.ts', src: decl },
        { file: 'handlers/a.ts', src: "import { logX } from '../lib/log';\nlogX({ draftToken });" },
      ]);
      const importer = sinks.filter((s) => s.file === 'handlers/a.ts');
      expect(importer.length, `importer call must be a sink for: ${decl}`).toBe(1);
      expect(violationsIn(importer).length).toBeGreaterThan(0);
    }
    const { sinks } = deriveSinks([
      { file: 'lib/log.ts', src: 'const logY = (meta) => console.log(meta);' },
      { file: 'handlers/a.ts', src: 'logY({ ok: 1 });' },
    ]);
    expect(sinks.filter((s) => s.file === 'handlers/a.ts')).toEqual([]);
  });

  test('log-redaction | negative control | the matcher catches each forbidden key', () => {
    const bad: Record<string, string> = {
      anonId: '({ id, anonId, isNew })',
      anonymous_id: '(JSON.stringify({ anonymous_id: x }))',
      emailHash: '(JSON.stringify({ type: "X", emailHash }))',
      email_hash: '({ email_hash: h })',
      'request.url': '(JSON.stringify({ q: new URL(request.url).search }))',
      'URL query': '(JSON.stringify({ type: "X", q: url.search }))',
      'token:': '({ token: t, ok: true })',
      'credential name': '(JSON.stringify({ type: "X", draftToken }))',
      'form record id': "('register', eventId, 'submit', { id, isNew })",
      'token shorthand': '({ ok: true, token })',
      cookie: '({ value: request.headers.get("Cookie") })',
    };
    for (const f of FORBIDDEN) {
      expect(hits(f, bad[f.label]), `matcher for ${f.label} must fire`).toBe(true);
    }
    const cred = FORBIDDEN.find((f) => f.label === 'credential name')!;
    for (const leak of [
      '({ draft_token: t })',
      '(`draft ${draftToken}`)',
      '({ sessionSecret })',
      // Copilot review on #747: a quoted key names the credential too.
      '(JSON.stringify({ "draftToken": value }))',
      "({ ok: true, 'draft_token': t })",
    ]) {
      expect(hits(cred, leak), `credential matcher must fire on ${leak}`).toBe(true);
    }
    const reqUrl = FORBIDDEN.find((f) => f.label === 'request.url')!;
    for (const leak of [
      '(new URL(request.url).href)',
      '({ url: request.url })',
      '(`${request.url}`)',
    ]) {
      expect(hits(reqUrl, leak), `request.url matcher must fire on ${leak}`).toBe(true);
    }
    const good = [
      '({ path: new URL(request.url).pathname })',
      '({ isNew, latencyMs })',
      '({ anonIdHash: h, tokenType: "x", count })',
      "({ reason: !secret ? 'no_secret' : 'no_hostnames' })",
    ];
    for (const g of good) {
      for (const f of FORBIDDEN) {
        expect(hits(f, g), `matcher for ${f.label} must not fire on ${g}`).toBe(false);
      }
    }
  });

  test('log-redaction | negative control | the query half of a parsed URL is refused', () => {
    // Not `request.url` in the call itself: the URL was parsed a line earlier.
    const q = FORBIDDEN.find((f) => f.label === 'URL query')!;
    for (const leak of [
      '(JSON.stringify({ type: "X", q: url.search }))',
      "({ t: url.searchParams.get('t') })",
      '(`failed ${here.href}`)',
      '({ link: requestUrl.href })',
    ]) {
      expect(hits(q, leak), `URL query matcher must fire on ${leak}`).toBe(true);
    }
    for (const ok of [
      '({ path: url.pathname, origin: url.origin })',
      '({ researched: true, searchCount: 3, hrefs })',
    ]) {
      expect(hits(q, ok), `URL query matcher must not fire on ${ok}`).toBe(false);
    }
    const src = [
      'export async function handle(request: Request) {',
      '  const url = new URL(request.url);',
      '  console.error(JSON.stringify({ type: "X", q: url.search }));',
      '}',
    ].join('\n');
    const sources = [{ file: 'handlers/x.ts', src }];
    const found = violationsIn(deriveSinks(sources).sinks, deriveUrlScopes(sources));
    expect(found.some((v) => v.includes('"URL query"'))).toBe(true);
  });

  test('log-redaction | negative control | a parsed request URL logged whole is refused', () => {
    const wrap = (call: string, decl = 'const url = new URL(request.url);') => [
      {
        file: 'handlers/x.ts',
        src: `async function h(request: Request) {\n  ${decl}\n  ${call}\n}`,
      },
    ];
    const whole = (sources: Array<{ file: string; src: string }>) =>
      violationsIn(deriveSinks(sources).sinks, deriveUrlScopes(sources)).filter((v) =>
        v.includes(`"${WHOLE_URL_LABEL}"`)
      );
    for (const leak of [
      'console.error(JSON.stringify({ type: "X", url }));',
      'console.error(JSON.stringify({ type: "X", at: url }));',
      'console.warn(`failed on ${url}`);',
      'console.log(String(url));',
      'console.log(url.toString());',
      'console.log({ a: 1, url, b: 2 });',
    ]) {
      expect(whole(wrap(leak)).length, `must fire on ${leak}`).toBe(1);
    }
    // Any name the URL was bound to is derived, typed or not.
    expect(
      whole(wrap('console.log({ here });', 'const here: URL = new URL(request.url);')).length
    ).toBe(1);
    for (const ok of [
      'console.log({ path: url.pathname, origin: url.origin, host: url.hostname });',
      'console.log({ url: issue.url });',
      "console.log('url', { count });",
      'console.log({ curl, urls, my_url });',
    ]) {
      expect(whole(wrap(ok)), `must not fire on ${ok}`).toEqual([]);
    }
    // A name bound to something else is not a request URL …
    expect(whole(wrap('console.log({ url });', 'const url = sponsor.website_url;'))).toEqual([]);
    // … and neither is `new URL(request.url).pathname`, which is a string.
    expect(
      whole(wrap('console.log({ url });', 'const url = new URL(request.url).pathname;'))
    ).toEqual([]);
    // The scope is the block the URL was parsed in, from that line on: a sink in
    // a callback inside it counts, another function's own `url` does not, and
    // neither does a sink above the declaration.
    const two = (first: string, second: string) => [
      {
        file: 'handlers/x.ts',
        src: [
          'async function a(request: Request) {',
          '  console.info({ early: url });',
          '  const url = new URL(request.url);',
          `  ${first}`,
          '}',
          'function b(sponsor: { website_url: string }) {',
          '  const url = sponsor.website_url;',
          `  ${second}`,
          '}',
        ].join('\n'),
      },
    ];
    expect(whole(two('items.forEach((i) => { console.log({ i, url }); });', '')).length).toBe(1);
    expect(whole(two('', 'console.log({ url });'))).toEqual([]);
    // Braces the scanner cannot pair: the whole file becomes the scope.
    const unbalanced = two('', 'console.log({ url });');
    unbalanced[0].src += '\n}';
    expect(whole(unbalanced).length).toBe(2);
    // The names are derived in the worker source too, so the rule is not vacuous,
    // and the scanner pairs the braces of nearly every file it reads.
    expect(
      [...URL_SCOPES.values()].flat().length,
      'the walk must find names bound to new URL(request.url)'
    ).toBeGreaterThan(10);
    const unpaired = SOURCES.filter(({ src }) => !braceBlocks(src).balanced).map((s) => s.file);
    expect(
      unpaired.length,
      `files whose braces the scanner cannot pair (whole-file scope there): ${unpaired.join(', ')}`
    ).toBeLessThan(SOURCES.length / 10);
  });

  test('log-redaction | every exemption is still needed and has a reason', () => {
    for (const e of EXEMPTIONS) {
      expect(
        e.reason.trim().length,
        `exemption ${e.file}/${e.pattern} needs a reason`
      ).toBeGreaterThan(10);
      if (e.pattern === WHOLE_URL_LABEL) {
        const hit = SINKS.some(
          (s) =>
            s.file === e.file && urlNamesAt(s, URL_SCOPES).some((n) => readsWholeUrl(n, s.args))
        );
        expect(hit, `exemption ${e.file}/${e.pattern} is stale — remove it`).toBe(true);
        continue;
      }
      const f = FORBIDDEN.find((x) => x.label === e.pattern);
      expect(f, `exemption ${e.file}/${e.pattern} names an unknown pattern`).toBeTruthy();
      const hit = SINKS.some((s) => s.file === e.file && hits(f!, s.args));
      expect(hit, `exemption ${e.file}/${e.pattern} is stale — remove it`).toBe(true);
    }
  });

  test('log-redaction | no log sink carries an identifier or credential', () => {
    const violations = violationsIn(SINKS, URL_SCOPES);
    expect(
      violations,
      'Log lines must not carry identifiers or credentials (Workers Logs are on). ' +
        'Log the pathname or the route pattern, not request.url, url.search or the parsed URL; ' +
        'drop anonId / emailHash; never log tokens or cookies.\n' +
        violations.join('\n')
    ).toEqual([]);
  });
});
