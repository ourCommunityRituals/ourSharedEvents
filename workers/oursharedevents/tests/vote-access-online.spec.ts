/**
 * The Access Pass and the Online Pick (OSE ADR-040 decision 13), and the vote
 * route's limit (decision 5). Workers pool, real D1 (migrations to 0123), the
 * real router. Red-team ids (RT-…) name the attack each case stands against;
 * the threat model is docs/security/THREAT-MODEL-voting-red-blue-2026-11-26.md.
 *
 * Each case names, in brackets, the fault it was seen failing on first.
 *
 * @born-red decision 13 | method: injected-fault, each removed after: the cap
 *   counting only live passes (`AND a.is_revoked = 0` in the INSERT; the
 *   give-revoke-give case red), the cap check outside the INSERT (the parallel
 *   give case red: 5+ given), the vote route's accessPassUsable check removed
 *   (the revoke case red), the access voter key under the room's label (the
 *   key-separation case red), openCrowdPass on the room seal (both cross-channel
 *   cases red), CROWD_COUNT writing vote_tallies (the swarm case red: the room
 *   tally moved), the crowd final without the room-final guard (the
 *   crowd-before-room case red), the vote route's limit removed (the 429 case
 *   red) | date: 2026-11-26
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import {
  accessVoterKey,
  crowdVoterKey,
  mintCrowdPass,
  mintVotePass,
  openCrowdPass,
  openVotePass,
  voterKey,
} from '../src/lib/vote-pass';
import { ACCESS_PASS_CAP, accessLookup } from '../src/lib/vote-access-pass';
import { VOTING_ON } from '../src/lib/voting-switch';
import { runVoteFinalJob } from '../src/lib/vote-sets';
import { resetCrowdFloodMemo } from '../src/lib/vote-crowd';
import { castVote } from '../src/lib/vote-cast';
import { pepperEpoch } from '../src/lib/anon-id-hash';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;
const PEPPER = tenv.ANON_ID_HASH_PEPPER;
const routerEnv = { ...(env as unknown as RouterEnv), VOTING_ENABLED: VOTING_ON } as RouterEnv;

const ORIGIN = 'https://ose.test';
const BRAND = 'brand-vao-a';
const BRAND_B = 'brand-vao-b';
const OWNER = 'owner-vao-a@example.com';
const OWNER_B = 'owner-vao-b@example.com';
const N1 = 'evt-vao-n1';
const N2 = 'evt-vao-n2';
const NB = 'evt-vao-nb';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const nowS = Math.floor(Date.now() / 1000);
const adminAs = (email: string) => ({
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email,
    iat: nowS - 10,
    exp: nowS + 3600,
  })}.sig`,
  'Sec-Fetch-Site': 'same-origin',
});
const ADMIN = adminAs(OWNER);

type Json = Record<string, any>;
let ipSeq = 1;
const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

async function routed(req: Request, over: Partial<RouterEnv> = {}) {
  const ctx = createExecutionContext();
  const res = await route(req, { ...routerEnv, ...over } as RouterEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function admin(method: string, path: string, body?: unknown, headers = ADMIN) {
  const res = await routed(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const vp = (eventId: string, tail = '') => `/api/v2/admin/events/${eventId}/votables${tail}`;

async function post(path: string, body: unknown, ip = nextIp(), over: Partial<RouterEnv> = {}) {
  const res = await routed(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-origin',
        'CF-Connecting-IP': ip,
      },
      body: JSON.stringify(body),
    }),
    over
  );
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  return { status: res.status, text, json };
}
const roomVote = (eventId: string, objectId: string, side: string, pass: string, ip?: string) =>
  post(`/api/v2/vote/${eventId}`, { object_id: objectId, side, pass }, ip);
const crowdVote = (eventId: string, objectId: string, side: string, pass: string, ip?: string) =>
  post(`/api/v2/vote/${eventId}/crowd`, { object_id: objectId, side, pass }, ip);
const redeem = (token: unknown, ip?: string, over: Partial<RouterEnv> = {}) =>
  post('/api/v2/vote/access', { token }, ip, over);

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();
const one = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .first<Json>();
const n = async (sql: string, ...binds: unknown[]) => Number((await one(sql, ...binds))?.n ?? 0);
const roomTally = async (objectId: string) =>
  (await one(
    `SELECT up_count, down_count FROM vote_tallies WHERE object_id = ?`,
    objectId
  )) as Json;
const crowdTally = async (objectId: string) =>
  (await one(
    `SELECT up_count, down_count FROM vote_crowd_tallies WHERE object_id = ?`,
    objectId
  )) as Json | null;

const cookie = (i: number) => `anon_22222222-aaaa-bbbb-cccc-${String(i).padStart(12, '0')}`;
const roomPass = (eventId: string, i = 1) =>
  mintVotePass(PEPPER, cookie(i), eventId, Date.now()) as Promise<string>;
const crowdPass = (eventId: string, i = 1) =>
  mintCrowdPass(PEPPER, cookie(i), eventId, Date.now()) as Promise<string>;

/** The token inside a link the host was shown: it rides in the fragment. */
const tokenOf = (url: string) => {
  const u = new URL(url);
  expect(u.pathname).toBe('/access');
  expect(u.search).toBe('');
  return u.hash.slice(1);
};

