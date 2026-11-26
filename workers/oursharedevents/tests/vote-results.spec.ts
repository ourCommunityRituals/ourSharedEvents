/**
 * The night's result at final (OSE-2130, S5 of OSE-1193; OSE ADR-040
 * decisions 4, 7 and 8). Workers pool: the admin finalize route and the
 * nightly job against a real D1 with migrations 0111 to 0114.
 *
 * What it holds:
 *   1. no result before the set is final, and none while it is open;
 *   2. computing the result sets final; a second compute changes nothing;
 *   3. below the secret voter floor V the night reads too close to call, the
 *      same answer as a narrow lead (V fixed by a test seam: a direct UPDATE);
 *   4. a lead under the secret margin T is too close; at T the winner is named
 *      (T fixed by a test seam);
 *   5. a tie is too close (no tiebreak, Q17); "not for me" counts are not used;
 *   6. on a team night a voter who backs three of a team's songs adds one to
 *      its total: team markers decide, song up counts are never summed;
 *   7. T and V are null after final; no response carries a count, T, V, a
 *      voter count or a reason; the finalize audit entry has no detail;
 *   8. a void set, and a set that never opened, become final with no result;
 *   9. the nightly job computes the result of a due set the same way;
 *  10. the result, final, the nulling and the deletes are one D1 batch.
 *
 * @born-red OSE-2130 | method: injected-fault, each removed after: the
 *   `secret_floor` comparison dropped from OUTCOME_UPDATE (3 red), `>=
 *   secret_margin` changed to `>= 5` (4 red), the team night ranked by song
 *   up counts instead of team markers (6 red), the team total as the sum of
 *   its songs' up counts (6 red), resultStatements
 *   moved out of the finalize batch into a second db.batch (10 red), the
 *   finalize answer spreading the set row (7 red) | date: 2026-11-19
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { runVoteFinalJob } from '../src/lib/vote-sets';
import { TOO_CLOSE_WORDS } from '../src/lib/vote-results';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND = 'brand-vrs-a';
const OWNER = 'owner-vrs-a@example.com';
const N1 = 'evt-vrs-n1'; // a night still to come
const OLD = 'evt-vrs-old'; // ended 10 days ago
const TEAM_1 = 'grp_00000001';
const TEAM_2 = 'grp_00000002';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const now = Math.floor(Date.now() / 1000);
const A = {
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email: OWNER,
    iat: now - 10,
    exp: now + 3600,
  })}.sig`,
  'Sec-Fetch-Site': 'same-origin',
};

type Json = Record<string, any>;
async function call(method: string, path: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      method,
      headers: body === undefined ? A : { ...A, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}
const vp = (eventId: string, tail = '') => `/api/v2/admin/events/${eventId}/votables${tail}`;

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();
const one = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .first<Json>();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let markerSeq = 0;
/** A fresh 64-hex marker, as the vote route would store. */
const marker = () => (++markerSeq).toString(16).padStart(64, '0');

async function seedEvent(id: string, date: string) {
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, 'active', 'Eagles Hall', ?, ?, 'America/Chicago')`,
    id,
    BRAND,
    `Result fixture ${id}`,
    id,
    date,
    date
  );
}

/** A set with these songs, opened. Returns the song ids in order. */
async function openNight(
  eventId: string,
  songs: { label: string; team?: string }[],
  playedBy: 'object' | 'team' = 'object'
): Promise<string[]> {
  expect((await call('POST', vp(eventId), { played_by: playedBy })).status).toBe(201);
  const ids: string[] = [];
  for (const s of songs) {
    const res = await call('POST', vp(eventId, '/objects'), {
      kind: 'song',
      label: s.label,
      ...(s.team ? { group_id: s.team } : {}),
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    ids.push(res.json.object.id);
  }
  expect((await call('POST', vp(eventId, '/open'), { room_size: 200 })).status).toBe(200);
  return ids;
}

/** The test seam: fix T and V for a set, as the first open would have drawn them. */
const fixSecrets = (eventId: string, margin: number, floor: number) =>
  run(
    `UPDATE vote_sets SET secret_margin = ?, secret_floor = ? WHERE event_id = ?`,
    margin,
    floor,
    eventId
  );

const setId = async (eventId: string) =>
  (await one(`SELECT id FROM vote_sets WHERE event_id = ?`, eventId))?.id as string;

/** Votes as the vote route would leave them: tallies, plus distinct voters. */
async function tally(objectId: string, up: number, down = 0) {
  await run(
    `UPDATE vote_tallies SET up_count = ?, down_count = ? WHERE object_id = ?`,
    up,
    down,
    objectId
  );
}
async function voters(eventId: string, n: number) {
  const id = await setId(eventId);
  for (let i = 0; i < n; i++)
    await run(`INSERT INTO vote_participants (set_id, marker) VALUES (?, ?)`, id, marker());
}
async function teamVoters(eventId: string, team: string, n: number) {
  const id = await setId(eventId);
  for (let i = 0; i < n; i++)
    await run(
      `INSERT INTO vote_team_markers (set_id, team_id, marker) VALUES (?, ?, ?)`,
      id,
      team,
      marker()
    );
}

async function closeAndCompute(eventId: string) {
  expect((await call('POST', vp(eventId, '/close'))).status).toBe(200);
  return call('POST', vp(eventId, '/finalize'));
}

const row = (eventId: string) =>
  one(
    `SELECT is_final, state, secret_margin, secret_floor, outcome, winner_object_id, winner_team_id
       FROM vote_sets WHERE event_id = ?`,
    eventId
  );

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
  await run(
    `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
    OWNER,
    BRAND
  );
});

