/**
 * A source check for pages that build markup in the browser by joining strings:
 * every value written into an attribute goes through the page's one escaper.
 *
 * Written for shared-report.html (shared-report-attribute-escaping.spec.ts) and
 * moved here unchanged in what it refuses, so poster.html
 * (poster-attribute-escaping.spec.ts) is held to the same rule by the same code.
 *
 * How: each inline script is parsed (TypeScript's parser, as JavaScript). Every
 * chain of `'...' + value + '...'` (and every template literal) is walked left
 * to right with a small HTML reader that knows whether it is in text, inside a
 * tag, or inside an attribute value, and which attribute. Each value met along
 * the way is judged by where it lands:
 *
 *   in a quoted attribute value   must be `esc(...)`
 *   in `src`, `href` and the like must be `encodeURIComponent(...)`, in double
 *                                 quotes, after a fixed path on this site
 *                                 (escaping does not stop a `javascript:`
 *                                 address). Two more forms exist only for a page
 *                                 that names them in its rules, see MarkupRules
 *   in `style`                    must be a number by construction (a `const`
 *                                 made by Math.round or by arithmetic); escaping
 *                                 is not a defence inside a style
 *   in an event-handler attribute, an unquoted attribute, a tag name, or inside
 *   a tag but outside any value   never
 *
 * It fails closed on what it cannot follow: a string that ends inside a tag or
 * an attribute value (markup split across variables or an array), and a
 * conditional whose two sides leave the markup in different places.
 *
 * What it does NOT check: a value written in TEXT position (the two-page
 * comparisons in the specs cover what is drawn there), values set through DOM
 * calls (`setAttribute`, `textContent`, which need no escaping), what an address
 * maker lets through (the spec that names one tests it), and markup assembled in
 * a way that never puts the attribute's opening quote and its value in the same
 * expression AND still ends each piece in text. It is a check on these pages'
 * way of writing markup, not a proof about every way there is.
 */

import { JSDOM } from 'jsdom';
import ts from 'typescript';

export interface MarkupRules {
  /**
   * The page's one escaper is `window.<helper>`, assigned exactly once; every
   * `esc` on the page must be `const esc = window.<helper>`.
   */
  helper: string;
  /**
   * Text that may stand in front of `encodeURIComponent(...)` in an address,
   * besides a path on this site. Each entry is the whole start of the attribute
   * value, exactly as the page's source writes it (so `&amp;`, not `&`).
   */
  addressStarts?: readonly string[];
  /**
   * Page functions that return an address they have checked, or ''. A whole
   * address may then be `esc(f(...))`, or `esc(x)` where every `x` on the page
   * is `const x = f(...)`. Each maker must be declared exactly once, as a
   * function, and never assigned. This check does not read what a maker lets
   * through: the spec that lists one has to test it.
   */
  addressMakers?: readonly string[];
}

type Mode =
  | 'text'
  | 'lt'
  | 'tag'
  | 'close'
  | 'comment'
  | 'before-attr'
  | 'attr'
  | 'after-attr'
  | 'before-value'
  | 'dq'
  | 'sq'
  | 'bare';

interface Cursor {
  mode: Mode;
  tag: string;
  attr: string;
  /** The literal text of the attribute value so far; a value met earlier is `￼`. */
  value: string;
}

const START: Cursor = { mode: 'text', tag: '', attr: '', value: '' };
const isSpace = (c: string): boolean =>
  c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const isLetter = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/** Read `text` as HTML from `at`, and say where that leaves the reader. */
function feed(at: Cursor, text: string): Cursor {
  let { mode, tag, attr, value } = at;
  for (const c of text) {
    switch (mode) {
      case 'text':
        if (c === '<') mode = 'lt';
        break;
      case 'lt':
        if (isLetter(c)) {
          mode = 'tag';
          tag = c.toLowerCase();
          attr = '';
          value = '';
        } else if (c === '/') mode = 'close';
        else if (c === '!' || c === '?') mode = 'comment';
        else if (c !== '<') mode = 'text';
        break;
      case 'close':
      case 'comment':
        if (c === '>') mode = 'text';
        break;
      case 'tag':
        if (isSpace(c) || c === '/') mode = 'before-attr';
        else if (c === '>') mode = 'text';
        else tag += c.toLowerCase();
        break;
      case 'before-attr':
        if (isSpace(c) || c === '/') break;
        if (c === '>') mode = 'text';
        else {
          mode = 'attr';
          attr = c.toLowerCase();
        }
        break;
      case 'attr':
        if (c === '=') mode = 'before-value';
        else if (isSpace(c)) mode = 'after-attr';
        else if (c === '>') mode = 'text';
        else if (c === '/') mode = 'before-attr';
        else attr += c.toLowerCase();
        break;
      case 'after-attr':
        if (isSpace(c)) break;
        if (c === '=') mode = 'before-value';
        else if (c === '>') mode = 'text';
        else if (c === '/') mode = 'before-attr';
        else {
          mode = 'attr';
          attr = c.toLowerCase();
        }
        break;
      case 'before-value':
        if (isSpace(c)) break;
        value = '';
        if (c === '"') mode = 'dq';
        else if (c === "'") mode = 'sq';
        else if (c === '>') mode = 'text';
        else {
          mode = 'bare';
          value = c;
        }
        break;
      case 'dq':
        if (c === '"') mode = 'before-attr';
        else value += c;
        break;
      case 'sq':
        if (c === "'") mode = 'before-attr';
        else value += c;
        break;
      case 'bare':
        if (isSpace(c)) mode = 'before-attr';
        else if (c === '>') mode = 'text';
        else value += c;
        break;
    }
  }
  return { mode, tag, attr, value };
}

