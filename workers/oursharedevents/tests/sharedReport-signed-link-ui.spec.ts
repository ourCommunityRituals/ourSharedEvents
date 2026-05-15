/**
 * OSE-R-003 — /sharedReport HTML page must call the OSE-272 Session 5
 * signed-link SharedReport API when entered via a share-link URL.
 *
 * Layer: API (vitest inspects the rendered HTML for the signed-link mode
 * wiring; the FE-side DOM behavior is locked by the Playwright companion
 * at tests/playwright/sharedReport-signed-link-ui.spec.ts).
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   - These test names share their shape byte-for-byte with the Postman
 *     items in postman/collections/ose-api.json (`OSE-R-003 | API | ...`).
 *   - Format: `<STORY-ID> | <API|FE> | <method + path> (<condition>) | <assertion>`.
 *
 * The audit (REFINEMENT-BACKLOG-2026-05-15.md OSE-R-003) found that the
 * Session 5 SharedReport API has no customer-facing surface — a bar owner
 * who clicks a signed share-link lands on the generic admin dashboard,
 * which ignores their token and fetches admin-only endpoints. This spec
 * locks the contract that the `/sharedReport` page:
 *   1. Detects ?eventId=&token= and switches into signed-link mode.
 *   2. Calls GET /api/v2/events/:id/shared-report with Authorization Bearer.
 *   3. Has a friendly-copy map for every SharedReport error code.
 *   4. Preserves the raw code on data-error-code for support visibility.
 *   5. Early-exits admin scripts when signed-link mode is active so the
 *      browser never calls admin endpoints from a customer-share visit.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { setFlag } from '../src/lib/feature-flags';

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

// The /sharedReport route is gated by the analytics.shared-report feature
// flag. Tests must seed the flag table so the route returns the page HTML
// rather than the disabled-tier 403. We use the public setFlag() helper so
// the seed is robust against schema drift.
beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  const tolerated = (msg: string) =>
    msg.includes('duplicate column name') ||
    msg.includes('already exists') ||
    msg.includes('no such column');
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
  await setFlag(tenv.FORMS_DB, 'analytics.shared-report', true, 'global');
});

// Server error codes the signed-link SharedReport API can return. If a new
// code is added in src/handlers/shared-report-read.ts, add it here too AND
// add the corresponding friendly copy in pages.ts SHARED_REPORT_ERROR_COPY.
const KNOWN_SERVER_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'MATERIALIZATION_PENDING',
] as const;

// Client-only codes the page emits when the network/transport fails before
// the server can answer. These must also be in the friendly-copy map.
const CLIENT_TRANSPORT_CODES = ['NON_JSON_RESPONSE', 'NETWORK_ERROR'] as const;

// Strings that should NEVER appear as user-visible copy in the rendered
// SharedReport page's friendly-copy map. These are dev/server messages,
// not friendly UX.
const FORBIDDEN_RAW_PHRASES = [
  'missing bearer token',
  'invalid or expired token',
  'event_id claim does not match path',
  'materialized signal',
  'cron tick',
];

async function fetchSharedReportPage(): Promise<string> {
  const res = await SELF.fetch('https://test.local/sharedReport', {
    headers: { Accept: 'text/html' },
  });
  expect(res.status, '/sharedReport should render 200 (flag-gated, seeded above)').toBe(200);
  return res.text();
}

describe('OSE-R-003 SharedReport signed-link UI — API layer', () => {
  test('OSE-R-003 | API | GET /sharedReport (any visitor) | signed-link section markup present in rendered HTML', async () => {
    const html = await fetchSharedReportPage();
    expect(html).toMatch(/id="signed-link-section"/);
    expect(html).toMatch(/id="signed-link-content"/);
    expect(html).toMatch(/id="signed-link-error"/);
    expect(html).toMatch(/data-testid="signed-link-section"/);
    expect(html).toMatch(/data-testid="signed-link-error"/);
  });

  test('OSE-R-003 | API | GET /sharedReport (any visitor) | SHARED_REPORT_ERROR_COPY map embedded', async () => {
    const html = await fetchSharedReportPage();
    expect(html).toMatch(/SHARED_REPORT_ERROR_COPY\s*=\s*\{/);
    expect(html).toMatch(/friendlySharedReportError\s*=\s*function/);
  });

  test('OSE-R-003 | API | GET /sharedReport (any visitor) | friendly-copy entry present for every known server code', async () => {
    const html = await fetchSharedReportPage();
    for (const code of KNOWN_SERVER_CODES) {
      expect(html, `SharedReport HTML must include friendly copy for ${code}`).toMatch(
        new RegExp(`${code}\\s*:\\s*["']`)
      );
    }
  });

  test('OSE-R-003 | API | GET /sharedReport (any visitor) | friendly-copy entry present for every client transport code', async () => {
    const html = await fetchSharedReportPage();
    for (const code of CLIENT_TRANSPORT_CODES) {
      expect(html, `SharedReport HTML must include friendly copy for ${code}`).toMatch(
        new RegExp(`${code}\\s*:\\s*["']`)
      );
    }
  });

  test('OSE-R-003 | API | GET /sharedReport (any visitor) | DEFAULT fallback copy present in friendly map', async () => {
    const html = await fetchSharedReportPage();
    expect(html).toMatch(/DEFAULT\s*:\s*["']/);
  });

  test('OSE-R-003 | API | GET /sharedReport (any visitor) | no forbidden raw server phrases appear as user-facing copy', async () => {
    const html = await fetchSharedReportPage();
    for (const phrase of FORBIDDEN_RAW_PHRASES) {
      // The phrase may legitimately appear in code comments. What we forbid
      // is its appearance as the VALUE of a friendly-copy entry, i.e. as
      // user-visible text inside a quoted string after `:` in the map.
      const friendlyMapPattern = new RegExp(
        `:\\s*["'][^"']*${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"']*["']`
      );
      expect(
        html,
        `Friendly-copy map must NOT contain the raw server phrase "${phrase}" as user-facing copy`
      ).not.toMatch(friendlyMapPattern);
    }
  });

  test('OSE-R-003 | API | GET /sharedReport (with signed-link params) | page calls the OSE-272 Session 5 SharedReport API', async () => {
    const html = await fetchSharedReportPage();
    // The signed-link client logic must hit the Session 5 endpoint, with
    // the eventId encoded into the path. The literal URL pattern is the
    // contract — if the path moves, this test breaks and the audit catches
    // the regression.
    expect(html).toMatch(
      /fetch\(\s*['"]\/api\/v2\/events\/['"]\s*\+\s*encodeURIComponent\(\s*eventId\s*\)\s*\+\s*['"]\/shared-report['"]/
    );
  });

  test('OSE-R-003 | API | GET /sharedReport (with signed-link params) | page sends Authorization Bearer header with the token', async () => {
    const html = await fetchSharedReportPage();
    expect(html).toMatch(/['"]Authorization['"]\s*:\s*['"]Bearer\s*['"]\s*\+\s*token/);
  });

  test('OSE-R-003 | API | GET /sharedReport (signed-link error path) | raw error code preserved on data-error-code attribute', async () => {
    const html = await fetchSharedReportPage();
    // Support engineers inspect DevTools to read the underlying code while
    // the user sees only the friendly copy. Same contract as OSE-R-002.
    expect(html).toMatch(/setAttribute\s*\(\s*['"]data-error-code['"]/);
  });

  test('OSE-R-003 | API | GET /sharedReport (signed-link mode) | admin sections gated by __signedLinkMode flag', async () => {
    const html = await fetchSharedReportPage();
    // Admin scripts must early-exit when signed-link mode is active so the
    // browser never calls admin endpoints from a customer-share visit.
    // We look for at least three guards — one before each admin IIFE
    // body (events list, sponsor metrics, advanced metrics).
    const guardMatches = html.match(/if\s*\(\s*window\.__signedLinkMode\s*\)\s*return\s*;?/g);
    expect(guardMatches, 'expected __signedLinkMode guards in admin IIFEs').toBeTruthy();
    expect((guardMatches ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('OSE-R-003 | API | GET /sharedReport (signed-link mode) | admin sections have stable IDs the signed-link script can hide', async () => {
    const html = await fetchSharedReportPage();
    for (const id of [
      'admin-action-bar',
      'admin-section-stats',
      'admin-section-events',
      'report-sponsor-section',
      'advanced-metrics-section',
    ]) {
      expect(html, `admin section must carry id="${id}" so signed-link mode can hide it`).toMatch(
        new RegExp(`id="${id}"`)
      );
    }
  });

  test('OSE-R-003 | API | GET /sharedReport (signed-link payload) | rendered article carries event_title, unique_gatherings, return_rate, corridor_density data-testids', async () => {
    const html = await fetchSharedReportPage();
    // These data-testids are the contract the Playwright FE spec relies on
    // to find rendered fields. If a future refactor renames them, the
    // audit catches the break at the API layer rather than only in the
    // (slower, separately-run) FE suite.
    for (const testid of [
      'signed-link-event-title',
      'signed-link-event-date',
      'signed-link-unique-gatherings',
      'signed-link-return-rate',
      'signed-link-corridor-density',
    ]) {
      expect(html, `signed-link render must emit data-testid="${testid}"`).toMatch(
        new RegExp(`data-testid="${testid}"`)
      );
    }
  });

  test('OSE-R-003 | API | GET /api/v2/events/:id/shared-report (no Authorization header) | body.code=UNAUTHORIZED (client-mappable contract)', async () => {
    // The signed-link UI's friendly-copy lookup is keyed on body.code from
    // the server. If the server stops emitting a `code` field, the UI
    // falls back to the HTTP-status map — but the contract under test
    // here is that the server still emits the code, locked at the wire.
    const res = await SELF.fetch('https://test.local/api/v2/events/evt_test_2026/shared-report', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  test('OSE-R-003 | API | GET /api/v2/events/:id/shared-report (malformed bearer token) | body.code=UNAUTHORIZED', async () => {
    const res = await SELF.fetch('https://test.local/api/v2/events/evt_test_2026/shared-report', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer not-a-real-signature',
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
