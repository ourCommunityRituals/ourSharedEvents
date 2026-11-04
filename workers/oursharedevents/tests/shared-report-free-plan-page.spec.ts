/**
 * OSE-682 — everyone gets a SharedReport. With `analytics.shared-report` off
 * (the Free preset, the seeded default per flag-seed-parity) the report page
 * still loads; what it shows is decided at the read API, which caps every viewer
 * at Local on such a plan (capDepthToPlan, covered in
 * shared-report-read-depth-wiring.spec.ts and shared-report-read.spec.ts).
 *
 * Supersedes OSE-1206's branded 403: that page refused the whole report on Free,
 * so a Free event reached the end of its flow with no report at all.
 *
 * @born-red OSE-682 | method: restore-gate | verified: putting back the router's
 *   `if (!reportEnabled) return 403` block turns all three tests red.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

/** Apply the FORMS_DB migrations (same pattern as feature-flags.spec.ts), then
 *  pin the flag off so the suite holds even if a seed default ever flips. */
async function forceFlagOff() {
  const stmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
  await tenv()
    .FORMS_DB.prepare(
      `UPDATE feature_flags SET enabled = 0 WHERE flag_key = 'analytics.shared-report'`
    )
    .run();
}

describe('OSE-682 | /sharedReport on a plan without the paid report | the page loads', () => {
  beforeAll(forceFlagOff);

  test('browser (Accept: text/html) → 200, the report page, not an error page', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport', {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).not.toContain('data-surface="ose-error"');
    expect(html).not.toContain('switched on here yet');
    expect(html).toContain('report.distinct_scanners');
  });

  test('API caller (Accept: application/json) → 200, no REPORT_DISABLED envelope', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport', {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('REPORT_DISABLED');
  });

  test('every report alias loads on Free', async () => {
    for (const path of ['/report', '/analytics', '/reports', '/insights', '/stats']) {
      const res = await SELF.fetch(`https://t.test${path}`);
      expect(res.status, path).toBe(200);
    }
  });
});
