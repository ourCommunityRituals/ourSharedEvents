/**
 * Put a workers-pool spec on a plan that includes the paid SharedReport.
 *
 * OSE-682: the read API caps every viewer at Local unless the plan includes the
 * paid report, and the plan lookup fails CLOSED (`isPaidReportEnabled`): with no
 * forms tables at all, a report reads at Local. A spec that asserts Mid or
 * Premium sections therefore has to say which plan it is on. This applies the
 * FORMS_DB migrations (tolerating re-runs) and sets the global
 * `analytics.shared-report` flag on, the Mid / Enterprise preset value.
 *
 * Call it in a `beforeAll` or `beforeEach`. A spec that tests the Free cap sets
 * the flag off itself (shared-report-free-plan-page.spec.ts, the OSE-682 block in
 * shared-report-read.spec.ts).
 */
import { env } from 'cloudflare:test';

interface PlanEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

export async function usePaidReportPlan(): Promise<void> {
  const e = env as unknown as PlanEnv;
  const stmts: string[] = JSON.parse(e.TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await e.FORMS_DB.prepare(stmt).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('UNIQUE constraint failed')
      ) {
        continue;
      }
      throw err;
    }
  }
  await e.FORMS_DB.prepare(
    `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
     VALUES ('test-paid-report-plan', 'global', '', 'analytics.shared-report', 1, datetime('now'))
     ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET enabled = 1, updated_at = datetime('now')`
  ).run();
}
