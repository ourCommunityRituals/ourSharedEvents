/**
 * Admin writes: cross-site requests are refused, and JSON means JSON.
 *
 * An admin signs in through Cloudflare Access, and the browser then attaches the
 * Access cookie to every request to this host, including one a different site
 * makes on the admin's behalf. Before this guard nothing checked where an admin
 * write came from, and the content-type checks that existed could be passed by a
 * plain HTML form (`text/plain; x=application/json`) or did not exist at all.
 *
 * The rule (src/lib/admin-write-guard.ts), for every request to an admin path
 * with a method other than GET, HEAD or OPTIONS:
 *
 *   1. If the browser says where the request came from, it must be this origin:
 *      `Sec-Fetch-Site: same-origin`, or, when that header is absent, an
 *      `Origin` equal to this host. This holds for every caller.
 *   2. If the request says nothing about where it came from, it passes only when
 *      the caller proved itself with a secret header (a `key:` actor). A signed-in
 *      person with no such evidence is refused. A caller nobody can identify goes
 *      on to requireAdmin and gets its 401.
 *   3. A body sent by an identified caller must be `application/json` (an optional
 *      charset is allowed), except on the one multipart upload route.
 *
 * Every test here calls route() the way the Worker does. Nothing imports the
 * guard module, so the tests were written and seen red before it existed.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, vi } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { PLATFORM_BRAND_ID } from '../src/lib/admin-brand-scope';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const HOST = 'https://ose.test';
const BRAND = 'awg-brand';
const EVT = 'evt-awg-1';
const OWNER_EMAIL = 'awg-owner@example.com';
const PLATFORM_EMAIL = 'awg-platform@example.com';
const FLAG = 'forms.register';

async function applyStatements(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function accessJwt(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ iat: now - 10, exp: now + 3600, ...claims })}.sig`;
}

type H = Record<string, string>;

/** A signed-in person: what Access adds after it has checked the cookie. */
const asEmail = (email: string): H => ({ 'Cf-Access-Jwt-Assertion': accessJwt({ email }) });
const OWNER = asEmail(OWNER_EMAIL);
const PLATFORM = asEmail(PLATFORM_EMAIL);

/** Automation: a secret header no browser can be made to send. */
const KEY_BEARER: H = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const KEY_OCR: H = { 'X-OCR-Internal': 'test-ocr-internal-secret-2026' };
/** The staging CI shape: an Access service-token JWT (no email) plus a key. */
const SERVICE_TOKEN_AND_KEY: H = {
  'Cf-Access-Jwt-Assertion': accessJwt({ common_name: 'ci-token.access' }),
  ...KEY_BEARER,
};

