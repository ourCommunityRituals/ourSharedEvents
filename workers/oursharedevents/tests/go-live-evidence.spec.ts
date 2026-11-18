/**
 * Going live needs a code that works (OSE-1420, with OSE-1426 folded in).
 *
 * An event moves into `active` through two doors a person can use: verify-qr
 * (ready → active) and PUT status (ready → active, archived → active). Both
 * now read the event's codes first. The move is allowed only when at least one
 * of these exists:
 *   - a share link the resolver accepts: a 6-character base62 code whose
 *     target is empty or https;
 *   - a poster that is switched on (`is_active = 1`) and whose token the scan
 *     route accepts (`qrt_` and at most 128 characters).
 * Otherwise the answer is 409 NO_QR_EVIDENCE and nothing is written.
 *
 * The three corrections carried in from the start:
 *   (a) a link row that fails the shared rule (lib/code-validity.ts) is not
 *       evidence, however many such rows there are;
 *   (b) a failed read of the evidence is 503 EVIDENCE_UNAVAILABLE with one
 *       structured log line, never a 409 that blames the organizer;
 *   (c) no scan count is in any answer. The receipt counts links and posters,
 *       which are things, not people, so they are exact.
 *
 * Level: W (workers pool, real D1, real routes through SELF; the read-failure
 * cases call the handlers with a database that fails on the evidence tables).
 *
 * WHAT THIS DOES NOT PROVE. That staging rows pass: see the Bruno sequence in
 * folder 12. Creating an event already live (automation only) is a third door
 * and is not gated here.
 *
 * @born-red go-live evidence | method: ran against the handlers before the
 *   change | date: 2026-11-18 | verified: every refusal case failed with 200
 *   where 409 or 503 was expected, and every receipt case failed on a missing
 *   `evidence` object. After the change each check was seen red again on an
 *   injected fault; the list is in the pull request.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { handleUpdateEvent, type EventsEnv } from '../src/handlers/events';
import { handleV2AdminVerifyQr } from '../src/handlers/qr-verify';
import { giveCoreValues } from './helpers/core-values';
import { mintTestCode } from './helpers/go-live-evidence';

const E = env as unknown as Record<string, string> & { DB: D1Database };
const ORIGIN = 'https://localhost';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const JSON_HEADERS = { ...ADMIN, 'Content-Type': 'application/json' };

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

afterEach(() => vi.restoreAllMocks());

// ── Seeding ──────────────────────────────────────────────────────────────────

let made = 0;

/** An event row with its core values and NO codes at all. */
async function seedEvent(status: string): Promise<string> {
  made += 1;
  const id = `gle-${status}-${made}-${Date.now()}`;
  await E.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, qr_verified, created_at, updated_at)
     VALUES (?, 'brand-go-live-evidence', 'Go Live Evidence', ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(id, id, status, status === 'active' ? 1 : 0)
    .run();
  await giveCoreValues(E.DB, id);
  return id;
}