beforeEach(async () => {
  const like = 'evt-vrs-%';
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
  await seedEvent(N1, '2099-06-01');
  await seedEvent(OLD, '2099-06-01'); // moved into the past after it opens
});

/** Keys a result answer may carry, and nothing else. */
const RESULT_KEYS = ['outcome', 'winner_object', 'winner_team_id'];
const NUMBERISH =
  /secret|margin|floor|count|tall(y|ies)|voter|participant|marker|receipt|epoch|void|reason|lead|total|runner/i;
function keys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keys(v, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keys(v, out);
    }
  return out;
}

describe('1 and 2. the result exists only once the set is final, and only once', () => {
  test('no result while open or closed; the finalize of an open set is refused', async () => {
    const [a] = await openNight(N1, [{ label: 'One' }, { label: 'Two' }]);
    await tally(a, 20);
    await voters(N1, 20);
    const open = await call('GET', vp(N1));
    expect(open.json.set.result).toBeNull();
    const refused = await call('POST', vp(N1, '/finalize'));
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('VOTE_SET_OPEN');
    expect((await row(N1))?.is_final).toBe(0);
    await call('POST', vp(N1, '/close'));
    expect((await call('GET', vp(N1))).json.set.result).toBeNull();
    expect((await row(N1))?.outcome).toBeNull();
  });

  test('computing the result sets final; a second compute changes nothing', async () => {
    const [a, b] = await openNight(N1, [{ label: 'One' }, { label: 'Two' }]);
    await fixSecrets(N1, 5, 10);
    await tally(a, 12);
    await tally(b, 3);
    await voters(N1, 15);
    const first = await closeAndCompute(N1);
    expect(first.status).toBe(200);
    expect(first.json.set.final).toBe(true);
    expect(first.json.set.result).toEqual({
      outcome: 'winner',
      winner_object: { id: a, label: 'One' },
      winner_team_id: null,
    });
    const before = await row(N1);
    const again = await call('POST', vp(N1, '/finalize'));
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('VOTE_SET_FINAL');
    expect(await row(N1)).toEqual(before);
  });
});

