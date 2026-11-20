/**
 * The vote route: POST /api/v2/vote/:eventId (OSE-2128, S4a of OSE-1193;
 * OSE ADR-040 decisions 1 to 6). Workers pool, real D1 (migrations 0111 to
 * 0114), the real router.
 *
 * Each case names, in brackets, the fault it was seen failing on first.
 *
 * @born-red OSE-2128 | method: injected-fault, each removed after: the counter
 *   UPDATE without `changes() = 1` (duplicate and order cases red), the side
 *   added to the receipt key (whichever-side case red), `o.closes_at > ?`
 *   dropped from OPEN_NOW (lapsed case red), openVotePass skipped (no-pass and
 *   tampered cases red), the same-origin check removed (cross-site case red),
 *   the answer echoing up_count (identical-bytes case red), receipts deleted at
 *   reopen (reopen case red), voidOnEpochChange not called (epoch case red) |
 *   date: 2026-11-19
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { mintVotePass, voterKey } from '../src/lib/vote-pass';
import { voteReceipt } from '../src/lib/votes';
import { VOTING_ON } from '../src/lib/voting-switch';
import { emitOperationCost, createCostAccumulator } from '../src/lib/cost-metric';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;
const PEPPER = tenv.ANON_ID_HASH_PEPPER;
const routerEnv = { ...(env as unknown as RouterEnv), VOTING_ENABLED: VOTING_ON } as RouterEnv;

const ORIGIN = 'https://ose.test';
const BRAND = 'brand-vrt-a';
const BRAND_B = 'brand-vrt-b';
const OWNER = 'owner-vrt-a@example.com';
const N1 = 'evt-vrt-n1';
const N2 = 'evt-vrt-n2'; // another night of the same brand
const NB = 'evt-vrt-nb'; // another brand's night
const TEAM_1 = 'grp_00000011';

const COOKIE_1 = 'anon_11111111-aaaa-bbbb-cccc-000000000001';
const COOKIE_2 = 'anon_11111111-aaaa-bbbb-cccc-000000000002';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const nowS = Math.floor(Date.now() / 1000);
const ADMIN = {
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email: OWNER,
    iat: nowS - 10,
    exp: nowS + 3600,
  })}.sig`,
  'Sec-Fetch-Site': 'same-origin',
};

type Json = Record<string, any>;
async function routed(req: Request, over: Partial<RouterEnv> = {}) {
  const ctx = createExecutionContext();
  const res = await route(req, { ...routerEnv, ...over } as RouterEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function admin(method: string, path: string, body?: unknown) {
  const res = await routed(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: body === undefined ? ADMIN : { ...ADMIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const vp = (eventId: string, tail = '') => `/api/v2/admin/events/${eventId}/votables${tail}`;

/** POST a vote, as the voter page would. */
async function vote(
  eventId: string,
  body: unknown,
  opts: { headers?: Record<string, string>; method?: string; raw?: string } = {},
  over: Partial<RouterEnv> = {}
) {
  const res = await routed(
    new Request(`${ORIGIN}/api/v2/vote/${eventId}`, {
      method: opts.method ?? 'POST',
      headers: opts.headers ?? {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-origin',
      },
      body:
        (opts.method ?? 'POST') === 'GET' || (opts.method ?? 'POST') === 'HEAD'
          ? undefined
          : (opts.raw ?? JSON.stringify(body)),
    }),
    over
  );
  const text = await res.text();
  return { status: res.status, text, headers: res.headers, json: safeJson(text) };
}
const safeJson = (t: string): Json => {
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
};

const pass = (eventId: string, cookie = COOKIE_1, at = Date.now()) =>
  mintVotePass(PEPPER, cookie, eventId, at) as Promise<string>;

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();
const one = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .first<Json>();
const tallyOf = async (objectId: string) =>
  (await one(`SELECT up_count, down_count FROM vote_tallies WHERE object_id = ?`, objectId)) as {
    up_count: number;
    down_count: number;
  };
const countRows = async (table: string, col: string, value: string) =>
  Number((await one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, value))?.n ?? 0);

