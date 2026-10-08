/**
 * The forms database holds no value that can be joined to the scan tables.
 *
 * The `ose_anon` cookie value (`anon_<uuid>`) is what the scan path stores in
 * `scan_node_returns.anonymous_id` (main DB). The forms path used to store the
 * same raw value beside named form data (FORMS_DB), so anyone who could read
 * both databases could join a named registration to that browser's scan history.
 *
 * Owner decision (2026-10-07): FORMS_DB keeps an id, but a PER-EVENT KEYED one —
 * a keyed hash of the anonymous id and the event id. It equals nothing in the
 * main DB, differs from event to event, and is stable inside one event (so
 * check-in can still recognise the same phone).
 *
 * Every test drives the real Worker (`SELF.fetch`): one cookie scans a poster
 * (`GET /q/<token>`) and submits all four form types for the same event. The
 * assertions then read BOTH databases, which only a test may do.
 *
 * Format: `<LAYER> | <what> | <assertion>`.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, vi, afterEach } from 'vitest';
import {
  handleFormRegistration,
  handleFormCheckin,
  handleFormSurvey,
  handleFormEmailSignup,
  type FormsEnv,
} from '../src/handlers/forms';
import { findAnonIdsLinkedToEmailHash } from '../src/lib/erasure-anon-lookup';
import { hashEmail } from '../src/lib/forms-db';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  FORMS_HASH_PEPPER: string;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;
const mainDb = () => tenv().DB;
const formsDb = () => tenv().FORMS_DB;

const ADMIN_KEY = 'test-admin-key-e2e-2026';

/** The four FORMS_DB columns that hold the anonymous id. */
const FORMS_ANON_COLUMNS = [
  { table: 'form_registrations', column: 'anonymous_id' },
  { table: 'checkin_counts', column: 'last_anonymous_id' },
  { table: 'form_surveys', column: 'anonymous_id' },
  { table: 'email_signups', column: 'anonymous_id' },
] as const;

function newCookieValue(): string {
  return `anon_${crypto.randomUUID()}`;
}

async function applyAll(db: D1Database, statementsJson: string): Promise<void> {
  const stmts: string[] = JSON.parse(statementsJson);
  for (const stmt of stmts) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

/**
 * A fresh live event with one poster, so no test reads another test's rows.
 * Returns the event id and the poster's QR token.
 */
async function newEvent(): Promise<{ eventId: string; token: string }> {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const eventId = `evt-unlink-${suffix}`;
  const token = `qrt_unlink_${suffix}`;
  await seedEvent(eventId, token);
  return { eventId, token };
}

async function seedEvent(id: string, token: string): Promise<void> {
  // Phase 2 clearance: survey and email-signup are only taken for a cleared event.
  await mainDb()
    .prepare(
      `INSERT OR REPLACE INTO events
         (id, brand_id, title, slug, status, legal_clearance_tier, start_date, created_at, updated_at)
       VALUES (?, 'brand-test', ?, ?, 'active', 2, datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(id, `Unlinkable ${id}`, id)
    .run();
  await mainDb()
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments
         (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES (?, ?, ?, 'Unlinkable Poster', 1, datetime('now'))`
    )
    .bind(`pd-${id}`, id, token)
    .run();
}

beforeAll(async () => {
  await applyAll(mainDb(), tenv().TEST_MIGRATION_STATEMENTS);
  await applyAll(formsDb(), tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  // Survey and email signup are off on the free tier; switch them on.
  const tier = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'mid' }),
  });
  expect(tier.status).toBe(200);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Journey helpers (the real Worker, one cookie) ────────────────────────────

async function scan(cookieValue: string, token: string): Promise<void> {
  const res = await SELF.fetch(`https://t.test/q/${token}`, {
    redirect: 'manual',
    headers: { Cookie: `ose_anon=${cookieValue}`, 'User-Agent': 'unlinkable-spec' },
  });
  expect(res.status).toBe(302);
}

