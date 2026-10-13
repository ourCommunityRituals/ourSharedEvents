/**
 * The unhandled-error log line never carries a signed link.
 *
 * Workers Logs are on, so every line the Worker writes is kept by a third
 * party. A sponsor's home link (`/sponsor?t=…`), a SharedReport link
 * (`/sharedReport?…&token=…`) and an onboarding draft's asset path
 * (`/api/v2/sponsors/draft/<token>/asset/…`) are bearer credentials: whoever
 * reads one can use it. When a request fails with an error nobody caught, the
 * line that records it may say which route failed and what kind of error it
 * was. It may not carry the URL, its query string, or any part of the path that
 * is not a fixed word.
 *
 * Method: real requests through the Worker (SELF), every console level
 * captured, and a fault switched on inside the request:
 *   - `inSponsorHome` fails a read deep inside the real sponsor-home handler,
 *     after it has verified a live signed link (a database that goes away
 *     half-way through the page);
 *   - `atRouter` fails the first statement of the router, which reaches the
 *     same catch for any URL at all.
 * The credentials in the URLs are real ones, minted with the test secret.
 *
 * Level: W (workers pool, real D1, real routes through SELF).
 *
 * @born-red path-borne token | method: ran against index.ts before the change.
 *   The line logged `path: new URL(request.url).pathname`, so the draft token in
 *   the path was written out | date: 2026-10-07
 * @born-red error that repeats the URL | method: ran against index.ts before
 *   the change. The line logged `err.message` as it came, so an error naming the
 *   URL wrote the whole signed link | date: 2026-10-07
 * @born-red route pattern and error class | method: ran against index.ts before
 *   the change. The line had no `op` and no `errorClass` | date: 2026-10-07
 * @born-red query-borne token | method: already held on main (pathname only),
 *   so it was proved by logging `request.url` again and watching the tests
 *   fail | date: 2026-10-07
 * @born-red code and request reference on the 500 | method: ran against
 *   index.ts before the change. The answer had no `code`, no `requestId` and no
 *   X-Request-Id header, and the line had no `requestId` (11 cases failed) |
 *   date: 2026-10-12
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';

const fault = vi.hoisted(() => ({
  atRouter: null as null | ((request: Request) => unknown),
  inSponsorHome: null as null | (() => unknown),
}));

vi.mock('../src/lib/cors', async (orig) => {
  const real = await orig<typeof import('../src/lib/cors')>();
  return {
    ...real,
    bindCorsEnv: (...args: Parameters<typeof real.bindCorsEnv>) => {
      if (fault.atRouter) throw fault.atRouter(args[0]);
      return real.bindCorsEnv(...args);
    },
  };
});

vi.mock('../src/lib/sponsor-discovery', async (orig) => {
  const real = await orig<typeof import('../src/lib/sponsor-discovery')>();
  return {
    ...real,
    readDiscoverableEvents: async (...args: Parameters<typeof real.readDiscoverableEvents>) => {
      if (fault.inSponsorHome) throw fault.inSponsorHome();
      return real.readDiscoverableEvents(...args);
    },
  };
});

const { mintSponsorHomeToken } = await import('../src/lib/sponsor-home-auth');
const { mintSignedLinkToken } = await import('../src/lib/shared-report-auth');

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const E = env as unknown as TestEnv;
const ORIGIN = 'https://t.test';
const BRAND = 'ose-unhandled-log';
const SPONSOR = 'uel-sponsor';
const EVENT = 'uel-event';

let sponsorToken = '';
let reportToken = '';

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
  await E.DB.prepare(
    `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, start_date)
     VALUES (?, ?, 'Unhandled Log Event', 'uel-event', 'active', '2099-01-01')`
  )
    .bind(EVENT, BRAND)
    .run();
  await E.DB.prepare(
    `INSERT OR IGNORE INTO sponsor_business (id, brand_id, name, is_active) VALUES (?, ?, 'Log Test Bakery', 1)`
  )
    .bind(SPONSOR, BRAND)
    .run();
  sponsorToken = (await mintSponsorHomeToken(E, SPONSOR, BRAND))!.token;
  reportToken = (await mintSignedLinkToken(E, EVENT, 'sponsor', 3600, { sponsor_id: SPONSOR }))!;
  expect(sponsorToken.length).toBeGreaterThan(80);
  expect(reportToken.length).toBeGreaterThan(80);
});

afterEach(() => {
  fault.atRouter = null;
  fault.inSponsorHome = null;
  vi.restoreAllMocks();
});

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Every line written to any console level while `fn` ran, as text. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((a) =>
            typeof a === 'string'
              ? a
              : a instanceof Error
                ? `${a.message} ${a.stack ?? ''}`
                : safeJson(a)
          )
          .join(' ')
      );
    });
  }
  const result = await fn();
  return { result, lines };
}

const unhandled = (lines: string[]) =>
  lines
    .filter((l) => l.includes('"UNHANDLED_ERROR"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);

/**
 * A signed token and the pieces of it that must not be written out either: the
 * payload (it names the sponsor or event) and the signature.
 */