async function seedEvent(id: string, brand: string) {
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, 'active', 'Eagles Hall', '2099-06-01', '2099-06-01', 'America/Chicago')`,
    id,
    brand,
    `Access and Online Pick fixture ${id}`,
    id
  );
}

async function makeSet(eventId: string, labels: string[], playedBy: 'object' | 'team' = 'object') {
  expect((await admin('POST', vp(eventId), { played_by: playedBy })).status).toBe(201);
  const ids: string[] = [];
  for (const label of labels) {
    const res = await admin('POST', vp(eventId, '/objects'), {
      kind: 'song',
      label,
      ...(playedBy === 'team' ? { group_id: 'grp_00000021' } : {}),
    });
    ids.push(res.json.object.id);
  }
  return ids;
}
async function openAll(eventId: string, ids: string[]) {
  expect((await admin('POST', vp(eventId, '/open'), { room_size: 200 })).status).toBe(200);
  for (const id of ids)
    expect((await admin('POST', vp(eventId, `/objects/${id}/open`), {})).status).toBe(200);
}
async function openNight(eventId: string, labels = ['One', 'Two']) {
  const ids = await makeSet(eventId, labels);
  await openAll(eventId, ids);
  return ids;
}
const give = (eventId: string, headers = ADMIN) =>
  admin('POST', vp(eventId, '/access-passes'), {}, headers);

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
  for (const [email, brand] of [
    [OWNER, BRAND],
    [OWNER_B, BRAND_B],
  ])
    await run(
      `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
      email,
      brand
    );
});

