/**
 * OSE-2130 (S5 of OSE-1193) — the night's result after the set is final: one
 * winner, or "too close to call, the champion retains", decided by a secret
 * margin T (5 to 9) and a secret voter floor V (10 to 14), with no count
 * anywhere. OSE ADR-040 decisions 4, 7 and 8.
 *
 * Workers-pool layer (miniflare D1). Votes are cast through lib/vote-cast.ts
 * (the S4a write) with a pass per voter, so every number the result reads was
 * written the way a real vote writes it. Admin answers go through the router.
 * T and V are fixed for a case by writing them into the set (the test seam the
 * story names); 0111's CHECK keeps them inside their ranges.
 *
 * Each case names, in brackets, the fault it was watched failing on first.
 *
 * Staging twin: bruno/ose-api/28. Vote route and the night's result (OSE-2128 OSE-2130).
 *
 * @born-red OSE-2130 | method: injected-fault, each removed after; listed in
 *   the PR body | date: 2026-11-19
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { castVote } from '../src/lib/vote-cast';
import { mintVotePass } from '../src/lib/vote-pass';
import {
  closeVoteSet,
  createVotable,
  createVoteSet,
  drawUniform,
  finalizeVoteSet,
  moveVotable,
  openVoteSet,
  readVoteSet,
  reopenVoteSet,
  runVoteFinalJob,
  SECRET_FLOOR_RANGE,
  SECRET_MARGIN_RANGE,
  VOTE_TOO_CLOSE_WORDS,
} from '../src/lib/vote-sets';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;
const PEPPER = tenv.ANON_ID_HASH_PEPPER;
const BRAND = 'brand-vres';
const OWNER = 'owner-vres@example.com';
const TEAM_X = 'grp_cccccccc';
const TEAM_Y = 'grp_dddddddd';
const TEAM_Z = 'grp_eeeeeeee';

type Row = Record<string, any>;
type Json = Record<string, any>;
const one = (sql: string, ...b: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...b)
    .first<Row>();
const run = (sql: string, ...b: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...b)
    .run();

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const now = Math.floor(Date.now() / 1000);
const ADMIN = {
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email: OWNER,
    iat: now - 10,
    exp: now + 3600,
  })}.sig`,
  'Sec-Fetch-Site': 'same-origin',
};

/** Every admin answer this file receives, read at the end for guarded keys. */
const ANSWERS: { path: string; json: Json }[] = [];

async function admin(method: string, path: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://vote-result.test${path}`, {
      method,
      headers: body === undefined ? ADMIN : { ...ADMIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env as unknown as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  const json = (await res.json()) as Json;
  ANSWERS.push({ path, json });
  return { status: res.status, json };
}
const vp = (eventId: string, tail = '') => `/api/v2/admin/events/${eventId}/votables${tail}`;

const iso = () => new Date().toISOString();
async function must<T>(p: Promise<{ ok: true; value: T } | { ok: false }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`setup failed: ${JSON.stringify(r)}`);
  return r.value;
}

interface Night {
  eventId: string;
  setId: string;
  objects: string[];
}
let round = 0;

