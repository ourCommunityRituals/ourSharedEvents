/**
 * OSE-312 — Shorturl /s/:code resolver contract spec.
 *
 * @contract-flow-no-ui
 *   This flow spec validates a non-rendering surface (302 redirector +
 *   JSON 404). The OSE-307 helper at _helpers/mobile-workability-
 *   assertions is intentionally NOT imported — there's no DOM to
 *   measure. The OSE-307 regression guard at tests/unit/flow-tests-
 *   helper-wired.test.ts honors this marker as an exemption.
 *
 * The shortlink resolver at `/s/:code` is a 302 redirector, not a
 * rendered HTML surface. There's no "screen" to test for mobile
 * workability — the resolver looks up the code, increments an
 * anonymous click counter, and 302-redirects to /events/:id where
 * `flow-events-discovery.spec.ts` already covers the resulting
 * mobile experience.
 *
 * What this spec DOES validate (failure modes the per-surface audit
 * + the events-discovery flow don't reach):
 *
 *   1. Malformed code (wrong length / non-base62) → 404 JSON
 *   2. Well-formed but unknown code → 404 JSON
 *   3. Information-leak guard: both 404s return IDENTICAL body shape
 *      (security: probing must not differentiate malformed from
 *      unknown — see shortlink-resolve.ts security comment)
 *   4. 404 Content-Type is application/json (machine-readable, not
 *      HTML — the resolver is API-shaped on failure)
 *   5. Mobile-customer recovery path: when a recipient pastes a
 *      broken /s/ link into their phone browser, the 404 JSON IS
 *      what they see; the OSE-R-004 HTML error page is NOT served
 *      for the /s/ surface (different design choice than /events/:id)
 *
 * Code shape (from src/lib/shortlinks.ts):
 *   - CODE_LEN = 6
 *   - BASE62_ALPHABET = [0-9a-zA-Z]
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-312 | FE | flow shortlink-resolver | <assertion>`.
 *
 * NOTE: the happy path (302 → /events/:id) is NOT tested here because
 * it requires a known seeded shortlink on staging — that's a separate
 * fixture-seeding concern. The 302 → render chain is exercised by
 * flow-events-discovery.spec.ts directly on /events/:id.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

// Malformed: 8 chars > CODE_LEN of 6.
const MALFORMED_CODE = 'abc12345';
// Well-formed shape (6 base62 chars), but unknown to the DB.
const UNKNOWN_CODE = 'zzz999';
// Another malformed: contains non-base62 char ('!').
const NONBASE62_CODE = 'a!b2c3';

async function fetchShortlink(code: string): Promise<{
  status: number;
  contentType: string;
  body: string;
}> {
  // maxRedirects: 0 — never follow the 302 success path. We only
  // assert the resolver's RESPONSE shape; the downstream redirect
  // target is verified by other specs.
  const res = await fetch(`${BASE_URL}/s/${code}`, { redirect: 'manual' });
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body: await res.text(),
  };
}

test.describe('OSE-312 shortlink resolver — 404 contract + information-leak guard', () => {
  test('OSE-312 | FE | flow shortlink-resolver | malformed code (wrong length) → 404 JSON', async () => {
    const { status, contentType, body } = await fetchShortlink(MALFORMED_CODE);
    expect(status).toBe(404);
    expect(contentType).toContain('application/json');
    const parsed = JSON.parse(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('NOT_FOUND');
    expect(typeof parsed.error).toBe('string');
  });

  test('OSE-312 | FE | flow shortlink-resolver | malformed code (non-base62 char) → 404 JSON', async () => {
    const { status, contentType, body } = await fetchShortlink(NONBASE62_CODE);
    expect(status).toBe(404);
    expect(contentType).toContain('application/json');
    const parsed = JSON.parse(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('NOT_FOUND');
  });

  test('OSE-312 | FE | flow shortlink-resolver | well-formed but unknown code → 404 JSON', async () => {
    const { status, contentType, body } = await fetchShortlink(UNKNOWN_CODE);
    expect(status).toBe(404);
    expect(contentType).toContain('application/json');
    const parsed = JSON.parse(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('NOT_FOUND');
  });

  test('OSE-312 | FE | flow shortlink-resolver | information-leak guard — malformed + unknown return IDENTICAL body', async () => {
    // Security contract from src/handlers/shortlink-resolve.ts:
    //   "Same 404 shape for unknown vs malformed so probing reveals
    //    nothing."
    // If a future change differentiates these (e.g., adds a hint
    // like "code length wrong" vs "code unknown"), a probing
    // attacker can map the namespace. This test forbids that
    // differentiation at the response-body level.
    const malformed = await fetchShortlink(MALFORMED_CODE);
    const unknown = await fetchShortlink(UNKNOWN_CODE);
    expect(malformed.status).toBe(unknown.status);
    expect(malformed.body).toBe(unknown.body);
  });

  test('OSE-312 | FE | flow shortlink-resolver | mobile-customer recovery path — 404 body is small JSON, no HTML', async () => {
    // When a recipient pastes a broken /s/ link into their phone,
    // they see this 404 JSON (not the OSE-R-004 branded HTML error
    // page used by /events/:id). That's a deliberate design choice:
    // /s/ is an API-shaped surface for crawlers + redirects; humans
    // typically arrive via the 302 success path. If this contract
    // ever changes to serve HTML, update this test + the resolver
    // comment together.
    const { contentType, body } = await fetchShortlink(MALFORMED_CODE);
    expect(contentType, '/s/ 404 must NOT serve text/html').not.toContain('text/html');
    // Body should be a small JSON object, not a multi-kilobyte HTML
    // page. Anything > 500 bytes suggests an HTML page snuck in.
    expect(body.length).toBeLessThan(500);
    expect(body).toMatch(/^\s*\{/); // starts with JSON object opener
  });
});
