/**
 * Vote integrity (OSE-2234 follow-up; OSE ADR-040 decision 6, amended
 * 2026-11-26: "as stringent as you can make it", results never pushed up or
 * down by outsiders, hosts, sponsors, scripts or AI agents; voting stays in
 * the room).
 *
 * Workers-pool layer (miniflare D1). What it holds:
 *   - THE ROTATING CODE (lib/vote-code-window.ts): `/q` mints a vote pass only
 *     for a stamp from this minute or the one before, made for this code's
 *     token under the pepper. No stamp, an old stamp, a future stamp, another
 *     code's stamp, a tampered seal or no pepper: no pass, and the scan stands.
 *   - THE ROOM SIZE: the first open needs it (10 to 50000, a whole number),
 *     writes it once, a reopen keeps it, and the database refuses any change
 *     to it after (trigger vote_sets_room_size_fixed).
 *   - THE ROOM CHECK AT FINAL (lib/vote-results.ts ROOM_CHECK_UPDATE): more
 *     distinct voters than the room size flags the night; as many or fewer
 *     does not; the outcome and the winner are the same either way.
 *   - THE FLAG IS ONE-WAY in the database itself (trigger
 *     vote_sets_flood_one_way), whatever code runs.
 *   - The room screen reloads well inside one stamp's life.
 *
 * Staging twins: bruno/ose-api/25. Vote pass at scan (OSE-2133), scan 50 (the
 * stamped code mints a pass) and 51 (the bare code mints none); 23. Voting
 * admin (OSE-2127), open 60 (needs the room size).
 *
 * @born-red OSE-2234 | method: injected-fault, each removed after; listed in
 *   the PR body | date: 2026-11-26
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { handleQrScan, type QrScanEnv } from '../src/handlers/qr-scan';
import { signAnonId } from '../src/lib/anonymous-id';
import {
  adminFinalizeVoteSet,
  closeVoteSet,
  createVoteSet,
  createVotable,
  openVoteSet,
  readVoteSet,
  reopenVoteSet,
} from '../src/lib/vote-sets';
import { VOTING_ON } from '../src/lib/voting-switch';
import {
  VOTE_CODE_WINDOW_SECONDS,
  voteCodeMinute,
  voteCodeStamp,
  voteCodeStampOk,
} from '../src/lib/vote-code-window';
import { VOTE_SCREEN_RELOAD_SECONDS } from '../src/handlers/vote-screen';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;
const PEPPER = tenv.ANON_ID_HASH_PEPPER;
const ORIGIN = 'https://vote-integrity.test';
const MINUTE = VOTE_CODE_WINDOW_SECONDS * 1000;

const EV = 'evt-vint-a';
const EV_2 = 'evt-vint-b';
const TOKEN: Record<string, string> = {
  [EV]: 'qrt_vintcode_a_0001',
  [EV_2]: 'qrt_vintcode_b_0001',
};

function makeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
    async delete(k: string) {
      store.delete(k);
    },
  } as unknown as KVNamespace;
}

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();
const setRow = (eventId: string) =>
  tenv.DB.prepare(
    `SELECT id, flood_seen, room_size, outcome, winner_object_id FROM vote_sets WHERE event_id = ?`
  )
    .bind(eventId)
    .first<{
      id: string;
      flood_seen: number;
      room_size: number | null;
      outcome: string | null;
      winner_object_id: string | null;
    }>();

const nowIso = () => new Date().toISOString();
async function ok<T>(p: Promise<{ ok: boolean } & T>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`setup failed: ${JSON.stringify(r)}`);
  return r as T;
}

async function seedEvent(id: string): Promise<void> {
  await run(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date, created_at, updated_at)
     VALUES (?, 'brand-vint', 'Song night', ?, 'active', date('now'), datetime('now'), datetime('now'))`,
    id,
    id
  );
  await run(
    `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token, placement_label, is_vote_code, is_active, created_at)
     VALUES (?, ?, ?, 'Room screen', 1, 1, datetime('now'))`,
    `pd-${id}`,
    id,
    TOKEN[id]
  );
}

async function clear(id: string): Promise<void> {
  const sets = `(SELECT id FROM vote_sets WHERE event_id = ?)`;
  await run(`DELETE FROM vote_participants WHERE set_id IN ${sets}`, id);
  await run(`DELETE FROM vote_team_markers WHERE set_id IN ${sets}`, id);
  await run(
    `DELETE FROM vote_receipts WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id = ?)`,
    id
  );
  await run(
    `DELETE FROM vote_tallies WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id = ?)`,
    id
  );
  await run(`DELETE FROM votable_objects WHERE event_id = ?`, id);
  await run(`DELETE FROM vote_sets WHERE event_id = ?`, id);
}

function scanEnv(over: Partial<QrScanEnv> = {}): QrScanEnv {
  return {
    DB: tenv.DB,
    RATE_LIMIT_KV: makeKV(),
    ANON_ID_HASH_PEPPER: PEPPER,
    VOTING_ENABLED: VOTING_ON,
    ...over,
  };
}

let cookieSeq = 0;
const freshCookie = () => `anon_55555555-6666-7777-8888-${String(++cookieSeq).padStart(12, '0')}`;

/** One scan of EV's vote code with `w` as given (null: no w at all). */
async function scanWith(w: string | null, over: Partial<QrScanEnv> = {}): Promise<Response> {
  const q = w === null ? '' : `&w=${encodeURIComponent(w)}`;
  const req = new Request(`${ORIGIN}/q/${TOKEN[EV]}?type=vote${q}`, {
    headers: { Cookie: `ose_anon=${await signAnonId(freshCookie(), PEPPER)}` },
  });
  return handleQrScan(req, scanEnv(over), TOKEN[EV], true);
}
const hasPass = (res: Response) => (res.headers.get('Location') ?? '').includes('/vote#t=');