async function seedEvent(id: string, brand: string) {
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, 'active', 'Eagles Hall', '2099-06-01', '2099-06-01', 'America/Chicago')`,
    id,
    brand,
    `Vote route fixture ${id}`,
    id
  );
}

/** A set with songs, the set open and every song open. Returns the song ids. */
async function openNight(
  eventId: string,
  labels: string[] = ['One', 'Two'],
  playedBy: 'object' | 'team' = 'object'
): Promise<string[]> {
  expect((await admin('POST', vp(eventId), { played_by: playedBy })).status).toBe(201);
  const ids: string[] = [];
  for (const label of labels) {
    const res = await admin('POST', vp(eventId, '/objects'), {
      kind: 'song',
      label,
      ...(playedBy === 'team' ? { group_id: TEAM_1 } : {}),
    });
    ids.push(res.json.object.id);
  }
  expect((await admin('POST', vp(eventId, '/open'))).status).toBe(200);
  for (const id of ids)
    expect((await admin('POST', vp(eventId, `/objects/${id}/open`), {})).status).toBe(200);
  return ids;
}

beforeAll(async () => {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
  await run(
    `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
    OWNER,
    BRAND
  );
});

beforeEach(async () => {
  const like = 'evt-vrt-%';
  for (const sql of [
    `DELETE FROM vote_receipts WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    `DELETE FROM vote_tallies WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    `DELETE FROM vote_participants WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id LIKE ?)`,
    `DELETE FROM vote_team_markers WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id LIKE ?)`,
    `DELETE FROM votable_objects WHERE event_id LIKE ?`,
    `DELETE FROM vote_sets WHERE event_id LIKE ?`,
    `DELETE FROM admin_audit_log WHERE resource_id LIKE ?`,
    `DELETE FROM events WHERE id LIKE ?`,
  ])
    await run(sql, like);
  await seedEvent(N1, BRAND);
  await seedEvent(N2, BRAND);
  await seedEvent(NB, BRAND_B);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a vote counts once per voter per object', () => {
  test('an open object counts one up vote (the positive control) [skip the increment]', async () => {
    const [a] = await openNight(N1);
    const res = await vote(N1, { object_id: a, side: 'up', pass: await pass(N1) });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(await tallyOf(a)).toEqual({ up_count: 1, down_count: 0 });
  });

  test('"not for me" raises the down counter only', async () => {
    const [a] = await openNight(N1);
    await vote(N1, { object_id: a, side: 'down', pass: await pass(N1) });
    expect(await tallyOf(a)).toEqual({ up_count: 0, down_count: 1 });
  });

  test('the same pass twice on one object counts once, whichever side [side in the receipt key]', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    await vote(N1, { object_id: a, side: 'up', pass: p });
    await vote(N1, { object_id: a, side: 'down', pass: p });
    await vote(N1, { object_id: a, side: 'up', pass: p });
    expect(await tallyOf(a)).toEqual({ up_count: 1, down_count: 0 });
    expect(await countRows('vote_receipts', 'object_id', a)).toBe(1);
  });

  test('a re-scan gives the same voter key, so a second vote on one object counts once [event left out of k]', async () => {
    const [a] = await openNight(N1);
    const first = await pass(N1, COOKIE_1, Date.now() - 60_000);
    const second = await pass(N1, COOKIE_1, Date.now());
    expect(first).not.toBe(second);
    await vote(N1, { object_id: a, side: 'up', pass: first });
    await vote(N1, { object_id: a, side: 'up', pass: second });
    expect((await tallyOf(a)).up_count).toBe(1);
    // A different browser counts.
    await vote(N1, { object_id: a, side: 'up', pass: await pass(N1, COOKIE_2) });
    expect((await tallyOf(a)).up_count).toBe(2);
  });

  test('one voter votes once on each of two objects', async () => {
    const [a, b] = await openNight(N1);
    const p = await pass(N1);
    await vote(N1, { object_id: a, side: 'up', pass: p });
    await vote(N1, { object_id: b, side: 'up', pass: p });
    expect((await tallyOf(a)).up_count).toBe(1);
    expect((await tallyOf(b)).up_count).toBe(1);
    const setId = (await one(`SELECT id FROM vote_sets WHERE event_id = ?`, N1))?.id as string;
    expect(await countRows('vote_participants', 'set_id', setId)).toBe(1);
  });

  test('after a reopen, a person who voted still cannot vote again on that object [receipts cleared at reopen]', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    await vote(N1, { object_id: a, side: 'up', pass: p });
    await admin('POST', vp(N1, `/objects/${a}/close`), {});
    await admin('POST', vp(N1, '/close'));
    await admin('POST', vp(N1, '/reopen'));
    await admin('POST', vp(N1, `/objects/${a}/reopen`), {});
    const again = await vote(N1, { object_id: a, side: 'up', pass: p });
    expect(again.status).toBe(200);
    expect((await tallyOf(a)).up_count).toBe(1);
  });

  test('the counter rises only when the receipt is new [wrong batch order]', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    const k = (await voterKey(PEPPER, COOKIE_1, N1)) as string;
    // A receipt already there (an earlier vote) and a counter at 0.
    await run(
      `INSERT INTO vote_receipts (object_id, receipt) VALUES (?, ?)`,
      a,
      (await voteReceipt(PEPPER, k, a)) as string
    );
    await vote(N1, { object_id: a, side: 'up', pass: p });
    expect(await tallyOf(a)).toEqual({ up_count: 0, down_count: 0 });
  });

  test('on a team night an up vote adds one team marker; a second song of the team adds none', async () => {
    const [a, b] = await openNight(N1, ['One', 'Two'], 'team');
    const p = await pass(N1);
    await vote(N1, { object_id: a, side: 'up', pass: p });
    await vote(N1, { object_id: b, side: 'up', pass: p });
    const setId = (await one(`SELECT id FROM vote_sets WHERE event_id = ?`, N1))?.id as string;
    expect(await countRows('vote_team_markers', 'set_id', setId)).toBe(1);
  });

  test('on a team night a "not for me" vote, and a repeat after it, add no team marker', async () => {
    const [a] = await openNight(N1, ['One'], 'team');
    const p = await pass(N1);
    await vote(N1, { object_id: a, side: 'down', pass: p });
    await vote(N1, { object_id: a, side: 'up', pass: p });
    const setId = (await one(`SELECT id FROM vote_sets WHERE event_id = ?`, N1))?.id as string;
    expect(await countRows('vote_team_markers', 'set_id', setId)).toBe(0);
  });
});

