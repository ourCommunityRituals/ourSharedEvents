/**
 * OSE-R-004 (+ OSE-R-022) — public-event 4xx/5xx HTML responses must render
 * a branded, navigable error page with friendly copy and a wayfinding CTA.
 *
 * Layer: API (vitest exercises the worker's public-event endpoint via
 * SELF.fetch and inspects the rendered HTML).
 *
 * Per OCR_STANDARD_perStoryTestPyramid: tests share names byte-for-byte with
 * the matching Playwright FE spec at tests/playwright/public-event-error-pages.spec.ts
 * and Postman items in postman/collections/ose-pages.json.
 *
 * Format: `OSE-R-004 | API | <method + path> (<condition>) | <assertion>`.
 *
 * The audit found the public-event handler emitted bare 1996-style HTML for
 * 404 + 503 — no brand, no nav, no CTA, no wayfinding. A bar attendee who
 * followed a shared link to an archived event saw `<h1>Event not found</h1>`
 * and nothing else. This spec locks the contract that every 4xx/5xx HTML
 * path now routes through renderErrorPage() with:
 *   1. OurSharedEvents brand header.
 *   2. A friendly, plain-English title and body.
 *   3. A CTA back to /events.
 *   4. data-testids for the test pyramid.
 *   5. No raw dev strings ("undefined", "no such table", stack traces).
 *   6. Draft-gated 404 byte-identical to plain 404 (timing/content safe).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

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
  // Seed one draft event so the draft-gated 404 branch can run. Status of
  // 'draft' means the public handler MUST 404 (not 403) so probing can't
  // distinguish missing rows from unpublished ones.
  await tenv.DB.prepare(
    "INSERT OR REPLACE INTO events (id, title, status, start_date) VALUES ('evt_r004_draft', 'Secret Draft', 'draft', '2026-06-01T20:00:00Z')"
  )
    .run()
    .catch(() => {
      /* schema may seed automatically — ignore */
    });
});

// Strings that should NEVER appear in user-visible error page HTML. The h1
// "Event not found" alone (no brand, no nav) was the audit finding — the
// new helper replaces it with a friendly title.
const FORBIDDEN_BARE_PHRASES = [
  '<h1>Event not found</h1>',
  '<h1>Service unavailable</h1>',
  '<title>Not found</title>',
  '<title>Service unavailable</title>',
];

// Dev / internal strings that should never reach customers via error pages.
const FORBIDDEN_DEV_STRINGS = [
  'no such table',
  'no such column',
  'undefined',
  'D1_ERROR',
  'stack:',
  'at async',
];

async function fetchEventPage(eventId: string): Promise<Response> {
  return SELF.fetch(`https://test.local/events/${encodeURIComponent(eventId)}`, {
    headers: { Accept: 'text/html' },
  });
}