/** `n` distinct voters on a set, as the vote route leaves them: participant markers. */
async function voters(setId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const marker = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
    await run(`INSERT INTO vote_participants (set_id, marker) VALUES (?, ?)`, setId, marker);
  }
}

beforeAll(async () => {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
});

beforeEach(async () => {
  for (const id of [EV, EV_2]) {
    await clear(id);
    await seedEvent(id);
    await ok(createVoteSet(tenv.DB, id, 'object'));
  }
});

describe('the rotating vote code', () => {
  test("this minute's stamp mints a pass; so does last minute's", async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 200));
    const now = Date.now();
    expect(hasPass(await scanWith(await voteCodeStamp(PEPPER, TOKEN[EV], now)))).toBe(true);
    expect(hasPass(await scanWith(await voteCodeStamp(PEPPER, TOKEN[EV], now - MINUTE)))).toBe(
      true
    );
  });

  test('SECURITY | a photo goes stale: no stamp, a stamp two minutes old, or a future one mints no pass', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 200));
    const now = Date.now();
    for (const w of [
      null,
      '',
      await voteCodeStamp(PEPPER, TOKEN[EV], now - 2 * MINUTE),
      await voteCodeStamp(PEPPER, TOKEN[EV], now - 60 * MINUTE),
      await voteCodeStamp(PEPPER, TOKEN[EV], now + MINUTE),
    ]) {
      const res = await scanWith(w);
      expect(res.status, String(w)).toBe(302);
      expect(hasPass(res), String(w)).toBe(false);
    }
  });

  test("SECURITY | a forged stamp mints no pass: another code's, a changed seal, another pepper", async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 200));
    const now = Date.now();
    const good = await voteCodeStamp(PEPPER, TOKEN[EV], now);
    const [minute, seal] = good.split('.');
    const flipped = (seal[0] === 'a' ? 'b' : 'a') + seal.slice(1);
    for (const w of [
      await voteCodeStamp(PEPPER, TOKEN[EV_2], now),
      `${minute}.${flipped}`,
      `${minute}.${seal.toUpperCase()}`,
      `${minute}.${seal}0`,
      `${Number(minute) - 0.5}.${seal}`,
      await voteCodeStamp(`${PEPPER}-other`, TOKEN[EV], now),
    ]) {
      expect(hasPass(await scanWith(w)), w).toBe(false);
    }
    // The control: the good stamp still works.
    expect(hasPass(await scanWith(good))).toBe(true);
  });

  test('fails closed: with no pepper no stamp is accepted', async () => {
    const now = Date.now();
    const good = await voteCodeStamp(PEPPER, TOKEN[EV], now);
    expect(await voteCodeStampOk(PEPPER, TOKEN[EV], good, now)).toBe(true);
    expect(await voteCodeStampOk(undefined, TOKEN[EV], good, now)).toBe(false);
    expect(await voteCodeStampOk('', TOKEN[EV], good, now)).toBe(false);
    expect(await voteCodeStampOk(PEPPER, '', good, now)).toBe(false);
  });

  test('a stamp lives from 60 to 120 seconds, and the room screen reloads well inside it', async () => {
    const start = voteCodeMinute(Date.now()) * MINUTE;
    const stamp = await voteCodeStamp(PEPPER, TOKEN[EV], start);
    expect(await voteCodeStampOk(PEPPER, TOKEN[EV], stamp, start + 2 * MINUTE - 1)).toBe(true);
    expect(await voteCodeStampOk(PEPPER, TOKEN[EV], stamp, start + 2 * MINUTE)).toBe(false);
    expect(VOTE_SCREEN_RELOAD_SECONDS * 2).toBeLessThanOrEqual(VOTE_CODE_WINDOW_SECONDS);
  });
});

