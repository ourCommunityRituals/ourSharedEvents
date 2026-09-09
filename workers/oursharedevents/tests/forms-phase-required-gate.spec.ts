/**
 * OSE-1172 (slice — forms PHASE_REQUIRED gate) on the forms submit path.
 *
 * The L1 cell for OSE-1172's "Forms" axis: survey + email-signup collect PERSONAL
 * DATA, so they require regulatory clearance Phase 2 (OSE-73 / ADMIN-2). Below that
 * the submit path returns 403 PHASE_REQUIRED. This is a SECURITY gate (no PII
 * collection before legal clearance), and it was untested — no spec asserted the
 * PHASE_REQUIRED code at all.
 *
 * SCOPE NOTE (verify-first, 2026-09-09): the design-doc §7 row called this "forms
 * phase-gate × SharedReport mutual enforcement", but there is NO SharedReport
 * intersection — the forms submit path (FORMS_DB) and the anonymous SharedReport
 * (DB) are two severed ledgers that never join (two-DB isolation). So this is a
 * pure forms-path cell; the doc row is corrected to match.
 *
 * TWO DISTINCT 403s on the submit path — this spec targets the SECOND, which is the
 * untested one:
 *   1. FORM_DISABLED     — the `forms.<type>` feature flag is off (tier gating).
 *                          Already covered by forms-e2e.spec.ts Scenario 8.
 *   2. PHASE_REQUIRED    — the flag is ON but the event's `legal_clearance_tier < 2`
 *                          for survey/email-signup (router.ts:1295-1307). THIS ONE.
 *
 * The gate fires only when `requiredPhase && eventRow` (router.ts:1295) — an
 * un-seeded event passes through (which is exactly why forms-e2e Scenario 8, which
 * never seeds its event, only ever hit FORM_DISABLED). So this spec SEEDS the event
 * with an explicit `legal_clearance_tier` and enables the flag (mid tier), so the
 * phase gate — not the flag gate — is what bites.
 *
 * @born-red regulatory#OSE-73 | method: forms-phase-required | armed: 2026-09-09
 *   Remove the phase gate (router.ts:1295-1307) and the tier-1 survey/email-signup
 *   cells return 200 instead of 403 PHASE_REQUIRED — PII collection before legal
 *   clearance. The register cell (no phase requirement) and the tier-2 cell
 *   (cleared) stay green, so the guard isolates the phase check specifically.
 *
 * PLATFORM NOTE: workers-pool spec (SELF.fetch, DB + FORMS_DB); the pool SEGFAULTS
 * on native Windows (OSE-696) → authoritative green is Linux CI (T0 workers `tests`
 * shard). Local = review + typecheck only. See [[windows-linux-verification-boundary]].
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

// The worker-under-test's staging Bearer fallback (same value forms-e2e uses).
const ADMIN_KEY = 'test-admin-key-e2e-2026';

// ─── Harness ──────────────────────────────────────────────────────────────────

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

/**
 * Seed a renderable event with an explicit regulatory clearance tier. Status
 * 'active' so the public-render check (router.ts:1255) passes and the submit path
 * reaches the phase gate. INSERT OR REPLACE so a per-case id can re-seed freely.
 */
async function seedEvent(id: string, clearanceTier: number): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT OR REPLACE INTO events
         (id, brand_id, title, slug, status, location, start_date, legal_clearance_tier, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', '2026-05-07T19:00:00Z', ?,
               datetime('now'), datetime('now'))`
    )
    .bind(id, `Test ${id}`, id, clearanceTier)
    .run();
}

async function submitForm(eventId: string, formType: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/${formType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const FORM_BODY: Record<string, Record<string, unknown>> = {
  survey: { responses: { rating: 5 } },
  'email-signup': { email: 'phase@test.com' },
  register: { name: 'Phase Test' },
};

beforeAll(async () => {
  await applyMigrations();
  // Enable forms.{register,survey,email-signup} flags globally (mid tier), so the
  // FORM_DISABLED gate is satisfied and the PHASE gate is the one under test.
  const res = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'mid' }),
  });
  expect(res.status).toBe(200);
});

// ─── The phase-gate matrix ──────────────────────────────────────────────────

interface Cell {
  name: string;
  form: 'survey' | 'email-signup' | 'register';
  tier: number;
  expect403: boolean;
}

const CELLS: Cell[] = [
  // Personal-data forms below Phase 2 → blocked.
  { name: 'survey at clearance tier 1 → 403 PHASE_REQUIRED (PII pre-clearance blocked)', form: 'survey', tier: 1, expect403: true },
  { name: 'email-signup at clearance tier 1 → 403 PHASE_REQUIRED', form: 'email-signup', tier: 1, expect403: true },
  // Phase-1 form is never phase-gated, even at tier 1.
  { name: 'register at clearance tier 1 → allowed (no phase requirement)', form: 'register', tier: 1, expect403: false },
  // Cleared to Phase 2 → personal-data forms proceed.
  { name: 'survey at clearance tier 2 → allowed (cleared)', form: 'survey', tier: 2, expect403: false },
];

describe('OSE-1172 — forms PHASE_REQUIRED gate (OSE-73 regulatory clearance, flag enabled)', () => {
  test.each(CELLS)('$name', async ({ form, tier, expect403 }) => {
    const eventId = `evt-phase-${form}-t${tier}`;
    await seedEvent(eventId, tier);

    const res = await submitForm(eventId, form, FORM_BODY[form]);
    const body = (await res.json()) as { ok?: boolean; code?: string };

    if (expect403) {
      expect(res.status).toBe(403);
      // The load-bearing distinction: it is the PHASE gate, not FORM_DISABLED —
      // the flag is on (mid tier), so a FORM_DISABLED here would mean the flag
      // gate mis-fired and the phase assertion would be vacuous.
      expect(body.code).toBe('PHASE_REQUIRED');
    } else {
      expect(res.status).not.toBe(403);
      expect(body.code).not.toBe('PHASE_REQUIRED');
    }
  });
});