export interface Hole extends Cursor {
  line: number;
  expr: string;
  node: ts.Expression;
}

interface Decl {
  line: number;
  /** `const x = <init>`; anything else (let, var, a parameter, a function) has none. */
  constInit: ts.Expression | null;
  isFunction: boolean;
}

export interface Checked {
  /** Every value met while reading markup, with where it landed. */
  holes: Hole[];
  /** What is wrong, one line each. Empty means the page keeps the rule. */
  findings: string[];
  escDeclarations: number;
}

const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'data',
  'ping',
  'background',
  'cite',
  'manifest',
  'xlink:href',
]);
const NEVER_ATTRS = new Set(['srcset', 'imagesrcset', 'srcdoc']);
const NUMBER_MAKERS = new Set(['round', 'floor', 'ceil', 'trunc', 'abs', 'min', 'max']);
const ARITHMETIC = new Set([
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
]);

/** Text, between the attributes of a tag, or inside one attribute's value. */
const place = (c: Cursor): string =>
  c.mode === 'text' || c.mode === 'lt'
    ? 'text'
    : c.mode === 'dq' || c.mode === 'sq' || c.mode === 'bare'
      ? `the value of ${c.attr}`
      : c.mode === 'close' || c.mode === 'comment'
        ? c.mode
        : 'inside a tag';

const isPlus = (n: ts.Node): n is ts.BinaryExpression =>
  ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;
const isMarkupRoot = (n: ts.Node): boolean =>
  isPlus(n) ||
  ts.isStringLiteral(n) ||
  ts.isNoSubstitutionTemplateLiteral(n) ||
  ts.isTemplateExpression(n);
const callTo = (n: ts.Node, name: string): boolean =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name;

