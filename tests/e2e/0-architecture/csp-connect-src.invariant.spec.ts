/**
 * INVARIANT: CSP connect-src is same-origin on every served surface
 *
 * Every Content-Security-Policy the OSE worker emits must leave the page able
 * to open network connections (fetch / XHR / WebSocket / EventSource /
 * sendBeacon) ONLY to its own origin — effective `connect-src` is `'self'` or
 * `'none'`, nothing else. No external origin, no scheme source (`https:`,
 * `wss:`), no wildcard, no runtime interpolation.
 *
 * Why: never-who. A third-party geo / analytics / map origin reachable from a
 * served page is a side channel for re-identification, whatever the script
 * that calls it claims to do. On 2026-09-29 a community Claude plugin
 * (MapMap, mcp.mapmap.ai) was evaluated and blocked; this gate makes the
 * same decision structural for the runtime. Adding an external origin to
 * connect-src needs an ADR + CCR + Dr-of-Security pass, recorded as an entry
 * in EXEMPTIONS below — never a quiet edit to a header string.
 *
 * Gate shape (see README "property or subject?"): PROPERTY-ASSERTING. The
 * subject list is derived — every `Content-Security-Policy` string in
 * workers/oursharedevents/src (.ts header blocks and any .html
 * `<meta http-equiv>`) is found by scanning the tree. A CSP added to a new
 * handler next month is covered the day it is written. No handler is named.
 *
 * What it enforces:
 *   1. Every CSP header site has a string-literal value the gate can read. A
 *      CSP built from a variable or function call is itself a failure — an
 *      unauditable policy is an unrestricted one.
 *   2. The effective connect-src of each (connect-src, else default-src, else
 *      nothing = unrestricted) contains only `'self'` / `'none'`.
 *   3. The token `connect-src` appears in src ONLY inside those audited CSP
 *      literals. This closes the interpolation hole: a `${fragment}` spliced
 *      into a policy cannot smuggle in a connect-src without spelling it
 *      somewhere else in src, which this check catches.
 *
 * Out of scope (a gate, not a sandbox): deliberately obfuscated construction
 * such as `'connect' + '-src'`. Code review owns adversarial spelling.
 *
 * Negative controls (README lesson 1): the parser is self-tested against
 * synthetic policies, and the scan must find CSP sites in more than one file —
 * a gate that finds nothing is indistinguishable from one that looks at
 * nothing.
 *
 * Born-red: verified by adding `https://example.com` to one handler's
 * connect-src and watching test 2 fail, then reverting.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');

// The only connect-src sources a served page may carry.
const ALLOWED_CONNECT_SOURCES = new Set(["'self'", "'none'"]);

// README lesson 2: a triaged exemption list, one reason per entry. EMPTY by
// design. An entry is an external origin that has been through ADR + CCR +
// Dr-of-Security review; `adr` must name the ADR that approved it.
const EXEMPTIONS: ReadonlyArray<{ origin: string; adr: string; reason: string }> = [];

// Stands in for a `${...}` interpolation inside a template literal. It is not a
// valid CSP source, so if it lands in connect-src the gate fails.
const INTERP = '<interpolated>';

// ── Source walking ───────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|html)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(full);
  }
  return files;
}

function relFromSrc(filePath: string): string {
  return filePath.slice(SRC_DIR.length + 1).replace(/\\/g, '/');
}

function lineAt(content: string, index: number): string {
  const start = content.lastIndexOf('\n', index - 1) + 1;
  const end = content.indexOf('\n', index);
  return content.slice(start, end === -1 ? content.length : end);
}

function lineNo(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

// A mention inside a // or /* */ or JSDoc line is documentation, not a policy.
function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

// ── Literal reader ───────────────────────────────────────────────────────────

/**
 * Read a JS string expression starting at `i`: one or more '…' / "…" / `…`
 * literals joined by `+`. `${…}` in a template literal becomes INTERP.
 * Returns null if the expression at `i` is not a literal (identifier, call).
 */
