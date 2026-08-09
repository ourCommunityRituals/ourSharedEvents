/**
 * OSE-666 / B1 — resolveAdminBrandScope unit tests (pure, no runtime).
 *
 * Pins the fail-closed contract of the #9 tenant_isolation enforcement point:
 * every ambiguous/absent case collapses to deny-all (zero rows), scope comes
 * from the server-verified actor, and unscoped access is an explicit key-only
 * opt-in never granted to an email operator.
 */

import { describe, test, expect } from 'vitest';
import { resolveAdminBrandScope } from '../src/lib/admin-brand-scope';

const MAP = JSON.stringify({
  'a@brand-a.test': ['brand-A'],
  'multi@brand.test': ['brand-A', 'brand-B'],
  'empty@brand.test': [],
});

describe('resolveAdminBrandScope — fail-closed (#9)', () => {
  test('null actor → deny', () => {
    expect(resolveAdminBrandScope(null, { ADMIN_BRAND_MEMBERSHIP: MAP })).toEqual({ mode: 'deny' });
  });

  test('email present in map → scoped to exactly its brands', () => {
    expect(resolveAdminBrandScope('a@brand-a.test', { ADMIN_BRAND_MEMBERSHIP: MAP })).toEqual({
      mode: 'scoped',
      brandIds: ['brand-A'],
    });
    expect(resolveAdminBrandScope('multi@brand.test', { ADMIN_BRAND_MEMBERSHIP: MAP })).toEqual({
      mode: 'scoped',
      brandIds: ['brand-A', 'brand-B'],
    });
  });

  test('email NOT in map → deny (never the whole table)', () => {
    expect(resolveAdminBrandScope('nobody@x.test', { ADMIN_BRAND_MEMBERSHIP: MAP })).toEqual({
      mode: 'deny',
    });
  });

  test('email mapped to an empty brand list → deny', () => {
    expect(resolveAdminBrandScope('empty@brand.test', { ADMIN_BRAND_MEMBERSHIP: MAP })).toEqual({
      mode: 'deny',
    });
  });

  test('missing membership config → deny', () => {
    expect(resolveAdminBrandScope('a@brand-a.test', {})).toEqual({ mode: 'deny' });
  });

  test('malformed membership JSON → deny (fail-closed, not throw)', () => {
    expect(resolveAdminBrandScope('a@brand-a.test', { ADMIN_BRAND_MEMBERSHIP: '{not json' })).toEqual(
      { mode: 'deny' }
    );
  });

  test('key actor with ADMIN_SCOPE_ALL=true → all (automation opt-in)', () => {
    expect(resolveAdminBrandScope('key:ocr-internal', { ADMIN_SCOPE_ALL: 'true' })).toEqual({
      mode: 'all',
    });
    expect(resolveAdminBrandScope('key:admin', { ADMIN_SCOPE_ALL: 'true' })).toEqual({ mode: 'all' });
  });

  test('key actor WITHOUT the opt-in → deny', () => {
    expect(resolveAdminBrandScope('key:ocr-internal', {})).toEqual({ mode: 'deny' });
    expect(resolveAdminBrandScope('key:admin', { ADMIN_SCOPE_ALL: 'false' })).toEqual({ mode: 'deny' });
  });

  test('ADMIN_SCOPE_ALL never elevates an EMAIL operator (only keys)', () => {
    // An email not in the map stays denied even if the automation flag is on.
    expect(
      resolveAdminBrandScope('nobody@x.test', { ADMIN_BRAND_MEMBERSHIP: MAP, ADMIN_SCOPE_ALL: 'true' })
    ).toEqual({ mode: 'deny' });
  });

  test('duplicate brand ids are de-duplicated', () => {
    const dupMap = JSON.stringify({ 'd@x.test': ['brand-A', 'brand-A', 'brand-B'] });
    expect(resolveAdminBrandScope('d@x.test', { ADMIN_BRAND_MEMBERSHIP: dupMap })).toEqual({
      mode: 'scoped',
      brandIds: ['brand-A', 'brand-B'],
    });
  });
});
