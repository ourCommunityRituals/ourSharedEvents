/**
 * QA-2: Flag toggle → surface gating E2E (OSE-111)
 *
 * Full tier lifecycle for all 4 form types:
 *   - Free tier:       register ✅  checkin ✅  survey ❌  email-signup ❌
 *   - Mid tier:        all 4 ✅
 *   - Enterprise:      all 4 ✅ + event-level override (per-event ON/OFF)
 *   - Downgrade path:  mid → free → gated forms return 403
 *   - Event override:  global OFF but event ON → 200 (enterprise only)
 *                      global ON but event OFF → 403
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const ADMIN_KEY = 'test-admin-key-e2e-2026';

const tenv = () => env as unknown as TestEnv;
const mainDb = () => tenv().DB;
const formsDb = () => tenv().FORMS_DB;

function post(path: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function applyTier(tier: string): Promise<void> {
  await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier }),
  });
}

async function setEventFlag(eventId: string, flag: string, enabled: boolean): Promise<void> {
  await SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}/flags/${flag}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

async function deleteEventFlag(eventId: string, flag: string): Promise<void> {
  await SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}/flags/${flag}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
}

async function j(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

// OSE-1270: survey/email-signup now require an EXISTING, Phase-2-cleared event
// (a missing event fails closed — see router.ts phase gate). These tests exercise
// FLAG gating, not the phase gate, so their events are seeded as cleared to
// isolate that axis. Free-tier events keep unique un-seeded ids so FORM_DISABLED
// still fires there.
async function seedClearedEvent(id: string): Promise<void> {
  await mainDb()
    .prepare(
      `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, legal_clearance_tier, created_at, updated_at)
       VALUES (?, 'brand-qa2', ?, ?, 'active', 2, datetime('now'), datetime('now'))`
    )
    .bind(id, `Cleared ${id}`, id)
    .run();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await mainDb().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }

  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await formsDb().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }

  await applyTier('free');

  // OSE-1270: seed cleared events for the mid/enterprise phase-form tests so the
  // PHASE gate passes and FLAG gating is what's under test.
  for (const id of [
    'qa2-mid-matrix',
    'qa2-downgrade-survey',
    'qa2-downgrade-email',
    'qa2-ent-override-on',
    'qa2-ent-remove-override',
    'qa2-matrix-mid',
    'qa2-matrix-enterprise',
  ]) {
    await seedClearedEvent(id);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GATE-1: Free tier — per-form-type gating matrix
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-2 Gate-1: Free tier form-type matrix', () => {
  test('free tier: register → 200, checkin → 200, survey → 403, email-signup → 403', async () => {
    const EVENT = 'qa2-free-matrix';
    await applyTier('free');

    const reg = await post(`/api/v2/events/${EVENT}/forms/register`, { name: 'Free Test' });
    expect(reg.status).toBe(200);
    expect((await j(reg)).ok).toBe(true);

    const checkin = await post(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(checkin.status).toBe(200);
    expect((await j(checkin)).ok).toBe(true);

    const survey = await post(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { q: 'a' },
    });
    expect(survey.status).toBe(403);
    expect((await j(survey)).code).toBe('FORM_DISABLED');

    const email = await post(`/api/v2/events/${EVENT}/forms/email-signup`, {
      email: 'free@qa2.test',
    });
    expect(email.status).toBe(403);
    expect((await j(email)).code).toBe('FORM_DISABLED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GATE-2: Mid tier — all 4 form types enabled
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-2 Gate-2: Mid tier — all form types enabled', () => {
  test('mid tier: register → 200, checkin → 200, survey → 200, email-signup → 200', async () => {
    const EVENT = 'qa2-mid-matrix';
    await applyTier('mid');

    const reg = await post(`/api/v2/events/${EVENT}/forms/register`, { name: 'Mid Test' });
    expect(reg.status).toBe(200);

    const checkin = await post(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(checkin.status).toBe(200);

    const survey = await post(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { rating: 5 },
    });
    expect(survey.status).toBe(200);

    const email = await post(`/api/v2/events/${EVENT}/forms/email-signup`, {
      email: 'mid@qa2.test',
    });
    expect(email.status).toBe(200);

    await applyTier('free');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GATE-3: Downgrade path — mid → free re-gates survey + email-signup
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-2 Gate-3: Downgrade path — mid → free re-gates forms', () => {
  test('survey allowed on mid, blocked after downgrade to free', async () => {
    const EVENT = 'qa2-downgrade-survey';

    await applyTier('mid');
    const midRes = await post(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { q: 'before-downgrade' },
    });
    expect(midRes.status).toBe(200);

    await applyTier('free');
    const freeRes = await post(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { q: 'after-downgrade' },
    });
    expect(freeRes.status).toBe(403);
    expect((await j(freeRes)).code).toBe('FORM_DISABLED');
  });

  test('email-signup allowed on mid, blocked after downgrade to free', async () => {
    const EVENT = 'qa2-downgrade-email';

    await applyTier('mid');
    const midRes = await post(`/api/v2/events/${EVENT}/forms/email-signup`, {
      email: 'downgrade@qa2.test',
    });
    expect(midRes.status).toBe(200);

    await applyTier('free');
    const freeRes = await post(`/api/v2/events/${EVENT}/forms/email-signup`, {
      email: 'downgrade2@qa2.test',
    });
    expect(freeRes.status).toBe(403);
    expect((await j(freeRes)).code).toBe('FORM_DISABLED');
  });

  test('register + checkin remain enabled after downgrade to free', async () => {
    const EVENT = 'qa2-downgrade-always-on';

    await applyTier('mid');
    await applyTier('free');

    const reg = await post(`/api/v2/events/${EVENT}/forms/register`, { name: 'Downgrade' });
    expect(reg.status).toBe(200);

    const checkin = await post(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(checkin.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GATE-4: Enterprise event-level override — global OFF, event ON → 200
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-2 Gate-4: Event-level override — enterprise per-event access', () => {
  test('global survey OFF (free tier), event override ON → 200 for that event only', async () => {
    const ENT_EVENT = 'qa2-ent-override-on';
    const FREE_EVENT = 'qa2-ent-no-override';

    await applyTier('free');

    // Global: survey is OFF
    const globalRes = await post(`/api/v2/events/${FREE_EVENT}/forms/survey`, {
      responses: { q: 'global-off' },
    });
    expect(globalRes.status).toBe(403);

    // Set event-level override ON for ENT_EVENT
    await setEventFlag(ENT_EVENT, 'forms.survey', true);

    // ENT_EVENT: override grants access despite global OFF
    const entRes = await post(`/api/v2/events/${ENT_EVENT}/forms/survey`, {
      responses: { q: 'event-override-on' },
    });
    expect(entRes.status).toBe(200);
    expect((await j(entRes)).ok).toBe(true);

    // FREE_EVENT: still blocked (no override)
    const freeAgain = await post(`/api/v2/events/${FREE_EVENT}/forms/survey`, {
      responses: { q: 'still-blocked' },
    });
    expect(freeAgain.status).toBe(403);

    // Clean up override
    await deleteEventFlag(ENT_EVENT, 'forms.survey');
  });

  test('global register ON (free tier), event override OFF → 403 for that event only', async () => {
    const BLOCKED_EVENT = 'qa2-event-register-off';
    const NORMAL_EVENT = 'qa2-event-register-on';

    await applyTier('free');

    // Both events: register is globally ON
    const normalBefore = await post(`/api/v2/events/${NORMAL_EVENT}/forms/register`, {
      name: 'Normal',
    });
    expect(normalBefore.status).toBe(200);

    // Set event-level override OFF for BLOCKED_EVENT
    await setEventFlag(BLOCKED_EVENT, 'forms.register', false);

    // BLOCKED_EVENT: override blocks despite global ON
    const blockedRes = await post(`/api/v2/events/${BLOCKED_EVENT}/forms/register`, {
      name: 'Blocked',
    });
    expect(blockedRes.status).toBe(403);
    expect((await j(blockedRes)).code).toBe('FORM_DISABLED');

    // NORMAL_EVENT: still works (no override)
    const normalAfter = await post(`/api/v2/events/${NORMAL_EVENT}/forms/register`, {
      name: 'Normal 2',
    });
    expect(normalAfter.status).toBe(200);

    // Clean up
    await deleteEventFlag(BLOCKED_EVENT, 'forms.register');
  });

  test('removing event override restores global flag behavior', async () => {
    const EVENT = 'qa2-ent-remove-override';

    await applyTier('free');
    await setEventFlag(EVENT, 'forms.survey', true);

    // Override active → 200
    const withOverride = await post(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { q: 'with-override' },
    });
    expect(withOverride.status).toBe(200);

    // Remove override
    await deleteEventFlag(EVENT, 'forms.survey');

    // Override removed → falls back to global free-tier OFF → 403
    const withoutOverride = await post(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { q: 'without-override' },
    });
    expect(withoutOverride.status).toBe(403);
    expect((await j(withoutOverride)).code).toBe('FORM_DISABLED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GATE-5: All 4 tiers × all 4 form types — full matrix
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-2 Gate-5: Full tier × form-type gating matrix', () => {
  type GatingMatrix = {
    tier: string;
    register: number;
    checkin: number;
    survey: number;
    emailSignup: number;
  };

  const matrix: GatingMatrix[] = [
    { tier: 'free', register: 200, checkin: 200, survey: 403, emailSignup: 403 },
    { tier: 'mid', register: 200, checkin: 200, survey: 200, emailSignup: 200 },
    { tier: 'enterprise', register: 200, checkin: 200, survey: 200, emailSignup: 200 },
  ];

  for (const row of matrix) {
    test(`${row.tier} tier: register=${row.register} checkin=${row.checkin} survey=${row.survey} email-signup=${row.emailSignup}`, async () => {
      const EVENT = `qa2-matrix-${row.tier}`;
      await applyTier(row.tier);

      const reg = await post(`/api/v2/events/${EVENT}/forms/register`, {
        name: 'Matrix Test',
      });
      expect(reg.status).toBe(row.register);

      const checkin = await post(`/api/v2/events/${EVENT}/forms/checkin`, {});
      expect(checkin.status).toBe(row.checkin);

      const survey = await post(`/api/v2/events/${EVENT}/forms/survey`, {
        responses: { q: 'matrix' },
      });
      expect(survey.status).toBe(row.survey);

      const email = await post(`/api/v2/events/${EVENT}/forms/email-signup`, {
        email: `matrix-${row.tier}@qa2.test`,
      });
      expect(email.status).toBe(row.emailSignup);
    });
  }

  // Reset after matrix tests
  test('reset to free tier baseline after matrix tests', async () => {
    await applyTier('free');
    const res = await post('/api/v2/events/qa2-reset-check/forms/register', { name: 'Reset' });
    expect(res.status).toBe(200);
  });
});