function readLiteralExpr(src: string, i: number): { value: string; end: number } | null {
  let value = '';
  let pos = i;
  for (;;) {
    while (/\s/.test(src[pos] ?? '')) pos++;
    const q = src[pos];
    if (q !== "'" && q !== '"' && q !== '`') return null;
    pos++;
    for (;;) {
      const c = src[pos];
      if (c === undefined) return null;
      if (c === '\\') {
        value += src[pos + 1] ?? '';
        pos += 2;
        continue;
      }
      if (c === q) {
        pos++;
        break;
      }
      if (q === '`' && c === '$' && src[pos + 1] === '{') {
        let depth = 1;
        pos += 2;
        while (depth > 0 && pos < src.length) {
          if (src[pos] === '{') depth++;
          else if (src[pos] === '}') depth--;
          pos++;
        }
        value += INTERP;
        continue;
      }
      value += c;
      pos++;
    }
    let peek = pos;
    while (/\s/.test(src[peek] ?? '')) peek++;
    if (src[peek] !== '+') return { value, end: pos };
    pos = peek + 1;
  }
}

// ── CSP parsing ──────────────────────────────────────────────────────────────

function parseDirectives(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const raw of policy.split(';')) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const name = parts[0].toLowerCase();
    // CSP: the first occurrence of a directive wins; later duplicates are ignored.
    if (!directives.has(name)) directives.set(name, parts.slice(1));
  }
  return directives;
}

/** The sources that govern connections, or null when nothing restricts them. */
function effectiveConnectSrc(policy: string): { from: string; sources: string[] } | null {
  const d = parseDirectives(policy);
  if (d.has('connect-src')) return { from: 'connect-src', sources: d.get('connect-src')! };
  if (d.has('default-src')) return { from: 'default-src', sources: d.get('default-src')! };
  return null;
}

/** Violations for one policy; empty when connections stay same-origin. */
function connectSrcViolations(policy: string): string[] {
  const eff = effectiveConnectSrc(policy);
  if (!eff) return ['no connect-src and no default-src — connections are unrestricted'];
  if (eff.sources.length === 0) return [`${eff.from} has no sources`];
  const exempt = new Set(EXEMPTIONS.map((e) => e.origin));
  return eff.sources
    .filter((s) => !ALLOWED_CONNECT_SOURCES.has(s.toLowerCase()) && !exempt.has(s))
    .map((s) =>
      s.includes(INTERP)
        ? `${eff.from} contains a runtime interpolation — the allowed origins cannot be audited`
        : `${eff.from} allows "${s}" — only 'self' / 'none' are permitted`
    );
}

// ── Site discovery ───────────────────────────────────────────────────────────

type CspSite = {
  file: string;
  line: number;
  policy: string | null; // null = value is not a readable literal
  span: [number, number]; // character range of the policy value in the file
};