describe('the room size', () => {
  test('the first open needs it: missing, too small, too big or not whole is refused', async () => {
    for (const bad of [undefined, null, 9, 50001, 12.5, '200', -1, Number.NaN]) {
      const r = await openVoteSet(tenv.DB, EV, PEPPER, nowIso(), bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.code, String(bad)).toMatch(/^ROOM_SIZE_(NEEDED|OUT_OF_RANGE)$/);
    }
    expect((await setRow(EV))?.room_size).toBeNull();
    expect((await readVoteSet(tenv.DB, EV))?.opened).toBe(false);
    const opened = await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 40));
    expect(opened).toMatchObject({ value: { room_size: 40, opened: true } });
  });

  test('SECURITY | it is fixed: a reopen keeps it, and the database refuses any change', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 40));
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    await ok(reopenVoteSet(tenv.DB, EV, PEPPER, nowIso()));
    expect((await setRow(EV))?.room_size).toBe(40);
    // A host who wants to hide padding after the night cannot raise it, by any path.
    await expect(
      run(`UPDATE vote_sets SET room_size = 400 WHERE event_id = ?`, EV)
    ).rejects.toThrow(/room_size is fixed/);
    await expect(
      run(`UPDATE vote_sets SET room_size = NULL WHERE event_id = ?`, EV)
    ).rejects.toThrow(/room_size is fixed/);
    expect((await setRow(EV))?.room_size).toBe(40);
  });
});

describe('the room check at final', () => {
  async function night(eventId: string, room: number, n: number) {
    await ok(openVoteSet(tenv.DB, eventId, PEPPER, nowIso(), room));
    const set = await setRow(eventId);
    await voters(set!.id, n);
    await ok(closeVoteSet(tenv.DB, eventId, nowIso()));
    await ok(adminFinalizeVoteSet(tenv.DB, eventId, nowIso()));
    return setRow(eventId);
  }

  test('SECURITY | more voters than the room holds flags the night; as many does not', async () => {
    expect((await night(EV, 10, 11))?.flood_seen).toBe(1);
    expect((await night(EV_2, 10, 10))?.flood_seen).toBe(0);
    expect((await readVoteSet(tenv.DB, EV))?.flood_seen).toBe(true);
    expect((await readVoteSet(tenv.DB, EV_2))?.flood_seen).toBe(false);
  });

  test('the check only flags: the outcome and the winner are the same either way', async () => {
    const out: Record<string, Awaited<ReturnType<typeof setRow>>> = {};
    for (const [id, room] of [
      [EV, 10],
      [EV_2, 5000],
    ] as const) {
      await ok(openVoteSet(tenv.DB, id, PEPPER, nowIso(), room));
      const song = await ok(
        createVotable(tenv.DB, id, {
          kind: 'song',
          label: 'Only song',
          booth_id: null,
          group_id: null,
          sort: 0,
        })
      );
      const objectId = (song as unknown as { value: { id: string } }).value.id;
      // 15 voters (above any V) and a lead of 15 (above any T): a won night.
      await run(`UPDATE vote_tallies SET up_count = 15 WHERE object_id = ?`, objectId);
      await voters((await setRow(id))!.id, 15);
      await ok(closeVoteSet(tenv.DB, id, nowIso()));
      await ok(adminFinalizeVoteSet(tenv.DB, id, nowIso()));
      out[id] = await setRow(id);
    }
    expect(out[EV]).toMatchObject({ flood_seen: 1, outcome: 'winner' });
    expect(out[EV_2]).toMatchObject({ flood_seen: 0, outcome: 'winner' });
  });

  test('a set opened before the room size existed is not checked', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 10));
    // As a set opened by the older Worker: no room size. The trigger allows
    // only null to null, so the row is remade without it.
    const before = await setRow(EV);
    await run(`DELETE FROM vote_sets WHERE event_id = ?`, EV);
    await run(
      `INSERT INTO vote_sets (id, event_id, state, played_by, pepper_epoch, secret_margin, secret_floor)
       SELECT ?, ?, 'closed', 'object', 'e', 5, 10`,
      before!.id,
      EV
    );
    await voters(before!.id, 30);
    await ok(adminFinalizeVoteSet(tenv.DB, EV, nowIso()));
    expect((await setRow(EV))?.flood_seen).toBe(0);
  });
});

describe('the flag is one-way in the database', () => {
  test('SECURITY | once set, no write turns it back to 0, whatever code runs', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 10));
    await run(`UPDATE vote_sets SET flood_seen = 1 WHERE event_id = ?`, EV);
    await expect(run(`UPDATE vote_sets SET flood_seen = 0 WHERE event_id = ?`, EV)).rejects.toThrow(
      /one-way/
    );
    expect((await setRow(EV))?.flood_seen).toBe(1);
    // Setting it to 1 again is fine (the flood write and the room check may both run).
    await run(`UPDATE vote_sets SET flood_seen = 1 WHERE event_id = ?`, EV);
  });

  test("SECURITY | the host's burst alarm is one-way too: no write clears it", async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 10));
    await run(`UPDATE vote_sets SET burst_seen = 1 WHERE event_id = ?`, EV);
    await expect(run(`UPDATE vote_sets SET burst_seen = 0 WHERE event_id = ?`, EV)).rejects.toThrow(
      /burst_seen is one-way/
    );
    await expect(
      run(`UPDATE vote_sets SET burst_seen = 2 WHERE event_id = ?`, EV)
    ).rejects.toThrow();
    const row = await tenv.DB.prepare(`SELECT burst_seen FROM vote_sets WHERE event_id = ?`)
      .bind(EV)
      .first<{ burst_seen: number }>();
    expect(row?.burst_seen).toBe(1);
  });
});
