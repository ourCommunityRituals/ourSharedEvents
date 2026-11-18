/**
 * INVARIANT: the header of router.ts lists every route the router matches (OSE-2047)
 *
 * AGENTS.md ("Sources of truth") names the header comment of
 * `workers/oursharedevents/src/router.ts` as the canonical route list. On
 * 2026-11-18 the code matched 56 path shapes the header did not list (page
 * aliases, the demo site, `/s/<code>`, and admin and sponsor routes), so the
 * list people and agents read was short. This gate keeps the two the same.
 *
 * L0 STATIC (this file): reads router.ts and compares two sets of path shapes.
 *   - the code: every `pathname === '/x'` literal, every `/^...$/` regex and
 *     every `pathname.startsWith('/x/')` prefix after the header. The first two
 *     are read by the same functions the admin write guard's gate uses
 *     (workers/oursharedevents/tests/helpers/admin-write-routes.ts).
 *   - the header: every ` *   METHOD /path` line.
 *
 * What this catches:
 *   - a new route is added to the router and not to the header → red, naming it.
 *   - a route is removed or renamed in the router and its header line stays → red.
 *   - a router regex this reading cannot turn into a path shape → red, not skipped.
 *
 * What it does not prove: that the method or the description on a header line is
 * right, or anything about a path matched outside router.ts or compared to a
 * constant (the two constants today are listed below with their reason).
 *
 * Seen red (2026-11-18): against `main` before the header lines were added (56
 * unlisted), and again with one header line taken out and one invented line put in.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  headerListedShapes,
  isUnreadShape,
  routerMatchedShapes,
  shapesOfRegexBody,
  unlistedRoutes,
  unmatchedHeaderRoutes,
} from '../../../workers/oursharedevents/tests/helpers/router-route-list';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const ROUTER = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'router.ts');
const SOURCE = readFileSync(ROUTER, 'utf8');

/**
 * Header routes this reading cannot find in the code, each with the reason. The
 * router compares these two paths to an imported constant, not a string literal.
 */
const MATCHED_BY_CONSTANT: Readonly<Record<string, string>> = {
  '/sponsor-default-logo.svg': 'pathname === SPONSOR_DEFAULT_LOGO_PATH (lib/sponsor-card.ts)',
  '/event-default-thumb.svg': 'pathname === EVENT_DEFAULT_THUMB_PATH (lib/event-thumb.ts)',
};

const fake = (headerLines: string[], codeLines: string[]): string =>
  ['/**', ' * Route table:', ' *', ...headerLines, ' */', '', ...codeLines].join('\n');

