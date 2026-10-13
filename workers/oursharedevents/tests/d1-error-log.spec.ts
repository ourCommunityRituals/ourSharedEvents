/**
 * A failing database never puts a row in the Worker's log.
 *
 * The D1 client bundled in workerd writes data into two of its error messages
 * (source of workerd 1.20260930.2, the version in package-lock.json):
 *   - `Failed to parse body as JSON, got: ${body}`: the whole response body;
 *   - `D1_TYPE_ERROR: Type '…' not supported for value '${r}'`: a bound value.
 * Workers Logs are on, so a log line that writes `err.message` after a database
 * call can carry an event id, venue text, another brand's row and, from
 * FORMS_DB, a person's details. Log lines carry `errorLabel(err)` instead
 * (src/lib/error-label.ts): the error's class and its database codes.
 *
 * Method: the real Worker entry (`fetch` and `scheduled`), with a database
 * binding replaced by one whose every statement fails with one of the two
 * messages, each quoting a row. Every console level is captured and every line
 * is read. Each case names the log lines it must see, so a case that stops
 * reaching its sink fails instead of passing on silence. The first two tests
 * use the real D1 client, to show what this runtime's messages hold and what
 * the label makes of them.
 *
 * Level: W (workers pool, real routes, real nightly jobs). There is no staging
 * layer: a staging database cannot be made to fail on request. The source side
 * is tests/e2e/0-architecture/log-redaction.invariant.spec.ts.
 *
 * @born-red every case under "a database that fails" | method: run against
 *   main before any log line was changed. 14 of the 16 cases then written
 *   failed, each on a line carrying the row (LIFECYCLE_PHASE_ERROR,
 *   LIFECYCLE_COMPLETE, DB_ERROR, UNHANDLED_ERROR, LIST_SUBSCRIBERS_DB_ERROR,
 *   FLAG_EVENT and 9 more); the 2 that passed never reached a database and
 *   were rewritten | date: 2026-10-12
 * @born-red each log line, again | method: after the change, one sink at a time
 *   put back to `err.message` (see the PR for the list) | date: 2026-10-12
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import worker from '../src/index';
import type { RouterEnv } from '../src/router';
import { errorLabel } from '../src/lib/error-label';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  ADMIN_KEY: string;
  TEST_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const ORIGIN = 'https://t.test';
// The event the requests name. It is not part of the row: a form line logs it.
const EVENT = 'evt_request_0001';

// Text that stands for a row: a name, an email, a venue, an event id.
const ROW_WORDS = ['Jane', 'Roe', 'jane.roe@example.test', 'Harbor-Hall', 'evt_4f1c9a'];
const ROW = ROW_WORDS.join(' ');

/** The two message forms, as the D1 client builds them. */
const MESSAGES = {
  'response body': `D1_ERROR: Failed to parse body as JSON, got: {"results":[{"attendee_name":"${ROW}"}]}`,
  'bound value': `D1_TYPE_ERROR: Type 'object' not supported for value '${ROW}'`,
} as const;
type Form = keyof typeof MESSAGES;
const CODE: Record<Form, string> = { 'response body': 'D1_ERROR', 'bound value': 'D1_TYPE_ERROR' };

/** A database whose every statement fails with `message`. */
function failingDatabase(message: string): D1Database {
  const fail = async (): Promise<never> => {
    throw new Error(message, { cause: new Error(message.replace(/^D1_[A-Z_]+: /, '')) });
  };
  const statement = { bind: () => statement, first: fail, all: fail, run: fail, raw: fail };
  const db = { prepare: () => statement, batch: fail, exec: fail, dump: fail };
  return db as unknown as D1Database;
}

/** Which bindings fail: both, or the forms database alone (the main one answers). */
type Failing = 'both' | 'forms';

function failingEnv(form: Form, failing: Failing): RouterEnv {
  const db = failingDatabase(MESSAGES[form]);
  const bindings = failing === 'both' ? { DB: db, FORMS_DB: db } : { FORMS_DB: db };
  return { ...(env as object), ...bindings } as unknown as RouterEnv;
}

