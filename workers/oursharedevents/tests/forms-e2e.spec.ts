/**
 * Forms E2E Mock Processing Tests
 *
 * Exercises the entire form service end-to-end: handler → D1 → response → DB
 * verification. Each scenario runs the full lifecycle in a SINGLE test to
 * match D1's per-test isolation in vitest-pool-workers.
 *
 *   Scenario 1: Registration — submit → admin reads → lifecycle destroys
 *   Scenario 2: Check-in     — tap 5 times → verify count → verify zero PII in DB
 *   Scenario 3: Survey       — submit with PII → admin blocked → scrub → admin reads
 *   Scenario 4: Email signup — submit → dedup → count → verify encryption → lifecycle
 *   Scenario 5: Auth gates   — admin endpoints reject without token (via SELF.fetch)
 *   Scenario 6: Input guards — bad payloads, invalid event IDs
 *   Scenario 7: Cross-layer  — data from one layer never leaks to another
 *   Scenario 8: Tier gating  — free blocks survey, mid allows, downgrade re-blocks
 *   Scenario 8b: Enterprise  — event override allows survey for one event, blocks others
 *   Scenario 9: Existing routes — health, public page, 404 still work (via SELF.fetch)
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  handleFormRegistration,
  handleFormCheckin,
  handleFormSurvey,
  handleFormEmailSignup,
  handleAdminRegistrations,
  handleAdminCheckinCount,
  handleAdminSurveys,
  handleAdminEmailSignupCount,
  type FormsEnv,
} from '../src/handlers/forms';

// ── Test env ─────────────────────────────────────────────────────────────────

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const MOCK_ADMIN_KEY = 'test-admin-key-e2e-2026';

const tenv = () => env as unknown as TestEnv;
const formsEnv = (): FormsEnv => env as unknown as FormsEnv;
const formsDb = () => tenv().FORMS_DB;
const mainDb = () => tenv().DB;

function postReq(body: Record<string, unknown>): Request {
  return new Request('https://e2e.test/form', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(): Request {
  return new Request('https://e2e.test/admin');
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

// OSE-1270: survey/email-signup now require an EXISTING, Phase-2-cleared event
// (a missing event fails closed). The tier-gating scenarios below submit survey/
// email on paid tiers to prove FLAG gating; seed those events as cleared so the
// PHASE gate passes. Free-tier events keep unique un-seeded ids → FORM_DISABLED.
async function seedClearedEvent(id: string): Promise<void> {
  await mainDb()
    .prepare(
      `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, legal_clearance_tier, created_at, updated_at)
       VALUES (?, 'ose', ?, ?, 'active', 2, datetime('now'), datetime('now'))`
    )
    .bind(id, `Cleared ${id}`, id)
    .run();
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await mainDb().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }

  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await formsDb().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }

  // OSE-1270: seed cleared events for the paid-tier survey/email scenarios
  // (Scenario 8 tier-gate + the enterprise override) so the phase gate passes.
  await seedClearedEvent('evt-tier-gate');
  await seedClearedEvent('evt-enterprise-e2e');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Registration — Full Lifecycle in Single Test
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 1: Registration lifecycle', () => {
  test('submit → admin reads (hashed email, source tracked) → lifecycle destroys expired', async () => {
    const EVENT = 'evt-reg-e2e';

    // ── Step 1: Customer submits registration ─────────────────────────────
    const submitRes = await handleFormRegistration(
      postReq({
        name: 'Alice Johnson',
        email: 'alice@example.com',
        sourcePlacementId: 'poster-lobby-01',
      }),
      formsEnv(),
      EVENT
    );
    expect(submitRes.status).toBe(200);
    const submitBody = await json(submitRes);
    expect(submitBody.ok).toBe(true);
    expect(submitBody.id).toBeDefined();
    expect((submitBody.registrationBucket as string).length).toBe(13);
    const regId = submitBody.id as string;

    // ── Step 2: Admin reads — sees entry with hashed email ────────────────
    const adminRes = await handleAdminRegistrations(getReq(), formsEnv(), EVENT);
    const adminBody = await json(adminRes);
    // OSE-665: the aggregate count is floored uniformly (K=5) — a single
    // registration is suppressed. The organizer's first-party `items` list is
    // still exact, so the write is verified by the row below.
    expect(adminBody.suppressed).toBe(true);
    expect(adminBody.count).toBeNull();
    const items = adminBody.items as Record<string, unknown>[];
    expect(items[0].id).toBe(regId);
    expect(items[0].attendee_name).toBe('Alice Johnson');
    expect(items[0].attendee_email_hash).not.toBe('alice@example.com');
    expect((items[0].attendee_email_hash as string).length).toBe(64);
    expect(items[0].source_placement_id).toBe('poster-lobby-01');

    // ── Step 3: DB verification — raw email never stored ──────────────────
    const row = await formsDb()
      .prepare('SELECT * FROM form_registrations WHERE id = ?')
      .bind(regId)
      .first();
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain('alice@example.com');
    expect(row!.expires_at).not.toBeNull(); // server-computed

    // ── Step 4: Add active registration, backdate original, run lifecycle ──
    await handleFormRegistration(postReq({ name: 'Active Person' }), formsEnv(), EVENT);

    await formsDb()
      .prepare('UPDATE form_registrations SET expires_at = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', regId)
      .run();

    await formsDb()
      .prepare('DELETE FROM form_registrations WHERE expires_at IS NOT NULL AND expires_at < ?')
      .bind(new Date().toISOString())
      .run();

    // Expired gone, active remains
    const expired = await formsDb()
      .prepare('SELECT id FROM form_registrations WHERE id = ?')
      .bind(regId)
      .first();
    expect(expired).toBeNull();

    const remaining = await handleAdminRegistrations(getReq(), formsEnv(), EVENT);
    const remainingBody = await json(remaining);
    // OSE-665: one row remains — the exact first-party items list proves it;
    // the aggregate count is floored (suppressed) below K=5.
    expect((remainingBody.items as unknown[]).length).toBe(1);
    expect(remainingBody.suppressed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Check-in — Zero PII Counter
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 2: Check-in lifecycle', () => {
  test('5 taps → counter = 5 → admin reads 5 → DB has zero PII', async () => {
    const EVENT = 'evt-checkin-e2e';

    // ── 5 check-in taps ───────────────────────────────────────────────────
    for (let i = 1; i <= 5; i++) {
      const res = await handleFormCheckin(postReq({}), formsEnv(), EVENT);
      const body = await json(res);
      expect(body.ok).toBe(true);
      expect(body.count).toBe(i);
    }

    // ── Admin reads count ─────────────────────────────────────────────────
    const adminRes = await handleAdminCheckinCount(getReq(), formsEnv(), EVENT);
    const adminBody = await json(adminRes);
    expect(adminBody.count).toBe(5);

    // ── DB verification: 1 row, 6 columns, zero PII ──────────────────────
    const rows = await formsDb()
      .prepare('SELECT * FROM checkin_counts WHERE event_id = ?')
      .bind(EVENT)
      .all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].total_count).toBe(5);
    // OSE-1373: plain taps declare no arrival path, so none count as walk-ins.
    expect(rows.results[0].walk_in_count).toBe(0);
    expect(Object.keys(rows.results[0]).sort()).toEqual([
      'event_id',
      'id',
      'last_anonymous_id',
      'total_count',
      'updated_at',
      'walk_in_count',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Survey — PII Scrub Gate
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 3: Survey lifecycle with PII scrub', () => {
  test('submit PII → admin blocked → scrub → admin reads (ratings kept, PII gone)', async () => {
    const EVENT = 'evt-survey-e2e';
    // Whitelist approach — safe keys kept, all other strings scrubbed
    const SAFE_KEYS =
      /^(rating|score|count|number|rank|order|id|uuid|type|category|topic|session|duration|index|overall|venue|speaker|event|quality|value|level|tier|scale|stars?|thumbs?).*$/i;

    // ── Step 1: Submit survey with PII (including tricky variants) ────────
    const submitRes = await handleFormSurvey(
      postReq({
        responses: {
          overall_rating: 5,
          venue_rating: 4,
          name: 'Bob Smith',
          email: 'bob@example.com',
          comments: 'Amazing event!',
          speaker_quality: 3,
          first_name: 'Bob',
          attendee_phone: '555-1234',
        },
      }),
      formsEnv(),
      EVENT
    );
    const submitBody = await json(submitRes);
    expect(submitBody.ok).toBe(true);
    const surveyId = submitBody.id as string;

    // ── Step 2: Admin blocked — pii_scrubbed = 0 ──────────────────────────
    // No scrubbed surveys are visible; the floored count suppresses the sub-5
    // aggregate, and the items list is empty (the real "blocked" assertion).
    const blockedRes = await handleAdminSurveys(getReq(), formsEnv(), EVENT);
    const blockedBody = await json(blockedRes);
    expect((blockedBody.items as unknown[]).length).toBe(0);
    expect(blockedBody.suppressed).toBe(true);

    // ── Step 3: Verify raw PII is in DB ───────────────────────────────────
    const before = await formsDb()
      .prepare('SELECT responses_json, pii_scrubbed FROM form_surveys WHERE id = ?')
      .bind(surveyId)
      .first<{ responses_json: string; pii_scrubbed: number }>();
    expect(before!.pii_scrubbed).toBe(0);
    expect(JSON.parse(before!.responses_json).name).toBe('Bob Smith');

    // ── Step 4: Run lifecycle PII scrub ───────────────────────────────────
    const unscrubbed = await formsDb()
      .prepare(
        'SELECT id, responses_json FROM form_surveys WHERE pii_scrubbed = 0 AND created_at < ?'
      )
      .bind(new Date().toISOString())
      .all();

    for (const row of unscrubbed.results ?? []) {
      const parsed = JSON.parse(row.responses_json as string) as Record<string, unknown>;
      const scrubbed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' || typeof value === 'boolean') {
          scrubbed[key] = value;
        } else if (SAFE_KEYS.test(key)) {
          scrubbed[key] = value;
        } else if (typeof value === 'string') {
          scrubbed[key] = '[SCRUBBED]';
        } else {
          scrubbed[key] = value;
        }
      }
      await formsDb()
        .prepare('UPDATE form_surveys SET responses_json = ?, pii_scrubbed = 1 WHERE id = ?')
        .bind(JSON.stringify(scrubbed), row.id as string)
        .run();
    }

    // ── Step 5: Verify scrub — PII gone, ratings preserved ────────────────
    const after = await formsDb()
      .prepare('SELECT responses_json, pii_scrubbed FROM form_surveys WHERE id = ?')
      .bind(surveyId)
      .first<{ responses_json: string; pii_scrubbed: number }>();
    expect(after!.pii_scrubbed).toBe(1);
    const data = JSON.parse(after!.responses_json);
    expect(data.name).toBe('[SCRUBBED]');
    expect(data.email).toBe('[SCRUBBED]');
    expect(data.comments).toBe('[SCRUBBED]');
    expect(data.first_name).toBe('[SCRUBBED]'); // Whitelist catches variants
    expect(data.attendee_phone).toBe('[SCRUBBED]'); // Whitelist catches variants
    expect(data.overall_rating).toBe(5); // Numeric — always safe
    expect(data.venue_rating).toBe(4); // Numeric — always safe
    expect(data.speaker_quality).toBe(3); // Numeric — always safe

    // ── Step 6: Admin NOW reads — ratings intact, PII gone ────────────────
    const visibleRes = await handleAdminSurveys(getReq(), formsEnv(), EVENT);
    const visibleBody = await json(visibleRes);
    // OSE-665: the scrubbed survey is now visible in the first-party items list;
    // the aggregate count is floored (suppressed) below K=5.
    expect((visibleBody.items as unknown[]).length).toBe(1);
    expect(visibleBody.suppressed).toBe(true);
    const fullStr = JSON.stringify(visibleBody);
    expect(fullStr).not.toContain('Bob Smith');
    expect(fullStr).not.toContain('bob@example.com');
    expect(fullStr).not.toContain('Amazing event');
    expect(fullStr).toContain('overall_rating');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Email Signup — Encryption + Dedup + Retention
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 4: Email signup lifecycle', () => {
  test('submit → dedup → case-insensitive dedup → count → verify encryption → lifecycle deletes', async () => {
    const EVENT = 'evt-email-e2e';

    // ── Step 1: First signup ──────────────────────────────────────────────
    const r1 = await handleFormEmailSignup(
      postReq({ email: 'carol@example.com' }),
      formsEnv(),
      EVENT
    );
    const b1 = await json(r1);
    expect(b1.ok).toBe(true);
    expect(b1.duplicate).toBeUndefined();

    // ── Step 2: Same email → dedup ────────────────────────────────────────
    const r2 = await handleFormEmailSignup(
      postReq({ email: 'carol@example.com' }),
      formsEnv(),
      EVENT
    );
    const b2 = await json(r2);
    expect(b2.ok).toBe(true);
    expect(b2.duplicate).toBe(true);

    // ── Step 3: Case-insensitive dedup ────────────────────────────────────
    const r3 = await handleFormEmailSignup(
      postReq({ email: 'CAROL@Example.COM' }),
      formsEnv(),
      EVENT
    );
    expect((await json(r3)).duplicate).toBe(true);

    // ── Step 4: Different email → new signup ──────────────────────────────
    const r4 = await handleFormEmailSignup(
      postReq({ email: 'dave@example.com' }),
      formsEnv(),
      EVENT
    );
    expect((await json(r4)).duplicate).toBeUndefined();

    // ── Step 5: Admin count floored (2 unique < 5) ────────────────────────
    // Dedup is verified by r4.duplicate above + the DB rows below; the aggregate
    // count is suppressed uniformly (K=5).
    const adminRes = await handleAdminEmailSignupCount(getReq(), formsEnv(), EVENT);
    const emailCountBody = await json(adminRes);
    expect(emailCountBody.suppressed).toBe(true);
    expect(emailCountBody.count).toBeNull();

    // ── Step 6: DB verification — encrypted, not plaintext ────────────────
    const rows = await formsDb()
      .prepare('SELECT * FROM email_signups WHERE event_id = ?')
      .bind(EVENT)
      .all();
    expect(rows.results).toHaveLength(2);
    for (const row of rows.results) {
      const rowStr = JSON.stringify(row);
      expect(rowStr).not.toContain('carol@example.com');
      expect(rowStr).not.toContain('dave@example.com');
      expect((row.email_encrypted as string).length).toBeGreaterThan(30);
      expect((row.email_hash as string).length).toBe(64);
      expect(row.retention_expires_at).toBeDefined();
    }

    // ── Step 7: Lifecycle deletes past retention ──────────────────────────
    await formsDb()
      .prepare(
        "UPDATE email_signups SET retention_expires_at = '2020-01-01T00:00:00.000Z' WHERE event_id = ?"
      )
      .bind(EVENT)
      .run();

    await formsDb()
      .prepare('DELETE FROM email_signups WHERE retention_expires_at < ?')
      .bind(new Date().toISOString())
      .run();

    // OSE-665: 0 is below the floor → the endpoint suppresses (count null), so
    // deletion is verified directly against the DB (the true 0-row proof).
    const remainingRows = await formsDb()
      .prepare('SELECT COUNT(*) AS n FROM email_signups WHERE event_id = ?')
      .bind(EVENT)
      .first<{ n: number }>();
    expect(remainingRows?.n).toBe(0);
    const afterDelete = await handleAdminEmailSignupCount(getReq(), formsEnv(), EVENT);
    const afterDeleteBody = await json(afterDelete);
    expect(afterDeleteBody.suppressed).toBe(true);
    expect(afterDeleteBody.count).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Auth Gates (via SELF.fetch)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 5: Auth enforcement', () => {
  test('admin form endpoints reject without auth, accept with correct token', async () => {
    const paths = ['registrations', 'checkin-count', 'surveys', 'email-signups'];
    for (const p of paths) {
      const noAuth = await SELF.fetch(`https://t.test/api/v2/admin/events/evt-auth/forms/${p}`);
      expect(noAuth.status).toBe(401);
    }

    const wrongToken = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt-auth/forms/registrations',
      {
        headers: { Authorization: 'Bearer wrong-token' },
      }
    );
    expect(wrongToken.status).toBe(401);

    const rightToken = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt-auth/forms/registrations',
      {
        headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}` },
      }
    );
    expect(rightToken.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Input Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 6: Input guards', () => {
  test('invalid JSON → 400', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events/evt-guard/forms/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json {{{',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('INVALID_BODY');
  });

  test('invalid event ID → 400', async () => {
    const res = await handleFormRegistration(postReq({ name: 'Test' }), formsEnv(), 'evt"OR"1"="1');
    expect((await json(res)).code).toBe('INVALID_EVENT_ID');
  });

  test('survey missing responses → 400', async () => {
    const res = await handleFormSurvey(postReq({ rating: 5 }), formsEnv(), 'evt-guard');
    expect((await json(res)).code).toBe('MISSING_FIELD');
  });

  test('email signup missing email → 400', async () => {
    const res = await handleFormEmailSignup(postReq({}), formsEnv(), 'evt-guard');
    expect((await json(res)).code).toBe('MISSING_FIELD');
  });

  test('POST to nonexistent form type → 405 (OSE-214: public read-only guard blocks unrecognised form types)', async () => {
    // OSE-214: guardPublicReadOnly only exempts known form types (register/checkin/survey/email-signup).
    // An unrecognised form type is not in the exemption list, so the guard returns 405 before the
    // router can return 404. 405 is acceptable here — no information is disclosed about unknown types.
    const res = await SELF.fetch('https://t.test/api/v2/events/evt-x/forms/nonexistent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(405);
  });

  test('GET to public form route → 404 (POST only)', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events/evt-x/forms/register');
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 7: Cross-Layer Data Isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 7: Cross-layer data isolation', () => {
  test('4 layers for same event — data stays in correct tables, main DB untouched', async () => {
    const EVENT = 'evt-iso-e2e';

    await handleFormRegistration(
      postReq({ name: 'Iso Test', email: 'iso@test.com' }),
      formsEnv(),
      EVENT
    );
    await handleFormCheckin(postReq({}), formsEnv(), EVENT);
    await handleFormSurvey(
      postReq({ responses: { rating: 5, name: 'Survey Person' } }),
      formsEnv(),
      EVENT
    );
    await handleFormEmailSignup(postReq({ email: 'iso-email@test.com' }), formsEnv(), EVENT);

    // Each layer has exactly 1 entry
    const reg = await formsDb()
      .prepare('SELECT COUNT(*) as cnt FROM form_registrations WHERE event_id = ?')
      .bind(EVENT)
      .first<{ cnt: number }>();
    expect(reg!.cnt).toBe(1);

    const cc = await formsDb()
      .prepare('SELECT total_count FROM checkin_counts WHERE event_id = ?')
      .bind(EVENT)
      .first<{ total_count: number }>();
    expect(cc!.total_count).toBe(1);

    const srv = await formsDb()
      .prepare('SELECT COUNT(*) as cnt FROM form_surveys WHERE event_id = ?')
      .bind(EVENT)
      .first<{ cnt: number }>();
    expect(srv!.cnt).toBe(1);

    const es = await formsDb()
      .prepare('SELECT COUNT(*) as cnt FROM email_signups WHERE event_id = ?')
      .bind(EVENT)
      .first<{ cnt: number }>();
    expect(es!.cnt).toBe(1);

    // Registration name NOT in survey or email tables
    const surveyLeak = await formsDb()
      .prepare("SELECT COUNT(*) as cnt FROM form_surveys WHERE responses_json LIKE '%Iso Test%'")
      .first<{ cnt: number }>();
    expect(surveyLeak!.cnt).toBe(0);

    // Main DB has zero form tables
    const mainTables = await mainDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
      )
      .all();
    const names = mainTables.results.map((r: Record<string, unknown>) => r.name);
    expect(names).not.toContain('form_registrations');
    expect(names).not.toContain('checkin_counts');
    expect(names).not.toContain('form_surveys');
    expect(names).not.toContain('email_signups');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 8: Tier-Gating E2E — Free Can't Survey, Mid Can
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 8: Tier gating — free tier blocks survey, mid tier allows it', () => {
  test('free tier → POST survey 403 FORM_DISABLED, mid tier → POST survey 200, downgrade → 403 again', async () => {
    const EVENT = 'evt-tier-gate';

    // ── Free tier: survey is OFF (seeded by migration 0007) ──────────────
    const freeRes = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/forms/survey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses: { rating: 5 } }),
    });
    expect(freeRes.status).toBe(403);
    const freeBody = await json(freeRes);
    expect(freeBody.code).toBe('FORM_DISABLED');

    // ── Free tier: register IS allowed ───────────────────────────────────
    const regRes = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/forms/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tier Test' }),
    });
    expect(regRes.status).toBe(200);

    // ── Upgrade to mid tier ──────────────────────────────────────────────
    const upgradeRes = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'mid' }),
    });
    expect(upgradeRes.status).toBe(200);

    // ── Mid tier: survey now allowed ─────────────────────────────────────
    const midRes = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/forms/survey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses: { rating: 5 } }),
    });
    expect(midRes.status).toBe(200);
    expect((await json(midRes)).ok).toBe(true);

    // ── Mid tier: email-signup also allowed ──────────────────────────────
    const emailRes = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/forms/email-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'tier@test.com' }),
    });
    expect(emailRes.status).toBe(200);

    // ── Downgrade back to free ───────────────────────────────────────────
    await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'free' }),
    });

    // ── Free tier again: survey blocked ──────────────────────────────────
    const downgradeRes = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/forms/survey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses: { rating: 5 } }),
    });
    expect(downgradeRes.status).toBe(403);
    expect((await json(downgradeRes)).code).toBe('FORM_DISABLED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 8b: Enterprise Event Override E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 8b: Enterprise event override — global OFF, event ON', () => {
  test('free tier blocks survey globally, but enterprise event override allows it for one event', async () => {
    const EVENT_ENTERPRISE = 'evt-enterprise-e2e';
    const EVENT_FREE = 'evt-free-e2e';

    // ── Ensure free tier (survey globally OFF) ───────────────────────────
    await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'free' }),
    });

    // ── Set event-level override: survey ON for enterprise event ─────────
    await SELF.fetch(`https://t.test/api/v2/admin/events/${EVENT_ENTERPRISE}/flags/forms.survey`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    // ── Enterprise event: survey ALLOWED (event override) ────────────────
    const entRes = await SELF.fetch(
      `https://t.test/api/v2/events/${EVENT_ENTERPRISE}/forms/survey`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: { rating: 5 } }),
      }
    );
    expect(entRes.status).toBe(200);

    // ── Free event: survey BLOCKED (no override, global OFF) ─────────────
    const freeRes = await SELF.fetch(`https://t.test/api/v2/events/${EVENT_FREE}/forms/survey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses: { rating: 5 } }),
    });
    expect(freeRes.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 10: Full Organizer Flow — QA-4
//   admin creates event → configure tier → QR scan → customer submits → admin verifies
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 10: Full organizer flow (QA-4 — admin→configure→QR→submit→verify)', () => {
  test('create event → apply mid tier → QR scan renders form → submit → admin verifies count=1', async () => {
    // ── Step 1: Admin creates event ──────────────────────────────────────
    const createRes = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MOCK_ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'QA Flow Event', status: 'active' }),
    });
    expect(createRes.status).toBe(201);
    const createBody = await json(createRes);
    expect(createBody.ok).toBe(true);
    const eventId = createBody.id as string;
    expect(eventId).toMatch(/^evt_/);

    // ── Step 2: Admin configures — apply mid tier ──────────────────────
    // Mid tier enables: forms.register, forms.survey, forms.email-signup
    const configRes = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MOCK_ADMIN_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tier: 'mid' }),
    });
    expect(configRes.status).toBe(200);
    const configBody = await json(configRes);
    expect(configBody.tier).toBe('mid');
    expect(configBody.ok).toBe(true);

    // ── Step 3: QR scan — attendee scans code, form page loads ────────
    const formRes = await SELF.fetch(
      `https://t.test/forms/${eventId}?type=register&event=QA+Flow+Event`
    );
    expect(formRes.status).toBe(200);
    expect(formRes.headers.get('Content-Type')).toContain('text/html');
    const formHtml = await formRes.text();
    expect(formHtml).toContain('data-testid="form-register"');
    expect(formHtml).toContain('QA Flow Event');

    // ── Step 4: Customer submits registration ──────────────────────────
    const submitRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Flow Test Attendee', email: 'flow@test.com' }),
    });
    expect(submitRes.status).toBe(200);
    const submitBody = await json(submitRes);
    expect(submitBody.ok).toBe(true);
    expect(submitBody.id).toBeDefined();

    // ── Step 5: Admin verifies count = 1 ─────────────────────────────
    const adminRes = await SELF.fetch(
      `https://t.test/api/v2/admin/events/${eventId}/forms/registrations`,
      { headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}` } }
    );
    expect(adminRes.status).toBe(200);
    const adminBody = await json(adminRes);
    // OSE-665: single registration → floored count; first-party items exact.
    expect(adminBody.suppressed).toBe(true);
    expect(adminBody.count).toBeNull();
    const items = adminBody.items as Record<string, unknown>[];
    expect(items[0].attendee_name).toBe('Flow Test Attendee');
    // Raw email must not be stored (hashed only)
    expect(JSON.stringify(items[0])).not.toContain('flow@test.com');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 9: Existing Routes (via SELF.fetch)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 9: Existing routes unaffected', () => {
  test('GET / → 200 HTML, /health → 200 JSON, /nonexistent → 404, OPTIONS → 204 CORS', async () => {
    const home = await SELF.fetch('https://t.test/');
    expect(home.status).toBe(200);
    expect(home.headers.get('Content-Type')).toContain('text/html');
    expect(await home.text()).toContain('OurSharedEvents');

    const health = await SELF.fetch('https://t.test/health');
    expect(health.status).toBe(200);
    expect((await json(health)).env).toBe('test');

    const notFound = await SELF.fetch('https://t.test/nonexistent');
    expect(notFound.status).toBe(404);

    const cors = await SELF.fetch('https://t.test/api/v2/events/x/forms/register', {
      method: 'OPTIONS',
    });
    expect(cors.status).toBe(204);
    expect(cors.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