beforeEach(async () => {
  const like = 'evt-vao-%';
  for (const sql of [
    `DELETE FROM vote_crowd_receipts WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    `DELETE FROM vote_crowd_tallies WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    `DELETE FROM vote_crowd_participants WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id LIKE ?)`,
    `DELETE FROM vote_crowd_sets WHERE event_id LIKE ?`,
    `DELETE FROM vote_access_passes WHERE event_id LIKE ?`,
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

// ── The Access Pass ──────────────────────────────────────────────────────────

describe('Access Pass: giving one', () => {
  test('a host gives a pass: a link with the token in the fragment, shown once, audited without a recipient', async () => {
    await makeSet(N1, ['One']);
    const res = await give(N1);
    expect(res.status).toBe(201);
    const { id, url } = res.json.access_pass;
    expect(id).toMatch(/^vap_[0-9a-f]{32}$/);
    const token = tokenOf(url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The list never carries the link again, a use, or a recipient.
    const list = await admin('GET', vp(N1, '/access-passes'));
    expect(list.json.access).toEqual({
      passes: [{ id, revoked: false }],
      remaining: ACCESS_PASS_CAP - 1,
      cap: ACCESS_PASS_CAP,
    });
    expect(JSON.stringify(list.json)).not.toContain(token);
    // The audit row: the action, the admin, the event. Nothing about who it is for.
    const audit = await one(
      `SELECT action, actor, details FROM admin_audit_log WHERE resource_id = ? AND action = 'VOTE_ACCESS_PASS_GIVE'`,
      N1
    );
    expect(audit?.actor).toBe(OWNER);
    expect(String(audit?.details ?? '')).not.toContain(token);
  });

  test('RT-AP-01: the token is never stored; a copy of the table cannot vote [lookup = token]', async () => {
    await makeSet(N1, ['One']);
    const { url } = (await give(N1)).json.access_pass;
    const token = tokenOf(url);
    const row = await one(`SELECT * FROM vote_access_passes WHERE event_id = ?`, N1);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row?.lookup).toBe(await accessLookup(PEPPER, token));
    // Redeeming the lookup itself is refused: the stored value is not a token.
    expect((await redeem(row?.lookup)).status).toBe(403);
  });

  test('RT-AP-02: a pass takes no details: no name, note or reason can be typed in', async () => {
    await makeSet(N1, ['One']);
    for (const body of [{ name: 'Matt' }, { note: 'seizure day' }, { reason: 'x' }]) {
      const res = await admin('POST', vp(N1, '/access-passes'), body);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('UNKNOWN_FIELD');
    }
    const cols = await tenv.DB.prepare(`PRAGMA table_info(vote_access_passes)`).all<Json>();
    expect((cols.results ?? []).map((c) => c.name).sort()).toEqual([
      'created_at',
      'event_id',
      'id',
      'is_revoked',
      'lookup',
      'set_id',
    ]);
  });

  test(`RT-AP-03: at most ${ACCESS_PASS_CAP} ever, and a revoke does not free a slot [cap counts live passes only]`, async () => {
    await makeSet(N1, ['One']);
    const ids: string[] = [];
    for (let i = 0; i < ACCESS_PASS_CAP; i++) {
      const res = await give(N1);
      expect(res.status).toBe(201);
      ids.push(res.json.access_pass.id);
    }
    const fifth = await give(N1);
    expect(fifth.status).toBe(409);
    expect(fifth.json.code).toBe('ACCESS_PASS_LIMIT');
    // Give, vote, revoke, give again would stack votes: a revoke never frees a slot.
    expect((await admin('POST', vp(N1, `/access-passes/${ids[0]}/revoke`), {})).status).toBe(200);
    expect((await give(N1)).status).toBe(409);
    expect(await n(`SELECT COUNT(*) AS n FROM vote_access_passes WHERE event_id = ?`, N1)).toBe(
      ACCESS_PASS_CAP
    );
  });

  test('RT-AP-04: twelve gives at once still give at most the cap [cap checked outside the INSERT]', async () => {
    await makeSet(N1, ['One']);
    const results = await Promise.all(Array.from({ length: 12 }, () => give(N1)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(ACCESS_PASS_CAP);
    expect(results.filter((r) => r.status === 409)).toHaveLength(12 - ACCESS_PASS_CAP);
    expect(await n(`SELECT COUNT(*) AS n FROM vote_access_passes WHERE event_id = ?`, N1)).toBe(
      ACCESS_PASS_CAP
    );
  });

  test('RT-AP-05: another brand cannot give, list or revoke a pass on this event', async () => {
    await makeSet(N1, ['One']);
    const mine = (await give(N1)).json.access_pass.id;
    const other = adminAs(OWNER_B);
    // The brand wall answers as if the event did not exist (404), never 2xx.
    expect((await give(N1, other)).status).toBe(404);
    expect((await admin('GET', vp(N1, '/access-passes'), undefined, other)).status).toBe(404);
    expect((await admin('POST', vp(N1, `/access-passes/${mine}/revoke`), {}, other)).status).toBe(
      404
    );
    expect(await n(`SELECT COUNT(*) AS n FROM vote_access_passes WHERE event_id = ?`, N1)).toBe(1);
    expect(
      await n(`SELECT COUNT(*) AS n FROM vote_access_passes WHERE id = ? AND is_revoked = 1`, mine)
    ).toBe(0);
    // And a pass id of another event is not found from this one.
    await makeSet(N2, ['Two']);
    expect((await admin('POST', vp(N2, `/access-passes/${mine}/revoke`), {})).status).toBe(404);
  });

  test("a final set takes no new pass, and final deletes the set's passes", async () => {
    const [a] = await makeSet(N1, ['One']);
    await give(N1);
    await openAll(N1, [a]);
    expect((await admin('POST', vp(N1, '/close'))).status).toBe(200);
    expect((await admin('POST', vp(N1, '/finalize'))).status).toBe(200);
    expect(await n(`SELECT COUNT(*) AS n FROM vote_access_passes WHERE event_id = ?`, N1)).toBe(0);
    expect((await give(N1)).json.code).toBe('VOTE_SET_FINAL');
  });
});

describe('Access Pass: redeeming and voting', () => {
  test('a redeemed pass votes in the Room Pick with the same weight as the room [not counted]', async () => {
    const [a] = await makeSet(N1, ['One']);
    const token = tokenOf((await give(N1)).json.access_pass.url);
    // Given in advance, while in draft: not redeemable until the set opens.
    expect((await redeem(token)).status).toBe(403);
    await openAll(N1, [a]);
    const res = await redeem(token);
    expect(res.status).toBe(200);
    expect(res.json.event_id).toBe(N1);
    const claims = await openVotePass(PEPPER, res.json.pass, Date.now(), N1);
    expect(claims?.access_id).toMatch(/^vap_/);
    expect((await roomVote(N1, a, 'up', res.json.pass)).status).toBe(200);
    // A room browser's vote: the same counter, the same step of one.
    expect((await roomVote(N1, a, 'up', await roomPass(N1, 1))).status).toBe(200);
    expect(await roomTally(a)).toEqual({ up_count: 2, down_count: 0 });
    // Nothing marks the pass vote: no table holds the pass id or the token beside a vote.
    for (const t of ['vote_tallies', 'vote_receipts', 'vote_participants'])
      expect(
        JSON.stringify((await tenv.DB.prepare(`SELECT * FROM ${t}`).all()).results)
      ).not.toContain(claims!.access_id!);
  });

  test('RT-AP-06: a shared or forwarded pass is still one voter: every redeem gives the same key', async () => {
    const [a, b] = await openNight(N1);
    const token = tokenOf((await give(N1)).json.access_pass.url);
    const first = (await redeem(token)).json.pass;
    const second = (await redeem(token)).json.pass;
    const third = (await redeem(token)).json.pass;
    for (const p of [first, second, third]) await roomVote(N1, a, 'up', p);
    await roomVote(N1, b, 'up', second);
    expect((await roomTally(a)).up_count).toBe(1);
    expect((await roomTally(b)).up_count).toBe(1);
  });

  test('RT-AP-07: a revoke stops a pass already redeemed, before it runs out [no revoke check at the vote]', async () => {
    const [a, b] = await openNight(N1);
    const given = (await give(N1)).json.access_pass;
    const p = (await redeem(tokenOf(given.url))).json.pass;
    expect((await roomVote(N1, a, 'up', p)).status).toBe(200);
    expect((await admin('POST', vp(N1, `/access-passes/${given.id}/revoke`), {})).status).toBe(200);
    const after = await roomVote(N1, b, 'up', p);
    expect(after.status).toBe(403);
    expect(after.json.code).toBe('VOTE_PASS_INVALID');
    expect((await roomTally(b)).up_count).toBe(0);
    // The vote already cast stays (a receipt is not linked to the pass).
    expect((await roomTally(a)).up_count).toBe(1);
    expect((await redeem(tokenOf(given.url))).status).toBe(403);
  });

  test('RT-AP-08: every refusal is the same answer: unknown, revoked, closed, voting off, bad shape', async () => {
    const [a] = await openNight(N1);
    const given = (await give(N1)).json.access_pass;
    const token = tokenOf(given.url);
    const second = (await give(N1)).json.access_pass;
    const revokedTok = tokenOf(second.url);
    const revokedId = second.id;
    await admin('POST', vp(N1, `/access-passes/${revokedId}/revoke`), {});
    const answers = [
      await redeem('A'.repeat(43)),
      await redeem(revokedTok),
      await redeem(token, undefined, { VOTING_ENABLED: 'off' } as Partial<RouterEnv>),
      await redeem('not a token'),
      await redeem(12345),
    ];
    // Voting off: the route does not exist at all (the router's own 404).
    expect(answers[2].status).toBe(404);
    const refusals = [answers[0], answers[1], answers[3], answers[4]];
    for (const r of refusals) expect(r.status).toBe(403);
    expect(new Set(refusals.map((r) => r.text)).size).toBe(1);
    await admin('POST', vp(N1, `/objects/${a}/close`), {});
    await admin('POST', vp(N1, '/close'));
    const closed = await redeem(token);
    expect(closed.text).toBe(refusals[0].text);
  });

  test('RT-AP-09: the redeem route takes JSON from this site only, with exactly one field', async () => {
    await openNight(N1);
    const token = tokenOf((await give(N1)).json.access_pass.url);
    const cross = await routed(
      new Request(`${ORIGIN}/api/v2/vote/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify({ token }),
      })
    );
    expect(cross.status).toBe(403);
    const form = await routed(
      new Request(`${ORIGIN}/api/v2/vote/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ token }),
      })
    );
    expect(form.status).toBe(403);
    expect((await post('/api/v2/vote/access', { token, extra: 1 })).status).toBe(403);
  });

  test('RT-AP-10: an Access Pass key never equals a room key or a crowd key, even for the same bytes [one label]', async () => {
    const same = 'anon_33333333-aaaa-bbbb-cccc-000000000001';
    const keys = [
      await voterKey(PEPPER, same, N1),
      await accessVoterKey(PEPPER, same, N1),
      await crowdVoterKey(PEPPER, same, N1),
    ];
    expect(new Set(keys).size).toBe(3);
    // And a pass for one event never opens at another.
    const p = await roomPass(N1);
    expect(await openVotePass(PEPPER, p, Date.now(), N2)).toBeNull();
  });

  test('the access page carries no token, and the token never reaches a request line', async () => {
    const res = await routed(new Request(`${ORIGIN}/access`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    const html = await res.text();
    expect(html).toContain("history.replaceState(null, '', location.pathname)");
    expect(html).toContain('/api/v2/vote/access');
  });
});

// ── The Online Pick ──────────────────────────────────────────────────────────

async function entry(eventId: string, cookieValue?: string, over: Partial<RouterEnv> = {}) {
  const res = await routed(
    new Request(`${ORIGIN}/q/crowd/${eventId}`, {
      headers: {
        'CF-Connecting-IP': nextIp(),
        ...(cookieValue ? { Cookie: `ose_anon=${cookieValue}` } : {}),
      },
      redirect: 'manual',
    }),
    over
  );
  return { status: res.status, location: res.headers.get('Location') ?? '', res };
}

describe('Online Pick: on and off', () => {
  test('off by default: the way in sends the browser to the event page with no pass', async () => {
    await openNight(N1);
    const e = await entry(N1);
    expect(e.status).toBe(302);
    expect(e.location).toBe(`${ORIGIN}/events/${N1}`);
    const list = await admin('GET', vp(N1));
    expect(list.json.online_pick).toEqual({ on: false, final: false, burst_seen: false });
  });

  test('on: the way in mints a crowd pass in the fragment of the Online Pick page', async () => {
    await openNight(N1);
    expect((await admin('POST', vp(N1, '/online-pick'), { on: true })).status).toBe(200);
    const e = await entry(N1);
    expect(e.location.startsWith(`${ORIGIN}/events/${N1}/online-pick#t=vc1.`)).toBe(true);
    // The host's view: on, never a count, T or V.
    const list = await admin('GET', vp(N1));
    expect(list.json.online_pick).toEqual({ on: true, final: false, burst_seen: false });
    expect(JSON.stringify(list.json)).not.toMatch(/secret|margin|floor|epoch|up_count/);
  });

  test('F1: a swarm on the way in trips the host-only alarm, once, and never blocks or shows in public [no alarm]', async () => {
    const [a] = await openNight(N1);
    expect((await admin('POST', vp(N1, '/online-pick'), { on: true })).status).toBe(200);
    resetCrowdFloodMemo();
    const keys: string[] = [];
    let n = 0;
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        n += 1;
        return { success: n <= 3 };
      },
    };
    for (let i = 0; i < 6; i++) {
      const e = await entry(N1, undefined, { VOTE_FLOOD_LIMITER: limiter } as Partial<RouterEnv>);
      // Detection only: every browser still gets its pass.
      expect(e.location.startsWith(`${ORIGIN}/events/${N1}/online-pick#t=vc1.`)).toBe(true);
    }
    // Keyed by the event only, under the crowd's own prefix.
    expect([...new Set(keys)]).toEqual([`crowd-flood:${N1}`]);
    const list = await admin('GET', vp(N1));
    expect(list.json.online_pick).toEqual({ on: true, final: false, burst_seen: true });
    // The room's own alarm is untouched.
    expect((await one(`SELECT burst_seen FROM vote_sets WHERE event_id = ?`, N1))?.burst_seen).toBe(
      0
    );
    // No public answer names it.
    const page = await routed(new Request(`${ORIGIN}/events/${N1}/online-pick`));
    expect(await page.text()).not.toMatch(/burst|gaming the Online Pick/i);
    void a;
  });

  test('a team night cannot have an Online Pick (v1)', async () => {
    await makeSet(N1, ['One'], 'team');
    const res = await admin('POST', vp(N1, '/online-pick'), { on: true });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('ONLINE_PICK_TEAM_NIGHT');
  });

  test('only { on: boolean } is taken, and another brand cannot turn it on', async () => {
    await makeSet(N1, ['One']);
    expect((await admin('POST', vp(N1, '/online-pick'), { on: 'yes' })).status).toBe(400);
    expect((await admin('POST', vp(N1, '/online-pick'), { on: true, weight: 2 })).status).toBe(400);
    expect(
      (await admin('POST', vp(N1, '/online-pick'), { on: true }, adminAs(OWNER_B))).status
    ).toBe(404);
    expect((await admin('GET', vp(N1))).json.online_pick).toEqual({
      on: false,
      final: false,
      burst_seen: false,
    });
  });
});

describe('Online Pick: two channels, never mixed', () => {
  test('RT-OP-01: a crowd pass is refused by the Room Pick, and a room pass by the Online Pick [one seal]', async () => {
    const [a] = await openNight(N1);
    await admin('POST', vp(N1, '/online-pick'), { on: true });
    const cp = await crowdPass(N1);
    const rp = await roomPass(N1);
    expect(await openVotePass(PEPPER, cp, Date.now(), N1)).toBeNull();
    expect(await openCrowdPass(PEPPER, rp, Date.now(), N1)).toBeNull();
    // Re-prefixed, a crowd pass still fails the room's seal.
    expect(await openVotePass(PEPPER, cp.replace(/^vc1\./, 'vp1.'), Date.now(), N1)).toBeNull();
    expect((await roomVote(N1, a, 'up', cp)).json.code).toBe('VOTE_PASS_INVALID');
    expect((await crowdVote(N1, a, 'up', rp)).json.code).toBe('VOTE_PASS_INVALID');
    expect((await roomTally(a)).up_count).toBe(0);
    expect(await crowdTally(a)).toBeNull();
  });

  test('RT-OP-02: a crowd vote moves the crowd counter only; a room vote the room counter only', async () => {
    const [a] = await openNight(N1);
    await admin('POST', vp(N1, '/online-pick'), { on: true });
    expect((await crowdVote(N1, a, 'up', await crowdPass(N1, 1))).status).toBe(200);
    expect(await roomTally(a)).toEqual({ up_count: 0, down_count: 0 });
    expect(await crowdTally(a)).toEqual({ up_count: 1, down_count: 0 });
    expect((await roomVote(N1, a, 'down', await roomPass(N1, 1))).status).toBe(200);
    expect(await roomTally(a)).toEqual({ up_count: 0, down_count: 1 });
    expect(await crowdTally(a)).toEqual({ up_count: 1, down_count: 0 });
  });

  test('RT-OP-03: a crowd vote is one per browser per object, and is refused when the Online Pick is off', async () => {
    const [a] = await openNight(N1);
    await admin('POST', vp(N1, '/online-pick'), { on: true });
    const p = await crowdPass(N1, 1);
    await crowdVote(N1, a, 'up', p);
    await crowdVote(N1, a, 'up', p);
    expect((await crowdTally(a))?.up_count).toBe(1);
    await admin('POST', vp(N1, '/online-pick'), { on: false });
    const off = await crowdVote(N1, a, 'up', await crowdPass(N1, 2));
    expect(off.status).toBe(409);
    expect((await crowdTally(a))?.up_count).toBe(1);
  });

  test('RT-OP-04: the Online Pick closes when the Room Pick closes', async () => {
    const [a] = await openNight(N1);
    await admin('POST', vp(N1, '/online-pick'), { on: true });
    await admin('POST', vp(N1, '/close'));
    expect((await crowdVote(N1, a, 'up', await crowdPass(N1, 3))).status).toBe(409);
    const e = await entry(N1);
    expect(e.location).toBe(`${ORIGIN}/events/${N1}`);
  });

  test('RT-OP-05 swarm: 300 crowd voters for B and 12 room voters for A: the Room Pick is A, the Online Pick is B [crowd counter writes the room]', async () => {
    const [a, b] = await openNight(N1, ['Alpha', 'Bravo']);
    await admin('POST', vp(N1, '/online-pick'), { on: true });
    // T is at most 9 and V at most 14: 14 room voters for A, none for B, always wins.
    for (let i = 0; i < 14; i++) await roomVote(N1, a, 'up', await roomPass(N1, 1000 + i));
    // A swarm of 300 distinct crowd browsers, in parallel bursts, all for B.
    for (let burst = 0; burst < 6; burst++)
      await Promise.all(
        Array.from({ length: 50 }, async (_, j) =>
          crowdVote(N1, b, 'up', await crowdPass(N1, 5000 + burst * 50 + j))
        )
      );
    expect(await roomTally(a)).toEqual({ up_count: 14, down_count: 0 });
    expect(await roomTally(b)).toEqual({ up_count: 0, down_count: 0 });
    expect((await crowdTally(b))?.up_count).toBe(300);
    await admin('POST', vp(N1, '/close'));
    expect((await admin('POST', vp(N1, '/finalize'))).status).toBe(200);
    const room = await one(
      `SELECT outcome, winner_object_id FROM vote_sets WHERE event_id = ?`,
      N1
    );
    expect(room).toEqual({ outcome: 'winner', winner_object_id: a });
    const crowd = await one(
      `SELECT outcome, winner_object_id, is_final, secret_margin, secret_floor FROM vote_crowd_sets WHERE event_id = ?`,
      N1
    );
    expect(crowd).toEqual({
      outcome: 'winner',
      winner_object_id: b,
      is_final: 1,
      secret_margin: null,
      secret_floor: null,
    });
    // Everything the crowd counted is gone at final.
    expect(await crowdTally(b)).toBeNull();
    expect(
      await n(
        `SELECT COUNT(*) AS n FROM vote_crowd_participants WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id = ?)`,
        N1
      )
    ).toBe(0);
    // The voter page shows the Room Pick first, the Online Pick below with its note.
    const page = await (await routed(new Request(`${ORIGIN}/events/${N1}/vote`))).text();
    const roomAt = page.indexOf('data-testid="vote-result"');
    const crowdAt = page.indexOf('data-testid="vote-crowd-result"');
    expect(roomAt).toBeGreaterThan(-1);
    expect(crowdAt).toBeGreaterThan(roomAt);
    expect(page).toContain('It never changes the Room Pick.');
  });

  test('RT-OP-06: the Online Pick is never final before the Room Pick [no room-final guard]', async () => {
    const [a] = await openNight(N1);
    await admin('POST', vp(N1, '/online-pick'), { on: true });
    await crowdVote(N1, a, 'up', await crowdPass(N1, 1));
    const { finalizeOnlinePickAndPasses } = await import('../src/lib/vote-crowd');
    const setId = (await one(`SELECT id FROM vote_sets WHERE event_id = ?`, N1))!.id as string;
    await finalizeOnlinePickAndPasses(tenv.DB, setId);
    const crowd = await one(
      `SELECT is_final, outcome FROM vote_crowd_sets WHERE set_id = ?`,
      setId
    );
    expect(crowd).toEqual({ is_final: 0, outcome: null });
    expect((await crowdTally(a))?.up_count).toBe(1);
  });

  test('the nightly job finishes an Online Pick and passes left by a failed follow-up', async () => {
    const [a] = await openNight(N1);
    await admin('POST', vp(N1, '/online-pick'), { on: true });
    await give(N1);
    await crowdVote(N1, a, 'up', await crowdPass(N1, 1));
    // The room set made final as if the follow-up batch had failed.
    await admin('POST', vp(N1, '/close'));
    await run(
      `UPDATE vote_sets SET is_final = 1, final_at = '2099-01-01 00:00:00', secret_margin = NULL, secret_floor = NULL WHERE event_id = ?`,
      N1
    );
    await runVoteFinalJob({ DB: tenv.DB });
    expect(
      await n(`SELECT COUNT(*) AS n FROM vote_crowd_sets WHERE event_id = ? AND is_final = 1`, N1)
    ).toBe(1);
    expect(await n(`SELECT COUNT(*) AS n FROM vote_access_passes WHERE event_id = ?`, N1)).toBe(0);
  });

  test('the Online Pick page has the fixed words and posts to the crowd route', async () => {
    await openNight(N1);
    const page = await (await routed(new Request(`${ORIGIN}/events/${N1}/online-pick`))).text();
    expect(page).toContain('data-channel="crowd"');
    expect(page).toContain('>Online Pick</h1>');
    expect(page).toContain('this can be gamed');
    expect(page).not.toContain('data-testid="vote-access-line"');
  });
});

// ── The vote route's limit (decision 5) ──────────────────────────────────────

describe('RT-RP-01: the vote route is limited per caller', () => {
  test('one address past 600 votes in a minute is refused with a 429, and another address is not [no limit]', async () => {
    const [a] = await openNight(N1);
    const p = await roomPass(N1);
    const ip = '203.0.113.201';
    let last = 0;
    for (let i = 0; i < 605; i++) last = (await roomVote(N1, a, 'up', p, ip)).status;
    expect(last).toBe(429);
    expect((await roomVote(N1, a, 'up', p, '203.0.113.202')).status).toBe(200);
  }, 120_000);
});

// ── Every refusal answered (CCR loop 4, QA seat: refusals with no test) ─────

async function adminWith(over: Partial<RouterEnv>, method: string, path: string, body?: unknown) {
  const res = await routed(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: body === undefined ? ADMIN : { ...ADMIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    over
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

describe('every refusal of the host routes has its own answer', () => {
  test('no pepper: no pass is given and the Online Pick does not turn on (503) [pepper check removed]', async () => {
    await makeSet(N1, ['One']);
    const noPepper = { ANON_ID_HASH_PEPPER: '' } as Partial<RouterEnv>;
    const g = await adminWith(noPepper, 'POST', vp(N1, '/access-passes'), {});
    expect(g.status).toBe(503);
    expect(g.json.code).toBe('ACCESS_PASS_UNAVAILABLE');
    const o = await adminWith(noPepper, 'POST', vp(N1, '/online-pick'), { on: true });
    expect(o.status).toBe(503);
    expect(o.json.code).toBe('VOTING_UNAVAILABLE');
    expect(await n(`SELECT COUNT(*) AS n FROM vote_access_passes WHERE event_id = ?`, N1)).toBe(0);
    expect(await n(`SELECT COUNT(*) AS n FROM vote_crowd_sets WHERE event_id = ?`, N1)).toBe(0);
  });

  test('an event with no vote set: give, list and the Online Pick answer VOTE_SET_NOT_FOUND', async () => {
    for (const [method, tail, body] of [
      ['POST', '/access-passes', {}],
      ['GET', '/access-passes', undefined],
      ['POST', '/online-pick', { on: true }],
    ] as const) {
      const r = await admin(method, vp(N1, tail), body);
      expect(r.status, `${method} ${tail}`).toBe(404);
      expect(r.json.code, `${method} ${tail}`).toBe('VOTE_SET_NOT_FOUND');
    }
  });

  test('revoke: an unknown id and a bad id are not found; a second revoke changes nothing', async () => {
    await makeSet(N1, ['One']);
    const id = (await give(N1)).json.access_pass.id as string;
    const unknown = `vap_${'0'.repeat(32)}`;
    for (const pid of [unknown, 'vap_nothex', 'x'.repeat(40)]) {
      const r = await admin('POST', vp(N1, `/access-passes/${encodeURIComponent(pid)}/revoke`), {});
      expect(r.status, pid).toBe(404);
      if (r.json.code !== undefined) expect(r.json.code, pid).not.toBe('VOTE_SET_NOT_FOUND');
    }
    expect((await admin('POST', vp(N1, `/access-passes/${id}/revoke`), {})).status).toBe(200);
    expect((await admin('POST', vp(N1, `/access-passes/${id}/revoke`), {})).status).toBe(200);
    const list = await admin('GET', vp(N1, '/access-passes'));
    expect(list.json.access.remaining).toBe(ACCESS_PASS_CAP - 1);
    expect(list.json.access.passes).toEqual([{ id, revoked: true }]);
  });
});

describe('RT-OP-07: the crowd vote route takes JSON from this site only [crowd guards removed]', () => {
  test('wrong method, wrong type, another site, a bad body, a bad event id, no pepper', async () => {
    const [a] = await openNight(N1, ['One']);
    expect((await admin('POST', vp(N1, '/online-pick'), { on: true })).status).toBe(200);
    const pass = await crowdPass(N1);
    const path = `/api/v2/vote/${N1}/crowd`;
    const body = JSON.stringify({ object_id: a, side: 'up', pass });
    const send = (init: RequestInit, p = path, over: Partial<RouterEnv> = {}) =>
      routed(new Request(`${ORIGIN}${p}`, init), over);
    const same = { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' };

    // The router takes only a POST here: a GET never reaches the counter.
    expect([404, 405]).toContain((await send({ method: 'GET' })).status);
    expect(
      (await send({ method: 'POST', headers: { ...same, 'Content-Type': 'text/plain' }, body }))
        .status
    ).toBe(415);
    const cross = await send({
      method: 'POST',
      headers: { ...same, 'Sec-Fetch-Site': 'cross-site' },
      body,
    });
    expect(cross.status).toBe(403);
    expect(((await cross.json()) as Json).code).toBe('SAME_ORIGIN_ONLY');
    const bad = await send({ method: 'POST', headers: same, body: '{"object_id":1}' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Json).code).toBe('INVALID_VOTE');
    const off = await send({ method: 'POST', headers: same, body }, path, {
      ANON_ID_HASH_PEPPER: '',
    } as Partial<RouterEnv>);
    expect(off.status).toBe(503);
    // A malformed event id never reaches the counter.
    const odd = await send({ method: 'POST', headers: same, body }, `/api/v2/vote/x%27/crowd`);
    expect(odd.status).toBeGreaterThanOrEqual(400);
    // None of these moved a counter.
    expect(await crowdTally(a)).toBeNull();
    // And the same pass still counts once, through the front door.
    expect((await crowdVote(N1, a, 'up', pass)).status).toBe(200);
    expect((await crowdTally(a))?.up_count).toBe(1);
  });
});

describe('SEC-4: a revoke stops a vote already in flight [revoke checked only before the vote]', () => {
  test('a vote whose Access Pass was taken back after the first check is not counted', async () => {
    const [a] = await openNight(N1, ['One']);
    const id = (await give(N1)).json.access_pass.id as string;
    // The route's own check passed; then the host takes the pass back.
    expect((await admin('POST', vp(N1, `/access-passes/${id}/revoke`), {})).status).toBe(200);
    const epoch = (await pepperEpoch(PEPPER)) as string;
    const k = await accessVoterKey(PEPPER, 'in-flight-token', N1);
    const base = { eventId: N1, objectId: a, side: 'up' as const, k, epoch, nowMs: Date.now() };
    expect(await castVote(tenv.DB, PEPPER, { ...base, accessId: id })).toBe('closed');
    expect((await roomTally(a)).up_count).toBe(0);
    // A room pass (no Access Pass) still counts through the same statement.
    const roomK = await voterKey(PEPPER, cookie(9), N1);
    expect(await castVote(tenv.DB, PEPPER, { ...base, k: roomK })).toBe('accepted');
    expect((await roomTally(a)).up_count).toBe(1);
  });
});

describe('SEC-1: the Online Pick alarm sees volume, not only a burst [no volume trip]', () => {
  test('more than twice the room size of crowd voters trips the host-only flag; up to it does not', async () => {
    const [a] = await makeSet(N1, ['One']);
    expect((await admin('POST', vp(N1, '/open'), { room_size: 10 })).status).toBe(200);
    expect((await admin('POST', vp(N1, `/objects/${a}/open`), {})).status).toBe(200);
    expect((await admin('POST', vp(N1, '/online-pick'), { on: true })).status).toBe(200);
    const burst = async () =>
      Number(
        (await one(`SELECT burst_seen FROM vote_crowd_sets WHERE event_id = ?`, N1))?.burst_seen
      );
    // The smallest room the host can give is 10: up to 20 crowd voters is not an alarm.
    for (let i = 1; i <= 20; i++)
      expect((await crowdVote(N1, a, 'up', await crowdPass(N1, 100 + i))).status).toBe(200);
    expect(await burst()).toBe(0);
    // A second vote by a voter already in is not a new voter.
    expect((await crowdVote(N1, a, 'up', await crowdPass(N1, 101))).status).toBe(200);
    expect(await burst()).toBe(0);
    expect((await crowdVote(N1, a, 'up', await crowdPass(N1, 121))).status).toBe(200);
    expect(await burst()).toBe(1);
    // The host sees the flag and no number; the Room Pick did not move.
    const view = await admin('GET', vp(N1));
    expect(view.json.online_pick).toEqual({ on: true, final: false, burst_seen: true });
    expect((await roomTally(a)).up_count).toBe(0);
  });
});