function pieces(token: string): string[] {
  return [token, ...token.split('.').filter((p) => p.length >= 16)];
}

/** No captured line may contain any of `secrets`, in plain or URL-encoded form. */
function expectAbsent(lines: string[], secrets: string[], what: string): void {
  for (const secret of secrets) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      for (const line of lines) {
        expect(line, `${what} is in a log line`).not.toContain(form);
      }
    }
  }
}

// What a failure toast can show as a reference (ocrToast.detailsFrom).
const REFERENCE = /^[A-Za-z0-9_.:-]{8,64}$/;

async function expectPlain500(res: Response, secrets: string[]): Promise<void> {
  expect(res.status).toBe(500);
  const reference = res.headers.get('X-Request-Id');
  expect(reference, 'X-Request-Id header').toMatch(REFERENCE);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({
    ok: false,
    status: 500,
    code: 'INTERNAL',
    error: 'Internal server error',
    requestId: reference,
  });
  for (const s of secrets) expect(text).not.toContain(s);
}

describe('an unhandled error on a signed link', () => {
  test('a failure inside the sponsor home page does not log the live sponsor link', async () => {
    fault.inSponsorHome = () => new Error('D1_ERROR: no such table: events: SQLITE_ERROR');
    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(`${ORIGIN}/sponsor?t=${sponsorToken}`)
    );
    await expectPlain500(res, pieces(sponsorToken));
    expect(unhandled(lines), 'the failure was logged once').toHaveLength(1);
    expectAbsent(lines, pieces(sponsorToken), 'the sponsor link token');
    for (const line of lines) expect(line, 'a query string is in a log line').not.toContain('?t=');
  });

  test.each([
    ['the sponsor home page', () => `/sponsor?t=${sponsorToken}`, () => sponsorToken, 'GET'],
    [
      'the SharedReport page',
      () => `/sharedReport?eventId=${EVENT}&token=${reportToken}`,
      () => reportToken,
      'GET',
    ],
    [
      'the SharedReport API',
      () => `/api/v2/events/${EVENT}/shared-report?token=${reportToken}`,
      () => reportToken,
      'GET',
    ],
  ] as const)(
    'a failure on %s does not log its query string',
    async (_name, path, token, method) => {
      fault.atRouter = () => new Error('boom');
      const { result: res, lines } = await captureLogs(() =>
        SELF.fetch(`${ORIGIN}${path()}`, { method })
      );
      await expectPlain500(res, pieces(token()));
      expect(unhandled(lines)).toHaveLength(1);
      expectAbsent(lines, pieces(token()), 'the signed token');
      const search = new URL(`${ORIGIN}${path()}`).search;
      for (const line of lines) {
        expect(line, 'the query string is in a log line').not.toContain(search);
        expect(line, 'the query string is in a log line').not.toContain(search.slice(1));
      }
    }
  );

  test('a token carried in the path is not logged either', async () => {
    const draftToken = crypto.randomUUID();
    fault.atRouter = () => new Error('boom');
    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(`${ORIGIN}/api/v2/sponsors/draft/${draftToken}/asset/svg`, {
        method: 'POST',
        body: 'x',
      })
    );
    await expectPlain500(res, [draftToken]);
    expect(unhandled(lines)).toHaveLength(1);
    expectAbsent(lines, [draftToken], 'the draft token from the path');
  });

  test.each([
    [
      'an Error whose message repeats the URL',
      (r: Request) => new TypeError(`fetch failed: ${r.url}`),
    ],
    [
      'an Error whose message repeats the token',
      (r: Request) => new Error(`bad token ${new URL(r.url).searchParams.get('t')}`),
    ],
    [
      'an Error whose message repeats the path and query',
      (r: Request) =>
        new Error(`no handler for ${new URL(r.url).pathname}${new URL(r.url).search}`),
    ],
    ['a thrown string that is the URL', (r: Request) => r.url],
  ] as const)('%s does not bring the signed link into the log', async (_name, make) => {
    fault.atRouter = make;
    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(`${ORIGIN}/sponsor?t=${sponsorToken}`)
    );
    await expectPlain500(res, pieces(sponsorToken));
    expect(unhandled(lines)).toHaveLength(1);
    expectAbsent(lines, pieces(sponsorToken), 'the sponsor link token');
  });

  test.each([
    ['the whole path', (r: Request) => new Error(`upload failed for ${new URL(r.url).pathname}`)],
    [
      'the token alone',
      (r: Request) => new Error(`draft ${new URL(r.url).pathname.split('/')[5]} not found`),
    ],
  ] as const)(
    'an error that repeats %s does not bring a token from the path into the log',
    async (_name, make) => {
      const draftToken = crypto.randomUUID();
      fault.atRouter = make;
      const { lines } = await captureLogs(() =>
        SELF.fetch(`${ORIGIN}/api/v2/sponsors/draft/${draftToken}/asset/svg`, {
          method: 'POST',
          body: 'x',
        })
      );
      const [line] = unhandled(lines);
      expect(line.error).toContain('[redacted]');
      expectAbsent(lines, [draftToken], 'the draft token from the path');
    }
  );

  test('an error whose name was set to the URL does not bring the signed link into the log', async () => {
    fault.atRouter = (r) => Object.assign(new Error('boom'), { name: r.url });
    const { lines } = await captureLogs(() => SELF.fetch(`${ORIGIN}/sponsor?t=${sponsorToken}`));
    const [line] = unhandled(lines);
    expect(line.errorClass).toBe('Error');
    expectAbsent(lines, pieces(sponsorToken), 'the sponsor link token');
  });
});

