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
 *   RL-001  /api/v2/events — a burst past the public-read limit → 429 within 3 s
 *   RL-002  /api/v2/events/:id/forms/email-signup — a burst past the form limit → 429 within 3 s
 *   RL-003  Retry-After header value is present and numeric
 *   RL-004  X-RateLimit-Limit header reflects the configured window
 *
 * Public reads and form submissions have separate configured limits.
 */

import { test, expect, type APIResponse } from '@playwright/test';

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') ?? 'https://stg.oursharedevents.com';

const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';

/**
 * Requests allowed per 10 s edge window (OSE-1509; workers/oursharedevents/
 * src/lib/edge-rate-limit.ts: PUBLIC_READ_EDGE_MAX, FORM_EDGE_MAX). The PO bar:
 * a flood is refused within 3 s, while one person at ~5 requests a second
 * (50 per window) never is.
 */
const RATE_LIMIT_THRESHOLD = 60;
const PUBLIC_READ_RATE_LIMIT_THRESHOLD = 60;

/** The PO bar: the first 429 must arrive within this long of the burst starting. */
const MAX_SECONDS_TO_FIRST_429 = 3;

/**
 * Requests in flight at once. A sequential loop from a CI runner managed about
 * 4 requests a second, under the 5-a-second bar the limits are sized to let
 * through, so it was not a flood. Waves of 20 are.
 */
const BURST_CONCURRENCY = 20;

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
  /** Seconds from the burst starting to the first 429 arriving. */
  secondsToFirst429: number | null;
  /** Who answered when the burst was NOT limited: first non-2xx/429 response, else the last. */
  answeredBy: string;
  retryAfterOnFirst429: string | null;
  xRateLimitLimitOnFirst429: string | null;
}

/**
 * Send `total` requests as a burst, in waves of BURST_CONCURRENCY, and return a
 * structured summary. Stops after the wave that drew the first 429. Responses
 * are read in request order, so "first" means lowest request number.
 */
async function hammmerEndpoint(
  fetcher: (n: number) => Promise<APIResponse>,
  total: number
): Promise<HitResult> {
  const statuses: number[] = [];
  let firstRateLimitIndex: number | null = null;
  let secondsToFirst429: number | null = null;
  let retryAfterOnFirst429: string | null = null;
  let xRateLimitLimitOnFirst429: string | null = null;
  let answeredBy = '';
  const start = Date.now();

  for (
    let waveStart = 0;
    waveStart < total && firstRateLimitIndex === null;
    waveStart += BURST_CONCURRENCY
  ) {
    const size = Math.min(BURST_CONCURRENCY, total - waveStart);
    const wave = await Promise.all(
      Array.from({ length: size }, async (_, k) => {
        const response = await fetcher(waveStart + k);
        return { response, at: Date.now() };
      })
    );

    for (let k = 0; k < wave.length; k++) {
      const i = waveStart + k;
      const { response, at } = wave[k];
      const status = response.status();
      statuses.push(status);

      // OSE-1509: record which layer answered, so a burst that is never limited
      // can be told apart as Worker (JSON error code, X-RateLimit-* headers) or
      // the Cloudflare edge (cf-mitigated, HTML block page). Kept: the first
      // non-2xx/non-429 response, otherwise the last response of the burst.
      if (status !== 429 && !answeredBy.startsWith('first-error')) {
        const h = response.headers();
        const isError = status >= 300;
        const body = isError ? (await response.text().catch(() => '')).slice(0, 160) : '';
        answeredBy =
          `${isError ? 'first-error' : 'last'} #${i + 1}: status=${status} ` +
          `cf-mitigated=${h['cf-mitigated'] ?? '-'} ` +
          `x-ratelimit-remaining=${h['x-ratelimit-remaining'] ?? '-'} ` +
          `content-type=${h['content-type'] ?? '-'}` +
          (body ? ` body=${JSON.stringify(body.replace(/\s+/g, ' '))}` : '');
      }

      if (status === 429 && firstRateLimitIndex === null) {
        firstRateLimitIndex = i;
        secondsToFirst429 = (at - start) / 1000;
        retryAfterOnFirst429 = response.headers()['retry-after'] ?? null;
        xRateLimitLimitOnFirst429 = response.headers()['x-ratelimit-limit'] ?? null;
      }
    }
  }

  return {
    statuses,
    firstRateLimitIndex,
    secondsToFirst429,
    answeredBy,
    retryAfterOnFirst429,
    xRateLimitLimitOnFirst429,
  };
}

// ─── RL-001 — /api/v2/events rate limit ──────────────────────────────────────

