/**
 * OSE-1554 — brand test matrix SELF-CHECK (property-asserting gate).
 *
 * The matrix (brand-matrix.spec.ts) is only as complete as its route list. This gate
 * derives the admin route patterns from `src/router.ts` and fails when one is in
 * neither `MATRIX_ROUTES` nor `ROUTE_EXEMPTIONS`, so a new brand-scoped admin route
 * cannot merge without matrix coverage or a reviewed, reasoned exemption.
 *
 * Shape (per tests/e2e/0-architecture/README.md): PROPERTY-asserting. The subject
 * list is read from the router, not typed here. Negative controls below prove the
 * derivation sees the router, and a stale list entry fails too.
 *
 * Placement: this runs in the workers pool (source arrives via TEST_SOURCE_FILES_JSON),
 * i.e. in the S0/T0 test shard on every PR. Moving it into the T0 `invariants` shard
 * needs a workflow change (tests/integration/infra-consistency.test.js), left as a
 * follow-up.
 *
 * @born-red invariant#9 | method: router-route-list-completeness | armed: 2026-10-04
 */

import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import {
  MATRIX_ROUTES,
  ROUTE_EXEMPTIONS,
  PUBLIC_ROUTE_NOTES,
  deriveAdminRoutePatterns,
  matrixPatterns,
} from './helpers/brand-matrix-routes';

const sources = (): Record<string, string> =>
  JSON.parse((env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON);

function routerSource(): string {
  for (const [path, content] of Object.entries(sources())) {
    if (path.replace(/\\/g, '/').endsWith('src/router.ts')) return content;
  }
  throw new Error('src/router.ts not found in TEST_SOURCE_FILES_JSON');
}

describe('OSE-1554 self-check: the matrix route list covers the router', () => {
  const derived = deriveAdminRoutePatterns(routerSource());

  test('negative control: the derivation sees the router (not an empty list)', () => {
    expect(derived.length).toBeGreaterThanOrEqual(40);
    for (const known of [
      '/api/v2/admin/events',
      '/api/v2/admin/events/:id/stats',
      '/api/v2/admin/sponsors/:id',
      '/api/v2/admin/poster-deployments/:id',
      '/api/v2/admin/audit-log',
    ]) {
      expect(derived, `derivation missed ${known}`).toContain(known);
    }
  });

  test('every admin route in router.ts is in the matrix or in a named exemption', () => {
    const covered = matrixPatterns();
    const missing = derived.filter((p) => !covered.has(p) && !(p in ROUTE_EXEMPTIONS));
    expect(
      missing,
      `Brand-scoped admin route(s) with no matrix coverage and no exemption. Add each to MATRIX_ROUTES ` +
        `(tests/helpers/brand-matrix-routes.ts) or to ROUTE_EXEMPTIONS with a reason:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  test('no stale entries: every matrix pattern and exemption is a real router route', () => {
    const real = new Set(derived);
    const staleMatrix = [...matrixPatterns()].filter((p) => !real.has(p));
    const staleExempt = Object.keys(ROUTE_EXEMPTIONS).filter((p) => !real.has(p));
    expect(staleMatrix, 'matrix pattern not in router.ts').toEqual([]);
    expect(staleExempt, 'exemption not in router.ts').toEqual([]);
  });

  test('a route is not both covered and exempt', () => {
    const covered = matrixPatterns();
    expect(Object.keys(ROUTE_EXEMPTIONS).filter((p) => covered.has(p))).toEqual([]);
  });

  test('every exemption states a reason a reviewer can read', () => {
    for (const [p, reason] of Object.entries(ROUTE_EXEMPTIONS)) {
      expect(reason.trim().length, `exemption for ${p} has no reason`).toBeGreaterThanOrEqual(25);
    }
  });

  test('the matrix exercises every object kind and every shape', () => {
    const kinds = new Set(MATRIX_ROUTES.flatMap((r) => (r.shape === 'object' ? [r.objectOf] : [])));
    expect([...kinds].sort()).toEqual([
      'campaign',
      'event',
      'placement',
      'poster-deployment',
      'sponsor',
    ]);
    const shapes = new Set(MATRIX_ROUTES.map((r) => r.shape));
    expect([...shapes].sort()).toEqual(['create', 'list', 'object']);
  });

  test('every known-gap marker names a ticket and a reason', () => {
    for (const r of MATRIX_ROUTES) {
      if (!r.knownGap) continue;
      expect(r.knownGap.ticket).toMatch(/^OSE-\d+$/);
      expect(r.knownGap.reason.length).toBeGreaterThan(20);
    }
  });

  test('public routes named in the matrix notes still exist in the router', () => {
    const src = routerSource();
    for (const p of Object.keys(PUBLIC_ROUTE_NOTES)) {
      const probe = p.replace('/:id', '');
      expect(src.includes(probe), p).toBe(true);
    }
  });
});
