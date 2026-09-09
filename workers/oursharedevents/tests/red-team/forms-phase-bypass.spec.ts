/**
 * Red Team: forms-phase-bypass.spec.ts  (OSE-1270 Cell A — the confirmed hole)
 *
 * Attack: collect PERSONAL DATA (survey / email-signup) without regulatory Phase-2
 * clearance by targeting an event the phase gate never evaluates.
 *
 * The gate (router.ts) fires per formType for survey/email (Phase 2 required). Its
 * clearance source is `events.legal_clearance_tier`. Pre-fix, the gate ran only
 * `if (requiredPhase && eventRow)` — so an UNKNOWN event id (no `events` row) fell
 * straight through, and because `form_surveys` / `email_signups` (FORMS_DB) carry
 * NO foreign key to the main-DB `events` table, the PII persisted against a
 * phantom, never-cleared event. That is a covenant-floor breach: PII collected
 * outside a legally-cleared context.
 *
 * Fix (OSE-1270): the gate treats a missing event as Phase 0 and fails closed —
 * a personal-data form requires an EXISTING, Phase-2-cleared event.
 *
 * Each attack asserts the attack finds NOTHING (403 + zero rows written) — a test
 * that cannot detect the violation earns no credit (impression-privacy.spec.ts).
 *
 * @born-red regulatory#OSE-73/OSE-1270 | armed: 2026-09-09
 *   Revert the fail-closed change (back to `if (requiredPhase && eventRow)`) and
 *   these reds: the nonexistent-event survey/email return 200 and a row appears in
 *   FORMS_DB for the phantom event.
 *
 * PLATFORM NOTE: workers-pool spec (DB + FORMS_DB); workerd segfaults on native
 * Windows (OSE-696) → authoritative green is Linux CI. See
 * [[windows-linux-verification-boundary]].
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const ADMIN_KEY = 'test-admin-key-e2e-2026';
// A phantom event id — deliberately NEVER seeded into the events table.
const PHANTOM = 'evt-phantom-never-seeded-redteam';

async function applyMigrations(): Promise<void> {
  const main: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of main) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists') || msg.includes('no such column')) continue;
      throw e;
    }
  }
  const forms: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of forms) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists') || msg.includes('no such column')) continue;
      throw e;
    }
  }
}

async function submit(formType: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/events/${PHANTOM}/forms/${formType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function rowCount(db: D1Database, table: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE event_id = ?`).bind(PHANTOM).first<{ c: number }>();
  return r?.c ?? 0;
}

beforeAll(async () => {
  await applyMigrations();
  // Enable the form flags globally (mid tier) so FORM_DISABLED does NOT pre-empt
  // the phase gate — the attack must be stopped by the PHASE gate, not the flag.
  const res = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'mid' }),
  });
  expect(res.status).toBe(200);
});

describe('Red team: forms PHASE_REQUIRED bypass on a phantom event (OSE-1270 Cell A)', () => {
  test('PHASE-BYPASS-1: survey to a nonexistent event → 403 PHASE_REQUIRED, no row written', async () => {
    const before = await rowCount(tenv().FORMS_DB, 'form_surveys');
    const res = await submit('survey', { responses: { rating: 5 } });
    const body = (await res.json()) as { code?: string };

    expect(res.status).toBe(403);
    expect(body.code).toBe('PHASE_REQUIRED'); // the PHASE gate, not FORM_DISABLED (flag is on)
    expect(await rowCount(tenv().FORMS_DB, 'form_surveys')).toBe(before); // no PII persisted
  });

  test('PHASE-BYPASS-2: email-signup to a nonexistent event → 403 PHASE_REQUIRED, no row written', async () => {
    const before = await rowCount(tenv().FORMS_DB, 'email_signups');
    const res = await submit('email-signup', { email: 'attacker@test.com' });
    const body = (await res.json()) as { code?: string };

    expect(res.status).toBe(403);
    expect(body.code).toBe('PHASE_REQUIRED');
    expect(await rowCount(tenv().FORMS_DB, 'email_signups')).toBe(before);
  });
});