describe('the answer says nothing', () => {
  test('answer bytes identical for counted and duplicate [up_count echoed]', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    const counted = await vote(N1, { object_id: a, side: 'up', pass: p });
    const dup = await vote(N1, { object_id: a, side: 'down', pass: p });
    expect(counted.status).toBe(dup.status);
    expect(counted.text).toBe(dup.text);
    expect(counted.text).toBe('{"ok":true}');
  });

  test('no answer sets a cookie; every answer is no-store and sends no referrer', async () => {
    const [a] = await openNight(N1);
    const answers = [
      await vote(N1, { object_id: a, side: 'up', pass: await pass(N1) }),
      await vote(N1, { object_id: a, side: 'up' }),
      await vote(N1, { object_id: 'vob_nope', side: 'up', pass: await pass(N1) }),
    ];
    for (const r of answers) {
      expect(r.headers.get('Set-Cookie')).toBeNull();
      expect(r.headers.get('Cache-Control')).toBe('no-store');
      expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    }
  });

  test('OPERATION_COST rows read and written are null for a vote', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: unknown) => void lines.push(String(l)));
    const acc = createCostAccumulator();
    acc.d1RowsWritten = 4;
    acc.d1RowsRead = 9;
    acc.d1Queries = 6;
    emitOperationCost({ op: 'POST /api/v2/vote/:x', wallMs: 3, acc, status: 200 });
    emitOperationCost({ op: 'GET /api/v2/vote/:x/objects', wallMs: 3, acc, status: 200 });
    const [voteLine, readLine] = lines.map((l) => JSON.parse(l));
    expect(voteLine).toMatchObject({ d1RowsRead: null, d1RowsWritten: null, d1Queries: 6 });
    expect(readLine).toMatchObject({ d1RowsRead: 9, d1RowsWritten: 4 });
  });

  test('no log line carries the object, the side, the event, the pass, k or a receipt', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation(
        (...a: unknown[]) => void lines.push(a.map(String).join(' '))
      );
    const [a] = await openNight(N1);
    const p = await pass(N1);
    const k = (await voterKey(PEPPER, COOKIE_1, N1)) as string;
    const receipt = (await voteReceipt(PEPPER, k, a)) as string;
    await vote(N1, { object_id: a, side: 'up', pass: p });
    await vote(N1, { object_id: a, side: 'down', pass: p });
    await vote(N1, { object_id: a, side: 'up', pass: p + 'x' });
    await vote(N1, { object_id: a, side: 'up', pass: p }, {}, {
      DB: undefined,
    } as Partial<RouterEnv>);
    const text = lines.join('\n');
    for (const secret of [a, N1, p, k, receipt, '"side"']) expect(text).not.toContain(secret);
  });
});

