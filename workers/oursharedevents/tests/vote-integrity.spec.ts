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
 *   - THE ROOM SIZE: the first open needs it (10 to 50000, a whole number,
 *     under the platform's ceiling: the venue's room_cap, else 500), writes it
 *     once, and a second open, a reopen and final keep it. No trigger (D1,
 *     migration 0025): the T0 gate votes-never-who holds every write to it.
 *   - THE ROOM CHECK AT FINAL (lib/vote-results.ts ROOM_CHECK_UPDATE): more
 *     distinct voters than the room size flags the night; as many or fewer
 *     does not; the outcome and the winner are the same either way.
 *   - THE FLAGS ARE ONE-WAY: no app path clears flood_seen or burst_seen
 *     (and the T0 gate holds every statement sets them only to 1).
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
import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
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
  ROOM_CEILING_DEFAULT,
} from '../src/lib/vote-sets';
import { VOTING_ON } from '../src/lib/voting-switch';
import {
  VOTE_CODE_WINDOW_SECONDS,
  voteCodeMinute,
  voteCodeStamp,
  voteCodeStampOk,
} from '../src/lib/vote-code-window';
import { VOTE_SCREEN_RELOAD_SECONDS } from '../src/handlers/vote-screen';
import { castVote } from '../src/lib/vote-cast';
import { moveVotable } from '../src/lib/vote-sets';
import { voterKey } from '../src/lib/vote-pass';
import { pepperEpoch } from '../src/lib/anon-id-hash';

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

  test('SECURITY | a stale scan counts nothing and tells the voter to scan again (CCR F7, F12)', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 200));
    await run(`DELETE FROM scan_placement_events WHERE event_id = ?`, EV);
    const rows = async () =>
      (
        await tenv.DB.prepare(`SELECT COUNT(*) AS c FROM scan_placement_events WHERE event_id = ?`)
          .bind(EV)
          .first<{ c: number }>()
      )?.c ?? 0;
    const req = new Request(
      `${ORIGIN}/q/${TOKEN[EV]}?type=vote&w=${await voteCodeStamp(PEPPER, TOKEN[EV], Date.now() - 2 * MINUTE)}`
    );
    const res = await handleQrScan(req, scanEnv(), TOKEN[EV], true);
    expect(res.status).toBe(302);
    // The vote page with no pass: it reads "Scan the code on the screen again."
    expect(res.headers.get('Location')).toBe(`${ORIGIN}/events/${EV}/vote`);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(await rows()).toBe(0);
    // The control: a fresh stamp from a browser with no cookie writes its row,
    // sets the cookie and carries a pass.
    const fresh = await handleQrScan(
      new Request(
        `${ORIGIN}/q/${TOKEN[EV]}?type=vote&w=${await voteCodeStamp(PEPPER, TOKEN[EV], Date.now())}`
      ),
      scanEnv(),
      TOKEN[EV],
      true
    );
    expect(hasPass(fresh)).toBe(true);
    expect(fresh.headers.get('Set-Cookie')).not.toBeNull();
    expect(await rows()).toBe(1);
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

  test('SECURITY | it is fixed: a second open, a reopen and final keep it', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 40));
    // A second open with another size is refused and changes nothing.
    expect(await openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 400)).toMatchObject({ ok: false });
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    expect(await openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 400)).toMatchObject({ ok: false });
    await ok(reopenVoteSet(tenv.DB, EV, PEPPER, nowIso()));
    expect((await setRow(EV))?.room_size).toBe(40);
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    await ok(adminFinalizeVoteSet(tenv.DB, EV, nowIso()));
    expect((await setRow(EV))?.room_size).toBe(40);
    // No statement in the code base writes it without "room_size IS NULL":
    // the T0 gate votes-never-who, rule 5 (no trigger: migration 0025).
  });
});

