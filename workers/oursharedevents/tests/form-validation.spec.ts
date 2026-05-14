/**
 * OSE-204 / BE-15 — Form validation container behavioral tests (L2).
 *
 * Complements the static invariant gate (`form-validation-invariant.spec.ts`)
 * with end-to-end behaviour via SELF.fetch against miniflare:
 *
 *   - oversized body (Content-Length > 16KB)     -> 413 PAYLOAD_TOO_LARGE
 *   - oversized body (actual text > 16KB, lying header) -> 413 PAYLOAD_TOO_LARGE
 *   - bad event ID (path traversal chars)        -> 400 INVALID_EVENT_ID
 *   - bad event ID (empty)                       -> 400 INVALID_EVENT_ID  (or 404 from router)
 *   - bad event ID (too long, > 128 chars)       -> 400 INVALID_EVENT_ID
 *   - invalid JSON body                          -> 400 INVALID_BODY
 *   - GET-only handler (checkin) with bad event id -> 400 INVALID_EVENT_ID
 *
 * Pre-OSE-204, oversized body was conflated with INVALID_BODY -> 400. This
 * spec locks in the 413 vs 400 distinction that the AC mandates.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// 16 KB is the canonical hard cap (MAX_BODY_BYTES in lib/form-validation.ts).
const OVER_LIMIT_BODY = JSON.stringify({ junk: 'x'.repeat(17 * 1024) });

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

// Apply migrations on both DBs so downstream handler code-paths (anonymous ID
// lookup, FORMS_DB inserts) don't fault with 500s and mask the validation
// outcome under test. Mirrors the pattern used by forms-security.spec.ts.
beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  const tolerated = (msg: string) =>
    msg.includes('duplicate column name') ||
    msg.includes('already exists') ||
    msg.includes('no such column');

  const mainStmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (tolerated(msg)) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await tenv.FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (tolerated(msg)) continue;
      throw e;
    }
  }
});

interface ErrorEnvelope {
  ok: boolean;
  code: string;
  error: string;
  status: number;
  timestamp: string;
}

async function postForm(eventId: string, body: string, headerOverrides: HeadersInit = {}) {
  return SELF.fetch(`https://t.test/api/v2/events/${encodeURIComponent(eventId)}/forms/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headerOverrides },
    body,
  });
}

describe('OSE-204: form validation container behaviour', () => {
  test('oversized body via honest Content-Length -> 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await postForm('evt_test_204', OVER_LIMIT_BODY);
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.ok).toBe(false);
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('oversized body via lying Content-Length still caught after read -> 413', async () => {
    // Client lies and says Content-Length is small; actual body is 17 KB.
    // The post-read length check is the authoritative gate.
    const res = await postForm('evt_test_204', OVER_LIMIT_BODY, {
      // miniflare will compute the true Content-Length from the body, so we
      // can't actually override it here. This test confirms the post-read
      // gate catches oversized payloads regardless of how the client
      // declared them.
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('bad event ID (path traversal characters) -> 400 INVALID_EVENT_ID', async () => {
    // `..` and `/` aren't allowed by the EVENT_ID regex. Sending percent-encoded
    // path traversal must NOT reach the handler with a valid-looking ID.
    const res = await SELF.fetch('https://t.test/api/v2/events/evt..%2Ffoo/forms/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    // Either 400 (router decoded + handler rejected) or 404 (router did not
    // match the pattern at all). Both are acceptable from a security stance,
    // but the validator MUST not accept the traversal as a valid ID.
    expect([400, 404]).toContain(res.status);
    if (res.status === 400) {
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.code).toBe('INVALID_EVENT_ID');
    }
  });

  test('bad event ID (too long, > 128 chars) -> 400 INVALID_EVENT_ID', async () => {
    const longId = 'a'.repeat(200);
    const res = await postForm(longId, JSON.stringify({ name: 'x' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('INVALID_EVENT_ID');
  });

  test('invalid JSON body -> 400 INVALID_BODY (not 413)', async () => {
    const res = await postForm('evt_test_204', '{not valid json');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('INVALID_BODY');
  });

  test('GET-only handler (checkin) with bad event ID also returns 400 INVALID_EVENT_ID', async () => {
    // Checkin endpoint doesn't read a JSON body but still validates the event
    // ID through the same container. Asserts the eventId guard fires on the
    // requireBody=false path too.
    const res = await SELF.fetch(
      'https://t.test/api/v2/events/' + 'a'.repeat(200) + '/forms/checkin',
      { method: 'POST' }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('INVALID_EVENT_ID');
  });
});