describe('a vote without a good pass is refused, and writes nothing', () => {
  async function nothingWritten(objectId: string) {
    expect(await tallyOf(objectId)).toEqual({ up_count: 0, down_count: 0 });
    expect(await countRows('vote_receipts', 'object_id', objectId)).toBe(0);
  }

  test('no pass: refused, nothing written, no Set-Cookie [pass check skipped]', async () => {
    const [a] = await openNight(N1);
    const res = await vote(N1, { object_id: a, side: 'up' });
    expect(res.status).toBe(400);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    await nothingWritten(a);
  });

  test('tampered pass, or k altered: refused [MAC check dropped]', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    const [prefix, body, mac] = [
      p.slice(0, 4),
      p.slice(4, p.lastIndexOf('.')),
      p.slice(p.lastIndexOf('.') + 1),
    ];
    const wire = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    wire.k = 'f'.repeat(64);
    const forged = `${prefix}${btoa(JSON.stringify(wire)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${mac}`;
    for (const bad of [forged, p.slice(0, -2) + 'AA', 'vp1.x.y']) {
      const res = await vote(N1, { object_id: a, side: 'up', pass: bad });
      expect(res.status).toBe(403);
      expect(res.json.code).toBe('VOTE_PASS_INVALID');
    }
    await nothingWritten(a);
  });

  test('a pass for another event: refused', async () => {
    const [a] = await openNight(N1);
    await openNight(N2);
    const res = await vote(N1, { object_id: a, side: 'up', pass: await pass(N2) });
    expect(res.status).toBe(403);
    await nothingWritten(a);
  });

  test('an expired pass: refused (a controlled clock)', async () => {
    const [a] = await openNight(N1);
    const old = await pass(N1, COOKIE_1, Date.now() - 31 * 60_000);
    const res = await vote(N1, { object_id: a, side: 'up', pass: old });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('Scan the code on the screen again.');
    await nothingWritten(a);
  });

  test('a pass minted before a pepper rotation is refused after it [old pass gets a receipt under the new key]', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    const res = await vote(N1, { object_id: a, side: 'up', pass: p }, {}, {
      ANON_ID_HASH_PEPPER: `${PEPPER}-rotated`,
    } as Partial<RouterEnv>);
    expect(res.status).toBe(403);
    await nothingWritten(a);
  });

  test('pass, set and current epochs must all match; on a mismatch the vote is refused and the set is void [only pass and set compared]', async () => {
    const [a] = await openNight(N1);
    const rotated = `${PEPPER}-rotated`;
    // A pass minted after the rotation: its epoch is the new one, the set's the old.
    const fresh = (await mintVotePass(rotated, COOKIE_1, N1, Date.now())) as string;
    const res = await vote(N1, { object_id: a, side: 'up', pass: fresh }, {}, {
      ANON_ID_HASH_PEPPER: rotated,
    } as Partial<RouterEnv>);
    expect(res.status).toBe(409);
    await nothingWritten(a);
    expect(await one(`SELECT is_void, void_reason FROM vote_sets WHERE event_id = ?`, N1)).toEqual({
      is_void: 1,
      void_reason: 'pepper_epoch',
    });
    // And the void set takes no vote from a pass of the old epoch either.
    const after = await vote(N1, { object_id: a, side: 'up', pass: await pass(N1) });
    expect(after.status).toBe(409);
    await nothingWritten(a);
  });

  test('pepper missing: refused, nothing written [unkeyed fallback]', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    const res = await vote(N1, { object_id: a, side: 'up', pass: p }, {}, {
      ANON_ID_HASH_PEPPER: undefined,
    } as Partial<RouterEnv>);
    expect(res.status).toBe(503);
    await nothingWritten(a);
  });
});

