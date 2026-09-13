/**
 * INVARIANT (OSE-1301): Consent-traced sponsorship — a sponsor's NAME/LOGO reaches a
 * PUBLIC surface only if that sponsor CONFIRMED its own appearance. STRUCTURAL (L0).
 *
 * "Nothing appears about a party unless that party said yes." Silence (NULL) is not
 * consent. The ORGANIZER side stays permissive — creating the placement IS the pick.
 *
 * SURFACES GUARDED HERE (each direct-placement query requires strict sponsor_accepted = 1):
 *   - public event page      — src/handlers/pages.ts
 *   - poster/display rotation — src/lib/sponsor-resolver.ts (Path 1, Direct)
 *   - shared report           — src/lib/shared-report-builder.ts (the impressions→name join)
 *
 * The shared report is the surface of the ORIGINAL incident (staging 2026-09-11:
 * "Free Test sponsor 1" surfaced on the report with nobody having agreed). handleLogImpression
 * is an unauthenticated POST, so without a consent predicate any sponsor_id with a
 * logged impression leaked its name. That is why the report is guarded here explicitly.
 *
 * HONESTY (CCR 2026-09-13 corrections):
 *   - Asserts run against COMMENT-STRIPPED source, so a "strict" assert can NEVER pass
 *     against docstring prose that merely quotes `sp.sponsor_accepted = 1`. Deleting the
 *     clause entirely (not just reverting to COALESCE) turns the positive assert red.
 *   - EXEMPT (named, with reason): sponsor-resolver Path 2 (template/geo auto-match) still
 *     renders on sponsor silence via a reject-only exclusion. This is a KNOWN live gap on
 *     display/report, tracked as the OSE-1301 open "standing-rotation = default-on?" question.
 *     It is asserted-present-and-documented, NOT claimed closed.
 *
 * @born-red OSE-1301 | method: (a) revert any guarded query to COALESCE(...sponsor_accepted,1)
 *   OR (b) delete its `sponsor_accepted = 1` clause → the strict/eradication asserts fail.
 *   Verified against a comment-only revert (asserts still catch it). 2026-09-13.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');
const GUARDED = {
  'public event page': join(SRC, 'handlers', 'pages.ts'),
  'resolver Path 1': join(SRC, 'lib', 'sponsor-resolver.ts'),
  'shared report': join(SRC, 'lib', 'shared-report-builder.ts'),
} as const;
const RESOLVER = GUARDED['resolver Path 1'];

// Strict confirmation, alias-agnostic (sp./spc./…), NOT preceded by COALESCE(.
const STRICT_SPONSOR = /(?<!COALESCE\s*\(\s*)\b\w+\.sponsor_accepted\s*=\s*1/i;
// The permissive default OSE-1301 eradicates: COALESCE(<alias>.sponsor_accepted, 1).
const PERMISSIVE_SPONSOR = /COALESCE\s*\(\s*\w+\.sponsor_accepted\s*,\s*1\s*\)/gi;

/**
 * Drop comment LINES (JSDoc / line comments) so asserts see CODE — including SQL
 * string literals on code lines — but never prose that quotes the SQL. Conservative
 * on purpose: only whole lines whose trimmed start is a comment marker are removed,
 * so `//` inside a string literal on a code line is preserved.
 */
function stripCommentLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/'));
    })
    .join('\n');
}

test.describe('OSE-1301: consent-traced sponsorship — public render requires sponsor confirmation', () => {
  // Negative control: the scanner must actually see the files it audits.
  test('OSE-INV-CONSENT | control | every guarded source exists and queries sponsor_placement', () => {
    for (const [label, path] of Object.entries(GUARDED)) {
      expect(existsSync(path), `${label} must exist`).toBe(true);
      expect(readFileSync(path, 'utf8'), `${label} must query sponsor_placement`).toMatch(
        /sponsor_placement/i
      );
    }
  });

  test('OSE-INV-CONSENT | strict | every guarded public query gates on sponsor_accepted = 1 (not COALESCE, not absent)', () => {
    for (const [label, path] of Object.entries(GUARDED)) {
      const code = stripCommentLines(readFileSync(path, 'utf8'));
      expect(
        code,
        `${label}: must gate on strict sponsor_accepted = 1 in CODE (silence is not consent; deleting the clause turns this red)`
      ).toMatch(STRICT_SPONSOR);
      expect(
        code,
        `${label}: must NOT use the permissive COALESCE(sponsor_accepted, 1) — that is silence-is-consent`
      ).not.toMatch(/COALESCE\s*\(\s*\w+\.sponsor_accepted\s*,\s*1\s*\)/i);
    }
  });

  test('OSE-INV-CONSENT | organizer | the organizer side stays permissive (COALESCE(organizer_accepted, 1) = 1)', () => {
    // The split is load-bearing: organizer silence must NOT hide (creating the
    // placement is the pick). Assert the permissive organizer form is present on the
    // event page + resolver (the report gate uses the same form in its EXISTS).
    for (const label of ['public event page', 'resolver Path 1'] as const) {
      const code = stripCommentLines(readFileSync(GUARDED[label], 'utf8'));
      expect(code, `${label}: organizer stays COALESCE(organizer_accepted, 1) = 1`).toMatch(
        /COALESCE\s*\(\s*\w+\.organizer_accepted\s*,\s*1\s*\)\s*=\s*1/i
      );
    }
  });

  test('OSE-INV-CONSENT | property | the permissive COALESCE(sponsor_accepted, 1) is eradicated from src/', () => {
    const files = listTsFiles(SRC);
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripCommentLines(readFileSync(f, 'utf8')); // ignore docstrings that quote the old form
      const hits = code.match(PERMISSIVE_SPONSOR);
      if (hits) offenders.push(`${f.replace(SRC, 'src')} (${hits.length})`);
    }
    expect(
      offenders,
      `COALESCE(sponsor_accepted, 1) — silence-is-consent — must not exist in src/ CODE. Found: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  test('OSE-INV-CONSENT | exemption | Path 2 template/geo is a NAMED permissive gap (NOT claimed closed)', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    expect(
      src,
      'Path 2 still uses the reject-only exclusion (spx.sponsor_accepted = 0) — the permissive gap'
    ).toMatch(/spx\.sponsor_accepted\s*=\s*0/i);
    expect(
      src,
      'Path 2 permissiveness must be documented as the OSE-1301 open-question exemption'
    ).toMatch(/OSE-1301[\s\S]{0,400}(open question|standing rotation|CCR)/i);
  });
});

/** Recursively list *.ts files under a directory (skips node_modules / .stryker-tmp). */
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.stryker')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}
