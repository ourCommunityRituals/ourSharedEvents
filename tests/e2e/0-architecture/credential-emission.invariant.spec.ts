/**
 * INVARIANT: the Worker never emits a credential.
 *
 * A credential the Worker receives (an Access JWT, the admin key, the CI
 * header, a service token, a cookie) or holds (a key, a pepper, a signing
 * secret) is compared, verified or hashed. It is never written into an answer
 * (body or header) and never into a log line.
 *
 * This gate is STRUCTURAL (reads source via node:fs, no deployed worker) and
 * PROPERTY-ASSERTING (README "Gate shape"). It derives its subjects:
 *   1. every `.ts` file under workers/oursharedevents/src (walked, not listed);
 *   2. every SOURCE in them: a read of a credential request header
 *      (`headers.get('Authorization')` …), the request's headers taken whole
 *      (`request.headers` passed on, spread or listed), and a secret binding
 *      (`env.NAME`, the name deciding: KEY, SECRET, TOKEN, PEPPER, PEM …);
 *   3. every NAME that holds one: `const token = extractBearer(…)`, and then
 *      every name bound from that name, to a fixed point, inside one function;
 *      plus every READER, a function that returns one (`bearerToken(request)`),
 *      whose calls are sources wherever they are made;
 *   4. every SINK: `console.*(…)`, `new Response(…)`, `Response.json(…)`,
 *      `Response.redirect(…)`, `headers.set/append(…)`, and every WRAPPER, a
 *      function that passes one of its own parameters into a sink (`json(…)`,
 *      `fail(…)`, `html(…)`, `logFormEvent(…)`), to a fixed point.
 * A sink whose argument text carries a source or a holding name fails.
 *
 * What a helper does with a credential is derived too, not assumed:
 *   - a PASS-THROUGH returns what it is given (`extractBearer(header)`,
 *     `escapeHtml(text)`), so what comes out of it is still the credential;
 *   - a WRAPPER writes a parameter out, so its call is a sink for that argument;
 *   - any other call is where the value stops: it is compared, verified,
 *     hashed, signed with or sent upstream, and what comes back is something
 *     else (a boolean, claims, a digest). The built-ins that hand a value back
 *     (`JSON.stringify`, `String`, `encodeURIComponent` …) are listed.
 *
 * Signed links are a route's product. They are classified, not hidden:
 * MINT_SITES names every call that mints a token and what its route does with
 * it. A mint call that is not in the table fails; so does a table row that
 * matches no call. The runtime side reads the answers themselves:
 * workers/oursharedevents/tests/credential-echo.derived.spec.ts. The vote pass
 * `/q` mints is a row in the same table, and one test holds its path in the
 * source: minted in one place, asked for by `/q` alone, used once.
 *
 * Log redaction is wired here too: src/index.ts installs it when it loads and
 * at each entry, and nothing else in src/ reassigns the console.
 *
 * Limits: this reads text, not types. A credential that reaches a sink through
 * an object field set far from the sink (`out.token = t; … json(out)`), through
 * a collection it was pushed into, or from a request held under a name other
 * than `request` / `req` with its headers taken whole, is not seen here. The
 * runtime sweep is what reads every answer for it.
 *
 * @born-red each rule | method: faults put into the real source, one at a time,
 *   and taken out again: the Authorization header written into a 401 body in
 *   auth/admin.ts; the bearer logged in handlers/sponsors-draft.ts through its
 *   reader `bearer(request)`; `(env as { ADMIN_KEY?: string }).ADMIN_KEY` in a
 *   response header in handlers/health.ts; `Object.fromEntries(request.headers)`
 *   in a log line in router.ts; the Access JWT handed to the log wrapper
 *   `logJwtRefused` in router.ts; a refused report token answered through the
 *   helper `jsonResponse` in handlers/shared-report-read.ts; a new
 *   `mintBeaconToken(…)` call in handlers/events.ts; the installLogRedaction()
 *   call removed from the top of index.ts, then from its `fetch`;
 *   `console.log = …` in a handler. Nine failed their own test at once, naming
 *   the file and line. The binding in the response header stayed GREEN: the
 *   scan knew `env.NAME` and `(env as Type).NAME` but not an inline object
 *   type. It now reads a secret-named property off any receiver, and that
 *   fault fails too. The made-up cases under "the analysis can fail" keep one
 *   fault of each kind in the suite | date: 2026-11-18
 * @born-red the vote pass, classified and held to one way out | method: on
 *   main, where the /q vote pass had merged beside this gate, "every call that
 *   mints a token is classified" failed on `lib/vote-pass.ts mintVotePass`.
 *   With the row added, seven faults, one at a time: /q made to log the pass;
 *   /q made to set it as a response header; a second handler calling
 *   `issueVotePass`; a second file calling `mintVotePass`; the pass put after
 *   `?t=`; the row's callee renamed; the /q row's place taken out of the
 *   runtime table. Each failed "the vote pass has one way out", "every call
 *   that mints a token is classified" or "the runtime gate classifies the same
 *   products" | date: 2026-11-18
 *
 * Runs in the T0 Gate `invariants` shard — listed in the
 * "Architecture: structural invariants" step of
 * .github/workflows/oursharedevents-ci.yml (enforced by
 * tests/integration/infra-consistency.test.js).
 */

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_DIR = join(REPO_ROOT, 'workers', 'oursharedevents');
const SRC_DIR = join(WORKER_DIR, 'src');

// ── What counts as a credential ──────────────────────────────────────────────

/** Request headers whose value is a credential (the ticket's list, plus the Access cookie's name). */
const CREDENTIAL_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'cf-access-jwt-assertion',
  'cf-access-client-secret',
  'cf-authorization',
  'x-ocr-internal',
];

/** A binding holds a secret when its name says so. Flags and public keys are not secrets. */
function isSecretBindingName(name: string): boolean {
  if (/^(ALLOW_|TEST_)/.test(name)) return false;
  if (/(_ROTATED_AT|_SITE_KEY|_KEY_FALLBACK)$/.test(name)) return false;
  return /(KEY|SECRET|TOKEN|PEPPER|PEM|PASSWORD|X_OCR_INTERNAL)/.test(name);
}

/**
 * Built-ins that hand back what they are given, by the callee's last name.
 * Functions in src/ that do the same are derived (see `analyse`).
 */
const BUILTIN_PASS_THROUGH = new Set([
  'stringify',
  'String',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'btoa',
  'atob',
  'fromEntries',
  'entries',
  'values',
  'from',
  'assign',
  'concat',
  'structuredClone',
]);

/** Names that are an entry point or a platform call, never a helper of ours. */
const NOT_A_HELPER = new Set(['fetch', 'scheduled', 'queue', 'get', 'set', 'has', 'then', 'catch']);

// ── A small scanner: skip strings / templates / comments, balance brackets ──

function skipQuoted(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === q) return j + 1;
    else if (c === '\n') return j;
    else j++;
  }
  return j;
}

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