describe('a vote only lands on an open object of this event', () => {
  test('object of another event: refused', async () => {
    await openNight(N1);
    const [other] = await openNight(N2);
    const res = await vote(N1, { object_id: other, side: 'up', pass: await pass(N1) });
    expect(res.status).toBe(409);
    expect(await tallyOf(other)).toEqual({ up_count: 0, down_count: 0 });
  });

  test("another brand's object, with a pass for its own event, is refused at this event", async () => {
    await openNight(N1);
    await run(
      `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
      OWNER,
      BRAND_B
    );
    const [theirs] = await openNight(NB);
    const res = await vote(N1, { object_id: theirs, side: 'up', pass: await pass(NB) });
    expect(res.status).toBe(403);
    expect(await tallyOf(theirs)).toEqual({ up_count: 0, down_count: 0 });
  });

  test('closed, past closes_at, or final: refused [check outside the batch]', async () => {
    const [a, b, c] = await openNight(N1, ['One', 'Two', 'Three']);
    await admin('POST', vp(N1, `/objects/${a}/close`), {});
    await run(
      `UPDATE votable_objects SET closes_at = ? WHERE id = ?`,
      new Date(Date.now() - 1000).toISOString(),
      b
    );
    const p = await pass(N1);
    expect((await vote(N1, { object_id: a, side: 'up', pass: p })).status).toBe(409);
    expect((await vote(N1, { object_id: b, side: 'up', pass: p })).status).toBe(409);
    await admin('POST', vp(N1, '/close'));
    expect((await vote(N1, { object_id: c, side: 'up', pass: p })).status).toBe(409);
    await admin('POST', vp(N1, '/finalize'));
    expect((await vote(N1, { object_id: c, side: 'up', pass: p })).status).toBe(409);
    for (const id of [a, b, c])
      expect(await one(`SELECT up_count FROM vote_tallies WHERE object_id = ?`, id)).toEqual({
        up_count: 0,
      });
  });

  test('an event that is not live takes no vote', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    await run(`UPDATE events SET status = 'draft' WHERE id = ?`, N1);
    expect((await vote(N1, { object_id: a, side: 'up', pass: p })).status).toBe(409);
    expect((await tallyOf(a)).up_count).toBe(0);
  });
});

describe('the request shape', () => {
  test('a form-encoded or cross-site POST: refused [JSON or same-origin check removed]', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    const body = JSON.stringify({ object_id: a, side: 'up', pass: p });
    const form = await vote(N1, null, {
      raw: `object_id=${a}&side=up&pass=${p}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    const cross = await vote(N1, null, {
      raw: body,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
    });
    const foreignOrigin = await vote(N1, null, {
      raw: body,
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    });
    const neither = await vote(N1, null, {
      raw: body,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(form.status).toBe(415);
    expect(cross.status).toBe(403);
    expect(foreignOrigin.status).toBe(403);
    expect(neither.status).toBe(403);
    expect((await tallyOf(a)).up_count).toBe(0);
    // An older phone that sends Origin but no Sec-Fetch-Site still votes.
    const older = await vote(N1, null, {
      raw: body,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    });
    expect(older.status).toBe(200);
    expect((await tallyOf(a)).up_count).toBe(1);
  });

  test('GET and HEAD never vote', async () => {
    const [a] = await openNight(N1);
    expect((await vote(N1, null, { method: 'GET' })).status).toBe(404);
    expect((await vote(N1, null, { method: 'HEAD' })).status).toBe(404);
    expect((await tallyOf(a)).up_count).toBe(0);
  });

  test('a side other than up or down, or a body too big: refused', async () => {
    const [a] = await openNight(N1);
    const p = await pass(N1);
    expect((await vote(N1, { object_id: a, side: 'sideways', pass: p })).status).toBe(400);
    expect(
      (await vote(N1, { object_id: a, side: 'up', pass: p, pad: 'x'.repeat(4096) })).status
    ).toBe(400);
    expect((await tallyOf(a)).up_count).toBe(0);
  });

  test('with VOTING_ENABLED off the route does not exist', async () => {
    const [a] = await openNight(N1);
    const res = await vote(N1, { object_id: a, side: 'up', pass: await pass(N1) }, {}, {
      VOTING_ENABLED: 'off',
    } as Partial<RouterEnv>);
    expect(res.status).toBe(404);
    expect((await tallyOf(a)).up_count).toBe(0);
  });
});

describe('the night: votes, close, result', () => {
  test('twelve voters through the route give the night a winner at final', async () => {
    const [a, b] = await openNight(N1);
    await run(`UPDATE vote_sets SET secret_margin = 5, secret_floor = 10 WHERE event_id = ?`, N1);
    for (let i = 0; i < 12; i++) {
      const p = await pass(N1, `anon_22222222-aaaa-bbbb-cccc-${String(i).padStart(12, '0')}`);
      await vote(N1, { object_id: i < 9 ? a : b, side: 'up', pass: p });
    }
    await admin('POST', vp(N1, '/close'));
    const fin = await admin('POST', vp(N1, '/finalize'));
    expect(fin.json.set.result).toEqual({
      outcome: 'winner',
      winner_object: { id: a, label: 'One' },
      winner_team_id: null,
    });
    expect(await countRows('vote_receipts', 'object_id', a)).toBe(0);
  });
});
