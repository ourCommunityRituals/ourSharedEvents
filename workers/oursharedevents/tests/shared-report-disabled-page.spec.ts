/**
 * OSE-1206 — when `analytics.shared-report` is off (the seeded default,
 * flag-seed-parity), a BROWSER hitting /sharedReport gets the branded
 * friendly-error page, while API callers keep the JSON envelope. Staging
 * showed a phone the raw `{"code":"REPORT_DISABLED"…}` body.
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

describe('OSE-1206 | /sharedReport disabled tier | browser vs API', () => {
  beforeAll(forceFlagOff);

  test('browser (Accept: text/html) → 403 branded page, no raw code', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport', {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('data-surface="ose-error"');
    expect(html).toContain('Shared reports aren&#39;t switched on here yet'); // helper escapes the apostrophe
    expect(html).toContain('data-testid="error-cta"');
    expect(html).not.toContain('REPORT_DISABLED');
    expect(html).not.toMatch(/"ok":false/);
  });

  test('API caller (Accept: application/json) → 403 JSON envelope unchanged', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport', {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as { ok: boolean; code: string; status: number };
    expect(body).toMatchObject({ ok: false, status: 403, code: 'REPORT_DISABLED' });
  });

  test('no Accept header at all → JSON envelope (curl, Newman, smoke probes)', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});