/** What a browser says about where a request came from. */
const SAME_ORIGIN: H = { 'Sec-Fetch-Site': 'same-origin', Origin: HOST };
const CROSS_SITE: H = { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' };

const JSON_CT: H = { 'Content-Type': 'application/json' };
/** The two bodies a plain cross-site HTML form can send. */
const FORM_TYPES = ['text/plain', 'text/plain; x=application/json'] as const;

interface Sent {
  status: number;
  code: string | undefined;
  body: Record<string, unknown>;
  headers: Headers;
}

async function send(
  method: string,
  path: string,
  headers: H,
  body?: unknown,
  contentType?: string | null
): Promise<Sent> {
  const h: H = { ...headers };
  const init: RequestInit = { method, headers: h };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    // null = a body with no declared type at all (an untyped Blob). route() is
    // called in-process here, so the Content-Length a real HTTP hop adds is set
    // by hand.
    if (contentType === null) {
      h['Content-Length'] = String(new TextEncoder().encode(init.body as string).length);
      init.body = new Blob([init.body as string]);
    } else h['Content-Type'] = contentType ?? 'application/json';
  } else if (contentType) {
    h['Content-Type'] = contentType;
  }
  const ctx = createExecutionContext();
  const res = await route(new Request(`${HOST}${path}`, init), routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return {
    status: res.status,
    code: parsed.code as string | undefined,
    body: parsed,
    headers: res.headers,
  };
}

async function count(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const eventTitle = async (): Promise<string | undefined> =>
  (
    await tenv.DB.prepare('SELECT title FROM events WHERE id = ?')
      .bind(EVT)
      .first<{ title: string }>()
  )?.title;

beforeAll(async () => {
  await applyStatements(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await applyStatements(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, 'AWG original title', ?, 'draft')`
  )
    .bind(EVT, BRAND, EVT)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
  )
    .bind(OWNER_EMAIL, BRAND)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
  )
    .bind(PLATFORM_EMAIL, PLATFORM_BRAND_ID)
    .run();
});

// ─── The handlers the finding names ──────────────────────────────────────────
// Each is called as the person who is allowed to make that change, so a 403 is
// the guard's doing and not a missing permission.

interface Listed {
  name: string;
  method: 'POST' | 'PUT';
  path: string;
  who: H;
  body: unknown;
}

const LISTED: Listed[] = [
  {
    name: 'events.ts: create event',
    method: 'POST',
    path: '/api/v2/admin/events',
    who: OWNER,
    body: { title: 'Made by another site' },
  },
  {
    name: 'events.ts: update event',
    method: 'PUT',
    path: `/api/v2/admin/events/${EVT}`,
    who: OWNER,
    body: { title: 'Renamed by another site' },
  },
  {
    name: 'sponsors.ts: create sponsor',
    method: 'POST',
    path: '/api/v2/admin/sponsors',
    who: OWNER,
    body: { name: 'Sponsor from another site', tier: 'primary' },
  },
  {
    name: 'sponsor-home.ts: organizer answers a sponsor request',
    method: 'POST',
    path: '/api/v2/admin/sponsor-requests/spl_awg_none/respond',
    who: OWNER,
    body: { approve: true },
  },
  {
    name: 'data-subject.ts: erase',
    method: 'POST',
    path: '/api/v2/admin/data-subject/erase',
    who: PLATFORM,
    body: { email: 'erase-me@example.com' },
  },
  {
    name: 'feature-flags.ts: global flag',
    method: 'PUT',
    path: `/api/v2/admin/flags/${FLAG}`,
    who: KEY_OCR,
    body: { enabled: false },
  },
  {
    name: 'feature-flags.ts: apply tier',
    method: 'POST',
    path: '/api/v2/admin/flags/apply-tier',
    who: KEY_OCR,
    body: { tier: 'free' },
  },
  {
    name: 'feature-flags.ts: event flag',
    method: 'PUT',
    path: `/api/v2/admin/events/${EVT}/flags/${FLAG}`,
    who: OWNER,
    body: { enabled: false },
  },
  {
    name: 'poster-deployments.ts: create poster deployment',
    method: 'POST',
    path: `/api/v2/admin/events/${EVT}/poster-deployments`,
    who: OWNER,
    body: { placement_label: 'Hung by another site' },
  },
];

describe('a cross-site request to each handler the finding names is refused (403)', () => {
  for (const r of LISTED) {
    for (const ct of FORM_TYPES) {
      test(`${r.name}: ${r.method} as "${ct}" from another site → 403 CROSS_SITE_WRITE`, async () => {
        const res = await send(r.method, r.path, { ...r.who, ...CROSS_SITE }, r.body, ct);
        expect(res.status).toBe(403);
        expect(res.code).toBe('CROSS_SITE_WRITE');
      });
    }
  }
});

describe('a refused cross-site request changes nothing', () => {
  test('create event with the form-shaped content type: no event is made', async () => {
    const before = await count(tenv.DB, 'SELECT COUNT(*) AS n FROM events');
    const res = await send(
      'POST',
      '/api/v2/admin/events',
      { ...OWNER, ...CROSS_SITE },
      { title: 'Made by another site' },
      'text/plain; x=application/json'
    );
    expect(res.status).toBe(403);
    expect(await count(tenv.DB, 'SELECT COUNT(*) AS n FROM events')).toBe(before);
  });

  test('update event: the title stays as it was', async () => {
    await send(
      'PUT',
      `/api/v2/admin/events/${EVT}`,
      { ...OWNER, ...CROSS_SITE },
      { title: 'Renamed by another site' },
      'text/plain; x=application/json'
    );
    expect(await eventTitle()).toBe('AWG original title');
  });

  test('poster deployment as text/plain: no row is made', async () => {
    const sql = 'SELECT COUNT(*) AS n FROM poster_deployments WHERE event_id = ?';
    const before = await count(tenv.DB, sql, EVT);
    const res = await send(
      'POST',
      `/api/v2/admin/events/${EVT}/poster-deployments`,
      { ...OWNER, ...CROSS_SITE },
      { placement_label: 'Hung by another site' },
      'text/plain'
    );
    expect(res.status).toBe(403);
    expect(await count(tenv.DB, sql, EVT)).toBe(before);
  });

  test('event flag as text/plain: no override is stored', async () => {
    const sql = `SELECT COUNT(*) AS n FROM feature_flags WHERE scope = 'event' AND scope_id = ?`;
    const res = await send(
      'PUT',
      `/api/v2/admin/events/${EVT}/flags/${FLAG}`,
      { ...OWNER, ...CROSS_SITE },
      { enabled: false },
      'text/plain'
    );
    expect(res.status).toBe(403);
    expect(await count(tenv.FORMS_DB, sql, EVT)).toBe(0);
  });

  test('sponsor as the form-shaped content type: no sponsor is made', async () => {
    const sql = 'SELECT COUNT(*) AS n FROM sponsor_business WHERE brand_id = ?';
    const before = await count(tenv.DB, sql, BRAND);
    const res = await send(
      'POST',
      '/api/v2/admin/sponsors',
      { ...OWNER, ...CROSS_SITE },
      { name: 'Sponsor from another site', tier: 'primary' },
      'text/plain; x=application/json'
    );
    expect(res.status).toBe(403);
    expect(await count(tenv.DB, sql, BRAND)).toBe(before);
  });

  test('the refusal is written to the audit log as denied, with the path', async () => {
    const path = `/api/v2/admin/events/${EVT}/poster-deployments`;
    await send('POST', path, { ...OWNER, ...CROSS_SITE }, { placement_label: 'x' }, 'text/plain');
    const row = await tenv.DB.prepare(
      `SELECT actor, outcome, resource_id FROM admin_audit_log
        WHERE action = 'ADMIN_WRITE_REFUSED' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
    )
      .bind(path)
      .first<{ actor: string; outcome: string; resource_id: string }>();
    expect(row).toMatchObject({ actor: OWNER_EMAIL, outcome: 'denied', resource_id: path });
  });

  test('the refusal is never cached and carries a request id', async () => {
    const res = await send('PUT', `/api/v2/admin/events/${EVT}`, { ...OWNER, ...CROSS_SITE }, {});
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
    expect(res.body.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  // One log line per refusal, naming which part of the rule refused it. The path
  // is logged without its query string.
  test.each([
    ['cross-site', 'sec-fetch-site', { ...OWNER, ...CROSS_SITE }, 'application/json'],
    ['cross-site', 'origin', { ...OWNER, Origin: 'https://evil.example' }, 'application/json'],
    ['cross-site', 'no-origin', { ...OWNER }, 'application/json'],
    ['content-type', 'not-json', { ...OWNER, ...SAME_ORIGIN }, 'text/plain'],
    ['content-type', 'undeclared-body', { ...OWNER, ...SAME_ORIGIN }, null],
  ] as const)('logs kind "%s", reason "%s"', async (kind, reason, headers, contentType) => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const path = `/api/v2/admin/events/${EVT}`;
      await send('PUT', `${path}?secret=do-not-log`, headers, { title: 'changed' }, contentType);
      const lines = spy.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('"ADMIN_WRITE_REFUSED"'));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        event: 'ADMIN_WRITE_REFUSED',
        kind,
        reason,
        method: 'PUT',
        path,
      });
      expect(lines[0]).not.toContain('do-not-log');
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── The rule, one branch at a time ──────────────────────────────────────────
// One cheap write the owner is allowed to make: rename their own draft.

const RENAME = `/api/v2/admin/events/${EVT}`;
const rename = (headers: H, title = 'AWG original title'): Promise<Sent> =>
  send('PUT', RENAME, headers, { title });

describe('where the request came from', () => {
  test('signed-in person, Sec-Fetch-Site: same-origin → allowed', async () => {
    expect((await rename({ ...OWNER, 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
  });

  test('the header value is compared without regard to case or padding', async () => {
    expect((await rename({ ...OWNER, 'Sec-Fetch-Site': ' Same-Origin ' })).status).toBe(200);
  });

  test.each(['cross-site', 'same-site', 'none', 'bogus', ''])(
    'signed-in person, Sec-Fetch-Site: "%s" → 403',
    async (site) => {
      const res = await rename({ ...OWNER, 'Sec-Fetch-Site': site, Origin: HOST }, 'changed');
      expect(res.status).toBe(403);
      expect(res.code).toBe('CROSS_SITE_WRITE');
      expect(await eventTitle()).toBe('AWG original title');
    }
  );

  test('older browser (no Sec-Fetch-Site), Origin equals this host → allowed', async () => {
    expect((await rename({ ...OWNER, Origin: HOST })).status).toBe(200);
  });

  test.each([
    'https://evil.example',
    'https://www.ose.test',
    'http://ose.test',
    'https://ose.test:8443',
    'https://ose.test.evil.example',
    'null',
    '',
  ])('older browser, Origin "%s" → 403', async (origin) => {
    const res = await rename({ ...OWNER, Origin: origin }, 'changed');
    expect(res.status).toBe(403);
    expect(res.code).toBe('CROSS_SITE_WRITE');
    expect(await eventTitle()).toBe('AWG original title');
  });

  test('signed-in person with no Sec-Fetch-Site and no Origin → 403 (no evidence, no write)', async () => {
    const res = await rename({ ...OWNER }, 'changed');
    expect(res.status).toBe(403);
    expect(res.code).toBe('CROSS_SITE_WRITE');
    expect(await eventTitle()).toBe('AWG original title');
  });

  test('Sec-Fetch-Site decides when it is present: same-origin wins over a stray Origin', async () => {
    // Only a non-browser client can send this pair. A browser sets both itself.
    const res = await rename({
      ...OWNER,
      'Sec-Fetch-Site': 'same-origin',
      Origin: 'https://evil.example',
    });
    expect(res.status).toBe(200);
  });
});

describe('automation (key actors) keeps working with no browser headers', () => {
  test.each([
    ['Bearer admin key', KEY_BEARER],
    ['X-OCR-Internal', KEY_OCR],
    ['Access service-token JWT + Bearer key (the staging CI shape)', SERVICE_TOKEN_AND_KEY],
  ])('%s, no Origin and no Sec-Fetch-Site → allowed', async (_name, who) => {
    expect((await rename({ ...who })).status).toBe(200);
  });

  test('a key actor is still refused when the browser says the request is cross-site', async () => {
    const res = await rename({ ...KEY_BEARER, ...CROSS_SITE }, 'changed');
    expect(res.status).toBe(403);
    expect(res.code).toBe('CROSS_SITE_WRITE');
    expect(await eventTitle()).toBe('AWG original title');
  });

  test('a key actor with a foreign Origin and no Sec-Fetch-Site is refused too', async () => {
    const res = await rename({ ...KEY_OCR, Origin: 'https://evil.example' }, 'changed');
    expect(res.status).toBe(403);
    expect(res.code).toBe('CROSS_SITE_WRITE');
  });

  test('a key actor inside a browser on this origin is allowed', async () => {
    expect((await rename({ ...KEY_BEARER, ...SAME_ORIGIN })).status).toBe(200);
  });
});

describe('callers nobody can identify', () => {
  test('no credentials and no browser headers → still the 401 from requireAdmin', async () => {
    const res = await rename({});
    expect(res.status).toBe(401);
    expect(res.code).toBe('UNAUTH');
  });

  test('no credentials, same-origin → still 401', async () => {
    expect((await rename({ ...SAME_ORIGIN })).status).toBe(401);
  });

  test('no credentials and a text/plain body → 401, not a content-type answer', async () => {
    const res = await send('PUT', RENAME, {}, { title: 'changed' }, 'text/plain');
    expect(res.status).toBe(401);
    expect(res.code).toBe('UNAUTH');
  });

  test('no credentials, cross-site → 403 (refused before auth is even asked)', async () => {
    const res = await rename({ ...CROSS_SITE });
    expect(res.status).toBe(403);
    expect(res.code).toBe('CROSS_SITE_WRITE');
  });

  test('a service-token JWT alone (no key) and no browser headers → 401, not a write', async () => {
    const res = await rename({ 'Cf-Access-Jwt-Assertion': accessJwt({ common_name: 'ci' }) });
    expect(res.status).toBe(401);
  });
});

describe('what the guard leaves alone', () => {
  test('a cross-site GET of an admin read is not a write: the guard does not answer it', async () => {
    const res = await send('GET', '/api/v2/admin/events', { ...OWNER, ...CROSS_SITE });
    expect(res.status).toBe(200);
  });

  test('HEAD and OPTIONS are not refused as cross-site writes', async () => {
    for (const method of ['HEAD', 'OPTIONS']) {
      const res = await send(method, '/api/v2/admin/events', { ...OWNER, ...CROSS_SITE });
      expect(res.status, method).not.toBe(403);
    }
  });

  test('a public form post from another site is not an admin write', async () => {
    const res = await send(
      'POST',
      `/api/v2/events/${EVT}/forms/checkin`,
      { ...CROSS_SITE },
      {},
      'application/json'
    );
    expect(res.code).not.toBe('CROSS_SITE_WRITE');
  });

  test("the sponsor's own page writes carry a token in the body, not the Access cookie: not guarded", async () => {
    for (const path of ['/api/v2/sponsor/requests', '/api/v2/sponsor/placements/spl_x/respond']) {
      const res = await send('POST', path, { ...CROSS_SITE }, { token: 'not-a-token' });
      expect(res.code, path).not.toBe('CROSS_SITE_WRITE');
      expect(res.status, path).not.toBe(200);
    }
  });
});

// ─── JSON means JSON ─────────────────────────────────────────────────────────

interface JsonWrite extends Listed {
  /** Statuses that mean "the handler accepted the content type and went on". */
  note: string;
}

/** Every JSON admin write the finding names, called from the admin page's own origin. */
const JSON_WRITES: JsonWrite[] = LISTED.map((r) => ({ ...r, note: r.name }));

const REFUSED_TYPES = [
  'text/plain',
  'text/plain; x=application/json',
  'text/plain;application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data; boundary=x',
  'application/jsonp',
  'application/json-seq',
  'application/json, text/plain',
  'application/json; x=y',
  'xapplication/json',
];

const ACCEPTED_TYPES = [
  'application/json',
  'application/json; charset=utf-8',
  'application/json;charset=UTF-8',
  'APPLICATION/JSON',
  ' application/json ',
  'application/json ; charset=utf-8',
  'application/json; charset="utf-8"',
];

describe('a body that is not declared as JSON is refused on every JSON admin write (400)', () => {
  for (const r of JSON_WRITES) {
    for (const ct of FORM_TYPES) {
      test(`${r.name}: "${ct}" from the admin page itself → 400 BAD_CONTENT_TYPE`, async () => {
        const res = await send(r.method, r.path, { ...r.who, ...SAME_ORIGIN }, r.body, ct);
        expect(res.status).toBe(400);
        expect(res.code).toBe('BAD_CONTENT_TYPE');
      });
    }
  }

  test.each(REFUSED_TYPES)('rename as "%s" → 400 BAD_CONTENT_TYPE, title unchanged', async (ct) => {
    const res = await send('PUT', RENAME, { ...OWNER, ...SAME_ORIGIN }, { title: 'changed' }, ct);
    expect(res.status).toBe(400);
    expect(res.code).toBe('BAD_CONTENT_TYPE');
    expect(await eventTitle()).toBe('AWG original title');
  });

  test.each(ACCEPTED_TYPES)('rename as "%s" → accepted', async (ct) => {
    const res = await send(
      'PUT',
      RENAME,
      { ...OWNER, ...SAME_ORIGIN },
      { title: 'AWG original title' },
      ct
    );
    expect(res.status).toBe(200);
  });

  test('a body with no content type at all is refused, for a person and for a key', async () => {
    for (const who of [OWNER, KEY_OCR]) {
      const res = await send(
        'PUT',
        `/api/v2/admin/events/${EVT}/flags/${FLAG}`,
        { ...who, ...SAME_ORIGIN },
        { enabled: false },
        null
      );
      expect(res.status).toBe(400);
      expect(res.code).toBe('BAD_CONTENT_TYPE');
    }
  });

  test('automation sending a text body is refused the same way (the Bruno contract)', async () => {
    const res = await send(
      'POST',
      '/api/v2/admin/sponsor-requests/spl_awg_none/respond',
      { ...KEY_BEARER },
      '{"approve":true,"a":"="}',
      'text/plain'
    );
    expect(res.status).toBe(400);
    expect(res.code).toBe('BAD_CONTENT_TYPE');
  });

  test('a write with no body needs no content type (DELETE, and POST with nothing to say)', async () => {
    const del = await send('DELETE', `/api/v2/admin/events/${EVT}/flags/${FLAG}`, {
      ...OWNER,
      ...SAME_ORIGIN,
    });
    expect(del.code).not.toBe('BAD_CONTENT_TYPE');
    expect(del.status).toBeLessThan(500);
    const mint = await send('POST', '/api/v2/admin/sponsors/sb_awg_none/home-link', {
      ...KEY_BEARER,
    });
    expect(mint.status).toBe(404);
  });

  test('a write with a JSON content type and no body is fine (how the admin page calls verify-qr)', async () => {
    const res = await send(
      'POST',
      '/api/v2/admin/events/evt_awg_none/verify-qr',
      { ...KEY_BEARER, ...SAME_ORIGIN },
      undefined,
      'application/json'
    );
    expect(res.status).toBe(404);
  });

  test('the upload route takes multipart, and only that route does', async () => {
    const boundary = '----awg';
    const multipart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const up = await send(
      'POST',
      `/api/v2/admin/events/${EVT}/uploads`,
      { ...OWNER, ...SAME_ORIGIN },
      multipart,
      `multipart/form-data; boundary=${boundary}`
    );
    // The upload handler answers (a .txt is not an allowed file); the guard did not.
    expect(up.body.error).not.toBe('Content-Type must be application/json');

    const notUpload = await send(
      'POST',
      `/api/v2/admin/events/${EVT}/poster-deployments`,
      { ...OWNER, ...SAME_ORIGIN },
      multipart,
      `multipart/form-data; boundary=${boundary}`
    );
    expect(notUpload.status).toBe(400);
    expect(notUpload.code).toBe('BAD_CONTENT_TYPE');
  });

  test('a cross-site multipart upload is refused like any other cross-site write', async () => {
    const res = await send(
      'POST',
      `/api/v2/admin/events/${EVT}/uploads`,
      { ...OWNER, ...CROSS_SITE },
      '--x\r\n\r\n--x--\r\n',
      'multipart/form-data; boundary=x'
    );
    expect(res.status).toBe(403);
    expect(res.code).toBe('CROSS_SITE_WRITE');
  });
});

describe('the loose match is gone from the handlers that had it', () => {
  // With no identity the guard stands aside, so these reach the handlers' own check.
  test.each([
    ['sponsor accepts or declines a placement', '/api/v2/sponsor/placements/spl_x/respond'],
    ['sponsor asks to back an event', '/api/v2/sponsor/requests'],
  ])('%s: "text/plain; x=application/json" → 400 BAD_CONTENT_TYPE', async (_n, path) => {
    const res = await send('POST', path, {}, { token: 'x' }, 'text/plain; x=application/json');
    expect(res.status).toBe(400);
    expect(res.code).toBe('BAD_CONTENT_TYPE');
  });

  test('sponsor impression beacon (sponsors.ts, public): the form-shaped type → 400', async () => {
    const res = await send(
      'POST',
      `/api/v2/events/${EVT}/sponsors/sb_awg_none/impression`,
      {},
      { surface: 'display', placement: 'tvTop' },
      'text/plain; x=application/json'
    );
    expect(res.status).toBe(400);
    expect(res.code).toBe('BAD_CONTENT_TYPE');
  });

  // The admin handlers' own checks sit behind the guard. The local-dev open-admin
  // switch lets a caller with no identity through requireAdmin, which is the one
  // way to reach them without the guard's content-type rule answering first.
  describe('admin handlers reached with no identity (local dev open admin)', () => {
    const open = routerEnv as unknown as { DEV_OPEN_ADMIN?: string };
    async function openAdmin<T>(fn: () => Promise<T>): Promise<T> {
      const before = open.DEV_OPEN_ADMIN;
      open.DEV_OPEN_ADMIN = 'true';
      try {
        return await fn();
      } finally {
        open.DEV_OPEN_ADMIN = before;
      }
    }

    test.each([
      ['events.ts create', 'POST', '/api/v2/admin/events', { title: 'x' }],
      ['events.ts update', 'PUT', `/api/v2/admin/events/${EVT}`, { title: 'changed' }],
      ['sponsors.ts create', 'POST', '/api/v2/admin/sponsors', { name: 'x', tier: 'primary' }],
      [
        'sponsor-home.ts organizer answer',
        'POST',
        '/api/v2/admin/sponsor-requests/spl_awg_none/respond',
        { approve: true },
      ],
    ])('%s: "text/plain; x=application/json" → 400 from the handler', async (_n, m, p, b) => {
      const res = await openAdmin(() => send(m, p, {}, b, 'text/plain; x=application/json'));
      expect(res.status).toBe(400);
      expect(res.code).toBe('BAD_CONTENT_TYPE');
      expect(await eventTitle()).toBe('AWG original title');
    });

    test('local open admin is refused from another site too', async () => {
      const res = await openAdmin(() =>
        send('PUT', RENAME, { ...CROSS_SITE }, { title: 'changed' })
      );
      expect(res.status).toBe(403);
      expect(res.code).toBe('CROSS_SITE_WRITE');
      expect(await eventTitle()).toBe('AWG original title');
    });
  });

  test('sponsor routes still take real JSON (and then refuse the bad token)', async () => {
    const res = await send(
      'POST',
      '/api/v2/sponsor/requests',
      {},
      { token: 'x', event_id: EVT },
      'application/json; charset=utf-8'
    );
    expect(res.code).not.toBe('BAD_CONTENT_TYPE');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ─── The admin page itself ───────────────────────────────────────────────────
// What the browser sends when admin.html, or the draft preview's Publish script,
// calls these routes: a same-origin fetch.

describe('the admin page and the draft preview keep working (same-origin fetches)', () => {
  const page: H = { ...OWNER, ...SAME_ORIGIN };

  test('create an event, then rename it, as the admin page does', async () => {
    const made = await send('POST', '/api/v2/admin/events', page, { title: 'AWG from the page' });
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    expect(
      (await send('PUT', `/api/v2/admin/events/${id}`, page, { title: 'AWG renamed' })).status
    ).toBe(200);
  });

  test('preview Publish script shape: PUT with JSON content type and a status body', async () => {
    const res = await send('PUT', RENAME, { ...page, ...JSON_CT }, { status: 'draft' });
    expect(res.code).not.toBe('CROSS_SITE_WRITE');
    expect(res.code).not.toBe('BAD_CONTENT_TYPE');
  });

  test('a bare fetch(url, { method }) with no headers of its own is allowed', async () => {
    const res = await send('DELETE', '/api/v2/admin/sponsors/sb_awg_none', page);
    expect(res.status).toBe(404);
  });

  test('add a poster deployment and set an event flag', async () => {
    const pd = await send('POST', `/api/v2/admin/events/${EVT}/poster-deployments`, page, {
      placement_label: 'AWG front door',
    });
    expect(pd.status).toBe(201);
    const flag = await send('PUT', `/api/v2/admin/events/${EVT}/flags/${FLAG}`, page, {
      enabled: true,
    });
    expect(flag.status).toBe(200);
  });
});
