/**
 * What a failure toast reads from a refused request, past the first refusal:
 * the form switch, and the publish and unpublish steps of a status change.
 *
 * A failure toast shows two things and reads them from one place each
 * (`ocrToast.detailsFrom`): the body's `code` and the `X-Request-Id` response
 * header. Without the header it reads "Request reference: not available".
 *
 * What this holds, for PUT /api/v2/admin/events/:id/flags/:key and for
 * POST /api/v2/admin/events/:id/verify-qr and /unverify-qr:
 *   - a refusal on a real event (a status that cannot move that way, a
 *     publish with no start time, a status that moved while saving) carries a
 *     `code`, and `X-Request-Id` as a short id, equal to the body's `requestId`
 *   - the reference is the one on the request's audit row, and on the flag
 *     handler's FLAG_EVENT log line, so it can be found later
 *   - an answer that worked carries the header too, and its body is unchanged
 *
 * The refusal for a thing that is not there, one per endpoint, is in the
 * REFUSALS table of ui-toast-route.spec.ts ("what a failure toast reads from a
 * refused request"). The rows here have the same shape and need seeded events.
 *
 * Level: W (workers pool, real D1, real routes through SELF).
 *
 * @born-red request reference on a refusal | method: run before
 *   handlers/feature-flags.ts and handlers/qr-verify.ts set the header (every
 *   case failed on a null X-Request-Id; five of the cases then here have since
 *   moved to ui-toast-route.spec.ts) | date: 2026-10-12
 * @born-red the reference is the audit row's | method: the router's call to
 *   verify-qr put back to three arguments, so the handler made an id of its
 *   own (the audit case and the publish case failed, the rest passed) |
 *   date: 2026-10-12
 * @born-red STATUS_CONFLICT | method: run against handlers/qr-verify.ts as it
 *   was on main (both cases failed on a null header) | date: 2026-10-12
 */

import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, test, expect, vi } from 'vitest';
import { giveCoreValues } from './helpers/core-values';
import { handleV2AdminUnverifyQr, handleV2AdminVerifyQr } from '../src/handlers/qr-verify';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const ORIGIN = 'https://t.test';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const JSON_BODY = { 'Content-Type': 'application/json' };
const BRAND = 'ose-toast-reference';
// The toast shows a code or a reference only when it is a short id (letters,
// digits, `_ . : -`); anything else reads "not available".
const REFERENCE = /^[A-Za-z0-9_.:-]{8,64}$/;
const CODE = /^[A-Za-z0-9_.:-]{1,48}$/;

const DRAFT = 'trr-draft';
const READY = 'trr-ready';
const ARCHIVED = 'trr-archived';