// ── Every line the Worker writes ─────────────────────────────────────────────

const LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

function captureLogs(): string[] {
  const lines: string[] = [];
  const text = (a: unknown): string =>
    typeof a === 'string' ? a : a instanceof Error ? String(a.stack) : JSON.stringify(a);
  for (const level of LEVELS) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(text).join(' '));
    });
  }
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The lines that carry any word of the row. */
const withRow = (lines: string[]): string[] =>
  lines.filter((l) => ROW_WORDS.some((w) => l.includes(w)));

/** The structured lines, parsed; a line that is not JSON is skipped. */
function structured(lines: string[]): Array<Record<string, unknown>> {
  return lines.flatMap((l) => {
    try {
      const parsed: unknown = JSON.parse(l);
      return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

/** `Error D1_ERROR`, `Error D1_ERROR SQLITE_CONSTRAINT`: a class, then codes. */
const LABEL = /^[A-Za-z][A-Za-z0-9_]{0,63}(?: (?:D1|SQLITE)_[A-Z_]{2,40}){0,4}$/;

/**
 * No line carries the row; every line type in `types` was written; and every
 * value under a key named `error` or ending in `Error`, on any line, is a label
 * with this form's code.
 */
function expectLabelled(lines: string[], form: Form, types: string[]): void {
  expect(withRow(lines), 'no log line may carry a word of the row').toEqual([]);
  const parsed = structured(lines);
  const written = [...new Set(parsed.map((l) => String(l.type)))];
  for (const type of types) {
    expect(written, `the ${type} line must be written`).toContain(type);
  }
  const errors = parsed.flatMap((l) =>
    Object.entries(l)
      .filter(([key, value]) => /^error$|Error$/.test(key) && value !== null)
      .map(([key, value]) => ({ where: `${String(l.type)}.${key}`, value: String(value) }))
  );
  expect(errors.length, 'at least one line must say what failed').toBeGreaterThan(0);
  for (const { where, value } of errors) {
    expect(value, where).toMatch(LABEL);
    expect(value, where).toContain(CODE[form]);
  }
}

const ADMIN = { Authorization: `Bearer ${E.ADMIN_KEY}` };
const JSON_BODY = { 'Content-Type': 'application/json' };
const json = (body: unknown): RequestInit => ({ headers: JSON_BODY, body: JSON.stringify(body) });

beforeAll(async () => {
  // The cases where only the forms database fails read the main one for real.
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate column name|already exists|no such column/.test(msg)) throw e;
    }
  }
});

// ── The premise, on the real client ──────────────────────────────────────────

describe('the D1 client in this runtime', () => {
  test('writes a bound value into its error message, and the label leaves it out', () => {
    let thrown: unknown;
    try {
      // An array of strings is not a value D1 can bind; the client says which.
      E.DB.prepare('SELECT ?').bind([ROW]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('D1_TYPE_ERROR');
    expect((thrown as Error).message, 'the premise: the message quotes the value').toContain(ROW);
    expect(errorLabel(thrown)).toBe('Error D1_TYPE_ERROR');
  });

  test('names a constraint failure by a code the label keeps', async () => {
    await E.DB.exec('CREATE TABLE IF NOT EXISTS label_probe (k TEXT PRIMARY KEY)');
    await E.DB.prepare('INSERT INTO label_probe (k) VALUES (?)').bind(ROW).run();
    let thrown: unknown;
    try {
      await E.DB.prepare('INSERT INTO label_probe (k) VALUES (?)').bind(ROW).run();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const label = errorLabel(thrown);
    expect(label).toMatch(LABEL);
    expect(label).toContain('D1_ERROR');
    expect(label).toContain('SQLITE_CONSTRAINT');
    expect(withRow([label])).toEqual([]);
  });
});

// ── The log lines ────────────────────────────────────────────────────────────

interface Case {
  name: string;
  failing: Failing;
  method: string;
  path: string;
  init?: RequestInit;
  /** The log lines this request must write. */
  lines: string[];
}

const REQUESTS: Case[] = [
  // FORMS_DB: the rows are people.
  {
    name: 'a registration (FORMS_DB)',
    failing: 'forms',
    method: 'POST',
    path: `/api/v2/events/${EVENT}/forms/register`,
    init: json({ attendee_name: 'Pat Doe', email: 'pat.doe@example.test' }),
    lines: ['FORM_EVENT'],
  },
  {
    name: 'a check-in (FORMS_DB)',
    failing: 'forms',
    method: 'POST',
    path: `/api/v2/events/${EVENT}/forms/checkin`,
    init: json({}),
    lines: ['FORM_EVENT'],
  },
  {
    name: 'the admin registration list (FORMS_DB)',
    failing: 'forms',
    method: 'GET',
    path: `/api/v2/admin/events/${EVENT}/forms/registrations`,
    init: { headers: ADMIN },
    lines: ['FORM_EVENT'],
  },
  {
    name: 'the admin subscriber list (FORMS_DB)',
    failing: 'forms',
    method: 'GET',
    path: '/api/v2/admin/subscribers',
    init: { headers: ADMIN },
    lines: ['LIST_SUBSCRIBERS_DB_ERROR'],
  },
  {
    name: 'the admin flag list (FORMS_DB)',
    failing: 'forms',
    method: 'GET',
    path: '/api/v2/admin/flags',
    init: { headers: ADMIN },
    lines: ['FLAG_EVENT'],
  },
  // DB: events, venues, sponsors, other brands' rows.
  {
    name: 'the public event list (DB)',
    failing: 'both',
    method: 'GET',
    path: '/api/v2/events',
    lines: ['DB_ERROR'],
  },
  {
    name: 'the admin event list (DB)',
    failing: 'both',
    method: 'GET',
    path: '/api/v2/admin/events',
    init: { headers: ADMIN },
    lines: ['DB_ERROR'],
  },
  // Nothing catches it: the line of last resort.
  {
    name: 'a form request whose error nobody catches',
    failing: 'both',
    method: 'POST',
    path: `/api/v2/events/${EVENT}/forms/register`,
    init: json({ attendee_name: 'Pat Doe', email: 'pat.doe@example.test' }),
    lines: ['UNHANDLED_ERROR'],
  },
];

describe.each(Object.keys(MESSAGES) as Form[])(
  'a database that fails with a %s in its message',
  (form) => {
    test('the nightly jobs', async () => {
      const lines = captureLogs();
      const ctx = createExecutionContext();
      await worker.scheduled(
        { scheduledTime: Date.now(), cron: '0 3 * * *', noRetry: () => {} },
        failingEnv(form, 'both'),
        ctx
      );
      // A job may reject its promise; this test reads what was logged.
      await waitOnExecutionContext(ctx).catch(() => undefined);
      expectLabelled(lines, form, [
        // FORMS_DB: the form-data clean-up and the registrant contact clear.
        'LIFECYCLE_PHASE_ERROR',
        'LIFECYCLE_COMPLETE',
        // DB.
        'SECURITY_CRON_ERROR',
        'DRAFT_EXPIRY_ERROR',
        'SCAN_RETURNS_RETENTION_ERROR',
        'SHARED_REPORT_MATERIALIZE_ERROR',
        'SHARED_REPORT_MATERIALIZE_PHASE_FATAL',
        'ANON_ID_RETURNS_PEPPER_PURGE_ERROR',
        'LIFECYCLE',
      ]);
    });

    test.each(REQUESTS)('$name', async (c) => {
      const lines = captureLogs();
      const ctx = createExecutionContext();
      const res = await worker.fetch(
        new Request(`${ORIGIN}${c.path}`, { method: c.method, ...c.init }),
        failingEnv(form, c.failing),
        ctx
      );
      await waitOnExecutionContext(ctx).catch(() => undefined);
      expect(res.status, 'the request fails').toBeGreaterThanOrEqual(500);
      expect(withRow([await res.text()]), 'and its answer carries no row either').toEqual([]);
      expectLabelled(lines, form, c.lines);
    });
  }
);
