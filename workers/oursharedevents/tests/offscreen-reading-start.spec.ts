/**
 * OSE-1850 follow-up — offscreen hiding by the reading start, on every page.
 *
 * Staging T4i, 2026-11-12: the Arabic check-in page scrolled 9999 px sideways
 * at 375 px. Its skip link was hidden with a physical `left: -9999px`, and on a
 * right-to-left page the overflow past the left edge is the scrollable side.
 * The form pages were fixed in PR #1197 (form-pages-language.spec.ts holds
 * them). This spec holds the five pages outside the language layer — admin
 * sign-in, admin, SharedReport, poster and display — to the same rule, so none
 * of them can scroll sideways if it is ever served right-to-left:
 *
 *   1. Each served page's skip-link rule hides by `inset-inline-start: -9999px`
 *      and its `:focus` rule shows it at `inset-inline-start: 0`; neither names
 *      a physical `left:` or `right:`.
 *   2. Nothing under src/ hides anything with a physical `left:` / `right:` at a
 *      large negative offset (three digits or more of px).
 *   3. Both detectors flag a synthetic physical rule (negative controls), so
 *      they cannot pass by seeing nothing.
 *
 * Mock layer: the page handlers called directly, as keyboard-nav.spec.ts does.
 * Staging: T3/T4 load these pages; the form-page overflow check is in
 * tests/e2e (T4i).
 *
 * @born-red offscreen by the reading start | method: this spec run against the
 *   five templates as on main (b56e15dc, before the change): the five page
 *   cases and the src/ sweep fail on `left: -9999px` | date: 2026-11-16
 *
 * Placement: node project. The handlers render static templates; no runtime.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  handleAdminPage,
  handleAdminSignInPage,
  handleDisplayPage,
  handlePosterPage,
  handleSharedReportPage,
} from '../src/handlers/pages';

const SRC = join(__dirname, '..', 'src');

const PAGES: Record<string, () => Response | Promise<Response>> = {
  'admin sign-in': () => handleAdminSignInPage({} as never),
  admin: () => handleAdminPage({} as never),
  SharedReport: () => handleSharedReportPage({} as never),
  poster: () => handlePosterPage({} as never),
  display: () => handleDisplayPage({} as never),
};

/** Every CSS rule inside the page's <style> blocks, as [selectors, body]. */
function cssRules(page: string): Array<[string[], string]> {
  const rules: Array<[string[], string]> = [];
  for (const [, css] of page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = sel
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim());
      rules.push([selectors, body]);
    }
  }
  return rules;
}

/** A physical side in a declaration list (not margin-left, not inset-inline-start). */
const PHYSICAL_SIDE = /(^|[\s;{])(left|right)\s*:/;
/** A physical side pushed far off the page. */
const PHYSICAL_OFFSCREEN = /(^|[\s;{])(left|right)\s*:\s*-\d{3,}px/;

function skipLinkRules(page: string) {
  const rules = cssRules(page);
  return {
    hidden: rules.filter(([s]) => s.includes('.skip-link')).map(([, b]) => b),
    shown: rules.filter(([s]) => s.includes('.skip-link:focus')).map(([, b]) => b),
  };
}

function srcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return srcFiles(path);
    return /\.(html|ts|css|js)$/.test(name) ? [path] : [];
  });
}

describe('offscreen hiding sits past the reading start, never a physical side', () => {
  for (const [name, render] of Object.entries(PAGES)) {
    test(`${name}: the skip link hides and shows by the reading start`, async () => {
      const page = await (await render()).text();
      const { hidden, shown } = skipLinkRules(page);
      expect(hidden.length, name).toBeGreaterThan(0);
      expect(shown.length, name).toBeGreaterThan(0);
      // Some .skip-link rules hide it another way (SharedReport's print rule is
      // display: none); the offscreen one is by the reading start.
      expect(
        hidden.some((rule) => /inset-inline-start:\s*-9999px/.test(rule)),
        `${name}: a .skip-link rule hides it past the reading start`
      ).toBe(true);
      expect(
        shown.some((rule) => /inset-inline-start:\s*0\b/.test(rule)),
        `${name}: a :focus rule shows it at the reading start`
      ).toBe(true);
      for (const rule of [...hidden, ...shown]) {
        expect(rule, name).not.toMatch(PHYSICAL_SIDE);
      }
    });
  }

  test('nothing under src/ hides with a physical side at a large negative offset', () => {
    const offenders = srcFiles(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => PHYSICAL_OFFSCREEN.test(line))
        .map(([line, n]) => `${relative(SRC, file).split(sep).join('/')}:${n}: ${line.trim()}`)
    );
    expect(offenders).toEqual([]);
  });

  test('negative controls: both detectors flag a physical rule', () => {
    const synthetic =
      '<style>.skip-link { position: absolute; left: -9999px; }\n' +
      '.skip-link:focus { position: fixed; right: 0; }</style>';
    const { hidden, shown } = skipLinkRules(synthetic);
    expect(hidden).toHaveLength(1);
    expect(shown).toHaveLength(1);
    expect(hidden[0]).toMatch(PHYSICAL_SIDE);
    expect(shown[0]).toMatch(PHYSICAL_SIDE);
    expect(PHYSICAL_OFFSCREEN.test('  left: -9999px;')).toBe(true);
    expect(PHYSICAL_OFFSCREEN.test('  right:-1000px')).toBe(true);
    expect(PHYSICAL_OFFSCREEN.test('  inset-inline-start: -9999px;')).toBe(false);
    expect(PHYSICAL_OFFSCREEN.test('  margin-left: -9999px;')).toBe(false);
    expect(PHYSICAL_OFFSCREEN.test('  left: -1px;')).toBe(false);
  });
});