async function submit(
  cookieValue: string,
  eventId: string,
  form: 'register' | 'checkin' | 'survey' | 'email-signup',
  body?: Record<string, unknown>
): Promise<Response> {
  const res = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/${form}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `ose_anon=${cookieValue}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res;
}

/** All four form types for one event, with one cookie. Every one must be taken. */
async function submitAllForms(cookieValue: string, eventId: string, email: string): Promise<void> {
  const results = [
    await submit(cookieValue, eventId, 'register', { name: 'Pat Example', email }),
    await submit(cookieValue, eventId, 'checkin'),
    await submit(cookieValue, eventId, 'survey', { responses: { rating: 5 } }),
    await submit(cookieValue, eventId, 'email-signup', { email }),
  ];
  expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
}

// ── Reading both databases (test only) ───────────────────────────────────────

/** Every value of every column of every FORMS_DB table, as text. */
async function everyFormsDbValue(): Promise<Array<{ where: string; value: string }>> {
  const tables = await formsDb()
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
          AND name NOT LIKE 'd1_%'`
    )
    .all<{ name: string }>();
  const out: Array<{ where: string; value: string }> = [];
  for (const { name } of tables.results) {
    const rows = await formsDb().prepare(`SELECT * FROM ${name}`).all<Record<string, unknown>>();
    for (const row of rows.results) {
      for (const [column, value] of Object.entries(row)) {
        if (value === null || value === undefined) continue;
        out.push({ where: `${name}.${column}`, value: String(value) });
      }
    }
  }
  return out;
}

async function scanAnonymousIds(): Promise<string[]> {
  const rows = await mainDb()
    .prepare('SELECT anonymous_id FROM scan_node_returns WHERE anonymous_id IS NOT NULL')
    .all<{ anonymous_id: string }>();
  return rows.results.map((r) => r.anonymous_id);
}

