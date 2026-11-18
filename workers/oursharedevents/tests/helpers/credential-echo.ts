/**
 * Pure helpers for tests/credential-echo.derived.spec.ts (no runtime, no I/O).
 *
 *   - `sweepPaths` reads every address the router answers out of the text of
 *     `src/router.ts` and turns each into paths that can be requested. An
 *     address it cannot turn into a path is returned in `unresolved`, and the
 *     gate fails on it instead of skipping it.
 *   - `findLeaks` reads one answer (headers and body) for a credential.
 *
 * A leak is reported by the NAME of the credential and where it was found,
 * never by its value: a failing run must not print what it is guarding.
 */

import { codeOnly } from './route-shapes';

/** Stands in for an id segment. The gate seeds an event and a sponsor under it. */
export const SAMPLE_ID = 'ce-sample-1';

const MAX_PATHS_PER_PATTERN = 12;

/** The top-level `( … )` groups of a regex body, in order, with their spans. */
function groupsOf(body: string): Array<{ start: number; end: number; inner: string }> | null {
  const out: Array<{ start: number; end: number; inner: string }> = [];
  let depth = 0;
  let start = -1;
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) out.push({ start, end: i + 1, inner: body.slice(start + 1, i) });
    }
  }
  return depth === 0 ? out : null;
}

/**
 * Paths that the router regex `^body$` matches (body as written between the
 * slashes, anchors included or not). A group of plain words (`(tv|poster)`)
 * gives one path per word; any other group stands for an id. Null when no
 * candidate matches the regex itself.
 */
export function samplePathsForPattern(rawBody: string): string[] | null {
  const body = rawBody.replace(/^\^/, '').replace(/\$$/, '');
  let re: RegExp;
  try {
    re = new RegExp(`^${body}$`);
  } catch {
    return null;
  }
  const groups = groupsOf(body);
  if (groups === null) return null;

  let partials: string[] = [''];
  let cursor = 0;
  for (const g of groups) {
    const literal = body.slice(cursor, g.start);
    const words = /^[a-z0-9-]+(\|[a-z0-9-]+)+$/.test(g.inner) ? g.inner.split('|') : [SAMPLE_ID];
    const next: string[] = [];
    for (const p of partials) {
      for (const w of words) {
        if (next.length < MAX_PATHS_PER_PATTERN) next.push(p + literal + w);
      }
    }
    partials = next;
    cursor = g.end;
  }
  const tail = body.slice(cursor);
  const paths = partials
    // An optional character (`\/?`) is left out: the path without it matches too.
    .map((p) => (p + tail).replace(/(?:\\.|[A-Za-z0-9-])\?/g, '').replace(/\\(.)/g, '$1'))
    .filter((p) => re.test(p));
  return paths.length > 0 ? [...new Set(paths)] : null;
}

export interface SweepPaths {
  paths: string[];
  /** Addresses the router answers that could not be turned into a path. */
  unresolved: string[];
}

/**
 * Every address in the router source as requestable paths.
 * `constants` gives the value of a path constant (`pathname === NAME`).
 */
export function sweepPaths(
  routerSource: string,
  constants: Readonly<Record<string, string | undefined>> = {}
): SweepPaths {
  const code = codeOnly(routerSource);
  const paths = new Set<string>();
  const unresolved: string[] = [];

  for (const m of code.matchAll(/pathname\s*===\s*'([^']*)'/g)) paths.add(m[1]);
  for (const m of code.matchAll(/pathname\s*===\s*([A-Z][A-Z0-9_]*)\b/g)) {
    const value = constants[m[1]];
    if (typeof value === 'string' && value.startsWith('/')) paths.add(value);
    else unresolved.push(`constant ${m[1]}`);
  }
  for (const m of code.matchAll(/pathname\.startsWith\(\s*'([^']*)'\s*\)/g)) {
    paths.add(m[1].endsWith('/') ? `${m[1]}${SAMPLE_ID}` : `${m[1]}/${SAMPLE_ID}`);
  }
  for (const m of code.matchAll(/\/(\^\\\/[^\n]*?\$)\//g)) {
    const found = samplePathsForPattern(m[1]);
    if (found === null) unresolved.push(`pattern ${m[1]}`);
    else for (const p of found) paths.add(p);
  }
  return { paths: [...paths].sort(), unresolved };
}

/** The value of every `const NAME = '/…'` path constant in a set of source files. */
export function pathConstants(sources: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const text of Object.values(sources)) {
    for (const m of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*'(\/[^']*)'/g)) {
      out[m[1]] = m[2];
    }
  }
  return out;
}

// ── Reading an answer ────────────────────────────────────────────────────────

/** A credential to look for: a name for the report and the value itself. */
export interface Probe {
  name: string;
  value: string;
  /**
   * A response header this value may appear in, as `header-name` and the
   * text its value starts with (the anonymous cookie is re-sent by design).
   */
  allowedHeader?: { name: string; startsWith: string };
}

export interface Leak {
  /** `body` or `header <name>`. */
  where: string;
  /** The probe's name, or the kind of token found. Never a value. */
  what: string;
}

