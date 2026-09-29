/**
 * OSE-1410 — regression locks for the two CodeQL security findings that sat in
 * live Worker source, unread, while codeql.yml ran with `upload: 'never'`.
 *
 *   1. js/polynomial-redos   — src/handlers/data-subject.ts
 *      The email regex ran BEFORE the 320-char length cap, so an unbounded body
 *      reached a pattern that is quadratic on '!@!.' + '!.'.repeat(n) + '@'
 *      (measured: 20k chars ≈ 85 ms, doubling length ≈ 4× time).
 *   2. js/insecure-randomness — src/lib/anonymous-id.ts
 *      A `Date.now()` + `Math.random()` fallback would mint predictable,
 *      time-ordered anon ids if crypto.randomUUID were ever absent.
 *
 * Pure logic, node project. Both cases were verified red against the pre-fix
 * source before the fix landed.
 */

import { describe, test, expect, afterEach, vi } from 'vitest';
import { handleDataSubjectErase, type DataSubjectEnv } from '../src/handlers/data-subject';
import { generateAnonId } from '../src/lib/anonymous-id';

const eraseRequest = (email: string) =>
  new Request('https://example.test/api/v2/admin/data-subject/erase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

describe('OSE-1410 | data-subject erase: length cap runs before the email regex', () => {
  test('an 80k-char backtracking payload is rejected as INVALID_EMAIL without evaluating the regex', async () => {
    // '!@!.' + '!.'×40000 + '@' — the shape CodeQL reported; the trailing '@'
    // forces the second [^\s@]+ to try every split point.
    const payload = `!@!.${'!.'.repeat(40_000)}@`;
    const started = performance.now();
    const res = await handleDataSubjectErase(eraseRequest(payload), {} as DataSubjectEnv);
    const elapsed = performance.now() - started;

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_EMAIL');
    // Pre-fix this took > 1 s (quadratic); with the cap first it is a length check.
    expect(elapsed).toBeLessThan(150);
  });

  test('a 321-char otherwise well-formed address is still rejected (cap unchanged)', async () => {
    const email = `${'a'.repeat(309)}@example.com`; // 321 chars
    expect(email.length).toBe(321);
    const res = await handleDataSubjectErase(eraseRequest(email), {} as DataSubjectEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_EMAIL');
  });
});

describe('OSE-1410 | generateAnonId never falls back to a predictable id', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('uses crypto.randomUUID: output is anon_ + a v4 UUID', () => {
    expect(generateAnonId()).toMatch(
      /^anon_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  test('without crypto.randomUUID it throws rather than minting a Date.now/Math.random id', () => {
    vi.stubGlobal('crypto', {});
    expect(() => generateAnonId()).toThrow();
  });
});
