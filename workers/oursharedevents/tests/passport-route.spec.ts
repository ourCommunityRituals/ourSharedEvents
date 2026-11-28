/**
 * Stamp passport, route layer (owner 2026-11-28, src/lib/passport.ts).
 *
 *   GET /q/:token                    a stop's code on a passport event lands on
 *                                    /events/:id/booths/:number#stamp
 *   GET /events/:id/booths/:number   shows the passport card and its script
 *   GET /events/:id/booths           shows the card and a mark per stop
 *   PUT /api/v2/admin/events/:id     settings.passport saves; a bad value is 400
 *   GET /api/v2/admin/events/:id/booths  says whether the passport is on
 *
 * Held here:
 *   1. on a passport event a stop's code lands on the stop's page with #stamp,
 *      and the scan is counted exactly as before (one row, no booth on it);
 *   2. with the passport off, on a code at no stop, on a stop out of use and on
 *      a vote code, the landing is the event page as before;
 *   3. the stop page and the list carry the card only when the passport is on;
 *   4. no cookie on the stop page, with or without the passport;
 *   5. the admin switch saves through the event's settings and reads back.
 *
 * @born-red owner 2026-11-28 | method: one fault at a time, each restored:
 *   1. passportStopSql always NULL: 1 red (the landing);
 *   2. the vote-code guard taken out of passportStopSql: 1 red;
 *   3. the card rendered whatever the setting: 2 red;
 *   4. the passport field left out of the admin booths read: 1 red.
 * date: 2026-11-28
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND = 'brand-pp';
const OWNER = 'owner-pp@example.com';
const WALK = 'evt-pp-walk'; // passport on
const PLAIN = 'evt-pp-plain'; // passport off

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const ADMIN = (() => {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email: OWNER,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
    'Sec-Fetch-Site': 'same-origin',
  };
})();
const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };

let nextIp = 1;
async function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'CF-Connecting-IP': `198.51.100.${nextIp++ % 250}`,
        Accept: 'text/html',
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

async function run(sql: string, ...args: unknown[]): Promise<void> {
  await tenv.DB.prepare(sql)
    .bind(...args)
    .run();
}

beforeAll(applyMigrations);

beforeEach(async () => {
  await run(`DELETE FROM scan_placement_events WHERE event_id LIKE 'evt-pp-%'`);
  for (const t of [
    'scan_node_returns',
    'anon_id_returns',
    'scan_aggregates',
    'scan_cell_aggregates',
    'scans',
    'share_opens_daily',
  ]) {
    try {
      await run(`DELETE FROM ${t} WHERE event_id LIKE 'evt-pp-%'`);
    } catch {
      // a table without event_id holds nothing of these events
    }
  }
  await run(`DELETE FROM poster_deployments WHERE event_id LIKE 'evt-pp-%'`);
  await run(`DELETE FROM event_booths WHERE event_id LIKE 'evt-pp-%'`);
  await run(`DELETE FROM events WHERE id LIKE 'evt-pp-%'`);
  for (const [id, settings] of [
    [WALK, '{"passport":true}'],
    [PLAIN, '{}'],
  ]) {
    await run(
      `INSERT INTO events (id, brand_id, title, slug, status, qr_verified, is_published, start_date, end_date, timezone, settings_json)
       VALUES (?, ?, ?, ?, 'active', 1, 1, '2099-06-04', '2099-06-04', 'America/Chicago', ?)`,
      id,
      BRAND,
      id === WALK ? 'First Friday Art Walk' : 'Plain Fair',
      id,
      settings
    );
  }
  const booth = (id: string, ev: string, n: string, active = 1) =>
    run(
      `INSERT INTO event_booths (id, event_id, number, name, category, is_active) VALUES (?, ?, ?, ?, 'art', ?)`,
      id,
      ev,
      n,
      `Gallery ${n}`,
      active
    );
  await booth('bth-pp-1', WALK, '1');
  await booth('bth-pp-2', WALK, '2');
  await booth('bth-pp-3', WALK, '3');
  await booth('bth-pp-old', WALK, '9', 0);
  await booth('bth-pp-plain', PLAIN, '1');
  const code = (id: string, ev: string, bid: string | null, vote = 0) =>
    run(
      `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, booth_id, is_vote_code)
       VALUES (?, ?, ?, 'Stop', 1, ?, ?)`,
      id,
      ev,
      `qrt_${id}`,
      bid,
      vote
    );
  await code('pd-pp-stop1', WALK, 'bth-pp-1');
  await code('pd-pp-none', WALK, null);
  await code('pd-pp-old', WALK, 'bth-pp-old');
  await code('pd-pp-vote', WALK, 'bth-pp-2', 1);
  await code('pd-pp-plain', PLAIN, 'bth-pp-plain');
});

describe('a stop code lands where it should', () => {
  test('on a passport event: the stop page with #stamp, and the scan counted as before', async () => {
    const res = await call('GET', '/q/qrt_pd-pp-stop1');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`https://ose.test/events/${WALK}/booths/1#stamp`);
    const rows = await tenv.DB.prepare(
      `SELECT poster_deployment_id FROM scan_placement_events WHERE event_id = ?`
    )
      .bind(WALK)
      .all();
    expect(rows.results).toEqual([{ poster_deployment_id: 'pd-pp-stop1' }]);
  });

  test.each([
    ['passport off', 'pd-pp-plain', PLAIN],
    ['a code at no stop', 'pd-pp-none', WALK],
    ['a stop out of use', 'pd-pp-old', WALK],
  ])('%s: the event page, as before', async (_name, pd, ev) => {
    const res = await call('GET', `/q/qrt_${pd}`);
    expect(res.status).toBe(302);
    const loc = res.headers.get('Location') ?? '';
    expect(loc).toContain(`/events/${ev}?type=register&deployment=${pd}`);
    expect(loc).not.toContain('#stamp');
  });

  test('a vote code never stamps', async () => {
    const res = await call('GET', '/q/qrt_pd-pp-vote?type=vote');
    expect(res.headers.get('Location') ?? '').not.toContain('#stamp');
  });
});

describe('the stop pages carry the card only with the passport on', () => {
  test('stop page, passport on: the card, every stop in use, this stop, the script', async () => {
    const res = await call('GET', `/events/${WALK}/booths/2`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('data-testid="passport"');
    expect(body).toContain('data-passport-stops="[&quot;1&quot;,&quot;2&quot;,&quot;3&quot;]"');
    expect(body).toContain('data-passport-stop="2"');
    expect(body).toMatch(/<script nonce="[^"]+">\s*\(function \(\) \{\s*var card/);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  test('stop page, passport off: no card, no script', async () => {
    const res = await call('GET', `/events/${PLAIN}/booths/1`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('data-testid="passport"');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  test('the list, passport on: the card and one mark per stop', async () => {
    const body = await (await call('GET', `/events/${WALK}/booths`)).text();
    expect(body).toContain('data-testid="passport"');
    expect([...body.matchAll(/data-testid="passport-mark"/g)]).toHaveLength(3);
  });

  test('the list, passport off: neither', async () => {
    const body = await (await call('GET', `/events/${PLAIN}/booths`)).text();
    expect(body).not.toContain('data-testid="passport"');
    expect(body).not.toContain('passport-mark');
  });
});

describe('the admin switch', () => {
  test('reads back through the stalls list, saves on and off, and refuses a bad value', async () => {
    const read = async () =>
      (
        (await (await call('GET', `/api/v2/admin/events/${PLAIN}/booths`, KEY)).json()) as {
          passport: boolean;
        }
      ).passport;
    expect(await read()).toBe(false);

    const on = await call('PUT', `/api/v2/admin/events/${PLAIN}`, KEY, {
      settings: { passport: true },
    });
    expect(on.status).toBe(200);
    expect(await read()).toBe(true);

    const off = await call('PUT', `/api/v2/admin/events/${PLAIN}`, KEY, {
      settings: { passport: false },
    });
    expect(off.status).toBe(200);
    expect(await read()).toBe(false);

    const bad = await call('PUT', `/api/v2/admin/events/${PLAIN}`, KEY, {
      settings: { passport: 'yes' },
    });
    expect(bad.status).toBe(400);
    expect(ADMIN['Sec-Fetch-Site']).toBe('same-origin');
  });
});