/** A live night, its set opened and every song open for an hour. */
async function night(
  songs: { label: string; team?: string }[],
  playedBy: 'object' | 'team' = 'object'
): Promise<Night> {
  const eventId = `evt-vres-${++round}`;
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, created_at, updated_at)
     VALUES (?, ?, 'Result night', ?, 'active', date('now'), datetime('now'), datetime('now'))`,
    eventId,
    BRAND,
    eventId
  );
  const set = await must(createVoteSet(tenv.DB, eventId, playedBy));
  const objects: string[] = [];
  for (const s of songs)
    objects.push(
      (
        await must(
          createVotable(tenv.DB, eventId, {
            kind: 'song',
            label: s.label,
            booth_id: null,
            group_id: s.team ?? null,
            sort: objects.length,
          })
        )
      ).id
    );
  await must(openVoteSet(tenv.DB, eventId, PEPPER, iso()));
  for (const id of objects) await must(moveVotable(tenv.DB, eventId, id, 'open', 3600, iso()));
  return { eventId, setId: set.id, objects };
}

/** Fix T and V for this set: the story's test seam. */
const fix = (n: Night, margin: number, floor: number) =>
  run(
    `UPDATE vote_sets SET secret_margin = ?, secret_floor = ? WHERE id = ?`,
    margin,
    floor,
    n.setId
  );

let voter = 0;
/** One new voter casts these votes: [object index, side]. */
async function voterCasts(n: Night, votes: [number, 'up' | 'down'][]): Promise<void> {
  const cookie = `anon_vres-${++voter}-0000-0000-0000`;
  const pass = await mintVotePass(PEPPER, cookie, n.eventId, Date.now());
  for (const [i, side] of votes) {
    const out = await castVote(tenv.DB, PEPPER, {
      eventId: n.eventId,
      objectId: n.objects[i],
      side,
      pass,
      nowMs: Date.now(),
    });
    if (out !== 'accepted') throw new Error(`vote refused: ${out}`);
  }
}
/** `count` new voters each cast one up vote on object `i`. */
async function ups(n: Night, i: number, count: number): Promise<void> {
  for (let c = 0; c < count; c++) await voterCasts(n, [[i, 'up']]);
}

const resultOf = async (n: Night) => (await readVoteSet(tenv.DB, n.eventId))?.result ?? null;
const compute = (n: Night) => admin('POST', vp(n.eventId, '/finalize'), {});

beforeAll(async () => {
  await applyMigrations();
  await run(
    `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
    OWNER,
    BRAND
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TOO_CLOSE = { outcome: 'too_close', winner_id: null };

// ── nothing before final; once, and for good ────────────────────────────────