describe('3 to 5. the winner rule: the secret floor, the secret margin, no tiebreak', () => {
  test('below V the night is too close, word for word as a narrow lead', async () => {
    const [a, b] = await openNight(N1, [{ label: 'One' }, { label: 'Two' }]);
    await fixSecrets(N1, 5, 12);
    await tally(a, 11);
    await tally(b, 0);
    await voters(N1, 11); // a lead of 11, but one voter under V
    const under = await closeAndCompute(N1);
    expect(under.json.set.result).toEqual({
      outcome: 'too_close',
      winner_object: null,
      winner_team_id: null,
    });

    const [c, d] = await openNight(OLD, [{ label: 'One' }, { label: 'Two' }]);
    await fixSecrets(OLD, 9, 10);
    await tally(c, 14);
    await tally(d, 6);
    await voters(OLD, 20); // plenty of voters, a lead of 8 under T = 9
    const narrow = await closeAndCompute(OLD);
    expect(narrow.json.set.result).toEqual(under.json.set.result);
  });

  test('at V exactly, with the lead at T, the winner is named', async () => {
    const [a, b] = await openNight(N1, [{ label: 'One' }, { label: 'Two' }]);
    await fixSecrets(N1, 7, 12);
    await tally(a, 9);
    await tally(b, 2);
    await voters(N1, 12);
    const res = await closeAndCompute(N1);
    expect(res.json.set.result.outcome).toBe('winner');
    expect(res.json.set.result.winner_object.id).toBe(a);
  });

  test('a lead one under T is too close', async () => {
    const [a, b] = await openNight(N1, [{ label: 'One' }, { label: 'Two' }]);
    await fixSecrets(N1, 7, 10);
    await tally(a, 8);
    await tally(b, 2);
    await voters(N1, 30);
    expect((await closeAndCompute(N1)).json.set.result.outcome).toBe('too_close');
  });

  test('a tie at the top is too close: there is no tiebreak', async () => {
    const [a, b, c] = await openNight(N1, [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }]);
    await fixSecrets(N1, 5, 10);
    await tally(a, 15);
    await tally(b, 15);
    await tally(c, 0);
    await voters(N1, 30);
    expect((await closeAndCompute(N1)).json.set.result.outcome).toBe('too_close');
  });

  test('"not for me" counts are not used: only up counts rank', async () => {
    const [a, b] = await openNight(N1, [{ label: 'Loved' }, { label: 'Divisive' }]);
    await fixSecrets(N1, 5, 10);
    await tally(a, 6, 0);
    await tally(b, 12, 40);
    await voters(N1, 50);
    const res = await closeAndCompute(N1);
    expect(res.json.set.result.winner_object).toEqual({ id: b, label: 'Divisive' });
  });

  test('a single song with enough voters and up votes wins against nothing', async () => {
    const [a] = await openNight(N1, [{ label: 'Only' }]);
    await fixSecrets(N1, 5, 10);
    await tally(a, 10);
    await voters(N1, 10);
    expect((await closeAndCompute(N1)).json.set.result.winner_object?.id).toBe(a);
  });
});

describe('6. a team night counts distinct voters per team, never summed song votes', () => {
  test('one voter backing three songs of a team adds one to its total', async () => {
    const [t1a, t1b, t1c, t2a, t2b] = await openNight(
      N1,
      [
        { label: 'Team one A', team: TEAM_1 },
        { label: 'Team one B', team: TEAM_1 },
        { label: 'Team one C', team: TEAM_1 },
        { label: 'Team two A', team: TEAM_2 },
        { label: 'Team two B', team: TEAM_2 },
      ],
      'team'
    );
    await fixSecrets(N1, 7, 10);
    // Team one: the same 8 voters back all three songs (24 up votes summed).
    // Team two: 16 voters, 9 up votes on each song (18 summed).
    // Distinct voters: 16 against 8, a lead of 8 at T = 7: team two wins.
    // Summed song votes would give team one 24 against 18 (too close), and
    // ranking songs would give a tie of 9 against 9 (too close).
    for (const id of [t1a, t1b, t1c]) await tally(id, 8);
    await tally(t2a, 9);
    await tally(t2b, 9);
    await teamVoters(N1, TEAM_1, 8);
    await teamVoters(N1, TEAM_2, 16);
    await voters(N1, 24);
    const res = await closeAndCompute(N1);
    expect(res.json.set.result).toEqual({
      outcome: 'winner',
      winner_object: null,
      winner_team_id: TEAM_2,
    });
    expect((await row(N1))?.winner_object_id).toBeNull();
  });

  test('a team lead under T is too close', async () => {
    await openNight(
      N1,
      [
        { label: 'Team one A', team: TEAM_1 },
        { label: 'Team two A', team: TEAM_2 },
      ],
      'team'
    );
    await fixSecrets(N1, 6, 10);
    await teamVoters(N1, TEAM_1, 12);
    await teamVoters(N1, TEAM_2, 7);
    await voters(N1, 19);
    expect((await closeAndCompute(N1)).json.set.result.outcome).toBe('too_close');
  });
});

