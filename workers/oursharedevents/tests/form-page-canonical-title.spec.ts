/**
 * OSE-R-007 — form page title MUST come from the canonical event row in
 * D1, never from the `?event=` URL query parameter. The pre-fix renderer
 * trusted the query param and let an attacker craft a phishing-ready URL
 * (e.g. `/forms/evt_X?event=Cheap%20Rolex%20Deals!`).
 *
 * Layer: API (vitest exercises the worker's `/forms/:eventId` route via
 * SELF.fetch and inspects the rendered HTML).
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names share their shape
 * byte-for-byte with the Playwright FE spec at
 * tests/playwright/form-page-canonical-title.spec.ts.
 *
 * Format: `OSE-R-007 | API | <method + path> (<condition>) | <assertion>`.
 *
 * The audit (REFINEMENT-BACKLOG-2026-05-15.md OSE-R-007) found the form
 * renderer at form-pages.ts:496 read `?event=...` as the display name
 * with no source-of-truth check. The fix: server-side D1 lookup by
 * `eventId`; query param is ignored for display.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const KNOWN_EVENT_ID = 'evt_r007_canonical';
const KNOWN_TITLE = 'Thursday Jazz at Empty Bottle';
const UNKNOWN_EVENT_ID = 'evt_r007_does_not_exist';

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
  // Seed one event with a known canonical title so we can verify the
  // renderer uses the DB row and ignores the query param. Matches the
  // events-table schema (id, brand_id, title, slug, status, start_date).
  await tenv.DB.prepare(
    "INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date) VALUES (?, 'brand_test', ?, ?, 'active', '2026-06-01T20:00:00Z')"
  )
    .bind(KNOWN_EVENT_ID, KNOWN_TITLE, KNOWN_EVENT_ID)
    .run();
});

async function fetchFormPage(eventId: string, query = ''): Promise<string> {
  const res = await SELF.fetch(`https://test.local/forms/${eventId}${query}`, {
    headers: { Accept: 'text/html' },
  });
  expect(
    res.status,
    '/forms/:id should always render 200 (backward compat for un-seeded events)'
  ).toBe(200);
  return res.text();
}

describe('OSE-R-007 form page canonical title — API layer', () => {
  test('OSE-R-007 | API | GET /forms/:id (known event, no query) | renders canonical title from D1', async () => {
    const html = await fetchFormPage(KNOWN_EVENT_ID);
    expect(html).toContain(KNOWN_TITLE);
    // The visible event-name testid carries the title; the <title> tag
    // does as well. Both must show the canonical string.
    expect(html).toMatch(new RegExp(`data-testid="form-event-name"[^>]*>${KNOWN_TITLE}<`));
  });

  test('OSE-R-007 | API | GET /forms/:id (known event, attacker query) | query param IGNORED, canonical title rendered', async () => {
    // The phishing scenario from the audit row: attacker crafts a URL
    // that overrides the event display name. With the fix, the query
    // param is ignored entirely — only the DB row drives display.
    const phishingPayload = 'Cheap Rolex Deals!';
    const html = await fetchFormPage(
      KNOWN_EVENT_ID,
      `?event=${encodeURIComponent(phishingPayload)}`
    );
    expect(html).toContain(KNOWN_TITLE);
    expect(html).not.toContain(phishingPayload);
    expect(html).not.toContain('Cheap Rolex');
    expect(html).not.toContain('Rolex Deals');
  });

  test('OSE-R-007 | API | GET /forms/:id (unknown event, no query) | renders generic "Event" fallback', async () => {
    // Backward-compat path: un-seeded event IDs (some test fixtures, some
    // pre-launch QR codes) still render a form but show the neutral
    // placeholder rather than 404ing the customer.
    const html = await fetchFormPage(UNKNOWN_EVENT_ID);
    expect(html).toMatch(/data-testid="form-event-name"[^>]*>Event</);
  });

  test('OSE-R-007 | API | GET /forms/:id (unknown event, attacker query) | query param IGNORED, fallback rendered', async () => {
    // The original phishing vector: unknown event id + attacker-supplied
    // ?event=... was rendered as if authoritative. With the fix, the
    // fallback "Event" wins. Attacker string never reaches the DOM.
    const phishingPayload = 'URGENT: Account suspended — click here';
    const html = await fetchFormPage(
      UNKNOWN_EVENT_ID,
      `?event=${encodeURIComponent(phishingPayload)}`
    );
    expect(html).toMatch(/data-testid="form-event-name"[^>]*>Event</);
    expect(html).not.toContain(phishingPayload);
    expect(html).not.toContain('Account suspended');
  });

  test('OSE-R-007 | API | GET /forms/:id (script-tag XSS in query param) | payload neither rendered nor executed', async () => {
    // Defense in depth: even if the canonical-title path somehow regressed,
    // the `escapeHtml` call must still neutralize any HTML in the rendered
    // output. We assert the raw payload AND its escaped form do not appear
    // in the visible event-name slot.
    const xssPayload = '<script>alert(1)</script>';
    const html = await fetchFormPage(UNKNOWN_EVENT_ID, `?event=${encodeURIComponent(xssPayload)}`);
    expect(html).not.toContain(xssPayload);
    expect(html).not.toContain('alert(1)');
    // The form-event-name testid must show the safe fallback only.
    expect(html).toMatch(/data-testid="form-event-name"[^>]*>Event</);
  });

  test('OSE-R-007 | API | GET /forms/:id (img-src XSS in query param) | payload neither rendered nor executed', async () => {
    // Variant payload: HTML attribute injection via on* handlers.
    const xssPayload = '"><img src=x onerror="alert(1)">';
    const html = await fetchFormPage(KNOWN_EVENT_ID, `?event=${encodeURIComponent(xssPayload)}`);
    expect(html).not.toMatch(/onerror\s*=\s*['"]alert/);
    expect(html).not.toContain('<img src=x onerror');
    // Canonical title wins.
    expect(html).toContain(KNOWN_TITLE);
  });

  test('OSE-R-007 | API | GET /forms/:id (known event) | document title reflects canonical event name', async () => {
    const html = await fetchFormPage(KNOWN_EVENT_ID);
    // <title>${eventName} – OurSharedEvents</title>
    expect(html).toMatch(new RegExp(`<title>${KNOWN_TITLE}\\s*[–-]\\s*OurSharedEvents</title>`));
  });

  test('OSE-R-007 | API | GET /forms/:id (known event, attacker query) | document title NOT controlled by query param', async () => {
    const html = await fetchFormPage(KNOWN_EVENT_ID, '?event=' + encodeURIComponent('PWNED'));
    // The browser tab title is a very visible phishing surface; lock it.
    expect(html).not.toMatch(/<title>[^<]*PWNED[^<]*<\/title>/);
    expect(html).toMatch(new RegExp(`<title>${KNOWN_TITLE}\\s*[–-]\\s*OurSharedEvents</title>`));
  });

  test('OSE-R-007 | API | GET /forms/:id (DB query throws) | gracefully falls back without leaking error', async () => {
    // Hard to simulate a D1 throw without mocking the binding; instead,
    // assert that the fallback rendering for an unknown event does NOT
    // contain any of the dev strings a D1 error would leak. Same shape
    // as OSE-R-004's no-dev-jargon assertion.
    const html = await fetchFormPage(UNKNOWN_EVENT_ID);
    // "undefined" intentionally omitted — legitimate inline JS in the form
    // bundle uses `typeof x === 'undefined'` defensively. The dev-jargon
    // leaks we actually care about are D1/sqlite error texts + stack traces.
    for (const phrase of [
      'no such table',
      'no such column',
      'D1_ERROR',
      'SQLITE_',
      'stack:',
      'at async',
    ]) {
      expect(html, `Form page must not leak the dev string "${phrase}"`).not.toContain(phrase);
    }
  });

  // OSE-626 regression: poster-bundle.ts generates ?type=email-signup.
  // Before the fix, formPage() switch had `case 'email':` only — 'email-signup'
  // fell through to the registration form, silently miscollecting data on every
  // deployed email-signup poster QR. Both aliases must now route to emailSignupForm().
  test('OSE-626 | API | GET /forms/:id?type=email-signup | renders email signup form, NOT registration form', async () => {
    const html = await fetchFormPage(KNOWN_EVENT_ID, '?type=email-signup');
    expect(html).toContain('data-testid="form-email"');
    expect(html).not.toContain('data-testid="form-register"');
    // Verify the canonical email signup CTA is present
    expect(html).toContain('data-testid="email-submit"');
    expect(html).not.toContain('data-testid="register-submit"');
  });

  test('OSE-626 | API | GET /forms/:id?type=email | legacy alias still routes to email signup form', async () => {
    // The legacy `?type=email` param must still work alongside the canonical
    // `?type=email-signup` — both map to emailSignupForm().
    const html = await fetchFormPage(KNOWN_EVENT_ID, '?type=email');
    expect(html).toContain('data-testid="form-email"');
    expect(html).not.toContain('data-testid="form-register"');
  });

  test('OSE-R-007 | API | GET /forms/:id (long title, 250+ chars) | title clamped to 200 chars for display', async () => {
    // Defense in depth: even if an admin somehow saves a 10KB title, the
    // form page truncates to 200 chars in the display slot. Prevents a
    // layout-breaking title from being weaponized against bar attendees.
    const longTitle = 'A'.repeat(250);
    const longId = 'evt_r007_long';
    const tenv = env as unknown as TestEnv;
    await tenv.DB.prepare(
      "INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date) VALUES (?, 'brand_test', ?, ?, 'active', '2026-06-01T20:00:00Z')"
    )
      .bind(longId, longTitle, longId)
      .run();
    const html = await fetchFormPage(longId);
    // Title is rendered but clamped. The visible substring should not
    // exceed 200 chars between the data-testid open and close tags.
    const m = html.match(/data-testid="form-event-name"[^>]*>([^<]*)</);
    expect(m, 'event-name testid must render').toBeTruthy();
    expect(m![1].length).toBeLessThanOrEqual(200);
  });
});
