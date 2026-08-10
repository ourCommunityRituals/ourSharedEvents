/**
 * SR-16 — Rate limiting on form endpoints gate
 *
 * Source-level gates asserting that forms.ts implements per-IP per-eventId
 * sliding-window rate limiting on PII-collecting form handlers:
 *
 *   1. isFormRateLimited function defined with ip + eventId composite key
 *   2. FORM_RATE_MAX = 10 (10 submissions per minute)
 *   3. FORM_RATE_WINDOW_MS = 60_000 (1-minute window)
 *   4. 429 status + Retry-After: 60 on rate limit hit
 *   5. registration + email-signup handlers check the rate limit (PII handlers)
 *   6. checkin + survey handlers are exempt (TL-026: anonymous handlers cannot read IP)
 *   7. Rate limiting is skipped when CF-Connecting-IP header is absent (local/test)
 *   8. Different eventIds have independent limits (composite key)
 *
 * Integration gate: direct handler invocation confirms 429 after 10 requests.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import {
  handleFormRegistration,
  handleFormCheckin,
  handleFormSurvey,
  handleFormEmailSignup,
} from '../src/handlers/forms';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
  FORMS_DB: D1Database;
}

function getFormsTs(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('handlers/forms.ts')
  );
  if (!entry) throw new Error('handlers/forms.ts not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}

function makeRequest(body: Record<string, unknown> = {}, ip = '1.2.3.4'): Request {
  return new Request('http://localhost/api/v2/events/evt_rl_test/forms/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      Origin: 'http://localhost',
    },
    body: JSON.stringify(body),
  });
}

describe('SR-16 | Rate limiting | Source gate', () => {
  test('isFormRateLimited is defined with ip and eventId params', () => {
    const src = getFormsTs();
    expect(src).toContain('function isFormRateLimited(ip');
    expect(src).toContain('eventId');
  });

  test('composite key uses ip:eventId format', () => {
    const src = getFormsTs();
    expect(src).toContain('`${ip}:${eventId}`');
  });

  test('FORM_RATE_MAX is 10', () => {
    const src = getFormsTs();
    expect(src).toContain('FORM_RATE_MAX = 10');
  });

  test('FORM_RATE_WINDOW_MS is 60000 (1 minute)', () => {
    const src = getFormsTs();
    // Allow either literal or underscore-separated form
    expect(src).toMatch(/FORM_RATE_WINDOW_MS\s*=\s*60[_]?000/);
  });

  test('formRateLimitedResponse emits status 429', () => {
    const src = getFormsTs();
    expect(src).toContain('formRateLimitedResponse');
    expect(src).toContain('status: 429');
  });

  test('formRateLimitedResponse emits Retry-After: 60', () => {
    const src = getFormsTs();
    expect(src).toContain("'Retry-After': '60'");
  });

  test('handleFormRegistration (PII handler) checks rate limit before processing', () => {
    const src = getFormsTs();
    const fnIdx = src.indexOf('export async function handleFormRegistration(');
    const fnBody = src.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toContain('isFormRateLimited');
    expect(fnBody).toContain('formRateLimitedResponse');
  });

  test('handleFormEmailSignup (PII handler) checks rate limit before processing', () => {
    const src = getFormsTs();
    const fnIdx = src.indexOf('export async function handleFormEmailSignup(');
    const fnBody = src.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toContain('isFormRateLimited');
    expect(fnBody).toContain('formRateLimitedResponse');
  });

  test('handleFormCheckin (anonymous handler) is exempt from IP-based rate limiting (TL-026)', () => {
    const src = getFormsTs();
    const fnIdx = src.indexOf('export async function handleFormCheckin(');
    const fnBody = src.slice(fnIdx, fnIdx + 500);
    // TL-026: anonymous handlers must not read CF-Connecting-IP
    expect(fnBody).not.toContain('CF-Connecting-IP');
    expect(fnBody).not.toContain('isFormRateLimited');
  });

  test('handleFormSurvey (anonymous handler) is exempt from IP-based rate limiting (TL-026)', () => {
    const src = getFormsTs();
    const fnIdx = src.indexOf('export async function handleFormSurvey(');
    const fnBody = src.slice(fnIdx, fnIdx + 500);
    // TL-026: anonymous handlers must not read CF-Connecting-IP
    expect(fnBody).not.toContain('CF-Connecting-IP');
    expect(fnBody).not.toContain('isFormRateLimited');
  });

  test('rate limiting is skipped when CF-Connecting-IP is absent (null check guards)', () => {
    const src = getFormsTs();
    // Both PII handlers must check clientIp is truthy before calling isFormRateLimited
    expect(src).toContain('if (clientIp && isFormRateLimited');
  });
});

describe('SR-16 | Rate limiting | Integration gate', () => {
  test('registration handler returns 429 after 10 requests from same IP+eventId', async () => {
    const formsEnv = env as unknown as TestEnv;
    // Use a unique IP to avoid cross-test pollution from other test runs
    const ip = '10.0.0.1';
    const eventId = 'evt_rl_integ';

    const makeReq = (n: number) =>
      new Request(`http://localhost/api/v2/events/${eventId}/forms/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': ip,
          Origin: 'http://localhost',
        },
        body: JSON.stringify({ name: `User ${n}`, consent: true }),
      });

    // First 10 should not be rate-limited (may fail DB — that's OK; only care about non-429 status)
    for (let i = 1; i <= 10; i++) {
      const res = await handleFormRegistration(makeReq(i), formsEnv as any, eventId);
      expect(res.status).not.toBe(429);
    }

    // 11th request must be rate-limited
    const limited = await handleFormRegistration(makeReq(11), formsEnv as any, eventId);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    const body = await limited.json() as Record<string, unknown>;
    expect(body.code).toBe('RATE_LIMITED');
  });

  test('different eventIds have independent rate limits', async () => {
    const formsEnv = env as unknown as TestEnv;
    // Use unique IP to avoid cross-test pollution
    const ip = '10.0.0.20';

    // Exhaust rate limit for eventId A (registration is rate-limited)
    for (let i = 1; i <= 10; i++) {
      await handleFormRegistration(
        new Request('http://localhost/api/v2/events/evt_rl_a2/forms/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: 'http://localhost' },
          body: JSON.stringify({ name: `User ${i}`, consent: true }),
        }),
        formsEnv as any,
        'evt_rl_a2'
      );
    }

    // eventId B should NOT be rate-limited for the same IP (independent bucket)
    const resB = await handleFormRegistration(
      new Request('http://localhost/api/v2/events/evt_rl_b2/forms/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: 'http://localhost' },
        body: JSON.stringify({ name: 'User 1', consent: true }),
      }),
      formsEnv as any,
      'evt_rl_b2'
    );
    expect(resB.status).not.toBe(429);
  });

  test('rate limiting is skipped when CF-Connecting-IP header is absent', async () => {
    const formsEnv = env as unknown as TestEnv;
    // No CF-Connecting-IP header — should not be rate-limited regardless of request count
    const makeReq = (n: number) =>
      new Request('http://localhost/api/v2/events/evt_rl_noip/forms/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({ name: `User ${n}`, consent: true }),
      });

    // Even 15 requests should not trigger 429 when IP is absent
    for (let i = 1; i <= 15; i++) {
      const res = await handleFormRegistration(makeReq(i), formsEnv as any, 'evt_rl_noip');
      expect(res.status).not.toBe(429);
    }
  });
});