/** Check scripts (`code` is JavaScript; `line` is where it starts in its file). */
export function checkMarkupScripts(
  scripts: Array<{ code: string; line: number }>,
  rules: MarkupRules
): Checked {
  const HELPER = rules.helper;
  const addressStarts = new Set(rules.addressStarts ?? []);
  const addressMakers = new Set(rules.addressMakers ?? []);
  const holes: Hole[] = [];
  const findings: string[] = [];
  const decls = new Map<string, Decl[]>();
  let helperAssignments = 0;

  const files = scripts.map((s) => ({
    sf: ts.createSourceFile('page.js', s.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS),
    line: s.line,
  }));

  for (const { sf, line } of files) {
    const at = (n: ts.Node): number => line + sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
    const declare = (name: ts.Node, constInit: ts.Expression | null, isFunction = false): void => {
      if (!ts.isIdentifier(name)) return;
      const list = decls.get(name.text) ?? [];
      list.push({ line: at(name), constInit, isFunction });
      decls.set(name.text, list);
    };

    // Pass 1: what every name is declared as, and who assigns the helper.
    const collect = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n)) {
        const isConst =
          ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) !== 0;
        declare(n.name, isConst && n.initializer ? n.initializer : null);
      } else if (ts.isParameter(n) || ts.isBindingElement(n)) declare(n.name, null);
      else if (ts.isFunctionDeclaration(n) && n.name) declare(n.name, null, true);
      else if (ts.isClassDeclaration(n) && n.name) declare(n.name, null);
      else if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const left = n.left;
        const named =
          (ts.isPropertyAccessExpression(left) && left.name.text === HELPER) ||
          (ts.isElementAccessExpression(left) &&
            ts.isStringLiteralLike(left.argumentExpression) &&
            left.argumentExpression.text === HELPER) ||
          (ts.isIdentifier(left) && (left.text === HELPER || left.text === 'esc'));
        if (named) {
          if (
            left.getText(sf) === `window.${HELPER}` &&
            n.operatorToken.kind === ts.SyntaxKind.EqualsToken
          )
            helperAssignments++;
          else
            findings.push(
              `line ${at(n)}: \`${left.getText(sf)}\` is assigned; the escaper is set once, as window.${HELPER}`
            );
        }
        const maker =
          (ts.isIdentifier(left) && addressMakers.has(left.text)) ||
          (ts.isPropertyAccessExpression(left) && addressMakers.has(left.name.text)) ||
          (ts.isElementAccessExpression(left) &&
            ts.isStringLiteralLike(left.argumentExpression) &&
            addressMakers.has(left.argumentExpression.text));
        if (maker)
          findings.push(
            `line ${at(n)}: \`${left.getText(sf)}\` is assigned; an address maker is one function, declared once`
          );
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);

    // Pass 2: read the markup.
    const walk = (n: ts.Expression, from: Cursor): Cursor => {
      if (ts.isParenthesizedExpression(n)) return walk(n.expression, from);
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return feed(from, n.text);
      if (isPlus(n)) return walk(n.right, walk(n.left, from));
      if (ts.isTemplateExpression(n)) {
        let cur = feed(from, n.head.text);
        for (const span of n.templateSpans)
          cur = feed(walk(span.expression, cur), span.literal.text);
        return cur;
      }
      if (ts.isConditionalExpression(n)) {
        scan(n.condition);
        const yes = walk(n.whenTrue, from);
        const no = walk(n.whenFalse, from);
        if (place(yes) !== place(no))
          findings.push(
            `line ${at(n)}: the two sides of \`${n.condition.getText(sf)} ? … : …\` leave the markup in different places (${place(yes)} / ${place(no)}); the check cannot follow it`
          );
        return yes;
      }
      // A value.
      holes.push({ ...from, line: at(n), expr: n.getText(sf), node: n });
      ts.forEachChild(n, scan);
      return from.mode === 'dq' || from.mode === 'sq' || from.mode === 'bare'
        ? { ...from, value: from.value + '￼' }
        : from;
    };
    const scan = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n)) {
        // A key such as '<' in a lookup table is not markup; its value may be.
        if (ts.isComputedPropertyName(n.name)) scan(n.name.expression);
        scan(n.initializer);
        return;
      }
      if (isMarkupRoot(n)) {
        const end = walk(n as ts.Expression, START);
        if (end.mode !== 'text' && end.mode !== 'lt')
          findings.push(
            `line ${at(n)}: a string ends ${end.mode === 'dq' || end.mode === 'sq' || end.mode === 'bare' ? `inside the value of ${end.attr}="…"` : `inside a <${end.tag}> tag`}; markup split across pieces cannot be checked`
          );
        return;
      }
      ts.forEachChild(n, scan);
    };
    scan(sf);
  }

  // The helper, and every name the page calls `esc`.
  if (helperAssignments !== 1)
    findings.push(`window.${HELPER} is assigned ${helperAssignments} times; expected exactly once`);
  const escDecls = decls.get('esc') ?? [];
  for (const d of escDecls) {
    const ok =
      d.constInit !== null &&
      ts.isPropertyAccessExpression(d.constInit) &&
      ts.isIdentifier(d.constInit.expression) &&
      d.constInit.expression.text === 'window' &&
      d.constInit.name.text === HELPER;
    if (!ok)
      findings.push(
        `line ${d.line}: \`esc\` is declared as something other than \`const esc = window.${HELPER}\``
      );
  }

  // An address maker is one function: a second declaration, a parameter or a
  // variable of the same name could stand in for it unseen.
  for (const name of addressMakers) {
    const all = decls.get(name) ?? [];
    if (all.length !== 1 || !all[0].isFunction)
      findings.push(
        `the address maker \`${name}\` is declared ${all.length} times${all.length === 1 ? ', not as a function' : ''}; expected one function declaration`
      );
  }

  const numeric = (n: ts.Expression, seen: Set<string>): boolean => {
    if (ts.isParenthesizedExpression(n)) return numeric(n.expression, seen);
    if (ts.isNumericLiteral(n)) return true;
    if (ts.isPrefixUnaryExpression(n))
      return n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.PlusToken;
    if (ts.isBinaryExpression(n)) return ARITHMETIC.has(n.operatorToken.kind);
    if (ts.isConditionalExpression(n))
      return numeric(n.whenTrue, seen) && numeric(n.whenFalse, seen);
    if (ts.isCallExpression(n)) {
      if (callTo(n, 'Number')) return true;
      const f = n.expression;
      return (
        ts.isPropertyAccessExpression(f) &&
        ts.isIdentifier(f.expression) &&
        f.expression.text === 'Math' &&
        NUMBER_MAKERS.has(f.name.text)
      );
    }
    if (ts.isIdentifier(n)) {
      if (seen.has(n.text)) return false;
      const all = decls.get(n.text) ?? [];
      const next = new Set(seen).add(n.text);
      return all.length > 0 && all.every((d) => d.constInit !== null && numeric(d.constInit, next));
    }
    return false;
  };

  /** A call to an address maker, or a name that is only ever `const x = maker(...)`. */
  const made = (n: ts.Expression, seen: Set<string>): boolean => {
    if (ts.isParenthesizedExpression(n)) return made(n.expression, seen);
    if (ts.isCallExpression(n))
      return ts.isIdentifier(n.expression) && addressMakers.has(n.expression.text);
    if (ts.isIdentifier(n)) {
      if (seen.has(n.text)) return false;
      const all = decls.get(n.text) ?? [];
      const next = new Set(seen).add(n.text);
      return all.length > 0 && all.every((d) => d.constInit !== null && made(d.constInit, next));
    }
    return false;
  };

  for (const h of holes) {
    const where = `line ${h.line}: \`${h.expr.replace(/\s+/g, ' ')}\``;
    const target = `<${h.tag} ${h.attr}="…">`;
    if (h.mode === 'text') continue;
    if (h.mode === 'lt' || h.mode === 'tag' || h.mode === 'close') {
      findings.push(`${where} is written as (part of) a tag name`);
    } else if (h.mode === 'bare' || h.mode === 'before-value') {
      findings.push(`${where} is written into an unquoted attribute, ${target}`);
    } else if (h.mode !== 'dq' && h.mode !== 'sq') {
      findings.push(`${where} is written inside a <${h.tag}> tag, outside any attribute value`);
    } else if (h.attr.startsWith('on')) {
      findings.push(`${where} is written into an event-handler attribute, ${target}`);
    } else if (NEVER_ATTRS.has(h.attr)) {
      findings.push(`${where} is written into ${target}, which takes no value from data`);
    } else if (URL_ATTRS.has(h.attr)) {
      const fixedPath =
        h.value.startsWith('/') && !h.value.startsWith('//') && !h.value.startsWith('/\\');
      const encoded =
        (fixedPath || addressStarts.has(h.value)) && callTo(h.node, 'encodeURIComponent');
      const whole =
        h.value === '' &&
        ts.isCallExpression(h.node) &&
        callTo(h.node, 'esc') &&
        h.node.arguments.length === 1 &&
        made(h.node.arguments[0], new Set());
      if (encoded && h.mode === 'sq')
        // encodeURIComponent leaves the single quote alone: it would end the value.
        findings.push(
          `${where} is written into an address in single quotes, ${target}: encodeURIComponent(...) is only allowed in double quotes`
        );
      else if (!encoded && !whole)
        findings.push(
          `${where} is written into an address, ${target}: only encodeURIComponent(...) after a fixed path that starts with one "/" is allowed`
        );
    } else if (h.attr === 'style') {
      if (!numeric(h.node, new Set()))
        findings.push(
          `${where} is written into ${target}: only a number made by Math.round or arithmetic is allowed in a style`
        );
    } else if (!callTo(h.node, 'esc')) {
      findings.push(`${where} is written into ${target} without esc(...)`);
    }
  }
  return { holes, findings, escDeclarations: escDecls.length };
}

/** Check a served page: every inline script, with line numbers of the page. */
export function checkMarkupPage(page: string, rules: MarkupRules): Checked & { scripts: number } {
  const text = page.split('\r\n').join('\n');
  // The HTML parser finds the scripts; no pattern is matched against the tags.
  const doc = new JSDOM(text).window.document;
  const scripts = [...doc.querySelectorAll('script')]
    .filter((s) => !s.hasAttribute('src'))
    .map((s) => {
      const code = s.textContent ?? '';
      const offset = text.indexOf(code);
      if (offset < 0) throw new Error('the script text was not found in the page');
      return { code, line: text.slice(0, offset).split('\n').length };
    });
  return { ...checkMarkupScripts(scripts, rules), scripts: scripts.length };
}

/** Check a piece of code as if it stood on a page that already has its escaper. */
export function checkMarkupCode(code: string, rules: MarkupRules): Checked {
  return checkMarkupScripts(
    [
      {
        code: `window.${rules.helper} = function (s) { return s; };\nconst esc = window.${rules.helper};\n${code}`,
        line: 1,
      },
    ],
    rules
  );
}