describe('7. nothing about the numbers or the rule leaves the database', () => {
  test('T and V are null after final; the answers carry only the result keys', async () => {
    const [a, b] = await openNight(N1, [{ label: 'One' }, { label: 'Two' }]);
    await fixSecrets(N1, 5, 10);
    await tally(a, 15);
    await tally(b, 1);
    await voters(N1, 16);
    const fin = await closeAndCompute(N1);
    const list = await call('GET', vp(N1));
    expect(await row(N1)).toMatchObject({ secret_margin: null, secret_floor: null, is_final: 1 });
    for (const answer of [fin.json, list.json]) {
      expect(Object.keys(answer.set.result).sort()).toEqual([...RESULT_KEYS].sort());
      expect(keys(answer).filter((k) => NUMBERISH.test(k))).toEqual([]);
      const text = JSON.stringify(answer);
      for (const n of ['15', '16']) expect(text).not.toMatch(new RegExp(`[:\\[,]${n}[,\\]}]`));
    }
  });

  test('the finalize audit entry names the action only, with no detail', async () => {
    await openNight(N1, [{ label: 'One' }, { label: 'Two' }]);
    await voters(N1, 3);
    await closeAndCompute(N1);
    const audit = await one(
      `SELECT action, details FROM admin_audit_log WHERE resource_id = ? AND action = 'VOTE_SET_FINALIZE'`,
      N1
    );
    expect(audit).toEqual({ action: 'VOTE_SET_FINALIZE', details: null });
  });

  test("the words for a night with no winner are the owner's", () => {
    expect(TOO_CLOSE_WORDS).toBe('Too close to call. The champion retains.');
  });
});

describe('8. a void set, and a set that never opened, have no result', () => {
  test('a void set becomes final with no outcome', async () => {
    const [a, b] = await openNight(N1, [{ label: 'One' }, { label: 'Two' }]);
    await fixSecrets(N1, 5, 10);
    await tally(a, 30);
    await tally(b, 0);
    await voters(N1, 30);
    await run(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch' WHERE event_id = ?`,
      N1
    );
    const res = await closeAndCompute(N1);
    expect(res.status).toBe(200);
    expect(res.json.set).toMatchObject({ final: true, result: null });
    expect(await row(N1)).toMatchObject({ outcome: null, winner_object_id: null });
  });

  test('a set that never opened becomes final with no outcome', async () => {
    expect((await call('POST', vp(N1))).status).toBe(201);
    const res = await call('POST', vp(N1, '/finalize'));
    expect(res.status).toBe(200);
    expect(res.json.set).toMatchObject({ final: true, opened: false, result: null });
  });
});

describe('9. the nightly job computes a due set the same way', () => {
  test('a set left open 7 days after its event gets its result and loses its markers', async () => {
    const [a, b] = await openNight(OLD, [{ label: 'One' }, { label: 'Two' }]);
    await fixSecrets(OLD, 5, 10);
    await tally(a, 2);
    await tally(b, 13);
    await voters(OLD, 14);
    await teamVoters(OLD, TEAM_1, 1);
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      daysAgo(10),
      daysAgo(10),
      OLD
    );
    const out = await runVoteFinalJob({ DB: tenv.DB });
    expect(out.finalized).toBeGreaterThanOrEqual(1);
    expect(await row(OLD)).toMatchObject({
      is_final: 1,
      state: 'closed',
      outcome: 'winner',
      winner_object_id: b,
      secret_margin: null,
      secret_floor: null,
    });
    const id = await setId(OLD);
    expect(await one(`SELECT COUNT(*) AS n FROM vote_participants WHERE set_id = ?`, id)).toEqual({
      n: 0,
    });
    expect(await one(`SELECT COUNT(*) AS n FROM vote_team_markers WHERE set_id = ?`, id)).toEqual({
      n: 0,
    });
  });
});

describe('10. the result is written in the same batch as final', () => {
  test('resultStatements sits inside the one db.batch of finalizeVoteSet, before the final UPDATE', () => {
    const sources = JSON.parse(tenv.TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const lib = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/lib/vote-sets.ts')
    )?.[1];
    expect(lib, 'src/lib/vote-sets.ts in TEST_SOURCE_FILES_JSON').toBeTruthy();
    const body = lib!.slice(lib!.indexOf('export async function finalizeVoteSet'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    expect(fn.match(/db\.batch\(/g)).toHaveLength(1);
    const batch = fn.slice(fn.indexOf('db.batch(['));
    const at = batch.indexOf('...resultStatements(');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(batch.indexOf('SET is_final = 1'));
  });
});
