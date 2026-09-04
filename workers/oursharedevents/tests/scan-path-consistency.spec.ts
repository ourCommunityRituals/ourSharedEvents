/**
 * Staging walkthrough 2026-09-03 — three drift items on the scan path, fixed
 * together and locked here against the RENDERED output (not source):
 *
 *   1. Form inputs measured 42px at 390px — under the 44px mobile-workability
 *      floor. `min-height: 44px` on input/select/textarea.
 *   2. The landing wore Tailwind blue (#2563eb / #1d4ed8) while forms, the
 *      error page and admin use the platform accent #4361ee (OSE-221). One
 *      scan path, one accent.
 *   3. The TV display carried no privacy line. It now states the promise in
 *      10-foot type: "We count the room, never the person."
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const MOCK_ADMIN_KEY = 'test-admin-key-e2e-2026';
const tenv = () => env as unknown as TestEnv;

beforeAll(async () => {
  for (const [db, key] of [
    [tenv().DB, 'TEST_MIGRATION_STATEMENTS'],
    [tenv().FORMS_DB, 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    const stmts: string[] = JSON.parse(tenv()[key]);
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name')) continue;
        throw e;
      }
    }
  }
});

describe('scan-path consistency | walkthrough 2026-09-03', () => {
  test('form pages: input/select/textarea rule carries min-height: 44px', async () => {
    const created = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Scan path floor check', status: 'active' }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    for (const type of ['register', 'email']) {
      const res = await SELF.fetch(`https://t.test/forms/${id}?type=${type}`);
      expect(res.status, `/forms/${id}?type=${type}`).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/input,\s*textarea,\s*select\s*\{[^}]*min-height:\s*44px/);
    }
  });

  test('landing: platform accent #4361ee, no Tailwind-blue drift', async () => {
    const html = await (await SELF.fetch('https://t.test/')).text();
    expect(html).toMatch(/#4361ee/i);
    expect(html).not.toMatch(/#2563eb|#1d4ed8/i);
  });

  test('display: the consent line is present, in the voice, outside the aria-hidden ticker', async () => {
    const html = await (await SELF.fetch('https://t.test/display')).text();
    expect(html).toMatch(/data-testid="display-consent"[^>]*role="note"/);
    expect(html).toContain('We count the room, never the person.');
    const consentIdx = html.indexOf('data-testid="display-consent"');
    const tickerIdx = html.indexOf('data-testid="display-ticker"');
    expect(consentIdx).toBeGreaterThan(-1);
    expect(consentIdx, 'consent line precedes the decorative ticker').toBeLessThan(tickerIdx);
  });
});

/**
 * Counts are POST-EVENT only (founder decision 2026-09-04).
 *
 * The attendee-facing surfaces never show an attendance tally: not the TV, not
 * the public listing, not the event page before or during the night. The host
 * (admin), the sponsor, and the SharedReport are where counts belong; the
 * post-event recap card is the one attendee-facing exception, kept deliberately
 * as the keepsake OSE-657 designed.
 *
 * Runtime, not source-shape: these fetch the real rendered surfaces, so a count
 * reintroduced through a partial, a template include, or client-side JS is
 * caught too.
 */
describe('counts are post-event only | attendee surfaces carry no tally', () => {
  const COUNT_TESTIDS = [
    'checkin-count',
    'registration-count',
    'stat-checkins',
    'stat-registrations',
    'stat-showed-up-share',
    'event-stats-card',
  ];
  const COUNT_COPY = [/checked in so far/i, /registered so far/i, /% of those registered/i];

  test('/display renders no attendance count', async () => {
    const html = await (await SELF.fetch('https://t.test/display')).text();
    for (const id of COUNT_TESTIDS) {
      expect(html, `/display must not carry data-testid="${id}"`).not.toContain(
        `data-testid="${id}"`
      );
    }
    for (const re of COUNT_COPY) expect(html).not.toMatch(re);
    // The sponsor ROTATION counter ("2 / 3") is not an attendance count and stays.
    expect(html).toContain('display-sponsor-banner');
  });

  test('/events (public listing) renders no attendance count', async () => {
    const html = await (await SELF.fetch('https://t.test/events')).text();
    for (const id of COUNT_TESTIDS) {
      expect(html, `/events must not carry data-testid="${id}"`).not.toContain(
        `data-testid="${id}"`
      );
    }
    for (const re of COUNT_COPY) expect(html).not.toMatch(re);
    // The sr-only "N upcoming events" counts EVENTS, not people — it stays.
    expect(html).toContain('data-testid="public-events-count"');
  });
});