describe('the room size has a ceiling the host cannot set (owner, 2026-11-26)', () => {
  beforeEach(async () => {
    await run(`UPDATE events SET host_venue_id = NULL WHERE id IN (?, ?)`, EV, EV_2);
  });

  async function atVenue(eventId: string, kind: string | null, cap: number | null) {
    const venueId = `ven_${eventId
      .replace(/[^a-f0-9]/g, '')
      .padEnd(32, 'a')
      .slice(0, 32)}`;
    await run(
      `INSERT OR REPLACE INTO venues (id, brand_id, name, room_kind, room_cap) VALUES (?, 'vi-brand', 'Hall', ?, ?)`,
      venueId,
      kind,
      cap
    );
    await run(`UPDATE events SET host_venue_id = ? WHERE id = ?`, venueId, eventId);
  }

  test('SECURITY | no venue: 500 at most; over it is refused and nothing opens', async () => {
    expect(ROOM_CEILING_DEFAULT).toBe(500);
    const over = await openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 501);
    expect(over).toMatchObject({ ok: false, code: 'ROOM_SIZE_OVER_CEILING' });
    expect((over as { error: string }).error).toContain('500');
    expect(await setRow(EV)).toMatchObject({ room_size: null });
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 500));
  });

  test('SECURITY | indoors: the fire-marshal capacity is the ceiling, even below 500', async () => {
    await atVenue(EV, 'indoor', 120);
    expect(await openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 121)).toMatchObject({
      code: 'ROOM_SIZE_OVER_CEILING',
    });
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 120));
  });

  test('outdoors: the permit limit, which may be above 500; with no permit limit, 500', async () => {
    await atVenue(EV, 'outdoor', 2000);
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 2000));
    await atVenue(EV_2, 'outdoor', null);
    expect(await openVoteSet(tenv.DB, EV_2, PEPPER, nowIso(), 501)).toMatchObject({
      code: 'ROOM_SIZE_OVER_CEILING',
    });
    await ok(openVoteSet(tenv.DB, EV_2, PEPPER, nowIso(), 500));
  });

  test('SECURITY | the ceiling is in the open statement itself, not only in the code before it', async () => {
    // A stale read: the code sees no venue (500), the statement sees 120.
    const real = tenv.DB.prepare.bind(tenv.DB);
    let swapped = false;
    const spy = vi.spyOn(tenv.DB, 'prepare').mockImplementation((sql: string) => {
      if (!swapped && /SELECT v\.room_cap AS cap/.test(sql)) {
        swapped = true;
        return real(`SELECT NULL AS cap WHERE ? IS NOT NULL`);
      }
      return real(sql);
    });
    await atVenue(EV, 'indoor', 120);
    const res = await openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 300);
    spy.mockRestore();
    expect(res).toMatchObject({ ok: false, code: 'ROOM_SIZE_OVER_CEILING' });
    expect(await setRow(EV)).toMatchObject({ room_size: null });
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
      [EV_2, 400],
    ] as const) {
      const song = await ok(
        createVotable(tenv.DB, id, {
          kind: 'song',
          label: 'Only song',
          booth_id: null,
          group_id: null,
          sort: 0,
        })
      );
      await ok(openVoteSet(tenv.DB, id, PEPPER, nowIso(), room));
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

  test('SECURITY | through the cast path: eleven real voters in a room of ten flag the night; ten do not (CCR F14)', async () => {
    const epoch = (await pepperEpoch(PEPPER)) as string;
    for (const [eventId, count] of [
      [EV, 11],
      [EV_2, 10],
    ] as const) {
      const obj = await ok(
        createVotable(tenv.DB, eventId, {
          kind: 'song',
          label: 'One',
          booth_id: null,
          group_id: null,
          sort: 0,
        })
      );
      await ok(openVoteSet(tenv.DB, eventId, PEPPER, nowIso(), 10));
      const id = (obj as unknown as { value: { id: string } }).value.id;
      await ok(moveVotable(tenv.DB, eventId, id, 'open', 600, nowIso()));
      for (let i = 0; i < count; i++) {
        const k = (await voterKey(PEPPER, freshCookie(), eventId)) as string;
        expect(
          await castVote(tenv.DB, PEPPER, {
            eventId,
            objectId: id,
            side: 'up',
            k,
            epoch,
            nowMs: Date.now(),
          })
        ).toBe('accepted');
      }
      await ok(closeVoteSet(tenv.DB, eventId, nowIso()));
      await ok(adminFinalizeVoteSet(tenv.DB, eventId, nowIso()));
    }
    expect((await setRow(EV))?.flood_seen).toBe(1);
    expect((await setRow(EV_2))?.flood_seen).toBe(0);
  });

  test('a set opened before the room size existed is not checked', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 10));
    // As a set opened by the older Worker: no room size, so the row is
    // remade without it.
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

describe('a set with no room size is not reopened (CCR F9)', () => {
  test('SECURITY | a closed set an older Worker opened stays closed; one with a room size reopens', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 50));
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    // As the older Worker left it: opened, closed, no room size.
    await run(`UPDATE vote_sets SET room_size = NULL WHERE event_id = ?`, EV);
    const r = await reopenVoteSet(tenv.DB, EV, PEPPER, nowIso());
    expect(r).toMatchObject({ ok: false, status: 409, code: 'ROOM_SIZE_MISSING' });
    expect((await readVoteSet(tenv.DB, EV))?.state).toBe('closed');
    // It can still be finalized, so its night is not lost.
    await ok(adminFinalizeVoteSet(tenv.DB, EV, nowIso()));
    // The control: a set with its room size reopens.
    await ok(openVoteSet(tenv.DB, EV_2, PEPPER, nowIso(), 50));
    await ok(closeVoteSet(tenv.DB, EV_2, nowIso()));
    await ok(reopenVoteSet(tenv.DB, EV_2, PEPPER, nowIso()));
  });
});

describe('the flags are one-way: no app path clears them', () => {
  test('SECURITY | a close, a reopen and final keep both flags', async () => {
    await ok(openVoteSet(tenv.DB, EV, PEPPER, nowIso(), 10));
    await run(`UPDATE vote_sets SET flood_seen = 1, burst_seen = 1 WHERE event_id = ?`, EV);
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    await ok(reopenVoteSet(tenv.DB, EV, PEPPER, nowIso()));
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    await ok(adminFinalizeVoteSet(tenv.DB, EV, nowIso()));
    const row = await tenv.DB.prepare(
      `SELECT flood_seen, burst_seen FROM vote_sets WHERE event_id = ?`
    )
      .bind(EV)
      .first<{ flood_seen: number; burst_seen: number }>();
    expect(row).toEqual({ flood_seen: 1, burst_seen: 1 });
    // Each flag is a 0-or-1 column; any other value is refused by its CHECK.
    await expect(
      run(`UPDATE vote_sets SET burst_seen = 2 WHERE event_id = ?`, EV)
    ).rejects.toThrow();
    await expect(
      run(`UPDATE vote_sets SET flood_seen = 2 WHERE event_id = ?`, EV)
    ).rejects.toThrow();
  });
});
