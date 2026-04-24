/**
 * OSE-200 / BE-13 — R2 file upload handler tests
 *
 * L1: static shape (exports)
 * L2: integration via SELF.fetch (miniflare R2)
 *   - POST /api/v2/admin/events/:id/uploads  — admin auth required
 *   - GET  /api/v2/uploads/*key              — public read
 */

import { SELF } from 'cloudflare:test';
import { describe, it, expect, test } from 'vitest';
import { handleAdminUploadFile, handleGetUploadedFile } from '../src/handlers/upload';
import type { UploadEnv } from '../src/handlers/upload';

const ADMIN_KEY = 'test-admin-key-e2e-2026';

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${ADMIN_KEY}` };
}

// Satisfy the TypeScript import of the type without a runtime assertion.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeCheck: UploadEnv = {};

// ── L1: Static shape ──────────────────────────────────────────────────────────

describe('upload — L1 static', () => {
  it('exports handleAdminUploadFile as a function', () => {
    expect(typeof handleAdminUploadFile).toBe('function');
  });

  it('exports handleGetUploadedFile as a function', () => {
    expect(typeof handleGetUploadedFile).toBe('function');
  });
});

// ── L2: POST /api/v2/admin/events/:id/uploads ─────────────────────────────────

describe('POST /api/v2/admin/events/:id/uploads', () => {
  test('no auth → 401', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['data'], { type: 'image/jpeg' }), 'photo.jpg');
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/test-evt/uploads', {
      method: 'POST',
      body: formData,
    });
    expect(res.status).toBe(401);
  });

  test('non-multipart content-type → 400 BAD_CONTENT_TYPE', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/test-evt/uploads', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('BAD_CONTENT_TYPE');
  });

  test('valid JPEG upload → 201 with key and url', async () => {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(100).fill(0xff)], { type: 'image/jpeg' }),
      'test-photo.jpg'
    );
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/upload-test-evt/uploads', {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const file = body.file as Record<string, unknown>;
    expect(typeof file.key).toBe('string');
    expect((file.key as string).startsWith('events/upload-test-evt/')).toBe(true);
    expect((file.url as string).startsWith('/api/v2/uploads/events/upload-test-evt/')).toBe(true);
    expect(file.contentType).toBe('image/jpeg');
  });

  test('missing file field → 400 MISSING_FILE', async () => {
    const formData = new FormData();
    formData.append('other', 'value');
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/test-evt/uploads', {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('MISSING_FILE');
  });

  test('unsupported MIME type (text/plain) → 415 UNSUPPORTED_FILE_TYPE', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['hello'], { type: 'text/plain' }), 'readme.txt');
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/test-evt/uploads', {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });
});

// ── L2: GET /api/v2/uploads/*key ─────────────────────────────────────────────

describe('GET /api/v2/uploads/*key', () => {
  test('key without events/ prefix → 400 BAD_INPUT', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/uploads/no-prefix/file.jpg');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('BAD_INPUT');
  });

  test('valid key not in R2 → 404 NOT_FOUND', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/uploads/events/nonexistent/photo.jpg');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('NOT_FOUND');
  });

  test('upload then GET returns file with correct content-type and cache headers', async () => {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      'banner.png'
    );
    const uploadRes = await SELF.fetch('https://t.test/api/v2/admin/events/roundtrip-evt/uploads', {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as Record<string, unknown>;
    const fileUrl = (uploadBody.file as Record<string, unknown>).url as string;

    const getRes = await SELF.fetch(`https://t.test${fileUrl}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    expect(getRes.headers.get('Cache-Control')).toContain('immutable');
  });
});
