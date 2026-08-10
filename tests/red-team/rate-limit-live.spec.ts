/**
 * RED TEAM — Rate Limit Live Tests
 *
 * Hits real staging endpoints past the configured threshold and verifies
 * Cloudflare's rate-limit response is correct. These tests make real
 * network calls — they are intentionally slow and should NOT run on
 * every push. Wire them to a nightly or pre-release CI gate.
 *
 * Environment variables:
 *   BASE_URL        — override target (default: https://stg.oursharedevents.com)
 *   ADMIN_KEY       — valid Bearer token (used for authenticated endpoints)
 *   X_OCR_INTERNAL  — internal auth secret
 *
 * Test IDs:
 *   RL-001  /api/v2/events — 61 sequential GETs → 61st returns 429
 *   RL-002  /api/v2/events/:id/forms/email-signup — 61 POSTs → 429
 *   RL-003  Retry-After header value is present and numeric
 *   RL-004  X-RateLimit-Limit header reflects the configured window
 *
 * Rate limit assumption: 60 requests per window on Cloudflare's staging
 * rule. Adjust RATE_LIMIT_THRESHOLD if the CF rule changes.
 */

import { test, expect, type APIResponse } from '@playwright/test';

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, '') ?? 'https://stg.oursharedevents.com';

const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';

/**
 * The number of requests allowed within the rate-limit window.
 * The (N+1)th request should receive 429.
 */
const RATE_LIMIT_THRESHOLD = 60;

/**
 * A real event ID that exists on staging. The test tries to use
 * SMOKE_EVENT_ID from the environment (same fixture used by smoke tests),
 * and falls back to a placeholder that will 404 — which is still
 * sufficient to trigger the rate limit on the path pattern itself.
 */
const FIXTURE_EVENT_ID = process.env.SMOKE_EVENT_ID ?? 'evt_fixture_001';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adminHeaders(): Record<string, string> {
  if (X_OCR_INTERNAL) return { 'X-OCR-Internal': X_OCR_INTERNAL };
  if (ADMIN_KEY) return { Authorization: `Bearer ${ADMIN_KEY}` };
  return {};
}

interface HitResult {
  statuses: number[];
  firstRateLimitIndex: number | null;
  retryAfterOnFirst429: string | null;
  xRateLimitLimitOnFirst429: string | null;
}

/**
 * Hit an endpoint N+1 times sequentially and return a structured summary.
 * Sequential (not concurrent) so Cloudflare's per-IP counter increments
 * cleanly and we can pinpoint exactly which request number triggers the 429.
 */
async function hammmerEndpoint(
  fetcher: (n: number) => Promise<APIResponse>,
  total: number,
): Promise<HitResult> {
  const statuses: number[] = [];
  let firstRateLimitIndex: number | null = null;
  let retryAfterOnFirst429: string | null = null;
  let xRateLimitLimitOnFirst429: string | null = null;

  for (let i = 0; i < total; i++) {
    const response = await fetcher(i);
    const status = response.status();
    statuses.push(status);

    if (status === 429 && firstRateLimitIndex === null) {
      firstRateLimitIndex = i;
      retryAfterOnFirst429 = response.headers()['retry-after'] ?? null;
      xRateLimitLimitOnFirst429 = response.headers()['x-ratelimit-limit'] ?? null;

      // We have what we need — no need to keep hammering after the first 429
      break;
    }
  }

  return {
    statuses,
    firstRateLimitIndex,
    retryAfterOnFirst429,
    xRateLimitLimitOnFirst429,
  };
}

// ─── RL-001 — /api/v2/events rate limit ──────────────────────────────────────

test.describe('RL-001 — GET /api/v2/events rate limit', () => {
  /**
   * This test is slow by design (61 sequential HTTP calls).
   * Increase the test timeout to 3 minutes.
   */
  test.setTimeout(180_000);

  test('61st request to /api/v2/events returns 429', async ({ request }) => {
    const TOTAL = RATE_LIMIT_THRESHOLD + 1;
    const endpoint = `${BASE_URL}/api/v2/events`;

    const result = await hammmerEndpoint(
      () => request.get(endpoint),
      TOTAL,
    );

    expect(
      result.firstRateLimitIndex,
      `Expected 429 by request #${TOTAL} on /api/v2/events. ` +
        `Statuses received: ${result.statuses.join(', ')}`,
    ).not.toBeNull();

    expect(
      result.firstRateLimitIndex,
      `Rate limit triggered too early at request #${result.firstRateLimitIndex! + 1} ` +
        `(expected at or after #${RATE_LIMIT_THRESHOLD + 1})`,
    ).toBeGreaterThanOrEqual(RATE_LIMIT_THRESHOLD);

    console.log(
      `[RL-001] 429 triggered at request #${(result.firstRateLimitIndex ?? 0) + 1} of ${TOTAL}`,
    );
  });
});

// ─── RL-002 — /api/v2/events/:id/forms/email-signup rate limit ───────────────

