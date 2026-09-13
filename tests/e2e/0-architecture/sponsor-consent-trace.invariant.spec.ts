/**
 * INVARIANT (OSE-1301): Consent-traced sponsorship — a sponsor renders on a PUBLIC
 * surface only if that sponsor CONFIRMED its own appearance. STRUCTURAL lock (L0).
 *
 * "Nothing appears about a party unless that party said yes." A sponsor's name/logo
 * reaching a public surface (event page pre/live/recap, and the poster/display/report
 * rotation) must trace to the SPONSOR's own confirmation — sp.sponsor_accepted = 1.
 * Silence (NULL) is NOT consent. The ORGANIZER side stays permissive, because
 * creating the placement IS the organizer's pick (OSE-1301 leg 1).
 *
 * WHY THIS EXISTS / WHAT IT CORRECTS
 *   Observed on staging 2026-09-11: "Free Test sponsor 1" rendered across poster,
 *   display, and report with no sponsor party having agreed — an organiser
 *   *asserting* a relationship, not a relationship. The cause was a permissive
 *   default, `COALESCE(sp.sponsor_accepted, 1) = 1`, i.e. silence renders. OSE-1301
 *   ("silence never becomes consent") supersedes that. The prior permissive rule was
 *   locked by geo-resolution.structural.invariant (OSE-1298); that lock was rewritten
 *   in lockstep (ratified 2026-09-13). This gate is the entity-agnostic guarantee.
 *
 * SHAPE (property-asserting + triaged exemptions, per 0-architecture/README.md):
 *   - Every PUBLIC direct-placement render query requires strict sp.sponsor_accepted
 *     = 1 (Path 1 in both the public event page and the resolver).
 *   - The permissive COALESCE(sp.sponsor_accepted, 1) pattern is ERADICATED from
 *     src/ — a negative control (zero occurrences), so a future re-introduction
 *     anywhere turns this red.
 *   - EXEMPT (named, with reason): Path 2 template/geo auto-match still treats
 *     sponsor silence permissively (reject-only exclusion). That is the epic's OPEN
 *     "can a venue pre-authorise a standing rotation?" question — DECIDED AT CCR, not
 *     silently covered. Admin list/get intentionally show unconfirmed placements to
 *     the organizer, so they carry no sponsor-side filter at all.
 *
 * @born-red OSE-1301 | method: revert either public query's `sp.sponsor_accepted = 1`
 *   to COALESCE(...,1) → the strict + eradication assertions fail. Verified 2026-09-13.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_ROOT = join(REPO_ROOT, 'workers', 'oursharedevents');
const SRC = join(WORKER_ROOT, 'src');
const PAGES = join(SRC, 'handlers', 'pages.ts');
const RESOLVER = join(SRC, 'lib', 'sponsor-resolver.ts');

// Strict confirmation: `sp.sponsor_accepted = 1` NOT preceded by `COALESCE(`.
const STRICT_SPONSOR = /(?<!COALESCE\s*\(\s*)\bsp\.sponsor_accepted\s*=\s*1/i;
// The permissive default OSE-1301 eradicates: COALESCE(<alias>.sponsor_accepted, 1).
const PERMISSIVE_SPONSOR = /COALESCE\s*\(\s*\w+\.sponsor_accepted\s*,\s*1\s*\)/gi;

test.describe('OSE-1301: consent-traced sponsorship — public render requires sponsor confirmation', () => {
  // Negative control: the scanner must actually see the files it audits. A
  // completeness check that reads nothing is indistinguishable from a pass.
  test('OSE-INV-CONSENT | control | both public render sources exist and query sponsor_placement', () => {
    for (const [label, path] of [
      ['pages.ts', PAGES],
      ['sponsor-resolver.ts', RESOLVER],
    ] as const) {
      expect(existsSync(path), `${label} must exist`).toBe(true);
      expect(readFileSync(path, 'utf8'), `${label} must query sponsor_placement`).toMatch(
        /sponsor_placement/i
      );
    }
  });

  test('OSE-INV-CONSENT | public-event-page | direct sponsor list requires strict sponsor_accepted = 1', () => {
    const src = readFileSync(PAGES, 'utf8');
    expect(
      src,
      'the public event-page sponsor query must gate on strict sp.sponsor_accepted = 1 (silence is not consent)'
    ).toMatch(STRICT_SPONSOR);
    expect(
      src,
      'the organizer side stays permissive — COALESCE(sp.organizer_accepted, 1) = 1'
    ).toMatch(/COALESCE\s*\(\s*sp\.organizer_accepted\s*,\s*1\s*\)\s*=\s*1/i);
  });

  test('OSE-INV-CONSENT | resolver | Path 1 direct placements require strict sponsor_accepted = 1', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    expect(src, 'resolver Path 1 must gate on strict sp.sponsor_accepted = 1').toMatch(
      STRICT_SPONSOR
    );
  });

  test('OSE-INV-CONSENT | property | the permissive COALESCE(sponsor_accepted, 1) is eradicated from src/', () => {
    // Scan every .ts under src/. The permissive default must appear NOWHERE — its
    // re-introduction in any handler is exactly the regression this gate prevents.
    const files = listTsFiles(SRC);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const hits = src.match(PERMISSIVE_SPONSOR);
      if (hits) offenders.push(`${f.replace(SRC, 'src')} (${hits.length})`);
    }
    expect(
      offenders,
      `COALESCE(sponsor_accepted, 1) — silence-is-consent — must not exist in src/. Found: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  test('OSE-INV-CONSENT | exemption | Path 2 template/geo is a NAMED permissive exemption (OSE-1301 open question)', () => {
    // Honesty gate: Path 2 (auto-match without a per-event pick) still treats sponsor
    // silence permissively via a reject-only exclusion. That is the epic's OPEN
    // "standing rotation = default-on?" question, DECIDED AT CCR — this test asserts
    // the exemption is present and documented, so the suite is not falsely claiming
    // total coverage. When Path 2 is decided, update this test in lockstep.
    const src = readFileSync(RESOLVER, 'utf8');
    expect(
      src,
      'Path 2 still uses the reject-only exclusion (spx.sponsor_accepted = 0) — the permissive exemption'
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
