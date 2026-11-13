/**
 * Every address the router answers is in the page-rules list (OSE-2030,
 * OSE ADR-028).
 *
 * `tests/helpers/page-surfaces.ts` says, for each address outside /api/,
 * whether a browser gets a page there. This gate holds that list equal to the
 * route table read out of `src/router.ts`:
 *
 *   - an address the router answers that the list does not name fails, and the
 *     message says what to do;
 *   - a list entry the router no longer answers fails too.
 *
 * So a new page cannot be added without someone deciding "page or not", and a
 * page so decided is asked for and checked by `page-surfaces-one-h1.spec.ts`
 * (exactly one <h1>, AGENTS.md invariant 8). The demo sites shipped with no
 * <h1> because the old check was a remembered list; this one is derived.
 *
 * Shape: property-asserting, with negative controls that run the same check on
 * a router with a planted route, so the gate is shown to see a new route.
 *
 * Placement: node project (reads the source file, no runtime).
 *
 * Seen red (2026-11-13): adding `if (pathname === '/tickets')` to the router
 * fails "every address is in the page-rules list"; deleting the '/demo' entry
 * from the list fails the same test; adding a '/gone' entry fails "no entry is
 * left for an address the router no longer answers".
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeShapes, isApi } from './helpers/route-shapes';
import { PAGE_SURFACES, LANGUAGE_PREFIX_SAMPLES } from './helpers/page-surfaces';

const ROUTER = readFileSync(join(__dirname, '..', 'src', 'router.ts'), 'utf8');

/** Addresses outside /api/ that the list does not name. */
function unlisted(src: string, listed: Readonly<Record<string, unknown>>): string[] {
  return [...routeShapes(src)].filter((s) => !isApi(s) && !(s in listed)).sort();
}

describe('the page-rules list equals the route table', () => {
  test('the reader sees the routes (negative control)', () => {
    const shapes = routeShapes(ROUTER);
    for (const s of ['/', '/events', '/demo', '/demo/:param', '/sponsors/:param', '/ui.css']) {
      expect(shapes.has(s), `reader finds ${s}`).toBe(true);
    }
    expect(shapes.size).toBeGreaterThan(80);
  });

  test('every address is in the page-rules list', () => {
    expect(
      unlisted(ROUTER, PAGE_SURFACES),
      'The router answers these addresses and tests/helpers/page-surfaces.ts does not name them. ' +
        'Add each one: page(...) if a browser gets an HTML document there (it is then checked for one <h1>), ' +
        'notPage(...) if it is a forward, a file, data or a POST target.'
    ).toEqual([]);
  });

  test('no entry is left for an address the router no longer answers', () => {
    const shapes = routeShapes(ROUTER);
    const stale = Object.keys(PAGE_SURFACES).filter((k) => !shapes.has(k));
    expect(stale, 'Remove these from PAGE_SURFACES (or restore the route).').toEqual([]);
  });

  test('every entry has a sample to ask for and says what it is', () => {
    for (const [shape, s] of Object.entries(PAGE_SURFACES)) {
      expect(s.samples.length, `${shape} has a sample`).toBeGreaterThan(0);
      for (const sample of s.samples) expect(sample, `${shape} sample`).toMatch(/^\//);
      expect(s.what.trim().length, `${shape} says what it is`).toBeGreaterThan(3);
    }
    for (const sample of LANGUAGE_PREFIX_SAMPLES) expect(sample).toMatch(/^\/[a-z]{2}\//);
  });

  test('a shape with alternatives has a sample for each one', () => {
    for (const [shape, s] of Object.entries(PAGE_SURFACES)) {
      const alt = shape.match(/\(([a-z0-9|-]+)\)/);
      if (!alt) continue;
      for (const word of alt[1].split('|')) {
        expect(
          s.samples.some((p) => p.split(/[/?]/).includes(word)),
          `${shape}: no sample for "${word}"`
        ).toBe(true);
      }
    }
  });
});

describe('the gate fails on an address nobody decided (negative control)', () => {
  // Each case plants one line in today's router and reads only what that line
  // added, so the controls check the gate and stay green if the router drifts.
  const before = new Set(unlisted(ROUTER, PAGE_SURFACES));
  const planted = (line: string) =>
    unlisted(ROUTER.replace('// ── 404', `${line}\n  // ── 404`), PAGE_SURFACES).filter(
      (s) => !before.has(s)
    );

  test('the router has the marker the controls plant at', () => {
    expect(ROUTER).toContain('// ── 404');
  });

  test('a new exact address is caught', () => {
    expect(planted("  if (pathname === '/tickets') return page();")).toEqual(['/tickets']);
  });

  test('a new pattern address is caught', () => {
    expect(planted('  const m = pathname.match(/^\\/venues\\/([^/]+)$/);')).toEqual([
      '/venues/:param',
    ]);
  });

  test('a new prefix address is caught', () => {
    expect(planted("  if (pathname.startsWith('/maps/')) return page();")).toEqual(['/maps/*']);
  });

  test('an address under /api/ is left to the API gates', () => {
    expect(planted("  if (pathname === '/api/v2/things') return json();")).toEqual([]);
  });

  test('a page dropped from the list is caught', () => {
    const { '/demo': _dropped, ...rest } = PAGE_SURFACES;
    expect(unlisted(ROUTER, rest).filter((s) => !before.has(s))).toEqual(['/demo']);
  });
});
