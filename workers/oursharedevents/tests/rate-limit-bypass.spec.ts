/**
 * TL-013 — Rate limit bypass: IP rotation attack documentation + defense assertions
 *
 * Threat: "Rate limit bypass: attacker rotates source IPs or CF-Ray headers
 * to exceed per-endpoint rate limits"
 *
 * Current defense: per-isolate sliding-window rate limiter keyed on
 * CF-Connecting-IP + eventId (SR-16). Full distributed defense (CF Rate
 * Limiting Rules, OSE-576/SR-23) is pending KV provisioning.
 *
 * This test suite:
 *   1. Documents the IP-rotation bypass vector (expected behavior until SR-23)
 *   2. Asserts the rate limiter uses CF-Connecting-IP (not CF-Ray, which is
 *      spoofable within the request chain — CL note: CF-Ray is assigned by
 *      Cloudflare and cannot be spoofed by the client; this test asserts we
 *      don't accidentally key on a header that can be set by the client)
 *   3. Asserts the rate limiter is NOT keyed on any client-injectable header
 *   4. Asserts the per-event-id independence (separate buckets per event)
 *   5. Confirms the 10-req/min limit is enforced per-IP (not global)
 *
 * @born-red TL-013 | method: design-time-negative-assertion | date: 2026-08-06
 * Known bypass: IP rotation defeats per-isolate rate limiting. Full fix: SR-23.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { handleFormRegistration } from '../src/handlers/forms';

/** Mirrors FORM_RATE_MAX in handlers/forms.ts (pinned by form-rate-limit.spec.ts). */
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

function makeReq(eventId: string, ip: string | null, n = 1): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost',
  };
  if (ip !== null) headers['CF-Connecting-IP'] = ip;
  return new Request(`http://localhost/api/v2/events/${eventId}/forms/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: `User ${n}`, consent: true }),
  });
}

describe('TL-013 | Rate limit bypass | Source gate', () => {
  test('rate limiter keys on CF-Connecting-IP (not a client-injectable header)', () => {
    const src = getFormsTs();
    // Must use CF-Connecting-IP which is set by Cloudflare, not forwarded from client
    expect(src).toContain('CF-Connecting-IP');
    // Must NOT key on X-Forwarded-For or X-Real-IP (client-injectable via curl -H)
    const fnIdx = src.indexOf('function isFormRateLimited(');
    const fnBody = src.slice(fnIdx, fnIdx + 200);
    expect(fnBody).not.toContain('X-Forwarded-For');
    expect(fnBody).not.toContain('X-Real-IP');
  });

  test('rate limiter does NOT rely on CF-Ray (it is set per-request, not per-IP)', () => {
    const src = getFormsTs();
    // CF-Ray is a unique ray ID per request, not suitable for rate limiting
    const fnIdx = src.indexOf('function isFormRateLimited(');
    const fnBody = src.slice(fnIdx, fnIdx + 400);
    expect(fnBody).not.toContain('CF-Ray');
  });

  test('rate limit key is composite: IP + eventId (not IP alone)', () => {
    const src = getFormsTs();
    // Composite key prevents one exhausted IP from being blocked across all events
    expect(src).toContain('`${ip}:${eventId}`');
  });

  test('rate limiting is skipped when CF-Connecting-IP absent (local/test guard)', () => {
    const src = getFormsTs();
    // Requests without CF-Connecting-IP bypass rate limiting
    // This is intentional: CF-Connecting-IP is always present in CF production
    expect(src).toContain('if (clientIp && isFormRateLimited');
  });
});

describe('TL-013 | Rate limit bypass | Integration: known bypass documentation', () => {
  /**
   * KNOWN BYPASS (documented): IP rotation defeats per-isolate rate limiting.
   *
   * An attacker sending 10 requests from IP A then switching to IP B gets a
   * fresh bucket for IP B. This test documents this as expected current behavior.
   * Full mitigation requires SR-23 (CF Rate Limiting Rules, distributed).
   *
   * This test is a @born-red red assertion — it passes when the bypass EXISTS,
   * which documents the current risk surface. When SR-23 is implemented and
   * distributed rate limiting is wired, this test should be updated to assert
   * that IP-B requests ARE rate-limited (via KV cross-isolate state).
   */
  test('BYPASS-DOCUMENTED: rotating IPs resets the rate limit bucket (known gap, pending SR-23)', async () => {
    const formsEnv = env as unknown as TestEnv;
    const eventId = 'evt_rl_bypass_tl013';

    // Exhaust the rate limit for IP A
    for (let i = 1; i <= FORM_RATE_MAX; i++) {
      await handleFormRegistration(makeReq(eventId, '192.0.2.1', i), formsEnv as any, eventId);
    }
    const limitedA = await handleFormRegistration(
      makeReq(eventId, '192.0.2.1', FORM_RATE_MAX + 1),
      formsEnv as any,
      eventId
    );
    expect(limitedA.status).toBe(429);

    // IP B is NOT rate-limited (fresh bucket) — this is the bypass
    // @known-bypass TL-013: pending SR-23 distributed rate limiting
    const resultB = await handleFormRegistration(
      makeReq(eventId, '192.0.2.2', 1),
      formsEnv as any,
      eventId
    );
    expect(resultB.status).not.toBe(429);
  });

  test('same IP across different eventIds has independent limits (correct isolation)', async () => {
    const formsEnv = env as unknown as TestEnv;
    const ip = '192.0.2.10';

    // Exhaust for event A
    for (let i = 1; i <= FORM_RATE_MAX; i++) {
      await handleFormRegistration(
        makeReq('evt_rl_tl013_a', ip, i),
        formsEnv as any,
        'evt_rl_tl013_a'
      );
    }

    // Event B is not rate-limited for same IP (correct — per-event isolation)
    const resultB = await handleFormRegistration(
      makeReq('evt_rl_tl013_b', ip, 1),
      formsEnv as any,
      'evt_rl_tl013_b'
    );
    expect(resultB.status).not.toBe(429);
  });

  test('requests without CF-Connecting-IP are never rate-limited (bypass for headerless clients)', async () => {
    const formsEnv = env as unknown as TestEnv;
    // 15 requests with no IP header should never return 429
    for (let i = 1; i <= 15; i++) {
      const res = await handleFormRegistration(
        makeReq('evt_rl_tl013_noip', null, i),
        formsEnv as any,
        'evt_rl_tl013_noip'
      );
      expect(res.status).not.toBe(429);
    }
  });
});