describe('OSE-R-004 public-event error pages — API layer', () => {
  test('OSE-R-004 | API | GET /events/:id (invalid id format) | 404 with branded HTML body', async () => {
    // An attendee mistypes or follows a malformed share-link. The handler
    // must 404 with the branded shell — not the old bare h1.
    const res = await fetchEventPage('not a valid id!!');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toMatch(/data-testid="error-header"/);
    expect(body).toMatch(/data-testid="error-brand"/);
    expect(body).toMatch(/data-testid="error-title"/);
    expect(body).toMatch(/data-testid="error-body"/);
    expect(body).toMatch(/data-testid="error-cta"/);
  });

  test('OSE-R-004 | API | GET /events/:id (invalid id format) | rendered HTML carries OurSharedEvents brand', async () => {
    const res = await fetchEventPage('not a valid id!!');
    const body = await res.text();
    expect(body).toMatch(/OurSharedEvents/);
  });

  test('OSE-R-004 | API | GET /events/:id (invalid id format) | rendered HTML has a CTA link to /events', async () => {
    const res = await fetchEventPage('not a valid id!!');
    const body = await res.text();
    // Friendly CTA back to the public event index — must be hrefable.
    expect(body).toMatch(/href="\/events"/);
    expect(body).toMatch(/Browse upcoming events/);
  });

  test('OSE-R-004 | API | GET /events/:id (invalid id format) | friendly copy is plain English, not dev jargon', async () => {
    const res = await fetchEventPage('not a valid id!!');
    const body = await res.text();
    expect(body).toMatch(/couldn.{1,6}t find that event/i);
    expect(body).toMatch(/coming up next|browse upcoming events/i);
  });

  test('OSE-R-004 | API | GET /events/:id (invalid id format) | no bare 1996-style HTML appears anywhere in the response', async () => {
    const res = await fetchEventPage('not a valid id!!');
    const body = await res.text();
    for (const phrase of FORBIDDEN_BARE_PHRASES) {
      expect(
        body,
        `Response must not contain the pre-fix bare-HTML phrase "${phrase}"`
      ).not.toContain(phrase);
    }
  });

  test('OSE-R-004 | API | GET /events/:id (invalid id format) | no dev jargon or stack traces leak to user', async () => {
    const res = await fetchEventPage('not a valid id!!');
    const body = await res.text();
    for (const phrase of FORBIDDEN_DEV_STRINGS) {
      expect(body, `Response must not leak the dev string "${phrase}" to the user`).not.toContain(
        phrase
      );
    }
  });

  test('OSE-R-004 | API | GET /events/:id (well-formed id, no row) | 404 with branded HTML body', async () => {
    // Distinct from the bad-format branch — this path passes regex validation
    // but the row genuinely doesn't exist. Same branded shell.
    const res = await fetchEventPage('evt_does_not_exist_r004');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toMatch(/data-testid="error-header"/);
    expect(body).toMatch(/data-testid="error-cta"/);
    expect(body).toMatch(/couldn.{1,6}t find that event/i);
  });

  test('OSE-R-004 | API | GET /events/:id (draft event) | 404 byte-identical to plain not-found case (probe-safe)', async () => {
    // SECURITY: if the draft 404 differs in any way from the not-found 404,
    // an attacker can probe to discover unpublished events. The audit comment
    // in pages.ts explicitly says "404 (not 403) so an attacker can't probe"
    // — this test enforces that comment at the contract layer.
    const draftRes = await fetchEventPage('evt_r004_draft');
    const missingRes = await fetchEventPage('evt_does_not_exist_r004');
    expect(draftRes.status).toBe(missingRes.status);
    expect(draftRes.status).toBe(404);
    const draftBody = await draftRes.text();
    const missingBody = await missingRes.text();
    // Bodies might differ in their CSP nonce values (different requests).
    // Strip the nonce attributes before comparing so the assertion only
    // catches content drift, not security boilerplate drift.
    const stripNonce = (s: string) => s.replace(/nonce="[^"]+"/g, 'nonce="REDACTED"');
    expect(stripNonce(draftBody)).toBe(stripNonce(missingBody));
  });

  test('OSE-R-004 | API | GET /events/:id (any 404 branch) | response is text/html (not JSON)', async () => {
    const res = await fetchEventPage('evt_does_not_exist_r004');
    expect(res.headers.get('Content-Type') || '').toContain('text/html');
  });

  test('OSE-R-022 | API | GET /events/:id (any branded error) | OurSharedEvents header is the FIRST visible element', async () => {
    // The audit specifically calls out that the customer should see brand
    // chrome BEFORE the error content. Order matters for trust + wayfinding.
    const res = await fetchEventPage('not a valid id!!');
    const body = await res.text();
    const headerIdx = body.indexOf('data-testid="error-header"');
    const mainIdx = body.indexOf('data-testid="error-main"');
    expect(headerIdx).toBeGreaterThan(0);
    expect(mainIdx).toBeGreaterThan(0);
    expect(headerIdx, 'header must appear before main error content').toBeLessThan(mainIdx);
  });
});