describe('OSE-2130 | the result exists only once the set is final', () => {
  test('OSE-2130 | SECURITY | no result before the set is final [final check removed]', async () => {
    const n = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(n, 5, 10);
    await ups(n, 0, 12);
    await must(closeVoteSet(tenv.DB, n.eventId, iso()));
    const before = await admin('GET', vp(n.eventId));
    expect(before.json.set.final).toBe(false);
    expect(before.json.set.result).toBeNull();
    expect(await one(`SELECT outcome, winner_id FROM vote_sets WHERE id = ?`, n.setId)).toEqual({
      outcome: null,
      winner_id: null,
    });
    // The database refuses a result on a set that is not final (0114's CHECK).
    for (const [outcome, winner] of [
      ['too_close', null],
      ['winner', n.objects[0]],
    ])
      await expect(
        run(
          `UPDATE vote_sets SET outcome = ?, winner_id = ? WHERE id = ?`,
          outcome,
          winner,
          n.setId
        )
      ).rejects.toThrow(/CHECK/);
    // Nor a winner with no id, or a too_close with one, once final.
    expect((await compute(n)).status).toBe(200);
    await expect(
      run(`UPDATE vote_sets SET winner_id = NULL WHERE id = ? AND outcome = 'winner'`, n.setId)
    ).rejects.toThrow(/CHECK/);
  });

  test('OSE-2130 | computing results sets final, and a second compute changes nothing [recompute allowed]', async () => {
    const n = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(n, 5, 10);
    await ups(n, 0, 11);
    const first = await compute(n);
    expect(first.status).toBe(200);
    expect(first.json.set).toMatchObject({ final: true, state: 'closed' });
    expect(first.json.set.result).toEqual({ outcome: 'winner', winner_id: n.objects[0] });
    // Whatever changes after, the result stays: the counters are not read again.
    await run(`UPDATE vote_tallies SET up_count = 99 WHERE object_id = ?`, n.objects[1]);
    const second = await compute(n);
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('VOTE_SET_FINAL');
    expect(await finalizeVoteSet(tenv.DB, n.setId, n.eventId, 'admin', iso())).toBe(false);
    await runVoteFinalJob({ DB: tenv.DB });
    expect(await resultOf(n)).toEqual({ outcome: 'winner', winner_id: n.objects[0] });
  });

  test('OSE-2130 | final nulls T and V, deletes the receipts and markers, and keeps the tallies for now', async () => {
    const n = await night(
      [
        { label: 'X1', team: TEAM_X },
        { label: 'Y1', team: TEAM_Y },
      ],
      'team'
    );
    await fix(n, 5, 10);
    await ups(n, 0, 3);
    await compute(n);
    expect(
      await one(
        `SELECT secret_margin, secret_floor, is_final, state FROM vote_sets WHERE id = ?`,
        n.setId
      )
    ).toEqual({ secret_margin: null, secret_floor: null, is_final: 1, state: 'closed' });
    const left = await one(
      `SELECT (SELECT COUNT(*) FROM vote_receipts WHERE object_id IN (?, ?)) AS r,
              (SELECT COUNT(*) FROM vote_participants WHERE set_id = ?) AS p,
              (SELECT COUNT(*) FROM vote_team_markers WHERE set_id = ?) AS t,
              (SELECT COUNT(*) FROM vote_tallies WHERE object_id IN (?, ?)) AS tallies`,
      ...n.objects,
      n.setId,
      n.setId,
      ...n.objects
    );
    expect(left).toEqual({ r: 0, p: 0, t: 0, tallies: 2 });
  });

  test('OSE-2130 | SECURITY | result, final, nulling and deletion are one batch [nulling in a second statement]', async () => {
    const n = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(n, 5, 10);
    await ups(n, 0, 10);
    const batches: string[][] = [];
    const outside: string[] = [];
    const spy = new Proxy(tenv.DB, {
      get(target, prop) {
        if (prop === 'prepare')
          return (sql: string) => {
            const stmt = target.prepare(sql);
            return new Proxy(stmt, {
              get(t, p) {
                if (p === 'bind')
                  return (...a: unknown[]) => {
                    const bound = t.bind(...a);
                    (bound as unknown as { __sql: string }).__sql = sql;
                    return new Proxy(bound, {
                      get(bt, bp) {
                        if (bp === 'run' || bp === 'first' || bp === 'all')
                          if (/\b(?:UPDATE|INSERT|DELETE)\b/i.test(sql)) outside.push(sql);
                        const v = Reflect.get(bt, bp);
                        return typeof v === 'function' ? v.bind(bt) : v;
                      },
                    });
                  };
                const v = Reflect.get(t, p);
                return typeof v === 'function' ? v.bind(t) : v;
              },
            });
          };
        if (prop === 'batch')
          return (stmts: D1PreparedStatement[]) => {
            batches.push(stmts.map((s) => (s as unknown as { __sql?: string }).__sql ?? '?'));
            return target.batch(stmts);
          };
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    expect(await finalizeVoteSet(spy, n.setId, n.eventId, 'admin', iso())).toBe(true);
    expect(outside, 'a write outside the one batch').toEqual([]);
    expect(batches).toHaveLength(1);
    const flat = batches[0].map((s) => s.replace(/\s+/g, ' '));
    const finalStmt = flat.find((s) => /UPDATE vote_sets SET/.test(s)) ?? '';
    for (const part of [
      'outcome = (SELECT v_outcome FROM verdict)',
      'winner_id = (SELECT v_winner FROM verdict)',
      'is_final = 1',
      'secret_margin = NULL',
      'secret_floor = NULL',
    ])
      expect(finalStmt, part).toContain(part);
    for (const table of ['vote_receipts', 'vote_participants', 'vote_team_markers'])
      expect(
        flat.some((s) => s.startsWith(`DELETE FROM ${table}`)),
        table
      ).toBe(true);
    // A batch is all or nothing: a batch whose last statement fails leaves the
    // set as it was, its T and V and markers included.
    const m = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(m, 5, 10);
    await ups(m, 0, 10);
    const failing = new Proxy(tenv.DB, {
      get(target, prop) {
        if (prop === 'batch')
          return (stmts: D1PreparedStatement[]) =>
            target.batch([...stmts, target.prepare('SELECT * FROM no_such_table_vres')]);
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    await expect(finalizeVoteSet(failing, m.setId, m.eventId, 'admin', iso())).rejects.toThrow();
    expect(
      await one(
        `SELECT is_final, outcome, secret_margin, secret_floor,
                (SELECT COUNT(*) FROM vote_participants WHERE set_id = vote_sets.id) AS p
           FROM vote_sets WHERE id = ?`,
        m.setId
      )
    ).toEqual({ is_final: 0, outcome: null, secret_margin: 5, secret_floor: 10, p: 10 });
  });
});

// ── the rule: V, then T, no tiebreak ─────────────────────────────────────────

describe('OSE-2130 | the winner rule on the unpublished numbers', () => {
  test('OSE-2130 | SECURITY | below V the night reads too close to call, word for word the same as a close result [a different message under the floor]', async () => {
    // Under the floor: 13 voters, V = 14, a lead of 13 (far above any T).
    const under = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(under, 5, 14);
    await ups(under, 0, 13);
    // A close result: 14 voters (at V), a lead of 4 under T = 5.
    const close = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(close, 5, 14);
    await ups(close, 0, 9);
    await ups(close, 1, 5);
    // A set that never opened, and a tie.
    const tie = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(tie, 5, 10);
    await ups(tie, 0, 6);
    await ups(tie, 1, 6);
    const a = await compute(under);
    const b = await compute(close);
    const c = await compute(tie);
    const strip = (j: Json) => JSON.stringify(j.set.result);
    expect(a.json.set.result).toEqual(TOO_CLOSE);
    expect(strip(a.json)).toBe(strip(b.json));
    expect(strip(c.json)).toBe(strip(b.json));
    expect(VOTE_TOO_CLOSE_WORDS).toBe('Too close to call, the champion retains');
    // Positive control: the same 13 voters reach a floor of 13.
    const at = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(at, 5, 13);
    await ups(at, 0, 13);
    expect((await compute(at)).json.set.result).toEqual({
      outcome: 'winner',
      winner_id: at.objects[0],
    });
  });

  test('OSE-2130 | a lead below T is too close to call; at or above T names the winner [margin fixed at 5]', async () => {
    for (const [margin, lead, wins] of [
      [7, 6, false],
      [7, 7, true],
      [9, 8, false],
      [9, 9, true],
      [5, 4, false],
      [5, 5, true],
    ] as const) {
      const n = await night([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
      await fix(n, margin, 10);
      // 12 + lead voters: the leader gets lead + 4, the runner-up 4, the third 4.
      await ups(n, 1, lead + 4);
      await ups(n, 0, 4);
      await ups(n, 2, 4);
      const r = (await compute(n)).json.set.result;
      expect(r, `T=${margin} lead=${lead}`).toEqual(
        wins ? { outcome: 'winner', winner_id: n.objects[1] } : TOO_CLOSE
      );
    }
  });

  test('OSE-2130 | "not for me" votes are not used, and a voter counts toward V once however many songs they vote on', async () => {
    const n = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(n, 5, 10);
    // 9 voters each back A and say "not for me" to B: 9 distinct voters < 10.
    for (let i = 0; i < 9; i++)
      await voterCasts(n, [
        [0, 'up'],
        [1, 'down'],
      ]);
    expect((await compute(n)).json.set.result).toEqual(TOO_CLOSE);
    // The same, with a tenth voter who only says "not for me": V is reached,
    // and A's lead of 9 is counted on up votes only.
    const m = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(m, 9, 10);
    for (let i = 0; i < 9; i++)
      await voterCasts(m, [
        [0, 'up'],
        [1, 'down'],
      ]);
    await voterCasts(m, [[1, 'down']]);
    expect((await compute(m)).json.set.result).toEqual({
      outcome: 'winner',
      winner_id: m.objects[0],
    });
  });

  test('OSE-2130 | fewer than two in the running is too close to call; a void set gets no result', async () => {
    const solo = await night([{ label: 'Only' }]);
    await fix(solo, 5, 10);
    await ups(solo, 0, 14);
    expect((await compute(solo)).json.set.result).toEqual(TOO_CLOSE);
    const v = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(v, 5, 10);
    await ups(v, 0, 12);
    await run(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch' WHERE id = ?`,
      v.setId
    );
    const r = await compute(v);
    expect(r.status).toBe(200);
    expect(r.json.set).toMatchObject({ final: true, result: null });
    expect(await one(`SELECT outcome, winner_id FROM vote_sets WHERE id = ?`, v.setId)).toEqual({
      outcome: null,
      winner_id: null,
    });
  });

  test("OSE-2130 | SECURITY | on a team night, a voter who backs three of a team's songs adds one to its total [song up counts summed]", async () => {
    const n = await night(
      [
        { label: 'X one', team: TEAM_X },
        { label: 'X two', team: TEAM_X },
        { label: 'X three', team: TEAM_X },
        { label: 'Y one', team: TEAM_Y },
        { label: 'Z one', team: TEAM_Z },
      ],
      'team'
    );
    await fix(n, 5, 10);
    // 4 voters back all three of X's songs: X's total is 4 (12 up votes).
    for (let i = 0; i < 4; i++)
      await voterCasts(n, [
        [0, 'up'],
        [1, 'up'],
        [2, 'up'],
      ]);
    // 9 voters back Y's one song: Y's total is 9. 13 voters reach V.
    await ups(n, 3, 9);
    // Y leads X by 5 distinct voters, which is T: Y wins. Summed, X would have
    // 12 against Y's 9, and the night would be too close to call.
    expect((await compute(n)).json.set.result).toEqual({ outcome: 'winner', winner_id: TEAM_Y });

    // A team night with no lead: too close, no tiebreak by any song or player.
    const m = await night(
      [
        { label: 'X one', team: TEAM_X },
        { label: 'Y one', team: TEAM_Y },
        { label: 'Y two', team: TEAM_Y },
      ],
      'team'
    );
    await fix(m, 5, 10);
    await ups(m, 0, 6);
    for (let i = 0; i < 6; i++)
      await voterCasts(m, [
        [1, 'up'],
        [2, 'up'],
      ]);
    expect((await compute(m)).json.set.result).toEqual(TOO_CLOSE);
  });
});

// ── T and V ──────────────────────────────────────────────────────────────────

describe('OSE-2130 | the secret numbers', () => {
  test('OSE-2130 | T is drawn from 5 to 9 and V from 10 to 14, with no value more likely [modulo bias]', () => {
    expect(SECRET_MARGIN_RANGE).toEqual([5, 9]);
    expect(SECRET_FLOOR_RANGE).toEqual([10, 14]);
    // Rejection: a draw at or above the last whole multiple of 5 below 2^32 is
    // thrown away, not folded in by modulo.
    const feed = (values: number[]) => {
      let i = 0;
      vi.spyOn(crypto, 'getRandomValues').mockImplementation(((arr: Uint32Array) => {
        arr[0] = values[i++];
        return arr;
      }) as typeof crypto.getRandomValues);
    };
    const limit = Math.floor(0x100000000 / 5) * 5; // 4294967295 is above it
    feed([0xffffffff, limit, 7]);
    expect(drawUniform(5, 9)).toBe(5 + (7 % 5));
    vi.restoreAllMocks();
    feed([limit - 1]);
    expect(drawUniform(10, 14)).toBe(10 + ((limit - 1) % 5));
    vi.restoreAllMocks();
    // Over many real draws, each value is as likely as any other: a chi-square
    // test with 4 degrees of freedom, against 18.47 (p = 0.001).
    for (const [lo, hi] of [SECRET_MARGIN_RANGE, SECRET_FLOOR_RANGE]) {
      const draws = 50_000;
      const seen = new Map<number, number>();
      for (let i = 0; i < draws; i++) {
        const v = drawUniform(lo, hi);
        expect(v >= lo && v <= hi).toBe(true);
        seen.set(v, (seen.get(v) ?? 0) + 1);
      }
      expect([...seen.keys()].sort((x, y) => x - y)).toEqual([lo, lo + 1, lo + 2, lo + 3, lo + 4]);
      const expected = draws / 5;
      const chi = [...seen.values()].reduce((a, o) => a + (o - expected) ** 2 / expected, 0);
      expect(chi, `chi-square for ${lo} to ${hi}`).toBeLessThan(18.47);
    }
  });

  test('OSE-2130 | T and V are drawn once at the first open and unchanged by a reopen, with votes between [redrawn at reopen]', async () => {
    const n = await night([{ label: 'A' }, { label: 'B' }]);
    const first = await one(
      `SELECT secret_margin AS t, secret_floor AS v FROM vote_sets WHERE id = ?`,
      n.setId
    );
    expect(first!.t).toBeGreaterThanOrEqual(5);
    expect(first!.v).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < 5; i++) {
      await ups(n, i % 2, 2);
      await must(closeVoteSet(tenv.DB, n.eventId, iso()));
      await must(reopenVoteSet(tenv.DB, n.eventId, PEPPER, iso()));
      expect(
        await one(
          `SELECT secret_margin AS t, secret_floor AS v FROM vote_sets WHERE id = ?`,
          n.setId
        )
      ).toEqual(first);
    }
  });

  test('OSE-2130 | SECURITY | T and V are never in a response or a log line, and are null after final [T returned]', async () => {
    const lines: string[] = [];
    const capture = (...a: unknown[]) =>
      void lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, m).mockImplementation(capture);
    const n = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(n, 8, 13);
    await ups(n, 0, 13);
    const seen = [
      await admin('GET', vp(n.eventId)),
      await compute(n),
      await admin('GET', vp(n.eventId)),
    ];
    // The job on a due set, too.
    const j = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(j, 6, 11);
    await run(
      `UPDATE events SET start_date = date('now', '-10 days'), end_date = date('now', '-10 days') WHERE id = ?`,
      j.eventId
    );
    await runVoteFinalJob({ DB: tenv.DB });
    seen.push(await admin('GET', vp(j.eventId)));
    const keys = (v: unknown, out: string[] = []): string[] => {
      if (Array.isArray(v)) v.forEach((x) => keys(x, out));
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          out.push(k);
          keys(x, out);
        }
      return out;
    };
    for (const a of seen) {
      const ks = keys(a.json);
      expect(ks.filter((k) => /secret|margin|floor|^t$|^v$|threshold|minimum/i.test(k))).toEqual(
        []
      );
    }
    const text = lines.join('\n');
    expect(/secret|margin|floor/i.test(text)).toBe(false);
    for (const set of [n, j])
      expect(
        await one(`SELECT secret_margin, secret_floor FROM vote_sets WHERE id = ?`, set.setId)
      ).toEqual({ secret_margin: null, secret_floor: null });
    expect(lines.some((l) => l.includes('VOTE_FINAL_JOB'))).toBe(true);
  });
});

// ── what an answer and the audit carry ───────────────────────────────────────

describe('OSE-2130 | one result, no number, no reason', () => {
  test('OSE-2130 | SECURITY | exactly one result per set; no per-song result field [per-song outcome returned]', async () => {
    const n = await night([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
    await fix(n, 5, 10);
    await ups(n, 2, 11);
    await compute(n);
    const list = await admin('GET', vp(n.eventId));
    expect(Object.keys(list.json.set.result).sort()).toEqual(['outcome', 'winner_id']);
    for (const o of list.json.objects)
      expect(
        Object.keys(o).filter((k) => /result|outcome|winner|won|rank|place|standing|belt/i.test(k)),
        o.id
      ).toEqual([]);
    expect(list.json.set.result).toEqual({ outcome: 'winner', winner_id: n.objects[2] });
  });

  test('OSE-2130 | SECURITY | the finalize audit entry and the compute response carry no reason field [reason "below floor" written]', async () => {
    const under = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(under, 5, 14);
    await ups(under, 0, 12);
    const won = await night([{ label: 'A' }, { label: 'B' }]);
    await fix(won, 5, 10);
    await ups(won, 0, 12);
    const job = await night([{ label: 'A' }, { label: 'B' }]);
    await run(
      `UPDATE events SET start_date = date('now', '-9 days'), end_date = date('now', '-9 days') WHERE id = ?`,
      job.eventId
    );
    const answers = [await compute(under), await compute(won)];
    await runVoteFinalJob({ DB: tenv.DB });
    const REASON = /reason|rule|why|floor|margin|decided|below|above|lead|cause|close_by/i;
    for (const a of answers) {
      expect(Object.keys(a.json).sort()).toEqual(
        ['ok', 'requestId', 'set', 'status', 'timestamp'].sort()
      );
      expect(Object.keys(a.json.set).sort()).toEqual(
        ['event_id', 'final', 'id', 'opened', 'played_by', 'result', 'state'].sort()
      );
      expect(JSON.stringify(a.json)).not.toMatch(REASON);
    }
    for (const n of [under, won, job]) {
      const rows = (
        await tenv.DB.prepare(
          `SELECT action, details FROM admin_audit_log
            WHERE resource_id = ? AND action IN ('VOTE_SET_FINALIZE', 'VOTE_SET_FINAL')`
        )
          .bind(n.eventId)
          .all<Row>()
      ).results;
      expect(rows.length, n.eventId).toBe(1);
      for (const r of rows) expect(r.details).toBeNull();
    }
  });

  test('OSE-2130 | SECURITY | no per-object count, voter count, participation, net, sum, percent-up or team total in any answer, admin included [up_count returned]', async () => {
    const n = await night(
      [
        { label: 'X1', team: TEAM_X },
        { label: 'Y1', team: TEAM_Y },
      ],
      'team'
    );
    await fix(n, 5, 10);
    await ups(n, 0, 11);
    await ups(n, 1, 2);
    const from = ANSWERS.length;
    await admin('GET', vp(n.eventId));
    await compute(n);
    await admin('GET', vp(n.eventId));
    // This case's own answers, then every admin answer the file has seen.
    expect(ANSWERS.length - from).toBe(3);
    const BANNED =
      /count|tally|tallies|votes?$|voters?|participa|turnout|net|sum|total|percent|pct|share|ratio|score|up$|down$|^n$|margin|floor|runner|second|standing|rank/i;
    const keys = (v: unknown, out: string[] = []): string[] => {
      if (Array.isArray(v)) v.forEach((x) => keys(x, out));
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          out.push(k);
          keys(x, out);
        }
      return out;
    };
    const votables = ANSWERS.filter((a) => a.path.includes('/votables'));
    expect(votables.length).toBeGreaterThanOrEqual(3);
    const bad = votables.flatMap((a) =>
      keys(a.json)
        .filter((k) => BANNED.test(k) && !['status'].includes(k))
        .map((k) => `${a.path}: ${k}`)
    );
    expect(bad).toEqual([]);
    // No number in a set or its result but the HTTP status of the envelope.
    for (const a of votables)
      if (a.json.set) expect(JSON.stringify(a.json.set)).not.toMatch(/:\s*\d/);
  });

  test('OSE-2130 | LOAD | computing results for 50 objects and 500 receipts finishes in under 1 s', async () => {
    const n = await night(Array.from({ length: 50 }, (_, i) => ({ label: `Song ${i + 1}` })));
    await fix(n, 5, 10);
    // 500 receipts: 100 voters, 5 objects each, written as the vote writes them.
    for (let v = 0; v < 100; v++)
      await voterCasts(
        n,
        [0, 1, 2, 3, 4].map((j) => [(v * 7 + j * 11) % 50, 'up'] as [number, 'up'])
      );
    expect(
      (
        await one(
          `SELECT COUNT(*) AS c FROM vote_receipts WHERE object_id IN (SELECT id FROM votable_objects WHERE set_id = ?)`,
          n.setId
        )
      )?.c
    ).toBe(500);
    const t0 = performance.now();
    expect(await finalizeVoteSet(tenv.DB, n.setId, n.eventId, 'admin', iso())).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
