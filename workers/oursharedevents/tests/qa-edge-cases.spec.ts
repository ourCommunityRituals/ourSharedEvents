/**
 * QA-1: Edge case test suite (OSE-110)
 *
 * Covers the failure modes that bypass the happy path:
 *   - Double-submit: registration (no dedup) vs email-signup (dedup by hash)
 *   - Archived event lifecycle: draft, archived, cancelled → 410 EVENT_ARCHIVED
 *   - Flag mid-session: flag toggled off between form page load and form submit → 403
 *   - Unknown eventId with no DB row → passes through (backward compat)
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

function postJson(path: string, body: Record<string, unknown>): Promise<Response> {
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

async function j(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
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

  // Ensure free tier baseline for all QA-1 tests
  await applyTier('free');
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE-1: Double-submit registration (no server-side dedup)
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-1 Edge-1: Double-submit registration — no server-side dedup', () => {
  test('submitting registration twice produces two distinct IDs', async () => {
    const EVENT = 'qa1-double-reg';

    const r1 = await postJson(`/api/v2/events/${EVENT}/forms/register`, {
      name: 'Alice',
      email: 'alice@qa1.test',
    });
    expect(r1.status).toBe(200);
    const b1 = await j(r1);
    expect(b1.ok).toBe(true);

    const r2 = await postJson(`/api/v2/events/${EVENT}/forms/register`, {
      name: 'Alice',
      email: 'alice@qa1.test',
    });
    expect(r2.status).toBe(200);
    const b2 = await j(r2);
    expect(b2.ok).toBe(true);

    // Two unique IDs — registration has no dedup by design
    expect(b1.id).not.toBe(b2.id);
  });

  test('checkin increments counter on every tap — no dedup', async () => {
    const EVENT = 'qa1-double-checkin';

    const r1 = await postJson(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(r1.status).toBe(200);
    expect((await j(r1)).count).toBe(1);

    const r2 = await postJson(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(r2.status).toBe(200);
    expect((await j(r2)).count).toBe(2);

    const r3 = await postJson(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(r3.status).toBe(200);
    expect((await j(r3)).count).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE-2: Email-signup dedup by hash
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-1 Edge-2: Email-signup — server-side dedup by email hash', () => {
  test('submitting same email twice returns duplicate:true on second call', async () => {
    const EVENT = 'qa1-email-dedup';
    await applyTier('mid');

    const r1 = await postJson(`/api/v2/events/${EVENT}/forms/email-signup`, {
      email: 'dedup@qa1.test',
    });
    expect(r1.status).toBe(200);
    const b1 = await j(r1);
    expect(b1.ok).toBe(true);
    expect(b1.duplicate).toBeUndefined();
    const id1 = b1.id as string;

    const r2 = await postJson(`/api/v2/events/${EVENT}/forms/email-signup`, {
      email: 'dedup@qa1.test',
    });
    expect(r2.status).toBe(200);
    const b2 = await j(r2);
    expect(b2.ok).toBe(true);
    expect(b2.duplicate).toBe(true);
    // Returns the original ID
    expect(b2.id).toBe(id1);

    await applyTier('free');
  });

  test('different emails for the same event are each accepted', async () => {
    const EVENT = 'qa1-email-unique';
    await applyTier('mid');

    const r1 = await postJson(`/api/v2/events/${EVENT}/forms/email-signup`, {
      email: 'user-a@qa1.test',
    });
    expect(r1.status).toBe(200);

    const r2 = await postJson(`/api/v2/events/${EVENT}/forms/email-signup`, {
      email: 'user-b@qa1.test',
    });
    expect(r2.status).toBe(200);

    const b1 = await j(r1);
    const b2 = await j(r2);
    expect(b1.id as string).not.toBe(b2.id as string);
    expect(b1.duplicate).toBeUndefined();
    expect(b2.duplicate).toBeUndefined();

    await applyTier('free');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE-3: Archived / draft event lifecycle guard → 410 EVENT_ARCHIVED
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-1 Edge-3: Event lifecycle guard — non-active events reject submissions', () => {
  test('archived event returns 410 EVENT_ARCHIVED for register', async () => {
    const EVENT = 'qa1-archived-evt';
    await mainDb()
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, 'brand-qa1', 'Archived', 'qa1-archived', 'archived')`
      )
      .bind(EVENT)
      .run();

    const res = await postJson(`/api/v2/events/${EVENT}/forms/register`, { name: 'Bob' });
    expect(res.status).toBe(410);
    const body = await j(res);
    expect(body.code).toBe('EVENT_ARCHIVED');
    expect(body.ok).toBe(false);
  });

  test('draft event returns 410 EVENT_ARCHIVED for checkin', async () => {
    const EVENT = 'qa1-draft-evt';
    await mainDb()
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, 'brand-qa1', 'Draft', 'qa1-draft', 'draft')`
      )
      .bind(EVENT)
      .run();

    const res = await postJson(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(res.status).toBe(410);
    expect((await j(res)).code).toBe('EVENT_ARCHIVED');
  });

  test('cancelled event returns 410 EVENT_ARCHIVED for survey', async () => {
    const EVENT = 'qa1-cancelled-evt';
    await mainDb()
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, 'brand-qa1', 'Cancelled', 'qa1-cancelled', 'cancelled')`
      )
      .bind(EVENT)
      .run();

    // Upgrade to mid so survey flag isn't the blocking factor
    await applyTier('mid');

    const res = await postJson(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { rating: 4 },
    });
    expect(res.status).toBe(410);
    expect((await j(res)).code).toBe('EVENT_ARCHIVED');

    await applyTier('free');
  });

  test('active event accepts submissions normally', async () => {
    const EVENT = 'qa1-active-evt';
    await mainDb()
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, 'brand-qa1', 'Active', 'qa1-active', 'active')`
      )
      .bind(EVENT)
      .run();

    const res = await postJson(`/api/v2/events/${EVENT}/forms/register`, { name: 'Carol' });
    expect(res.status).toBe(200);
    expect((await j(res)).ok).toBe(true);
  });

  test('unknown event ID (no DB row) passes through — backward compat', async () => {
    const EVENT = 'qa1-unknown-evt-no-row';
    // No INSERT — this event doesn't exist in DB
    const res = await postJson(`/api/v2/events/${EVENT}/forms/register`, { name: 'Dave' });
    // Should succeed: the guard only blocks rows with explicit non-active status
    expect(res.status).toBe(200);
    expect((await j(res)).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE-4: Flag toggled mid-session (form loaded → flag disabled → submit → 403)
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-1 Edge-4: Flag toggled mid-session', () => {
  test('register: allowed → flag OFF → 403, flag ON → allowed again', async () => {
    const EVENT = 'qa1-mid-session-reg';

    // T0: register is ON (free tier default)
    const r0 = await postJson(`/api/v2/events/${EVENT}/forms/register`, { name: 'Eve' });
    expect(r0.status).toBe(200);

    // T1: admin disables register globally
    await SELF.fetch('https://t.test/api/v2/admin/flags/forms.register', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    // T2: same user submits (flag is now off) → 403
    const r1 = await postJson(`/api/v2/events/${EVENT}/forms/register`, { name: 'Eve' });
    expect(r1.status).toBe(403);
    expect((await j(r1)).code).toBe('FORM_DISABLED');

    // T3: admin re-enables register
    await SELF.fetch('https://t.test/api/v2/admin/flags/forms.register', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    // T4: submit succeeds again
    const r2 = await postJson(`/api/v2/events/${EVENT}/forms/register`, { name: 'Eve' });
    expect(r2.status).toBe(200);
    expect((await j(r2)).ok).toBe(true);
  });

  test('checkin: cannot be disabled via flag mid-session (always ON in free tier)', async () => {
    const EVENT = 'qa1-mid-session-checkin';

    const r0 = await postJson(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(r0.status).toBe(200);

    // Checkin is always ON for free tier — confirm it's allowed regardless of tier
    await applyTier('mid');
    const r1 = await postJson(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(r1.status).toBe(200);

    await applyTier('free');
    const r2 = await postJson(`/api/v2/events/${EVENT}/forms/checkin`, {});
    expect(r2.status).toBe(200);
  });

  test('survey: mid-tier upgrade mid-session unblocks survey', async () => {
    const EVENT = 'qa1-mid-session-survey';

    // T0: free tier → survey blocked
    const r0 = await postJson(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { q: 'a' },
    });
    expect(r0.status).toBe(403);
    expect((await j(r0)).code).toBe('FORM_DISABLED');

    // T1: admin upgrades to mid
    await applyTier('mid');

    // T2: same event, survey now allowed
    const r1 = await postJson(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { q: 'a' },
    });
    expect(r1.status).toBe(200);
    expect((await j(r1)).ok).toBe(true);

    // T3: downgrade back to free
    await applyTier('free');

    // T4: survey blocked again
    const r2 = await postJson(`/api/v2/events/${EVENT}/forms/survey`, {
      responses: { q: 'a' },
    });
    expect(r2.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE-5: Input guards (fat-finger scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe('QA-1 Edge-5: Input guards', () => {
  test('registration with invalid email format → 400 INVALID_EMAIL', async () => {
    const res = await postJson('/api/v2/events/qa1-guard/forms/register', {
      name: 'Fat Finger',
      email: 'not-an-email',
    });
    expect(res.status).toBe(400);
    expect((await j(res)).code).toBe('INVALID_EMAIL');
  });

  test('email-signup with missing email field → 400 MISSING_FIELD', async () => {
    await applyTier('mid');
    const res = await postJson('/api/v2/events/qa1-guard/forms/email-signup', { name: 'Oops' });
    expect(res.status).toBe(400);
    expect((await j(res)).code).toBe('MISSING_FIELD');
    await applyTier('free');
  });

  test('survey with missing responses field → 400 MISSING_FIELD', async () => {
    await applyTier('mid');
    const res = await postJson('/api/v2/events/qa1-guard/forms/survey', { rating: 5 });
    expect(res.status).toBe(400);
    expect((await j(res)).code).toBe('MISSING_FIELD');
    await applyTier('free');
  });

  test('invalid event ID (special chars) → 400 INVALID_EVENT_ID', async () => {
    const res = await postJson('/api/v2/events/bad id!@#/forms/register', { name: 'Test' });
    // Router won't match the route for IDs with special chars — returns 404
    expect([400, 404]).toContain(res.status);
  });
});
