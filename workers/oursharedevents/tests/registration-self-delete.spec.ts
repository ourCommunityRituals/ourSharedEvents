/**
 * Registration self-delete: `DELETE /api/v2/events/:id/forms/register`.
 *
 * OSE-659 gave an attendee a way to remove their own registration before the
 * TTL does: they send the email they registered with, and the row whose keyed
 * hash matches is deleted. Writes ONLY to FORMS_DB; never joins
 * registration↔scan. A registration made without an email cannot be removed
 * this way (the TTL destroys it); name-only deletion is refused.
 *
 * OSE-1497 found three things wrong with how it answered:
 *
 *   1. It returned `deleted: N`. The route takes no login, so anyone could send
 *      any email and read whether that person had registered for that event
 *      (0, or 1 and more). The answer is now the same in every case.
 *   2. It hashed the email without requiring FORMS_HASH_PEPPER. With the secret
 *      missing it fell back to a bare SHA-256, matched nothing written with the
 *      secret, and said "ok". It now answers 503 CONFIG_ERROR and deletes nothing.
 *   3. Nothing checked that the route is rate-limited. It is, in three layers,
 *      and each one is now pinned here.
 *
 * NOT settled here: the route still deletes for anyone who knows the email. The
 * owner decision (a one-time link sent to the address, or erasure by an
 * operator only) is open on OSE-1497.
 *
 * Level: W (workers pool: real D1 and KV, the real route through SELF and
 * through `route()` where a binding has to be swapped).
 *
 * @born-red OSE-1497 | method: written and run against the pre-change handler.
 * Six tests failed. "the answer is the same…" failed on the body (`deleted: 1`
 * against `deleted: 0`); "an attendee deletes their own registration" and "the
 * body is { ok: true }" failed on the extra `deleted` field; "secret unset" and
 * "secret empty" failed on the status (200, not 503) and on the row a bare hash
 * matches, which was gone; "the hash call requires the secret" failed on the
 * source | date: 2026-10-07
 * The other ten were green from the start: they are guards, not red-first
 * tests. Every test here was then seen red against a fault injected into the
 * production code (list in the pull request). "a database failure is a 503" was
 * added because one of those faults got past the first version of this file.
 */

import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { handleSelfDeleteRegistration, type FormsEnv } from '../src/handlers/forms';
import { hashEmail } from '../src/lib/pii';
import { checkRateLimit, RATE_LIMIT_FORM_MAX } from '../src/lib/rate-limit';
import { FORM_EDGE_MAX, EDGE_WINDOW_SECONDS } from '../src/lib/edge-rate-limit';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  FORMS_HASH_PEPPER: string;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  for (const key of ['TEST_MIGRATION_STATEMENTS', 'TEST_FORMS_MIGRATION_STATEMENTS'] as const) {
    const db = key === 'TEST_MIGRATION_STATEMENTS' ? tenv().DB : tenv().FORMS_DB;
    for (const stmt of JSON.parse(tenv()[key]) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.includes('duplicate column name') || m.includes('already exists')) continue;
        throw e;
      }
    }
  }
}

const EVENT = 'selfdel-evt';
const OTHER_EVENT = 'selfdel-evt-other';
const pathFor = (eventId: string) => `/api/v2/events/${eventId}/forms/register`;

/** Register through the real route, so write and delete hash the same way. */
async function register(email: string, eventId = EVENT): Promise<Response> {
  return SELF.fetch(`https://t.test${pathFor(eventId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Attendee', email }),
  });
}

/** The real route, as a caller on the internet reaches it. */
async function selfDelete(
  body: Record<string, unknown>,
  opts: { eventId?: string; ip?: string } = {}
): Promise<Response> {
  return SELF.fetch(`https://t.test${pathFor(opts.eventId ?? EVENT)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.ip ? { 'CF-Connecting-IP': opts.ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** The same route with part of the environment swapped (a secret, a binding). */
async function selfDeleteWith(
  override: Record<string, unknown>,
  body: Record<string, unknown>,
  opts: { eventId?: string; ip?: string } = {}
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://t.test${pathFor(opts.eventId ?? EVENT)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.ip ? { 'CF-Connecting-IP': opts.ip } : {}),
      },
      body: JSON.stringify(body),
    }),
    { ...(env as unknown as RouterEnv), ...override } as unknown as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

