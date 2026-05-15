/**
 * OSE-R-002 — form-page error rendering shows friendly user copy, not raw
 * server codes.
 *
 * Layer: API (vitest exercises the worker's HTTP endpoints via SELF.fetch
 * and inspects the rendered FORM HTML for the friendly-copy map).
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   - These tests share names byte-for-byte with the matching Postman items
 *     (postman/collections/ose-api.json — `OSE-R-002 | API | ...`).
 *   - Companion FE tests live in tests/playwright/form-error-friendly-copy.spec.ts.
 *
 * The audit (REFINEMENT-BACKLOG-2026-05-15.md R-002) found that
 * form-pages.ts:174-175 piped raw server `error` strings (`INVALID_BODY`,
 * `PAYLOAD_TOO_LARGE`, `Missing required field: responses`, etc.) directly
 * to bar attendees on their phones. This spec locks the contract that:
 *   1. The friendly-copy MAP exists in the rendered form HTML for each
 *      form type (register / checkin / survey / email-signup).
 *   2. Each known server code has a friendly entry — no dev jargon leaks.
 *   3. The raw code is preserved in a `data-error-code` attribute for
 *      support visibility (NOT rendered to user).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

// Migrations must run before SELF.fetch hits any form endpoint, otherwise
// downstream lookups (event lifecycle guard, feature flag check) crash with
// "no such table" 500s that mask the validation outcome under test.
// Same pattern as form-validation.spec.ts.
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

const FORM_TYPES = ['register', 'checkin', 'survey', 'email-signup'] as const;

// The codes that the OSE form endpoints can return. If a new code is added
// in src/handlers/forms.ts or src/lib/form-validation.ts, add it here too
// and add the corresponding friendly copy in form-pages.ts.
const KNOWN_SERVER_CODES = [
  'INVALID_EVENT_ID',
  'INVALID_BODY',
  'PAYLOAD_TOO_LARGE',
  'MISSING_FIELD',
  'INVALID_EMAIL',
  'CONFIG_ERROR',
  'DB_ERROR',
  'METHOD_NOT_ALLOWED',
] as const;

// Strings that should NEVER appear as user-visible error copy in the
// rendered form page. These are dev/server messages, not friendly UX.
const FORBIDDEN_RAW_PHRASES = [
  'Request body must be valid JSON',
  'Body must be under 16KB',
  'Missing required field:',
  'FORMS_ENCRYPTION_KEY not configured',
  'Service temporarily unavailable',
  'Invalid event ID format',
];

async function fetchFormPage(formType: string): Promise<string> {
  // Hits the public /forms/:eventId page render via the worker. Any valid
  // event ID is fine — the page renders for the form-type independently.
  const res = await SELF.fetch(`https://test.local/forms/evt_test_2026?type=${formType}`, {
    headers: { Accept: 'text/html' },
  });
  expect(res.status, `${formType} page should render 200`).toBe(200);
  return res.text();
}

describe('OSE-R-002 form-page error rendering — API layer', () => {
  test('OSE-R-002 | API | GET /forms/:eventId?type=register | FORM_ERROR_FRIENDLY_COPY map embedded', async () => {
    const html = await fetchFormPage('register');
    expect(html).toMatch(/FORM_ERROR_FRIENDLY_COPY\s*=\s*\{/);
    expect(html).toMatch(/friendlyFormError\s*\(/);
  });

  // One test per form type — the same map must ship in every form-page HTML.
  for (const formType of FORM_TYPES) {
    test(`OSE-R-002 | API | GET /forms/:eventId?type=${formType} | friendly-copy map present for every known server code`, async () => {
      const html = await fetchFormPage(formType);
      for (const code of KNOWN_SERVER_CODES) {
        expect(html, `${formType} HTML must include friendly copy for ${code}`).toMatch(
          new RegExp(`${code}\\s*:\\s*["']`)
        );
      }
    });
  }

  test('OSE-R-002 | API | GET /forms/:eventId?type=register | no forbidden raw server phrases in rendered form HTML', async () => {
    const html = await fetchFormPage('register');
    for (const phrase of FORBIDDEN_RAW_PHRASES) {
      // The phrase may appear in code-strings (`FORMS_ENCRYPTION_KEY` etc.)
      // as VALUES in the friendly map's input side, but must NOT appear as
      // the value/output of any friendly-copy mapping.
      const friendlyMapPattern = new RegExp(
        `:\\s*["'][^"']*${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"']*["']`
      );
      expect(
        html,
        `Friendly-copy map must NOT contain the raw server phrase "${phrase}" as user-facing copy`
      ).not.toMatch(friendlyMapPattern);
    }
  });

  test('OSE-R-002 | API | GET /forms/:eventId?type=register | submitForm preserves raw code in data-error-code attribute (support visibility)', async () => {
    const html = await fetchFormPage('register');
    // Verify the contract: the submit handler must SET data-error-code on
    // the error element so support engineers can inspect via DevTools.
    expect(html).toMatch(/setAttribute\s*\(\s*['"]data-error-code['"]/);
  });

  test('OSE-R-002 | API | GET /forms/:eventId?type=register | submitForm handles non-JSON server response gracefully', async () => {
    // Defensive: if the server ever returns non-JSON (proxy 502, network
    // unwrap, etc.), the form must still show friendly copy, not crash.
    const html = await fetchFormPage('register');
    expect(html).toMatch(/NON_JSON_RESPONSE/);
  });

  test('OSE-R-002 | API | GET /forms/:eventId?type=register | submitForm handles network error path with friendly fallback', async () => {
    const html = await fetchFormPage('register');
    // The catch block must emit a friendly copy when the network request
    // itself fails (offline, DNS, etc.). Locked via the NETWORK_ERROR code.
    expect(html).toMatch(/NETWORK_ERROR/);
  });

  test('OSE-R-002 | API | POST /api/v2/events/:id/forms/register | server returns body.code field (client-mappable contract)', async () => {
    // Submit a bad body so the server returns INVALID_BODY. The response
    // must include a `code` field — this is the contract the friendly-copy
    // client logic relies on. If the server stops emitting `code`, this
    // test catches it.
    const res = await SELF.fetch('https://test.local/api/v2/events/evt_test_2026/forms/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBeDefined();
    expect(body.code).toBe('INVALID_BODY');
  });

  test('OSE-R-002 | API | POST /api/v2/events/:id/forms/register | malformed email returns body.code=INVALID_EMAIL', async () => {
    // Register accepts unknown event IDs (router middleware comment says
    // "unknown event IDs pass through for backward compat with un-seeded
    // test fixtures") so we hit the email-validation branch directly.
    const res = await SELF.fetch('https://test.local/api/v2/events/evt_test_2026/forms/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.code).toBe('INVALID_EMAIL');
  });
});