/** An Access-style JWT: three base64url parts, the first two JSON objects. */
export const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{2,}/;
/** This Worker's signed links: `base64url(JSON payload).hex(HMAC-SHA256)`. */
export const SIGNED_LINK_SHAPE = /eyJ[A-Za-z0-9_-]{8,}\.[0-9a-f]{64}(?![0-9a-f])/g;

function htmlEscaped(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The forms a value can take when it is written into an answer. */
function formsOf(value: string): string[] {
  const forms = new Set<string>([value, encodeURIComponent(value), htmlEscaped(value)]);
  try {
    forms.add(JSON.stringify(value).slice(1, -1));
  } catch {
    // not representable: the raw form is enough
  }
  return [...forms];
}

function carries(text: string, probe: Probe): boolean {
  return formsOf(probe.value).some((f) => text.includes(f));
}

export interface Answer {
  headers: Array<[string, string]>;
  body: string;
}

/**
 * Where a signed link this Worker minted may appear in an answer. `null` means
 * nowhere: any signed link in the answer is a leak.
 */
export interface SignedLinkRule {
  /** JSON answers: the property names a token (or a URL carrying one) may sit under. */
  jsonFields?: readonly string[];
  /** HTML answers: the text that must come right before each token. */
  htmlPrefix?: RegExp;
}

function signedLinkLeaks(body: string, rule: SignedLinkRule | null): string[] {
  const matches = [...body.matchAll(SIGNED_LINK_SHAPE)];
  if (matches.length === 0) return [];
  if (rule === null) return ['a signed link (no route here is classified as minting one)'];

  if (rule.jsonFields) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return ['a signed link in an answer that is not the JSON its route is classified for'];
    }
    const bad = new Set<string>();
    const walk = (v: unknown, key: string): void => {
      if (typeof v === 'string') {
        SIGNED_LINK_SHAPE.lastIndex = 0;
        if (SIGNED_LINK_SHAPE.test(v) && !rule.jsonFields!.includes(key)) bad.add(key);
        SIGNED_LINK_SHAPE.lastIndex = 0;
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, k);
      }
    };
    walk(parsed, '(root)');
    return [...bad].map((k) => `a signed link under "${k}", which is not a classified field`);
  }
  if (rule.htmlPrefix) {
    const out: string[] = [];
    for (const m of matches) {
      const before = body.slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0);
      if (!rule.htmlPrefix.test(before)) {
        out.push('a signed link outside the place its page is classified for');
        break;
      }
    }
    return out;
  }
  return ['a signed link under a rule that names no place for it'];
}

/** Every credential found in one answer. Empty when the answer is clean. */
export function findLeaks(
  answer: Answer,
  probes: readonly Probe[],
  signedLinks: SignedLinkRule | null = null
): Leak[] {
  const leaks: Leak[] = [];
  for (const probe of probes) {
    if (probe.value.length < 8) continue;
    if (carries(answer.body, probe)) leaks.push({ where: 'body', what: probe.name });
    for (const [name, value] of answer.headers) {
      if (!carries(value, probe)) continue;
      const ok =
        probe.allowedHeader !== undefined &&
        name.toLowerCase() === probe.allowedHeader.name &&
        value.startsWith(probe.allowedHeader.startsWith);
      if (!ok) leaks.push({ where: `header ${name.toLowerCase()}`, what: probe.name });
    }
  }
  if (JWT_SHAPE.test(answer.body)) leaks.push({ where: 'body', what: 'a JWT (eyJ….eyJ….sig)' });
  for (const what of signedLinkLeaks(answer.body, signedLinks)) leaks.push({ where: 'body', what });
  for (const [name, raw] of answer.headers) {
    // A value a probe is allowed to have in this header is not read again as a shape.
    let value = raw;
    for (const probe of probes) {
      const a = probe.allowedHeader;
      if (a && name.toLowerCase() === a.name && raw.startsWith(a.startsWith)) {
        for (const f of formsOf(probe.value)) value = value.split(f).join('');
      }
    }
    if (JWT_SHAPE.test(value)) {
      leaks.push({ where: `header ${name.toLowerCase()}`, what: 'a JWT (eyJ….eyJ….sig)' });
    }
    SIGNED_LINK_SHAPE.lastIndex = 0;
    if (SIGNED_LINK_SHAPE.test(value)) {
      leaks.push({ where: `header ${name.toLowerCase()}`, what: 'a signed link' });
    }
    SIGNED_LINK_SHAPE.lastIndex = 0;
  }
  return leaks;
}

/** Binding names that hold a secret, by what the name says. */
export function isSecretBindingName(name: string): boolean {
  if (/^(ALLOW_|TEST_)/.test(name)) return false;
  if (/(_ROTATED_AT|_SITE_KEY|_KEY_FALLBACK)$/.test(name)) return false;
  return /(KEY|SECRET|TOKEN|PEPPER|PEM|PASSWORD|X_OCR_INTERNAL)/.test(name);
}