/**
 * Put one registration row straight into FORMS_DB and return its id.
 * `bare` stores the unkeyed SHA-256 the handler used to fall back to, which is
 * also what a row written before the secret existed carries.
 */
async function seed(
  email: string,
  eventId: string,
  opts: { bare?: boolean } = {}
): Promise<string> {
  const pepper = opts.bare ? undefined : tenv().FORMS_HASH_PEPPER;
  const id = crypto.randomUUID();
  await tenv()
    .FORMS_DB.prepare(
      `INSERT INTO form_registrations (id, event_id, attendee_email_hash, registration_bucket, status, expires_at)
       VALUES (?, ?, ?, '2026-10-07T00', 'confirmed', '2099-01-01T00:00:00.000Z')`
    )
    .bind(id, eventId, await hashEmail(email, pepper))
    .run();
  return id;
}

async function rowExists(id: string): Promise<boolean> {
  const r = await tenv()
    .FORMS_DB.prepare('SELECT COUNT(*) AS n FROM form_registrations WHERE id = ?')
    .bind(id)
    .first<{ n: number }>();
  return (r?.n ?? 0) === 1;
}

/** Rows this email holds at this event, found the way the handler finds them. */
async function rowsFor(email: string, eventId = EVENT): Promise<number> {
  const r = await tenv()
    .FORMS_DB.prepare(
      'SELECT COUNT(*) AS n FROM form_registrations WHERE event_id = ? AND attendee_email_hash = ?'
    )
    .bind(eventId, await hashEmail(email, tenv().FORMS_HASH_PEPPER))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Everything a caller can read off a response, minus the two headers that are
 * random or a clock by design and say nothing about the registration.
 */
const VOLATILE_HEADERS = new Set(['x-request-id', 'date']);
async function visible(res: Response) {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (!VOLATILE_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  });
  return { status: res.status, statusText: res.statusText, headers, body: await res.text() };
}

function handlerSource(): string {
  const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  // A Windows checkout hands the source over with CRLF line ends; CI with LF.
  const src = Object.entries(files)
    .find(([p]) => p.replace(/\\/g, '/').endsWith('handlers/forms.ts'))![1]
    .replace(/\r\n/g, '\n');
  const start = src.indexOf('export async function handleSelfDeleteRegistration');
  expect(start, 'the handler is in handlers/forms.ts').toBeGreaterThan(-1);
  // The handler ends at the first closing brace in column 0.
  const end = src.indexOf('\n}\n', start);
  expect(end, 'the end of the handler was found').toBeGreaterThan(start);
  return src.slice(start, end + 2);
}