async function addLink(eventId: string, code: string, target: string | null = null) {
  await E.DB.prepare(
    `INSERT INTO shortlinks (code, event_id, target_url, kind, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  )
    .bind(code, eventId, target, target === null ? null : 'donate')
    .run();
}

/** A placed poster. Its token has the shape the scan route accepts unless one is given. */
async function addPoster(eventId: string, isActive: 0 | 1, token?: string): Promise<string> {
  const id = `gle-pd-${mintTestCode()}`;
  const qrToken = token ?? `qrt_gle_${mintTestCode()}${mintTestCode()}`;
  await E.DB.prepare(
    `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active)
     VALUES (?, ?, ?, 'Library window', ?)`
  )
    .bind(id, eventId, qrToken, isActive)
    .run();
  return qrToken;
}

async function readRow(id: string) {
  return E.DB.prepare('SELECT status, qr_verified, listed_from FROM events WHERE id = ?')
    .bind(id)
    .first<{ status: string; qr_verified: number; listed_from: string | null }>();
}

// ── The two doors ────────────────────────────────────────────────────────────

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

async function read(res: Response): Promise<Answer> {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const verifyQr = async (id: string) =>
  read(
    await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: ADMIN,
    })
  );

const putStatus = async (id: string, body: Record<string, unknown> = { status: 'active' }) =>
  read(
    await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })
  );

/** Each door, with the state it is entered from. PUT is tried from both. */
const DOORS = [
  { door: 'verify-qr', from: 'ready', go: verifyQr },
  { door: 'PUT status', from: 'ready', go: (id: string) => putStatus(id) },
  { door: 'PUT status', from: 'archived', go: (id: string) => putStatus(id) },
] as const;

const NOTHING = { shortlinks: 0, active_deployments: 0 };

function expectRefused(a: Answer, from: string) {
  expect(a.status).toBe(409);
  expect(a.body.ok).toBe(false);
  expect(a.body.code).toBe('NO_QR_EVIDENCE');
  expect(a.body.from).toBe(from);
  expect(a.body.to).toBe('active');
  expect(a.body.evidence).toEqual(NOTHING);
  expect(typeof a.body.error).toBe('string');
  expect(typeof a.body.requestId).toBe('string');
}

async function expectUntouched(id: string, from: string) {
  expect(await readRow(id)).toEqual({ status: from, qr_verified: 0, listed_from: null });
}

describe.each(DOORS)('$door from $from: no working code, no go-live', ({ from, go }) => {
  test('an event with no link and no poster is refused, and nothing is written', async () => {
    const id = await seedEvent(from);
    expectRefused(await go(id), from);
    await expectUntouched(id, from);
  });

  test('(a) a link whose code is not 6 base62 characters is not evidence', async () => {
    const id = await seedEvent(from);
    await addLink(id, `${mintTestCode()}x`); // 7 characters
    expectRefused(await go(id), from);
    await expectUntouched(id, from);
  });

  test('(a) a link whose code has a character outside base62 is not evidence', async () => {
    const id = await seedEvent(from);
    await addLink(id, `${mintTestCode().slice(0, 5)}-`);
    expectRefused(await go(id), from);
    await expectUntouched(id, from);
  });

  test('(a) a link whose target is not https is not evidence', async () => {
    const id = await seedEvent(from);
    await addLink(id, mintTestCode(), 'http://example.org/give');
    expectRefused(await go(id), from);
    await expectUntouched(id, from);
  });

  test('a poster that is switched off is not evidence', async () => {
    const id = await seedEvent(from);
    await addPoster(id, 0);
    expectRefused(await go(id), from);
    await expectUntouched(id, from);
  });

  test('(a) a switched-on poster whose token the scan route refuses is not evidence', async () => {
    const id = await seedEvent(from);
    await addPoster(id, 1, `gle-token-${mintTestCode()}`); // no qrt_ prefix
    await addPoster(id, 1, `qrt_${mintTestCode()}${'x'.repeat(119)}`); // 129 characters
    expectRefused(await go(id), from);
    await expectUntouched(id, from);
  });

  test("another event's link and poster are not this event's evidence", async () => {
    const other = await seedEvent('ready');
    await addLink(other, mintTestCode());
    await addPoster(other, 1);
    const id = await seedEvent(from);
    expectRefused(await go(id), from);
    await expectUntouched(id, from);
  });

  test('one working link is enough, and the receipt counts it', async () => {
    const id = await seedEvent(from);
    await addLink(id, mintTestCode());
    const a = await go(id);
    expect(a.status).toBe(200);
    expect(a.body.ok).toBe(true);
    expect(a.body.evidence).toEqual({ shortlinks: 1, active_deployments: 0 });
    const row = await readRow(id);
    expect(row?.status).toBe('active');
    expect(row?.qr_verified).toBe(1);
  });

  test('a working link with an https target counts', async () => {
    const id = await seedEvent(from);
    await addLink(id, mintTestCode(), 'https://example.org/give');
    const a = await go(id);
    expect(a.status).toBe(200);
    expect(a.body.evidence).toEqual({ shortlinks: 1, active_deployments: 0 });
  });

  test('one switched-on poster is enough, with no link at all', async () => {
    const id = await seedEvent(from);
    await addPoster(id, 1);
    const a = await go(id);
    expect(a.status).toBe(200);
    expect(a.body.evidence).toEqual({ shortlinks: 0, active_deployments: 1 });
    expect((await readRow(id))?.status).toBe('active');
  });

  test('(a) the receipt counts only the rows that work', async () => {
    const id = await seedEvent(from);
    await addLink(id, mintTestCode());
    await addLink(id, `${mintTestCode()}x`);
    await addLink(id, mintTestCode(), 'http://example.org/give');
    await addPoster(id, 1);
    await addPoster(id, 1);
    await addPoster(id, 0);
    await addPoster(id, 1, `gle-token-${mintTestCode()}`);
    const a = await go(id);
    expect(a.status).toBe(200);
    expect(a.body.evidence).toEqual({ shortlinks: 1, active_deployments: 2 });
  });

  test('(c) no answer carries a scan count: the evidence has two keys', async () => {
    const bare = await seedEvent(from);
    const refused = await go(bare);
    expect(Object.keys(refused.body.evidence as object).sort()).toEqual([
      'active_deployments',
      'shortlinks',
    ]);
    expect(JSON.stringify(refused.body)).not.toMatch(/scan/i);

    const linked = await seedEvent(from);
    await addLink(linked, mintTestCode());
    const allowed = await go(linked);
    expect(Object.keys(allowed.body.evidence as object).sort()).toEqual([
      'active_deployments',
      'shortlinks',
    ]);
    expect(JSON.stringify(allowed.body)).not.toMatch(/scan/i);
  });
});

// ── What the gate leaves alone ───────────────────────────────────────────────

describe('a write that does not move an event into active asks for no evidence', () => {
  test('a field edit on a ready event with no codes still saves', async () => {
    const id = await seedEvent('ready');
    const a = await putStatus(id, { title: 'Renamed While Ready' });
    expect(a.status).toBe(200);
    expect(a.body.evidence).toBeUndefined();
  });

  test('ready → draft with no codes still moves', async () => {
    const id = await seedEvent('ready');
    const a = await putStatus(id, { status: 'draft' });
    expect(a.status).toBe(200);
    expect((await readRow(id))?.status).toBe('draft');
  });

  test('a live event that is saved as active again is not a go-live', async () => {
    const id = await seedEvent('active');
    const a = await putStatus(id, { status: 'active', title: 'Renamed While Live' });
    expect(a.status).toBe(200);
    expect(a.body.evidence).toBeUndefined();
    expect((await readRow(id))?.status).toBe('active');
  });

  test('the core values are still asked for first', async () => {
    const id = await seedEvent('archived');
    await E.DB.prepare('UPDATE events SET starts_at = NULL WHERE id = ?').bind(id).run();
    const a = await putStatus(id);
    expect(a.status).toBe(409);
    expect(a.body.code).toBe('CORE_VALUES_MISSING');
  });

  test('a move the state machine refuses is still INVALID_TRANSITION', async () => {
    const id = await seedEvent('draft');
    const a = await verifyQr(id);
    expect(a.status).toBe(409);
    expect(a.body.code).toBe('INVALID_TRANSITION');
  });
});

// ── A refusal is logged without naming the event ─────────────────────────────

describe('a refused go-live writes one line that names no event', () => {
  test.each(DOORS)('$door from $from', async ({ door, from, go }) => {
    const id = await seedEvent(from);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expectRefused(await go(id), from);
    const lines = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('go_live_refused'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([
      {
        type: 'LIFECYCLE',
        event: 'go_live_refused',
        door: door === 'verify-qr' ? 'verify_qr' : 'put_status',
        from,
        to: 'active',
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(id);
  });
});

// ── (b) a read that fails is not "no QR" ─────────────────────────────────────

type Failure = 'throws' | 'no rows array';

/** The real database, except that reads of one table fail. */
function failingOn(table: 'shortlinks' | 'poster_deployments', how: Failure): D1Database {
  const real = E.DB;
  const from = new RegExp(`\\bFROM\\s+${table}\\b`, 'i');
  const broken = {
    bind: () => broken,
    all: async () => {
      if (how === 'throws') throw new Error('D1_ERROR: simulated read failure: SQLITE_BUSY');
      return { success: true, meta: {} };
    },
    first: async () => {
      throw new Error('D1_ERROR: simulated read failure: SQLITE_BUSY');
    },
    run: async () => {
      throw new Error('D1_ERROR: simulated read failure: SQLITE_BUSY');
    },
  };
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => (from.test(sql) ? broken : target.prepare(sql));
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as D1Database;
}

const READ_FAILURES = [
  { table: 'shortlinks', how: 'throws' },
  { table: 'poster_deployments', how: 'throws' },
  { table: 'shortlinks', how: 'no rows array' },
  { table: 'poster_deployments', how: 'no rows array' },
] as const;

describe.each(READ_FAILURES)(
  '(b) the $table read fails ($how): 503, never 409 "no QR"',
  ({ table, how }) => {
    function errorLines(spy: ReturnType<typeof vi.spyOn>) {
      return spy.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('goLiveEvidence'))
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    }

    test('verify-qr', async () => {
      // The event HAS a working link and poster: a failed read must not pass
      // on what it did manage to read, and must not say there is none.
      const id = await seedEvent('ready');
      await addLink(id, mintTestCode());
      await addPoster(id, 1);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await handleV2AdminVerifyQr(
        new Request(`${ORIGIN}/api/v2/admin/events/${id}/verify-qr`, { method: 'POST' }),
        { DB: failingOn(table, how) },
        id,
        'ref-evidence-0001'
      );
      const a = await read(res);
      expect(a.status).toBe(503);
      expect(a.body.ok).toBe(false);
      expect(a.body.code).toBe('EVIDENCE_UNAVAILABLE');
      expect(a.body.requestId).toBe('ref-evidence-0001');
      expect(res.headers.get('X-Request-Id')).toBe('ref-evidence-0001');
      expect(a.body.evidence).toBeUndefined();
      await expectUntouched(id, 'ready');

      const lines = errorLines(spy);
      expect(lines).toHaveLength(1);
      expect(Object.keys(lines[0]!).sort()).toEqual([
        'door',
        'error',
        'handler',
        'timestamp',
        'type',
      ]);
      expect(lines[0]).toMatchObject({
        type: 'DB_ERROR',
        handler: 'goLiveEvidence',
        door: 'verify_qr',
      });
      // The label is the error's class and codes, never its message or the id.
      expect(JSON.stringify(lines)).not.toContain(id);
      expect(JSON.stringify(lines)).not.toContain('simulated');
    });

    test.each(['ready', 'archived'])('PUT status from %s', async (from) => {
      const id = await seedEvent(from);
      await addLink(id, mintTestCode());
      await addPoster(id, 1);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await handleUpdateEvent(
        new Request(`${ORIGIN}/api/v2/admin/events/${id}`, {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ status: 'active' }),
        }),
        { ...(E as unknown as EventsEnv), DB: failingOn(table, how) },
        id
      );
      const a = await read(res);
      expect(a.status).toBe(503);
      expect(a.body.code).toBe('EVIDENCE_UNAVAILABLE');
      expect(typeof a.body.requestId).toBe('string');
      expect(a.body.evidence).toBeUndefined();
      await expectUntouched(id, from);

      const lines = errorLines(spy);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: 'DB_ERROR',
        handler: 'goLiveEvidence',
        door: 'put_status',
      });
      expect(JSON.stringify(lines)).not.toContain(id);
    });
  }
);

// ── The rule, checked against the route that serves the link ─────────────────

describe('what the gate counts is what the resolver serves', () => {
  test('a counted link answers 302 to its own event; a refused code answers 404', async () => {
    const id = await seedEvent('ready');
    const good = mintTestCode();
    const long = `${mintTestCode()}x`;
    await addLink(id, good);
    await addLink(id, long);
    const a = await verifyQr(id);
    expect(a.status).toBe(200);
    expect(a.body.evidence).toEqual({ shortlinks: 1, active_deployments: 0 });

    const served = await SELF.fetch(`${ORIGIN}/s/${good}`, { redirect: 'manual' });
    expect(served.status).toBe(302);
    expect(served.headers.get('Location')).toContain(id);

    const refused = await SELF.fetch(`${ORIGIN}/s/${long}`, { redirect: 'manual' });
    expect(refused.status).toBe(404);
  });

  test('a counted poster forwards a scan to its own event; a refused token is sent home', async () => {
    const id = await seedEvent('ready');
    const good = await addPoster(id, 1);
    const bad = await addPoster(id, 1, `gle-token-${mintTestCode()}`);
    const off = await addPoster(id, 0);
    const a = await verifyQr(id);
    expect(a.status).toBe(200);
    expect(a.body.evidence).toEqual({ shortlinks: 0, active_deployments: 1 });

    const scan = (token: string) =>
      SELF.fetch(`${ORIGIN}/q/${encodeURIComponent(token)}`, { redirect: 'manual' });
    const served = await scan(good);
    expect(served.status).toBe(302);
    expect(served.headers.get('Location')).toContain(`/events/${id}`);
    for (const token of [bad, off]) {
      const sentHome = await scan(token);
      expect(sentHome.status).toBe(302);
      expect(sentHome.headers.get('Location')).toBe('/');
    }
  });
});