async function applyAll(db: D1Database, statements: string): Promise<void> {
  for (const stmt of JSON.parse(statements) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function insertEvent(id: string, status: string): Promise<void> {
  await E.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date)
     VALUES (?, ?, ?, ?, ?, '2099-01-01')`
  )
    .bind(id, BRAND, `Toast reference ${id}`, id, status)
    .run();
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
  await insertEvent(DRAFT, 'draft');
  await insertEvent(READY, 'ready');
  await giveCoreValues(E.DB, READY);
  await insertEvent(ARCHIVED, 'archived');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The audit row is written after the answer (ctx.waitUntil), so wait for it. */
async function auditRow(action: string, requestId: string) {
  for (let i = 0; i < 20; i++) {
    const row = await E.DB.prepare(
      'SELECT outcome, resource_id FROM admin_audit_log WHERE action = ? AND request_id = ?'
    )
      .bind(action, requestId)
      .first<{ outcome: string; resource_id: string }>();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

describe('what a failure toast reads from a refusal on a real event', () => {
  // The refusals a person can meet on a real event: a status that cannot move
  // that way, and an archived event brought back with no start time or event
  // type.
  const REFUSALS: Array<{
    action: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
    status: number;
    code: string;
  }> = [
    {
      action: 'admin: publish a draft',
      method: 'POST',
      path: `/api/v2/admin/events/${DRAFT}/verify-qr`,
      headers: ADMIN,
      status: 409,
      code: 'INVALID_TRANSITION',
    },
    {
      action: 'admin: unpublish an archived event',
      method: 'POST',
      path: `/api/v2/admin/events/${ARCHIVED}/unverify-qr`,
      headers: ADMIN,
      status: 409,
      code: 'INVALID_TRANSITION',
    },
    {
      action: 'admin: publish an archived event with no start time',
      method: 'POST',
      path: `/api/v2/admin/events/${ARCHIVED}/verify-qr`,
      headers: ADMIN,
      status: 409,
      code: 'CORE_VALUES_MISSING',
    },
  ];

  for (const r of REFUSALS) {
    test(`${r.action}: a code, and X-Request-Id as a short id`, async () => {
      const res = await SELF.fetch(`${ORIGIN}${r.path}`, {
        method: r.method,
        headers: r.headers,
        body: r.body === undefined ? undefined : JSON.stringify(r.body),
      });
      expect(res.status).toBe(r.status);
      const body = (await res.json()) as { code: string; requestId: string };
      expect(body.code).toBe(r.code);
      const reference = res.headers.get('X-Request-Id');
      expect(reference, 'X-Request-Id header').toMatch(REFERENCE);
      expect(body.code).toMatch(CODE);
      expect(body.requestId).toBe(reference);
    });
  }
});

describe('a status that moved while saving', () => {
  // The read sees one status and the guarded write changes no row: another tab
  // moved the event in between. It cannot be staged through the route, so the
  // handler is called with a database that answers that way.
  const moved = (status: string) =>
    ({
      prepare: () => ({
        bind: () => ({
          first: async () => ({ id: 'evt_moved', status, starts_at: 'x', event_type_id: 'x' }),
          run: async () => ({ meta: { changes: 0 } }),
        }),
      }),
    }) as unknown as D1Database;

  test.each([
    ['publish', handleV2AdminVerifyQr, 'ready'],
    ['unpublish', handleV2AdminUnverifyQr, 'active'],
  ] as const)(
    '%s: STATUS_CONFLICT carries the reference it was given',
    async (_n, handler, from) => {
      const res = await handler(
        new Request(`${ORIGIN}/api/v2/admin/events/evt_moved/x`, { method: 'POST' }),
        { DB: moved(from) },
        'evt_moved',
        'ref-moved-0001'
      );
      expect(res.status).toBe(409);
      expect(res.headers.get('X-Request-Id')).toBe('ref-moved-0001');
      expect(await res.json()).toEqual({
        ok: false,
        code: 'STATUS_CONFLICT',
        error: 'This event changed while saving. Reload and try again.',
        requestId: 'ref-moved-0001',
      });
    }
  );
});

describe('the reference can be found later', () => {
  test.each([
    ['VERIFY_QR', 'POST', '/api/v2/admin/events/evt_none_a/verify-qr', 'evt_none_a'],
    ['UNVERIFY_QR', 'POST', '/api/v2/admin/events/evt_none_b/unverify-qr', 'evt_none_b'],
    [
      'SET_EVENT_FLAG',
      'PUT',
      '/api/v2/admin/events/evt_none_c/flags/not.a.flag',
      'evt_none_c/not.a.flag',
    ],
  ] as const)('a refused %s is audited under the reference it answered with', async (...c) => {
    const [action, method, path, resource] = c;
    const res = await SELF.fetch(`${ORIGIN}${path}`, {
      method,
      headers: { ...ADMIN, ...JSON_BODY },
      body: method === 'PUT' ? JSON.stringify({ enabled: true }) : undefined,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const reference = res.headers.get('X-Request-Id');
    expect(reference, 'X-Request-Id header').toMatch(REFERENCE);
    expect(await auditRow(action, reference!)).toEqual({
      outcome: 'denied',
      resource_id: resource,
    });
  });

  test('the form switch log line carries the reference', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${READY}/flags/forms.register`, {
      method: 'PUT',
      headers: { ...ADMIN, ...JSON_BODY },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const reference = res.headers.get('X-Request-Id');
    const flagLines = lines
      .filter((l) => l.includes('"FLAG_EVENT"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(flagLines).toHaveLength(1);
    expect(flagLines[0]).toMatchObject({
      type: 'FLAG_EVENT',
      action: 'set_event',
      requestId: reference,
    });
    expect(Object.keys(flagLines[0]).sort()).toEqual([
      'action',
      'enabled',
      'eventId',
      'flagKey',
      'requestId',
      'timestamp',
      'type',
    ]);
  });
});

describe('an answer that worked carries the reference in the header only', () => {
  test('the form switch: X-Request-Id, and the body it had before', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${READY}/flags/forms.survey`, {
      method: 'PUT',
      headers: { ...ADMIN, ...JSON_BODY },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toMatch(REFERENCE);
    expect(await res.json()).toEqual({
      ok: true,
      eventId: READY,
      flagKey: 'forms.survey',
      enabled: true,
      scope: 'event',
    });
  });

  test('publish then unpublish: X-Request-Id on both, and the bodies they had before', async () => {
    const published = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${READY}/verify-qr`, {
      method: 'POST',
      headers: ADMIN,
    });
    expect(published.status).toBe(200);
    const publishRef = published.headers.get('X-Request-Id');
    expect(publishRef).toMatch(REFERENCE);
    const publishedBody = (await published.json()) as { event: { listedFrom: string | null } };
    expect(publishedBody).toEqual({
      ok: true,
      event: {
        id: READY,
        status: 'active',
        qrVerified: true,
        listedFrom: publishedBody.event.listedFrom,
      },
    });
    expect(await auditRow('VERIFY_QR', publishRef!)).toEqual({
      outcome: 'success',
      resource_id: READY,
    });

    const unpublished = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${READY}/unverify-qr`, {
      method: 'POST',
      headers: ADMIN,
    });
    expect(unpublished.status).toBe(200);
    expect(unpublished.headers.get('X-Request-Id')).toMatch(REFERENCE);
    expect(unpublished.headers.get('X-Request-Id')).not.toBe(publishRef);
    expect(await unpublished.json()).toEqual({
      ok: true,
      event: { id: READY, status: 'ready', qrVerified: false },
    });
  });
});