beforeAll(async () => {
  await applyMigrations();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, 'selfdel', 'Self Del', ?, 'active')
       ON CONFLICT(id) DO NOTHING`
    )
    .bind(EVENT, EVENT)
    .run();
});

describe('registration self-delete removes the row it is asked to, and only that', () => {
  test('an attendee deletes their own registration with the registered email', async () => {
    const email = 'alice@example.com';
    expect((await register(email)).status).toBe(200);
    expect(await rowsFor(email)).toBe(1);

    const res = await selfDelete({ email });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The row is physically gone from FORMS_DB.
    expect(await rowsFor(email)).toBe(0);
  });

  test('the email is matched as it was stored: case and spaces around it do not matter', async () => {
    const id = await seed('erin@example.com', EVENT);
    expect((await selfDelete({ email: '  Erin@Example.COM ' })).status).toBe(200);
    expect(await rowExists(id)).toBe(false);
  });

  test('a wrong email deletes nothing', async () => {
    const id = await seed('bob@example.com', EVENT);
    const res = await selfDelete({ email: 'not-bob@example.com' });
    expect(res.status).toBe(200);
    expect(await rowExists(id), "bob's registration is untouched").toBe(true);
  });

  test('only the named event: the same email at another event keeps its registration', async () => {
    const here = await seed('carol@example.com', EVENT);
    const elsewhere = await seed('carol@example.com', OTHER_EVENT);
    expect((await selfDelete({ email: 'carol@example.com' })).status).toBe(200);
    expect(await rowExists(here)).toBe(false);
    expect(await rowExists(elsewhere), 'the other event is not touched').toBe(true);
  });

  test('self-delete requires a valid email — name-only / missing / invalid is refused', async () => {
    expect((await selfDelete({ name: 'Attendee' })).status).toBe(400);
    expect((await selfDelete({})).status).toBe(400);
    expect((await selfDelete({ email: 'not-an-email' })).status).toBe(400);
  });

  test('#1: the handler + route never join registration↔scan (FORMS_DB only)', () => {
    const body = handlerSource();
    expect(body).toContain('env.FORMS_DB');
    expect(body).not.toContain('env.DB.prepare'); // never the scan DB
    expect(body).not.toMatch(/JOIN|scans|scan_aggregates/i);
  });
});

describe('the answer does not say whether a registration existed', () => {
  test('the answer is the same whether a row was deleted, none matched, or the event is unknown', async () => {
    const ip = '203.0.113.21';
    const id = await seed('dave@example.com', EVENT);

    const removed = await visible(await selfDelete({ email: 'dave@example.com' }, { ip }));
    expect(await rowExists(id), 'this call did delete a row').toBe(false);

    const nothingThere = await visible(await selfDelete({ email: 'nobody@example.com' }, { ip }));
    const alreadyGone = await visible(await selfDelete({ email: 'dave@example.com' }, { ip }));
    const unknownEvent = await visible(
      await selfDelete({ email: 'dave@example.com' }, { ip, eventId: 'selfdel-no-such-event' })
    );

    // Status, status text, every header but the request id, and the body bytes.
    expect(nothingThere).toEqual(removed);
    expect(alreadyGone).toEqual(removed);
    expect(unknownEvent).toEqual(removed);
  });

  // "ok" means the delete statement ran. It must not also cover the case where
  // the database could not be reached, or a person is told their registration
  // was dealt with when it is still there.
  test('a database failure is a 503, never { ok: true }', async () => {
    const id = await seed('lena@example.com', EVENT);
    const down = {
      prepare() {
        throw new Error('D1_ERROR: database is unavailable');
      },
    };
    const res = await selfDeleteWith({ FORMS_DB: down }, { email: 'lena@example.com' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('DB_ERROR');
    expect(await rowExists(id)).toBe(true);
  });

  test('the body is { ok: true } and nothing else: no count, no flag', async () => {
    await seed('frank@example.com', EVENT);
    const res = await selfDelete({ email: 'frank@example.com' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(text).not.toMatch(/deleted|count|found|removed|exist/i);
  });
});

describe('no FORMS_HASH_PEPPER: the route answers 503 and deletes nothing', () => {
  // Without the secret the old handler hashed with a bare SHA-256. That is the
  // hash a row written before the secret existed carries, so such a row is the
  // one a missing secret could still reach.
  for (const [label, value] of [
    ['unset', undefined],
    ['empty', ''],
  ] as const) {
    test(`secret ${label}`, async () => {
      const email = `gina-${label}@example.com`;
      const keyed = await seed(email, EVENT);
      const bare = await seed(email, EVENT, { bare: true });

      const res = await selfDeleteWith({ FORMS_HASH_PEPPER: value }, { email });
      // Soft, so a failure also shows what happened to the rows below.
      expect.soft(res.status).toBe(503);
      const body = (await res.json()) as { ok: boolean; code?: string };
      expect.soft(body.ok).toBe(false);
      expect.soft(body.code).toBe('CONFIG_ERROR');

      expect(await rowExists(keyed), 'the row stored with the secret is still there').toBe(true);
      expect(await rowExists(bare), 'the row a bare hash matches is still there').toBe(true);
    });
  }

  test('with the secret back, the same request works', async () => {
    const id = await seed('henry@example.com', EVENT);
    const res = await selfDeleteWith({}, { email: 'henry@example.com' });
    expect(res.status).toBe(200);
    expect(await rowExists(id)).toBe(false);
  });

  test('the hash call requires the secret, so it can never fall back to a bare SHA-256', () => {
    expect(handlerSource()).toMatch(/hashEmail\([^)]*\{\s*requirePepper:\s*true\s*\}\s*\)/);
  });
});

describe('the route is rate-limited, and a refused request deletes nothing', () => {
  /**
   * Use up `ip`'s per-minute allowance on the form routes without sending
   * hundreds of requests. This writes the same KV count the router reads
   * (`checkRateLimit(env, <caller address>, RATE_LIMIT_FORM_MAX)` in
   * `formRouteLimit`), and never touches the 10-second edge layer, so nothing
   * here lines up with a clock boundary. The count's window opens at the first
   * call and lasts 60 s; the request under test follows within the same test.
   *
   * The last line checks the drain did what it says.
   */
  const useUpMinute = async (ip: string) => {
    for (let i = 0; i < RATE_LIMIT_FORM_MAX; i++) {
      await checkRateLimit(tenv(), ip, RATE_LIMIT_FORM_MAX);
    }
    expect(
      await checkRateLimit(tenv(), ip, RATE_LIMIT_FORM_MAX),
      'the per-minute allowance is used up'
    ).toBe(true);
  };

  test(`per-minute count: past ${RATE_LIMIT_FORM_MAX} the route answers 429 and the row stays`, async () => {
    const ip = '203.0.113.31';
    const eventId = 'selfdel-evt-minute';
    const email = 'ivy@example.com';
    const id = await seed(email, eventId);

    await useUpMinute(ip);
    const res = await selfDelete({ email }, { ip, eventId });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('X-RateLimit-Limit')).toBe(String(RATE_LIMIT_FORM_MAX));
    expect(((await res.json()) as { code: string }).code).toBe('RATE_LIMITED');
    expect(await rowExists(id), 'a refused request deletes nothing').toBe(true);

    // Another caller is not held back, and the row can still be removed.
    const other = await selfDelete({ email }, { ip: '203.0.113.32', eventId });
    expect(other.status).toBe(200);
    expect(await rowExists(id)).toBe(false);
  });

  test(`edge layer: when it refuses, the route answers 429 (retry in ${EDGE_WINDOW_SECONDS} s) and the row stays`, async () => {
    const ip = '203.0.113.41';
    const eventId = 'selfdel-evt-edge';
    const email = 'jack@example.com';
    const id = await seed(email, eventId);

    const asked: string[] = [];
    const refuses = {
      limit: async ({ key }: { key: string }) => {
        asked.push(key);
        return { success: false };
      },
    };
    const res = await selfDeleteWith({ FORM_EDGE_LIMITER: refuses }, { email }, { ip, eventId });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe(String(EDGE_WINDOW_SECONDS));
    expect(res.headers.get('X-RateLimit-Limit')).toBe(String(FORM_EDGE_MAX));
    await res.body?.cancel();
    expect(asked, 'asked once, per caller per event').toEqual([`${ip}:${eventId}`]);
    expect(await rowExists(id), 'a refused request deletes nothing').toBe(true);
  });

  test('in the handler: one caller on one event is refused after 360 a minute, and the row stays', async () => {
    // Mirrors FORM_RATE_MAX in handlers/forms.ts (pinned in form-rate-limit.spec.ts).
    const FORM_RATE_MAX = 360;
    const ip = '203.0.113.51';
    const eventId = 'selfdel-evt-handler';
    const email = 'kim@example.com';
    const id = await seed(email, eventId);

    const call = (body: string) =>
      handleSelfDeleteRegistration(
        new Request(`https://t.test${pathFor(eventId)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
          body,
        }),
        env as unknown as FormsEnv,
        eventId
      );

    // Not JSON, so each call stops at 400 before the database. It still counts.
    for (let i = 0; i < FORM_RATE_MAX; i++) {
      expect((await call('not json')).status).toBe(400);
    }
    const limited = await call(JSON.stringify({ email }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(((await limited.json()) as { code: string }).code).toBe('RATE_LIMITED');
    expect(await rowExists(id), 'a refused request deletes nothing').toBe(true);
  });
});