/** `src[i]` opens a bracket: the index just past its match. */
function skipBalanced(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") j = skipQuoted(src, j);
    else if (c === '`') j = skipTemplate(src, j);
    else if (c === '(' || c === '[' || c === '{') {
      depth++;
      j++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      j++;
      if (depth === 0) return j;
    } else j++;
  }
  return j;
}

/**
 * `text[i]` is a `/` that is not a comment. If it opens a regex literal, the
 * index just past the literal (flags included); otherwise -1 (a division).
 * A regex literal can only follow an operator, an opening bracket or a keyword.
 */
function regexLiteralEnd(text: string, i: number, before: string): number {
  const prev = before.trimEnd();
  const last = prev[prev.length - 1] ?? '';
  const afterKeyword = /(?:^|[^\w$])(?:return|typeof|case|in|of|void|delete|throw|new)$/.test(prev);
  if (!(prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || afterKeyword)) return -1;
  let j = i + 1;
  let inClass = false;
  while (j < text.length) {
    const c = text[j];
    if (c === '\n') return -1;
    if (c === '\\') j += 2;
    else if (inClass) {
      if (c === ']') inClass = false;
      j++;
    } else if (c === '[') {
      inClass = true;
      j++;
    } else if (c === '/') {
      j++;
      while (j < text.length && /[a-z]/.test(text[j])) j++;
      return j;
    } else j++;
  }
  return -1;
}

/**
 * Comments become spaces and a regex literal's pattern becomes `x`s (newlines
 * and lengths kept), so offsets and line numbers hold and no later pass reads a
 * quote, a bracket or `//` inside a pattern as code.
 */
function blankComments(text: string): string {
  let out = '';
  let j = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  while (j < text.length) {
    const c = text[j];
    const n = text[j + 1];
    const regexEnd = c === '/' && n !== '*' && n !== '/' ? regexLiteralEnd(text, j, out) : -1;
    if (regexEnd !== -1) {
      out += `/${'x'.repeat(Math.max(0, regexEnd - j - 2))}/`;
      j = regexEnd;
    } else if (c === '/' && n === '/') {
      const nl = text.indexOf('\n', j);
      const e = nl === -1 ? text.length : nl;
      out += blank(text.slice(j, e));
      j = e;
    } else if (c === '/' && n === '*') {
      const end = text.indexOf('*/', j + 2);
      const e = end === -1 ? text.length : end + 2;
      out += blank(text.slice(j, e));
      j = e;
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

/**
 * The text with plain string literals emptied (`'…'` → `''`), so a word inside
 * prose is not read as a name. Template literals keep their `${…}` parts.
 */
function emptyStrings(text: string): string {
  let out = '';
  let j = 0;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'") {
      const e = skipQuoted(text, j);
      out += c + c;
      j = e;
    } else if (c === '`') {
      const e = skipTemplate(text, j);
      const body = text.slice(j, e);
      // Keep only what is interpolated.
      let kept = '`';
      let k = 1;
      while (k < body.length - 1) {
        if (body[k] === '\\') k += 2;
        else if (body[k] === '$' && body[k + 1] === '{') {
          const end = skipBalanced(body, k + 1);
          kept += '${' + emptyStrings(body.slice(k + 2, end - 1)) + '}';
          k = end;
        } else k++;
      }
      out += kept + '`';
      j = e;
    } else {
      out += c;
      j++;
    }
  }
  return out;
}

function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length;
}

// ── Sources ──────────────────────────────────────────────────────────────────

const HEADER_READ = new RegExp(
  `\\.headers\\s*\\.\\s*get\\(\\s*(['"\`])(?:${CREDENTIAL_HEADERS.join('|')})\\1\\s*\\)`,
  'gi'
);
/**
 * A request header read by a name that is not written out (`headers.get(name)`):
 * it cannot be told apart from a credential header, so it is treated as one.
 */