test.describe('RL-001 — GET /api/v2/events rate limit', () => {
  /**
   * A burst of up to 3x the limit; it stops after the first 429.
   */
  test.setTimeout(180_000);

  test('requests past the public-read limit return 429', async ({ request }) => {
    const TOTAL = 3 * PUBLIC_READ_RATE_LIMIT_THRESHOLD;
    const endpoint = `${BASE_URL}/api/v2/events`;

    const result = await hammmerEndpoint(() => request.get(endpoint), TOTAL);

    expect(
      result.firstRateLimitIndex,
      `Expected 429 by request #${TOTAL} on /api/v2/events. ` +
        `Statuses received: ${result.statuses.join(', ')}. Answered by: ${result.answeredBy}`
    ).not.toBeNull();
    expect(
      result.secondsToFirst429,
      `First 429 took ${result.secondsToFirst429}s; the bar is ${MAX_SECONDS_TO_FIRST_429}s`
    ).toBeLessThanOrEqual(MAX_SECONDS_TO_FIRST_429);

    console.log(
      `[RL-001] 429 triggered at request #${(result.firstRateLimitIndex ?? 0) + 1} of ${TOTAL}, ` +
        `${result.secondsToFirst429}s into the burst`
    );
  });
});

// ─── RL-002 — /api/v2/events/:id/forms/email-signup rate limit ───────────────

test.describe('RL-002 — POST email-signup form rate limit', () => {
  test.setTimeout(180_000);

  test('requests past the form limit return 429', async ({ request }) => {
    const TOTAL = 3 * RATE_LIMIT_THRESHOLD;
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
      TOTAL
    );

    expect(
      result.firstRateLimitIndex,
      `Expected 429 by request #${TOTAL} on email-signup. ` +
        `Statuses received: ${result.statuses.join(', ')}. Answered by: ${result.answeredBy}`
    ).not.toBeNull();
    expect(
      result.secondsToFirst429,
      `First 429 took ${result.secondsToFirst429}s; the bar is ${MAX_SECONDS_TO_FIRST_429}s`
    ).toBeLessThanOrEqual(MAX_SECONDS_TO_FIRST_429);

    console.log(
      `[RL-002] 429 triggered at request #${(result.firstRateLimitIndex ?? 0) + 1} of ${TOTAL}, ` +
        `${result.secondsToFirst429}s into the burst`
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
    const TOTAL = 3 * PUBLIC_READ_RATE_LIMIT_THRESHOLD;

    const result = await hammmerEndpoint(() => request.get(endpoint), TOTAL);

    if (result.firstRateLimitIndex === null) {
      test.skip(true, `No 429 received in ${TOTAL} calls — cannot check Retry-After`);
      return;
    }

    expect(
      result.retryAfterOnFirst429,
      'Retry-After header must be present on 429 responses'
    ).not.toBeNull();

    const retrySeconds = parseInt(result.retryAfterOnFirst429 ?? '0', 10);

    expect(
      isNaN(retrySeconds),
      `Retry-After header "${result.retryAfterOnFirst429}" is not numeric`
    ).toBe(false);

    expect(
      retrySeconds,
      `Retry-After must be a positive number of seconds, got ${retrySeconds}`
    ).toBeGreaterThan(0);

    // Sanity: the window should be sane (between 1 second and 1 hour)
    expect(
      retrySeconds,
      `Retry-After ${retrySeconds}s exceeds 1-hour maximum — check CF rule config`
    ).toBeLessThanOrEqual(3_600);

    console.log(`[RL-003] Retry-After: ${retrySeconds}s`);
  });
});

// ─── RL-004 — X-RateLimit-Limit header ───────────────────────────────────────

test.describe('RL-004 — X-RateLimit-Limit header reflects configured window', () => {
  test.setTimeout(180_000);

  test('X-RateLimit-Limit header matches the configured threshold', async ({ request }) => {
    const endpoint = `${BASE_URL}/api/v2/events`;
    const TOTAL = 3 * PUBLIC_READ_RATE_LIMIT_THRESHOLD;

    const result = await hammmerEndpoint(() => request.get(endpoint), TOTAL);

    if (result.firstRateLimitIndex === null) {
      test.skip(true, `No 429 received in ${TOTAL} calls — cannot check X-RateLimit-Limit`);
      return;
    }

    expect(
      result.xRateLimitLimitOnFirst429,
      'X-RateLimit-Limit header must be present on 429 responses'
    ).not.toBeNull();

    const limit = parseInt(result.xRateLimitLimitOnFirst429 ?? '0', 10);

    expect(
      isNaN(limit),
      `X-RateLimit-Limit "${result.xRateLimitLimitOnFirst429}" is not numeric`
    ).toBe(false);

    expect(
      limit,
      `X-RateLimit-Limit ${limit} does not match configured threshold ${PUBLIC_READ_RATE_LIMIT_THRESHOLD}`
    ).toBe(PUBLIC_READ_RATE_LIMIT_THRESHOLD);

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
      expect(remaining, 'X-RateLimit-Remaining must accompany X-RateLimit-Limit').toBeDefined();

      const remainingNum = parseInt(remaining ?? '0', 10);
      expect(remainingNum, 'X-RateLimit-Remaining must be non-negative').toBeGreaterThanOrEqual(0);
    } else {
      // CF may not send these on non-429 responses — log for observability
      console.log(
        '[RL-004] X-RateLimit-Limit not present on 2xx response ' +
          '(CF may only send on 429). This is acceptable.'
      );
    }
  });
});