test.describe('RL-002 — POST email-signup form rate limit', () => {
  test.setTimeout(180_000);

  test('61st POST to email-signup form returns 429', async ({ request }) => {
    const TOTAL = RATE_LIMIT_THRESHOLD + 1;
    const endpoint = `${BASE_URL}/api/v2/events/${FIXTURE_EVENT_ID}/forms/email-signup`;

    const result = await hammmerEndpoint(
      (i) =>
        request.post(endpoint, {
          data: {
            email: `redteam+${i}@example.com`,
            name: `Red Team ${i}`,
          },
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      TOTAL,
    );

    expect(
      result.firstRateLimitIndex,
      `Expected 429 by request #${TOTAL} on email-signup. ` +
        `Statuses received: ${result.statuses.join(', ')}`,
    ).not.toBeNull();

    expect(
      result.firstRateLimitIndex,
      `Rate limit triggered too early at request #${result.firstRateLimitIndex! + 1}`,
    ).toBeGreaterThanOrEqual(RATE_LIMIT_THRESHOLD);

    console.log(
      `[RL-002] 429 triggered at request #${(result.firstRateLimitIndex ?? 0) + 1} of ${TOTAL}`,
    );
  });
});

// ─── RL-003 — Retry-After header ─────────────────────────────────────────────

test.describe('RL-003 — Retry-After header on 429 response', () => {
  test.setTimeout(180_000);

  test('429 response includes Retry-After header with a positive numeric value', async ({
    request,
  }) => {
    const endpoint = `${BASE_URL}/api/v2/events`;
    const TOTAL = RATE_LIMIT_THRESHOLD + 1;

    const result = await hammmerEndpoint(() => request.get(endpoint), TOTAL);

    if (result.firstRateLimitIndex === null) {
      test.skip(true, `No 429 received in ${TOTAL} calls — cannot check Retry-After`);
      return;
    }

    expect(
      result.retryAfterOnFirst429,
      'Retry-After header must be present on 429 responses',
    ).not.toBeNull();

    const retrySeconds = parseInt(result.retryAfterOnFirst429 ?? '0', 10);

    expect(
      isNaN(retrySeconds),
      `Retry-After header "${result.retryAfterOnFirst429}" is not numeric`,
    ).toBe(false);

    expect(
      retrySeconds,
      `Retry-After must be a positive number of seconds, got ${retrySeconds}`,
    ).toBeGreaterThan(0);

    // Sanity: the window should be sane (between 1 second and 1 hour)
    expect(
      retrySeconds,
      `Retry-After ${retrySeconds}s exceeds 1-hour maximum — check CF rule config`,
    ).toBeLessThanOrEqual(3_600);

    console.log(`[RL-003] Retry-After: ${retrySeconds}s`);
  });
});

// ─── RL-004 — X-RateLimit-Limit header ───────────────────────────────────────

test.describe('RL-004 — X-RateLimit-Limit header reflects configured window', () => {
  test.setTimeout(180_000);

  test('X-RateLimit-Limit header matches the configured threshold', async ({ request }) => {
    const endpoint = `${BASE_URL}/api/v2/events`;
    const TOTAL = RATE_LIMIT_THRESHOLD + 1;

    const result = await hammmerEndpoint(() => request.get(endpoint), TOTAL);

    if (result.firstRateLimitIndex === null) {
      test.skip(true, `No 429 received in ${TOTAL} calls — cannot check X-RateLimit-Limit`);
      return;
    }

    expect(
      result.xRateLimitLimitOnFirst429,
      'X-RateLimit-Limit header must be present on 429 responses',
    ).not.toBeNull();

    const limit = parseInt(result.xRateLimitLimitOnFirst429 ?? '0', 10);

    expect(
      isNaN(limit),
      `X-RateLimit-Limit "${result.xRateLimitLimitOnFirst429}" is not numeric`,
    ).toBe(false);

    expect(
      limit,
      `X-RateLimit-Limit ${limit} does not match configured threshold ${RATE_LIMIT_THRESHOLD}`,
    ).toBe(RATE_LIMIT_THRESHOLD);

    console.log(`[RL-004] X-RateLimit-Limit: ${limit}`);
  });

  test('Successful responses include X-RateLimit-Remaining header', async ({ request }) => {
    // Make a single clean request (before exhausting the limit) and verify
    // the remaining-count header is present so clients can self-throttle.
    const response = await request.get(`${BASE_URL}/api/v2/events`);

    // Only check if rate limit headers are implemented at all
    const remaining = response.headers()['x-ratelimit-remaining'];
    const limit = response.headers()['x-ratelimit-limit'];

    if (limit !== undefined) {
      // If X-RateLimit-Limit is present, Remaining must also be present
      expect(
        remaining,
        'X-RateLimit-Remaining must accompany X-RateLimit-Limit',
      ).toBeDefined();

      const remainingNum = parseInt(remaining ?? '0', 10);
      expect(
        remainingNum,
        'X-RateLimit-Remaining must be non-negative',
      ).toBeGreaterThanOrEqual(0);
    } else {
      // CF may not send these on non-429 responses — log for observability
      console.log(
        '[RL-004] X-RateLimit-Limit not present on 2xx response ' +
          '(CF may only send on 429). This is acceptable.',
      );
    }
  });
});