const HEADER_NAME_RE = /(['"`])content-security-policy(?:-report-only)?\1/gi;
const META_RE =
  /<meta\b[^>]*http-equiv\s*=\s*(['"])content-security-policy\1[^>]*content\s*=\s*(['"])([\s\S]*?)\2/gi;

function findCspSites(): { sites: CspSite[]; filesScanned: number } {
  const sites: CspSite[] = [];
  const files = walk(SRC_DIR);
  for (const filePath of files) {
    const rel = relFromSrc(filePath);
    const content = readFileSync(filePath, 'utf8');

    if (filePath.endsWith('.html')) {
      for (const m of content.matchAll(META_RE)) {
        const valueStart = m.index! + m[0].length - m[3].length - 1;
        sites.push({
          file: rel,
          line: lineNo(content, m.index!),
          policy: m[3],
          span: [valueStart, valueStart + m[3].length],
        });
      }
      continue;
    }

    for (const m of content.matchAll(HEADER_NAME_RE)) {
      const at = m.index!;
      if (isCommentLine(lineAt(content, at))) continue;
      // The header name is followed by `:` (object key) or `,` (headers.set /
      // headers.append / tuple). Anything else is a CSP site we cannot read.
      let pos = at + m[0].length;
      while (/\s/.test(content[pos] ?? '')) pos++;
      const sep = content[pos];
      const lit = sep === ':' || sep === ',' ? readLiteralExpr(content, pos + 1) : null;
      sites.push({
        file: rel,
        line: lineNo(content, at),
        policy: lit ? lit.value : null,
        span: [at, lit ? lit.end : at + m[0].length],
      });
    }
  }
  return { sites, filesScanned: files.length };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Invariant: CSP connect-src is same-origin on every served surface (never-who)', () => {
  test('OSE-CSP-CONNECT | platform | self-test | the parser reads policies the way a browser does', () => {
    // Accepted.
    expect(connectSrcViolations("default-src 'self'; connect-src 'self'")).toEqual([]);
    expect(connectSrcViolations("default-src 'self'; connect-src 'none'")).toEqual([]);
    expect(connectSrcViolations("default-src 'none'")).toEqual([]); // falls back to default-src
    expect(connectSrcViolations("default-src 'self'; script-src 'self' https://x.test")).toEqual(
      []
    );

    // Rejected.
    expect(connectSrcViolations("connect-src 'self' https://example.com")).toHaveLength(1);
    expect(connectSrcViolations("default-src 'self'; connect-src *")).toHaveLength(1);
    expect(connectSrcViolations("default-src 'self'; connect-src wss:")).toHaveLength(1);
    expect(connectSrcViolations('default-src https://mcp.mapmap.ai')).toHaveLength(1);
    expect(connectSrcViolations("script-src 'self'")).toHaveLength(1); // unrestricted
    expect(connectSrcViolations(`connect-src 'self' ${INTERP}`)).toHaveLength(1);

    // Literal reader: concatenation, template interpolation, and non-literals.
    expect(readLiteralExpr(`: 'a' + "b" + \`c\${x}d\`,`, 1)?.value).toBe(`abc${INTERP}d`);
    expect(readLiteralExpr(`: buildCsp(nonce),`, 1)).toBeNull();
    expect(readLiteralExpr(`: CSP,`, 1)).toBeNull();
  });

  test('OSE-CSP-CONNECT | platform | coverage | the scan finds the CSP sites it is meant to see', () => {
    const { sites, filesScanned } = findCspSites();
    expect(filesScanned, `scanned ${SRC_DIR}`).toBeGreaterThan(0);
    const files = new Set(sites.map((s) => s.file));
    // Negative control: a regex that matches nothing passes every other test.
    // HTML surfaces set CSP from several handlers today; if the scan sees
    // fewer than two files, the scanner broke — not the codebase.
    expect(
      files.size,
      `CSP scan found sites in only ${files.size} file(s): ${[...files].join(', ') || '(none)'}. ` +
        'The header-name matcher or literal reader has stopped seeing policies.'
    ).toBeGreaterThanOrEqual(2);
  });

  test('OSE-CSP-CONNECT | platform | property | every CSP limits connect-src to self/none', () => {
    const { sites } = findCspSites();
    const violations: string[] = [];
    for (const site of sites) {
      const where = `${site.file}:${site.line}`;
      if (site.policy === null) {
        violations.push(
          `${where}: Content-Security-Policy value is not a string literal — the gate cannot ` +
            'audit a policy built at runtime. Inline the policy as a literal.'
        );
        continue;
      }
      for (const v of connectSrcViolations(site.policy)) violations.push(`${where}: ${v}`);
    }
    expect(
      violations,
      'A served page may only connect to its own origin (never-who). Adding an external ' +
        'origin needs an ADR + CCR + Dr-of-Security pass and an EXEMPTIONS entry in this spec.\n' +
        violations.join('\n')
    ).toEqual([]);
  });

  test('OSE-CSP-CONNECT | platform | closure | connect-src is only spelled inside audited CSP literals', () => {
    const { sites } = findCspSites();
    const stray: string[] = [];
    for (const filePath of walk(SRC_DIR)) {
      const rel = relFromSrc(filePath);
      const content = readFileSync(filePath, 'utf8');
      const spans = sites.filter((s) => s.file === rel && s.policy !== null).map((s) => s.span);
      for (const m of content.matchAll(/connect-src/gi)) {
        const at = m.index!;
        if (spans.some(([a, b]) => at >= a && at < b)) continue;
        if (!filePath.endsWith('.html') && isCommentLine(lineAt(content, at))) continue;
        stray.push(`${rel}:${lineNo(content, at)}: ${lineAt(content, at).trim()}`);
      }
    }
    expect(
      stray,
      '`connect-src` appears outside an audited Content-Security-Policy literal. A fragment ' +
        'interpolated into a policy could widen connect-src without this gate seeing it.\n' +
        stray.join('\n')
    ).toEqual([]);
  });

  test('OSE-CSP-CONNECT | platform | exemptions | every exemption cites the ADR that approved it', () => {
    for (const e of EXEMPTIONS) {
      expect(e.adr, `exemption ${e.origin} must cite its approving ADR`).toMatch(/^ADR-\d+/);
      expect(e.reason.trim().length, `exemption ${e.origin} needs a reason`).toBeGreaterThan(0);
    }
  });
});
