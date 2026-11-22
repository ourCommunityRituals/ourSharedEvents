/**
 * Staging testers (owner, 2026-11-22): an outside tester signs in on staging
 * and administers exactly one practice brand. The list is a staging secret,
 * never code, and it grants nothing anywhere but staging.
 *
 * Pure: no runtime. Every address and brand here is a made-up example.
 */

import { describe, test, expect } from 'vitest';
import {
  stagingTesters,
  stagingTesterBrand,
  MAX_STAGING_TESTERS,
} from '../src/lib/staging-testers';
import { isAdminEmailAllowed } from '../src/lib/admin-allowlist';
import {
  resolveAdminBrandScope,
  resolveAdminBrandScopeAsync,
  PLATFORM_BRAND_ID,
  PUBLIC_BRAND_ID,
} from '../src/lib/admin-brand-scope';

const TESTERS = JSON.stringify({ 'Tester@Example.test': 'practice-brand' });
const STAGING = { WORKER_ENV: 'staging', STAGING_TESTERS: TESTERS };
const ALLOW = { ALLOWED_ADMIN_EMAILS: 'owner@example.test', ALLOWED_ADMIN_DOMAINS: '' };

describe('stagingTesters: what the setting grants', () => {
  test('on staging, a listed address has its one brand (address read case-blind)', () => {
    expect(stagingTesterBrand('tester@example.test', STAGING)).toBe('practice-brand');
    expect(stagingTesterBrand('TESTER@example.test', STAGING)).toBe('practice-brand');
  });

  test.each([undefined, 'production', 'local', 'Staging', ''])(
    'off staging (WORKER_ENV=%s) it grants nothing',
    (workerEnv) => {
      expect(stagingTesters({ WORKER_ENV: workerEnv, STAGING_TESTERS: TESTERS }).size).toBe(0);
    }
  );

  test.each([
    ['unset', undefined],
    ['blank', '  '],
    ['not JSON', '{tester'],
    ['an array', '["tester@example.test"]'],
    ['null', 'null'],
  ])('a setting that is %s grants nothing', (_label, raw) => {
    expect(stagingTesters({ WORKER_ENV: 'staging', STAGING_TESTERS: raw }).size).toBe(0);
  });

  test.each([
    ['the platform brand', PLATFORM_BRAND_ID],
    ['the public brand', PUBLIC_BRAND_ID],
    ['a brand that is not a slug', 'Practice Brand'],
    ['a list of brands', ['a', 'b']],
    ['an empty brand', ''],
  ])('a tester given %s grants nothing', (_label, brand) => {
    const env = {
      WORKER_ENV: 'staging',
      STAGING_TESTERS: JSON.stringify({ 't@example.test': brand }),
    };
    expect(stagingTesterBrand('t@example.test', env)).toBeNull();
  });

  test('an entry that is not an email address grants nothing', () => {
    const env = { WORKER_ENV: 'staging', STAGING_TESTERS: JSON.stringify({ 'not-an-email': 'b' }) };
    expect(stagingTesters(env).size).toBe(0);
  });

  test(`more than ${MAX_STAGING_TESTERS} testers reads as malformed`, () => {
    const many: Record<string, string> = {};
    for (let i = 0; i <= MAX_STAGING_TESTERS; i++) many[`t${i}@example.test`] = 'b';
    expect(
      stagingTesters({ WORKER_ENV: 'staging', STAGING_TESTERS: JSON.stringify(many) }).size
    ).toBe(0);
  });
});

describe('the admin allowlist lets a staging tester in, on staging only', () => {
  test('staging: the tester passes', () => {
    expect(isAdminEmailAllowed('tester@example.test', { ...ALLOW, ...STAGING })).toBe(true);
  });

  test('production: the same setting does not let the tester in', () => {
    expect(
      isAdminEmailAllowed('tester@example.test', {
        ...ALLOW,
        WORKER_ENV: 'production',
        STAGING_TESTERS: TESTERS,
      })
    ).toBe(false);
  });

  test('an empty allowlist still denies everyone, a tester included', () => {
    expect(
      isAdminEmailAllowed('tester@example.test', {
        ALLOWED_ADMIN_EMAILS: '',
        ALLOWED_ADMIN_DOMAINS: '',
        ...STAGING,
      })
    ).toBe(false);
  });

  test('an address not on the list is still refused on staging', () => {
    expect(isAdminEmailAllowed('stranger@example.test', { ...ALLOW, ...STAGING })).toBe(false);
  });
});

describe('a staging tester sees exactly one brand', () => {
  test('staging: scoped to the practice brand alone', () => {
    expect(resolveAdminBrandScope('tester@example.test', STAGING)).toEqual({
      mode: 'scoped',
      brandIds: ['practice-brand'],
    });
  });

  test('production: the same setting scopes nothing (deny)', () => {
    expect(
      resolveAdminBrandScope('tester@example.test', {
        WORKER_ENV: 'production',
        STAGING_TESTERS: TESTERS,
      })
    ).toEqual({ mode: 'deny' });
  });

  test('another address is not widened by the setting', () => {
    expect(resolveAdminBrandScope('stranger@example.test', STAGING)).toEqual({ mode: 'deny' });
  });

  test('membership rows, when the address has them, win over the setting', async () => {
    const DB = {
      prepare: () => ({
        bind: () => ({ all: async () => ({ results: [{ brand_id: 'row-brand' }] }) }),
      }),
    } as unknown as D1Database;
    expect(await resolveAdminBrandScopeAsync('tester@example.test', { ...STAGING, DB })).toEqual({
      mode: 'scoped',
      brandIds: ['row-brand'],
    });
  });

  test('with no membership rows, the async path gives the practice brand', async () => {
    const DB = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
    } as unknown as D1Database;
    expect(await resolveAdminBrandScopeAsync('tester@example.test', { ...STAGING, DB })).toEqual({
      mode: 'scoped',
      brandIds: ['practice-brand'],
    });
  });
});

describe('where the setting may ever grant anything', () => {
  test('production and local are never tester environments', async () => {
    const { TESTER_ENVIRONMENTS } = await import('../src/lib/staging-testers');
    expect(TESTER_ENVIRONMENTS).not.toContain('production');
    expect(TESTER_ENVIRONMENTS).not.toContain('local');
  });
});
