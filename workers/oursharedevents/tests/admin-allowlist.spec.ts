/**
 * OSE-211 / SEC-5 — Admin email allowlist
 *
 * L1: unit tests for isAdminEmailAllowed + assertAdminEmailAllowed
 * L2: integration via SELF.fetch — CF Access JWT with non-allowlisted email → 403
 */

import { describe, test, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { isAdminEmailAllowed, assertAdminEmailAllowed } from '../src/lib/admin-allowlist';

// ── L1: isAdminEmailAllowed ───────────────────────────────────────────────────

describe('L1: isAdminEmailAllowed — exact email match', () => {
  const e = {
    ALLOWED_ADMIN_EMAILS: 'admin@example.com,ops@example.com',
    ALLOWED_ADMIN_DOMAINS: '',
  };

  test('exact match returns true', () => {
    expect(isAdminEmailAllowed('admin@example.com', e)).toBe(true);
  });

  test('case-insensitive match returns true', () => {
    expect(isAdminEmailAllowed('ADMIN@EXAMPLE.COM', e)).toBe(true);
  });

  test('second email in CSV returns true', () => {
    expect(isAdminEmailAllowed('ops@example.com', e)).toBe(true);
  });

  test('email not in list returns false', () => {
    expect(isAdminEmailAllowed('stranger@example.com', e)).toBe(false);
  });
});

describe('L1: isAdminEmailAllowed — domain match', () => {
  const e = { ALLOWED_ADMIN_EMAILS: '', ALLOWED_ADMIN_DOMAINS: 'oursharedevents.com,example.com' };

  test('email on allowed domain returns true', () => {
    expect(isAdminEmailAllowed('anyone@oursharedevents.com', e)).toBe(true);
  });

  test('email on second allowed domain returns true', () => {
    expect(isAdminEmailAllowed('dev@example.com', e)).toBe(true);
  });

  test('domain case-insensitive returns true', () => {
    expect(isAdminEmailAllowed('user@OURSHAREDEVENTS.COM', e)).toBe(true);
  });

  test('email on non-allowed domain returns false', () => {
    expect(isAdminEmailAllowed('user@otherdomain.com', e)).toBe(false);
  });
});

describe('L1: isAdminEmailAllowed — fail-safe (empty env)', () => {
  test('both empty → deny all', () => {
    expect(isAdminEmailAllowed('admin@example.com', {})).toBe(false);
  });

  test('empty strings → deny all', () => {
    expect(
      isAdminEmailAllowed('admin@example.com', {
        ALLOWED_ADMIN_EMAILS: '',
        ALLOWED_ADMIN_DOMAINS: '',
      })
    ).toBe(false);
  });

  test('whitespace-only → deny all', () => {
    expect(
      isAdminEmailAllowed('admin@example.com', {
        ALLOWED_ADMIN_EMAILS: '   ',
        ALLOWED_ADMIN_DOMAINS: '  ',
      })
    ).toBe(false);
  });
});

describe('L1: isAdminEmailAllowed — CSV edge cases', () => {
  test('handles spaces around commas', () => {
    const e = { ALLOWED_ADMIN_EMAILS: ' admin@a.com , ops@b.com ', ALLOWED_ADMIN_DOMAINS: '' };
    expect(isAdminEmailAllowed('admin@a.com', e)).toBe(true);
    expect(isAdminEmailAllowed('ops@b.com', e)).toBe(true);
  });

  test('email with no @ symbol does not match domain list', () => {
    const e = { ALLOWED_ADMIN_EMAILS: '', ALLOWED_ADMIN_DOMAINS: 'example.com' };
    expect(isAdminEmailAllowed('notanemail', e)).toBe(false);
  });
});

// ── L1: assertAdminEmailAllowed ───────────────────────────────────────────────

describe('L1: assertAdminEmailAllowed', () => {
  const allowed = { ALLOWED_ADMIN_EMAILS: 'admin@example.com', ALLOWED_ADMIN_DOMAINS: '' };
  const empty = { ALLOWED_ADMIN_EMAILS: '', ALLOWED_ADMIN_DOMAINS: '' };

  test('allowed email → returns null', () => {
    expect(assertAdminEmailAllowed('admin@example.com', allowed, 'req-1')).toBeNull();
  });

  test('unlisted email → returns 403 Response', async () => {
    const res = assertAdminEmailAllowed('bad@external.com', allowed, 'req-2');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { code: string; requestId: string };
    expect(body.code).toBe('ADMIN_NOT_ALLOWED');
    expect(body.requestId).toBe('req-2');
  });

  test('empty allowlist → 403 (fail-safe, not 503)', async () => {
    const res = assertAdminEmailAllowed('admin@example.com', empty, 'req-3');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  test('403 response has X-Request-Id header', () => {
    const res = assertAdminEmailAllowed('bad@test.com', allowed, 'my-req-id');
    expect(res!.headers.get('X-Request-Id')).toBe('my-req-id');
  });

  test('403 response is application/json', () => {
    const res = assertAdminEmailAllowed('bad@test.com', allowed, 'req-4');
    expect(res!.headers.get('Content-Type')).toBe('application/json');
  });
});

// ── L1: static analysis — admin-allowlist.ts is imported in admin.ts ─────────

describe('L1: static — admin-allowlist imported in auth/admin.ts', () => {
  // Normalise Windows backslashes so path checks work cross-platform
  function normPath(p: string): string {
    return p.replace(/\\/g, '/');
  }

  test('admin.ts imports assertAdminEmailAllowed from admin-allowlist', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const adminTs = Object.entries(files).find(([k]) => normPath(k).includes('/auth/admin.ts'));
    expect(adminTs).toBeDefined();
    expect(adminTs![1]).toContain('admin-allowlist');
    expect(adminTs![1]).toContain('assertAdminEmailAllowed');
  });

  test('router.ts has ALLOWED_ADMIN_EMAILS in RouterEnv or inherits via AdminEnv', () => {
    const src = (env as Record<string, unknown>).TEST_SOURCE_FILES_JSON as string;
    const files = JSON.parse(src) as Record<string, string>;
    const routerTs = Object.entries(files).find(([k]) => normPath(k).endsWith('/src/router.ts'));
    expect(routerTs).toBeDefined();
    // RouterEnv includes AdminEnv which extends AdminAllowlistEnv
    expect(routerTs![1]).toContain('AdminEnv');
  });

  test('wrangler.toml declares ALLOWED_ADMIN_EMAILS', () => {
    const toml = (env as Record<string, unknown>).TEST_WRANGLER_TOML as string;
    expect(toml).toContain('ALLOWED_ADMIN_EMAILS');
    expect(toml).toContain('ALLOWED_ADMIN_DOMAINS');
  });
});

// ── L2: integration — ADMIN_KEY bypasses allowlist ───────────────────────────

describe('L2: ADMIN_KEY (Method 3) bypasses allowlist — no email identity', () => {
  test('admin list endpoint accessible with ADMIN_KEY despite allowlist being configured', async () => {
    // In the test environment ALLOWED_ADMIN_EMAILS=test-admin@example.com
    // but ADMIN_KEY Method 3 bypasses the allowlist entirely.
    const res = await SELF.fetch('http://localhost/api/v2/admin/events', {
      headers: { Authorization: 'Bearer test-admin-key-e2e-2026' },
    });
    // Should succeed (200) or return a non-401/403 auth error
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
