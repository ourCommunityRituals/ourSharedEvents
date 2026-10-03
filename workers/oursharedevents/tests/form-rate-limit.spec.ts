/**
 * SR-16 — Rate limiting on form endpoints gate
 *
 * Source-level gates asserting that forms.ts implements per-IP per-eventId
 * sliding-window rate limiting on PII-collecting form handlers:
 *
 *   1. isFormRateLimited function defined with ip + eventId composite key
 *   2. FORM_RATE_MAX = 360 (6 a second: OSE-1509, ~5/s from one person is never refused)
 *   3. FORM_RATE_WINDOW_MS = 60_000 (1-minute window)
 *   4. 429 status + Retry-After: 60 on rate limit hit
 *   5. registration + email-signup handlers check the rate limit (PII handlers)
 *   6. checkin + survey handlers are exempt (TL-026: anonymous handlers cannot read IP)
 *   7. Rate limiting is skipped when CF-Connecting-IP header is absent (local/test)
 *   8. Different eventIds have independent limits (composite key)
 *
 * Integration gate: direct handler invocation confirms 429 after FORM_RATE_MAX (360) requests.
 */

import { SELF, env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import {
  handleFormRegistration,
  handleFormCheckin,
  handleFormSurvey,
  handleFormEmailSignup,
} from '../src/handlers/forms';
import { RATE_LIMIT_FORM_MAX } from '../src/lib/rate-limit';
import { FORM_EDGE_MAX, EDGE_WINDOW_SECONDS } from '../src/lib/edge-rate-limit';

/** Mirrors FORM_RATE_MAX in handlers/forms.ts (pinned by the source gate below). */
const FORM_RATE_MAX = 360;

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

  test('FORM_RATE_MAX is 360', () => {
    const src = getFormsTs();
    expect(src).toContain('FORM_RATE_MAX = 360');
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
  test('registration handler returns 429 after FORM_RATE_MAX requests from same IP+eventId', async () => {
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

    // The first FORM_RATE_MAX are not rate-limited (may fail DB — that's OK; only care about non-429 status)
    for (let i = 1; i <= FORM_RATE_MAX; i++) {
      const res = await handleFormRegistration(makeReq(i), formsEnv as any, eventId);
      expect(res.status).not.toBe(429);
    }

    // The next one must be rate-limited
    const limited = await handleFormRegistration(makeReq(FORM_RATE_MAX + 1), formsEnv as any, eventId);
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
    for (let i = 1; i <= FORM_RATE_MAX; i++) {
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

// TL-057: the handler exemption above is not the whole picture. The router puts
// every public form POST, check-in and survey included, behind two route-level
// limits (src/router.ts, formRouteLimit; OSE-1509): the edge layer
// (FORM_EDGE_LIMITER, 60 per 10 s per IP per event) refuses a flood within its
// first fraction of a second, and the KV count (RATE_LIMIT_FORM_MAX = 360/min
// per IP across events; the KV key is an HMAC/SHA-256 of the IP, never the IP)
// catches a caller who stays under it. These tests pin both, so a router change
// that drops either turns red.
describe('TL-057 | route-level limit covers the anonymous form handlers', () => {
  const post = (formType: string, eventId: string, ip: string) =>
    SELF.fetch(`http://localhost/api/v2/events/${eventId}/forms/${formType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: 'http://localhost' },
      body: JSON.stringify({}),
    });

  for (const formType of ['checkin', 'survey'] as const) {
    test(`POST /forms/${formType}: a burst on one event is refused after ${FORM_EDGE_MAX}, retry in ${EDGE_WINDOW_SECONDS} s`, async () => {
      const ip = formType === 'checkin' ? '10.57.0.1' : '10.57.0.2';
      for (let i = 0; i < FORM_EDGE_MAX; i++) {
        const res = await post(formType, `evt_tl057_${formType}`, ip);
        expect(res.status).not.toBe(429);
        await res.body?.cancel();
      }
      // The binding counts in fixed 10 s windows, so a burst that straddles a
      // window edge is counted afresh once; it is refused by 2x the limit.
      let limited = await post(formType, `evt_tl057_${formType}`, ip);
      for (let i = 0; limited.status !== 429 && i < FORM_EDGE_MAX; i++) {
        await limited.body?.cancel();
        limited = await post(formType, `evt_tl057_${formType}`, ip);
      }
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toBe(String(EDGE_WINDOW_SECONDS));
      expect(limited.headers.get('X-RateLimit-Limit')).toBe(String(FORM_EDGE_MAX));
      await limited.body?.cancel();
    });
  }

  test(`the per-IP KV count refuses a caller spread across events after ${RATE_LIMIT_FORM_MAX}`, async () => {
    const ip = '10.57.0.3';
    // One event per request, so the per-event edge layer never trips.
    for (let i = 0; i < RATE_LIMIT_FORM_MAX; i++) {
      const res = await post('checkin', `evt_tl057_spread_${i}`, ip);
      expect(res.status).not.toBe(429);
      await res.body?.cancel();
    }
    const limited = await post('checkin', 'evt_tl057_spread_last', ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('X-RateLimit-Limit')).toBe(String(RATE_LIMIT_FORM_MAX));
    await limited.body?.cancel();
  });
});