async function storedFormsIds(eventId: string): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const { table, column } of FORMS_ANON_COLUMNS) {
    const row = await formsDb()
      .prepare(`SELECT ${column} AS v FROM ${table} WHERE event_id = ? LIMIT 1`)
      .bind(eventId)
      .first<{ v: string | null }>();
    out[`${table}.${column}`] = row ? row.v : null;
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. The cross-database join
// ═════════════════════════════════════════════════════════════════════════════

describe('cross-database: a scan and the four forms from one cookie share no value', () => {
  test('INTEGRATION | scan + register + check-in + survey + email signup, same cookie, same event | no FORMS_DB value equals a scan_node_returns.anonymous_id or the raw cookie value', async () => {
    const cookieValue = newCookieValue();
    const { eventId, token } = await newEvent();

    await scan(cookieValue, token);
    await submitAllForms(cookieValue, eventId, 'join-test@example.com');

    // The scan really was recorded under this cookie, so the join has a left side.
    const scanIds = await scanAnonymousIds();
    expect(scanIds.length).toBeGreaterThan(0);
    const scanRow = await mainDb()
      .prepare('SELECT COUNT(*) AS c FROM scan_node_returns WHERE event_id = ?')
      .bind(eventId)
      .first<{ c: number }>();
    expect(scanRow!.c).toBe(1);
    expect(scanIds).toContain(cookieValue);

    // Every form really wrote a row, and each row carries an id (the decision
    // was to replace the id, not drop it), so the join has a right side.
    const stored = await storedFormsIds(eventId);
    for (const [where, value] of Object.entries(stored)) {
      expect(value, `${where} holds no id after the submission`).toBeTruthy();
    }

    const formsValues = await everyFormsDbValue();
    expect(formsValues.length).toBeGreaterThan(0);

    const scanIdSet = new Set(scanIds);
    const joinable = formsValues.filter((v) => scanIdSet.has(v.value)).map((v) => v.where);
    expect(
      joinable,
      `FORMS_DB columns that equal a scan_node_returns.anonymous_id: ${joinable.join(', ')}`
    ).toEqual([]);

    const carriesRaw = formsValues.filter((v) => v.value.includes(cookieValue)).map((v) => v.where);
    expect(
      carriesRaw,
      `FORMS_DB columns that carry the raw ose_anon cookie value: ${carriesRaw.join(', ')}`
    ).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Per event: stable inside one event, different across events
// ═════════════════════════════════════════════════════════════════════════════

describe('the stored id is per event', () => {
  test('INTEGRATION | one cookie, all four forms, one event | every form stores the same id', async () => {
    const cookieValue = newCookieValue();
    const { eventId } = await newEvent();
    await submitAllForms(cookieValue, eventId, 'stable@example.com');

    const stored = Object.values(await storedFormsIds(eventId));
    expect(stored.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    expect(new Set(stored).size).toBe(1);
  });

  test('INTEGRATION | one cookie, two events | the two events store different ids', async () => {
    const cookieValue = newCookieValue();
    const first = await newEvent();
    const second = await newEvent();
    await submitAllForms(cookieValue, first.eventId, 'two-events@example.com');
    await submitAllForms(cookieValue, second.eventId, 'two-events@example.com');

    const a = await storedFormsIds(first.eventId);
    const b = await storedFormsIds(second.eventId);
    for (const key of Object.keys(a)) {
      expect(a[key], `${key} for event A`).toBeTruthy();
      expect(b[key], `${key} for event B`).toBeTruthy();
      expect(a[key], `${key} is the same for two events — joinable across events`).not.toBe(b[key]);
    }
  });

  test('INTEGRATION | check-in twice from one phone, then once from another | the same phone is recognisable, a different phone is not mistaken for it', async () => {
    const phoneOne = newCookieValue();
    const phoneTwo = newCookieValue();
    const { eventId } = await newEvent();
    const lastId = async () =>
      (
        await formsDb()
          .prepare('SELECT last_anonymous_id AS v FROM checkin_counts WHERE event_id = ?')
          .bind(eventId)
          .first<{ v: string | null }>()
      )?.v ?? null;

    expect((await submit(phoneOne, eventId, 'checkin')).status).toBe(200);
    const afterFirstTap = await lastId();
    expect(afterFirstTap).toBeTruthy();
    expect(afterFirstTap).not.toBe(phoneOne);

    // Second tap, same phone: the id on the row is the one this tap produces.
    expect((await submit(phoneOne, eventId, 'checkin')).status).toBe(200);
    expect(await lastId()).toBe(afterFirstTap);

    // Another phone produces a different id.
    expect((await submit(phoneTwo, eventId, 'checkin')).status).toBe(200);
    const afterOtherPhone = await lastId();
    expect(afterOtherPhone).toBeTruthy();
    expect(afterOtherPhone).not.toBe(afterFirstTap);
    expect(afterOtherPhone).not.toBe(phoneTwo);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. No secret, no write — never the raw value as a fallback
// ═════════════════════════════════════════════════════════════════════════════

describe('without FORMS_HASH_PEPPER the forms path refuses, it does not store the raw id', () => {
  const EVENT = 'evt-anon-unlink-nopepper';
  const noPepperEnv = (): FormsEnv =>
    ({ ...(env as unknown as FormsEnv), FORMS_HASH_PEPPER: undefined }) as FormsEnv;
  const req = (cookieValue: string, body?: Record<string, unknown>) =>
    new Request('https://t.test/form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `ose_anon=${cookieValue}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  test('INTEGRATION | each form handler, pepper unset | 503 CONFIG_ERROR and no row is written', async () => {
    const cookieValue = newCookieValue();
    const responses = [
      await handleFormRegistration(req(cookieValue, {}), noPepperEnv(), EVENT),
      await handleFormCheckin(req(cookieValue), noPepperEnv(), EVENT),
      await handleFormSurvey(req(cookieValue, { responses: { rating: 4 } }), noPepperEnv(), EVENT),
      await handleFormEmailSignup(
        req(cookieValue, { email: 'nopepper@example.com' }),
        noPepperEnv(),
        EVENT
      ),
    ];
    for (const res of responses) {
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('CONFIG_ERROR');
    }
    for (const { table } of FORMS_ANON_COLUMNS) {
      const row = await formsDb()
        .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE event_id = ?`)
        .bind(EVENT)
        .first<{ c: number }>();
      expect(row!.c, `${table} took a row without the secret`).toBe(0);
    }
    const carriesRaw = (await everyFormsDbValue()).filter((v) => v.value.includes(cookieValue));
    expect(carriesRaw).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Logs
// ═════════════════════════════════════════════════════════════════════════════

describe('form logs carry neither the cookie value nor the stored id', () => {
  test('INTEGRATION | all four forms with a sentinel cookie, every console line captured | the sentinel is in no line', async () => {
    const sentinel = `anon_SENTINEL-${crypto.randomUUID()}`;
    const { eventId } = await newEvent();
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation(capture);
    }

    await submitAllForms(sentinel, eventId, 'log-sentinel@example.com');
    // A repeat email signup takes the "duplicate" branch, which logs on its own.
    expect(
      (await submit(sentinel, eventId, 'email-signup', { email: 'log-sentinel@example.com' }))
        .status
    ).toBe(200);

    const stored = Object.values(await storedFormsIds(eventId)).filter(
      (v): v is string => typeof v === 'string' && v.length > 0
    );
    vi.restoreAllMocks();

    // The capture saw the form path: one FORM_EVENT submit line per submission.
    const formEvents = lines.filter((l) => l.includes('"type":"FORM_EVENT"'));
    expect(formEvents.length).toBeGreaterThanOrEqual(5);
    for (const form of ['register', 'checkin', 'survey', 'email-signup']) {
      expect(
        formEvents.some((l) => l.includes(`"formType":"${form}"`) && l.includes('"submit"')),
        `no FORM_EVENT submit line captured for ${form}`
      ).toBe(true);
    }

    const leaking = lines.filter((l) => l.includes(sentinel));
    expect(leaking, 'log lines that carry the raw ose_anon cookie value').toEqual([]);

    // The id stored beside the form data stays out of the logs too, so a log
    // line cannot be used to find a named row.
    expect(stored.length).toBeGreaterThan(0);
    for (const id of stored) {
      expect(
        lines.filter((l) => l.includes(id)),
        'log lines that carry the stored forms id'
      ).toEqual([]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. What erasure by email can no longer reach
// ═════════════════════════════════════════════════════════════════════════════

describe('erasure by email: the forms rows go, the scan rows are out of reach', () => {
  test('INTEGRATION | register and scan with one cookie, then erase by email | the registration is deleted; the scan row stays and scanReturnsDeleted is 0', async () => {
    const cookieValue = newCookieValue();
    const email = `erase-${crypto.randomUUID()}@example.com`;
    const { eventId, token } = await newEvent();

    await scan(cookieValue, token);
    expect(
      (await submit(cookieValue, eventId, 'register', { name: 'Erase Me', email })).status
    ).toBe(200);

    // The forms side no longer records which anonymous id an email belongs to.
    const emailHash = await hashEmail(email, tenv().FORMS_HASH_PEPPER, { requirePepper: true });
    const linked = await findAnonIdsLinkedToEmailHash({ FORMS_DB: formsDb() }, emailHash);
    expect([...linked]).toEqual([]);

    const res = await SELF.fetch('https://t.test/api/v2/admin/data-subject/erase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // Still works: everything keyed by the email.
    expect(body.registrationsDeleted).toBe(1);
    const reg = await formsDb()
      .prepare('SELECT COUNT(*) AS c FROM form_registrations WHERE attendee_email_hash = ?')
      .bind(emailHash)
      .first<{ c: number }>();
    expect(reg!.c).toBe(0);

    // No longer possible: finding that browser's scan rows from the email.
    expect(body.scanReturnsDeleted).toBe(0);
    expect(body.anonIdReturnsDeleted).toBe(0);
    const scanRow = await mainDb()
      .prepare('SELECT COUNT(*) AS c FROM scan_node_returns WHERE anonymous_id = ?')
      .bind(cookieValue)
      .first<{ c: number }>();
    expect(scanRow!.c).toBe(1);
  });

  test('UNIT | the erasure lookup over one raw value and one keyed id for the same email | only the raw value is returned', async () => {
    const emailHash = `lookup-hash-${crypto.randomUUID()}`;
    const raw = newCookieValue();
    const keyed = `evk1_${'cd'.repeat(32)}`;
    for (const [suffix, value] of [
      ['raw', raw],
      ['keyed', keyed],
    ] as const) {
      await formsDb()
        .prepare(
          `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash, anonymous_id)
           VALUES (?, 'evt-lookup', '2026-10-07T12', 'confirmed', ?, ?)`
        )
        .bind(`reg-lookup-${suffix}-${crypto.randomUUID()}`, emailHash, value)
        .run();
    }
    const linked = await findAnonIdsLinkedToEmailHash({ FORMS_DB: formsDb() }, emailHash);
    expect([...linked]).toEqual([raw]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Forms migration 0016: raw values already stored are cleared
// ═════════════════════════════════════════════════════════════════════════════

describe('forms migration 0016 clears raw anonymous ids already stored', () => {
  /** The scrub statements, taken from the migration set the pool applies. */
  function scrubStatements(): string[] {
    const all: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
    return all.filter((s) => /^UPDATE\s+\w+\s+SET\s+(last_)?anonymous_id\s*=\s*NULL\b/i.test(s));
  }

  test('MIGRATION | one scrub statement per table that holds the id | four statements, four tables', () => {
    const tables = scrubStatements()
      .map((s) => /^UPDATE\s+(\w+)/i.exec(s)![1])
      .sort();
    expect(tables).toEqual(FORMS_ANON_COLUMNS.map((c) => c.table).sort());
  });

  test('MIGRATION | rows holding a raw value, a keyed id and no id | raw is cleared; the keyed id, the rows and their other columns stay', async () => {
    const raw = newCookieValue();
    const keyed = `evk1_${'ab'.repeat(32)}`;
    const ev = `evt-scrub-${crypto.randomUUID().slice(0, 8)}`;
    const db = formsDb();

    // One row per case in each table: a raw value, a keyed id, no id.
    for (const [suffix, value] of [
      ['raw', raw],
      ['keyed', keyed],
      ['none', null],
    ] as const) {
      await db
        .prepare(
          `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash, anonymous_id)
           VALUES (?, ?, '2026-10-07T12', 'confirmed', ?, ?)`
        )
        .bind(`reg-${ev}-${suffix}`, ev, `hash-${suffix}`, value)
        .run();
      await db
        .prepare(
          `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed, anonymous_id)
           VALUES (?, ?, '{"rating":5}', '2026-10-07T12', 0, ?)`
        )
        .bind(`sv-${ev}-${suffix}`, ev, value)
        .run();
      await db
        .prepare(
          `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at, anonymous_id)
           VALUES (?, ?, ?, 'enc', '2026-10-07T12', '2099-01-01', ?)`
        )
        .bind(`es-${ev}-${suffix}`, ev, `ehash-${ev}-${suffix}`, value)
        .run();
      // checkin_counts is one row per event.
      await db
        .prepare(
          `INSERT INTO checkin_counts (id, event_id, total_count, walk_in_count, updated_at, last_anonymous_id)
           VALUES (?, ?, 7, 2, datetime('now'), ?)`
        )
        .bind(`ci-${ev}-${suffix}`, `${ev}-${suffix}`, value)
        .run();
    }

    for (const stmt of scrubStatements()) await db.prepare(stmt).run();

    const read = async (table: string, column: string, idPrefix: string) => {
      const rows = await db
        .prepare(`SELECT id, ${column} AS v FROM ${table} WHERE id LIKE ?`)
        .bind(`${idPrefix}-${ev}-%`)
        .all<{ id: string; v: string | null }>();
      return Object.fromEntries(rows.results.map((r) => [r.id.split('-').pop(), r.v]));
    };
    const expected = { keyed, none: null, raw: null };
    expect(await read('form_registrations', 'anonymous_id', 'reg')).toEqual(expected);
    expect(await read('form_surveys', 'anonymous_id', 'sv')).toEqual(expected);
    expect(await read('email_signups', 'anonymous_id', 'es')).toEqual(expected);
    expect(await read('checkin_counts', 'last_anonymous_id', 'ci')).toEqual(expected);

    // Nothing else moved: the counts and the email hash are as written.
    const counts = await db
      .prepare('SELECT total_count, walk_in_count FROM checkin_counts WHERE id = ?')
      .bind(`ci-${ev}-raw`)
      .first<{ total_count: number; walk_in_count: number }>();
    expect(counts).toEqual({ total_count: 7, walk_in_count: 2 });
    const reg = await db
      .prepare('SELECT attendee_email_hash, status FROM form_registrations WHERE id = ?')
      .bind(`reg-${ev}-raw`)
      .first<{ attendee_email_hash: string; status: string }>();
    expect(reg).toEqual({ attendee_email_hash: 'hash-raw', status: 'confirmed' });

    // And the raw value is in no FORMS_DB column any more.
    expect((await everyFormsDbValue()).filter((v) => v.value.includes(raw))).toEqual([]);
  });
});