const HEADER_READ_BY_VARIABLE = /\b(?:request|req)\s*\.\s*headers\s*\.\s*get\(\s*(?!['"`])[^)]*\)/g;
/** The request's headers used whole: not `.get(` / `.has(` of one name. */
const WHOLE_HEADERS = /\b(?:request|req)\s*\.\s*headers\b(?!\s*\.\s*(?:(?:get|has)\s*\(|§SRC§))/g;
/**
 * A secret binding read off any receiver: `env.NAME`, `e?.NAME`,
 * `(env as AdminEnv).NAME`, `(env as { NAME?: string }).NAME`. The name decides.
 */
const SECRET_BINDING = /(?<=[\w$)\]])\s*\??\.\s*([A-Z][A-Z0-9_]{2,})\b/g;

/** `text` with every source replaced by the marker `§SRC§`. Strings already emptied. */
function markSources(text: string, rawForHeaders: string): string {
  // Header names live in string literals, so they are found in the raw text
  // and marked at the same offsets (emptyStrings would have removed them).
  void rawForHeaders;
  return text
    .replace(WHOLE_HEADERS, '§SRC§')
    .replace(SECRET_BINDING, (m, name: string) => (isSecretBindingName(name) ? '.§SRC§' : m));
}

/**
 * Prepare one file: comments blanked, credential header reads turned into the
 * marker (before strings are emptied), strings emptied, the other sources marked.
 */
function prepare(src: string): string {
  const noComments = blankComments(src);
  const withHeaderMarks = noComments
    .replace(HEADER_READ, '.headers.§SRC§')
    .replace(HEADER_READ_BY_VARIABLE, 'request.headers.§SRC§');
  return markSources(emptyStrings(withHeaderMarks), withHeaderMarks);
}

// ── Does an expression carry a credential? ───────────────────────────────────

/** Split argument text at its top-level commas. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let j = 0;
  let start = 0;
  while (j < args.length) {
    const c = args[j];
    if (c === '(' || c === '[' || c === '{') j = skipBalanced(args, j);
    else if (c === '"' || c === "'") j = skipQuoted(args, j);
    else if (c === '`') j = skipTemplate(args, j);
    else if (c === ',') {
      out.push(args.slice(start, j));
      start = ++j;
    } else j++;
  }
  out.push(args.slice(start));
  return out;
}

/** Methods that hand back the string they are called on, or a piece of it. */
const STRING_KEEPING_METHOD =
  /^(?:trim|trimStart|trimEnd|slice|substring|substr|replace|replaceAll|toString|toLowerCase|toUpperCase|padStart|padEnd|split|match|concat|normalize|at|valueOf|join)$/;

/** Which parameter positions a function hands back (a pass-through), by name. */
type Positions = ReadonlyMap<string, ReadonlySet<number>>;

/**
 * Remove the arguments of every call that does not hand its input back (a call
 * is where a credential stops unless the callee is a pass-through for that
 * argument), turn a reader's call into a source, and drop the forms that only
 * test a value.
 */
function reduce(expr: string, passThrough: Positions, readers: ReadonlySet<string>): string {
  let out = '';
  let j = 0;
  while (j < expr.length) {
    const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(expr.slice(j));
    if (m && !/[\w$]/.test(expr[j - 1] ?? '')) {
      const open = j + m[0].length - 1;
      const close = skipBalanced(expr, open);
      const inner = expr.slice(open + 1, close - 1);
      const isMethod = /\.\s*$/.test(expr.slice(0, j));
      const positions = isMethod ? undefined : passThrough.get(m[1]);
      if (!isMethod && readers.has(m[1])) {
        out += '§SRC§';
      } else if (BUILTIN_PASS_THROUGH.has(m[1])) {
        out += `${m[1]}(${reduce(inner, passThrough, readers)})`;
      } else if (positions) {
        const kept = splitArgs(inner)
          .filter((_, i) => positions.has(i))
          .map((a) => reduce(a, passThrough, readers));
        out += `${m[1]}(${kept.join(', ')})`;
      } else {
        out += `${m[1]}()`;
      }
      j = close;
      continue;
    }
    out += expr[j];
    j++;
  }
  return (
    out
      // `!x`, `!!x`, `typeof x`: a test of the value, not the value
      .replace(
        /(?:!+|\btypeof\s+)\s*(?:§SRC§|[A-Za-z_$][\w$]*)(?:\s*\?\.\s*trim\(\))?(?![\w$.([])/g,
        ' true '
      )
      // `x.length`, `x.trim().length`
      .replace(/(?:§SRC§|[A-Za-z_$][\w$]*)(?:\s*\??\.\s*trim\(\))?\s*\??\.\s*length\b/g, ' 0 ')
      // `x === y`, `x !== y`, `x == null`
      .replace(/(?:§SRC§|[A-Za-z_$][\w$.]*)\s*[!=]==?\s*(?:§SRC§|[A-Za-z_$'"][\w$.'"]*)/g, ' true ')
  );
}

interface Known {
  passThrough: Positions;
  readers: ReadonlySet<string>;
}
const NOTHING_KNOWN: Known = { passThrough: new Map(), readers: new Set() };

/**
 * What `expr` carries: a source, or one of `names` used as a value. Null when
 * neither. `namesOnly` ignores sources: it asks only whether `names` come through.
 */
function carries(
  expr: string,
  names: ReadonlySet<string>,
  known: Known = NOTHING_KNOWN,
  namesOnly = false
): string | null {
  const text = reduce(expr, known.passThrough, namesOnly ? new Set() : known.readers);
  if (!namesOnly && text.includes('§SRC§')) return 'a credential read';
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (!names.has(m[0])) continue;
    const i = m.index ?? 0;
    const before = text.slice(0, i).trimEnd();
    const after = text.slice(i + m[0].length).trimStart();
    if (before.endsWith('.') && !before.endsWith('...')) continue; // `obj.token`: another thing's field
    // `{ token: x }`: a key
    if (after.startsWith(':') && /[{,]\s*$/.test(before)) continue;
    // `claims.email`, `scope.mode`: a field of what the name holds is not the
    // credential. A piece of the string is (`token.slice(…)`, `m[1]`).
    const field = /^\??\.\s*([A-Za-z_$][\w$]*)/.exec(after);
    if (field && !STRING_KEEPING_METHOD.test(field[1])) continue;
    return `\`${m[0]}\``;
  }
  return null;
}

// ── Functions, names, readers, wrappers ──────────────────────────────────────

interface Fn {
  file: string;
  name: string;
  params: string[];
  /** Offsets of the body in the prepared text. */
  start: number;
  end: number;
}

const NOT_A_FUNCTION = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'with',
]);

function paramNames(paramText: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of paramText) {
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out
    .map((p) => /^\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)/.exec(p)?.[1] ?? '')
    .filter((p) => p.length > 0);
}

/**
 * `i` is just past a parameter list. Skip an optional return type (which may
 * itself hold `{ … }`, `<…>` or `(…) => …`) and an optional `=>`, and give the
 * offset of the `{` that opens the body. Null when no body follows.
 */
function bodyStart(text: string, i: number): { at: number; arrow: boolean } | null {
  let j = i;
  const ws = () => {
    while (j < text.length && /\s/.test(text[j])) j++;
  };
  ws();
  if (text[j] === ':') {
    j++;
    let wantType = true; // right after `:`, `|`, `&` or a type's own `=>`
    for (let guard = 0; guard < 400 && j < text.length; guard++) {
      ws();
      const c = text[j];
      if (c === '{') {
        if (!wantType) break;
        j = skipBalanced(text, j);
        wantType = false;
      } else if (c === '(' || c === '[') {
        j = skipBalanced(text, j);
        wantType = false;
      } else if (c === '<') {
        let depth = 0;
        do {
          if (text[j] === '<') depth++;
          else if (text[j] === '>' && text[j - 1] !== '=') depth--;
          j++;
        } while (depth > 0 && j < text.length);
        wantType = false;
      } else if (c === '|' || c === '&') {
        j++;
        wantType = true;
      } else if (c === '=' && text[j + 1] === '>') {
        if (!wantType) break; // the arrow of the function itself
        j += 2;
      } else if (/[\w$.'"]/.test(c ?? '')) {
        while (j < text.length && /[\w$.'"]/.test(text[j])) j++;
        const word = text.slice(Math.max(0, j - 3), j);
        wantType = /\bis$/.test(word) && /\s/.test(text[j] ?? ''); // `x is Type`
      } else return null;
    }
  }
  ws();
  let arrow = false;
  if (text[j] === '=' && text[j + 1] === '>') {
    arrow = true;
    j += 2;
    ws();
  }
  return text[j] === '{' ? { at: j, arrow } : null;
}

/** Every function with a braced body: declarations, arrow consts and methods. */
function functionsIn(file: string, text: string): Fn[] {
  const fns: Fn[] = [];
  const re =
    /(?:\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(|(?:^|\n)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1] ?? m[2] ?? m[3];
    if (!name || NOT_A_FUNCTION.has(name)) continue;
    const open = m.index + m[0].length - 1;
    const close = skipBalanced(text, open);
    const after = bodyStart(text, close);
    if (!after) continue;
    if (m[2] && !after.arrow) continue; // `const x = (…)` that is not an arrow function
    if (m[3] && after.arrow) continue; // a call followed by an arrow is not a method
    const bodyOpen = after.at;
    const bodyClose = skipBalanced(text, bodyOpen);
    fns.push({
      file,
      name,
      params: paramNames(text.slice(open + 1, close - 1)),
      start: bodyOpen,
      end: bodyClose,
    });
  }
  return fns;
}

/** The innermost function whose body holds `offset`. */
function enclosing(fns: readonly Fn[], offset: number): Fn | null {
  let best: Fn | null = null;
  for (const f of fns) {
    if (offset >= f.start && offset < f.end && (!best || f.end - f.start < best.end - best.start)) {
      best = f;
    }
  }
  return best;
}

/** The outermost function whose body holds `offset` (names are tracked across its nested callbacks). */
function outermost(fns: readonly Fn[], offset: number): Fn | null {
  let best: Fn | null = null;
  for (const f of fns) {
    if (offset >= f.start && offset < f.end && (!best || f.end - f.start > best.end - best.start)) {
      best = f;
    }
  }
  return best;
}

interface Decl {
  names: string[];
  init: string;
  offset: number;
  /** For `const { key, other: alias } = …`: key → the local name it is bound to. */
  byKey?: Map<string, string>;
}

/** `const|let|var NAME = init;` and destructuring forms, with the init text. */
function declarationsIn(text: string, from: number, to: number): Decl[] {
  const out: Decl[] = [];
  const re =
    /\b(?:const|let|var)\s+(\{[^=]*?\}|\[[^=]*?\]|[A-Za-z_$][\w$]*)\s*(?::[^=;]+?)?=(?!=|>)/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < to) {
    let j = m.index + m[0].length;
    const startInit = j;
    while (j < to) {
      const c = text[j];
      if (c === '(' || c === '[' || c === '{') j = skipBalanced(text, j);
      else if (c === '"' || c === "'") j = skipQuoted(text, j);
      else if (c === '`') j = skipTemplate(text, j);
      else if (c === ';') break;
      else j++;
    }
    const target = m[1];
    const names = /^[{[]/.test(target)
      ? [...target.matchAll(/(?:^|[{,[]|:)\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?=[,}\]=]|$)/g)].map(
          (x) => x[1]
        )
      : [target];
    let byKey: Map<string, string> | undefined;
    if (target.startsWith('{') && !target.includes('...') && !/[{[]/.test(target.slice(1, -1))) {
      byKey = new Map();
      for (const part of target.slice(1, -1).split(',')) {
        const pair = /^\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?:=.*)?$/.exec(part);
        if (pair) byKey.set(pair[1], pair[2] ?? pair[1]);
      }
    }
    out.push({ names, init: text.slice(startInit, j), offset: m.index, byKey });
  }
  return out;
}

/** `NAME = expr;` assignments to an existing name (`token = extract(…)`). */
function assignmentsIn(text: string, from: number, to: number): Decl[] {
  const out: Decl[] = [];
  const re = /(?:^|[;{}\n])\s*([A-Za-z_$][\w$]*)\s*=(?!=|>)/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < to) {
    let j = m.index + m[0].length;
    const startInit = j;
    while (j < to) {
      const c = text[j];
      if (c === '(' || c === '[' || c === '{') j = skipBalanced(text, j);
      else if (c === '"' || c === "'") j = skipQuoted(text, j);
      else if (c === '`') j = skipTemplate(text, j);
      else if (c === ';') break;
      else j++;
    }
    out.push({ names: [m[1]], init: text.slice(startInit, j), offset: m.index });
  }
  return out;
}

const DIRECT_SINK =
  /(?:\bconsole\s*\.\s*(?:log|info|warn|error|debug|trace)|\bnew\s+Response|\bResponse\s*\.\s*(?:json|redirect)|\bheaders\s*\.\s*(?:set|append))\s*\(/g;

interface Call {
  callee: string;
  args: string;
  offset: number;
}

function callsMatching(text: string, re: RegExp, from = 0, to = text.length): Call[] {
  const out: Call[] = [];
  const g = new RegExp(re.source, 'g');
  g.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null && m.index < to) {
    const open = m.index + m[0].length - 1;
    if (text[open] !== '(') continue;
    if (/\bfunction\s+$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
    const close = skipBalanced(text, open);
    out.push({
      callee: m[0].slice(0, -1).replace(/\s+/g, ''),
      args: text.slice(open + 1, close - 1),
      offset: m.index,
    });
  }
  return out;
}

export interface Finding {
  file: string;
  line: number;
  sink: string;
  carries: string;
}

interface Analysis {
  findings: Finding[];
  readers: string[];
  passThrough: string[];
  wrappers: string[];
  /** For each reader and pass-through, the `return` that made it one. */
  why: Record<string, string>;
  /** How many sources were found, per kind, so a blind scan is visible. */
  sources: { headerReads: number; wholeHeaders: number; secretBindings: number };
  sinks: number;
}

/**
 * Read a set of source files (path → text) for a credential that reaches a sink.
 */
export function analyse(files: Readonly<Record<string, string>>): Analysis {
  const prepared: Record<string, string> = {};
  const fnsByFile: Record<string, Fn[]> = {};
  const sources = { headerReads: 0, wholeHeaders: 0, secretBindings: 0 };
  for (const [file, src] of Object.entries(files)) {
    const noComments = blankComments(src);
    sources.headerReads += [...noComments.matchAll(HEADER_READ)].length;
    sources.headerReads += [...noComments.matchAll(HEADER_READ_BY_VARIABLE)].length;
    sources.wholeHeaders += [...noComments.matchAll(WHOLE_HEADERS)].length;
    sources.secretBindings += [...noComments.matchAll(SECRET_BINDING)].filter((m) =>
      isSecretBindingName(m[1])
    ).length;
    prepared[file] = prepare(src);
    fnsByFile[file] = functionsIn(file, prepared[file]);
  }

  const fnBody = (file: string, fn: Fn): string => prepared[file].slice(fn.start, fn.end);
  /**
   * For a reader that returns an object literal: the keys that carry
   * (`{ anonId: match[1], isNew: false }` → `anonId`). Null: all of it carries.
   */
  const readerKeys = new Map<string, Set<string> | null>();
  /** The names a declaration binds a credential to. */
  const bound = (d: Decl): string[] => {
    const call = /^\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(d.init);
    const keys = call ? readerKeys.get(call[1]) : undefined;
    if (!d.byKey || !keys) return d.names;
    // `const { anonId, isNew } = reader(…)`: only the keys the reader fills with it.
    const whole = skipBalanced(d.init, d.init.indexOf('(')) >= d.init.trimEnd().length;
    if (!whole) return d.names;
    return [...d.byKey].filter(([key]) => keys.has(key)).map(([, local]) => local);
  };
  /** The names in `fn` that hold one of `seeds`, to a fixed point over its declarations. */
  const localNames = (
    file: string,
    fn: Fn,
    seeds: Iterable<string>,
    known: Known,
    namesOnly = false
  ): Set<string> => {
    const names = new Set(seeds);
    const text = prepared[file];
    const decls = [
      ...declarationsIn(text, fn.start, fn.end),
      ...assignmentsIn(text, fn.start, fn.end),
    ];
    for (let again = true; again;) {
      again = false;
      for (const d of decls) {
        if (carries(d.init, names, known, namesOnly) === null) continue;
        for (const n of bound(d)) {
          if (!names.has(n)) {
            names.add(n);
            again = true;
          }
        }
      }
    }
    return names;
  };
  /** Why each reader is one: the `return` that carries, for a failure message. */
  const why: Record<string, string> = {};
  /**
   * Whether one of `fn`'s own `return`s (not a nested callback's) carries, and
   * for object-literal returns, under which keys.
   */
  const returnsCarrying = (
    file: string,
    fn: Fn,
    names: ReadonlySet<string>,
    known: Known,
    namesOnly = false
  ): { where: string; keys: Set<string> | null } | null => {
    const body = fnBody(file, fn);
    let where: string | null = null;
    let keys: Set<string> | null = new Set();
    for (const r of body.matchAll(/\breturn\b([^;]*);/g)) {
      const at = fn.start + (r.index ?? 0);
      if (enclosing(fnsByFile[file], at) !== fn) continue;
      const what = carries(r[1], names, known, namesOnly);
      if (what === null) continue;
      where ??= `${file}:${lineOf(prepared[file], at)} returns ${what}`;
      const expr = r[1].trim();
      if (keys !== null && expr.startsWith('{') && skipBalanced(expr, 0) === expr.length) {
        for (const prop of splitArgs(expr.slice(1, -1))) {
          const pair = /^\s*([A-Za-z_$][\w$]*)\s*(?::([\s\S]*))?$/.exec(prop);
          if (!pair) keys = null;
          else if (carries(pair[2] ?? pair[1], names, known, namesOnly) !== null)
            keys?.add(pair[1]);
          if (keys === null) break;
        }
      } else keys = null;
    }
    return where === null ? null : { where, keys };
  };

  // Pass-throughs (return a parameter) and readers (return a source), to a
  // fixed point: each can be built from the other.
  const passThrough = new Map<string, Set<number>>();
  const readers = new Set<string>();
  const known: Known = { passThrough, readers };
  for (let round = 0, changed = true; changed && round < 12; round++) {
    changed = false;
    for (const file of Object.keys(prepared)) {
      for (const fn of fnsByFile[file]) {
        // A mint makes a new token. What it returns is governed by MINT_SITES,
        // not followed as if it were the secret it was signed with.
        if (NOT_A_HELPER.has(fn.name) || /^mint[A-Z]/.test(fn.name)) continue;
        fn.params.forEach((param, index) => {
          if (passThrough.get(fn.name)?.has(index)) return;
          // Only what comes through from this parameter: a source read inside
          // makes a reader, not a pass-through.
          const fromParam = localNames(file, fn, [param], known, true);
          if (returnsCarrying(file, fn, fromParam, known, true) !== null) {
            const set = passThrough.get(fn.name) ?? new Set<number>();
            set.add(index);
            passThrough.set(fn.name, set);
            changed = true;
          }
        });
        if (!readers.has(fn.name)) {
          const found = returnsCarrying(file, fn, localNames(file, fn, [], known), known);
          if (found !== null) {
            readers.add(fn.name);
            readerKeys.set(fn.name, found.keys);
            why[fn.name] = found.where;
            changed = true;
          }
        }
      }
    }
  }

  // Wrappers: functions that write one of their own parameters into a sink.
  // Kept per parameter position, so `alert(payload, env)` logging `payload`
  // does not make its `env` argument a sink.
  const wrappers = new Map<string, Set<number>>();
  const sinkRe = (): RegExp =>
    wrappers.size === 0
      ? DIRECT_SINK
      : new RegExp(
          `${DIRECT_SINK.source}|(?<![\\w$.])(?:${[...wrappers.keys()].join('|')})\\s*\\(`,
          'g'
        );
  /** The argument texts of `call` that reach a sink: all of them, or a wrapper's positions. */
  const sinkArgs = (call: Call): string[] => {
    const positions = wrappers.get(call.callee);
    if (!positions) return [call.args];
    const parts = splitArgs(call.args);
    return [...positions].map((i) => parts[i] ?? '');
  };
  for (let round = 0, changed = true; changed && round < 12; round++) {
    changed = false;
    for (const [file, text] of Object.entries(prepared)) {
      for (const fn of fnsByFile[file]) {
        if (NOT_A_HELPER.has(fn.name) || fn.params.length === 0) continue;
        const calls = callsMatching(text, sinkRe(), fn.start, fn.end);
        fn.params.forEach((param, index) => {
          if (wrappers.get(fn.name)?.has(index)) return;
          const names = localNames(file, fn, [param], known, true);
          if (calls.some((c) => sinkArgs(c).some((a) => carries(a, names, known, true) !== null))) {
            const set = wrappers.get(fn.name) ?? new Set<number>();
            set.add(index);
            wrappers.set(fn.name, set);
            changed = true;
          }
        });
      }
    }
  }

  // Every sink, read with the names its function holds.
  const findings: Finding[] = [];
  let sinks = 0;
  const namesByTop = new Map<Fn, Set<string>>();
  for (const [file, text] of Object.entries(prepared)) {
    for (const call of callsMatching(text, sinkRe())) {
      sinks++;
      const top = outermost(fnsByFile[file], call.offset);
      let names = new Set<string>();
      if (top) {
        names = namesByTop.get(top) ?? localNames(file, top, [], known);
        namesByTop.set(top, names);
      }
      for (const arg of sinkArgs(call)) {
        const what = carries(arg, names, known);
        if (what === null) continue;
        findings.push({ file, line: lineOf(text, call.offset), sink: call.callee, carries: what });
        break;
      }
    }
  }
  return {
    findings,
    readers: [...readers].sort(),
    passThrough: [...passThrough.keys()].sort(),
    wrappers: [...wrappers.keys()].sort(),
    why,
    sources,
    sinks,
  };
}

// ── Reading the real source ──────────────────────────────────────────────────

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function realSources(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of walkTs(SRC_DIR)) {
    out[relative(SRC_DIR, p).split(/[\\/]/).join(posix.sep)] = readFileSync(p, 'utf8');
  }
  return out;
}

/**
 * Triaged exemptions: a sink that carries a credential on purpose. One entry
 * per sink (file + callee + what it carries), each with a reason a reviewer
 * would accept. An entry that matches nothing fails.
 */
const EXEMPTIONS: ReadonlyArray<{ file: string; sink: string; carries: string; reason: string }> = [
  {
    file: 'handlers/forms.ts',
    sink: 'setAnonCookie',
    carries: '`cookieValue`',
    reason:
      'The form routes send the anonymous id back as the ose_anon cookie (signed since OSE-1496). That is the cookie ' +
      'itself (invariant 4: the one cookie, on /q and the forms routes), an anonymous token and ' +
      'not a sign-in. cookie-setters.invariant.spec.ts lists where it may be set.',
  },
  {
    file: 'handlers/qr-scan.ts',
    sink: 'setAnonCookie',
    carries: '`newCookie`',
    reason:
      'GET /q/:token on the room vote code only (OSE-2214: a poster code sets none), and GET ' +
      "/q/crowd/:eventId, the Online Pick's way in (OSE ADR-040 decision 13), send the " +
      'anonymous id back as the ose_anon cookie: the same cookie, the same rule (invariant 4), ' +
      'still on /q, listed in cookie-setters.invariant.spec.ts.',
  },
];

// ── Mint sites: classified, not hidden ───────────────────────────────────────

/**
 * Every call that mints a token, and what its route does with it. `runtime` is
 * the text the runtime gate's own table must hold for the same product, so the
 * two cannot drift apart ('' for a token no answer ever carries).
 */
const MINT_SITES: ReadonlyArray<{
  file: string;
  callee: string;
  product: string;
  runtime: string;
}> = [
  {
    file: 'handlers/shared-report-read.ts',
    callee: 'mintSignedLinkToken',
    product:
      'POST /api/v2/admin/events/:id/shared-report/mint-link answers the organizer with the ' +
      'report link they asked for, under `token`. Admin only, rate-limited, audited.',
    runtime: 'shared-report\\/mint-link',
  },
  {
    file: 'handlers/family-report.ts',
    callee: 'mintFamilyToken',
    product:
      'POST /api/v2/admin/brands/:brand/family-report/mint-link answers the parent company with ' +
      'its family report link, under `token` and `path`. Admin only, brand in scope, ' +
      'rate-limited, audited.',
    runtime: 'family-report\\/mint-link',
  },
  {
    file: 'handlers/sponsor-home.ts',
    callee: 'mintSponsorHomeToken',
    product:
      "POST /api/v2/admin/sponsors/:id/home-link answers the organizer with the sponsor's page " +
      'link, under `url`. Admin only, rate-limited, audited.',
    runtime: 'home-link',
  },
  {
    file: 'handlers/sponsor-home.ts',
    callee: 'mintSignedLinkToken',
    product:
      "GET /sponsor (opened with the sponsor's own signed link) links to that sponsor's reports; " +
      'each link is signed for that sponsor and that event.',
    runtime: '\\/sponsor$',
  },
  {
    file: 'handlers/sponsors.ts',
    callee: 'mintBeaconToken',
    product:
      'GET /api/v2/events/:id/sponsor-bundle carries `beacon_token` per sponsor: public by ' +
      'design, sent back with an impression or a click, opens nothing.',
    runtime: 'sponsor-bundle',
  },
  {
    file: 'lib/vote-pass.ts',
    callee: 'mintVotePass',
    product:
      "GET /q/<token>?type=vote on the event's own vote code (OSE-2140; no other placement), " +
      'with voting on, the set open and the event Published (OSE-2142), answers 302 with a 30-minute ' +
      'vote pass for that browser at that event. It sits at the end of `Location`, after ' +
      '`/events/:id/vote#t=`, and nowhere else: no body, no other header, no query string, no ' +
      'log line (OSE ADR-040 decision 6). The test below holds the source to that one path.',
    runtime: '\\/vote#t=$',
  },
  {
    file: 'handlers/qr-scan.ts',
    callee: 'mintCrowdPass',
    product:
      'GET /q/crowd/:eventId (OSE ADR-040 decision 13), with voting on and the Online Pick on and ' +
      'open, answers 302 with a 30-minute Online Pick pass (`vc1.`) for that browser at that event. ' +
      'It sits at the end of `Location`, after `/events/:id/online-pick#t=`, and nowhere else. ' +
      'Another prefix and another seal: it never opens in the Room Pick.',
    runtime: '\\/online-pick#t=$',
  },
  {
    file: 'lib/vote-access-pass.ts',
    callee: 'mintAccessVotePass',
    product:
      'POST /api/v2/vote/access (OSE ADR-040 decision 13) takes an Access Pass token in a ' +
      'same-origin JSON body and answers that same browser with a 30-minute room pass under ' +
      '`pass`; its page puts it straight into the voter page fragment. One refusal for anything ' +
      'else; limited per caller; no log line names the token or the pass.',
    runtime: '\\/api\\/v2\\/vote\\/access$',
  },
  {
    file: 'google/auth.ts',
    callee: 'mintWifJwt',
    product:
      'Signed for Google and sent to Google (workload identity federation). No route answers ' +
      'with it.',
    runtime: '',
  },
];

function mintCalls(files: Readonly<Record<string, string>>): string[] {
  const out = new Set<string>();
  for (const [file, src] of Object.entries(files)) {
    const text = emptyStrings(blankComments(src));
    for (const c of callsMatching(text, /(?<![\w$.])mint[A-Z]\w*\s*\(/g)) {
      out.add(`${file} ${c.callee}`);
    }
  }
  return [...out].sort();
}

// ── Log redaction wiring ─────────────────────────────────────────────────────

function consoleReassignments(files: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  for (const [file, src] of Object.entries(files)) {
    if (file === 'lib/log-redact.ts') continue;
    const text = emptyStrings(blankComments(src));
    const re =
      /\bconsole\s*(?:\.\s*\w+|\[[^\]]*\])\s*=(?!=)|\b(?:globalThis|self)\s*\.\s*console\s*=(?!=)|\bObject\s*\.\s*(?:assign|defineProperty)\(\s*console\b/g;
    for (const m of text.matchAll(re)) out.push(`${file}:${lineOf(text, m.index ?? 0)}`);
  }
  return out;
}

/** Top level, and inside each entry (`fetch`, `scheduled`, `queue`) of the default export. */
function redactionInstalls(indexSrc: string): { topLevel: boolean; missingEntries: string[] } {
  const text = emptyStrings(blankComments(indexSrc));
  const fns = functionsIn('index.ts', text);
  const calls = callsMatching(text, /(?<![\w$.])installLogRedaction\s*\(/g);
  const topLevel = calls.some((c) => enclosing(fns, c.offset) === null);
  const missingEntries = ['fetch', 'scheduled', 'queue'].filter((entry) => {
    const fn = fns.find((f) => f.name === entry);
    if (!fn) return /\basync\s+/.test(text) && new RegExp(`\\basync\\s+${entry}\\s*\\(`).test(text);
    return !calls.some((c) => c.offset >= fn.start && c.offset < fn.end);
  });
  return { topLevel, missingEntries };
}

// ── The gate ─────────────────────────────────────────────────────────────────

const FILES = realSources();
const REAL = analyse(FILES);
const key = (f: { file: string; sink: string; carries: string }) =>
  `${f.file} | ${f.sink} | ${f.carries}`;

test.describe('Invariant: the Worker never emits a credential', () => {
  test('the scan sees the source: files, credential reads, secret bindings, sinks', () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(150);
    expect(REAL.sources.headerReads).toBeGreaterThanOrEqual(10);
    expect(REAL.sources.secretBindings).toBeGreaterThanOrEqual(60);
    expect(REAL.sinks).toBeGreaterThan(400);
  });

  test('it finds the readers and the wrappers it is meant to find', () => {
    // Functions that return a credential they read. An exact list: a new
    // reader is a new way for a credential to travel, and should be looked at.
    expect(REAL.readers, JSON.stringify(REAL.why)).toEqual([
      'bearer', // handlers/sponsors-draft.ts: the draft's bearer, compared with the stored draft
      'bearerToken', // handlers/upload.ts: the same, for a draft's uploads
      'familyReportBucketKey', // handlers/family-report.ts: a rate-limit key, hashed before it is stored
      'getAdminKey', // auth/admin.ts: the admin key binding, compared in constant time
      'getOrCreateAnonId', // lib/anonymous-id.ts: the anonymous cookie's id
      'sharedReportBucketKey', // handlers/shared-report-read.ts: a rate-limit key, hashed before it is stored
    ]);
    // Functions that hand back what they are given.
    for (const p of ['extractBearer', 'extractBearerToken', 'escapeHtml']) {
      expect(REAL.passThrough, p).toContain(p);
    }
    // Functions that put a parameter into an answer or a log line.
    for (const w of ['html', 'jsonResponse', 'errorResponse', 'logFormEvent', 'setAnonCookie']) {
      expect(REAL.wrappers, w).toContain(w);
    }
  });

  test('no sink carries a credential (request header, whole headers, secret binding)', () => {
    const exempt = new Set(EXEMPTIONS.map(key));
    const violations = REAL.findings
      .filter((f) => !exempt.has(key(f)))
      .map((f) => `${f.file}:${f.line} ${f.sink}(…) carries ${f.carries}`);
    expect(
      violations,
      'A credential reaches an answer or a log line. Compare, verify or hash it; never write it out.'
    ).toEqual([]);
  });

  test('every exemption still matches a sink, and has a reason', () => {
    const found = new Set(REAL.findings.map(key));
    for (const e of EXEMPTIONS) {
      expect(found.has(key(e)), `stale exemption: ${key(e)}`).toBe(true);
      expect(e.reason.length).toBeGreaterThan(60);
    }
  });

  test('every call that mints a token is classified, and every classification matches a call', () => {
    expect(mintCalls(FILES)).toEqual(MINT_SITES.map((m) => `${m.file} ${m.callee}`).sort());
    for (const m of MINT_SITES) expect(m.product.length, m.callee).toBeGreaterThan(60);
  });

  test('the vote pass has one way out: issueVotePass, then votePageTarget, then Location', () => {
    const code = (file: string): string => emptyStrings(blankComments(FILES[file]));
    const callersOf = (fn: string): string[] =>
      Object.keys(FILES)
        .filter((file) => new RegExp(`(?<![\\w$.])${fn}\\s*\\(`).test(code(file)))
        .sort();
    // The mint is called from the library alone, by the function that checks
    // the switch, the pepper and the open set first.
    expect(callersOf('mintVotePass')).toEqual(['lib/vote-pass.ts']);
    expect(code('lib/vote-pass.ts').match(/(?<![\w$.])mintVotePass\s*\(/g)).toHaveLength(2);
    expect(code('lib/vote-pass.ts')).toMatch(
      /export async function issueVotePass\([\s\S]*?\breturn mintVotePass\(/
    );
    // Only /q asks for a pass, and only /q builds the address that carries it.
    expect(callersOf('issueVotePass')).toEqual(['handlers/qr-scan.ts', 'lib/vote-pass.ts']);
    expect(callersOf('votePageTarget')).toEqual(['handlers/qr-scan.ts', 'lib/vote-pass.ts']);
    expect(code('lib/vote-pass.ts').match(/(?<![\w$.])issueVotePass\s*\(/g)).toHaveLength(1);
    expect(code('lib/vote-pass.ts').match(/(?<![\w$.])votePageTarget\s*\(/g)).toHaveLength(1);

    // In /q the pass is held under one name, and that name is used three
    // times: where it is set, where it is tested, and as the last argument of
    // votePageTarget. Anything else that takes it fails here.
    const scan = code('handlers/qr-scan.ts');
    const held = /\b(\w+)\s*=\s*await issueVotePass\(/.exec(scan)?.[1];
    expect(held, 'the name /q holds the pass under').toBeTruthy();
    const name = String(held);
    const uses = scan.match(new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g')) ?? [];
    const declared = new RegExp(`\\blet ${name}\\b[^;=]*=\\s*null\\s*;`).test(scan);
    expect(declared, `let ${name} … = null`).toBe(true);
    expect(scan).toMatch(new RegExp(`\\bif \\(${name}\\)`));
    expect(scan).toMatch(new RegExp(`votePageTarget\\([^()]*,\\s*${name}\\s*\\)`));
    expect(uses.length, `uses of ${name} in handlers/qr-scan.ts`).toBe(4);
    // What votePageTarget returns goes to the redirect and to nothing else.
    const target = new RegExp(`\\b(\\w+)\\s*=\\s*votePageTarget\\(`).exec(scan)?.[1];
    expect(target, 'the name the vote address is held under').toBeTruthy();
    expect(scan).toMatch(new RegExp(`Location:\\s*${String(target)}\\b`));
    // The library writes no log line and builds no answer.
    expect(code('lib/vote-pass.ts')).not.toMatch(/\bconsole\s*\.|new Response\b|Response\.\w+\(/);
    // And the pass is put after `#t=`, in the fragment.
    expect(FILES['lib/vote-pass.ts']).toMatch(/\/vote#t=\$\{pass\}/);
  });

  test('the runtime gate classifies the same products, and is not switched off', () => {
    const path = join(WORKER_DIR, 'tests', 'credential-echo.derived.spec.ts');
    expect(existsSync(path)).toBe(true);
    const spec = readFileSync(path, 'utf8');
    for (const m of MINT_SITES) {
      if (m.runtime)
        expect(spec.includes(m.runtime), `runtime table lacks ${m.runtime}`).toBe(true);
    }
    expect(spec).not.toMatch(/\b(?:test|describe|it)\.(?:skip|only|todo|fails)\b/);
    // It must stay in the workers pool: real routes, real D1.
    const nodeSpecs = readFileSync(join(WORKER_DIR, 'vitest.node-specs.mjs'), 'utf8');
    expect(nodeSpecs).not.toContain('credential-echo.derived.spec.ts');
  });

  test('log redaction is installed by the Worker: when it loads and at every entry', () => {
    const installs = redactionInstalls(FILES['index.ts']);
    expect(installs.topLevel, 'installLogRedaction() at the top of src/index.ts').toBe(true);
    expect(installs.missingEntries, 'entries of the default export without it').toEqual([]);
    expect(FILES['lib/log-redact.ts']).toMatch(/export function installLogRedaction\(/);
    expect(FILES['lib/log-redact.ts']).toMatch(/export function redact\(/);
  });

  test('nothing else in src/ reassigns the console', () => {
    expect(consoleReassignments(FILES)).toEqual([]);
  });

  test('the unhandled-error line removes the credential headers by value', () => {
    const src = FILES['lib/unhandled-error-log.ts'];
    expect(src).toMatch(/import \{ CREDENTIAL_HEADERS \} from '\.\/log-redact'/);
    expect(src).toMatch(/credentialPieces\(request\)/);
  });
});

// ── The analysis can fail (negative controls on made-up source) ──────────────

test.describe('the analysis can fail', () => {
  const one = (src: string): string[] =>
    analyse({ 'handlers/made-up.ts': src }).findings.map((f) => `${f.line} ${f.sink} ${f.carries}`);

  test('a header read written straight into an answer', () => {
    expect(
      one(`export function h(request: Request) {
        return Response.json({ got: request.headers.get('Authorization') });
      }`)
    ).toEqual(['2 Response.json a credential read']);
  });

  test('a header read held in a name, then in another, then logged', () => {
    expect(
      one(`export function h(request: Request) {
        const raw = request.headers.get('Cf-Access-Jwt-Assertion') ?? '';
        const short = raw.slice(0, 20);
        console.warn(JSON.stringify({ type: 'X', short }));
        return new Response('ok');
      }`)
    ).toEqual(['4 console.warn `short`']);
  });

  test('a reader function, and a wrapper function, both found and both followed', () => {
    const a = analyse({
      'handlers/made-up.ts': `
        function myBearer(request: Request): string | null {
          const m = (request.headers.get('Authorization') ?? '').match(/^Bearer (.+)$/);
          return m ? m[1] : null;
        }
        function reply(body: unknown, status: number): Response {
          return new Response(JSON.stringify(body), { status });
        }
        export function h(request: Request) {
          const t = myBearer(request);
          return reply({ ok: false, t }, 401);
        }`,
    });
    expect(a.readers).toEqual(['myBearer']);
    expect(a.wrappers).toEqual(['reply']);
    expect(a.findings.map((f) => `${f.line} ${f.sink} ${f.carries}`)).toEqual(['11 reply `t`']);
  });

  test('a credential in a response header, and in a page', () => {
    expect(
      one(`export function h(request: Request, res: Response) {
        const ocr = request.headers.get('X-OCR-Internal');
        res.headers.set('X-Debug', ocr ?? '');
        return new Response(\`<p>\${ocr}</p>\`);
      }`)
    ).toEqual(['3 headers.set `ocr`', '4 newResponse `ocr`']);
  });

  test('a header read by a name that is not written out is treated as a credential', () => {
    expect(
      one(`export function h(request: Request, which: string) {
        const v = request.headers.get(which);
        const lang = request.headers.get('Accept-Language');
        return Response.json({ v, lang });
      }`)
    ).toEqual(['4 Response.json `v`']);
  });

  test("the request's headers taken whole", () => {
    expect(
      one(`export function h(request: Request) {
        console.log(JSON.stringify({ headers: Object.fromEntries(request.headers) }));
        return Response.json({ h: [...request.headers] });
      }`)
    ).toEqual(['2 console.log a credential read', '3 Response.json a credential read']);
  });

  test('a secret binding, straight or held in a name', () => {
    expect(
      one(`export function h(env: { ADMIN_KEY?: string; SHARED_REPORT_SIGNING_SECRET?: string }) {
        const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
        console.error('misconfigured', secret);
        return Response.json({ key: env.ADMIN_KEY });
      }`)
    ).toEqual(['3 console.error `secret`', '4 Response.json a credential read']);
    // Whatever the receiver is called and however it is cast.
    expect(
      one(`export function h(e: unknown, res: Response) {
        res.headers.set('X-Key', (e as { ADMIN_KEY?: string }).ADMIN_KEY ?? '');
        console.log(JSON.stringify({ pepper: (e as Env)?.FORMS_HASH_PEPPER, rotated: (e as Env).FORMS_KEY_ROTATED_AT }));
      }`)
    ).toEqual(['2 headers.set a credential read', '3 console.log a credential read']);
  });

  test('comparing, verifying, hashing and testing a credential are allowed', () => {
    expect(
      one(`export async function h(request: Request, env: { ADMIN_KEY?: string; ALLOW_ADMIN_KEY_FALLBACK?: string }) {
        const token = extractBearer(request.headers.get('Authorization'));
        const key = env.ADMIN_KEY?.trim();
        const ok = !!key && !!token && constantTimeEqual(token, key);
        const claims = await verifySignedLinkToken(env, token);
        const id = await hashAnonIdForReturns(token, key);
        console.log(JSON.stringify({ ok, hasKey: !!key, len: token.length, same: token === key, id, fallback: env.ALLOW_ADMIN_KEY_FALLBACK }));
        return Response.json({ ok, role: claims?.role, configured: Boolean(env.ADMIN_KEY) });
      }`)
    ).toEqual([]);
  });

  test('a helper is followed when it hands the value back, and only then', () => {
    const helper = (body: string) => `function prettify(raw: string | null, width: number) {
        ${body}
      }
      export function h(request: Request) {
        const shown = prettify(request.headers.get('Cookie'), 40);
        return Response.json({ shown });
      }`;
    // It returns a piece of what it was given: still the credential.
    expect(one(helper("const cut = (raw ?? '').slice(0, width); return cut;"))).toEqual([
      '6 Response.json `shown`',
    ]);
    // It returns something else about it: the value stopped there.
    expect(one(helper('return raw !== null && raw.length > width;'))).toEqual([]);
    expect(one(helper('return width;'))).toEqual([]);
  });

  test('a field of decoded claims is not the token; a piece of the token is', () => {
    expect(
      one(`export function h(request: Request) {
        const jwt = request.headers.get('Cf-Access-Jwt-Assertion') ?? '';
        const claims = JSON.parse(atob(jwt.split('.')[1]));
        const parts = jwt.split('.');
        console.log(JSON.stringify({ actor: claims.email, sig: parts[2] }));
        return Response.json({ actor: claims.email });
      }`)
    ).toEqual(['5 console.log `parts`']);
  });

  test('a return type written as an object, and a pattern holding `//`, do not hide a function', () => {
    const a = analyse({
      'lib/made-up.ts': `
        export function readPair(request: Request): { id: string; fresh: boolean } {
          const c = (request.headers.get('Cookie') ?? '').replace(/\\//g, '_');
          return { id: c, fresh: false };
        }
        export function h(request: Request) {
          const { id } = readPair(request);
          return Response.json({ id });
        }`,
    });
    expect(a.readers).toEqual(['readPair']);
    expect(a.findings.map((f) => `${f.line} ${f.sink} ${f.carries}`)).toEqual([
      '8 Response.json `id`',
    ]);
  });

  test("a word in a string, a comment or another object's field is not a credential", () => {
    expect(
      one(`export function h(request: Request, row: { token: string }) {
        const token = request.headers.get('Authorization');
        // token is compared below
        if (!token) return Response.json({ error: 'token is required', token: row.token && 'set' });
        return Response.json({ ok: constantTimeEqual(token, 'x') });
      }`)
    ).toEqual([]);
  });

  test('an unclassified mint call, a console reassignment and a missing install are each seen', () => {
    expect(
      mintCalls({ 'handlers/x.ts': 'const t = await mintBeaconToken(env, a, b); // mintOther(' })
    ).toEqual(['handlers/x.ts mintBeaconToken']);
    expect(
      consoleReassignments({ 'handlers/x.ts': 'console.log = () => {};\nconsole.log("a = b");' })
    ).toEqual(['handlers/x.ts:1']);
    const bare = `export default {
  async fetch(request: Request) { return new Response('x'); },
  async scheduled(e: unknown) { installLogRedaction(); },
};`;
    expect(redactionInstalls(bare)).toEqual({ topLevel: false, missingEntries: ['fetch'] });
    expect(redactionInstalls(`installLogRedaction();\n${bare}`).topLevel).toBe(true);
  });
});
