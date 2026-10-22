/**
 * INVARIANT: no cookie is set anywhere in the Worker except the owner-ruled places.
 *
 * AGENTS.md Invariant 4: "No cookies on public surfaces, except the anonymous
 * `ose_anon` token (one-year lifetime) on `/q` and the forms routes (owner ruling
 * 2026-10-22). `/s` sets none." Brain invariant #1 lists the same `ose_anon` cookie
 * contract. Until this gate, the only check was `anonymity-gate.spec.ts`, which looks
 * at four listed files and never matches a raw `Set-Cookie`, so a new public route that
 * set a cookie would have passed.
 *
 * Pyramid coverage:
 *   L0 STATIC (this file) — scans every source file under workers/oursharedevents/src
 *                           (ts, js, html templates) for the ways a response or page can
 *                           mint a cookie. A match outside the allowlist, or more matches
 *                           in an allowed file than the ceiling, fails. node:fs only.
 *
 * Matching is by name anywhere in the file, not by call shape, so importing the setter
 * under another name (`import { setAnonCookie as sac }`) is still caught.
 *
 * Born red (kept in this file, permanent): the pure scan function is run on planted
 * fixtures: a setter in an unlisted handler, an aliased import, a `document.cookie`
 * write in a template, and a seventh site in an allowed file each fail.
 */

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'workers', 'oursharedevents', 'src');

const PATTERNS: Array<[string, RegExp]> = [
  ['setAnonCookie', /\bsetAnonCookie\b/g],
  ['Set-Cookie header', /set-cookie/gi],
  ['document.cookie', /document\.cookie/g],
  ['.cookie assignment', /\.cookie\s*=/g],
];

// File (relative to src, forward slashes) -> the most matches of each pattern allowed.
// Only these files may mint the owner-ruled `ose_anon` cookie. Raise a ceiling only with
// the owner's ruling and an AGENTS.md Invariant 4 change in the same PR.
const ALLOWED: Record<string, Record<string, number>> = {
  // The setter itself: the definition, and the one Set-Cookie header it writes (plus its doc comment).
  'lib/anonymous-id.ts': { setAnonCookie: 1, 'Set-Cookie header': 2 },
  // /q: the import and the one call for a new visitor.
  'handlers/qr-scan.ts': { setAnonCookie: 2 },
  // Forms routes (register, check-in, survey, email sign-up): the import and five call sites.
  'handlers/forms.ts': { setAnonCookie: 6 },
  // A comment on the /q route that mentions the header; no code sets it here.
  'router.ts': { 'Set-Cookie header': 1 },
};

function scan(files: Map<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of files) {
    for (const [name, re] of PATTERNS) {
      const n = (text.match(re) || []).length;
      if (n === 0) continue;
      const max = ALLOWED[file]?.[name] ?? 0;
      if (n > max) {
        violations.push(`${file}: ${n} x ${name} (allowed ${max})`);
      }
    }
  }
  return violations;
}

function readTree(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTree(p, out);
    else if (/\.(ts|tsx|js|mjs|html)$/.test(name))
      out.set(relative(SRC, p).split(sep).join('/'), readFileSync(p, 'utf8'));
  }
  return out;
}

test('the scan reads the whole Worker source (it cannot pass on nothing)', () => {
  expect(readTree(SRC).size).toBeGreaterThan(100);
});

test('only the owner-ruled files set a cookie, and no more often than today', () => {
  expect(scan(readTree(SRC))).toEqual([]);
});

const FAKE = (extra: Record<string, string>) => {
  const m = readTree(SRC);
  for (const [k, v] of Object.entries(extra)) m.set(k, v);
  return m;
};

test('born red: a setter in an unlisted handler is caught', () => {
  const v = scan(FAKE({ 'handlers/pages.ts': 'return setAnonCookie(res, id);' }));
  expect(v.join('\n')).toContain('handlers/pages.ts: 1 x setAnonCookie (allowed 0)');
});

test('born red: an aliased import of the setter is still caught', () => {
  const v = scan(
    FAKE({ 'handlers/sponsors.ts': "import { setAnonCookie as sac } from '../lib/anonymous-id';" })
  );
  expect(v.join('\n')).toContain('handlers/sponsors.ts: 1 x setAnonCookie');
});

test('born red: a raw Set-Cookie header and a document.cookie write are caught', () => {
  const v = scan(
    FAKE({
      'lib/other.ts': "headers.set('Set-Cookie', 'a=b');",
      'templates/public.html': '<script>document.cookie = "a=b";</script>',
    })
  );
  const s = v.join('\n');
  expect(s).toContain('lib/other.ts: 1 x Set-Cookie header');
  expect(s).toContain('templates/public.html: 1 x document.cookie');
  expect(s).toContain('templates/public.html: 1 x .cookie assignment');
});

test('born red: one more site in an allowed file is caught', () => {
  const real = readTree(SRC);
  const m = new Map(real);
  m.set('handlers/forms.ts', (real.get('handlers/forms.ts') || '') + '\nsetAnonCookie(res, id);\n');
  expect(scan(m).join('\n')).toContain('handlers/forms.ts: 7 x setAnonCookie (allowed 6)');
});
