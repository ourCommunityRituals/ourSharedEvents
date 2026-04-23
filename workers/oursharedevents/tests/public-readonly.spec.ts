/**
 * OSE-214 / SEC-7 — Public read-only guard
 *
 * L1: unit tests for guardPublicReadOnly
 * L2: integration via SELF.fetch — mutation on public path → 405
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { guardPublicReadOnly } from '../src/lib/public-readonly';

// ── L1: guardPublicReadOnly — allowed requests pass through ──────────────────

describe('L1: guardPublicReadOnly — GET/HEAD always passes', () => {
  const paths = [
    '/api/v2/events',
    '/api/v2/events/evt-123',
    '/api/v2/events/evt-123/sponsors',
    '/api/v2/events/evt-123/sponsor-bundle',
    '/api/v2/uploads/events/evt-123/file.jpg',
  ];

  for (const path of paths) {
    test(`GET ${path} → null`, () => {
      expect(guardPublicReadOnly('GET', path)).toBeNull();
    });
    test(`HEAD ${path} → null`, () => {
      expect(guardPublicReadOnly('HEAD', path)).toBeNull();
    });
  }
});

// ── L1: mutation on read-only paths → 405 ────────────────────────────────────

describe('L1: guardPublicReadOnly — mutations on public read-only paths → 405', () => {
  test('POST /api/v2/events → 405', () => {
    const res = guardPublicReadOnly('POST', '/api/v2/events');
    expect(res?.status).toBe(405);
  });

  test('PUT /api/v2/events/evt-123 → 405', () => {
    expect(guardPublicReadOnly('PUT', '/api/v2/events/evt-123')?.status).toBe(405);
  });

  test('DELETE /api/v2/events/evt-123 → 405', () => {
    expect(guardPublicReadOnly('DELETE', '/api/v2/events/evt-123')?.status).toBe(405);
  });

  test('PATCH /api/v2/events/evt-123 → 405', () => {
    expect(guardPublicReadOnly('PATCH', '/api/v2/events/evt-123')?.status).toBe(405);
  });

  test('DELETE /api/v2/uploads/events/evt-123/file.jpg → 405', () => {
    expect(guardPublicReadOnly('DELETE', '/api/v2/uploads/events/evt-123/file.jpg')?.status).toBe(
      405
    );
  });

  test('PUT /api/v2/uploads/events/evt-123/file.jpg → 405', () => {
    expect(guardPublicReadOnly('PUT', '/api/v2/uploads/events/evt-123/file.jpg')?.status).toBe(405);
  });
});

describe('L1: guardPublicReadOnly — 405 response shape', () => {
  test('response has Allow: GET, HEAD header', () => {
    const res = guardPublicReadOnly('POST', '/api/v2/events');
    expect(res!.headers.get('Allow')).toBe('GET, HEAD');
  });

  test('response is JSON with code METHOD_NOT_ALLOWED', async () => {
    const res = guardPublicReadOnly('DELETE', '/api/v2/events/evt-123');
    const body = (await res!.json()) as { code: string; status: number };
    expect(body.code).toBe('METHOD_NOT_ALLOWED');
    expect(body.status).toBe(405);
  });

  test('response includes the method name in error message', async () => {
    const res = guardPublicReadOnly('PUT', '/api/v2/events/evt-123');
    const body = (await res!.json()) as { error: string };
    expect(body.error).toContain('PUT');
  });
});

// ── L1: POST-only public exemptions pass through ──────────────────────────────

describe('L1: guardPublicReadOnly — POST-only public exemptions → null', () => {
  test('POST /api/v2/events/:id/forms/register → null (exempt)', () => {
    expect(guardPublicReadOnly('POST', '/api/v2/events/evt-1/forms/register')).toBeNull();
  });

  test('POST /api/v2/events/:id/forms/checkin → null (exempt)', () => {
    expect(guardPublicReadOnly('POST', '/api/v2/events/evt-1/forms/checkin')).toBeNull();
  });

  test('POST /api/v2/events/:id/forms/survey → null (exempt)', () => {
    expect(guardPublicReadOnly('POST', '/api/v2/events/evt-1/forms/survey')).toBeNull();
  });

  test('POST /api/v2/events/:id/forms/email-signup → null (exempt)', () => {
    expect(guardPublicReadOnly('POST', '/api/v2/events/evt-1/forms/email-signup')).toBeNull();
  });

  test('POST /api/v2/events/:id/sponsors/:sid/impression → null (exempt)', () => {
    expect(
      guardPublicReadOnly('POST', '/api/v2/events/evt-1/sponsors/spon-1/impression')
    ).toBeNull();
  });

  test('POST /api/v2/events/:id/sponsors/:sid/click → null (exempt)', () => {
    expect(guardPublicReadOnly('POST', '/api/v2/events/evt-1/sponsors/spon-1/click')).toBeNull();
  });

  test('POST /subscribe → null (exempt)', () => {
    expect(guardPublicReadOnly('POST', '/subscribe')).toBeNull();
  });

  test('POST /signup → null (exempt)', () => {
    expect(guardPublicReadOnly('POST', '/signup')).toBeNull();
  });

  test('POST /newsletter → null (exempt)', () => {
    expect(guardPublicReadOnly('POST', '/newsletter')).toBeNull();
  });
});

// ── L1: admin + auth routes always pass through ───────────────────────────────

describe('L1: guardPublicReadOnly — admin/auth routes pass through', () => {
  test('POST /api/v2/admin/events → null (admin route, not guarded here)', () => {
    expect(guardPublicReadOnly('POST', '/api/v2/admin/events')).toBeNull();
  });

  test('DELETE /api/v2/admin/sponsors/s1 → null', () => {
    expect(guardPublicReadOnly('DELETE', '/api/v2/admin/sponsors/s1')).toBeNull();
  });

  test('GET /auth/login → null', () => {
    expect(guardPublicReadOnly('GET', '/auth/login')).toBeNull();
  });
});

// ── L1: OPTIONS always passes through ────────────────────────────────────────

describe('L1: guardPublicReadOnly — OPTIONS passes (CORS)', () => {
  test('OPTIONS /api/v2/events → null', () => {
    expect(guardPublicReadOnly('OPTIONS', '/api/v2/events')).toBeNull();
  });
});

// ── L1: non-API paths not affected ───────────────────────────────────────────

describe('L1: guardPublicReadOnly — non-API paths not affected', () => {
  test('POST /admin → null (page route, not guarded)', () => {
    expect(guardPublicReadOnly('POST', '/admin')).toBeNull();
  });

  test('DELETE /health → null (not a public API path)', () => {
    expect(guardPublicReadOnly('DELETE', '/health')).toBeNull();
  });
});

// ── L2: integration — router enforces guard ───────────────────────────────────

describe('L2: router — public read-only guard is wired', () => {
  test('PUT /api/v2/events → 405 from router', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events', { method: 'PUT' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
  });

  test('DELETE /api/v2/events/any-id → 405 from router', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/some-event', { method: 'DELETE' });
    expect(res.status).toBe(405);
  });

  test('POST /api/v2/events/any-id/sponsors/any-id/impression → NOT 405 (exempt)', async () => {
    const res = await SELF.fetch(
      'http://localhost/api/v2/events/evt-1/sponsors/spon-1/impression',
      { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }
    );
    // Should not be 405 — impression POST is exempt
    expect(res.status).not.toBe(405);
  });

  test('GET /api/v2/events → NOT 405', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events');
    expect(res.status).not.toBe(405);
  });
});