test.describe('the reading (negative controls on synthetic router source)', () => {
  test('a literal route missing from the header is reported', () => {
    const src = fake(
      [' *   GET /health                  → health check'],
      ["  if (pathname === '/health') {}", "  if (pathname === '/secret-console') {}"]
    );
    expect(unlistedRoutes(src)).toEqual(['/secret-console']);
    expect(unmatchedHeaderRoutes(src)).toEqual([]);
  });

  test('a regex route is matched to its header line by shape, whatever the parameter is called', () => {
    const src = fake(
      [' *   PUT    /api/v2/admin/things/:thingId/parts/:id → change a part'],
      ['  const m = pathname.match(/^\\/api\\/v2\\/admin\\/things\\/([^/]+)\\/parts\\/([^/]+)$/);']
    );
    expect(unlistedRoutes(src)).toEqual([]);
    expect(unmatchedHeaderRoutes(src)).toEqual([]);
  });

  test('every branch of a regex alternation has to be listed', () => {
    const src = fake(
      [' *   GET  /api/v2/admin/events/:id/forms/registrations → list'],
      [
        '  const m = pathname.match(',
        '    /^\\/api\\/v2\\/admin\\/events\\/([^/]+)\\/forms\\/(registrations|contacts)$/',
        '  );',
      ]
    );
    expect(unlistedRoutes(src)).toEqual(['/api/v2/admin/events/:p/forms/contacts']);
  });

  test('a header line may name several paths, branches, a query and an optional part', () => {
    const src = fake(
      [
        ' *   GET /e/:code /p/:code         → 302',
        ' *   GET /events/:id/tv|poster     → screens',
        ' *   GET /api/v2/things/:id/logo[?slot=sidebar] → logo',
        ' *   GET /sponsor?t=<token>        → page',
      ],
      []
    );
    expect(headerListedShapes(src)).toEqual([
      '/api/v2/things/:p/logo',
      '/e/:p',
      '/events/:p/poster',
      '/events/:p/tv',
      '/p/:p',
      '/sponsor',
    ]);
  });

  test('a startsWith prefix is a route, and a header line that names no route is reported', () => {
    const src = fake(
      [' *   GET /gone/:id                 → a route that was removed'],
      ["  if (pathname.startsWith('/s/') && method === 'GET') {}"]
    );
    expect(unlistedRoutes(src)).toEqual(['/s/*']);
    expect(unmatchedHeaderRoutes(src)).toEqual(['/gone/:p']);
  });

  test('a path under a language prefix is checked without the prefix', () => {
    const src = fake(
      [' *   GET /e/:code                  → 302', ' *   GET /es/e/:code               → 302'],
      ['  const m = pathname.match(/^\\/(e|p)\\/([^/]{1,40})$/);']
    );
    expect(unmatchedHeaderRoutes(src)).toEqual([]);
    expect(unlistedRoutes(src)).toEqual(['/p/:p']);
  });

  test('prose in the header that mentions a path is not a route line', () => {
    const src = fake(
      [
        ' *   GET /                        → landing page',
        ' *                                  GET /events has the same limit, counted apart.',
      ],
      []
    );
    expect(headerListedShapes(src)).toEqual(['/']);
  });

  test('a regex the reading cannot turn into a shape is flagged', () => {
    expect(shapesOfRegexBody('\\/api\\/v2\\/things\\/(\\d{4})').some(isUnreadShape)).toBe(true);
    expect(shapesOfRegexBody('\\/api\\/v2\\/things\\/([^/]+)').some(isUnreadShape)).toBe(false);
  });
});

test.describe('the real router', () => {
  test('the reading sees the router and the header (not two empty lists)', () => {
    expect(routerMatchedShapes(SOURCE).length).toBeGreaterThanOrEqual(150);
    expect(headerListedShapes(SOURCE).length).toBeGreaterThanOrEqual(150);
  });

  test('every router regex was turned into a path shape', () => {
    const unread = routerMatchedShapes(SOURCE).filter(isUnreadShape);
    expect(
      unread,
      `router regex(es) this reading cannot turn into a path shape. Teach ` +
        `workers/oursharedevents/tests/helpers/router-route-list.ts the new form; do not skip it:\n  ${unread.join('\n  ')}`
    ).toEqual([]);
  });

  test('every route the router matches is listed in the header', () => {
    const unlisted = unlistedRoutes(SOURCE);
    expect(
      unlisted,
      `route(s) matched in router.ts and missing from its header comment, which AGENTS.md ` +
        `names as the canonical route list. Add a " *   METHOD /path → what it does" line for each:\n  ${unlisted.join('\n  ')}`
    ).toEqual([]);
  });

  test('every route the header lists is matched by the router', () => {
    const stale = unmatchedHeaderRoutes(SOURCE).filter((s) => !(s in MATCHED_BY_CONSTANT));
    expect(
      stale,
      `header line(s) naming a path the router does not match. Remove or correct each line:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });

  test('every constant-matched exemption is still needed and states its reason', () => {
    const unmatched = unmatchedHeaderRoutes(SOURCE);
    for (const [path, reason] of Object.entries(MATCHED_BY_CONSTANT)) {
      expect(unmatched, `exemption no longer needed: ${path}`).toContain(path);
      const constant = /=== ([A-Z_]+) /.exec(reason)?.[1] ?? '';
      expect(constant, `exemption for ${path} names no constant`).not.toBe('');
      expect(SOURCE, `router.ts no longer compares pathname to ${constant}`).toContain(
        `pathname === ${constant}`
      );
    }
  });
});