describe('the unhandled-error line stays useful', () => {
  test('it names the route pattern, the error class and what the error said', async () => {
    fault.atRouter = () => new RangeError('offset 12 is out of bounds');
    const { lines } = await captureLogs(() =>
      SELF.fetch(`${ORIGIN}/api/v2/sponsors/draft/${crypto.randomUUID()}/asset/svg`, {
        method: 'POST',
        body: 'x',
      })
    );
    const [line] = unhandled(lines);
    expect(line).toMatchObject({
      type: 'UNHANDLED_ERROR',
      // Every segment that is not a known fixed word is masked, `asset` included.
      op: 'POST /api/v2/sponsors/draft/:x/:x/:x',
      errorClass: 'RangeError',
      error: 'offset 12 is out of bounds',
    });
    expect(Object.keys(line).sort()).toEqual([
      'error',
      'errorClass',
      'op',
      'requestId',
      'timestamp',
      'type',
    ]);
  });

  test('it carries the reference the 500 answered with, a new one for each request', async () => {
    const references: string[] = [];
    for (let i = 0; i < 2; i++) {
      fault.atRouter = () => new Error('boom');
      const { result: res, lines } = await captureLogs(() =>
        SELF.fetch(`${ORIGIN}/api/v2/admin/events/evt_none/verify-qr`, { method: 'POST' })
      );
      expect(res.status).toBe(500);
      const reference = res.headers.get('X-Request-Id');
      expect(reference, 'X-Request-Id header').toMatch(REFERENCE);
      const body = (await res.json()) as { code: string; requestId: string };
      expect(body.code).toBe('INTERNAL');
      expect(body.requestId).toBe(reference);
      expect(unhandled(lines)).toHaveLength(1);
      expect(unhandled(lines)[0].requestId).toBe(reference);
      references.push(reference!);
      vi.restoreAllMocks();
    }
    expect(references[0]).not.toBe(references[1]);
  });

  test('the same route pattern is on the cost line, so the two can be joined', async () => {
    fault.atRouter = () => new Error('boom');
    const { lines } = await captureLogs(() => SELF.fetch(`${ORIGIN}/sponsor?t=${sponsorToken}`));
    const cost = lines
      .filter((l) => l.includes('"OPERATION_COST"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(cost).toHaveLength(1);
    expect(cost[0]).toMatchObject({ op: 'GET /sponsor', status: 500 });
    expect(unhandled(lines)[0].op).toBe(cost[0].op);
  });

  test('a message that only names the redacted part still says what failed', async () => {
    fault.atRouter = (r) => new Error(`timeout after 5000 ms loading ${r.url}`);
    const { lines } = await captureLogs(() => SELF.fetch(`${ORIGIN}/sponsor?t=${sponsorToken}`));
    const [line] = unhandled(lines);
    expect(line.error).toBe('timeout after 5000 ms loading [redacted]');
  });

  test('a thrown value that is not an Error is described without its content leaking the link', async () => {
    fault.atRouter = () => ({ reason: 'not an error object' });
    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(`${ORIGIN}/sponsor?t=${sponsorToken}`)
    );
    expect(res.status).toBe(500);
    const [line] = unhandled(lines);
    expect(line.errorClass).toBe('object');
    expectAbsent(lines, pieces(sponsorToken), 'the sponsor link token');
  });
});

describe('a handled request on a signed link', () => {
  test('a working sponsor link is not written to the log', async () => {
    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(`${ORIGIN}/sponsor?t=${sponsorToken}`)
    );
    expect(res.status).toBe(200);
    expect(lines.length, 'the request logged something (the cost line at least)').toBeGreaterThan(
      0
    );
    expectAbsent(lines, pieces(sponsorToken), 'the sponsor link token');
  });

  test('a refused sponsor link is not written to the log', async () => {
    const forged = `${sponsorToken.slice(0, -4)}0000`;
    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(`${ORIGIN}/sponsor?t=${forged}`)
    );
    expect(res.status).toBe(401);
    expectAbsent(lines, pieces(forged), 'the refused token');
  });

  test('a SharedReport API read with a signed link is not written to the log', async () => {
    const { result: res, lines } = await captureLogs(() =>
      SELF.fetch(`${ORIGIN}/api/v2/events/${EVENT}/shared-report?token=${reportToken}`)
    );
    expect(res.status).toBeLessThan(500);
    expect(lines.length).toBeGreaterThan(0);
    expectAbsent(lines, pieces(reportToken), 'the report link token');
  });
});
